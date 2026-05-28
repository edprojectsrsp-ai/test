from tkinter import *
from tkinter import ttk, messagebox, filedialog
from datetime import datetime, date, timedelta
from collections import defaultdict, deque
import csv
import json
import math
import os
import re
import xml.etree.ElementTree as ET

from database import get_db_connection
from utils import (
    apply_page_watermark,
    keep_window_active,
    normalize_buttons,
    parse_app_date,
    to_display_date,
    to_storage_date,
)


class ScheduleFrame(Frame):
    STANDARD_COLUMNS = [
        "activity_uid",
        "activity_code",
        "activity_name",
        "wbs",
        "duration_days",
        "start_date",
        "finish_date",
        "actual_start",
        "actual_finish",
        "percent_complete",
        "predecessors",
        "successors",
        "early_start",
        "early_finish",
        "late_start",
        "late_finish",
        "total_float",
        "is_critical",
    ]

    DEFAULT_VISIBLE_COLUMNS = [
        "activity_code",
        "activity_name",
        "duration_days",
        "start_date",
        "finish_date",
        "actual_start",
        "actual_finish",
        "percent_complete",
        "predecessors",
        "early_start",
        "early_finish",
        "late_start",
        "late_finish",
        "total_float",
        "is_critical",
    ]

    COLUMN_LABELS = {
        "activity_uid": "Activity UID",
        "activity_code": "Activity ID",
        "activity_name": "Activity Name",
        "wbs": "WBS",
        "duration_days": "Duration\n(Days)",
        "start_date": "Schedule\nStart",
        "finish_date": "Schedule\nFinish",
        "actual_start": "Actual\nStart",
        "actual_finish": "Actual\nFinish",
        "percent_complete": "%\nComplete",
        "predecessors": "Predecessors",
        "successors": "Successors",
        "early_start": "Early\nStart",
        "early_finish": "Early\nFinish",
        "late_start": "Late\nStart",
        "late_finish": "Late\nFinish",
        "total_float": "Total\nFloat",
        "is_critical": "Critical",
    }

    DATE_COLUMNS = {"start_date", "finish_date", "actual_start", "actual_finish", "early_start", "early_finish", "late_start", "late_finish"}

    def __init__(self, parent, main_app=None):
        super().__init__(parent, bg="#f0f4f8")
        self.main_app = main_app
        self.current_schedule = None
        self.activities = []
        self.available_columns = list(self.STANDARD_COLUMNS)
        self.visible_columns = list(self.DEFAULT_VISIBLE_COLUMNS)
        self.critical_highlight_enabled = True

        self.build_ui()
        self.refresh_all()
        apply_page_watermark(self)
        normalize_buttons(self)
        self.compact_ribbon_buttons()

    def build_ui(self):
        self.can_edit_schedule = not self.main_app or self.main_app.can_edit("schedule")
        self.edit_state = NORMAL if self.can_edit_schedule else DISABLED

        self.build_quick_access_toolbar()

        header = Frame(self, bg="#003087", height=90)
        header.pack(fill=X)
        header.pack_propagate(False)
        Label(header, text="SCHEDULE - CRITICAL PATH METHOD", bg="#003087", fg="white",
              font=("Arial", 22, "bold")).pack(expand=True, pady=(12, 0))
        Label(header, text="Upload Primavera XML / XER, calculate CPM, update Actual Start / Finish / % Complete",
              bg="#003087", fg="#dbeafe", font=("Arial", 10, "bold")).pack(pady=(0, 10))

        self.build_ribbon()
        self.build_timeline_bar()

        table_frame = Frame(self, bg="#f0f4f8")
        table_frame.pack(fill=BOTH, expand=True, padx=18, pady=(0, 18))
        table_frame.grid_rowconfigure(0, weight=1)
        table_frame.grid_columnconfigure(0, weight=1)

        self.tree = ttk.Treeview(table_frame, columns=self.visible_columns, show="headings", height=24)
        self.tree.grid(row=0, column=0, sticky="nsew")
        self.tree.bind("<Double-1>", lambda _event: self.open_update_popup())

        yscroll = ttk.Scrollbar(table_frame, orient=VERTICAL, command=self.tree.yview)
        yscroll.grid(row=0, column=1, sticky="ns")
        xscroll = Scrollbar(table_frame, orient=HORIZONTAL, command=self.tree.xview, width=18)
        xscroll.grid(row=1, column=0, sticky="ew", pady=(4, 0))
        self.tree.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)

    def build_quick_access_toolbar(self):
        quick = Frame(self, bg="#e5e7eb", height=34)
        quick.pack(fill=X)
        quick.pack_propagate(False)
        self.quick_access_toolbar = quick

        Label(quick, text="Quick Access:", bg="#e5e7eb", fg="#003087",
              font=("Arial", 9, "bold")).pack(side=LEFT, padx=(12, 6))
        self.ribbon_button(quick, "Save", self.save_schedule_state, "#003087", self.edit_state).pack(side=LEFT, padx=3, pady=4)
        self.ribbon_button(quick, "Undo", lambda: self.show_info("Undo", "Undo history will be available after manual schedule editing is expanded."), "#555555").pack(side=LEFT, padx=3, pady=4)
        self.ribbon_button(quick, "Redo", lambda: self.show_info("Redo", "Redo history will be available after manual schedule editing is expanded."), "#555555").pack(side=LEFT, padx=3, pady=4)
        self.ribbon_button(quick, "Refresh", self.refresh_all, "#28a745").pack(side=LEFT, padx=3, pady=4)

    def build_ribbon(self):
        self.ribbon = ttk.Notebook(self)
        self.ribbon.pack(fill=X, padx=8, pady=(8, 0))

        tabs = {
            "File": [
                ("Schedule File", [("Upload XML/XER", self.upload_schedule, self.edit_state), ("Refresh", self.refresh_all, NORMAL)]),
                ("Manage", [("Save", self.save_schedule_state, self.edit_state), ("Columns", self.open_column_popup, NORMAL)]),
            ],
            "Task": [
                ("Schedule", [("Recalculate CPM", self.recalculate_current_schedule, self.edit_state), ("Update Activity", self.open_update_popup, self.edit_state)]),
                ("Tasks", [("Insert Task", self.open_insert_task_popup, self.edit_state), ("Link Tasks", self.open_link_tasks_popup, self.edit_state)]),
                ("Properties", [("Task Information", self.open_update_popup, self.edit_state), ("Advanced", self.open_schedule_settings, NORMAL)]),
            ],
            "Resource": [
                ("Assignments", [("Assign Resources", self.open_assign_resources_popup, self.edit_state)]),
                ("Level", [("Level Resource", lambda: self.show_info("Resource Leveling", "Resource leveling logic can be added after resource calendars are defined."), self.edit_state)]),
                ("Team", [("Team Planner", lambda: self.show_info("Team Planner", "Team planner view will use assigned resources once resource data is available."), NORMAL)]),
            ],
            "Report": [
                ("Reports", [("Critical Path", self.show_critical_path_report, NORMAL), ("Schedule Summary", self.show_schedule_summary, NORMAL)]),
                ("Export", [("Export CSV", self.export_schedule_csv, NORMAL)]),
            ],
            "Project": [
                ("Baseline", [("Set Baseline", self.set_baseline, self.edit_state)]),
                ("Information", [("Project Info", self.show_schedule_summary, NORMAL)]),
            ],
            "View": [
                ("Views", [("Gantt Chart", self.open_gantt_chart, NORMAL), ("Data Grid", self.show_data_grid, NORMAL), ("Network Diagram", self.open_network_diagram, NORMAL)]),
                ("Usage", [("Task Usage", self.show_task_usage, NORMAL), ("Resource Usage", self.show_resource_usage, NORMAL)]),
            ],
            "Format": [
                ("Show / Hide", [("Columns", self.open_column_popup, NORMAL), ("Critical Highlight", self.toggle_critical_highlight, NORMAL)]),
                ("Layout", [("Fit Table", self.fit_table_columns, NORMAL)]),
            ],
            "Team / Add-ins": [
                ("Team", [("Assign Resources", self.open_assign_resources_popup, self.edit_state), ("Team Planner", lambda: self.show_info("Team Planner", "Team planner view will use assigned resources once resource data is available."), NORMAL)]),
                ("Add-ins", [("Refresh Add-ins", lambda: self.show_info("Add-ins", "No external add-ins are configured yet."), NORMAL)]),
            ],
        }

        for tab_name, groups in tabs.items():
            tab = Frame(self.ribbon, bg="#edf2f7")
            self.ribbon.add(tab, text=tab_name)
            for group_name, commands in groups:
                group = LabelFrame(tab, text=group_name, bg="#edf2f7", fg="#003087",
                                   font=("Arial", 9, "bold"), padx=6, pady=6)
                group.pack(side=LEFT, fill=Y, padx=5, pady=5)
                for label, command, state in commands:
                    self.ribbon_button(group, label, command, state=state).pack(side=LEFT, padx=3)
                Button(group, text="...", command=self.open_schedule_settings,
                       bg="#d1d5db", fg="#111827", font=("Arial", 9, "bold"),
                       width=3, height=1).pack(side=LEFT, padx=(6, 0))

    def build_timeline_bar(self):
        timeline = Frame(self, bg="#f8fafc", height=54, bd=1, relief="ridge")
        timeline.pack(fill=X, padx=18, pady=(8, 8))
        timeline.pack_propagate(False)

        Label(timeline, text="Timeline:", bg="#f8fafc", fg="#003087",
              font=("Arial", 10, "bold")).pack(side=LEFT, padx=(12, 8))
        self.timeline_label = Label(timeline, text="Upload a schedule to view project span and critical milestones.",
                                    bg="#f8fafc", fg="#334155", font=("Arial", 10, "bold"), anchor=W)
        self.timeline_label.pack(side=LEFT, fill=X, expand=True, padx=6)
        self.info_label = Label(timeline, text="No schedule uploaded", bg="#f8fafc", fg="#003087",
                                font=("Arial", 9, "bold"))
        self.info_label.pack(side=RIGHT, padx=12)

    def ribbon_button(self, parent, text, command, bg="#0066cc", state=NORMAL):
        return Button(parent, text=text, command=command, bg=bg, fg="white",
                      font=("Arial", 9, "bold"), width=14, height=1, state=state)

    def compact_ribbon_buttons(self):
        def walk(widget):
            for child in widget.winfo_children():
                if isinstance(child, Button):
                    width = 3 if str(child.cget("text")).strip() == "..." else 14
                    child.config(width=width, height=1, anchor=CENTER, justify=CENTER)
                walk(child)
        walk(self.ribbon)
        if hasattr(self, "quick_access_toolbar"):
            walk(self.quick_access_toolbar)

    def refresh_all(self):
        self.load_latest_schedule()
        self.refresh_tree()
        self.update_timeline_bar()

    def upload_schedule(self):
        if self.main_app and not self.main_app.can_edit("schedule"):
            messagebox.showwarning("Edit Denied", "You have view access only for Schedule.")
            return

        file_path = filedialog.askopenfilename(
            title="Upload Schedule XML/XER",
            filetypes=[("Schedule Files", "*.xml *.xer"), ("XML Files", "*.xml"), ("XER Files", "*.xer"), ("All Files", "*.*")],
        )
        if not file_path:
            return

        try:
            ext = os.path.splitext(file_path)[1].lower()
            if ext == ".xer":
                activities = self.parse_xer(file_path)
            elif ext == ".xml":
                activities = self.parse_xml(file_path)
            else:
                messagebox.showerror("Unsupported File", "Please upload a .xml or .xer schedule file.")
                return

            if not activities:
                messagebox.showwarning("No Activities", "No schedule activities were found in the uploaded file.")
                return

            activities = self.calculate_cpm(activities)
            self.save_schedule(os.path.basename(file_path), activities)
            self.refresh_all()
            messagebox.showinfo("Schedule Uploaded", f"Imported {len(activities)} activities and recalculated CPM.")
            keep_window_active(self)
        except Exception as exc:
            messagebox.showerror("Upload Error", f"Failed to import schedule:\n{exc}")
            keep_window_active(self)

    def parse_xer(self, file_path):
        tables = defaultdict(list)
        current_table = None
        current_fields = []

        with open(file_path, "r", encoding="utf-8", errors="ignore") as file:
            for line in file:
                line = line.rstrip("\n\r")
                if not line:
                    continue
                parts = line.split("\t")
                marker = parts[0]
                if marker == "%T" and len(parts) > 1:
                    current_table = parts[1]
                    current_fields = []
                elif marker == "%F" and current_table:
                    current_fields = parts[1:]
                elif marker == "%R" and current_table and current_fields:
                    values = parts[1:]
                    row = {field: values[idx] if idx < len(values) else "" for idx, field in enumerate(current_fields)}
                    tables[current_table].append(row)

        tasks = tables.get("TASK", [])
        relations = tables.get("TASKPRED", [])
        activities = []

        for task in tasks:
            uid = self.first_value(task, "task_id", "guid", "task_code")
            name = self.first_value(task, "task_name", "name")
            if not uid or not name:
                continue

            duration = self.hours_to_days(self.first_value(task, "target_drtn_hr_cnt", "remain_drtn_hr_cnt", "orig_drtn_hr_cnt"))
            start = self.first_date(task, "target_start_date", "act_start_date", "early_start_date", "restart_date")
            finish = self.first_date(task, "target_end_date", "act_end_date", "early_end_date", "reend_date")
            actual_start = self.first_date(task, "act_start_date")
            actual_finish = self.first_date(task, "act_end_date")
            percent = self.percent_value(self.first_value(task, "phys_complete_pct", "complete_pct"))

            activities.append({
                "activity_uid": str(uid),
                "activity_code": self.first_value(task, "task_code", "task_id"),
                "activity_name": name,
                "wbs": self.first_value(task, "wbs_id", "wbs_name", "proj_id"),
                "duration_days": duration,
                "start_date": start,
                "finish_date": finish,
                "actual_start": actual_start,
                "actual_finish": actual_finish,
                "percent_complete": percent,
                "raw_data": dict(task),
            })

        self.apply_relationships(activities, relations, "pred_task_id", "task_id", "lag_hr_cnt")
        return activities

    def parse_xml(self, file_path):
        tree = ET.parse(file_path)
        root = tree.getroot()
        activities = []
        uid_to_activity = {}

        for elem in root.iter():
            tag = self.local_name(elem.tag)
            if tag not in ("Activity", "Task"):
                continue
            fields = self.child_text_map(elem)
            name = self.first_value(fields, "Name", "ActivityName", "TaskName")
            uid = self.first_value(fields, "ObjectId", "UID", "Id", "ID", "ActivityId", "TaskId")
            if not uid or not name:
                continue
            if fields.get("Summary") in ("1", "true", "True"):
                continue

            code = self.first_value(fields, "ActivityId", "Id", "ID", "Code", "UID", "ObjectId")
            duration = self.duration_to_days(self.first_value(fields, "PlannedDuration", "Duration", "OriginalDuration", "RemainingDuration"))
            start = self.first_date(fields, "StartDate", "Start", "PlannedStartDate", "BaselineStartDate")
            finish = self.first_date(fields, "FinishDate", "Finish", "PlannedFinishDate", "BaselineFinishDate")
            actual_start = self.first_date(fields, "ActualStartDate", "ActualStart")
            actual_finish = self.first_date(fields, "ActualFinishDate", "ActualFinish")
            percent = self.percent_value(self.first_value(fields, "PercentComplete", "PhysicalPercentComplete", "CompletePercent"))

            activity = {
                "activity_uid": str(uid),
                "activity_code": code,
                "activity_name": name,
                "wbs": self.first_value(fields, "WBSName", "WBSObjectId", "OutlineNumber", "WBS"),
                "duration_days": duration,
                "start_date": start,
                "finish_date": finish,
                "actual_start": actual_start,
                "actual_finish": actual_finish,
                "percent_complete": percent,
                "raw_data": fields,
            }
            activities.append(activity)
            uid_to_activity[str(uid)] = activity

            for pred_link in elem:
                if self.local_name(pred_link.tag) != "PredecessorLink":
                    continue
                pred_fields = self.child_text_map(pred_link)
                pred_uid = self.first_value(pred_fields, "PredecessorUID", "PredecessorObjectId", "PredecessorActivityObjectId")
                if pred_uid:
                    activity.setdefault("_pred_set", set()).add(str(pred_uid))

        relationship_rows = []
        for elem in root.iter():
            if self.local_name(elem.tag) not in ("Relationship", "ActivityRelationship"):
                continue
            fields = self.child_text_map(elem)
            pred = self.first_value(fields, "PredecessorActivityObjectId", "PredecessorObjectId", "PredecessorUID", "PredecessorActivityId")
            succ = self.first_value(fields, "SuccessorActivityObjectId", "SuccessorObjectId", "SuccessorUID", "SuccessorActivityId")
            if pred and succ:
                relationship_rows.append({"pred": str(pred), "succ": str(succ), "lag": self.first_value(fields, "Lag", "LagDuration")})

        self.apply_relationships(activities, relationship_rows, "pred", "succ", "lag")
        self.finish_inline_predecessors(activities)
        return activities

    def apply_relationships(self, activities, relations, pred_key, succ_key, lag_key=None):
        activity_ids = {str(activity["activity_uid"]) for activity in activities}
        code_to_uid = {str(activity.get("activity_code")): str(activity["activity_uid"]) for activity in activities if activity.get("activity_code")}

        for relation in relations:
            pred = str(relation.get(pred_key) or "").strip()
            succ = str(relation.get(succ_key) or "").strip()
            if pred not in activity_ids:
                pred = code_to_uid.get(pred, pred)
            if succ not in activity_ids:
                succ = code_to_uid.get(succ, succ)
            if pred not in activity_ids or succ not in activity_ids or pred == succ:
                continue
            lag_value = relation.get(lag_key) if lag_key else 0
            lag = self.hours_to_days(lag_value) if lag_key == "lag_hr_cnt" else self.duration_to_days(lag_value)
            pred_activity = next((a for a in activities if str(a["activity_uid"]) == pred), None)
            succ_activity = next((a for a in activities if str(a["activity_uid"]) == succ), None)
            if pred_activity and succ_activity:
                pred_activity.setdefault("_succ_set", set()).add(succ)
                succ_activity.setdefault("_pred_set", set()).add(pred)
                succ_activity.setdefault("_lag_map", {})[pred] = lag

        self.finish_inline_predecessors(activities)

    def finish_inline_predecessors(self, activities):
        id_to_activity = {str(activity["activity_uid"]): activity for activity in activities}
        for activity in activities:
            for pred in list(activity.get("_pred_set", set())):
                if pred in id_to_activity:
                    id_to_activity[pred].setdefault("_succ_set", set()).add(str(activity["activity_uid"]))

        for activity in activities:
            activity["predecessors"] = ", ".join(sorted(activity.get("_pred_set", set())))
            activity["successors"] = ", ".join(sorted(activity.get("_succ_set", set())))

    def calculate_cpm(self, activities):
        if not activities:
            return activities

        id_to_activity = {str(activity["activity_uid"]): activity for activity in activities}
        pred_map = {uid: set(activity.get("_pred_set", set())) & set(id_to_activity.keys()) for uid, activity in id_to_activity.items()}
        succ_map = {uid: set(activity.get("_succ_set", set())) & set(id_to_activity.keys()) for uid, activity in id_to_activity.items()}

        for uid, preds in pred_map.items():
            for pred in preds:
                succ_map.setdefault(pred, set()).add(uid)

        uploaded_dates = [parse_app_date(a.get("start_date")) for a in activities]
        uploaded_dates += [parse_app_date(a.get("finish_date")) for a in activities]
        uploaded_dates = [d for d in uploaded_dates if d]
        project_start = min(uploaded_dates) if uploaded_dates else date.today()

        indegree = {uid: len(preds) for uid, preds in pred_map.items()}
        queue = deque([uid for uid, degree in indegree.items() if degree == 0])
        order = []
        while queue:
            uid = queue.popleft()
            order.append(uid)
            for succ in succ_map.get(uid, set()):
                indegree[succ] -= 1
                if indegree[succ] == 0:
                    queue.append(succ)

        if len(order) != len(id_to_activity):
            for uid in id_to_activity:
                if uid not in order:
                    order.append(uid)

        es = {}
        ef = {}
        duration = {}
        for uid in order:
            activity = id_to_activity[uid]
            duration[uid] = max(0.0, float(activity.get("duration_days") or self.duration_from_dates(activity) or 1))
            pred_finishes = []
            lag_map = activity.get("_lag_map", {})
            for pred in pred_map.get(uid, set()):
                lag = float(lag_map.get(pred, 0) or 0)
                if pred in ef:
                    pred_finishes.append(ef[pred] + timedelta(days=lag))
            uploaded_start = parse_app_date(activity.get("start_date"))
            es[uid] = max(pred_finishes) if pred_finishes else (uploaded_start or project_start)
            ef[uid] = es[uid] + timedelta(days=duration[uid])

        project_finish = max(ef.values()) if ef else project_start
        ls = {}
        lf = {}
        for uid in reversed(order):
            succ_starts = []
            for succ in succ_map.get(uid, set()):
                lag = float(id_to_activity[succ].get("_lag_map", {}).get(uid, 0) or 0)
                if succ in ls:
                    succ_starts.append(ls[succ] - timedelta(days=lag))
            lf[uid] = min(succ_starts) if succ_starts else project_finish
            ls[uid] = lf[uid] - timedelta(days=duration[uid])

        for activity in activities:
            uid = str(activity["activity_uid"])
            total_float = (ls.get(uid, es.get(uid, project_start)) - es.get(uid, project_start)).total_seconds() / 86400
            activity["early_start"] = self.format_storage_date(es.get(uid))
            activity["early_finish"] = self.format_storage_date(ef.get(uid))
            activity["late_start"] = self.format_storage_date(ls.get(uid))
            activity["late_finish"] = self.format_storage_date(lf.get(uid))
            activity["total_float"] = round(total_float, 2)
            activity["is_critical"] = "Y" if total_float <= 0.01 else "N"
            activity["predecessors"] = ", ".join(sorted(pred_map.get(uid, set())))
            activity["successors"] = ", ".join(sorted(succ_map.get(uid, set())))

        return activities

    def save_schedule(self, file_name, activities):
        conn = get_db_connection()
        c = conn.cursor()
        c.execute(
            "INSERT INTO schedule_imports (file_name, imported_at) VALUES (%s, %s) RETURNING id",
            (file_name, datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        schedule_id = c.fetchone()["id"]

        for activity in activities:
            c.execute(
                """
                INSERT INTO schedule_activities (
                    schedule_id, activity_uid, activity_code, activity_name, wbs, duration_days,
                    start_date, finish_date, actual_start, actual_finish, percent_complete,
                    predecessors, successors, early_start, early_finish, late_start, late_finish,
                    total_float, is_critical, raw_data
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    schedule_id,
                    activity.get("activity_uid"),
                    activity.get("activity_code"),
                    activity.get("activity_name"),
                    activity.get("wbs"),
                    activity.get("duration_days") or 0,
                    to_storage_date(activity.get("start_date")),
                    to_storage_date(activity.get("finish_date")),
                    to_storage_date(activity.get("actual_start")),
                    to_storage_date(activity.get("actual_finish")),
                    float(activity.get("percent_complete") or 0),
                    activity.get("predecessors"),
                    activity.get("successors"),
                    to_storage_date(activity.get("early_start")),
                    to_storage_date(activity.get("early_finish")),
                    to_storage_date(activity.get("late_start")),
                    to_storage_date(activity.get("late_finish")),
                    float(activity.get("total_float") or 0),
                    activity.get("is_critical") or "N",
                    json.dumps(activity.get("raw_data") or {}, default=str),
                ),
            )
        conn.commit()
        conn.close()

    def load_latest_schedule(self):
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT id, file_name, imported_at FROM schedule_imports ORDER BY id DESC LIMIT 1")
        self.current_schedule = c.fetchone()
        self.activities = []
        if self.current_schedule:
            c.execute("SELECT * FROM schedule_activities WHERE schedule_id=%s ORDER BY id", (self.current_schedule["id"],))
            rows = c.fetchall()
            for row in rows:
                row = dict(row)
                try:
                    row["raw_data"] = json.loads(row.get("raw_data") or "{}")
                except Exception:
                    row["raw_data"] = {}
                self.activities.append(row)
        conn.close()

        raw_columns = []
        for activity in self.activities:
            for key in (activity.get("raw_data") or {}).keys():
                if key not in self.STANDARD_COLUMNS and key not in raw_columns:
                    raw_columns.append(key)
        self.available_columns = list(self.STANDARD_COLUMNS) + raw_columns

        if self.current_schedule:
            self.info_label.config(
                text=f"Loaded: {self.current_schedule['file_name']} | Activities: {len(self.activities)} | Imported: {self.current_schedule['imported_at']}"
            )
        else:
            self.info_label.config(text="No schedule uploaded")

    def refresh_tree(self):
        self.visible_columns = [col for col in self.visible_columns if col in self.available_columns]
        if not self.visible_columns:
            self.visible_columns = list(self.DEFAULT_VISIBLE_COLUMNS)

        self.tree.configure(columns=self.visible_columns)
        for col in self.visible_columns:
            self.tree.heading(col, text=self.COLUMN_LABELS.get(col, col))
            width = 240 if col == "activity_name" else 150
            if col in ("activity_uid", "activity_code", "duration_days", "percent_complete", "total_float", "is_critical"):
                width = 120
            self.tree.column(col, width=width, minwidth=width, anchor="center", stretch=False)

        for item in self.tree.get_children():
            self.tree.delete(item)

        for activity in self.activities:
            values = [self.get_display_value(activity, col) for col in self.visible_columns]
            tags = ("critical",) if self.critical_highlight_enabled and activity.get("is_critical") == "Y" else ()
            self.tree.insert("", END, iid=str(activity["id"]), values=values, tags=tags)

        self.tree.tag_configure("critical", background="#ffe6e6")

    def recalculate_current_schedule(self):
        if not self.current_schedule:
            messagebox.showwarning("No Schedule", "Please upload a schedule first.")
            return
        activities = []
        for row in self.activities:
            activity = {col: row.get(col) for col in self.STANDARD_COLUMNS}
            activity["raw_data"] = row.get("raw_data") or {}
            activity["_pred_set"] = set(filter(None, str(row.get("predecessors") or "").split(", ")))
            activity["_succ_set"] = set(filter(None, str(row.get("successors") or "").split(", ")))
            activities.append(activity)

        recalculated = self.calculate_cpm(activities)
        conn = get_db_connection()
        c = conn.cursor()
        for old, activity in zip(self.activities, recalculated):
            c.execute(
                """
                UPDATE schedule_activities
                SET early_start=%s, early_finish=%s, late_start=%s, late_finish=%s,
                    total_float=%s, is_critical=%s, predecessors=%s, successors=%s
                WHERE id=%s
                """,
                (
                    to_storage_date(activity.get("early_start")),
                    to_storage_date(activity.get("early_finish")),
                    to_storage_date(activity.get("late_start")),
                    to_storage_date(activity.get("late_finish")),
                    float(activity.get("total_float") or 0),
                    activity.get("is_critical") or "N",
                    activity.get("predecessors"),
                    activity.get("successors"),
                    old["id"],
                ),
            )
        conn.commit()
        conn.close()
        self.refresh_all()
        messagebox.showinfo("CPM Updated", "Critical path recalculated successfully.")

    def save_schedule_state(self):
        if not self.current_schedule:
            messagebox.showwarning("No Schedule", "Please upload a schedule first.")
            return
        self.recalculate_current_schedule()

    def show_info(self, title, message):
        messagebox.showinfo(title, message)
        keep_window_active(self)

    def open_insert_task_popup(self):
        if self.main_app and not self.main_app.can_edit("schedule"):
            messagebox.showwarning("Edit Denied", "You have view access only for Schedule.")
            return
        if not self.current_schedule:
            messagebox.showwarning("No Schedule", "Please upload a schedule before inserting activities.")
            return

        popup = Toplevel(self)
        popup.title("Insert Schedule Task")
        popup.geometry("560x430")
        popup.configure(bg="#f0f4f8")
        popup.transient(self.winfo_toplevel())
        popup.grab_set()

        Label(popup, text="Insert Task", bg="#f0f4f8", fg="#003087",
              font=("Arial", 16, "bold")).pack(pady=(18, 10))
        form = Frame(popup, bg="#f0f4f8")
        form.pack(padx=20, pady=8, fill=X)

        fields = {
            "Activity ID": StringVar(),
            "Task Name": StringVar(),
            "Duration Days": StringVar(value="1"),
            "Start Date DD-MM-YY": StringVar(),
            "Finish Date DD-MM-YY": StringVar(),
        }
        for row, (label, var) in enumerate(fields.items()):
            Label(form, text=label + ":", bg="#f0f4f8", font=("Arial", 10, "bold")).grid(row=row, column=0, sticky=W, padx=8, pady=7)
            Entry(form, textvariable=var, width=36).grid(row=row, column=1, sticky=W, padx=8, pady=7)

        def save_task():
            code = fields["Activity ID"].get().strip()
            name = fields["Task Name"].get().strip()
            if not code or not name:
                messagebox.showerror("Missing Data", "Activity ID and Task Name are required.")
                return
            try:
                duration = float(fields["Duration Days"].get() or 0)
            except ValueError:
                messagebox.showerror("Invalid Duration", "Duration Days must be numeric.")
                return
            start = to_storage_date(fields["Start Date DD-MM-YY"].get().strip()) if fields["Start Date DD-MM-YY"].get().strip() else None
            finish = to_storage_date(fields["Finish Date DD-MM-YY"].get().strip()) if fields["Finish Date DD-MM-YY"].get().strip() else None
            if fields["Start Date DD-MM-YY"].get().strip() and not start:
                messagebox.showerror("Invalid Date", "Start Date must be DD-MM-YY.")
                return
            if fields["Finish Date DD-MM-YY"].get().strip() and not finish:
                messagebox.showerror("Invalid Date", "Finish Date must be DD-MM-YY.")
                return

            uid = f"MANUAL-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            conn = get_db_connection()
            c = conn.cursor()
            c.execute(
                """
                INSERT INTO schedule_activities (
                    schedule_id, activity_uid, activity_code, activity_name, duration_days,
                    start_date, finish_date, percent_complete, raw_data
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, 0, %s)
                """,
                (self.current_schedule["id"], uid, code, name, duration, start, finish, json.dumps({"Source": "Manual"})),
            )
            conn.commit()
            conn.close()
            popup.destroy()
            self.refresh_all()
            self.recalculate_current_schedule()

        buttons = Frame(popup, bg="#f0f4f8")
        buttons.pack(pady=18)
        Button(buttons, text="Insert Task", command=save_task,
               bg="#008000", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=8)
        Button(buttons, text="Cancel", command=popup.destroy,
               bg="#666666", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=8)
        normalize_buttons(popup)

    def open_link_tasks_popup(self):
        if self.main_app and not self.main_app.can_edit("schedule"):
            messagebox.showwarning("Edit Denied", "You have view access only for Schedule.")
            return
        if len(self.activities) < 2:
            messagebox.showwarning("Link Tasks", "At least two activities are required to link tasks.")
            return

        choices = [self.activity_choice(activity) for activity in self.activities]
        popup = Toplevel(self)
        popup.title("Link Tasks")
        popup.geometry("620x300")
        popup.configure(bg="#f0f4f8")
        popup.transient(self.winfo_toplevel())
        popup.grab_set()

        Label(popup, text="Link Tasks", bg="#f0f4f8", fg="#003087",
              font=("Arial", 16, "bold")).pack(pady=(18, 10))
        form = Frame(popup, bg="#f0f4f8")
        form.pack(pady=10)
        pred_var = StringVar(value=choices[0])
        succ_var = StringVar(value=choices[1])
        Label(form, text="Predecessor:", bg="#f0f4f8", font=("Arial", 10, "bold")).grid(row=0, column=0, padx=8, pady=8, sticky=W)
        ttk.Combobox(form, textvariable=pred_var, values=choices, width=58, state="readonly").grid(row=0, column=1, padx=8, pady=8)
        Label(form, text="Successor:", bg="#f0f4f8", font=("Arial", 10, "bold")).grid(row=1, column=0, padx=8, pady=8, sticky=W)
        ttk.Combobox(form, textvariable=succ_var, values=choices, width=58, state="readonly").grid(row=1, column=1, padx=8, pady=8)

        def save_link():
            pred = self.uid_from_choice(pred_var.get())
            succ = self.uid_from_choice(succ_var.get())
            if not pred or not succ or pred == succ:
                messagebox.showerror("Invalid Link", "Please choose two different activities.")
                return
            pred_activity = next((a for a in self.activities if str(a.get("activity_uid")) == pred), None)
            succ_activity = next((a for a in self.activities if str(a.get("activity_uid")) == succ), None)
            if not pred_activity or not succ_activity:
                return

            pred_successors = set(filter(None, str(pred_activity.get("successors") or "").split(", ")))
            succ_predecessors = set(filter(None, str(succ_activity.get("predecessors") or "").split(", ")))
            pred_successors.add(succ)
            succ_predecessors.add(pred)

            conn = get_db_connection()
            c = conn.cursor()
            c.execute("UPDATE schedule_activities SET successors=%s WHERE id=%s", (", ".join(sorted(pred_successors)), pred_activity["id"]))
            c.execute("UPDATE schedule_activities SET predecessors=%s WHERE id=%s", (", ".join(sorted(succ_predecessors)), succ_activity["id"]))
            conn.commit()
            conn.close()
            popup.destroy()
            self.refresh_all()
            self.recalculate_current_schedule()

        buttons = Frame(popup, bg="#f0f4f8")
        buttons.pack(pady=16)
        Button(buttons, text="Link Tasks", command=save_link,
               bg="#008000", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=8)
        Button(buttons, text="Cancel", command=popup.destroy,
               bg="#666666", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=8)
        normalize_buttons(popup)

    def open_assign_resources_popup(self):
        selected = self.tree.selection()
        if not selected:
            messagebox.showwarning("Select Activity", "Please select one activity to assign resources.")
            return
        if self.main_app and not self.main_app.can_edit("schedule"):
            messagebox.showwarning("Edit Denied", "You have view access only for Schedule.")
            return
        activity = next((row for row in self.activities if str(row["id"]) == str(selected[0])), None)
        if not activity:
            return
        raw_data = dict(activity.get("raw_data") or {})

        popup = Toplevel(self)
        popup.title("Assign Resources")
        popup.geometry("560x300")
        popup.configure(bg="#f0f4f8")
        popup.transient(self.winfo_toplevel())
        popup.grab_set()

        Label(popup, text="Assign Resources", bg="#f0f4f8", fg="#003087",
              font=("Arial", 16, "bold")).pack(pady=(18, 8))
        Label(popup, text=str(activity.get("activity_name") or ""), bg="#f0f4f8",
              wraplength=500, font=("Arial", 10, "bold")).pack(pady=(0, 8))
        resources_var = StringVar(value=str(raw_data.get("Resources") or ""))
        Entry(popup, textvariable=resources_var, width=62).pack(padx=20, pady=10, ipady=4)

        def save_resources():
            raw_data["Resources"] = resources_var.get().strip()
            conn = get_db_connection()
            c = conn.cursor()
            c.execute("UPDATE schedule_activities SET raw_data=%s WHERE id=%s", (json.dumps(raw_data), activity["id"]))
            conn.commit()
            conn.close()
            popup.destroy()
            if "Resources" not in self.visible_columns:
                self.visible_columns.append("Resources")
            self.refresh_all()

        buttons = Frame(popup, bg="#f0f4f8")
        buttons.pack(pady=18)
        Button(buttons, text="Save Resources", command=save_resources,
               bg="#008000", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=8)
        Button(buttons, text="Cancel", command=popup.destroy,
               bg="#666666", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=8)
        normalize_buttons(popup)

    def set_baseline(self):
        if not self.activities:
            messagebox.showwarning("No Schedule", "Please upload a schedule first.")
            return
        conn = get_db_connection()
        c = conn.cursor()
        for activity in self.activities:
            raw_data = dict(activity.get("raw_data") or {})
            raw_data["Baseline Start"] = activity.get("start_date") or activity.get("early_start") or ""
            raw_data["Baseline Finish"] = activity.get("finish_date") or activity.get("early_finish") or ""
            c.execute("UPDATE schedule_activities SET raw_data=%s WHERE id=%s", (json.dumps(raw_data), activity["id"]))
        conn.commit()
        conn.close()
        for column in ("Baseline Start", "Baseline Finish"):
            if column not in self.visible_columns:
                self.visible_columns.append(column)
        self.refresh_all()
        messagebox.showinfo("Baseline Saved", "Baseline Start and Baseline Finish saved for all activities.")

    def show_schedule_summary(self):
        if not self.activities:
            messagebox.showwarning("No Schedule", "Please upload a schedule first.")
            return
        date_range = self.get_gantt_date_range()
        critical_count = sum(1 for activity in self.activities if activity.get("is_critical") == "Y")
        completed_count = sum(1 for activity in self.activities if float(activity.get("percent_complete") or 0) >= 100)
        average_progress = sum(float(activity.get("percent_complete") or 0) for activity in self.activities) / max(1, len(self.activities))
        schedule_span = ""
        if date_range:
            schedule_span = f"\nSchedule Span: {to_display_date(date_range[0])} to {to_display_date(date_range[1])}"
        messagebox.showinfo(
            "Schedule Summary",
            f"Activities: {len(self.activities)}\n"
            f"Critical Activities: {critical_count}\n"
            f"Completed Activities: {completed_count}\n"
            f"Average Progress: {average_progress:.2f}%"
            f"{schedule_span}",
        )
        keep_window_active(self)

    def show_critical_path_report(self):
        critical = [activity for activity in self.activities if activity.get("is_critical") == "Y"]
        if not critical:
            messagebox.showinfo("Critical Path", "No critical activities found.")
            return
        lines = []
        for activity in critical[:30]:
            lines.append(
                f"{activity.get('activity_code') or activity.get('activity_uid')} - "
                f"{activity.get('activity_name')} | {to_display_date(activity.get('early_start'))} to {to_display_date(activity.get('early_finish'))}"
            )
        more = f"\n...and {len(critical) - 30} more" if len(critical) > 30 else ""
        messagebox.showinfo("Critical Path", "\n".join(lines) + more)
        keep_window_active(self)

    def export_schedule_csv(self):
        if not self.activities:
            messagebox.showwarning("No Schedule", "Please upload a schedule first.")
            return
        file_path = filedialog.asksaveasfilename(
            title="Export Schedule CSV",
            defaultextension=".csv",
            filetypes=[("CSV File", "*.csv")],
            initialfile="schedule_export.csv",
        )
        if not file_path:
            return
        with open(file_path, "w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow([self.COLUMN_LABELS.get(col, col).replace("\n", " ") for col in self.visible_columns])
            for activity in self.activities:
                writer.writerow([self.get_display_value(activity, col) for col in self.visible_columns])
        messagebox.showinfo("Export Complete", "Schedule exported successfully.")
        keep_window_active(self)

    def show_data_grid(self):
        self.tree.focus_set()
        self.tree.selection_remove(*self.tree.selection())
        messagebox.showinfo("Data Grid", "Data Grid view is active in the working area.")
        keep_window_active(self)

    def show_task_usage(self):
        self.show_usage_window("Task Usage", group_by="task")

    def show_resource_usage(self):
        self.show_usage_window("Resource Usage", group_by="resource")

    def show_usage_window(self, title, group_by):
        if not self.activities:
            messagebox.showwarning("No Schedule", "Please upload a schedule first.")
            return
        popup = Toplevel(self)
        popup.title(title)
        popup.geometry("900x520")
        popup.configure(bg="#f0f4f8")
        popup.transient(self.winfo_toplevel())
        Label(popup, text=title, bg="#f0f4f8", fg="#003087",
              font=("Arial", 16, "bold")).pack(pady=14)

        cols = ("Name", "Duration", "Progress", "Resources")
        tree = ttk.Treeview(popup, columns=cols, show="headings", height=16)
        tree.pack(fill=BOTH, expand=True, padx=16, pady=10)
        for col in cols:
            tree.heading(col, text=col)
            tree.column(col, width=180 if col != "Name" else 360, anchor="center")

        for activity in self.activities:
            raw = activity.get("raw_data") or {}
            resources = raw.get("Resources", "")
            if group_by == "resource" and not resources:
                continue
            tree.insert(
                "",
                END,
                values=(
                    activity.get("activity_name") if group_by == "task" else resources,
                    f"{float(activity.get('duration_days') or 0):.2f}",
                    f"{float(activity.get('percent_complete') or 0):.2f}%",
                    resources,
                ),
            )
        Button(popup, text="Close", command=popup.destroy,
               bg="#666666", fg="white", font=("Arial", 10, "bold")).pack(pady=10)
        normalize_buttons(popup)

    def open_network_diagram(self):
        if not self.activities:
            messagebox.showwarning("No Schedule", "Please upload a schedule first.")
            return
        popup = Toplevel(self)
        popup.title("Network Diagram")
        popup.geometry("1180x680")
        popup.configure(bg="#f0f4f8")
        popup.transient(self.winfo_toplevel())

        Label(popup, text="NETWORK DIAGRAM", bg="#f0f4f8", fg="#003087",
              font=("Arial", 16, "bold")).pack(pady=10)
        frame = Frame(popup, bg="#f0f4f8")
        frame.pack(fill=BOTH, expand=True, padx=12, pady=8)
        canvas = Canvas(frame, bg="white", highlightthickness=1, highlightbackground="#9ca3af")
        canvas.pack(side=LEFT, fill=BOTH, expand=True)
        yscroll = ttk.Scrollbar(frame, orient=VERTICAL, command=canvas.yview)
        yscroll.pack(side=RIGHT, fill=Y)
        canvas.configure(yscrollcommand=yscroll.set)

        node_w = 210
        node_h = 56
        gap_x = 60
        gap_y = 22
        levels = self.network_levels()
        max_level_rows = max((len(items) for items in levels.values()), default=1)
        canvas.configure(scrollregion=(0, 0, 80 + len(levels) * (node_w + gap_x), 80 + max_level_rows * (node_h + gap_y)))
        positions = {}
        for level, ids in levels.items():
            x = 40 + level * (node_w + gap_x)
            for row, uid in enumerate(ids):
                y = 40 + row * (node_h + gap_y)
                activity = next((a for a in self.activities if str(a.get("activity_uid")) == uid), None)
                if not activity:
                    continue
                positions[uid] = (x, y)
                fill = "#fee2e2" if activity.get("is_critical") == "Y" else "#dbeafe"
                canvas.create_rectangle(x, y, x + node_w, y + node_h, fill=fill, outline="#003087", width=2)
                label = f"{activity.get('activity_code') or uid}\n{str(activity.get('activity_name') or '')[:32]}"
                canvas.create_text(x + node_w / 2, y + node_h / 2, text=label, font=("Arial", 8, "bold"), width=node_w - 12)
        for activity in self.activities:
            uid = str(activity.get("activity_uid"))
            if uid not in positions:
                continue
            x1, y1 = positions[uid]
            for succ in filter(None, str(activity.get("successors") or "").split(", ")):
                if succ in positions:
                    x2, y2 = positions[succ]
                    canvas.create_line(x1 + node_w, y1 + node_h / 2, x2, y2 + node_h / 2, arrow=LAST, fill="#374151", width=2)

    def open_schedule_settings(self):
        messagebox.showinfo(
            "Advanced Schedule Settings",
            "Current settings:\n"
            "- Calendar basis: 8 working hours per day for XER hour conversion\n"
            "- CPM relationship type: Finish-to-Start\n"
            "- Critical threshold: Total Float <= 0\n"
            "- Uploaded raw columns can be shown from Format > Columns",
        )
        keep_window_active(self)

    def toggle_critical_highlight(self):
        self.critical_highlight_enabled = not self.critical_highlight_enabled
        self.refresh_tree()

    def fit_table_columns(self):
        for col in self.visible_columns:
            width = 280 if col == "activity_name" else 130
            self.tree.column(col, width=width, minwidth=width, stretch=False)

    def activity_choice(self, activity):
        return f"{activity.get('activity_uid')} | {activity.get('activity_code') or ''} | {activity.get('activity_name') or ''}"

    def uid_from_choice(self, choice):
        return str(choice or "").split("|", 1)[0].strip()

    def update_timeline_bar(self):
        if not hasattr(self, "timeline_label"):
            return
        date_range = self.get_gantt_date_range()
        if not date_range:
            self.timeline_label.config(text="Upload a schedule to view project span and critical milestones.")
            return
        critical_count = sum(1 for activity in self.activities if activity.get("is_critical") == "Y")
        completed_count = sum(1 for activity in self.activities if float(activity.get("percent_complete") or 0) >= 100)
        self.timeline_label.config(
            text=(
                f"{to_display_date(date_range[0])} to {to_display_date(date_range[1])} | "
                f"Activities: {len(self.activities)} | Critical: {critical_count} | Complete: {completed_count}"
            )
        )

    def network_levels(self):
        ids = [str(activity.get("activity_uid")) for activity in self.activities]
        pred_map = {
            str(activity.get("activity_uid")): set(filter(None, str(activity.get("predecessors") or "").split(", ")))
            for activity in self.activities
        }
        levels_by_id = {}
        for uid in ids:
            self.calculate_network_level(uid, pred_map, levels_by_id)
        levels = defaultdict(list)
        for uid, level in levels_by_id.items():
            levels[level].append(uid)
        return dict(sorted(levels.items()))

    def calculate_network_level(self, uid, pred_map, levels_by_id, visiting=None):
        visiting = visiting or set()
        if uid in levels_by_id:
            return levels_by_id[uid]
        if uid in visiting:
            levels_by_id[uid] = 0
            return 0
        visiting.add(uid)
        preds = [pred for pred in pred_map.get(uid, set()) if pred in pred_map and pred != uid]
        if not preds:
            levels_by_id[uid] = 0
            visiting.discard(uid)
            return 0
        level = 1 + max(self.calculate_network_level(pred, pred_map, levels_by_id, visiting) for pred in preds)
        levels_by_id[uid] = level
        visiting.discard(uid)
        return level

    def open_update_popup(self):
        selected = self.tree.selection()
        if not selected:
            messagebox.showwarning("Select Activity", "Please select one schedule activity.")
            return
        if self.main_app and not self.main_app.can_edit("schedule"):
            messagebox.showwarning("Edit Denied", "You have view access only for Schedule.")
            return

        activity_id = int(selected[0])
        activity = next((row for row in self.activities if int(row["id"]) == activity_id), None)
        if not activity:
            return

        popup = Toplevel(self)
        popup.title("Update Schedule Activity")
        popup.geometry("560x390")
        popup.configure(bg="#f0f4f8")
        popup.transient(self.winfo_toplevel())
        popup.grab_set()

        Label(popup, text="Update Activity Progress", bg="#f0f4f8", fg="#003087",
              font=("Arial", 16, "bold")).pack(pady=(18, 5))
        Label(popup, text=f"{activity.get('activity_code') or activity.get('activity_uid')} - {activity.get('activity_name')}",
              bg="#f0f4f8", fg="#333", font=("Arial", 10, "bold"),
              wraplength=500).pack(pady=(0, 18))

        form = Frame(popup, bg="#f0f4f8")
        form.pack(pady=8)

        Label(form, text="Actual Start:", bg="#f0f4f8", font=("Arial", 10, "bold")).grid(row=0, column=0, padx=8, pady=8, sticky=W)
        actual_start_var = StringVar(value=to_display_date(activity.get("actual_start")))
        Entry(form, textvariable=actual_start_var, width=18).grid(row=0, column=1, padx=8, pady=8)

        Label(form, text="Actual Finish:", bg="#f0f4f8", font=("Arial", 10, "bold")).grid(row=1, column=0, padx=8, pady=8, sticky=W)
        actual_finish_var = StringVar(value=to_display_date(activity.get("actual_finish")))
        Entry(form, textvariable=actual_finish_var, width=18).grid(row=1, column=1, padx=8, pady=8)

        Label(form, text="% Complete:", bg="#f0f4f8", font=("Arial", 10, "bold")).grid(row=2, column=0, padx=8, pady=8, sticky=W)
        percent_var = StringVar(value=str(activity.get("percent_complete") or 0))
        Entry(form, textvariable=percent_var, width=18).grid(row=2, column=1, padx=8, pady=8)
        Label(form, text="Date format: DD-MM-YY. Leave blank if not applicable.",
              bg="#f0f4f8", fg="#666666", font=("Arial", 9, "italic")).grid(row=3, column=0, columnspan=2, pady=(6, 0))

        def save_update():
            try:
                percent = float(percent_var.get() or 0)
            except ValueError:
                messagebox.showerror("Invalid Value", "% Complete must be numeric.")
                return
            if percent < 0 or percent > 100:
                messagebox.showerror("Invalid Value", "% Complete must be between 0 and 100.")
                return
            actual_start_text = actual_start_var.get().strip()
            actual_finish_text = actual_finish_var.get().strip()
            actual_start_storage = to_storage_date(actual_start_text) if actual_start_text else None
            actual_finish_storage = to_storage_date(actual_finish_text) if actual_finish_text else None
            if actual_start_text and not actual_start_storage:
                messagebox.showerror("Invalid Date", "Actual Start must be in DD-MM-YY format.")
                return
            if actual_finish_text and not actual_finish_storage:
                messagebox.showerror("Invalid Date", "Actual Finish must be in DD-MM-YY format.")
                return

            conn = get_db_connection()
            c = conn.cursor()
            c.execute(
                """
                UPDATE schedule_activities
                SET actual_start=%s, actual_finish=%s, percent_complete=%s
                WHERE id=%s
                """,
                (
                    actual_start_storage,
                    actual_finish_storage,
                    percent,
                    activity_id,
                ),
            )
            conn.commit()
            conn.close()
            popup.destroy()
            self.refresh_all()

        buttons = Frame(popup, bg="#f0f4f8")
        buttons.pack(pady=20)
        Button(buttons, text="Save Update", command=save_update,
               bg="#008000", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=8)
        Button(buttons, text="Cancel", command=popup.destroy,
               bg="#666666", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=8)
        normalize_buttons(popup)

    def open_column_popup(self):
        popup = Toplevel(self)
        popup.title("Show / Hide Schedule Columns")
        popup.geometry("520x600")
        popup.configure(bg="#f0f4f8")
        popup.transient(self.winfo_toplevel())
        popup.grab_set()

        Label(popup, text="Select Columns to Display", bg="#f0f4f8", fg="#003087",
              font=("Arial", 15, "bold")).pack(pady=12)

        canvas = Canvas(popup, bg="#f0f4f8", highlightthickness=0)
        scroll = ttk.Scrollbar(popup, orient=VERTICAL, command=canvas.yview)
        inner = Frame(canvas, bg="#f0f4f8")
        inner.bind("<Configure>", lambda _event: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side=LEFT, fill=BOTH, expand=True, padx=(16, 0), pady=8)
        scroll.pack(side=RIGHT, fill=Y, pady=8)

        vars_by_column = {}
        for index, column in enumerate(self.available_columns):
            var = BooleanVar(value=column in self.visible_columns)
            vars_by_column[column] = var
            label = self.COLUMN_LABELS.get(column, column).replace("\n", " ")
            Checkbutton(inner, text=label, variable=var, bg="#f0f4f8",
                        font=("Arial", 10)).grid(row=index, column=0, sticky=W, padx=12, pady=3)

        button_bar = Frame(popup, bg="#f0f4f8")
        button_bar.pack(fill=X, padx=16, pady=12)

        def apply_columns():
            selected = [column for column, var in vars_by_column.items() if var.get()]
            if not selected:
                messagebox.showwarning("Columns", "Please keep at least one column visible.")
                return
            self.visible_columns = selected
            popup.destroy()
            self.refresh_tree()

        def show_default():
            for column, var in vars_by_column.items():
                var.set(column in self.DEFAULT_VISIBLE_COLUMNS)

        def show_all():
            for var in vars_by_column.values():
                var.set(True)

        Button(button_bar, text="Apply", command=apply_columns,
               bg="#008000", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=5)
        Button(button_bar, text="Default", command=show_default,
               bg="#0066cc", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=5)
        Button(button_bar, text="Show All", command=show_all,
               bg="#7c3aed", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=5)
        Button(button_bar, text="Close", command=popup.destroy,
               bg="#666666", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=5)
        normalize_buttons(popup)

    def open_gantt_chart(self):
        if not self.activities:
            messagebox.showwarning("No Schedule", "Please upload a schedule first.")
            return

        date_range = self.get_gantt_date_range()
        if not date_range:
            messagebox.showwarning("Dates Missing", "No valid schedule dates are available to draw the Gantt chart.")
            return

        popup = Toplevel(self)
        popup.title("Gantt Chart - Critical Path Schedule")
        popup.geometry("1300x760")
        popup.configure(bg="#f0f4f8")
        popup.transient(self.winfo_toplevel())

        header = Frame(popup, bg="#003087", height=70)
        header.pack(fill=X)
        header.pack_propagate(False)
        Label(header, text="GANTT CHART", bg="#003087", fg="white",
              font=("Arial", 18, "bold")).pack(pady=(10, 0))
        Label(header, text="Blue = planned schedule | Red = critical path | Green = actual / progress",
              bg="#003087", fg="#dbeafe", font=("Arial", 10, "bold")).pack()

        chart_outer = Frame(popup, bg="#f0f4f8")
        chart_outer.pack(fill=BOTH, expand=True, padx=14, pady=12)
        chart_outer.grid_rowconfigure(0, weight=1)
        chart_outer.grid_columnconfigure(0, weight=1)

        canvas = Canvas(chart_outer, bg="white", highlightthickness=1, highlightbackground="#9ca3af")
        canvas.grid(row=0, column=0, sticky="nsew")
        yscroll = ttk.Scrollbar(chart_outer, orient=VERTICAL, command=canvas.yview)
        yscroll.grid(row=0, column=1, sticky="ns")
        xscroll = Scrollbar(chart_outer, orient=HORIZONTAL, command=canvas.xview, width=18)
        xscroll.grid(row=1, column=0, sticky="ew", pady=(4, 0))
        canvas.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)

        button_bar = Frame(popup, bg="#f0f4f8")
        button_bar.pack(fill=X, padx=14, pady=(0, 12))
        Button(button_bar, text="Refresh Chart", command=lambda: self.draw_gantt_chart(canvas, date_range),
               bg="#0066cc", fg="white", font=("Arial", 10, "bold")).pack(side=LEFT, padx=6)
        Button(button_bar, text="Close", command=popup.destroy,
               bg="#666666", fg="white", font=("Arial", 10, "bold")).pack(side=RIGHT, padx=6)

        self.draw_gantt_chart(canvas, date_range)
        normalize_buttons(popup)

    def get_gantt_date_range(self):
        dates = []
        for activity in self.activities:
            for column in ("start_date", "finish_date", "early_start", "early_finish", "actual_start", "actual_finish"):
                parsed = parse_app_date(activity.get(column))
                if parsed:
                    dates.append(parsed)
        if not dates:
            return None
        start = min(dates)
        finish = max(dates)
        return start, finish if finish >= start else start

    def draw_gantt_chart(self, canvas, date_range):
        canvas.delete("all")
        start_date, finish_date = date_range
        day_count = max(1, (finish_date - start_date).days + 1)

        left_width = 360
        top_height = 72
        row_height = 30
        bar_height = 14
        pixel_per_day = 4
        chart_width = max(900, day_count * pixel_per_day)
        chart_height = top_height + max(1, len(self.activities)) * row_height + 40
        total_width = left_width + chart_width + 80

        canvas.configure(scrollregion=(0, 0, total_width, chart_height))

        canvas.create_rectangle(0, 0, total_width, top_height, fill="#f8fafc", outline="")
        canvas.create_rectangle(0, 0, left_width, chart_height, fill="#f9fafb", outline="#d1d5db")
        canvas.create_text(14, 42, text="Activity", anchor=W, font=("Arial", 11, "bold"), fill="#003087")

        self.draw_gantt_month_grid(canvas, start_date, finish_date, left_width, top_height, chart_height, pixel_per_day)

        today = date.today()
        if start_date <= today <= finish_date:
            today_x = left_width + (today - start_date).days * pixel_per_day
            canvas.create_line(today_x, top_height, today_x, chart_height, fill="#111827", width=2, dash=(5, 4))
            canvas.create_text(today_x + 4, 18, text="Today", anchor=W, font=("Arial", 9, "bold"), fill="#111827")

        for index, activity in enumerate(self.activities):
            y1 = top_height + index * row_height
            y_mid = y1 + row_height // 2
            fill = "#ffffff" if index % 2 == 0 else "#f8fafc"
            canvas.create_rectangle(0, y1, total_width, y1 + row_height, fill=fill, outline="#e5e7eb")

            code = str(activity.get("activity_code") or activity.get("activity_uid") or "")
            name = str(activity.get("activity_name") or "")
            label = f"{code} - {name}" if code else name
            if len(label) > 62:
                label = label[:59] + "..."
            label_fill = "#b91c1c" if activity.get("is_critical") == "Y" else "#111827"
            canvas.create_text(14, y_mid, text=label, anchor=W, font=("Arial", 9, "bold"), fill=label_fill)

            planned_start = parse_app_date(activity.get("start_date")) or parse_app_date(activity.get("early_start"))
            planned_finish = parse_app_date(activity.get("finish_date")) or parse_app_date(activity.get("early_finish")) or planned_start
            if planned_start:
                self.draw_gantt_bar(
                    canvas,
                    planned_start,
                    planned_finish,
                    start_date,
                    left_width,
                    pixel_per_day,
                    y_mid - bar_height // 2,
                    y_mid + bar_height // 2,
                    "#dc2626" if activity.get("is_critical") == "Y" else "#2563eb",
                    "#991b1b" if activity.get("is_critical") == "Y" else "#1d4ed8",
                )

                percent = max(0, min(100, float(activity.get("percent_complete") or 0)))
                if percent > 0:
                    progress_finish = planned_start + timedelta(days=max(0, math.ceil(((planned_finish - planned_start).days or 1) * percent / 100)))
                    self.draw_gantt_bar(
                        canvas,
                        planned_start,
                        progress_finish,
                        start_date,
                        left_width,
                        pixel_per_day,
                        y_mid - 4,
                        y_mid + 4,
                        "#22c55e",
                        "#15803d",
                    )

            actual_start = parse_app_date(activity.get("actual_start"))
            actual_finish = parse_app_date(activity.get("actual_finish"))
            if actual_start:
                self.draw_gantt_bar(
                    canvas,
                    actual_start,
                    actual_finish or actual_start,
                    start_date,
                    left_width,
                    pixel_per_day,
                    y_mid + 7,
                    y_mid + 13,
                    "#16a34a",
                    "#166534",
                )

        canvas.create_line(left_width, 0, left_width, chart_height, fill="#9ca3af", width=2)

    def draw_gantt_month_grid(self, canvas, start_date, finish_date, left_width, top_height, chart_height, pixel_per_day):
        month_start = start_date.replace(day=1)
        if month_start < start_date:
            month_start = self.add_one_month(month_start)

        current = start_date.replace(day=1)
        while current <= finish_date:
            next_month = self.add_one_month(current)
            segment_start = max(current, start_date)
            segment_finish = min(next_month - timedelta(days=1), finish_date)
            x1 = left_width + (segment_start - start_date).days * pixel_per_day
            x2 = left_width + ((segment_finish - start_date).days + 1) * pixel_per_day
            canvas.create_rectangle(x1, 0, x2, top_height, fill="#fff7ed", outline="#f59e0b")
            canvas.create_text((x1 + x2) / 2, 24, text=current.strftime("%b-%y"), font=("Arial", 9, "bold"), fill="#7c2d12")
            canvas.create_line(x1, top_height, x1, chart_height, fill="#e5e7eb")
            current = next_month
        last_x = left_width + ((finish_date - start_date).days + 1) * pixel_per_day
        canvas.create_line(last_x, top_height, last_x, chart_height, fill="#e5e7eb")

    def draw_gantt_bar(self, canvas, start, finish, chart_start, left_width, pixel_per_day, y1, y2, fill, outline):
        if not start:
            return
        finish = finish or start
        if finish < start:
            finish = start
        x1 = left_width + max(0, (start - chart_start).days) * pixel_per_day
        x2 = left_width + max(1, ((finish - chart_start).days + 1)) * pixel_per_day
        canvas.create_rectangle(x1, y1, x2, y2, fill=fill, outline=outline)

    def add_one_month(self, value):
        year = value.year + (value.month // 12)
        month = value.month % 12 + 1
        return value.replace(year=year, month=month, day=1)

    def get_display_value(self, activity, column):
        if column in self.STANDARD_COLUMNS:
            value = activity.get(column)
        else:
            value = (activity.get("raw_data") or {}).get(column, "")
        if column in self.DATE_COLUMNS:
            return to_display_date(value)
        if column == "duration_days":
            return f"{float(value or 0):.2f}"
        if column == "percent_complete":
            return f"{float(value or 0):.2f}%"
        if column == "total_float":
            return f"{float(value or 0):.2f}"
        return "" if value is None else str(value)

    def first_value(self, data, *keys):
        for key in keys:
            value = data.get(key)
            if value not in (None, ""):
                return str(value).strip()
        return ""

    def first_date(self, data, *keys):
        for key in keys:
            value = data.get(key)
            parsed = self.parse_schedule_date(value)
            if parsed:
                return parsed.strftime("%Y-%m-%d")
        return ""

    def parse_schedule_date(self, value):
        if isinstance(value, (datetime, date)):
            return value.date() if isinstance(value, datetime) else value
        text = str(value or "").strip()
        if not text:
            return None
        text = text.replace("T", " ").replace("Z", "")
        parsed = parse_app_date(text)
        if parsed:
            return parsed
        for fmt in ("%Y-%m-%d %H:%M", "%m/%d/%Y", "%m/%d/%y", "%d-%b-%y", "%d-%b-%Y"):
            try:
                return datetime.strptime(text[:len(datetime.now().strftime(fmt))], fmt).date()
            except Exception:
                pass
        match = re.search(r"\d{4}-\d{2}-\d{2}", text)
        if match:
            return parse_app_date(match.group(0))
        return None

    def duration_to_days(self, value):
        text = str(value or "").strip()
        if not text:
            return 0
        iso_match = re.match(r"P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?)?", text)
        if iso_match and iso_match.group(0):
            days = float(iso_match.group(1) or 0)
            hours = float(iso_match.group(2) or 0)
            minutes = float(iso_match.group(3) or 0)
            return round(days + (hours / 8) + (minutes / 480), 2)
        try:
            number = float(re.sub(r"[^0-9.\-]", "", text))
        except ValueError:
            return 0
        return round(number / 8, 2) if number > 100 else round(number, 2)

    def hours_to_days(self, value):
        try:
            return round(float(str(value or "0").strip()) / 8, 2)
        except ValueError:
            return self.duration_to_days(value)

    def duration_from_dates(self, activity):
        start = parse_app_date(activity.get("start_date"))
        finish = parse_app_date(activity.get("finish_date"))
        if start and finish and finish >= start:
            return max(1, (finish - start).days)
        return 0

    def percent_value(self, value):
        text = str(value or "").strip()
        if not text:
            return 0
        try:
            number = float(text.replace("%", ""))
        except ValueError:
            return 0
        return round(number * 100, 2) if 0 < number <= 1 else round(number, 2)

    def child_text_map(self, elem):
        data = {}
        for child in list(elem):
            key = self.local_name(child.tag)
            text = (child.text or "").strip()
            if text:
                data[key] = text
        return data

    def local_name(self, tag):
        return str(tag).split("}", 1)[-1]

    def format_storage_date(self, value):
        if not value:
            return ""
        if isinstance(value, datetime):
            value = value.date()
        if isinstance(value, date):
            return value.strftime("%Y-%m-%d")
        return to_storage_date(value) or ""
