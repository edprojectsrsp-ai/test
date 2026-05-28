from tkinter import *
from tkinter import ttk, messagebox
from database import get_projects_by_stage, update_project_stage, get_db_connection
import utils
from utils import normalize_buttons, keep_window_active, to_display_date, to_storage_date, parse_app_date, apply_page_watermark
from datetime import datetime
from tkcalendar import DateEntry

APPROVAL_FIELD_STAGES = [
    {
        "key": "formulation",
        "label": "Formulation Stage",
        "steps": [
            {"no": "1", "key": "acceptance_assignment_consultant", "name": "Acceptance of Assignment by Consultant", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "2", "key": "submission_fr_ts_eligibility", "name": "Submission of FR, TS & Eligibility Criteria", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "3", "key": "formulation_amount", "name": "Amount", "plant": True, "corporate": True, "board": True, "dataField": "Amount"},
            {"no": "4", "key": "finalisation_fr_ts", "name": "Finalisation of FR & TS", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "5", "key": "plant_level_pag", "name": "Plant Level PAG", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "6", "key": "forwarding_proposal_corporate", "name": "Forwarding Proposal to Corporate Office", "plant": False, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "6A", "key": "ec_meeting_stage1", "name": "EC Meeting", "plant": False, "corporate": True, "board": True, "dataField": "Date"},
        ],
    },
    {
        "key": "stage1",
        "label": "Stage-1 Clearance",
        "steps": [
            {"no": "7", "key": "cod_corporate_pag", "name": "COD / Corporate PAG", "plant": False, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "8", "key": "financial_concurrence_approval", "name": "Financial Concurrence & Approval", "plant": False, "corporate": True, "board": False, "dataField": "Date"},
            {"no": "9", "key": "independent_financial_appraisal", "name": "Independent Financial Appraisal", "plant": False, "corporate": False, "board": True, "dataField": "Date"},
            {"no": "10", "key": "agenda_note_chairman", "name": "Approval of Agenda Note by Chairman", "plant": False, "corporate": False, "board": True, "dataField": "Date"},
            {"no": "11", "key": "project_committee_sail_board", "name": "Project Committee of SAIL Board", "plant": False, "corporate": False, "board": True, "dataField": "Date"},
            {"no": "12", "key": "deliberation_approval_sail_board", "name": "Deliberation & Approval of SAIL Board", "plant": False, "corporate": False, "board": True, "dataField": "Date"},
            {"no": "13", "key": "sanction_letter_mandate_tendering", "name": "Issuance of Sanction Letter / Mandate for Tendering", "plant": False, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "14", "key": "stage1_approval", "name": "Stage-I Approval", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "15", "key": "stage1_cost", "name": "Stage-1 Cost", "plant": True, "corporate": True, "board": True, "dataField": "Amount"},
        ],
    },
    {
        "key": "tendering",
        "label": "Tendering Stage",
        "steps": [
            {"no": "16", "key": "receipt_proposal_plant_zone_shop", "name": "Receipt of Proposal in Plant / Zone / Shop", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "17", "key": "initiation_proposal_nit_approval", "name": "Initiation of Proposal for NIT Approval", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "18", "key": "approval_process_nit", "name": "Approval Process for NIT", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "19", "key": "uploading_nit", "name": "Uploading of NIT", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "20", "key": "opening_offers", "name": "Opening of Offers", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "21", "key": "sending_offers_consultant_shop", "name": "Sending Offers to Consultant / Shop for Evaluation", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "22", "key": "scrutiny_offers_consultant", "name": "Scrutiny of Offers by Consultant", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "23", "key": "issue_ter_tar", "name": "Issue of TER / TAR", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "24", "key": "tec_recommendation", "name": "TEC Recommendation", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "25", "key": "cec_recommendation", "name": "CEC Recommendation (if CET consultant)", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "26", "key": "tc_recommendation", "name": "TC Recommendation", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "27", "key": "approval_process_tc", "name": "Approval Process after TC", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "28", "key": "letters_revised_price_ra", "name": "Issue of Letters for Revised Price / RA", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "29", "key": "reverse_auction_revised_price", "name": "Reverse Auction / Revised Price Submission", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "30", "key": "ra_report_l1_breakup", "name": "Submission of RA Report with L-1 Breakup", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "31", "key": "price_evaluation_consultant", "name": "Price Evaluation by Consultant", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "32", "key": "tc_award_work", "name": "TC for Award of Work", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "33", "key": "approval_process_award", "name": "Approval Process for Award", "plant": True, "corporate": True, "board": True, "dataField": "Date"},
            {"no": "34", "key": "firming_up_cost", "name": "Firming Up of Cost", "plant": True, "corporate": True, "board": True, "dataField": "Amount"},
        ],
    },
    {
        "key": "stage2",
        "label": "Stage-2 Clearance",
        "steps": [
            {"no": "35", "key": "sending_proposal_stage2_approval", "name": "Sending Proposal for Stage-II Approval", "plant": True, "corporate": True, "board": True, "dataField": "Date", "plantAgency": "Plant Level Internal", "corporateAgency": "Corporate Office", "boardAgency": "Corporate Office / Board"},
            {"no": "36", "key": "stage2_approval", "name": "Stage-II Approval", "plant": True, "corporate": True, "board": True, "dataField": "Date", "plantAgency": "Plant Level", "corporateAgency": "Corporate Authority", "boardAgency": "Board / Corporate Authority"},
            {"no": "37", "key": "stage2_cost", "name": "Stage-II Cost", "plant": True, "corporate": True, "board": True, "dataField": "Amount"},
        ],
    },
]

