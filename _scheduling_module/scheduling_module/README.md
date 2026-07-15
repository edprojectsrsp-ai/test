# Scheduling & Project Control Module

A simplified **MS Project / Primavera-style** scheduling engine in Python + PostgreSQL,
designed to be embedded into an existing project-management system as a FastAPI sub-app.

The hard parts — **CPM, DCMA 14-point, working-day calendar, delay analysis, report
export** — are real, runnable, and covered by a passing test suite. The DB/ORM/API/importer
layers are complete and wired to those engines.

> Full architecture, algorithm explanations, schema walkthrough, API reference, frontend
> guidance and roadmap: **[`docs/DESIGN.md`](docs/DESIGN.md)**.

---

## Quickstart

```bash
pip install -r requirements.txt

# database
createdb scheduling
psql scheduling -f sql/schema.sql
export SCHED_DATABASE_URL="postgresql+asyncpg://user:pass@localhost/scheduling"

# run the API (suggested port 8003)
uvicorn app.main:app --port 8003 --reload
# -> http://localhost:8003/health
# -> http://localhost:8003/docs   (interactive OpenAPI)
```

### Run the engines with no database

The `app/core/` engines are pure — no DB, no framework. Run CPM on in-memory data:

```bash
python tests/test_cpm.py     # full CPM test suite, no DB required
```

---

## What's inside

```
app/core/        pure engines  → calendar · cpm · dcma · delay_analysis · alerts · reports
app/importers/   XER · MS-Project XML · MPP(MPXJ) → normalized intermediate representation
app/models/      SQLAlchemy 2.0 async ORM (mirrors sql/schema.sql)
app/services/    load DB → run engine → persist
app/api/         FastAPI router  (/api/scheduling/*)
sql/schema.sql   PostgreSQL DDL  (UUID PKs, enums, self-ref WBS tree)
tests/           CPM test suite
docs/DESIGN.md   the full design & integration guide
```

## Feature → file map (spec items 1–13)

| Spec area | Where |
|---|---|
| 1 Schedule creation & upload | `app/importers/*`, `POST /projects`, `/import` |
| 2 Display & editing | grid/Gantt guidance in `docs/DESIGN.md §13` |
| 3 Baseline management | `baselines` tables, `POST /baselines`, ghost bars (§13) |
| 4 Schedule updating + log | `PATCH /activities/{id}/progress` → `update_logs` |
| 5 CPM calculation | `app/core/cpm.py` |
| 6 Delay analysis | `app/core/delay_analysis.py`, `GET /delay` |
| 7 Hindrance register | `hindrances` table; delay-reason integration (§7) |
| 8 Risk register | `risks` table; critical-path cross-ref (§8) |
| 9 DCMA 14-point | `app/core/dcma.py`, `POST /dcma` |
| 10 Alerts & dashboard | `app/core/alerts.py`, `GET /dashboard` |
| 11 Reports & export | `app/core/reports.py`, `GET /reports/export` |
| 12 Data model & backend | `sql/schema.sql`, `app/models/`, `app/services/` |
| 13 Frontend guidance | `docs/DESIGN.md §13` |

## Notes & honest limitations

- **CPM runs on one project calendar.** Per-activity / per-resource calendars are a
  genuinely harder problem, deferred to Phase 2 (see `docs/DESIGN.md §14`).
- **`.mpp` import needs MPXJ** (Java, via JPype) — there's no reliable pure-Python MPP
  reader. Without it, the importer raises a clear error; the simplest path is
  *Save As → XML* in MS Project, which the XML importer handles natively.
- Excel/PDF export needs `openpyxl` / `reportlab` (in `requirements.txt`); CSV is stdlib.

## Tests

```bash
python tests/test_cpm.py
```

Verifies the classic A-B-D-F network (critical path, total/free float, anchored dates),
SS+lag and FF relationships, deadline-driven negative float, data-date progress
scheduling, and circular-logic detection.
