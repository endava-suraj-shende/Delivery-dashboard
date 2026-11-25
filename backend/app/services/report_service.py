"""Report generation: PDF (ReportLab), Excel (openpyxl) and CSV."""
from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.graphics.shapes import Drawing, Rect
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    KeepTogether,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.core.config import Settings
from app.core.exceptions import NotFoundError, ValidationFailedError
from app.events.event_bus import EventBus, Events
from app.processors.status_normalizer import CATEGORY_META
from app.services.analytics_service import AnalyticsEngine, category_series
from app.services.filter_service import Filters
from app.utils.text import slugify

COLOR_HEX = {"green": "16A34A", "blue": "2563EB", "orange": "F97316", "amber": "EAB308", "pink": "DB2777", "red": "DC2626",
             "grey": "6B7280", "purple": "7C3AED", "teal": "0D9488", "cyan": "0891B2", "indigo": "4F46E5"}
NAVY = colors.HexColor("#1E293B")
LIGHT = colors.HexColor("#F1F5F9")
ZEBRA = colors.HexColor("#F8FAFC")
BORDER = colors.HexColor("#CBD5E1")
MUTED = colors.HexColor("#64748B")
ACCENT = colors.HexColor("#2563EB")
COLOR_HEX.update({"sky": "0EA5E9", "slate": "64748B", "violet": "A855F7", "lime": "65A30D"})
DARK_HEX = {"green": "#166534", "blue": "#1E40AF", "orange": "#9A3412", "amber": "#854D0E", "pink": "#9D174D", "red": "#991B1B",
            "grey": "#374151", "purple": "#5B21B6", "teal": "#115E59", "cyan": "#155E75", "indigo": "#3730A3", "sky": "#075985",
            "slate": "#334155", "violet": "#6B21A8", "lime": "#3F6212"}


def _hex(tone: str) -> colors.Color:
    return colors.HexColor("#" + COLOR_HEX.get(tone, "6B7280"))


def _dark(tone: str) -> str:
    return DARK_HEX.get(tone, "#374151")


def _tint(c: colors.Color) -> colors.Color:
    return colors.Color(1 - (1 - c.red) * 0.16, 1 - (1 - c.green) * 0.16, 1 - (1 - c.blue) * 0.16)


def _esc(v: str) -> str:
    return v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _bar(frac: float, width: float, color: colors.Color) -> Drawing:
    d = Drawing(width, 6)
    d.add(Rect(0, 0, width, 6, fillColor=LIGHT, strokeColor=None, rx=1.5, ry=1.5))
    d.add(Rect(0, 0, max(1.5, width * max(0.0, min(1.0, frac))), 6, fillColor=color, strokeColor=None, rx=1.5, ry=1.5))
    return d

REPORT_TYPES = {
    "employee": "Individual Employee Report",
    "all_employees": "All Employees Report",
    "team": "Team Performance Report",
    "project": "Project / Team Report",
    "application": "Application Report",
    "jira_board": "Jira Board Report",
    "jira_status": "Jira Ticket Status Report",
    "dev_deployment": "Dev Deployment Report",
    "prod_deployment": "Production Deployment Report",
    "management": "Consolidated Management Report",
}


def _lbl(dim: str, cat: Any) -> str:
    return CATEGORY_META[dim].get(str(cat), CATEGORY_META[dim]["other"])["label"] if cat else ""


def _fmt(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float):
        return f"{v:.1f}"
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    return str(v)


