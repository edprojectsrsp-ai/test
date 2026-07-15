"""End-to-end verification of the retrieval/ingestion/OKF stack against the
REAL restored project_brain database (Postgres 16 + pgvector, 79 schemes)."""
import hashlib
import json
import math
import os
import re
import sys

os.environ.setdefault("PROJECT_BRAIN_DB_URL", "postgresql://postgres@/project_brain?host=/home/claude/pg/sock&port=5599")
os.environ.setdefault("EMBED_MODEL", "test-hash-768")

sys.path.insert(0, ".")

PASS = 0; FAIL = 0
def ok(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  PASS  {name}")
    else: FAIL += 1; print(f"  FAIL  {name}  {detail}")

# Deterministic 768-dim embedder: hashed bag-of-words, L2-normalized.
# Shared tokens → high cosine. Genuinely tests vector-arm ordering.
def hash_embed(text):
    vec = [0.0] * 768
    for tok in re.findall(r"[a-z0-9]+", text.lower()):
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        vec[h % 768] += 1.0
    n = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / n for v in vec]

print("── M1: migration 031 applies cleanly (idempotent ×2) ──")
import psycopg2
conn = psycopg2.connect(os.environ["PROJECT_BRAIN_DB_URL"])
conn.autocommit = True
cur = conn.cursor()
mig = open("migrations/031_ai_retrieval.sql").read()
cur.execute(mig)
cur.execute(mig)  # idempotence
cur.execute("SELECT count(*) FROM entity_aliases")
n_alias = cur.fetchone()[0]
ok("migration ran twice without error", True)
ok(f"aliases seeded from live data ({n_alias})", n_alias > 150)
cur.execute("SELECT count(*) FROM information_schema.columns WHERE table_name='document_chunks' AND column_name='chunk_tsv'")
ok("chunk_tsv column present", cur.fetchone()[0] == 1)

print("── M2: fuzzy entity resolution on REAL data ──")
from app.services.retrieval import resolve_entities, normalize_query
r = resolve_entities("what is the progress of con-7")
top = (r["resolved"] + r["suggestions"])[:1]
ok("'con-7' → COB-7 found", any(
    c["entity_type"] == "scheme" and c["entity_id"] == 74 for c in r["resolved"] + r["suggestions"]),
    json.dumps(r)[:200])
r2 = resolve_entities("cob7 status")
ok("'cob7' (glued) → scheme 74 confident", any(
    c["entity_id"] == 74 and c["confidence"] >= 0.9 for c in r2["resolved"]), json.dumps(r2)[:200])
r3 = resolve_entities("COB-7")
ok("exact 'COB-7' → confidence 1.0", any(
    c["entity_id"] == 74 and c["confidence"] == 1.0 for c in r3["resolved"]))
r4 = resolve_entities("wht prog cob 7 lst mnth")
ok("broken query still resolves scheme 74", any(
    c["entity_id"] == 74 for c in r4["resolved"] + r4["suggestions"]), json.dumps(r4)[:200])
ok("normalize expands shorthand", "what progress" in normalize_query("wht prog cob 7"))
r5 = resolve_entities("completely unrelated gibberish zzqqxx")
ok("gibberish → nothing confident", len(r5["resolved"]) == 0)

print("── M3: ingestion — WhatsApp / correspondence / contract ──")
from app.ingestion.ingest_v2 import (parse_whatsapp, ingest_whatsapp_export,
                                     ingest_correspondence, ingest_contract,
                                     chunk_contract)
WA = """12/06/26, 09:14 - Sharma PMC: Raft casting at COB-7 battery area completed 90.3% today
12/06/26, 09:16 - Sharma PMC: Balance raft holding due to dewatering issue near pit 4
12/06/26, 09:20 - Verma L&T: Noted. Dewatering pump mobilized, expect resolution by 14th
12/06/26, 09:31 - Sharma PMC: Column erection continues
2. Second lift shuttering at CDCP area from Monday
12/06/26, 10:02 - Verma L&T: <Media omitted>
12/06/26, 11:45 - Das RSP: Please share updated S-curve for COB-7 before VC review
"""
msgs = parse_whatsapp(WA)
ok("WA two-pass parse: 5 real messages", len(msgs) == 5, f"got {len(msgs)}")
ok("inline-numbered line folded into prior msg", "Second lift shuttering" in msgs[3]["text"])
ok("media-omitted dropped", all("Media omitted" not in m["text"] for m in msgs))

wa_res = ingest_whatsapp_export(WA, title="COB-7 site group Jun-26",
                                scheme_id=74, embedder=hash_embed)
ok("WhatsApp ingested + embedded", wa_res["chunks"] >= 1 and wa_res["embedded"] == wa_res["chunks"])

CORR = """Subject: Extension of time for dewatering works at COB-7

Ref: RSP/PROJ/COB7/2026/118 dated 02.06.2026

With reference to the above, the agency has requested extension of 15 days for
dewatering works near pit 4 owing to unseasonal ground water ingress. PMC has
examined the request and recommends acceptance of 10 days without financial
implication.

Approval of the competent authority is solicited.
"""
co_res = ingest_correspondence(CORR, scheme_id=74, embedder=hash_embed)
ok("correspondence subject auto-extracted", "Extension of time" in co_res["title"])
ok("correspondence ingested", co_res["chunks"] >= 1)

