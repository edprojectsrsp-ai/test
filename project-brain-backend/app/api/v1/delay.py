"""Delay Analysis Studio API — five forensic methods, each its own process flow,
all driven by the live plan_activities baseline-vs-forecast network and a
party-attributed delay-event register.

  GET  /delay/schedule/{scheme_id}            base network (activities, as-built, rows)
  GET  /delay/events/{scheme_id}              register list
  POST /delay/events/{scheme_id}              add event
  PUT  /delay/events/{event_id}               edit event (party / days / dates)
  DELETE /delay/events/{event_id}
  POST /delay/events/{scheme_id}/autopopulate seed register from baseline→forecast slips

  GET  /delay/apab/{scheme_id}                As-Planned vs As-Built
  GET  /delay/iap/{scheme_id}                 Impacted As-Planned (additive)
  GET  /delay/collapsed/{scheme_id}           Collapsed As-Built (but-for)
  GET  /delay/windows/{scheme_id}?windows=N   Window / contemporaneous
  POST /delay/tia/{scheme_id}                 Time Impact Analysis (fragnet @ data date)
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.security.auth import require_user
from app.services import delay_analysis as D

# Sprint 0 — all delay routes require a valid JWT (or PB_AUTH_ENFORCE=0 soft mode).
router = APIRouter(
    prefix="/delay",
    tags=["Delay Analysis"],
    dependencies=[Depends(require_user)],
)

VALID_PARTIES = {"employer", "contractor", "neutral"}


# ─────────────────────────── register table ─────────────────────────────────

def _ensure_table(db):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS delay_events (
            event_id SERIAL PRIMARY KEY,
            scheme_id INTEGER NOT NULL,
            activity_id INTEGER,
            name TEXT NOT NULL,
            party TEXT NOT NULL DEFAULT 'neutral',
            delay_days REAL NOT NULL DEFAULT 0,
            at_date DATE,
            description TEXT DEFAULT '',
            source TEXT NOT NULL DEFAULT 'manual',
            is_excusable BOOLEAN NOT NULL DEFAULT TRUE,
            is_compensable BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    # Sprint 3 — evidence-linked KG attribution (idempotent ALTERs)
    for col_sql in (
        "ALTER TABLE delay_events ADD COLUMN IF NOT EXISTS evidence_document_id INTEGER",
        "ALTER TABLE delay_events ADD COLUMN IF NOT EXISTS evidence_chunk_id INTEGER",
        "ALTER TABLE delay_events ADD COLUMN IF NOT EXISTS kg_edge_id INTEGER",
        "ALTER TABLE delay_events ADD COLUMN IF NOT EXISTS evidence_quote TEXT DEFAULT ''",
        "ALTER TABLE delay_events ADD COLUMN IF NOT EXISTS party_suggested TEXT",
        "ALTER TABLE delay_events ADD COLUMN IF NOT EXISTS cause_label TEXT DEFAULT ''",
    ):
        try:
            db.execute(text(col_sql))
        except Exception:
            pass
    db.commit()


def _to_date(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _load_events(db, scheme_id):
    _ensure_table(db)
    return [dict(r) for r in db.execute(text("""
        SELECT event_id, scheme_id, activity_id, name, party, delay_days,
               at_date, description, source, is_excusable, is_compensable,
               evidence_document_id, evidence_chunk_id, kg_edge_id,
               evidence_quote, party_suggested, cause_label
        FROM delay_events WHERE scheme_id = :sid
        ORDER BY at_date NULLS LAST, event_id
    """), {"sid": scheme_id}).mappings().all()]


def _suggest_party(cause: str) -> str:
    t = (cause or "").lower()
    employer_kw = (
        "drawing", "approval", "sanction", "handover", "site access", "design",
        "authority", "department", "client", "employer", "owner", "rsp", "land",
        "permission", "clearance", "payment delay", "fund",
    )
    contractor_kw = (
        "labour", "labor", "manpower", "material", "equipment", "contractor",
        "vendor", "supply", "fabrication", "erection", "mobilisation", "mobilization",
        "workforce", "subcontractor", "plant breakdown", "machinery",
    )
    if any(k in t for k in employer_kw):
        return "employer"
    if any(k in t for k in contractor_kw):
        return "contractor"
    return "neutral"


def _match_activity(model, cause: str, target_label: str):
    """Best-effort activity_id from cause/target text vs schedule names."""
    hay = f"{cause} {target_label}".lower()
    best_aid, best_score = None, 0
    for r in model.get("rows") or []:
        name = (r.get("name") or "").lower()
        if not name:
            continue
        score = 0
        for tok in name.replace("-", " ").split():
            if len(tok) >= 4 and tok in hay:
                score += len(tok)
        if name in hay:
            score += 20
        if score > best_score:
            best_score, best_aid = score, int(r["aid"]) if str(r["aid"]).isdigit() else None
    return best_aid if best_score >= 6 else None


def _kg_tables_exist(db) -> bool:
    row = db.execute(text("""
        SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('kg_nodes', 'kg_edges')
    """)).mappings().first()
    return bool(row and int(row["n"] or 0) >= 2)


def _kg_delay_edges(db, scheme_id: int) -> list[dict]:
    """caused_delay edges linked to this scheme (directly or via package/document)."""
    if not _kg_tables_exist(db):
        return []
    # scheme node + package nodes under scheme + documents about them
    return [dict(r) for r in db.execute(text("""
        WITH scheme_nodes AS (
            SELECT node_id FROM kg_nodes
            WHERE node_type = 'scheme' AND ref_id = :sid
        ),
        package_nodes AS (
            SELECT n.node_id
            FROM kg_nodes n
            JOIN packages p ON p.package_id = n.ref_id AND n.node_type = 'package'
            WHERE p.scheme_id = :sid AND NOT coalesce(p.is_deleted, false)
        ),
        related AS (
            SELECT node_id FROM scheme_nodes
            UNION SELECT node_id FROM package_nodes
            UNION
            SELECT e.src_id FROM kg_edges e
            WHERE e.relation IN ('about', 'mentioned_in', 'has_package')
              AND (e.dst_id IN (SELECT node_id FROM scheme_nodes)
                   OR e.dst_id IN (SELECT node_id FROM package_nodes)
                   OR e.src_id IN (SELECT node_id FROM scheme_nodes)
                   OR e.src_id IN (SELECT node_id FROM package_nodes))
            UNION
            SELECT e.dst_id FROM kg_edges e
            WHERE e.relation IN ('about', 'mentioned_in', 'has_package')
              AND (e.dst_id IN (SELECT node_id FROM scheme_nodes)
                   OR e.dst_id IN (SELECT node_id FROM package_nodes)
                   OR e.src_id IN (SELECT node_id FROM scheme_nodes)
                   OR e.src_id IN (SELECT node_id FROM package_nodes))
        )
        SELECT DISTINCT ON (e.src_id, e.dst_id, coalesce(e.evidence_chunk_id, 0))
               e.edge_id AS kg_edge_id,
               e.relation,
               e.weight,
               e.evidence_document_id,
               e.evidence_chunk_id,
               e.props,
               ns.label AS cause_label,
               ns.node_type AS cause_type,
               nd.label AS target_label,
               nd.node_type AS target_type,
               nd.ref_id AS target_ref_id,
               d.title AS document_title,
               LEFT(dc.chunk_text, 400) AS chunk_preview
        FROM kg_edges e
        JOIN kg_nodes ns ON ns.node_id = e.src_id
        JOIN kg_nodes nd ON nd.node_id = e.dst_id
        LEFT JOIN documents d ON d.document_id = e.evidence_document_id
        LEFT JOIN document_chunks dc ON dc.chunk_id = e.evidence_chunk_id
        WHERE e.relation = 'caused_delay'
          AND (e.src_id IN (SELECT node_id FROM related)
               OR e.dst_id IN (SELECT node_id FROM related)
               OR e.evidence_document_id IN (
                    SELECT DISTINCT evidence_document_id FROM kg_edges
                    WHERE relation IN ('mentioned_in', 'about')
                      AND (src_id IN (SELECT node_id FROM related)
                           OR dst_id IN (SELECT node_id FROM related))
                      AND evidence_document_id IS NOT NULL
               ))
        ORDER BY e.src_id, e.dst_id, coalesce(e.evidence_chunk_id, 0), e.weight DESC
        LIMIT 80
    """), {"sid": scheme_id}).mappings().all()]


def _engine_events(db_events, model):
    """Convert register rows → engine events (day-indexed, activity_id as str).
    Events whose activity isn't in the current network are dropped."""
    origin = _to_date(model["meta"]["origin"])
    valid = {a["id"] for a in model["activities"]}
    finish_by_aid = {r["aid"]: r["plannedFinishDay"] for r in model["rows"]}
    out = []
    for e in db_events:
        aid = str(e["activity_id"]) if e["activity_id"] is not None else None
        if aid not in valid:
            continue
        at = _to_date(e["at_date"])
        at_day = (at - origin).days if (at and origin) else finish_by_aid.get(aid, 0)
        out.append({
            "id": f"E{e['event_id']}", "eventId": e["event_id"],
            "name": e["name"], "party": e["party"] if e["party"] in VALID_PARTIES else "neutral",
            "activityId": aid, "days": float(e["delay_days"] or 0), "atDay": at_day,
            "isExcusable": bool(e["is_excusable"]), "isCompensable": bool(e["is_compensable"]),
        })
    return out


