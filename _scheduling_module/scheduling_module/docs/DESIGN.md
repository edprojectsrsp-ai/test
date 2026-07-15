# Scheduling & Project Control Module — Design & Integration Guide

A simplified MS Project / Primavera-style scheduling engine in **Python + PostgreSQL**,
built to slot into an existing project-management system (e.g. Project Brain / RSP) as a
self-contained FastAPI sub-app.

This document is the architectural map. The code that ships alongside it is **real and
tested** — the hard parts (CPM, DCMA, calendar, delay analysis, report export) run and
have a passing test suite. The DB/ORM/API/importer layers are complete and import cleanly;
they are wired to the same engines.

---

## 0. What is actually built vs. what is guidance

| Area | Status |
|---|---|
| CPM engine (forward/backward, 4 rel types, lags, constraints, progress, float, critical + near-critical) | **Implemented + tested** |
| Working-day calendar engine | **Implemented + tested** |
| DCMA 14-point assessor | **Implemented + tested** |
| Delay analysis vs baseline (+ grouping) | **Implemented + tested** |
| Alerts / dashboard cards | **Implemented** |
| Report export — CSV / Excel / PDF | **Implemented + tested** |
| XER importer (Primavera) | **Implemented + tested on synthetic file** |
| MS Project XML importer | **Implemented** |
| MPP importer (via MPXJ/JPype adapter) | **Implemented with honest fallback** |
| PostgreSQL schema (DDL) | **Complete** |
| SQLAlchemy async ORM | **Complete** |
| FastAPI routes + service layer | **Complete** |
| Frontend | **Layout guidance only** (this doc) |

Honest limitations are called out in §13 rather than hidden.

---

