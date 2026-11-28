"""Scheduled e-mail digests: narrative + anomaly flags + optional PDF/XLSX report, per filter scope, on a cadence.

Runs inside the API process (see main.py `_run_schedules`); one row per schedule, `next_run_at` drives the queue so
restarts never double-send and a missed slot is sent on the next tick.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.db.models import ReportSchedule, User, utcnow
from app.services.auth_service import AppError
from app.services.filter_service import Filters, preset_range

log = get_logger("schedules")

CADENCES = ("daily", "weekly", "fortnightly")
PRESETS = ("last_7_days", "last_15_days", "last_30_days", "previous_week", "previous_month")
FORMATS = ("pdf", "xlsx", "none")
MAX_RECIPIENTS = 20


def next_run(after: datetime, cadence: str, weekday: int, hour_utc: int) -> datetime:
    """First slot strictly after `after` matching the cadence (UTC, naive)."""
    base = after.replace(minute=0, second=0, microsecond=0)
    if cadence == "daily":
        cand = base.replace(hour=hour_utc)
        return cand if cand > after else cand + timedelta(days=1)
    days_ahead = (weekday - base.weekday()) % 7
    cand = (base + timedelta(days=days_ahead)).replace(hour=hour_utc)
    if cand <= after:
        cand += timedelta(days=7)
    if cadence == "fortnightly":
        # anchor fortnights to ISO week parity so two schedules created on different days stay aligned
        if cand.isocalendar()[1] % 2 == 1:
            cand += timedelta(days=7)
    return cand


class ScheduleService:
    def __init__(self, container: Any) -> None:
        self.c = container

    # ------------------------------------------------------------------ CRUD
    def list(self, db: Session, owner: User) -> List[Dict[str, Any]]:
        q = select(ReportSchedule).order_by(ReportSchedule.created_at.desc())
        if owner.role != "admin":
            q = q.where(ReportSchedule.owner_id == owner.id)
        return [self._dict(db, r) for r in db.execute(q).scalars().all()]

    def _dict(self, db: Session, r: ReportSchedule) -> Dict[str, Any]:
        d = r.to_dict()
        owner = db.get(User, r.owner_id)
        d["owner"] = {"id": owner.id, "name": owner.name, "email": owner.email} if owner else None
        return d

    def create(self, db: Session, owner: User, body: Dict[str, Any]) -> Dict[str, Any]:
        row = ReportSchedule(owner_id=owner.id)
        self._apply(row, body, owner)
        row.next_run_at = next_run(utcnow(), row.cadence, row.weekday, row.hour_utc)
        db.add(row)
        db.flush()
        self.c.auth._audit(db, owner.id, "schedule.create", row.name, recipients=len(row.recipients))
        return self._dict(db, row)

    def update(self, db: Session, owner: User, schedule_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        row = self._get(db, owner, schedule_id)
        self._apply(row, body, owner)
        row.next_run_at = next_run(utcnow(), row.cadence, row.weekday, row.hour_utc) if row.active else None
        self.c.auth._audit(db, owner.id, "schedule.update", row.name)
        return self._dict(db, row)

    def delete(self, db: Session, owner: User, schedule_id: str) -> None:
        row = self._get(db, owner, schedule_id)
        self.c.auth._audit(db, owner.id, "schedule.delete", row.name)
        db.delete(row)

    def _get(self, db: Session, owner: User, schedule_id: str) -> ReportSchedule:
        row = db.get(ReportSchedule, schedule_id)
        if row is None or (owner.role != "admin" and row.owner_id != owner.id):
            from app.core.exceptions import NotFoundError
            raise NotFoundError("Schedule not found")
        return row

    def _apply(self, row: ReportSchedule, body: Dict[str, Any], owner: User) -> None:
        # partial updates keep the stored value when a field is absent
        name = (body.get("name") if "name" in body else row.name or "").strip()
        if not name:
            raise AppError("Give the schedule a name")
        recipients = [str(r).strip().lower() for r in (body["recipients"] if "recipients" in body else row.recipients or []) if str(r).strip()]
        if not recipients:
            raise AppError("Add at least one recipient")
        if len(recipients) > MAX_RECIPIENTS:
            raise AppError(f"At most {MAX_RECIPIENTS} recipients")
        if any("@" not in r for r in recipients):
            raise AppError("Recipients must be e-mail addresses")
        cadence = body.get("cadence", row.cadence or "weekly")
        if cadence not in CADENCES:
            raise AppError("Cadence must be daily, weekly or fortnightly")
        preset = body.get("preset", row.preset or "last_15_days")
        if preset not in PRESETS:
            raise AppError("Unknown period preset")
        fmt = body.get("format", row.format or "pdf")
        if fmt not in FORMATS:
            raise AppError("Format must be pdf, xlsx or none")
        row.name, row.recipients, row.cadence, row.preset, row.format = name, recipients, cadence, preset, fmt
        row.report_type = body.get("report_type", row.report_type or "management") or "management"
        row.weekday = max(0, min(int(body.get("weekday", row.weekday or 0)), 6))
        row.hour_utc = max(0, min(int(body.get("hour_utc", row.hour_utc if row.hour_utc is not None else 6)), 23))
        row.include_narrative = bool(body.get("include_narrative", row.include_narrative if row.include_narrative is not None else True))
        row.active = bool(body.get("active", row.active if row.active is not None else True))
        filters = body.get("filters") or row.filters or {}
        row.filters = {k: v for k, v in filters.items() if k in ("jira_board", "project", "employee", "sprint", "status", "work_type") and v}

    # ------------------------------------------------------------------ running
    def due(self, db: Session, now: Optional[datetime] = None) -> List[ReportSchedule]:
        now = now or utcnow()
        return db.execute(select(ReportSchedule).where(ReportSchedule.active.is_(True), ReportSchedule.next_run_at <= now)).scalars().all()

    def run_due(self, db: Session, now: Optional[datetime] = None) -> int:
        sent = 0
        for row in self.due(db, now):
            try:
                self.run(db, row)
                sent += 1
            except Exception as e:  # keep the queue moving; the failure is recorded on the row
                log.exception("Schedule %s failed", row.name)
                row.last_status = f"error: {str(e)[:200]}"
            row.last_run_at = utcnow()
            row.next_run_at = next_run(utcnow(), row.cadence, row.weekday, row.hour_utc)
            db.commit()
        return sent

    def run(self, db: Session, row: ReportSchedule, send: bool = True) -> Dict[str, Any]:
        """Builds the digest for one schedule (and sends it unless send=False - used by the preview endpoint)."""
        owner = db.get(User, row.owner_id)
        if owner is None or owner.status != "active":
            row.last_status = "skipped: owner inactive"
            return {"sent": False, "reason": row.last_status}
        from app.api.auth_deps import in_demo
        from app.api.deps import scope_filters
        ws = self.c.demo() if in_demo(owner) else self.c
        ws.ensure_loaded() if hasattr(ws, "ensure_loaded") else None
        if not ws.store.is_loaded:
            ws.data.load_all(force=True, reason="schedule")
        start, end = preset_range(row.preset)
        f = Filters.from_query(start_date=start, end_date=end, **(row.filters or {}))
        f = scope_filters(f, ws, owner)
        narrative = ws.narrative.summary(f)
        attachments = []
        if row.format in ("pdf", "xlsx"):
            info = ws.reports.generate(row.report_type, row.format, f, None, created_by=owner.id)
            path = Path(ws.reports.get(info["report_id"])["path"])
            attachments.append((info["file_name"], path.read_bytes()))
        scope = ", ".join(row.filters.get("jira_board", [])) or ", ".join(row.filters.get("project", [])) or "All boards"
        subject = f"{row.name}: {narrative['headline'][:90]}"
        paragraphs = [p["text"] for p in narrative["paragraphs"]] if row.include_narrative else [narrative["headline"]]
        flags = [fl["text"] for fl in narrative["flags"] if fl["severity"] in ("danger", "warning")][:5]
        link = self.c.settings.public_url.rstrip("/") + "/"
        result = {"sent": False, "subject": subject, "paragraphs": paragraphs, "flags": flags, "recipients": row.recipients,
                  "attachment": attachments[0][0] if attachments else None}
        if send:
            out = self.c.email.send_digest(row.recipients, subject, scope, narrative["period"]["label"], paragraphs, flags, link, attachments)
            result["sent"] = bool(out.get("sent"))
            row.last_status = "sent" if out.get("sent") else f"not sent: {out.get('reason', 'unknown')}"
            self.c.auth._audit(db, owner.id, "schedule.sent" if out.get("sent") else "schedule.failed", row.name, recipients=len(row.recipients))
        return result
