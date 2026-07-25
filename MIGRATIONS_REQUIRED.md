# Database changes required

Everything the recent work needs, verified against the actual schemas in the
repo (`_scheduling_module/scheduling_module/sql/schema.sql`,
`ppe-camera/backend/app/models/*.py`, `project-brain-backend/migrations/*.sql`)
rather than assumed.

**Read this first — three findings that change the scope:**

1. `resources` and `resource_assignments` **already exist** in
   `sql/schema.sql`. They are missing from `models.py`, which is why they
   looked absent. Only one column needs adding, not two tables.
2. `cameras.source_kwargs` is already a JSON column, so the new camera source
   types (MJPEG, HTTP snapshot, image folder, HLS) need **no schema change**.
3. A **pre-existing bug** that broke the scheduling API end to end has been
   found and fixed in code — see §6. It needs no migration, but read it, because
   it explains why several endpoints could never have worked.

Ordering: §1–§3 are needed for features already merged. §4 is needed only when
you wire the resource UI to real data. §5 is optional. §6 needs no action — it
was a code bug, already fixed.

---

## 1. Scheduling — resource levelling

**Database:** Postgres, `_scheduling_module`
**Needed by:** resource histogram + levelling (`lib/furnace/resources.ts`)

`resources` already has `id, project_id, name, type, unit, rate`.
`resource_assignments` already has `id, activity_id, resource_id, units,
budgeted_cost` — `units` is the per-day demand the levelling engine reads, so
no change is needed there.

The levelling engine needs to know how much of a resource exists per day, which
`rate` (a cost) does not express.

```sql
-- migrations/2026_07_24_resource_capacity.sql
ALTER TABLE resources
    ADD COLUMN IF NOT EXISTS capacity NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS color    TEXT;

COMMENT ON COLUMN resources.capacity IS
    'Units available per working day. NULL = unconstrained (never levelled).';

CREATE INDEX IF NOT EXISTS idx_resassign_activity
    ON resource_assignments(activity_id);
CREATE INDEX IF NOT EXISTS idx_resassign_resource
    ON resource_assignments(resource_id);
```

`capacity` is deliberately nullable rather than defaulted. A default of 1 would
make every existing resource instantly over-allocated and the levelling screen
would open full of false alarms on day one; NULL means "not yet configured, do
not constrain", which is honest.

**Also required (code, not schema):** `app/models/models.py` has no `Resource`
or `ResourceAssignment` class even though the tables exist. Add them so the ORM
matches the schema.

---

## 2. PPE — violation engine fields

**Database:** `ppe-camera` (SQLAlchemy, SQLite by default)
**Needed by:** the industrial-grade violation engine

`violation_events` currently stores `track_id`, which is **NULL for every
untracked person**. The engine now assigns a spatial identity when the tracker
gives no id, and that identity is the only stable person key in a crowd.

```sql
ALTER TABLE violation_events ADD COLUMN identity        VARCHAR(32) DEFAULT '';
ALTER TABLE violation_events ADD COLUMN evidence_frames INTEGER     DEFAULT 0;
ALTER TABLE violation_events ADD COLUMN reason          VARCHAR(128) DEFAULT '';
ALTER TABLE violation_events ADD COLUMN assessable      BOOLEAN     DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_violation_identity
    ON violation_events(camera_id, identity, gear);
```

| Column | Why |
|---|---|
| `identity` | Resolved person key (`t7` tracked, `s3` spatial). Without it you cannot count distinct violators, and every untracked person aggregates as one. |
| `evidence_frames` | How many frames supported the violation. This is what makes a disputed claim defensible. |
| `reason` | Why it fired or was declined (`violation class detected in band`, `person too small`, `feet outside frame`). |
| `assessable` | False when PPE could not be judged. Must be distinguishable from compliant — "we couldn't see" is not "they were wearing it". |

**SQLAlchemy** (`app/models/domain.py`, class `ViolationEvent`):

