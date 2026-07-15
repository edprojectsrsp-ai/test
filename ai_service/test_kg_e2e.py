"""Knowledge graph e2e against the real restored DB."""
import os, sys, json
os.environ.setdefault("PROJECT_BRAIN_DB_URL", "postgresql://postgres@/project_brain?host=/home/claude/pg/sock&port=5599")
sys.path.insert(0, ".")
PASS=0; FAIL=0
def ok(n,c,d=""):
    global PASS,FAIL
    if c: PASS+=1; print(f"  PASS  {n}")
    else: FAIL+=1; print(f"  FAIL  {n}  {d}")

import psycopg2
conn = psycopg2.connect(os.environ["PROJECT_BRAIN_DB_URL"]); conn.autocommit=True
cur = conn.cursor()
mig = open("migrations/032_knowledge_graph.sql").read()
cur.execute(mig); cur.execute(mig)
ok("migration 032 idempotent x2", True)

# Seed two ingested docs mentioning COB-7 with a causal phrase
cur.execute("DELETE FROM kg_edges; DELETE FROM kg_nodes; DELETE FROM document_embeddings; DELETE FROM document_chunks; DELETE FROM documents;")
from app.ingestion.ingest_v2 import ingest_correspondence, ingest_contract
d1 = ingest_correspondence(
    "Subject: COB-7 delay report\n\nRaft work at COB-7 was delayed due to dewatering failure near pit 4. "
    "The agency has sought extension of time (EOT) of 15 days.", scheme_id=74)
d2 = ingest_contract(
    "CLAUSE 12 LIQUIDATED DAMAGES\nFor COB-7, liquidated damages at 0.5% per week apply. "
    "CDCP interface delays attributable to the Employer are excluded.",
    title="COB-7 Contract extract", scheme_id=74)

from app.services.knowledge_graph import (sync_structural_graph,
    extract_relations_from_chunks, neighbors, find_path, subgraph)
s = sync_structural_graph()
ok(f"structural sync: nodes {s['nodes']}, edges {s['edges']}", s["nodes"] >= 160 and s["edges"] >= 80, str(s))
e = extract_relations_from_chunks()
ok("mentions extracted", e["mentions"] >= 2, str(e))
ok("causal relation extracted ('delayed due to dewatering')", e["causal"] >= 1, str(e))
ok("EOT + LD topics extracted", e["eot"] >= 1 and e["ld"] >= 1, str(e))

nb = neighbors("COB-7")
rels = {r["relation"] for r in nb["neighbors"]}
ok("COB-7 neighbors span structure+text", {"has_package", "mentioned_in"} & rels != set()
   and ("about" in rels or "mentioned_in" in rels), str(sorted(rels)))
ok("neighbors carry evidence doc ids", any(r["evidence_document_id"] for r in nb["neighbors"]))
ok("neighbors cite scheme/docs", nb["cited_document_ids"])

p = find_path("dewatering failure near pit 4", "COB-7")
ok("path topic→COB-7 found", p.get("path") and p["hops"] >= 1, json.dumps(p)[:200])
ok("path carries evidence", p.get("cited_document_ids"), json.dumps(p)[:150])

sg = subgraph("COB-7", depth=2)
ok("subgraph has nodes+edges for viz", len(sg["nodes"]) >= 4 and len(sg["edges"]) >= 3,
   f"n={len(sg['nodes'])} e={len(sg['edges'])}")

import app.tools.retrieval_tools  # self-registers graph tools
from app.tools.db_tools import call_tool, TOOL_REGISTRY
names = [t["name"] for t in TOOL_REGISTRY]
ok("graph tools registered", all(n in names for n in ("graph_neighbors","graph_path","graph_sync")))
tn = call_tool("graph_neighbors", {"name": "con-7"})  # trigram label match
ok("tool handles fuzzy label 'con-7'", "neighbors" in tn and tn["neighbors"], str(tn)[:120])

import app.services.orchestrator as orch
ok("rich-output contract in system prompt", "brain:chart" in orch.SYSTEM_PROMPT
   and "brain:table" in orch.SYSTEM_PROMPT)

conn.close()
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