def _build(db, scheme_id, package_id):
    model = D.build_schedule_model(db, scheme_id, package_id)
    if not model["activities"]:
        raise HTTPException(status_code=404,
                            detail="No baseline-dated activities for this scheme/package. "
                                   "Lock a plan with planned start/finish dates first.")
    return model


def _activity_names(model):
    return {a["id"]: a["name"] for a in model["activities"]}


def _default_boundaries(model, n_windows):
    finish = max((r["abFinishDay"] for r in model["rows"]), default=0)
    n = max(1, n_windows)
    step = finish / n if n else finish
    bounds = [round(step * i) for i in range(n)] + [finish + 1]
    return sorted(set(bounds))


# ─────────────────────────── base network ───────────────────────────────────

@router.get("/schedule/{scheme_id}")
def schedule(scheme_id: int, package_id: Optional[int] = None, db: Session = Depends(get_db)):
    model = _build(db, scheme_id, package_id)
    events = _engine_events(_load_events(db, scheme_id), model)
    apab = D.as_planned_vs_as_built(model["activities"], model["asBuilt"], model["startFloor"])
    by_aid = {r["aid"]: r for r in model["rows"]}
    # a sensible TIA default: the baseline completion driver (activity with the
    # latest baseline finish), so a fragnet on it actually bites project finish
    suggested = (max(model["rows"], key=lambda r: r["plannedFinishDay"])["aid"]
                 if model["rows"] else None)
    return {
        "schemeId": scheme_id, "packageId": package_id,
        "meta": model["meta"],
        "activities": model["activities"],
        "asBuilt": model["asBuilt"],
        "startFloor": model["startFloor"],
        "rows": model["rows"],
        "events": events,
        "windowBoundaries": _default_boundaries(model, 4),
        "drivingChain": apab["drivingChain"],
        "projectSlip": apab["projectSlip"],
        "suggestedTiaActivity": suggested,
        "suggestedTiaDataDate": by_aid.get(suggested, {}).get("plannedStartDay") if suggested else None,
    }


