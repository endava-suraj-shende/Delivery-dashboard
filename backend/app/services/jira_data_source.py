"""Jira boards as the primary data source.

Produces the same ``ParsedReport`` structure as the Excel template parser so that
every dashboard, KPI, chart and report works unchanged. Mapping:

* one **activity** = one status transition in an issue's changelog (plus a snapshot
  row at the last update when it happened on a later day) — the Jira analogue of one
  Excel work-item row per bi-weekly report;
* one **report** = (board, assignee, date) — the Jira analogue of one workbook;
* **production releases** = fixVersions (release flag + release date) and transitions
  into production statuses.

Field ids for Team / Sprint / Story Points / Epic etc. are resolved by *name* per site,
so the mapping survives different Jira configurations.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from app.core.logging import get_logger
from app.processors.status_normalizer import StatusNormalizer
from app.processors.template_parser import DataIssue, ParsedReport, ReportMetadata
from app.services.jira_board_registry import BoardConfig, JiraBoardRegistry
from app.services.jira_client import JiraError, JiraSiteClient
from app.utils.text import clean_text

log = get_logger("jira_source")

BASE_FIELDS = ["summary", "status", "assignee", "reporter", "issuetype", "priority", "created", "updated",
               "resolutiondate", "resolution", "fixVersions", "labels", "components", "project", "parent", "duedate",
               "description", "comment"]

# field display name -> canonical key (resolved per site)
NAMED_FIELDS: Dict[str, Sequence[str]] = {
    "team": ("Team",),
    "sprint": ("Sprint",),
    "story_points": ("Story Points", "Story point estimate"),
    "epic_link": ("Epic Link",),
    "epic_name": ("Epic Name",),
    "tech_lead": ("Technical Lead", "Tech Lead"),
    "environment": ("SD - Environment", "Environment", "Site Environments"),
    "module": ("Module",),
}

PROD_STATUS_HINTS = ("in prod", "in production", "released", "live", "deployed to prod")
_PAREN_RE = re.compile(r"\s*\([^)]*\)\s*$")


def _ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        try:
            return datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None


def _d(value: Optional[str]) -> Optional[date]:
    t = _ts(value)
    if t:
        return t.date()
    try:
        return date.fromisoformat((value or "")[:10])
    except ValueError:
        return None


def clean_person(name: Optional[str]) -> Optional[str]:
    """'Suraj Gopal Shende (Omnicom)' -> 'Suraj Gopal Shende'."""
    text = clean_text(name)
    return _PAREN_RE.sub("", text) if text else None


def adf_to_text(node: Any, limit: int = 600) -> Optional[str]:
    """Flatten an Atlassian Document Format tree (or plain string) to text."""
    if node is None:
        return None
    if isinstance(node, str):
        return clean_text(node[:limit])
    parts: List[str] = []

    def walk(n: Any) -> None:
        if isinstance(n, dict):
            if n.get("type") == "text":
                parts.append(n.get("text", ""))
            elif n.get("type") == "mention":
                parts.append((n.get("attrs") or {}).get("text", ""))
            elif n.get("type") in ("hardBreak", "paragraph", "heading", "listItem"):
                parts.append(" ")
            for c in n.get("content") or []:
                walk(c)
        elif isinstance(n, list):
            for c in n:
                walk(c)

    walk(node)
    text = clean_text("".join(parts))
    return text[:limit] if text else None


@dataclass
class SprintInfo:
    id: Optional[int]
    name: str
    state: Optional[str] = None          # active | closed | future
    start: Optional[date] = None
    end: Optional[date] = None
    complete: Optional[date] = None
    board: Optional[str] = None          # configured board label
    board_id: Optional[int] = None
    goal: Optional[str] = None

    @property
    def effective_end(self) -> Optional[date]:
        return self.complete or self.end

    def contains(self, day: date) -> bool:
        if not self.start:
            return False
        end = self.effective_end
        return self.start <= day and (end is None or day <= end)

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "name": self.name, "state": self.state, "board": self.board, "board_id": self.board_id,
                "start_date": self.start.isoformat() if self.start else None,
                "end_date": self.end.isoformat() if self.end else None,
                "complete_date": self.complete.isoformat() if self.complete else None, "goal": self.goal}


def _sprint_from_raw(raw: Any, board_label: Optional[str] = None) -> Optional[SprintInfo]:
    """Normalise a sprint from the Agile API or from the issue 'Sprint' custom field (dict or legacy string)."""
    if isinstance(raw, dict):
        name = clean_text(raw.get("name"))
        if not name:
            return None
        return SprintInfo(id=raw.get("id"), name=name, state=(raw.get("state") or "").lower() or None,
                          start=_d(raw.get("startDate")), end=_d(raw.get("endDate")), complete=_d(raw.get("completeDate")),
                          board=board_label, board_id=raw.get("originBoardId") or raw.get("boardId"), goal=clean_text(raw.get("goal")))
    if isinstance(raw, str):
        def pick(k: str) -> Optional[str]:
            m = re.search(rf"{k}=([^,\]]+)", raw)
            return m.group(1) if m and m.group(1) != "<null>" else None
        name = clean_text(pick("name"))
        if not name:
            return None
        sid = pick("id")
        return SprintInfo(id=int(sid) if sid and sid.isdigit() else None, name=name, state=(pick("state") or "").lower() or None,
                          start=_d(pick("startDate")), end=_d(pick("endDate")), complete=_d(pick("completeDate")), board=board_label)
    return None


@dataclass
class JiraSourceStats:
    boards: int = 0
    issues: int = 0
    activities: int = 0
    releases: int = 0
    employees: int = 0
    errors: List[Dict[str, str]] = field(default_factory=list)
    fields_resolved: Dict[str, Dict[str, Optional[str]]] = field(default_factory=dict)
    assignees: Dict[str, List[str]] = field(default_factory=dict)  # board cfg id -> assignee names seen
    filtered_out: Dict[str, int] = field(default_factory=dict)      # board cfg id -> issues excluded by people mapping
    sprints: List[Dict[str, Any]] = field(default_factory=list)     # sprint catalogue across boards
    loaded_at: Optional[str] = None
    lookback_days: int = 0


class JiraDataSource:
    def __init__(self, registry: JiraBoardRegistry, normalizer: StatusNormalizer, lookback_days: int = 180,
                 max_issues: int = 3000) -> None:
        self.registry = registry
        self.normalizer = normalizer
        self.lookback_days = lookback_days
        self.max_issues = max_issues
        self.stats = JiraSourceStats()
        self._field_cache: Dict[str, Dict[str, List[str]]] = {}
        self._assignees_by_board: Dict[str, List[str]] = {}
        self._sprints: Dict[str, SprintInfo] = {}

    def assignees(self, board_cfg_id: str) -> List[str]:
        return list(self._assignees_by_board.get(board_cfg_id, []))

    def sprints(self) -> List[SprintInfo]:
        """Known sprints, newest first (by start date, then name)."""
        return sorted(self._sprints.values(), key=lambda s: (s.start or date.min, s.name), reverse=True)

    def _remember_sprint(self, sp: Optional[SprintInfo]) -> Optional[SprintInfo]:
        if sp is None:
            return None
        known = self._sprints.get(sp.name)
        if known is None:
            self._sprints[sp.name] = sp
            return sp
        # fill gaps (issue field often lacks dates the Agile API has, and vice versa)
        for attr in ("id", "state", "start", "end", "complete", "board", "board_id", "goal"):
            if getattr(known, attr) is None and getattr(sp, attr) is not None:
                setattr(known, attr, getattr(sp, attr))
        return known

    # ------------------------------------------------------------------ field resolution
    def resolve_fields(self, client: JiraSiteClient) -> Dict[str, List[str]]:
        """canonical key -> candidate field ids (a site may have several fields with the same name)."""
        if client.base_url in self._field_cache:
            return self._field_cache[client.base_url]
        by_name: Dict[str, List[str]] = defaultdict(list)
        try:
            for f in client.fields():
                by_name[(f.get("name") or "").strip().lower()].append(f.get("id"))
        except JiraError as exc:
            log.warning("Could not list fields for %s: %s", client.base_url, exc.message)
        resolved = {key: [fid for n in names for fid in by_name.get(n.lower(), [])] for key, names in NAMED_FIELDS.items()}
        self._field_cache[client.base_url] = resolved
        self.stats.fields_resolved[client.base_url] = {k: ", ".join(v) or None for k, v in resolved.items()}
        return resolved

    # ------------------------------------------------------------------ public
    def load(self, boards: Optional[Iterable[BoardConfig]] = None) -> Tuple[List[ParsedReport], JiraSourceStats]:
        boards = list(boards if boards is not None else self.registry.enabled())
        stats = JiraSourceStats(boards=len(boards), lookback_days=self.lookback_days)
        reports: List[ParsedReport] = []
        employees: set = set()
        self._sprints = {}
        for cfg in boards:
            try:
                client = self.registry.client_for(cfg)
                fmap = self.resolve_fields(client)
                fields = BASE_FIELDS + [fid for ids in fmap.values() for fid in ids]
                jql = f"updated >= -{self.lookback_days}d"
                raw = client.board_issues_raw(cfg.board_id, jql, fields, max_results=self.max_issues)
                versions = {}
                if cfg.project_key:
                    try:
                        versions = {v["name"]: v for v in client.project_versions(cfg.project_key)}
                    except JiraError:
                        versions = {}
                board_label = cfg.label or cfg.board_name or f"Board {cfg.board_id}"
                if (cfg.board_type or "scrum") != "kanban":
                    try:
                        for s in client.board_sprints(cfg.board_id, state="active,closed,future"):
                            self._remember_sprint(_sprint_from_raw(s, board_label))
                    except JiraError as exc:
                        log.info("No sprint list for %s: %s", cfg.label, exc.message)
                board_reports = self._build_reports(cfg, raw, fmap, versions, stats)
                reports.extend(board_reports)
                stats.issues += len(raw)
                stats.activities += sum(len(r.work_items) for r in board_reports)
                stats.releases += sum(len(r.releases) for r in board_reports)
                employees.update(r.metadata.employee for r in board_reports if r.metadata.employee)
                self.registry.record_sync(cfg.id, len(raw))
                if not raw:
                    stats.errors.append({"scope": cfg.label, "error": f"0 issues returned in the last {self.lookback_days} days — check that the credentials used for this board can see it"})
                log.info("Jira source: %s -> %d issues, %d reports", cfg.label, len(raw), len(board_reports))
            except JiraError as exc:
                stats.errors.append({"scope": cfg.label, "error": exc.message})
                self.registry.record_sync(cfg.id, 0, exc.message)
                log.warning("Jira source failed for %s: %s", cfg.label, exc.message)
        stats.employees = len(employees)
        stats.loaded_at = datetime.now().isoformat(timespec="seconds")
        stats.fields_resolved = dict(self.stats.fields_resolved)
        stats.assignees = dict(self._assignees_by_board)
        stats.sprints = [s.to_dict() for s in self.sprints()]
        self.stats = stats
        return reports, stats

    # ------------------------------------------------------------------ building
    def _build_reports(self, cfg: BoardConfig, issues: List[Dict[str, Any]], fmap: Dict[str, List[str]],
                       versions: Dict[str, Dict[str, Any]], stats: Optional[JiraSourceStats] = None) -> List[ParsedReport]:
        # (employee, date) -> rows
        buckets: Dict[Tuple[str, date], List[Dict[str, Any]]] = defaultdict(list)
        releases: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        meta_by_emp: Dict[str, Dict[str, Any]] = {}
        issues_by_emp: Dict[str, int] = defaultdict(int)
        board_name = cfg.label or cfg.board_name or f"Board {cfg.board_id}"
        allowed = {p.strip().lower() for p in (cfg.people or []) if p and p.strip()}
        seen_assignees: set = set()
        excluded = 0
        for raw in issues:
            f = raw.get("fields") or {}
            key = raw.get("key")
            employee = clean_person((f.get("assignee") or {}).get("displayName")) or "Unassigned"
            seen_assignees.add(employee)
            if allowed and employee.lower() not in allowed:
                excluded += 1
                continue
            team = self._field_value(f, fmap.get("team")) or (f.get("project") or {}).get("name") or cfg.project_name or cfg.project_key
            application, all_components = self._application(f, fmap)
            if not application:
                application = (f.get("project") or {}).get("name") or cfg.project_name or cfg.project_key
            sprints = [s for s in (self._remember_sprint(x) for x in self._issue_sprints(f, fmap.get("sprint"), board_name)) if s]
            sprint = sprints[-1].name if sprints else None
            tech_lead = clean_person(self._field_value(f, fmap.get("tech_lead")))
            environment = self._field_value(f, fmap.get("environment"))
            story_points = self._first_raw(f, fmap.get("story_points"))
            summary = clean_text(f.get("summary"))
            issue_type = (f.get("issuetype") or {}).get("name")
            current_status = (f.get("status") or {}).get("name")
            created = _ts(f.get("created"))
            updated = _ts(f.get("updated"))
            fix_versions = f.get("fixVersions") or []
            prod_required = "Yes" if fix_versions else None
            last_comment = self._last_comment(f.get("comment"))
            description = adf_to_text(f.get("description"), limit=300)
            url = f"{cfg.base_url}/browse/{key}"
            issues_by_emp[employee] += 1
            m = meta_by_emp.setdefault(employee, {"teams": set(), "apps": set(), "leads": set()})
            if team:
                m["teams"].add(str(team))
            if application:
                m["apps"].add(application)
            if tech_lead:
                m["leads"].add(tech_lead)

            transitions = self._status_transitions(raw, created, current_status)
            prod_dates = [d for d, st in transitions if st and any(h in st.lower() for h in PROD_STATUS_HINTS)]
            due_date = _d(f.get("duedate"))
            resolved = _d(f.get("resolutiondate"))
            dates_seen: set = set()

            def emit(day: date, row: Dict[str, Any]) -> None:
                # Due date: Jira due date, else the end of the sprint the work belongs to (sprint commitment).
                sp = self._sprints.get(row.get("sprint") or "")
                row["due_date"] = (due_date or (sp.effective_end if sp else None) or None)
                row["due_source"] = "jira" if due_date else ("sprint" if sp and sp.effective_end else None)
                row["resolved_date"] = resolved
                buckets[(employee, day)].append(row)

            for idx, (when, status) in enumerate(transitions):
                day = when.date()
                if (status, day) in dates_seen:
                    continue
                dates_seen.add((status, day))
                emit(day, self._row(
                    key, url, summary, issue_type, status, prod_required, environment, self._sprint_for_day(sprints, day), story_points, team,
                    application, last_comment if status == current_status else None, description, idx + 1, fix_versions,
                    is_current=(status == current_status and idx == len(transitions) - 1), updated=updated,
                    components=all_components))
            # snapshot at last update if later than the last transition (assignee change, comment, etc.)
            if updated and transitions and updated.date() > transitions[-1][0].date():
                emit(updated.date(), self._row(
                    key, url, summary, issue_type, current_status, prod_required, environment, self._sprint_for_day(sprints, updated.date()), story_points, team,
                    application, last_comment, description, len(transitions) + 1, fix_versions, is_current=True, updated=updated,
                    components=all_components))

            # production releases
            for v in fix_versions:
                ver = versions.get(v.get("name"), v)
                released = bool(ver.get("released") or v.get("released"))
                rel_date = _d(ver.get("releaseDate") or v.get("releaseDate")) or (prod_dates[-1].date() if prod_dates else None)
                releases[employee].append({
                    "application": application, "release_tickets": key, "ticket_ids": [key], "ticket_note": None,
                    "release_details": f"{v.get('name')}: {summary}" if summary else v.get("name"),
                    "release_date": rel_date.isoformat() if rel_date else None, "release_date_parsed": rel_date,
                    "prod_deployment": "Released" if released else ("Released" if any(h in (current_status or "").lower() for h in PROD_STATUS_HINTS) else "Pending"),
                    "comments": f"fixVersion {v.get('name')} ({'released' if released else 'unreleased'})",
                    "source_row": 0, "source_sheet": board_name, "sprint": sprint,
                })
            if not fix_versions and prod_dates:
                when = prod_dates[-1]
                releases[employee].append({
                    "application": application, "release_tickets": key, "ticket_ids": [key], "ticket_note": None,
                    "release_details": summary, "release_date": when.date().isoformat(), "release_date_parsed": when.date(),
                    "prod_deployment": "Released", "comments": f"status '{current_status}'",
                    "source_row": 0, "source_sheet": board_name, "sprint": self._sprint_for_day(sprints, when.date()),
                })

        reports: List[ParsedReport] = []
        emitted_release_for: set = set()
        if stats is not None:
            stats.assignees[cfg.id] = sorted(seen_assignees)
            stats.filtered_out[cfg.id] = excluded
        self._assignees_by_board[cfg.id] = sorted(seen_assignees)
        for (employee, day), rows in sorted(buckets.items(), key=lambda kv: (kv[0][0], kv[0][1])):
            m = meta_by_emp.get(employee, {"teams": set(), "apps": set(), "leads": set()})
            team_counts: Dict[str, int] = defaultdict(int)
            for r in rows:
                if r.get("project"):
                    team_counts[str(r["project"])] += 1
            project = max(team_counts, key=team_counts.get) if team_counts else (cfg.project_name or cfg.project_key)
            app_counts: Dict[str, int] = defaultdict(int)
            for r in rows:
                if r.get("application"):
                    app_counts[str(r["application"])] += 1
            meta = ReportMetadata(
                employee=employee, employee_source="jira", project=project,
                application=max(app_counts, key=app_counts.get) if app_counts else None, jira_board=board_name,
                team_lead=", ".join(sorted(m["leads"])) or None, report_date=day,
                report_date_raw=day.isoformat(), report_date_source="jira",
            )
            for i, r in enumerate(rows, start=1):
                r["source_row"] = i
                r["source_sheet"] = board_name
            rep = ParsedReport(
                file_name=f"{board_name} · {employee} · {day.isoformat()}", file_path=f"{cfg.url}#{employee}#{day.isoformat()}",
                sheet_name=board_name, layout="jira", metadata=meta, work_items=rows, checksum=f"jira:{cfg.id}:{employee}:{day}",
                size_bytes=0, modified_at=self.stats.loaded_at,
            )
            if employee not in emitted_release_for and releases.get(employee):
                rep.releases = releases[employee]
                emitted_release_for.add(employee)
            if employee == "Unassigned":
                rep.issues.append(DataIssue("info", "missing_employee", f"{len(rows)} activity row(s) on unassigned issues",
                                            rep.file_name, board_name, field="employee"))
            for r in rows:
                if not r.get("application"):
                    rep.issues.append(DataIssue("info", "missing_project", f"{r['ticket_id']}: no component / epic / label to derive an application",
                                                rep.file_name, board_name, r["source_row"], "application"))
                    break
            reports.append(rep)
        return reports

    def _row(self, key: str, url: str, summary: Optional[str], issue_type: Optional[str], status: Optional[str],
             prod_required: Optional[str], environment: Optional[str], sprint: Optional[str], story_points: Any,
             team: Any, application: Optional[str], comment: Optional[str], description: Optional[str], seq: int,
             fix_versions: List[Dict[str, Any]], *, is_current: bool, updated: Optional[datetime],
             components: Optional[List[str]] = None) -> Dict[str, Any]:
        dev = self.normalizer.normalize("jira_dev_deployment", status)
        if fix_versions:
            released = any(v.get("released") for v in fix_versions)
            prod_raw = "Released" if released else "Pending release"
        else:
            prod = self.normalizer.normalize("jira_prod_deployment", status)
            prod_raw = prod.label if prod.mapped else status
        notes: List[str] = []
        if sprint:
            notes.append(f"Sprint: {sprint}")
        if story_points not in (None, ""):
            notes.append(f"SP: {story_points:g}" if isinstance(story_points, (int, float)) else f"SP: {story_points}")
        if environment:
            notes.append(f"Env: {environment}")
        if components and len(components) > 1:
            notes.append("Components: " + ", ".join(components))
        if fix_versions:
            notes.append("Fix: " + ", ".join(v.get("name", "") for v in fix_versions))
        if comment:
            notes.append(f"Last comment: {comment}")
        sp_val = story_points if isinstance(story_points, (int, float)) else None
        return {
            "application": application, "ticket_id": key, "ticket_ids": [key], "ticket_note": None, "ticket_link": url,
            "work_details": summary or description, "work_type": issue_type, "work_status": status,
            "prod_required": prod_required, "dev_deployment": dev.label if dev.mapped else status,
            "prod_deployment": prod_raw, "environment": environment,
            "comments": " | ".join(notes) or None, "jira_current": is_current, "jira_seq": seq,
            "jira_updated": updated.isoformat() if updated else None, "project": team, "sprint": sprint, "story_points": sp_val,
        }

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _first_raw(f: Dict[str, Any], fids: Optional[List[str]]) -> Any:
        for fid in fids or []:
            v = f.get(fid)
            if v not in (None, "", [], {}):
                return v
        return None

    @classmethod
    def _field_value(cls, f: Dict[str, Any], fids: Optional[List[str]], primary: bool = False) -> Optional[str]:
        v = cls._first_raw(f, fids)
        if v is None:
            return None
        if isinstance(v, dict):
            return clean_text(v.get("name") or v.get("value") or v.get("displayName"))
        if isinstance(v, list):
            vals = [x for x in (clean_text(x.get("name") or x.get("value")) if isinstance(x, dict) else clean_text(x) for x in v) if x]
            if not vals:
                return None
            return min(vals, key=lambda c: (len(c), c)) if primary else ", ".join(vals)
        return clean_text(v)

    def _issue_sprints(self, f: Dict[str, Any], fids: Optional[List[str]], board_label: Optional[str]) -> List[SprintInfo]:
        """All sprints an issue has been in, oldest first (carried-over tickets list several)."""
        v = self._first_raw(f, fids)
        raws: List[Any] = v if isinstance(v, list) else ([v] if v else [])
        if not raws and isinstance(f.get("sprint"), dict):
            raws = [f["sprint"]]
        out = [s for s in (_sprint_from_raw(x, board_label) for x in raws) if s]
        return sorted(out, key=lambda s: (s.start or date.min, s.id or 0))

    @staticmethod
    def _sprint_for_day(sprints: List[SprintInfo], day: date) -> Optional[str]:
        """Sprint a piece of work belongs to: the sprint whose window contains the day, otherwise the
        latest sprint that had already started, otherwise the issue's first sprint."""
        if not sprints:
            return None
        for s in sprints:
            if s.contains(day):
                return s.name
        started = [s for s in sprints if s.start and s.start <= day]
        return (started[-1] if started else sprints[0]).name

    def _application(self, f: Dict[str, Any], fmap: Dict[str, List[str]]) -> Tuple[Optional[str], List[str]]:
        """Primary application name plus the full component list.

        Components are preferred; when several are set the shortest (most generic) one is used as the
        primary so breakdowns stay readable, and the full list is kept in the notes.
        """
        comps = [c for c in (clean_text(x.get("name")) for x in (f.get("components") or [])) if c]
        if comps:
            return min(comps, key=lambda c: (len(c), c)), comps
        module = self._field_value(f, fmap.get("module"), primary=True)
        if module:
            return module, []
        parent = f.get("parent") or {}
        pf = parent.get("fields") or {}
        if (pf.get("issuetype") or {}).get("name", "").lower() == "epic" and pf.get("summary"):
            return clean_text(pf["summary"]), []
        epic_name = self._field_value(f, fmap.get("epic_name"))
        if epic_name:
            return epic_name, []
        labels = [clean_text(l) for l in (f.get("labels") or []) if l]
        if labels:
            return labels[0], []
        if pf.get("summary"):
            return clean_text(pf["summary"]), []
        return None, []

    @staticmethod
    def _last_comment(comment_field: Any) -> Optional[str]:
        if not isinstance(comment_field, dict):
            return None
        comments = comment_field.get("comments") or []
        if not comments:
            return None
        last = comments[-1]
        author = clean_person((last.get("author") or {}).get("displayName"))
        body = adf_to_text(last.get("body"), limit=300)
        if not body:
            return None
        return f"{author}: {body}" if author else body

    @staticmethod
    def _status_transitions(raw: Dict[str, Any], created: Optional[datetime], current_status: Optional[str]) -> List[Tuple[datetime, str]]:
        hist = (raw.get("changelog") or {}).get("histories") or []
        out: List[Tuple[datetime, str]] = []
        first_from: Optional[str] = None
        for h in sorted(hist, key=lambda x: x.get("created") or ""):
            when = _ts(h.get("created"))
            if when is None:
                continue
            for item in h.get("items") or []:
                if item.get("field") == "status":
                    if first_from is None:
                        first_from = item.get("fromString")
                    if item.get("toString"):
                        out.append((when, item["toString"]))
        if created:
            out.insert(0, (created, first_from or (out[0][1] if out else current_status) or "Created"))
        if not out and current_status:
            out.append((created or datetime.now(), current_status))
        # if the changelog was truncated and the last known status differs from current, append current at updated
        if current_status and out and out[-1][1] != current_status:
            upd = _ts((raw.get("fields") or {}).get("updated")) or out[-1][0]
            out.append((max(upd, out[-1][0]), current_status))
        return out
