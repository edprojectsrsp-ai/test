"""
retrieval.py — hybrid retrieval + fuzzy entity brain for Project Brain AI.

Three capabilities:
  1. resolve_entities(query)   — "con-7", "cob7", "coke oven 7" → COB-7 (scheme 74)
                                 with confidence + did-you-mean suggestions.
  2. hybrid_search(...)        — RRF fusion of three arms over document_chunks:
                                   a) pgvector cosine (only same embedding_model)
                                   b) Postgres FTS (websearch_to_tsquery)
                                   c) pg_trgm similarity
                                 Any arm can be empty; fusion degrades gracefully.
  3. normalize_query(query)    — deterministic cleanup of broken queries before
                                 the LLM sees them (whitespace, joined codes,
                                 common shorthand), never destructive.

All SQL parameterized. Read path uses db_tools.query (read-only connection).
"""
from __future__ import annotations

import re
from typing import Any, Optional

from app.tools.db_tools import query, _require_tables

RRF_K = 60           # standard reciprocal-rank-fusion constant
ARM_LIMIT = 20       # candidates fetched per arm before fusion
TRGM_MIN_SIM = 0.18  # floor for trigram arm

# ---------------------------------------------------------------------------
# Query normalization (deterministic — safe on any input)
# ---------------------------------------------------------------------------

_SHORTHAND = {
    r"\bphy\b": "physical",
    r"\bfin\b": "financial",
    r"\bprog\b": "progress",
    r"\bcompl\b": "completion",
    r"\bexp\b": "expenditure",
    r"\bappx\b": "appendix",
    r"\blst\b": "last",
    r"\bmnth\b": "month",
    r"\bwht\b": "what",
    r"\bpls\b": "please",
}


def normalize_query(q: str) -> str:
    """Light, lossless-in-spirit cleanup: collapse whitespace, split glued
    code+word ('cob7progress' → 'cob7 progress'), expand common shorthand.
    Original casing of code-like tokens preserved for the resolver."""
    s = re.sub(r"\s+", " ", (q or "").strip())
    # split letter-digit-letter gluing around code-like tokens: cob7progress
    s = re.sub(r"([a-zA-Z]{2,}\d{1,3})(?=[a-zA-Z]{3,})", r"\1 ", s)
    low = s
    for pat, rep in _SHORTHAND.items():
        low = re.sub(pat, rep, low, flags=re.IGNORECASE)
    return low


# ---------------------------------------------------------------------------
# Entity resolution (fuzzy, multi-strategy)
# ---------------------------------------------------------------------------

