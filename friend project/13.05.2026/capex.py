from datetime import date
import json
import os
import uuid
from tkinter import *
from tkinter import ttk, messagebox, simpledialog

from database import get_all_projects
from utils import get_project_status
from utils import keep_window_active, normalize_buttons, apply_page_watermark


def build_capex_months(today=None):
    today = today or date.today()
    fy_start_year = today.year if today.month >= 4 else today.year - 1
    months = []
    for month in range(4, 13):
        months.append(date(fy_start_year, month, 1).strftime("%b-%y"))
    for month in range(1, 4):
        months.append(date(fy_start_year + 1, month, 1).strftime("%b-%y"))
    return months


def build_financial_year_label(today=None):
    today = today or date.today()
    start_year = today.year if today.month >= 4 else today.year - 1
    return f"FY {start_year}-{start_year + 1}"


def build_financial_year_options(today=None, count=4):
    today = today or date.today()
    start_year = today.year if today.month >= 4 else today.year - 1
    return [f"FY {year}-{year + 1}" for year in range(start_year, start_year + max(1, int(count or 1)))]


CAPEX_MONTHS = build_capex_months()
CAPEX_SAVE_PATH = os.path.join(os.path.expanduser("~"), "Documents", "New project", "capex_saved_data.json")
BASE_COLUMNS = [
    ("CAPEX Plan (FY)", 304, "#ffc000"),
    ("Gross Cost", 146, "#ffc000"),
    ("Cummulative Expenditure till Last FY", 184, "#ffc000"),
    ("BE (FY)", 124, "#92d050"),
    ("RE (FY)", 124, "#92d050"),
]

MONTH_COLUMNS = []
for month in CAPEX_MONTHS:
    month_lower = month.lower()
    MONTH_COLUMNS.append((f"{month} BE", 86, "#fff200"))
    if month_lower in ["oct-26", "nov-26", "dec-26", "jan-27", "feb-27", "mar-27"]:
        MONTH_COLUMNS.append((f"{month} RE", 86, "#fff200"))
    MONTH_COLUMNS.append((f"{month} Actual", 86, "#fff200"))

ALL_COLUMNS = BASE_COLUMNS + MONTH_COLUMNS
MONTH_GROUP_WIDTH = sum(width for _, width, _ in MONTH_COLUMNS[:3])  # First 3 columns for header grouping
ROW_HEIGHT = 34
HEADER_HEIGHT = 68


def empty_values():
    values = {label: "" for label, _, _ in ALL_COLUMNS}
    values["CAPEX Plan (FY)"] = ""
    return values


def month_subcolumn(month, subheader):
    return f"{month} {subheader}"


DEFAULT_ROWS = [
    {"values": {**empty_values(), "CAPEX Plan (FY)": "1. MEP"}, "indent": 0, "collapsed": False},
    {"values": {**empty_values(), "CAPEX Plan (FY)": "2. AMR"}, "indent": 0, "collapsed": False},
    {"values": {**empty_values(), "CAPEX Plan (FY)": "2.1 Completed AMR Schemes >30 Cr."}, "indent": 1, "collapsed": False},
    {"values": {**empty_values(), "CAPEX Plan (FY)": "2.2 Ongoing AMR Schemes >30 Cr."}, "indent": 1, "collapsed": False},
    {"values": {**empty_values(), "CAPEX Plan (FY)": "2.3 Plant Level AMR Schemes <30 Cr."}, "indent": 1, "collapsed": False},
    {"values": {**empty_values(), "CAPEX Plan (FY)": "3. Capital Repairs/Spares"}, "indent": 0, "collapsed": False},
    {"values": {**empty_values(), "CAPEX Plan (FY)": "4. Allocation for New Projects/ Upcoming Schemes"}, "indent": 0, "collapsed": False},
]

AMR_BUCKET_NAMES = {
    "2.1 Completed AMR Schemes >30 Cr.",
    "2.2 Ongoing AMR Schemes >30 Cr.",
    "2.3 Plant Level AMR Schemes <30 Cr.",
}
AMR_BUCKET_ORDER = [
    "2.1 Completed AMR Schemes >30 Cr.",
    "2.2 Ongoing AMR Schemes >30 Cr.",
    "2.3 Plant Level AMR Schemes <30 Cr.",
]
AMR_BUCKET_ALIASES = {
    "completed amr schemes >30 cr.": "2.1 Completed AMR Schemes >30 Cr.",
    "2.1 completed amr schemes >30 cr.": "2.1 Completed AMR Schemes >30 Cr.",
    "ongoing amr schemes >30 cr.": "2.2 Ongoing AMR Schemes >30 Cr.",
    "2.2 ongoing amr schemes >30 cr.": "2.2 Ongoing AMR Schemes >30 Cr.",
    "amr schemes <30 cr.": "2.3 Plant Level AMR Schemes <30 Cr.",
    "plant level amr schemes <30 cr.": "2.3 Plant Level AMR Schemes <30 Cr.",
    "2.3 plant level amr schemes <30 cr.": "2.3 Plant Level AMR Schemes <30 Cr.",
}

LEVEL_HEADER = "Header"
LEVEL_SUBHEADER = "SubHeader"
LEVEL_ITEM = "Item"
LEVEL_SEQUENCE = (LEVEL_HEADER, LEVEL_SUBHEADER, LEVEL_ITEM)


