from tkinter import *
from tkinter import ttk, messagebox
from datetime import date

from database import get_db_connection
from utils import (
    apply_page_watermark,
    get_project_status,
    keep_window_active,
    normalize_buttons,
    to_display_date,
    to_storage_date,
)


def current_financial_year_label(today=None):
    today = today or date.today()
    start_year = today.year if today.month >= 4 else today.year - 1
    return f"FY {start_year}-{str(start_year + 1)[-2:]}"


def last_financial_year_label(today=None):
    today = today or date.today()
    start_year = today.year if today.month >= 4 else today.year - 1
    return f"FY {start_year - 1}-{str(start_year)[-2:]}"


MASTER_COLUMNS = [
    ("project_name", "Project Name", "Basic Project Information", 260, "readonly"),
    ("project_manager", "Project Manager", "Basic Project Information", 150, "text"),
    ("executing_agency", "Executing Agency", "Basic Project Information", 160, "text"),
    ("dic_recommendation_date", "DIC Recommendation Date", "Approval & Cost Information", 135, "readonly_date"),
    ("cod_cleared", "COD Cleared", "Approval & Cost Information", 95, "readonly"),
    ("cod_date", "COD Date", "Approval & Cost Information", 105, "readonly_date"),
    ("stage1_date", "Stage-I Date", "Approval & Cost Information", 105, "readonly_date"),
    ("stage1_cost", "Stage-I Cost (Cr.)", "Approval & Cost Information", 120, "readonly_number"),
    ("stage1_cleared", "Stage-I Cleared", "Approval & Cost Information", 110, "readonly"),
    ("expected_tod_date", "Expected TOD", "Approval & Cost Information", 115, "readonly_date"),
    ("final_tod_date", "Final TOD", "Approval & Cost Information", 105, "readonly_date"),
    ("tender_cancelled", "Tender Cancelled", "Approval & Cost Information", 120, "readonly"),
    ("retender_expected_date", "Expected Retender TOD", "Approval & Cost Information", 145, "readonly_date"),
    ("retender_final_date", "Final Retender TOD", "Approval & Cost Information", 135, "readonly_date"),
    ("stage2_date", "Stage-II Date", "Approval & Cost Information", 105, "readonly_date"),
    ("stage2_cost", "Stage-II Cost (Cr.)", "Approval & Cost Information", 120, "readonly_number"),
    ("stage2_cleared", "Stage-II Cleared", "Approval & Cost Information", 110, "readonly"),
    ("gross_cost", "Gross Cost (Cr.)", "Approval & Cost Information", 120, "readonly_number"),
    ("expenditure_upto_last_fy", f"Expenditure incurred up to {last_financial_year_label()}", "CAPEX / Financial Tracking", 170, "number"),
    ("be_re_current_fy", f"BE/RE Current Financial Year ({current_financial_year_label()})", "CAPEX / Financial Tracking", 170, "number"),
    ("actual_cost_current_fy", "Actual Cost Incurred in Current FY", "CAPEX / Financial Tracking", 170, "number"),
    ("cumulative_cost", "Cummulative Cost", "CAPEX / Financial Tracking", 130, "number"),
    ("tender_publish", "Tender Publish", "CAPEX / Financial Tracking", 115, "date"),
    ("tender_award_date", "Tender Award Date", "CAPEX / Financial Tracking", 120, "readonly_date"),
    ("loa_loi", "LOA/LOI", "Tendering & Contract Milestones", 110, "readonly_date"),
    ("contract_signing", "Contract Signing", "Tendering & Contract Milestones", 120, "date"),
    ("effective_date", "Effective Date of Contract", "Tendering & Contract Milestones", 145, "readonly_date"),
    ("schedule_month", "Schedule Month", "Tendering & Contract Milestones", 110, "readonly"),
    ("contract_schedule_completion", "Schedule Completion", "Tendering & Contract Milestones", 130, "readonly_date"),
    ("expected_completion_date", "Expected Completion Date", "Schedule & Completion Tracking", 145, "date"),
    ("actual_completion_date", "Actual Completion Date", "Schedule & Completion Tracking", 130, "readonly_date"),
    ("status", "Status", "Status", 130, "status"),
]