_CODE_TOKEN = re.compile(r"\b([a-zA-Z]{2,8})[\s\-_#]?(\d{1,3})\b")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def resolve_entities(question: str, limit: int = 5) -> dict:
    """Resolve scheme/package references in free text.

    Strategy per candidate token (and the full question):
      1. exact alias_norm match                          → confidence 1.0
      2. code-shape match: same trailing number, fuzzy prefix
         ('con-7' → 'cob7': number 7 equal, 'con'~'cob') → trigram-scored
      3. whole-phrase trigram against aliases             → trigram-scored
    Returns {"resolved":[...], "suggestions":[...], "ambiguous": bool}.
    resolved = confident (>=0.55 or exact); suggestions = did-you-mean list.
    """
    guard = _require_tables("entity_aliases")
    if guard:
        return {"resolved": [], "suggestions": [], "error": guard["error"]}

    q = normalize_query(question)
    candidates: dict[tuple[str, int], dict] = {}

    def consider(rows, base: float = 0.0):
        for r in rows:
            key = (r["entity_type"], r["entity_id"])
            score = max(base, float(r.get("sim") or 0))
            prev = candidates.get(key)
            if not prev or score > prev["confidence"]:
                candidates[key] = {
                    "entity_type": r["entity_type"],
                    "entity_id": r["entity_id"],
                    "canonical": r["canonical"],
                    "matched_alias": r["alias"],
                    "confidence": round(score, 3),
                }

    canonical_join = """
        LEFT JOIN scheme_master sm ON ea.entity_type='scheme'  AND sm.scheme_id  = ea.entity_id
        LEFT JOIN packages     pk ON ea.entity_type='package' AND pk.package_id = ea.entity_id
    """
    canonical_col = "coalesce(sm.scheme_code || ' — ' || sm.scheme_name, pk.package_code || ' — ' || pk.package_name, ea.alias) AS canonical"

    # -- 1. exact normalized alias on every code-shaped token + full question
    tokens = [m.group(0) for m in _CODE_TOKEN.finditer(q)] + [q]
    for tok in tokens:
        rows = query(f"""
            SELECT ea.entity_type, ea.entity_id, ea.alias, 1.0 AS sim, {canonical_col}
            FROM entity_aliases ea {canonical_join}
            WHERE ea.alias_norm = %s
            LIMIT %s
        """, (_norm(tok), limit))
        consider(rows, base=1.0)

    # -- 2. code-shape fuzzy: same number, similar letter prefix (con-7 → cob-7)
    for m in _CODE_TOKEN.finditer(q):
        prefix, number = m.group(1), m.group(2)
        rows = query(f"""
            SELECT ea.entity_type, ea.entity_id, ea.alias,
                   similarity(lower(%s), lower(regexp_replace(ea.alias, '[^a-zA-Z]', '', 'g'))) AS sim,
                   {canonical_col}
            FROM entity_aliases ea {canonical_join}
            WHERE ea.alias_norm ~ ('[a-z]+' || %s || '$')
              AND similarity(lower(%s), lower(regexp_replace(ea.alias, '[^a-zA-Z]', '', 'g'))) > 0.25
            ORDER BY sim DESC
            LIMIT %s
        """, (prefix, number, prefix, limit))
        consider(rows)

    # -- 3. whole-phrase trigram
    rows = query(f"""
        SELECT ea.entity_type, ea.entity_id, ea.alias,
               similarity(lower(%s), lower(ea.alias)) AS sim, {canonical_col}
        FROM entity_aliases ea {canonical_join}
        WHERE similarity(lower(%s), lower(ea.alias)) > %s
        ORDER BY sim DESC
        LIMIT %s
    """, (q, q, TRGM_MIN_SIM, limit))
    consider(rows)

    ranked = sorted(candidates.values(), key=lambda c: -c["confidence"])
    resolved = [c for c in ranked if c["confidence"] >= 0.55][:limit]
    suggestions = [c for c in ranked if 0.20 <= c["confidence"] < 0.55][:limit]
    return {
        "resolved": resolved,
        "suggestions": suggestions,
        "ambiguous": len(resolved) == 0 and len(suggestions) > 0,
    }


# ---------------------------------------------------------------------------
# Hybrid search with Reciprocal Rank Fusion
# ---------------------------------------------------------------------------

def _kw_cond(conds: list, params: list, keyword: Optional[str]):
    if keyword:
        conds.append("EXISTS (SELECT 1 FROM unnest(d.keywords) kx WHERE kx ILIKE %s)")
        params.append(keyword)


def _arm_vector(qvec: list[float], scheme_id: Optional[int], model: str,
                keyword: Optional[str] = None) -> list[dict]:
    conds = ["NOT d.is_deleted", "de.embedding_model = %s"]
    params: list[Any] = [str(qvec), model]
    if scheme_id is not None:
        conds.append("d.scheme_id = %s"); params.append(scheme_id)
    _kw_cond(conds, params, keyword)
    params_full = [str(qvec)] + params[1:] + [str(qvec), ARM_LIMIT]
    return query(f"""
        SELECT dc.chunk_id, (1 - (de.embedding <=> %s::vector)) AS score
        FROM document_embeddings de
        JOIN document_chunks dc ON dc.chunk_id = de.chunk_id
        JOIN documents d ON d.document_id = dc.document_id
        WHERE {' AND '.join(conds)}
        ORDER BY de.embedding <=> %s::vector
        LIMIT %s
    """, tuple(params_full))


def _arm_fts(qtext: str, scheme_id: Optional[int],
             keyword: Optional[str] = None) -> list[dict]:
    conds = ["NOT d.is_deleted", "dc.chunk_tsv @@ websearch_to_tsquery('english', %s)"]
    params: list[Any] = [qtext, qtext]  # SELECT ts_rank(%s), WHERE tsquery(%s)
    if scheme_id is not None:
        conds.append("d.scheme_id = %s"); params.append(scheme_id)
    _kw_cond(conds, params, keyword)
    params.append(ARM_LIMIT)
    return query(f"""
        SELECT dc.chunk_id, ts_rank(dc.chunk_tsv, websearch_to_tsquery('english', %s)) AS score
        FROM document_chunks dc
        JOIN documents d ON d.document_id = dc.document_id
        WHERE {' AND '.join(conds)}
        ORDER BY score DESC
        LIMIT %s
    """, tuple(params))


