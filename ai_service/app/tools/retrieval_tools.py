"""
retrieval_tools.py — LLM-facing tools for the hybrid retrieval layer.
Self-registering via @register_tool; importing this module is the integration.
"""
from __future__ import annotations

from app.tools.db_tools import register_tool
from app.services.retrieval import resolve_entities, hybrid_search


@register_tool(
    name="resolve_entity",
    description=(
        "Resolve a possibly-misspelled or partial scheme/package reference to the real entity. "
        "Use this FIRST whenever the user's wording doesn't exactly match a known scheme "
        "(e.g. 'con-7', 'cob7', 'coke oven 7', 'boundry wall'). Returns resolved entities with "
        "confidence, plus did-you-mean suggestions when ambiguous."
    ),
    parameters={
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "The user's phrase or the whole question"},
        },
        "required": ["text"],
    },
)
def tool_resolve_entity(text: str):
    res = resolve_entities(text)
    out = dict(res)
    out["cited_scheme_ids"] = [c["entity_id"] for c in res.get("resolved", [])
                               if c["entity_type"] == "scheme"]
    out["cited_package_ids"] = [c["entity_id"] for c in res.get("resolved", [])
                                if c["entity_type"] == "package"]
    return out


@register_tool(
    name="hybrid_search_documents",
    description=(
        "Search ALL ingested project documents — WhatsApp messages, correspondence/letters, "
        "contracts, record notes, any uploaded file — using hybrid retrieval (semantic + "
        "full-text + fuzzy). Better than search_documents for vague or broken queries. "
        "Returns the most relevant chunks with document titles and match provenance."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to find"},
            "scheme_id": {"type": "integer", "description": "Optional — scope to one scheme"},
            "keyword": {"type": "string", "description": "Optional — only documents labelled with this keyword (e.g. 'LD', 'COB-7', 'dewatering')"},
            "limit": {"type": "integer", "description": "Max chunks (default 6)"},
        },
        "required": ["query"],
    },
)
def tool_hybrid_search(query: str, scheme_id: int = None, keyword: str = None, limit: int = 6):
    qvec = None
    model = None
    try:
        from app.services.embeddings_service import embed_text, EMBED_MODEL
        qvec = embed_text(query)
        model = EMBED_MODEL
    except Exception:
        pass
    return hybrid_search(query, scheme_id=scheme_id, limit=limit,
                         qvec=qvec, embedding_model=model, keyword=keyword)


@register_tool(
    name="export_knowledge_bundle",
    description=(
        "Export the project knowledge base (entities, taught facts, document chunks) as an "
        "OKF v0.1 bundle zip for exchange or backup. Returns the manifest with counts."
    ),
    parameters={
        "type": "object",
        "properties": {
            "include_chunks": {"type": "boolean", "description": "Include RAG chunks (default true)"},
        },
        "required": [],
    },
)
def tool_export_okf(include_chunks: bool = True):
    import os, tempfile
    from app.services.okf_export import export_okf_bundle
    out_dir = os.environ.get("OKF_EXPORT_DIR", tempfile.gettempdir())
    path = os.path.join(out_dir, "project_brain_okf.zip")
    manifest = export_okf_bundle(path, include_chunks=include_chunks)
    return {"bundle_path": path, "manifest": manifest}


@register_tool(
    name="list_ingested_documents",
    description=(
        "Browse the Document Vault: list ingested documents with their labels/keywords, "
        "type, channel and scheme. Use to answer 'what documents do we have about X', "
        "'show contracts for COB-7', or to find the right keyword before hybrid_search_documents."
    ),
    parameters={
        "type": "object",
        "properties": {
            "document_type": {"type": "string", "description": "contract | correspondence_in | correspondence_out | record_note | report | other"},
            "scheme_id": {"type": "integer", "description": "Optional scheme filter"},
            "keyword": {"type": "string", "description": "Optional label filter"},
            "limit": {"type": "integer", "description": "Max rows (default 20)"},
        },
        "required": [],
    },
)
def tool_list_documents(document_type: str = None, scheme_id: int = None,
                        keyword: str = None, limit: int = 20):
    from app.tools.db_tools import query
    conds = ["NOT d.is_deleted"]
    params = []
    if document_type:
        conds.append("d.document_type::text = %s"); params.append(document_type)
    if scheme_id is not None:
        conds.append("d.scheme_id = %s"); params.append(scheme_id)
    if keyword:
        conds.append("EXISTS (SELECT 1 FROM unnest(d.keywords) kx WHERE kx ILIKE %s)")
        params.append(keyword)
    params.append(limit)
    rows = query(f"""
        SELECT d.document_id, d.title, d.document_type::text AS document_type,
               d.keywords, d.ingest_channel, d.scheme_id, sm.scheme_code,
               d.chunk_count, d.created_at::date AS ingested_on
        FROM documents d LEFT JOIN scheme_master sm ON sm.scheme_id=d.scheme_id
        WHERE {' AND '.join(conds)}
        ORDER BY d.created_at DESC LIMIT %s
    """, tuple(params))
    return {"documents": rows,
            "cited_document_ids": [r["document_id"] for r in rows],
            "cited_scheme_ids": sorted({r["scheme_id"] for r in rows if r["scheme_id"]})}

# ---------------------------------------------------------------------------
# Knowledge graph tools
# ---------------------------------------------------------------------------

@register_tool(
    name="graph_neighbors",
    description=(
        "Knowledge graph: everything connected to an entity — its packages, contractor, "
        "documents that mention it, co-mentioned entities, delay causes (caused_delay), "
        "EOT and LD topics. Each connection carries the evidence document. Use for "
        "'what do we know about X', 'what is linked to X', 'why is X delayed'."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Entity label, e.g. 'COB-7'"},
            "relation": {"type": "string", "description": "Optional filter: has_package | contracted_to | mentioned_in | co_mentioned | caused_delay | granted_eot | has_ld_clause | about"},
        },
        "required": ["name"],
    },
)
def tool_graph_neighbors(name: str, relation: str = None):
    from app.services.knowledge_graph import neighbors
    return neighbors(name, relation)


@register_tool(
    name="graph_path",
    description=(
        "Knowledge graph: shortest connection between two entities/topics/documents "
        "with the relation chain and evidence documents. Use for 'how is X related to Y'."
    ),
    parameters={
        "type": "object",
        "properties": {
            "a": {"type": "string"},
            "b": {"type": "string"},
        },
        "required": ["a", "b"],
    },
)
def tool_graph_path(a: str, b: str):
    from app.services.knowledge_graph import find_path
    return find_path(a, b)


@register_tool(
    name="graph_sync",
    description=(
        "Rebuild the knowledge graph: mirror scheme→package→contractor→document structure "
        "from the database and mine ingested chunks for mentions, co-mentions, delay causes, "
        "EOT and LD relations. Run after bulk ingestion."
    ),
    parameters={"type": "object", "properties": {}, "required": []},
)
def tool_graph_sync():
    from app.services.knowledge_graph import sync_structural_graph, extract_relations_from_chunks
    s = sync_structural_graph()
    e = extract_relations_from_chunks()
    return {"structural": s, "text_mining": e}
