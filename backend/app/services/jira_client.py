"""Jira Cloud REST client (read-only).

* Basic auth with Atlassian email + API token (never logged).
* One client per Atlassian site (``base_url``) so several sites can be used at once.
* Small TTL cache to avoid hammering Jira while users click around dashboards.
"""
from __future__ import annotations

import base64
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

import httpx

from app.core.exceptions import AppError
from app.core.logging import get_logger

log = get_logger("jira_client")

ISSUE_FIELDS = ["summary", "status", "assignee", "reporter", "issuetype", "priority", "updated", "created",
                "resolutiondate", "resolution", "fixVersions", "labels", "project", "sprint", "customfield_10020"]

_BOARD_URL_RE = re.compile(r"/jira/(?:software|core|servicedesk)/(?:c/)?projects/(?P<project>[A-Za-z][A-Za-z0-9_]*)/boards/(?P<board>\d+)")
_BOARD_URL_RE2 = re.compile(r"[?&]rapidView=(?P<board>\d+)")
_PROJECT_URL_RE = re.compile(r"/projects/(?P<project>[A-Za-z][A-Za-z0-9_]*)")


class JiraError(AppError):
    status_code = 502
    code = "jira_error"


class JiraAuthError(JiraError):
    status_code = 401
    code = "jira_auth_error"


class JiraNotConfigured(JiraError):
    status_code = 409
    code = "jira_not_configured"


@dataclass
class BoardRef:
    base_url: str
    board_id: int
    project_key: Optional[str] = None

    @property
    def url(self) -> str:
        proj = f"projects/{self.project_key}/" if self.project_key else ""
        return f"{self.base_url}/jira/software/c/{proj}boards/{self.board_id}"


def parse_board_url(url: str) -> BoardRef:
    """Accepts board links such as
    https://site.atlassian.net/jira/software/c/projects/OCS/boards/921
    https://site.atlassian.net/secure/RapidBoard.jspa?rapidView=921
    """
    text = (url or "").strip()
    parsed = urlparse(text if "://" in text else f"https://{text}")
    if not parsed.netloc:
        raise AppError("Invalid Jira board link")
    base = f"{parsed.scheme or 'https'}://{parsed.netloc}"
    m = _BOARD_URL_RE.search(parsed.path)
    if m:
        return BoardRef(base, int(m.group("board")), m.group("project").upper())
    m2 = _BOARD_URL_RE2.search("?" + parsed.query)
    if m2:
        pm = _PROJECT_URL_RE.search(parsed.path)
        return BoardRef(base, int(m2.group("board")), pm.group("project").upper() if pm else None)
    m3 = re.search(r"/boards?/(\d+)", parsed.path)
    if m3:
        pm = _PROJECT_URL_RE.search(parsed.path)
        return BoardRef(base, int(m3.group(1)), pm.group("project").upper() if pm else None)
    raise AppError("Could not find a board id in the link. Expected .../projects/KEY/boards/123")


@dataclass
class JiraIssue:
    key: str
    summary: Optional[str]
    status: Optional[str]
    status_category: Optional[str]
    assignee: Optional[str]
    assignee_account_id: Optional[str]
    assignee_email: Optional[str]
    reporter: Optional[str]
    issue_type: Optional[str]
    priority: Optional[str]
    project_key: Optional[str]
    created: Optional[str]
    updated: Optional[str]
    resolved: Optional[str]
    resolution: Optional[str]
    fix_versions: List[str] = field(default_factory=list)
    fix_versions_released: bool = False
    sprint: Optional[str] = None
    sprint_state: Optional[str] = None
    labels: List[str] = field(default_factory=list)
    url: str = ""
    base_url: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return self.__dict__.copy()