# ─────────────────────────── register CRUD ──────────────────────────────────

class EventIn(BaseModel):
    activity_id: Optional[int] = None
    name: str
    party: str = "neutral"
    delay_days: float = 0
    at_date: Optional[str] = None
    description: Optional[str] = ""
    is_excusable: bool = True
    is_compensable: bool = False


@router.get("/events/{scheme_id}")
def list_events(scheme_id: int, db: Session = Depends(get_db)):
    return {"events": _load_events(db, scheme_id)}


@router.post("/events/{scheme_id}")
def add_event(scheme_id: int, payload: EventIn, db: Session = Depends(get_db)):
    _ensure_table(db)
    party = payload.party if payload.party in VALID_PARTIES else "neutral"
    row = db.execute(text("""
        INSERT INTO delay_events (scheme_id, activity_id, name, party, delay_days,
                                  at_date, description, source, is_excusable, is_compensable)
        VALUES (:sid, :aid, :name, :party, :days, :at, :desc, 'manual', :exc, :comp)
        RETURNING event_id
    """), {"sid": scheme_id, "aid": payload.activity_id, "name": payload.name,
           "party": party, "days": payload.delay_days, "at": _to_date(payload.at_date),
           "desc": payload.description or "", "exc": payload.is_excusable,
           "comp": payload.is_compensable}).mappings().first()
    db.commit()
    return {"ok": True, "event_id": row["event_id"]}


