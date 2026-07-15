"""
knowledge_graph.py — the KG layer of Project Brain's AI stack.

Nodes: schemes, packages, contractors, documents, topics.
Edges carry PROVENANCE (evidence_document_id / evidence_chunk_id) so every
graph answer can cite the document it came from.

Two builders:
  sync_structural_graph()      — mirrors hard DB relations:
        scheme —has_package→ package
        package —contracted_to→ contractor        (from contracts)
        document —about→ scheme / package         (from documents FKs)
  extract_relations_from_chunks() — deterministic text mining over ingested
        chunks (no LLM, reproducible):
        entity —mentioned_in→ document            (alias hits)
        entity —co_mentioned→ entity  (weight+=1)  (same-chunk co-occurrence)
        cause —caused_delay→ entity                ("delay(ed) due to X", "held up by X")
        entity —granted_eot→ document              (extension-of-time language)
        document —has_ld_clause→ entity            (liquidated damages language)

Traversal (used by AI tools and the frontend):
  neighbors(node)                — 1-hop with relations + evidence
  find_path(a, b, max_hops=4)    — BFS shortest path with edge labels
  subgraph(node, depth=2)        — for graph visualisation
"""
from __future__ import annotations

import re
from collections import deque
from typing import Optional

import psycopg2
import psycopg2.extras

from app.tools.db_tools import query, _require_tables


def _rw():
    import os
    dsn = (os.environ.get("PROJECT_BRAIN_DB_URL")
           or os.environ.get("DATABASE_URL")
           or "postgresql://postgres:abc123@127.0.0.1:5432/project_brain")
    return psycopg2.connect(dsn)


# ---------------------------------------------------------------------------
# Node helpers
# ---------------------------------------------------------------------------

def _upsert_node(cur, node_type: str, ref_id: Optional[int], label: str,
                 props: Optional[dict] = None) -> int:
    import json
    if ref_id is not None:
        # Entity nodes are IDENTIFIED by (type, ref_id); label is display-only.
        # Prevents duplicate nodes when different code paths derive different labels.
        cur.execute("SELECT node_id FROM kg_nodes WHERE node_type=%s AND ref_id=%s LIMIT 1",
                    (node_type, ref_id))
        row = cur.fetchone()
        if row:
            if props:
                cur.execute("UPDATE kg_nodes SET props = props || %s::jsonb WHERE node_id=%s",
                            (json.dumps(props), row[0]))
            return row[0]
    cur.execute("""
        INSERT INTO kg_nodes (node_type, ref_id, label, props)
        VALUES (%s, %s, %s, %s::jsonb)
        ON CONFLICT (node_type, ref_id, label)
        DO UPDATE SET props = kg_nodes.props || EXCLUDED.props
        RETURNING node_id
    """, (node_type, ref_id, label, json.dumps(props or {})))
    return cur.fetchone()[0]


def _upsert_edge(cur, src: int, dst: int, relation: str, weight: float = 1.0,
                 doc_id: Optional[int] = None, chunk_id: Optional[int] = None,
                 props: Optional[dict] = None):
    import json
    cur.execute("""
        INSERT INTO kg_edges (src_id, dst_id, relation, weight,
                              evidence_document_id, evidence_chunk_id, props)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (src_id, dst_id, relation, coalesce(evidence_chunk_id, 0))
        DO UPDATE SET weight = kg_edges.weight + EXCLUDED.weight
    """, (src, dst, relation, weight, doc_id, chunk_id, json.dumps(props or {})))


# ---------------------------------------------------------------------------
# Builder 1 — structural sync from relational tables
# ---------------------------------------------------------------------------

