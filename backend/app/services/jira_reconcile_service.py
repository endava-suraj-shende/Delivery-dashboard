"""Reconcile Excel work items with live Jira issues.

Excel remains the source of truth for all KPIs; this service produces a *side-by-side*
comparison so Delivery Managers can see where the bi-weekly sheets and Jira disagree.
"""
from __future__ import annotations

import difflib
import json
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

import pandas as pd

from app.core.logging import get_logger
from app.events.event_bus import EventBus, Events
from app.processors.status_normalizer import StatusNormalizer
from app.services.data_store import InMemoryDataStore
from app.services.filter_service import Filters, apply_activity_filters, apply_report_filters
from app.services.jira_board_registry import BoardConfig, JiraBoardRegistry
from app.services.jira_client import JiraClientPool, JiraError, JiraIssue, JiraNotConfigured
from app.utils.text import clean_text, normalize_key

log = get_logger("jira_reconcile")

COMPLETED = {"completed", "deployed"}
RELEASED_STATUS_HINTS = ("deployed", "released", "live", "in production", "prod")

SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2, "ok": 3}

CHECKS = {
    "not_found": ("error", "Ticket not found in Jira (typo, wrong project key, or no permission)"),
    "unverified": ("info", "Could not verify against Jira (sync failed or board unreachable)"),
    "status_conflict": ("error", "Excel status category differs from Jira status"),
    "completed_not_resolved": ("warning", "Excel says Completed but Jira has no resolution / is not done"),
    "jira_done_excel_open": ("warning", "Jira is Done but the sheet still reports it as open"),
    "assignee_mismatch": ("warning", "Jira assignee differs from the reporting employee"),
    "unassigned": ("info", "Ticket is unassigned in Jira"),
    "prod_mismatch": ("warning", "Production status in Excel differs from Jira (fixVersion / status)"),
    "board_mismatch": ("info", "Ticket belongs to a different project than the board named in the sheet"),
    "stale_excel": ("info", "Jira was updated after the latest Excel report for this ticket"),
    "missing_from_excel": ("info", "Jira issue assigned to the employee but not reported in any sheet for the period"),
    "unmapped_board": ("info", "No configured Jira board covers this ticket's project"),
}


@dataclass
class UserMap:
    """Excel employee name -> Jira account (manual overrides persisted to JSON)."""
    overrides: Dict[str, Dict[str, Optional[str]]] = field(default_factory=dict)  # name -> {account_id, display_name, email}
    ignored: List[str] = field(default_factory=list)


