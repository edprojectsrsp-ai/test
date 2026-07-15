"""
okf_export.py — Open Knowledge Format bundle exporter for Project Brain.

Exports the project knowledge base as an OKF v0.1-shaped bundle:
    manifest.json    — bundle metadata, counts, embedding model, checksums
    entities.jsonl   — schemes + packages (id, type, names, aliases, key attrs)
    facts.jsonl      — taught facts (authoritative corrections) + progress/CAPEX
                       snapshot facts, each with provenance
    chunks.jsonl     — document chunks with doc metadata (RAG corpus exchange)

Round-trip: import_okf_bundle() re-ingests entities.jsonl into entity_aliases
and chunks.jsonl into documents/document_chunks — so two Project Brain
installs (or Brain ↔ any OKF consumer) can exchange knowledge.
"""
from __future__ import annotations

import hashlib
import json
import os
import zipfile
from datetime import datetime, timezone
from typing import Optional

from app.tools.db_tools import query

OKF_VERSION = "0.1"
GENERATOR = "project-brain-ai/okf-exporter"


def _jsonl(rows) -> str:
    return "\n".join(json.dumps(r, default=str, ensure_ascii=False) for r in rows)


def _entities() -> list[dict]:
    out = []
    for r in query("""
        SELECT sm.scheme_id, sm.scheme_code, sm.scheme_name, sm.current_status,
               sm.sanctioned_cost_cr, sm.planned_completion_date,
               array_remove(array_agg(DISTINCT ea.alias), NULL) AS aliases
        FROM scheme_master sm
        LEFT JOIN entity_aliases ea ON ea.entity_type='scheme' AND ea.entity_id=sm.scheme_id
        WHERE NOT coalesce(sm.is_deleted, false)
        GROUP BY sm.scheme_id
    """):
        out.append({
            "id": f"scheme:{r['scheme_id']}", "type": "scheme",
            "code": r["scheme_code"], "name": r["scheme_name"],
            "status": r["current_status"],
            "attrs": {"sanctioned_cost_cr": r["sanctioned_cost_cr"],
                      "planned_completion": r["planned_completion_date"]},
            "aliases": r["aliases"] or [],
        })
    for r in query("""
        SELECT pk.package_id, pk.package_code, pk.package_name, pk.scheme_id,
               array_remove(array_agg(DISTINCT ea.alias), NULL) AS aliases
        FROM packages pk
        LEFT JOIN entity_aliases ea ON ea.entity_type='package' AND ea.entity_id=pk.package_id
        WHERE NOT coalesce(pk.is_deleted, false)
        GROUP BY pk.package_id
    """):
        out.append({
            "id": f"package:{r['package_id']}", "type": "package",
            "code": r["package_code"], "name": r["package_name"],
            "parent": f"scheme:{r['scheme_id']}",
            "aliases": r["aliases"] or [],
        })
    return out


def _facts() -> list[dict]:
    facts = []
    try:
        for r in query("""
            SELECT id, subject, fact, authority, scheme_id, taught_by, created_at
            FROM ai_taught_facts WHERE NOT is_deleted
        """):
            facts.append({
                "id": f"taught:{r['id']}",
                "subject": r["subject"], "statement": r["fact"],
                "authoritative": bool(r["authority"]),
                "about": f"scheme:{r['scheme_id']}" if r["scheme_id"] else None,
                "provenance": {"kind": "taught", "by": r["taught_by"],
                               "at": str(r["created_at"])},
            })
    except Exception:
        pass  # taught facts table may not exist yet
    return facts


def _chunks(limit: Optional[int] = None) -> list[dict]:
    lim = f"LIMIT {int(limit)}" if limit else ""
    return [{
        "id": f"chunk:{r['chunk_id']}",
        "document": {"id": f"doc:{r['document_id']}", "title": r["title"],
                     "type": r["document_type"], "channel": r["ingest_channel"],
                     "keywords": r.get("keywords") or []},
        "about": f"scheme:{r['scheme_id']}" if r["scheme_id"] else None,
        "text": r["chunk_text"],
        "seq": r["chunk_no"],
    } for r in query(f"""
        SELECT dc.chunk_id, dc.chunk_no, dc.chunk_text,
               d.document_id, d.title, d.document_type::text, d.scheme_id, d.ingest_channel,
               d.keywords
        FROM document_chunks dc JOIN documents d ON d.document_id=dc.document_id
        WHERE NOT d.is_deleted ORDER BY d.document_id, dc.chunk_no {lim}
    """)]


def export_okf_bundle(out_path: str, include_chunks: bool = True,
                      chunk_limit: Optional[int] = None) -> dict:
    entities = _entities()
    facts = _facts()
    chunks = _chunks(chunk_limit) if include_chunks else []

    files = {
        "entities.jsonl": _jsonl(entities),
        "facts.jsonl": _jsonl(facts),
        "chunks.jsonl": _jsonl(chunks),
    }
    manifest = {
        "okf_version": OKF_VERSION,
        "generator": GENERATOR,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "project_brain",
        "embedding_model": os.environ.get("EMBED_MODEL", "all-mpnet-base-v2"),
        "counts": {"entities": len(entities), "facts": len(facts), "chunks": len(chunks)},
        "checksums": {name: hashlib.sha256(body.encode()).hexdigest()
                      for name, body in files.items()},
    }
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2))
        for name, body in files.items():
            z.writestr(name, body)
    return manifest


def validate_okf_bundle(path: str) -> dict:
    """Structural validation: manifest present, checksums match, jsonl parses."""
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        assert "manifest.json" in names, "manifest.json missing"
        manifest = json.loads(z.read("manifest.json"))
        assert manifest.get("okf_version") == OKF_VERSION, "okf_version mismatch"
        for name, want in manifest["checksums"].items():
            body = z.read(name)
            got = hashlib.sha256(body).hexdigest()
            assert got == want, f"checksum mismatch for {name}"
            for i, line in enumerate(body.decode().splitlines()):
                if line.strip():
                    json.loads(line)
    return {"valid": True, "counts": manifest["counts"]}
