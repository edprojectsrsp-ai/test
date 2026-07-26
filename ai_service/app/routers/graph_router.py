"""HTTP surface for the Project Brain knowledge graph visualisation."""
from fastapi import APIRouter, HTTPException, Query

from app.services.knowledge_graph import (
    extract_relations_from_chunks,
    find_path,
    neighbors,
    subgraph,
    sync_structural_graph,
)

router = APIRouter(prefix="/ai/graph", tags=["knowledge-graph"])


def _result_or_error(result: dict) -> dict:
    if result.get("error"):
        raise HTTPException(404, result["error"])
    return result


def _retry_after_structural_sync(result: dict, loader) -> dict:
    """Fresh databases may have empty graph tables until the first sync.

    The explorer's default query is usually a live scheme/package name. If the
    lookup misses, rebuild the cheap structural graph once and retry before
    returning a 404. Text mining still stays behind the explicit Sync button.
    """
    if not result.get("error"):
        return result
    sync_structural_graph()
    return loader()


@router.get("/subgraph")
def get_subgraph(
    name: str = Query(..., min_length=1, max_length=200),
    depth: int = Query(2, ge=1, le=4),
    max_nodes: int = Query(60, ge=5, le=150),
):
    entity = name.strip()
    result = subgraph(entity, depth=depth, max_nodes=max_nodes)
    result = _retry_after_structural_sync(
        result,
        lambda: subgraph(entity, depth=depth, max_nodes=max_nodes),
    )
    return _result_or_error(result)


@router.get("/neighbors")
def get_neighbors(
    name: str = Query(..., min_length=1, max_length=200),
    relation: str | None = Query(None, max_length=80),
    limit: int = Query(30, ge=1, le=150),
):
    entity = name.strip()
    result = neighbors(entity, relation=relation, limit=limit)
    result = _retry_after_structural_sync(
        result,
        lambda: neighbors(entity, relation=relation, limit=limit),
    )
    return _result_or_error(result)


@router.get("/path")
def get_path(
    a: str = Query(..., min_length=1, max_length=200),
    b: str = Query(..., min_length=1, max_length=200),
    max_hops: int = Query(4, ge=1, le=8),
):
    left, right = a.strip(), b.strip()
    result = find_path(left, right, max_hops=max_hops)
    result = _retry_after_structural_sync(
        result,
        lambda: find_path(left, right, max_hops=max_hops),
    )
    return _result_or_error(result)


@router.post("/sync")
def sync_graph():
    """Rebuild structural edges, then mine evidence-backed text relations."""
    return {
        "structural": sync_structural_graph(),
        "text_mining": extract_relations_from_chunks(),
    }
