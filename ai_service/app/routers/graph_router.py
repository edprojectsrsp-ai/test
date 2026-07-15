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


@router.get("/subgraph")
def get_subgraph(
    name: str = Query(..., min_length=1, max_length=200),
    depth: int = Query(2, ge=1, le=4),
    max_nodes: int = Query(60, ge=5, le=150),
):
    return _result_or_error(subgraph(name.strip(), depth=depth, max_nodes=max_nodes))


@router.get("/neighbors")
def get_neighbors(
    name: str = Query(..., min_length=1, max_length=200),
    relation: str | None = Query(None, max_length=80),
    limit: int = Query(30, ge=1, le=150),
):
    return _result_or_error(neighbors(name.strip(), relation=relation, limit=limit))


@router.get("/path")
def get_path(
    a: str = Query(..., min_length=1, max_length=200),
    b: str = Query(..., min_length=1, max_length=200),
    max_hops: int = Query(4, ge=1, le=8),
):
    return _result_or_error(find_path(a.strip(), b.strip(), max_hops=max_hops))


@router.post("/sync")
def sync_graph():
    """Rebuild structural edges, then mine evidence-backed text relations."""
    return {
        "structural": sync_structural_graph(),
        "text_mining": extract_relations_from_chunks(),
    }
