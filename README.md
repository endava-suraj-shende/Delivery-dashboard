# Employee Project & Delivery Performance Reporting Dashboard

An Excel-driven reporting application for Delivery Managers, Project Managers and Team Leads.
It reads the per-employee **bi-weekly work-update workbooks** kept in the `Data/` folder and produces:

* an executive dashboard, individual employee dashboards, team and project dashboards
* Jira ticket analytics with configurable status normalisation and unique-ticket counting
* separate Dev-deployment and Production-release tracking
* rule-based management insights, data-quality monitoring and period comparison
* downloadable PDF / Excel / CSV reports

There is **no database** â€” Excel is the only source of truth. Nothing ever writes to the source workbooks.

---

## 1. Quick start

Prerequisites: **Python 3.10+**, **Node.js 18+** (with npm). Windows 10/11 and Linux are supported.

```bash
# one-time
python -m pip install -r backend/requirements.txt
cd frontend && npm install && cd ..

# every time
python run.py
```

`run.py` checks dependencies, starts the FastAPI backend and the Vite frontend, prints the URLs, monitors both
processes and shuts them down together on **Ctrl+C**. Use `python run.py --install` to install missing dependencies
automatically, `--check` to only verify prerequisites, `--backend` / `--frontend` to start a single side.

| Service  | URL                          |
|----------|------------------------------|
| Frontend | http://localhost:5173        |
| Backend  | http://127.0.0.1:8000        |
| API docs | http://127.0.0.1:8000/docs   |

Optional configuration: copy `.env.example` to `.env` (all variables are prefixed `EDD_`).

---

## 2. Data sources

The application has a switchable **primary data source** (Settings â†’ *Primary data source*, or `EDD_DATA_SOURCE`):

| Mode | Description |
|---|---|
| `auto` (default) | **Jira boards** when credentials and at least one board are configured, otherwise Excel |
| `jira` | Every dashboard is built from the configured Jira boards (see Â§2b) |
| `excel` | Bi-weekly workbooks in `Data/` plus uploads (see Â§2a) |
| `both` | Both sources combined; a ticket present in both counts once |

### 2a. Excel workbooks

```
Data/
  <EmployeeFolder>/
    <Name>-<dd-mm-yyyy>.xlsx      â† one bi-weekly template per report
```

Each workbook is the standard **"Bi-Weekly Delivery Status & Work Update"** template:

| Section                         | What is read                                                                                                  |
|---------------------------------|---------------------------------------------------------------------------------------------------------------|
| Form header                     | `Date`, `Jira Board`, `Team Lead`, `Team Members`, `Employee Name`, `Project / Team Name`, `Application Name` |
| Work Items & Delivery Tracking  | `Application Name`, `Jira Ticket ID`, `Jira Ticket Link`, `Work Details`, `Work Type`, `Work Status`, `Production Deployment Required?`, `Dev Deployment Status`, `Additional Comments` |
| Production Deployment Summary   | `Application Name`, `Production Release Tickets`, `Production Release Details`, `Production Release Date`, `Production Deployment Status` |
| Knowledge Transfer Tracking     | optional KT table                                                                                              |
| Additional work notes           | free text                                                                                                      |

Column headers are matched fuzzily (case, spaces, punctuation and common synonyms such as `Jira/OS Ticket ID`,
`Jira TicketID`, `Status`). Flat sheets (a plain table with a ticket-id and status column) are also accepted; the
employee is then derived from the folder / file name. Every anomaly (missing ids, blank statuses, invalid dates,
duplicates, unmapped statuses, â€¦) is recorded as a data-quality issue instead of being discarded.

Additional workbooks can be uploaded from **Excel Data Management**; they are copied to `storage/uploads/` and the
folder is re-scanned. The backend also watches `Data/` and reloads automatically when files change.

> **Windows note:** `Data` and `data` are the same folder on Windows. Runtime storage therefore lives in `storage/`,
> never inside `Data/`.

### 2b. Jira boards as the data source

Add board links in **Jira Connections** (any number of boards, any Atlassian site). Credentials can be entered in the
UI â€” a default Atlassian email + API token, and optionally a different email/token per board â€” and are stored
**encrypted** (Fernet, key in `backend/config/.secret.key`, never returned by the API); `.env` variables still work as a
fallback. Each board has a **People** picker: when people are selected, only their work from that board is loaded
(nobody selected = everyone). Only issues *updated within the look-back window* (default 180 days, Settings) are
loaded; data refreshes automatically every `refresh_minutes` (default 15) and on **Refresh data**.

