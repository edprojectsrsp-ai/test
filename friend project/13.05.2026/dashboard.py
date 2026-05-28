from datetime import datetime, timedelta
import json
import os
import subprocess
import tempfile
from tkinter import *
from tkinter import filedialog, ttk, messagebox

from database import get_db_connection, get_latest_planned_plan
from utils import classify_project_financial_year, normalize_buttons


STATUS_COLORS = {
    "on_track": "#16a34a",
    "at_risk": "#f59e0b",
    "delayed": "#dc2626",
}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BUNDLED_PYTHON = os.path.join(
    os.path.expanduser("~"),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "python.exe",
)
BUNDLED_NODE = os.path.join(
    os.path.expanduser("~"),
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "node",
    "bin",
    "node.exe",
)
PY_EXPORT_HELPER = os.path.join(BASE_DIR, "dashboard_export_doc_pdf.py")
PPT_EXPORT_HELPER = os.path.join(BASE_DIR, "dashboard_export_ppt.js")


class DashboardScrollableFrame(Frame):
    def __init__(self, parent, bg="#eef3f8"):
        super().__init__(parent, bg=bg)
        self.canvas = Canvas(self, bg=bg, highlightthickness=0)
        self.v_scroll = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.canvas.pack(side=LEFT, fill=BOTH, expand=True)
        self.v_scroll.pack(side=RIGHT, fill=Y)
        self.canvas.configure(yscrollcommand=self.v_scroll.set)

        self.content = Frame(self.canvas, bg=bg)
        self.window_id = self.canvas.create_window((0, 0), window=self.content, anchor="nw")

        self.content.bind("<Configure>", self._on_content_configure)
        self.canvas.bind("<Configure>", self._on_canvas_configure)
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)

    def _on_content_configure(self, _event=None):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _on_canvas_configure(self, event):
        self.canvas.itemconfigure(self.window_id, width=event.width)

    def _on_mousewheel(self, event):
        self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")