class ReportService:
    def __init__(self, settings: Settings, engine: AnalyticsEngine, bus: EventBus) -> None:
        self.settings = settings
        self.engine = engine
        self.bus = bus
        self._registry: Dict[str, Dict[str, Any]] = {}

    # ------------------------------------------------------------------ public
    def generate(self, report_type: str, fmt: str, filters: Filters, target: Optional[str] = None) -> Dict[str, Any]:
        if report_type not in REPORT_TYPES:
            raise ValidationFailedError(f"Unknown report type '{report_type}'", {"allowed": list(REPORT_TYPES)})
        fmt = fmt.lower()
        if fmt not in ("pdf", "xlsx", "csv"):
            raise ValidationFailedError("Format must be pdf, xlsx or csv")
        filters = self._apply_target(report_type, filters, target)
        data = self._collect(report_type, filters, target)
        if fmt == "pdf":
            content = self._build_pdf(report_type, data, target)
        elif fmt == "xlsx":
            content = self._build_xlsx(report_type, data, target)
        else:
            content = self._build_csv(report_type, data)
        report_id = uuid.uuid4().hex[:12]
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        name = f"{slugify(report_type)}{'_' + slugify(target) if target else ''}_{stamp}.{fmt}"
        path = self.settings.report_dir / name
        path.write_bytes(content)
        info = {"report_id": report_id, "report_type": report_type, "format": fmt, "file_name": name,
                "size_bytes": len(content), "created_at": datetime.now().isoformat(), "target": target,
                "period": data["period"]["label"], "path": str(path)}
        self._registry[report_id] = info
        self._prune()
        self.bus.publish(Events.REPORT_GENERATED, report_id=report_id, report_type=report_type, format=fmt)
        return {k: v for k, v in info.items() if k != "path"}

    def get(self, report_id: str) -> Dict[str, Any]:
        info = self._registry.get(report_id)
        if not info or not Path(info["path"]).exists():
            raise NotFoundError("Report not found or expired")
        return info

    def list(self) -> List[Dict[str, Any]]:
        return [{k: v for k, v in i.items() if k != "path"} for i in sorted(self._registry.values(), key=lambda x: x["created_at"], reverse=True)]

    def _prune(self) -> None:
        items = sorted(self._registry.values(), key=lambda x: x["created_at"], reverse=True)
        for old in items[self.settings.report_retention:]:
            Path(old["path"]).unlink(missing_ok=True)
            self._registry.pop(old["report_id"], None)

    # ------------------------------------------------------------------ data
    @staticmethod
    def _apply_target(report_type: str, f: Filters, target: Optional[str]) -> Filters:
        if not target:
            if report_type in ("employee", "project", "application", "jira_board"):
                raise ValidationFailedError(f"'target' is required for {report_type} reports")
            return f
        key = {"employee": "employee", "project": "project", "application": "application", "jira_board": "jira_board"}.get(report_type)
        if key:
            return Filters(**{**f.__dict__, key: [target]})
        return f

    def _collect(self, report_type: str, f: Filters, target: Optional[str]) -> Dict[str, Any]:
        ov = self.engine.overview(f)
        acts = self.engine.activities_view(f, page=1, page_size=5000)["items"]
        rels = self.engine.releases_view(f)["items"]
        tickets = self.engine.tickets_view(f)["items"]
        dq = self.engine.data_quality(self.engine.resolve_filters(f))
        return {"overview": ov, "activities": acts, "releases": rels, "tickets": tickets, "quality": dq,
                "period": ov["period"], "filters": ov["filters"], "generated_at": datetime.now().strftime("%d %b %Y %H:%M")}

    # ------------------------------------------------------------------ PDF
    PAGE_W = landscape(A4)[0] - 28 * mm  # printable width

    def _styles(self) -> Dict[str, ParagraphStyle]:
        ss = getSampleStyleSheet()
        body = ParagraphStyle("body", parent=ss["BodyText"], fontSize=8.5, leading=11.5, textColor=colors.HexColor("#0F172A"))
        cell = ParagraphStyle("cell", parent=body, fontSize=7.4, leading=9.2)
        return {
            "title": ParagraphStyle("title", parent=ss["Title"], fontSize=19, leading=23, textColor=colors.white, alignment=TA_LEFT, spaceAfter=0),
            "subtitle": ParagraphStyle("subtitle", parent=body, fontSize=8.5, leading=11, textColor=colors.HexColor("#CBD5E1")),
            "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontSize=11.5, leading=14, textColor=NAVY, spaceBefore=0, spaceAfter=0),
            "h2sub": ParagraphStyle("h2sub", parent=body, fontSize=7.5, leading=9.5, textColor=MUTED),
            "body": body,
            "small": ParagraphStyle("small", parent=body, fontSize=7.5, leading=9.5, textColor=MUTED),
            "cell": cell,
            "cell_r": ParagraphStyle("cell_r", parent=cell, alignment=TA_RIGHT),
            "cell_b": ParagraphStyle("cell_b", parent=cell, fontName="Helvetica-Bold"),
            "head": ParagraphStyle("head", parent=cell, textColor=colors.white, fontName="Helvetica-Bold", fontSize=7),
            "head_r": ParagraphStyle("head_r", parent=cell, textColor=colors.white, fontName="Helvetica-Bold", fontSize=7, alignment=TA_RIGHT),
            "kpi_label": ParagraphStyle("kpi_label", parent=body, fontSize=6.8, leading=8.5, textColor=MUTED),
            "kpi_value": ParagraphStyle("kpi_value", parent=body, fontSize=14, leading=16, fontName="Helvetica-Bold", textColor=NAVY),
        }

    def _build_pdf(self, report_type: str, data: Dict[str, Any], target: Optional[str]) -> bytes:
        buf = io.BytesIO()
        title = REPORT_TYPES[report_type] + (f" - {target}" if target else "")
        self._doc_title = title
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=14 * mm, rightMargin=14 * mm,
                                topMargin=14 * mm, bottomMargin=14 * mm, title=title, author=self.settings.app_name)
        st = self._styles()
        self._st = st
        ov = data["overview"]
        k = ov["kpis"]
        story: List[Any] = []

        # -- title band
        chips = ov["filters"]
        active = [f"{key.replace('_', ' ').title()}: {', '.join(v)}" for key, v in chips.items() if isinstance(v, list) and v and key != "label"]
        if chips.get("search"):
            active.append(f"Search: {chips['search']}")
        sub = (f"Reporting period <b>{data['period']['label']}</b> &nbsp;|&nbsp; {data['period']['report_count']} report dates &nbsp;|&nbsp; "
               f"Generated {data['generated_at']} &nbsp;|&nbsp; {self.settings.app_name}")
        band_rows = [[Paragraph(title, st["title"])], [Paragraph(sub, st["subtitle"])]]
        if active:
            band_rows.append([Paragraph("Filters applied: " + " &nbsp;&middot;&nbsp; ".join(active), st["subtitle"])])
        band = Table(band_rows, colWidths=[self.PAGE_W])
        band.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), NAVY), ("LEFTPADDING", (0, 0), (-1, -1), 10),
                                  ("RIGHTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, 0), 9),
                                  ("BOTTOMPADDING", (0, -1), (-1, -1), 9), ("TOPPADDING", (0, 1), (-1, -1), 1),
                                  ("BOTTOMPADDING", (0, 0), (-1, -2), 1), ("ROUNDEDCORNERS", [6, 6, 6, 6])]))
        story.append(band)
        story.append(Spacer(1, 8))

        if report_type == "employee" and ov["employees"]:
            e = ov["employees"][0]
            story.append(self._section("Employee details"))
            story.append(self._kv_table([
                ("Employee", e["employee"]), ("Project / team", e["project"]), ("Jira board", e["jira_board"]),
                ("Team lead", e["team_lead"]), ("Report dates in period", e["reports"]), ("Last report date", e["last_report_date"]),
            ]))
            story.append(Spacer(1, 6))

        story.append(self._section("Key figures", "Unique tickets by latest status, plus deployment and release counts for the period."))
        story.append(self._kpi_tiles([
            ("Tickets worked on", k["total_tickets"], "slate"), ("Completed", k["completed_tickets"], "green"),
            ("In progress", k["in_progress_tickets"], "blue"), ("Pending", k["pending_tickets"], "orange"),
            ("Blocked", k["blocked_tickets"], "red"), ("Analysis", k["analysis_tickets"], "sky"),
            ("Dev deployed", k["dev_deployed"], "teal"), ("Dev pending", k["dev_pending"], "orange"),
            ("Production releases", k["production_releases"], "purple"), ("Deployed to production", k["production_released"], "green"),
            ("Production pending", k["production_pending"], "orange"), ("Active people", k["active_employees"], "slate"),
        ]))
        story.append(Spacer(1, 8))

        story.append(self._section("Distribution", "Share of tickets, work rows and deployment records by category."))
        story.append(self._quad([
            self._dist_table("Ticket status", ov["charts"]["ticket_status"]),
            self._dist_table("Work type", ov["charts"]["work_type"]),
            self._dist_table("Dev deployment", ov["charts"]["dev_deployment"]),
            self._dist_table("Production deployment", ov["charts"]["prod_deployment"]),
        ]))

        if report_type in ("management", "team", "all_employees", "project", "application", "jira_board", "jira_status"):
            story.append(PageBreak())
            story.append(self._section("Employee-wise performance", "One row per person. Counts are unique tickets by latest status; red cells mark blocked work."))
            story.append(self._grid(
                ["Employee", "Project", "Assigned", "Completed", "In progress", "Pending", "Blocked", "Analysis", "Dev deployed", "Prod releases", "Prod deployed", "Completion"],
                [[e["employee"], e["project"], e["unique_tickets"], e["completed"], e["in_progress"], e["pending"], e["blocked"], e["analysis"],
                  e["dev_deployed"], e["production_releases"], e["production_released"],
                  (f"{100 * e['completed'] / e['unique_tickets']:.0f}%" if e["unique_tickets"] else "-")]
                 for e in sorted(ov["employees"], key=lambda x: -x["unique_tickets"])],
                widths=[40, 36, 14, 16, 16, 14, 14, 14, 16, 16, 16, 16], highlight={6: "red", 3: "green"}))
            story.append(Spacer(1, 8))
            story.append(self._section("Project-wise performance", "One row per project across the selected people."))
            story.append(self._grid(
                ["Project", "People", "Assigned", "Completed", "In progress", "Pending", "Blocked", "Backlog", "Dev deployed", "Prod releases", "Prod deployed", "Completion"],
                [[p["project"], p["employees"], p["unique_tickets"], p["completed"], p["in_progress"], p["pending"], p["blocked"], p["backlog"],
                  p["dev_deployed"], p["production_releases"], p["production_released"],
                  (f"{100 * p['completed'] / p['unique_tickets']:.0f}%" if p["unique_tickets"] else "-")]
                 for p in sorted(ov["projects"], key=lambda x: -x["unique_tickets"])],
                widths=[46, 14, 14, 16, 16, 14, 14, 14, 16, 16, 16, 16], highlight={6: "red", 3: "green"}))

        if report_type in ("management", "team") and ov["insights"]:
            story.append(Spacer(1, 8))
            story.append(self._section("Observations", "Rule-based findings for the selected period."))
            story.append(self._insights(ov["insights"]))

        if report_type in ("employee", "all_employees", "team", "management", "project", "application", "jira_board", "jira_status"):
            story.append(PageBreak())
            story.append(self._section(f"Jira tickets ({len(data['tickets'])})", "Latest status per ticket within the period."))
            story.append(self._grid(
                ["Ticket", "Status", "Type", "Employee", "Project", "Dev deploy", "Prod deploy", "Last seen", "Summary"],
                [[t["ticket_id"], t["work_status"], t["work_type"], t["employee"], t["project"], t["dev_deployment"], t["prod_deployment"] if t.get("has_release", True) else "",
                  t["last_seen"], (t["work_details"] or "")[:120]] for t in data["tickets"]],
                widths=[22, 24, 20, 34, 30, 22, 22, 18, 78],
                status_cols={1: "work_status", 2: "work_type", 5: "dev_deployment", 6: "prod_deployment"}))

        if report_type in ("dev_deployment", "management", "employee", "project"):
            story.append(PageBreak())
            story.append(self._section(f"Dev deployment detail ({len(data['activities'])})", "One row per work item reported in the period."))
            story.append(self._grid(
                ["Date", "Employee", "Project", "Ticket", "Type", "Work status", "Dev deployment"],
                [[a["report_date"], a["employee"], a["project"], a["ticket_id"] or a["ticket_raw"], a["work_type"], a["work_status"], a["dev_deployment"]]
                 for a in data["activities"]], widths=[20, 36, 34, 24, 22, 26, 26],
                status_cols={4: "work_type", 5: "work_status", 6: "dev_deployment"}, max_rows=600))

        if report_type in ("prod_deployment", "management", "employee", "project", "team"):
            story.append(PageBreak() if report_type == "prod_deployment" else Spacer(1, 8))
            story.append(self._section(f"Production releases ({len(data['releases'])})", "Release records dated inside the period."))
            story.append(self._grid(
                ["Release date", "Employee", "Project", "Ticket(s)", "Status", "Release details", "Comments"],
                [[r["release_date"], r["employee"], r["project"], r["ticket_raw"], r["prod_deployment"], (r["release_details"] or "")[:140], (r["comments"] or "")[:80]]
                 for r in data["releases"]], widths=[20, 34, 30, 28, 22, 90, 50], status_cols={4: "prod_deployment"}))

        if report_type in ("employee", "all_employees", "management", "team", "project"):
            story.append(PageBreak())
            story.append(self._section(f"Work items ({len(data['activities'])})", "Every work row reported in the period, traceable to its source."))
            story.append(self._grid(
                ["Date", "Employee", "Project", "Ticket", "Type", "Status", "Dev deploy", "Work details", "Comments"],
                [[a["report_date"], a["employee"], a["project"], a["ticket_id"] or a["ticket_raw"] or "", a["work_type"], a["work_status"],
                  a["dev_deployment"], (a["work_details"] or "")[:130], (a["comments"] or "")[:90]] for a in data["activities"]],
                widths=[18, 30, 28, 20, 20, 22, 22, 72, 44], status_cols={4: "work_type", 5: "work_status", 6: "dev_deployment"}, max_rows=600))
            notes = self._notes_for(ov, data)
            if notes:
                story.append(Spacer(1, 8))
                story.append(self._section("Additional work notes"))
                for who, text in notes:
                    story.append(Paragraph(f"<b>{who}:</b> {text}", st["body"]))

        if report_type == "management":
            story.append(PageBreak())
            story.append(self._section("Data quality", "Issues found while reading the source data."))
            q = data["quality"]["summary"]
            story.append(self._kpi_tiles([
                ("Issues", q["total_issues"], "slate"), ("Errors", q["errors"], "red"), ("Warnings", q["warnings"], "orange"),
                ("Missing employee", q["missing_employee"], "orange"), ("Missing ticket id", q["missing_ticket"], "orange"),
                ("Missing status", q["missing_status"], "orange"), ("Invalid dates", q["invalid_dates"], "red"),
                ("Duplicates", q["duplicates"], "amber"), ("Incomplete deployment", q["incomplete_deployment"], "amber"),
                ("Unmapped statuses", q["unmapped_statuses"], "purple"),
            ]))
            story.append(Spacer(1, 6))
            story.append(self._grid(["Severity", "Category", "File", "Row", "Message"],
                                    [[i["severity"], i["category"], i["file_name"], i["row"], i["message"]] for i in data["quality"]["issues"][:300]],
                                    widths=[16, 30, 70, 10, 140]))

        story.append(Spacer(1, 10))
        story.append(self._section("How the numbers are calculated"))
        for rule in ov["calculation_rules"]:
            story.append(Paragraph("&bull; " + rule.replace("*", ""), st["small"]))
        doc.build(story, onFirstPage=self._footer, onLaterPages=self._page_chrome)
        return buf.getvalue()

    # -- chrome
    def _footer(self, canvas: Any, doc: Any) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(14 * mm, 8 * mm, f"{self.settings.app_name}  |  generated {datetime.now():%d %b %Y %H:%M}  |  confidential")
        canvas.drawRightString(landscape(A4)[0] - 14 * mm, 8 * mm, f"Page {doc.page}")
        canvas.restoreState()

    def _page_chrome(self, canvas: Any, doc: Any) -> None:
        self._footer(canvas, doc)
        canvas.saveState()
        w, h = landscape(A4)
        canvas.setFont("Helvetica-Bold", 7.5)
        canvas.setFillColor(NAVY)
        canvas.drawString(14 * mm, h - 9 * mm, getattr(self, "_doc_title", ""))
        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.4)
        canvas.line(14 * mm, h - 10.5 * mm, w - 14 * mm, h - 10.5 * mm)
        canvas.restoreState()

    # -- building blocks
    def _section(self, title: str, subtitle: Optional[str] = None) -> Table:
        st = self._st
        rows = [["", Paragraph(title, st["h2"])]]
        if subtitle:
            rows.append(["", Paragraph(subtitle, st["h2sub"])])
        t = Table(rows, colWidths=[1.6 * mm, self.PAGE_W - 1.6 * mm])
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), ACCENT), ("LEFTPADDING", (1, 0), (1, -1), 6),
                               ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                               ("BOTTOMPADDING", (0, -1), (-1, -1), 5), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
        return t

    def _kv_table(self, pairs: Sequence[tuple]) -> Table:
        st = self._st
        half = (len(pairs) + 1) // 2
        left, right = pairs[:half], pairs[half:]
        rows = []
        for i in range(half):
            lk, lv = left[i]
            rk, rv = right[i] if i < len(right) else ("", "")
            rows.append([Paragraph(lk, st["small"]), Paragraph(_fmt(lv) or "-", st["cell_b"]), Paragraph(rk, st["small"]), Paragraph(_fmt(rv) or "-", st["cell_b"])])
        w = self.PAGE_W
        t = Table(rows, colWidths=[w * 0.14, w * 0.36, w * 0.14, w * 0.36])
        t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.4, BORDER), ("LINEBELOW", (0, 0), (-1, -2), 0.25, BORDER),
                               ("BACKGROUND", (0, 0), (0, -1), LIGHT), ("BACKGROUND", (2, 0), (2, -1), LIGHT),
                               ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
        return t

    def _kpi_tiles(self, items: Sequence[tuple]) -> Table:
        st = self._st
        per_row, gap = 6, 3 * mm
        tile_w = (self.PAGE_W - gap * (per_row - 1)) / per_row
        rows: List[List[Any]] = []
        heights: List[float] = []
        styles: List[tuple] = []
        chunks = [items[i:i + per_row] for i in range(0, len(items), per_row)]
        for ci, chunk in enumerate(chunks):
            r = len(rows)
            row: List[Any] = []
            for c in range(per_row):
                col = c * 2
                if c < len(chunk):
                    label, value, tone = chunk[c]
                    row.append([Paragraph(label, st["kpi_label"]), Paragraph(_fmt(value) or "0", st["kpi_value"])])
                    styles += [("BOX", (col, r), (col, r), 0.4, BORDER), ("BACKGROUND", (col, r), (col, r), colors.white),
                               ("LINEBEFORE", (col, r), (col, r), 2.2, _hex(tone))]
                else:
                    row.append("")
                if c < per_row - 1:
                    row.append("")
            rows.append(row)
            heights.append(15 * mm)
            if ci < len(chunks) - 1:
                rows.append([""] * (per_row * 2 - 1))
                heights.append(gap)
        widths = []
        for c in range(per_row):
            widths.append(tile_w)
            if c < per_row - 1:
                widths.append(gap)
        t = Table(rows, colWidths=widths, rowHeights=heights)
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 0),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 0)] + styles))
        return t

    def _quad(self, cells: Sequence[Any]) -> Table:
        gap = 3 * mm
        w = (self.PAGE_W - gap * 3) / 4
        row: List[Any] = []
        widths: List[float] = []
        for i, c in enumerate(cells):
            row.append(c)
            widths.append(w)
            if i < 3:
                row.append("")
                widths.append(gap)
        t = Table([row], colWidths=widths)
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        return t

    def _pair(self, left: Any, right: Any) -> Table:
        half = (self.PAGE_W - 4 * mm) / 2
        t = Table([[left, "", right]], colWidths=[half, 4 * mm, half])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        return t

    def _dist_table(self, title: str, series: List[Dict[str, Any]]) -> Any:
        st = self._st
        items = [s for s in series if s["value"]]
        width = (self.PAGE_W - 9 * mm) / 4
        header = [Paragraph(title, st["head"]), "", Paragraph("#", st["head_r"]), Paragraph("%", st["head_r"]), Paragraph("", st["head"])]
        if not items:
            rows = [header, ["", Paragraph("No records", st["small"]), "", "", ""]]
        else:
            total = sum(s["value"] for s in items)
            mx = max(s["value"] for s in items)
            bar_w = width * 0.28 - 6
            rows = [header]
            for s in items:
                rows.append(["", Paragraph(s["label"], st["cell"]), Paragraph(str(s["value"]), st["cell_r"]),
                             Paragraph(f"{100 * s['value'] / total:.0f}", st["cell_r"]), _bar(s["value"] / mx, bar_w, _hex(s["color"]))])
        t = Table(rows, colWidths=[2.2 * mm, width * 0.46 - 2.2 * mm, width * 0.13, width * 0.13, width * 0.28])
        ts = [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("SPAN", (0, 0), (1, 0)), ("BOX", (0, 0), (-1, -1), 0.4, BORDER),
              ("LINEBELOW", (0, 1), (-1, -2), 0.25, BORDER), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("LEFTPADDING", (0, 0), (0, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 0)]
        for i, s in enumerate(items, start=1):
            ts.append(("BACKGROUND", (0, i), (0, i), _hex(s["color"])))
        t.setStyle(TableStyle(ts))
        return t

    def _insights(self, insights: List[Dict[str, Any]]) -> Table:
        st = self._st
        tone = {"success": "green", "info": "blue", "warning": "orange", "danger": "red"}
        rows, ts = [], [("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -2), 0.25, BORDER), ("BOX", (0, 0), (-1, -1), 0.4, BORDER),
                        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (0, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 0)]
        for i, ins in enumerate(insights[:14]):
            val = f" &nbsp;<font color='#64748B'>({_fmt(ins['value'])})</font>" if ins.get("value") not in (None, "") else ""
            rows.append(["", Paragraph(f"<b>{ins['title']}</b>{val}<br/>{ins['detail']}", st["cell"])])
            ts.append(("BACKGROUND", (0, i), (0, i), _hex(tone.get(ins["type"], "slate"))))
        t = Table(rows, colWidths=[2.2 * mm, self.PAGE_W - 2.2 * mm])
        t.setStyle(TableStyle(ts))
        return t

    def _grid(self, headers: Sequence[str], rows: Sequence[Sequence[Any]], widths: Optional[Sequence[float]] = None,
              status_cols: Optional[Dict[int, str]] = None, highlight: Optional[Dict[int, str]] = None, max_rows: Optional[int] = None) -> Any:
        st = self._st
        if not rows:
            return Paragraph("<i>No records for the selected period and filters.</i>", st["small"])
        status_cols = status_cols or {}
        highlight = highlight or {}
        shown = list(rows[:max_rows]) if max_rows else list(rows)
        ncols = len(headers)
        numeric = [all(isinstance(r[c], (int, float)) and not isinstance(r[c], bool) or r[c] in (None, "") for r in shown) and any(isinstance(r[c], (int, float)) for r in shown)
                   or (c not in status_cols and all(isinstance(r[c], str) and r[c].endswith("%") or r[c] in ("-", None, "") for r in shown) and any(isinstance(r[c], str) and r[c].endswith("%") for r in shown))
                   for c in range(ncols)]
        data = [[Paragraph(str(h), st["head_r"] if numeric[c] else st["head"]) for c, h in enumerate(headers)]]
        ts: List[tuple] = [
            ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("LINEBELOW", (0, 0), (-1, -1), 0.25, BORDER), ("BOX", (0, 0), (-1, -1), 0.4, BORDER),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ZEBRA]), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]
        for ri, r in enumerate(shown, start=1):
            cells = []
            for c, v in enumerate(r):
                if c in status_cols:
                    dim = status_cols[c]
                    meta = CATEGORY_META[dim].get(str(v)) if v else None
                    label = meta["label"] if meta else (_fmt(v) or "-")
                    color = _hex(meta["color"]) if meta else None
                    if color is not None and v:
                        ts.append(("BACKGROUND", (c, ri), (c, ri), _tint(color)))
                        cells.append(Paragraph(f"<font color='{_dark(meta['color'])}'><b>{_esc(label)}</b></font>", st["cell"]))
                    else:
                        cells.append(Paragraph(_esc(label), st["cell"]))
                    continue
                text = _esc(_fmt(v))
                if c in highlight and isinstance(v, (int, float)) and v > 0:
                    ts.append(("BACKGROUND", (c, ri), (c, ri), _tint(_hex(highlight[c]))))
                    cells.append(Paragraph(f"<font color='{_dark(highlight[c])}'><b>{text}</b></font>", st["cell_r"]))
                else:
                    cells.append(Paragraph(text if text else "<font color='#CBD5E1'>-</font>", st["cell_r"] if numeric[c] else st["cell"]))
            data.append(cells)
        if widths:
            s = sum(widths)
            col_w = [w / s * self.PAGE_W for w in widths]
        else:
            col_w = [self.PAGE_W / ncols] * ncols
        t = Table(data, colWidths=col_w, repeatRows=1)
        t.setStyle(TableStyle(ts))
        if max_rows and len(rows) > max_rows:
            return KeepTogether([t, Spacer(1, 3), Paragraph(f"Showing the first {max_rows} of {len(rows)} rows. Use the Excel or CSV export for the full list.", st["small"])])
        return t

    def _notes_for(self, ov: Dict[str, Any], data: Dict[str, Any]) -> List[tuple]:
        from app.services.filter_service import apply_report_filters
        f = self.engine.resolve_filters(Filters.from_query(**{k: v for k, v in data["filters"].items() if k not in ("label", "days")}))
        reps = apply_report_filters(self.engine.store.reports(), f)
        out: List[tuple] = []
        for _, r in reps.sort_values(["employee", "report_date"]).iterrows():
            for n in r["notes"] or []:
                out.append((f"{r['employee']} ({r['report_date'].date().isoformat() if r['report_date'] == r['report_date'] else '-'})", n))
        return out

    # ------------------------------------------------------------------ Excel
    def _build_xlsx(self, report_type: str, data: Dict[str, Any], target: Optional[str]) -> bytes:
        wb = Workbook()
        ov = data["overview"]
        k = ov["kpis"]
        ws = wb.active
        ws.title = "Executive Summary"
        self._title(ws, REPORT_TYPES[report_type] + (f" — {target}" if target else ""), data)
        kpi_rows = [
            ("Total employees (all data)", k["total_employees"]), ("Active employees in period", k["active_employees"]),
            ("Report dates in period", k["total_reports"]), ("Work rows", k["total_activities"]),
            ("Unique Jira tickets", k["total_tickets"]), ("Completed tickets", k["completed_tickets"]),
            ("In progress tickets", k["in_progress_tickets"]), ("Pending tickets", k["pending_tickets"]),
            ("Blocked tickets", k["blocked_tickets"]), ("Analysis tickets", k["analysis_tickets"]),
            ("Other / unmapped tickets", k["other_status_tickets"]),
            ("Development work rows", k["development_activities"]), ("Analysis work rows", k["analysis_activities"]),
            ("Testing work rows", k["testing_activities"]), ("Dev deployed", k["dev_deployed"]),
            ("Dev pending", k["dev_pending"]), ("Production release records", k["production_releases"]),
            ("Production deployed", k["production_released"]), ("Production pending", k["production_pending"]),
            ("Production blocked / failed", k["production_blocked"]),
        ]
        ws.append([]); ws.append(["KPI", "Value"])
        self._style_header(ws, ws.max_row, 2)
        for row in kpi_rows:
            ws.append(list(row))
        ws.append([])
        for name, dim in (("Ticket status", "ticket_status"), ("Work type", "work_type"),
                          ("Dev deployment", "dev_deployment"), ("Production deployment", "prod_deployment")):
            ws.append([name, "Count"])
            self._style_header(ws, ws.max_row, 2)
            for s in ov["charts"][dim]:
                ws.append([s["label"], s["value"]])
            ws.append([])
        ws.append(["Insights"])
        ws.cell(ws.max_row, 1).font = Font(bold=True)
        for ins in ov["insights"]:
            ws.append([ins["title"], ins["detail"]])
        ws.append([])
        ws.append(["Calculation rules"])
        ws.cell(ws.max_row, 1).font = Font(bold=True)
        for rule in ov["calculation_rules"]:
            ws.append([rule.replace("*", "")])
        self._autosize(ws, {1: 42, 2: 90})

        self._sheet(wb, "Employee Summary", ov["employees"], [
            ("employee", "Employee"), ("project", "Project / Team"), ("application", "Application"), ("jira_board", "Jira Board"),
            ("reports", "Report Dates"), ("total_activities", "Work Rows"), ("unique_tickets", "Assigned Tickets"),
            ("completed", "Completed"), ("in_progress", "In Progress"), ("pending", "Pending"), ("blocked", "Blocked"),
            ("analysis", "Analysis"), ("development", "Development"), ("testing", "Testing"),
            ("dev_deployed", "Dev Deployed"), ("dev_pending", "Dev Pending"), ("production_releases", "Prod Releases"),
            ("production_released", "Prod Deployed"), ("production_pending", "Prod Pending"),
        ], conditional={"Blocked": "red", "Completed": "green"})
        self._sheet(wb, "Project Summary", ov["projects"], [
            ("project", "Project"), ("employees", "Employees"), ("applications", "Applications"), ("jira_boards", "Jira Boards"),
            ("total_activities", "Work Rows"), ("unique_tickets", "Assigned Tickets"), ("completed", "Completed"),
            ("in_progress", "In Progress"), ("pending", "Pending"), ("blocked", "Blocked"), ("backlog", "Backlog"),
            ("analysis", "Analysis"), ("development", "Development"), ("testing", "Testing"), ("dev_deployed", "Dev Deployed"),
            ("production_releases", "Prod Releases"), ("production_released", "Prod Deployed"),
        ], conditional={"Blocked": "red"})
        self._sheet(wb, "Jira Ticket Details", data["tickets"], [
            ("ticket_id", "Jira Ticket ID"), ("work_status_raw", "Work Status (Excel)"), ("work_status", "Status Category"),
            ("work_type_raw", "Work Type"), ("employee", "Employee(s)"), ("project", "Project"), ("application", "Application"),
            ("jira_board", "Jira Board"), ("dev_deployment_raw", "Dev Deployment"), ("prod_required_raw", "Prod Required?"),
            ("prod_deployment_raw", "Prod Deployment"), ("release_date", "Release Date"), ("first_seen", "First Seen"),
            ("last_seen", "Last Seen"), ("activity_count", "Work Rows"), ("status_changed", "Status Changed"),
            ("work_details", "Work Details"), ("ticket_link", "Link"),
        ], categorical="work_status")
        self._sheet(wb, "Development Deployment", data["activities"], [
            ("report_date", "Report Date"), ("employee", "Employee"), ("project", "Project"), ("application", "Application"),
            ("ticket_id", "Jira Ticket ID"), ("work_status_raw", "Work Status"), ("dev_deployment_raw", "Dev Deployment"),
            ("dev_deployment", "Dev Category"), ("prod_required_raw", "Prod Required?"), ("work_details", "Work Details"),
        ], categorical="dev_deployment")
        self._sheet(wb, "Production Deployment", data["releases"], [
            ("release_date", "Release Date"), ("release_date_source", "Date Source"), ("employee", "Employee"),
            ("project", "Project"), ("application", "Application"), ("ticket_raw", "Release Ticket(s)"),
            ("prod_deployment_raw", "Production Status"), ("prod_deployment", "Category"), ("release_details", "Details"),
            ("comments", "Comments"), ("file_name", "Source File"), ("source_row", "Row"),
        ], categorical="prod_deployment")
        self._sheet(wb, "Work Items", data["activities"], [
            ("report_date", "Report Date"), ("employee", "Employee"), ("project", "Project / Team"), ("application", "Application"),
            ("jira_board", "Jira Board"), ("ticket_id", "Jira Ticket ID"), ("ticket_raw", "Ticket (Excel)"),
            ("work_type_raw", "Work Type"), ("work_status_raw", "Work Status"), ("work_status", "Status Category"),
            ("dev_deployment_raw", "Dev Deployment"), ("prod_required_raw", "Prod Required?"), ("work_details", "Work Details"),
            ("comments", "Additional Comments"), ("is_duplicate", "Duplicate"), ("file_name", "Source File"), ("source_row", "Row"),
        ], categorical="work_status")
        self._sheet(wb, "Data Quality", data["quality"]["issues"], [
            ("severity", "Severity"), ("category", "Category"), ("employee", "Employee"), ("file_name", "File"),
            ("sheet", "Sheet"), ("row", "Row"), ("field", "Field"), ("value", "Value"), ("message", "Message"),
        ])
        out = io.BytesIO()
        wb.save(out)
        return out.getvalue()

    def _title(self, ws: Any, title: str, data: Dict[str, Any]) -> None:
        ws.append([title]); ws.append([f"Reporting period: {data['period']['label']}  |  Generated: {data['generated_at']}  |  {self.settings.app_name}"])
        for r, size, color, bold in ((1, 15, "FFFFFF", True), (2, 10, "CBD5E1", False)):
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
            c = ws.cell(r, 1)
            c.font = Font(bold=bold, size=size, color=color)
            c.fill = PatternFill("solid", fgColor="1E293B")
            c.alignment = Alignment(vertical="center", indent=1)
        ws.row_dimensions[1].height = 26
        ws.row_dimensions[2].height = 18

    def _style_header(self, ws: Any, row: int, ncols: int) -> None:
        fill = PatternFill("solid", fgColor="1E293B")
        thin = Side(style="thin", color="CBD5E1")
        for c in range(1, ncols + 1):
            cell = ws.cell(row, c)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = fill
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            cell.border = Border(top=thin, bottom=thin, left=thin, right=thin)

    def _sheet(self, wb: Workbook, name: str, rows: List[Dict[str, Any]], cols: Sequence[tuple],
               conditional: Optional[Dict[str, str]] = None, categorical: Optional[str] = None) -> None:
        ws = wb.create_sheet(name[:31])
        headers = [h for _, h in cols]
        ws.append(headers)
        self._style_header(ws, 1, len(headers))
        zebra = PatternFill("solid", fgColor="F8FAFC")
        for i, r in enumerate(rows, start=2):
            ws.append([_fmt(r.get(key)) if isinstance(r.get(key), list) else r.get(key) for key, _ in cols])
            for c in range(1, len(headers) + 1):
                cell = ws.cell(i, c)
                cell.alignment = Alignment(vertical="top", wrap_text=isinstance(cell.value, str) and len(cell.value) > 40,
                                           horizontal="right" if isinstance(cell.value, (int, float)) and not isinstance(cell.value, bool) else "left")
                if i % 2 == 0:
                    cell.fill = zebra
        ws.row_dimensions[1].height = 22
        ws.freeze_panes = "A2"
        if rows:
            ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{len(rows) + 1}"
        self._autosize(ws)
        if conditional and rows:
            for header, color in conditional.items():
                if header in headers:
                    col = get_column_letter(headers.index(header) + 1)
                    rng = f"{col}2:{col}{len(rows) + 1}"
                    ws.conditional_formatting.add(rng, CellIsRule(operator="greaterThan", formula=["0"],
                                                                  fill=PatternFill("solid", fgColor={"red": "FECACA", "green": "BBF7D0"}[color])))
        if categorical and rows:
            key_idx = next((i for i, (k, _) in enumerate(cols) if k == categorical), None)
            if key_idx is not None:
                for i, r in enumerate(rows, start=2):
                    color = CATEGORY_META[categorical].get(str(r.get(categorical)), {}).get("color")
                    fills = {"green": "BBF7D0", "red": "FECACA", "orange": "FED7AA", "amber": "FEF08A", "pink": "FBCFE8", "purple": "E9D5FF", "blue": "BFDBFE"}
                    if color in fills:
                        ws.cell(i, key_idx + 1).fill = PatternFill("solid", fgColor=fills[color])

    @staticmethod
    def _autosize(ws: Any, overrides: Optional[Dict[int, int]] = None) -> None:
        widths: Dict[int, int] = {}
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is not None:
                    widths[cell.column] = max(widths.get(cell.column, 0), min(len(str(cell.value)), 60))
        for col, w in widths.items():
            ws.column_dimensions[get_column_letter(col)].width = (overrides or {}).get(col, max(10, w + 2))

    # ------------------------------------------------------------------ CSV
    def _build_csv(self, report_type: str, data: Dict[str, Any]) -> bytes:
        buf = io.StringIO()
        if report_type == "prod_deployment":
            rows, cols = data["releases"], ["release_date", "employee", "project", "application", "ticket_raw",
                                             "prod_deployment_raw", "prod_deployment", "release_details", "comments", "file_name", "source_row"]
        elif report_type == "jira_status":
            rows, cols = data["tickets"], ["ticket_id", "work_status_raw", "work_status", "work_type_raw", "employee", "project",
                                            "application", "jira_board", "dev_deployment_raw", "prod_deployment_raw", "first_seen",
                                            "last_seen", "activity_count", "work_details"]
        elif report_type in ("team", "all_employees"):
            rows = data["overview"]["employees"]
            cols = list(rows[0].keys()) if rows else ["employee"]
        else:
            rows, cols = data["activities"], ["report_date", "employee", "project", "application", "jira_board", "ticket_id",
                                               "ticket_raw", "work_type_raw", "work_status_raw", "work_status", "dev_deployment_raw",
                                               "prod_required_raw", "work_details", "comments", "file_name", "source_row"]
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: _fmt(r.get(c)) for c in cols})
        return ("\ufeff" + buf.getvalue()).encode("utf-8")
