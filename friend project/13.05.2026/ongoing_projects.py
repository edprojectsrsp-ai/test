from tkinter import *
from tkinter import ttk, messagebox
from datetime import date
import json
import webbrowser

from database import get_db_connection, project_has_completed_planning
import execution
from utils import (
    normalize_buttons,
    keep_window_active,
    apply_page_watermark,
    to_display_date,
    to_storage_date,
    parse_app_date,
    get_project_status,
    classify_project_financial_year,
)

WEB_DAILY_PROGRESS_URL = "http://127.0.0.1:5173"
PLANT_LEVEL_REMARKS_LIMIT = 600


def build_current_fy_months(today=None):
    today = today or date.today()
    start_year = today.year if today.month >= 4 else today.year - 1
    months = []
    for month in range(4, 13):
        months.append(date(start_year, month, 1).strftime("%b-%y"))
    for month in range(1, 4):
        months.append(date(start_year + 1, month, 1).strftime("%b-%y"))
    return months


def build_fy_label(today=None):
    today = today or date.today()
    start_year = today.year if today.month >= 4 else today.year - 1
    return f"FY {start_year}-{start_year + 1}"


class OngoingProjectsFrame(Frame):
    def __init__(self, parent, main_app=None):
        super().__init__(parent)
        self.main_app = main_app
        self.project_trees = {}
        self.type_frames = {}
        self.type_buttons = {}
        self.active_type = "Corporate AMR"
        self.current_fy = build_fy_label()
        self.month_columns = build_current_fy_months()
        self.selected_project_id = None
        self.selected_project_uid = ""
        self.selected_project_name = ""
        self.selected_project_type = ""

        Label(self, text="Ongoing Projects", font=("Arial", 16, "bold")).pack(pady=(10, 6))

        selector_wrap = Frame(self, bg="#eef3f8")
        selector_wrap.pack(fill=X, padx=10, pady=(0, 6))

        Label(
            selector_wrap,
            text="Project Type:",
            bg="#eef3f8",
            fg="#003087",
            font=("Arial", 11, "bold"),
        ).pack(side=LEFT, padx=(0, 8))

        for ptype in ("Corporate AMR", "Plant Level AMR"):
            btn = Button(
                selector_wrap,
                text=ptype,
                command=lambda value=ptype: self.show_type(value),
                bg="#0f766e" if ptype == self.active_type else "#dbeafe",
                fg="white" if ptype == self.active_type else "#003087",
                font=("Arial", 10, "bold"),
                width=18,
                height=2,
            )
            btn.pack(side=LEFT, padx=6)
            self.type_buttons[ptype] = btn

        Button(
            selector_wrap,
            text="Refresh",
            command=self.refresh_all,
            bg="#2f9e44",
            fg="white",
            font=("Arial", 10, "bold"),
            width=12,
            height=2,
        ).pack(side=RIGHT, padx=6)

        self.content_area = Frame(self, bg="#eef3f8")
        self.content_area.pack(fill=BOTH, expand=True, padx=10, pady=5)
        self.type_host = Frame(self.content_area, bg="#eef3f8")
        self.type_host.pack(fill=BOTH, expand=True)

        self.create_type_panel("Corporate AMR")
        self.create_type_panel("Plant Level AMR")
        self.build_project_tabs()
        self.show_type(self.active_type)

        apply_page_watermark(self)
        normalize_buttons(self)

    def create_type_panel(self, ptype):
        frame = Frame(self.type_host, bg="#eef3f8")
        self.type_frames[ptype] = frame
        if ptype == "Plant Level AMR":
            self.create_plant_level_panel(frame, ptype)
        else:
            self.create_standard_panel(frame, ptype)

    def create_standard_panel(self, frame, ptype):
        Label(
            frame,
            text=f"{ptype} Projects",
            bg="#eef3f8",
            fg="#003087",
            font=("Arial", 14, "bold"),
        ).pack(anchor="w", pady=(4, 8))

        tree_frame = Frame(frame)
        tree_frame.pack(fill=BOTH, expand=True, padx=5, pady=5)

        tree = ttk.Treeview(tree_frame, columns=("UID", "Name", "GROSS"), show="headings", height=15)
        tree.heading("UID", text="Unique ID")
        tree.heading("Name", text="Project Name")
        tree.heading("GROSS", text="Gross Cost")
        tree.column("UID", width=220, anchor="center")
        tree.column("Name", width=500, anchor="w")
        tree.column("GROSS", width=120, anchor="center")
        tree.pack(side=LEFT, fill=BOTH, expand=True)

        y_scroll = ttk.Scrollbar(tree_frame, orient="vertical", command=tree.yview)
        y_scroll.pack(side=RIGHT, fill=Y)
        x_scroll = ttk.Scrollbar(frame, orient="horizontal", command=tree.xview)
        x_scroll.pack(fill=X, padx=5)
        tree.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)
        tree.bind("<<TreeviewSelect>>", lambda _event, t=tree, kind=ptype: self.on_project_selected(t, kind))

        self.project_trees[ptype] = tree
        self.load_projects(tree, ptype)

        btn_frame = Frame(frame, bg="#eef3f8")
        btn_frame.pack(pady=15)
        edit_state = NORMAL if not self.main_app or self.main_app.can_edit("ongoing") else DISABLED

        Button(
            btn_frame,
            text="Corporate AMR Master",
            command=self.open_corporate_amr_master,
            bg="#0f766e",
            fg="white",
            font=("Arial", 10, "bold"),
            width=24,
            height=2,
            state=NORMAL,
        ).pack(side=LEFT, padx=8)

        Button(
            btn_frame,
            text="Contract Details & Appendix-2",
            command=lambda t=tree: self.open_contract(t),
            bg="#003087",
            fg="white",
            font=("Arial", 10, "bold"),
            width=32,
            height=2,
            state=edit_state,
        ).pack(side=LEFT, padx=8)

        Button(
            btn_frame,
            text="S-Curve Planning",
            command=lambda t=tree: self.open_scurve(t),
            bg="#0066cc",
            fg="white",
            font=("Arial", 10, "bold"),
            width=24,
            height=2,
            state=edit_state,
        ).pack(side=LEFT, padx=8)

    def create_plant_level_panel(self, frame, ptype):
        Label(
            frame,
            text=f"{ptype} Projects - Monitoring Form",
            bg="#eef3f8",
            fg="#003087",
            font=("Arial", 14, "bold"),
        ).pack(anchor="w", pady=(4, 8))

        tree_frame = Frame(frame)
        tree_frame.pack(fill=BOTH, expand=True, padx=5, pady=5)

        base_columns = [
            ("PROJECT_ID", "", 0),
            ("UID", "", 0),
            ("SLNO", "Sl No", 60),
            ("ATNO", "A/T No.", 90),
            ("ATDATE", "A/T Date", 90),
            ("DEPT", "Deptt.", 90),
            ("NAME", "Project Name", 250),
            ("AGENCY", "Executing Agency", 160),
            ("SCHSTART", "Schedule\nStart", 105),
            ("SCHCOMP", "Schedule\nCompletion", 110),
            ("ANTCOMP", "Anticipated\nCompletion", 110),
            ("COMPDATE", "Completion\nDate", 100),
            ("STATUS", "Project\nStatus", 100),
            ("STARTFLAG", "Start\nStatus", 160),
            ("REMARKS", "Remarks", 170),
            ("PHYS", "Physical\nProgress", 90),
            ("GROSS", "Gross Cost", 95),
            ("CAPLASTFY", "CAPEX till\nLast FY", 100),
            ("BE", "BE", 80),
            ("RE", "RE", 80),
        ]
        month_columns = [(f"M_{month}", month, 78) for month in self.month_columns]
        columns = tuple(col_id for col_id, _, _ in base_columns + month_columns)
        display_columns = tuple(col_id for col_id, heading, width in base_columns + month_columns if width > 0)

        tree = ttk.Treeview(tree_frame, columns=columns, displaycolumns=display_columns, show="headings", height=15)
        for col_id, heading, width in base_columns + month_columns:
            tree.heading(col_id, text=heading)
            if width > 0:
                anchor = "w" if col_id in {"NAME", "AGENCY", "REMARKS", "STARTFLAG"} else "center"
                tree.column(col_id, width=width, minwidth=width, anchor=anchor, stretch=False)
            else:
                tree.column(col_id, width=0, minwidth=0, stretch=False)

        tree.pack(side=LEFT, fill=BOTH, expand=True)

        y_scroll = ttk.Scrollbar(tree_frame, orient="vertical", command=tree.yview)
        y_scroll.pack(side=RIGHT, fill=Y)
        x_scroll = ttk.Scrollbar(frame, orient="horizontal", command=tree.xview)
        x_scroll.pack(fill=X, padx=5)
        tree.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)
        tree.bind("<Double-1>", lambda _event, t=tree: self.open_plant_level_form(t))
        tree.bind("<<TreeviewSelect>>", lambda _event, t=tree, kind=ptype: self.on_project_selected(t, kind))

        self.project_trees[ptype] = tree
        self.load_projects(tree, ptype)

        btn_frame = Frame(frame, bg="#eef3f8")
        btn_frame.pack(pady=15)
        edit_state = NORMAL if not self.main_app or self.main_app.can_edit("ongoing") else DISABLED

        Button(
            btn_frame,
            text="Edit Plant Level Form",
            command=lambda t=tree: self.open_plant_level_form(t),
            bg="#0f766e",
            fg="white",
            font=("Arial", 10, "bold"),
            width=22,
            height=2,
            state=edit_state,
        ).pack(side=LEFT, padx=8)

        Button(
            btn_frame,
            text="🗑️ Delete",
            command=lambda t=tree: self.delete_plant_level_form(t),
            bg="#c1121f",
            fg="white",
            font=("Arial", 10, "bold"),
            width=14,
            height=2,
            state=edit_state,
        ).pack(side=LEFT, padx=8)

        Button(
            btn_frame,
            text="Contract Details & Appendix-2",
            command=lambda t=tree: self.open_contract(t),
            bg="#003087",
            fg="white",
            font=("Arial", 10, "bold"),
            width=28,
            height=2,
            state=edit_state,
        ).pack(side=LEFT, padx=8)

    def build_project_tabs(self):
        tool_wrap = LabelFrame(
            self.content_area,
            text="Selected Project Tabs",
            bg="#eef3f8",
            fg="#003087",
            font=("Arial", 11, "bold"),
            padx=8,
            pady=8,
        )
        tool_wrap.pack(fill=X, padx=4, pady=(8, 0))

        self.project_context_label = Label(
            tool_wrap,
            text="Select an ongoing project to activate Daily Progress Report, Schedule, and Repository.",
            bg="#eef3f8",
            fg="#334155",
            font=("Arial", 10, "bold"),
            anchor="w",
            justify=LEFT,
        )
        self.project_context_label.pack(fill=X, pady=(0, 8))

        self.project_tabs = ttk.Notebook(tool_wrap)
        self.project_tabs.pack(fill=X, expand=True)

        self.daily_tab = Frame(self.project_tabs, bg="#eef3f8")
        self.schedule_tab = Frame(self.project_tabs, bg="#eef3f8")
        self.repository_tab = Frame(self.project_tabs, bg="#eef3f8")

        self.project_tabs.add(self.daily_tab, text="Daily Progress Report")
        self.project_tabs.add(self.schedule_tab, text="Schedule")
        self.project_tabs.add(self.repository_tab, text="Repository")

        self.daily_tab_message = Label(
            self.daily_tab,
            text="Select a project and complete S-Curve Planning to enable Daily Progress Report.",
            bg="#eef3f8",
            fg="#c8102e",
            font=("Arial", 10, "bold"),
            justify=LEFT,
            anchor="w",
        )
        self.daily_tab_message.pack(fill=X, padx=12, pady=(12, 8))
        self.daily_tab_button = Button(
            self.daily_tab,
            text="Open Daily Progress Report",
            command=self.open_selected_daily_progress,
            bg="#003087",
            fg="white",
            font=("Arial", 10, "bold"),
            width=24,
            height=2,
        )
        self.daily_tab_button.pack(anchor="w", padx=12, pady=(0, 12))

        self.schedule_tab_message = Label(
            self.schedule_tab,
            text="Schedule stays available after project selection.",
            bg="#eef3f8",
            fg="#334155",
            font=("Arial", 10, "bold"),
            justify=LEFT,
            anchor="w",
        )
        self.schedule_tab_message.pack(fill=X, padx=12, pady=(12, 8))
        self.schedule_tab_button = Button(
            self.schedule_tab,
            text="Open Schedule",
            command=self.open_selected_schedule,
            bg="#0f766e",
            fg="white",
            font=("Arial", 10, "bold"),
            width=18,
            height=2,
        )
        self.schedule_tab_button.pack(anchor="w", padx=12, pady=(0, 12))

        self.repository_tab_message = Label(
            self.repository_tab,
            text="Repository stays available after project selection.",
            bg="#eef3f8",
            fg="#334155",
            font=("Arial", 10, "bold"),
            justify=LEFT,
            anchor="w",
        )
        self.repository_tab_message.pack(fill=X, padx=12, pady=(12, 8))
        self.repository_tab_button = Button(
            self.repository_tab,
            text="Open Repository",
            command=self.open_selected_repository,
            bg="#555555",
            fg="white",
            font=("Arial", 10, "bold"),
            width=18,
            height=2,
        )
        self.repository_tab_button.pack(anchor="w", padx=12, pady=(0, 12))

        self.clear_selected_project_context()

    def clear_selected_project_context(self):
        self.selected_project_id = None
        self.selected_project_uid = ""
        self.selected_project_name = ""
        self.selected_project_type = ""
        self.project_context_label.config(
            text="Select an ongoing project to activate Daily Progress Report, Schedule, and Repository."
        )
        self.daily_tab_message.config(
            text="Select a project and complete S-Curve Planning to enable Daily Progress Report.",
            fg="#c8102e",
        )
        self.schedule_tab_message.config(text="Schedule stays available after project selection.")
        self.repository_tab_message.config(text="Repository stays available after project selection.")
        self.daily_tab_button.config(state=DISABLED)
        self.schedule_tab_button.config(state=DISABLED)
        self.repository_tab_button.config(state=DISABLED)
        self.project_tabs.tab(self.daily_tab, state="disabled")
        self.project_tabs.tab(self.schedule_tab, state="disabled")
        self.project_tabs.tab(self.repository_tab, state="disabled")

    def on_project_selected(self, tree, ptype):
        selected = tree.selection()
        if not selected:
            return

        for other_tree in self.project_trees.values():
            if other_tree is not tree:
                other_tree.selection_remove(*other_tree.selection())

        project_id, uid = self.get_selected_project_info(tree)
        if not project_id:
            self.clear_selected_project_context()
            return

        values = tree.item(selected[0]).get("values", [])
        if len(values) > 6:
            project_name = str(values[6] or "").strip()
        elif len(values) > 1:
            project_name = str(values[1] or "").strip()
        else:
            project_name = uid

        self.selected_project_id = project_id
        self.selected_project_uid = uid
        self.selected_project_name = project_name
        self.selected_project_type = ptype

        self.project_context_label.config(
            text=f"Selected Project: {uid} - {project_name} ({ptype})"
        )
        self.update_project_tabs()

    def update_project_tabs(self):
        has_project = bool(self.selected_project_id)
        has_daily_access = bool(self.main_app and self.main_app.can_access("daily_progress"))
        has_schedule_access = bool(self.main_app and self.main_app.can_access("schedule"))
        has_repository_access = bool(self.main_app and self.main_app.can_access("repository"))
        has_completed_planning = project_has_completed_planning(self.selected_project_id) if has_project else False

        daily_enabled = has_project and has_daily_access and has_completed_planning
        schedule_enabled = has_project and has_schedule_access
        repository_enabled = has_project and has_repository_access

        self.project_tabs.tab(self.daily_tab, state="normal" if daily_enabled else "disabled")
        self.project_tabs.tab(self.schedule_tab, state="normal" if schedule_enabled else "disabled")
        self.project_tabs.tab(self.repository_tab, state="normal" if repository_enabled else "disabled")

        self.daily_tab_button.config(state=NORMAL if daily_enabled else DISABLED)
        self.schedule_tab_button.config(state=NORMAL if schedule_enabled else DISABLED)
        self.repository_tab_button.config(state=NORMAL if repository_enabled else DISABLED)

        if has_project and not has_completed_planning:
            self.daily_tab_message.config(
                text="Daily Progress Report stays disabled until S-Curve Planning is completed for this project.",
                fg="#c8102e",
            )
        elif daily_enabled:
            self.daily_tab_message.config(
                text="S-Curve Planning is completed. Daily Progress Report is active for this project.",
                fg="#0f766e",
            )

        if schedule_enabled:
            self.schedule_tab_message.config(
                text=f"Schedule is available for {self.selected_project_name or self.selected_project_uid}.",
            )
        if repository_enabled:
            self.repository_tab_message.config(
                text=f"Repository is available for {self.selected_project_name or self.selected_project_uid}.",
            )

        if daily_enabled:
            self.project_tabs.select(self.daily_tab)
        elif schedule_enabled:
            self.project_tabs.select(self.schedule_tab)
        elif repository_enabled:
            self.project_tabs.select(self.repository_tab)

    def open_selected_daily_progress(self):
        if not self.selected_project_id:
            messagebox.showwarning("Select", "Please select an ongoing project first.")
            return
        if self.main_app and not self.main_app.can_access("daily_progress"):
            messagebox.showwarning("Access Denied", "You do not have access to Daily Progress Report.")
            return
        if not project_has_completed_planning(self.selected_project_id):
            messagebox.showwarning(
                "Planning Pending",
                "Daily Progress Report stays disabled until S-Curve Planning is completed for the selected project.",
            )
            return

        webbrowser.open(f"{WEB_DAILY_PROGRESS_URL}?projectId={self.selected_project_id}")

    def open_selected_schedule(self):
        if not self.selected_project_id:
            messagebox.showwarning("Select", "Please select an ongoing project first.")
            return
        if self.main_app and hasattr(self.main_app, "open_schedule_window"):
            self.main_app.open_schedule_window(
                project_uid=self.selected_project_uid,
                project_name=self.selected_project_name,
            )

    def open_selected_repository(self):
        if not self.selected_project_id:
            messagebox.showwarning("Select", "Please select an ongoing project first.")
            return
        if self.main_app and hasattr(self.main_app, "show_repository"):
            self.main_app.show_repository(
                project_id=self.selected_project_id,
                uid=self.selected_project_uid,
                project_name=self.selected_project_name,
            )

    def show_type(self, ptype):
        self.active_type = ptype
        for name, frame in self.type_frames.items():
            if name == ptype:
                frame.pack(fill=BOTH, expand=True)
            else:
                frame.pack_forget()

        for name, button in self.type_buttons.items():
            if name == ptype:
                button.config(bg="#0f766e", fg="white")
            else:
                button.config(bg="#dbeafe", fg="#003087")

        tree = self.project_trees.get(ptype)
        if tree is not None:
            self.load_projects(tree, ptype)
        self.clear_selected_project_context()

    def refresh_all(self):
        for ptype, tree in self.project_trees.items():
            self.load_projects(tree, ptype)
        if self.active_type in self.project_trees:
            self.show_type(self.active_type)
        else:
            self.clear_selected_project_context()

    def format_number(self, value):
        text = str(value or "").strip()
        if not text:
            return ""
        try:
            return f"{float(text):.2f}"
        except (TypeError, ValueError):
            return text

    def parse_monthly_values(self, raw_value):
        try:
            parsed = json.loads(raw_value or "{}")
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    def build_start_status(self, project_row):
        source_date = (
            project_row.get("schedule_start")
            or project_row.get("display_schedule_start")
            or project_row.get("stage2_date")
            or project_row.get("registration_date")
        )
        return classify_project_financial_year(source_date, self.current_fy, date.today())["fy_classification"]

    def get_selected_project_info(self, tree):
        selected = tree.selection()
        if not selected:
            return None, None
        values = tree.item(selected[0]).get("values", [])
        if not values:
            return None, None
        if len(values) > 2:
            try:
                return int(values[0]), str(values[1])
            except (TypeError, ValueError):
                pass
        uid = str(values[0])
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT id FROM projects WHERE unique_id=%s", (uid,))
        row = c.fetchone()
        conn.close()
        return (int(row["id"]), uid) if row else (None, None)

    def order_projects_with_children(self, rows):
        project_rows = [dict(row) for row in rows]
        ids_in_view = {int(row.get("id") or 0) for row in project_rows}
        children_by_parent = {}
        roots = []

        for row in project_rows:
            parent_id = row.get("parent_project_id")
            try:
                parent_id = int(parent_id) if parent_id not in (None, "") else None
            except (TypeError, ValueError):
                parent_id = None

            if parent_id and parent_id in ids_in_view:
                children_by_parent.setdefault(parent_id, []).append(row)
            else:
                roots.append(row)

        def sort_key(row):
            return int(row.get("id") or 0)

        roots.sort(key=sort_key, reverse=True)
        for child_rows in children_by_parent.values():
            child_rows.sort(key=sort_key, reverse=True)

        ordered = []

        def append_project(row, depth):
            ordered.append((row, depth))
            row_id = int(row.get("id") or 0)
            for child in children_by_parent.get(row_id, []):
                append_project(child, depth + 1)

        for root in roots:
            append_project(root, 0)

        return ordered

    def load_projects(self, tree, ptype):
        for item in tree.get_children():
            tree.delete(item)
        if ptype == "Plant Level AMR":
            self.load_plant_level_projects(tree)
            return

        conn = get_db_connection()
        c = conn.cursor()
        allowed_project_ids = self.main_app.get_allowed_project_ids() if self.main_app else None
        if allowed_project_ids is not None and not allowed_project_ids:
            conn.close()
            return
        if allowed_project_ids is None:
            c.execute(
                """
                SELECT id, parent_project_id, unique_id, project_name, stage2_cost, stage1_cost
                FROM projects
                WHERE project_type=%s AND stage2_cleared='Y'
                ORDER BY id DESC
                """,
                (ptype,),
            )
        else:
            c.execute(
                """
                SELECT id, parent_project_id, unique_id, project_name, stage2_cost, stage1_cost
                FROM projects
                WHERE project_type=%s AND stage2_cleared='Y' AND id = ANY(%s)
                ORDER BY id DESC
                """,
                (ptype, list(allowed_project_ids)),
            )
        rows = c.fetchall()
        conn.close()
        for row, depth in self.order_projects_with_children(rows):
            prefix = ("    " * max(0, depth)) + ("- " if depth else "")
            gross_cost = row.get("stage2_cost")
            if gross_cost in (None, ""):
                gross_cost = row.get("stage1_cost")
            tree.insert(
                "",
                END,
                values=(
                    row["unique_id"],
                    f"{prefix}{row['project_name']}",
                    self.format_number(gross_cost),
                ),
            )

    def load_plant_level_projects(self, tree):
        conn = get_db_connection()
        c = conn.cursor()
        allowed_project_ids = self.main_app.get_allowed_project_ids() if self.main_app else None
        if allowed_project_ids is not None and not allowed_project_ids:
            conn.close()
            return

        filter_sql = ""
        params = ["Plant Level AMR"]
        if allowed_project_ids is not None:
            filter_sql = " AND p.id = ANY(%s)"
            params.append(list(allowed_project_ids))

        c.execute(
            f"""
            SELECT
                p.*,
                d.sl_no,
                d.at_no,
                d.at_date,
                d.department,
                d.executing_agency,
                COALESCE(d.schedule_start, (
                    SELECT MIN(a.schedule_start)
                    FROM appendix2 a
                    WHERE a.project_id = p.id AND a.schedule_start IS NOT NULL AND a.schedule_start <> ''
                ), p.effective_date) AS display_schedule_start,
                COALESCE(d.schedule_completion, p.schedule_completion, (
                    SELECT MAX(a.schedule_finish)
                    FROM appendix2 a
                    WHERE a.project_id = p.id AND a.schedule_finish IS NOT NULL AND a.schedule_finish <> ''
                )) AS display_schedule_completion,
                d.anticipated_completion,
                d.remarks,
                d.physical_progress,
                d.gross_cost AS detail_gross_cost,
                d.capex_till_last_fy,
                d.be_amount,
                d.re_amount,
                d.monthly_values
            FROM projects p
            LEFT JOIN plant_level_amr_details d ON d.project_id = p.id
            WHERE p.project_type=%s AND p.stage2_cleared='Y'
            {filter_sql}
            ORDER BY p.id DESC
            """,
            params,
        )
        rows = c.fetchall()
        conn.close()

        for index, (row, depth) in enumerate(self.order_projects_with_children(rows), start=1):
            month_values = self.parse_monthly_values(row.get("monthly_values"))
            gross_cost = row.get("detail_gross_cost")
            if gross_cost in (None, ""):
                gross_cost = row.get("stage2_cost")
            if gross_cost in (None, ""):
                gross_cost = row.get("stage1_cost")
            prefix = ("    " * max(0, depth)) + ("- " if depth else "")

            values = [
                row["id"],
                row["unique_id"],
                row.get("sl_no") or str(index),
                row.get("at_no") or "",
                to_display_date(row.get("at_date")),
                row.get("department") or "",
                f"{prefix}{row.get('project_name') or ''}",
                row.get("executing_agency") or row.get("contractor_name") or "",
                to_display_date(row.get("display_schedule_start")),
                to_display_date(row.get("display_schedule_completion")),
                to_display_date(row.get("anticipated_completion")),
                to_display_date(row.get("completion_date")),
                get_project_status(row),
                self.build_start_status(row),
                row.get("remarks") or "",
                self.format_number(row.get("physical_progress")),
                self.format_number(gross_cost),
                self.format_number(row.get("capex_till_last_fy")),
                self.format_number(row.get("be_amount")),
                self.format_number(row.get("re_amount")),
            ]
            for month in self.month_columns:
                values.append(self.format_number(month_values.get(month)))
            tree.insert("", END, values=tuple(values))

    def fetch_plant_level_detail(self, project_id):
        conn = get_db_connection()
        c = conn.cursor()
        c.execute(
            """
            SELECT
                p.*,
                d.sl_no,
                d.at_no,
                d.at_date,
                d.department,
                d.executing_agency,
                d.schedule_start,
                d.schedule_completion,
                d.anticipated_completion,
                d.remarks,
                d.physical_progress,
                d.gross_cost,
                d.capex_till_last_fy,
                d.be_amount,
                d.re_amount,
                d.monthly_values
            FROM projects p
            LEFT JOIN plant_level_amr_details d ON d.project_id = p.id
            WHERE p.id=%s
            """,
            (project_id,),
        )
        row = c.fetchone()
        conn.close()
        return row

    def save_plant_level_detail(self, project_id, payload):
        remarks = str(payload.get("remarks") or "").strip()
        if len(remarks) > PLANT_LEVEL_REMARKS_LIMIT:
            raise ValueError(f"Remarks cannot exceed {PLANT_LEVEL_REMARKS_LIMIT} characters.")
        payload["remarks"] = remarks
        conn = get_db_connection()
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO plant_level_amr_details (
                project_id, sl_no, at_no, at_date, department, executing_agency,
                schedule_start, schedule_completion, anticipated_completion, remarks,
                physical_progress, gross_cost, capex_till_last_fy, be_amount, re_amount, monthly_values
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (project_id) DO UPDATE SET
                sl_no=EXCLUDED.sl_no,
                at_no=EXCLUDED.at_no,
                at_date=EXCLUDED.at_date,
                department=EXCLUDED.department,
                executing_agency=EXCLUDED.executing_agency,
                schedule_start=EXCLUDED.schedule_start,
                schedule_completion=EXCLUDED.schedule_completion,
                anticipated_completion=EXCLUDED.anticipated_completion,
                remarks=EXCLUDED.remarks,
                physical_progress=EXCLUDED.physical_progress,
                gross_cost=EXCLUDED.gross_cost,
                capex_till_last_fy=EXCLUDED.capex_till_last_fy,
                be_amount=EXCLUDED.be_amount,
                re_amount=EXCLUDED.re_amount,
                monthly_values=EXCLUDED.monthly_values
            """,
            (
                project_id,
                payload.get("sl_no"),
                payload.get("at_no"),
                payload.get("at_date"),
                payload.get("department"),
                payload.get("executing_agency"),
                payload.get("schedule_start"),
                payload.get("schedule_completion"),
                payload.get("anticipated_completion"),
                payload.get("remarks"),
                payload.get("physical_progress"),
                payload.get("gross_cost"),
                payload.get("capex_till_last_fy"),
                payload.get("be_amount"),
                payload.get("re_amount"),
                payload.get("monthly_values"),
            ),
        )
        conn.commit()
        conn.close()

    def delete_plant_level_detail(self, project_id):
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("DELETE FROM plant_level_amr_details WHERE project_id=%s", (project_id,))
        conn.commit()
        conn.close()

    def parse_float_or_none(self, value):
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            raise ValueError("Enter numeric values only for amount and progress fields.")

    def create_plant_level_payload_from_row(self, row, month_values):
        gross_cost = row.get("gross_cost")
        if gross_cost in (None, ""):
            gross_cost = row.get("stage2_cost")
        if gross_cost in (None, ""):
            gross_cost = row.get("stage1_cost")
        return {
            "sl_no": str(row.get("sl_no") or "").strip(),
            "at_no": str(row.get("at_no") or "").strip(),
            "at_date": to_storage_date(row.get("at_date")),
            "department": str(row.get("department") or "").strip(),
            "executing_agency": str(row.get("executing_agency") or row.get("contractor_name") or "").strip(),
            "schedule_start": to_storage_date(row.get("schedule_start")),
            "schedule_completion": to_storage_date(row.get("schedule_completion") or row.get("schedule_completion")),
            "anticipated_completion": to_storage_date(row.get("anticipated_completion")),
            "remarks": str(row.get("remarks") or "").strip(),
            "physical_progress": row.get("physical_progress"),
            "gross_cost": gross_cost,
            "capex_till_last_fy": row.get("capex_till_last_fy"),
            "be_amount": row.get("be_amount"),
            "re_amount": row.get("re_amount"),
            "monthly_values": json.dumps(month_values, ensure_ascii=False),
        }

    def delete_plant_level_form(self, tree):
        if self.main_app and not self.main_app.can_edit("ongoing"):
            messagebox.showwarning("Edit Denied", "You have view access only for Ongoing Projects.")
            return

        project_id, uid = self.get_selected_project_info(tree)
        if not project_id:
            messagebox.showwarning("Select", "Please select a Plant Level AMR project first.")
            return

        if not messagebox.askyesno(
            "Delete Form",
            f"Delete Plant Level AMR monitoring data for {uid}?\n\nThis will clear only the Plant Level form data, not the project registration.",
        ):
            return

        self.delete_plant_level_detail(project_id)
        self.load_plant_level_projects(self.project_trees["Plant Level AMR"])
        messagebox.showinfo("Deleted", "Plant Level AMR form data deleted successfully.")

    def open_plant_level_form(self, tree):
        if self.main_app and not self.main_app.can_edit("ongoing"):
            messagebox.showwarning("Edit Denied", "You have view access only for Ongoing Projects.")
            return

        project_id, uid = self.get_selected_project_info(tree)
        if not project_id:
            messagebox.showwarning("Select", "Please select a Plant Level AMR project first.")
            return

        row = self.fetch_plant_level_detail(project_id)
        if not row:
            messagebox.showwarning("Missing", "Project details could not be loaded.")
            return

        monthly_values = self.parse_monthly_values(row.get("monthly_values"))
        project_status = get_project_status(row)
        start_status = self.build_start_status(row)

        popup = Toplevel(self)
        popup.title(f"Plant Level AMR Form - {uid}")
        popup.geometry("1200x820")
        popup.configure(bg="#eef3f8")
        popup.grab_set()

        canvas = Canvas(popup, bg="#eef3f8", highlightthickness=0)
        canvas.pack(side=LEFT, fill=BOTH, expand=True)
        scroll = ttk.Scrollbar(popup, orient=VERTICAL, command=canvas.yview)
        scroll.pack(side=RIGHT, fill=Y)
        canvas.configure(yscrollcommand=scroll.set)

        content = Frame(canvas, bg="#eef3f8")
        canvas_window = canvas.create_window((0, 0), window=content, anchor="nw")

        def on_content_configure(_event=None):
            canvas.configure(scrollregion=canvas.bbox("all"))

        def on_canvas_configure(event):
            canvas.itemconfigure(canvas_window, width=event.width)

        content.bind("<Configure>", on_content_configure)
        canvas.bind("<Configure>", on_canvas_configure)

        Label(
            content,
            text="Plant Level AMR Monitoring Form",
            bg="#eef3f8",
            fg="#003087",
            font=("Arial", 18, "bold"),
        ).pack(pady=(14, 6))
        Label(
            content,
            text=f"Project: {row.get('project_name', '')}",
            bg="#eef3f8",
            fg="#1d4ed8",
            font=("Arial", 13, "bold"),
        ).pack(pady=(0, 12))

        form = Frame(content, bg="#eef3f8")
        form.pack(fill=X, padx=18, pady=(0, 8))

        vars_map = {
            "sl_no": StringVar(value=str(row.get("sl_no") or "")),
            "at_no": StringVar(value=str(row.get("at_no") or "")),
            "at_date": StringVar(value=to_display_date(row.get("at_date"))),
            "department": StringVar(value=str(row.get("department") or "")),
            "executing_agency": StringVar(value=str(row.get("executing_agency") or row.get("contractor_name") or "")),
            "schedule_start": StringVar(value=to_display_date(row.get("schedule_start"))),
            "schedule_completion": StringVar(value=to_display_date(row.get("schedule_completion") or row.get("schedule_completion"))),
            "anticipated_completion": StringVar(value=to_display_date(row.get("anticipated_completion"))),
            "physical_progress": StringVar(value=self.format_number(row.get("physical_progress"))),
            "gross_cost": StringVar(value=self.format_number(row.get("gross_cost") if row.get("gross_cost") not in (None, "") else (row.get("stage2_cost") if row.get("stage2_cost") not in (None, "") else row.get("stage1_cost")))),
            "capex_till_last_fy": StringVar(value=self.format_number(row.get("capex_till_last_fy"))),
            "be_amount": StringVar(value=self.format_number(row.get("be_amount"))),
            "re_amount": StringVar(value=self.format_number(row.get("re_amount"))),
        }

        general_fields = [
            ("Sl No.", "sl_no"),
            ("A/T No.", "at_no"),
            ("A/T Date (DD-MM-YY)", "at_date"),
            ("Deptt.", "department"),
            ("Executing Agency", "executing_agency"),
            ("Schedule Start (DD-MM-YY)", "schedule_start"),
            ("Schedule Completion (DD-MM-YY)", "schedule_completion"),
            ("Anticipated Completion (DD-MM-YY)", "anticipated_completion"),
            ("Physical Progress", "physical_progress"),
            ("Gross Cost", "gross_cost"),
            ("CAPEX till Last FY", "capex_till_last_fy"),
            ("BE", "be_amount"),
            ("RE", "re_amount"),
        ]

        for idx, (label_text, key) in enumerate(general_fields):
            row_idx = idx // 2
            col_offset = (idx % 2) * 2
            Label(form, text=label_text + ":", bg="#eef3f8", font=("Arial", 10, "bold")).grid(
                row=row_idx, column=col_offset, sticky=W, padx=8, pady=6
            )
            Entry(form, textvariable=vars_map[key], font=("Arial", 10), width=28).grid(
                row=row_idx, column=col_offset + 1, sticky=W, padx=8, pady=6
            )

        info_frame = LabelFrame(content, text="Auto Picked Project Information", bg="#eef3f8", fg="#003087", font=("Arial", 11, "bold"))
        info_frame.pack(fill=X, padx=18, pady=(6, 8))

        info_pairs = [
            ("Unique ID", uid),
            ("Project Name", row.get("project_name") or ""),
            ("Project Status", project_status),
            ("Start Status", start_status),
            ("Completion Date", to_display_date(row.get("completion_date"))),
        ]
        for idx, (label_text, value) in enumerate(info_pairs):
            Label(info_frame, text=label_text + ":", bg="#eef3f8", font=("Arial", 10, "bold")).grid(
                row=idx, column=0, sticky=W, padx=8, pady=4
            )
            Label(info_frame, text=value, bg="#eef3f8", fg="#111827", font=("Arial", 10)).grid(
                row=idx, column=1, sticky=W, padx=8, pady=4
            )

        remarks_frame = LabelFrame(content, text="Remarks", bg="#eef3f8", fg="#003087", font=("Arial", 11, "bold"))
        remarks_frame.pack(fill=X, padx=18, pady=(4, 8))
        remarks_text = Text(remarks_frame, height=4, font=("Arial", 10), wrap="word")
        remarks_text.pack(fill=X, padx=8, pady=8)
        if row.get("remarks"):
            remarks_text.insert("1.0", str(row.get("remarks"))[:PLANT_LEVEL_REMARKS_LIMIT])

        def limit_remarks(_event=None):
            text = remarks_text.get("1.0", END).rstrip("\n")
            if len(text) > PLANT_LEVEL_REMARKS_LIMIT:
                remarks_text.delete("1.0", END)
                remarks_text.insert("1.0", text[:PLANT_LEVEL_REMARKS_LIMIT])
                remarks_text.mark_set(INSERT, END)
                return "break"
            return None

        remarks_text.bind("<KeyRelease>", limit_remarks)

        month_frame = LabelFrame(
            content,
            text=f"Monthly Values - {self.current_fy}",
            bg="#eef3f8",
            fg="#003087",
            font=("Arial", 11, "bold"),
        )
        month_frame.pack(fill=X, padx=18, pady=(4, 8))

        month_vars = {}
        for index, month in enumerate(self.month_columns):
            month_vars[month] = StringVar(value=self.format_number(monthly_values.get(month)))
            row_idx = index // 4
            col_idx = (index % 4) * 2
            Label(month_frame, text=month + ":", bg="#eef3f8", font=("Arial", 10, "bold")).grid(
                row=row_idx, column=col_idx, sticky=W, padx=8, pady=6
            )
            Entry(month_frame, textvariable=month_vars[month], font=("Arial", 10), width=16).grid(
                row=row_idx, column=col_idx + 1, sticky=W, padx=8, pady=6
            )

        btns = Frame(content, bg="#eef3f8")
        btns.pack(fill=X, padx=18, pady=16)

        def reset_form():
            popup.destroy()
            self.open_plant_level_form(tree)

        def save_form():
            try:
                monthly_payload = {
                    month: self.parse_float_or_none(var.get())
                    for month, var in month_vars.items()
                    if str(var.get()).strip()
                }
                payload = {
                    "sl_no": vars_map["sl_no"].get().strip(),
                    "at_no": vars_map["at_no"].get().strip(),
                    "at_date": to_storage_date(vars_map["at_date"].get()),
                    "department": vars_map["department"].get().strip(),
                    "executing_agency": vars_map["executing_agency"].get().strip(),
                    "schedule_start": to_storage_date(vars_map["schedule_start"].get()),
                    "schedule_completion": to_storage_date(vars_map["schedule_completion"].get()),
                    "anticipated_completion": to_storage_date(vars_map["anticipated_completion"].get()),
                    "remarks": remarks_text.get("1.0", END).strip(),
                    "physical_progress": self.parse_float_or_none(vars_map["physical_progress"].get()),
                    "gross_cost": self.parse_float_or_none(vars_map["gross_cost"].get()),
                    "capex_till_last_fy": self.parse_float_or_none(vars_map["capex_till_last_fy"].get()),
                    "be_amount": self.parse_float_or_none(vars_map["be_amount"].get()),
                    "re_amount": self.parse_float_or_none(vars_map["re_amount"].get()),
                    "monthly_values": json.dumps(monthly_payload, ensure_ascii=False),
                }
            except ValueError as exc:
                messagebox.showerror("Invalid Value", str(exc), parent=popup)
                keep_window_active(popup)
                return

            try:
                self.save_plant_level_detail(project_id, payload)
            except ValueError as exc:
                messagebox.showerror("Invalid Value", str(exc), parent=popup)
                keep_window_active(popup)
                return
            self.load_plant_level_projects(self.project_trees["Plant Level AMR"])
            messagebox.showinfo("Saved", "Plant Level AMR form saved successfully.", parent=popup)
            keep_window_active(popup)

        Button(
            btns,
            text="Save",
            command=save_form,
            bg="#0066cc",
            fg="white",
            font=("Arial", 10, "bold"),
            width=14,
            height=2,
        ).pack(side=LEFT, padx=6)
        Button(
            btns,
            text="Reset",
            command=reset_form,
            bg="#555555",
            fg="white",
            font=("Arial", 10, "bold"),
            width=14,
            height=2,
        ).pack(side=LEFT, padx=6)
        Button(
            btns,
            text="Close",
            command=popup.destroy,
            bg="#8b0000",
            fg="white",
            font=("Arial", 10, "bold"),
            width=14,
            height=2,
        ).pack(side=RIGHT, padx=6)

        apply_page_watermark(popup)
        normalize_buttons(popup)
        keep_window_active(popup)

    def open_contract(self, tree):
        if self.main_app and not self.main_app.can_edit("ongoing"):
            messagebox.showwarning("Edit Denied", "You have view access only for Ongoing Projects.")
            return

        project_id, uid = self.get_selected_project_info(tree)
        if not project_id:
            messagebox.showwarning("Select", "Please select a project first")
            return
        if self.main_app and not self.main_app.can_access_project(project_id):
            messagebox.showwarning("Access Denied", "You do not have access to this project.")
            return
        win = execution.ContractWindow(self.master, project_id, uid, main_app=self.main_app)
        keep_window_active(win)

    def open_scurve(self, tree):
        if self.main_app and not self.main_app.can_edit("ongoing"):
            messagebox.showwarning("Edit Denied", "You have view access only for Ongoing Projects.")
            return

        project_id, uid = self.get_selected_project_info(tree)
        if not project_id:
            messagebox.showwarning("Select", "Please select a project first")
            return
        if self.main_app and not self.main_app.can_access_project(project_id):
            messagebox.showwarning("Access Denied", "You do not have access to this project.")
            return
        win = execution.ScurveWindow(self.master, project_id, uid, main_app=self.main_app)
        keep_window_active(win)

    def open_corporate_amr_master(self):
        if self.main_app and not self.main_app.can_access("ongoing"):
            messagebox.showwarning("Access Denied", "You do not have access to Ongoing Projects.")
            return
        from corporate_amr_master import CorporateAMRMasterWindow

        win = CorporateAMRMasterWindow(self.winfo_toplevel(), main_app=self.main_app)
        keep_window_active(win)


if __name__ == "__main__":
    root = Tk()
    root.withdraw()
    OngoingProjectsFrame(root)
    root.mainloop()
