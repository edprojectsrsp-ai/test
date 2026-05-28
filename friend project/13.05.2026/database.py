import json
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from calendar import monthrange
from datetime import datetime, date
import hashlib

APP_MODULES = [
    ("registration", "Project Registration"),
    ("project_details", "Project Details"),
    ("ongoing", "Ongoing Projects"),
    ("daily_progress", "Daily Progress Report"),
    ("capex", "CAPEX"),
    ("billing_schedule", "Billing Schedule"),
    ("scurve_expected_finish", "S-Curve Expected Finish Edit"),
    ("dashboard", "Dashboard"),
    ("reports", "Reports"),
    ("schedule", "Schedule"),
    ("repository", "Repository"),
    ("local_ai", "Local AI Assistant"),
]

CAPEX_SAVE_PATH = os.path.join(os.path.expanduser("~"), "Documents", "New project", "capex_saved_data.json")

def get_db_connection():
    conn = psycopg2.connect(
        host=os.getenv("PROJECT_BRAIN_DB_HOST", "localhost"),
        port=os.getenv("PROJECT_BRAIN_DB_PORT", "5432"),
        dbname=os.getenv("PROJECT_BRAIN_DB_NAME", "project_brain"),
        user=os.getenv("PROJECT_BRAIN_DB_USER", "postgres"),
        password=os.getenv("PROJECT_BRAIN_DB_PASSWORD", "Zxc@2211"),
        cursor_factory=RealDictCursor
    )
    return conn