def _user(obj: Optional[Dict[str, Any]]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    if not obj:
        return None, None, None
    return obj.get("displayName"), obj.get("accountId"), obj.get("emailAddress")


def issue_from_api(data: Dict[str, Any], base_url: str) -> JiraIssue:
    f = data.get("fields") or {}
    status = f.get("status") or {}
    sprint_obj = f.get("sprint")
    sprints = f.get("customfield_10020")
    if not sprint_obj and isinstance(sprints, list) and sprints:
        active = [s for s in sprints if isinstance(s, dict) and s.get("state") == "active"]
        sprint_obj = (active or sprints)[-1]
    a_name, a_id, a_mail = _user(f.get("assignee"))
    r_name, _, _ = _user(f.get("reporter"))
    fvs = [v.get("name") for v in (f.get("fixVersions") or []) if v.get("name")]
    return JiraIssue(
        key=data.get("key"), summary=f.get("summary"), status=status.get("name"),
        status_category=((status.get("statusCategory") or {}).get("key")),
        assignee=a_name, assignee_account_id=a_id, assignee_email=a_mail, reporter=r_name,
        issue_type=(f.get("issuetype") or {}).get("name"), priority=(f.get("priority") or {}).get("name"),
        project_key=(f.get("project") or {}).get("key"), created=f.get("created"), updated=f.get("updated"),
        resolved=f.get("resolutiondate"), resolution=(f.get("resolution") or {}).get("name"),
        fix_versions=fvs, fix_versions_released=any((v.get("released") for v in (f.get("fixVersions") or []))),
        sprint=(sprint_obj or {}).get("name") if isinstance(sprint_obj, dict) else None,
        sprint_state=(sprint_obj or {}).get("state") if isinstance(sprint_obj, dict) else None,
        labels=list(f.get("labels") or []), url=f"{base_url}/browse/{data.get('key')}", base_url=base_url,
    )


class JiraSiteClient:
    def __init__(self, base_url: str, email: str, token: str, timeout: int = 30, cache_minutes: int = 10) -> None:
        self.base_url = base_url.rstrip("/")
        self.email = email
        self._auth = "Basic " + base64.b64encode(f"{email}:{token}".encode()).decode()
        self._client = httpx.Client(base_url=self.base_url, timeout=timeout,
                                    headers={"Authorization": self._auth, "Accept": "application/json"})
        self._cache: Dict[str, Tuple[float, Any]] = {}
        self._ttl = cache_minutes * 60
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ http
    def _request(self, method: str, path: str, *, params: Optional[Dict[str, Any]] = None,
                 json: Optional[Dict[str, Any]] = None, retries: int = 2) -> Any:
        last: Optional[Exception] = None
        for attempt in range(retries + 1):
            try:
                r = self._client.request(method, path, params=params, json=json)
            except httpx.HTTPError as exc:
                last = exc
                time.sleep(0.5 * (attempt + 1))
                continue
            if r.status_code in (401, 403):
                raise JiraAuthError(f"Jira rejected the credentials for {self.base_url} ({r.status_code}). "
                                    "Check EDD_JIRA_EMAIL / EDD_JIRA_API_TOKEN and project permissions.")
            if r.status_code == 404:
                return None
            if r.status_code == 429 or r.status_code >= 500:
                retry_after = float(r.headers.get("Retry-After", 1 + attempt))
                time.sleep(min(retry_after, 10))
                last = JiraError(f"Jira returned {r.status_code}")
                continue
            if r.status_code >= 400:
                detail = ""
                try:
                    body = r.json()
                    detail = "; ".join(body.get("errorMessages") or []) or str(body.get("errors") or "")
                except Exception:
                    detail = r.text[:200]
                raise JiraError(f"Jira error {r.status_code}: {detail}")
            return r.json() if r.content else {}
        raise JiraError(f"Jira unreachable at {self.base_url}: {last}")

    def _cached(self, key: str, loader):
        now = time.time()
        with self._lock:
            hit = self._cache.get(key)
            if hit and now - hit[0] < self._ttl:
                return hit[1]
        value = loader()
        with self._lock:
            self._cache[key] = (now, value)
        return value

    def clear_cache(self) -> None:
        with self._lock:
            self._cache.clear()

    # ------------------------------------------------------------------ endpoints
    def myself(self) -> Dict[str, Any]:
        return self._request("GET", "/rest/api/3/myself") or {}

    def board(self, board_id: int) -> Optional[Dict[str, Any]]:
        return self._cached(f"board:{board_id}", lambda: self._request("GET", f"/rest/agile/1.0/board/{board_id}"))

    def board_configuration(self, board_id: int) -> Optional[Dict[str, Any]]:
        return self._cached(f"boardcfg:{board_id}", lambda: self._request("GET", f"/rest/agile/1.0/board/{board_id}/configuration"))

    def board_sprints(self, board_id: int, state: str = "active,future,closed") -> List[Dict[str, Any]]:
        def load() -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            start = 0
            while True:
                page = self._request("GET", f"/rest/agile/1.0/board/{board_id}/sprint",
                                     params={"state": state, "startAt": start, "maxResults": 50})
                if not page:
                    break
                out.extend(page.get("values") or [])
                if page.get("isLast", True) or not page.get("values"):
                    break
                start += len(page.get("values") or [])
            return out
        return self._cached(f"sprints:{board_id}:{state}", load)

    def boards(self, project_key: Optional[str] = None) -> List[Dict[str, Any]]:
        def load() -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            start = 0
            while True:
                params: Dict[str, Any] = {"startAt": start, "maxResults": 50}
                if project_key:
                    params["projectKeyOrId"] = project_key
                page = self._request("GET", "/rest/agile/1.0/board", params=params)
                if not page:
                    break
                out.extend(page.get("values") or [])
                if page.get("isLast", True) or not page.get("values"):
                    break
                start += len(page.get("values") or [])
            return out
        return self._cached(f"boards:{project_key}", load)

    def search(self, jql: str, fields: Sequence[str] = ISSUE_FIELDS, max_results: int = 1000) -> List[JiraIssue]:
        """POST /rest/api/3/search/jql with token pagination (falls back to legacy /search)."""
        def load() -> List[JiraIssue]:
            issues: List[JiraIssue] = []
            token: Optional[str] = None
            while len(issues) < max_results:
                body: Dict[str, Any] = {"jql": jql, "fields": list(fields), "maxResults": min(100, max_results - len(issues))}
                if token:
                    body["nextPageToken"] = token
                page = self._request("POST", "/rest/api/3/search/jql", json=body)
                if page is None:  # endpoint missing on older sites
                    return self._legacy_search(jql, fields, max_results)
                issues.extend(issue_from_api(i, self.base_url) for i in page.get("issues") or [])
                token = page.get("nextPageToken")
                if not token or page.get("isLast"):
                    break
            return issues
        return self._cached(f"jql:{jql}:{max_results}", load)

    def _legacy_search(self, jql: str, fields: Sequence[str], max_results: int) -> List[JiraIssue]:
        issues: List[JiraIssue] = []
        start = 0
        while len(issues) < max_results:
            page = self._request("POST", "/rest/api/3/search",
                                 json={"jql": jql, "fields": list(fields), "startAt": start, "maxResults": 100}) or {}
            batch = page.get("issues") or []
            issues.extend(issue_from_api(i, self.base_url) for i in batch)
            if not batch or start + len(batch) >= page.get("total", 0):
                break
            start += len(batch)
        return issues

    def issues_by_keys(self, keys: Iterable[str]) -> Dict[str, JiraIssue]:
        """Fetch issues in batches of 50 keys. Missing keys are simply absent from the result."""
        keys = sorted({k.upper() for k in keys if k})
        out: Dict[str, JiraIssue] = {}
        for i in range(0, len(keys), 50):
            batch = keys[i:i + 50]
            try:
                found = self.search(f"key in ({', '.join(batch)})", max_results=len(batch) + 5)
            except JiraError as exc:
                # One unknown key makes the whole JQL fail on some sites; fall back to per-key lookup.
                log.info("Batch search failed (%s); falling back to per-key lookup", exc.message[:80])
                found = []
                for k in batch:
                    data = self._request("GET", f"/rest/api/3/issue/{k}", params={"fields": ",".join(ISSUE_FIELDS)})
                    if data:
                        found.append(issue_from_api(data, self.base_url))
            for iss in found:
                out[iss.key.upper()] = iss
        return out

    def board_issues(self, board_id: int, jql_filter: Optional[str] = None, max_results: int = 2000) -> List[JiraIssue]:
        def load() -> List[JiraIssue]:
            issues: List[JiraIssue] = []
            start = 0
            while len(issues) < max_results:
                params: Dict[str, Any] = {"startAt": start, "maxResults": 100, "fields": ",".join(ISSUE_FIELDS)}
                if jql_filter:
                    params["jql"] = jql_filter
                page = self._request("GET", f"/rest/agile/1.0/board/{board_id}/issue", params=params) or {}
                batch = page.get("issues") or []
                issues.extend(issue_from_api(i, self.base_url) for i in batch)
                if not batch or start + len(batch) >= page.get("total", 0):
                    break
                start += len(batch)
            return issues
        return self._cached(f"boardissues:{board_id}:{jql_filter}:{max_results}", load)

    def fields(self) -> List[Dict[str, Any]]:
        """All field definitions on the site (used to resolve custom field ids by name)."""
        return self._cached("fields", lambda: self._request("GET", "/rest/api/3/field") or [])

    def board_issues_raw(self, board_id: int, jql_filter: Optional[str], fields: Sequence[str],
                         expand: str = "changelog", max_results: int = 3000) -> List[Dict[str, Any]]:
        """Raw issue dicts (with changelog) from a board; not cached by the TTL cache (callers cache)."""
        issues: List[Dict[str, Any]] = []
        start = 0
        while len(issues) < max_results:
            params: Dict[str, Any] = {"startAt": start, "maxResults": 100, "fields": ",".join(fields), "expand": expand}
            if jql_filter:
                params["jql"] = jql_filter
            page = self._request("GET", f"/rest/agile/1.0/board/{board_id}/issue", params=params) or {}
            batch = page.get("issues") or []
            issues.extend(batch)
            if not batch or start + len(batch) >= page.get("total", 0):
                break
            start += len(batch)
        return issues

    def project_versions(self, project_key: str) -> List[Dict[str, Any]]:
        return self._cached(f"versions:{project_key}", lambda: self._request("GET", f"/rest/api/3/project/{project_key}/versions") or [])

    def assignable_users(self, project_key: str) -> List[Dict[str, Any]]:
        def load() -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            start = 0
            while True:
                page = self._request("GET", "/rest/api/3/user/assignable/search",
                                     params={"project": project_key, "startAt": start, "maxResults": 100}) or []
                out.extend(page)
                if len(page) < 100:
                    break
                start += 100
            return [{"account_id": u.get("accountId"), "display_name": u.get("displayName"),
                     "email": u.get("emailAddress"), "active": u.get("active", True)} for u in out if u.get("accountType", "atlassian") == "atlassian"]
        return self._cached(f"users:{project_key}", load)

    def close(self) -> None:
        self._client.close()


class JiraClientPool:
    """Creates one ``JiraSiteClient`` per site, using default or per-board credentials."""

    def __init__(self, email: str, token: str, timeout: int, cache_minutes: int) -> None:
        self.email, self.token, self.timeout, self.cache_minutes = email, token, timeout, cache_minutes
        self._clients: Dict[Tuple[str, str], JiraSiteClient] = {}
        self._lock = threading.Lock()

    @property
    def configured(self) -> bool:
        return bool(self.email and self.token)

    def update_credentials(self, email: str, token: str) -> None:
        with self._lock:
            self.email, self.token = email, token
            for c in self._clients.values():
                c.close()
            self._clients.clear()

    def for_site(self, base_url: str, email: Optional[str] = None, token: Optional[str] = None) -> JiraSiteClient:
        email = email or self.email
        token = token or self.token
        if not email or not token:
            raise JiraNotConfigured("Jira credentials are not configured. Set EDD_JIRA_EMAIL and EDD_JIRA_API_TOKEN in .env.")
        key = (base_url.rstrip("/"), email)
        with self._lock:
            if key not in self._clients:
                self._clients[key] = JiraSiteClient(base_url, email, token, self.timeout, self.cache_minutes)
            return self._clients[key]

    def clear_cache(self) -> None:
        with self._lock:
            for c in self._clients.values():
                c.clear_cache()
