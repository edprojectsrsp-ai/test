"""
report_brain.formats — declarative format specs for all five report families.

Each family is a list of BLOCKS the renderer walks. A block is one of:
  heading   {roman, text, underline}
  para      {text}                              (static register lines)
  figtable  {title, columns, rows_source}       (figures from DB, auto-filled)
  narrative {section, title}                     (composed, inline-editable)
  blank     {title, columns, note}               (format-preserving empty table)
  manpower  {title}                              (averaged from DPR)
  milestones{title}

The frontend renders these live so the on-screen document IS the output format;
'docx' export walks the SAME spec, guaranteeing screen == file.
This preserves each project family's exact language & structure.
"""
from __future__ import annotations

# ---- DO Letter (Dir -> Chairman) -------------------------------------------
DO_LETTER = {
    "family": "do",
    "title": "D.O. Letter — Director to Chairman",
    "register": "formal_do",
    "blocks": [
        {"type": "para", "text": "Dear Sir,"},
        {"type": "para", "text": "Please find below the physical and financial progress of major projects at RSP for the month, submitted for your kind perusal."},
        {"type": "heading", "text": "Production Performance: PPC"},
        {"type": "blank", "title": "Production Performance (PPC)",
         "columns": ["Parameters", "Month (T)", "% Growth over prev month", "% Growth over CPLY",
                     "Apr–Month CY (T)", "Apr–Month PY (T)", "% Growth over CPLY"],
         "rows": ["Total Crude Steel Production", "Total Finished Steel Production", "OGOM Production"],
         "note": "PPC production figures are supplied by Operations; table preserved blank to retain format."},
        {"type": "para", "text": "The reason for the shortfall is provided in the Annexure."},
        {"type": "heading", "text": "Capital Expenditure (CAPEX): PROJECTS"},
        {"type": "figtable", "title": "Capital Expenditure (₹ Cr)",
         "columns": ["Expenditure Head", "Actual (Month)", "Target (Month)", "Actual (Cumulative)", "Target (Cumulative)"],
         "rows_source": "capex_heads"},
        {"type": "heading", "text": "Expansion Projects and Key Projects Progress: PROJECTS"},
        {"type": "narrative", "section": "present_status", "title": "Project-wise Progress",
         "style": "do_bullets", "all_projects": True},
    ],
}

# ---- PMC Monthly Progress Report (per project) -----------------------------
PMC_REPORT = {
    "family": "pmc",
    "title": "PMC — Monthly Progress Report",
    "register": "pmc",
    "blocks": [
        {"type": "heading", "roman": "I", "text": "Progress of the Project"},
        {"type": "figtable", "title": "Discipline-wise Progress",
         "columns": ["Brief Description of Progress (Main package)",
                     "Overall % Target till the month", "Cumulative % completion till the month",
                     "% achievement for the month"],
         "rows_source": "pmc_discipline"},
        {"type": "heading", "roman": "II", "text": "Present Status of the Project"},
        {"type": "narrative", "section": "present_status", "title": "Present Status", "style": "pmc_bullets"},
        {"type": "heading", "roman": "III", "text": "Reasons / Issues / Constraints"},
        {"type": "narrative", "section": "issues", "title": "Issues", "style": "pmc_bullets"},
        {"type": "heading", "roman": "IV", "text": "Action Taken"},
        {"type": "narrative", "section": "actions", "title": "Actions Taken", "style": "pmc_bullets"},
        {"type": "heading", "roman": "V", "text": "Milestones reported on OCMS portal of MoSPI"},
        {"type": "milestones", "title": "OCMS Milestones"},
        {"type": "heading", "roman": "VI", "text": "Manpower Engaged"},
        {"type": "manpower", "title": "Manpower Engaged (Average)"},
    ],
}

# ---- Board Agenda (Physical & Financial, PCSB) -----------------------------
BOARD_AGENDA = {
    "family": "agenda",
    "title": "Physical & Financial Progress — Board Agenda Note",
    "register": "agenda",
    "blocks": [
        {"type": "heading", "roman": "1", "text": "Status of Ongoing Projects"},
        {"type": "figtable", "title": "Portfolio Status",
         "columns": ["Category", "No. of Schemes", "Cost (₹ Cr)"],
         "rows_source": "portfolio_status"},
        {"type": "heading", "roman": "2", "text": "Project-wise Physical & Financial Progress"},
        {"type": "figtable", "title": "Master Table",
         "columns": ["Sl", "Scheme", "Cost (Net of ITC) / TPC", "Stage-II Approval",
                     "Scheduled Completion", "Expenditure till date", "Revised Completion", "Anticipated Completion"],
         "rows_source": "scheme_master"},
        {"type": "narrative", "section": "present_status", "title": "Present Status (per project)",
         "style": "agenda_blocks", "all_projects": True},
        {"type": "narrative", "section": "issues", "title": "Issues (per project)", "style": "agenda_blocks", "all_projects": True},
        {"type": "narrative", "section": "actions", "title": "Actions Taken (per project)", "style": "agenda_blocks", "all_projects": True},
    ],
}

# ---- CAPEX / MoS Format ----------------------------------------------------
CAPEX_MOS = {
    "family": "capex",
    "title": "CAPEX Monitoring — MoS Format",
    "register": "mos",
    "blocks": [
        {"type": "heading", "text": "CAPEX Overview"},
        {"type": "figtable", "title": "MoS CAPEX Format",
         "columns": ["Sl", "Head / Scheme", "Gross Cost", "Cum till last FY",
                     "BE (FY)", "RE (FY)", "Actual (YTD)", "Achv %"],
         "rows_source": "capex_mos"},
        {"type": "narrative", "section": "present_status", "title": "Salient Progress",
         "style": "mos_bullets", "all_projects": True},
    ],
}

# ---- WPR (generated weekly per project) ------------------------------------
WPR = {
    "family": "wpr",
    "title": "Weekly Progress Report",
    "register": "wpr",
    "blocks": [
        {"type": "figtable", "title": "Activity Progress (Weekly)",
         "columns": ["Activity", "UoM", "Scope", "Cum Plan (till date)", "Cum Actual (till date)",
                     "Plan (this week)", "Actual (this week)", "% Complete"],
         "rows_source": "wpr_activities"},
        {"type": "narrative", "section": "present_status", "title": "Progress Highlights", "style": "wpr_bullets"},
    ],
}

FAMILIES = {"do": DO_LETTER, "pmc": PMC_REPORT, "agenda": BOARD_AGENDA,
            "capex": CAPEX_MOS, "wpr": WPR}


def family_spec(family: str) -> dict:
    return FAMILIES.get(family, PMC_REPORT)