STAGE_EDIT_TITLES = {
    "formulation": "Edit Formulation Details",
    "stage1": "Edit Stage-1 Details",
    "tendering": "Edit Tendering Details",
    "stage2": "Edit Stage-2 Details",
}


def ensure_approval_field_tables():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS project_approval_fields (
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            field_key TEXT NOT NULL,
            stage_key TEXT,
            stage_name TEXT,
            step_no TEXT,
            step_key TEXT,
            step_name TEXT,
            responsible_agency TEXT,
            data_field TEXT,
            field_value TEXT,
            updated_at TEXT,
            PRIMARY KEY (project_id, field_key)
        )
    """)
    for column_name in (
        "stage_key", "stage_name", "step_no", "step_key", "step_name",
        "responsible_agency", "data_field", "field_value", "updated_at",
    ):
        c.execute("""
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'project_approval_fields'
              AND column_name = %s
        """, (column_name,))
        if not c.fetchone():
            c.execute(f"ALTER TABLE project_approval_fields ADD COLUMN {column_name} TEXT")
    conn.commit()
    conn.close()


def approval_cost(project):
    for key in ("stage2_cost", "stage1_cost", "formulation_cost", "project_cost_cr"):
        value = project.get(key)
        if value not in (None, ""):
            try:
                return float(value)
            except (TypeError, ValueError):
                pass
    return None


def approval_category(project):
    cost = approval_cost(project)
    project_type = str(project.get("project_type") or "").strip()
    if cost is not None:
        if cost < 30:
            return "plant"
        if cost > 50:
            return "board"
        return "corporate"
    if "Board Approved" in project_type:
        return "board"
    if project_type == "Plant Level AMR":
        return "plant"
    return "corporate"


def approval_workflow_for_project(project, saved_values=None):
    saved_values = saved_values or {}
    category = approval_category(project)
    category_label = {
        "plant": "< Rs.30 Cr. Plant Level AMR Project",
        "corporate": "> Rs.30 Cr. & < Rs.50 Cr. Corporate AMR Project",
        "board": "> Rs.50 Cr. Corporate AMR Project (Board Approved)",
    }[category]
    stages = []
    for stage in APPROVAL_FIELD_STAGES:
        steps = []
        for step in stage["steps"]:
            field_key = f"{stage['key']}.{step['key']}"
            applicable = bool(step.get(category))
            default_agency = "Plant Level" if category == "plant" else "Corporate Office" if category == "corporate" else "Board / Corporate Authority"
            steps.append({
                **step,
                "fieldKey": field_key,
                "applicable": applicable,
                "responsibleAgency": step.get(f"{category}Agency") or default_agency,
                "value": saved_values.get(field_key, ""),
            })
        stages.append({**stage, "steps": steps})
    return {"category": category, "categoryLabel": category_label, "stages": stages}


def approval_step_metadata(project, field_key):
    workflow = approval_workflow_for_project(project, {})
    for stage in workflow["stages"]:
        for step in stage["steps"]:
            if step["fieldKey"] == field_key:
                return {
                    "stage_key": stage["key"],
                    "stage_name": stage["label"],
                    "step_no": step["no"],
                    "step_key": step["key"],
                    "step_name": step["name"],
                    "responsible_agency": step.get("responsibleAgency") or "",
                    "data_field": step["dataField"],
                }
    return None


class ProjectDetailsFrame(Frame):
    def __init__(self, parent, main_app=None):
        super().__init__(parent)
        self.main_app = main_app
        Label(self, text="Project Details - Stage-wise Tracking", font=("Arial", 16, "bold")).pack(pady=10)
        
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=BOTH, expand=True, padx=10, pady=5)
        
        self.tab_formulation = self.create_stage_tab(self.notebook, "Under Formulation", "formulation", "Edit Under Formulation Details")
        self.tab_stage1      = self.create_stage_tab(self.notebook, "Stage-1",         "stage1",      "Edit Stage-1 Details")
        self.tab_tendering   = self.create_stage_tab(self.notebook, "Tendering",       "tendering",   "Edit Tendering Details")
        self.tab_stage2      = self.create_stage_tab(self.notebook, "Stage-2",         "stage2",      "Edit Stage-2 Details")
        
        self.notebook.bind("<<NotebookTabChanged>>", self.refresh_current_tab)
        apply_page_watermark(self)
        normalize_buttons(self)

    def create_stage_tab(self, notebook, title, stage_key, button_text):
        frame = Frame(notebook)
        notebook.add(frame, text=title)
        
        columns = ("UID", "Name", "Type", "Status", "Dropped")
        tree_frame = Frame(frame)
        tree_frame.pack(fill=BOTH, expand=True, padx=5, pady=5)

        tree = ttk.Treeview(tree_frame, columns=columns, show="headings", height=12)
        tree.heading("UID", text="Unique ID")
        tree.heading("Name", text="Project Name")
        tree.heading("Type", text="Project Type")
        tree.heading("Status", text="Current Status")
        tree.heading("Dropped", text="Project Dropped")
        
        tree.column("UID", width=140)
        tree.column("Name", width=280)
        tree.column("Type", width=140)
        tree.column("Status", width=120)
        tree.column("Dropped", width=130, anchor="center")
        
        tree.pack(side=LEFT, fill=BOTH, expand=True)
        y_scroll = ttk.Scrollbar(tree_frame, orient="vertical", command=tree.yview)
        y_scroll.pack(side=RIGHT, fill=Y)
        x_scroll = ttk.Scrollbar(frame, orient="horizontal", command=tree.xview)
        x_scroll.pack(fill=X, padx=5)
        tree.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)
        
        frame.tree = tree
        frame.stage_key = stage_key
        
        self.load_stage_data(tree, stage_key)
        
        tree.bind("<Double-1>", lambda e, sk=stage_key, tr=tree: self.on_tree_double_click(e, tr, sk))
        tree.bind("<ButtonRelease-1>", lambda e, sk=stage_key, tr=tree: self.on_tree_click(e, tr, sk))
        
        btn_frame = Frame(frame)
        btn_frame.pack(pady=8)
        edit_state = NORMAL if not self.main_app or self.main_app.can_edit("project_details") else DISABLED
        Button(btn_frame, text=button_text, command=lambda tr=tree, sk=stage_key: self.open_edit_form(tr, sk),
               bg="#003087", fg="white", font=("Arial", 10, "bold"), width=30,
               state=edit_state).pack(side=LEFT, padx=10)
        
        Button(btn_frame, text="🔄 Refresh List", command=lambda tr=tree, sk=stage_key: self.load_stage_data(tr, sk),
               bg="#555", fg="white", font=("Arial", 10)).pack(side=LEFT, padx=10)
        
        return frame

    def load_stage_data(self, tree, stage_key):
        for item in tree.get_children():
            tree.delete(item)
        allowed_project_ids = self.main_app.get_allowed_project_ids() if self.main_app else None
        projects = get_projects_by_stage(stage_key, allowed_project_ids)
        for p in projects:
            status = utils.get_project_status(dict(p))
            dropped_mark = "☑" if p.get("project_dropped") == "Y" else "☐"
            tree.insert("", END, values=(
                p["unique_id"],
                p["project_name"],
                p["project_type"],
                status,
                dropped_mark,
            ))

    def on_tree_click(self, event, tree, stage_key):
        if self.main_app and not self.main_app.can_edit("project_details"):
            return
        if stage_key not in ("formulation", "stage1", "tendering", "stage2"):
            return
        region = tree.identify("region", event.x, event.y)
        row_id = tree.identify_row(event.y)
        column_id = tree.identify_column(event.x)
        if region != "cell" or not row_id or column_id != "#5":
            return

        item = tree.item(row_id)
        values = item.get("values", [])
        if len(values) < 5:
            return
        uid = values[0]
        current_checked = values[4] == "☑"

        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT id FROM projects WHERE unique_id=%s", (uid,))
        row = c.fetchone()
        conn.close()
        if not row:
            messagebox.showerror("Error", "Project not found.")
            return

        if current_checked:
            if not messagebox.askyesno("Clear Dropped Mark", f"Remove Project Dropped mark for project {uid}?"):
                return
            update_project_stage(row["id"], project_dropped="N")
        else:
            if not messagebox.askyesno("Project Dropped", f"Mark project {uid} as dropped?"):
                return
            update_project_stage(row["id"], project_dropped="Y")

        self.load_stage_data(tree, stage_key)

    def on_tree_double_click(self, event, tree, stage_key):
        if tree.identify("region", event.x, event.y) == "cell" and tree.identify_column(event.x) == "#5":
            return
        self.open_edit_form(tree, stage_key)

    def refresh_current_tab(self, event=None):
        current_tab = self.notebook.tab(self.notebook.select(), "text")
        if current_tab == "Under Formulation":
            self.load_stage_data(self.tab_formulation.tree, "formulation")
        elif current_tab == "Stage-1":
            self.load_stage_data(self.tab_stage1.tree, "stage1")
        elif current_tab == "Tendering":
            self.load_stage_data(self.tab_tendering.tree, "tendering")
        elif current_tab == "Stage-2":
            self.load_stage_data(self.tab_stage2.tree, "stage2")

    def _open_legacy_edit_form(self, tree, stage_key):
        if self.main_app and not self.main_app.can_edit("project_details"):
            messagebox.showwarning("Edit Denied", "You have view access only for Project Details.")
            return

        selected = tree.selection()
        if not selected:
            messagebox.showwarning("Select Project", "Please select a project row first.")
            return
        
        item = tree.item(selected[0])
        uid = item["values"][0]
        
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM projects WHERE unique_id=%s", (uid,))
        row = c.fetchone()
        conn.close()
        if not row:
            messagebox.showerror("Error", "Project not found.")
            return
        project = dict(row)
        if self.main_app and not self.main_app.can_access_project(project["id"]):
            messagebox.showwarning("Access Denied", "You do not have access to this project.")
            return
        
        edit_win = Toplevel(self)
        edit_win.title(f"Edit {stage_key.upper()} Details - {uid}")
        edit_win.geometry("780x720")
        edit_win.grab_set()
        
        Label(edit_win, text=f"Project: {project['project_name']} ({uid})", 
              font=("Arial", 12, "bold")).pack(pady=10)
        
        entries = {}
        f = Frame(edit_win)
        f.pack(pady=10, fill=X, padx=40)
        
        row_idx = 0
        
        def add_date_field(label_text, db_key, row_idx):
            Label(f, text=label_text).grid(row=row_idx, column=0, sticky=W, pady=8)
            date_var = StringVar()
            date_entry = Entry(f, width=25, textvariable=date_var)
            date_entry.grid(row=row_idx, column=1, pady=8)
            Button(f, text="📅", width=3, command=lambda dv=date_var: self.pick_date(dv)).grid(row=row_idx, column=2, padx=5)
            
            saved_date = project.get(db_key)
            if saved_date:
                date_var.set(to_display_date(saved_date))
            return date_entry, date_var
        
        if stage_key == "formulation":
            _, entries["dic_recommendation_date_var"] = add_date_field("DIC Recommendation Date (DD-MM-YY):", "dic_recommendation_date", row_idx)
            row_idx += 1
            Label(f, text="COD Cleared (Y/N):").grid(row=row_idx, column=0, sticky=W, pady=8)
            cod_clear_var = StringVar(value=project.get("cod_cleared", "N"))
            ttk.Combobox(f, textvariable=cod_clear_var, values=["Y", "N"], width=22, state="readonly").grid(row=row_idx, column=1, pady=8)
            entries["cod_cleared"] = cod_clear_var
        
        elif stage_key == "stage1":
            if project.get("project_type") == "Corporate AMR":
                Label(f, text="COM Project", fg="#003087", font=("Arial", 11, "bold")).grid(row=row_idx, column=0, sticky=W, pady=8)
                row_idx += 1
            _, entries["cod_date_var"] = add_date_field("COD Date (DD-MM-YY):", "cod_date", row_idx)
            row_idx += 1
            _, entries["stage1_date_var"] = add_date_field("Stage-1 Date (DD-MM-YY):", "stage1_date", row_idx)
            row_idx += 1
            Label(f, text="Stage-1 Cost (₹):").grid(row=row_idx, column=0, sticky=W, pady=8)
            s1_cost = Entry(f, width=25)
            s1_cost.grid(row=row_idx, column=1, pady=8)
            if project.get("stage1_cost") is not None:
                s1_cost.insert(0, str(project.get("stage1_cost")))
            entries["stage1_cost"] = s1_cost
            row_idx += 1
            Label(f, text="Stage-1 Cleared (Y/N):").grid(row=row_idx, column=0, sticky=W, pady=8)
            s1_clear_var = StringVar(value=project.get("stage1_cleared", "N"))
            ttk.Combobox(f, textvariable=s1_clear_var, values=["Y", "N"], width=22, state="readonly").grid(row=row_idx, column=1, pady=8)
            entries["stage1_cleared"] = s1_clear_var
        
        elif stage_key == "tendering":
            _, entries["expected_tod_var"] = add_date_field("Expected Tender Opening Date (DD-MM-YY):", "expected_tod_date", row_idx)
            row_idx += 1
            _, entries["final_tod_var"] = add_date_field("Final Tender Opening Date (DD-MM-YY):", "final_tod_date", row_idx)
            
            Label(edit_win, text="Previous Tender Opening Dates", font=("Arial", 10, "bold")).pack(pady=(20,5))
            tod_frame = Frame(edit_win)
            tod_frame.pack(fill=X, padx=40, pady=5)
            tod_tree = ttk.Treeview(tod_frame, columns=("No", "Date"), show="headings", height=6)
            tod_tree.heading("No", text="TOD No.")
            tod_tree.heading("Date", text="Date")
            tod_tree.pack(side=LEFT, fill=X, expand=True)
            tod_scroll = ttk.Scrollbar(tod_frame, orient="vertical", command=tod_tree.yview)
            tod_scroll.pack(side=RIGHT, fill=Y)
            tod_x_scroll = ttk.Scrollbar(edit_win, orient="horizontal", command=tod_tree.xview)
            tod_x_scroll.pack(fill=X, padx=40)
            tod_tree.configure(yscrollcommand=tod_scroll.set, xscrollcommand=tod_x_scroll.set)
            
            conn = get_db_connection()
            c = conn.cursor()
            c.execute("SELECT tod_number, tod_date FROM tods WHERE project_id = %s ORDER BY tod_number", (project["id"],))
            for r in c.fetchall():
                tod_tree.insert("", END, values=(r["tod_number"], to_display_date(r["tod_date"])))
            conn.close()
            
            add_f = Frame(edit_win)
            add_f.pack(pady=10)
            Label(add_f, text="Add New TOD Date (DD-MM-YY):").pack(side=LEFT)
            new_tod_var = StringVar()
            new_tod_entry = Entry(add_f, width=20, textvariable=new_tod_var)
            new_tod_entry.pack(side=LEFT, padx=5)
            Button(add_f, text="📅", width=3, command=lambda dv=new_tod_var: self.pick_date(dv)).pack(side=LEFT, padx=2)
            Button(add_f, text="➕ Add", command=lambda: self.add_tod(project["id"], new_tod_var, tod_tree)).pack(side=LEFT)
            entries["tod_tree"] = tod_tree
            
            cancel_btn = Button(edit_win, text="❌ Cancel Tender", bg="#c8102e", fg="white", 
                                font=("Arial", 11, "bold"), height=2,
                                command=lambda: self.cancel_tender(edit_win, project["id"], project["unique_id"]))
            cancel_btn.pack(pady=15, padx=40, fill=X)
        
        elif stage_key == "stage2":
            if project.get("project_type") == "Corporate AMR":
                Label(f, text="COM Project", fg="#003087", font=("Arial", 11, "bold")).grid(row=row_idx, column=0, sticky=W, pady=8)
                row_idx += 1
            _, entries["stage2_date_var"] = add_date_field("Stage-2 Date (DD-MM-YY):", "stage2_date", row_idx)
            row_idx += 1
            Label(f, text="Stage-2 Cost (₹):").grid(row=row_idx, column=0, sticky=W, pady=8)
            s2_cost = Entry(f, width=25)
            s2_cost.grid(row=row_idx, column=1, pady=8)
            if project.get("stage2_cost") is not None:
                s2_cost.insert(0, str(project.get("stage2_cost")))
            entries["stage2_cost"] = s2_cost
            row_idx += 1
            Label(f, text="Stage-2 Cleared (Y/N):").grid(row=row_idx, column=0, sticky=W, pady=8)
            s2_clear_var = StringVar(value=project.get("stage2_cleared", "N"))
            ttk.Combobox(f, textvariable=s2_clear_var, values=["Y", "N"], width=22, state="readonly").grid(row=row_idx, column=1, pady=8)
            entries["stage2_cleared"] = s2_clear_var
        
        Button(edit_win, text="SAVE & MOVE TO NEXT STAGE IF CLEARED", 
               command=lambda: self._save_legacy_stage_data(edit_win, project["id"], stage_key, entries, tree),
               bg="#008000", fg="white", font=("Arial", 12, "bold"), height=2).pack(pady=10, padx=40, fill=X)
        
        Label(edit_win, text="Note: Required stage dates must be filled before moving to next stage.", 
              fg="gray", font=("Arial", 9)).pack(pady=5)
        normalize_buttons(edit_win)

    def pick_date(self, date_var):
        cal_win = Toplevel()
        cal_win.title("Select Date")
        cal_win.geometry("320x300")
        cal_win.grab_set()
        cal = DateEntry(cal_win, width=25, date_pattern='dd-mm-yy', background='darkblue', foreground='white')
        cal.pack(pady=20)
        def set_date():
            date_var.set(cal.get_date().strftime("%d-%m-%y"))
            cal_win.destroy()
        def cancel():
            cal_win.destroy()
        Button(cal_win, text="Select This Date", command=set_date, bg="#003087", fg="white", width=20).pack(pady=8)
        Button(cal_win, text="Cancel", command=cancel, width=20).pack()
        normalize_buttons(cal_win)

    def add_tod(self, project_id, date_var, tree):
        date_str = date_var.get().strip()
        if not date_str:
            messagebox.showerror("Error", "Please select a TOD date")
            return
        try:
            storage_date = to_storage_date(date_str)
            if not storage_date:
                raise ValueError
        except ValueError:
            messagebox.showerror("Error", "Invalid date format. Use DD-MM-YY")
            return
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT MAX(tod_number) FROM tods WHERE project_id=%s", (project_id,))
        row = c.fetchone()
        max_no = (row.get("max") if row else 0) or 0
        next_no = max_no + 1
        c.execute("INSERT INTO tods (project_id, tod_number, tod_date) VALUES (%s,%s,%s)", (project_id, next_no, storage_date))
        conn.commit()
        conn.close()
        tree.insert("", END, values=(next_no, to_display_date(storage_date)))
        date_var.set("")
        messagebox.showinfo("Success", f"TOD #{next_no} added!")
        keep_window_active(tree.winfo_toplevel())

    def cancel_tender(self, parent_win, project_id, uid):
        if messagebox.askyesno("Tender Cancel", "Do you want to proceed for Retendering?"):
            ret_win = Toplevel(parent_win)
            ret_win.title(f"Retendering Data - {uid}")
            ret_win.geometry("500x300")
            ret_win.grab_set()
            
            Label(ret_win, text="Retendering Details", font=("Arial", 12, "bold")).pack(pady=15)
            
            f = Frame(ret_win)
            f.pack(pady=10, padx=40, fill=X)
            
            Label(f, text="Expected Retender Opening Date (DD-MM-YY):").grid(row=0, column=0, sticky=W, pady=8)
            exp_var = StringVar()
            Entry(f, width=25, textvariable=exp_var).grid(row=0, column=1, pady=8)
            Button(f, text="📅", width=3, command=lambda: self.pick_date(exp_var)).grid(row=0, column=2, padx=5)
            
            Label(f, text="Final Retender Opening Date (DD-MM-YY):").grid(row=1, column=0, sticky=W, pady=8)
            final_var = StringVar()
            Entry(f, width=25, textvariable=final_var).grid(row=1, column=1, pady=8)
            Button(f, text="📅", width=3, command=lambda: self.pick_date(final_var)).grid(row=1, column=2, padx=5)
            
            def save_retender():
                data = {
                    "tender_cancelled": "Y",
                    "retender_expected_date": to_storage_date(exp_var.get()),
                    "retender_final_date": to_storage_date(final_var.get())
                }
                update_project_stage(project_id, **data)
                messagebox.showinfo("Success", "Tender cancelled and Retendering data saved!")
                ret_win.destroy()
                parent_win.destroy()
                self.refresh_current_tab()
                keep_window_active(self)
            
            Button(ret_win, text="SAVE RETENDERING DATA", command=save_retender,
                   bg="#008000", fg="white", font=("Arial", 11, "bold")).pack(pady=20)
            normalize_buttons(ret_win)

    def _save_legacy_stage_data(self, win, project_id, stage_key, entries, tree):
        data = {}
        moving_to_next_stage = False
        
        if stage_key == "formulation":
            data["dic_recommendation_date"] = to_storage_date(entries["dic_recommendation_date_var"].get())
            data["cod_cleared"]             = entries["cod_cleared"].get()
            moving_to_next_stage = data["cod_cleared"] == "Y"
        elif stage_key == "stage1":
            data["cod_date"] = to_storage_date(entries["cod_date_var"].get())
            data["stage1_date"] = to_storage_date(entries["stage1_date_var"].get())
            try:
                cost_str = entries["stage1_cost"].get().strip()
                if cost_str != "":
                    data["stage1_cost"] = float(cost_str)
                else:
                    data["stage1_cost"] = None
            except ValueError:
                messagebox.showerror("Error", "Stage-1 Cost must be a number")
                return
            data["stage1_cleared"] = entries["stage1_cleared"].get()
            moving_to_next_stage = data["stage1_cleared"] == "Y"
        elif stage_key == "tendering":
            data["expected_tod_date"] = to_storage_date(entries["expected_tod_var"].get())
            data["final_tod_date"]    = to_storage_date(entries["final_tod_var"].get())
            moving_to_next_stage = bool(data["final_tod_date"])
        elif stage_key == "stage2":
            data["stage2_date"] = to_storage_date(entries["stage2_date_var"].get())
            try:
                cost_str = entries["stage2_cost"].get().strip()
                if cost_str != "":
                    data["stage2_cost"] = float(cost_str)
                else:
                    data["stage2_cost"] = None
            except ValueError:
                messagebox.showerror("Error", "Stage-2 Cost must be a number")
                return
            data["stage2_cleared"] = entries["stage2_cleared"].get()
            moving_to_next_stage = data["stage2_cleared"] == "Y"

        if moving_to_next_stage:
            required_dates = []
            if stage_key == "formulation":
                required_dates = [("DIC Recommendation Date", data.get("dic_recommendation_date"))]
            elif stage_key == "stage1":
                required_dates = [
                    ("COD Date", data.get("cod_date")),
                    ("Stage-1 Date", data.get("stage1_date")),
                ]
            elif stage_key == "tendering":
                required_dates = [
                    ("Expected Tender Opening Date", data.get("expected_tod_date")),
                    ("Final Tender Opening Date", data.get("final_tod_date")),
                ]
            elif stage_key == "stage2":
                required_dates = [("Stage-2 Date", data.get("stage2_date"))]

            missing_dates = [label for label, value in required_dates if not value]
            if missing_dates:
                messagebox.showerror(
                    "Required Dates Missing",
                    "Fill all required dates before moving to next stage:\n\n" + "\n".join(missing_dates),
                )
                keep_window_active(win)
                return
        
        update_project_stage(project_id, **data)
        
        self.load_stage_data(tree, stage_key)
        self.refresh_current_tab()
        
        if moving_to_next_stage:
            messagebox.showinfo("Success", f"Details saved for project ID {project_id}.\n\nProject moved to next stage.")
        else:
            messagebox.showinfo("Success", f"Details saved for project ID {project_id}.")
        win.destroy()
        keep_window_active(self)

    def open_edit_form(self, tree, stage_key):
        if self.main_app and not self.main_app.can_edit("project_details"):
            messagebox.showwarning("Edit Denied", "You have view access only for Project Details.")
            return

        selected = tree.selection()
        if not selected:
            messagebox.showwarning("Select Project", "Please select a project row first.")
            return

        uid = tree.item(selected[0])["values"][0]
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM projects WHERE unique_id=%s", (uid,))
        row = c.fetchone()
        conn.close()
        if not row:
            messagebox.showerror("Error", "Project not found.")
            return

        project = dict(row)
        if self.main_app and not self.main_app.can_access_project(project["id"]):
            messagebox.showwarning("Access Denied", "You do not have access to this project.")
            return

        ensure_approval_field_tables()
        saved_values = self.load_approval_values(project["id"])
        workflow = approval_workflow_for_project(project, saved_values)
        workflow_stage = next((item for item in workflow["stages"] if item["key"] == stage_key), None)
        if not workflow_stage:
            messagebox.showerror("Error", "Approval workflow stage not found.")
            return

        edit_win = Toplevel(self)
        edit_win.title(f"{STAGE_EDIT_TITLES.get(stage_key, 'Edit Stage Details')} - {uid}")
        edit_win.geometry("1020x650")
        edit_win.minsize(920, 540)
        edit_win.grab_set()

        Label(edit_win, text=STAGE_EDIT_TITLES.get(stage_key, "Edit Stage Details"),
              font=("Arial", 15, "bold"), fg="#003087").pack(pady=(14, 8))

        project_box = Frame(edit_win, bg="#eaf2fb", highlightbackground="#b8c9dc", highlightthickness=1)
        project_box.pack(fill=X, padx=14, pady=(0, 18))
        Label(project_box, text=uid, font=("Arial", 12, "bold"), fg="#003087",
              bg="#eaf2fb", anchor=W).pack(fill=X, padx=12, pady=(10, 2))
        Label(project_box, text=project.get("project_name") or "", font=("Arial", 10, "bold"),
              fg="#22364d", bg="#eaf2fb", anchor=W).pack(fill=X, padx=12)
        Label(project_box, text=workflow["categoryLabel"], font=("Arial", 10, "bold"),
              fg="#526173", bg="#eaf2fb", anchor=W).pack(fill=X, padx=12, pady=(2, 10))

        table_outer = Frame(edit_win)
        table_outer.pack(fill=BOTH, expand=True, padx=14)
        canvas = Canvas(table_outer, highlightthickness=0)
        y_scroll = ttk.Scrollbar(table_outer, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=y_scroll.set)
        y_scroll.pack(side=RIGHT, fill=Y)
        canvas.pack(side=LEFT, fill=BOTH, expand=True)

        table = Frame(canvas)
        table_window = canvas.create_window((0, 0), window=table, anchor="nw")
        canvas.bind("<Configure>", lambda event: canvas.itemconfigure(table_window, width=event.width))
        table.bind("<Configure>", lambda event: canvas.configure(scrollregion=canvas.bbox("all")))

        headers = ("Sl. No.", "Workflow Activity / Approval Step", "Responsible Agency", "Data Field", "Value")
        widths = (9, 46, 24, 13, 24)
        for col, (header, width) in enumerate(zip(headers, widths)):
            Label(table, text=header, font=("Arial", 9, "bold"), bg="#e5eef8",
                  fg="#142b4c", relief="solid", bd=1, width=width, pady=8).grid(row=0, column=col, sticky=NSEW)
        table.grid_columnconfigure(1, weight=1)
        table.grid_columnconfigure(4, weight=1)

        value_vars = {}
        for row_index, step in enumerate(workflow_stage["steps"], start=1):
            applicable = bool(step.get("applicable"))
            bg = "white" if applicable else "#f4f6f8"
            fg = "#0f1f33" if applicable else "#8192ac"
            row_values = (
                step["no"],
                step["name"],
                step.get("responsibleAgency") if applicable else "-",
                step["dataField"],
            )
            for col, text in enumerate(row_values):
                anchor = W if col in (1, 2) else CENTER
                wrap = 370 if col == 1 else 190
                Label(table, text=text, font=("Arial", 9), bg=bg, fg=fg, relief="solid",
                      bd=1, anchor=anchor, padx=10, pady=8, wraplength=wrap).grid(
                          row=row_index, column=col, sticky=NSEW
                      )

            value_frame = Frame(table, bg=bg, relief="solid", bd=1)
            value_frame.grid(row=row_index, column=4, sticky=NSEW)
            if applicable:
                var = StringVar(value=step.get("value") or "")
                value_vars[step["fieldKey"]] = var
                Entry(value_frame, textvariable=var, width=20, relief="flat").pack(
                    side=LEFT, fill=X, expand=True, padx=(8, 4), pady=5
                )
                if step["dataField"] == "Date":
                    Button(value_frame, text="📅", width=3, command=lambda dv=var: self.pick_date(dv)).pack(
                        side=RIGHT, padx=(0, 6), pady=4
                    )
            else:
                na_var = StringVar(value="Not Applicable")
                Entry(value_frame, textvariable=na_var, width=22, relief="flat", state=DISABLED,
                      disabledforeground="#6f6254", disabledbackground="#eef2f7").pack(fill=X, padx=8, pady=5)

        action_frame = Frame(edit_win)
        action_frame.pack(pady=16)
        Button(action_frame, text="Save", width=14, bg="#008000", fg="white",
               font=("Arial", 11, "bold"),
               command=lambda: self.save_approval_stage_form(edit_win, project, workflow_stage, value_vars, tree, stage_key)).pack(side=LEFT, padx=8)
        clear_state = NORMAL if (not self.main_app or self.main_app.is_admin()) else DISABLED
        Button(action_frame, text="Stage Cleared", width=15, bg="#0068c9", fg="white",
               font=("Arial", 11, "bold"), state=clear_state,
               command=lambda: self.clear_approval_stage_form(edit_win, project, stage_key, value_vars, workflow_stage, tree)).pack(side=LEFT, padx=8)
        Button(action_frame, text="Cancel", width=14, bg="#555", fg="white",
               font=("Arial", 11, "bold"), command=edit_win.destroy).pack(side=LEFT, padx=8)
        normalize_buttons(edit_win)

    def load_approval_values(self, project_id):
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT field_key, field_value FROM project_approval_fields WHERE project_id=%s", (project_id,))
        values = {row["field_key"]: row["field_value"] for row in c.fetchall()}
        conn.close()
        return values

    def collect_approval_values(self, workflow_stage, value_vars):
        values = {}
        for step in workflow_stage["steps"]:
            if not step.get("applicable"):
                continue
            value = value_vars.get(step["fieldKey"]).get().strip()
            if step["dataField"] == "Amount" and value:
                try:
                    float(value)
                except ValueError:
                    raise ValueError(f"{step['name']} must be a valid number.")
            values[step["fieldKey"]] = value
        return values

    def save_project_approval_fields(self, project, values):
        ensure_approval_field_tables()
        conn = get_db_connection()
        c = conn.cursor()
        updated_at = datetime.now().isoformat(timespec="seconds")
        allowed_keys = {
            f"{stage['key']}.{step['key']}"
            for stage in APPROVAL_FIELD_STAGES
            for step in stage["steps"]
        }
        for field_key, raw_value in values.items():
            if field_key not in allowed_keys:
                continue
            metadata = approval_step_metadata(project, field_key)
            if not metadata:
                continue
            c.execute("""
                INSERT INTO project_approval_fields (
                    project_id, field_key, stage_key, stage_name, step_no,
                    step_key, step_name, responsible_agency, data_field,
                    field_value, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (project_id, field_key)
                DO UPDATE SET
                    stage_key=EXCLUDED.stage_key,
                    stage_name=EXCLUDED.stage_name,
                    step_no=EXCLUDED.step_no,
                    step_key=EXCLUDED.step_key,
                    step_name=EXCLUDED.step_name,
                    responsible_agency=EXCLUDED.responsible_agency,
                    data_field=EXCLUDED.data_field,
                    field_value=EXCLUDED.field_value,
                    updated_at=EXCLUDED.updated_at
            """, (
                project["id"],
                field_key,
                metadata["stage_key"],
                metadata["stage_name"],
                metadata["step_no"],
                metadata["step_key"],
                metadata["step_name"],
                metadata["responsible_agency"],
                metadata["data_field"],
                "" if raw_value is None else str(raw_value).strip(),
                updated_at,
            ))
        conn.commit()
        conn.close()

    def save_approval_stage_form(self, win, project, workflow_stage, value_vars, tree, stage_key):
        try:
            values = self.collect_approval_values(workflow_stage, value_vars)
        except ValueError as exc:
            messagebox.showerror("Invalid Value", str(exc))
            keep_window_active(win)
            return
        self.save_project_approval_fields(project, values)
        self.load_stage_data(tree, stage_key)
        messagebox.showinfo("Success", "Approval stage fields saved.")
        win.destroy()
        keep_window_active(self)

    def sync_legacy_stage_from_approval_values(self, project_id, project, values):
        workflow = approval_workflow_for_project(project, values)
        updates = {}
        for stage in workflow["stages"]:
            applicable_steps = [step for step in stage["steps"] if step.get("applicable")]
            if not applicable_steps:
                continue
            if not all(str(values.get(step["fieldKey"]) or "").strip() for step in applicable_steps):
                continue

            last_date = next(
                (
                    str(values.get(step["fieldKey"]) or "").strip()
                    for step in reversed(applicable_steps)
                    if step.get("dataField") == "Date" and str(values.get(step["fieldKey"]) or "").strip()
                ),
                "",
            )
            last_amount = next(
                (
                    str(values.get(step["fieldKey"]) or "").strip()
                    for step in reversed(applicable_steps)
                    if step.get("dataField") == "Amount" and str(values.get(step["fieldKey"]) or "").strip()
                ),
                "",
            )

            if stage["key"] == "formulation":
                updates["cod_cleared"] = "Y"
                if last_date:
                    updates["dic_recommendation_date"] = to_storage_date(last_date) or last_date
            elif stage["key"] == "stage1":
                updates["stage1_cleared"] = "Y"
                if last_date:
                    updates["stage1_date"] = to_storage_date(last_date) or last_date
                    updates.setdefault("cod_date", to_storage_date(last_date) or last_date)
                if last_amount:
                    updates["stage1_cost"] = float(last_amount)
            elif stage["key"] == "tendering":
                if last_date:
                    updates["final_tod_date"] = to_storage_date(last_date) or last_date
                    updates.setdefault("expected_tod_date", to_storage_date(last_date) or last_date)
            elif stage["key"] == "stage2":
                updates["stage2_cleared"] = "Y"
                if last_date:
                    updates["stage2_date"] = to_storage_date(last_date) or last_date
                if last_amount:
                    updates["stage2_cost"] = float(last_amount)

        if updates:
            update_project_stage(project_id, **updates)
        return updates

    def clear_approval_stage_form(self, win, project, stage_key, value_vars, workflow_stage, tree):
        if self.main_app and not self.main_app.is_admin():
            messagebox.showwarning("Admin Required", "Only admin can clear approval stages.")
            return
        if not messagebox.askyesno("Stage Cleared", f"Mark {workflow_stage['label']} as cleared for {project['unique_id']}?"):
            keep_window_active(win)
            return
        try:
            values = self.collect_approval_values(workflow_stage, value_vars)
        except ValueError as exc:
            messagebox.showerror("Invalid Value", str(exc))
            keep_window_active(win)
            return

        self.save_project_approval_fields(project, values)
        saved_values = self.load_approval_values(project["id"])
        updates = self.sync_legacy_stage_from_approval_values(project["id"], project, saved_values)
        if stage_key == "formulation":
            updates.setdefault("cod_cleared", "Y")
        elif stage_key == "stage1":
            updates.setdefault("stage1_cleared", "Y")
        elif stage_key == "tendering":
            if not updates.get("final_tod_date"):
                updates["final_tod_date"] = datetime.now().strftime("%Y-%m-%d")
        elif stage_key == "stage2":
            updates.setdefault("stage2_cleared", "Y")
            if not updates.get("stage2_date"):
                updates["stage2_date"] = datetime.now().strftime("%Y-%m-%d")
        if updates:
            update_project_stage(project["id"], **updates)

        self.load_stage_data(tree, stage_key)
        self.refresh_current_tab()
        messagebox.showinfo("Success", f"{workflow_stage['label']} Stage Cleared. Project moved to the next stage.")
        win.destroy()
        keep_window_active(self)