def _arm_trgm(qtext: str, scheme_id: Optional[int],
              keyword: Optional[str] = None) -> list[dict]:
    """word_similarity, not similarity: a short query against a long chunk
    should score by the best-matching span, not whole-string overlap."""
    conds = ["NOT d.is_deleted", "word_similarity(%s, dc.chunk_text) > %s"]
    params: list[Any] = [qtext, qtext, 0.30]
    if scheme_id is not None:
        conds.append("d.scheme_id = %s"); params.append(scheme_id)
    _kw_cond(conds, params, keyword)
    params.append(ARM_LIMIT)
    return query(f"""
        SELECT dc.chunk_id, word_similarity(%s, dc.chunk_text) AS score
        FROM document_chunks dc
        JOIN documents d ON d.document_id = dc.document_id
        WHERE {' AND '.join(conds)}
        ORDER BY score DESC
        LIMIT %s
    """, tuple(params))


def rrf_fuse(arms: dict[str, list[dict]], k: int = RRF_K) -> list[dict]:
    """Reciprocal Rank Fusion: score(chunk) = Σ_arm 1/(k + rank_in_arm)."""
    fused: dict[int, dict] = {}
    for arm_name, rows in arms.items():
        for rank, r in enumerate(rows, start=1):
            cid = r["chunk_id"]
            entry = fused.setdefault(cid, {"chunk_id": cid, "rrf": 0.0, "arms": {}})
            entry["rrf"] += 1.0 / (k + rank)
            entry["arms"][arm_name] = {"rank": rank, "score": round(float(r["score"]), 4)}
    return sorted(fused.values(), key=lambda e: -e["rrf"])


def hybrid_search(
    qtext: str,
    scheme_id: Optional[int] = None,
    limit: int = 6,
    qvec: Optional[list[float]] = None,
    embedding_model: Optional[str] = None,
    keyword: Optional[str] = None,
) -> dict:
    """Fuse vector + FTS + trigram over document chunks. qvec optional —
    without it (embedder offline) FTS+trigram still work."""
    guard = _require_tables("documents", "document_chunks")
    if guard:
        return guard

    qn = normalize_query(qtext)
    arms: dict[str, list[dict]] = {}
    if qvec is not None and embedding_model:
        try:
            arms["vector"] = _arm_vector(qvec, scheme_id, embedding_model, keyword)
        except Exception:
            arms["vector"] = []
    try:
        arms["fts"] = _arm_fts(qn, scheme_id, keyword)
    except Exception:
        arms["fts"] = []
    try:
        arms["trgm"] = _arm_trgm(qn, scheme_id, keyword)
    except Exception:
        arms["trgm"] = []

    fused = rrf_fuse(arms)[:limit]
    if not fused:
        return {"chunks": [], "arms_used": list(arms.keys())}

    ids = [f["chunk_id"] for f in fused]
    rows = query("""
        SELECT dc.chunk_id, dc.chunk_text, dc.page_number,
               d.document_id, d.title, d.document_type::text, d.scheme_id, d.package_id,
               d.ingest_channel, d.keywords
        FROM document_chunks dc
        JOIN documents d ON d.document_id = dc.document_id
        WHERE dc.chunk_id = ANY(%s)
    """, (ids,))
    by_id = {r["chunk_id"]: r for r in rows}
    chunks = []
    for f in fused:
        r = by_id.get(f["chunk_id"])
        if not r:
            continue
        r = dict(r)
        r["rrf_score"] = round(f["rrf"], 5)
        r["match_arms"] = f["arms"]
        chunks.append(r)
    return {
        "chunks": chunks,
        "arms_used": list(arms.keys()),
        "cited_document_ids": sorted({c["document_id"] for c in chunks}),
        "cited_chunk_ids": [c["chunk_id"] for c in chunks],
        "cited_scheme_ids": sorted({c["scheme_id"] for c in chunks if c["scheme_id"]}),
    }