class DashboardWindow(Toplevel):
    def __init__(self, parent, main_app=None, project_id=None):
        super().__init__(parent)
        self.main_app = main_app
        self.current_project_id = project_id
        self.project_options = []
        self.current_snapshot = {}

        self.title("Executive Dashboard - Sutradhar PM")
        self.geometry("1680x980")
        self.configure(bg="#eef3f8")

        self.build_ui()
        self.load_project_options()
        if self.project_options:
            default = next((p for p in self.project_options if p["id"] == project_id), self.project_options[0])
            self.project_var.set(default["label"])
            self.refresh_dashboard()

        normalize_buttons(self)

    def build_ui(self):
        top = Frame(self, bg="#0b3d91", height=62)
        top.pack(fill=X)
        top.pack_propagate(False)
        Label(top, text="PROJECT-WISE EXECUTIVE SUMMARY DASHBOARD", bg="#0b3d91", fg="white", font=("Arial", 18, "bold")).pack(expand=True)

        controls = Frame(self, bg="#eef3f8")
        controls.pack(fill=X, padx=12, pady=8)
        Label(controls, text="Project", bg="#eef3f8", fg="#1f2937", font=("Arial", 10, "bold")).pack(side=LEFT)
        self.project_var = StringVar()
        self.project_combo = ttk.Combobox(controls, textvariable=self.project_var, state="readonly", width=55)
        self.project_combo.pack(side=LEFT, padx=6)
        self.project_combo.bind("<<ComboboxSelected>>", lambda _e: self.refresh_dashboard())

        Label(controls, text="FY", bg="#eef3f8", fg="#1f2937", font=("Arial", 10, "bold")).pack(side=LEFT, padx=(12, 0))
        self.fy_var = StringVar(value=self.current_fy_label())
        self.fy_combo = ttk.Combobox(controls, textvariable=self.fy_var, state="readonly", width=14, values=self.fy_labels())
        self.fy_combo.pack(side=LEFT, padx=6)
        self.fy_combo.bind("<<ComboboxSelected>>", lambda _e: self.refresh_dashboard())

        Label(controls, text="Month", bg="#eef3f8", fg="#1f2937", font=("Arial", 10, "bold")).pack(side=LEFT, padx=(12, 0))
        self.month_var = StringVar(value=datetime.now().strftime("%b-%y"))
        self.month_combo = ttk.Combobox(controls, textvariable=self.month_var, state="readonly", width=12, values=self.last_12_months())
        self.month_combo.pack(side=LEFT, padx=6)
        self.month_combo.bind("<<ComboboxSelected>>", lambda _e: self.refresh_dashboard())

        Button(controls, text="Refresh", command=self.refresh_dashboard, bg="#0369a1", fg="white", font=("Arial", 9, "bold"), width=10).pack(side=LEFT, padx=6)
        Button(controls, text="Export PDF", command=self.export_pdf, bg="#14532d", fg="white", font=("Arial", 9, "bold"), width=12).pack(side=LEFT, padx=6)
        Button(controls, text="Export DOC", command=self.export_docx, bg="#1d4ed8", fg="white", font=("Arial", 9, "bold"), width=12).pack(side=LEFT, padx=6)
        Button(controls, text="Export PPT", command=self.export_pptx, bg="#9333ea", fg="white", font=("Arial", 9, "bold"), width=12).pack(side=LEFT, padx=6)

        self.page_scroll = DashboardScrollableFrame(self, bg="#eef3f8")
        self.page_scroll.pack(fill=BOTH, expand=True, padx=10, pady=(0, 10))
        self.body = self.page_scroll.content
        self.body.grid_columnconfigure(0, weight=1)
        self.body.grid_rowconfigure(4, weight=1)

        self.header_card = LabelFrame(self.body, text="Project Identity", bg="white", fg="#0b3d91", font=("Arial", 11, "bold"), padx=10, pady=8)
        self.header_card.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        self.header_text = Label(self.header_card, text="", bg="white", justify=LEFT, font=("Arial", 10), anchor="w")
        self.header_text.pack(fill=X)
        self.status_badge = Label(self.header_card, text="", fg="white", font=("Arial", 10, "bold"), padx=10, pady=4)
        self.status_badge.pack(anchor="e", pady=(6, 0))

        row2 = Frame(self.body, bg="#eef3f8")
        row2.grid(row=1, column=0, sticky="ew", pady=(0, 8))
        row2.grid_columnconfigure(0, weight=3)
        row2.grid_columnconfigure(1, weight=2)
        row2.grid_columnconfigure(2, weight=3)

        self.physical_card = LabelFrame(row2, text="Physical Progress Summary", bg="white", fg="#0b3d91", font=("Arial", 11, "bold"), padx=8, pady=8)
        self.physical_card.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        self.physical_text = Text(self.physical_card, height=10, font=("Consolas", 10), bg="white", relief="flat")
        self.physical_text.pack(fill=BOTH, expand=True)
        self.physical_text.configure(state="disabled")

        self.stage_card = LabelFrame(row2, text="Stage Status", bg="white", fg="#0b3d91", font=("Arial", 11, "bold"), padx=8, pady=8)
        self.stage_card.grid(row=0, column=1, sticky="nsew", padx=3)
        self.stage_text = Label(self.stage_card, text="", bg="white", justify=LEFT, anchor="nw", font=("Arial", 10))
        self.stage_text.pack(fill=BOTH, expand=True)

        self.capex_card = LabelFrame(row2, text="CAPEX Snapshot", bg="white", fg="#0b3d91", font=("Arial", 11, "bold"), padx=8, pady=8)
        self.capex_card.grid(row=0, column=2, sticky="nsew", padx=(6, 0))
        self.capex_text = Label(self.capex_card, text="", bg="white", justify=LEFT, anchor="nw", font=("Arial", 10))
        self.capex_text.pack(fill=BOTH, expand=True)

        self.work_card = LabelFrame(self.body, text="Current Work Summary (DPR Insights)", bg="white", fg="#0b3d91", font=("Arial", 11, "bold"), padx=8, pady=8)
        self.work_card.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        self.work_text = Text(self.work_card, height=7, wrap=WORD, font=("Arial", 10), bg="white", relief="flat")
        self.work_text.pack(fill=BOTH, expand=True)
        self.work_text.configure(state="disabled")

        row4 = Frame(self.body, bg="#eef3f8")
        row4.grid(row=3, column=0, sticky="nsew")
        row4.grid_columnconfigure(0, weight=1)
        row4.grid_columnconfigure(1, weight=1)
        row4.grid_rowconfigure(0, weight=1)

        self.critical_card = LabelFrame(row4, text="Critical Path Activities", bg="white", fg="#0b3d91", font=("Arial", 11, "bold"), padx=8, pady=8)
        self.critical_card.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        self.critical_tree = self.make_activity_tree(self.critical_card)
        self.critical_tree.bind("<Double-1>", lambda _e: self.drilldown_activity(self.critical_tree))

        self.missed_card = LabelFrame(row4, text="Missed Baseline Activities", bg="white", fg="#0b3d91", font=("Arial", 11, "bold"), padx=8, pady=8)
        self.missed_card.grid(row=0, column=1, sticky="nsew", padx=(6, 0))
        self.missed_tree = self.make_missed_tree(self.missed_card)
        self.missed_tree.bind("<Double-1>", lambda _e: self.drilldown_activity(self.missed_tree))

    def make_activity_tree(self, parent):
        cols = ("activity", "start", "finish", "status", "delay")
        tree = ttk.Treeview(parent, columns=cols, show="headings", height=10)
        tree.heading("activity", text="Activity Name")
        tree.heading("start", text="Baseline Start")
        tree.heading("finish", text="Baseline Finish")
        tree.heading("status", text="Current Status")
        tree.heading("delay", text="Delay (days)")
        tree.column("activity", width=360, anchor="w")
        tree.column("start", width=110, anchor="center")
        tree.column("finish", width=110, anchor="center")
        tree.column("status", width=120, anchor="center")
        tree.column("delay", width=90, anchor="center")
        tree.tag_configure("delayed", foreground="#dc2626")
        tree.tag_configure("risk", foreground="#b45309")
        tree.pack(fill=BOTH, expand=True)
        return tree

    def make_missed_tree(self, parent):
        cols = ("activity", "type", "baseline", "status")
        tree = ttk.Treeview(parent, columns=cols, show="headings", height=10)
        tree.heading("activity", text="Activity Name")
        tree.heading("type", text="Type")
        tree.heading("baseline", text="Baseline Date")
        tree.heading("status", text="Current Status")
        tree.column("activity", width=340, anchor="w")
        tree.column("type", width=90, anchor="center")
        tree.column("baseline", width=120, anchor="center")
        tree.column("status", width=140, anchor="center")
        tree.tag_configure("delayed", foreground="#dc2626")
        tree.tag_configure("risk", foreground="#b45309")
        tree.pack(fill=BOTH, expand=True)
        return tree

    def load_project_options(self):
        allowed_ids = self.main_app.get_allowed_project_ids() if self.main_app else None
        conn = get_db_connection()
        c = conn.cursor()
        if allowed_ids is None:
            c.execute(
                """
                SELECT id, unique_id, project_name
                FROM projects
                WHERE project_type=%s
                ORDER BY id DESC
                """,
                ("Corporate AMR",),
            )
        elif not allowed_ids:
            c.execute("SELECT id, unique_id, project_name FROM projects WHERE 1=0")
        else:
            c.execute(
                """
                SELECT id, unique_id, project_name
                FROM projects
                WHERE project_type=%s AND id = ANY(%s)
                ORDER BY id DESC
                """,
                ("Corporate AMR", list(allowed_ids)),
            )
        rows = c.fetchall()
        conn.close()
        self.project_options = [{"id": r["id"], "label": f"{r['unique_id']} - {r['project_name']}", "name": r["project_name"]} for r in rows]
        self.project_combo["values"] = [row["label"] for row in self.project_options]

    def refresh_dashboard(self):
        selected_label = self.project_var.get().strip()
        selected = next((option for option in self.project_options if option["label"] == selected_label), None)
        if not selected:
            messagebox.showwarning("Project Required", "Please select a project.")
            return
        self.current_project_id = selected["id"]
        snapshot = self.get_dashboard_snapshot(self.current_project_id, self.fy_var.get(), self.month_var.get())
        self.current_snapshot = snapshot
        self.render_snapshot(snapshot)

    def render_snapshot(self, snapshot):
        header = snapshot.get("header", {})
        self.header_text.config(
            text=(
                f"Project: {header.get('project_name', '-')}\n"
                f"Department: {header.get('department', '-')}\n"
                f"Contractor: {header.get('contractor', '-')}\n"
                f"Start Date: {header.get('start_date', '-')}\n"
                f"FY Classification: {header.get('fy_classification', '-')}\n"
                f"Scheduled Completion: {header.get('scheduled_completion', '-')}\n"
                f"Current Delay: {header.get('delay_days', 0)} days"
            )
        )
        status_key = header.get("status_key", "at_risk")
        self.status_badge.config(text=header.get("status_text", "At Risk"), bg=STATUS_COLORS.get(status_key, STATUS_COLORS["at_risk"]))

        self.physical_text.configure(state="normal")
        self.physical_text.delete("1.0", END)
        self.physical_text.insert(END, snapshot.get("physical_text", "No physical progress data available."))
        self.physical_text.configure(state="disabled")

        self.stage_text.config(text=snapshot.get("stage_text", "No stage info available."))
        self.capex_text.config(text=snapshot.get("capex_text", "No CAPEX data available."))

        self.work_text.configure(state="normal")
        self.work_text.delete("1.0", END)
        for line in snapshot.get("dpr_summary", ["- No DPR data available."]):
            self.work_text.insert(END, f"- {line}\n")
        self.work_text.configure(state="disabled")

        for tree in (self.critical_tree, self.missed_tree):
            for item in tree.get_children():
                tree.delete(item)

        for row in snapshot.get("critical_rows", []):
            self.critical_tree.insert("", END, values=row["values"], tags=(row.get("tag", ""),))
        for row in snapshot.get("missed_rows", []):
            self.missed_tree.insert("", END, values=row["values"], tags=(row.get("tag", ""),))

    def get_dashboard_snapshot(self, project_id, fy_label, month_label):
        fy_start, fy_end = self.fy_bounds_from_label(fy_label)
        month_date = self.month_label_to_date(month_label) or datetime.now().date().replace(day=1)
        plan_name = get_latest_planned_plan(project_id)
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM projects WHERE id=%s", (project_id,))
        project = c.fetchone() or {}

        header = self.build_header(project)
        physical_text = self.build_physical_summary(c, project_id, plan_name, fy_start, fy_end, month_date)
        capex_text = self.build_capex_summary(c, project_id)
        dpr_summary = self.build_dpr_summary(c, project_id)
        stage_text = self.build_stage_status(project)
        critical_rows = self.build_critical_rows(c, project_id)
        missed_rows = self.build_missed_rows(c, project_id)
        conn.close()
        return {
            "header": header,
            "physical_text": physical_text,
            "capex_text": capex_text,
            "dpr_summary": dpr_summary,
            "stage_text": stage_text,
            "critical_rows": critical_rows,
            "missed_rows": missed_rows,
        }

    def build_header(self, project):
        start_date = self.format_date(project.get("effective_date") or project.get("registration_date"))
        fy_context = classify_project_financial_year(
            project.get("effective_date") or project.get("registration_date"),
            self.fy_var.get(),
            self.month_label_to_date(self.month_var.get()) or datetime.now().date(),
        )
        completion = self.format_date(project.get("schedule_completion"))
        delay_days = self.calculate_delay_days(project.get("schedule_completion"))
        if delay_days <= 0:
            status_key, status_text = "on_track", "On Track"
        elif delay_days <= 30:
            status_key, status_text = "at_risk", "At Risk"
        else:
            status_key, status_text = "delayed", "Delayed"
        return {
            "project_name": project.get("project_name", "-"),
            "department": project.get("project_type", "-"),
            "contractor": project.get("contractor_name") or "-",
            "start_date": start_date,
            "fy_classification": fy_context["fy_classification"],
            "fy_classification_color": fy_context["fy_classification_color"],
            "financial_year": fy_context["financial_year"],
            "fy_start_date": fy_context["fy_start_date"],
            "scheduled_completion": completion,
            "delay_days": max(0, delay_days),
            "status_key": status_key,
            "status_text": status_text,
        }

    def build_physical_summary(self, cursor, project_id, plan_name, fy_start, fy_end, month_date):
        if not plan_name:
            return "No saved S-curve plan found for this project."
        cursor.execute(
            """
            SELECT activity_type, uom, COALESCE(scope_qty,0) AS scope_qty, COALESCE(actuals_till_last_fy,0) AS last_fy
            FROM activities
            WHERE project_id=%s AND plan_name=%s
            ORDER BY id
            """,
            (project_id, plan_name),
        )
        activities = cursor.fetchall()
        if not activities:
            return "No activities found under latest saved plan."
        cursor.execute(
            """
            SELECT activity_type, month, COALESCE(SUM(planned_qty),0) AS qty
            FROM monthly_plans
            WHERE project_id=%s AND plan_name=%s
            GROUP BY activity_type, month
            """,
            (project_id, plan_name),
        )
        planned = cursor.fetchall()
        cursor.execute(
            """
            SELECT a.activity_type, da.actual_date, COALESCE(SUM(da.actual_qty),0) AS qty
            FROM daily_actuals da
            JOIN activities a ON a.id = da.activity_id
            WHERE a.project_id=%s AND a.plan_name=%s
            GROUP BY a.activity_type, da.actual_date
            """,
            (project_id, plan_name),
        )
        actuals = cursor.fetchall()

        plan_map = {}
        for row in planned:
            plan_map.setdefault(str(row["activity_type"]), []).append((row["month"], float(row["qty"] or 0)))
        act_map = {}
        for row in actuals:
            act_map.setdefault(str(row["activity_type"]), []).append((row["actual_date"], float(row["qty"] or 0)))

        lines = ["Head                        Scope     Till LastFY   MTD Plan   MTD Act   FY Plan   FY Act   Cum Plan   Cum Act", "-" * 102]
        total_scope = total_last = total_mtd_plan = total_mtd_act = total_fy_plan = total_fy_act = 0.0
        for row in activities:
            name = self.short_activity_name(row["activity_type"])
            scope = float(row["scope_qty"] or 0)
            last_fy = float(row["last_fy"] or 0)
            mtd_plan = fy_plan = 0.0
            for month_label, qty in plan_map.get(str(row["activity_type"]), []):
                dt = self.month_label_to_date(month_label)
                if not dt:
                    continue
                if dt.year == month_date.year and dt.month == month_date.month:
                    mtd_plan += qty
                if fy_start <= dt <= fy_end:
                    fy_plan += qty
            mtd_act = fy_act = 0.0
            for date_text, qty in act_map.get(str(row["activity_type"]), []):
                dt = self.safe_date(date_text)
                if not dt:
                    continue
                if dt.year == month_date.year and dt.month == month_date.month:
                    mtd_act += qty
                if fy_start <= dt <= fy_end:
                    fy_act += qty
            lines.append(
                f"{name[:26]:<26} {scope:>8.2f} {last_fy:>12.2f} {mtd_plan:>10.2f} {mtd_act:>9.2f} {fy_plan:>9.2f} {fy_act:>8.2f} {(last_fy+fy_plan):>10.2f} {(last_fy+fy_act):>9.2f}"
            )
            total_scope += scope
            total_last += last_fy
            total_mtd_plan += mtd_plan
            total_mtd_act += mtd_act
            total_fy_plan += fy_plan
            total_fy_act += fy_act
        lines.append("-" * 102)
        lines.append(
            f"{'OVERALL':<26} {total_scope:>8.2f} {total_last:>12.2f} {total_mtd_plan:>10.2f} {total_mtd_act:>9.2f} {total_fy_plan:>9.2f} {total_fy_act:>8.2f} {(total_last+total_fy_plan):>10.2f} {(total_last+total_fy_act):>9.2f}"
        )
        return "\n".join(lines)

    def build_capex_summary(self, cursor, project_id):
        cursor.execute(
            """
            SELECT gross_cost, capex_till_last_fy, be_amount, re_amount, monthly_values
            FROM plant_level_amr_details
            WHERE project_id=%s
            """,
            (project_id,),
        )
        row = cursor.fetchone() or {}
        gross = float(row.get("gross_cost") or 0)
        last = float(row.get("capex_till_last_fy") or 0)
        be = float(row.get("be_amount") or 0)
        re = float(row.get("re_amount") or 0)
        cursor.execute(
            """
            SELECT COALESCE(SUM(actual_qty), 0) AS total_actual
            FROM daily_actuals da
            JOIN activities a ON a.id = da.activity_id
            WHERE a.project_id=%s
            """,
            (project_id,),
        )
        actual = float((cursor.fetchone() or {}).get("total_actual") or 0)
        variance_be = actual - be
        variance_re = actual - re
        return (
            f"Gross Project Cost: {gross:.2f}\n"
            f"CAPEX till Last FY: {last:.2f}\n"
            f"Current FY BE: {be:.2f}\n"
            f"Current FY RE: {re:.2f}\n"
            f"Actual Expenditure till Date: {actual:.2f}\n"
            f"Variance vs BE: {variance_be:+.2f}\n"
            f"Variance vs RE: {variance_re:+.2f}\n"
            f"\nMini Trend (last 3 months):\n"
            f"BE: {be/12:.2f} avg/month | RE: {re/12:.2f} avg/month | Actual: {actual/3:.2f} (last-3 avg)"
        )

    def build_dpr_summary(self, cursor, project_id):
        cursor.execute(
            """
            SELECT report_date, design_engineering, civil, structural_supply, structural_erection,
                   equipment_supply, equipment_erection
            FROM daily_progress
            WHERE project_id=%s
            ORDER BY report_date DESC
            LIMIT 1
            """,
            (project_id,),
        )
        row = cursor.fetchone()
        if not row:
            return ["No DPR snapshot available for this project."]
        civil = float(row.get("civil") or 0)
        structural = float(row.get("structural_supply") or 0) + float(row.get("structural_erection") or 0)
        equipment = float(row.get("equipment_supply") or 0) + float(row.get("equipment_erection") or 0)
        design = float(row.get("design_engineering") or 0)
        remarks = []
        remarks.append(f"Civil works update: {'active' if civil > 0 else 'low movement'} (latest qty {civil:.2f}).")
        remarks.append(f"Structural works: {'progressing' if structural > 0 else 'awaiting execution'} (qty {structural:.2f}).")
        remarks.append(f"Equipment supply/erection: {'in progress' if equipment > 0 else 'not yet started'} (qty {equipment:.2f}).")
        remarks.append(f"Design & engineering momentum: {design:.2f} in latest DPR cycle.")
        if civil == 0 or structural == 0 or equipment == 0:
            remarks.append("Key constraint: one or more major work fronts show zero progress in latest DPR.")
        else:
            remarks.append("No major execution blockage visible from latest DPR snapshot.")
        return remarks[:5]

    def build_stage_status(self, project):
        lines = [
            f"COD Cleared: {project.get('cod_cleared', 'N')}",
            f"Stage-1 Cleared: {project.get('stage1_cleared', 'N')}",
            f"Stage-2 Cleared: {project.get('stage2_cleared', 'N')}",
            f"Tender Cancelled: {project.get('tender_cancelled', 'N')}",
            f"Completion Marked: {project.get('completion_marked', 'N')}",
            f"Commissioned: {project.get('commissioned_marked', 'N')}",
        ]
        return "\n".join(lines)

    def build_critical_rows(self, cursor, project_id):
        cursor.execute(
            """
            SELECT id, activity_name, start_date, finish_date, percent_complete
            FROM schedule_activities
            WHERE is_critical='Y'
            ORDER BY id
            LIMIT 30
            """
        )
        rows = []
        today = datetime.now().date()
        for row in cursor.fetchall():
            finish = self.safe_date(row.get("finish_date"))
            delay = 0
            if finish and finish < today and float(row.get("percent_complete") or 0) < 100:
                delay = (today - finish).days
            percent = float(row.get("percent_complete") or 0)
            status = "Not Started" if percent <= 0 else (f"{percent:.1f}%" if percent < 100 else "Completed")
            tag = "delayed" if delay > 0 else ("risk" if finish and (finish - today).days <= 7 and percent < 100 else "")
            rows.append(
                {
                    "values": (
                        row.get("activity_name") or "-",
                        self.format_date(row.get("start_date")),
                        self.format_date(row.get("finish_date")),
                        status,
                        delay,
                    ),
                    "tag": tag,
                }
            )
        return rows

    def build_missed_rows(self, cursor, project_id):
        cursor.execute(
            """
            SELECT activity_name, start_date, finish_date, actual_start, actual_finish, percent_complete
            FROM schedule_activities
            ORDER BY id
            LIMIT 200
            """
        )
        rows = []
        today = datetime.now().date()
        for row in cursor.fetchall():
            start = self.safe_date(row.get("start_date"))
            finish = self.safe_date(row.get("finish_date"))
            actual_start = self.safe_date(row.get("actual_start"))
            percent = float(row.get("percent_complete") or 0)
            if start and start < today and not actual_start:
                rows.append(
                    {
                        "values": (row.get("activity_name") or "-", "Start", self.format_date(start), "Not Started"),
                        "tag": "delayed",
                    }
                )
            elif finish and finish < today and percent < 100:
                tag = "delayed" if (today - finish).days > 7 else "risk"
                rows.append(
                    {
                        "values": (row.get("activity_name") or "-", "Finish", self.format_date(finish), f"{percent:.1f}% Complete"),
                        "tag": tag,
                    }
                )
        return rows[:40]

    def drilldown_activity(self, tree):
        item = tree.selection()
        if not item:
            return
        values = tree.item(item[0]).get("values", [])
        if not values:
            return
        messagebox.showinfo(
            "Activity Drill-down",
            f"Activity: {values[0]}\nStatus: {values[-2] if len(values) > 2 else '-'}\n\nUse Schedule module for full task-level drill-down and dependencies.",
        )

    def build_export_payload(self):
        header = self.current_snapshot.get("header", {})
        return {
            "title": "Executive Summary Dashboard",
            "project_label": self.project_var.get().strip(),
            "fy_label": self.fy_var.get().strip(),
            "month_label": self.month_var.get().strip(),
            "status_text": header.get("status_text", "At Risk"),
            "header_lines": self.header_text.cget("text").split("\n"),
            "physical_text": self.current_snapshot.get("physical_text", ""),
            "stage_text": self.current_snapshot.get("stage_text", ""),
            "capex_text": self.current_snapshot.get("capex_text", ""),
            "dpr_summary": self.current_snapshot.get("dpr_summary", []),
            "critical_rows": [row.get("values", ()) for row in self.current_snapshot.get("critical_rows", [])],
            "missed_rows": [row.get("values", ()) for row in self.current_snapshot.get("missed_rows", [])],
        }

    def capture_current_view_image(self):
        self.update_idletasks()
        canvas = self.page_scroll.canvas
        x = canvas.winfo_rootx()
        y = canvas.winfo_rooty()
        width = canvas.winfo_width()
        height = canvas.winfo_height()
        if width <= 1 or height <= 1:
            raise RuntimeError("Dashboard page is not visible enough to export.")
        try:
            from PIL import ImageGrab
        except Exception as exc:
            raise RuntimeError("Pillow ImageGrab is required to export the current page view.") from exc

        image = ImageGrab.grab(bbox=(x, y, x + width, y + height))
        with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as handle:
            image.save(handle.name, "PNG")
            return handle.name

    def run_external_export(self, file_path, export_format):
        if not self.current_snapshot:
            messagebox.showwarning("No Data", "Please load a project dashboard first.")
            return False
        temp_json = None
        temp_image = None
        file_path = filedialog.asksaveasfilename(
            title="Export Executive Summary",
            defaultextension=file_path["extension"],
            filetypes=file_path["types"],
            initialfile=file_path["initialfile"],
        )
        if not file_path:
            return False
        try:
            payload = self.build_export_payload()
            if export_format in ("pdf", "docx"):
                temp_image = self.capture_current_view_image()
                payload["current_view_image"] = temp_image

            with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                temp_json = handle.name

            if export_format in ("pdf", "docx"):
                if not os.path.exists(BUNDLED_PYTHON):
                    raise FileNotFoundError("Bundled Python runtime not found for report export.")
                if not os.path.exists(PY_EXPORT_HELPER):
                    raise FileNotFoundError("Dashboard export helper is missing.")
                result = subprocess.run(
                    [BUNDLED_PYTHON, PY_EXPORT_HELPER, temp_json, file_path, export_format],
                    capture_output=True,
                    text=True,
                    check=True,
                )
                if result.stdout.strip():
                    print(result.stdout.strip())
            elif export_format == "pptx":
                if not os.path.exists(BUNDLED_NODE):
                    raise FileNotFoundError("Bundled Node runtime not found for PPT export.")
                if not os.path.exists(PPT_EXPORT_HELPER):
                    raise FileNotFoundError("Dashboard PPT export helper is missing.")
                result = subprocess.run(
                    [BUNDLED_NODE, PPT_EXPORT_HELPER, temp_json, file_path],
                    capture_output=True,
                    text=True,
                    check=True,
                )
                if result.stdout.strip():
                    print(result.stdout.strip())
            else:
                raise ValueError(f"Unsupported export format: {export_format}")

            format_label = {"pdf": "PDF", "docx": "DOCX", "pptx": "PPT"}[export_format]
            messagebox.showinfo("Exported", f"Dashboard {format_label} saved:\n{file_path}")
            return True
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or str(exc)).strip()
            messagebox.showerror("Export Error", f"Could not export dashboard report.\n\n{detail}")
            return False
        except Exception as exc:
            messagebox.showerror("Export Error", str(exc))
            return False
        finally:
            if temp_json and os.path.exists(temp_json):
                try:
                    os.remove(temp_json)
                except Exception:
                    pass
            if temp_image and os.path.exists(temp_image):
                try:
                    os.remove(temp_image)
                except Exception:
                    pass

    def export_pdf(self):
        self.run_external_export(
            {
                "extension": ".pdf",
                "types": [("PDF File", "*.pdf")],
                "initialfile": "executive_dashboard_summary.pdf",
            },
            "pdf",
        )

    def export_docx(self):
        self.run_external_export(
            {
                "extension": ".docx",
                "types": [("Word Document", "*.docx")],
                "initialfile": "executive_dashboard_summary.docx",
            },
            "docx",
        )

    def export_pptx(self):
        self.run_external_export(
            {
                "extension": ".pptx",
                "types": [("PowerPoint Presentation", "*.pptx")],
                "initialfile": "executive_dashboard_summary.pptx",
            },
            "pptx",
        )

    def calculate_delay_days(self, schedule_completion):
        dt = self.safe_date(schedule_completion)
        if not dt:
            return 0
        return (datetime.now().date() - dt).days

    def safe_date(self, date_text):
        if not date_text:
            return None
        txt = str(date_text).strip()
        for fmt in ("%Y-%m-%d", "%d-%m-%y", "%d-%m-%Y"):
            try:
                return datetime.strptime(txt[:10], fmt).date()
            except Exception:
                pass
        return None

    def format_date(self, date_text):
        dt = self.safe_date(date_text)
        return dt.strftime("%d-%m-%Y") if dt else "-"

    def month_label_to_date(self, text):
        try:
            return datetime.strptime(str(text or "").strip(), "%b-%y").date().replace(day=1)
        except Exception:
            return None

    def short_activity_name(self, text):
        value = str(text or "").strip()
        if "->" in value:
            return value.split("->")[-1].strip()
        return value

    def fy_labels(self):
        y = datetime.now().year
        labels = []
        for offset in range(-1, 2):
            start = y + offset if datetime.now().month >= 4 else y + offset - 1
            labels.append(f"FY {start}-{str(start + 1)[-2:]}")
        return labels

    def current_fy_label(self):
        year = datetime.now().year if datetime.now().month >= 4 else datetime.now().year - 1
        return f"FY {year}-{str(year + 1)[-2:]}"

    def fy_bounds_from_label(self, text):
        try:
            start_year = int(str(text).split()[1].split("-")[0])
        except Exception:
            start_year = datetime.now().year if datetime.now().month >= 4 else datetime.now().year - 1
        return datetime(start_year, 4, 1).date(), datetime(start_year + 1, 3, 31).date()

    def last_12_months(self):
        months = []
        current = datetime.now().date().replace(day=1)
        for _ in range(12):
            months.append(current.strftime("%b-%y"))
            prev = current - timedelta(days=1)
            current = prev.replace(day=1)
        return months

