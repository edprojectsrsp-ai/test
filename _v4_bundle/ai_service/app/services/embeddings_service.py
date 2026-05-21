"""
Embeddings service.

Strategy:
  1. Try Ollama with BGE-M3 (`ollama pull bge-m3:latest`) — local, private, free
  2. Fallback: sentence-transformers locally (all-mpnet-base-v2, 768-dim)
  3. If neither available, return None → caller does text search instead

BGE-M3 is 1024-dim natively but we slice to 768 for schema compatibility.
Switch to sentence-transformers all-mpnet-base-v2 if you want pure 768-dim.
"""
import os
import logging
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

EMBED_DIM = 768
EMBED_MODEL = os.environ.get("EMBED_MODEL", "all-mpnet-base-v2")
OLLAMA_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")

_st_model = None  # lazy-loaded sentence-transformers model


def _try_ollama_embed(text: str) -> Optional[list[float]]:
    """Try Ollama's /api/embeddings endpoint."""
    try:
        r = httpx.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=30.0,
        )
        if r.status_code == 200:
            vec = r.json().get("embedding", [])
            if len(vec) >= EMBED_DIM:
                return vec[:EMBED_DIM]
            if len(vec) == 0:
                return None
            # Pad with zeros if too short
            return list(vec) + [0.0] * (EMBED_DIM - len(vec))
    except Exception as e:
        logger.debug(f"Ollama embed failed: {e}")
    return None


def _try_sentence_transformers(text: str) -> Optional[list[float]]:
    """Fallback to local sentence-transformers."""
    global _st_model
    try:
        if _st_model is None:
            from sentence_transformers import SentenceTransformer
            _st_model = SentenceTransformer("all-mpnet-base-v2")
            logger.info("Loaded sentence-transformers all-mpnet-base-v2")
        vec = _st_model.encode(text, convert_to_tensor=False)
        return vec.tolist()
    except Exception as e:
        logger.debug(f"sentence-transformers failed: {e}")
    return None


def embed_text(text: str) -> Optional[list[float]]:
    """Get embedding for a piece of text. Returns None if all backends fail."""
    if not text or not text.strip():
        return None
    text = text.strip()[:8000]  # cap input

    # Try Ollama first
    vec = _try_ollama_embed(text)
    if vec is not None:
        return vec

    # Fallback to local
    return _try_sentence_transformers(text)


def embed_batch(texts: list[str]) -> list[Optional[list[float]]]:
    """Embed a batch. Falls back per-item."""
    return [embed_text(t) for t in texts]