```python
identity:        Mapped[str]  = mapped_column(String(32), default="", index=True)
evidence_frames: Mapped[int]  = mapped_column(Integer, default=0)
reason:          Mapped[str]  = mapped_column(String(128), default="")
assessable:      Mapped[bool] = mapped_column(Boolean, default=True)
```

---

## 3. PPE — alert incidents

**Needed by:** per-person alert deduplication (`app/services/alert_policy.py`)

The policy engine currently holds incident state **in memory only**, so a
restart re-alerts every ongoing violation. `alerts.dedup_key` exists but is the
old `(camera, gear)` key.

```sql
ALTER TABLE alerts ADD COLUMN incident_key     VARCHAR(160) DEFAULT '';
ALTER TABLE alerts ADD COLUMN kind             VARCHAR(16)  DEFAULT 'new';
ALTER TABLE alerts ADD COLUMN occurrence       INTEGER      DEFAULT 1;
ALTER TABLE alerts ADD COLUMN escalation_level INTEGER      DEFAULT 0;
ALTER TABLE alerts ADD COLUMN reason           VARCHAR(128) DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_alerts_incident ON alerts(incident_key);

-- Survives restart. Without this, a shift change re-alerts every open incident.
CREATE TABLE IF NOT EXISTS alert_incidents (
    key              VARCHAR(160) PRIMARY KEY,
    camera_id        VARCHAR(64)  NOT NULL,
    gear             VARCHAR(48)  NOT NULL,
    person           VARCHAR(32)  NOT NULL DEFAULT '',
    first_at         TIMESTAMP    NOT NULL,
    last_alert_at    TIMESTAMP    NOT NULL,
    last_seen_at     TIMESTAMP    NOT NULL,
    observations     INTEGER      NOT NULL DEFAULT 1,
    alerts_sent      INTEGER      NOT NULL DEFAULT 1,
    escalations      INTEGER      NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_incident_camera ON alert_incidents(camera_id);
CREATE INDEX IF NOT EXISTS idx_incident_seen   ON alert_incidents(last_seen_at);
```

`kind` is one of `new | escalation | digest | suppressed`.

**Note:** `alert_policy.py` must be changed to load and persist through this
table. Until it is, the migration is harmless but inert.

---

## 4. PPE — per-camera detection rules

**Needed by:** the assessability gating in the violation engine

`cameras.required_ppe` (JSON) exists, but every threshold is currently global.
A gantry camera looking down a 200 m yard and a gate camera two metres from a
turnstile cannot share `min_person_px` — this is the single setting that most
affects the false-negative rate.

```sql
CREATE TABLE IF NOT EXISTS zone_rules (
    camera_id                VARCHAR(64) PRIMARY KEY
        REFERENCES cameras(id) ON DELETE CASCADE,
    min_frames               INTEGER NOT NULL DEFAULT 5,
    window_frames            INTEGER NOT NULL DEFAULT 15,
    cooldown_s               REAL    NOT NULL DEFAULT 3.0,
    min_person_px            INTEGER NOT NULL DEFAULT 64,
    min_person_frac          REAL    NOT NULL DEFAULT 0.0,
    always_assess_frac       REAL    NOT NULL DEFAULT 0.25,
    occlusion_grace_frames   INTEGER NOT NULL DEFAULT 15,
    min_evidence_conf        REAL    NOT NULL DEFAULT 0.35,
    require_band             BOOLEAN NOT NULL DEFAULT 1,
    edge_margin_px           INTEGER NOT NULL DEFAULT 4,
    updated_at               TIMESTAMP
);
```

Defaults match `ZoneRule` in `app/ml/violations.py` exactly, so a camera with no
row behaves as it does today. **Do not seed a row per camera** — absence should
mean "use defaults", so the defaults can be improved later without rewriting
every row.

`always_assess_frac` is the low-resolution escape hatch: a person filling 25% of
the frame is judged even on an analogue feed where the absolute pixel height is
below `min_person_px`.

---

## 5. Optional — DPMS join quality cache

**Only if** you commit `dpms_viewer.py` to the repo. It is currently external,
which is why the join inspector computes health client-side from a 50-row
sample.

