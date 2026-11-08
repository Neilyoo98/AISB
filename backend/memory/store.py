"""Qdrant memory: tool catalog search, Business Constitution facts, and adoption episodes.

Qdrant Cloud when QDRANT_URL is set; otherwise embedded local mode (on-disk), so it runs anywhere.
Embeddings: fastembed all-MiniLM-L6-v2 (384-d, ONNX - no torch).
"""
import json
import threading
import uuid
from functools import lru_cache

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from config import DATA_DIR, QDRANT_API_KEY, QDRANT_PATH, QDRANT_URL

EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DIM = 384
CATALOG = "tool_catalog"
FACTS = "business_facts"
EPISODES = "episodes"

_lock = threading.Lock()
_client: QdrantClient | None = None


def client() -> QdrantClient:
    global _client
    with _lock:
        if _client is None:
            _client = (QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY or None, timeout=30)
                       if QDRANT_URL else QdrantClient(path=QDRANT_PATH))
        return _client


@lru_cache(maxsize=1)
def _embedder():
    from fastembed import TextEmbedding
    return TextEmbedding(EMBED_MODEL)


def embed(texts: list[str]) -> list[list[float]]:
    return [v.tolist() for v in _embedder().embed(texts)]


def _pid(*parts) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "|".join(parts)))


def _ensure(name: str):
    c = client()
    if not c.collection_exists(name):
        c.create_collection(name, vectors_config=qm.VectorParams(size=DIM, distance=qm.Distance.COSINE))
        # Qdrant Cloud strict mode rejects filters on unindexed fields
        if QDRANT_URL:
            for field in INDEXED.get(name, []):
                c.create_payload_index(name, field_name=field, field_schema=qm.PayloadSchemaType.KEYWORD)


INDEXED = {CATALOG: ["solves", "verticals"], FACTS: ["business_id"], EPISODES: ["business_id", "vertical"]}


# ---------------- catalog ----------------

@lru_cache(maxsize=1)
def load_catalog() -> dict[str, dict]:
    with open(DATA_DIR / "catalog.json", encoding="utf-8") as f:
        return {t["id"]: t for t in json.load(f)}


def _tool_text(t: dict) -> str:
    return (f"{t['name']}. {t['description']} Solves: {', '.join(t['solves'])}. "
            f"AI features: {', '.join(t['ai_features'])}. For: {', '.join(t['verticals'])}.")


def seed_catalog(force: bool = False) -> int:
    _ensure(CATALOG)
    c = client()
    cat = load_catalog()
    if not force and c.count(CATALOG).count == len(cat):
        return 0
    tools = list(cat.values())
    vecs = embed([_tool_text(t) for t in tools])
    c.upsert(CATALOG, [qm.PointStruct(id=_pid("tool", t["id"]), vector=v, payload=t) for t, v in zip(tools, vecs)])
    return len(tools)


def search_tools(query: str, *, pain_tag: str | None, vertical: str | None, limit: int = 6) -> list[dict]:
    """Semantic search, boosted by structured filters (pain tag + vertical), with graceful fallback."""
    c = client()
    vec = embed([query])[0]
    must = []
    if pain_tag:
        must.append(qm.FieldCondition(key="solves", match=qm.MatchValue(value=pain_tag)))
    should = None
    if vertical:
        should = [qm.FieldCondition(key="verticals", match=qm.MatchAny(any=[vertical, "all"]))]
    results = []
    for flt in (qm.Filter(must=must, should=should) if must or should else None,
                qm.Filter(should=should) if should else None, None):
        hits = c.query_points(CATALOG, query=vec, query_filter=flt, limit=limit, with_payload=True).points
        results = [h.payload | {"_score": round(h.score, 3)} for h in hits]
        if len(results) >= 3:
            break
    # prefer tools that list this vertical
    if vertical:
        results.sort(key=lambda t: (vertical in t["verticals"] or "all" in t["verticals"], t["_score"]), reverse=True)
    return results[:limit]


# ---------------- Business Constitution ----------------

def upsert_facts(business_id: str, facts: list[dict]):
    """facts: {subject, predicate, object, category, confidence}"""
    if not facts:
        return
    _ensure(FACTS)
    texts = [f"{f['subject']} {f['predicate']} {f['object']}" for f in facts]
    vecs = embed(texts)
    pts = [qm.PointStruct(id=_pid("fact", business_id, f["category"], f["predicate"], f["object"]), vector=v,
                          payload=f | {"business_id": business_id}) for f, v in zip(facts, vecs)]
    client().upsert(FACTS, pts)


def get_facts(business_id: str, limit: int = 100) -> list[dict]:
    _ensure(FACTS)
    pts, _ = client().scroll(FACTS, scroll_filter=qm.Filter(must=[
        qm.FieldCondition(key="business_id", match=qm.MatchValue(value=business_id))]), limit=limit, with_payload=True)
    return [p.payload for p in pts]


def delete_business_memory(business_id: str):
    for col in (FACTS, EPISODES):
        _ensure(col)
        client().delete(col, points_selector=qm.FilterSelector(filter=qm.Filter(must=[
            qm.FieldCondition(key="business_id", match=qm.MatchValue(value=business_id))])))


# ---------------- episodes (adoption outcomes) ----------------

def add_episode(business_id: str, vertical: str, text: str, payload: dict):
    _ensure(EPISODES)
    client().upsert(EPISODES, [qm.PointStruct(id=_pid("ep", business_id, text), vector=embed([text])[0],
                                              payload={"business_id": business_id, "vertical": vertical,
                                                       "text": text, **payload})])


def similar_episodes(query: str, vertical: str, exclude_business: str, limit: int = 3) -> list[dict]:
    _ensure(EPISODES)
    hits = client().query_points(EPISODES, query=embed([query])[0], limit=limit, with_payload=True,
                                 query_filter=qm.Filter(
                                     must=[qm.FieldCondition(key="vertical", match=qm.MatchValue(value=vertical))],
                                     must_not=[qm.FieldCondition(key="business_id",
                                                                 match=qm.MatchValue(value=exclude_business))])).points
    return [h.payload for h in hits]


def business_episodes(business_id: str, limit: int = 10) -> list[dict]:
    _ensure(EPISODES)
    pts, _ = client().scroll(EPISODES, scroll_filter=qm.Filter(must=[
        qm.FieldCondition(key="business_id", match=qm.MatchValue(value=business_id))]), limit=limit, with_payload=True)
    return [p.payload for p in pts]