CONTRACT = """ARTICLE I DEFINITIONS
1.1 In this Agreement the following terms shall have the meanings assigned.
1.2 "Employer" means Rourkela Steel Plant, SAIL.

CLAUSE 2 SCOPE OF WORK
2.1 The Contractor shall execute the design, supply, erection and commissioning
of Coke Oven Battery No. 7 including all auxiliary facilities.

CLAUSE 12 LIQUIDATED DAMAGES
12.1 If the Contractor fails to achieve completion within the time for completion,
the Contractor shall pay liquidated damages at the rate of 0.5% of the contract
price per week of delay subject to a maximum of 10% of the contract price.
"""
cl = chunk_contract(CONTRACT, max_words=60)
ok("clause-aware chunking splits on headings", len(cl) >= 2)
ok("LD clause kept intact in one chunk", any("liquidated damages" in c.lower()
   and "0.5%" in c for c in cl))
ct_res = ingest_contract(CONTRACT, title="COB-7 Main Contract", scheme_id=74, embedder=hash_embed)
ok("contract ingested + embedded", ct_res["chunks"] >= 2 and ct_res["embedded"] == ct_res["chunks"])
cur.execute("SELECT DISTINCT embedding_model FROM document_embeddings")
models = [r[0] for r in cur.fetchall()]
ok("embeddings stamped with model", models == ["test-hash-768"], str(models))

print("── M4: hybrid search (vector + FTS + trgm, RRF) on ingested corpus ──")
from app.services.retrieval import hybrid_search, rrf_fuse
q = "liquidated damages rate for delay"
res = hybrid_search(q, scheme_id=74, qvec=hash_embed(q), embedding_model="test-hash-768")
ok("all three arms ran", set(res["arms_used"]) == {"vector", "fts", "trgm"}, str(res["arms_used"]))
ok("LD clause is top hit", res["chunks"] and "0.5%" in res["chunks"][0]["chunk_text"],
   res["chunks"][0]["chunk_text"][:80] if res["chunks"] else "no chunks")
ok("provenance shows multi-arm match", len(res["chunks"][0]["match_arms"]) >= 2,
   str(res["chunks"][0]["match_arms"]))
ok("citations returned", res["cited_document_ids"] and res["cited_chunk_ids"])

q2 = "dewatering issue near pit 4"
res2 = hybrid_search(q2, qvec=hash_embed(q2), embedding_model="test-hash-768")
texts2 = " ".join(c["chunk_text"] for c in res2["chunks"][:3]).lower()
ok("cross-channel: WhatsApp + letter both surfaced", "pump mobilized" in texts2
   and "ground water ingress" in texts2, texts2[:120])

res3 = hybrid_search("extension of time dewatering")  # NO vector arm (embedder offline)
ok("degrades gracefully without embedder",
   res3["chunks"] and "vector" not in res3["arms_used"])
ok("FTS-only still finds the letter", any("extension of 15 days" in c["chunk_text"].lower()
   or "extension" in c["chunk_text"].lower() for c in res3["chunks"]))

fused = rrf_fuse({"a": [{"chunk_id": 1, "score": .9}, {"chunk_id": 2, "score": .5}],
                  "b": [{"chunk_id": 2, "score": .8}, {"chunk_id": 3, "score": .4}]})
ok("RRF math: 2-arm chunk beats 1-arm", fused[0]["chunk_id"] == 2
   and abs(fused[0]["rrf"] - (1/62 + 1/61)) < 1e-9)

print("── M5: LLM tool registration + orchestrator prompt injection ──")
import app.tools.retrieval_tools  # registers
from app.tools.db_tools import TOOL_REGISTRY, call_tool
names = [t["name"] for t in TOOL_REGISTRY]
ok("3 new tools registered", all(n in names for n in
   ("resolve_entity", "hybrid_search_documents", "export_knowledge_bundle")))
tr = call_tool("resolve_entity", {"text": "con-7 progress"})
ok("resolve_entity tool → scheme 74 cited", 74 in (tr.get("cited_scheme_ids") or [])
   or any(c["entity_id"] == 74 for c in tr.get("resolved", []) + tr.get("suggestions", [])))
th = call_tool("hybrid_search_documents", {"query": "liquidated damages", "scheme_id": 74})
ok("hybrid tool returns chunks", bool(th.get("chunks")))

import app.services.orchestrator as orch
sysp = orch.get_prompt_with_portfolio_hint("what is the status of con-7?")
ok("RESOLVED ENTITIES block injected into system prompt",
   "RESOLVED ENTITIES" in sysp and ("COB-7" in sysp), sysp[-300:])
sysp2 = orch.get_prompt_with_portfolio_hint("hello how are you")
ok("no entity block for entity-free chat", "RESOLVED ENTITIES" not in sysp2)

print("── M6: OKF bundle export + validation ──")
from app.services.okf_export import export_okf_bundle, validate_okf_bundle
man = export_okf_bundle("/tmp/okf_test.zip")
ok("bundle exported", os.path.exists("/tmp/okf_test.zip"))
ok("entities include schemes+packages", man["counts"]["entities"] > 150)
ok("chunks exported", man["counts"]["chunks"] >= 4)
val = validate_okf_bundle("/tmp/okf_test.zip")
ok("bundle validates (checksums + jsonl)", val["valid"] is True)
with __import__("zipfile").ZipFile("/tmp/okf_test.zip") as z:
    ent_lines = z.read("entities.jsonl").decode().splitlines()
    cob7 = [json.loads(l) for l in ent_lines if '"scheme:74"' in l]
ok("COB-7 entity in bundle with aliases", cob7 and "COB-7" in (cob7[0]["aliases"] + [cob7[0]["code"]]))

conn.close()
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