class JiraReconcileService:
    def __init__(self, store: InMemoryDataStore, normalizer: StatusNormalizer, registry: JiraBoardRegistry,
                 pool: JiraClientPool, bus: EventBus, user_map_path: Path, auto_sync: bool = True, user_map_store: Any = None) -> None:
        from app.db.repos import FileJsonStore
        self.store, self.normalizer, self.registry, self.pool, self.bus = store, normalizer, registry, pool, bus
        self._user_map_store = user_map_store or FileJsonStore(user_map_path)
        self.auto_sync = auto_sync
        self._lock = threading.RLock()
        self._user_map = self._load_user_map()
        self._issues: Dict[str, JiraIssue] = {}            # KEY -> issue (from Excel ticket lookups)
        self._board_issues: Dict[str, List[JiraIssue]] = {}  # board cfg id -> issues
        self._users: Dict[str, List[Dict[str, Any]]] = {}    # project_key -> users
        self._last_sync: Optional[datetime] = None
        self._last_errors: List[Dict[str, str]] = []
        self._sync_version = 0
        self._store_version_synced = -1
        # set by the container; when the data already comes from Jira there is nothing to reconcile against
        self.source_mode: Callable[[], str] = lambda: "excel"

    # ------------------------------------------------------------------ status
    @property
    def configured(self) -> bool:
        return self.pool.configured or any(b.token_env or b.token_enc for b in self.registry.list())

    def status(self) -> Dict[str, Any]:
        a = self.store.activities()
        ticket_keys = self._excel_ticket_keys(a)
        projects = sorted({k.split("-")[0] for k in ticket_keys})
        boards = [b.to_dict() for b in self.registry.list()]
        covered = {b["project_key"] for b in boards if b["enabled"] and b["project_key"]}
        return {
            "configured": self.configured,
            "email": self.pool.email or None,
            "boards": boards,
            "excel_projects": projects,
            "uncovered_projects": [p for p in projects if p not in covered],
            "excel_board_names": sorted({str(x) for x in self.store.reports()["jira_board"].dropna()}) if len(self.store.reports()) else [],
            "excel_tickets": len(ticket_keys),
            "fetched_issues": len(self._issues),
            "last_sync": self._last_sync.isoformat(timespec="seconds") if self._last_sync else None,
            "errors": self._last_errors,
            "auto_sync": self.auto_sync,
            "stale": self._store_version_synced != self.store.version,
            "user_map": self.user_map_summary(),
        }

    # ------------------------------------------------------------------ user map
    def _load_user_map(self) -> UserMap:
        data = self._user_map_store.read()
        if data:
            try:
                return UserMap(overrides=data.get("overrides", {}), ignored=data.get("ignored", []))
            except Exception:
                pass
        return UserMap()

    def _save_user_map(self) -> None:
        self._user_map_store.write(dict(self._user_map.__dict__))

    def set_user_mapping(self, employee: str, account_id: Optional[str], display_name: Optional[str], email: Optional[str]) -> None:
        with self._lock:
            if account_id is None and display_name is None:
                self._user_map.overrides.pop(employee, None)
            else:
                self._user_map.overrides[employee] = {"account_id": account_id, "display_name": display_name, "email": email}
            self._save_user_map()

    def all_jira_users(self) -> List[Dict[str, Any]]:
        seen: Dict[str, Dict[str, Any]] = {}
        for users in self._users.values():
            for u in users:
                if u.get("account_id") and u["account_id"] not in seen:
                    seen[u["account_id"]] = u
        for iss in self._issues.values():
            if iss.assignee_account_id and iss.assignee_account_id not in seen:
                seen[iss.assignee_account_id] = {"account_id": iss.assignee_account_id, "display_name": iss.assignee,
                                                 "email": iss.assignee_email, "active": True}
        return sorted(seen.values(), key=lambda u: (u.get("display_name") or "").lower())

    @staticmethod
    def _name_tokens(name: str) -> Set[str]:
        return {t for t in re.split(r"[^a-z]+", (name or "").lower()) if len(t) > 1}

    def resolve_employee(self, employee: Optional[str]) -> Dict[str, Any]:
        """Return the best Jira user for an Excel employee name (override > exact > fuzzy)."""
        if not employee:
            return {"employee": employee, "account_id": None, "display_name": None, "email": None, "match": "none", "score": 0}
        ov = self._user_map.overrides.get(employee)
        if ov:
            return {"employee": employee, **ov, "match": "manual", "score": 1.0}
        users = self.all_jira_users()
        key = normalize_key(employee)
        toks = self._name_tokens(employee)
        best: Tuple[float, Optional[Dict[str, Any]], str] = (0.0, None, "none")
        for u in users:
            dn = u.get("display_name") or ""
            dkey = normalize_key(dn)
            if dkey == key:
                return {"employee": employee, "account_id": u["account_id"], "display_name": dn, "email": u.get("email"), "match": "exact", "score": 1.0}
            # same tokens in any order (e.g. "Mancham Lavanya Kumari" vs "Lavanya Kumari Mancham")
            dt = self._name_tokens(dn)
            if toks and dt and (toks == dt or (len(toks & dt) >= 2) or (toks <= dt) or (dt <= toks and len(dt) >= 1 and len(toks) <= 2)):
                score = 0.9 if toks == dt else 0.8 if (toks <= dt or dt <= toks) else 0.7
            else:
                score = difflib.SequenceMatcher(None, key, dkey).ratio()
            if u.get("email") and key.replace(" ", ".") in (u["email"] or "").lower():
                score = max(score, 0.85)
            if score > best[0]:
                best = (score, u, "fuzzy")
        if best[1] and best[0] >= 0.6:
            u = best[1]
            return {"employee": employee, "account_id": u["account_id"], "display_name": u.get("display_name"),
                    "email": u.get("email"), "match": best[2], "score": round(best[0], 2)}
        return {"employee": employee, "account_id": None, "display_name": None, "email": None, "match": "none", "score": round(best[0], 2)}

    def user_map_summary(self) -> List[Dict[str, Any]]:
        reps = self.store.reports()
        names = sorted({str(x) for x in reps["employee"].dropna()}) if len(reps) else []
        return [self.resolve_employee(n) for n in names]

    # ------------------------------------------------------------------ sync
    @staticmethod
    def _excel_ticket_keys(a: pd.DataFrame) -> List[str]:
        if a.empty:
            return []
        return sorted({str(k).upper() for ids in a["ticket_ids"] for k in (ids or [])})

    def _board_for_key(self, key: str, excel_board: Optional[str]) -> Optional[BoardConfig]:
        project = key.split("-")[0] if "-" in key else None
        return self.registry.by_project(project) or self.registry.by_excel_name(excel_board)

    def sync(self, force: bool = False, board_id: Optional[str] = None) -> Dict[str, Any]:
        """Fetch live data for all Excel tickets and the configured boards."""
        if not self.configured:
            raise JiraNotConfigured("Jira credentials are not configured. Set EDD_JIRA_EMAIL and EDD_JIRA_API_TOKEN in .env.")
        with self._lock:
            if force:
                self.pool.clear_cache()
            a = self.store.activities()
            reps = self.store.reports()
            keys = self._excel_ticket_keys(a)
            excel_board_by_key: Dict[str, Optional[str]] = {}
            for ids, board in zip(a["ticket_ids"], a["jira_board"]):
                for k in ids or []:
                    excel_board_by_key.setdefault(str(k).upper(), board)
            errors: List[Dict[str, str]] = []
            boards = [self.registry.get(board_id)] if board_id else self.registry.enabled()

            # 1. group Excel ticket keys per site (via their board) and fetch them
            by_site: Dict[str, Tuple[BoardConfig, List[str]]] = {}
            unmapped: List[str] = []
            for k in keys:
                cfg = self._board_for_key(k, excel_board_by_key.get(k))
                if cfg is None or (board_id and cfg.id != board_id):
                    if cfg is None:
                        unmapped.append(k)
                    continue
                by_site.setdefault(cfg.base_url, (cfg, []))[1].append(k)
            # unmapped tickets: try every configured site (a project may exist on a site without a configured board)
            for cfg in boards:
                if cfg.base_url in by_site:
                    by_site[cfg.base_url][1].extend(k for k in unmapped if k not in by_site[cfg.base_url][1])
                else:
                    by_site[cfg.base_url] = (cfg, list(unmapped))
            issues: Dict[str, JiraIssue] = dict(self._issues) if board_id else {}
            for site, (cfg, site_keys) in by_site.items():
                if not site_keys:
                    continue
                try:
                    client = self.registry.client_for(cfg)
                    found = client.issues_by_keys(site_keys)
                    issues.update(found)
                except JiraError as exc:
                    errors.append({"scope": site, "error": exc.message})
                    log.warning("Jira lookup failed for %s: %s", site, exc.message)

            # 2. board issues + users for 'missing from Excel' and user mapping
            board_issues: Dict[str, List[JiraIssue]] = dict(self._board_issues) if board_id else {}
            users: Dict[str, List[Dict[str, Any]]] = dict(self._users)
            min_date = reps["report_date"].min() if len(reps) else None
            since = (min_date - pd.Timedelta(days=30)).strftime("%Y-%m-%d") if min_date is not None and min_date == min_date else None
            for cfg in boards:
                try:
                    client = self.registry.client_for(cfg)
                    jql = f"updated >= '{since}'" if since else None
                    bi = client.board_issues(cfg.board_id, jql_filter=jql)
                    board_issues[cfg.id] = bi
                    for iss in bi:
                        issues.setdefault(iss.key.upper(), iss)
                    if cfg.project_key:
                        try:
                            users[cfg.project_key] = client.assignable_users(cfg.project_key)
                        except JiraError as exc:
                            log.info("Could not list users for %s: %s", cfg.project_key, exc.message)
                    self.registry.record_sync(cfg.id, len(bi))
                except JiraError as exc:
                    errors.append({"scope": cfg.label, "error": exc.message})
                    self.registry.record_sync(cfg.id, 0, exc.message)

            self._issues, self._board_issues, self._users = issues, board_issues, users
            self._last_sync, self._last_errors = datetime.now(), errors
            self._sync_version += 1
            self._store_version_synced = self.store.version
        self.bus.publish(Events.JIRA_SYNCED, issues=len(issues), errors=len(errors))
        return self.status()

    def ensure_synced(self) -> None:
        if self.source_mode() == "jira":
            return  # dashboards are built from Jira already; the Excel-vs-Jira sync would only re-download the site
        if self.configured and self.auto_sync and (self._last_sync is None or self._store_version_synced != self.store.version):
            try:
                self.sync()
            except JiraError as exc:
                log.warning("Auto-sync skipped: %s", exc.message)

    # ------------------------------------------------------------------ reconciliation
    def _jira_norm(self, issue: Optional[JiraIssue]) -> Optional[str]:
        if issue is None:
            return None
        cat = self.normalizer.normalize("work_status", issue.status).category
        if cat == "other" and issue.status_category:
            cat = {"done": "completed", "indeterminate": "in_progress", "new": "pending"}.get(issue.status_category, "other")
        return cat

    @staticmethod
    def _is_released(issue: JiraIssue) -> Optional[bool]:
        if issue.fix_versions_released:
            return True
        s = (issue.status or "").lower()
        if any(h in s for h in RELEASED_STATUS_HINTS):
            return True
        return None  # unknown

    def _site_failed(self, base_url: str) -> bool:
        return any(e["scope"] == base_url or e["scope"] in {b.label for b in self.registry.list() if b.base_url == base_url}
                   for e in self._last_errors)

    def _site_error(self, base_url: str) -> Optional[str]:
        for e in self._last_errors:
            if e["scope"] == base_url or e["scope"] in {b.label for b in self.registry.list() if b.base_url == base_url}:
                return e["error"]
        return None

    def compare_row(self, row: pd.Series, issue: Optional[JiraIssue], jira_user: Dict[str, Any],
                    release_status: Optional[str]) -> Dict[str, Any]:
        flags: List[Dict[str, str]] = []

        def flag(code: str, detail: str = "") -> None:
            sev, desc = CHECKS[code]
            flags.append({"code": code, "severity": sev, "message": desc if not detail else f"{desc}: {detail}"})

        excel_cat = row["work_status"]
        if issue is None:
            cfg = self._board_for_key(row["_key"], row.get("jira_board"))
            if cfg is None:
                flag("unmapped_board")
            elif self._site_failed(cfg.base_url) or self._last_sync is None:
                flag("unverified", self._site_error(cfg.base_url) or "no sync yet")
            else:
                flag("not_found")
        else:
            jira_cat = self._jira_norm(issue)
            if excel_cat != "other" and jira_cat != "other" and jira_cat is not None:
                ex_done, j_done = excel_cat in COMPLETED, jira_cat in COMPLETED
                if ex_done and not j_done:
                    flag("completed_not_resolved", f"Jira status '{issue.status}'")
                elif j_done and not ex_done:
                    flag("jira_done_excel_open", f"Jira status '{issue.status}'")
                elif excel_cat != jira_cat:
                    flag("status_conflict", f"Excel '{row['work_status_raw']}' vs Jira '{issue.status}'")
            if issue.assignee_account_id:
                if jira_user.get("account_id") and jira_user["account_id"] != issue.assignee_account_id:
                    flag("assignee_mismatch", f"Jira: {issue.assignee}")
            else:
                flag("unassigned")
            if release_status and release_status in ("pending", "not_released", "in_progress") and self._is_released(issue):
                flag("prod_mismatch", f"Jira indicates released ({issue.status}{', ' + ', '.join(issue.fix_versions) if issue.fix_versions else ''})")
            excel_board = clean_text(row.get("jira_board"))
            if excel_board and issue.project_key:
                cfg = self.registry.by_excel_name(excel_board)
                if cfg and cfg.project_key and cfg.project_key.upper() != issue.project_key.upper():
                    flag("board_mismatch", f"issue project {issue.project_key}, sheet board '{excel_board}' â†’ {cfg.project_key}")
            try:
                upd = pd.Timestamp(issue.updated).tz_localize(None) if issue.updated else None
                if upd is not None and row["report_date"] == row["report_date"] and upd.normalize() > pd.Timestamp(row["report_date"]).normalize() and excel_cat not in COMPLETED:
                    flag("stale_excel", f"Jira updated {upd.date().isoformat()}")
            except Exception:
                pass
        worst = min((f["severity"] for f in flags), key=lambda s: SEVERITY_ORDER[s], default="ok")
        return {
            "activity_id": row["activity_id"], "file_id": row["file_id"], "file_name": row["file_name"], "source_row": int(row["source_row"]),
            "report_date": row["report_date"].date().isoformat() if row["report_date"] == row["report_date"] else None,
            "employee": row["employee"], "project": row["project"], "application": row["application"], "excel_board": row["jira_board"],
            "ticket_id": row["_key"], "work_details": row["work_details"],
            "excel_status_raw": row["work_status_raw"], "excel_status": excel_cat,
            "excel_dev_deployment": row["dev_deployment_raw"], "excel_prod_required": row["prod_required_raw"],
            "excel_release_status": release_status,
            "jira_found": issue is not None,
            "jira_status": issue.status if issue else None, "jira_status_category": self._jira_norm(issue),
            "jira_assignee": issue.assignee if issue else None, "jira_assignee_email": issue.assignee_email if issue else None,
            "mapped_jira_user": jira_user.get("display_name"), "user_match": jira_user.get("match"),
            "jira_type": issue.issue_type if issue else None, "jira_priority": issue.priority if issue else None,
            "jira_sprint": issue.sprint if issue else None, "jira_updated": issue.updated if issue else None,
            "jira_resolved": issue.resolved if issue else None, "jira_fix_versions": issue.fix_versions if issue else [],
            "jira_summary": issue.summary if issue else None, "jira_url": issue.url if issue else None,
            "verdict": worst, "flags": flags,
        }

    def reconcile(self, f: Optional[Filters] = None, file_id: Optional[str] = None, include_missing: bool = True) -> Dict[str, Any]:
        self.ensure_synced()
        a = self.store.activities()
        reps = self.store.reports()
        if f is not None:
            a = apply_activity_filters(a, f)
            reps = apply_report_filters(reps, f)
        if file_id:
            a = a[a["file_id"] == file_id]
            reps = reps[reps["file_id"] == file_id]
        rows: List[Dict[str, Any]] = []
        rel = self.store.releases()
        rel_status: Dict[str, str] = {}
        if len(rel):
            for ids, st in zip(rel.sort_values("release_date")["ticket_ids"], rel.sort_values("release_date")["prod_deployment"]):
                for k in ids or []:
                    rel_status[str(k).upper()] = st
        user_cache: Dict[str, Dict[str, Any]] = {}
        seen_keys: Set[str] = set()
        if len(a):
            ex = a[a["has_ticket"]].explode("ticket_ids").rename(columns={"ticket_ids": "_key"})
            ex = ex[ex["_key"].notna()]
            for _, row in ex.iterrows():
                key = str(row["_key"]).upper()
                row = row.copy()
                row["_key"] = key
                seen_keys.add(key)
                emp = row["employee"]
                if emp not in user_cache:
                    user_cache[emp] = self.resolve_employee(emp)
                rows.append(self.compare_row(row, self._issues.get(key), user_cache[emp], rel_status.get(key)))

        # Jira-only issues: assigned to a mapped employee, updated in the period, not in any sheet
        missing: List[Dict[str, Any]] = []
        if include_missing and self._board_issues:
            employees = sorted({str(x) for x in reps["employee"].dropna()}) if len(reps) else []
            acct_to_emp = {}
            for emp in employees:
                u = user_cache.get(emp) or self.resolve_employee(emp)
                user_cache[emp] = u
                if u.get("account_id"):
                    acct_to_emp[u["account_id"]] = emp
            start = pd.Timestamp(f.start_date) if f and f.start_date else None
            end = pd.Timestamp(f.end_date) + pd.Timedelta(days=1) if f and f.end_date else None
            all_excel_keys = set(self._excel_ticket_keys(self.store.activities()))
            for cfg_id, issues in self._board_issues.items():
                for iss in issues:
                    k = iss.key.upper()
                    if k in all_excel_keys or not iss.assignee_account_id or iss.assignee_account_id not in acct_to_emp:
                        continue
                    try:
                        upd = pd.Timestamp(iss.updated).tz_localize(None) if iss.updated else None
                    except Exception:
                        upd = None
                    if start is not None and (upd is None or upd < start):
                        continue
                    if end is not None and upd is not None and upd >= end:
                        continue
                    emp = acct_to_emp[iss.assignee_account_id]
                    if f and f.employee and emp.lower() not in {e.lower() for e in f.employee}:
                        continue
                    sev, desc = CHECKS["missing_from_excel"]
                    missing.append({
                        "activity_id": None, "file_id": None, "file_name": None, "source_row": None, "report_date": None,
                        "employee": emp, "project": None, "application": None, "excel_board": None, "ticket_id": k,
                        "work_details": None, "excel_status_raw": None, "excel_status": None, "excel_dev_deployment": None,
                        "excel_prod_required": None, "excel_release_status": None, "jira_found": True,
                        "jira_status": iss.status, "jira_status_category": self._jira_norm(iss), "jira_assignee": iss.assignee,
                        "jira_assignee_email": iss.assignee_email, "mapped_jira_user": iss.assignee, "user_match": "jira",
                        "jira_type": iss.issue_type, "jira_priority": iss.priority, "jira_sprint": iss.sprint,
                        "jira_updated": iss.updated, "jira_resolved": iss.resolved, "jira_fix_versions": iss.fix_versions,
                        "jira_summary": iss.summary, "jira_url": iss.url, "verdict": sev,
                        "flags": [{"code": "missing_from_excel", "severity": sev, "message": desc}],
                    })
        all_rows = rows + missing
        summary = {
            "compared": len(rows), "matched": sum(1 for r in rows if r["verdict"] == "ok"),
            "errors": sum(1 for r in all_rows if r["verdict"] == "error"),
            "warnings": sum(1 for r in all_rows if r["verdict"] == "warning"),
            "info": sum(1 for r in all_rows if r["verdict"] == "info"),
            "not_found": sum(1 for r in rows if not r["jira_found"] and any(fl["code"] == "not_found" for fl in r["flags"])),
            "unmapped_board": sum(1 for r in rows if any(fl["code"] == "unmapped_board" for fl in r["flags"])),
            "unverified": sum(1 for r in rows if any(fl["code"] == "unverified" for fl in r["flags"])),
            "missing_from_excel": len(missing),
            "by_check": {code: sum(1 for r in all_rows for fl in r["flags"] if fl["code"] == code) for code in CHECKS},
            "last_sync": self._last_sync.isoformat(timespec="seconds") if self._last_sync else None,
            "configured": self.configured,
            "stale": self._store_version_synced != self.store.version,
            "errors_detail": self._last_errors,
        }
        by_emp: Dict[str, Dict[str, int]] = {}
        for r in all_rows:
            d = by_emp.setdefault(r["employee"] or "Unknown", {"employee": r["employee"] or "Unknown", "compared": 0, "ok": 0, "error": 0, "warning": 0, "info": 0})
            d["compared"] += 1
            d[r["verdict"]] += 1
        return {"summary": summary, "items": sorted(all_rows, key=lambda r: (SEVERITY_ORDER[r["verdict"]], r["employee"] or "", r["ticket_id"])),
                "by_employee": sorted(by_emp.values(), key=lambda x: (-x["error"], -x["warning"], x["employee"])),
                "checks": {k: {"severity": v[0], "description": v[1]} for k, v in CHECKS.items()}}

    def issue(self, key: str) -> Optional[Dict[str, Any]]:
        iss = self._issues.get(key.upper())
        return iss.to_dict() if iss else None

    def ticket_lookup(self) -> Dict[str, Dict[str, Any]]:
        """Compact map used to decorate ticket tables."""
        out: Dict[str, Dict[str, Any]] = {}
        for k, iss in self._issues.items():
            out[k] = {"status": iss.status, "category": self._jira_norm(iss), "assignee": iss.assignee, "updated": iss.updated,
                      "sprint": iss.sprint, "url": iss.url}
        return out
