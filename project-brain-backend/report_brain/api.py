"""
report_brain.api — FastAPI surface for Report Studio.

  POST /report-brain/ingest        upload a source file -> atoms into the store
  POST /report-brain/quick-note    type a note directly -> atom (first-class source)
  GET  /report-brain/projects      projects with atom counts for a month
  POST /report-brain/compose       compose all sections for a project/month
  GET  /report-brain/review        get composed sections with per-bullet citations
  POST /report-brain/edit          human correction -> store + taught-facts loop
  POST /report-brain/generate      render the report family -> downloadable file
  GET  /report-brain/commitments   commitment lifecycle board for a project

The store is process-global (MemStore for dev; swap to the DB repo in prod —
same surface). Every compose is grounded; every edit is captured for learning.
"""
from __future__ import annotations

import os
import tempfile
import time
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from report_brain.atoms import AliasRegistry, Atom
from report_brain.whatsapp import parse_whatsapp
from report_brain.recordnotes import parse_record_notes
from report_brain.dpr import extract_dpr
from report_brain.factstore import MemStore
from report_brain.composer import compose_present_status, render_prose
from report_brain.issues_actions import (
    classify_commitments, compose_actions, compose_issues,
)
from report_brain.figures import manpower_average
from report_brain.render_pmc import render_pmc

router = APIRouter(prefix="/report-brain", tags=["report-brain"])

REG = AliasRegistry(path=os.environ.get("RB_ALIASES", "report_brain_aliases.json"))
STORE = MemStore()
_COMMITMENTS: dict[str, list] = {}          # project -> classified commitments
OUT_DIR = os.environ.get("RB_OUT", tempfile.gettempdir())


# --------------------------------------------------------------- ingest
@router.post("/ingest")
async def ingest(file: UploadFile = File(...), month: str = Form(...),
                 kind: str = Form("auto"), project: str = Form("")) -> dict:
    raw = await file.read()
    name = file.filename or "upload"
    suffix = name.rsplit(".", 1)[-1].lower()
    added = {"whatsapp": 0, "status": 0, "manpower": 0, "actions": 0, "issues": 0, "commitments": 0}
    staging: list[dict] = []

    if suffix == "txt":
        atoms = parse_whatsapp(raw.decode("utf-8", "ignore"), REG, month=month)
        STORE.add_atoms(atoms, month)
        added["whatsapp"] = len(atoms)
    elif suffix in ("xlsx", "xls"):
        tmp = os.path.join(OUT_DIR, f"_ing_{int(time.time()*1000)}.{suffix}")
        open(tmp, "wb").write(raw)
        res = extract_dpr(tmp, REG, as_on=f"{month}-30")
        STORE.add_atoms(res.status_atoms, month)
        STORE.add_atoms(res.manpower_atoms, month)
        added["status"] = len(res.status_atoms)
        added["manpower"] = len(res.manpower_atoms)
        staging = [s.__dict__ for s in res.progress]  # for S-curve confirm screen
        os.remove(tmp)
    elif suffix in ("docx", "txt_rn"):
        if suffix == "docx":
            from docx import Document

            tmp = os.path.join(OUT_DIR, f"_ing_{int(time.time()*1000)}.{suffix}")
            open(tmp, "wb").write(raw)
            try:
                text = "\n".join(p.text for p in Document(tmp).paragraphs)
            finally:
                os.remove(tmp)
        else:
            text = raw.decode("utf-8", "ignore")
        notes = parse_record_notes(text, project=project or "UNKNOWN")
        STORE.add_atoms(notes, month)
        for a in notes:
            added[a.kind if a.kind in added else "actions"] = added.get(a.kind, 0) + 1
    else:
        raise HTTPException(422, f"unsupported source type: {suffix}")

    return {"file": name, "month": month, "added": added,
            "staging_rows": staging, "total_atoms": len(STORE.atoms)}


class QuickNote(BaseModel):
    project: str
    month: str
    text: str
    section: str = "status"       # status | issue | action
    discipline: str = ""
    date: str = ""


@router.post("/quick-note")
async def quick_note(n: QuickNote) -> dict:
    a = Atom(kind=n.section, date=n.date or f"{n.month}-15", project=n.project,
             section_affinity=n.section, discipline=n.discipline, text=n.text.strip(),
             source_type="manual", source_ref=f"manual:{int(time.time())}", author="user")
    STORE.add_atoms([a], n.month)
    return {"added": True, "project": n.project, "total_atoms": len(STORE.atoms)}


@router.get("/projects")
async def projects(month: str) -> dict:
    counts: dict[str, dict] = {}
    for a in STORE.atoms:
        if a["month"] != month:
            continue
        p = counts.setdefault(a["project"], {"status": 0, "issue": 0, "action": 0, "manpower": 0})
        aff = a.get("section_affinity", "status")
        p[aff] = p.get(aff, 0) + 1
    return {"month": month, "projects": counts}


# --------------------------------------------------------------- compose
class ComposeIn(BaseModel):
    project: str
    month: str
    as_of: str = ""