```sql
CREATE TABLE IF NOT EXISTS dpms_join_health (
    child_table     TEXT NOT NULL,
    child_col       TEXT NOT NULL,
    parent_table    TEXT NOT NULL,
    parent_col      TEXT NOT NULL,
    match_rate      REAL,
    matched_rows    BIGINT,
    orphan_rows     BIGINT,
    null_keys       BIGINT,
    cardinality     TEXT,
    computed_at     TIMESTAMP,
    full_table_scan BOOLEAN DEFAULT 0,
    PRIMARY KEY (child_table, child_col, parent_table, parent_col)
);
```

`full_table_scan` distinguishes an exact figure from a sampled estimate. The UI
labels sampled numbers as estimates and must keep doing so.

**More important than this table:** check whether `/api/link-sample` uses an
INNER JOIN. If it does, the inspector's "Unmatched" tab will always read zero
and match rate will always show 100% — the metrics would be meaningless. It
needs a LEFT JOIN from child to parent for orphans to appear at all.

---

## 6. RESOLVED — the UUID/int question

**Answered and fixed in code. No migration needed.**

The schema is correct: primary keys really are UUID. Three independent pieces of
evidence agree — `sql/schema.sql` declares `UUID DEFAULT gen_random_uuid()`,
`models.py` mirrors it with `UUID(as_uuid=True)`, and `POST /projects` returns
`str(id)`, which is what you do for a UUID and not for an integer.

So the `int(...)` coercions were the bug, and they were fatal: the API handed
out a UUID and then rejected it on the next request. `get_schedule`, `import`,
`cpm/run`, `progress`, `delay`, `dcma` and `reports/export` failed on every call
made with an id the API itself had issued.

All 23 coercions across `app/api/routes.py` and `app/services/cpm_service.py`
are removed; ids now pass through as opaque strings and Postgres casts them,
which works whether the deployed keys are UUID or integer.

Two of those were worse than a type annoyance:

- `cpm_service._to_cpm_activities` built a dict named `code_to_uuid` and then
  coerced the value with `int(r["id"])`.
- The XER/MSP import path coerced activity ids while inserting relationships,
  so every imported schedule would have lost its logic links.

Two more were mine, from the multi-baseline work: `BaselineRef.baseline_id` and
`BaselineActivityRow.baseline_id` were annotated `int`. Now `str`, with a test
that runs the whole comparison on real UUIDs.

Nine regression tests now pin the contract (`tests/test_identifier_handling.py`)
by scanning both modules for any reintroduced coercion, so this cannot come
back silently.

---

## Not required

For completeness, work that needed **no** schema change:

| Feature | Why none needed |
|---|---|
| DCMA 14-point checker | Computed in-browser from the loaded schedule |
| Multi-baseline compare | `baselines` / `baseline_activities` already sufficient |
| XER / MSP / CSV export | Reads existing tables only |
| Working-day calendars | `calendars` already has `working_weekdays`, `holidays`, `exceptions_work` |
| Schedule constraints | `activities.constraint_type` / `constraint_date` already exist |
| Undo/redo | Client-side session state |
| Baseline Gantt overlay | Same data as the compare endpoint |
| New camera sources | `cameras.source_kwargs` is already JSON |
| Telegram alert config | Stored in `DATA_DIR/alert_config.json`, not the DB |

---

## Suggested order

1. §1 — resource capacity (unblocks the levelling UI)
2. §2 — violation event fields (already-merged code emits them)
3. §3 — alert incidents (survives restart)
4. §4 — per-camera zone rules (needed for real site tuning)
5. §5 — only if the DPMS service comes into the repo

§6 needs no action: it was a code bug, already fixed.

Each block is idempotent (`IF NOT EXISTS`) and safe to re-run. SQLite does not
support `ADD COLUMN IF NOT EXISTS`, so for §2 and §3 either check
`PRAGMA table_info(...)` first or let the `ALTER` fail harmlessly on re-run.