class CapexWindow(Toplevel):
    def __init__(self, parent, main_app=None):
        super().__init__(parent)
        self.main_app = main_app
        self.title("CAPEX")
        self.geometry("1860x940")
        self.configure(bg="#eef3f8")

        self.current_fy = build_financial_year_label()
        self.next_row_id = 1
        self.plan_store = {}
        self.active_plan_name = ""
        self.rows = self.load_saved_rows()
        self.rows = self.prune_deleted_project_rows(self.rows)
        if not self.rows:
            self.rows = [
                self.make_row(
                    row["values"]["CAPEX Plan (FY)"],
                    indent=row["indent"],
                    collapsed=row.get("collapsed", False),
                )
                for row in DEFAULT_ROWS
            ]
        self.ensure_default_plan()
        self.selected_row_index = 0 if self.rows else None
        self.active_editor = None
        self.header_canvas = None
        self.body_canvas = None
        self.header_total_width = sum(width for _, width, _ in ALL_COLUMNS)
        self.visible_rows = []
        self.plan_var = StringVar()
        self.effective_plan_label_var = StringVar()

        self.build_ui()
        self.draw_header_grid()
        self.draw_data_grid()
        apply_page_watermark(self)
        normalize_buttons(self)
        self.compact_footer_buttons()
        keep_window_active(self)

    def build_ui(self):
        header = Frame(self, bg="#003087", height=84)
        header.pack(fill=X)
        header.pack_propagate(False)

        Label(
            header,
            text="CAPEX",
            bg="#003087",
            fg="white",
            font=("Arial", 24, "bold"),
        ).pack(pady=(14, 4))
        Label(
            header,
            text="Editable CAPEX hierarchy with roll-up totals",
            bg="#003087",
            fg="#dbeafe",
            font=("Arial", 11, "bold"),
        ).pack()

        plan_bar = Frame(self, bg="#e8eef7", height=48)
        plan_bar.pack(fill=X, padx=14, pady=(10, 0))
        plan_bar.pack_propagate(False)

        Label(plan_bar, text=f"Financial Year: {self.current_fy}", bg="#e8eef7", fg="#003087",
              font=("Arial", 11, "bold")).pack(side=LEFT, padx=(14, 16))
        Label(plan_bar, text="Effective Plan:", bg="#e8eef7", fg="#003087",
              font=("Arial", 10, "bold")).pack(side=LEFT)
        self.plan_combo = ttk.Combobox(plan_bar, textvariable=self.plan_var, state="readonly", width=22)
        self.plan_combo.pack(side=LEFT, padx=(8, 10))
        self.plan_combo.bind("<<ComboboxSelected>>", self.on_plan_selected)
        Button(plan_bar, text="🗓 Open Planning", command=self.open_planning_popup_v2,
               bg="#7c3aed", fg="white", font=("Arial", 9, "bold"), width=14, height=1).pack(side=LEFT, padx=6)
        Button(plan_bar, text="✔ Set Effective", command=self.set_effective_plan,
               bg="#0066cc", fg="white", font=("Arial", 9, "bold"), width=14, height=1).pack(side=LEFT, padx=6)
        Label(plan_bar, textvariable=self.effective_plan_label_var, bg="#e8eef7", fg="#374151",
              font=("Arial", 10, "bold")).pack(side=RIGHT, padx=14)

        self.refresh_plan_selector()

        # ==================== SUMMARY BOXES ====================
        summary_bar = Frame(self, bg="#f1f5f9", height=95)
        summary_bar.pack(fill=X, padx=14, pady=(8, 0))
        summary_bar.pack_propagate(False)

        # Month Selector
        month_frame = Frame(summary_bar, bg="#f1f5f9")
        month_frame.pack(side=LEFT, padx=12, pady=8)
        Label(month_frame, text="Select Month:", bg="#f1f5f9", fg="#003087", font=("Arial", 10, "bold")).pack(anchor="w")
        self.month_var = StringVar(value=CAPEX_MONTHS[0] if CAPEX_MONTHS else "Apr-26")
        self.month_combo = ttk.Combobox(month_frame, textvariable=self.month_var, values=CAPEX_MONTHS, width=12, state="readonly")
        self.month_combo.pack(pady=2)
        self.month_combo.bind("<<ComboboxSelected>>", self.on_month_selected)

        # Box 1: Gross Cost (Parent Level)
        box1 = Frame(summary_bar, bg="#f6e4c3", relief="solid", bd=1, width=220, height=75)
        box1.pack(side=LEFT, padx=6, pady=8)
        box1.pack_propagate(False)
        Label(box1, text="Gross Cost", bg="#f6e4c3", fg="#003087", font=("Arial", 9, "bold")).pack(pady=(4, 0))
        self.gross_cost_var = StringVar(value="0.00")
        Label(box1, textvariable=self.gross_cost_var, bg="#f6e4c3", fg="#1e40af", font=("Arial", 16, "bold")).pack()

        # Box 2: Plan vs Actual for Current FY
        box2 = Frame(summary_bar, bg="#c2f7d0", relief="solid", bd=1, width=280, height=75)
        box2.pack(side=LEFT, padx=6, pady=8)
        box2.pack_propagate(False)
        Label(box2, text="Plan vs Actual - Current FY", bg="#c2f7d0", fg="#003087", font=("Arial", 9, "bold")).pack(pady=(4, 0))
        self.plan_actual_fy_var = StringVar(value="Plan: 0.00 | Actual: 0.00")
        Label(box2, textvariable=self.plan_actual_fy_var, bg="#c2f7d0", fg="#1e40af", font=("Arial", 11, "bold")).pack()

        # Box 3: Plan vs Actual Cumulative
        box3 = Frame(summary_bar, bg="#72efef", relief="solid", bd=1, width=280, height=75)
        box3.pack(side=LEFT, padx=6, pady=8)
        box3.pack_propagate(False)
        Label(box3, text="Plan vs Actual - Cumulative", bg="#72efef", fg="#003087", font=("Arial", 9, "bold")).pack(pady=(4, 0))
        self.plan_actual_cum_var = StringVar(value="Plan: 0.00 | Actual: 0.00")
        Label(box3, textvariable=self.plan_actual_cum_var, bg="#72efef", fg="#1e40af", font=("Arial", 11, "bold")).pack()

        # Refresh button
        Button(summary_bar, text="🔄 Refresh Summary", command=self.refresh_summary_boxes, bg="#0f766e", fg="white", font=("Arial", 8, "bold"), width=14).pack(side=RIGHT, padx=10, pady=25)
        # =======================================================

        content = Frame(self, bg="#eef3f8")
        content.pack(fill=BOTH, expand=True, padx=14, pady=14)

        table_wrap = Frame(content, bg="#f8fafc", relief="solid", bd=1)
        table_wrap.pack(fill=BOTH, expand=True)

        self.header_canvas = Canvas(table_wrap, bg="#f8fafc", height=HEADER_HEIGHT, highlightthickness=0)
        self.header_canvas.pack(fill=X, pady=(0, 2))

        self.body_canvas = Canvas(table_wrap, bg="white", highlightthickness=0)
        self.body_canvas.pack(side=LEFT, fill=BOTH, expand=True)
        self.body_canvas.bind("<Button-1>", self.on_body_click)

        y_scroll = ttk.Scrollbar(table_wrap, orient=VERTICAL, command=self.body_canvas.yview)
        y_scroll.pack(side=RIGHT, fill=Y)

        x_scroll = ttk.Scrollbar(content, orient=HORIZONTAL, command=self.sync_x_scroll)
        x_scroll.pack(fill=X, pady=(4, 0))

        self.body_canvas.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)
        self.header_canvas.configure(xscrollcommand=x_scroll.set)

        footer = Frame(self, bg="#eef3f8")
        footer.pack(fill=X, padx=14, pady=(0, 12))
        self.footer = footer

        Button(
            footer,
            text="➕\nAdd",
            command=self.open_add_item_popup,
            bg="#008000",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(side=LEFT, padx=(0, 8))
        Button(
            footer,
            text="📥\nImport",
            command=self.import_projects_by_status,
            bg="#0f766e",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(side=LEFT, padx=8)
        Button(
            footer,
            text="💾\nSave",
            command=self.save_capex_data,
            bg="#0066cc",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(side=LEFT, padx=8)
        Button(
            footer,
            text="🗑️\nDelete",
            command=self.delete_selected_row,
            bg="#c8102e",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(side=LEFT, padx=8)
        Button(
            footer,
            text="➡\nIndent",
            command=lambda: self.change_indent(1),
            bg="#0066cc",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(side=LEFT, padx=8)
        Button(
            footer,
            text="⬅\nOutdent",
            command=lambda: self.change_indent(-1),
            bg="#555555",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(side=LEFT, padx=8)
        Button(
            footer,
            text="⬆\nUp",
            command=lambda: self.move_row(-1),
            bg="#7c3aed",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(side=LEFT, padx=8)
        Button(
            footer,
            text="⬇\nDown",
            command=lambda: self.move_row(1),
            bg="#9333ea",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(side=LEFT, padx=8)
        Button(
            footer,
            text="🔄\nRefresh",
            command=self.refresh_view,
            bg="#2f9e44",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(side=LEFT, padx=8)
        Button(
            footer,
            text="✖\nClose",
            command=self.destroy,
            bg="#555555",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(side=RIGHT)

    def normalize_indent(self, indent):
        try:
            return max(0, int(indent or 0))
        except (TypeError, ValueError):
            return 0

    def is_fixed_hierarchy_name(self, name):
        return str(name or "").strip() in {
            str(row.get("values", {}).get("CAPEX Plan (FY)", "")).strip()
            for row in DEFAULT_ROWS
        }

    def make_row(self, name, indent=0, collapsed=False, imported_for=None):
        indent = self.normalize_indent(indent)
        row = {
            "row_id": self.next_row_id,
            "values": empty_values(),
            "indent": indent,
            "collapsed": collapsed,
            "imported_for": imported_for,
            "level": self.level_from_indent(indent),
            "children": [],
        }
        row["values"]["CAPEX Plan (FY)"] = name
        self.next_row_id += 1
        return row

    def default_rows(self):
        return [
            self.make_row(
                row["values"]["CAPEX Plan (FY)"],
                indent=row["indent"],
                collapsed=row.get("collapsed", False),
            )
            for row in DEFAULT_ROWS
        ]

    def clone_rows(self, rows):
        cloned = []
        max_row_id = 0
        for source_row in rows:
            new_row = {
                "row_id": int(source_row.get("row_id") or 0),
                "values": dict(source_row.get("values") or {}),
                "indent": self.normalize_indent(source_row.get("indent") or 0),
                "collapsed": bool(source_row.get("collapsed", False)),
                "imported_for": source_row.get("imported_for"),
                "level": source_row.get("level"),
                "children": list(source_row.get("children") or []),
            }
            cloned.append(new_row)
            max_row_id = max(max_row_id, new_row["row_id"])
        self.next_row_id = max(self.next_row_id, max_row_id + 1)
        return self.sync_node_metadata(cloned)

    def plan_dataset_key(self, financial_year, plan_version, plan_type):
        return f"{financial_year} | {plan_version} | {plan_type}"


    def financial_year_choices(self):
        return build_financial_year_options()


    def plan_version_choices(self, include_final=True):
        versions = ["Original Plan", "Revised Plan-1", "Revised Plan-2"]
        if include_final:
            versions.append("Final Approved Plan")
        return versions


    def plan_sort_key(self, plan_key):
        record = self.plan_store.get(plan_key, {})
        version_order = {
            "Original Plan": 0,
            "Revised Plan-1": 1,
            "Revised Plan-2": 2,
            "Final Approved Plan": 3,
        }
        return (
            str(record.get("financial_year") or self.current_fy),
            version_order.get(str(record.get("plan_version") or "Original Plan"), 99),
            0 if str(record.get("plan_type") or "BE") == "BE" else 1,
            plan_key,
        )


    def sorted_plan_keys(self, only_approved=False):
        keys = list(self.plan_store.keys())
        if only_approved:
            keys = [key for key in keys if self.plan_store.get(key, {}).get("approved")]
        return sorted(keys, key=self.plan_sort_key)


    def approved_plan_keys(self):
        return self.sorted_plan_keys(only_approved=True)


    def active_plan_locked(self):
        return bool(self.plan_store.get(self.active_plan_name, {}).get("locked"))


    def find_plan_key(self, financial_year, plan_version, plan_type):
        key = self.plan_dataset_key(financial_year, plan_version, plan_type)
        return key if key in self.plan_store else ""


    def infer_legacy_plan_version(self, plan_name, approved=False):
        clean = str(plan_name or "").strip().lower()
        if approved or "final approved" in clean:
            return "Final Approved Plan"
        if "revised plan-2" in clean or clean in {"re-2", "re 2"}:
            return "Revised Plan-2"
        if "revised plan-1" in clean or clean.startswith("re"):
            return "Revised Plan-1"
        return "Original Plan"


    def build_plan_record(
        self,
        rows,
        financial_year,
        plan_version,
        plan_type,
        approved=False,
        locked=False,
        effective=False,
        effective_from_month="",
    ):
        return {
            "rows": self.clone_rows(rows),
            "financial_year": str(financial_year or self.current_fy),
            "plan_version": str(plan_version or "Original Plan"),
            "plan_type": str(plan_type or "BE"),
            "approved": bool(approved),
            "locked": bool(locked),
            "effective": bool(effective),
            "effective_from_month": str(effective_from_month or ""),
        }


    def plan_dataset_key(self, financial_year, plan_version, plan_type):
        return f"{financial_year} | {plan_version} | {plan_type}"


    def financial_year_choices(self):
        return build_financial_year_options()


    def plan_version_choices(self, include_final=True):
        versions = ["Original Plan", "Revised Plan-1", "Revised Plan-2"]
        if include_final:
            versions.append("Final Approved Plan")
        return versions


    def plan_sort_key(self, plan_key):
        record = self.plan_store.get(plan_key, {})
        version_order = {
            "Original Plan": 0,
            "Revised Plan-1": 1,
            "Revised Plan-2": 2,
            "Final Approved Plan": 3,
        }
        return (
            str(record.get("financial_year") or self.current_fy),
            version_order.get(str(record.get("plan_version") or "Original Plan"), 99),
            0 if str(record.get("plan_type") or "BE") == "BE" else 1,
            plan_key,
        )


    def sorted_plan_keys(self, only_approved=False):
        keys = list(self.plan_store.keys())
        if only_approved:
            keys = [key for key in keys if self.plan_store.get(key, {}).get("approved")]
        return sorted(keys, key=self.plan_sort_key)


    def approved_plan_keys(self):
        return self.sorted_plan_keys(only_approved=True)


    def active_plan_locked(self):
        return bool(self.plan_store.get(self.active_plan_name, {}).get("locked"))


    def find_plan_key(self, financial_year, plan_version, plan_type):
        key = self.plan_dataset_key(financial_year, plan_version, plan_type)
        return key if key in self.plan_store else ""


    def infer_legacy_plan_version(self, plan_name, approved=False):
        clean = str(plan_name or "").strip().lower()
        if approved or "final approved" in clean:
            return "Final Approved Plan"
        if "revised plan-2" in clean or clean in {"re-2", "re 2"}:
            return "Revised Plan-2"
        if "revised plan-1" in clean or clean.startswith("re"):
            return "Revised Plan-1"
        return "Original Plan"


    def build_plan_record(
        self,
        rows,
        financial_year,
        plan_version,
        plan_type,
        approved=False,
        locked=False,
        effective=False,
        effective_from_month="",
    ):
        return {
            "rows": self.clone_rows(rows),
            "financial_year": str(financial_year or self.current_fy),
            "plan_version": str(plan_version or "Original Plan"),
            "plan_type": str(plan_type or "BE"),
            "approved": bool(approved),
            "locked": bool(locked),
            "effective": bool(effective),
            "effective_from_month": str(effective_from_month or ""),
        }


    def plan_dataset_key(self, financial_year, plan_version, plan_type):
        return f"{financial_year} | {plan_version} | {plan_type}"


    def financial_year_choices(self):
        return build_financial_year_options()


    def plan_version_choices(self, include_final=True):
        versions = ["Original Plan", "Revised Plan-1", "Revised Plan-2"]
        if include_final:
            versions.append("Final Approved Plan")
        return versions


    def plan_sort_key(self, plan_key):
        record = self.plan_store.get(plan_key, {})
        version_order = {
            "Original Plan": 0,
            "Revised Plan-1": 1,
            "Revised Plan-2": 2,
            "Final Approved Plan": 3,
        }
        return (
            str(record.get("financial_year") or self.current_fy),
            version_order.get(str(record.get("plan_version") or "Original Plan"), 99),
            0 if str(record.get("plan_type") or "BE") == "BE" else 1,
            plan_key,
        )


    def sorted_plan_keys(self, only_approved=False):
        keys = list(self.plan_store.keys())
        if only_approved:
            keys = [key for key in keys if self.plan_store.get(key, {}).get("approved")]
        return sorted(keys, key=self.plan_sort_key)


    def approved_plan_keys(self):
        return self.sorted_plan_keys(only_approved=True)


    def active_plan_locked(self):
        return bool(self.plan_store.get(self.active_plan_name, {}).get("locked"))


    def find_plan_key(self, financial_year, plan_version, plan_type):
        key = self.plan_dataset_key(financial_year, plan_version, plan_type)
        return key if key in self.plan_store else ""


    def infer_legacy_plan_version(self, plan_name, approved=False):
        clean = str(plan_name or "").strip().lower()
        if approved or "final approved" in clean:
            return "Final Approved Plan"
        if "revised plan-2" in clean or clean in {"re-2", "re 2"}:
            return "Revised Plan-2"
        if "revised plan-1" in clean or clean.startswith("re"):
            return "Revised Plan-1"
        return "Original Plan"


    def build_plan_record(
        self,
        rows,
        financial_year,
        plan_version,
        plan_type,
        approved=False,
        locked=False,
        effective=False,
        effective_from_month="",
    ):
        return {
            "rows": self.clone_rows(rows),
            "financial_year": str(financial_year or self.current_fy),
            "plan_version": str(plan_version or "Original Plan"),
            "plan_type": str(plan_type or "BE"),
            "approved": bool(approved),
            "locked": bool(locked),
            "effective": bool(effective),
            "effective_from_month": str(effective_from_month or ""),
        }


    def ensure_default_plan(self):
        if not self.plan_store:
            default_key = self.plan_dataset_key(self.current_fy, "Original Plan", "BE")
            default_rows = self.clone_rows(self.rows) if self.rows else self.default_rows()
            self.plan_store[default_key] = self.build_plan_record(
                default_rows,
                self.current_fy,
                "Original Plan",
                "BE",
                approved=False,
                locked=False,
                effective=True,
            )
            self.active_plan_name = default_key
            self.rows = self.clone_rows(default_rows)
            return

        if not self.active_plan_name or self.active_plan_name not in self.plan_store:
            effective_name = next(
                (key for key in self.sorted_plan_keys() if self.plan_store.get(key, {}).get("effective")),
                "",
            )
            self.active_plan_name = effective_name or (self.sorted_plan_keys()[0] if self.plan_store else "")

        if self.active_plan_name and self.active_plan_name in self.plan_store:
            active_record = self.plan_store[self.active_plan_name]
            self.current_fy = str(active_record.get("financial_year") or self.current_fy)
            self.rows = self.clone_rows(active_record.get("rows", []))


    def save_current_plan_state(self):
        if not self.active_plan_name:
            return
        self.sync_node_metadata()
        current_record = self.plan_store.get(self.active_plan_name, {})
        self.plan_store[self.active_plan_name] = self.build_plan_record(
            self.rows,
            current_record.get("financial_year") or self.current_fy,
            current_record.get("plan_version") or "Original Plan",
            current_record.get("plan_type") or "BE",
            approved=current_record.get("approved", False),
            locked=current_record.get("locked", False),
            effective=current_record.get("effective", False),
            effective_from_month=current_record.get("effective_from_month", ""),
        )


    def load_plan_rows(self, plan_name):
        if plan_name not in self.plan_store:
            return
        self.active_plan_name = plan_name
        self.rows = self.clone_rows(self.plan_store[plan_name]["rows"])
        self.rows = self.prune_deleted_project_rows(self.rows)
        self.selected_row_index = 0 if self.rows else None

    def load_saved_rows(self):
        if not os.path.exists(CAPEX_SAVE_PATH):
            return []
        try:
            with open(CAPEX_SAVE_PATH, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            return []

        self.current_fy = str(payload.get("financial_year") or self.current_fy)
        plans_payload = payload.get("plans")
        if isinstance(plans_payload, dict) and plans_payload:
            self.plan_store = {}
            legacy_name_map = {}
            active_name = str(payload.get("active_plan") or "").strip()
            for plan_name, plan_data in plans_payload.items():
                clean_name = str(plan_name or "").strip()
                if not clean_name:
                    continue
                plan_rows = self.parse_saved_rows(plan_data.get("rows", []))
                plan_type = str(plan_data.get("plan_type") or ("RE" if "RE" in clean_name.upper() else "BE"))
                financial_year = str(plan_data.get("financial_year") or self.current_fy)
                plan_version = str(plan_data.get("plan_version") or self.infer_legacy_plan_version(clean_name, plan_data.get("approved", False)))
                approved = bool(plan_data.get("approved", False) or plan_version == "Final Approved Plan")
                locked = bool(plan_data.get("locked", False) or approved)
                dataset_key = self.plan_dataset_key(financial_year, plan_version, plan_type)
                self.plan_store[dataset_key] = self.build_plan_record(
                    plan_rows,
                    financial_year,
                    plan_version,
                    plan_type,
                    approved=approved,
                    locked=locked,
                    effective=bool(plan_data.get("effective", False)),
                    effective_from_month=str(plan_data.get("effective_from_month") or ""),
                )
                legacy_name_map[clean_name] = dataset_key

            resolved_active = active_name if active_name in self.plan_store else legacy_name_map.get(active_name, "")
            self.active_plan_name = resolved_active if resolved_active in self.plan_store else ""
            if self.active_plan_name:
                return self.clone_rows(self.plan_store[self.active_plan_name]["rows"])

            effective_name = next((key for key in self.sorted_plan_keys() if self.plan_store.get(key, {}).get("effective")), "")
            if effective_name:
                self.active_plan_name = effective_name
                return self.clone_rows(self.plan_store[effective_name]["rows"])
            if self.plan_store:
                first_name = self.sorted_plan_keys()[0]
                self.active_plan_name = first_name
                return self.clone_rows(self.plan_store[first_name]["rows"])
            return []

        loaded_rows = self.parse_saved_rows(payload.get("rows", []))
        if loaded_rows:
            default_key = self.plan_dataset_key(self.current_fy, "Original Plan", "BE")
            self.plan_store = {
                default_key: self.build_plan_record(
                    loaded_rows,
                    self.current_fy,
                    "Original Plan",
                    "BE",
                    approved=False,
                    locked=False,
                    effective=True,
                )
            }
            self.active_plan_name = default_key
        return loaded_rows


    def parse_saved_rows(self, saved_rows):
        loaded_rows = []
        max_row_id = 0
        for saved_row in saved_rows:
            values = empty_values()
            for key, value in (saved_row.get("values") or {}).items():
                if key in values:
                    values[key] = "" if value is None else str(value)
                elif key in CAPEX_MONTHS:
                    # Compatibility with the older one-column-per-month format.
                    values[month_subcolumn(key, "BE")] = "" if value is None else str(value)
            try:
                row_id = int(saved_row.get("row_id") or 0)
            except (TypeError, ValueError):
                row_id = 0
            if row_id <= 0:
                row_id = self.next_row_id
            loaded_rows.append({
                "row_id": row_id,
                "values": values,
                "indent": self.normalize_indent(saved_row.get("indent") or 0),
                "collapsed": bool(saved_row.get("collapsed", False)),
                "imported_for": saved_row.get("imported_for"),
                "level": saved_row.get("level") or self.level_from_indent(saved_row.get("indent") or 0),
                "children": list(saved_row.get("children") or []),
            })
            max_row_id = max(max_row_id, row_id)
        self.next_row_id = max(self.next_row_id, max_row_id + 1)
        return self.normalize_amr_subheaders(self.sync_node_metadata(loaded_rows))

    def prune_deleted_project_rows(self, rows):
        if not rows:
            return rows

        allowed_project_ids = self.main_app.get_allowed_project_ids() if self.main_app else None
        valid_project_names = {
            str(project.get("project_name") or "").strip().lower()
            for project in get_all_projects(allowed_project_ids)
            if str(project.get("project_name") or "").strip()
        }
        if not valid_project_names:
            return rows

        pruned_rows = []
        for row in rows:
            label = str((row.get("values") or {}).get("CAPEX Plan (FY)") or "").strip()
            is_imported_project = (
                row.get("imported_for") is not None
                and row.get("indent", 0) >= 2
                and label
                and label not in AMR_BUCKET_NAMES
            )
            if is_imported_project and label.lower() not in valid_project_names:
                continue
            pruned_rows.append(row)
        return self.normalize_amr_subheaders(self.sync_node_metadata(pruned_rows))

    def normalize_amr_subheaders(self, rows):
        if not rows:
            return rows

        rows = list(rows)
        amr_index = next(
            (
                idx
                for idx, row in enumerate(rows)
                if str((row.get("values") or {}).get("CAPEX Plan (FY)") or "").strip() == "2. AMR"
                and self.normalize_indent(row.get("indent") or 0) == 0
            ),
            None,
        )
        if amr_index is None:
            return self.sync_node_metadata(rows)

        amr_end = amr_index
        scan = amr_index + 1
        while scan < len(rows):
            if self.normalize_indent(rows[scan].get("indent") or 0) <= 0:
                break
            amr_end = scan
            scan += 1

        amr_children = []
        idx = amr_index + 1
        while idx <= amr_end:
            row = rows[idx]
            indent = self.normalize_indent(row.get("indent") or 0)
            if indent != 1:
                idx += 1
                continue
            block_end = idx
            while block_end + 1 <= amr_end:
                next_indent = self.normalize_indent(rows[block_end + 1].get("indent") or 0)
                if next_indent <= 1:
                    break
                block_end += 1
            amr_children.append((idx, block_end))
            idx = block_end + 1

        bucket_templates = {}
        bucket_descendants = {name: [] for name in AMR_BUCKET_ORDER}
        bucket_item_names = {name: set() for name in AMR_BUCKET_ORDER}
        other_blocks = []

        for block_start, block_end in amr_children:
            row = rows[block_start]
            label = str((row.get("values") or {}).get("CAPEX Plan (FY)") or "").strip()
            block_rows = rows[block_start:block_end + 1]
            canonical_label = AMR_BUCKET_ALIASES.get(label.lower(), label)
            if canonical_label in AMR_BUCKET_NAMES:
                bucket_templates.setdefault(canonical_label, row)
                for child_row in block_rows[1:]:
                    child_label = str((child_row.get("values") or {}).get("CAPEX Plan (FY)") or "").strip().lower()
                    child_indent = self.normalize_indent(child_row.get("indent") or 0)
                    if child_indent == 2 and child_label and child_label in bucket_item_names[canonical_label]:
                        continue
                    if child_indent == 2 and child_label:
                        bucket_item_names[canonical_label].add(child_label)
                    bucket_descendants[canonical_label].append(child_row)
            else:
                other_blocks.extend(block_rows)

        rebuilt = rows[:amr_index + 1]
        for bucket_name in AMR_BUCKET_ORDER:
            template_row = bucket_templates.get(bucket_name)
            if template_row is None:
                template_row = self.make_row(bucket_name, indent=1, collapsed=False)
            else:
                template_row = dict(template_row)
                template_row["values"] = dict(template_row.get("values") or {})
                template_row["values"]["CAPEX Plan (FY)"] = bucket_name
                template_row["indent"] = 1
                template_row["imported_for"] = None
            rebuilt.append(template_row)
            for child_row in bucket_descendants[bucket_name]:
                normalized_child = dict(child_row)
                normalized_child["values"] = dict(child_row.get("values") or {})
                normalized_child["indent"] = max(2, self.normalize_indent(child_row.get("indent") or 0))
                rebuilt.append(normalized_child)

        rebuilt.extend(other_blocks)
        rebuilt.extend(rows[amr_end + 1:])
        return self.sync_node_metadata(rebuilt)

    def level_from_indent(self, indent):
        indent = self.normalize_indent(indent)
        if indent <= 0:
            return LEVEL_HEADER
        if indent == 1:
            return LEVEL_SUBHEADER
        return LEVEL_ITEM

    def sync_node_metadata(self, rows=None):
        target_rows = self.rows if rows is None else rows
        if target_rows is None:
            return []

        id_to_children = {row["row_id"]: [] for row in target_rows}
        for row in target_rows:
            indent = self.normalize_indent(row.get("indent") or 0)
            row["indent"] = indent
            row["level"] = self.level_from_indent(indent)
            row["children"] = []

        for index, row in enumerate(target_rows):
            for child_index in self.get_direct_children_indexes(index, target_rows):
                id_to_children[row["row_id"]].append(target_rows[child_index]["row_id"])

        for row in target_rows:
            row["children"] = id_to_children.get(row["row_id"], [])
        return target_rows

    def save_capex_data(self):
        self.focus_set()
        self.save_current_plan_state()
        payload = {
            "financial_year": self.current_fy,
            "active_plan": self.active_plan_name,
            "plans": {
                plan_name: {
                    "financial_year": str(plan_data.get("financial_year") or self.current_fy),
                    "plan_version": str(plan_data.get("plan_version") or "Original Plan"),
                    "plan_type": str(plan_data.get("plan_type") or "BE"),
                    "approved": bool(plan_data.get("approved", False)),
                    "locked": bool(plan_data.get("locked", False)),
                    "effective": bool(plan_data.get("effective", False)),
                    "effective_from_month": str(plan_data.get("effective_from_month") or ""),
                    "rows": [
                        {
                            "row_id": row["row_id"],
                            "values": row["values"],
                            "indent": row["indent"],
                            "level": row.get("level"),
                            "children": row.get("children", []),
                            "collapsed": row.get("collapsed", False),
                            "imported_for": row.get("imported_for"),
                        }
                        for row in plan_data.get("rows", [])
                    ],
                }
                for plan_name, plan_data in self.plan_store.items()
            },
        }
        try:
            os.makedirs(os.path.dirname(CAPEX_SAVE_PATH), exist_ok=True)
            with open(CAPEX_SAVE_PATH, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
            messagebox.showinfo("Saved", f"CAPEX entries saved for {self.active_plan_name}.")
        except Exception as exc:
            messagebox.showerror("Save Failed", f"Unable to save CAPEX entries:\n{exc}")
        keep_window_active(self)


    def compact_footer_buttons(self):
        footer = getattr(self, "footer", None)
        if footer is None:
            return
        widths = {
            "➕\nAdd": 8,
            "📥\nImport": 9,
            "💾\nSave": 8,
            "🗑️\nDelete": 8,
            "➡\nIndent": 8,
            "⬅\nOutdent": 8,
            "⬆\nUp": 7,
            "⬇\nDown": 7,
            "🔄\nRefresh": 9,
            "✖\nClose": 8,
        }
        for child in footer.winfo_children():
            if isinstance(child, Button):
                label = str(child.cget("text"))
                child.config(
                    width=widths.get(label, 8),
                    height=2,
                    font=("Arial", 7, "bold"),
                    padx=2,
                    pady=1,
                    justify="center",
                    anchor="center",
                )
                child.pack_configure(padx=4, pady=2)
        return
        widths = {
            "Import by Status": 15,
            "Move Down": 11,
            "Move Up": 10,
            "Add Item": 11,
            "Outdent": 10,
            "Indent": 9,
            "Close": 8,
            "Save": 8,
        }
        for child in footer.winfo_children():
            if isinstance(child, Button):
                text = str(child.cget("text"))
                clean_text = text.replace("âž•", "").replace("âž¡", "").replace("â¬…", "").replace("â¬†", "").replace("â¬‡", "").strip()
                child.config(width=widths.get(clean_text, 8), height=1, font=("Arial", 9, "bold"), padx=3, pady=1)
                child.pack_configure(padx=4, pady=2)

    def refresh_view(self):
        self.focus_set()
        self.save_current_plan_state()
        self.rows = self.prune_deleted_project_rows(self.rows)
        self.plan_store[self.active_plan_name]["rows"] = self.clone_rows(self.rows)
        self.refresh_plan_selector()
        self.draw_header_grid()
        self.draw_data_grid()
        keep_window_active(self)

    def refresh_plan_selector(self):
        if not hasattr(self, "plan_combo"):
            return
        plan_names = self.sorted_plan_keys()
        self.plan_combo["values"] = plan_names
        if self.active_plan_name in self.plan_store:
            self.plan_var.set(self.active_plan_name)
        elif plan_names:
            self.active_plan_name = plan_names[0]
            self.plan_var.set(self.active_plan_name)
            self.rows = self.clone_rows(self.plan_store[self.active_plan_name]["rows"])
        effective_name = next((name for name, data in self.plan_store.items() if data.get("effective")), self.active_plan_name)
        effective_data = self.plan_store.get(effective_name, {})
        effective_type = str(effective_data.get("plan_type") or "BE")
        effective_month = str(effective_data.get("effective_from_month") or "")
        effective_fy = str(effective_data.get("financial_year") or self.current_fy)
        effective_version = str(effective_data.get("plan_version") or effective_name)
        if effective_type == "RE" and effective_month:
            self.effective_plan_label_var.set(f"Current Effective: {effective_fy} | {effective_version} | {effective_type} | RE from {effective_month}")
        else:
            self.effective_plan_label_var.set(f"Current Effective: {effective_fy} | {effective_version} | {effective_type}")


    def on_plan_selected(self, event=None):
        selected_name = self.plan_var.get().strip()
        if not selected_name or selected_name == self.active_plan_name:
            return
        self.save_current_plan_state()
        self.load_plan_rows(selected_name)
        self.refresh_plan_selector()
        self.draw_data_grid()
        keep_window_active(self)

    def set_effective_plan(self):
        selected_name = self.plan_var.get().strip() or self.active_plan_name
        if not selected_name or selected_name not in self.plan_store:
            return
        self.save_current_plan_state()
        selected_plan = self.plan_store[selected_name]
        if not bool(selected_plan.get("approved", False)):
            messagebox.showwarning(
                "Approval Required",
                "Only approved plans can be set as effective. Please approve the plan from the CAPEX Planning window first.",
                parent=self,
            )
            keep_window_active(self)
            return
        for plan_name in self.plan_store:
            self.plan_store[plan_name]["effective"] = plan_name == selected_name
        self.active_plan_name = selected_name
        self.rows = self.clone_rows(self.plan_store[selected_name]["rows"])
        self.refresh_plan_selector()
        self.draw_header_grid()
        self.draw_data_grid()
        self.save_capex_data()


    def open_new_plan_popup(self, parent_popup=None, on_created=None):
        popup = Toplevel(parent_popup or self)
        popup.title("Create CAPEX Plan")
        popup.geometry("470x280")
        popup.configure(bg="#f0f4f8")
        popup.grab_set()

        Label(popup, text="Create CAPEX Planning Dataset", bg="#f0f4f8", fg="#003087",
              font=("Arial", 15, "bold")).pack(pady=(18, 12))

        form = Frame(popup, bg="#f0f4f8")
        form.pack(fill=X, padx=28)

        fy_var = StringVar(value=self.current_fy)
        version_var = StringVar(value="Original Plan")
        type_var = StringVar(value="BE")

        Label(form, text="Financial Year:", bg="#f0f4f8", font=("Arial", 11, "bold")).grid(row=0, column=0, sticky=W, pady=8)
        ttk.Combobox(form, textvariable=fy_var, values=self.financial_year_choices(), width=20, state="readonly").grid(row=0, column=1, sticky=W, pady=8)

        Label(form, text="Plan Version:", bg="#f0f4f8", font=("Arial", 11, "bold")).grid(row=1, column=0, sticky=W, pady=8)
        ttk.Combobox(form, textvariable=version_var, values=self.plan_version_choices(include_final=False), width=20, state="readonly").grid(row=1, column=1, sticky=W, pady=8)

        Label(form, text="Plan Type:", bg="#f0f4f8", font=("Arial", 11, "bold")).grid(row=2, column=0, sticky=W, pady=8)
        ttk.Combobox(form, textvariable=type_var, values=["BE", "RE"], width=20, state="readonly").grid(row=2, column=1, sticky=W, pady=8)

        Label(
            popup,
            text="Each Financial Year + Plan Version + Plan Type combination is stored independently.",
            bg="#f0f4f8",
            fg="#475569",
            font=("Arial", 10),
            wraplength=380,
            justify="center",
        ).pack(pady=(12, 0))

        def create_plan():
            financial_year = fy_var.get().strip() or self.current_fy
            plan_version = version_var.get().strip() or "Original Plan"
            plan_type = type_var.get().strip() or "BE"
            if plan_version == "Final Approved Plan":
                messagebox.showwarning(
                    "Restricted",
                    "Final Approved Plan is system-controlled and is created only after approval.",
                    parent=popup,
                )
                keep_window_active(popup)
                return

            dataset_key = self.plan_dataset_key(financial_year, plan_version, plan_type)
            if dataset_key in self.plan_store:
                if messagebox.askyesno("Plan Exists", "This dataset already exists. Open it now?", parent=popup):
                    popup.destroy()
                    if on_created:
                        on_created(dataset_key)
                    keep_window_active(parent_popup or self)
                return

            template_rows = self.clone_rows(self.rows) if self.rows else self.default_rows()
            self.plan_store[dataset_key] = self.build_plan_record(
                template_rows,
                financial_year,
                plan_version,
                plan_type,
                approved=False,
                locked=False,
                effective=False,
            )
            if not on_created:
                self.active_plan_name = dataset_key
                self.rows = self.clone_rows(template_rows)
                self.refresh_plan_selector()
                self.draw_data_grid()
            popup.destroy()
            if on_created:
                on_created(dataset_key)
            keep_window_active(parent_popup or self)

        Button(popup, text="Create Plan", command=create_plan, bg="#008000", fg="white",
               font=("Arial", 10, "bold"), width=16).pack(pady=20)
        normalize_buttons(popup)
        keep_window_active(popup)


    def open_planning_popup(self):
        self.save_current_plan_state()

        popup = Toplevel(self)
        popup.title(f"CAPEX Planning - {self.current_fy}")
        popup.geometry("1500x760")
        popup.configure(bg="#eef3f8")
        popup.grab_set()

        Label(popup, text=f"CAPEX Planning - {self.current_fy}", bg="#eef3f8", fg="#003087",
              font=("Arial", 18, "bold")).pack(pady=(16, 6))

        top_bar = Frame(popup, bg="#eef3f8")
        top_bar.pack(fill=X, padx=18, pady=(0, 8))
        Label(top_bar, text="Plan Version:", bg="#eef3f8", fg="#003087",
              font=("Arial", 10, "bold")).pack(side=LEFT)
        popup_plan_var = StringVar(value=self.active_plan_name)
        popup_plan_combo = ttk.Combobox(top_bar, textvariable=popup_plan_var, values=list(self.plan_store.keys()), state="readonly", width=24)
        popup_plan_combo.pack(side=LEFT, padx=(8, 10))
        popup_plan_info_var = StringVar()
        Label(top_bar, textvariable=popup_plan_info_var, bg="#eef3f8", fg="#374151",
              font=("Arial", 10, "bold")).pack(side=LEFT, padx=10)

        table_frame = Frame(popup, bg="#eef3f8")
        table_frame.pack(fill=BOTH, expand=True, padx=18, pady=10)

        planning_columns = ["CAPEX Plan (FY)", "Gross Cost", "BE (FY)", "RE (FY)"] + [title for title, _, _ in MONTH_COLUMNS]
        planning_tree = ttk.Treeview(table_frame, columns=planning_columns, show="headings", height=22)
        planning_tree.heading("CAPEX Plan (FY)", text="Item")
        planning_tree.column("CAPEX Plan (FY)", width=280, anchor="w", stretch=False)
        planning_tree.column("Gross Cost", width=100, anchor="center", stretch=False)
        planning_tree.column("BE (FY)", width=90, anchor="center", stretch=False)
        planning_tree.column("RE (FY)", width=90, anchor="center", stretch=False)
        for month_col in [title for title, _, _ in MONTH_COLUMNS]:
            planning_tree.heading(month_col, text=month_col.replace(" ", "\n"))
            planning_tree.column(month_col, width=78, anchor="center", stretch=False)
        planning_tree.pack(side=LEFT, fill=BOTH, expand=True)

        tree_y = ttk.Scrollbar(table_frame, orient=VERTICAL, command=planning_tree.yview)
        tree_y.pack(side=RIGHT, fill=Y)
        planning_tree.configure(yscrollcommand=tree_y.set)

        bottom_x = ttk.Scrollbar(popup, orient=HORIZONTAL, command=planning_tree.xview)
        bottom_x.pack(fill=X, padx=18)
        planning_tree.configure(xscrollcommand=bottom_x.set)

        popup_state = {
            "plan_name": popup_plan_var.get().strip(),
            "rows": self.clone_rows(self.plan_store[popup_plan_var.get().strip()]["rows"]) if popup_plan_var.get().strip() in self.plan_store else [],
        }

        def popup_plan_info():
            plan_name = popup_state["plan_name"]
            plan_data = self.plan_store.get(plan_name, {})
            plan_type = str(plan_data.get("plan_type") or "BE")
            effective_month = str(plan_data.get("effective_from_month") or "")
            if plan_type == "RE" and effective_month:
                popup_plan_info_var.set(f"Type: {plan_type} | Effective from: {effective_month}")
            else:
                popup_plan_info_var.set(f"Type: {plan_type}")

        def render_popup_rows():
            planning_tree.delete(*planning_tree.get_children())
            popup_plan_info()
            for row in popup_state["rows"]:
                level = row.get("level") or self.level_from_indent(row.get("indent", 0))
                if level != LEVEL_ITEM:
                    continue
                values = row.get("values", {})
                row_values = [values.get("CAPEX Plan (FY)", ""), values.get("Gross Cost", ""), values.get("BE (FY)", ""), values.get("RE (FY)", "")]
                for month_col in [title for title, _, _ in MONTH_COLUMNS]:
                    row_values.append(values.get(month_col, ""))
                planning_tree.insert("", END, iid=str(row["row_id"]), values=row_values)

        def save_popup_plan_state():
            plan_name = popup_state["plan_name"]
            if not plan_name:
                return
            self.plan_store[plan_name]["rows"] = self.clone_rows(popup_state["rows"])
            if self.active_plan_name == plan_name:
                self.rows = self.clone_rows(self.plan_store[plan_name]["rows"])

        def switch_popup_plan(event=None):
            selected_name = popup_plan_var.get().strip()
            if not selected_name or selected_name == popup_state["plan_name"]:
                return
            save_popup_plan_state()
            popup_state["plan_name"] = selected_name
            popup_state["rows"] = self.clone_rows(self.plan_store[selected_name]["rows"])
            render_popup_rows()

        def edit_popup_cell(event=None):
            selected = planning_tree.selection()
            if not selected:
                return
            item_id = selected[0]
            region = planning_tree.identify("region", event.x, event.y) if event else "cell"
            if region != "cell":
                return
            column_id = planning_tree.identify_column(event.x) if event else ""
            if not column_id:
                return
            col_index = int(column_id.replace("#", "")) - 1
            if col_index <= 0:
                return
            col_name = planning_columns[col_index]
            row = next((r for r in popup_state["rows"] if str(r["row_id"]) == str(item_id)), None)
            if not row:
                return
            current_value = str((row.get("values") or {}).get(col_name, "") or "")
            new_value = simpledialog.askstring("Edit Planning Value", f"Enter value for {col_name}", initialvalue=current_value, parent=popup)
            if new_value is None:
                return
            clean_value = new_value.strip()
            if clean_value:
                try:
                    clean_value = f"{float(clean_value):.2f}"
                except ValueError:
                    clean_value = ""
            row["values"][col_name] = clean_value
            render_popup_rows()

        def save_popup():
            save_popup_plan_state()
            self.refresh_plan_selector()
            self.draw_data_grid()
            self.save_capex_data()
            keep_window_active(popup)

        planning_tree.bind("<Double-1>", edit_popup_cell)
        popup_plan_combo.bind("<<ComboboxSelected>>", switch_popup_plan)

        btns = Frame(popup, bg="#eef3f8")
        btns.pack(fill=X, padx=18, pady=12)
        Button(btns, text="💾 Save Planning", command=save_popup, bg="#0066cc", fg="white",
               font=("Arial", 10, "bold"), width=16).pack(side=LEFT, padx=6)
        Button(btns, text="🔄 Refresh", command=render_popup_rows, bg="#2f9e44", fg="white",
               font=("Arial", 10, "bold"), width=12).pack(side=LEFT, padx=6)
        Button(btns, text="Close", command=popup.destroy, bg="#555555", fg="white",
               font=("Arial", 10, "bold"), width=10).pack(side=RIGHT, padx=6)

        render_popup_rows()
        keep_window_active(popup)

    def open_planning_popup_v2(self):
        self.save_current_plan_state()

        popup = Toplevel(self)
        popup.title("CAPEX Planning Management")
        popup.geometry("1900x980")
        popup.minsize(1320, 760)
        try:
            popup.state("zoomed")
        except Exception:
            pass
        popup.configure(bg="#f4f8fc")
        popup.grab_set()

        planning_header_height = 74
        planning_row_height = 32
        planning_base_columns = [
            ("CAPEX Plan (FY)", 330, "#063a7a"),
            ("Gross Cost", 120, "#063a7a"),
            ("Cummulative Expenditure till Last FY", 165, "#063a7a"),
            ("BE (FY)", 105, "#063a7a"),
            ("RE (FY)", 105, "#063a7a"),
        ]
        planning_subheaders = ("BE", "RE")
        planning_month_columns = [
            (f"{month} {subheader}", 82, "#074a93")
            for month in CAPEX_MONTHS
            for subheader in planning_subheaders
        ]
        planning_columns = planning_base_columns + planning_month_columns
        planning_total_width = sum(width for _, width, _ in planning_columns)

        header = Frame(popup, bg="#003087", height=58)
        header.pack(fill=X)
        header.pack_propagate(False)
        Label(
            header,
            text="CAPEX Planning Management",
            bg="#003087",
            fg="white",
            font=("Arial", 18, "bold"),
        ).pack(side=LEFT, padx=24, pady=13)
        Label(header, text="?", bg="#003087", fg="white", font=("Arial", 13, "bold")).pack(side=RIGHT, padx=(0, 6), pady=15)
        Label(header, text="Help", bg="#003087", fg="white", font=("Arial", 10, "bold")).pack(side=RIGHT, padx=(0, 22), pady=18)

        body = Frame(popup, bg="#f4f8fc")
        body.pack(fill=BOTH, expand=True, padx=22, pady=(14, 10))

        selector_card = Frame(body, bg="#f4f8fc")
        selector_card.pack(fill=X, pady=(0, 10))
        selector_card.pack_propagate(False)
        selector_card.configure(height=56)

        top_row = Frame(selector_card, bg="#f4f8fc")
        top_row.pack(fill=X)

        active_record = self.plan_store.get(self.active_plan_name, {})
        default_fy = str(active_record.get("financial_year") or self.current_fy)
        default_version = str(active_record.get("plan_version") or "Original Plan")
        default_type = str(active_record.get("plan_type") or "BE")

        popup_fy_var = StringVar(value=default_fy)
        popup_version_var = StringVar(value=default_version)
        popup_type_var = StringVar(value=default_type)
        popup_info_var = StringVar()
        popup_validation_var = StringVar()
        popup_indicator_var = StringVar()
        popup_notice_var = StringVar()
        popup_gross_var = StringVar(value="Rs 0.00 Cr")
        popup_plan_var = StringVar(value="Rs 0.00 Cr")
        popup_actual_var = StringVar(value="Rs 0.00 Cr")
        popup_variance_var = StringVar(value="Rs 0.00 Cr")
        popup_progress_var = StringVar(value="0.00%")
        snapshot_name_var = StringVar(value="-")
        snapshot_level_var = StringVar(value="-")
        snapshot_gross_var = StringVar(value="0.00")
        snapshot_plan_var = StringVar(value="0.00")
        snapshot_actual_var = StringVar(value="0.00")
        snapshot_progress_var = StringVar(value="0.00%")
        alert_1_var = StringVar(value="Select or create a dataset to review planning alerts.")
        alert_2_var = StringVar(value="")
        alert_3_var = StringVar(value="")

        def form_field(parent, label, variable, values, width):
            field = Frame(parent, bg="#f4f8fc")
            field.pack(side=LEFT, padx=(0, 22), fill=Y)
            Label(field, text=label, bg="#f4f8fc", fg="#183153", font=("Arial", 9, "bold")).pack(anchor="w")
            combo = ttk.Combobox(field, textvariable=variable, values=values, state="readonly", width=width)
            combo.pack(anchor="w", pady=(4, 0), ipady=3)
            return combo

        popup_fy_combo = form_field(top_row, "Financial Year (FY)", popup_fy_var, self.financial_year_choices(), 28)
        popup_version_combo = form_field(top_row, "Plan Version", popup_version_var, self.plan_version_choices(), 24)
        popup_type_combo = form_field(top_row, "Plan Type", popup_type_var, ["BE", "RE"], 18)

        active_wrap = Frame(top_row, bg="#f4f8fc")
        active_wrap.pack(side=LEFT, padx=(0, 20), fill=Y)
        Label(active_wrap, text="Active Plan", bg="#f4f8fc", fg="#183153", font=("Arial", 9, "bold")).pack(anchor="w")
        active_pill = Label(active_wrap, text="YES", bg="#0f9d58", fg="white", font=("Arial", 8, "bold"), width=7, height=1)
        active_pill.pack(anchor="w", pady=(8, 0))

        top_actions = Frame(top_row, bg="#f4f8fc")
        top_actions.pack(side=RIGHT, fill=Y)

        kpi_bar = Frame(body, bg="#f4f8fc", height=96)
        kpi_bar.pack(fill=X, pady=(0, 12))
        kpi_bar.pack_propagate(False)

        def kpi_card(parent, title, variable, accent):
            card = Frame(parent, bg="white", relief="solid", bd=1, width=260, height=82)
            card.pack(side=LEFT, fill=X, expand=True, padx=(0, 12))
            card.pack_propagate(False)
            icon = Label(card, text="", bg=accent, width=5, height=2)
            icon.pack(side=LEFT, padx=16, pady=17)
            text_wrap = Frame(card, bg="white")
            text_wrap.pack(side=LEFT, fill=BOTH, expand=True, pady=15)
            Label(text_wrap, text=title, bg="white", fg="#183153", font=("Arial", 9, "bold")).pack(anchor="w")
            Label(text_wrap, textvariable=variable, bg="white", fg="#111827", font=("Arial", 15, "bold")).pack(anchor="w", pady=(5, 0))

        kpi_card(kpi_bar, "Gross Cost", popup_gross_var, "#0066cc")
        kpi_card(kpi_bar, "FY Plan", popup_plan_var, "#1ab65c")
        kpi_card(kpi_bar, "Actual Till Date", popup_actual_var, "#7c3aed")
        kpi_card(kpi_bar, "Variance", popup_variance_var, "#f97316")
        kpi_card(kpi_bar, "Progress", popup_progress_var, "#0ea5a4")

        btns = Frame(body, bg="#f4f8fc", height=46)
        btns.pack(side=BOTTOM, fill=X, pady=(8, 0))
        btns.pack_propagate(False)

        workspace = Frame(body, bg="#f4f8fc")
        workspace.pack(fill=BOTH, expand=True)

        left_area = Frame(workspace, bg="#f4f8fc")
        left_area.pack(side=LEFT, fill=BOTH, expand=True)

        toolbar = Frame(left_area, bg="#f4f8fc", height=44)
        toolbar.pack(fill=X)
        toolbar.pack_propagate(False)
        Label(toolbar, text="View By", bg="#f4f8fc", fg="#183153", font=("Arial", 9, "bold")).pack(side=LEFT, pady=9)
        Label(toolbar, text="Monthly", bg="#0066cc", fg="white", font=("Arial", 9, "bold"), width=10, height=1).pack(side=LEFT, padx=(10, 0), pady=8)
        Label(toolbar, text="Quarterly", bg="white", fg="#183153", font=("Arial", 9), width=10, height=1, relief="solid", bd=1).pack(side=LEFT, pady=8)
        Label(toolbar, text="FY Summary", bg="white", fg="#183153", font=("Arial", 9), width=12, height=1, relief="solid", bd=1).pack(side=LEFT, pady=8)
        Label(toolbar, textvariable=popup_indicator_var, bg="#f4f8fc", fg="#475569", font=("Arial", 9, "bold")).pack(side=RIGHT, pady=10)

        table_wrap = Frame(left_area, bg="#d7e1ec", relief="solid", bd=1)
        table_wrap.pack(fill=BOTH, expand=True)

        planning_header = Canvas(table_wrap, bg="#063a7a", height=planning_header_height, highlightthickness=0)
        planning_header.pack(fill=X)

        planning_body = Canvas(table_wrap, bg="white", highlightthickness=0)
        planning_body.pack(side=LEFT, fill=BOTH, expand=True)

        planning_y = ttk.Scrollbar(table_wrap, orient=VERTICAL, command=planning_body.yview)
        planning_y.pack(side=RIGHT, fill=Y)

        planning_x = ttk.Scrollbar(left_area, orient=HORIZONTAL)
        planning_x.pack(fill=X, pady=(6, 0))

        def sync_popup_x(*args):
            planning_header.xview(*args)
            planning_body.xview(*args)

        planning_x.configure(command=sync_popup_x)
        planning_body.configure(yscrollcommand=planning_y.set, xscrollcommand=planning_x.set)
        planning_header.configure(xscrollcommand=planning_x.set)

        side_panel = Frame(workspace, bg="#f4f8fc", width=440)
        # Keep the insight widgets alive for summary calculations, but do not
        # reserve screen space for them. The CAPEX planning grid is the primary
        # workspace and should stay centered/full width.
        side_panel.pack_propagate(False)

        snapshot_card = Frame(side_panel, bg="white", relief="solid", bd=1, height=215)
        snapshot_card.pack(fill=X, pady=(44, 10))
        snapshot_card.pack_propagate(False)
        Label(snapshot_card, text="Project Snapshot", bg="white", fg="#003087", font=("Arial", 10, "bold")).pack(anchor="w", padx=16, pady=(12, 8))

        def snapshot_line(parent, label, variable, fg="#183153"):
            row = Frame(parent, bg="white")
            row.pack(fill=X, padx=16, pady=3)
            Label(row, text=label, bg="white", fg="#334155", font=("Arial", 8, "bold"), width=18, anchor="w").pack(side=LEFT)
            Label(row, textvariable=variable, bg="white", fg=fg, font=("Arial", 8, "bold"), anchor="w", justify=LEFT).pack(side=LEFT, fill=X, expand=True)

        snapshot_line(snapshot_card, "Project Name", snapshot_name_var)
        snapshot_line(snapshot_card, "Hierarchy Level", snapshot_level_var)
        snapshot_line(snapshot_card, "Gross Cost", snapshot_gross_var)
        snapshot_line(snapshot_card, "Plan Amount", snapshot_plan_var)
        snapshot_line(snapshot_card, "Actual Till Date", snapshot_actual_var)
        snapshot_line(snapshot_card, "Progress", snapshot_progress_var, "#0f766e")

        curve_card = Frame(side_panel, bg="white", relief="solid", bd=1, height=260)
        curve_card.pack(fill=X, pady=(0, 10))
        curve_card.pack_propagate(False)
        Label(curve_card, text="Plan vs Actual S-Curve", bg="white", fg="#003087", font=("Arial", 10, "bold")).pack(anchor="w", padx=16, pady=(12, 4))
        curve_canvas = Canvas(curve_card, bg="white", height=205, highlightthickness=0)
        curve_canvas.pack(fill=BOTH, expand=True, padx=12, pady=(0, 10))

        alerts_card = Frame(side_panel, bg="white", relief="solid", bd=1, height=150)
        alerts_card.pack(fill=X)
        alerts_card.pack_propagate(False)
        Label(alerts_card, text="Alerts", bg="white", fg="#003087", font=("Arial", 10, "bold")).pack(anchor="w", padx=16, pady=(12, 8))
        Label(alerts_card, textvariable=alert_1_var, bg="white", fg="#dc2626", font=("Arial", 8, "bold"), wraplength=390, justify=LEFT).pack(anchor="w", padx=16, pady=4)
        Label(alerts_card, textvariable=alert_2_var, bg="white", fg="#f97316", font=("Arial", 8, "bold"), wraplength=390, justify=LEFT).pack(anchor="w", padx=16, pady=4)
        Label(alerts_card, textvariable=alert_3_var, bg="white", fg="#0066cc", font=("Arial", 8, "bold"), wraplength=390, justify=LEFT).pack(anchor="w", padx=16, pady=4)

        popup_state = {
            "dataset_key": "",
            "rows": [],
            "selected_row_index": 0,
            "visible_rows": [],
            "active_editor": None,
        }

        def monthly_total(values, subheader):
            total = 0.0
            has_value = False
            for month in CAPEX_MONTHS:
                number = self.parse_number(values.get(month_subcolumn(month, subheader), ""))
                if number is not None:
                    total += number
                    has_value = True
            return f"{total:.2f}" if has_value else ""

        def selected_dataset_key():
            return self.find_plan_key(popup_fy_var.get().strip(), popup_version_var.get().strip(), popup_type_var.get().strip())

        def current_plan_record():
            key = popup_state.get("dataset_key", "")
            return self.plan_store.get(key, {})

        def popup_destroy_editor():
            if popup_state["active_editor"] is not None:
                try:
                    popup_state["active_editor"].destroy()
                except Exception:
                    pass
                popup_state["active_editor"] = None

        def popup_is_parent(row_index):
            rows = popup_state["rows"]
            if row_index < 0 or row_index >= len(rows) - 1:
                return False
            return rows[row_index + 1]["indent"] > rows[row_index]["indent"]

        def popup_visible_row_indexes():
            visible = []
            hidden_until_indent = None
            for idx, row in enumerate(popup_state["rows"]):
                if hidden_until_indent is not None:
                    if row["indent"] > hidden_until_indent:
                        continue
                    hidden_until_indent = None
                visible.append(idx)
                if row.get("collapsed") and popup_is_parent(idx):
                    hidden_until_indent = row["indent"]
            return visible

        def popup_direct_children(row_index):
            rows = popup_state["rows"]
            if row_index < 0 or row_index >= len(rows):
                return []
            parent_indent = rows[row_index]["indent"]
            child_indent = parent_indent + 1
            indexes = []
            idx = row_index + 1
            while idx < len(rows):
                row_indent = rows[idx]["indent"]
                if row_indent <= parent_indent:
                    break
                if row_indent == child_indent:
                    indexes.append(idx)
                idx += 1
            return indexes

        def popup_compute_display_row(row_index):
            row = popup_state["rows"][row_index]
            display = dict(row["values"])
            level = row.get("level") or self.level_from_indent(row.get("indent", 0))
            direct_children = popup_direct_children(row_index)
            if not direct_children:
                display["BE (FY)"] = monthly_total(display, "BE")
                display["RE (FY)"] = monthly_total(display, "RE")
                return display

            expected_child_level = LEVEL_SUBHEADER if level == LEVEL_HEADER else LEVEL_ITEM
            for title, _, _ in planning_columns[1:]:
                total = 0.0
                has_value = False
                for child_index in direct_children:
                    child_row = popup_state["rows"][child_index]
                    child_level = child_row.get("level") or self.level_from_indent(child_row.get("indent", 0))
                    if child_level != expected_child_level:
                        continue
                    child_display = popup_compute_display_row(child_index)
                    value = self.parse_number(child_display.get(title, ""))
                    if value is not None:
                        total += value
                        has_value = True
                display[title] = f"{total:.2f}" if has_value else ""
            return display

        def money_text(value):
            return f"Rs {float(value or 0):,.2f} Cr"

        def selected_plan_column():
            selected_type = popup_type_var.get().strip() or "BE"
            return f"{selected_type} (FY)"

        def top_level_indexes():
            return [idx for idx, row in enumerate(popup_state["rows"]) if self.normalize_indent(row.get("indent", 0)) == 0]

        def leaf_indexes_under(row_index):
            rows = popup_state["rows"]
            if row_index is None or row_index < 0 or row_index >= len(rows):
                return []
            start_indent = self.normalize_indent(rows[row_index].get("indent", 0))
            indexes = []
            idx = row_index + 1
            while idx < len(rows):
                row_indent = self.normalize_indent(rows[idx].get("indent", 0))
                if row_indent <= start_indent:
                    break
                if not popup_direct_children(idx):
                    indexes.append(idx)
                idx += 1
            return indexes or ([row_index] if not popup_direct_children(row_index) else [])

        def summed_value(row_indexes, column):
            total = 0.0
            for row_index in row_indexes:
                value = self.parse_number(popup_compute_display_row(row_index).get(column, ""))
                if value is not None:
                    total += value
            return total

        def actual_total(row_indexes):
            total = 0.0
            for row_index in row_indexes:
                for leaf_index in leaf_indexes_under(row_index):
                    values = popup_state["rows"][leaf_index].get("values", {})
                    for month in CAPEX_MONTHS:
                        value = self.parse_number(values.get(month_subcolumn(month, "Actual"), ""))
                        if value is not None:
                            total += value
            return total

        def monthly_series(row_indexes):
            selected_type = popup_type_var.get().strip() or "BE"
            plan_points = []
            actual_points = []
            plan_running = 0.0
            actual_running = 0.0
            for month in CAPEX_MONTHS:
                month_plan = 0.0
                month_actual = 0.0
                for row_index in row_indexes:
                    for leaf_index in leaf_indexes_under(row_index):
                        values = popup_state["rows"][leaf_index].get("values", {})
                        plan_value = self.parse_number(values.get(month_subcolumn(month, selected_type), ""))
                        actual_value = self.parse_number(values.get(month_subcolumn(month, "Actual"), ""))
                        if plan_value is not None:
                            month_plan += plan_value
                        if actual_value is not None:
                            month_actual += actual_value
                plan_running += month_plan
                actual_running += month_actual
                plan_points.append(plan_running)
                actual_points.append(actual_running)
            return plan_points, actual_points

        def draw_curve(row_indexes):
            curve_canvas.delete("all")
            width = max(curve_canvas.winfo_width(), 360)
            height = max(curve_canvas.winfo_height(), 190)
            left, top, right, bottom = 48, 22, width - 18, height - 34
            plan_points, actual_points = monthly_series(row_indexes)
            max_value = max(plan_points + actual_points + [1.0])
            curve_canvas.create_line(left, bottom, right, bottom, fill="#cbd5e1")
            curve_canvas.create_line(left, top, left, bottom, fill="#cbd5e1")
            for step in range(1, 5):
                y = bottom - ((bottom - top) * step / 4)
                curve_canvas.create_line(left, y, right, y, fill="#edf2f7")
                curve_canvas.create_text(left - 8, y, text=f"{int(max_value * step / 4):,}", anchor="e", fill="#64748b", font=("Arial", 7))
            if len(CAPEX_MONTHS) <= 1:
                return

            def point(index, value):
                x = left + ((right - left) * index / (len(CAPEX_MONTHS) - 1))
                y = bottom - ((bottom - top) * value / max_value)
                return x, y

            for points, color in ((plan_points, "#0077ff"), (actual_points, "#16a34a")):
                coords = []
                for index, value in enumerate(points):
                    coords.extend(point(index, value))
                if len(coords) >= 4:
                    curve_canvas.create_line(*coords, fill=color, width=2, smooth=True)
                for index, value in enumerate(points):
                    x, y = point(index, value)
                    curve_canvas.create_oval(x - 3, y - 3, x + 3, y + 3, fill=color, outline=color)
            curve_canvas.create_line(156, 12, 184, 12, fill="#0077ff", width=2)
            curve_canvas.create_text(190, 12, text="Plan", anchor="w", fill="#183153", font=("Arial", 7, "bold"))
            curve_canvas.create_line(238, 12, 266, 12, fill="#16a34a", width=2)
            curve_canvas.create_text(272, 12, text="Actual", anchor="w", fill="#183153", font=("Arial", 7, "bold"))
            for index in range(0, len(CAPEX_MONTHS), 2):
                x, _ = point(index, 0)
                curve_canvas.create_text(x, bottom + 14, text=CAPEX_MONTHS[index], fill="#64748b", font=("Arial", 7))

        def update_summary_panel():
            key = popup_state.get("dataset_key", "")
            if not key or not popup_state["rows"]:
                popup_gross_var.set("Rs 0.00 Cr")
                popup_plan_var.set("Rs 0.00 Cr")
                popup_actual_var.set("Rs 0.00 Cr")
                popup_variance_var.set("Rs 0.00 Cr")
                popup_progress_var.set("0.00%")
                snapshot_name_var.set("-")
                snapshot_level_var.set("-")
                snapshot_gross_var.set("0.00")
                snapshot_plan_var.set("0.00")
                snapshot_actual_var.set("0.00")
                snapshot_progress_var.set("0.00%")
                alert_1_var.set("Select or create a dataset to review planning alerts.")
                alert_2_var.set("")
                alert_3_var.set("")
                draw_curve([])
                return

            plan_column = selected_plan_column()
            summary_indexes = top_level_indexes()
            gross = summed_value(summary_indexes, "Gross Cost")
            plan = summed_value(summary_indexes, plan_column)
            actual = actual_total(summary_indexes)
            variance = plan - actual
            progress = (actual / plan * 100) if plan else 0.0
            popup_gross_var.set(money_text(gross))
            popup_plan_var.set(money_text(plan))
            popup_actual_var.set(money_text(actual))
            popup_variance_var.set(money_text(variance))
            popup_progress_var.set(f"{progress:.2f}%")

            selected_index = popup_state.get("selected_row_index")
            if selected_index is None or selected_index < 0 or selected_index >= len(popup_state["rows"]):
                selected_index = summary_indexes[0] if summary_indexes else None
            if selected_index is not None:
                display = popup_compute_display_row(selected_index)
                row_indexes = [selected_index]
                selected_actual = actual_total(row_indexes)
                selected_plan = self.parse_number(display.get(plan_column, "")) or 0.0
                selected_progress = (selected_actual / selected_plan * 100) if selected_plan else 0.0
                snapshot_name_var.set(str(display.get("CAPEX Plan (FY)") or "-"))
                snapshot_level_var.set(str(popup_state["rows"][selected_index].get("level") or self.level_from_indent(popup_state["rows"][selected_index].get("indent", 0))))
                snapshot_gross_var.set(f"{self.parse_number(display.get('Gross Cost', '')) or 0.0:,.2f}")
                snapshot_plan_var.set(f"{selected_plan:,.2f}")
                snapshot_actual_var.set(f"{selected_actual:,.2f}")
                snapshot_progress_var.set(f"{selected_progress:.2f}%")

            if plan and progress < 50:
                alert_1_var.set(f"Progress is {progress:.2f}% against the selected {popup_type_var.get().strip() or 'BE'} plan.")
            else:
                alert_1_var.set("Planning progress is aligned with the selected dataset.")
            if variance > 0:
                alert_2_var.set(f"Balance plan exposure: Rs {variance:,.2f} Cr.")
            elif variance < 0:
                alert_2_var.set(f"Actual exceeds plan by Rs {abs(variance):,.2f} Cr.")
            else:
                alert_2_var.set("Plan and actual are currently balanced.")
            alert_3_var.set("Monitor cash flow requirement in the next quarter.")
            draw_curve(summary_indexes)

        def update_indicator():
            plan_type = popup_type_var.get().strip() or "BE"
            locked = bool(current_plan_record().get("locked"))
            if plan_type == "BE":
                message = "BE columns active | RE locked"
            else:
                message = "RE columns active | BE locked"
            if locked:
                message += " | Approved dataset locked"
            popup_indicator_var.set(message)

        def update_info():
            key = popup_state.get("dataset_key", "")
            popup_notice_var.set("")
            if not popup_fy_var.get().strip() or not popup_version_var.get().strip() or not popup_type_var.get().strip():
                popup_info_var.set("Select Financial Year, Plan Version and Plan Type to continue.")
                return
            if not key:
                popup_info_var.set("Dataset not found. Click Create Plan to make a new planning dataset for this selection.")
                return
            record = current_plan_record()
            state_text = "Approved and locked" if record.get("approved") else "Draft working dataset"
            popup_info_var.set(
                f"Dataset: {record.get('financial_year')} / {record.get('plan_version')} / {record.get('plan_type')} | {state_text}"
            )

        def evaluate_validation():
            key = popup_state.get("dataset_key", "")
            update_indicator()
            update_info()
            if not key:
                popup_validation_label.config(fg="#b91c1c")
                popup_validation_var.set("Planning will be enabled only after creating or selecting a valid dataset.")
                return

            issues = []
            for row in popup_state["rows"]:
                level = row.get("level") or self.level_from_indent(row.get("indent", 0))
                if level != LEVEL_ITEM:
                    continue
                values = row.get("values", {})
                calc_be = self.parse_number(monthly_total(values, "BE")) or 0.0
                calc_re = self.parse_number(monthly_total(values, "RE")) or 0.0
                saved_be = self.parse_number(values.get("BE (FY)", ""))
                saved_re = self.parse_number(values.get("RE (FY)", ""))
                if saved_be is not None and abs(saved_be - calc_be) > 0.01:
                    issues.append("Mismatch detected: BE (FY) does not match monthly BE values.")
                    break
                if saved_re is not None and abs(saved_re - calc_re) > 0.01:
                    issues.append("Mismatch detected: RE (FY) does not match monthly RE values.")
                    break

            if issues:
                popup_validation_label.config(fg="#b91c1c")
                popup_validation_var.set(issues[0])
            else:
                popup_validation_label.config(fg="#15803d")
                popup_validation_var.set("Validation OK: project totals and hierarchy roll-ups are aligned")

        def render_popup_header():
            planning_header.delete("all")
            selected_type = popup_type_var.get().strip() or "BE"
            x = 0
            for title, width, bg in planning_base_columns:
                planning_header.create_rectangle(x, 0, x + width, planning_header_height, fill=bg, outline="#5d85b7", width=1)
                planning_header.create_text(
                    x + width / 2,
                    planning_header_height / 2,
                    text=title,
                    fill="white",
                    font=("Arial", 9 if width >= 120 else 8, "bold"),
                    width=width - 10,
                    justify="center",
                )
                x += width

            subheader_height = 35
            month_header_height = planning_header_height - subheader_height
            for month in CAPEX_MONTHS:
                group_width = sum(width for title, width, _ in planning_columns if title.startswith(f"{month} "))
                planning_header.create_rectangle(x, 0, x + group_width, month_header_height, fill="#063a7a", outline="#5d85b7", width=1)
                planning_header.create_text(
                    x + group_width / 2,
                    month_header_height / 2,
                    text=month,
                    fill="white",
                    font=("Arial", 9, "bold"),
                    width=group_width - 8,
                    justify="center",
                )
                sub_x = x
                for subheader in planning_subheaders:
                    key = f"{month} {subheader}"
                    width = next(col_width for title, col_width, _ in planning_columns if title == key)
                    fill = "#0b5aa6" if subheader == selected_type else "#315d93"
                    planning_header.create_rectangle(sub_x, month_header_height, sub_x + width, planning_header_height, fill=fill, outline="#5d85b7", width=1)
                    planning_header.create_text(
                        sub_x + width / 2,
                        month_header_height + subheader_height / 2,
                        text=subheader,
                        fill="white",
                        font=("Arial", 8, "bold"),
                        width=width - 4,
                        justify="center",
                    )
                    sub_x += width
                x += group_width

            planning_header.configure(scrollregion=(0, 0, planning_total_width, planning_header_height))

        def popup_can_edit(row_index, title):
            key = popup_state.get("dataset_key", "")
            if not key:
                return False
            record = current_plan_record()
            if record.get("locked"):
                return False
            row_level = popup_state["rows"][row_index].get("level") or self.level_from_indent(popup_state["rows"][row_index].get("indent", 0))
            if popup_direct_children(row_index):
                return False

            # ==================== CHANGED BY GROK ====================
            # Allow editing of parent rows that have NO children in Planning window
            # (1. MEP, 3. Capital Repairs/Spares, 4. Allocation for New Projects...)
            if row_level != LEVEL_ITEM:
                children = self.get_direct_children_indexes(row_index, popup_state["rows"])
                if children:  # has children → lock for editing (rollup row)
                    return False
                # No children → allow editing
            # =======================================================

            if title == "CAPEX Plan (FY)":
                return False
            if title in ("Gross Cost", "Cummulative Expenditure till Last FY"):
                return True
            if title in ("BE (FY)", "RE (FY)"):
                return False
            selected_type = popup_type_var.get().strip() or "BE"
            return title.endswith(f" {selected_type}")

        def popup_cell_fill(row_index, title):
            record = current_plan_record()
            locked = bool(record.get("locked"))
            base_fill = "#dbeafe" if row_index == popup_state.get("selected_row_index") else ("#fff7d6" if popup_is_parent(row_index) else "#ffffff")
            row_level = popup_state["rows"][row_index].get("level") or self.level_from_indent(popup_state["rows"][row_index].get("indent", 0))
            if row_level != LEVEL_ITEM or title == "CAPEX Plan (FY)":
                return base_fill
            if title in ("BE (FY)", "RE (FY)"):
                return "#f3f4f6"
            if title in ("Gross Cost", "Cummulative Expenditure till Last FY"):
                return "#e0e0e0" if locked else base_fill
            if title.endswith(" BE"):
                return base_fill if (popup_type_var.get().strip() == "BE" and not locked) else "#e0e0e0"
            if title.endswith(" RE"):
                return base_fill if (popup_type_var.get().strip() == "RE" and not locked) else "#e0e0e0"
            return base_fill

        def render_popup_rows():
            popup_destroy_editor()
            planning_body.delete("all")
            evaluate_validation()
            key = popup_state.get("dataset_key", "")
            if not key:
                planning_body.configure(scrollregion=(0, 0, planning_total_width, 640))
                planning_body.create_text(
                    planning_total_width / 2,
                    180,
                    text="Create or select a CAPEX planning dataset to start entering BE / RE values.",
                    fill="#64748b",
                    font=("Arial", 13, "bold"),
                    width=640,
                    justify="center",
                )
                popup_state["visible_rows"] = []
                update_summary_panel()
                return

            popup_state["visible_rows"] = popup_visible_row_indexes()

            # TOTAL = Sum of only Top-Level Parents (indent == 0)
            parent_totals = {}
            for title, _, _ in planning_columns[1:]:
                total = 0.0
                has_value = False
                for i, row in enumerate(popup_state["rows"]):
                    if self.is_parent_row(i) and row.get("indent", 0) == 0:
                        value = self.parse_number(popup_compute_display_row(i).get(title, ""))
                        if value is not None:
                            total += value
                            has_value = True
                parent_totals[title] = f"{total:.2f}" if has_value else ""

            total_height = max(820, (len(popup_state["visible_rows"]) + 1) * planning_row_height + 24)
            planning_body.configure(scrollregion=(0, 0, planning_total_width, total_height))

            for visible_index, row_index in enumerate(popup_state["visible_rows"]):
                row = popup_state["rows"][row_index]
                display = popup_compute_display_row(row_index)
                y1 = visible_index * planning_row_height
                y2 = y1 + planning_row_height
                x = 0
                for col_index, (title, width, _) in enumerate(planning_columns):
                    fill = popup_cell_fill(row_index, title)
                    planning_body.create_rectangle(x, y1, x + width, y2, fill=fill, outline="#d7e1ec", width=1)
                    text = display.get(title, "")
                    anchor = "w" if col_index == 0 else "center"
                    font = ("Arial", 10, "bold") if popup_is_parent(row_index) else ("Arial", 10)
                    if col_index == 0:
                        marker = ""
                        if popup_is_parent(row_index):
                            marker = "+" if row.get("collapsed") else "-"
                        label_text = f"{marker} {text}".strip() if marker else text
                        marker_offset = 18 if marker else 0
                        text_x = x + 12 + (row["indent"] * 24)
                        text_width = max(width - 24 - (row["indent"] * 24) - marker_offset, 20)
                    else:
                        label_text = text
                        text_x = x + width / 2
                        text_width = width - 10
                    planning_body.create_text(
                        text_x,
                        y1 + (planning_row_height / 2),
                        text=label_text,
                        anchor=anchor,
                        fill="#111827",
                        font=font,
                        width=text_width,
                        justify="left" if col_index == 0 else "center",
                    )
                    x += width

            # ==================== DRAW TOTAL ROW (Top-Level Parent Only) ====================
            total_y1 = len(popup_state["visible_rows"]) * planning_row_height
            total_y2 = total_y1 + planning_row_height
            planning_body.create_rectangle(0, total_y1, planning_total_width, total_y2, fill="#e0f2fe", outline="#1e40af", width=2)
            x = 0
            for col_index, (title, width, _) in enumerate(planning_columns):
                if col_index == 0:
                    planning_body.create_text(
                        x + 12,
                        total_y1 + (planning_row_height / 2),
                        text="TOTAL (Parent Level)",
                        anchor="w",
                        fill="#1e40af",
                        font=("Arial", 10, "bold"),
                        width=width - 20,
                    )
                else:
                    text = parent_totals.get(title, "")
                    planning_body.create_text(
                        x + width / 2,
                        total_y1 + (planning_row_height / 2),
                        text=text,
                        anchor="center",
                        fill="#1e40af",
                        font=("Arial", 11, "bold"),
                        width=width - 10,
                    )
                x += width
            # ========================================================
            update_summary_panel()
        def popup_get_cell(event_x, event_y):
            canvas_x = planning_body.canvasx(event_x)
            canvas_y = planning_body.canvasy(event_y)
            visible_index = int(canvas_y // planning_row_height)
            if visible_index < 0 or visible_index >= len(popup_state["visible_rows"]):
                return None, None, None, None
            row_index = popup_state["visible_rows"][visible_index]
            x = 0
            for col_index, (title, width, _) in enumerate(planning_columns):
                if x <= canvas_x < x + width:
                    return row_index, col_index, title, (x, visible_index * planning_row_height, width, planning_row_height)
                x += width
            return row_index, None, None, None

        def popup_open_editor(row_index, col_index, title, cell):
            if cell is None:
                return
            if not popup_can_edit(row_index, title):
                if title and title != "CAPEX Plan (FY)":
                    if current_plan_record().get("locked"):
                        popup_notice_var.set("Editing restricted: Approved plan is locked.")
                    else:
                        popup_notice_var.set("Editing restricted: Change Plan Type to modify this column")
                return

            popup_destroy_editor()
            x, y, width, height = cell
            current_value = popup_state["rows"][row_index]["values"].get(title, "")
            entry = Entry(planning_body, font=("Arial", 10), justify="center")
            popup_state["active_editor"] = entry
            planning_body.create_window(
                x + (width / 2),
                y + (height / 2),
                window=entry,
                width=max(width - 6, 20),
                height=max(height - 6, 20),
            )
            entry.insert(0, current_value)
            entry.focus()
            entry.select_range(0, END)

            def save_edit(event=None):
                new_value = entry.get().strip()
                if new_value:
                    try:
                        new_value = f"{float(new_value):.2f}"
                    except ValueError:
                        new_value = ""
                popup_state["rows"][row_index]["values"][title] = new_value
                popup_destroy_editor()
                render_popup_rows()

            entry.bind("<Return>", save_edit)
            entry.bind("<FocusOut>", save_edit)

        def save_popup_plan_state():
            key = popup_state.get("dataset_key", "")
            if not key or key not in self.plan_store:
                return
            popup_rows = self.clone_rows(popup_state["rows"])
            for row_index, row in enumerate(popup_rows):
                display = popup_compute_display_row(row_index)
                level = row.get("level") or self.level_from_indent(row.get("indent", 0))
                if level == LEVEL_ITEM and not popup_direct_children(row_index):
                    row["values"]["BE (FY)"] = monthly_total(row["values"], "BE")
                    row["values"]["RE (FY)"] = monthly_total(row["values"], "RE")
                else:
                    for title, _, _ in planning_columns[1:]:
                        row["values"][title] = display.get(title, "")
            popup_rows = self.normalize_amr_subheaders(self.sync_node_metadata(popup_rows))
            record = self.plan_store[key]
            record["rows"] = popup_rows
            record["financial_year"] = popup_fy_var.get().strip() or self.current_fy
            record["plan_version"] = popup_version_var.get().strip() or "Original Plan"
            record["plan_type"] = popup_type_var.get().strip() or "BE"
            if self.active_plan_name == key:
                self.rows = self.clone_rows(popup_rows)

        def load_selected_dataset():
            popup_destroy_editor()
            key = selected_dataset_key()
            popup_state["dataset_key"] = key
            if key and key in self.plan_store:
                popup_state["rows"] = self.normalize_amr_subheaders(self.clone_rows(self.plan_store[key]["rows"]))
                popup_state["selected_row_index"] = 0 if popup_state["rows"] else None
            else:
                popup_state["rows"] = []
                popup_state["selected_row_index"] = None
            render_popup_header()
            render_popup_rows()
            planning_header.xview_moveto(0)
            planning_body.xview_moveto(0)

        def after_plan_created(plan_key):
            record = self.plan_store.get(plan_key, {})
            popup_fy_var.set(str(record.get("financial_year") or self.current_fy))
            popup_version_var.set(str(record.get("plan_version") or "Original Plan"))
            popup_type_var.set(str(record.get("plan_type") or "BE"))
            load_selected_dataset()

        popup_validation_label = Label(toolbar, textvariable=popup_validation_var, bg="#f4f8fc", fg="#15803d", font=("Arial", 9, "bold"))
        popup_validation_label.pack(side=RIGHT, padx=(0, 16), pady=10)
        Label(toolbar, textvariable=popup_notice_var, bg="#f4f8fc", fg="#92400e", font=("Arial", 9, "bold")).pack(side=RIGHT, padx=(0, 16), pady=10)

        def popup_on_click(event):
            row_index, col_index, title, cell = popup_get_cell(event.x, event.y)
            if row_index is None:
                return
            popup_state["selected_row_index"] = row_index
            if title is None:
                render_popup_rows()
                return
            if col_index == 0 and popup_is_parent(row_index):
                popup_state["rows"][row_index]["collapsed"] = not popup_state["rows"][row_index].get("collapsed", False)
                render_popup_rows()
                return
            render_popup_rows()
            popup_open_editor(row_index, col_index, title, cell)

        def save_popup():
            key = popup_state.get("dataset_key", "")
            if not key:
                messagebox.showwarning(
                    "Selection Required",
                    "Please create or select a CAPEX planning dataset before saving.",
                    parent=popup,
                )
                keep_window_active(popup)
                return
            save_popup_plan_state()
            self.refresh_plan_selector()
            if self.active_plan_name == key:
                self.draw_header_grid()
                self.draw_data_grid()
            self.save_capex_data()
            render_popup_rows()
            keep_window_active(popup)

        def approve_popup():
            key = popup_state.get("dataset_key", "")
            if not key or key not in self.plan_store:
                messagebox.showwarning("Selection Required", "Please select a valid dataset before approval.", parent=popup)
                keep_window_active(popup)
                return
            record = self.plan_store[key]
            if str(record.get("plan_version") or "") == "Final Approved Plan" or record.get("locked"):
                messagebox.showinfo("Approved", "This CAPEX plan is already approved and locked.", parent=popup)
                keep_window_active(popup)
                return
            if not messagebox.askyesno("Approve Plan", "Approve this CAPEX plan and create the Final Approved Plan?", parent=popup):
                keep_window_active(popup)
                return

            save_popup_plan_state()
            record = self.plan_store[key]
            source_rows = self.clone_rows(record.get("rows", []))
            plan_type = str(record.get("plan_type") or popup_type_var.get().strip() or "BE")
            financial_year = str(record.get("financial_year") or popup_fy_var.get().strip() or self.current_fy)
            effective_month = ""
            final_rows = self.clone_rows(source_rows)

            if plan_type == "RE":
                effective_month = self.ask_effective_month(record.get("effective_from_month") or CAPEX_MONTHS[0])
                if not effective_month:
                    keep_window_active(popup)
                    return
                effective_index = CAPEX_MONTHS.index(effective_month)
                approved_be_key = self.find_plan_key(financial_year, "Final Approved Plan", "BE")
                base_rows = self.clone_rows(self.plan_store[approved_be_key]["rows"]) if approved_be_key in self.plan_store else self.clone_rows(source_rows)
                base_lookup = {
                    str((base_row.get("values") or {}).get("CAPEX Plan (FY)") or "").strip(): base_row
                    for base_row in base_rows
                }
                for row in final_rows:
                    level = row.get("level") or self.level_from_indent(row.get("indent", 0))
                    if level != LEVEL_ITEM:
                        continue
                    label = str((row.get("values") or {}).get("CAPEX Plan (FY)") or "").strip()
                    base_row = base_lookup.get(label, {})
                    base_values = base_row.get("values", {}) if isinstance(base_row, dict) else {}
                    values = row.get("values", {})
                    for month_index, month in enumerate(CAPEX_MONTHS):
                        be_key = month_subcolumn(month, "BE")
                        re_key = month_subcolumn(month, "RE")
                        if month_index < effective_index:
                            if str(base_values.get(be_key) or "").strip():
                                values[be_key] = str(base_values.get(be_key) or "")
                        else:
                            if str(values.get(re_key) or "").strip():
                                values[be_key] = str(values.get(re_key) or "")
                    values["BE (FY)"] = monthly_total(values, "BE")
                    values["RE (FY)"] = monthly_total(values, "RE")

            final_key = self.plan_dataset_key(financial_year, "Final Approved Plan", plan_type)
            self.plan_store[final_key] = self.build_plan_record(
                final_rows,
                financial_year,
                "Final Approved Plan",
                plan_type,
                approved=True,
                locked=True,
                effective=True,
                effective_from_month=effective_month,
            )
            record["approved"] = True
            record["locked"] = True
            record["effective_from_month"] = effective_month
            for plan_name, plan_data in self.plan_store.items():
                if plan_name != final_key:
                    plan_data["effective"] = False
            self.active_plan_name = final_key
            self.rows = self.clone_rows(self.plan_store[final_key]["rows"])
            self.refresh_plan_selector()
            self.draw_header_grid()
            self.draw_data_grid()
            self.save_capex_data()
            popup_fy_var.set(financial_year)
            popup_version_var.set("Final Approved Plan")
            popup_type_var.set(plan_type)
            load_selected_dataset()
            messagebox.showinfo("Approved", "Final Approved Plan created and locked successfully.", parent=popup)
            keep_window_active(popup)

        popup_fy_combo.bind("<<ComboboxSelected>>", lambda event: load_selected_dataset())
        popup_version_combo.bind("<<ComboboxSelected>>", lambda event: load_selected_dataset())
        popup_type_combo.bind("<<ComboboxSelected>>", lambda event: load_selected_dataset())
        planning_body.bind("<Button-1>", popup_on_click)

        Button(top_actions, text="+  Create Plan", command=lambda: self.open_new_plan_popup(popup, on_created=after_plan_created),
               bg="#0066cc", fg="white", font=("Arial", 9, "bold"), width=15, height=1).pack(side=LEFT, padx=(0, 10), pady=(12, 0))
        Button(top_actions, text="Save Plan", command=save_popup, bg="#0f8b3d", fg="white",
               font=("Arial", 9, "bold"), width=14, height=1).pack(side=LEFT, padx=(0, 10), pady=(12, 0))
        Button(top_actions, text="Approve Plan", command=approve_popup, bg="white", fg="#183153",
               font=("Arial", 9, "bold"), width=14, height=1, relief="solid", bd=1).pack(side=LEFT, pady=(12, 0))

        Button(btns, text="Save Draft", command=save_popup, bg="#0066cc", fg="white", font=("Arial", 10, "bold"), width=16).pack(side=LEFT, padx=(0, 10))
        Button(btns, text="Submit for Approval", command=approve_popup, bg="#15803d", fg="white", font=("Arial", 10, "bold"), width=20).pack(side=LEFT, padx=8)
        Button(btns, text="Refresh", command=load_selected_dataset, bg="white", fg="#183153", font=("Arial", 10, "bold"), width=12, relief="solid", bd=1).pack(side=LEFT, padx=8)
        Label(btns, text="Once plan is saved, approved datasets are locked and cannot be edited.", bg="#f4f8fc", fg="#334155", font=("Arial", 9, "bold")).pack(side=RIGHT, padx=(0, 16))
        Button(btns, text="Close", command=popup.destroy, bg="#555555", fg="white", font=("Arial", 10, "bold"), width=10).pack(side=RIGHT)
    
        render_popup_header()
        load_selected_dataset()
        apply_page_watermark(popup)
        normalize_buttons(popup)
        keep_window_active(popup)

    def ask_effective_month(self, current_month=""):
        popup = Toplevel(self)
        popup.title("RE Effective Month")
        popup.geometry("360x180")
        popup.configure(bg="#f0f4f8")
        popup.grab_set()

        result = {"month": ""}
        Label(popup, text="Select RE Effective From Month", bg="#f0f4f8", fg="#003087",
              font=("Arial", 13, "bold")).pack(pady=(18, 12))
        month_var = StringVar(value=current_month or CAPEX_MONTHS[0])
        ttk.Combobox(popup, textvariable=month_var, values=CAPEX_MONTHS, width=18, state="readonly").pack(pady=8)

        def confirm():
            result["month"] = month_var.get().strip()
            popup.destroy()

        Button(popup, text="Apply", command=confirm, bg="#008000", fg="white",
               font=("Arial", 10, "bold"), width=14).pack(pady=16)
        keep_window_active(popup)
        popup.wait_window()
        return result["month"]

    def apply_re_effective_logic(self, plan_name, effective_month):
        plan_data = self.plan_store.get(plan_name)
        if not plan_data:
            return
        try:
            effective_index = CAPEX_MONTHS.index(effective_month)
        except ValueError:
            return

        working_rows = self.clone_rows(plan_data.get("rows", []))
        for row in working_rows:
            level = row.get("level") or self.level_from_indent(row.get("indent", 0))
            if level != LEVEL_ITEM:
                continue
            values = row.get("values", {})
            for month_index, month in enumerate(CAPEX_MONTHS):
                be_key = month_subcolumn(month, "BE")
                re_key = month_subcolumn(month, "RE")
                actual_key = month_subcolumn(month, "Actual")
                if month_index < effective_index:
                    if not str(values.get(actual_key) or "").strip():
                        values[actual_key] = str(values.get(be_key) or "").strip()
                elif month_index >= effective_index:
                    if str(values.get(re_key) or "").strip():
                        values[be_key] = str(values.get(re_key) or "").strip()
        plan_data["rows"] = self.clone_rows(working_rows)

    def sync_x_scroll(self, *args):
        self.header_canvas.xview(*args)
        self.body_canvas.xview(*args)

    def draw_header_grid(self):
        self.header_canvas.delete("all")
        x = 0
        for title, width, bg in BASE_COLUMNS:
            self.header_canvas.create_rectangle(x, 0, x + width, HEADER_HEIGHT, fill=bg, outline="black", width=1)
            self.header_canvas.create_text(
                x + width / 2,
                HEADER_HEIGHT / 2,
                text=title,
                fill="black",
                font=("Arial", 10 if width >= 120 else 9, "bold"),
                width=width - 10,
                justify="center",
            )
            x += width

        subheader_height = 28
        month_header_height = HEADER_HEIGHT - subheader_height
        
        # Dynamic header: RE only from October onwards
        for month in CAPEX_MONTHS:
            month_lower = month.lower()
            if month_lower in ["oct-26", "nov-26", "dec-26", "jan-27", "feb-27", "mar-27"]:
                subheaders = ["BE", "RE", "Actual"]
            else:
                subheaders = ["BE", "Actual"]
            
            group_width = sum(width for title, width, _ in ALL_COLUMNS if title.startswith(f"{month} "))
            self.header_canvas.create_rectangle(x, 0, x + group_width, month_header_height, fill="#fff200", outline="black", width=1)
            self.header_canvas.create_text(
                x + group_width / 2,
                month_header_height / 2,
                text=month,
                fill="black",
                font=("Arial", 10, "bold"),
                width=group_width - 8,
                justify="center",
            )
            sub_x = x
            for subheader in subheaders:
                key = f"{month} {subheader}"
                width = next((col_width for title, col_width, _ in ALL_COLUMNS if title == key), 65)
                self.header_canvas.create_rectangle(
                    sub_x,
                    month_header_height,
                    sub_x + width,
                    HEADER_HEIGHT,
                    fill="#fff799",
                    outline="black",
                    width=1,
                )
                self.header_canvas.create_text(
                    sub_x + width / 2,
                    month_header_height + subheader_height / 2,
                    text=subheader,
                    fill="black",
                    font=("Arial", 9, "bold"),
                    width=width - 4,
                    justify="center",
                )
                sub_x += width
            x += group_width

        self.header_canvas.configure(scrollregion=(0, 0, self.header_total_width, HEADER_HEIGHT))

    def destroy_editor(self):
        if self.active_editor is not None:
            try:
                self.active_editor.destroy()
            except Exception:
                pass
            self.active_editor = None

    def is_parent_row(self, row_index):
        if row_index < 0 or row_index >= len(self.rows) - 1:
            return False
        return self.rows[row_index + 1]["indent"] > self.rows[row_index]["indent"]

    def get_direct_children_indexes(self, row_index, rows=None):
        target_rows = self.rows if rows is None else rows
        if row_index < 0 or row_index >= len(target_rows):
            return []
        parent_indent = target_rows[row_index]["indent"]
        child_indent = parent_indent + 1
        children = []
        idx = row_index + 1
        while idx < len(target_rows):
            row_indent = target_rows[idx]["indent"]
            if row_indent <= parent_indent:
                break
            if row_indent == child_indent:
                children.append(idx)
            idx += 1
        return children

    def gather_children(self, row_index):
        children = []
        parent_indent = self.rows[row_index]["indent"]
        idx = row_index + 1
        while idx < len(self.rows):
            if self.rows[idx]["indent"] <= parent_indent:
                break
            children.append(idx)
            idx += 1
        return children

    def get_visible_row_indexes(self):
        visible = []
        hidden_until_indent = None
        for idx, row in enumerate(self.rows):
            if hidden_until_indent is not None:
                if row["indent"] > hidden_until_indent:
                    continue
                hidden_until_indent = None
            visible.append(idx)
            if row.get("collapsed") and self.is_parent_row(idx):
                hidden_until_indent = row["indent"]
        return visible

    def compute_display_row(self, row_index):
        row = self.rows[row_index]
        display = dict(row["values"])
        level = row.get("level") or self.level_from_indent(row.get("indent", 0))
        direct_children = self.get_direct_children_indexes(row_index)
        if not direct_children:
            return display

        expected_child_level = LEVEL_SUBHEADER if level == LEVEL_HEADER else LEVEL_ITEM
        for title, _, _ in ALL_COLUMNS[1:]:
            total = 0.0
            has_value = False
            for child_index in direct_children:
                child_level = self.rows[child_index].get("level") or self.level_from_indent(self.rows[child_index].get("indent", 0))
                if child_level != expected_child_level:
                    continue
                child_display = self.compute_display_row(child_index)
                value = self.parse_number(child_display.get(title, ""))
                if value is not None:
                    total += value
                    has_value = True
            display[title] = f"{total:.2f}" if has_value else ""
        return display

    def parse_number(self, value):
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None

    def row_fill(self, row_index):
        if row_index == self.selected_row_index:
            return "#dbeafe"
        if self.is_parent_row(row_index):
            return "#fff7d6"
        return "#ffffff"

    def draw_data_grid(self):
        self.destroy_editor()
        self.body_canvas.delete("all")
        self.visible_rows = self.get_visible_row_indexes()

       # ==================== TOTAL OF TOP-LEVEL PARENT ACTIVITIES ONLY ====================
        # Sum only top-level parents (indent == 0) - NOT sub-parents like "2.1", "2.2", "2.3"
        parent_totals = {}
        for title, _, _ in ALL_COLUMNS[1:]:   # Skip "CAPEX Plan (FY)" column
            total = 0.0
            has_value = False
            for i, row in enumerate(self.rows):
                indent = row.get("indent", 0)
                if self.is_parent_row(i) and indent == 0:   # Only top-level parents
                    display = self.compute_display_row(i)
                    value = self.parse_number(display.get(title, ""))
                    if value is not None:
                        total += value
                        has_value = True
            parent_totals[title] = f"{total:.2f}" if has_value else ""
        # =======================================================================

        # TOTAL = Sum of only Top-Level Parents (indent == 0)
        parent_totals = {}
        for title, _, _ in ALL_COLUMNS[1:]:
            total = 0.0
            has_value = False
            for i, row in enumerate(self.rows):
                if self.is_parent_row(i) and row.get("indent", 0) == 0:
                    value = self.parse_number(self.compute_display_row(i).get(title, ""))
                    if value is not None:
                        total += value
                        has_value = True
            parent_totals[title] = f"{total:.2f}" if has_value else ""

        total_height = max(1400, (len(self.visible_rows) + 1) * ROW_HEIGHT + 20)
        self.body_canvas.configure(scrollregion=(0, 0, self.header_total_width, total_height))

        # Draw normal rows
        for visible_index in range(len(self.visible_rows)):
            y1 = visible_index * ROW_HEIGHT
            y2 = y1 + ROW_HEIGHT
            actual_index = self.visible_rows[visible_index]
            fill = self.row_fill(actual_index)
            self.body_canvas.create_rectangle(0, y1, self.header_total_width, y2, fill=fill, outline="")

        # Draw TOTAL row at the bottom
        total_y1 = len(self.visible_rows) * ROW_HEIGHT
        total_y2 = total_y1 + ROW_HEIGHT
        self.body_canvas.create_rectangle(0, total_y1, self.header_total_width, total_y2, fill="#e0f2fe", outline="#1e40af", width=2)

        # Draw vertical lines
        x = 0
        for _, width, _ in ALL_COLUMNS:
            self.body_canvas.create_line(x, 0, x, total_height, fill="#d1d5db", width=1)
            x += width
        self.body_canvas.create_line(self.header_total_width - 1, 0, self.header_total_width - 1, total_height, fill="#d1d5db", width=1)

        # Draw horizontal lines
        y = 0
        while y <= total_height:
            self.body_canvas.create_line(0, y, self.header_total_width, y, fill="#e5e7eb", width=1)
            y += ROW_HEIGHT

        # Draw normal data rows
        for visible_index, row_index in enumerate(self.visible_rows):
            row = self.rows[row_index]
            display = self.compute_display_row(row_index)
            x = 0
            for col_index, (title, width, _) in enumerate(ALL_COLUMNS):
                text = display.get(title, "")
                anchor = "w" if col_index == 0 else "center"
                font = ("Arial", 10, "bold") if self.is_parent_row(row_index) else ("Arial", 10)
                if col_index == 0:
                    marker = ""
                    if self.is_parent_row(row_index):
                        marker = "+" if row.get("collapsed") else "-"
                    label_text = f"{marker} {text}".strip() if marker else text
                    marker_offset = 18 if marker else 0
                    text_x = x + 12 + (row["indent"] * 24)
                    text_width = max(width - 24 - (row["indent"] * 24) - marker_offset, 20)
                else:
                    text_x = x + width / 2
                    text_width = width - 10
                    label_text = text
                self.body_canvas.create_text(
                    text_x,
                    visible_index * ROW_HEIGHT + (ROW_HEIGHT / 2),
                    text=label_text,
                    anchor=anchor,
                    fill="#111827",
                    font=font,
                    width=text_width,
                    justify="left" if col_index == 0 else "center",
                )
                x += width

        # ==================== DRAW TOTAL ROW (Parent Level) ====================
        x = 0
        for col_index, (title, width, _) in enumerate(ALL_COLUMNS):
            if col_index == 0:
                self.body_canvas.create_text(
                    x + 12,
                    len(self.visible_rows) * ROW_HEIGHT + (ROW_HEIGHT / 2),
                    text="TOTAL (Parent Level)",
                    anchor="w",
                    fill="#1e40af",
                    font=("Arial", 10, "bold"),
                    width=width - 20,
                )
            else:
                text = parent_totals.get(title, "")
                self.body_canvas.create_text(
                    x + width / 2,
                    len(self.visible_rows) * ROW_HEIGHT + (ROW_HEIGHT / 2),
                    text=text,
                    anchor="center",
                    fill="#1e40af",
                    font=("Arial", 11, "bold"),
                    width=width - 10,
                )
            x += width
        # ========================================================

    def get_cell_at(self, event_x, event_y):
        canvas_x = self.body_canvas.canvasx(event_x)
        canvas_y = self.body_canvas.canvasy(event_y)
        visible_index = int(canvas_y // ROW_HEIGHT)
        if visible_index < 0 or visible_index >= len(self.visible_rows):
            return None, None, None, None
        row_index = self.visible_rows[visible_index]

        x = 0
        for col_index, (title, width, _) in enumerate(ALL_COLUMNS):
            if x <= canvas_x < x + width:
                return row_index, col_index, title, (x, visible_index * ROW_HEIGHT, width, ROW_HEIGHT)
            x += width
        return row_index, None, None, None

    def on_body_click(self, event):
        row_index, col_index, title, cell = self.get_cell_at(event.x, event.y)
        if row_index is None:
            return
        self.selected_row_index = row_index
        self.draw_data_grid()
        if title is None:
            return
        if col_index == 0 and self.is_parent_row(row_index):
            self.rows[row_index]["collapsed"] = not self.rows[row_index].get("collapsed", False)
            self.draw_data_grid()
            return
        self.open_cell_editor(row_index, col_index, title, cell)

    def open_cell_editor(self, row_index, col_index, title, cell):
        if cell is None:
            return

        # ==================== BLOCK EDITING OF BE, RE, GROSS COST, CUMMULATIVE ====================
        if not self.is_editable_column(title):
            messagebox.showinfo(
                "Read Only Column",
                "Only **Actual** columns can be edited here.\n\n"
                "BE / RE / Gross Cost / Cummulative columns are read-only.\n"
                "Use 'Open Planning' button for BE/RE planning.",
                parent=self
            )
            keep_window_active(self)
            return
        # =======================================================================================

        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked.\nUse CAPEX Planning to edit.",
                parent=self
            )
            keep_window_active(self)
            return

        # Rest of the original method remains unchanged
        row_level = self.rows[row_index].get("level") or self.level_from_indent(self.rows[row_index].get("indent", 0))
        if self.get_direct_children_indexes(row_index):
            return

        # Allow editing of parent rows that have NO children (e.g. "3. Capital Repairs/Spares")
        if row_level != LEVEL_ITEM:
            # Check if this parent row has any direct children
            children = self.get_direct_children_indexes(row_index)
            if children:  # has children → still non-editable (rollup row)
                return
            # No children → treat as editable leaf row

        self.destroy_editor()
        x, y, width, height = cell
        current_value = self.rows[row_index]["values"].get(title, "")

        entry = Entry(self.body_canvas, font=("Arial", 10), justify="left" if col_index == 0 else "center")
        self.active_editor = entry
        self.body_canvas.create_window(
            x + (width / 2),
            y + (height / 2),
            window=entry,
            width=max(width - 6, 20),
            height=max(height - 6, 20),
        )
        entry.insert(0, current_value)
        entry.focus()
        entry.select_range(0, END)

        def save_edit(event=None):
            new_value = entry.get().strip()
            if col_index != 0 and new_value:
                try:
                    new_value = f"{float(new_value):.2f}"
                except ValueError:
                    new_value = ""
            self.rows[row_index]["values"][title] = new_value
            self.destroy_editor()
            self.draw_data_grid()

        entry.bind("<Return>", save_edit)
        entry.bind("<FocusOut>", save_edit)

    def open_add_item_popup(self):
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        popup = Toplevel(self)
        popup.title("Add CAPEX Item")
        popup.geometry("420x250")
        popup.configure(bg="#f0f4f8")
        popup.grab_set()

        Label(
            popup,
            text="Add Item in CAPEX Plan Column",
            bg="#f0f4f8",
            fg="#003087",
            font=("Arial", 14, "bold"),
        ).pack(pady=(18, 12))

        form = Frame(popup, bg="#f0f4f8")
        form.pack(fill=X, padx=25)

        Label(form, text="Item Name:", bg="#f0f4f8", font=("Arial", 11, "bold")).grid(row=0, column=0, sticky=W, pady=8)
        name_var = StringVar()
        Entry(form, textvariable=name_var, font=("Arial", 11), width=28).grid(row=0, column=1, sticky=W, pady=8)

        Label(form, text="Level:", bg="#f0f4f8", font=("Arial", 11, "bold")).grid(row=1, column=0, sticky=W, pady=8)
        level_map = {LEVEL_HEADER: 0, LEVEL_SUBHEADER: 1, LEVEL_ITEM: 2}
        default_level = LEVEL_ITEM
        if self.selected_row_index is not None:
            selected_level = self.rows[self.selected_row_index].get("level") or self.level_from_indent(self.rows[self.selected_row_index]["indent"])
            if selected_level == LEVEL_HEADER:
                default_level = LEVEL_SUBHEADER
            elif selected_level == LEVEL_SUBHEADER:
                default_level = LEVEL_ITEM
        level_var = StringVar(value=default_level)
        ttk.Combobox(form, textvariable=level_var, values=list(LEVEL_SEQUENCE), width=14, state="readonly").grid(row=1, column=1, sticky=W, pady=8)

        def add_item():
            name = name_var.get().strip()
            if not name:
                return
            new_row = self.make_row(name, indent=level_map.get(level_var.get(), 2), collapsed=False)
            insert_at = self.selected_row_index + 1 if self.selected_row_index is not None else len(self.rows)
            self.rows.insert(insert_at, new_row)
            self.sync_node_metadata()
            self.selected_row_index = insert_at
            popup.destroy()
            self.draw_data_grid()
            keep_window_active(self)

        Button(
            popup,
            text="➕ Add Item",
            command=add_item,
            bg="#008000",
            fg="white",
            font=("Arial", 11, "bold"),
        ).pack(pady=18)
        normalize_buttons(popup)

    def delete_selected_row(self):
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.selected_row_index is None or not (0 <= self.selected_row_index < len(self.rows)):
            return
        start_index, end_index = self.get_block_range(self.selected_row_index)
        del self.rows[start_index:end_index + 1]
        self.sync_node_metadata()
        if not self.rows:
            self.selected_row_index = None
        else:
            self.selected_row_index = min(start_index, len(self.rows) - 1)
        self.draw_data_grid()

    def change_indent(self, delta):
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.selected_row_index is None or not (0 <= self.selected_row_index < len(self.rows)):
            return
        row_name = str((self.rows[self.selected_row_index].get("values") or {}).get("CAPEX Plan (FY)") or "").strip()
        if self.is_fixed_hierarchy_name(row_name):
            messagebox.showinfo(
                "Indent Restricted",
                "Only project rows can be indented under another project.",
                parent=self,
            )
            keep_window_active(self)
            return

        start_index, end_index = self.get_block_range(self.selected_row_index)
        current_indent = self.rows[start_index]["indent"]

        if delta > 0:
            if start_index <= 0:
                return
            target_parent_index = None
            scan_index = start_index - 1
            while scan_index >= 0:
                candidate_indent = self.rows[scan_index]["indent"]
                if candidate_indent == current_indent:
                    target_parent_index = scan_index
                    break
                if candidate_indent < current_indent:
                    target_parent_index = scan_index
                    break
                scan_index -= 1
            if target_parent_index is None:
                return
            target_indent = self.rows[target_parent_index]["indent"] + 1
            shift = target_indent - current_indent
        else:
            if current_indent <= 0:
                return
            shift = -1

        if shift == 0:
            return

        for idx in range(start_index, end_index + 1):
            self.rows[idx]["indent"] = self.normalize_indent(self.rows[idx]["indent"] + shift)
        self.sync_node_metadata()
        self.selected_row_index = start_index
        self.draw_data_grid()

    def import_projects_by_status(self):
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.selected_row_index is None or not (0 <= self.selected_row_index < len(self.rows)):
            return

        parent_row = self.rows[self.selected_row_index]
        parent_id = parent_row["row_id"]
        parent_indent = parent_row["indent"]
        parent_name = str(parent_row["values"].get("CAPEX Plan (FY)", "")).strip()

        if parent_name != "2. AMR":
            return

        self.rows = self.normalize_amr_subheaders(self.rows)
        self.rows = [row for row in self.rows if row.get("imported_for") != parent_id]
        selected_indexes = [idx for idx, row in enumerate(self.rows) if row["row_id"] == parent_id]
        if not selected_indexes:
            self.draw_data_grid()
            return
        self.selected_row_index = selected_indexes[0]

        allowed_project_ids = self.main_app.get_allowed_project_ids() if self.main_app else None
        projects = [dict(project) for project in get_all_projects(allowed_project_ids)]
        projects_by_id = {int(project.get("id") or 0): project for project in projects if project.get("id")}
        children_by_parent = {}
        root_projects = []

        for project in projects:
            parent_project_id = project.get("parent_project_id")
            try:
                parent_project_id = int(parent_project_id) if parent_project_id not in (None, "") else None
            except (TypeError, ValueError):
                parent_project_id = None

            if parent_project_id and parent_project_id in projects_by_id:
                children_by_parent.setdefault(parent_project_id, []).append(project)
            else:
                root_projects.append(project)

        def sort_key(project):
            return int(project.get("id") or 0)

        root_projects.sort(key=sort_key, reverse=True)
        for child_projects in children_by_parent.values():
            child_projects.sort(key=sort_key, reverse=True)

        def bucket_for_project(project):
            project_type = str(project.get("project_type") or "").strip()
            status = get_project_status(dict(project))
            if project_type == "Corporate AMR":
                if status == "Ongoing":
                    return "2.2 Ongoing AMR Schemes >30 Cr."
                if status in ("Complete", "Commissioned"):
                    return "2.1 Completed AMR Schemes >30 Cr."
                return ""
            if project_type == "Plant Level AMR":
                return "2.3 Plant Level AMR Schemes <30 Cr."
            return ""

        bucket_rows = {bucket_name: [] for bucket_name in AMR_BUCKET_ORDER}
        for project in root_projects:
            bucket_name = bucket_for_project(project)
            if bucket_name:
                bucket_rows[bucket_name].append(project)

        def make_imported_project_row(project, indent):
            project_label = str(project.get("project_name") or "").strip()
            project_row = self.make_row(project_label, indent=indent, collapsed=False, imported_for=parent_id)
            gross_cost = project.get("stage2_cost")
            if gross_cost in (None, ""):
                gross_cost = project.get("stage1_cost")
            if gross_cost not in (None, ""):
                try:
                    project_row["values"]["Gross Cost"] = f"{float(gross_cost):.2f}"
                except (TypeError, ValueError):
                    project_row["values"]["Gross Cost"] = ""
            return project_row

        for bucket_name in AMR_BUCKET_ORDER:
            bucket_projects = bucket_rows.get(bucket_name, [])
            direct_children = self.get_direct_children_indexes(self.selected_row_index)
            bucket_index = next(
                (
                    idx
                    for idx in direct_children
                    if str((self.rows[idx].get("values") or {}).get("CAPEX Plan (FY)") or "").strip() == bucket_name
                ),
                None,
            )
            if bucket_index is None:
                continue
            insert_at = self.get_block_range(bucket_index)[1] + 1

            def insert_project_tree(project, depth=0):
                nonlocal insert_at
                project_row = make_imported_project_row(project, parent_indent + 2 + depth)
                self.rows.insert(insert_at, project_row)
                insert_at += 1
                project_id = int(project.get("id") or 0)
                for child_project in children_by_parent.get(project_id, []):
                    insert_project_tree(child_project, depth + 1)

            for project in bucket_projects:
                insert_project_tree(project)

        self.rows[self.selected_row_index]["collapsed"] = False
        self.rows = self.prune_deleted_project_rows(self.rows)
        self.rows = self.normalize_amr_subheaders(self.rows)
        self.draw_data_grid()

    def move_row(self, direction):
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.active_plan_locked():
            messagebox.showinfo(
                "Locked Plan",
                "The approved CAPEX dataset is locked. Use CAPEX Planning to create or open a draft plan for edits.",
                parent=self,
            )
            keep_window_active(self)
            return
        if self.selected_row_index is None or not (0 <= self.selected_row_index < len(self.rows)):
            return

        start_index, end_index = self.get_block_range(self.selected_row_index)
        block = self.rows[start_index:end_index + 1]

        if direction < 0:
            previous_start = self.find_previous_block_start(start_index)
            if previous_start is None:
                return
            previous_end = self.get_block_range(previous_start)[1]
            previous_block = self.rows[previous_start:previous_end + 1]
            self.rows[previous_start:end_index + 1] = block + previous_block
            self.selected_row_index = previous_start
        else:
            next_start = end_index + 1
            if next_start >= len(self.rows):
                return
            next_end = self.get_block_range(next_start)[1]
            next_block = self.rows[next_start:next_end + 1]
            self.rows[start_index:next_end + 1] = next_block + block
            self.selected_row_index = start_index + len(next_block)
        self.sync_node_metadata()
        self.draw_data_grid()

    def get_block_range(self, row_index):
        start_index = row_index
        base_indent = self.rows[row_index]["indent"]
        end_index = row_index
        idx = row_index + 1
        while idx < len(self.rows):
            if self.rows[idx]["indent"] <= base_indent:
                break
            end_index = idx
            idx += 1
        return start_index, end_index

    def find_previous_block_start(self, row_index):
        if row_index <= 0:
            return None
        previous_index = row_index - 1
        target_indent = self.rows[previous_index]["indent"]
        while previous_index > 0 and self.rows[previous_index - 1]["indent"] > target_indent:
            previous_index -= 1
        return previous_index
    def is_editable_column(self, title):
        """Only Actual columns are editable.
        BE, RE, Gross Cost and Cummulative Expenditure till Last FY are blocked."""
        if not title:
            return False
        title_lower = str(title).strip().lower()
        if "actual" in title_lower:
            return True
        if any(x in title_lower for x in ["be", "re", "gross cost", "cummulative expenditure"]):
            return False
        return True  # CAPEX Plan (FY) name column remains editable
        # ==================== SUMMARY BOXES LOGIC ====================
    def on_month_selected(self, event=None):
        self.refresh_summary_boxes()

    def refresh_summary_boxes(self):
        if not hasattr(self, 'month_var'):
            return
        selected_month = self.month_var.get()
        self.calculate_gross_cost()
        self.calculate_plan_vs_actual_fy(selected_month)
        self.calculate_plan_vs_actual_cumulative(selected_month)

    def calculate_gross_cost(self):
        """Box 1: Total Gross Cost at Parent Level"""
        total = 0.0
        for i, row in enumerate(self.rows):
            if self.is_parent_row(i) and row.get("indent", 0) == 0:
                for child_idx in self.gather_children(i):
                    child_row = self.rows[child_idx]
                    child_level = child_row.get("level") or self.level_from_indent(child_row.get("indent", 0))
                    if child_level != LEVEL_ITEM or self.get_direct_children_indexes(child_idx):
                        continue
                    value = self.parse_number(child_row["values"].get("Gross Cost", ""))
                    if value is not None:
                        total += value
        self.gross_cost_var.set(f"{total:,.2f}")

    def calculate_plan_vs_actual_fy(self, selected_month):
        """Box 2: Plan vs Actual for Current FY"""
        if not selected_month or not CAPEX_MONTHS:
            self.plan_actual_fy_var.set("Plan: 0.00 | Actual: 0.00")
            return

        effective_record = self.plan_store.get(self.active_plan_name, {})
        plan_type = str(effective_record.get("plan_type") or "BE")
        re_effective_month = str(effective_record.get("effective_from_month") or "")

        plan_fy = 0.0
        actual_fy = 0.0

        try:
            selected_idx = CAPEX_MONTHS.index(selected_month)
        except ValueError:
            selected_idx = len(CAPEX_MONTHS) - 1

        re_eff_idx = -1
        if re_effective_month and re_effective_month in CAPEX_MONTHS:
            re_eff_idx = CAPEX_MONTHS.index(re_effective_month)

        for i, row in enumerate(self.rows):
            if self.is_parent_row(i) and row.get("indent", 0) == 0:
                for child_idx in self.gather_children(i):
                    child_row = self.rows[child_idx]
                    child_level = child_row.get("level") or self.level_from_indent(child_row.get("indent", 0))
                    if child_level != LEVEL_ITEM or self.get_direct_children_indexes(child_idx):
                        continue
                    values = child_row.get("values", {})

                    for m_idx in range(selected_idx + 1):
                        actual_val = self.parse_number(values.get(month_subcolumn(CAPEX_MONTHS[m_idx], "Actual"), ""))
                        if actual_val is not None:
                            actual_fy += actual_val

                    if plan_type == "BE" or re_eff_idx < 0:
                        for m_idx in range(selected_idx + 1):
                            be_val = self.parse_number(values.get(month_subcolumn(CAPEX_MONTHS[m_idx], "BE"), ""))
                            if be_val is not None:
                                plan_fy += be_val
                    else:
                        for m_idx in range(min(re_eff_idx, selected_idx + 1)):
                            actual_val = self.parse_number(values.get(month_subcolumn(CAPEX_MONTHS[m_idx], "Actual"), ""))
                            if actual_val is not None:
                                plan_fy += actual_val
                        for m_idx in range(max(re_eff_idx, 0), selected_idx + 1):
                            re_val = self.parse_number(values.get(month_subcolumn(CAPEX_MONTHS[m_idx], "RE"), ""))
                            if re_val is not None:
                                plan_fy += re_val

        self.plan_actual_fy_var.set(f"Plan: {plan_fy:,.2f} | Actual: {actual_fy:,.2f}")

    def calculate_plan_vs_actual_cumulative(self, selected_month):
        """Box 3: Plan vs Actual Cumulative"""
        if not selected_month or not CAPEX_MONTHS:
            self.plan_actual_cum_var.set("Plan: 0.00 | Actual: 0.00")
            return

        prev_fy_plan = 0.0
        prev_fy_actual = 0.0

        for i, row in enumerate(self.rows):
            if self.is_parent_row(i) and row.get("indent", 0) == 0:
                for child_idx in self.gather_children(i):
                    child_row = self.rows[child_idx]
                    child_level = child_row.get("level") or self.level_from_indent(child_row.get("indent", 0))
                    if child_level != LEVEL_ITEM or self.get_direct_children_indexes(child_idx):
                        continue
                    values = child_row.get("values", {})
                    prev_fy_plan += self.parse_number(values.get("Cummulative Expenditure till Last FY", "")) or 0.0
                    prev_fy_actual += self.parse_number(values.get("Cummulative Expenditure till Last FY", "")) or 0.0

        effective_record = self.plan_store.get(self.active_plan_name, {})
        plan_type = str(effective_record.get("plan_type") or "BE")
        re_effective_month = str(effective_record.get("effective_from_month") or "")

        try:
            selected_idx = CAPEX_MONTHS.index(selected_month)
        except ValueError:
            selected_idx = len(CAPEX_MONTHS) - 1

        re_eff_idx = -1
        if re_effective_month and re_effective_month in CAPEX_MONTHS:
            re_eff_idx = CAPEX_MONTHS.index(re_effective_month)

        current_plan = 0.0
        current_actual = 0.0

        for i, row in enumerate(self.rows):
            if self.is_parent_row(i) and row.get("indent", 0) == 0:
                for child_idx in self.gather_children(i):
                    child_row = self.rows[child_idx]
                    child_level = child_row.get("level") or self.level_from_indent(child_row.get("indent", 0))
                    if child_level != LEVEL_ITEM or self.get_direct_children_indexes(child_idx):
                        continue
                    values = child_row.get("values", {})

                    for m_idx in range(selected_idx + 1):
                        actual_val = self.parse_number(values.get(month_subcolumn(CAPEX_MONTHS[m_idx], "Actual"), ""))
                        if actual_val is not None:
                            current_actual += actual_val

                    if plan_type == "BE" or re_eff_idx < 0:
                        for m_idx in range(selected_idx + 1):
                            be_val = self.parse_number(values.get(month_subcolumn(CAPEX_MONTHS[m_idx], "BE"), ""))
                            if be_val is not None:
                                current_plan += be_val
                    else:
                        for m_idx in range(min(re_eff_idx, selected_idx + 1)):
                            actual_val = self.parse_number(values.get(month_subcolumn(CAPEX_MONTHS[m_idx], "Actual"), ""))
                            if actual_val is not None:
                                current_plan += actual_val
                        for m_idx in range(max(re_eff_idx, 0), selected_idx + 1):
                            re_val = self.parse_number(values.get(month_subcolumn(CAPEX_MONTHS[m_idx], "RE"), ""))
                            if re_val is not None:
                                current_plan += re_val

        cum_plan = prev_fy_plan + current_plan
        cum_actual = prev_fy_actual + current_actual

        self.plan_actual_cum_var.set(f"Plan: {cum_plan:,.2f} | Actual: {cum_actual:,.2f}")
    # ========================================================
