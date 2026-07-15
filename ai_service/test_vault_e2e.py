"""Document Vault e2e — real DB + real HTTP via FastAPI TestClient.
Verifies: original-file preservation (byte-exact), auto keyword labeling,
list/filter/detail/download/patch/delete endpoints, keyword-filtered hybrid
search, and the AI-facing vault tools."""
import hashlib
import io
import json
import os
import re
import sys

os.environ.setdefault("PROJECT_BRAIN_DB_URL", "postgresql://postgres@/project_brain?host=/home/claude/pg/sock&port=5599")
os.environ.setdefault("EMBED_MODEL", "test-hash-768")
os.environ.setdefault("UPLOAD_DIR", "/home/claude/work/vault_uploads")

sys.path.insert(0, ".")

PASS = 0; FAIL = 0
def ok(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  PASS  {name}")
    else: FAIL += 1; print(f"  FAIL  {name}  {detail}")

print("── K1: keyword extraction engine ──")
from app.ingestion.keywords import extract_keywords, merge_keywords
CONTRACT_TEXT = """CLAUSE 12 LIQUIDATED DAMAGES
If the Contractor fails to achieve completion of COB-7 works within the time
for completion, the Contractor shall pay liquidated damages (LD) at 0.5% of the
contract price per week of delay. PMC shall certify the delay period. The
liquidated damages shall not exceed 10% of the contract price. Dewatering
delays attributable to the Employer shall be excluded from LD computation.
Dewatering records shall be maintained daily."""
kw = extract_keywords(CONTRACT_TEXT, title="COB-7 Main Contract — LD clause")
ok("code token COB-7 labeled", "COB-7" in kw, str(kw))
ok("domain acronyms LD & PMC labeled", "LD" in kw and "PMC" in kw, str(kw))
ok("salient terms present", any(t in kw for t in ("liquidated", "damages", "dewatering")), str(kw))
ok("stopwords excluded", not any(t in kw for t in ("shall", "the", "within")))
merged = merge_keywords(["auto1", "shared"], ["Manual-A", "shared"], ["COB-7"])
ok("merge order manual>entity>auto, deduped",
   merged[:3] == ["Manual-A", "shared", "COB-7"] and merged.count("shared") == 1, str(merged))

print("── K2: vault API over real HTTP (TestClient) ──")
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(client_app := app)

# clean slate for deterministic assertions
import psycopg2
conn = psycopg2.connect(os.environ["PROJECT_BRAIN_DB_URL"]); conn.autocommit = True
cur = conn.cursor()
cur.execute("DELETE FROM document_embeddings; DELETE FROM document_chunks; DELETE FROM documents;")

pdf_like = ("COB-7 MAIN CONTRACT\n\n" + CONTRACT_TEXT + "\n\nCLAUSE 13 ARBITRATION\n"
            "Disputes shall be referred to arbitration under the Arbitration and "
            "Conciliation Act. The seat of arbitration shall be Rourkela.").encode()
r = client.post("/ai/ingest/upload",
                files={"file": ("cob7_contract.txt", io.BytesIO(pdf_like), "text/plain")},
                data={"document_type": "contract", "title": "COB-7 Main Contract",
                      "scheme_id": "74", "keywords": "priority, legal"})
ok("upload 200", r.status_code == 200, r.text[:200])
up = r.json()
doc_id = up.get("document_id")
ok("original stored on disk", up.get("original_stored") and os.path.exists(up["file_path"]))
ok("contract chunked by clause", up.get("chunks", 0) >= 2, str(up))

with open(up["file_path"], "rb") as f:
    ok("stored original byte-exact (sha256)",
       hashlib.sha256(f.read()).hexdigest() == hashlib.sha256(pdf_like).hexdigest())

r = client.get(f"/ai/ingest/documents/{doc_id}")
det = r.json()
ok("detail returns doc + chunk previews", r.status_code == 200
   and det["document"]["document_id"] == doc_id and len(det["chunks"]) >= 2)
kws = det["document"]["keywords"] or []
ok("manual labels first", kws[:2] == ["priority", "legal"], str(kws))
ok("auto labels include COB-7 + LD", "COB-7" in kws and "LD" in kws, str(kws))

r = client.get(f"/ai/ingest/documents/{doc_id}/download")
ok("download returns exact original bytes", r.status_code == 200 and r.content == pdf_like)

# paste-text WhatsApp ingest
wa = """12/06/26, 09:14 - Sharma PMC: Dewatering at COB-7 pit 4 resumed, LD exposure reviewed
12/06/26, 09:20 - Verma L&T: Noted, daily dewatering log shared"""
r = client.post("/ai/ingest/text", json={"text": wa, "kind": "whatsapp",
                                         "title": "COB-7 site group", "scheme_id": 74})
ok("text ingest 200", r.status_code == 200, r.text[:200])
wa_doc = r.json()["document_id"]

# list + filters
r = client.get("/ai/ingest/documents")
ok("list shows both docs", r.json()["total"] == 2, str(r.json()["total"]))
r = client.get("/ai/ingest/documents", params={"document_type": "contract"})
ok("type filter", r.json()["total"] == 1 and r.json()["documents"][0]["document_id"] == doc_id)
r = client.get("/ai/ingest/documents", params={"keyword": "ld"})
ok("keyword filter case-insensitive across docs", r.json()["total"] >= 1)
r = client.get("/ai/ingest/documents", params={"channel": "whatsapp"})
ok("channel filter", r.json()["total"] == 1 and r.json()["documents"][0]["document_id"] == wa_doc)

r = client.get("/ai/ingest/keywords")
cloud = {k["keyword"]: k["n"] for k in r.json()}
ok("keyword cloud aggregates", "COB-7" in cloud and cloud["COB-7"] >= 2, str(list(cloud)[:8]))

r = client.patch(f"/ai/ingest/documents/{doc_id}/keywords",
                 json={"keywords": ["COB-7", "LD", "arbitration", "final"]})
ok("labels editable", r.status_code == 200 and "arbitration" in r.json()["keywords"])

r = client.get("/ai/ingest/schemes")
ok("scheme picker endpoint", r.status_code == 200 and any(s["scheme_id"] == 74 for s in r.json()))

print("── K3: keyword-scoped retrieval + AI tools ──")
# embed with the deterministic test embedder so the vector arm participates
from app.ingestion.ingest_v2 import embed_and_store
import math
def hash_embed(text):
    vec = [0.0]*768
    for tok in re.findall(r"[a-z0-9]+", text.lower()):
        h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
        vec[h % 768] += 1.0
    n = math.sqrt(sum(v*v for v in vec)) or 1.0
    return [v/n for v in vec]
cur.execute("SELECT chunk_id FROM document_chunks")
embed_and_store([r0[0] for r0 in cur.fetchall()], embedder=hash_embed)

from app.services.retrieval import hybrid_search
res = hybrid_search("dewatering delay", keyword="arbitration",
                    qvec=hash_embed("dewatering delay"), embedding_model="test-hash-768")
ok("keyword scope: only labelled doc searched",
   res["chunks"] and all(c["document_id"] == doc_id for c in res["chunks"]), str(res)[:150])
res2 = hybrid_search("dewatering log", qvec=hash_embed("dewatering log"),
                     embedding_model="test-hash-768")
ok("unscoped search reaches WhatsApp doc too",
   any(c["document_id"] == wa_doc for c in res2["chunks"]))
ok("chunks carry keywords for citation UI",
   all("keywords" in c for c in res2["chunks"]))

from app.tools.db_tools import call_tool, TOOL_REGISTRY
names = [t["name"] for t in TOOL_REGISTRY]
ok("list_ingested_documents registered", "list_ingested_documents" in names)
tl = call_tool("list_ingested_documents", {"keyword": "LD"})
ok("AI can browse vault by label", any(d["document_id"] == doc_id for d in tl["documents"]))
th = call_tool("hybrid_search_documents", {"query": "arbitration seat", "keyword": "arbitration"})
ok("AI keyword-scoped search finds arbitration clause",
   th["chunks"] and "Rourkela" in th["chunks"][0]["chunk_text"], str(th)[:150])

r = client.delete(f"/ai/ingest/documents/{wa_doc}")
ok("soft delete", r.status_code == 200)
r = client.get("/ai/ingest/documents")
ok("deleted doc hidden from list", r.json()["total"] == 1)
cur.execute("SELECT file_path FROM documents WHERE document_id=%s", (wa_doc,))
ok("original retained after delete (audit)", os.path.exists(cur.fetchone()[0]))

print("── K4: OKF carries labels ──")
from app.services.okf_export import export_okf_bundle
import zipfile
export_okf_bundle("/tmp/okf_kw.zip")
with zipfile.ZipFile("/tmp/okf_kw.zip") as z:
    lines = [json.loads(l) for l in z.read("chunks.jsonl").decode().splitlines() if l.strip()]
ok("chunks.jsonl includes document keywords",
   lines and any("COB-7" in (l["document"].get("keywords") or []) for l in lines))

conn.close()
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