def sync_structural_graph() -> dict:
    conn = _rw()
    stats = {"nodes": 0, "edges": 0}
    try:
        cur = conn.cursor()
        scheme_nodes: dict[int, int] = {}
        for r in query("""SELECT scheme_id, scheme_code, scheme_name FROM scheme_master
                          WHERE NOT coalesce(is_deleted,false)"""):
            nid = _upsert_node(cur, "scheme", r["scheme_id"],
                               r["scheme_name"] or r["scheme_code"],
                               {"code": r["scheme_code"], "name": r["scheme_name"]})
            scheme_nodes[r["scheme_id"]] = nid
            stats["nodes"] += 1

        pkg_nodes: dict[int, int] = {}
        for r in query("""SELECT package_id, package_code, package_name, scheme_id
                          FROM packages WHERE NOT coalesce(is_deleted,false)"""):
            nid = _upsert_node(cur, "package", r["package_id"],
                               r["package_code"] or r["package_name"],
                               {"name": r["package_name"]})
            pkg_nodes[r["package_id"]] = nid
            stats["nodes"] += 1
            if r["scheme_id"] in scheme_nodes:
                _upsert_edge(cur, scheme_nodes[r["scheme_id"]], nid, "has_package")
                stats["edges"] += 1

        try:
            for r in query("""SELECT contract_id, package_id, contractor_name, contract_no
                              FROM contracts WHERE NOT coalesce(is_deleted,false)"""):
                if not r["contractor_name"]:
                    continue
                cn = _upsert_node(cur, "contractor", None, r["contractor_name"].strip())
                stats["nodes"] += 1
                if r["package_id"] in pkg_nodes:
                    _upsert_edge(cur, pkg_nodes[r["package_id"]], cn, "contracted_to",
                                 props={"contract_no": r["contract_no"]})
                    stats["edges"] += 1
        except Exception:
            pass  # contracts table optional

        for r in query("""SELECT document_id, title, scheme_id, package_id, document_type::text
                          FROM documents WHERE NOT is_deleted"""):
            dn = _upsert_node(cur, "document", r["document_id"], r["title"][:180],
                              {"type": r["document_type"]})
            stats["nodes"] += 1
            if r["scheme_id"] in scheme_nodes:
                _upsert_edge(cur, dn, scheme_nodes[r["scheme_id"]], "about")
                stats["edges"] += 1
            if r["package_id"] in pkg_nodes:
                _upsert_edge(cur, dn, pkg_nodes[r["package_id"]], "about")
                stats["edges"] += 1
        conn.commit()
    except Exception:
        conn.rollback(); raise
    finally:
        conn.close()
    return stats


# ---------------------------------------------------------------------------
# Builder 2 — deterministic relation extraction from ingested chunks
# ---------------------------------------------------------------------------

_CAUSE_PAT = re.compile(
    r"(?:delay(?:ed|s)?|held\s*up|stalled|stopped|hindered)\s+"
    r"(?:\w+\s+){0,4}?(?:due\s+to|owing\s+to|because\s+of|on\s+account\s+of|attributable\s+to)\s+"
    r"([A-Za-z][A-Za-z0-9 \-#/]{3,60}?)(?:[\.,;\n]|$)", re.IGNORECASE)
_EOT_PAT = re.compile(r"extension\s+of\s+time|EOT\b", re.IGNORECASE)
_LD_PAT = re.compile(r"liquidated\s+damages|\bLD\b", re.IGNORECASE)


def _alias_map() -> list[tuple[re.Pattern, str, int]]:
    """Compiled alias patterns → (pattern, entity_type, entity_id).
    Longest aliases first so 'COB-7 CDCP' beats 'COB-7'."""
    rows = query("""SELECT entity_type, entity_id, alias FROM entity_aliases
                    WHERE length(alias) BETWEEN 3 AND 80""")
    rows.sort(key=lambda r: -len(r["alias"]))
    out = []
    for r in rows[:2000]:
        pat = re.compile(r"(?<![A-Za-z0-9])" + re.escape(r["alias"]) + r"(?![A-Za-z0-9])",
                         re.IGNORECASE)
        out.append((pat, r["entity_type"], r["entity_id"]))
    return out