@router.put("/events/{event_id}")
def update_event(event_id: int, payload: EventIn, db: Session = Depends(get_db)):
    _ensure_table(db)
    party = payload.party if payload.party in VALID_PARTIES else "neutral"
    res = db.execute(text("""
        UPDATE delay_events SET activity_id=:aid, name=:name, party=:party,
               delay_days=:days, at_date=:at, description=:desc,
               is_excusable=:exc, is_compensable=:comp, updated_at=CURRENT_TIMESTAMP
        WHERE event_id=:eid
    """), {"eid": event_id, "aid": payload.activity_id, "name": payload.name,
           "party": party, "days": payload.delay_days, "at": _to_date(payload.at_date),
           "desc": payload.description or "", "exc": payload.is_excusable,
           "comp": payload.is_compensable})
    db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="event not found")
    return {"ok": True}


@router.delete("/events/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    _ensure_table(db)
    db.execute(text("DELETE FROM delay_events WHERE event_id=:eid"), {"eid": event_id})
    db.commit()
    return {"ok": True}


@router.get("/kg-suggestions/{scheme_id}")
def kg_suggestions(scheme_id: int, package_id: Optional[int] = None,
                   db: Session = Depends(get_db)):
    """Preview caused_delay edges that can seed the event register (Sprint 3)."""
    _ensure_table(db)
    edges = _kg_delay_edges(db, scheme_id)
    model = None
    try:
        model = D.build_schedule_model(db, scheme_id, package_id)
    except Exception:
        model = {"rows": []}

    suggestions = []
    for e in edges:
        props = e.get("props") or {}
        if isinstance(props, str):
            try:
                import json
                props = json.loads(props)
            except Exception:
                props = {}
        quote = (props.get("quote") if isinstance(props, dict) else None) or e.get("chunk_preview") or ""
        cause = e.get("cause_label") or "unknown cause"
        party = _suggest_party(f"{cause} {quote}")
        aid = _match_activity(model, cause, e.get("target_label") or "")
        suggestions.append({
            "kg_edge_id": e.get("kg_edge_id"),
            "cause_label": cause,
            "target_label": e.get("target_label"),
            "party_suggested": party,
            "activity_id": aid,
            "evidence_document_id": e.get("evidence_document_id"),
            "evidence_chunk_id": e.get("evidence_chunk_id"),
            "document_title": e.get("document_title"),
            "evidence_quote": (quote or "")[:280],
            "weight": float(e.get("weight") or 1),
        })
    return {
        "scheme_id": scheme_id,
        "kg_available": _kg_tables_exist(db),
        "count": len(suggestions),
        "suggestions": suggestions,
    }


@router.post("/events/{scheme_id}/from-kg")
def seed_from_kg(scheme_id: int, package_id: Optional[int] = None,
                 replace: bool = Query(True, description="Replace prior kg_delay rows"),
                 db: Session = Depends(get_db)):
    """Seed the delay-event register from knowledge-graph caused_delay edges
    with document evidence. Party is auto-suggested; analyst can override.
    Source tag: kg_delay. Manual and autoslip rows are kept."""
    _ensure_table(db)
    if not _kg_tables_exist(db):
        raise HTTPException(
            404,
            "Knowledge graph tables not found. Run AI graph sync first "
            "(POST /ai/graph/sync on the AI service).",
        )
    edges = _kg_delay_edges(db, scheme_id)
    if not edges:
        return {
            "ok": True, "created": 0, "source": "kg_delay",
            "note": "No caused_delay edges linked to this scheme. "
                    "Ingest correspondence and run graph sync/text mining.",
        }

    try:
        model = D.build_schedule_model(db, scheme_id, package_id)
    except Exception:
        model = {"rows": []}

    if replace:
        db.execute(text(
            "DELETE FROM delay_events WHERE scheme_id=:sid AND source='kg_delay'"
        ), {"sid": scheme_id})

    # avoid exact duplicate kg_edge_ids if not replacing
    existing = set()
    if not replace:
        existing = {
            r["kg_edge_id"]
            for r in db.execute(text(
                "SELECT kg_edge_id FROM delay_events "
                "WHERE scheme_id=:sid AND kg_edge_id IS NOT NULL"
            ), {"sid": scheme_id}).mappings().all()
        }

    created = 0
    for e in edges:
        eid = e.get("kg_edge_id")
        if eid in existing:
            continue
        props = e.get("props") or {}
        if isinstance(props, str):
            try:
                import json
                props = json.loads(props)
            except Exception:
                props = {}
        quote = (props.get("quote") if isinstance(props, dict) else None) or e.get("chunk_preview") or ""
        cause = (e.get("cause_label") or "delay cause").strip()
        party = _suggest_party(f"{cause} {quote}")
        aid = _match_activity(model, cause, e.get("target_label") or "")
        # default delay days: prefer matched activity slip, else 7 placeholder
        days = 7.0
        if aid is not None:
            for r in model.get("rows") or []:
                if str(r.get("aid")) == str(aid) and r.get("slipDays"):
                    days = float(r["slipDays"])
                    break
        name = f"KG: {cause[:80]}"
        desc = (
            f"Attributed from correspondence · target: {e.get('target_label') or '—'} · "
            f"doc: {e.get('document_title') or e.get('evidence_document_id') or '—'} · "
            f"quote: {(quote or '')[:180]}"
        )
        db.execute(text("""
            INSERT INTO delay_events (
                scheme_id, activity_id, name, party, delay_days, at_date,
                description, source, is_excusable, is_compensable,
                evidence_document_id, evidence_chunk_id, kg_edge_id,
                evidence_quote, party_suggested, cause_label
            ) VALUES (
                :sid, :aid, :name, :party, :days, CURRENT_DATE,
                :desc, 'kg_delay', TRUE, :comp,
                :doc, :chunk, :edge, :quote, :psug, :cause
            )
        """), {
            "sid": scheme_id, "aid": aid, "name": name, "party": party,
            "days": days, "desc": desc,
            "comp": party == "employer",
            "doc": e.get("evidence_document_id"),
            "chunk": e.get("evidence_chunk_id"),
            "edge": eid, "quote": (quote or "")[:500],
            "psug": party, "cause": cause[:120],
        })
        created += 1
    db.commit()
    return {
        "ok": True, "created": created, "source": "kg_delay",
        "suggested": created,
        "note": "Party auto-suggested from cause language; override in register.",
    }


@router.get("/evidence/{event_id}")
def event_evidence(event_id: int, db: Session = Depends(get_db)):
    """Full evidence drawer payload for a register row (quote + doc meta)."""
    _ensure_table(db)
    row = db.execute(text("""
        SELECT event_id, scheme_id, name, party, party_suggested, cause_label,
               evidence_document_id, evidence_chunk_id, kg_edge_id, evidence_quote,
               description, source, delay_days, activity_id
        FROM delay_events WHERE event_id = :eid
    """), {"eid": event_id}).mappings().first()
    if not row:
        raise HTTPException(404, "event not found")
    out = dict(row)
    if row.get("evidence_document_id"):
        try:
            doc = db.execute(text("""
                SELECT document_id, title, source_filename, created_at
                FROM documents WHERE document_id = :d
            """), {"d": row["evidence_document_id"]}).mappings().first()
            out["document"] = dict(doc) if doc else None
        except Exception:
            out["document"] = None
    if row.get("evidence_chunk_id") and not out.get("evidence_quote"):
        try:
            ch = db.execute(text("""
                SELECT chunk_text FROM document_chunks WHERE chunk_id = :c
            """), {"c": row["evidence_chunk_id"]}).mappings().first()
            if ch:
                out["evidence_quote"] = (ch.get("chunk_text") or "")[:500]
        except Exception:
            pass
    return out


@router.post("/events/{scheme_id}/autopopulate")
def autopopulate(scheme_id: int, package_id: Optional[int] = None,
                 scope: str = Query("driving", pattern="^(driving|all)$"),
                 db: Session = Depends(get_db)):
    """Seed the register from the baseline→forecast slips. Default scope
    'driving' seeds only the activities on the as-built driving chain (the ones
    that actually controlled completion) — forensically the right root-cause set,
    and it keeps the additive methods from double-counting concurrent slips.
    scope='all' seeds every slipped activity. Party is left 'neutral' for the
    analyst to attribute. Replaces prior auto-slip rows; manual rows kept."""
    _ensure_table(db)
    model = _build(db, scheme_id, package_id)
    db.execute(text("DELETE FROM delay_events WHERE scheme_id=:sid AND source='autoslip'"),
               {"sid": scheme_id})
    driving = set()
    if scope == "driving":
        apab = D.as_planned_vs_as_built(model["activities"], model["asBuilt"], model["startFloor"])
        driving = set(apab["drivingChain"])
    created = 0
    for r in model["rows"]:
        if not (r["slipDays"] and r["slipDays"] > 0):
            continue
        if scope == "driving" and r["aid"] not in driving:
            continue
        db.execute(text("""
            INSERT INTO delay_events (scheme_id, activity_id, name, party, delay_days,
                                      at_date, description, source)
            VALUES (:sid, :aid, :name, 'neutral', :days, :at, :desc, 'autoslip')
        """), {"sid": scheme_id, "aid": int(r["aid"]),
               "name": f"Forecast slip — {r['name']}",
               "days": r["slipDays"], "at": r["plannedFinishDate"],
               "desc": f"Baseline finish {r['plannedFinishDate']} → forecast {r['expectedFinishDate']} "
                       f"({r['slipDays']}d). Attribute party."})
        created += 1
    # if the driving chain carried no slip, fall back to the single worst slip
    if created == 0:
        worst = max((r for r in model["rows"] if r["slipDays"] > 0),
                    key=lambda r: r["slipDays"], default=None)
        if worst:
            db.execute(text("""
                INSERT INTO delay_events (scheme_id, activity_id, name, party, delay_days,
                                          at_date, description, source)
                VALUES (:sid, :aid, :name, 'neutral', :days, :at, :desc, 'autoslip')
            """), {"sid": scheme_id, "aid": int(worst["aid"]),
                   "name": f"Forecast slip — {worst['name']}", "days": worst["slipDays"],
                   "at": worst["plannedFinishDate"], "desc": "Largest forecast slip."})
            created = 1
    db.commit()
    return {"ok": True, "created": created, "scope": scope}


# ─────────────────────────── the five methods ───────────────────────────────

@router.get("/apab/{scheme_id}")
def apab(scheme_id: int, package_id: Optional[int] = None, db: Session = Depends(get_db)):
    model = _build(db, scheme_id, package_id)
    result = D.as_planned_vs_as_built(model["activities"], model["asBuilt"], model["startFloor"])
    return {"result": result, "activityNames": _activity_names(model),
            "unit": model["meta"]["unit"], "origin": model["meta"]["origin"]}


@router.get("/iap/{scheme_id}")
def iap(scheme_id: int, package_id: Optional[int] = None, db: Session = Depends(get_db)):
    model = _build(db, scheme_id, package_id)
    events = _engine_events(_load_events(db, scheme_id), model)
    if not events:
        raise HTTPException(status_code=400,
                            detail="No delay events. Auto-populate or add events first.")
    result = D.impacted_as_planned(model["activities"], events, model["startFloor"])
    return {"result": result, "activityNames": _activity_names(model),
            "eventCount": len(events), "unit": model["meta"]["unit"]}


@router.get("/collapsed/{scheme_id}")
def collapsed(scheme_id: int, package_id: Optional[int] = None, db: Session = Depends(get_db)):
    model = _build(db, scheme_id, package_id)
    events = _engine_events(_load_events(db, scheme_id), model)
    if not events:
        raise HTTPException(status_code=400,
                            detail="No delay events. Auto-populate or add events first.")
    result = D.collapsed_as_built(model["activities"], model["asBuilt"], events, model["startFloor"])
    return {"result": result, "activityNames": _activity_names(model),
            "eventCount": len(events), "unit": model["meta"]["unit"]}


@router.get("/windows/{scheme_id}")
def windows(scheme_id: int, package_id: Optional[int] = None,
            windows: int = Query(4, ge=1, le=12), db: Session = Depends(get_db)):
    model = _build(db, scheme_id, package_id)
    events = _engine_events(_load_events(db, scheme_id), model)
    bounds = _default_boundaries(model, windows)
    result = D.window_analysis(model["activities"], model["asBuilt"], events, bounds, model["startFloor"])
    return {"result": result, "activityNames": _activity_names(model),
            "boundaries": bounds, "eventCount": len(events), "unit": model["meta"]["unit"]}


class TiaIn(BaseModel):
    data_date_day: Optional[int] = None        # project-day of the data date
    activity_id: int
    name: str = "Fragnet"
    party: str = "employer"
    days: float = 0


@router.post("/tia/{scheme_id}")
def tia(scheme_id: int, payload: TiaIn, package_id: Optional[int] = None,
        db: Session = Depends(get_db)):
    model = _build(db, scheme_id, package_id)
    valid = {a["id"] for a in model["activities"]}
    aid = str(payload.activity_id)
    if aid not in valid:
        # fall back to the baseline completion driver so the fragnet lands on the
        # activity that controls project finish rather than one with float
        aid = (max(model["rows"], key=lambda r: r["plannedFinishDay"])["aid"]
               if model["rows"] else None)
        if aid is None:
            raise HTTPException(status_code=400, detail="no activities in network")
    by_aid = {r["aid"]: r for r in model["rows"]}
    data_date = payload.data_date_day
    if data_date is None:
        # status just as the fragnet activity begins, so its extension bites
        data_date = by_aid.get(aid, {}).get("plannedStartDay")
        if data_date is None:
            data_date = round(max((r["abFinishDay"] for r in model["rows"]), default=0) / 2)
    fragnet = {"id": "FRAG", "name": payload.name,
               "party": payload.party if payload.party in VALID_PARTIES else "employer",
               "activityId": aid, "days": float(payload.days), "atDay": data_date}
    result = D.time_impact_analysis(model["activities"], model["asBuilt"],
                                    fragnet, data_date, model["startFloor"])
    return {"result": result, "activityNames": _activity_names(model),
            "dataDateDay": data_date, "unit": model["meta"]["unit"]}