def init_db():
    conn = get_db_connection()
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        unique_id TEXT UNIQUE NOT NULL,
        project_type TEXT NOT NULL,
        project_name TEXT NOT NULL,
        registration_date TEXT,
        project_dropped TEXT DEFAULT 'N',
        project_archived TEXT DEFAULT 'N',
        completion_marked TEXT DEFAULT 'N',
        completion_date TEXT,
        commissioned_marked TEXT DEFAULT 'N',
        commissioned_date TEXT,
        dic_recommendation_date TEXT,
        cod_date TEXT,
        cod_cleared TEXT DEFAULT 'N',
        stage1_date TEXT,
        stage1_cost REAL,
        stage1_cleared TEXT DEFAULT 'N',
        expected_tod_date TEXT,
        final_tod_date TEXT,
        tender_cancelled TEXT DEFAULT 'N',
        retender_expected_date TEXT,
        retender_final_date TEXT,
        contractor_name TEXT,
        loa_date TEXT,
        effective_date TEXT,
        schedule_months INTEGER,
        schedule_completion TEXT,
        stage2_date TEXT,
        stage2_cost REAL,
        stage2_cleared TEXT DEFAULT 'N'
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS appendix2 (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        s_no TEXT,
        category TEXT,
        item TEXT,
        commencement_months INTEGER,
        completion_months INTEGER,
        schedule_start TEXT,
        schedule_finish TEXT
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS tods (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        tod_number INTEGER,
        tod_date TEXT
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS activities (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        activity_type TEXT,
        uom TEXT,
        scope_qty REAL,
        weight_percent REAL DEFAULT 10,
        start_date TEXT,
        finish_date TEXT
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS monthly_plans (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        activity_type TEXT,
        month TEXT,
        planned_qty REAL,
        row_type TEXT
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS daily_actuals (
        id SERIAL PRIMARY KEY,
        activity_id INTEGER REFERENCES activities(id),
        actual_date TEXT,
        actual_qty REAL
    )''')
    
    # ==================== NEW CODE FOR MULTI-PLAN SUPPORT ====================
    c.execute('''CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        plan_name TEXT NOT NULL,
        financial_year TEXT,
        plan_version TEXT,
        is_active TEXT DEFAULT 'N',
        is_locked TEXT DEFAULT 'Y'
    )''')

    def ensure_column(table_name, column_name, column_type):
        c.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = %s
              AND column_name = %s
            """,
            (table_name, column_name),
        )
        if c.fetchone():
            return
        c.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}")

    ensure_column("activities", "plan_name", "TEXT")
    ensure_column("activities", "weight_percent", "REAL DEFAULT 10")
    ensure_column("activities", "actuals_till_last_fy", "REAL DEFAULT 0")
    ensure_column("activities", "expected_finish", "TEXT")
    ensure_column("monthly_plans", "plan_name", "TEXT")
    ensure_column("daily_actuals", "area_of_work", "TEXT")
    ensure_column("daily_progress_manpower", "month_target", "TEXT")
    ensure_column("daily_progress_manpower", "last_month_average", "REAL DEFAULT 0")
    ensure_column("daily_progress_manpower", "remarks", "TEXT")
    ensure_column("plans", "financial_year", "TEXT")
    ensure_column("plans", "plan_version", "TEXT")
    ensure_column("plans", "is_active", "TEXT DEFAULT 'N'")
    ensure_column("plans", "is_locked", "TEXT DEFAULT 'Y'")
    ensure_column("appendix2", "schedule_start", "TEXT")
    ensure_column("appendix2", "schedule_finish", "TEXT")
    ensure_column("projects", "completion_marked", "TEXT DEFAULT 'N'")
    ensure_column("projects", "completion_date", "TEXT")
    ensure_column("projects", "commissioned_marked", "TEXT DEFAULT 'N'")
    ensure_column("projects", "commissioned_date", "TEXT")
    ensure_column("projects", "expected_finish", "TEXT")
    ensure_column("projects", "project_dropped", "TEXT DEFAULT 'N'")
    ensure_column("projects", "project_archived", "TEXT DEFAULT 'N'")
    ensure_column("projects", "parent_project_id", "INTEGER")
    # ========================================================================

    # ==================== APPROVAL WORKFLOW FIELDS ====================
    c.execute('''CREATE TABLE IF NOT EXISTS project_approval_fields (
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
    )''')
    ensure_column("project_approval_fields", "stage_key", "TEXT")
    ensure_column("project_approval_fields", "stage_name", "TEXT")
    ensure_column("project_approval_fields", "step_no", "TEXT")
    ensure_column("project_approval_fields", "step_key", "TEXT")
    ensure_column("project_approval_fields", "step_name", "TEXT")
    ensure_column("project_approval_fields", "responsible_agency", "TEXT")
    ensure_column("project_approval_fields", "data_field", "TEXT")
    ensure_column("project_approval_fields", "field_value", "TEXT")
    ensure_column("project_approval_fields", "updated_at", "TEXT")

    c.execute('''CREATE TABLE IF NOT EXISTS project_approval_field_history (
        id SERIAL PRIMARY KEY,
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
        revert_to_stage TEXT,
        revert_remark TEXT,
        revision_no INTEGER,
        archived_at TEXT
    )''')
    ensure_column("project_approval_field_history", "project_id", "INTEGER")
    ensure_column("project_approval_field_history", "field_key", "TEXT")
    ensure_column("project_approval_field_history", "stage_key", "TEXT")
    ensure_column("project_approval_field_history", "stage_name", "TEXT")
    ensure_column("project_approval_field_history", "step_no", "TEXT")
    ensure_column("project_approval_field_history", "step_key", "TEXT")
    ensure_column("project_approval_field_history", "step_name", "TEXT")
    ensure_column("project_approval_field_history", "responsible_agency", "TEXT")
    ensure_column("project_approval_field_history", "data_field", "TEXT")
    ensure_column("project_approval_field_history", "field_value", "TEXT")
    ensure_column("project_approval_field_history", "revert_to_stage", "TEXT")
    ensure_column("project_approval_field_history", "revert_remark", "TEXT")
    ensure_column("project_approval_field_history", "revision_no", "INTEGER")
    ensure_column("project_approval_field_history", "archived_at", "TEXT")

    c.execute('''CREATE TABLE IF NOT EXISTS corporate_amr_master (
        project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        project_manager TEXT,
        executing_agency TEXT,
        expenditure_upto_last_fy REAL,
        be_re_current_fy REAL,
        actual_cost_current_fy REAL,
        cumulative_cost REAL,
        tender_publish TEXT,
        contract_signing TEXT,
        expected_completion_date TEXT,
        status_override TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    ensure_column("corporate_amr_master", "project_manager", "TEXT")
    ensure_column("corporate_amr_master", "executing_agency", "TEXT")
    ensure_column("corporate_amr_master", "expenditure_upto_last_fy", "REAL")
    ensure_column("corporate_amr_master", "be_re_current_fy", "REAL")
    ensure_column("corporate_amr_master", "actual_cost_current_fy", "REAL")
    ensure_column("corporate_amr_master", "cumulative_cost", "REAL")
    ensure_column("corporate_amr_master", "tender_publish", "TEXT")
    ensure_column("corporate_amr_master", "contract_signing", "TEXT")
    ensure_column("corporate_amr_master", "expected_completion_date", "TEXT")
    ensure_column("corporate_amr_master", "status_override", "TEXT")
    ensure_column("corporate_amr_master", "updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

    c.execute('''CREATE TABLE IF NOT EXISTS corporate_amr_tender_openings (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        opening_date TEXT,
        remarks TEXT,
        created_at TEXT,
        updated_at TEXT
    )''')
    ensure_column("corporate_amr_tender_openings", "project_id", "INTEGER")
    ensure_column("corporate_amr_tender_openings", "opening_date", "TEXT")
    ensure_column("corporate_amr_tender_openings", "remarks", "TEXT")
    ensure_column("corporate_amr_tender_openings", "created_at", "TEXT")
    ensure_column("corporate_amr_tender_openings", "updated_at", "TEXT")
    # =================================================================

    # ==================== DAILY PROGRESS REPORT TABLE (NEW - For Manpower + Construction Progress) ====================
    c.execute('''CREATE TABLE IF NOT EXISTS daily_progress (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        report_date DATE NOT NULL,
        rsp_executive INTEGER DEFAULT 0,
        rsp_non_executive INTEGER DEFAULT 0,
        executing_agency INTEGER DEFAULT 0,
        labour_deployed INTEGER DEFAULT 0,
        supervisor INTEGER DEFAULT 0,
        design_engineering INTEGER DEFAULT 0,
        civil INTEGER DEFAULT 0,
        structural_supply INTEGER DEFAULT 0,
        structural_erection INTEGER DEFAULT 0,
        equipment_supply INTEGER DEFAULT 0,
        equipment_erection INTEGER DEFAULT 0,
        UNIQUE(project_id, report_date)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS daily_progress_manpower (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id),
        report_date DATE NOT NULL,
        section_name TEXT NOT NULL,
        category_name TEXT,
        contractor_name TEXT,
        role_name TEXT,
        qty INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0
    )''')
    # ========================================================================

    # ==================== PLANT LEVEL AMR TRACKING ====================
    c.execute('''CREATE TABLE IF NOT EXISTS plant_level_amr_details (
        project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        sl_no TEXT,
        at_no TEXT,
        at_date TEXT,
        department TEXT,
        executing_agency TEXT,
        schedule_start TEXT,
        schedule_completion TEXT,
        anticipated_completion TEXT,
        remarks TEXT,
        physical_progress REAL,
        gross_cost REAL,
        capex_till_last_fy REAL,
        be_amount REAL,
        re_amount REAL,
        monthly_values TEXT DEFAULT '{}'
    )''')
    # ========================================================================

    # ==================== LOGIN + USER RIGHTS ====================
    c.execute('''CREATE TABLE IF NOT EXISTS app_users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS user_permissions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
        module_key TEXT NOT NULL,
        can_access BOOLEAN NOT NULL DEFAULT FALSE,
        can_edit BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE(user_id, module_key)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS user_projects (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(user_id, project_id)
    )''')

    # ==================== SCHEDULE / CPM ENGINE ====================
    c.execute('''CREATE TABLE IF NOT EXISTS schedule_imports (
        id SERIAL PRIMARY KEY,
        file_name TEXT NOT NULL,
        imported_at TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS schedule_activities (
        id SERIAL PRIMARY KEY,
        schedule_id INTEGER REFERENCES schedule_imports(id) ON DELETE CASCADE,
        activity_uid TEXT,
        activity_code TEXT,
        activity_name TEXT,
        wbs TEXT,
        duration_days REAL DEFAULT 0,
        start_date TEXT,
        finish_date TEXT,
        actual_start TEXT,
        actual_finish TEXT,
        percent_complete REAL DEFAULT 0,
        predecessors TEXT,
        successors TEXT,
        early_start TEXT,
        early_finish TEXT,
        late_start TEXT,
        late_finish TEXT,
        total_float REAL DEFAULT 0,
        is_critical TEXT DEFAULT 'N',
        raw_data TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS billing_schedule (
        id SERIAL PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        milestone_no INTEGER,
        description TEXT,
        milestone_type TEXT DEFAULT 'Physical',
        weightage_percent REAL DEFAULT 0,
        schedule_start TEXT,
        schedule_finish TEXT,
        scheduled_amount REAL DEFAULT 0,
        scheduled_date TEXT,
        billed_amount REAL DEFAULT 0,
        billed_date TEXT,
        received_amount REAL DEFAULT 0,
        received_date TEXT,
        remarks TEXT,
        manufacturing_clearance TEXT,
        inspection_clearance TEXT,
        dispatch_clearance TEXT,
        site_receipt_clearance TEXT,
        approval_clearance TEXT,
        appendix2_id INTEGER,
        milestone_source TEXT DEFAULT 'Manual'
    )''')
    ensure_column("billing_schedule", "schedule_start", "TEXT")
    ensure_column("billing_schedule", "schedule_finish", "TEXT")
    ensure_column("billing_schedule", "milestone_type", "TEXT DEFAULT 'Physical'")
    ensure_column("billing_schedule", "weightage_percent", "REAL DEFAULT 0")
    ensure_column("billing_schedule", "site_receipt_clearance", "TEXT")
    ensure_column("billing_schedule", "appendix2_id", "INTEGER")
    ensure_column("billing_schedule", "milestone_source", "TEXT DEFAULT 'Manual'")
    # ================================================================

    admin_hash = hash_password("admin123")
    c.execute("SELECT id FROM app_users WHERE username=%s", ("admin",))
    admin = c.fetchone()
    if not admin:
        c.execute("""
            INSERT INTO app_users (username, password_hash, role, active, created_at)
            VALUES (%s, %s, %s, TRUE, %s)
            RETURNING id
        """, ("admin", admin_hash, "admin", datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
        admin_id = c.fetchone()["id"]
    else:
        admin_id = admin["id"]

    for module_key, _ in APP_MODULES:
        c.execute("""
            INSERT INTO user_permissions (user_id, module_key, can_access, can_edit)
            VALUES (%s, %s, TRUE, TRUE)
            ON CONFLICT (user_id, module_key)
            DO UPDATE SET can_access=TRUE, can_edit=TRUE
        """, (admin_id, module_key))
    # =============================================================

    conn.commit()
    conn.close()
    print("PostgreSQL Database initialized successfully!")

def hash_password(password):
    return hashlib.sha256(str(password or "").strip().encode("utf-8")).hexdigest()

def authenticate_user(username, password):
    username = str(username or "").strip()
    password = str(password or "").strip()
    if not username or not password:
        return None
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT id, username, role, active
        FROM app_users
        WHERE LOWER(username)=LOWER(%s) AND password_hash=%s
    """, (username.strip(), hash_password(password)))
    user = c.fetchone()
    conn.close()
    if not user or not user["active"]:
        return None
    user = dict(user)
    user["role"] = str(user.get("role") or "user").strip().lower()
    if user["role"] != "admin":
        user["role"] = "user"
    user["permissions"] = complete_user_permissions(user["id"], user["role"])
    user["projectIds"] = list(get_user_project_ids(user["id"]))
    return user

def get_user_permissions(user_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT module_key, can_access, can_edit
        FROM user_permissions
        WHERE user_id=%s
    """, (user_id,))
    rows = c.fetchall()
    conn.close()
    return {r["module_key"]: {"access": bool(r["can_access"]), "edit": bool(r["can_edit"])} for r in rows}

def complete_user_permissions(user_id, role="user"):
    permissions = get_user_permissions(user_id)
    is_admin = str(role or "").strip().lower() == "admin"
    for module_key, _ in APP_MODULES:
        if is_admin:
            permissions[module_key] = {"access": True, "edit": True}
        else:
            permissions.setdefault(module_key, {"access": False, "edit": False})
    return permissions

def get_user_project_ids(user_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT project_id FROM user_projects WHERE user_id=%s", (user_id,))
    rows = c.fetchall()
    conn.close()
    return {int(r["project_id"]) for r in rows}

def get_all_users():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT id, username, role, active FROM app_users ORDER BY username")
    users = c.fetchall()
    conn.close()
    return users

def save_user_projects(user_id, project_ids):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("DELETE FROM user_projects WHERE user_id=%s", (user_id,))
    for project_id in project_ids:
        c.execute("""
            INSERT INTO user_projects (user_id, project_id)
            VALUES (%s, %s)
            ON CONFLICT (user_id, project_id) DO NOTHING
        """, (user_id, int(project_id)))
    conn.commit()
    conn.close()

def get_all_project_choices():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute(
        """
        SELECT id, unique_id, project_name, project_type
        FROM projects
        WHERE COALESCE(project_archived, 'N') <> 'Y'
        ORDER BY id DESC
        """
    )
    projects = c.fetchall()
    conn.close()
    return projects

def save_user(username, password, role, active, user_id=None):
    username = str(username or "").strip()
    password = str(password or "").strip()
    role = str(role or "user").strip().lower()
    conn = get_db_connection()
    c = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if user_id:
        if password:
            c.execute("""
                UPDATE app_users
                SET username=%s, password_hash=%s, role=%s, active=%s
                WHERE id=%s
            """, (username, hash_password(password), role, active, user_id))
        else:
            c.execute("""
                UPDATE app_users
                SET username=%s, role=%s, active=%s
                WHERE id=%s
            """, (username, role, active, user_id))
    else:
        c.execute("""
            INSERT INTO app_users (username, password_hash, role, active, created_at)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (username, hash_password(password), role, active, now))
        user_id = c.fetchone()["id"]
        for module_key, _ in APP_MODULES:
            c.execute("""
                INSERT INTO user_permissions (user_id, module_key, can_access, can_edit)
                VALUES (%s, %s, FALSE, FALSE)
                ON CONFLICT (user_id, module_key) DO NOTHING
            """, (user_id, module_key))
    conn.commit()
    conn.close()
    return user_id

def save_user_permissions(user_id, permissions):
    conn = get_db_connection()
    c = conn.cursor()
    for module_key, rights in permissions.items():
        c.execute("""
            INSERT INTO user_permissions (user_id, module_key, can_access, can_edit)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (user_id, module_key)
            DO UPDATE SET can_access=EXCLUDED.can_access, can_edit=EXCLUDED.can_edit
        """, (user_id, module_key, bool(rights.get("access")), bool(rights.get("edit"))))
    conn.commit()
    conn.close()

def add_project(unique_id, project_type, project_name):
    conn = get_db_connection()
    c = conn.cursor()
    date = datetime.now().strftime("%Y-%m-%d")
    c.execute("INSERT INTO projects (unique_id, project_type, project_name, registration_date) VALUES (%s, %s, %s, %s) RETURNING id", 
              (unique_id, project_type, project_name, date))
    project_id = c.fetchone()["id"]
    conn.commit()
    conn.close()
    return project_id

def add_child_project(parent_project_id, unique_id, project_name, stage2_gross_cost=None):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM projects WHERE id=%s", (parent_project_id,))
    parent = c.fetchone()
    if not parent:
        conn.close()
        raise ValueError("Selected parent project was not found.")

    registration_date = datetime.now().strftime("%Y-%m-%d")
    c.execute("""
        INSERT INTO projects (
            unique_id,
            project_type,
            project_name,
            registration_date,
            parent_project_id,
            dic_recommendation_date,
            cod_date,
            cod_cleared,
            stage1_date,
            stage1_cost,
            stage1_cleared,
            expected_tod_date,
            final_tod_date,
            tender_cancelled,
            retender_expected_date,
            retender_final_date,
            contractor_name,
            loa_date,
            effective_date,
            schedule_months,
            schedule_completion,
            stage2_date,
            stage2_cost,
            stage2_cleared,
            project_dropped,
            completion_marked,
            completion_date,
            commissioned_marked,
            commissioned_date
        )
        VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s, %s
        )
        RETURNING id
    """, (
        unique_id,
        parent.get("project_type"),
        project_name,
        registration_date,
        int(parent_project_id),
        parent.get("dic_recommendation_date"),
        parent.get("cod_date"),
        parent.get("cod_cleared") or "N",
        parent.get("stage1_date"),
        None,
        parent.get("stage1_cleared") or "N",
        parent.get("expected_tod_date"),
        parent.get("final_tod_date"),
        parent.get("tender_cancelled") or "N",
        parent.get("retender_expected_date"),
        parent.get("retender_final_date"),
        None,
        None,
        None,
        None,
        None,
        parent.get("stage2_date"),
        stage2_gross_cost,
        parent.get("stage2_cleared") or "N",
        parent.get("project_dropped") or "N",
        parent.get("completion_marked") or "N",
        parent.get("completion_date"),
        parent.get("commissioned_marked") or "N",
        parent.get("commissioned_date"),
    ))
    new_project_id = c.fetchone()["id"]
    c.execute("""
        INSERT INTO user_projects (user_id, project_id)
        SELECT user_id, %s
        FROM user_projects
        WHERE project_id=%s
        ON CONFLICT (user_id, project_id) DO NOTHING
    """, (new_project_id, int(parent_project_id)))
    conn.commit()
    conn.close()
    return new_project_id

def add_corporate_package_project(parent_project_id, unique_id, project_name):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM projects WHERE id=%s", (parent_project_id,))
    parent = c.fetchone()
    if not parent:
        conn.close()
        raise ValueError("Selected parent project was not found.")

    if str(parent.get("project_type") or "").strip() != "Corporate AMR":
        conn.close()
        raise ValueError("Package project can be added only under Corporate AMR.")

    if str(parent.get("stage2_cleared") or "N").strip().upper() != "Y":
        conn.close()
        raise ValueError("Package project can be added only after Stage-2 clearance.")

    if parent.get("parent_project_id"):
        conn.close()
        raise ValueError("Select the main Corporate AMR project. Packages cannot be added under another package.")

    registration_date = datetime.now().strftime("%Y-%m-%d")
    c.execute("""
        INSERT INTO projects (
            unique_id,
            project_type,
            project_name,
            registration_date,
            parent_project_id,
            dic_recommendation_date,
            cod_date,
            cod_cleared,
            stage1_date,
            stage1_cost,
            stage1_cleared,
            expected_tod_date,
            final_tod_date,
            tender_cancelled,
            retender_expected_date,
            retender_final_date,
            contractor_name,
            loa_date,
            effective_date,
            schedule_months,
            schedule_completion,
            stage2_date,
            stage2_cost,
            stage2_cleared,
            project_dropped,
            completion_marked,
            completion_date,
            commissioned_marked,
            commissioned_date
        )
        VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s, %s,
            'N', 'N', NULL, 'N', NULL
        )
        RETURNING id
    """, (
        unique_id,
        "Corporate AMR",
        project_name,
        registration_date,
        int(parent_project_id),
        parent.get("dic_recommendation_date"),
        parent.get("cod_date"),
        parent.get("cod_cleared") or "N",
        parent.get("stage1_date"),
        None,
        parent.get("stage1_cleared") or "N",
        parent.get("expected_tod_date"),
        parent.get("final_tod_date"),
        parent.get("tender_cancelled"),
        parent.get("retender_expected_date"),
        parent.get("retender_final_date"),
        None,
        None,
        None,
        None,
        None,
        parent.get("stage2_date"),
        None,
        "Y",
    ))
    new_project_id = c.fetchone()["id"]
    c.execute("""
        INSERT INTO user_projects (user_id, project_id)
        SELECT user_id, %s
        FROM user_projects
        WHERE project_id=%s
        ON CONFLICT (user_id, project_id) DO NOTHING
    """, (new_project_id, int(parent_project_id)))
    conn.commit()
    conn.close()
    return new_project_id

def get_all_projects(allowed_project_ids=None, include_archived=False):
    conn = get_db_connection()
    c = conn.cursor()
    archive_filter = "" if include_archived else " AND COALESCE(project_archived, 'N') <> 'Y'"
    if allowed_project_ids is not None:
        if not allowed_project_ids:
            conn.close()
            return []
        c.execute(f"SELECT * FROM projects WHERE id = ANY(%s){archive_filter} ORDER BY id DESC", (list(allowed_project_ids),))
    else:
        c.execute(f"SELECT * FROM projects WHERE 1=1{archive_filter} ORDER BY id DESC")
    return c.fetchall()

def get_projects_by_stage(stage, allowed_project_ids=None):
    if allowed_project_ids is not None and not allowed_project_ids:
        return []

    conn = get_db_connection()
    c = conn.cursor()
    project_filter = " AND COALESCE(project_archived, 'N') <> 'Y'"
    params = []
    if allowed_project_ids is not None:
        project_filter += " AND id = ANY(%s)"
        params.append(list(allowed_project_ids))
    
    if stage == "formulation":
        c.execute(f"""
            SELECT * FROM projects 
            WHERE (cod_cleared = 'N' OR cod_cleared IS NULL)
              AND (stage1_cleared = 'N' OR stage1_cleared IS NULL)
              AND (final_tod_date IS NULL OR final_tod_date = '')
              {project_filter}
        """, params)
        
    elif stage == "stage1":
        c.execute(f"""
            SELECT * FROM projects 
            WHERE cod_cleared = 'Y' 
              AND (stage1_cleared = 'N' OR stage1_cleared IS NULL)
              AND (final_tod_date IS NULL OR final_tod_date = '')
              {project_filter}
        """, params)
        
    elif stage == "tendering":
        c.execute(f"""
            SELECT * FROM projects 
            WHERE stage1_cleared = 'Y' 
              AND (final_tod_date IS NULL OR final_tod_date = '')
              AND (stage2_cleared = 'N' OR stage2_cleared IS NULL)
              {project_filter}
        """, params)
        
    elif stage == "stage2":
        c.execute(f"""
            SELECT * FROM projects 
            WHERE final_tod_date IS NOT NULL 
              AND final_tod_date != ''
              AND (stage2_cleared = 'N' OR stage2_cleared IS NULL)
              {project_filter}
        """, params)
    
    return c.fetchall()

def update_project_stage(project_id, **kwargs):
    conn = get_db_connection()
    c = conn.cursor()
    set_clause = ", ".join([f"{k}=%s" for k in kwargs.keys()])
    values = list(kwargs.values()) + [project_id]
    c.execute(f"UPDATE projects SET {set_clause} WHERE id=%s", values)
    conn.commit()
    conn.close()

def delete_project_everywhere(project_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT id FROM projects WHERE parent_project_id=%s ORDER BY id DESC", (project_id,))
    child_rows = c.fetchall()
    conn.close()
    for child in child_rows:
        delete_project_everywhere(child["id"])

    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT unique_id, project_name FROM projects WHERE id=%s", (project_id,))
    project_row = c.fetchone()
    if not project_row:
        conn.close()
        return

    project_name = str(project_row.get("project_name") or "").strip()

    _remove_project_from_capex_snapshot(project_name)

    c.execute("DELETE FROM daily_progress_manpower WHERE project_id=%s", (project_id,))
    c.execute("DELETE FROM plant_level_amr_details WHERE project_id=%s", (project_id,))
    c.execute("DELETE FROM daily_progress WHERE project_id=%s", (project_id,))
    c.execute("DELETE FROM daily_actuals WHERE activity_id IN (SELECT id FROM activities WHERE project_id=%s)", (project_id,))
    c.execute("DELETE FROM monthly_plans WHERE project_id=%s", (project_id,))
    c.execute("DELETE FROM activities WHERE project_id=%s", (project_id,))
    c.execute("DELETE FROM plans WHERE project_id=%s", (project_id,))
    c.execute("DELETE FROM appendix2 WHERE project_id=%s", (project_id,))
    c.execute("DELETE FROM tods WHERE project_id=%s", (project_id,))
    c.execute("DELETE FROM user_projects WHERE project_id=%s", (project_id,))
    c.execute("DELETE FROM projects WHERE id=%s", (project_id,))
    conn.commit()
    conn.close()

def _remove_project_from_capex_snapshot(project_name):
    project_name = str(project_name or "").strip().lower()
    if not project_name or not os.path.exists(CAPEX_SAVE_PATH):
        return

    try:
        with open(CAPEX_SAVE_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception:
        return

    rows = payload.get("rows")
    if not isinstance(rows, list):
        return

    cleaned_rows = []
    changed = False
    for row in rows:
        values = row.get("values") or {}
        label = str(values.get("CAPEX Plan (FY)") or "").strip().lower()
        if label == project_name:
            changed = True
            continue
        cleaned_rows.append(row)

    if not changed:
        return

    payload["rows"] = cleaned_rows
    try:
        os.makedirs(os.path.dirname(CAPEX_SAVE_PATH), exist_ok=True)
        with open(CAPEX_SAVE_PATH, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
    except Exception:
        pass

def project_has_plan(project_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT 1 FROM plans WHERE project_id=%s LIMIT 1", (project_id,))
    row = c.fetchone()
    conn.close()
    return bool(row)

def project_has_saved_planning(project_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT 1 FROM monthly_plans WHERE project_id=%s LIMIT 1", (project_id,))
    row = c.fetchone()
    conn.close()
    return bool(row)

def project_has_completed_planning(project_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT plan_name
        FROM plans
        WHERE project_id=%s
          AND COALESCE(is_active, 'N') = 'Y'
        ORDER BY id DESC
        LIMIT 1
    """, (project_id,))
    active_plan = c.fetchone()
    plan_name = active_plan["plan_name"] if active_plan else None
    c.execute("""
        SELECT
            a.id,
            COALESCE(a.scope_qty, 0) AS scope_qty,
            COALESCE(a.actuals_till_last_fy, 0) AS actuals_till_last_fy,
            COALESCE(SUM(mp.planned_qty), 0) AS planned_qty
        FROM activities a
        LEFT JOIN monthly_plans mp
            ON mp.project_id = a.project_id
           AND mp.plan_name = a.plan_name
           AND mp.activity_type = a.activity_type
        WHERE a.project_id = %s
          AND (%s IS NULL OR a.plan_name = %s)
        GROUP BY a.id, a.scope_qty, a.actuals_till_last_fy
    """, (project_id, plan_name, plan_name))
    rows = c.fetchall()
    conn.close()
    if not rows:
        return False
    for row in rows:
        scope_qty = float(row["scope_qty"] or 0)
        actuals_till_last_fy = float(row["actuals_till_last_fy"] or 0)
        planned_qty = float(row["planned_qty"] or 0)
        if scope_qty > 0 and (actuals_till_last_fy + planned_qty) < scope_qty:
            return False
    return True

def get_latest_planned_plan(project_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT plan_name
        FROM plans
        WHERE project_id=%s
          AND COALESCE(is_active, 'N') = 'Y'
        ORDER BY id DESC
        LIMIT 1
    """, (project_id,))
    row = c.fetchone()
    if row:
        conn.close()
        return row["plan_name"]
    c.execute("""
        SELECT plan_name
        FROM monthly_plans
        WHERE project_id=%s AND plan_name IS NOT NULL AND plan_name <> ''
        ORDER BY id DESC
        LIMIT 1
    """, (project_id,))
    row = c.fetchone()
    conn.close()
    return row["plan_name"] if row else None

def get_appendix_activity_rows(project_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT id, s_no, category, item, commencement_months, completion_months,
               schedule_start, schedule_finish
        FROM appendix2
        WHERE project_id=%s
        ORDER BY
            CASE
                WHEN s_no ~ '^[0-9]+$' THEN LPAD(s_no, 10, '0')
                ELSE s_no
            END,
            id
    """, (project_id,))
    rows = c.fetchall()
    conn.close()
    return rows

# ==================== DAILY PROGRESS REPORT HELPERS (OLD - For S-Curve Activities) ====================
def get_activities_for_plan(project_id, plan_name):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT id, activity_type, uom, scope_qty, weight_percent, start_date, finish_date
        FROM activities 
        WHERE project_id = %s AND plan_name = %s 
        ORDER BY id
    """, (project_id, plan_name))
    activities = c.fetchall()
    conn.close()
    return activities

def get_daily_actuals_for_activity(activity_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT actual_date, actual_qty 
        FROM daily_actuals 
        WHERE activity_id = %s 
        ORDER BY actual_date DESC
    """, (activity_id,))
    actuals = c.fetchall()
    conn.close()
    return actuals

def save_daily_actual(activity_id, actual_date, actual_qty):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        INSERT INTO daily_actuals (activity_id, actual_date, actual_qty)
        VALUES (%s, %s, %s)
    """, (activity_id, actual_date, actual_qty))
    conn.commit()
    conn.close()

def get_cumulative_actual_qty(activity_id):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT COALESCE(SUM(actual_qty), 0) as total FROM daily_actuals WHERE activity_id = %s", (activity_id,))
    row = c.fetchone()
    conn.close()
    return float(row['total']) if row else 0.0

def get_activity_progress_rows(project_id, plan_name, report_date):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT
            a.id,
            a.activity_type,
            a.uom,
            a.scope_qty,
            COALESCE(SUM(CASE WHEN da.actual_date::date = %s THEN da.actual_qty ELSE 0 END), 0) AS actual_today,
            COALESCE(SUM(da.actual_qty), 0) AS cumulative_actual
        FROM activities a
        LEFT JOIN daily_actuals da ON da.activity_id = a.id
        WHERE a.project_id = %s AND a.plan_name = %s
        GROUP BY a.id, a.activity_type, a.uom, a.scope_qty
        ORDER BY a.id
    """, (report_date, project_id, plan_name))
    rows = c.fetchall()
    conn.close()
    return rows

def get_daily_progress_activity_matrix(project_id, plan_name):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT a.id, a.activity_type
        FROM activities a
        WHERE a.project_id = %s AND a.plan_name = %s
        ORDER BY a.id
    """, (project_id, plan_name))
    activities = c.fetchall()

    c.execute("""
        SELECT dates.report_date, a.id AS activity_id,
               a.activity_type, COALESCE(da.actual_qty, 0) AS actual_qty
        FROM (
            SELECT report_date::date AS report_date
            FROM daily_progress
            WHERE project_id = %s
            UNION
            SELECT actual_date::date AS report_date
            FROM daily_actuals da
            INNER JOIN activities act ON act.id = da.activity_id
            WHERE act.project_id = %s AND act.plan_name = %s
        ) dates
        LEFT JOIN activities a
          ON a.project_id = %s
         AND a.plan_name = %s
        LEFT JOIN daily_actuals da
          ON da.activity_id = a.id
         AND da.actual_date::date = dates.report_date
        ORDER BY dates.report_date DESC, a.id
    """, (project_id, project_id, plan_name, project_id, plan_name))
    rows = c.fetchall()
    conn.close()
    return activities, rows

def classify_activity_progress(activity_type):
    text = str(activity_type or "").strip().lower()
    if "design" in text and "engineering" in text:
        return "design_engineering"
    if "civil" in text:
        return "civil"
    if "supply" in text and ("steel" in text or "structur" in text):
        return "structural_supply"
    if "erection" in text and ("steel" in text or "structur" in text):
        return "structural_erection"
    if "supply" in text and ("electrical" in text or "equipment" in text):
        return "equipment_supply"
    if "erection" in text and ("electrical" in text or "equipment" in text):
        return "equipment_erection"
    return None

def _daily_report_date_key(value):
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    if not text:
        return ""
    for fmt in ("%Y-%m-%d", "%d-%m-%y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass
    return text[:10]

def get_daily_report_month_matrix(project_id, plan_name, year, month):
    """Build the Daily Report month matrix from saved data-entry actuals and manpower."""
    start_day = date(int(year), int(month), 1)
    end_day = date(int(year), int(month), monthrange(int(year), int(month))[1])
    conn = get_db_connection()
    c = conn.cursor()

    c.execute("""
        SELECT unique_id, project_name
        FROM projects
        WHERE id = %s
    """, (project_id,))
    project = c.fetchone() or {}

    c.execute("""
        SELECT id, activity_type, uom, scope_qty
        FROM activities
        WHERE project_id = %s
          AND (%s IS NULL OR plan_name = %s)
        ORDER BY id
    """, (project_id, plan_name, plan_name))
    activities = c.fetchall()
    activity_ids = [int(row["id"]) for row in activities]

    activity_values = {}
    if activity_ids:
        c.execute("""
            SELECT activity_id, actual_date::date AS report_date, COALESCE(SUM(actual_qty), 0) AS actual_qty
            FROM daily_actuals
            WHERE activity_id = ANY(%s)
              AND actual_date::date BETWEEN %s AND %s
            GROUP BY activity_id, actual_date::date
        """, (activity_ids, start_day, end_day))
        for row in c.fetchall():
            activity_values[(int(row["activity_id"]), _daily_report_date_key(row["report_date"]))] = float(row["actual_qty"] or 0)

    c.execute("""
        SELECT report_date::date AS report_date, section_name, category_name, role_name, COALESCE(SUM(qty), 0) AS qty
        FROM daily_progress_manpower
        WHERE project_id = %s
          AND report_date::date BETWEEN %s AND %s
        GROUP BY report_date::date, section_name, category_name, role_name
        ORDER BY report_date::date
    """, (project_id, start_day, end_day))
    manpower_values = {}
    for row in c.fetchall():
        day_key = _daily_report_date_key(row["report_date"])
        section_name = str(row.get("section_name") or "")
        category_name = str(row.get("category_name") or "")
        role_name = str(row.get("role_name") or "")
        qty = int(row.get("qty") or 0)
        if section_name == "Rourkela Steel Plant Manpower" and category_name == "Executives":
            key = "rsp_executive"
        elif section_name == "Rourkela Steel Plant Manpower" and category_name == "Non-Executives":
            key = "rsp_non_executive"
        elif section_name == "Executing Agency" and (category_name == "Staff / Supervisory" or role_name not in {"Supervisor", "Labour"}):
            key = "agency_manpower"
        elif role_name == "Supervisor":
            key = "supervisor"
        elif role_name == "Labour":
            key = "labour"
        else:
            key = "agency_manpower"
        manpower_values[(key, day_key)] = manpower_values.get((key, day_key), 0) + qty

    conn.close()

    days = [date(int(year), int(month), day).isoformat() for day in range(1, end_day.day + 1)]
    activity_rows = []
    for index, activity in enumerate(activities, start=1):
        activity_id = int(activity["id"])
        values = {day_key: activity_values.get((activity_id, day_key), 0) for day_key in days}
        activity_rows.append({
            "serial": index,
            "activity_id": activity_id,
            "activity": activity.get("activity_type") or "",
            "category": classify_activity_progress(activity.get("activity_type")) or "",
            "uom": activity.get("uom") or "",
            "scope": activity.get("scope_qty") or 0,
            "values": values,
            "total": sum(values.values()),
        })

    manpower_specs = [
        ("rsp_executive", "RSP Exe."),
        ("rsp_non_executive", "RSP Non Executive"),
        ("agency_manpower", "Agency Manpower"),
        ("supervisor", "Supervisor"),
        ("labour", "Labour"),
    ]
    manpower_rows = []
    for key, label in manpower_specs:
        values = {day_key: manpower_values.get((key, day_key), 0) for day_key in days}
        manpower_rows.append({
            "key": key,
            "label": label,
            "values": values,
            "total": sum(values.values()),
        })

    day_totals = {
        day_key: sum(row["values"].get(day_key, 0) for row in manpower_rows)
        for day_key in days
    }
    return {
        "project": dict(project),
        "month": start_day.strftime("%B %Y"),
        "days": days,
        "activity_rows": activity_rows,
        "manpower_rows": manpower_rows,
        "day_totals": day_totals,
        "month_total": sum(day_totals.values()),
    }

def save_daily_progress_with_activities(project_id, report_date, manpower_data, activity_actuals):
    rsp_executive = int(manpower_data.get("rsp_executive", 0) or 0)
    rsp_non_executive = int(manpower_data.get("rsp_non_executive", 0) or 0)
    agency_staff_rows = manpower_data.get("agency_staff", [])
    if not agency_staff_rows:
        agency_staff_rows = [
            {"role": "Civil", "qty": int(manpower_data.get("staff_civil", 0) or 0)},
            {"role": "Electrical", "qty": int(manpower_data.get("staff_electrical", 0) or 0)},
            {"role": "Mechanical", "qty": int(manpower_data.get("staff_mechanical", 0) or 0)},
            {"role": "Refractory", "qty": int(manpower_data.get("staff_refractory", 0) or 0)},
        ]
    normalized_agency_staff_rows = []
    for row in agency_staff_rows:
        role_name = str(row.get("role") or "").strip()
        if not role_name:
            continue
        qty = int(row.get("qty", 0) or 0)
        normalized_agency_staff_rows.append({"role": role_name, "qty": max(0, qty)})

    staff_supervisory_total = sum(int(row.get("qty", 0) or 0) for row in normalized_agency_staff_rows)
    contractor_rows = manpower_data.get("contractors", [])
    contractor_supervisor_total = sum(int(row.get("supervisor", 0) or 0) for row in contractor_rows)
    contractor_labour_total = sum(int(row.get("labour", 0) or 0) for row in contractor_rows)
    executing_agency_total = staff_supervisory_total + contractor_supervisor_total + contractor_labour_total

    summary = {
        'rsp_executive': rsp_executive,
        'rsp_non_executive': rsp_non_executive,
        'executing_agency': executing_agency_total,
        'labour_deployed': contractor_labour_total,
        'supervisor': staff_supervisory_total + contractor_supervisor_total,
        'design_engineering': 0,
        'civil': 0,
        'structural_supply': 0,
        'structural_erection': 0,
        'equipment_supply': 0,
        'equipment_erection': 0,
    }
    for row in activity_actuals:
        qty = float(row.get("actual_qty") or 0)
        bucket = classify_activity_progress(row.get("activity_type"))
        if bucket:
            summary[bucket] += qty

    save_or_update_daily_progress(project_id, report_date, summary)

    conn = get_db_connection()
    c = conn.cursor()
    c.execute("DELETE FROM daily_progress_manpower WHERE project_id=%s AND report_date=%s", (project_id, report_date))

    detail_rows = [
        ("Rourkela Steel Plant Manpower", "Executives", None, None, rsp_executive),
        ("Rourkela Steel Plant Manpower", "Non-Executives", None, None, rsp_non_executive),
    ]
    for row in normalized_agency_staff_rows:
        detail_rows.append(("Executing Agency", "Staff / Supervisory", None, row["role"], int(row["qty"])))
    sort_order = 1
    for section_name, category_name, contractor_name, role_name, qty in detail_rows:
        c.execute("""
            INSERT INTO daily_progress_manpower
            (project_id, report_date, section_name, category_name, contractor_name, role_name, qty, sort_order)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (project_id, report_date, section_name, category_name, contractor_name, role_name, qty, sort_order))
        sort_order += 1

    for contractor in contractor_rows:
        contractor_name = str(contractor.get("name") or "").strip()
        if not contractor_name:
            continue
        for role_name, key in (("Supervisor", "supervisor"), ("Labour", "labour")):
            qty = int(contractor.get(key, 0) or 0)
            c.execute("""
                INSERT INTO daily_progress_manpower
                (project_id, report_date, section_name, category_name, contractor_name, role_name, qty, sort_order)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (project_id, report_date, "Executing Agency", contractor_name, contractor_name, role_name, qty, sort_order))
            sort_order += 1

    for row in activity_actuals:
        activity_id = int(row["activity_id"])
        actual_qty = float(row.get("actual_qty") or 0)
        c.execute("DELETE FROM daily_actuals WHERE activity_id=%s AND actual_date::date=%s", (activity_id, report_date))
        if actual_qty:
            c.execute("""
                INSERT INTO daily_actuals (activity_id, actual_date, actual_qty)
                VALUES (%s, %s, %s)
            """, (activity_id, report_date, actual_qty))
    conn.commit()
    conn.close()
# ============================================================================

# ==================== DAILY PROGRESS REPORT HELPERS (NEW - For Manpower + Construction Progress Table) ====================
def get_daily_progress(project_id):
    """Get all daily progress records for a project (latest first)"""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT id, report_date, rsp_executive, rsp_non_executive, executing_agency,
               labour_deployed, supervisor, design_engineering, civil,
               structural_supply, structural_erection, equipment_supply, equipment_erection
        FROM daily_progress 
        WHERE project_id = %s 
        ORDER BY report_date DESC
    """, (project_id,))
    records = c.fetchall()
    conn.close()
    return records

def get_daily_progress_display_rows(project_id, plan_name=None):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT report_date::date AS report_date
        FROM daily_progress
        WHERE project_id = %s
        UNION
        SELECT report_date::date AS report_date
        FROM daily_progress_manpower
        WHERE project_id = %s
        UNION
        SELECT actual_date::date AS report_date
        FROM daily_actuals da
        INNER JOIN activities a ON a.id = da.activity_id
        WHERE a.project_id = %s
          AND (%s IS NULL OR a.plan_name = %s)
        ORDER BY report_date DESC
    """, (project_id, project_id, project_id, plan_name, plan_name))
    dates = [row["report_date"] for row in c.fetchall()]

    c.execute("""
        SELECT id, report_date, rsp_executive, rsp_non_executive, executing_agency,
               labour_deployed, supervisor, design_engineering, civil,
               structural_supply, structural_erection, equipment_supply, equipment_erection
        FROM daily_progress
        WHERE project_id = %s
    """, (project_id,))
    progress_map = {row["report_date"]: dict(row) for row in c.fetchall()}

    c.execute("""
        SELECT report_date, section_name, category_name, contractor_name, role_name, qty
        FROM daily_progress_manpower
        WHERE project_id = %s
        ORDER BY report_date DESC, sort_order, id
    """, (project_id,))
    manpower_map = {}
    for row in c.fetchall():
        report_date = row["report_date"]
        bucket = manpower_map.setdefault(report_date, {
            "rsp_executive": 0,
            "rsp_non_executive": 0,
            "executing_agency": 0,
            "labour_deployed": 0,
            "supervisor": 0,
        })
        section_name = str(row.get("section_name") or "")
        category_name = str(row.get("category_name") or "")
        role_name = str(row.get("role_name") or "")
        qty = int(row.get("qty") or 0)
        if section_name == "Rourkela Steel Plant Manpower":
            if category_name == "Executives":
                bucket["rsp_executive"] += qty
            elif category_name == "Non-Executives":
                bucket["rsp_non_executive"] += qty
        elif section_name == "Executing Agency":
            bucket["executing_agency"] += qty
            if category_name == "Staff / Supervisory" or role_name == "Supervisor":
                bucket["supervisor"] += qty
            if role_name == "Labour":
                bucket["labour_deployed"] += qty

    conn.close()

    rows = []
    for index, report_date in enumerate(dates, start=1):
        base = progress_map.get(report_date, {})
        detail = manpower_map.get(report_date, {})
        rows.append({
            "id": base.get("id", f"derived_{report_date}"),
            "report_date": report_date,
            "rsp_executive": base.get("rsp_executive", detail.get("rsp_executive", 0)),
            "rsp_non_executive": base.get("rsp_non_executive", detail.get("rsp_non_executive", 0)),
            "executing_agency": base.get("executing_agency", detail.get("executing_agency", 0)),
            "labour_deployed": base.get("labour_deployed", detail.get("labour_deployed", 0)),
            "supervisor": base.get("supervisor", detail.get("supervisor", 0)),
            "design_engineering": base.get("design_engineering", 0),
            "civil": base.get("civil", 0),
            "structural_supply": base.get("structural_supply", 0),
            "structural_erection": base.get("structural_erection", 0),
            "equipment_supply": base.get("equipment_supply", 0),
            "equipment_erection": base.get("equipment_erection", 0),
        })
    return rows

def get_daily_progress_by_date(project_id, report_date):
    """Get a specific day's progress record"""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT * FROM daily_progress 
        WHERE project_id = %s AND report_date = %s
    """, (project_id, report_date))
    record = c.fetchone()
    conn.close()
    return record

def get_daily_progress_manpower(project_id, report_date):
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        SELECT section_name, category_name, contractor_name, role_name, qty, sort_order
        FROM daily_progress_manpower
        WHERE project_id = %s AND report_date = %s
        ORDER BY sort_order, id
    """, (project_id, report_date))
    rows = c.fetchall()
    conn.close()
    return rows

def save_or_update_daily_progress(project_id, report_date, data):
    """Insert or update daily progress record"""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        INSERT INTO daily_progress 
        (project_id, report_date, rsp_executive, rsp_non_executive, executing_agency,
         labour_deployed, supervisor, design_engineering, civil,
         structural_supply, structural_erection, equipment_supply, equipment_erection)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (project_id, report_date) 
        DO UPDATE SET 
            rsp_executive = EXCLUDED.rsp_executive,
            rsp_non_executive = EXCLUDED.rsp_non_executive,
            executing_agency = EXCLUDED.executing_agency,
            labour_deployed = EXCLUDED.labour_deployed,
            supervisor = EXCLUDED.supervisor,
            design_engineering = EXCLUDED.design_engineering,
            civil = EXCLUDED.civil,
            structural_supply = EXCLUDED.structural_supply,
            structural_erection = EXCLUDED.structural_erection,
            equipment_supply = EXCLUDED.equipment_supply,
            equipment_erection = EXCLUDED.equipment_erection
    """, (
        project_id, report_date,
        data.get('rsp_executive', 0),
        data.get('rsp_non_executive', 0),
        data.get('executing_agency', 0),
        data.get('labour_deployed', 0),
        data.get('supervisor', 0),
        data.get('design_engineering', 0),
        data.get('civil', 0),
        data.get('structural_supply', 0),
        data.get('structural_erection', 0),
        data.get('equipment_supply', 0),
        data.get('equipment_erection', 0)
    ))
    conn.commit()
    conn.close()

def delete_daily_progress(record_id):
    """Delete a daily progress record"""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT project_id, report_date FROM daily_progress WHERE id = %s", (record_id,))
    row = c.fetchone()
    if row:
        c.execute("DELETE FROM daily_progress_manpower WHERE project_id = %s AND report_date = %s", (row["project_id"], row["report_date"]))
        c.execute("""
            DELETE FROM daily_actuals
            WHERE actual_date = %s
              AND activity_id IN (SELECT id FROM activities WHERE project_id = %s)
        """, (row["report_date"], row["project_id"]))
    c.execute("DELETE FROM daily_progress WHERE id = %s", (record_id,))
    conn.commit()
    conn.close()
# ============================================================================
