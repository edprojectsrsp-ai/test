from tkinter import *
from tkinter import ttk, messagebox
from database import get_db_connection
from utils import normalize_buttons, keep_window_active, to_display_date, to_storage_date, get_project_status
from datetime import datetime

class BillingScheduleWindow(Toplevel):
    def __init__(self, parent, project_id=None, uid=None, project_name=None, main_app=None):
        super().__init__(parent)
        self.project_id = project_id
        self.uid = uid
        self.project_name = project_name
        self.main_app = main_app

        self.title("Billing Schedule & PV / Consumption Monitoring Window")
        self.geometry("1860x980")
        self.configure(bg="#f0f4f8")
        self.grab_set()

        self.selected_milestone_id = None
        self.billing_rows = []
        self.projects_list = []
        self.summary_card_vars = {}

        self.build_ui()
        self.load_projects_dropdown()
        self.load_billing_data()
        normalize_buttons(self)
        keep_window_active(self)

    def build_ui(self):
        # ==================== HEADER ====================
        header = Frame(self, bg="#003087", height=84)
        header.pack(fill=X)
        header.pack_propagate(False)

        top_row = Frame(header, bg="#003087")
        top_row.pack(fill=X, pady=(8, 0))

        # Project Dropdown (Only Corporate AMR Ongoing)
        Label(top_row, text="Project", bg="#003087", fg="#dbeafe", font=("Arial", 10, "bold")).pack(side=LEFT, padx=(15, 5))
        self.project_combo = ttk.Combobox(top_row, width=38, state="readonly")
        self.project_combo.pack(side=LEFT, padx=5)
        self.project_combo.bind("<<ComboboxSelected>>", self.on_project_selected)

        # Package / LOA
        Label(top_row, text="Package / LOA", bg="#003087", fg="#dbeafe", font=("Arial", 10, "bold")).pack(side=LEFT, padx=(15, 5))
        self.package_combo = ttk.Combobox(top_row, values=["PKG-01"], width=12, state="readonly")
        self.package_combo.set("PKG-01")
        self.package_combo.pack(side=LEFT, padx=5)

        # Contractor Name (from Corporate AMR Master)
        Label(top_row, text="Contractor", bg="#003087", fg="#dbeafe", font=("Arial", 10, "bold")).pack(side=LEFT, padx=(15, 5))
        self.contractor_var = StringVar()
        Entry(top_row, textvariable=self.contractor_var, width=22, font=("Arial", 10), state="readonly").pack(side=LEFT, padx=5)

        # LOA No.
        Label(top_row, text="LOA No.", bg="#003087", fg="#dbeafe", font=("Arial", 10, "bold")).pack(side=LEFT, padx=(15, 5))
        self.loa_no_var = StringVar()
        Entry(top_row, textvariable=self.loa_no_var, width=22, font=("Arial", 10)).pack(side=LEFT, padx=5)

        # LOA Date
        Label(top_row, text="LOA Date", bg="#003087", fg="#dbeafe", font=("Arial", 10, "bold")).pack(side=LEFT, padx=(15, 5))
        self.loa_date_var = StringVar()
        Entry(top_row, textvariable=self.loa_date_var, width=14, font=("Arial", 10)).pack(side=LEFT, padx=5)

        # Project Manager (from Corporate AMR Master)
        Label(top_row, text="Project Manager", bg="#003087", fg="#dbeafe", font=("Arial", 10, "bold")).pack(side=LEFT, padx=(15, 5))
        self.project_manager_var = StringVar()
        Entry(top_row, textvariable=self.project_manager_var, width=20, font=("Arial", 10), state="readonly").pack(side=LEFT, padx=5)

        Button(top_row, text="🔄 Refresh", bg="#0066cc", fg="white", font=("Arial", 10, "bold"), width=10,
               command=self.load_billing_data).pack(side=RIGHT, padx=15)
        Button(top_row, text="🖨️", bg="#555", fg="white", font=("Arial", 10, "bold"), width=4).pack(side=RIGHT, padx=5)

        # ==================== SUMMARY CARDS ====================
        summary_bar = Frame(self, bg="#f1f5f9", height=95)
        summary_bar.pack(fill=X, padx=15, pady=(8, 0))
        summary_bar.pack_propagate(False)

        cards = [
            ("Contract Value (Basic)", "₹ 100.00 Cr", "#f6e4c3"),
            ("Billing Schedule Value", "₹ 100.00 Cr", "#c2f7d0"),
            ("Billed Till Date (Basic)", "₹ 62.45 Cr\n62.45 %", "#72efef"),
            ("Paid Till Date (Basic)", "₹ 48.10 Cr\n48.10 %", "#f6e4c3"),
            ("PV Claimed Till Date", "₹ 6.35 Cr", "#c2f7d0"),
            ("PV Paid Till Date", "₹ 4.35 Cr", "#72efef"),
            ("Balance Billing (Basic)", "₹ 37.55 Cr\n37.55 %", "#f6e4c3"),
            ("Consumption Status", "72.35 %\n(Actual vs Contract Qty)", "#c2f7d0"),
        ]

        card_keys = [
            "contract", "schedule", "billed", "paid", "pv_claimed", "pv_paid", "balance", "consumption"
        ]
        for idx, (title, value, color) in enumerate(cards):
            key = card_keys[idx]
            value_var = StringVar(value=value)
            self.summary_card_vars[key] = value_var
            box = Frame(summary_bar, bg=color, relief="solid", bd=1, width=210, height=75)
            box.pack(side=LEFT, padx=5, pady=8)
            box.pack_propagate(False)
            Label(box, text=title, bg=color, fg="#003087", font=("Arial", 9, "bold")).pack(pady=(4, 0))
            Label(box, textvariable=value_var, bg=color, fg="#1e40af", font=("Arial", 14, "bold"), justify=CENTER).pack()

        # ==================== TABS ====================
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=BOTH, expand=True, padx=15, pady=10)

        tab1 = Frame(self.notebook, bg="#f0f4f8")
        self.notebook.add(tab1, text="1. Billing Schedule")
        for tab_title in [
            "2. RA Bill Entry",
            "3. Consumption Monitoring",
            "4. Price Variation Calculation",
            "5. Dispatch Clearance / Supply Linkage",
            "6. Payment & Deduction Tracker",
            "7. Reports",
        ]:
            tab = Frame(self.notebook, bg="#f8fafc")
            self.notebook.add(tab, text=tab_title)
            Label(
                tab,
                text=f"{tab_title} data is linked with the selected billing milestone.",
                bg="#f8fafc",
                fg="#003087",
                font=("Arial", 14, "bold"),
            ).pack(pady=40)

        # Main Table
        table_frame = Frame(tab1, bg="#f8fafc", relief="solid", bd=1)
        table_frame.pack(fill=BOTH, expand=True, padx=5, pady=5)

        columns = ("Sl. No.", "Billing Milestone", "Linked Appendix-2 Activity", "Billing Type", 
                   "Weightage (%)", "Amount (₹)", "Planned Date", "Actual Date", "RA Bill No.", 
                   "Status", "Bill Due Date", "Overdue (Days)", "Remarks")

        self.tree = ttk.Treeview(table_frame, columns=columns, show="headings", height=12)
        for col in columns:
            self.tree.heading(col, text=col)
            width = 140 if col not in ["Billing Milestone", "Linked Appendix-2 Activity", "Remarks"] else 220
            self.tree.column(col, width=width, anchor="center" if col not in ["Billing Milestone", "Linked Appendix-2 Activity", "Remarks"] else "w")

        self.tree.pack(side=LEFT, fill=BOTH, expand=True)
        self.tree.bind("<<TreeviewSelect>>", self.on_milestone_select)

        y_scroll = ttk.Scrollbar(table_frame, orient="vertical", command=self.tree.yview)
        y_scroll.pack(side=RIGHT, fill=Y)
        self.tree.configure(yscrollcommand=y_scroll.set)

        # ==================== SELECTED MILESTONE DETAILS ====================
        details_frame = LabelFrame(tab1, text="Selected Milestone Details", bg="#f0f4f8", font=("Arial", 11, "bold"), fg="#003087")
        details_frame.pack(fill=X, padx=5, pady=5)

        # Left Panel
        left = Frame(details_frame, bg="#f0f4f8")
        left.pack(side=LEFT, fill=BOTH, expand=True, padx=8, pady=5)

        Label(left, text="Milestone", bg="#f0f4f8", font=("Arial", 10, "bold")).pack(anchor=W)
        self.milestone_info = Label(left, text="", bg="#f0f4f8", font=("Arial", 10), justify=LEFT)
        self.milestone_info.pack(anchor=W, pady=3)

        ra_frame = LabelFrame(left, text="RA Bills Linked to this Milestone", bg="#f0f4f8", font=("Arial", 9, "bold"))
        ra_frame.pack(fill=X, pady=5)
        self.ra_tree = ttk.Treeview(ra_frame, columns=("RA No", "Bill Date", "Basic Amount", "GST", "PV", "Retention", "Net Payable", "Status"), 
                                    show="headings", height=4)
        for col in self.ra_tree["columns"]:
            self.ra_tree.heading(col, text=col)
            self.ra_tree.column(col, width=90, anchor="center")
        self.ra_tree.pack(fill=X)

        pv_frame = LabelFrame(left, text="Price Variation Summary (For this Milestone)", bg="#f0f4f8", font=("Arial", 9, "bold"))
        pv_frame.pack(fill=X, pady=5)
        self.pv_tree = ttk.Treeview(pv_frame, columns=("PV Item", "Base Index", "Current Index", "PV %", "PV Amount"), 
                                    show="headings", height=3)
        for col in self.pv_tree["columns"]:
            self.pv_tree.heading(col, text=col)
            self.pv_tree.column(col, width=95, anchor="center")
        self.pv_tree.pack(fill=X)

        # Right Panel
        right = Frame(details_frame, bg="#f0f4f8")
        right.pack(side=LEFT, fill=BOTH, expand=True, padx=8, pady=5)

        cons_frame = LabelFrame(right, text="Consumption Summary (For this Milestone)", bg="#f0f4f8", font=("Arial", 9, "bold"))
        cons_frame.pack(fill=X, pady=3)
        self.cons_tree = ttk.Treeview(cons_frame, columns=("Item Code", "Material Description", "UOM", "Contract Qty", "Actual Consumed", "Balance Qty", "Consumption %"), 
                                      show="headings", height=4)
        for col in self.cons_tree["columns"]:
            self.cons_tree.heading(col, text=col)
            self.cons_tree.column(col, width=85, anchor="center")
        self.cons_tree.pack(fill=X)

        disp_frame = LabelFrame(right, text="Dispatch / Supply Status (For this Milestone)", bg="#f0f4f8", font=("Arial", 9, "bold"))
        disp_frame.pack(fill=X, pady=3)
        self.disp_tree = ttk.Treeview(disp_frame, columns=("Material / Equipment", "PO / Item", "Dispatch Clearance Date", "Site Receipt Date", "Status"), 
                                      show="headings", height=3)
        for col in self.disp_tree["columns"]:
            self.disp_tree.heading(col, text=col)
            self.disp_tree.column(col, width=110, anchor="center")
        self.disp_tree.pack(fill=X)

        pay_frame = LabelFrame(right, text="Payment Tracker (For this Milestone)", bg="#f0f4f8", font=("Arial", 9, "bold"))
        pay_frame.pack(fill=X, pady=3)
        self.pay_tree = ttk.Treeview(pay_frame, columns=("Bill No.", "Certified Amount", "GST", "PV", "Retention", "Net Paid", "Payment Date"), 
                                     show="headings", height=3)
        for col in self.pay_tree["columns"]:
            self.pay_tree.heading(col, text=col)
            self.pay_tree.column(col, width=95, anchor="center")
        self.pay_tree.pack(fill=X)

        # ==================== BOTTOM BUTTONS ====================
        btn_frame = Frame(self, bg="#f0f4f8")
        btn_frame.pack(fill=X, padx=15, pady=8)

        buttons = [
            ("➕ Add RA Bill", self.add_ra_bill, "#008000"),
            ("➕ Add Consumption", self.add_consumption, "#0f766e"),
            ("🧮 Calculate PV", self.calculate_pv, "#0066cc"),
            ("🔗 Link Dispatch", self.link_dispatch, "#7c3aed"),
            ("💰 Add Payment", self.add_payment, "#16a34a"),
            ("📄 View Documents", self.view_documents, "#555"),
            ("📜 Milestone History", self.milestone_history, "#c8102e"),
            ("❌ Close", self.destroy, "#555"),
        ]

        for text, cmd, color in buttons:
            Button(btn_frame, text=text, command=cmd, bg=color, fg="white", 
                   font=("Arial", 10, "bold"), width=16, height=1).pack(side=LEFT, padx=4)

    # ==================== LOAD PROJECTS (Corporate AMR + Ongoing Only) ====================
    def load_projects_dropdown(self):
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("""
            SELECT p.id, p.unique_id, p.project_name, p.contractor_name,
                   m.project_manager, m.executing_agency, p.loa_date
            FROM projects p
            LEFT JOIN corporate_amr_master m ON m.project_id = p.id
            WHERE p.project_type = 'Corporate AMR'
              AND COALESCE(p.project_dropped, 'N') <> 'Y'
              AND COALESCE(p.completion_marked, 'N') <> 'Y'
              AND COALESCE(p.commissioned_marked, 'N') <> 'Y'
            ORDER BY p.id DESC
        """)
        rows = c.fetchall()
        conn.close()

        self.projects_list = []
        values = []
        for row in rows:
            status = get_project_status(dict(row))
            if status == "Ongoing":
                label = f"{row['unique_id']} - {row['project_name']}"
                self.projects_list.append({
                    "id": row["id"],
                    "uid": row["unique_id"],
                    "name": row["project_name"],
                    "contractor": row.get("executing_agency") or row.get("contractor_name") or "",
                    "project_manager": row.get("project_manager") or "",
                    "loa_date": to_display_date(row.get("loa_date"))
                })
                values.append(label)

        self.project_combo["values"] = values

        # Auto-select if project_id passed
        if self.project_id:
            for proj in self.projects_list:
                if proj["id"] == self.project_id:
                    self.project_combo.set(f"{proj['uid']} - {proj['name']}")
                    self.fill_project_details(proj)
                    break

    def on_project_selected(self, event=None):
        selected = self.project_combo.get()
        for proj in self.projects_list:
            if f"{proj['uid']} - {proj['name']}" == selected:
                self.project_id = proj["id"]
                self.uid = proj["uid"]
                self.project_name = proj["name"]
                self.fill_project_details(proj)
                self.load_billing_data()
                break

    def fill_project_details(self, proj):
        self.contractor_var.set(proj.get("contractor", ""))
        self.project_manager_var.set(proj.get("project_manager", ""))
        self.loa_date_var.set(proj.get("loa_date", ""))
        # You can also set LOA No. from master if stored

    def safe_float(self, value):
        try:
            text = str(value if value is not None else "").replace(",", "").strip()
            return float(text) if text else 0.0
        except (TypeError, ValueError):
            return 0.0

    def format_money(self, value):
        return f"Rs {self.safe_float(value):,.2f}"

    def format_cr(self, value):
        return f"Rs {self.safe_float(value) / 10000000:,.2f} Cr"

    def format_percent(self, numerator, denominator):
        total = self.safe_float(denominator)
        if total <= 0:
            return "0.00 %"
        return f"{(self.safe_float(numerator) / total) * 100:,.2f} %"

    def linked_activity_label(self, row):
        appendix_id = row.get("appendix2_id")
        source = row.get("milestone_source") or "Manual"
        if appendix_id:
            return f"A2-{int(appendix_id):03d} | {source}"
        return f"Manual | {source}"

    def due_date_for_row(self, row):
        return row.get("received_date") or row.get("billed_date") or row.get("scheduled_date") or row.get("schedule_finish")

    def overdue_days(self, row):
        if self.safe_float(row.get("received_amount")) >= self.safe_float(row.get("scheduled_amount")) > 0:
            return "-"
        due_date = row.get("scheduled_date") or row.get("schedule_finish")
        if not due_date:
            return "-"
        try:
            due = datetime.strptime(str(due_date)[:10], "%Y-%m-%d")
            days = (datetime.today() - due).days
            return days if days > 0 else "-"
        except ValueError:
            return "-"

    def sync_summary_cards(self):
        rows = self.billing_rows or []
        scheduled = sum(self.safe_float(row.get("scheduled_amount")) for row in rows)
        billed = sum(self.safe_float(row.get("billed_amount")) for row in rows)
        paid = sum(self.safe_float(row.get("received_amount")) for row in rows)
        pv_claimed = billed * 0.06
        pv_paid = paid * 0.06
        balance = max(0, scheduled - billed)
        consumption_pct = self.format_percent(paid, scheduled)
        values = {
            "contract": self.format_cr(scheduled),
            "schedule": self.format_cr(scheduled),
            "billed": f"{self.format_cr(billed)}\n{self.format_percent(billed, scheduled)}",
            "paid": f"{self.format_cr(paid)}\n{self.format_percent(paid, scheduled)}",
            "pv_claimed": self.format_cr(pv_claimed),
            "pv_paid": self.format_cr(pv_paid),
            "balance": f"{self.format_cr(balance)}\n{self.format_percent(balance, scheduled)}",
            "consumption": f"{consumption_pct}\n(Actual vs Contract Qty)",
        }
        for key, value in values.items():
            if key in self.summary_card_vars:
                self.summary_card_vars[key].set(value)

    # ==================== LOAD BILLING DATA ====================
    def load_billing_data(self):
        if not self.project_id:
            self.billing_rows = []
            self.sync_summary_cards()
            return

        for item in self.tree.get_children():
            self.tree.delete(item)

        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM billing_schedule WHERE project_id = %s ORDER BY milestone_no", (self.project_id,))
        self.billing_rows = c.fetchall()
        conn.close()

        total_weight = 0
        total_scheduled = 0
        for idx, row in enumerate(self.billing_rows, start=1):
            status = self.calculate_status(row)
            total_weight += self.safe_float(row.get("weightage_percent"))
            total_scheduled += self.safe_float(row.get("scheduled_amount"))
            milestone_no = int(row.get("milestone_no") or idx)
            self.tree.insert("", END, iid=row["id"], values=(
                idx,
                row.get("description") or "",
                self.linked_activity_label(row),
                row.get("milestone_type") or "Physical",
                f"{self.safe_float(row.get('weightage_percent')):.2f}",
                self.format_money(row.get("scheduled_amount")),
                to_display_date(row.get("scheduled_date") or row.get("schedule_finish")),
                to_display_date(row.get("billed_date")),
                f"RA-{milestone_no:03d}" if self.safe_float(row.get("billed_amount")) > 0 else "-",
                status,
                to_display_date(self.due_date_for_row(row)),
                self.overdue_days(row),
                row.get("remarks") or ""
            ))
        self.tree.insert("", END, iid="total", values=(
            "", "Total", "", "", f"{total_weight:.2f}", self.format_money(total_scheduled),
            "", "", "", "", "", "", ""
        ))
        self.sync_summary_cards()
        return

        for row in self.billing_rows:
            status = self.calculate_status(row)
            self.tree.insert("", END, iid=row["id"], values=(
                row["milestone_no"],
                row["description"],
                row.get("linked_appendix2", "A2-02 | Equipment Supply"),
                row.get("billing_type", "Supply"),
                f"{row.get('weightage_percent', 20):.2f}",
                f"₹ {float(row['scheduled_amount'] or 0):,.2f}",
                to_display_date(row["scheduled_date"]),
                to_display_date(row["actual_date"]),
                row.get("ra_bill_no", ""),
                status,
                to_display_date(row["bill_due_date"]),
                row.get("overdue_days", ""),
                row.get("remarks", "")
            ))

    def calculate_status(self, row):
        received = self.safe_float(row.get("received_amount"))
        billed = self.safe_float(row.get("billed_amount"))
        scheduled = self.safe_float(row.get("scheduled_amount"))
        if received >= scheduled > 0:
            return "Paid"
        elif billed > 0:
            return "Due"
        return "Upcoming"

    def on_milestone_select(self, event):
        selected = self.tree.selection()
        if not selected:
            return
        if selected[0] == "total":
            return
        self.selected_milestone_id = int(selected[0])
        self.update_selected_milestone_details()

    def update_selected_milestone_details(self):
        if not self.selected_milestone_id:
            return

        row = next((r for r in self.billing_rows if r["id"] == self.selected_milestone_id), None)
        if not row:
            return

        self.milestone_info.config(text=f"{row['description']}\nA2-02 | Equipment Supply\nWeightage: {row.get('weightage_percent', 20)}%\nAmount: ₹ {float(row['scheduled_amount'] or 0):,.2f}\nPlanned: {to_display_date(row['scheduled_date'])}\nStatus: {self.calculate_status(row)}")

        self.populate_sub_tables(row)

    def populate_sub_tables(self, row):
        for tree in [self.ra_tree, self.pv_tree, self.cons_tree, self.disp_tree, self.pay_tree]:
            for item in tree.get_children():
                tree.delete(item)

        milestone_no = int(row.get("milestone_no") or 1)
        billed = self.safe_float(row.get("billed_amount"))
        paid = self.safe_float(row.get("received_amount"))
        gst = billed * 0.18
        pv = billed * 0.06
        retention = billed * 0.05
        payment_status = "Paid" if paid > 0 else self.calculate_status(row)

        if billed > 0 or paid > 0:
            self.ra_tree.insert("", END, values=(
                f"RA-{milestone_no:03d}",
                to_display_date(row.get("billed_date")) or "-",
                self.format_money(billed),
                self.format_money(gst),
                self.format_money(pv),
                self.format_money(retention),
                self.format_money(paid or max(0, billed + gst + pv - retention)),
                payment_status,
            ))
            self.pay_tree.insert("", END, values=(
                f"RA-{milestone_no:03d}",
                self.format_money(billed),
                self.format_money(gst),
                self.format_money(pv),
                self.format_money(retention),
                self.format_money(paid),
                to_display_date(row.get("received_date")) or "-",
            ))

        for component, percent in [("Steel", 0.030), ("Copper", 0.020), ("Aluminium", 0.010)]:
            self.pv_tree.insert("", END, values=(
                component, "100.00", "106.00", "100.00%", self.format_money(billed * percent)
            ))

        description = row.get("description") or "Billing Milestone"
        scheduled = self.safe_float(row.get("scheduled_amount"))
        consumed = min(scheduled, paid or billed)
        balance = max(0, scheduled - consumed)
        self.cons_tree.insert("", END, values=(
            f"IT-{milestone_no:03d}",
            description,
            "Nos",
            self.format_money(scheduled),
            self.format_money(consumed),
            self.format_money(balance),
            self.format_percent(consumed, scheduled),
        ))
        self.disp_tree.insert("", END, values=(
            description,
            f"PO-{milestone_no:03d}",
            to_display_date(row.get("dispatch_clearance")) or "-",
            to_display_date(row.get("site_receipt_clearance")) or "-",
            "Received" if row.get("site_receipt_clearance") else "Pending",
        ))
        return

        # Sample data - replace with real queries from your DB
        self.ra_tree.insert("", END, values=("RA-004", "25-May-2023", "8,00,00,000", "1,44,00,000", "80,00,000", "40,00,000", "8,84,00,000", "Paid"))
        self.ra_tree.insert("", END, values=("RA-005", "28-Jun-2023", "12,00,00,000", "2,16,00,000", "1,20,00,000", "60,00,000", "13,76,00,000", "Paid"))

        self.pv_tree.insert("", END, values=("Steel", "135.40", "152.60", "100.00%", "72,60,000"))
        self.pv_tree.insert("", END, values=("Copper", "694.50", "815.20", "100.00%", "38,40,000"))
        self.pv_tree.insert("", END, values=("Aluminium", "210.30", "246.80", "100.00%", "9,00,000"))

        self.cons_tree.insert("", END, values=("ST-001", "Structural Steel", "MT", "1,000.000", "760.250", "239.750", "76.03%"))
        self.cons_tree.insert("", END, values=("CU-001", "Copper Conductor", "MT", "120.000", "98.400", "21.600", "82.00%"))

        self.disp_tree.insert("", END, values=("Power Transformer 315 MVA", "PO-123/10", "15-Mar-2023", "02-Apr-2023", "Received"))
        self.disp_tree.insert("", END, values=("Circuit Breaker 245kV", "PO-124/20", "20-Mar-2023", "05-May-2023", "Received"))

        self.pay_tree.insert("", END, values=("RA-004", "8,00,00,000", "1,44,00,000", "80,00,000", "40,00,000", "8,84,00,000", "18-May-2023"))
        self.pay_tree.insert("", END, values=("RA-005", "12,00,00,000", "2,16,00,000", "1,20,00,000", "60,00,000", "13,76,00,000", "05-Jul-2023"))

    # ==================== BUTTON ACTIONS ====================
    def add_ra_bill(self):
        messagebox.showinfo("Add RA Bill", "RA Bill entry form will open here")

    def add_consumption(self):
        messagebox.showinfo("Add Consumption", "Consumption entry form will open here")

    def calculate_pv(self):
        messagebox.showinfo("Calculate PV", "Price Variation calculation triggered")

    def link_dispatch(self):
        messagebox.showinfo("Link Dispatch", "Dispatch linkage form will open")

    def add_payment(self):
        messagebox.showinfo("Add Payment", "Payment entry form will open")

    def view_documents(self):
        messagebox.showinfo("View Documents", "Document viewer will open")

    def milestone_history(self):
        messagebox.showinfo("Milestone History", "History log will be shown")


# ==================== HOW TO OPEN ====================
# From your main application:
# BillingScheduleWindow(self, project_id=123, main_app=self)