| Dashboard concept | Jira source |
|---|---|
| Activity (one row) | one **status transition** from the issue changelog, plus a snapshot on the day of the last update |
| Report | (board, assignee, day) |
| Employee | assignee (`Unassigned` when empty) |
| Project / Team | `Team` field â†’ board project name |
| Application | primary Component â†’ `Module` â†’ Epic summary â†’ first label â†’ project name |
| Jira board | the configured board label |
| Work type | issue type (Story/Improvement/Sub-task â†’ Development, Bug/Defect â†’ Bug fix, Test/QA â†’ Testing, Spike â†’ Analysis, DevOps â†’ Deployment) |
| Work status | Jira status, normalised in Status Configuration (new category *Cancelled / Rejected*) |
| Dev deployment | Jira status via the *Jira status â†’ Dev deployment* mapping (In Dev / In QA / In Stage / Done = deployed) |
| Production | `fixVersions` (released flag + release date) and `In Prod` transitions; without a fixVersion the *Jira status â†’ Production* mapping is used |
| Sprint | the issue's sprint(s); a carried-over ticket's work is attributed to the sprint whose dates contain the day it happened |
| Notes | sprint, story points, environment, components, fix versions, last comment |

Custom field ids (Team, Sprint, Story Points, Epic Link/Name, Technical Lead, Environment, Module) are resolved
**by field name per site**, so no ids are hard-coded; the resolved mapping is shown under Settings.

---

## 3. Calculation rules (also shown inside the app)

1. An **activity** is one row of a Work Items table. Activity counts reflect reported work volume, not productivity.
2. A **unique Jira ticket** is counted once across all rows, reports and employees. Cells with several ids (`A-1, A-2`) contribute each id once.
3. Rows without a recognisable Jira id (`No Jira`, `NA`, project key only, blank) count as activities but never as tickets.
4. When a ticket appears in several reports its representative status follows the configurable **latest-status rule**:
   *latest report date wins* (default) or *most advanced status wins*.
5. In employee / project / application breakdowns a ticket is attributed to every group that reported it.
6. Dates come from each report's `Date` cell (falling back to the file name, with day/month-swap correction when the
   file name disagrees). Work items inherit their report date; production releases use their own release date when present.
7. `Work Status`, `Work Type`, `Dev Deployment Status`, `Production Deployment Required?` and `Production Deployment
   Status` are independent dimensions and are never inferred from each other.
8. Unmapped values are shown as **Other / Unmapped** and never assumed to be completed, pending or successful.
   Map them in **Status Configuration** (persisted to `backend/config/status_mapping.json`).
9. A production release row does not imply the Jira ticket is complete.

The global date filter (default **last 30 days**, inclusive) is applied on the server to every KPI, chart, table,
insight and report, together with the project / employee / board / sprint / status filters. A changed filter is
kept for every tab until the browser tab is closed. (The application filter is hidden behind the
`FEATURES.applicationFilter` flag in `frontend/src/lib/features.ts`.)