def extract_relations_from_chunks(document_ids: Optional[list[int]] = None) -> dict:
    guard = _require_tables("kg_nodes", "kg_edges", "entity_aliases")
    if guard:
        return guard
    aliases = _alias_map()
    cond = "AND d.document_id = ANY(%s)" if document_ids else ""
    params = (document_ids,) if document_ids else ()
    chunks = query(f"""
        SELECT dc.chunk_id, dc.chunk_text, d.document_id, d.title
        FROM document_chunks dc JOIN documents d ON d.document_id = dc.document_id
        WHERE NOT d.is_deleted {cond}
    """, params)

    conn = _rw()
    stats = {"mentions": 0, "co_mentions": 0, "causal": 0, "eot": 0, "ld": 0}
    try:
        cur = conn.cursor()
        for ch in chunks:
            text = ch["chunk_text"] or ""
            doc_node = _upsert_node(cur, "document", ch["document_id"], ch["title"][:180])
            found: list[tuple[str, int, int]] = []  # (etype, eid, node_id)
            seen: set[tuple[str, int]] = set()
            for pat, etype, eid in aliases:
                if (etype, eid) in seen:
                    continue
                if pat.search(text):
                    seen.add((etype, eid))
                    canon = query(
                        "SELECT coalesce(scheme_code, scheme_name) AS c FROM scheme_master WHERE scheme_id=%s"
                        if etype == "scheme"
                        else "SELECT coalesce(package_code, package_name) AS c FROM packages WHERE package_id=%s",
                        (eid,))
                    label = (canon[0]["c"] if canon and canon[0]["c"] else f"{etype}:{eid}")
                    en = _upsert_node(cur, etype, eid, label)
                    _upsert_edge(cur, en, doc_node, "mentioned_in", 1.0,
                                 ch["document_id"], ch["chunk_id"])
                    stats["mentions"] += 1
                    found.append((etype, eid, en))
            for i in range(len(found)):
                for j in range(i + 1, len(found)):
                    _upsert_edge(cur, found[i][2], found[j][2], "co_mentioned", 1.0,
                                 ch["document_id"], ch["chunk_id"])
                    stats["co_mentions"] += 1
            for m in _CAUSE_PAT.finditer(text):
                cause = m.group(1).strip().rstrip(".")
                cn = _upsert_node(cur, "topic", None, cause[:80].lower())
                targets = found or [("document", ch["document_id"], doc_node)]
                for _, _, tn in targets[:2]:
                    _upsert_edge(cur, cn, tn, "caused_delay", 1.0,
                                 ch["document_id"], ch["chunk_id"],
                                 {"quote": m.group(0)[:200]})
                    stats["causal"] += 1
            if _EOT_PAT.search(text):
                tn = _upsert_node(cur, "topic", None, "extension of time")
                _upsert_edge(cur, tn, doc_node, "granted_eot", 1.0,
                             ch["document_id"], ch["chunk_id"])
                stats["eot"] += 1
            if _LD_PAT.search(text):
                tn = _upsert_node(cur, "topic", None, "liquidated damages")
                _upsert_edge(cur, doc_node, tn, "has_ld_clause", 1.0,
                             ch["document_id"], ch["chunk_id"])
                stats["ld"] += 1
        conn.commit()
    except Exception:
        conn.rollback(); raise
    finally:
        conn.close()
    return stats


# ---------------------------------------------------------------------------
# Traversal
# ---------------------------------------------------------------------------

def _find_node(name: str) -> Optional[dict]:
    # 1. The fuzzy entity brain first: 'con-7'/'cob7'/'COB-7' → (scheme, 74)
    #    → kg node by (node_type, ref_id). One resolver for the whole system.
    try:
        from app.services.retrieval import resolve_entities
        res = resolve_entities(name)
        cands = (res.get("resolved") or []) + (res.get("suggestions") or [])
        for c in cands[:3]:
            rows = query("""SELECT node_id, node_type, ref_id, label FROM kg_nodes
                            WHERE node_type=%s AND ref_id=%s LIMIT 1""",
                         (c["entity_type"], c["entity_id"]))
            if rows:
                return rows[0]
    except Exception:
        pass
    # 2. Exact label (topics, contractors, documents)
    rows = query("""
        SELECT node_id, node_type, ref_id, label FROM kg_nodes
        WHERE lower(label) = lower(%s)
        ORDER BY node_id LIMIT 1
    """, (name,))
    if rows:
        return rows[0]
    # 3. Trigram label fallback
    rows = query("""
        SELECT node_id, node_type, ref_id, label,
               similarity(lower(label), lower(%s)) AS sim
        FROM kg_nodes WHERE similarity(lower(label), lower(%s)) > 0.3
        ORDER BY sim DESC LIMIT 1
    """, (name, name))
    return rows[0] if rows else None


def neighbors(name: str, relation: Optional[str] = None, limit: int = 30) -> dict:
    guard = _require_tables("kg_nodes", "kg_edges")
    if guard:
        return guard
    node = _find_node(name)
    if not node:
        return {"error": f"No graph node matching '{name}'. Run graph sync or check the name."}
    rows = query(f"""
        SELECT e.relation, e.weight, e.evidence_document_id, e.evidence_chunk_id,
               CASE WHEN e.src_id = %(nid)s THEN 'out' ELSE 'in' END AS direction,
               n.node_id, n.node_type, n.ref_id, n.label
        FROM kg_edges e
        JOIN kg_nodes n ON n.node_id = CASE WHEN e.src_id = %(nid)s THEN e.dst_id ELSE e.src_id END
        WHERE (e.src_id = %(nid)s OR e.dst_id = %(nid)s) {"AND e.relation = %(rel)s" if relation else ""}
        ORDER BY e.weight DESC LIMIT %(lim)s
    """, {"nid": node["node_id"], "rel": relation, "lim": limit})
    return {
        "node": node,
        "neighbors": rows,
        "cited_document_ids": sorted({r["evidence_document_id"] for r in rows
                                      if r["evidence_document_id"]}),
        "cited_scheme_ids": sorted({r["ref_id"] for r in rows
                                    if r["node_type"] == "scheme" and r["ref_id"]}),
    }


