"""Reconciliation workflow: acknowledge / resolve / ignore Excel-vs-Jira discrepancies and nudge the people who
need to fix their sheet. Findings are recomputed live by JiraReconcileService; this module only stores and applies
the human decisions on top of them."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.db.models import RECON_STATES, ReconciliationItem, User, utcnow
from app.services.auth_service import AppError

log = get_logger("reconciliation")


def item_key(ticket_id: str, employee: Optional[str]) -> str:
    return f"{(ticket_id or '').upper()}|{(employee or '').strip().lower()}"


class ReconciliationWorkflow:
    def __init__(self, container: Any, workspace: str = "real") -> None:
        self.c = container
        self.workspace = workspace

    # ------------------------------------------------------------------ enrichment
    def decorate(self, db: Session, result: Dict[str, Any]) -> Dict[str, Any]:
        """Attach the stored workflow state to each live finding and add open/handled counts to the summary."""
        items: List[Dict[str, Any]] = result.get("items", [])
        keys = {item_key(r["ticket_id"], r.get("employee")) for r in items if r.get("verdict") != "ok"}
        rows = {}
        if keys:
            for r in db.execute(select(ReconciliationItem).where(ReconciliationItem.workspace == self.workspace,
                                                                 ReconciliationItem.item_key.in_(keys))).scalars():
                rows[r.item_key] = r
        open_count = handled = 0
        for r in items:
            if r.get("verdict") == "ok":
                r["workflow"] = None
                continue
            row = rows.get(item_key(r["ticket_id"], r.get("employee")))
            live_codes = sorted(fl["code"] for fl in r.get("flags", []))
            if row is None:
                r["workflow"] = {"state": "open", "note": None, "codes": live_codes, "updated_by": None, "updated_at": None, "nudged_at": None, "nudge_count": 0}
                open_count += 1
            else:
                d = row.to_dict()
                # a resolved/ignored item whose findings changed since is re-opened automatically
                if row.state in ("resolved", "ignored") and sorted(row.codes or []) != live_codes:
                    d["state"], d["reopened"] = "open", True
                r["workflow"] = d
                if d["state"] in ("open", "acknowledged"):
                    open_count += 1
                else:
                    handled += 1
        result.setdefault("summary", {})["workflow"] = {"open": open_count, "handled": handled}
        return result

    # ------------------------------------------------------------------ actions
    def set_state(self, db: Session, actor: User, ticket_id: str, employee: Optional[str], state: str,
                  note: Optional[str], codes: Iterable[str]) -> Dict[str, Any]:
        if state not in RECON_STATES:
            raise AppError(f"state must be one of {', '.join(RECON_STATES)}")
        key = item_key(ticket_id, employee)
        row = db.execute(select(ReconciliationItem).where(ReconciliationItem.workspace == self.workspace,
                                                          ReconciliationItem.item_key == key)).scalar_one_or_none()
        if row is None:
            row = ReconciliationItem(workspace=self.workspace, item_key=key, ticket_id=ticket_id.upper(), employee=employee)
            db.add(row)
        row.state = state
        if note is not None:
            row.note = note.strip()[:2000] or None
        row.codes = sorted(set(codes))
        row.updated_by = actor.id
        row.updated_at = utcnow()
        db.flush()
        self.c.auth._audit(db, actor.id, f"reconciliation.{state}", f"{ticket_id} / {employee or '-'}")
        return row.to_dict()

    def nudge(self, db: Session, actor: User, employee: str, findings: List[Dict[str, Any]], to_email: Optional[str] = None) -> Dict[str, Any]:
        """E-mail one person the list of their open discrepancies. Recipient: explicit address, else the account whose name matches."""
        open_items = [r for r in findings if (r.get("employee") or "").strip().lower() == employee.strip().lower()
                      and r.get("verdict") in ("error", "warning") and (r.get("workflow") or {}).get("state", "open") in ("open", "acknowledged")]
        if not open_items:
            raise AppError("Nothing to nudge: no open discrepancies for this person in the current scope")
        recipient = to_email or self._email_for(db, employee, open_items)
        if not recipient:
            raise AppError("No e-mail address known for this person. Map them to a Jira user or enter an address.")
        link = self.c.settings.public_url.rstrip("/") + "/excel"
        lines = [f"{r['ticket_id']}: " + "; ".join(fl["message"] for fl in r.get("flags", []) if fl["severity"] in ("error", "warning")) for r in open_items[:25]]
        subject = f"{len(open_items)} status update(s) to check in your bi-weekly sheet"
        out = self.c.email.send_digest([recipient], subject, employee, "Excel vs Jira", 
                                       [f"Hi {employee.split(' ')[0]}, the items below differ between your bi-weekly workbook and Jira. "
                                        f"Please update the sheet (or the Jira ticket) so the next report is accurate.", *lines,
                                        f"Requested by {actor.name}."], [], link)
        now = utcnow()
        for r in open_items:
            key = item_key(r["ticket_id"], r.get("employee"))
            row = db.execute(select(ReconciliationItem).where(ReconciliationItem.workspace == self.workspace,
                                                              ReconciliationItem.item_key == key)).scalar_one_or_none()
            if row is None:
                row = ReconciliationItem(workspace=self.workspace, item_key=key, ticket_id=r["ticket_id"].upper(), employee=r.get("employee"),
                                         codes=sorted(fl["code"] for fl in r.get("flags", [])))
                db.add(row)
            row.nudged_at, row.nudge_count = now, (row.nudge_count or 0) + 1
            row.updated_by = actor.id
        db.flush()
        self.c.auth._audit(db, actor.id, "reconciliation.nudge", employee, items=len(open_items), sent=bool(out.get("sent")))
        return {"sent": bool(out.get("sent")), "reason": out.get("reason"), "recipient": recipient, "items": len(open_items)}

    def _email_for(self, db: Session, employee: str, items: List[Dict[str, Any]]) -> Optional[str]:
        for r in items:
            if r.get("jira_assignee_email"):
                return r["jira_assignee_email"]
        u = db.execute(select(User).where(User.name.ilike(employee.strip()))).scalars().first()
        return u.email if u else None
