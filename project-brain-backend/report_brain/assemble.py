"""
report_brain.assemble — turn a format spec + the Fact Store into a fully
resolved document (list of rendered blocks) that the frontend shows as the
actual report and edits inline. The SAME resolved blocks drive docx export,
so what you see is what you download.

resolve_document(family, project, month, store, figures) -> {title, blocks:[...]}
where each block is display-ready:
  heading {roman?, text}
  para    {text}
  table   {title, columns, rows, editable_cells, note?}   figures/manpower/milestones
  narrative {section, title, bullets:[{text, discipline, grounded, draft, source_ref}]}
"""
from __future__ import annotations

from report_brain.formats import family_spec
from report_brain.composer import compose_present_status
from report_brain.issues_actions import compose_actions, compose_issues, classify_commitments
from report_brain.figures import manpower_average


def _project_display(project: str, names: dict | None) -> str:
    return (names or {}).get(project, project)


def _figrows(source: str, ctx: dict) -> list[list]:
    """Resolve a figure table's rows from provided context (DB-derived upstream)."""
    rows = ctx.get(source, [])
    if not rows:
        return []
    if isinstance(rows, dict):
        return [list(rows.values())]
    if isinstance(rows, (list, tuple)) and rows and not isinstance(rows[0], (list, tuple, dict)):
        return [list(rows)]
    out: list[list] = []
    for row in rows:
        if isinstance(row, dict):
            out.append(list(row.values()))
        elif isinstance(row, (list, tuple)):
            out.append(list(row))
        else:
            out.append([row])
    return out


def resolve_document(family: str, project: str, month: str, store,
                     figures_ctx: dict | None = None,
                     project_names: dict | None = None,
                     all_projects: list[str] | None = None,
                     as_of: str = "") -> dict:
    spec = family_spec(family)
    ctx = figures_ctx or {}
    projects = all_projects or [project]

    # compose per project once (cache)
    composed: dict[str, dict] = {}
    for p in projects:
        status = store.atoms_for(p, month, "status")
        acts = store.atoms_for(p, month, "action")
        iss = store.atoms_for(p, month, "issue")
        commits = [a for a in store.atoms_for(p, month) if a.get("kind") == "commitment"]
        classified = classify_commitments(commits, status, as_of=as_of or f"{month}-30")
        composed[p] = {
            "present_status": compose_present_status(status),
            "issues": compose_issues(iss, classified),
            "actions": compose_actions(acts, classified),
            "manpower": manpower_average(store.atoms_for(p, month, "manpower")),
        }

    out_blocks: list[dict] = []
    for blk in spec["blocks"]:
        t = blk["type"]
        if t == "heading":
            out_blocks.append({"kind": "heading", "roman": blk.get("roman", ""), "text": blk["text"]})
        elif t == "para":
            out_blocks.append({"kind": "para", "text": blk["text"], "editable": True})
        elif t == "figtable":
            out_blocks.append({"kind": "table", "title": blk["title"], "columns": blk["columns"],
                               "rows": _figrows(blk["rows_source"], ctx), "source": "figures",
                               "editable_cells": True})
        elif t == "blank":
            out_blocks.append({"kind": "table", "title": blk["title"], "columns": blk["columns"],
                               "rows": [[r] + [""] * (len(blk["columns"]) - 1) for r in blk["rows"]],
                               "source": "blank", "note": blk.get("note", ""), "editable_cells": True})
        elif t == "manpower":
            mp = ctx.get("manpower") or composed[project]["manpower"]
            out_blocks.append({"kind": "table", "title": blk["title"],
                               "columns": ["Agency / Category", "Average Engaged", "Reporting Days"],
                               "rows": [[m["category"], int(m["average"]), m["days"]] for m in mp],
                               "source": "manpower", "editable_cells": True})
        elif t == "milestones":
            ms = ctx.get("milestones", [])
            out_blocks.append({"kind": "table", "title": blk["title"],
                               "columns": ["Milestone", "Orig. Completion", "Anticipated", "Reasons"],
                               "rows": [[m.get("name", ""), m.get("orig", ""), m.get("anticipated", ""), m.get("reason", "")] for m in ms],
                               "source": "masters", "editable_cells": True})
        elif t == "narrative":
            sect = blk["section"]
            if blk.get("all_projects"):
                for p in projects:
                    bl = composed[p][sect]
                    out_blocks.append({"kind": "narrative", "section": sect,
                                       "title": f"{_project_display(p, project_names)}",
                                       "project": p, "style": blk.get("style", ""), "bullets": bl})
            else:
                bl = composed[project][sect]
                out_blocks.append({"kind": "narrative", "section": sect, "title": blk["title"],
                                   "project": project, "style": blk.get("style", ""), "bullets": bl})
    return {"family": family, "title": spec["title"],
            "project": _project_display(project, project_names), "month": month,
            "blocks": out_blocks}