@router.post("/compose")
async def compose(c: ComposeIn) -> dict:
    status_atoms = STORE.atoms_for(c.project, c.month, "status")
    action_atoms = STORE.atoms_for(c.project, c.month, "action")
    issue_atoms = STORE.atoms_for(c.project, c.month, "issue")
    manpower_atoms = STORE.atoms_for(c.project, c.month, "manpower")
    commit_atoms = [a for a in STORE.atoms_for(c.project, c.month)
                    if a.get("kind") == "commitment"]

    classified = classify_commitments(commit_atoms, status_atoms,
                                      as_of=c.as_of or f"{c.month}-30")
    _COMMITMENTS[c.project] = classified

    present = compose_present_status(status_atoms)
    actions = compose_actions(action_atoms, classified)
    issues = compose_issues(issue_atoms, classified)
    manpower = manpower_average(manpower_atoms)

    STORE.put_narrative(c.project, c.month, "present_status", present)
    STORE.put_narrative(c.project, c.month, "issues", issues)
    STORE.put_narrative(c.project, c.month, "actions", actions)

    return {
        "project": c.project, "month": c.month,
        "present_status": present, "issues": issues, "actions": actions,
        "manpower": manpower,
        "grounding": {
            "present_grounded": sum(b["grounded"] for b in present),
            "present_total": len(present),
            "auto_slippage": sum(1 for b in issues if b.get("draft")),
        },
        "commitments": {
            "met": sum(1 for x in classified if x["lifecycle"] == "met"),
            "open": sum(1 for x in classified if x["lifecycle"] == "open"),
            "missed": sum(1 for x in classified if x["lifecycle"] == "missed"),
        },
    }


# --------------------------------------------------------------- edit (learn)
class EditIn(BaseModel):
    project: str
    month: str
    section_type: str
    before_text: str
    after_text: str
    kind: str = "phrasing"        # phrasing | fact | structure


@router.post("/edit")
async def edit(e: EditIn) -> dict:
    """Persist a correction and feed the taught-facts learning loop."""
    learned = None
    try:
        from app.tools.memory_tools import remember_fact
        if e.kind == "fact":
            remember_fact(subject=f"{e.project} report fact",
                          fact=f"{e.before_text} -> {e.after_text}", authority=True)
            learned = "fact"
        elif e.kind == "phrasing":
            remember_fact(subject=f"{e.project} phrasing preference",
                          fact=f"prefer '{e.after_text}' over '{e.before_text}'", authority=False)
            learned = "phrasing"
    except Exception:
        pass
    # update the stored narrative bullet in place
    key = (e.project, e.month, e.section_type)
    nar = STORE.narratives.get(key)
    if nar:
        for b in nar["body"]:
            if b.get("text") == e.before_text:
                b["text"] = e.after_text
                b["edited"] = True
    return {"saved": True, "learned": learned}


@router.get("/commitments")
async def commitments(project: str) -> dict:
    return {"project": project, "commitments": _COMMITMENTS.get(project, [])}


# --------------------------------------------------------------- generate
class GenerateIn(BaseModel):
    project: str
    project_name: str
    month: str
    month_label: str
    family: str = "pmc"           # pmc | do | agenda | capex | wpr
    progress_rows: list = []
    milestones: list = []
    officials: str = ""


@router.post("/generate")
async def generate(g: GenerateIn) -> dict:
    present = STORE.narratives.get((g.project, g.month, "present_status"), {}).get("body", [])
    issues = STORE.narratives.get((g.project, g.month, "issues"), {}).get("body", [])
    actions = STORE.narratives.get((g.project, g.month, "actions"), {}).get("body", [])
    manpower = manpower_average(STORE.atoms_for(g.project, g.month, "manpower"))

    fname = f"{g.family.upper()}_{g.project}_{g.month}.docx".replace(" ", "_")
    out_path = os.path.join(OUT_DIR, fname)
    if g.family == "pmc":
        render_pmc(out_path, project_name=g.project_name, month_label=g.month_label,
                   progress_rows=g.progress_rows, present_status=present,
                   issues=issues, actions=actions, milestones=g.milestones,
                   manpower=manpower, officials=g.officials)
    else:
        # other families share the store; renderers land in later increments
        render_pmc(out_path, project_name=g.project_name, month_label=g.month_label,
                   progress_rows=g.progress_rows, present_status=present,
                   issues=issues, actions=actions, milestones=g.milestones,
                   manpower=manpower, officials=g.officials)
    return {"file": fname, "path": out_path, "download": f"/report-brain/download/{fname}"}


@router.get("/download/{fname}")
async def download(fname: str):
    path = os.path.join(OUT_DIR, os.path.basename(fname))
    if not os.path.exists(path):
        raise HTTPException(404, "file not found")
    return FileResponse(path, filename=fname,
                        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


# --------------------------------------------------------------- live document
from report_brain.assemble import resolve_document
from report_brain.render_doc import render_document


class DocIn(BaseModel):
    family: str = "pmc"
    project: str
    month: str
    all_projects: list = []
    figures_ctx: dict = {}
    project_names: dict = {}
    as_of: str = ""


@router.post("/document")
async def document(d: DocIn) -> dict:
    """Return the fully resolved, editable document for a family (screen == file)."""
    return resolve_document(d.family, d.project, d.month, STORE,
                            figures_ctx=d.figures_ctx, project_names=d.project_names,
                            all_projects=d.all_projects or None, as_of=d.as_of)


class DocExport(BaseModel):
    resolved: dict
    filename: str = "report.docx"


@router.post("/document/export")
async def document_export(x: DocExport) -> dict:
    fname = os.path.basename(x.filename)
    path = os.path.join(OUT_DIR, fname)
    render_document(x.resolved, path)
    return {"file": fname, "download": f"/report-brain/download/{fname}"}