**Sprints.** *Sprint Performance* lists the active sprint and previous sprints (from the Scrum boards' Agile API)
with per-sprint KPIs, people, tickets and releases, plus deltas against the previous sprint. Selecting a sprint as a
filter applies it to every tab; a sprint is a period of its own, so the date range is not applied while a sprint
filter is active. Endpoints: `GET /sprints`, `GET /sprints/{name}`, filter parameter `sprint`.

**Employee performance.** *Employee Performance* shows, per person, unique tickets by latest status — assigned,
completed, in development, code review, testing / QA, ready to deploy, backlog, on hold, blocked — plus dev / production
deployments, as charts (assigned vs completed, work status by employee, deployments, completion trend) and a table.
The individual page adds a current-vs-previous-period ticket-status chart, a ticket summary table and a day-by-day
performance trend (chart + table). On-time / overdue counts use the Jira due date, or the end of the sprint the work
belongs to when no due date is set. Endpoint: `GET /employees/{name}/performance` (`performance.metrics`).

---

## 4. Architecture

```
backend/app
  core/          config (pydantic-settings), structured logging, exception handlers
  processors/    excel_reader â†’ template_parser â†’ column_mapper / ticket_parser / status_normalizer
  services/      data_store (in-memory, repository-shaped), excel_service, filter_service,
                 analytics_service (single aggregation engine), report_service (PDF/XLSX/CSV), container
  events/        in-process event bus + handlers (data.loaded â†’ cache invalidation, config change â†’ renormalise)
  api/v1/        excel, employees, projects, jira, deployment, dashboard, search, config, meta, reports
frontend/src
  layouts/       sidebar + header shell (global search, date range, refresh, theme)
  hooks/         URL-synchronised global filters, data hooks, theme
  components/    shadcn-style UI primitives, charts (Recharts), DataTable (TanStack), tables, KPI cards
  modules/       executive, employees, teams, projects, jira, deployments, reports, excel, config
```

* All numbers come from `AnalyticsEngine` so KPIs, charts, tables and reports always reconcile.
* Parsed data is cached in memory and invalidated when the workbook folder signature changes.
* `InMemoryDataStore` implements the `DataRepository` protocol so a database can be introduced later.
* No authentication: intended for a **trusted local environment**. The service/API layering is ready for auth and RBAC.

### API groups (all under `/api/v1`)

`/excel/*` (status, refresh, files, sheets, preview, validate, upload, uploads, history) Â·
`/employees`, `/employees/{name}/summary|activities|performance` Â· `/projects`, `/projects/{name}/summary|employees` Â·
`/jira/summary|status-distribution|tickets|tickets/{id}` Â· `/deployment/dev/summary|production/summary|trends` Â·
`/dashboard/executive|team|employee|project|activities|compare|data-quality` Â· `/search` Â· `/meta/dimensions|presets` Â·
`/config/status` (GET/PUT, `/mapping`, `/reset`), `/config/app` Â· `/reports/types|generate|employee|team|project|management|download/{id}`.

Query parameters: `start_date`, `end_date`, `preset`, `employee`, `project`, `application`, `jira_board`, `status`,
`work_type`, `dev_deployment`, `prod_deployment`, `prod_required`, `ticket`, `search` (list parameters may repeat).

---

## 4a. Live Jira comparison (optional)

Excel stays the source of truth; Jira is an **enrichment** that shows where the bi-weekly sheets and live Jira disagree.

**Setup**
1. Create an Atlassian API token (https://id.atlassian.com/manage-profile/security/api-tokens). Either enter it in
   **Jira Connections â†’ Default credentials** (stored encrypted in `backend/config/jira_credentials.json`) or put it in `.env`:
   ```
   EDD_JIRA_EMAIL=you@company.com
   EDD_JIRA_API_TOKEN=<token>
   ```
   (`.env` changes need a restart of `python run.py`; UI-entered credentials apply immediately.)
2. Open **Jira Connections** in the sidebar â†’ paste a board link (e.g. `https://annalect.atlassian.net/jira/software/c/projects/OCS/boards/921`) â†’ optionally an email + API token just for this board â†’ *Test link* â†’ *Add board*. Repeat for every team board, or use **Discover boards** (lists boards for the project keys found in your Excel files). Boards are stored in `backend/config/jira_boards.json`; nothing else is needed in code.
3. Boards on another Atlassian site (e.g. `flywheeldigital.atlassian.net`) can use their own credentials entered in the form, or `.env` names (`EDD_JIRA_EMAIL_X`, `EDD_JIRA_TOKEN_X`) via *Use credentials from environment variables*.
4. Check **People mapping** â€” Excel employee names are auto-matched to Jira users; override the few that differ.

**What is compared** (per Excel work-item row with a Jira id, for the files in `Data/` *and* uploaded files):

| Check | Severity |
|---|---|
| Ticket id not found in Jira | conflict |
| Excel status category â‰  Jira status (e.g. Completed vs In Progress) | conflict |
| Excel *Completed* but Jira not done / Jira *Done* but sheet still open | warning |
| Jira assignee â‰  reporting employee, or unassigned | warning / info |
| Excel production status pending while Jira shows released | warning |
| Ticket's project differs from the sheet's "Jira Board" | info |
| Jira updated after the latest sheet | info |
| Jira issue assigned to the employee, updated in the period, missing from every sheet | info |
| Project with no configured board / sync error | info (never counted as a conflict) |

**Where it appears:** Excel Data Management â†’ file preview â†’ *Compare with Jira* (also summarised in the upload toast) Â· Jira Analytics â†’ *Live Jira* tab (global filters apply) Â· Executive dashboard KPI + insight Â· Jira ticket dialog.

Sync runs automatically after each data load/upload (`EDD_JIRA_AUTO_SYNC`), is cached for `EDD_JIRA_CACHE_MINUTES`, and can be forced with *Sync*. If Jira is unreachable only the Jira panels show an error; all Excel dashboards keep working.

API: `/jira/connections[/boards|/test|/discover|/me]`, `/jira/live/sync|status|reconciliation|reconciliation/file/{id}|issues/{key}|users|user-map`.

---

## 5. Development

```bash
# backend tests (synthetic workbooks are generated in a temp folder â€” real data is never touched)
cd backend && python -m pytest -q

# frontend type-check / build
cd frontend && npx tsc -b && npm run build

# backend with auto-reload
python run.py --reload
```

Project layout:

```
run.py                 single-command launcher
backend/               FastAPI application, tests, requirements.txt
frontend/              React + TypeScript + Vite + Tailwind application
Data/                  source workbooks (business data, git-ignored)
storage/uploads        uploaded workbooks (session data)
storage/reports        generated reports
.env.example           configuration template
```

---

## 6. Assumptions & limitations

* Work-item rows carry no individual date; they are attributed to the **report date** of the workbook they appear in.
* The team roster is derived from the workbooks present; "employees with no activity" means no report dated in the period.
* Template rows copied from another employee's sheet (same ticket id in two employees' reports) are attributed to both;
  the ticket is still counted once in team totals.
* Import history and generated-report history are kept for the running session only (no database).