EDITABLE_TYPES = {"text", "number", "date", "status"}
GROUP_COLORS = {
    "Basic Project Information": "#dff1ff",
    "Approval & Cost Information": "#e5f5df",
    "CAPEX / Financial Tracking": "#fff0cc",
    "Tendering & Contract Milestones": "#f1e6ff",
    "Schedule & Completion Tracking": "#dcefff",
    "Status": "#ffe4ea",
}


def ensure_corporate_master_table():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS corporate_amr_master (
            project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
            project_manager TEXT,
            executing_agency TEXT,
            description TEXT,
            expenditure_upto_last_fy REAL,
            be_re_current_fy REAL,
            actual_cost_till_month REAL,
            actual_cost_current_fy REAL,
            cumulative_cost REAL,
            cumulative_cost_percent REAL,
            tender_publish TEXT,
            contract_signing TEXT,
            revise_completion_date TEXT,
            expected_completion_date TEXT,
            status_override TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    for column_name, column_type in (
        ("actual_cost_current_fy", "REAL"),
        ("expected_completion_date", "TEXT"),
    ):
        cursor.execute(f"ALTER TABLE corporate_amr_master ADD COLUMN IF NOT EXISTS {column_name} {column_type}")
    conn.commit()
    conn.close()


def parse_number(value):
    text = str(value or "").replace(",", "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        raise ValueError("Please enter a numeric value.")


def format_number(value):
    if value in (None, ""):
        return ""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    return str(int(number)) if number.is_integer() else f"{number:.2f}"


class CorporateAMRMasterWindow(Toplevel):
    def __init__(self, parent, main_app=None):
        super().__init__(parent)
        self.main_app = main_app
        self.rows = []
        self.title("Corporate AMR Master")
        self.geometry("1680x860")
        self.minsize(1180, 680)
        try:
            self.state("zoomed")
        except Exception:
            pass
        self.configure(bg="#edf3f8")

        ensure_corporate_master_table()
        self.build_ui()
        self.load_rows()
        apply_page_watermark(self)
        normalize_buttons(self)
        keep_window_active(self)

    def build_ui(self):
        header = Frame(self, bg="#003087", height=72)
        header.pack(fill=X)
        header.pack_propagate(False)
        Label(
            header,
            text="Corporate AMR Master",
            bg="#003087",
            fg="white",
            font=("Arial", 22, "bold"),
        ).pack(side=LEFT, padx=24)
        Button(
            header,
            text="Refresh",
            command=self.load_rows,
            bg="#008000",
            fg="white",
            font=("Arial", 10, "bold"),
            width=12,
        ).pack(side=RIGHT, padx=16, pady=16)

        title = Label(
            self,
            text="MASTER DATABASE LAYOUT (ONE MASTER TABLE)",
            bg="#f7fbff",
            fg="#002060",
            font=("Arial", 13, "bold"),
            relief=SOLID,
            bd=1,
        )
        title.pack(fill=X, padx=12, pady=(12, 0), ipady=6)

        group_frame = Frame(self, bg="#edf3f8")
        group_frame.pack(fill=X, padx=12, pady=(0, 0))
        Label(group_frame, text="", bg="#eef6ff", width=7, relief=SOLID, bd=1).pack(side=LEFT, fill=Y)
        for group_name, count in self.group_spans():
            Label(
                group_frame,
                text=group_name.upper(),
                bg=GROUP_COLORS.get(group_name, "#f8fafc"),
                fg="#001b4f",
                font=("Arial", 9, "bold"),
                width=max(14, count * 14),
                relief=SOLID,
                bd=1,
            ).pack(side=LEFT, fill=Y, ipady=5)

        table_frame = Frame(self, bg="white", relief=SOLID, bd=1)
        table_frame.pack(fill=BOTH, expand=True, padx=12, pady=(0, 12))

        columns = ("sr",) + tuple(column[0] for column in MASTER_COLUMNS)
        self.tree = ttk.Treeview(table_frame, columns=columns, show="headings", height=22)
        self.tree.heading("sr", text="Sr.")
        self.tree.column("sr", width=48, minwidth=48, anchor="center", stretch=False)

        for key, label, _group, width, _kind in MASTER_COLUMNS:
            self.tree.heading(key, text=label)
            anchor = "w" if key in {"project_name", "executing_agency", "project_manager"} else "center"
            self.tree.column(key, width=width, minwidth=80, anchor=anchor, stretch=False)

        self.tree.tag_configure("readonly", background="#f8fbff")
        self.tree.bind("<Double-1>", self.on_double_click)
        self.tree.pack(side=LEFT, fill=BOTH, expand=True)

        y_scroll = ttk.Scrollbar(table_frame, orient=VERTICAL, command=self.tree.yview)
        y_scroll.pack(side=RIGHT, fill=Y)
        x_scroll = ttk.Scrollbar(self, orient=HORIZONTAL, command=self.tree.xview)
        x_scroll.pack(fill=X, padx=12, pady=(0, 8))
        self.tree.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)

        footer = Frame(self, bg="#edf3f8")
        footer.pack(fill=X, padx=12, pady=(0, 12))
        Label(
            footer,
            text="Double-click a row to edit Corporate AMR master fields. Registration and contract milestone values are picked from existing project records.",
            bg="#edf3f8",
            fg="#334155",
            font=("Arial", 10, "bold"),
        ).pack(side=LEFT)
        Button(
            footer,
            text="Close",
            command=self.destroy,
            bg="#555555",
            fg="white",
            font=("Arial", 10, "bold"),
            width=12,
        ).pack(side=RIGHT)

    def group_spans(self):
        spans = []
        for _key, _label, group, _width, _kind in MASTER_COLUMNS:
            if spans and spans[-1][0] == group:
                spans[-1] = (group, spans[-1][1] + 1)
            else:
                spans.append((group, 1))
        return spans

    def fetch_rows(self):
        conn = get_db_connection()
        cursor = conn.cursor()
        allowed_project_ids = self.main_app.get_allowed_project_ids() if self.main_app else None
        filter_sql = ""
        params = []
        if allowed_project_ids is not None:
            if not allowed_project_ids:
                conn.close()
                return []
            filter_sql = "AND p.id = ANY(%s)"
            params.append(list(allowed_project_ids))
        cursor.execute(
            f"""
            SELECT
                p.*,
                m.project_manager,
                m.executing_agency AS master_executing_agency,
                m.description,
                m.expenditure_upto_last_fy,
                m.be_re_current_fy,
                m.actual_cost_till_month,
                m.actual_cost_current_fy,
                m.cumulative_cost,
                m.cumulative_cost_percent,
                m.tender_publish,
                m.contract_signing,
                m.revise_completion_date,
                m.expected_completion_date,
                m.status_override
            FROM projects p
            LEFT JOIN corporate_amr_master m ON m.project_id = p.id
            WHERE p.project_type='Corporate AMR'
              AND COALESCE(p.project_dropped, 'N') <> 'Y'
              {filter_sql}
            ORDER BY p.id DESC
            """,
            params,
        )
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return rows

    def row_to_values(self, row, serial):
        gross_cost = row.get("stage2_cost")
        if gross_cost in (None, ""):
            gross_cost = row.get("stage1_cost")
        if gross_cost in (None, ""):
            gross_cost = row.get("gross_cost")

        schedule_month = str(row.get("schedule_months") or "")
        values = {
            "project_name": row.get("project_name") or "",
            "project_manager": row.get("project_manager") or "",
            "executing_agency": row.get("master_executing_agency") or row.get("contractor_name") or "",
            "dic_recommendation_date": to_display_date(row.get("dic_recommendation_date")),
            "cod_cleared": row.get("cod_cleared") or "N",
            "cod_date": to_display_date(row.get("cod_date")),
            "stage1_date": to_display_date(row.get("stage1_date")),
            "stage1_cost": format_number(row.get("stage1_cost")),
            "stage1_cleared": row.get("stage1_cleared") or "N",
            "expected_tod_date": to_display_date(row.get("expected_tod_date")),
            "final_tod_date": to_display_date(row.get("final_tod_date")),
            "tender_cancelled": row.get("tender_cancelled") or "N",
            "retender_expected_date": to_display_date(row.get("retender_expected_date")),
            "retender_final_date": to_display_date(row.get("retender_final_date")),
            "stage2_date": to_display_date(row.get("stage2_date")),
            "stage2_cost": format_number(row.get("stage2_cost")),
            "stage2_cleared": row.get("stage2_cleared") or "N",
            "gross_cost": format_number(gross_cost),
            "expenditure_upto_last_fy": format_number(row.get("expenditure_upto_last_fy")),
            "be_re_current_fy": format_number(row.get("be_re_current_fy")),
            "actual_cost_current_fy": format_number(
                row.get("actual_cost_current_fy")
                if row.get("actual_cost_current_fy") not in (None, "")
                else row.get("actual_cost_till_month")
            ),
            "cumulative_cost": format_number(row.get("cumulative_cost")),
            "tender_publish": to_display_date(row.get("tender_publish")),
            "tender_award_date": to_display_date(row.get("final_tod_date")),
            "loa_loi": to_display_date(row.get("loa_date")),
            "contract_signing": to_display_date(row.get("contract_signing")),
            "effective_date": to_display_date(row.get("effective_date")),
            "schedule_month": schedule_month,
            "contract_schedule_completion": to_display_date(row.get("schedule_completion")),
            "expected_completion_date": to_display_date(
                row.get("expected_completion_date")
                or row.get("revise_completion_date")
                or row.get("expected_finish")
            ),
            "actual_completion_date": to_display_date(row.get("completion_date") or row.get("commissioned_date")),
            "status": row.get("status_override") or get_project_status(row),
        }
        return (serial,) + tuple(values.get(key, "") for key, *_rest in MASTER_COLUMNS)

    def load_rows(self):
        for item in self.tree.get_children():
            self.tree.delete(item)
        self.rows = self.fetch_rows()
        for index, row in enumerate(self.rows, start=1):
            self.tree.insert("", END, iid=str(row["id"]), values=self.row_to_values(row, index), tags=("readonly",))

    def selected_project_id(self):
        selected = self.tree.selection()
        if not selected:
            return None
        try:
            return int(selected[0])
        except (TypeError, ValueError):
            return None

    def selected_row(self):
        project_id = self.selected_project_id()
        if not project_id:
            return None
        return next((row for row in self.rows if int(row.get("id") or 0) == project_id), None)

    def on_double_click(self, _event=None):
        row = self.selected_row()
        if not row:
            return
        if self.main_app and not self.main_app.can_edit("ongoing"):
            messagebox.showwarning("Edit Denied", "You have view access only for Ongoing Projects.")
            return
        self.open_edit_dialog(row)

    def open_edit_dialog(self, row):
        popup = Toplevel(self)
        popup.title(f"Corporate AMR Master - {row.get('unique_id')}")
        popup.geometry("760x620")
        popup.configure(bg="#edf3f8")
        popup.transient(self)
        popup.grab_set()

        Label(
            popup,
            text=row.get("project_name") or "Corporate AMR Project",
            bg="#edf3f8",
            fg="#003087",
            font=("Arial", 15, "bold"),
            wraplength=700,
        ).pack(pady=(16, 6))
        Label(
            popup,
            text="Edit master-only fields",
            bg="#edf3f8",
            fg="#334155",
            font=("Arial", 10, "bold"),
        ).pack(pady=(0, 12))

        form = Frame(popup, bg="#edf3f8")
        form.pack(fill=BOTH, expand=True, padx=20)
        variables = {}

        editable_columns = [
            item for item in MASTER_COLUMNS
            if item[4] in EDITABLE_TYPES
        ]
        for index, (key, label, _group, _width, kind) in enumerate(editable_columns):
            Label(form, text=label + ":", bg="#edf3f8", font=("Arial", 10, "bold")).grid(
                row=index, column=0, sticky=W, padx=8, pady=6
            )
            source_key = "status_override" if key == "status" else key
            raw_value = row.get(source_key)
            if kind == "date":
                value = to_display_date(raw_value)
            elif kind == "number":
                value = format_number(raw_value)
            else:
                value = str(raw_value or "")
            var = StringVar(value=value)
            variables[key] = (var, kind)
            Entry(form, textvariable=var, width=54, font=("Arial", 10)).grid(
                row=index, column=1, sticky=EW, padx=8, pady=6
            )
        form.grid_columnconfigure(1, weight=1)

        buttons = Frame(popup, bg="#edf3f8")
        buttons.pack(fill=X, padx=20, pady=16)

        def save():
            try:
                payload = {}
                for key, (var, kind) in variables.items():
                    value = var.get().strip()
                    if key == "status":
                        payload["status_override"] = value
                    elif kind == "number":
                        payload[key] = parse_number(value)
                    elif kind == "date":
                        payload[key] = to_storage_date(value) if value else None
                    else:
                        payload[key] = value
            except ValueError as exc:
                messagebox.showerror("Invalid Value", str(exc), parent=popup)
                keep_window_active(popup)
                return

            self.save_master_row(row["id"], payload)
            popup.destroy()
            self.load_rows()

        Button(
            buttons,
            text="Save",
            command=save,
            bg="#0066cc",
            fg="white",
            font=("Arial", 10, "bold"),
            width=14,
        ).pack(side=LEFT, padx=6)
        Button(
            buttons,
            text="Cancel",
            command=popup.destroy,
            bg="#555555",
            fg="white",
            font=("Arial", 10, "bold"),
            width=14,
        ).pack(side=RIGHT, padx=6)
        normalize_buttons(popup)
        keep_window_active(popup)

    def save_master_row(self, project_id, payload):
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO corporate_amr_master (
                project_id, project_manager, executing_agency, description,
                expenditure_upto_last_fy, be_re_current_fy, actual_cost_till_month,
                actual_cost_current_fy, cumulative_cost, cumulative_cost_percent, tender_publish,
                contract_signing, revise_completion_date, expected_completion_date, status_override, updated_at
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP
            )
            ON CONFLICT (project_id) DO UPDATE SET
                project_manager=EXCLUDED.project_manager,
                executing_agency=EXCLUDED.executing_agency,
                description=EXCLUDED.description,
                expenditure_upto_last_fy=EXCLUDED.expenditure_upto_last_fy,
                be_re_current_fy=EXCLUDED.be_re_current_fy,
                actual_cost_till_month=EXCLUDED.actual_cost_till_month,
                actual_cost_current_fy=EXCLUDED.actual_cost_current_fy,
                cumulative_cost=EXCLUDED.cumulative_cost,
                cumulative_cost_percent=EXCLUDED.cumulative_cost_percent,
                tender_publish=EXCLUDED.tender_publish,
                contract_signing=EXCLUDED.contract_signing,
                revise_completion_date=EXCLUDED.revise_completion_date,
                expected_completion_date=EXCLUDED.expected_completion_date,
                status_override=EXCLUDED.status_override,
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                project_id,
                payload.get("project_manager"),
                payload.get("executing_agency"),
                None,
                payload.get("expenditure_upto_last_fy"),
                payload.get("be_re_current_fy"),
                payload.get("actual_cost_current_fy"),
                payload.get("actual_cost_current_fy"),
                payload.get("cumulative_cost"),
                None,
                payload.get("tender_publish"),
                payload.get("contract_signing"),
                None,
                payload.get("expected_completion_date"),
                payload.get("status_override"),
            ),
        )
        conn.commit()
        conn.close()


if __name__ == "__main__":
    root = Tk()
    root.withdraw()
    CorporateAMRMasterWindow(root)
    root.mainloop()
