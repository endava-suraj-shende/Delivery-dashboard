"""Employee, project, Jira, deployment, dashboard, search and config endpoints."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query

from app.api.deps import filters, loaded_container
from app.core.exceptions import NotFoundError, ValidationFailedError
from app.events.event_bus import Events
from app.schemas.common import StatusConfigUpdate, StatusMappingAdd
from app.services.container import Container
from app.services.filter_service import Filters
from app.services.performance_service import BANDS, PERFORMANCE_RULES, metric_rows, team_summary

employees = APIRouter(prefix="/employees", tags=["Employees"])
projects = APIRouter(prefix="/projects", tags=["Projects"])
jira = APIRouter(prefix="/jira", tags=["Jira Analytics"])
deployment = APIRouter(prefix="/deployment", tags=["Deployment"])
dashboard = APIRouter(prefix="/dashboard", tags=["Dashboard"])
search = APIRouter(prefix="/search", tags=["Search"])
config = APIRouter(prefix="/config", tags=["Configuration"])
meta = APIRouter(prefix="/meta", tags=["Metadata"])
sprints = APIRouter(prefix="/sprints", tags=["Sprints"])


def _with(f: Filters, **kw: Any) -> Filters:
    return Filters(**{**f.__dict__, **kw})


def _resolve_name(values: list, name: str, kind: str) -> str:
    match = next((v for v in values if v.lower() == name.lower()), None)
    if match is None:
        raise NotFoundError(f"{kind} '{name}' not found")
    return match


# ---------------------------------------------------------------- employees
@employees.get("")
def list_employees(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    ov = c.analytics.overview(f)
    all_names = c.analytics.roster(f)
    active = {e["employee"] for e in ov["employees"]}
    inactive = [n for n in all_names if n not in active]
    return {"period": ov["period"], "items": ov["employees"], "inactive": inactive, "all": all_names,
            "team": team_summary(ov["employees"], inactive), "bands": BANDS, "performance_rules": PERFORMANCE_RULES,
            "source": ov["source"]}


@employees.get("/performance")
def employees_performance(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    """Team delivery status + per-employee ratings for the current and previous period."""
    ov = c.analytics.overview(f)
    rf = c.analytics.resolve_filters(f)
    prev = c.analytics.overview(rf.previous_period(), include_prev=False) if not rf.is_all and not rf.sprint else None
    all_names = c.analytics.roster(f)
    active = {e["employee"] for e in ov["employees"]}
    inactive = [n for n in all_names if n not in active]
    prev_rows = {e["employee"]: e for e in (prev["employees"] if prev else [])}
    items = [{**e, "previous_score": prev_rows.get(e["employee"], {}).get("score"),
              "previous_rating": prev_rows.get(e["employee"], {}).get("rating")} for e in ov["employees"]]
    return {"period": ov["period"], "previous_period": prev["period"] if prev else None, "items": items, "inactive": inactive,
            "team": team_summary(ov["employees"], inactive),
            "previous_team": team_summary(prev["employees"], []) if prev else None,
            "bands": BANDS, "performance_rules": PERFORMANCE_RULES, "source": ov["source"]}


@employees.get("/{name}/summary")
def employee_summary(name: str, f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    name = _resolve_name(c.analytics.dimension_values()["employees"], name, "Employee")
    ov = c.analytics.overview(_with(f, employee=[name]))
    reps = c.store.reports()
    mine = reps[reps["employee"] == name].sort_values("report_date", ascending=False)
    from app.services.analytics_service import records
    return {**ov, "employee": name,
            "profile": records(mine, ["file_id", "file_name", "report_date", "project", "application", "jira_board",
                                      "team_lead", "team_members", "notes", "work_items", "releases", "issues"])}


@employees.get("/{name}/activities")
def employee_activities(name: str, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=1000),
                              sort: Optional[str] = None, desc: bool = True,
                              f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    name = _resolve_name(c.analytics.dimension_values()["employees"], name, "Employee")
    return c.analytics.activities_view(_with(f, employee=[name]), page, page_size, sort, desc)


@employees.get("/{name}/performance")
def employee_performance(name: str, f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    name = _resolve_name(c.analytics.dimension_values()["employees"], name, "Employee")
    ff = _with(f, employee=[name])
    cur = c.analytics.overview(ff)
    prev = c.analytics.overview(c.analytics.resolve_filters(ff).previous_period(), include_prev=False)
    cur_row = next((e for e in cur["employees"] if e["employee"] == name), None)
    prev_row = next((e for e in prev["employees"] if e["employee"] == name), None)
    # team reference values come from the unfiltered-by-employee scope
    team_rows = c.analytics.overview(_with(f, employee=[]), include_prev=False)["employees"]
    team_cycle = next((e.get("team_avg_cycle_days") for e in team_rows if e.get("team_avg_cycle_days") is not None), None)
    for row in (cur_row, prev_row):
        if row is not None:
            row["team_avg_cycle_days"] = team_cycle
    return {"employee": name, "current": {"period": cur["period"], "kpis": cur["kpis"], "trend": cur["charts"]["trend"]},
            "previous": {"period": prev["period"], "kpis": prev["kpis"], "trend": prev["charts"]["trend"]},
            "performance": {"current": cur_row, "previous": prev_row, "metrics": metric_rows(cur_row or {}, prev_row),
                            "bands": BANDS, "rules": PERFORMANCE_RULES},
            "tickets": c.analytics.tickets_view(ff)["items"], "releases": c.analytics.releases_view(ff)["items"]}


# ---------------------------------------------------------------- projects
@projects.get("")
def list_projects(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    ov = c.analytics.overview(f)
    return {"period": ov["period"], "items": ov["projects"], "all": c.analytics.dimension_values()["projects"]}


@projects.get("/{name}/summary")
def project_summary(name: str, f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    name = _resolve_name(c.analytics.dimension_values()["projects"], name, "Project")
    ff = _with(f, project=[name])
    ov = c.analytics.overview(ff)
    return {**ov, "project": name, "tickets": c.analytics.tickets_view(ff)["items"],
            "releases": c.analytics.releases_view(ff)["items"]}


@projects.get("/{name}/employees")
def project_employees(name: str, f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    name = _resolve_name(c.analytics.dimension_values()["projects"], name, "Project")
    ov = c.analytics.overview(_with(f, project=[name]))
    return {"project": name, "period": ov["period"], "items": ov["employees"]}


# ---------------------------------------------------------------- sprints
def _sprint_catalogue(c: Container) -> list:
    return list(c.jira_source.stats.sprints or [])


@sprints.get("")
def list_sprints(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    items = c.analytics.sprint_table(f, _sprint_catalogue(c))
    active = next((s["name"] for s in items if s.get("state") == "active"), None)
    # velocity: oldest -> newest, closed + active sprints that have work
    vel = sorted([s for s in items if s.get("state") != "future" and s["tickets"]], key=lambda s: (s.get("start_date") or "", s["name"]))
    closed = [s for s in vel if s.get("state") == "closed"]
    # Story points only make sense when teams actually estimate: require >= 30 % of tickets to carry points.
    est = sum(s["estimated_tickets"] for s in vel)
    tot = sum(s["tickets"] for s in vel)
    use_points = bool(tot) and est / tot >= 0.3
    last3 = closed[-3:]
    avg = lambda key, src: (round(sum(s[key] for s in src) / len(src), 1) if src else None)  # noqa: E731
    velocity = {
        "unit": "points" if use_points else "tickets",
        "estimated_share": round(100.0 * est / tot, 1) if tot else 0.0,
        "items": [{"name": s["name"], "state": s.get("state"), "start_date": s.get("start_date"), "end_date": s.get("complete_date") or s.get("end_date"),
                   "committed": s["committed_points"] if use_points else s["tickets"], "completed": s["completed_points"] if use_points else s["completed"],
                   "committed_tickets": s["tickets"], "completed_tickets": s["completed"],
                   "committed_points": s["committed_points"], "completed_points": s["completed_points"]} for s in vel],
        "average_completed": avg("completed_points" if use_points else "completed", closed),
        "average_last3": avg("completed_points" if use_points else "completed", last3),
        "average_completed_tickets": avg("completed", closed), "average_last3_tickets": avg("completed", last3),
        "average_completed_points": avg("completed_points", closed), "average_last3_points": avg("completed_points", last3),
        "closed_sprints": len(closed),
    }
    return {"items": items, "active": active, "source": c.analytics.source_mode(), "velocity": velocity}


@sprints.get("/{name}")
def sprint_detail(name: str, f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    items = c.analytics.sprint_table(f, _sprint_catalogue(c))
    row = next((s for s in items if s["name"].lower() == name.lower()), None)
    if row is None:
        raise NotFoundError(f"Sprint '{name}' not found")
    ff = c.analytics.sprint_filters(f, row)
    ov = c.analytics.overview(ff, include_prev=False)
    # previous sprint (by start date) for side-by-side comparison
    closed = [s for s in items if s.get("state") != "future" and s["name"] != row["name"]
              and (s.get("start_date") or "") < (row.get("start_date") or "~")]
    prev = max(closed, key=lambda s: s.get("start_date") or "") if closed else None
    return {**ov, "sprint": row, "previous_sprint": prev,
            "tickets": c.analytics.tickets_view(ff)["items"], "releases": c.analytics.releases_view(ff)["items"]}


# ---------------------------------------------------------------- jira
@jira.get("/summary")
def jira_summary(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    ov = c.analytics.overview(f)
    return {"period": ov["period"], "filters": ov["filters"], "kpis": ov["kpis"], "charts": ov["charts"],
            "latest_status_rule": ov["latest_status_rule"], "calculation_rules": ov["calculation_rules"]}


@jira.get("/status-distribution")
def jira_status_distribution(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    ov = c.analytics.overview(f)
    ch = ov["charts"]
    return {"period": ov["period"], "overall": ch["ticket_status"], "by_employee": ch["status_by_employee"],
            "by_project": ch["status_by_project"], "by_application": ch["status_by_application"],
            "by_board": ch["status_by_board"], "trend": ch["trend"]}


@jira.get("/tickets")
def jira_tickets(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return c.analytics.tickets_view(f)


@jira.get("/tickets/{ticket_id}")
def jira_ticket(ticket_id: str, c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    detail = c.analytics.ticket_detail(ticket_id)
    if detail is None:
        raise NotFoundError(f"Ticket '{ticket_id}' not found")
    return detail


# ---------------------------------------------------------------- deployment
@deployment.get("/dev/summary")
def dev_summary(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    ov = c.analytics.overview(f)
    ch = ov["charts"]
    return {"period": ov["period"], "filters": ov["filters"], "kpis": ov["kpis"], "distribution": ch["dev_deployment"],
            "by_employee": ch["dev_by_employee"], "by_project": ch["dev_by_project"],
            "by_application": ch["dev_by_application"], "trend": ch["trend"],
            "items": c.analytics.activities_view(f, 1, 5000)["items"]}


@deployment.get("/production/summary")
def prod_summary(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    ov = c.analytics.overview(f)
    ch = ov["charts"]
    return {"period": ov["period"], "filters": ov["filters"], "kpis": ov["kpis"], "distribution": ch["prod_deployment"],
            "prod_required": ch["prod_required"], "by_employee": ch["prod_by_employee"],
            "by_project": ch["prod_by_project"], "by_application": ch["prod_by_application"],
            "trend": ch["release_trend"], "items": c.analytics.releases_view(f)["items"]}


@deployment.get("/trends")
def deployment_trends(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    ov = c.analytics.overview(f)
    return {"period": ov["period"], "activity_trend": ov["charts"]["trend"], "release_trend": ov["charts"]["release_trend"]}


# ---------------------------------------------------------------- dashboard
@dashboard.get("/executive")
def executive(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    ov = c.analytics.overview(f)
    jira_summary = None
    if c.data.mode != "jira" and c.jira.configured and c.jira.status()["last_sync"]:
        try:
            rec = c.jira.reconcile(c.analytics.resolve_filters(f), include_missing=True)
            jira_summary = rec["summary"]
            s = jira_summary
            insights = list(ov["insights"])
            if s["errors"] or s["warnings"]:
                insights.insert(0, {"type": "danger" if s["errors"] else "warning", "title": "Excel vs Jira discrepancies",
                                    "detail": f"{s['errors']} conflict(s), {s['warnings']} warning(s) across {s['compared']} compared ticket rows; "
                                              f"{s['not_found']} ticket id(s) not found in Jira, {s['missing_from_excel']} Jira issue(s) missing from sheets.",
                                    "value": s["errors"] + s["warnings"], "link": {"type": "jira", "value": "live"}})
                ov = {**ov, "insights": insights}
        except Exception:  # noqa: BLE001 - Jira problems must not break the dashboard
            jira_summary = None
    return {**ov, "data_quality": c.analytics.data_quality(c.analytics.resolve_filters(f))["summary"], "jira": jira_summary}


@dashboard.get("/team")
def team(f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    ov = c.analytics.overview(f)
    return {**ov, "tickets": c.analytics.tickets_view(f)["items"], "releases": c.analytics.releases_view(f)["items"]}


@dashboard.get("/employee")
def employee_dashboard(name: str = Query(...), f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return employee_summary(name, f, c)


@dashboard.get("/project")
def project_dashboard(name: str = Query(...), f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return project_summary(name, f, c)


@dashboard.get("/activities")
def activities(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=1000), sort: Optional[str] = None,
                     desc: bool = True, f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return c.analytics.activities_view(f, page, page_size, sort, desc)


@dashboard.get("/compare")
def compare(a_start: str = Query(...), a_end: str = Query(...), b_start: str = Query(...), b_end: str = Query(...),
                  f: Filters = Depends(filters), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    from datetime import date
    try:
        fa = _with(f, start_date=date.fromisoformat(a_start), end_date=date.fromisoformat(a_end))
        fb = _with(f, start_date=date.fromisoformat(b_start), end_date=date.fromisoformat(b_end))
    except ValueError as exc:
        raise ValidationFailedError(f"Invalid date: {exc}")
    return c.analytics.compare(fa, fb)


@dashboard.get("/data-quality")
def data_quality(f: Filters = Depends(filters), scope: str = Query("period", description="period | all"),
                       c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return c.analytics.data_quality(None if scope == "all" else c.analytics.resolve_filters(f))


# ---------------------------------------------------------------- search / meta
@search.get("")
def global_search(q: str = Query(..., min_length=1), limit: int = Query(10, ge=1, le=50),
                        c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return c.analytics.search(q, limit)


@meta.get("/dimensions")
def dimensions(jira_board: Optional[List[str]] = Query(None), c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    """Filter options. When boards are given, employees / projects / sprints are limited to those boards."""
    dims = c.analytics.dimension_values()
    boards = [b for b in (jira_board or []) if b and b.strip()]
    if boards:
        scoped = c.analytics.dimension_values(Filters(jira_board=boards))
        dims = {**dims, "employees": scoped["employees"], "projects": scoped["projects"], "sprints": scoped["sprints"]}
    return dims


@meta.get("/presets")
def presets() -> Dict[str, Any]:
    from app.services.filter_service import PRESETS, preset_range
    return {"default": "last_15_days",
            "items": [{"key": k, "label": v, "start": s.isoformat() if s else None, "end": e.isoformat() if e else None}
                      for k, v in PRESETS.items() for s, e in [preset_range(k)]]}


# ---------------------------------------------------------------- config
@config.get("/status")
def get_status_config(c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    return c.normalizer.get_config()


@config.put("/status")
def put_status_config(body: StatusConfigUpdate, c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    out = c.normalizer.update_config(body.model_dump(exclude_none=True))
    c.bus.publish(Events.STATUS_CONFIG_CHANGED)
    return c.normalizer.get_config()


@config.post("/status/mapping")
def add_mapping(body: StatusMappingAdd, c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    try:
        c.normalizer.add_mapping(body.dimension, body.category, body.value)
    except ValueError as exc:
        raise ValidationFailedError(str(exc))
    c.bus.publish(Events.STATUS_CONFIG_CHANGED)
    return c.normalizer.get_config()


@config.post("/status/reset")
def reset_status_config(c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    c.normalizer.reset()
    c.bus.publish(Events.STATUS_CONFIG_CHANGED)
    return c.normalizer.get_config()


@config.get("/app")
def app_config(c: Container = Depends(loaded_container)) -> Dict[str, Any]:
    s = c.settings
    return {"app_name": s.app_name, "version": s.app_version, "environment": s.environment,
            "default_period_days": s.default_period_days, "max_upload_mb": s.max_upload_mb,
            "allowed_extensions": s.allowed_extensions, "data_dir_name": s.data_dir.name,
            "authentication": "none (trusted local environment)", "database": "none (Excel is the source of truth)",
            "jira_configured": c.jira.configured, "jira_email": s.jira_email or None,
            "jira_boards": len(c.jira_boards.list()), "jira_auto_sync": s.jira_auto_sync,
            "data_source": c.data.mode, "configured_data_source": c.data.configured_mode}
