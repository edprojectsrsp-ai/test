"""
report_brain.factstore — the Monthly Fact & Narrative Store.

One store, five renderers. Write a fact/narrative once; every report family
(Board Agenda, CAPEX/MoS, PMC, DO, WPR) reads from here. Backed by Postgres in
production; this module owns the DDL + a thin repository. All DDL is idempotent.

Tables
  rb_atoms          every ingested atom (audit + citation source of truth)
  rb_facts          figures per project/month/metric (SQL-derived; never AI)
  rb_narratives     composed sections per project/month/section_type, each
                    bullet carrying its source atom ids (grounding)
  rb_masters        fixed-per-project data (OCMS milestones, officials, blanks)
  rb_commitments    tracked commitments from record notes (open/met/missed)
  rb_edits          human corrections -> feed the taught-facts learning loop
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass

DDL = """
CREATE TABLE IF NOT EXISTS rb_atoms (
    id           bigserial PRIMARY KEY,
    kind         text NOT NULL,
    date         date,
    month        text,                     -- 'YYYY-MM'
    project      text,
    package      text,
    discipline   text,
    area         text,
    section_affinity text,
    text         text,
    quantities   jsonb DEFAULT '[]',
    verb_state   text,
    source_type  text,
    source_ref   text,
    author       text,
    extra        jsonb DEFAULT '{}',
    content_hash text UNIQUE,              -- idempotent ingestion
    created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rb_atoms_proj_month ON rb_atoms(project, month);
CREATE INDEX IF NOT EXISTS rb_atoms_affinity   ON rb_atoms(section_affinity);

CREATE TABLE IF NOT EXISTS rb_facts (
    id       bigserial PRIMARY KEY,
    project  text, month text, metric text,
    value    numeric, unit text, source text,   -- 'sql:capex' | 'sql:scurve'
    UNIQUE (project, month, metric)
);

CREATE TABLE IF NOT EXISTS rb_narratives (
    id           bigserial PRIMARY KEY,
    project      text, month text,
    section_type text,                    -- present_status | issues | actions | manpower
    body         jsonb NOT NULL,          -- [{"text":..,"atom_ids":[..],"discipline":..,"grounded":true}]
    status       text DEFAULT 'draft',    -- draft | reviewed | approved
    updated_at   timestamptz DEFAULT now(),
    UNIQUE (project, month, section_type)
);

CREATE TABLE IF NOT EXISTS rb_masters (
    id        bigserial PRIMARY KEY,
    project   text, key text,             -- 'ocms_milestones' | 'officials' | 'blank:ppc'
    value     jsonb NOT NULL,
    UNIQUE (project, key)
);

CREATE TABLE IF NOT EXISTS rb_commitments (
    id            bigserial PRIMARY KEY,
    project       text, activity text, committed_date date,
    source_ref    text, raised_month text,
    status        text DEFAULT 'open',    -- open | met | missed
    resolved_month text,
    UNIQUE (project, activity, committed_date)
);

CREATE TABLE IF NOT EXISTS rb_edits (
    id           bigserial PRIMARY KEY,
    project text, month text, section_type text,
    before_text text, after_text text,
    kind text,                            -- phrasing | fact | structure
    created_at timestamptz DEFAULT now()
);
"""


def get_conn():
    import psycopg2
    dsn = (os.environ.get("PROJECT_BRAIN_DB_URL") or os.environ.get("DATABASE_URL")
           or "postgresql://postgres:abc123@127.0.0.1:5432/project_brain")
    c = psycopg2.connect(dsn)
    c.autocommit = True
    return c


def ensure_schema(conn=None):
    c = conn or get_conn()
    with c.cursor() as cur:
        cur.execute(DDL)
    if conn is None:
        c.close()


# ---- lightweight in-memory store for offline dev / gold-pair test ----------
@dataclass
class MemStore:
    """Same surface as the DB repo, backed by dicts — used by the gold-pair
    test and any environment without Postgres."""
    def __post_init__(self):
        self.atoms: list[dict] = []
        self.facts: dict[tuple, dict] = {}
        self.narratives: dict[tuple, dict] = {}
        self.masters: dict[tuple, dict] = {}
        self.commitments: dict[tuple, dict] = {}

    def add_atoms(self, atoms, month: str):
        import hashlib
        for a in atoms:
            d = a.to_json() if hasattr(a, "to_json") else dict(a)
            d["month"] = month
            h = hashlib.sha1((d.get("source_ref", "") + d.get("text", "")).encode()).hexdigest()
            if any(x.get("content_hash") == h for x in self.atoms):
                continue
            d["content_hash"] = h
            self.atoms.append(d)

    def atoms_for(self, project: str, month: str, section: str | None = None):
        return [a for a in self.atoms
                if a["project"] == project and a["month"] == month
                and (section is None or a["section_affinity"] == section)]

    def put_fact(self, project, month, metric, value, unit="", source="sql"):
        self.facts[(project, month, metric)] = {"value": value, "unit": unit, "source": source}

    def put_narrative(self, project, month, section_type, body, status="draft"):
        self.narratives[(project, month, section_type)] = {"body": body, "status": status}