def find_path(a: str, b: str, max_hops: int = 4) -> dict:
    guard = _require_tables("kg_nodes", "kg_edges")
    if guard:
        return guard
    na, nb = _find_node(a), _find_node(b)
    if not na or not nb:
        return {"error": f"Node not found: {'' if na else a} {'' if nb else b}".strip()}
    edges = query("SELECT src_id, dst_id, relation, evidence_document_id FROM kg_edges")
    adj: dict[int, list[tuple[int, str, Optional[int]]]] = {}
    for e in edges:
        adj.setdefault(e["src_id"], []).append((e["dst_id"], e["relation"], e["evidence_document_id"]))
        adj.setdefault(e["dst_id"], []).append((e["src_id"], e["relation"], e["evidence_document_id"]))
    start, goal = na["node_id"], nb["node_id"]
    prev: dict[int, tuple[int, str, Optional[int]]] = {}
    seen = {start}
    dq = deque([(start, 0)])
    while dq:
        cur_id, d = dq.popleft()
        if cur_id == goal:
            break
        if d >= max_hops:
            continue
        for nxt, rel, doc in adj.get(cur_id, []):
            if nxt not in seen:
                seen.add(nxt)
                prev[nxt] = (cur_id, rel, doc)
                dq.append((nxt, d + 1))
    if goal not in prev and goal != start:
        return {"path": None, "note": f"No path within {max_hops} hops."}
    hops = []
    cur_id = goal
    while cur_id != start:
        p, rel, doc = prev[cur_id]
        hops.append({"from": p, "to": cur_id, "relation": rel, "evidence_document_id": doc})
        cur_id = p
    hops.reverse()
    labels = {r["node_id"]: r for r in query(
        "SELECT node_id, label, node_type, ref_id FROM kg_nodes WHERE node_id = ANY(%s)",
        ([start] + [h["to"] for h in hops],))}
    return {
        "path": [{"from": labels[h["from"]]["label"], "to": labels[h["to"]]["label"],
                  "relation": h["relation"], "evidence_document_id": h["evidence_document_id"]}
                 for h in hops],
        "hops": len(hops),
        "cited_document_ids": sorted({h["evidence_document_id"] for h in hops
                                      if h["evidence_document_id"]}),
    }


def subgraph(name: str, depth: int = 2, max_nodes: int = 60) -> dict:
    guard = _require_tables("kg_nodes", "kg_edges")
    if guard:
        return guard
    root = _find_node(name)
    if not root:
        return {"error": f"No graph node matching '{name}'."}
    nodes = {root["node_id"]: root}
    frontier = [root["node_id"]]
    out_edges = []
    for _ in range(depth):
        if not frontier or len(nodes) >= max_nodes:
            break
        rows = query("""
            SELECT e.src_id, e.dst_id, e.relation, e.weight,
                   e.evidence_document_id, e.evidence_chunk_id, e.props,
                   ns.label AS src_label, ns.node_type AS src_type, ns.ref_id AS src_ref,
                   nd.label AS dst_label, nd.node_type AS dst_type, nd.ref_id AS dst_ref
            FROM kg_edges e
            JOIN kg_nodes ns ON ns.node_id = e.src_id
            JOIN kg_nodes nd ON nd.node_id = e.dst_id
            WHERE e.src_id = ANY(%s) OR e.dst_id = ANY(%s)
        """, (frontier, frontier))
        nxt = []
        for r in rows:
            out_edges.append({"src": r["src_id"], "dst": r["dst_id"],
                              "relation": r["relation"], "weight": r["weight"],
                              "evidence_document_id": r["evidence_document_id"],
                              "evidence_chunk_id": r["evidence_chunk_id"],
                              "props": r.get("props") or {}})
            for nid, lab, typ, ref in ((r["src_id"], r["src_label"], r["src_type"], r["src_ref"]),
                                       (r["dst_id"], r["dst_label"], r["dst_type"], r["dst_ref"])):
                if nid not in nodes and len(nodes) < max_nodes:
                    nodes[nid] = {"node_id": nid, "label": lab, "node_type": typ, "ref_id": ref}
                    nxt.append(nid)
        frontier = nxt
    dedup = {(e["src"], e["dst"], e["relation"]): e for e in out_edges
             if e["src"] in nodes and e["dst"] in nodes}
    return {"root": root["node_id"], "nodes": list(nodes.values()),
            "edges": list(dedup.values())}
