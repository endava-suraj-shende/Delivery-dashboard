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
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
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
BORDER = colors.HexColor("#CBD5E1")

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
    def _build_pdf(self, report_type: str, data: Dict[str, Any], target: Optional[str]) -> bytes:
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=14 * mm, rightMargin=14 * mm,
                                topMargin=14 * mm, bottomMargin=14 * mm,
                                title=REPORT_TYPES[report_type], author=self.settings.app_name)
        ss = getSampleStyleSheet()
        h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=18, textColor=NAVY, alignment=TA_LEFT, spaceAfter=4)
        h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12.5, textColor=NAVY, spaceBefore=8, spaceAfter=4)
        body = ParagraphStyle("body", parent=ss["BodyText"], fontSize=8.5, leading=11)
        small = ParagraphStyle("small", parent=body, fontSize=7.5, textColor=colors.HexColor("#475569"))
        cell = ParagraphStyle("cell", parent=body, fontSize=7.2, leading=8.8)
        head = ParagraphStyle("head", parent=cell, textColor=colors.white, fontName="Helvetica-Bold")
        self._head_style = head

        ov = data["overview"]
        k = ov["kpis"]
        story: List[Any] = []
        title = REPORT_TYPES[report_type] + (f" — {target}" if target else "")
        story.append(Paragraph(title, h1))
        story.append(Paragraph(f"Reporting period: <b>{data['period']['label']}</b> &nbsp;&nbsp;|&nbsp;&nbsp; "
                               f"Reports in period: {data['period']['report_count']} &nbsp;&nbsp;|&nbsp;&nbsp; "
                               f"Generated: {data['generated_at']} &nbsp;&nbsp;|&nbsp;&nbsp; {self.settings.app_name}", small))
        chips = ov["filters"]
        active = [f"{key}: {', '.join(v)}" for key, v in chips.items()
                  if isinstance(v, list) and v and key not in ("label",)]
        if chips.get("search"):
            active.append(f"search: {chips['search']}")
        if active:
            story.append(Paragraph("Active filters: " + " · ".join(active), small))
        story.append(Spacer(1, 6))

        if report_type == "employee" and ov["employees"]:
            e = ov["employees"][0]
            story.append(Paragraph("Employee details", h2))
            story.append(self._kv_table([
                ("Employee", e["employee"]), ("Project / Team", e["project"]), ("Application(s)", e["application"]),
                ("Jira Board", e["jira_board"]), ("Team Lead", e["team_lead"]), ("Reports in period", e["reports"]),
                ("Last report date", e["last_report_date"]),
            ], cell))

        story.append(Paragraph("KPI summary", h2))
        story.append(self._kpi_grid([
            ("Activities", k["total_activities"]), ("Unique tickets", k["total_tickets"]),
            ("Completed", k["completed_tickets"]), ("In progress", k["in_progress_tickets"]),
            ("Pending", k["pending_tickets"]), ("Blocked", k["blocked_tickets"]),
            ("Analysis", k["analysis_tickets"]), ("Other / unmapped", k["other_status_tickets"]),
            ("Dev deployed", k["dev_deployed"]), ("Dev pending", k["dev_pending"]),
            ("Prod releases", k["production_releases"]), ("Prod deployed", k["production_released"]),
        ]))

        story.append(Paragraph("Jira status distribution (unique tickets)", h2))
        story.append(self._dist_table(ov["charts"]["ticket_status"], cell))
        story.append(Paragraph("Work type distribution (activities)", h2))
        story.append(self._dist_table(ov["charts"]["work_type"], cell))
        story.append(Paragraph("Dev deployment summary (activities)", h2))
        story.append(self._dist_table(ov["charts"]["dev_deployment"], cell))
        story.append(Paragraph("Production deployment summary (release records)", h2))
        story.append(self._dist_table(ov["charts"]["prod_deployment"], cell))

        if report_type in ("management", "team", "all_employees", "project", "application", "jira_board", "jira_status"):
            story.append(PageBreak())
            story.append(Paragraph("Employee-wise performance", h2))
            story.append(self._grid(
                ["Employee", "Project", "Activities", "Tickets", "Completed", "In Prog.", "Pending", "Blocked", "Analysis", "Dev", "Test", "Dev Deployed", "Prod Rel."],
                [[e["employee"], e["project"], e["total_activities"], e["unique_tickets"], e["completed"], e["in_progress"],
                  e["pending"], e["blocked"], e["analysis"], e["development"], e["testing"], e["dev_deployed"], e["production_releases"]]
                 for e in ov["employees"]], cell, widths=[38, 40, 16, 14, 16, 14, 14, 14, 14, 12, 12, 18, 14]))
            story.append(Paragraph("Project-wise performance", h2))
            story.append(self._grid(
                ["Project", "Employees", "Activities", "Tickets", "Completed", "In Prog.", "Pending", "Blocked", "Backlog", "Dev Deployed", "Prod Rel.", "Prod Deployed"],
                [[p["project"], p["employees"], p["total_activities"], p["unique_tickets"], p["completed"], p["in_progress"],
                  p["pending"], p["blocked"], p["backlog"], p["dev_deployed"], p["production_releases"], p["production_released"]]
                 for p in ov["projects"]], cell))

        if report_type in ("management", "team"):
            story.append(Paragraph("Management insights", h2))
            for ins in ov["insights"]:
                story.append(Paragraph(f"• <b>{ins['title']}</b> — {ins['detail']}", body))

        if report_type in ("employee", "all_employees", "team", "management", "project", "application", "jira_board", "jira_status"):
            story.append(PageBreak())
            story.append(Paragraph("Jira tickets (latest status per ticket)", h2))
            story.append(self._grid(
                ["Ticket", "Status", "Type", "Employee", "Project", "Application", "Dev Deploy", "Prod Deploy", "Last seen", "Summary"],
                [[t["ticket_id"], t["work_status_raw"] or _lbl("work_status", t["work_status"]), t["work_type_raw"] or "",
                  t["employee"], t["project"], t["application"], t["dev_deployment_raw"] or "", t["prod_deployment_raw"] or "",
                  t["last_seen"], (t["work_details"] or "")[:110]] for t in data["tickets"]], cell,
                widths=[22, 20, 20, 32, 30, 28, 20, 20, 18, 60]))

        if report_type in ("dev_deployment", "management", "employee", "project"):
            story.append(PageBreak())
            story.append(Paragraph("Dev deployment detail", h2))
            story.append(self._grid(
                ["Date", "Employee", "Project", "Application", "Ticket", "Work status", "Dev deployment", "Prod required"],
                [[a["report_date"], a["employee"], a["project"], a["application"], a["ticket_id"] or a["ticket_raw"],
                  a["work_status_raw"], a["dev_deployment_raw"], a["prod_required_raw"]] for a in data["activities"]], cell))

        if report_type in ("prod_deployment", "management", "employee", "project", "team"):
            story.append(Paragraph("Production releases", h2))
            story.append(self._grid(
                ["Release date", "Employee", "Project", "Application", "Ticket(s)", "Status", "Details"],
                [[r["release_date"], r["employee"], r["project"], r["application"], r["ticket_raw"], r["prod_deployment_raw"],
                  (r["release_details"] or "")[:120]] for r in data["releases"]], cell, widths=[20, 34, 34, 30, 26, 20, 90]))

        if report_type in ("employee", "all_employees", "management", "team", "project"):
            story.append(PageBreak())
            story.append(Paragraph("Detailed activity records", h2))
            story.append(self._grid(
                ["Date", "Employee", "Project", "Application", "Ticket", "Type", "Status", "Dev Deploy", "Work details", "Comments"],
                [[a["report_date"], a["employee"], a["project"], a["application"], a["ticket_id"] or a["ticket_raw"] or "",
                  a["work_type_raw"], a["work_status_raw"], a["dev_deployment_raw"], (a["work_details"] or "")[:120],
                  (a["comments"] or "")[:100]] for a in data["activities"]], cell,
                widths=[18, 30, 28, 26, 20, 18, 18, 18, 60, 48]))
            notes = self._notes_for(ov, data)
            if notes:
                story.append(Paragraph("Additional work notes", h2))
                for who, text in notes:
                    story.append(Paragraph(f"<b>{who}:</b> {text}", body))

        if report_type == "management":
            story.append(PageBreak())
            story.append(Paragraph("Data quality observations", h2))
            s = data["quality"]["summary"]
            story.append(self._kpi_grid([
                ("Issues", s["total_issues"]), ("Errors", s["errors"]), ("Warnings", s["warnings"]),
                ("Missing employee", s["missing_employee"]), ("Missing ticket id", s["missing_ticket"]),
                ("Missing status", s["missing_status"]), ("Invalid dates", s["invalid_dates"]),
                ("Duplicates", s["duplicates"]), ("Incomplete deployment", s["incomplete_deployment"]),
                ("Unmapped statuses", s["unmapped_statuses"]),
            ]))
            story.append(self._grid(["Severity", "Category", "File", "Row", "Message"],
                                    [[i["severity"], i["category"], i["file_name"], i["row"], i["message"]]
                                     for i in data["quality"]["issues"][:300]], cell, widths=[16, 30, 70, 10, 140]))

        story.append(Spacer(1, 8))
        story.append(Paragraph("Calculation rules", h2))
        for rule in ov["calculation_rules"]:
            story.append(Paragraph("• " + rule.replace("*", ""), small))
        doc.build(story, onFirstPage=self._footer, onLaterPages=self._footer)
        return buf.getvalue()

    def _footer(self, canvas: Any, doc: Any) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(14 * mm, 8 * mm, f"{self.settings.app_name} · generated {datetime.now():%d %b %Y %H:%M}")
        canvas.drawRightString(landscape(A4)[0] - 14 * mm, 8 * mm, f"Page {doc.page}")
        canvas.restoreState()

    def _notes_for(self, ov: Dict[str, Any], data: Dict[str, Any]) -> List[tuple]:
        from app.services.filter_service import apply_report_filters
        f = self.engine.resolve_filters(Filters.from_query(**{k: v for k, v in data["filters"].items() if k not in ("label", "days")}))
        reps = apply_report_filters(self.engine.store.reports(), f)
        out: List[tuple] = []
        for _, r in reps.sort_values(["employee", "report_date"]).iterrows():
            for n in r["notes"] or []:
                out.append((f"{r['employee']} ({r['report_date'].date().isoformat() if r['report_date'] == r['report_date'] else '-'})", n))
        return out

    def _kv_table(self, pairs: Sequence[tuple], style: ParagraphStyle) -> Table:
        rows = [[Paragraph(f"<b>{k}</b>", style), Paragraph(_fmt(v), style)] for k, v in pairs]
        t = Table(rows, colWidths=[40 * mm, 200 * mm])
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, BORDER), ("BACKGROUND", (0, 0), (0, -1), LIGHT),
                               ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        return t

    def _kpi_grid(self, items: Sequence[tuple]) -> Table:
        per_row = 6
        rows: List[List[Any]] = []
        for i in range(0, len(items), per_row):
            chunk = items[i:i + per_row]
            rows.append([Paragraph(f"<font size=7 color='#64748B'>{k}</font><br/><font size=13><b>{_fmt(v)}</b></font>",
                                   getSampleStyleSheet()["BodyText"]) for k, v in chunk] + [""] * (per_row - len(chunk)))
        t = Table(rows, colWidths=[45 * mm] * per_row, rowHeights=14 * mm)
        t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.3, BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.3, BORDER),
                               ("BACKGROUND", (0, 0), (-1, -1), LIGHT), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                               ("LEFTPADDING", (0, 0), (-1, -1), 6)]))
        return t

    def _dist_table(self, series: List[Dict[str, Any]], style: ParagraphStyle) -> Table:
        total = sum(s["value"] for s in series) or 1
        hs = getattr(self, "_head_style", style)
        header = [Paragraph("Category", hs), Paragraph("Count", hs), Paragraph("Share", hs)]
        rows = [header] + [[Paragraph(s["label"], style), Paragraph(str(s["value"]), style),
                            Paragraph(f"{100 * s['value'] / total:.0f}%", style)] for s in series if s["value"]]
        t = Table(rows, colWidths=[70 * mm, 25 * mm, 25 * mm])
        ts = [("GRID", (0, 0), (-1, -1), 0.3, BORDER), ("BACKGROUND", (0, 0), (-1, 0), NAVY),
              ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
        for i, s in enumerate([s for s in series if s["value"]], start=1):
            ts.append(("LINEBEFORE", (0, i), (0, i), 3, colors.HexColor("#" + COLOR_HEX.get(s["color"], "6B7280"))))
        t.setStyle(TableStyle(ts))
        return t

    def _grid(self, headers: Sequence[str], rows: Sequence[Sequence[Any]], style: ParagraphStyle,
              widths: Optional[Sequence[float]] = None) -> Any:
        if not rows:
            return Paragraph("<i>No records for the selected period / filters.</i>", style)
        hs = getattr(self, "_head_style", style)
        data = [[Paragraph(str(h), hs) for h in headers]]
        for r in rows:
            data.append([Paragraph(_fmt(v).replace("&", "&amp;").replace("<", "&lt;"), style) for v in r])
        total_w = 269 * mm
        if widths:
            s = sum(widths)
            col_w = [w / s * total_w for w in widths]
        else:
            col_w = [total_w / len(headers)] * len(headers)
        t = Table(data, colWidths=col_w, repeatRows=1)
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.25, BORDER), ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ]))
        return t

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
            ("Reports in period", k["total_reports"]), ("Total activities", k["total_activities"]),
            ("Unique Jira tickets", k["total_tickets"]), ("Completed tickets", k["completed_tickets"]),
            ("In progress tickets", k["in_progress_tickets"]), ("Pending tickets", k["pending_tickets"]),
            ("Blocked tickets", k["blocked_tickets"]), ("Analysis tickets", k["analysis_tickets"]),
            ("Other / unmapped tickets", k["other_status_tickets"]),
            ("Development activities", k["development_activities"]), ("Analysis activities", k["analysis_activities"]),
            ("Testing activities", k["testing_activities"]), ("Dev deployed", k["dev_deployed"]),
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
            ("reports", "Reports"), ("total_activities", "Activities"), ("unique_tickets", "Unique Tickets"),
            ("completed", "Completed"), ("in_progress", "In Progress"), ("pending", "Pending"), ("blocked", "Blocked"),
            ("analysis", "Analysis"), ("development", "Development"), ("testing", "Testing"),
            ("dev_deployed", "Dev Deployed"), ("dev_pending", "Dev Pending"), ("production_releases", "Prod Releases"),
            ("production_released", "Prod Deployed"), ("production_pending", "Prod Pending"),
        ], conditional={"Blocked": "red", "Completed": "green"})
        self._sheet(wb, "Project Summary", ov["projects"], [
            ("project", "Project"), ("employees", "Employees"), ("applications", "Applications"), ("jira_boards", "Jira Boards"),
            ("total_activities", "Activities"), ("unique_tickets", "Unique Tickets"), ("completed", "Completed"),
            ("in_progress", "In Progress"), ("pending", "Pending"), ("blocked", "Blocked"), ("backlog", "Backlog"),
            ("analysis", "Analysis"), ("development", "Development"), ("testing", "Testing"), ("dev_deployed", "Dev Deployed"),
            ("production_releases", "Prod Releases"), ("production_released", "Prod Deployed"),
        ], conditional={"Blocked": "red"})
        self._sheet(wb, "Jira Ticket Details", data["tickets"], [
            ("ticket_id", "Jira Ticket ID"), ("work_status_raw", "Work Status (Excel)"), ("work_status", "Status Category"),
            ("work_type_raw", "Work Type"), ("employee", "Employee(s)"), ("project", "Project"), ("application", "Application"),
            ("jira_board", "Jira Board"), ("dev_deployment_raw", "Dev Deployment"), ("prod_required_raw", "Prod Required?"),
            ("prod_deployment_raw", "Prod Deployment"), ("release_date", "Release Date"), ("first_seen", "First Seen"),
            ("last_seen", "Last Seen"), ("activity_count", "Activity Rows"), ("status_changed", "Status Changed"),
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
        self._sheet(wb, "Detailed Activities", data["activities"], [
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
        ws.append([title]); ws.cell(1, 1).font = Font(bold=True, size=14, color="1E293B")
        ws.append([f"Reporting period: {data['period']['label']}  |  Generated: {data['generated_at']}"])
        ws.cell(2, 1).font = Font(italic=True, color="64748B")

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
        for r in rows:
            ws.append([_fmt(r.get(key)) if isinstance(r.get(key), list) else r.get(key) for key, _ in cols])
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