## 1. Recommended architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Host application (Project Brain — Next.js 16 / React 19)        │
│  Schedule grid · Gantt · dashboards · DCMA scorecard            │
└───────────────┬────────────────────────────────────────────────┘
                │ HTTP  /api/scheduling/*
┌───────────────▼────────────────────────────────────────────────┐
│  Scheduling FastAPI sub-app  (suggested port 8003)              │
│                                                                 │
│   app/api/routes.py        thin HTTP layer                      │
│   app/services/*           load DB → engine → persist           │
│                                                                 │
│   app/core/                PURE engines (no DB, no framework)   │
│     calendar.py  cpm.py  dcma.py  delay_analysis.py             │
│     alerts.py    reports.py                                     │
│                                                                 │
│   app/importers/           XER / MSP-XML / MPP → normalized IR  │
│   app/models/              SQLAlchemy async ORM                 │
└───────────────┬────────────────────────────────────────────────┘
                │ asyncpg
┌───────────────▼────────────────────────────────────────────────┐
│  PostgreSQL  (schema in sql/schema.sql)                         │
└────────────────────────────────────────────────────────────────┘
```

**Design principle — the engines are pure.** Everything in `app/core/` operates on
plain dataclasses (`CPMActivity`, `CPMRelationship`, …) and knows nothing about the
database or FastAPI. This is what makes the CPM/DCMA/delay logic unit-testable without a
DB, and lets you reuse the same engine from a CLI, a batch job, or a different host app.

The service layer is the only place that touches both the DB and the engines: it loads
rows with `sql_text()` async queries, maps them onto engine dataclasses (using the
activity **code** as the engine's string id), runs the engine, and writes computed
fields back. A `code ↔ uuid` map translates results for persistence.

**Why a separate sub-app, not a library import.** Scheduling runs are CPU-spiky (a large
CPM/DCMA pass) and benefit from isolation so they can't stall the host's request loop.
A sub-app on its own port also lets you scale or restart it independently. If you prefer
a monolith, the same router mounts directly into the host FastAPI with one
`app.include_router(...)` call — nothing in the engines forbids it.

---

## 2. Database schema

Full DDL is in **`sql/schema.sql`** (PostgreSQL, UUID PKs via `pgcrypto`,
enum types, self-referential WBS tree). Tables:

| Table | Purpose |
|---|---|
| `projects` | one row per schedule; `start_date`, `data_date` |
| `calendars` | working weekdays, holidays, working exceptions (JSON) |
| `wbs` | self-referential tree (`parent_id`), per project |
| `activities` | the work; durations, %complete, actual dates, constraint, **cached CPM outputs** (`early_start`, `late_finish`, `total_float`, `is_critical`, …), and **grouping dims** (`agency`, `discipline`, `package`, `area`) |
| `relationships` | predecessor/successor + `rel_type` enum (FS/SS/FF/SF) + `lag` |
| `resources`, `resource_assignments` | resources and per-activity assignment |
| `baselines`, `baseline_activities` | named snapshots + per-activity baseline dates/duration |
| `update_logs` | one row per changed field per update — `field`, `old_value`, `new_value`, `changed_by`, `changed_at`, `remarks` |
| `hindrances` | type, start/end, responsibility, remarks, linked activity |
| `risks` | probability, impact, category, mitigation, owner, status |
| `dcma_runs` | score, passed/applicable counts, full JSON detail |
| `alerts` | generated alerts (severity, category, activity) |
| `schedule_imports` | provenance of each uploaded file |

**Two design choices worth noting:**

1. **CPM outputs are cached on `activities`.** The engine is the source of truth, but the
   computed early/late dates and float are written back so the grid and Gantt can render
   instantly without re-running CPM on every page load. Re-run CPM whenever logic,
   durations, or progress change.

2. **Grouping dimensions live on `activities` as plain columns** (`agency`, `discipline`,
   `package`, `area`). Delay analysis groups by any of these. If your host project models
   these as separate tables, replace them with FK columns — the delay engine only needs a
   `{activity_code: {dimension: value}}` map.

---

## 3. Python backend structure

```
app/
├── config.py            Settings (DATABASE_URL, API_PREFIX, NEAR_CRITICAL_WD)
├── database.py          async engine/session — LAZY init (imports w/o a live DB)
├── main.py              FastAPI app + /health
├── core/                ── pure engines, no DB/framework ──
│   ├── calendar.py        WorkCalendar, working-day arithmetic
│   ├── cpm.py             CPMEngine (the heart)
│   ├── dcma.py            DCMAAssessor (14 checks)
│   ├── delay_analysis.py  DelayAnalyzer (vs baseline + grouping)
│   ├── alerts.py          generate_alerts() → alerts + dashboard cards
│   └── reports.py         CSV / Excel / PDF export
├── importers/
│   ├── base.py            normalized ImportedSchedule IR
│   ├── xer_importer.py    Primavera XER parser
│   └── msp_importer.py    MS Project XML + MPP(MPXJ) parser
├── models/models.py     SQLAlchemy 2.0 async ORM (mirrors schema.sql)
├── services/cpm_service.py  load → run engine → persist
└── api/routes.py        FastAPI router (/api/scheduling/*)
```

`database.py` uses **lazy** engine/session creation (`get_engine()`,
`get_sessionmaker()`, `get_session()`) so the package imports even where the asyncpg
driver or a live DB isn't present (CI, unit tests, the engines alone).

---

## 4. Core CPM algorithm

File: **`app/core/cpm.py`**. This is the technically critical piece, so it's worth
understanding in detail.

### 4.1 The working-day "unit" model

CPM math is done on **integer working-day units**, not raw calendar dates. The calendar
engine maps each calendar date to/from a unit index relative to the project's first
working day:

```
unit 0  = first working day (anchor)
unit 1  = next working day  …
```

Weekends, holidays, and calendar exceptions simply don't get unit numbers, so adding
durations never lands on a non-working day and "10 working days from Friday" is correct
by construction. Forward/backward passes are plain integer arithmetic on units; only at
the end are units converted back to dates for display.

**Duration convention:** an activity of duration *D* starting at unit *s* occupies units
`s … s+D-1`. So a 1-day task starts and finishes on the **same** day. A 0-day activity is
a milestone.

> **Single-calendar scope.** CPM runs on **one project calendar**. Per-activity / per-
> resource calendars (where a successor's lag must be counted on the successor's own
> calendar) are a genuinely harder problem and are deferred to Phase 2 (§14). This is
> stated plainly rather than pretended away.

### 4.2 Relationship types and lag

All four relationship types are supported, each with a lag (negative lag = lead), in
working-day units:

| Type | Constraint imposed on successor |
|---|---|
| **FS** | `succ.start ≥ pred.finish + 1 + lag` |
| **SS** | `succ.start ≥ pred.start + lag` |
| **FF** | `succ.finish ≥ pred.finish + lag` |
| **SF** | `succ.finish ≥ pred.start + lag` |

### 4.3 Forward pass (early dates)

1. **Topological sort** of the activity graph. Cycle detection runs here — circular logic
   raises `CPMError` listing the cycle, rather than looping forever.
2. Walk in topo order. Each activity's early start is the max over all predecessor
   constraints (above), floored at the project start (or data date — §4.5).
3. Early finish = early start + duration − 1 (milestones: EF = ES).

### 4.4 Backward pass (late dates) & float

1. Project finish = max early finish across all activities.
2. Walk in reverse topo order; each activity's late finish is the min over successor
   constraints, ceiled at project finish.
3. **Total float** = late start − early start (in working days). Float 0 ⇒ critical.
   `NEAR_CRITICAL_WD` (default 5) flags near-critical activities.
4. **Free float** = how much an activity can slip without delaying *any* successor's early
   start — computed from the tightest successor relationship.

### 4.5 Constraints

The `Constraint` enum supports ASAP / ALAP / SNET / FNET / SNLT / FNLT / MSO / MFO.
`MSO`/`MFO` ("must start/finish on") are **hard** — they pin the date and can drive float
**negative** (a legitimate signal the schedule can't meet the constraint). Soft
constraints bound the relevant pass without overriding logic.

### 4.6 Progress & data date

When a `data_date` is set, the forward pass respects status:

- **Completed** activities are pinned to their **actual** dates.
- **In-progress** activities are scheduled forward **from the data date** using remaining
  duration (explicit `remaining_duration`, else derived from `percent_complete`).
- **Not-started** activities can't start before the data date.

This is what makes the "as of this update" CPM correct rather than a naïve replan.

### 4.7 The work-rate / productivity parameters (spec item 5)

The spec asks for CPM "based on different parameters" — current/baseline work rate,
planned/actual productivity, remaining duration, forecast completion rate. These are
**inputs that resolve to a remaining duration per activity**, not separate algorithms:

```
remaining_duration = remaining_quantity / productivity_rate
```

The recommended approach: compute remaining duration from whichever rate the user
selects (planned vs actual productivity, forecast rate, …), feed it into the CPM run via
`remaining_duration`, and label the resulting run as a **scenario**. The engine already
accepts per-activity remaining duration, so scenarios are a thin service-layer concern,
not an engine change. (Wiring a `scenario` table + selector is a Phase-2 nicety.)

---

## 5. File import (XML / XER / MPP)

All importers normalize to a single intermediate representation in
**`app/importers/base.py`** — `ImportedSchedule` with `ImpCalendar / ImpWBS /
ImpActivity / ImpRelationship`. The service layer persists the IR; engines never see file
formats.

### 5.1 XER (Primavera) — `xer_importer.py` *(tested)*

XER is a tab-delimited table dump (`%T` table, `%F` fields, `%R` rows). The parser reads
`PROJECT`, `PROJWBS`, `CALENDAR`, `TASK`, `TASKPRED`, converts P6 hours→days (÷8), maps
milestone flags, constraint codes, and relationship types, and carries actual dates.

### 5.2 MS Project XML — `msp_importer.py::parse_msp_xml()`

Native MSPDI XML via `ElementTree`: ISO-8601 durations → days, relationship/constraint
code maps, summary tasks → WBS nodes.

### 5.3 MPP — `msp_importer.py::parse_mpp()`

**There is no reliable pure-Python `.mpp` reader** — the format is an undocumented
compound binary. The honest, production-grade route is **MPXJ** (mature Java library) via
**JPype**:

```
pip install JPype1
export MPXJ_CLASSPATH=/path/to/mpxj.jar:/path/to/deps/*
```

`parse_mpp()` uses MPXJ when the classpath is present and otherwise raises
`MPPImportError` with exact remediation steps — rather than silently returning garbage.
**Recommended UX:** accept `.mpp`, and if MPXJ isn't configured, tell the user to "Save
As → XML" in MS Project (which the XML importer handles natively).

### 5.4 Validation

On import, validate before committing: every relationship references existing activities;
no circular logic (run the CPM topo sort); durations ≥ 0; milestones have duration 0;
constraint dates present where the constraint needs one. Surface failures as a per-row
report, not a 500.

---

## 6. Delay analysis logic

File: **`app/core/delay_analysis.py`**. Compares a CPM result against a saved baseline.

For each activity: start variance and finish variance in **working days** (+ve = late),
total float, criticality, and a **classification**:

- `ahead` — finishing earlier than baseline
- `on_track` — within tolerance
- `slipping` — late but with positive float (absorbed for now)
- `critical_delay` — late **and** on/near the critical path (pushes the end date)

`project_finish_variance_wd`, `delayed_count`, and `critical_delay_count` summarize the
run. **`group_summary(dimension)`** rolls the rows up by any dimension — agency,
discipline, package, area, WBS, milestone — answering "which agency is dragging the
project" directly. Per-activity **reasons** can be attached (typically sourced from the
hindrance register, §7).

---

## 7. Hindrance register integration

`hindrances` table links a hindrance (type, start/end, responsibility, remarks, docs) to
an activity. Two integration points:

1. **Delay reasons:** a hindrance overlapping an activity's slip window supplies the
   `reason` text in the delay report — connecting *what slipped* to *why*.
2. **Impact view:** hindrance duration vs the activity's float tells you whether a
   hindrance actually threatens the end date (consumed float) or was absorbed. Summaries
   are produced both **hindrance-wise** (this hindrance hit N activities, M working days)
   and **activity-wise** (this activity carries these hindrances).

---

## 8. Risk register integration

`risks` table attaches risks to an activity / WBS / milestone with probability, impact,
category, mitigation, owner, status. The dashboard cross-references open risks against CPM
output to highlight risks sitting on **critical or near-critical** activities — a
high-probability/high-impact risk on a zero-float activity is the thing to escalate. This
feeds the `high_risk` alert category (§10).

---

## 9. DCMA 14-point assessment

File: **`app/core/dcma.py`**. All 14 checks implemented with standard thresholds; each
returns a `CheckResult` (metric, threshold, pass/fail, affected/total, observation,
suggestion). The `DCMAReport` carries an overall score (% of *applicable* checks passed).

| # | Check | Threshold |
|---|---|---|
| 1 | Logic (missing predecessor/successor) | < 5% |
| 2 | Leads (negative lag) | = 0 |
| 3 | Lags | < 5% |
| 4 | Relationship types (FS share) | ≥ 90% FS |
| 5 | Hard constraints | < 5% |
| 6 | High float (> 44 wd) | < 5% |
| 7 | Negative float | = 0 |
| 8 | High duration (> 44 wd) | < 5% |
| 9 | Invalid dates (actuals in future / forecast in past) | = 0 |
| 10 | Resources (assigned where expected) | informational |
| 11 | Missed tasks (behind baseline) | < 5% |
| 12 | Critical path test | integrity |
| 13 | CPLI (Critical Path Length Index) | ≥ 0.95 |
| 14 | BEI (Baseline Execution Index) | ≥ 0.95 |

**Check 12 is the clever one.** It injects a large delay (+600 wd) into an incomplete
activity, re-runs CPM, and confirms the project finish moves — proving the critical path
is truly continuous from data date to finish. A broken or open-ended network won't
propagate the delay, which the test catches.

`44 working days` (≈ 2 calendar months) is the DCMA convention for "high" float/duration.

---

## 10. Alerts & dashboard

File: **`app/core/alerts.py`**. `generate_alerts()` returns `(list[Alert],
DashboardCards)`. Categories: negative float, missing logic, upcoming milestone, overdue
update, critical look-ahead, unresolved hindrance, high risk. Dashboard cards summarize
critical-activity count, delayed milestones, activities needing update, and an overall
**schedule-health** heuristic (good / watch / poor) derived from negative float, logic
gaps, and overdue updates.

---

## 11. Reports & dashboards (export)

File: **`app/core/reports.py`** *(tested — CSV, valid multi-page PDF, formatted XLSX)*.

Engine results → titled `Table` objects → three exporters:

- **CSV** — stdlib, always available.
- **Excel** — `openpyxl`, one formatted sheet per report (teal header, frozen panes,
  auto width, conditional shading: failed DCMA rows, critical activities).
- **PDF** — `reportlab`, landscape A4, repeating headers, same conditional shading.

`build_report_pack()` assembles whichever of these the caller has data for:
project schedule summary · critical path · milestone tracking · look-ahead · baseline
variance · delay analysis · DCMA scorecard.

Endpoint: `GET /api/scheduling/projects/{id}/reports/export?fmt=xlsx|pdf|csv&baseline_id=…&look_ahead_days=…`
streams the file back via `FileResponse`.

---

## 12. API endpoint reference

Router prefix **`/api/scheduling`** (file `app/api/routes.py`).

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects` | create a project |
| POST | `/projects/{id}/import` | upload `.xer` / `.xml` / `.mpp`; dispatch to importer |
| POST | `/projects/{id}/cpm/run` | run CPM, persist early/late/float/critical |
| PATCH | `/activities/{id}/progress` | actual start/finish, %, remaining → writes one `update_log` per changed field, recomputes |
| POST | `/projects/{id}/baselines` | snapshot current schedule as a named baseline |
| GET | `/projects/{id}/delay?baseline_id=…` | delay report vs baseline |
| POST | `/projects/{id}/dcma?baseline_id=…` | DCMA run; persists to `dcma_runs` |
| GET | `/projects/{id}/dashboard` | alerts + dashboard cards |
| GET | `/projects/{id}/reports/export?fmt=…` | CSV / Excel / PDF report pack |
| GET | `/health` | liveness |

Every write that changes a tracked field appends to `update_logs` (date, user, field,
old → new, remarks), satisfying the audit-trail requirement of spec item 4.

---

## 13. Frontend / UI layout guidance

The brief is explicit: *"feel like a professional project scheduling tool, not just a
basic data-entry form."* Concretely:

**Schedule grid (left)**
- Spreadsheet-style, virtualized rows (1000s of activities). Indented WBS tree with
  expand/collapse. Inline-editable duration, dates, %, constraint.
- **Column chooser** (MS-Project-style): user picks/reorders columns; persist per user.
- Sort, multi-filter, and **group-by** (WBS / agency / discipline / package / area).
- Saved **views**: WBS, activity, milestone, critical-path-only, delayed-only, look-ahead.

**Gantt (right, time-synced with grid rows)**
- Bars positioned on a working-day timescale (zoom: day/week/month).
- **Baseline bars** rendered as a thinner ghost bar beneath the current bar so slippage is
  visible at a glance.
- Critical path in a distinct colour (e.g. brand teal `#0E7C7B`); near-critical a lighter
  shade. Milestones as diamonds. Dependency arrows for FS/SS/FF/SF.
- Today/data-date vertical line.

**Delay dashboard**
- Top cards: project finish variance, # delayed, # critical delays, schedule health.
- Group-by selector (agency/discipline/package/area) driving a variance bar chart +
  drill-down table. Colour by `DelayClass`.

**DCMA scorecard**
- 14 tiles in a grid, each pass/fail with metric vs threshold and a one-line suggestion;
  overall score as a ring gauge. Click a tile → the offending activities in the grid.

**Suggested libraries:** a virtualized data grid (AG Grid / TanStack Table) + a Gantt
(frappe-gantt, dhtmlx, or a custom SVG layer over the CPM output). The backend already
returns everything these need; the UI is rendering, not computing.

---

## 14. Stepwise implementation roadmap

**Phase 0 — foundation (done in this package)**
CPM, calendar, DCMA, delay, alerts, reports engines + tests; schema; ORM; importers;
service + API skeleton.

**Phase 1 — make it live**
1. Provision PostgreSQL; run `sql/schema.sql`; set `SCHED_DATABASE_URL`.
2. Mount the router in the host (or run standalone on :8003). Smoke-test `/health`.
3. Wire the schedule grid + Gantt to `cpm/run` and the activity/relationship reads.
4. Hook progress updates → `PATCH /activities/{id}/progress` (confirm `update_logs`).

**Phase 2 — fidelity**
5. Baselines UI + baseline ghost bars; delay dashboard with group-by.
6. DCMA scorecard; alerts surfaced as dashboard cards.
7. Importers behind an upload UI; MPXJ classpath for `.mpp` (or XML fallback).
8. **Multi-calendar CPM** (per-activity/resource calendars) — the deferred hard problem.
9. CPM **scenarios** (work-rate / productivity selector → remaining duration → labelled run).

**Phase 3 — polish**
10. Resource loading/levelling views; report scheduling/email; saved user views &
    column layouts; permissions tied to the host's auth.

---

## 15. Running it

```bash
# deps
pip install -r requirements.txt

# database
createdb scheduling          # or reuse the host DB with a schema
psql scheduling -f sql/schema.sql
export SCHED_DATABASE_URL="postgresql+asyncpg://user:pass@localhost/scheduling"

# run
uvicorn app.main:app --port 8003 --reload

# tests (no DB needed — engines are pure)
python tests/test_cpm.py
```

The engines have **no database dependency** — you can import `app.core.cpm` and run a CPM
pass on in-memory dataclasses today, which is exactly how the test suite exercises them.
