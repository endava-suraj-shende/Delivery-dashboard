"""Low-level Excel workbook access (read-only, never modifies the source)."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import openpyxl

from app.core.exceptions import InvalidFileError
from app.core.logging import get_logger

log = get_logger("excel_reader")

Grid = List[List[Any]]


@dataclass
class SheetData:
    name: str
    grid: Grid
    max_row: int
    max_col: int

    @property
    def is_empty(self) -> bool:
        return not any(any(c is not None for c in row) for row in self.grid)


@dataclass
class WorkbookData:
    path: Path
    file_name: str
    size_bytes: int
    modified_at: datetime
    checksum: str
    sheets: List[SheetData] = field(default_factory=list)

    def sheet(self, name: str) -> Optional[SheetData]:
        return next((s for s in self.sheets if s.name == name), None)

    @property
    def sheet_names(self) -> List[str]:
        return [s.name for s in self.sheets]


def file_checksum(path: Path, chunk: int = 1 << 16) -> str:
    h = hashlib.sha1()
    with path.open("rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def _trim_grid(grid: Grid) -> Grid:
    """Drop trailing fully-empty rows and columns."""
    while grid and all(c is None for c in grid[-1]):
        grid.pop()
    if not grid:
        return grid
    width = max(len(r) for r in grid)
    last_col = 0
    for r in grid:
        for i in range(len(r) - 1, -1, -1):
            if r[i] is not None:
                last_col = max(last_col, i + 1)
                break
    return [list(r[:last_col]) + [None] * (last_col - len(r[:last_col])) for r in grid] if last_col else [[] for _ in grid]


def _read_xlsx(path: Path) -> List[SheetData]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheets: List[SheetData] = []
    try:
        for ws in wb.worksheets:
            grid = [list(row) for row in ws.iter_rows(values_only=True)]
            grid = _trim_grid(grid)
            sheets.append(SheetData(ws.title, grid, len(grid), max((len(r) for r in grid), default=0)))
    finally:
        wb.close()
    return sheets


def _read_xls(path: Path) -> List[SheetData]:
    try:
        import xlrd  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise InvalidFileError("Legacy .xls support requires the 'xlrd' package") from exc
    book = xlrd.open_workbook(str(path))
    sheets: List[SheetData] = []
    for sh in book.sheets():
        grid: Grid = []
        for r in range(sh.nrows):
            row: List[Any] = []
            for c in range(sh.ncols):
                cell = sh.cell(r, c)
                if cell.ctype == xlrd.XL_CELL_EMPTY or cell.ctype == xlrd.XL_CELL_BLANK:
                    row.append(None)
                elif cell.ctype == xlrd.XL_CELL_DATE:
                    row.append(datetime(*xlrd.xldate_as_tuple(cell.value, book.datemode)))
                elif cell.ctype == xlrd.XL_CELL_NUMBER and float(cell.value).is_integer():
                    row.append(int(cell.value))
                else:
                    row.append(cell.value)
            grid.append(row)
        grid = _trim_grid(grid)
        sheets.append(SheetData(sh.name, grid, len(grid), max((len(r) for r in grid), default=0)))
    return sheets


def read_workbook(path: Path) -> WorkbookData:
    path = Path(path)
    if not path.exists() or not path.is_file():
        raise InvalidFileError(f"Workbook not found: {path.name}")
    suffix = path.suffix.lower()
    try:
        if suffix in (".xlsx", ".xlsm"):
            sheets = _read_xlsx(path)
        elif suffix == ".xls":
            sheets = _read_xls(path)
        else:
            raise InvalidFileError(f"Unsupported file type '{suffix}'")
    except InvalidFileError:
        raise
    except Exception as exc:
        log.warning("Failed to read workbook %s: %s", path.name, exc)
        raise InvalidFileError(f"Could not read workbook '{path.name}': {exc.__class__.__name__}") from exc
    stat = path.stat()
    return WorkbookData(
        path=path,
        file_name=path.name,
        size_bytes=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime),
        checksum=file_checksum(path),
        sheets=sheets,
    )


def list_sheet_names(path: Path) -> List[str]:
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        wb = openpyxl.load_workbook(path, read_only=True)
        try:
            return list(wb.sheetnames)
        finally:
            wb.close()
    return [s.name for s in read_workbook(path).sheets]


def preview_rows(sheet: SheetData, limit: int = 25) -> Dict[str, Any]:
    rows = [[_json_safe(c) for c in r] for r in sheet.grid[:limit]]
    return {"sheet": sheet.name, "total_rows": sheet.max_row, "total_columns": sheet.max_col, "rows": rows}


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def folder_signature(paths: Sequence[Path]) -> str:
    """Cheap signature of a set of files (name + size + mtime) for cache invalidation."""
    h = hashlib.sha1()
    for p in sorted(paths):
        try:
            st = p.stat()
            h.update(f"{p}|{st.st_size}|{int(st.st_mtime)}".encode())
        except OSError:
            continue
    return h.hexdigest()
