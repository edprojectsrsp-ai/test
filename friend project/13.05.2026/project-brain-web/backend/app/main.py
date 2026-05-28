from calendar import monthrange
from datetime import date, datetime, timedelta
import json
import os
from pathlib import Path
import sys

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT_DIR = next(
    (parent for parent in Path(__file__).resolve().parents if (parent / "database.py").exists()),
    Path(r"D:\Python\Project Brain") if (Path(r"D:\Python\Project Brain") / "database.py").exists() else Path(__file__).resolve().parents[3],
)
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from database import (  # noqa: E402
    APP_MODULES,
    authenticate_user,
    add_child_project,
    add_project,
    delete_project_everywhere,
    get_all_project_choices,
    get_all_projects,
    get_all_users,
    get_appendix_activity_rows,
    get_db_connection,
    get_latest_planned_plan,
    get_activities_for_plan,
    get_daily_progress_display_rows,
    get_projects_by_stage,
    classify_activity_progress,
    complete_user_permissions,
    get_user_permissions,
    get_user_project_ids,
    project_has_completed_planning,
    save_user_permissions,
    save_user_projects,
    update_project_stage,
)
from utils import (  # noqa: E402
    classify_project_financial_year,
    generate_unique_id,
    get_project_status,
    normalize_financial_year,
    to_display_date,
    to_storage_date,
)

from capex import (  # noqa: E402
    ALL_COLUMNS,
    BASE_COLUMNS,
    CAPEX_MONTHS,
    DEFAULT_ROWS,
    build_financial_year_label,
    empty_values,
)
from app.plant_level_amr import (  # noqa: E402
    build_dashboard as build_plant_level_amr_dashboard,
    ensure_details_columns as ensure_plant_level_amr_details_columns,
    import_template_csv as import_plant_level_amr_template_csv,
    project_status_context as plant_level_project_status_context,
    update_edc_idc_monthly,
    update_edc_idc_values,
    update_project_field as update_plant_level_amr_project_field,
    update_project_fields as update_plant_level_amr_project_fields,
    update_monthly_value,
)


app = FastAPI(title="Project Brain API")


def is_admin_role(value):
    return str(value or "").strip().lower() in {"admin", "administrator", "super admin", "superadmin"}


allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "PROJECT_BRAIN_CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def ensure_app_settings_table():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT
        )
        """
    )
    conn.commit()
    conn.close()


def get_app_setting(setting_key, default_value=""):
    ensure_app_settings_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT setting_value FROM app_settings WHERE setting_key=%s", (setting_key,))
    row = cursor.fetchone()
    conn.close()
    return row["setting_value"] if row else default_value


def set_app_setting(setting_key, setting_value):
    ensure_app_settings_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO app_settings (setting_key, setting_value)
        VALUES (%s, %s)
        ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value
        """,
        (setting_key, str(setting_value)),
    )
    conn.commit()
    conn.close()


def get_daily_progress_backdate_days():
    try:
        value = int(get_app_setting("daily_progress_backdate_days", "3"))
    except (TypeError, ValueError):
        value = 3
    return max(0, min(value, 365))


class LoginPayload(BaseModel):
    username: str
    password: str


class UserPreferencePayload(BaseModel):
    value: dict = {}


class DailyProgressSettingsPayload(BaseModel):
    backdate_days: int = 3
    requested_by_role: str = ""


class AdminUserRightsPayload(BaseModel):
    user_id: int
    permissions: dict = {}
    project_ids: list[int] = []
    requested_by_role: str = ""


class DailyProgressActualRowPayload(BaseModel):
    activity_id: int | None = None
    actual_qty: float | int | str | None = 0
    area_of_work: str = ""


class DailyProgressManpowerRowPayload(BaseModel):
    category: str = ""
    contractorName: str = ""
    trade: str = ""
    monthTarget: float | int | str | None = ""
    lastMonth: float | int | str | None = 0
    today: float | int | str | None = 0
    remarks: str = ""


class DailyProgressActualsPayload(BaseModel):
    report_date: str
    plan_name: str | None = None
    requested_by_role: str = ""
    actuals: list[DailyProgressActualRowPayload] = []
    manpowerRows: list[DailyProgressManpowerRowPayload] = []


class DailyProgressMonthlyActualRowPayload(BaseModel):
    month: str
    actual_qty: float | int | str | None = 0
    remark: str = ""


class DailyProgressMonthlyActualsPayload(BaseModel):
    activity_id: int
    plan_name: str | None = None
    as_of: str | None = None
    requested_by_role: str = ""
    rows: list[DailyProgressMonthlyActualRowPayload] = []


class ProjectCreatePayload(BaseModel):
    unique_id: str = ""
    project_type: str
    project_name: str


class ChildProjectPayload(BaseModel):
    parent_project_id: int
    project_name: str
    stage2_gross_cost: float


class ProjectMarkPayload(BaseModel):
    mark_type: str
    checked: bool
    date_value: str | None = None


class ProjectArchivePayload(BaseModel):
    archived: bool


class ProjectStagePayload(BaseModel):
    dic_recommendation_date: str | None = None
    cod_date: str | None = None
    stage1_date: str | None = None
    stage1_cost: float | None = None
    expected_tod_date: str | None = None
    final_tod_date: str | None = None
    stage2_date: str | None = None
    stage2_cost: float | None = None
    cod_cleared: str | None = None
    stage1_cleared: str | None = None
    stage2_cleared: str | None = None
    project_dropped: str | None = None
    project_archived: str | None = None


class ApprovalFieldSavePayload(BaseModel):
    values: dict[str, str | float | int | None] = {}


class ApprovalStageClearancePayload(BaseModel):
    requested_by_role: str = ""


class ApprovalStageRevertPayload(BaseModel):
    stage_key: str = ""
    step_no: int | None = None
    requested_by_role: str = ""
    remark: str = ""


class CorporateAmrMasterPayload(BaseModel):
    master_values: dict[str, str | float | int | None] = {}
    approval_values: dict[str, str | float | int | None] = {}
    tender_openings: list[dict[str, str | int | None]] | None = None


class ContractAppendixRowPayload(BaseModel):
    s_no: str = ""
    category: str = ""
    item: str = ""
    commencement_months: int | None = None
    completion_months: int | None = None
    schedule_start: str | None = None
    schedule_finish: str | None = None


class ContractPayload(BaseModel):
    contractor_name: str = ""
    loa_date: str | None = None
    effective_date: str | None = None
    schedule_months: int | None = None
    schedule_completion: str | None = None
    expected_finish: str | None = None
    appendix_rows: list[ContractAppendixRowPayload] = []


class ScurveActivityPayload(BaseModel):
    activity_type: str = ""
    uom: str = ""
    scope_qty: float | int | str | None = None
    weight_percent: float | int | str | None = None
    actuals_till_last_fy: float | int | str | None = None
    start_date: str | None = None
    finish_date: str | None = None
    expected_finish: str | None = None
    monthly: dict[str, float | int | str | None] = {}


class ScurvePlanPayload(BaseModel):
    plan_name: str
    financial_year: str = ""
    plan_version: str = "Original Plan"
    make_active: bool = False
    requested_by_role: str = ""
    requested_by_username: str = ""
    requested_by_user_id: int | None = None
    activities: list[ScurveActivityPayload] = []


class ScurveActivePlanPayload(BaseModel):
    plan_name: str


class ScurvePlanCreatePayload(BaseModel):
    financial_year: str
    plan_version: str = "Original Plan"
    source_plan_name: str = ""


class CapexCellPayload(BaseModel):
    plan_name: str
    row_id: int
    column: str
    value: str


class CapexRowPayload(BaseModel):
    plan_name: str
    name: str
    indent: int = 2
    after_row_id: int | None = None


class CapexDeleteRowPayload(BaseModel):
    plan_name: str
    row_id: int
    requested_by_role: str = ""


class CapexRowsPayload(BaseModel):
    plan_name: str
    rows: list[dict]


class CapexPlanCreatePayload(BaseModel):
    financial_year: str
    plan_version: str = "Original Plan"
    plan_type: str = "BE"
    source_plan_name: str | None = None
    effective_from_month: str | None = None


class CapexApprovePayload(BaseModel):
    plan_name: str
    effective_from_month: str | None = None


class CapexEffectivePayload(BaseModel):
    plan_name: str


class CapexPlanDeletePayload(BaseModel):
    plan_name: str
    requested_by_role: str = ""


class CapexRowMovePayload(BaseModel):
    plan_name: str
    row_id: int
    direction: int


class CapexRowIndentPayload(BaseModel):
    plan_name: str
    row_id: int
    delta: int


class BillingMilestonePayload(BaseModel):
    project_id: int
    milestone_no: int | str | None = None
    description: str = ""
    milestone_type: str = ""
    weightage_percent: float | int | str | None = 0
    schedule_start: str | None = None
    schedule_finish: str | None = None
    scheduled_amount: float | int | str | None = 0
    scheduled_date: str | None = None
    billed_amount: float | int | str | None = 0
    billed_date: str | None = None
    received_amount: float | int | str | None = 0
    received_date: str | None = None
    remarks: str = ""
    manufacturing_clearance: str = ""
    inspection_clearance: str = ""
    dispatch_clearance: str = ""
    site_receipt_clearance: str = ""
    approval_clearance: str = ""


class PlantLevelAmrMonthlyPayload(BaseModel):
    project_id: int
    month: str
    metric: str
    value: float | int | str | None = 0
    financial_year: str = "2026-2027"


class PlantLevelAmrEdcIdcMonthlyPayload(BaseModel):
    month: str
    metric: str
    value: float | int | str | None = 0
    financial_year: str = "2026-2027"
    status_as_on: str = ""


class PlantLevelAmrEdcIdcBulkPayload(BaseModel):
    monthly: list[dict[str, str | float | int | None]] = []
    financial_year: str = "2026-2027"
    status_as_on: str = ""


class PlantLevelAmrProjectPayload(BaseModel):
    project_id: int
    field: str
    value: str | float | int | None = ""
    financial_year: str = ""
    month: str = ""
    status_as_on: str = ""


class PlantLevelAmrProjectFieldsPayload(BaseModel):
    project_id: int
    fields: dict[str, str | float | int | None] = {}
    financial_year: str = ""
    month: str = ""
    status_as_on: str = ""


class PlantLevelAmrUploadPayload(BaseModel):
    filename: str = ""
    content: str = ""


class PlantLevelAmrPdfPayload(BaseModel):
    title: str = "Plant Level AMR Projects - Current View"
    subtitle: str = ""
    columns: list = []
    rows: list = []


def json_ready(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: json_ready(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_ready(item) for item in value]
    return value


def ensure_user_preferences_table():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS user_preferences (
            username TEXT NOT NULL,
            view_key TEXT NOT NULL,
            preference_json TEXT NOT NULL DEFAULT '{}',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (username, view_key)
        )
        """
    )
    conn.commit()
    conn.close()


def optional_float(value, default=None):
    text = str(value if value is not None else "").replace(",", "").replace("%", "").strip()
    if text == "":
        return default
    try:
        return float(text)
    except (TypeError, ValueError):
        return default


def progress_category(activity_type):
    text = str(activity_type or "").strip().lower()
    if "design" in text and "engineering" in text:
        return "Design & Engineering"
    if "civil" in text:
        return "Civil-RCC"
    if "supply" in text and ("steel" in text or "structur" in text):
        return "Structural Supply"
    if "erection" in text and ("steel" in text or "structur" in text):
        return "Structural Erection"
    if "supply" in text and ("electrical" in text or "equipment" in text or "mechanical" in text):
        return "Equipment Supply"
    if "erection" in text and ("electrical" in text or "equipment" in text or "mechanical" in text):
        return "Equipment Erection"
    return "Other Progress"


def normalize_activity_text(value):
    text = str(value or "").lower()
    replacements = {
        "engg": "engineering",
        "eqpt": "equipment",
        "strl": "structural",
        "strl.": "structural",
        "nos": "nos",
        "no": "nos",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    return "".join(char for char in text if char.isalnum())


def activity_matches_appendix(activity, appendix_row):
    activity_text = normalize_activity_text(activity.get("activity_type"))
    activity_parent, activity_child = split_scurve_activity_type(activity.get("activity_type"))
    parent_text = normalize_activity_text(activity_parent)
    child_text = normalize_activity_text(activity_child)
    item_text = normalize_activity_text(appendix_row.get("item"))
    category_text = normalize_activity_text(appendix_row.get("category"))
    item_matches = bool(item_text and (item_text in child_text or child_text in item_text or item_text in activity_text))
    category_matches = bool(category_text and (category_text in parent_text or parent_text in category_text or category_text in activity_text))
    if item_text:
        return item_matches and (not category_text or category_matches)
    if category_text:
        return category_matches
    return False


def split_scurve_activity_type(activity_type):
    parts = [part.strip() for part in str(activity_type or "").split("->") if part.strip()]
    if len(parts) >= 2:
        return parts[0], " -> ".join(parts[1:])
    return progress_category(activity_type), str(activity_type or "").strip()


def scurve_parent_lookup_key(value):
    return "".join(char for char in str(value or "").lower() if char.isalnum())


def build_appendix_parent_schedules(appendix_rows):
    schedules = {}
    for row in appendix_rows or []:
        parent_name = row.get("category") or "Other Activities"
        start = parse_date(row.get("schedule_start"))
        finish = parse_date(row.get("schedule_finish"))
        current = schedules.setdefault(parent_name, {"start": None, "finish": None, "count": 0})
        if start and (current["start"] is None or start < current["start"]):
            current["start"] = start
        if finish and (current["finish"] is None or finish > current["finish"]):
            current["finish"] = finish
        current["count"] += 1
    return schedules


def appendix_rows_with_contract_dates(project_id, appendix_rows):
    """Fill missing Appendix schedule dates from Contract effective date/months for planning limits."""
    rows = [dict(row) for row in (appendix_rows or [])]
    if not rows:
        return rows
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT effective_date FROM projects WHERE id=%s", (project_id,))
    project = cursor.fetchone()
    conn.close()
    effective_date = project.get("effective_date") if project else None
    for row in rows:
        if not row.get("schedule_start"):
            row["schedule_start"] = to_storage_date(calculate_contract_completion(effective_date, row.get("commencement_months")))
        if not row.get("schedule_finish"):
            row["schedule_finish"] = to_storage_date(calculate_contract_completion(effective_date, row.get("completion_months")))
    return rows


def json_ready_parent_schedules(parent_schedules):
    return {
        parent_name: {
            "start": values["start"].isoformat() if values.get("start") else "",
            "finish": values["finish"].isoformat() if values.get("finish") else "",
            "count": values.get("count") or 0,
        }
        for parent_name, values in (parent_schedules or {}).items()
    }


def scurve_activity_parent_schedule(activity_type, parent_schedules):
    parent_name, _ = split_scurve_activity_type(activity_type)
    if parent_name in parent_schedules:
        return parent_schedules[parent_name]
    lookup = scurve_parent_lookup_key(parent_name)
    for schedule_parent, schedule in parent_schedules.items():
        if scurve_parent_lookup_key(schedule_parent) == lookup:
            return schedule
    return None


def appendix_schedule_for_scurve_activity(activity_type, appendix_rows, parent_schedules):
    parent_name, child_name = split_scurve_activity_type(activity_type)
    parent_key = scurve_parent_lookup_key(parent_name)
    child_key = scurve_parent_lookup_key(child_name)
    for row in appendix_rows or []:
        if scurve_parent_lookup_key(row.get("category")) != parent_key:
            continue
        if scurve_parent_lookup_key(row.get("item")) == child_key:
            return {
                "start": row.get("schedule_start") or "",
                "finish": row.get("schedule_finish") or "",
            }
    if not child_key or child_key == parent_key:
        parent_schedule = scurve_activity_parent_schedule(parent_name, parent_schedules) or {}
        parent_start = parent_schedule.get("start")
        parent_finish = parent_schedule.get("finish")
        return {
            "start": parent_start.isoformat() if isinstance(parent_start, date) else (parent_start or ""),
            "finish": parent_finish.isoformat() if isinstance(parent_finish, date) else (parent_finish or ""),
        }
    return None


def apply_default_scurve_activity_dates(activity, appendix_rows, parent_schedules):
    schedule = appendix_schedule_for_scurve_activity(activity.get("activity_type"), appendix_rows, parent_schedules)
    if not schedule:
        return activity
    if not activity.get("start_date"):
        activity["start_date"] = schedule.get("start") or ""
    if not activity.get("finish_date"):
        activity["finish_date"] = schedule.get("finish") or ""
    if not activity.get("expected_finish"):
        activity["expected_finish"] = activity.get("finish_date") or schedule.get("finish") or ""
    return activity


def scurve_month_within_limits(month_name, activity_start, activity_finish, parent_schedule=None, expected_finish=None):
    month_date = month_label_date(month_name)
    if not month_date:
        return False
    activity_start_month = date(activity_start.year, activity_start.month, 1) if activity_start else None
    planning_finish = expected_finish or activity_finish
    activity_finish_month = date(planning_finish.year, planning_finish.month, 1) if planning_finish else None
    parent_start = parent_schedule.get("start") if parent_schedule else None
    parent_start_month = date(parent_start.year, parent_start.month, 1) if parent_start else None
    if parent_start_month and month_date < parent_start_month:
        return False
    if activity_start_month and month_date < activity_start_month:
        return False
    if activity_finish_month and month_date > activity_finish_month:
        return False
    return True


def parse_scurve_plan_name(plan_name):
    text = str(plan_name or "").strip()
    import re
    match = re.search(r"(\d{4})\s*-\s*(\d{4})", text)
    financial_year = f"{match.group(1)}-{match.group(2)}" if match else ""
    version = "Original Plan"
    if "|" in text:
        parts = [part.strip() for part in text.split("|")]
        if len(parts) > 1 and parts[1]:
            version = normalize_scurve_plan_version(parts[1])
    return financial_year, version


def normalize_scurve_plan_version(value):
    text = str(value or "Original Plan").strip() or "Original Plan"
    lowered = text.lower().replace("-", " ")
    if lowered in ("original", "original plan"):
        return "Original Plan"
    import re
    match = re.search(r"(?:revision|revised plan|revised)\s*(\d+)", lowered)
    if match:
        return f"Revision {int(match.group(1))}"
    return text


def scurve_plan_name(financial_year, plan_version):
    year = str(financial_year or "").strip()
    version = normalize_scurve_plan_version(plan_version)
    return f"FY {year} | {version}"


def is_valid_scurve_plan_version(plan_version):
    text = normalize_scurve_plan_version(plan_version)
    if text == "Original Plan":
        return True
    import re
    return bool(re.fullmatch(r"Revision [1-9][0-9]*", text))


def scurve_fiscal_months(financial_year):
    start = financial_year_start(financial_year)
    end = start + 1
    return [
        *(f"{month}-{str(start)[-2:]}" for month in ("Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")),
        *(f"{month}-{str(end)[-2:]}" for month in ("Jan", "Feb", "Mar")),
    ]


def scurve_month_label(month_date):
    return month_date.strftime("%b-%y")


SCURVE_PLAN_VERSIONS = ["Original Plan", *[f"Revision {index}" for index in range(1, 11)]]
SCURVE_MONTH_ORDER = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]
SCURVE_MONTH_NUMBER = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}


def default_scurve_financial_year(today=None):
    today = today or date.today()
    start = today.year if today.month >= 4 else today.year - 1
    return f"{start}-{start + 1}"


def allowed_scurve_financial_years(today=None):
    current_start = financial_year_start(default_scurve_financial_year(today))
    return [f"{year}-{year + 1}" for year in range(current_start - 2, current_start + 2)]


def scurve_financial_year_options(today=None):
    years = allowed_scurve_financial_years(today)
    labels = ["Last FY - 2", "Last FY", "Current Financial Year", "Next Financial Year"]
    return [{"value": year, "label": f"{label} ({year})"} for year, label in zip(years, labels)]


def scurve_plan_display_label(plan_record):
    financial_year = plan_record.get("financial_year") or parse_scurve_plan_name(plan_record.get("plan_name"))[0]
    plan_version = normalize_scurve_plan_version(plan_record.get("plan_version") or parse_scurve_plan_name(plan_record.get("plan_name"))[1])
    active_mark = " (Active)" if plan_record.get("is_active") == "Y" else ""
    locked_mark = " - Locked" if plan_record.get("is_locked") == "Y" else " - Draft"
    return f"FY {financial_year} | {plan_version}{active_mark}{locked_mark}"


def month_label_date(month_label):
    month_text, _, year_text = str(month_label or "").partition("-")
    if month_text not in SCURVE_MONTH_ORDER or not year_text:
        return None
    try:
        return date(2000 + int(year_text), SCURVE_MONTH_NUMBER[month_text], 1)
    except ValueError:
        return None


def is_scurve_month_locked(activity, month_label):
    current = month_label_date(month_label)
    if not current:
        return True
    start = parse_date(activity.get("start_date"))
    finish = parse_date(activity.get("finish_date"))
    start_month = date(start.year, start.month, 1) if start else None
    finish_month = date(finish.year, finish.month, 1) if finish else None
    if start_month and current < start_month:
        return True
    if finish_month and current > finish_month:
        return True
    return False


def scurve_month_sort_key(month_label):
    month_text, _, year_text = str(month_label or "").partition("-")
    try:
        return int(year_text) * 12 + SCURVE_MONTH_NUMBER[month_text]
    except (ValueError, TypeError):
        return 0


def scurve_month_span(financial_year, activities=None, monthly_values=None):
    fiscal_months = set(scurve_fiscal_months(financial_year))
    months = set(fiscal_months)
    for monthly in (monthly_values or {}).values():
        months.update(
            month
            for month in (str(month or "").strip() for month in monthly.keys())
            if month in fiscal_months
        )

    fy_start = financial_year_start(financial_year)
    span_start = date(fy_start, 4, 1)
    span_finish = None
    for activity in activities or []:
        finish = parse_date(activity.get("expected_finish") or activity.get("finish_date"))
        if finish and (span_finish is None or finish > span_finish):
            span_finish = finish

    if span_finish:
        current = span_start
        finish_month = date(span_finish.year, span_finish.month, 1)
        while current <= finish_month:
            months.add(scurve_month_label(current))
            if current.month == 12:
                current = date(current.year + 1, 1, 1)
            else:
                current = date(current.year, current.month + 1, 1)
    return sorted(months, key=scurve_month_sort_key)


def build_scurve_ui_model(plan_records, activities_by_plan, monthly_by_plan):
    allowed_years = allowed_scurve_financial_years()
    plan_labels = {row["plan_name"]: scurve_plan_display_label(row) for row in plan_records}
    months_by_plan = {}
    planned_total_by_plan = {}
    month_lock_by_plan = {}
    plan_locked = {}
    plan_summaries = {}
    for plan_name, activities in activities_by_plan.items():
        record = next((row for row in plan_records if row["plan_name"] == plan_name), {})
        is_locked = record.get("is_locked") == "Y"
        plan_locked[plan_name] = is_locked
        financial_year = record.get("financial_year") or parse_scurve_plan_name(plan_name)[0] or default_scurve_financial_year()
        ordered_months = scurve_month_span(financial_year, activities, monthly_by_plan.get(plan_name) or {})
        months_by_plan[plan_name] = ordered_months
        plan_total = 0.0
        lock_rows = {}
        for activity in activities:
            activity_type = activity.get("activity_type") or ""
            monthly_values = monthly_by_plan.get(plan_name, {}).get(activity_type, {})
            activity_total = sum(optional_float(value, 0) or 0 for value in monthly_values.values())
            planned_total_by_plan.setdefault(plan_name, {})[activity_type] = activity_total
            plan_total += activity_total
            lock_rows[activity_type] = {month: is_locked or is_scurve_month_locked(activity, month) for month in ordered_months}
        month_lock_by_plan[plan_name] = lock_rows
        actual_total = sum(optional_float(activity.get("actuals_till_last_fy"), 0) or 0 for activity in activities)
        plan_summaries[plan_name] = {
            "financialYear": financial_year,
            "planVersion": record.get("plan_version") or parse_scurve_plan_name(plan_name)[1],
            "label": plan_labels.get(plan_name, plan_name),
            "months": ordered_months,
            "totalActivities": len(activities),
            "plannedTotal": plan_total,
            "actualTillLastFy": actual_total,
            "overallProgress": (actual_total / plan_total * 100) if plan_total else 0,
            "isLocked": is_locked,
            "isActive": record.get("is_active") == "Y",
        }
    return {
        "defaultFinancialYear": default_scurve_financial_year(),
        "allowedFinancialYears": allowed_years,
        "financialYearOptions": scurve_financial_year_options(),
        "planVersions": SCURVE_PLAN_VERSIONS,
        "planLabels": plan_labels,
        "planLocked": plan_locked,
        "monthsByPlan": months_by_plan,
        "plannedTotalByPlan": planned_total_by_plan,
        "monthLockByPlan": month_lock_by_plan,
        "planSummaries": plan_summaries,
    }


def scurve_actuals_till_last_fy_by_activity_type(cursor, project_id, financial_year, activity_types):
    fy_start = financial_year_start(financial_year)
    fy_start_date = date(fy_start, 4, 1)
    normalized_activity_types = sorted({
        str(activity_type or "").strip()
        for activity_type in activity_types
        if str(activity_type or "").strip()
    })
    if not normalized_activity_types:
        return {}
    cursor.execute(
        """
        SELECT a.activity_type,
               COALESCE(SUM(da.actual_qty), 0) AS actual_qty
        FROM daily_actuals da
        JOIN activities a ON a.id = da.activity_id
        WHERE a.project_id = %s
          AND a.activity_type = ANY(%s)
          AND NULLIF(da.actual_date, '')::date < %s
        GROUP BY a.activity_type
        """,
        (project_id, normalized_activity_types, fy_start_date),
    )
    return {
        str(row.get("activity_type") or ""): float(row.get("actual_qty") or 0)
        for row in cursor.fetchall()
    }


def daily_actuals_till_last_fy_by_activity_id(cursor, activity_ids, financial_year):
    fy_start = financial_year_start(financial_year)
    fy_start_date = date(fy_start, 4, 1)
    activity_ids = sorted({int(activity_id or 0) for activity_id in (activity_ids or []) if int(activity_id or 0)})
    if not activity_ids:
        return {}
    cursor.execute(
        """
        SELECT activity_id,
               COALESCE(SUM(actual_qty), 0) AS actual_qty
        FROM daily_actuals
        WHERE activity_id = ANY(%s)
          AND actual_date::date < %s
        GROUP BY activity_id
        """,
        (activity_ids, fy_start_date),
    )
    return {
        int(row.get("activity_id")): float(row.get("actual_qty") or 0)
        for row in cursor.fetchall()
    }


def daily_actuals_by_activity_type_between(cursor, project_id, activity_types, start_date=None, end_date=None):
    normalized_activity_types = sorted({
        str(activity_type or "").strip()
        for activity_type in activity_types
        if str(activity_type or "").strip()
    })
    if not normalized_activity_types:
        return {}
    clauses = [
        "a.project_id = %s",
        "a.activity_type = ANY(%s)",
    ]
    params = [project_id, normalized_activity_types]
    if start_date:
        clauses.append("da.actual_date::date >= %s")
        params.append(start_date)
    if end_date:
        clauses.append("da.actual_date::date <= %s")
        params.append(end_date)
    cursor.execute(
        f"""
        SELECT a.activity_type,
               COALESCE(SUM(da.actual_qty), 0) AS actual_qty
        FROM daily_actuals da
        JOIN activities a ON a.id = da.activity_id
        WHERE {' AND '.join(clauses)}
        GROUP BY a.activity_type
        """,
        tuple(params),
    )
    return {
        str(row.get("activity_type") or ""): float(row.get("actual_qty") or 0)
        for row in cursor.fetchall()
    }


def daily_actuals_by_normalized_activity_between(cursor, project_id, start_date=None, end_date=None):
    clauses = ["a.project_id = %s"]
    params = [project_id]
    if start_date:
        clauses.append("da.actual_date::date >= %s")
        params.append(start_date)
    if end_date:
        clauses.append("da.actual_date::date <= %s")
        params.append(end_date)
    cursor.execute(
        f"""
        SELECT a.activity_type,
               COALESCE(SUM(da.actual_qty), 0) AS actual_qty
        FROM daily_actuals da
        JOIN activities a ON a.id = da.activity_id
        WHERE {' AND '.join(clauses)}
        GROUP BY a.activity_type
        """,
        tuple(params),
    )
    actuals = {}
    for row in cursor.fetchall():
        key = normalize_activity_text(row.get("activity_type"))
        if not key:
            continue
        actuals[key] = actuals.get(key, 0.0) + float(row.get("actual_qty") or 0)
    return actuals


def scurve_monthly_values_for_plan(cursor, project_id, plan_name):
    cursor.execute(
        """
        SELECT activity_type, month, planned_qty
        FROM monthly_plans
        WHERE project_id=%s AND plan_name=%s
        ORDER BY id
        """,
        (project_id, plan_name),
    )
    monthly_rows = {}
    for row in cursor.fetchall():
        activity_type = row.get("activity_type") or ""
        month = row.get("month") or ""
        monthly_rows.setdefault(activity_type, {})[month] = row.get("planned_qty") or 0
    return monthly_rows


def ensure_scurve_plan_columns():
    conn = get_db_connection()
    cursor = conn.cursor()
    for column_name, column_type in (
        ("financial_year", "TEXT"),
        ("plan_version", "TEXT"),
        ("is_active", "TEXT DEFAULT 'N'"),
        ("is_locked", "TEXT DEFAULT 'Y'"),
    ):
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'plans'
              AND column_name = %s
            """,
            (column_name,),
        )
        if not cursor.fetchone():
            cursor.execute(f"ALTER TABLE plans ADD COLUMN {column_name} {column_type}")
    for column_name, column_type in (
        ("weight_percent", "REAL DEFAULT 10"),
        ("expected_finish", "TEXT"),
    ):
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'activities'
              AND column_name = %s
            """,
            (column_name,),
        )
        if not cursor.fetchone():
            cursor.execute(f"ALTER TABLE activities ADD COLUMN {column_name} {column_type}")
    cursor.execute("UPDATE activities SET weight_percent = 10 WHERE weight_percent IS NULL")
    cursor.execute("UPDATE activities SET expected_finish = finish_date WHERE COALESCE(expected_finish, '') = ''")
    cursor.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'daily_actuals'
          AND column_name = 'area_of_work'
        """
    )
    if not cursor.fetchone():
        cursor.execute("ALTER TABLE daily_actuals ADD COLUMN area_of_work TEXT")
    cursor.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'daily_actuals'
          AND column_name = 'remarks'
        """
    )
    if not cursor.fetchone():
        cursor.execute("ALTER TABLE daily_actuals ADD COLUMN remarks TEXT")
    for column_name, column_type in (
        ("month_target", "TEXT"),
        ("last_month_average", "REAL DEFAULT 0"),
        ("remarks", "TEXT"),
    ):
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'daily_progress_manpower'
              AND column_name = %s
            """,
            (column_name,),
        )
        if not cursor.fetchone():
            cursor.execute(f"ALTER TABLE daily_progress_manpower ADD COLUMN {column_name} {column_type}")
    cursor.execute("SELECT id, plan_name, financial_year, plan_version, is_locked FROM plans")
    for row in cursor.fetchall():
        financial_year, version = parse_scurve_plan_name(row.get("plan_name"))
        version = normalize_scurve_plan_version(row.get("plan_version") or version)
        cursor.execute(
            """
            UPDATE plans
            SET financial_year = COALESCE(NULLIF(financial_year, ''), %s),
                plan_version = %s,
                is_active = COALESCE(is_active, 'N'),
                is_locked = COALESCE(is_locked, 'Y')
            WHERE id = %s
            """,
            (financial_year, version, row["id"]),
        )
    conn.commit()
    conn.close()


def financial_year_start(value):
    text = str(value or "").strip()
    match = None
    import re
    match = re.search(r"(\d{4})\s*-\s*(\d{4})", text)
    if not match:
        year = date.today().year if date.today().month >= 4 else date.today().year - 1
        return year
    return int(match.group(1))


def financial_year_for_date(value):
    parsed = parse_date(value) or date.today()
    start = parsed.year if parsed.month >= 4 else parsed.year - 1
    return f"{start}-{start + 1}"


def scurve_month_bounds(month_label):
    month_start = month_label_date(month_label)
    if not month_start:
        return None, None
    if month_start.month == 12:
        return month_start, date(month_start.year + 1, 1, 1)
    return month_start, date(month_start.year, month_start.month + 1, 1)


def last_working_day_for_month(month_label):
    month_start, month_end = scurve_month_bounds(month_label)
    if not month_start or not month_end:
        return None
    current = month_end - timedelta(days=1)
    while current.weekday() >= 5:
        current -= timedelta(days=1)
    return current


def get_active_scurve_plan_for_fy(project_id, financial_year):
    ensure_scurve_plan_columns()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT plan_name
        FROM plans
        WHERE project_id=%s
          AND financial_year=%s
          AND COALESCE(is_active, 'N') = 'Y'
        ORDER BY id DESC
        LIMIT 1
        """,
        (project_id, financial_year),
    )
    row = cursor.fetchone()
    conn.close()
    return row["plan_name"] if row else None


def get_scurve_plan_for_entry_date(project_id, entry_date):
    financial_year = financial_year_for_date(entry_date)
    active_plan = get_active_scurve_plan_for_fy(project_id, financial_year)
    if active_plan:
        return active_plan
    ensure_scurve_plan_columns()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT plan_name
        FROM plans
        WHERE project_id=%s
          AND financial_year=%s
        ORDER BY
            CASE WHEN COALESCE(is_locked, 'N') = 'Y' THEN 0 ELSE 1 END,
            id DESC
        LIMIT 1
        """,
        (project_id, financial_year),
    )
    row = cursor.fetchone()
    conn.close()
    return row["plan_name"] if row else None


def scurve_plan_entry_status(project_id, plan_name, entry_date):
    financial_year = financial_year_for_date(entry_date)
    status = {
        "financialYear": financial_year,
        "planName": plan_name or "",
        "exists": False,
        "isLocked": False,
        "isActive": False,
        "isComplete": False,
        "canEnter": False,
        "message": f"Confirm S-Curve planning for FY {financial_year} before Daily Progress entry.",
    }
    if not plan_name:
        status["message"] = f"No S-Curve plan found for FY {financial_year}."
        return status

    ensure_scurve_plan_columns()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT plan_name,
               financial_year,
               COALESCE(is_locked, 'N') AS is_locked,
               COALESCE(is_active, 'N') AS is_active
        FROM plans
        WHERE project_id=%s AND plan_name=%s
        LIMIT 1
        """,
        (project_id, plan_name),
    )
    plan = cursor.fetchone()
    if not plan:
        conn.close()
        status["message"] = "Selected S-Curve plan was not found for this project."
        return status

    plan_financial_year = plan.get("financial_year") or parse_scurve_plan_name(plan.get("plan_name"))[0]
    status.update({
        "exists": True,
        "financialYear": plan_financial_year or financial_year,
        "isLocked": plan.get("is_locked") == "Y",
        "isActive": plan.get("is_active") == "Y",
    })
    if plan_financial_year != financial_year:
        conn.close()
        status["message"] = f"Selected date belongs to FY {financial_year}; choose or confirm a plan for that financial year."
        return status

    cursor.execute(
        """
        WITH monthly_totals AS (
            SELECT activity_type, COALESCE(SUM(planned_qty), 0) AS planned_qty
            FROM monthly_plans
            WHERE project_id=%s AND plan_name=%s
            GROUP BY activity_type
        )
        SELECT COUNT(*) AS activity_count,
               SUM(
                   CASE
                       WHEN COALESCE(a.scope_qty, 0) > 0
                        AND COALESCE(a.actuals_till_last_fy, 0) + COALESCE(mt.planned_qty, 0) < COALESCE(a.scope_qty, 0)
                       THEN 1 ELSE 0
                   END
               ) AS incomplete_count
        FROM activities a
        LEFT JOIN monthly_totals mt ON mt.activity_type = a.activity_type
        WHERE a.project_id=%s AND a.plan_name=%s
        """,
        (project_id, plan_name, project_id, plan_name),
    )
    row = cursor.fetchone() or {}
    conn.close()

    activity_count = int(row.get("activity_count") or 0)
    incomplete_count = int(row.get("incomplete_count") or 0)
    status["isComplete"] = activity_count > 0 and incomplete_count == 0
    if not status["isLocked"]:
        status["message"] = f"S-Curve planning for FY {financial_year} is still in draft. Save & Lock the plan before Daily Progress entry."
    elif not status["isComplete"]:
        status["message"] = f"S-Curve planning for FY {financial_year} is not complete. Planned total must cover scope for every activity."
    else:
        status["canEnter"] = True
        status["message"] = f"Daily Progress entry is allowed for FY {financial_year}."
    return status


def project_has_active_scurve_plan(project_id):
    ensure_scurve_plan_columns()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT 1
        FROM plans
        WHERE project_id=%s
          AND COALESCE(is_active, 'N') = 'Y'
          AND COALESCE(is_locked, 'N') = 'Y'
        LIMIT 1
        """,
        (project_id,),
    )
    exists = bool(cursor.fetchone())
    conn.close()
    return exists


def bulk_project_active_scurve_plan_flags(project_ids):
    ids = sorted({int(project_id or 0) for project_id in (project_ids or []) if int(project_id or 0)})
    flags = {project_id: False for project_id in ids}
    if not ids:
        return flags
    ensure_scurve_plan_columns()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT DISTINCT project_id
        FROM plans
        WHERE project_id = ANY(%s)
          AND COALESCE(is_active, 'N') = 'Y'
          AND COALESCE(is_locked, 'N') = 'Y'
        """,
        (ids,),
    )
    for row in cursor.fetchall():
        flags[int(row["project_id"])] = True
    conn.close()
    return flags


def bulk_project_completed_planning_flags(project_ids):
    ids = sorted({int(project_id or 0) for project_id in (project_ids or []) if int(project_id or 0)})
    flags = {project_id: False for project_id in ids}
    if not ids:
        return flags
    ensure_scurve_plan_columns()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        WITH active_plans AS (
            SELECT DISTINCT ON (project_id)
                   project_id,
                   plan_name
            FROM plans
            WHERE project_id = ANY(%s)
              AND COALESCE(is_active, 'N') = 'Y'
              AND COALESCE(is_locked, 'N') = 'Y'
            ORDER BY project_id, id DESC
        ),
        monthly_totals AS (
            SELECT project_id,
                   plan_name,
                   activity_type,
                   COALESCE(SUM(planned_qty), 0) AS planned_qty
            FROM monthly_plans
            WHERE project_id = ANY(%s)
            GROUP BY project_id, plan_name, activity_type
        ),
        activity_status AS (
            SELECT a.project_id,
                   COUNT(*) AS activity_count,
                   SUM(
                       CASE
                           WHEN COALESCE(a.scope_qty, 0) > 0
                            AND COALESCE(a.actuals_till_last_fy, 0) + COALESCE(mt.planned_qty, 0) < COALESCE(a.scope_qty, 0)
                           THEN 1 ELSE 0
                       END
                   ) AS incomplete_count
            FROM activities a
            LEFT JOIN active_plans ap ON ap.project_id = a.project_id
            LEFT JOIN monthly_totals mt
                   ON mt.project_id = a.project_id
                  AND mt.plan_name = a.plan_name
                  AND mt.activity_type = a.activity_type
            WHERE a.project_id = ANY(%s)
              AND (ap.plan_name IS NULL OR a.plan_name = ap.plan_name)
            GROUP BY a.project_id
        )
        SELECT project_id,
               activity_count,
               incomplete_count
        FROM activity_status
        """,
        (ids, ids, ids),
    )
    for row in cursor.fetchall():
        project_id = int(row["project_id"])
        flags[project_id] = int(row.get("activity_count") or 0) > 0 and int(row.get("incomplete_count") or 0) == 0
    conn.close()
    return flags


def parse_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%y", "%d-%m-%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def add_months(value, months):
    if value is None or months is None:
        return None
    try:
        month_value = float(months)
    except (TypeError, ValueError):
        return None
    month_count = int(month_value)
    month_index = value.month - 1 + month_count
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, monthrange(year, month)[1])
    result = date(year, month, day)
    fractional_month = month_value - month_count
    if abs(fractional_month) > 1e-9:
        result += timedelta(days=round(fractional_month * 30))
    return result


def calculate_contract_completion(effective_date, schedule_months):
    effective = parse_date(effective_date)
    return add_months(effective, schedule_months)


def planned_qty(activity, period_start=None, period_end=None):
    scope = float(activity.get("scope_qty") or 0)
    start = parse_date(activity.get("start_date"))
    finish = parse_date(activity.get("finish_date"))
    if not start or not finish or scope <= 0:
        return 0.0
    if finish < start:
        finish = start
    period_start = period_start or start
    period_end = period_end or date.today()
    actual_start = max(start, period_start)
    actual_end = min(finish, period_end)
    if actual_end < actual_start:
        return 0.0
    total_days = (finish - start).days + 1
    period_days = (actual_end - actual_start).days + 1
    return scope * (period_days / max(1, total_days))


def percent_of(value, base):
    return (float(value or 0) / float(base or 0) * 100) if float(base or 0) else 0.0


def weighted_progress_percent(rows, value_key):
    rows = normalised_summary_weight_rows([row for row in (rows or []) if row.get("source") != "capex"])
    weighted_total = 0.0
    has_weight = False
    for row in rows:
        raw_weight = float(row.get("weightPercent") or 0)
        weight_fraction = raw_weight / 100 if raw_weight > 1 else raw_weight
        if weight_fraction <= 0:
            continue
        has_weight = True
        scope = float(row.get("scope") or 0)
        qty = float(row.get(value_key) or 0)
        if scope:
            weighted_total += weight_fraction * (qty / scope)
    if has_weight:
        return weighted_total * 100
    total_scope = sum(float(row.get("scope") or 0) for row in rows)
    return percent_of(sum(float(row.get(value_key) or 0) for row in rows), total_scope)


def summary_activity_bucket(row):
    parent = str(row.get("parent") or "").lower()
    activity = str(row.get("activity") or row.get("category") or "").lower()
    if "design" in parent or "design" in activity or "engineering" in activity:
        return "design"
    if "civil" in parent or "civil" in activity:
        return "civil"
    if "erection" in parent and ("steel" in activity or "structur" in activity):
        return "structural_erection"
    if ("supply" in parent or "delivery" in parent) and ("steel" in activity or "structur" in activity):
        return "structural_supply"
    if ("supply" in parent or "delivery" in parent) and ("electrical" in activity or "equipment" in activity):
        return "equipment_supply"
    if "erection" in parent and ("electrical" in activity or "equipment" in activity):
        return "equipment_erection"
    return ""


def normalised_summary_weight_rows(rows):
    rows = [dict(row) for row in (rows or [])]
    by_bucket = {summary_activity_bucket(row): row for row in rows if summary_activity_bucket(row)}
    equipment_supply = by_bucket.get("equipment_supply")
    structural_erection = by_bucket.get("structural_erection")
    if equipment_supply and structural_erection:
        equipment_weight = float(equipment_supply.get("weightPercent") or 0)
        structural_erection_weight = float(structural_erection.get("weightPercent") or 0)
        if equipment_weight < structural_erection_weight:
            equipment_supply["weightPercent"], structural_erection["weightPercent"] = structural_erection_weight, equipment_weight
    return rows


def build_dpr_summary_model(scope_rows, report_date):
    physical_rows = [row for row in (scope_rows or []) if row.get("source") != "capex"]
    total_scope = sum(float(row.get("scope") or 0) for row in physical_rows)
    total_ftm_plan = sum(float(row.get("ftmPlan") or 0) for row in physical_rows)
    total_ftm_actual = sum(float(row.get("ftmActual") or 0) for row in physical_rows)
    total_last_fy_plan = sum(float(row.get("lastFyPlan") or 0) for row in physical_rows)
    total_last_fy_actual = sum(float(row.get("lastFyActual") or 0) for row in physical_rows)
    total_current_fy_plan = sum(float(row.get("currentFyPlan") or 0) for row in physical_rows)
    total_current_fy_actual = sum(float(row.get("currentFyActual") or 0) for row in physical_rows)
    total_cumulative_plan = sum(float(row.get("cumulativePlan") or 0) for row in physical_rows)
    total_cumulative_actual = sum(float(row.get("cumulativeActual") or 0) for row in physical_rows)
    last_fy_plan_percent = weighted_progress_percent(scope_rows, "lastFyPlan")
    last_fy_actual_percent = weighted_progress_percent(scope_rows, "lastFyActual")
    current_fy_plan_percent = weighted_progress_percent(scope_rows, "currentFyPlan")
    current_fy_actual_percent = weighted_progress_percent(scope_rows, "currentFyActual")
    planned_percent = weighted_progress_percent(scope_rows, "cumulativePlan")
    actual_percent = weighted_progress_percent(scope_rows, "cumulativeActual")
    ftm_plan_percent = weighted_progress_percent(scope_rows, "ftmPlan")
    ftm_actual_percent = weighted_progress_percent(scope_rows, "ftmActual")
    summary_rows = [{
        "category": "Overall Progress",
        "scope": total_scope or 100,
        "uom": "" if total_scope else "%",
        "weightPercent": sum(float(row.get("weightPercent") or 0) for row in physical_rows),
        "ftmPlan": total_ftm_plan,
        "ftmActual": total_ftm_actual,
        "lastFyPlan": total_last_fy_plan,
        "lastFyActual": total_last_fy_actual,
        "currentFyPlan": total_current_fy_plan,
        "currentFyActual": total_current_fy_actual,
        "cumulativePlan": total_cumulative_plan,
        "cumulativeActual": total_cumulative_actual,
        "ftmPlanPercent": ftm_plan_percent,
        "ftmActualPercent": ftm_actual_percent,
        "lastFyPlanPercent": last_fy_plan_percent,
        "lastFyActualPercent": last_fy_actual_percent,
        "currentFyPlanPercent": current_fy_plan_percent,
        "currentFyActualPercent": current_fy_actual_percent,
        "cumulativePlanPercent": planned_percent,
        "cumulativeActualPercent": actual_percent,
        "overall": True,
    }]
    for row in scope_rows:
        summary_rows.append({
            **row,
            "category": row.get("activity") or row.get("category") or "Other Progress",
            "ftmPlanPercent": percent_of(row.get("ftmPlan"), row.get("scope")),
            "ftmActualPercent": percent_of(row.get("ftmActual"), row.get("scope")),
            "lastFyPlanPercent": percent_of(row.get("lastFyPlan"), row.get("scope")),
            "lastFyActualPercent": percent_of(row.get("lastFyActual"), row.get("scope")),
            "currentFyPlanPercent": percent_of(row.get("currentFyPlan"), row.get("scope")),
            "currentFyActualPercent": percent_of(row.get("currentFyActual"), row.get("scope")),
            "cumulativePlanPercent": percent_of(row.get("cumulativePlan"), row.get("scope")),
            "cumulativeActualPercent": percent_of(row.get("cumulativeActual"), row.get("scope")),
            "overall": False,
        })
    financial_year = financial_year_for_date(report_date)
    return {
        "financialYearLabel": f"FY {financial_year}",
        "reportDate": report_date.isoformat(),
        "selectedMonthEnd": date(report_date.year, report_date.month, monthrange(report_date.year, report_date.month)[1]).isoformat(),
        "totals": {
            "scope": total_scope,
            "ftmPlan": total_ftm_plan,
            "ftmActual": total_ftm_actual,
            "lastFyPlan": total_last_fy_plan,
            "lastFyActual": total_last_fy_actual,
            "currentFyPlan": total_current_fy_plan,
            "currentFyActual": total_current_fy_actual,
            "cumulativePlan": total_cumulative_plan,
            "cumulativeActual": total_cumulative_actual,
            "plannedPercent": planned_percent,
            "actualPercent": actual_percent,
            "ftmPlanPercent": ftm_plan_percent,
            "ftmActualPercent": ftm_actual_percent,
            "lastFyPlanPercent": last_fy_plan_percent,
            "lastFyActualPercent": last_fy_actual_percent,
            "currentFyPlanPercent": current_fy_plan_percent,
            "currentFyActualPercent": current_fy_actual_percent,
        },
        "kpis": [
            {"label": "Plan Vs Actual Till Last FY", "plan": last_fy_plan_percent, "actual": last_fy_actual_percent, "tone": "green"},
            {"label": "Plan Vs Actual Current FY", "plan": current_fy_plan_percent, "actual": current_fy_actual_percent, "tone": "indigo"},
            {"label": "Cumulative Plan Vs Actual", "plan": planned_percent, "actual": actual_percent, "tone": "amber"},
        ],
        "summaryRows": summary_rows,
    }


def project_name_exists(name):
    ensure_project_archive_column()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT 1 FROM projects WHERE LOWER(project_name)=LOWER(%s) AND COALESCE(project_archived, 'N') <> 'Y'",
        (str(name or "").strip(),),
    )
    exists = bool(cursor.fetchone())
    conn.close()
    return exists


def registration_row(project, sr_no, depth=0, has_children=False):
    status = get_project_status(dict(project))
    prefix = ("    " * max(0, int(depth or 0))) + ("- " if depth else "")
    gross_cost = project.get("plant_amr_gross_cost") if project.get("project_type") == "Plant Level AMR" else None
    if gross_cost in (None, ""):
        gross_cost = project.get("stage2_cost")
    if gross_cost in (None, ""):
        gross_cost = project.get("stage1_cost")
    if gross_cost in (None, ""):
        gross_cost = project.get("formulation_cost")
    if gross_cost in (None, ""):
        gross_cost = project.get("gross_cost")
    return {
        "id": project["id"],
        "sr": sr_no,
        "unique_id": project["unique_id"],
        "project_name": f"{prefix}{project['project_name']}",
        "raw_project_name": project["project_name"],
        "gross_cost": gross_cost,
        "registration_date": to_display_date(project.get("registration_date")),
        "status": status,
        "project_type": project.get("project_type"),
        "parent_project_id": project.get("parent_project_id"),
        "has_children": has_children,
        "is_leaf_project": not has_children,
    }


def build_registration_tables():
    ensure_project_archive_column()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT p.*, d.gross_cost AS plant_amr_gross_cost
        FROM projects p
        LEFT JOIN plant_level_amr_details d ON d.project_id = p.id
        WHERE COALESCE(p.project_archived, 'N') <> 'Y'
        ORDER BY p.id DESC
        """
    )
    all_projects = [dict(project) for project in cursor.fetchall()]
    conn.close()

    def project_sort_key(project):
        return int(project.get("id") or 0)

    def populate(project_type):
        project_rows = [project for project in all_projects if project.get("project_type") == project_type]
        ids_in_view = {int(project.get("id") or 0) for project in project_rows}
        children_by_parent = {}
        roots = []
        for project in project_rows:
            parent_id = int(project.get("parent_project_id") or 0) or None
            if parent_id and parent_id in ids_in_view:
                children_by_parent.setdefault(parent_id, []).append(project)
            else:
                roots.append(project)
        roots.sort(key=project_sort_key, reverse=True)
        for child_rows in children_by_parent.values():
            child_rows.sort(key=project_sort_key, reverse=True)
        rows = []
        visited = set()
        serial = 1

        def append_row(project, depth=0):
            nonlocal serial
            project_id = int(project.get("id") or 0)
            if project_id in visited:
                return
            visited.add(project_id)
            has_children = bool(children_by_parent.get(project_id))
            rows.append(registration_row(project, serial if not has_children else "", depth, has_children))
            if not has_children:
                serial += 1
            for child in children_by_parent.get(project_id, []):
                append_row(child, depth + 1)

        for root_project in roots:
            append_row(root_project)
        for project in sorted(project_rows, key=project_sort_key, reverse=True):
            if int(project.get("id") or 0) not in visited:
                append_row(project)
        return rows

    return {
        "corporate": populate("Corporate AMR"),
        "plant": populate("Plant Level AMR"),
    }


CAPEX_PATH = Path(os.path.expanduser("~")) / "Documents" / "New project" / "capex_saved_data.json"
CAPEX_AMR_PARENT = "2. AMR"
CAPEX_AMR_BUCKET_ORDER = (
    "2.1 Completed AMR Schemes >30 Cr.",
    "2.2 Ongoing AMR Schemes >30 Cr.",
    "2.3 Plant Level AMR Schemes <30 Cr.",
)


def capex_default_rows():
    rows = []
    for index, row in enumerate(DEFAULT_ROWS, start=1):
        rows.append({
            "row_id": index,
            "values": {**capex_empty_values(), **dict(row.get("values") or {})},
            "indent": int(row.get("indent") or 0),
            "level": "Header" if int(row.get("indent") or 0) == 0 else "SubHeader",
            "children": [],
            "collapsed": bool(row.get("collapsed", False)),
            "imported_for": row.get("imported_for"),
        })
    return sync_capex_rows(rows)


def capex_project_gross_cost(project):
    gross_cost = project.get("stage2_cost")
    if gross_cost in (None, ""):
        gross_cost = project.get("stage1_cost")
    if gross_cost in (None, ""):
        return ""
    try:
        return f"{float(gross_cost):.2f}"
    except (TypeError, ValueError):
        return ""


def capex_project_bucket(project):
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


def capex_number_text(value, blank_zero=False):
    parsed = capex_parse_number(value)
    if parsed is None:
        return ""
    if blank_zero and abs(parsed) < 0.000001:
        return ""
    return f"{parsed:.2f}"


def capex_plant_level_values_by_project():
    try:
        dashboard = build_plant_level_amr_dashboard()
    except Exception:
        return {}

    values_by_project = {}
    edc_idc = dashboard.get("edc_idc") or {}
    if edc_idc:
        edc_values = {
            "Gross Cost": capex_number_text(edc_idc.get("gross_cost_cr"), blank_zero=True),
            "Cummulative Expenditure till Last FY": capex_number_text(edc_idc.get("actual_till_last_fy_cr"), blank_zero=True),
            "BE (FY)": capex_number_text(edc_idc.get("be_cr"), blank_zero=True),
            "RE (FY)": capex_number_text(edc_idc.get("re_cr"), blank_zero=True),
        }
        for monthly in edc_idc.get("monthly") or []:
            month = str(monthly.get("month") or "").strip()
            if month not in CAPEX_MONTHS:
                continue
            edc_values[f"{month} BE"] = capex_number_text(monthly.get("be"), blank_zero=True)
            edc_values[f"{month} RE"] = capex_number_text(monthly.get("re"), blank_zero=True)
            edc_values[f"{month} Actual"] = capex_number_text(monthly.get("actual"), blank_zero=True)
        values_by_project["edc_idc"] = edc_values

    for project in dashboard.get("projects") or []:
        try:
            project_id = int(project.get("id") or 0)
        except (TypeError, ValueError):
            project_id = 0
        if not project_id:
            continue

        values = {
            "Gross Cost": capex_number_text(project.get("gross_cost_cr"), blank_zero=True),
            "Cummulative Expenditure till Last FY": capex_number_text(project.get("actual_till_last_fy_cr"), blank_zero=True),
            "BE (FY)": capex_number_text(project.get("be_cr"), blank_zero=True),
            "RE (FY)": capex_number_text(project.get("re_cr"), blank_zero=True),
        }
        for monthly in project.get("monthly") or []:
            month = str(monthly.get("month") or "").strip()
            if month not in CAPEX_MONTHS:
                continue
            values[f"{month} BE"] = capex_number_text(monthly.get("be"), blank_zero=True)
            values[f"{month} RE"] = capex_number_text(monthly.get("re"), blank_zero=True)
            values[f"{month} Actual"] = capex_number_text(monthly.get("actual"), blank_zero=True)

        values_by_project[project_id] = values
    return values_by_project


def capex_imported_for(row):
    try:
        return int(row.get("imported_for") or 0)
    except (TypeError, ValueError):
        return 0


def normalize_capex_plan_version(plan_version):
    text = str(plan_version or "Original Plan").strip()
    if text.lower() == "original plan":
        return "Original Plan"
    if text.lower() == "final approved plan":
        return "Final Approved Plan"
    lowered = text.lower().replace("revised plan-", "revision ")
    if lowered.startswith("revision"):
        suffix = "".join(char for char in lowered.replace("revision", "").strip() if char.isdigit())
        if suffix:
            return f"Revision {int(suffix)}"
    return text


def capex_plan_key(financial_year, plan_version="Original Plan", plan_type="BE"):
    return f"{financial_year} | {normalize_capex_plan_version(plan_version)} | {plan_type}"


def capex_planning_column_labels():
    base = [label for label, _, _ in BASE_COLUMNS]
    monthly = [f"{month} {subheader}" for month in CAPEX_MONTHS for subheader in ("BE", "RE")]
    return base + monthly


def capex_all_column_labels():
    return {label for label, _, _ in ALL_COLUMNS} | set(capex_planning_column_labels())


def capex_empty_values():
    values = empty_values()
    for label in capex_planning_column_labels():
        values.setdefault(label, "")
    return values


def capex_normalize_indent(indent):
    try:
        return max(0, int(indent or 0))
    except (TypeError, ValueError):
        return 0


def capex_level(indent):
    indent = capex_normalize_indent(indent)
    if indent <= 0:
        return "Header"
    if indent == 1:
        return "SubHeader"
    return "Item"


def sync_capex_rows(rows):
    rows = list(rows or [])
    for row in rows:
        row["row_id"] = int(row.get("row_id") or 0)
        row["values"] = {**capex_empty_values(), **(row.get("values") or {})}
        row["indent"] = capex_normalize_indent(row.get("indent"))
        row["level"] = capex_level(row["indent"])
        row["children"] = []
    for index, row in enumerate(rows):
        child_indent = row["indent"] + 1
        for child in rows[index + 1:]:
            if child["indent"] <= row["indent"]:
                break
            if child["indent"] == child_indent:
                row["children"].append(child["row_id"])
    return rows


def clone_capex_rows(rows):
    return sync_capex_rows([
        {
            "row_id": int(row.get("row_id") or 0),
            "values": dict(row.get("values") or {}),
            "indent": capex_normalize_indent(row.get("indent")),
            "level": row.get("level"),
            "children": list(row.get("children") or []),
            "collapsed": bool(row.get("collapsed", False)),
            "imported_for": row.get("imported_for"),
            "source_project_id": row.get("source_project_id"),
        }
        for row in rows or []
    ])


def capex_sync_project_rows(rows):
    rows = sync_capex_rows(rows)
    parent_index = next(
        (
            index
            for index, row in enumerate(rows)
            if str((row.get("values") or {}).get("CAPEX Plan (FY)") or "").strip() == CAPEX_AMR_PARENT
        ),
        None,
    )
    if parent_index is None:
        return rows

    parent_row = rows[parent_index]
    parent_id = int(parent_row.get("row_id") or 0)
    parent_indent = int(parent_row.get("indent") or 0)

    existing_import_values = {}
    existing_import_order_by_bucket = {}

    def imported_row_key(row):
        values = dict(row.get("values") or {})
        source_project_id = row.get("source_project_id")
        if source_project_id not in (None, ""):
            return f"id:{source_project_id}"
        label = str(values.get("CAPEX Plan (FY)") or "").strip()
        return f"name:{label.casefold()}" if label else ""

    direct_bucket_indexes = [
        index
        for index, row in enumerate(rows)
        if index > parent_index
        and int(row.get("indent") or 0) == parent_indent + 1
        and str((row.get("values") or {}).get("CAPEX Plan (FY)") or "").strip() in CAPEX_AMR_BUCKET_ORDER
    ]
    for bucket_index in direct_bucket_indexes:
        bucket_name = str((rows[bucket_index].get("values") or {}).get("CAPEX Plan (FY)") or "").strip()
        _, bucket_end = capex_row_block(rows, rows[bucket_index]["row_id"])
        order = []
        for scan_index in range(bucket_index + 1, bucket_end + 1):
            if int(rows[scan_index].get("indent") or 0) != parent_indent + 2:
                continue
            key = imported_row_key(rows[scan_index])
            if key:
                order.append(key)
        existing_import_order_by_bucket[bucket_name] = order

    for row in rows:
        if capex_imported_for(row) != parent_id:
            continue
        values = dict(row.get("values") or {})
        label = str(values.get("CAPEX Plan (FY)") or "").strip()
        source_project_id = row.get("source_project_id")
        if source_project_id not in (None, ""):
            existing_import_values[f"id:{source_project_id}"] = values
        if label:
            existing_import_values[f"name:{label.casefold()}"] = values

    rows = [
        row
        for row in rows
        if capex_imported_for(row) != parent_id
    ]
    rows = sync_capex_rows(rows)
    parent_index = next(
        (
            index
            for index, row in enumerate(rows)
            if int(row.get("row_id") or 0) == parent_id
        ),
        None,
    )
    if parent_index is None:
        return rows

    ensure_project_archive_column()
    projects = [dict(project) for project in get_all_projects()]
    projects_by_id = {
        int(project.get("id") or 0): project
        for project in projects
        if project.get("id")
    }
    children_by_parent = {}
    root_projects = []
    for project in projects:
        try:
            parent_project_id = int(project.get("parent_project_id") or 0) or None
        except (TypeError, ValueError):
            parent_project_id = None
        if parent_project_id and parent_project_id in projects_by_id:
            children_by_parent.setdefault(parent_project_id, []).append(project)
        else:
            root_projects.append(project)

    def project_sort_key(project):
        return int(project.get("id") or 0)

    root_projects.sort(key=project_sort_key, reverse=True)
    for child_projects in children_by_parent.values():
        child_projects.sort(key=project_sort_key, reverse=True)

    bucket_projects = {bucket_name: [] for bucket_name in CAPEX_AMR_BUCKET_ORDER}
    for project in root_projects:
        bucket_name = capex_project_bucket(project)
        if bucket_name:
            bucket_projects[bucket_name].append(project)

    plant_level_values_by_project = capex_plant_level_values_by_project()
    next_row_id = max([int(row.get("row_id") or 0) for row in rows] or [0]) + 1

    def make_project_row(project, indent):
        nonlocal next_row_id
        project_id = int(project.get("id") or 0)
        label = str(project.get("project_name") or "").strip()
        values = dict(existing_import_values.get(f"id:{project_id}") or existing_import_values.get(f"name:{label.casefold()}") or {})
        values = {**capex_empty_values(), **values}
        values["CAPEX Plan (FY)"] = label
        if str(project.get("project_type") or "").strip() == "Plant Level AMR":
            values.update({
                key: value
                for key, value in plant_level_values_by_project.get(project_id, {}).items()
                if value not in (None, "")
            })
        else:
            gross_cost = capex_project_gross_cost(project)
            if gross_cost:
                values["Gross Cost"] = gross_cost
        row = {
            "row_id": next_row_id,
            "values": values,
            "indent": indent,
            "level": capex_level(indent),
            "children": [],
            "collapsed": False,
            "imported_for": parent_id,
            "source_project_id": project_id or None,
        }
        next_row_id += 1
        return row

    def make_edc_idc_row(indent):
        nonlocal next_row_id
        label = "EDC & IDC"
        source_key = "edc_idc"
        values = dict(existing_import_values.get(f"id:{source_key}") or existing_import_values.get(f"name:{label.casefold()}") or {})
        values = {**capex_empty_values(), **values}
        values["CAPEX Plan (FY)"] = label
        # EDC/IDC is owned by Plant Level AMR. Always refresh these cells from
        # that source, including blanks, so stale zero values do not linger.
        for key, value in plant_level_values_by_project.get(source_key, {}).items():
            values[key] = value or ""
        row = {
            "row_id": next_row_id,
            "values": values,
            "indent": indent,
            "level": capex_level(indent),
            "children": [],
            "collapsed": False,
            "imported_for": parent_id,
            "source_project_id": source_key,
        }
        next_row_id += 1
        return row

    def find_bucket_index(bucket_name):
        direct_children = capex_direct_child_indexes(rows, parent_index)
        return next(
            (
                index
                for index in direct_children
                if str((rows[index].get("values") or {}).get("CAPEX Plan (FY)") or "").strip() == bucket_name
            ),
            None,
        )

    for bucket_name in CAPEX_AMR_BUCKET_ORDER:
        bucket_index = find_bucket_index(bucket_name)
        if bucket_index is None:
            continue
        _, insert_at = capex_row_block(rows, rows[bucket_index]["row_id"])
        insert_at += 1

        def build_project_tree(project, depth=0):
            project_rows = [make_project_row(project, parent_indent + 2 + depth)]
            project_id = int(project.get("id") or 0)
            for child_project in children_by_parent.get(project_id, []):
                project_rows.extend(build_project_tree(child_project, depth + 1))
            return project_rows

        new_rows = []
        row_blocks = []
        for project in bucket_projects.get(bucket_name, []):
            row_blocks.append(build_project_tree(project))
        if bucket_name == "2.3 Plant Level AMR Schemes <30 Cr.":
            row_blocks.append([make_edc_idc_row(parent_indent + 2)])
        existing_order = existing_import_order_by_bucket.get(bucket_name) or []
        if existing_order:
            order_index = {key: index for index, key in enumerate(existing_order)}
            row_blocks.sort(
                key=lambda block: (
                    order_index.get(imported_row_key(block[0]), len(order_index) + 1000),
                    str((block[0].get("values") or {}).get("CAPEX Plan (FY)") or "").casefold(),
                )
            )
        for block in row_blocks:
            new_rows.extend(block)
        if new_rows:
            rows[insert_at:insert_at] = new_rows
            rows = sync_capex_rows(rows)

    return sync_capex_rows(rows)


def capex_monthly_total(values, subheader):
    total = 0.0
    has_value = False
    for month in CAPEX_MONTHS:
        raw = values.get(f"{month} {subheader}", "")
        try:
            if str(raw).strip() == "":
                continue
            total += float(raw)
            has_value = True
        except (TypeError, ValueError):
            pass
    return f"{total:.2f}" if has_value else ""


def capex_parse_number(value):
    text = str(value if value is not None else "").replace(",", "").strip()
    if text == "":
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def capex_direct_child_indexes(rows, row_index):
    row = rows[row_index]
    indexes = []
    child_indent = int(row.get("indent") or 0) + 1
    for index in range(row_index + 1, len(rows)):
        if int(rows[index].get("indent") or 0) <= int(row.get("indent") or 0):
            break
        if int(rows[index].get("indent") or 0) == child_indent:
            indexes.append(index)
    return indexes


def capex_display_row(rows, row_index, columns):
    row = rows[row_index]
    values = dict(row.get("values") or {})
    display = values.copy()
    children = capex_direct_child_indexes(rows, row_index)
    if not children:
        display["BE (FY)"] = capex_monthly_total(values, "BE")
        display["RE (FY)"] = capex_monthly_total(values, "RE")
        return display
    for column in columns:
        if column == "CAPEX Plan (FY)":
            continue
        total = 0.0
        has_value = False
        for child_index in children:
            child_display = capex_display_row(rows, child_index, columns)
            parsed = capex_parse_number(child_display.get(column))
            if parsed is None:
                continue
            total += parsed
            has_value = True
        if has_value:
            display[column] = f"{total:.2f}"
    return display


def capex_display_rows(rows, columns):
    rows = sync_capex_rows(rows)
    return [
        {
            **row,
            "display": capex_display_row(rows, index, columns),
        }
        for index, row in enumerate(rows)
    ]


def capex_validation_message(rows):
    for row in sync_capex_rows(rows):
        if row.get("level") != "Item":
            continue
        values = row.get("values", {})
        be_saved = capex_parse_number(values.get("BE (FY)"))
        re_saved = capex_parse_number(values.get("RE (FY)"))
        gross_cost = capex_parse_number(values.get("Gross Cost"))
        be_total = capex_parse_number(capex_monthly_total(values, "BE")) or 0
        re_total = capex_parse_number(capex_monthly_total(values, "RE")) or 0
        actual_total = capex_parse_number(capex_monthly_total(values, "Actual")) or 0
        if be_saved is not None and abs(be_saved - be_total) > 0.01:
            return "Mismatch detected: BE (FY) does not match monthly BE values."
        if re_saved is not None and abs(re_saved - re_total) > 0.01:
            return "Mismatch detected: RE (FY) does not match monthly RE values."
        if gross_cost is not None and be_total > gross_cost + 0.01:
            return "Mismatch detected: BE total cannot exceed Gross Cost for individual projects."
        if gross_cost is not None and re_total > gross_cost + 0.01:
            return "Mismatch detected: RE total cannot exceed Gross Cost for individual projects."
        plan_total = re_total if re_total else be_total
        if plan_total and actual_total > plan_total + 0.01:
            return "Mismatch detected: Actual CAPEX cannot exceed BE/RE value for individual projects."
    return "Validation OK: project totals and hierarchy roll-ups are aligned"


def capex_top_level_total(display_rows, column):
    return sum(
        capex_parse_number(row.get("display", {}).get(column)) or 0
        for row in display_rows
        if int(row.get("indent") or 0) == 0
    )


def capex_actual_till_date_total(display_rows):
    total = 0.0
    for row in display_rows:
        if int(row.get("indent") or 0) != 0:
            continue
        for month in CAPEX_MONTHS:
            total += capex_parse_number(row.get("display", {}).get(f"{month} Actual")) or 0
    return total


def capex_project_financials_by_project():
    try:
        payload = read_capex_payload()
    except Exception:
        return {}

    plans = payload.get("plans") or {}
    plan_name = next(
        (name for name, plan in plans.items() if plan.get("effective")),
        payload.get("active_plan"),
    )
    plan = plans.get(plan_name) or {}
    rows = plan.get("rows") or []
    display_rows = capex_display_rows(rows, capex_all_column_labels())
    plan_type = str(plan.get("plan_type") or "BE").upper()
    effective_month = str(plan.get("effective_from_month") or "").strip()
    effective_index = CAPEX_MONTHS.index(effective_month) if effective_month in CAPEX_MONTHS else None
    values_by_project = {}

    for row in display_rows:
        try:
            project_id = int(row.get("source_project_id") or 0)
        except (TypeError, ValueError):
            project_id = 0
        if not project_id:
            continue

        values = row.get("display") or row.get("values") or {}
        last_fy = capex_parse_number(values.get("Cummulative Expenditure till Last FY")) or 0.0
        gross_cost = capex_parse_number(values.get("Gross Cost")) or 0.0
        be_total = 0.0
        re_total = 0.0
        actual_total = 0.0
        has_re = False
        monthly_plan = {}
        monthly_actual = {}

        for month_index, month in enumerate(CAPEX_MONTHS):
            be_value = capex_parse_number(values.get(f"{month} BE")) or 0.0
            actual_value = capex_parse_number(values.get(f"{month} Actual")) or 0.0
            re_value = capex_parse_number(values.get(f"{month} RE"))
            be_total += be_value
            actual_total += actual_value
            if re_value is not None:
                has_re = True
            month_plan_value = be_value
            if plan_type == "RE" and effective_index is not None:
                month_plan_value = actual_value if month_index < effective_index else (re_value or 0.0)
                re_total += month_plan_value
            else:
                re_total += re_value or 0.0
            monthly_plan[month] = month_plan_value
            monthly_actual[month] = actual_value

        values_by_project[project_id] = {
            "capex_plan_name": plan_name,
            "capex_re_effective_month": effective_month,
            "gross_cost": gross_cost,
            "expenditure_last_fy": last_fy,
            "be_current_fy": be_total,
            "re_current_fy": re_total if has_re or (plan_type == "RE" and effective_index is not None) else None,
            "actual_current_fy": actual_total,
            "cumulative_cost": last_fy + actual_total,
            "monthly_plan": monthly_plan,
            "monthly_actual": monthly_actual,
        }

    return values_by_project


def capex_progress_percent(plan_total, actual_total):
    if not plan_total:
        return 0.0
    return round((actual_total / plan_total) * 100, 2)


def capex_month_from_column(column):
    for month in CAPEX_MONTHS:
        if column.startswith(f"{month} "):
            return month
    return ""


def capex_apply_re_effective_rules(rows, effective_month):
    if effective_month not in CAPEX_MONTHS:
        return rows
    effective_index = CAPEX_MONTHS.index(effective_month)
    rows = clone_capex_rows(rows)
    for row in rows:
        if row.get("level") != "Item":
            continue
        values = row.setdefault("values", {})
        for month_index, month in enumerate(CAPEX_MONTHS):
            if month_index < effective_index:
                values[f"{month} RE"] = values.get(f"{month} Actual") or ""
    return rows


def capex_validate_plan_amounts(rows, plan_type="BE"):
    plan_type = str(plan_type or "BE").upper()
    for row in sync_capex_rows(rows):
        if row.get("level") != "Item":
            continue
        values = row.get("values", {})
        label = values.get("CAPEX Plan (FY)") or "selected item"
        gross_cost = capex_parse_number(values.get("Gross Cost"))
        be_total = capex_parse_number(capex_monthly_total(values, "BE"))
        re_total = capex_parse_number(capex_monthly_total(values, "RE"))
        actual_total = capex_parse_number(capex_monthly_total(values, "Actual"))
        if gross_cost is not None and be_total is not None and be_total > gross_cost + 0.01:
            raise HTTPException(status_code=400, detail=f"BE total cannot exceed Gross Cost for {label}")
        if gross_cost is not None and re_total is not None and re_total > gross_cost + 0.01:
            raise HTTPException(status_code=400, detail=f"RE total cannot exceed Gross Cost for {label}")
        active_total = re_total if plan_type == "RE" else be_total
        active_label = "RE" if plan_type == "RE" else "BE"
        if actual_total is not None and active_total is not None and actual_total > active_total + 0.01:
            raise HTTPException(status_code=400, detail=f"Actual CAPEX cannot exceed {active_label} value for {label}")


def capex_merge_editable_rows(existing_rows, incoming_rows, plan):
    existing_rows = sync_capex_rows(existing_rows)
    incoming_by_id = {
        int(row.get("row_id") or 0): row
        for row in incoming_rows or []
    }
    merged_rows = clone_capex_rows(existing_rows)
    valid_columns = capex_all_column_labels()
    for index, row in enumerate(merged_rows):
        incoming = incoming_by_id.get(int(row.get("row_id") or 0))
        if not incoming:
            continue
        incoming_values = incoming.get("values") or {}
        values = row.setdefault("values", capex_empty_values())
        for column in valid_columns:
            if capex_can_edit_cell(existing_rows, index, column, plan):
                values[column] = incoming_values.get(column, values.get(column, ""))
    return sync_capex_rows(merged_rows)


def capex_can_edit_cell(rows, row_index, column, plan):
    row = rows[row_index]
    if str(row.get("source_project_id") or "") == "edc_idc":
        return False
    if column in ("BE (FY)", "RE (FY)"):
        return False
    if capex_direct_child_indexes(rows, row_index):
        return False
    plan_type = str(plan.get("plan_type") or "BE").upper()
    if column.endswith(" Actual"):
        return bool(plan.get("locked") or plan.get("approved") or plan.get("effective") or plan.get("plan_version") == "Final Approved Plan")
    if plan.get("locked") or plan.get("effective") or plan.get("plan_version") == "Final Approved Plan":
        return False
    if column.endswith(" RE") and plan_type != "RE":
        return False
    if column.endswith(" BE"):
        return plan_type == "BE"
    if column.endswith(" RE"):
        effective_month = plan.get("effective_from_month") or ""
        month = capex_month_from_column(column)
        if effective_month not in CAPEX_MONTHS or month not in CAPEX_MONTHS:
            return False
        return CAPEX_MONTHS.index(month) >= CAPEX_MONTHS.index(effective_month)
    return True


def capex_editable_cells(rows, columns, plan):
    rows = sync_capex_rows(rows)
    return {
        str(row.get("row_id")): {
            column: capex_can_edit_cell(rows, index, column, plan)
            for column in columns
        }
        for index, row in enumerate(rows)
    }


def capex_finalize_rows(rows):
    rows = clone_capex_rows(rows)
    for index, row in enumerate(rows):
        if not capex_direct_child_indexes(rows, index):
            row["values"]["BE (FY)"] = capex_monthly_total(row.get("values", {}), "BE")
            row["values"]["RE (FY)"] = capex_monthly_total(row.get("values", {}), "RE")
    return sync_capex_rows(rows)


def capex_build_plan_record(rows, financial_year, plan_version, plan_type, approved=False, locked=False, effective=False, effective_from_month=""):
    return {
        "financial_year": financial_year,
        "plan_version": plan_version,
        "plan_type": plan_type,
        "approved": bool(approved),
        "locked": bool(locked),
        "effective": bool(effective),
        "effective_from_month": effective_from_month or "",
        "rows": capex_finalize_rows(rows),
    }


def ensure_capex_tables(conn=None):
    own_connection = conn is None
    conn = conn or get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS capex_plans (
            plan_name TEXT PRIMARY KEY,
            financial_year TEXT NOT NULL,
            plan_version TEXT NOT NULL DEFAULT 'Original Plan',
            plan_type TEXT NOT NULL DEFAULT 'BE',
            approved BOOLEAN NOT NULL DEFAULT FALSE,
            locked BOOLEAN NOT NULL DEFAULT FALSE,
            effective BOOLEAN NOT NULL DEFAULT FALSE,
            effective_from_month TEXT NOT NULL DEFAULT '',
            rows_json TEXT NOT NULL DEFAULT '[]',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS capex_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.commit()
    if own_connection:
        conn.close()


def legacy_capex_payload_from_file(current_fy=None):
    current_fy = current_fy or build_financial_year_label()
    default_key = capex_plan_key(current_fy)
    if not CAPEX_PATH.exists():
        rows = capex_sync_project_rows(capex_default_rows())
        return {
            "financial_year": current_fy,
            "active_plan": default_key,
            "plans": {
                default_key: {
                    "financial_year": current_fy,
                    "plan_version": "Original Plan",
                    "plan_type": "BE",
                    "approved": False,
                    "locked": False,
                    "effective": True,
                    "effective_from_month": "",
                    "rows": rows,
                }
            },
        }

    payload = json.loads(CAPEX_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload.get("plans"), dict):
        payload["plans"] = {}
    if not payload["plans"]:
        payload["financial_year"] = payload.get("financial_year") or current_fy
        payload["active_plan"] = ""
        return payload
    for plan in payload["plans"].values():
        rows = plan.get("rows") or []
        plan["rows"] = sync_capex_rows(rows) if plan.get("locked") else capex_sync_project_rows(rows)
    if payload.get("active_plan") not in payload["plans"]:
        payload["active_plan"] = next(iter(payload["plans"]))
    return payload


def write_capex_payload_to_db(payload, conn=None):
    own_connection = conn is None
    conn = conn or get_db_connection()
    ensure_capex_tables(conn)
    cursor = conn.cursor()
    plans = payload.get("plans") or {}
    existing_names = set(plans.keys())
    if existing_names:
        cursor.execute("DELETE FROM capex_plans WHERE NOT (plan_name = ANY(%s))", (list(existing_names),))
    else:
        cursor.execute("DELETE FROM capex_plans")
    for plan_name, plan in plans.items():
        rows_json = json.dumps(capex_finalize_rows(plan.get("rows") or []), ensure_ascii=False)
        cursor.execute(
            """
            INSERT INTO capex_plans (
                plan_name, financial_year, plan_version, plan_type, approved,
                locked, effective, effective_from_month, rows_json, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (plan_name) DO UPDATE SET
                financial_year=EXCLUDED.financial_year,
                plan_version=EXCLUDED.plan_version,
                plan_type=EXCLUDED.plan_type,
                approved=EXCLUDED.approved,
                locked=EXCLUDED.locked,
                effective=EXCLUDED.effective,
                effective_from_month=EXCLUDED.effective_from_month,
                rows_json=EXCLUDED.rows_json,
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                plan_name,
                plan.get("financial_year") or payload.get("financial_year") or build_financial_year_label(),
                normalize_capex_plan_version(plan.get("plan_version") or "Original Plan"),
                str(plan.get("plan_type") or "BE").upper(),
                bool(plan.get("approved")),
                bool(plan.get("locked")),
                bool(plan.get("effective")),
                plan.get("effective_from_month") or "",
                rows_json,
            ),
        )
    cursor.execute(
        """
        INSERT INTO capex_settings (setting_key, setting_value)
        VALUES ('active_plan', %s)
        ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value
        """,
        (payload.get("active_plan") or "",),
    )
    cursor.execute(
        """
        INSERT INTO capex_settings (setting_key, setting_value)
        VALUES ('financial_year', %s)
        ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value
        """,
        (payload.get("financial_year") or build_financial_year_label(),),
    )
    conn.commit()
    if own_connection:
        conn.close()


def read_capex_payload_from_db():
    conn = get_db_connection()
    ensure_capex_tables(conn)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) AS count FROM capex_plans")
    if int((cursor.fetchone() or {}).get("count") or 0) == 0:
        payload = legacy_capex_payload_from_file()
        write_capex_payload_to_db(payload, conn)

    cursor.execute("SELECT setting_key, setting_value FROM capex_settings")
    settings = {row["setting_key"]: row["setting_value"] for row in cursor.fetchall()}
    cursor.execute(
        """
        SELECT plan_name, financial_year, plan_version, plan_type, approved,
               locked, effective, effective_from_month, rows_json
        FROM capex_plans
        ORDER BY updated_at, plan_name
        """
    )
    plan_rows = cursor.fetchall()
    plans = {}
    rows_changed = False
    for row in plan_rows:
        try:
            stored_rows = json.loads(row["rows_json"] or "[]")
        except (TypeError, ValueError):
            stored_rows = []
        synced_rows = sync_capex_rows(stored_rows) if row["locked"] else capex_sync_project_rows(stored_rows)
        rows_changed = rows_changed or json.dumps(stored_rows, sort_keys=True, default=str) != json.dumps(synced_rows, sort_keys=True, default=str)
        plans[row["plan_name"]] = {
            "financial_year": row["financial_year"],
            "plan_version": row["plan_version"],
            "plan_type": row["plan_type"],
            "approved": bool(row["approved"]),
            "locked": bool(row["locked"]),
            "effective": bool(row["effective"]),
            "effective_from_month": row["effective_from_month"] or "",
            "rows": synced_rows,
        }

    active_plan = settings.get("active_plan") or ""
    if active_plan not in plans and plans:
        active_plan = next(iter(plans))
    payload = {
        "financial_year": settings.get("financial_year") or build_financial_year_label(),
        "active_plan": active_plan,
        "plans": plans,
    }
    if rows_changed or settings.get("active_plan") != active_plan:
        write_capex_payload_to_db(payload, conn)
    conn.close()
    return payload


def read_capex_payload():
    return read_capex_payload_from_db()


def write_capex_payload(payload):
    write_capex_payload_to_db(payload)


def get_capex_plan(payload, plan_name):
    plan_name = plan_name or payload.get("active_plan")
    if plan_name not in payload.get("plans", {}):
        raise HTTPException(status_code=404, detail="CAPEX plan not found")
    return plan_name, payload["plans"][plan_name]


def capex_row_block(rows, row_id):
    index = next((idx for idx, row in enumerate(rows) if int(row.get("row_id") or 0) == int(row_id)), None)
    if index is None:
        raise HTTPException(status_code=404, detail="CAPEX row not found")
    base_indent = rows[index]["indent"]
    end = index
    for scan in range(index + 1, len(rows)):
        if rows[scan]["indent"] <= base_indent:
            break
        end = scan
    return index, end


def ensure_billing_schedule_table():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS billing_schedule (
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
        )
        """
    )
    for column_name in (
        "schedule_start",
        "schedule_finish",
        "milestone_type",
        "weightage_percent",
        "manufacturing_clearance",
        "inspection_clearance",
        "dispatch_clearance",
        "site_receipt_clearance",
        "approval_clearance",
        "appendix2_id",
        "milestone_source",
    ):
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name='billing_schedule'
              AND column_name=%s
            """,
            (column_name,),
        )
        if not cursor.fetchone():
            if column_name == "appendix2_id":
                cursor.execute("ALTER TABLE billing_schedule ADD COLUMN appendix2_id INTEGER")
            elif column_name == "weightage_percent":
                cursor.execute("ALTER TABLE billing_schedule ADD COLUMN weightage_percent REAL DEFAULT 0")
            else:
                cursor.execute(f"ALTER TABLE billing_schedule ADD COLUMN {column_name} TEXT")
    conn.commit()
    conn.close()


def billing_float(value):
    try:
        text = str(value if value is not None else "").replace(",", "").strip()
        return float(text) if text else 0.0
    except (TypeError, ValueError):
        return 0.0


def billing_int(value):
    try:
        return int(float(str(value if value is not None else "").strip()))
    except (TypeError, ValueError):
        return None


def billing_status(row):
    scheduled = billing_float(row.get("scheduled_amount"))
    billed = billing_float(row.get("billed_amount"))
    if scheduled > 0 and billed >= scheduled:
        return "Fully Billed"
    if billed > 0:
        return "Partially Billed"
    return "Not Billed"


def billing_payment_status(row):
    billed = billing_float(row.get("billed_amount"))
    received = billing_float(row.get("received_amount"))
    if billed > 0 and received >= billed:
        return "Fully Received"
    if received > 0:
        return "Partially Received"
    return "Not Received"


def billing_eligibility(row):
    milestone_type = str(row.get("milestone_type") or "").strip().lower()
    checks = []
    if milestone_type == "supply":
        checks = [row.get("inspection_clearance"), row.get("dispatch_clearance")]
    elif milestone_type in ("civil", "structural erection", "equipment erection"):
        checks = [row.get("approval_clearance")]
    else:
        checks = [row.get("approval_clearance") or row.get("inspection_clearance") or row.get("dispatch_clearance")]
    done = [bool(str(value or "").strip()) for value in checks]
    if done and all(done):
        return "Eligible"
    if any(done):
        return "Partially Eligible"
    return "Not Eligible"


def billing_financial_year():
    today = date.today()
    start = today.year if today.month >= 4 else today.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def billing_plan_meta(rows):
    has_billed = any(billing_float(row.get("billed_amount")) > 0 for row in rows)
    return {
        "financialYear": billing_financial_year(),
        "planVersion": "Rev-0",
        "isActive": True,
        "approvalStatus": "Under Review" if rows and not has_billed else ("Approved" if has_billed else "Draft"),
        "userRole": "Admin",
        "lastAction": "Submitted by Project Manager" if rows else "Draft Created",
        "pendingWith": "Finance Department" if rows and not has_billed else "Project Manager",
    }


def validate_billing_dates(payload):
    schedule_start = parse_date(payload.schedule_start)
    schedule_finish = parse_date(payload.schedule_finish)
    scheduled_date = parse_date(payload.scheduled_date)
    billed_date = parse_date(payload.billed_date)
    received_date = parse_date(payload.received_date)
    if schedule_start and schedule_finish and schedule_finish < schedule_start:
        raise HTTPException(status_code=400, detail="Schedule finish must be on or after schedule start")
    if scheduled_date and billed_date and billed_date < scheduled_date:
        raise HTTPException(status_code=400, detail="Billed date must be on or after scheduled date")
    if billed_date and received_date and received_date < billed_date:
        raise HTTPException(status_code=400, detail="Received date must be on or after billed date")


def validate_billing_payload(payload, milestone_id=None):
    scheduled = billing_float(payload.scheduled_amount)
    billed = billing_float(payload.billed_amount)
    received = billing_float(payload.received_amount)
    if scheduled >= 0 and billed > scheduled:
        raise HTTPException(status_code=400, detail="Billed amount cannot exceed scheduled amount")
    if received > billed:
        raise HTTPException(status_code=400, detail="Received amount cannot exceed billed amount")
    validate_billing_dates(payload)
    milestone_no = billing_int(payload.milestone_no)
    if milestone_no is not None:
        conn = get_db_connection()
        cursor = conn.cursor()
        if milestone_id:
            cursor.execute(
                "SELECT id FROM billing_schedule WHERE project_id=%s AND milestone_no=%s AND id<>%s",
                (payload.project_id, milestone_no, milestone_id),
            )
        else:
            cursor.execute(
                "SELECT id FROM billing_schedule WHERE project_id=%s AND milestone_no=%s",
                (payload.project_id, milestone_no),
            )
        duplicate = cursor.fetchone()
        conn.close()
        if duplicate:
            raise HTTPException(status_code=400, detail="Duplicate milestone number is not allowed")


def billing_appendix_activity_json(row, index=1):
    return {
        "id": row.get("id"),
        "activityCode": f"A2-{str(row.get('s_no') or index).zfill(2)}",
        "activityName": row.get("category") or "",
        "subActivity": row.get("item") or "",
        "scheduleStart": to_display_date(row.get("schedule_start")),
        "scheduleFinish": to_display_date(row.get("schedule_finish")),
        "weightagePercent": billing_float(row.get("weightage_percent")),
    }


def billing_row_json(row):
    item = dict(row)
    item["schedule_start"] = to_display_date(item.get("schedule_start"))
    item["schedule_finish"] = to_display_date(item.get("schedule_finish"))
    item["scheduled_date"] = to_display_date(item.get("scheduled_date"))
    item["billed_date"] = to_display_date(item.get("billed_date"))
    item["received_date"] = to_display_date(item.get("received_date"))
    item["balance_amount"] = max(0, billing_float(item.get("scheduled_amount")) - billing_float(item.get("billed_amount")))
    item["pending_payment"] = max(0, billing_float(item.get("billed_amount")) - billing_float(item.get("received_amount")))
    item["status"] = billing_status(row)
    item["payment_status"] = billing_payment_status(row)
    item["billing_eligibility"] = billing_eligibility(row)
    return item


def billing_summary(rows):
    total_scheduled = sum(billing_float(row.get("scheduled_amount")) for row in rows)
    total_billed = sum(billing_float(row.get("billed_amount")) for row in rows)
    total_received = sum(billing_float(row.get("received_amount")) for row in rows)
    pending = total_billed - total_received
    progress = (total_billed / total_scheduled * 100) if total_scheduled > 0 else 0
    receipt_progress = (total_received / total_billed * 100) if total_billed > 0 else 0
    return {
        "totalScheduled": total_scheduled,
        "totalBilled": total_billed,
        "totalReceived": total_received,
        "pendingAmount": pending,
        "progressPercent": progress,
        "receiptProgressPercent": receipt_progress,
        "totalBalance": max(0, total_scheduled - total_billed),
        "approvalStatus": billing_plan_meta(rows)["approvalStatus"],
    }


def appendix_billing_description(row):
    category = str(row.get("category") or "").strip()
    item = str(row.get("item") or "").strip()
    if category and item:
        return f"{category} + {item}"
    return item or category or "Appendix-2 Milestone"


def get_billing_appendix_rows(project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        WITH RECURSIVE project_tree AS (
            SELECT id, project_name, parent_project_id
            FROM projects
            WHERE id=%s
            UNION ALL
            SELECT child.id, child.project_name, child.parent_project_id
            FROM projects child
            INNER JOIN project_tree parent ON child.parent_project_id = parent.id
        )
        SELECT a.id, a.project_id, a.s_no, a.category, a.item,
               a.commencement_months, a.completion_months,
               a.schedule_start, a.schedule_finish,
               p.project_name AS appendix_project_name
        FROM appendix2 a
        INNER JOIN project_tree p ON p.id = a.project_id
        ORDER BY
            CASE
                WHEN a.s_no ~ '^[0-9]+$' THEN LPAD(a.s_no, 10, '0')
                ELSE a.s_no
            END,
            a.id
        """,
        (project_id,),
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows


def sync_billing_milestones_from_appendix(project_id):
    ensure_billing_schedule_table()
    appendix_rows = get_billing_appendix_rows(project_id)
    if not appendix_rows:
        return
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT appendix2_id
        FROM billing_schedule
        WHERE project_id=%s
          AND appendix2_id IS NOT NULL
        """,
        (project_id,),
    )
    existing_appendix_ids = {int(row["appendix2_id"]) for row in cursor.fetchall() if row.get("appendix2_id") is not None}
    for index, appendix_row in enumerate(appendix_rows, start=1):
        appendix_id = int(appendix_row.get("id") or 0)
        milestone_no = billing_int(appendix_row.get("s_no")) or index
        description = appendix_billing_description(appendix_row)
        schedule_start = to_storage_date(appendix_row.get("schedule_start"))
        schedule_finish = to_storage_date(appendix_row.get("schedule_finish"))
        weightage_percent = billing_float(appendix_row.get("weightage_percent"))
        if appendix_id in existing_appendix_ids:
            cursor.execute(
                """
                UPDATE billing_schedule
                SET milestone_no=%s,
                    description=%s,
                    milestone_type=COALESCE(NULLIF(milestone_type, ''), 'Physical'),
                    weightage_percent=%s,
                    schedule_start=%s,
                    schedule_finish=%s,
                    milestone_source='Appendix-2'
                WHERE project_id=%s
                  AND appendix2_id=%s
                """,
                (milestone_no, description, weightage_percent, schedule_start, schedule_finish, project_id, appendix_id),
            )
        else:
            cursor.execute(
                """
                INSERT INTO billing_schedule (
                    project_id, milestone_no, description, milestone_type, weightage_percent,
                    schedule_start, schedule_finish,
                    scheduled_amount, scheduled_date, billed_amount, received_amount,
                    appendix2_id, milestone_source
                )
                VALUES (%s, %s, %s, 'Physical', %s, %s, %s, 0, %s, 0, 0, %s, 'Appendix-2')
                """,
                (project_id, milestone_no, description, weightage_percent, schedule_start, schedule_finish, schedule_finish, appendix_id),
            )
    conn.commit()
    conn.close()


def get_billing_project_rows():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, unique_id, project_name, project_type, stage1_cost, stage2_cost, parent_project_id
        FROM projects
        WHERE project_type='Corporate AMR'
          AND stage2_cleared='Y'
          AND COALESCE(project_archived, 'N') <> 'Y'
        ORDER BY id DESC
        """
    )
    project_rows = [dict(row) for row in cursor.fetchall()]
    conn.close()

    ids_in_view = {int(project.get("id") or 0) for project in project_rows}
    children_by_parent = {}
    roots = []
    for project in project_rows:
        parent_id = int(project.get("parent_project_id") or 0) or None
        if parent_id and parent_id in ids_in_view:
            children_by_parent.setdefault(parent_id, []).append(project)
        else:
            roots.append(project)

    def sort_key(project):
        return int(project.get("id") or 0)

    roots.sort(key=sort_key, reverse=True)
    for child_rows in children_by_parent.values():
        child_rows.sort(key=sort_key, reverse=True)

    rows = []
    visited = set()

    def append_row(project, depth=0):
        project_id = int(project.get("id") or 0)
        if project_id in visited:
            return
        visited.add(project_id)
        gross_cost = project.get("stage2_cost")
        if gross_cost in (None, ""):
            gross_cost = project.get("stage1_cost")
        item = dict(project)
        item["gross_cost"] = gross_cost
        item["display_name"] = f"{'    ' * max(0, int(depth or 0))}{'- ' if depth else ''}{project.get('project_name') or ''}"
        rows.append(item)
        for child in children_by_parent.get(project_id, []):
            append_row(child, depth + 1)

    for root_project in roots:
        append_row(root_project)
    for project in sorted(project_rows, key=sort_key, reverse=True):
        if int(project.get("id") or 0) not in visited:
            append_row(project)
    return rows


def ensure_billing_project_allowed(project_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id
        FROM projects
        WHERE id=%s
          AND project_type='Corporate AMR'
          AND stage2_cleared='Y'
          AND COALESCE(project_archived, 'N') <> 'Y'
        """,
        (project_id,),
    )
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=400, detail="Select an ongoing Corporate AMR project")


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


def ensure_approval_field_tables():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
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
        """
    )
    for column_name in (
        "stage_key",
        "stage_name",
        "step_no",
        "step_key",
        "step_name",
        "responsible_agency",
        "data_field",
        "field_value",
        "updated_at",
    ):
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'project_approval_fields'
              AND column_name = %s
            """,
            (column_name,),
        )
        if not cursor.fetchone():
            cursor.execute(f"ALTER TABLE project_approval_fields ADD COLUMN {column_name} TEXT")
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS project_approval_field_history (
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
        )
        """
    )
    for column_name, column_type in (
        ("revert_remark", "TEXT"),
    ):
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'project_approval_field_history'
              AND column_name = %s
            """,
            (column_name,),
        )
        if not cursor.fetchone():
            cursor.execute(f"ALTER TABLE project_approval_field_history ADD COLUMN {column_name} {column_type}")
    conn.commit()
    conn.close()


def ensure_corporate_amr_master_table():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS corporate_amr_master (
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
        )
        """
    )
    for column_name, column_type in (
        ("project_manager", "TEXT"),
        ("executing_agency", "TEXT"),
        ("expenditure_upto_last_fy", "REAL"),
        ("be_re_current_fy", "REAL"),
        ("actual_cost_current_fy", "REAL"),
        ("cumulative_cost", "REAL"),
        ("tender_publish", "TEXT"),
        ("contract_signing", "TEXT"),
        ("expected_completion_date", "TEXT"),
        ("status_override", "TEXT"),
        ("updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
    ):
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'corporate_amr_master'
              AND column_name = %s
            """,
            (column_name,),
        )
        if not cursor.fetchone():
            cursor.execute(f"ALTER TABLE corporate_amr_master ADD COLUMN {column_name} {column_type}")
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS corporate_amr_tender_openings (
            id SERIAL PRIMARY KEY,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            opening_date TEXT,
            remarks TEXT,
            created_at TEXT,
            updated_at TEXT
        )
        """
    )
    for column_name, column_type in (
        ("project_id", "INTEGER"),
        ("opening_date", "TEXT"),
        ("remarks", "TEXT"),
        ("created_at", "TEXT"),
        ("updated_at", "TEXT"),
    ):
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'corporate_amr_tender_openings'
              AND column_name = %s
            """,
            (column_name,),
        )
        if not cursor.fetchone():
            cursor.execute(f"ALTER TABLE corporate_amr_tender_openings ADD COLUMN {column_name} {column_type}")
    conn.commit()
    conn.close()


def ensure_project_archive_column():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'projects'
          AND column_name = 'project_archived'
        """
    )
    if not cursor.fetchone():
        cursor.execute("ALTER TABLE projects ADD COLUMN project_archived TEXT DEFAULT 'N'")
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
    stages = []
    for stage in APPROVAL_FIELD_STAGES:
        steps = []
        for step in stage["steps"]:
            field_key = f"{stage['key']}.{step['key']}"
            applicable = bool(step.get(category))
            steps.append({
                **step,
                "fieldKey": field_key,
                "applicable": applicable,
                "responsibleAgency": step.get(f"{category}Agency") or ("Plant Level" if category == "plant" else "Corporate Office" if category == "corporate" else "Board / Corporate Authority"),
                "value": saved_values.get(field_key, ""),
            })
        stages.append({**stage, "steps": steps})
    return {
        "category": category,
        "categoryLabel": {
            "plant": "< ₹30 Cr. Plant Level AMR Project",
            "corporate": "> ₹30 Cr. & < ₹50 Cr. Corporate AMR Project",
            "board": "> ₹50 Cr. Corporate AMR Project (Board Approved)",
        }[category],
        "stages": stages,
    }


def approval_step_metadata(project, field_key):
    detail_suffix = ""
    base_field_key = field_key
    for suffix in (".amount", ".net_itc"):
        if field_key.endswith(suffix):
            detail_suffix = suffix
            base_field_key = field_key[: -len(suffix)]
            break
    workflow = approval_workflow_for_project(project, {})
    for stage in workflow["stages"]:
        for step in stage["steps"]:
            if step["fieldKey"] != base_field_key:
                continue
            data_field = step["dataField"]
            if detail_suffix == ".amount":
                data_field = "Amount"
            elif detail_suffix == ".net_itc":
                data_field = "Net of ITC"
            return {
                "stage_key": stage["key"],
                "stage_name": stage["label"],
                "step_no": step["no"],
                "step_key": step["key"],
                "step_name": step["name"],
                "responsible_agency": step.get("responsibleAgency") or "",
                "data_field": data_field,
            }
    return None


def approval_template_columns():
    columns = []
    for stage in APPROVAL_FIELD_STAGES:
        for step in stage["steps"]:
            columns.append({
                "header": f"{stage['label']} - {step['no']} - {step['name']}",
                "fieldKey": f"{stage['key']}.{step['key']}",
                "stageKey": stage["key"],
                "stageName": stage["label"],
                "stepNo": step["no"],
                "stepName": step["name"],
                "dataField": step["dataField"],
            })
    return columns


def sync_legacy_stage_from_approval_values(project_id, project, values):
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
                try:
                    updates["stage1_cost"] = float(last_amount)
                except ValueError:
                    pass
        elif stage["key"] == "tendering":
            if last_date:
                updates["final_tod_date"] = to_storage_date(last_date) or last_date
                updates.setdefault("expected_tod_date", to_storage_date(last_date) or last_date)
        elif stage["key"] == "stage2":
            updates["stage2_cleared"] = "Y"
            if last_date:
                updates["stage2_date"] = to_storage_date(last_date) or last_date
            if last_amount:
                try:
                    updates["stage2_cost"] = float(last_amount)
                except ValueError:
                    pass
    if updates:
        update_project_stage(project_id, **updates)
    return updates


def clear_project_approval_stage(project_id, stage_key):
    if stage_key not in {"formulation", "stage1", "tendering", "stage2"}:
        raise ValueError("Invalid approval stage")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id=%s", (project_id,))
    project = cursor.fetchone()
    if not project:
        conn.close()
        raise LookupError("Project not found")
    cursor.execute("SELECT field_key, field_value FROM project_approval_fields WHERE project_id=%s", (project_id,))
    values = {row["field_key"]: row["field_value"] for row in cursor.fetchall()}
    conn.close()
    if stage_key not in {stage["key"] for stage in APPROVAL_FIELD_STAGES}:
        raise ValueError("Invalid approval stage")
    updates = sync_legacy_stage_from_approval_values(project_id, dict(project), values)
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
        update_project_stage(project_id, **updates)
    return updates


def stage_key_for_step_no(step_no):
    for stage in APPROVAL_FIELD_STAGES:
        for step in stage["steps"]:
            if int(step["no"]) == int(step_no):
                return stage["key"]
    return None


def revert_project_approval_stage(project_id, stage_key="", step_no=None, remark=""):
    stage_order = [stage["key"] for stage in APPROVAL_FIELD_STAGES]
    if step_no is not None:
        try:
            step_no = int(step_no)
        except (TypeError, ValueError) as exc:
            raise ValueError("Invalid approval step") from exc
        if step_no < 1 or step_no > 37:
            raise ValueError("Approval step must be between 1 and 37")
        stage_key = stage_key_for_step_no(step_no)
    if stage_key not in stage_order:
        raise ValueError("Invalid approval stage")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id=%s", (project_id,))
    project = cursor.fetchone()
    if not project:
        conn.close()
        raise LookupError("Project not found")

    cursor.execute(
        "SELECT COALESCE(MAX(revision_no), 0) AS max_revision FROM project_approval_field_history WHERE project_id=%s",
        (project_id,),
    )
    next_revision = int((cursor.fetchone() or {}).get("max_revision") or 0) + 1
    cursor.execute(
        """
        INSERT INTO project_approval_field_history (
            project_id, field_key, stage_key, stage_name, step_no, step_key,
            step_name, responsible_agency, data_field, field_value,
            revert_to_stage, revert_remark, revision_no, archived_at
        )
        SELECT project_id, field_key, stage_key, stage_name, step_no, step_key,
               step_name, responsible_agency, data_field, field_value,
               %s, %s, %s, %s
        FROM project_approval_fields
        WHERE project_id=%s
          AND COALESCE(field_value, '') <> ''
        """,
        (
            f"step-{step_no}" if step_no is not None else stage_key,
            str(remark or "").strip(),
            next_revision,
            datetime.now().isoformat(timespec="seconds"),
            project_id,
        ),
    )
    if step_no is not None:
        cursor.execute(
            """
            DELETE FROM project_approval_fields
            WHERE project_id=%s
              AND NULLIF(regexp_replace(COALESCE(step_no, '0'), '\\D', '', 'g'), '')::INTEGER >= %s
            """,
            (project_id, step_no),
        )
    else:
        stage_index = stage_order.index(stage_key)
        revert_stage_keys = stage_order[stage_index:]
        cursor.execute(
            "DELETE FROM project_approval_fields WHERE project_id=%s AND stage_key = ANY(%s)",
            (project_id, revert_stage_keys),
        )
    conn.commit()
    conn.close()

    updates = {}
    if stage_key == "formulation":
        updates.update({
            "dic_recommendation_date": None,
            "cod_cleared": "N",
            "cod_date": None,
            "stage1_date": None,
            "stage1_cost": None,
            "stage1_cleared": "N",
            "expected_tod_date": None,
            "final_tod_date": None,
            "stage2_date": None,
            "stage2_cost": None,
            "stage2_cleared": "N",
        })
    elif stage_key == "stage1":
        updates.update({
            "cod_date": None,
            "stage1_date": None,
            "stage1_cost": None,
            "stage1_cleared": "N",
            "expected_tod_date": None,
            "final_tod_date": None,
            "stage2_date": None,
            "stage2_cost": None,
            "stage2_cleared": "N",
        })
    elif stage_key == "tendering":
        updates.update({
            "expected_tod_date": None,
            "final_tod_date": None,
            "stage2_date": None,
            "stage2_cost": None,
            "stage2_cleared": "N",
        })
    elif stage_key == "stage2":
        updates.update({
            "stage2_date": None,
            "stage2_cost": None,
            "stage2_cleared": "N",
        })
    if updates:
        update_project_stage(project_id, **updates)
    return {"revision_no": next_revision, "updates": updates}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/login")
def login(payload: LoginPayload):
    user = authenticate_user(payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return {"user": json_ready(dict(user))}


@app.get("/api/user-preferences/{username}/{view_key}")
def get_user_preference(username: str, view_key: str):
    ensure_user_preferences_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT preference_json
        FROM user_preferences
        WHERE username=%s AND view_key=%s
        """,
        (username.strip() or "default", view_key.strip()),
    )
    row = cursor.fetchone()
    conn.close()
    if not row:
        return {"username": username, "view_key": view_key, "value": {}}
    try:
        value = json.loads(row["preference_json"] or "{}")
    except (TypeError, json.JSONDecodeError):
        value = {}
    return {"username": username, "view_key": view_key, "value": value}


@app.put("/api/user-preferences/{username}/{view_key}")
def save_user_preference(username: str, view_key: str, payload: UserPreferencePayload):
    ensure_user_preferences_table()
    safe_username = username.strip() or "default"
    safe_view_key = view_key.strip()
    if not safe_view_key:
        raise HTTPException(status_code=400, detail="Preference key is required")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO user_preferences (username, view_key, preference_json, updated_at)
        VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
        ON CONFLICT (username, view_key)
        DO UPDATE SET preference_json=EXCLUDED.preference_json,
                      updated_at=CURRENT_TIMESTAMP
        """,
        (safe_username, safe_view_key, json.dumps(payload.value or {})),
    )
    conn.commit()
    conn.close()
    return {"username": safe_username, "view_key": safe_view_key, "value": payload.value or {}}


@app.get("/api/modules")
def modules():
    return {
        "modules": [
            {"key": key, "label": label}
            for key, label in APP_MODULES
        ]
    }


@app.get("/api/projects")
def projects():
    ensure_project_archive_column()
    rows = [dict(row) for row in get_all_projects()]
    return {"projects": json_ready(rows)}


@app.post("/api/projects")
def create_project(payload: ProjectCreatePayload):
    if not payload.project_type.strip() or not payload.project_name.strip():
        raise HTTPException(status_code=400, detail="Project type and project name are required")
    if payload.project_type.strip() not in ("Corporate AMR", "Plant Level AMR"):
        raise HTTPException(status_code=400, detail="Project type must be Corporate AMR or Plant Level AMR")
    if project_name_exists(payload.project_name):
        raise HTTPException(status_code=400, detail=f"Project Name '{payload.project_name}' already exists")
    unique_id = payload.unique_id.strip() or generate_unique_id()
    try:
        project_id = add_project(unique_id, payload.project_type.strip(), payload.project_name.strip())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok", "id": project_id, "unique_id": unique_id}


@app.get("/api/registration")
def registration_tables():
    return build_registration_tables()


@app.post("/api/registration/child")
def create_child_project(payload: ChildProjectPayload):
    if not payload.project_name.strip():
        raise HTTPException(status_code=400, detail="Child project name is required")
    if project_name_exists(payload.project_name):
        raise HTTPException(status_code=400, detail=f"Project Name '{payload.project_name}' already exists")
    if payload.stage2_gross_cost < 0:
        raise HTTPException(status_code=400, detail="Stage-2 gross cost cannot be negative")
    uid = generate_unique_id()
    try:
        project_id = add_child_project(payload.parent_project_id, uid, payload.project_name.strip(), payload.stage2_gross_cost)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok", "id": project_id, "unique_id": uid}


@app.patch("/api/projects/{project_id}/stage")
def update_stage(project_id: int, payload: ProjectStagePayload):
    update_data = payload.model_dump(exclude_unset=True)
    for key in (
        "dic_recommendation_date",
        "cod_date",
        "stage1_date",
        "expected_tod_date",
        "final_tod_date",
        "stage2_date",
    ):
        if key in update_data:
            update_data[key] = to_storage_date(update_data[key])
    if "cod_cleared" not in update_data and update_data.get("cod_date"):
        update_data["cod_cleared"] = "Y"
    if "stage1_cleared" not in update_data and update_data.get("stage1_date") and update_data.get("stage1_cost") is not None:
        update_data["stage1_cleared"] = "Y"
    if "stage2_cleared" not in update_data and update_data.get("stage2_date") and update_data.get("stage2_cost") is not None:
        update_data["stage2_cleared"] = "Y"
    if not update_data:
        raise HTTPException(status_code=400, detail="No stage data supplied")
    update_project_stage(project_id, **update_data)
    return {"status": "ok"}


@app.get("/api/projects/{project_id}/approval-fields")
def project_approval_fields(project_id: int):
    ensure_approval_field_tables()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id=%s", (project_id,))
    project = cursor.fetchone()
    if not project:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    cursor.execute("SELECT field_key, field_value FROM project_approval_fields WHERE project_id=%s", (project_id,))
    values = {row["field_key"]: row["field_value"] for row in cursor.fetchall()}
    conn.close()
    return json_ready({
        "project": dict(project),
        "workflow": approval_workflow_for_project(dict(project), values),
    })


@app.get("/api/approval-fields/template")
def approval_fields_template():
    return {"columns": approval_template_columns()}


@app.put("/api/projects/{project_id}/approval-fields")
def save_project_approval_fields(project_id: int, payload: ApprovalFieldSavePayload, auto_stage: bool = False):
    ensure_approval_field_tables()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id=%s", (project_id,))
    project = cursor.fetchone()
    if not project:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    allowed_keys = {
        f"{stage['key']}.{step['key']}"
        for stage in APPROVAL_FIELD_STAGES
        for step in stage["steps"]
    }
    amount_detail_keys = {
        f"{stage['key']}.{step['key']}{suffix}"
        for stage in APPROVAL_FIELD_STAGES
        for step in stage["steps"]
        if step.get("dataField") == "Amount"
        for suffix in (".amount", ".net_itc")
    }
    allowed_keys.update(amount_detail_keys)
    updated_at = datetime.now().isoformat(timespec="seconds")
    for field_key, raw_value in (payload.values or {}).items():
        if field_key not in allowed_keys:
            continue
        metadata = approval_step_metadata(dict(project), field_key)
        if not metadata:
            continue
        value = "" if raw_value is None else str(raw_value).strip()
        cursor.execute(
            """
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
            """,
            (
                project_id,
                field_key,
                metadata["stage_key"],
                metadata["stage_name"],
                metadata["step_no"],
                metadata["step_key"],
                metadata["step_name"],
                metadata["responsible_agency"],
                metadata["data_field"],
                value,
                updated_at,
            ),
        )
    conn.commit()
    cursor.execute("SELECT field_key, field_value FROM project_approval_fields WHERE project_id=%s", (project_id,))
    values = {row["field_key"]: row["field_value"] for row in cursor.fetchall()}
    conn.close()
    if auto_stage:
        sync_legacy_stage_from_approval_values(project_id, dict(project), values)
    return json_ready({"status": "ok", "workflow": approval_workflow_for_project(dict(project), values)})


@app.post("/api/projects/{project_id}/approval-stage-clearance/{stage_key}")
def clear_approval_stage(project_id: int, stage_key: str, payload: ApprovalStageClearancePayload):
    if str(payload.requested_by_role or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admin can clear approval stages")
    try:
        updates = clear_project_approval_stage(project_id, stage_key)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok", "updates": json_ready(updates)}


@app.post("/api/projects/{project_id}/approval-stage-revert")
def revert_approval_stage(project_id: int, payload: ApprovalStageRevertPayload):
    if str(payload.requested_by_role or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admin can revert approval stages")
    try:
        result = revert_project_approval_stage(project_id, payload.stage_key, payload.step_no, payload.remark)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return json_ready({"status": "ok", **result})


def save_corporate_amr_master_values(project_id: int, payload: CorporateAmrMasterPayload):
    ensure_corporate_amr_master_table()
    ensure_approval_field_tables()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id=%s", (project_id,))
    project = cursor.fetchone()
    conn.close()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if str(project.get("project_type") or "").strip() != "Corporate AMR":
        raise HTTPException(status_code=400, detail="Corporate AMR Master can edit Corporate AMR projects only")

    approval_payload = ApprovalFieldSavePayload(values=payload.approval_values or {})
    if approval_payload.values:
        save_project_approval_fields(project_id, approval_payload, auto_stage=True)

    allowed_master_fields = {
        "project_manager": ("project_manager", "text"),
        "expenditure_last_fy": ("expenditure_upto_last_fy", "number"),
        "be_re": ("be_re_current_fy", "number"),
        "actual_current_fy": ("actual_cost_current_fy", "number"),
        "cumulative_cost": ("cumulative_cost", "number"),
        "tender_publish": ("tender_publish", "date"),
        "contract_signing": ("contract_signing", "date"),
        "expected_completion_date": ("expected_completion_date", "date"),
        "status": ("status_override", "text"),
    }
    project_field_map = {
        "executing_agency": ("contractor_name", "text"),
        "loa_loi": ("loa_date", "date"),
        "effective_date": ("effective_date", "date"),
        "schedule_month": ("schedule_months", "integer"),
        "contract_schedule_completion": ("schedule_completion", "date"),
        "expected_completion_date": ("expected_finish", "date"),
        "actual_completion_date": ("completion_date", "date"),
        "completion_marked": ("completion_marked", "flag"),
        "completion_date": ("completion_date", "date"),
        "commissioned_marked": ("commissioned_marked", "flag"),
        "commissioned_date": ("commissioned_date", "date"),
    }
    explicit_project_fields = set((payload.master_values or {}).keys())
    values = {}
    project_updates = {}
    for field_key, raw_value in (payload.master_values or {}).items():
        if field_key not in allowed_master_fields and field_key not in project_field_map:
            continue
        _target_column, value_type = allowed_master_fields.get(field_key) or project_field_map.get(field_key)
        value = "" if raw_value is None else str(raw_value).strip()
        if value_type == "number":
            if value == "":
                parsed_value = None
            else:
                try:
                    parsed_value = float(value.replace(",", ""))
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=f"{field_key} must be numeric") from exc
        elif value_type == "integer":
            if value == "":
                parsed_value = None
            else:
                try:
                    parsed_value = int(float(value.replace(",", "")))
                except ValueError as exc:
                    raise HTTPException(status_code=400, detail=f"{field_key} must be a whole number") from exc
        elif value_type == "date":
            parsed_value = to_storage_date(value) or value
        elif value_type == "flag":
            parsed_value = "Y" if value.upper() in {"Y", "YES", "TRUE", "1", "MARKED"} else "N"
        else:
            parsed_value = value
        if field_key in allowed_master_fields:
            master_column_name, _ = allowed_master_fields[field_key]
            values[master_column_name] = parsed_value
        if field_key in project_field_map:
            project_column_name, _ = project_field_map[field_key]
            project_updates[project_column_name] = parsed_value
            if field_key in {"actual_completion_date", "completion_date"} and "completion_marked" not in explicit_project_fields:
                project_updates["completion_marked"] = "Y" if parsed_value else "N"
            if field_key == "commissioned_date" and "commissioned_marked" not in explicit_project_fields:
                project_updates["commissioned_marked"] = "Y" if parsed_value else "N"

    if values:
        conn = get_db_connection()
        cursor = conn.cursor()
        columns = ["project_id", *values.keys(), "updated_at"]
        placeholders = ", ".join(["%s"] * len(columns))
        update_clause = ", ".join([f"{column}=EXCLUDED.{column}" for column in values.keys()])
        update_clause = f"{update_clause}, updated_at=EXCLUDED.updated_at" if update_clause else "updated_at=EXCLUDED.updated_at"
        cursor.execute(
            f"""
            INSERT INTO corporate_amr_master ({", ".join(columns)})
            VALUES ({placeholders})
            ON CONFLICT (project_id)
            DO UPDATE SET {update_clause}
            """,
            [project_id, *values.values(), datetime.now()],
        )
        conn.commit()
        conn.close()
    if project_updates:
        update_project_stage(project_id, **project_updates)
    if payload.tender_openings is not None:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM corporate_amr_tender_openings WHERE project_id=%s", (project_id,))
        now_text = datetime.now().isoformat(timespec="seconds")
        for item in payload.tender_openings or []:
            opening_date = to_storage_date(item.get("opening_date")) or str(item.get("opening_date") or "").strip()
            remarks = str(item.get("remarks") or "").strip()
            if not opening_date and not remarks:
                continue
            cursor.execute(
                """
                INSERT INTO corporate_amr_tender_openings (project_id, opening_date, remarks, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (project_id, opening_date, remarks, now_text, now_text),
            )
        conn.commit()
        conn.close()

    return json_ready({"status": "ok"})


@app.patch("/api/corporate-amr-master/{project_id}")
def update_corporate_amr_master(project_id: int, payload: CorporateAmrMasterPayload):
    return save_corporate_amr_master_values(project_id, payload)


@app.patch("/api/projects/{project_id}/corporate-amr-master")
def update_project_corporate_amr_master(project_id: int, payload: CorporateAmrMasterPayload):
    return save_corporate_amr_master_values(project_id, payload)


@app.patch("/api/projects/{project_id}/mark")
def update_mark(project_id: int, payload: ProjectMarkPayload):
    if payload.mark_type not in ("complete", "commissioned"):
        raise HTTPException(status_code=400, detail="mark_type must be complete or commissioned")
    flag_column = "completion_marked" if payload.mark_type == "complete" else "commissioned_marked"
    date_column = "completion_date" if payload.mark_type == "complete" else "commissioned_date"
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id=%s", (project_id,))
    project = cursor.fetchone()
    if not project:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.checked and get_project_status(dict(project)) != "Ongoing":
        conn.close()
        raise HTTPException(status_code=400, detail="Can mark complete/commissioned only when project status is Ongoing")
    cursor.execute(
        f"UPDATE projects SET {flag_column}=%s, {date_column}=%s WHERE id=%s",
        ("Y" if payload.checked else "N", to_storage_date(payload.date_value) if payload.checked else None, project_id),
    )
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.patch("/api/projects/{project_id}/archive")
def archive_project(project_id: int, payload: ProjectArchivePayload):
    ensure_project_archive_column()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, completion_date, completion_marked FROM projects WHERE id=%s", (project_id,))
    project = cursor.fetchone()
    if not project:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.archived and not (project.get("completion_date") or project.get("completion_marked") == "Y"):
        conn.close()
        raise HTTPException(status_code=400, detail="Only completed projects can be archived")
    cursor.execute(
        "UPDATE projects SET project_archived=%s WHERE id=%s",
        ("Y" if payload.archived else "N", project_id),
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "project_archived": "Y" if payload.archived else "N"}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: int):
    delete_project_everywhere(project_id)
    return {"status": "ok"}


@app.get("/api/projects/stages")
def project_stages():
    ensure_project_archive_column()
    return {
        "formulation": json_ready([dict(row) for row in get_projects_by_stage("formulation")]),
        "stage1": json_ready([dict(row) for row in get_projects_by_stage("stage1")]),
        "tendering": json_ready([dict(row) for row in get_projects_by_stage("tendering")]),
        "stage2": json_ready([dict(row) for row in get_projects_by_stage("stage2")]),
    }


def registration_status_bucket(status):
    status_text = str(status or "").strip()
    if status_text in {"On Time", "Delay < 1 Yr.", "Delay > 1 Yr."}:
        return "active"
    if status_text == "Yet to Start":
        return "underApproval"
    if status_text == "Ongoing":
        return "active"
    if status_text in {"Complete", "Completed", "Commissioned"}:
        return "completed"
    return "underApproval"


def build_plant_level_ongoing_summary_from_dashboard():
    """Use Plant Level AMR window status/gross-cost data for Ongoing cards."""
    dashboard = build_plant_level_amr_dashboard()
    rows = [dict(row) for row in dashboard.get("projects", [])]
    summary = {
        "totalProjects": 0,
        "activeProjects": 0,
        "completedProjects": 0,
        "underApprovalProjects": 0,
        "grossTotal": 0.0,
        "activeGrossTotal": 0.0,
        "completedGrossTotal": 0.0,
        "underApprovalGrossTotal": 0.0,
        "activeBreakup": {
            "onTime": 0,
            "delayLtOneYear": 0,
            "delayGtOneYear": 0,
        },
        "activeBreakupCost": {
            "onTime": 0.0,
            "delayLtOneYear": 0.0,
            "delayGtOneYear": 0.0,
        },
        "statusSource": "plant_level_amr_status_as_on",
    }
    for row in rows:
        status_text = str(row.get("status") or "").strip()
        gross_cost = optional_float(row.get("gross_cost_cr"), 0) or 0
        summary["totalProjects"] += 1
        summary["grossTotal"] += gross_cost
        if status_text == "Completed":
            summary["completedProjects"] += 1
            summary["completedGrossTotal"] += gross_cost
        elif status_text == "Yet to Start":
            summary["underApprovalProjects"] += 1
            summary["underApprovalGrossTotal"] += gross_cost
        elif status_text in {"On Time", "Delay < 1 Yr.", "Delay > 1 Yr."}:
            summary["activeProjects"] += 1
            summary["activeGrossTotal"] += gross_cost
            if status_text == "On Time":
                summary["activeBreakup"]["onTime"] += 1
                summary["activeBreakupCost"]["onTime"] += gross_cost
            elif status_text == "Delay < 1 Yr.":
                summary["activeBreakup"]["delayLtOneYear"] += 1
                summary["activeBreakupCost"]["delayLtOneYear"] += gross_cost
            elif status_text == "Delay > 1 Yr.":
                summary["activeBreakup"]["delayGtOneYear"] += 1
                summary["activeBreakupCost"]["delayGtOneYear"] += gross_cost
        else:
            summary["underApprovalProjects"] += 1
            summary["underApprovalGrossTotal"] += gross_cost
    for key in ("grossTotal", "activeGrossTotal", "completedGrossTotal", "underApprovalGrossTotal"):
        summary[key] = round(summary[key], 2)
    for key, value in summary["activeBreakupCost"].items():
        summary["activeBreakupCost"][key] = round(value, 2)
    return summary


DPR_PROJECT_TYPES = ("Corporate AMR", "Plant Level AMR")


def daily_progress_project_context(current_project_id=None):
    ensure_project_archive_column()
    ensure_scurve_plan_columns()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id,
               unique_id,
               project_name,
               project_type,
               stage2_cleared,
               completion_marked,
               commissioned_marked,
               final_tod_date,
               stage1_cleared,
               cod_cleared,
               project_dropped,
               project_archived
        FROM projects
        WHERE project_type = ANY(%s)
          AND COALESCE(project_dropped, 'N') <> 'Y'
          AND COALESCE(project_archived, 'N') <> 'Y'
        ORDER BY project_type, id DESC
        """,
        (list(DPR_PROJECT_TYPES),),
    )
    project_rows = [dict(row) for row in cursor.fetchall()]
    cursor.execute(
        """
        SELECT project_id,
               plan_name,
               COALESCE(is_active, 'N') AS is_active,
               COALESCE(is_locked, 'N') AS is_locked,
               financial_year,
               plan_version
        FROM plans
        WHERE project_id = ANY(%s)
        ORDER BY project_id, id DESC
        """,
        ([int(row["id"]) for row in project_rows] or [0],),
    )
    plans_by_project = {}
    for plan in cursor.fetchall():
        plans_by_project.setdefault(int(plan["project_id"]), []).append(dict(plan))
    conn.close()
    project_ids = [int(row["id"]) for row in project_rows if row.get("id")]
    completed_planning_by_project = bulk_project_completed_planning_flags(project_ids)

    current_project_id = int(current_project_id or 0) if current_project_id else None
    current_project = next((row for row in project_rows if int(row.get("id") or 0) == current_project_id), None)
    selected_project_type = str(current_project.get("project_type") or "").strip() if current_project else ""
    if selected_project_type not in DPR_PROJECT_TYPES:
        selected_project_type = "Corporate AMR"

    project_options = []
    type_counts = {project_type: 0 for project_type in DPR_PROJECT_TYPES}
    for row in project_rows:
        status = get_project_status(dict(row))
        project_type = str(row.get("project_type") or "").strip()
        if project_type not in DPR_PROJECT_TYPES:
            continue
        if project_type == "Corporate AMR" and str(status or "").strip().lower() != "ongoing":
            continue
        type_counts[project_type] += 1
        project_id = int(row.get("id") or 0)
        project_plans = plans_by_project.get(project_id, [])
        active_plan = next((
            plan for plan in project_plans
            if str(plan.get("is_active") or "").upper() == "Y"
            and str(plan.get("is_locked") or "").upper() == "Y"
        ), None)
        project_options.append({
            "id": row.get("id"),
            "unique_id": row.get("unique_id"),
            "project_name": row.get("project_name"),
            "project_type": project_type,
            "status": status,
            "planNames": [plan.get("plan_name") for plan in project_plans if plan.get("plan_name")],
            "activePlanName": active_plan.get("plan_name") if active_plan else "",
            "hasActiveScurvePlan": bool(active_plan),
            "hasCompletedPlanning": completed_planning_by_project.get(project_id, False),
        })

    return {
        "projectTypes": [
            {"value": project_type, "label": project_type, "count": type_counts.get(project_type, 0)}
            for project_type in DPR_PROJECT_TYPES
        ],
        "projectOptions": project_options,
        "selectedProjectType": selected_project_type,
        "currentApplicable": selected_project_type,
    }


def default_daily_progress_manpower_rows():
    return [
        {"id": 1, "category": "RSP - Executive", "contractorName": "", "trade": "", "designation": "", "scope": "", "unit": "", "lastMonth": "0", "today": "0", "remarks": ""},
        {"id": 2, "category": "RSP - Non Executive", "contractorName": "", "trade": "", "designation": "", "scope": "", "unit": "", "lastMonth": "0", "today": "0", "remarks": ""},
        {"id": 3, "category": "Executing Agency", "contractorName": "", "trade": "Civil", "designation": "", "scope": "", "unit": "", "lastMonth": "0", "today": "0", "remarks": ""},
    ]


def pdf_escape_text(value):
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace("(", "\\(")
        .replace(")", "\\)")
        .replace("\r", " ")
        .replace("\n", " ")
    )


def build_simple_table_pdf(title, subtitle, columns, rows):
    page_width = 1190.55
    page_height = 841.89
    margin = 28
    title_height = 42
    row_height = 18
    max_columns = max(1, min(len(columns), 18))
    columns = columns[:max_columns]
    rows = [list(row)[:max_columns] for row in rows]
    usable_width = page_width - (margin * 2)
    column_width = usable_width / max_columns
    rows_per_page = max(1, int((page_height - margin - title_height - row_height - margin) // row_height))
    pages = []
    for start in range(0, max(1, len(rows)), rows_per_page):
        pages.append(rows[start:start + rows_per_page])
    if not pages:
        pages = [[]]

    def text_cell(value, limit=32):
        text = str(value or "")
        return text if len(text) <= limit else f"{text[:limit - 1]}…"

    page_streams = []
    for page_rows in pages:
        commands = [
            "0.95 0.98 1 rg",
            f"{margin} {page_height - margin - title_height - row_height} {usable_width} {row_height} re f",
            "0 0 0 RG 0.5 w",
            "BT /F1 16 Tf 0 0.19 0.53 rg",
            f"1 0 0 1 {margin} {page_height - margin - 14} Tm ({pdf_escape_text(title)}) Tj ET",
            "BT /F1 8 Tf 0.2 0.25 0.33 rg",
            f"1 0 0 1 {margin} {page_height - margin - 30} Tm ({pdf_escape_text(subtitle)}) Tj ET",
        ]
        y = page_height - margin - title_height
        for index, label in enumerate(columns):
            x = margin + (index * column_width)
            commands.extend([
                f"{x} {y - row_height} {column_width} {row_height} re S",
                "BT /F1 6 Tf 0 0 0 rg",
                f"1 0 0 1 {x + 3} {y - 12} Tm ({pdf_escape_text(text_cell(label, 28))}) Tj ET",
            ])
        y -= row_height
        for row in page_rows:
            for index, value in enumerate(row):
                x = margin + (index * column_width)
                commands.extend([
                    f"{x} {y - row_height} {column_width} {row_height} re S",
                    "BT /F1 5.5 Tf 0 0 0 rg",
                    f"1 0 0 1 {x + 3} {y - 12} Tm ({pdf_escape_text(text_cell(value, 34))}) Tj ET",
                ])
            y -= row_height
        page_streams.append("\n".join(commands).encode("latin-1", "replace"))

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    kids = []
    for stream in page_streams:
        page_id = len(objects) + 1
        content_id = page_id + 1
        kids.append(f"{page_id} 0 R")
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width:.2f} {page_height:.2f}] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>".encode("latin-1")
        )
        objects.append(b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode("latin-1")

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for object_no, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{object_no} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref_at = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF".encode("ascii")
    )
    return bytes(pdf)


@app.get("/api/projects/ongoing")
def ongoing_projects(include_archived: bool = False):
    ensure_project_archive_column()
    ensure_scurve_plan_columns()
    ensure_approval_field_tables()
    ensure_corporate_amr_master_table()
    conn = get_db_connection()
    ensure_plant_level_amr_details_columns(conn)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT p.id,
               p.unique_id,
               p.project_name,
               p.project_type,
               p.formulation_cost,
               p.dic_recommendation_date,
               p.cod_cleared,
               p.cod_date,
               p.stage1_date,
               p.stage1_cost,
               p.stage1_cleared,
               p.expected_tod_date,
               p.final_tod_date,
               p.tender_cancelled,
               p.retender_expected_date,
               p.retender_final_date,
               p.stage2_date,
               p.stage2_cost,
               p.stage2_cleared,
               p.contractor_name,
               p.loa_date,
               p.effective_date,
               p.schedule_months,
               p.schedule_completion,
               p.expected_finish,
               p.completion_marked,
               p.completion_date,
               p.commissioned_marked,
               p.commissioned_date,
               p.project_archived,
               p.parent_project_id,
               m.project_manager,
               m.executing_agency AS master_executing_agency,
               m.expenditure_upto_last_fy,
               m.be_re_current_fy,
               m.actual_cost_current_fy,
               m.cumulative_cost,
               m.contract_signing,
               m.expected_completion_date AS master_expected_completion_date,
               m.status_override,
               d.department AS amr_department,
               d.contractor_name AS amr_contractor_name,
               d.at_no AS amr_at_no,
               d.at_date AS amr_at_date,
               d.scheduled_month AS amr_schedule_months,
               d.schedule_start AS amr_start_date,
               d.schedule_completion AS amr_finish_date,
               d.anticipated_completion AS amr_expected_finish_date,
               d.completion_date AS amr_completion_date,
               d.physical_progress AS amr_physical_progress,
               d.amr_status AS amr_status,
               d.remarks AS amr_remarks,
               d.gross_cost AS plant_amr_gross_cost
        FROM projects p
        LEFT JOIN corporate_amr_master m ON m.project_id = p.id
        LEFT JOIN plant_level_amr_details d ON d.project_id = p.id
        WHERE (
            p.project_type = 'Corporate AMR'
            AND (%s OR COALESCE(p.project_archived, 'N') <> 'Y')
        ) OR (
            p.project_type = 'Plant Level AMR'
            AND COALESCE(p.project_dropped, 'N') <> 'Y'
            AND (%s OR COALESCE(p.project_archived, 'N') <> 'Y')
        )
        ORDER BY p.id DESC
        """
        ,
        (include_archived, include_archived),
    )
    project_rows = [dict(row) for row in cursor.fetchall()]
    approval_values_by_project = {}
    approval_history_by_project = {}
    tender_openings_by_project = {}
    project_ids = [int(row.get("id") or 0) for row in project_rows if row.get("id")]
    if project_ids:
        cursor.execute(
            """
            SELECT project_id, field_key, field_value
            FROM project_approval_fields
            WHERE project_id = ANY(%s)
            """,
            (project_ids,),
        )
        for field_row in cursor.fetchall():
            approval_values_by_project.setdefault(int(field_row["project_id"]), {})[field_row["field_key"]] = field_row["field_value"]
        cursor.execute(
            """
            SELECT project_id, field_key, field_value, revision_no, archived_at
            FROM project_approval_field_history
            WHERE project_id = ANY(%s)
              AND COALESCE(field_value, '') <> ''
            ORDER BY revision_no DESC, id DESC
            """,
            (project_ids,),
        )
        for history_row in cursor.fetchall():
            project_history = approval_history_by_project.setdefault(int(history_row["project_id"]), {})
            project_history.setdefault(history_row["field_key"], []).append({
                "value": history_row["field_value"],
                "revision_no": history_row.get("revision_no"),
                "archived_at": history_row.get("archived_at"),
            })
        cursor.execute(
            """
            SELECT id, project_id, opening_date, remarks
            FROM corporate_amr_tender_openings
            WHERE project_id = ANY(%s)
            ORDER BY id
            """,
            (project_ids,),
        )
        for opening_row in cursor.fetchall():
            tender_openings_by_project.setdefault(int(opening_row["project_id"]), []).append({
                "id": opening_row.get("id"),
                "opening_date": opening_row.get("opening_date"),
                "remarks": opening_row.get("remarks"),
            })
    conn.close()
    active_scurve_by_project = bulk_project_active_scurve_plan_flags(project_ids)
    completed_planning_by_project = bulk_project_completed_planning_flags(project_ids)
    capex_financials_by_project = capex_project_financials_by_project()
    ids_in_view = {int(project.get("id") or 0) for project in project_rows}
    children_by_parent = {}
    roots = []
    for project in project_rows:
        parent_id = int(project.get("parent_project_id") or 0) or None
        if parent_id and parent_id in ids_in_view:
            children_by_parent.setdefault(parent_id, []).append(project)
        else:
            roots.append(project)

    def sort_key(project):
        return int(project.get("id") or 0)

    roots.sort(key=sort_key, reverse=True)
    for child_rows in children_by_parent.values():
        child_rows.sort(key=sort_key, reverse=True)

    rows = []
    visited = set()

    def append_row(project, depth=0):
        project_id = int(project.get("id") or 0)
        if project_id in visited:
            return
        visited.add(project_id)
        gross_cost = project.get("plant_amr_gross_cost") if project.get("project_type") == "Plant Level AMR" else None
        if gross_cost in (None, ""):
            gross_cost = project.get("stage2_cost")
        if gross_cost in (None, ""):
            gross_cost = project.get("stage1_cost")
        if gross_cost in (None, ""):
            gross_cost = project.get("formulation_cost")
        capex_financials = capex_financials_by_project.get(project_id, {})
        plant_status_context = None
        if project.get("project_type") == "Plant Level AMR":
            plant_status_context = plant_level_project_status_context(dict(project))
        status = plant_status_context["status"] if plant_status_context else get_project_status(dict(project))
        status_bucket = registration_status_bucket(status)
        rows.append({
            "id": project["id"],
            "unique_id": project["unique_id"],
            "project_name": project["project_name"],
            "display_name": f"{'    ' * max(0, int(depth or 0))}{'- ' if depth else ''}{project['project_name']}",
            "project_type": project.get("project_type"),
            "status": status,
            "status_bucket": status_bucket,
            "plant_level_status": plant_status_context["status"] if plant_status_context else "",
            "delay_days": plant_status_context["delay_days"] if plant_status_context else "",
            "delay_category": plant_status_context["delay_category"] if plant_status_context else "",
            "gross_cost": gross_cost,
            "dic_recommendation_date": project.get("dic_recommendation_date"),
            "cod_cleared": project.get("cod_cleared"),
            "cod_date": project.get("cod_date"),
            "stage1_date": project.get("stage1_date"),
            "stage1_cost": project.get("stage1_cost"),
            "stage1_cleared": project.get("stage1_cleared"),
            "expected_tod_date": project.get("expected_tod_date"),
            "final_tod_date": project.get("final_tod_date"),
            "tender_cancelled": project.get("tender_cancelled"),
            "retender_expected_date": project.get("retender_expected_date"),
            "retender_final_date": project.get("retender_final_date"),
            "stage2_date": project.get("stage2_date"),
            "stage2_cost": project.get("stage2_cost"),
            "stage2_cleared": project.get("stage2_cleared"),
            "contractor_name": project.get("contractor_name"),
            "project_manager": project.get("project_manager"),
            "master_executing_agency": project.get("master_executing_agency"),
            "expenditure_last_fy": capex_financials.get("expenditure_last_fy", project.get("expenditure_upto_last_fy")),
            "be_current_fy": capex_financials.get("be_current_fy", project.get("be_re_current_fy")),
            "re_current_fy": capex_financials.get("re_current_fy"),
            "be_re": capex_financials.get("be_current_fy", project.get("be_re_current_fy")),
            "actual_current_fy": capex_financials.get("actual_current_fy", project.get("actual_cost_current_fy")),
            "cumulative_cost": capex_financials.get("cumulative_cost", project.get("cumulative_cost")),
            "capex_plan_name": capex_financials.get("capex_plan_name"),
            "capex_re_effective_month": capex_financials.get("capex_re_effective_month"),
            "contract_signing": project.get("contract_signing"),
            "status_override": project.get("status_override"),
            "loa_date": project.get("loa_date"),
            "effective_date": project.get("effective_date"),
            "schedule_months": project.get("schedule_months"),
            "schedule_completion": project.get("schedule_completion"),
            "expected_finish": project.get("expected_finish"),
            "expected_completion_date": project.get("master_expected_completion_date") or project.get("expected_finish"),
            "completion_marked": project.get("completion_marked"),
            "completion_date": project.get("completion_date"),
            "commissioned_marked": project.get("commissioned_marked"),
            "commissioned_date": project.get("commissioned_date"),
            "project_archived": project.get("project_archived"),
            "parent_project_id": project.get("parent_project_id"),
            "has_children": bool(children_by_parent.get(project_id)),
            "is_leaf_project": not bool(children_by_parent.get(project_id)),
            "approval_fields": approval_values_by_project.get(project_id, {}),
            "approval_field_history": approval_history_by_project.get(project_id, {}),
            "tender_openings": tender_openings_by_project.get(project_id, []),
            "hasActiveScurvePlan": active_scurve_by_project.get(project_id, False),
            "hasCompletedPlanning": completed_planning_by_project.get(project_id, False),
        })
        for child in children_by_parent.get(project_id, []):
            append_row(child, depth + 1)

    for root_project in roots:
        append_row(root_project)
    for project in sorted(project_rows, key=sort_key, reverse=True):
        if int(project.get("id") or 0) not in visited:
            append_row(project)

    summary_by_type = {}
    for row in rows:
        if row.get("project_archived") == "Y" or row.get("has_children"):
            continue
        project_type = row.get("project_type") or "Other"
        bucket = summary_by_type.setdefault(project_type, {
            "totalProjects": 0,
            "activeProjects": 0,
            "completedProjects": 0,
            "underApprovalProjects": 0,
            "grossTotal": 0.0,
            "activeGrossTotal": 0.0,
            "completedGrossTotal": 0.0,
            "underApprovalGrossTotal": 0.0,
        })
        status_bucket = row.get("status_bucket") or registration_status_bucket(row.get("status"))
        gross_cost = optional_float(row.get("gross_cost"), 0) or 0
        bucket["totalProjects"] += 1
        if project_type == "Plant Level AMR":
            active_breakup = bucket.setdefault("activeBreakup", {
                "onTime": 0,
                "delayLtOneYear": 0,
                "delayGtOneYear": 0,
            })
            active_breakup_cost = bucket.setdefault("activeBreakupCost", {
                "onTime": 0.0,
                "delayLtOneYear": 0.0,
                "delayGtOneYear": 0.0,
            })
            status_text = str(row.get("status") or "").strip()
            if status_text == "On Time":
                active_breakup["onTime"] += 1
                active_breakup_cost["onTime"] += gross_cost
            elif status_text == "Delay < 1 Yr.":
                active_breakup["delayLtOneYear"] += 1
                active_breakup_cost["delayLtOneYear"] += gross_cost
            elif status_text == "Delay > 1 Yr.":
                active_breakup["delayGtOneYear"] += 1
                active_breakup_cost["delayGtOneYear"] += gross_cost
        if status_bucket == "active":
            bucket["activeProjects"] += 1
            bucket["activeGrossTotal"] += gross_cost
        elif status_bucket == "completed":
            bucket["completedProjects"] += 1
            bucket["completedGrossTotal"] += gross_cost
        else:
            bucket["underApprovalProjects"] += 1
            bucket["underApprovalGrossTotal"] += gross_cost
        bucket["grossTotal"] += gross_cost
    summary_by_type["Plant Level AMR"] = build_plant_level_ongoing_summary_from_dashboard()
    return {"projects": json_ready(rows), "summaryByType": json_ready(summary_by_type)}


@app.get("/api/plant-level-amr")
def plant_level_amr_dashboard(financial_year: str = "", month: str = "", status_as_on: str = ""):
    return json_ready(
        build_plant_level_amr_dashboard(
            today=status_as_on or None,
            financial_year=financial_year or None,
            month=month or None,
        )
    )


@app.patch("/api/plant-level-amr/monthly")
def update_plant_level_amr_monthly(payload: PlantLevelAmrMonthlyPayload):
    try:
        return json_ready(
            update_monthly_value(
                payload.project_id,
                payload.month,
                payload.metric,
                payload.value,
                payload.financial_year,
            )
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/plant-level-amr/edc-idc/monthly")
def update_plant_level_amr_edc_idc_monthly(payload: PlantLevelAmrEdcIdcMonthlyPayload):
    try:
        return json_ready(
            update_edc_idc_monthly(
                payload.month,
                payload.metric,
                payload.value,
                payload.financial_year,
                today=payload.status_as_on or None,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/api/plant-level-amr/edc-idc")
def update_plant_level_amr_edc_idc_bulk(payload: PlantLevelAmrEdcIdcBulkPayload):
    try:
        return json_ready(
            update_edc_idc_values(
                payload.monthly,
                payload.financial_year,
                today=payload.status_as_on or None,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/plant-level-amr/project-field")
def update_plant_level_amr_project(payload: PlantLevelAmrProjectPayload):
    try:
        return json_ready(
            update_plant_level_amr_project_field(
                payload.project_id,
                payload.field,
                payload.value,
                financial_year=payload.financial_year or None,
                month=payload.month or None,
                status_as_on=payload.status_as_on or None,
            )
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/plant-level-amr/project-fields")
def update_plant_level_amr_project_fields_endpoint(payload: PlantLevelAmrProjectFieldsPayload):
    try:
        return json_ready(
            update_plant_level_amr_project_fields(
                payload.project_id,
                payload.fields,
                financial_year=payload.financial_year or None,
                month=payload.month or None,
                status_as_on=payload.status_as_on or None,
            )
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/plant-level-amr/export-pdf")
def export_plant_level_amr_pdf(payload: PlantLevelAmrPdfPayload):
    columns = [str(column or "") for column in (payload.columns or []) if str(column or "").strip()]
    rows = [
        [str(cell or "") for cell in row]
        for row in (payload.rows or [])
        if isinstance(row, list)
    ]
    if not columns:
        raise HTTPException(status_code=400, detail="No columns selected for PDF export")
    pdf = build_simple_table_pdf(payload.title, payload.subtitle, columns, rows)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="plant-level-amr-current-view.pdf"'},
    )


@app.post("/api/plant-level-amr/upload-template")
def upload_plant_level_amr_template(payload: PlantLevelAmrUploadPayload):
    try:
        return json_ready(import_plant_level_amr_template_csv(payload.filename, payload.content))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}")
def project_detail(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id=%s", (project_id,))
    project = cursor.fetchone()
    conn.close()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project_dict = dict(project)
    project_start = project_dict.get("start_date") or project_dict.get("effective_date") or project_dict.get("registration_date")
    project_dict.update(classify_project_financial_year(project_start))
    return {"project": json_ready(project_dict)}


@app.get("/api/projects/{project_id}/appendix")
def project_appendix(project_id: int):
    return {"rows": json_ready(appendix_rows_with_contract_dates(project_id, get_appendix_activity_rows(project_id)))}


@app.put("/api/projects/{project_id}/contract")
def save_project_contract(project_id: int, payload: ContractPayload):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM projects WHERE id=%s", (project_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    schedule_completion = calculate_contract_completion(payload.effective_date, payload.schedule_months)
    expected_finish = to_storage_date(payload.expected_finish) or to_storage_date(schedule_completion)

    cursor.execute(
        """
        UPDATE projects
        SET contractor_name=%s,
            loa_date=%s,
            effective_date=%s,
            schedule_months=%s,
            schedule_completion=%s,
            expected_finish=%s
        WHERE id=%s
        """,
        (
            payload.contractor_name.strip(),
            to_storage_date(payload.loa_date),
            to_storage_date(payload.effective_date),
            payload.schedule_months,
            to_storage_date(schedule_completion),
            expected_finish,
            project_id,
        ),
    )
    cursor.execute("DELETE FROM appendix2 WHERE project_id=%s", (project_id,))
    for row in payload.appendix_rows:
        # Backend is the source of truth for Appendix-2 schedule dates.
        # The UI sends commencement/completion months; dates are derived here.
        schedule_start = calculate_contract_completion(payload.effective_date, row.commencement_months)
        schedule_finish = calculate_contract_completion(payload.effective_date, row.completion_months)
        cursor.execute(
            """
            INSERT INTO appendix2 (
                project_id, s_no, category, item, commencement_months,
                completion_months, schedule_start, schedule_finish
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                project_id,
                row.s_no.strip(),
                row.category.strip(),
                row.item.strip(),
                row.commencement_months,
                row.completion_months,
                to_storage_date(schedule_start),
                to_storage_date(schedule_finish),
            ),
        )
    conn.commit()
    cursor.execute("SELECT * FROM projects WHERE id=%s", (project_id,))
    saved_project = dict(cursor.fetchone())
    conn.close()
    saved_appendix_rows = appendix_rows_with_contract_dates(project_id, get_appendix_activity_rows(project_id))
    return {
        "status": "ok",
        "project": json_ready(saved_project),
        "appendix_rows": json_ready(saved_appendix_rows),
    }


@app.get("/api/projects/{project_id}/activities")
def project_activities(project_id: int):
    ensure_scurve_plan_columns()
    plan_name = get_latest_planned_plan(project_id)
    rows = get_activities_for_plan(project_id, plan_name) if plan_name else []
    return {"planName": plan_name, "activities": json_ready([dict(row) for row in rows])}


@app.get("/api/projects/{project_id}/scurve")
def project_scurve(project_id: int):
    ensure_scurve_plan_columns()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, plan_name, financial_year, plan_version, is_active, is_locked
        FROM plans
        WHERE project_id=%s
        ORDER BY financial_year, id
        """,
        (project_id,),
    )
    plan_records = [dict(row) for row in cursor.fetchall()]
    plans = [row["plan_name"] for row in plan_records]
    appendix_rows = appendix_rows_with_contract_dates(project_id, get_appendix_activity_rows(project_id))
    parent_schedules = build_appendix_parent_schedules(appendix_rows)
    activities_by_plan = {}
    monthly_by_plan = {}
    for plan_name in plans:
        plan_record = next((row for row in plan_records if row["plan_name"] == plan_name), {})
        plan_financial_year = plan_record.get("financial_year") or parse_scurve_plan_name(plan_name)[0] or default_scurve_financial_year()
        cursor.execute(
            """
            SELECT id, activity_type, uom, scope_qty, weight_percent,
                   actuals_till_last_fy, start_date, finish_date,
                   COALESCE(NULLIF(expected_finish, ''), finish_date) AS expected_finish
            FROM activities
            WHERE project_id=%s AND plan_name=%s
            ORDER BY id
            """,
            (project_id, plan_name),
        )
        activities_by_plan[plan_name] = [
            apply_default_scurve_activity_dates(dict(row), appendix_rows, parent_schedules)
            for row in cursor.fetchall()
        ]
        actuals_till_last_fy = scurve_actuals_till_last_fy_by_activity_type(
            cursor,
            project_id,
            plan_financial_year,
            [activity.get("activity_type") for activity in activities_by_plan[plan_name]],
        )
        for activity in activities_by_plan[plan_name]:
            activity_type = activity.get("activity_type") or ""
            activity["actuals_till_last_fy"] = actuals_till_last_fy.get(activity_type, 0.0)
        cursor.execute(
            """
            SELECT activity_type, month, planned_qty
            FROM monthly_plans
            WHERE project_id=%s AND plan_name=%s
            ORDER BY id
            """,
            (project_id, plan_name),
        )
        monthly_rows = {}
        for row in cursor.fetchall():
            activity_type = row["activity_type"] or ""
            month = row["month"] or ""
            monthly_rows.setdefault(activity_type, {})[month] = row["planned_qty"]
        monthly_by_plan[plan_name] = monthly_rows
    conn.close()
    active_plans_by_year = {}
    for row in plan_records:
        if row.get("is_active") != "Y":
            continue
        financial_year = row.get("financial_year") or parse_scurve_plan_name(row.get("plan_name"))[0]
        active_plans_by_year[financial_year] = row["plan_name"]
    active_plan = next(iter(active_plans_by_year.values()), None) or ""
    ui_model = build_scurve_ui_model(plan_records, activities_by_plan, monthly_by_plan)
    return {
        "plans": plans,
        "planRecords": json_ready(plan_records),
        "activePlan": active_plan,
        "activePlansByYear": json_ready(active_plans_by_year),
        "latestPlan": get_latest_planned_plan(project_id),
        "appendixRows": json_ready(appendix_rows),
        "parentSchedules": json_ready_parent_schedules(parent_schedules),
        "activitiesByPlan": json_ready(activities_by_plan),
        "monthlyByPlan": json_ready(monthly_by_plan),
        "ui": json_ready(ui_model),
        "hasCompletedPlanning": project_has_completed_planning(project_id),
    }


@app.get("/api/projects/{project_id}/scurve/seed")
def seed_project_scurve(project_id: int, financial_year: str | None = None):
    fy_start = financial_year_start(financial_year)
    last_fy_end = date(fy_start, 3, 31)
    appendix_rows = appendix_rows_with_contract_dates(project_id, get_appendix_activity_rows(project_id))
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, activity_type, uom, scope_qty, start_date, finish_date,
               COALESCE(NULLIF(expected_finish, ''), finish_date) AS expected_finish
        FROM activities
        WHERE project_id=%s
        ORDER BY id
        """,
        (project_id,),
    )
    existing_activities = [dict(row) for row in cursor.fetchall()]
    existing_ids = [int(row["id"]) for row in existing_activities]
    actuals_by_activity = {}
    if existing_ids:
        cursor.execute(
            """
            SELECT activity_id, COALESCE(SUM(actual_qty), 0) AS actual_qty
            FROM daily_actuals
            WHERE activity_id = ANY(%s)
              AND NULLIF(actual_date, '')::date <= %s
            GROUP BY activity_id
            """,
            (existing_ids, last_fy_end),
        )
        actuals_by_activity = {
            int(row["activity_id"]): float(row["actual_qty"] or 0)
            for row in cursor.fetchall()
        }
    conn.close()

    seeded = []
    for index, appendix_row in enumerate(appendix_rows, start=1):
        matched = [activity for activity in existing_activities if activity_matches_appendix(activity, appendix_row)]
        actuals_till_last_fy = sum(actuals_by_activity.get(int(activity["id"]), 0.0) for activity in matched)
        first_match = matched[-1] if matched else {}
        seeded.append({
            "id": f"seed-{appendix_row.get('id') or index}",
            "activity_type": f"{appendix_row.get('category') or ''}{' -> ' if appendix_row.get('category') and appendix_row.get('item') else ''}{appendix_row.get('item') or ''}".strip(),
            "parent": appendix_row.get("category") or "",
            "child": appendix_row.get("item") or "",
            "uom": first_match.get("uom") or "",
            "scope_qty": first_match.get("scope_qty") or "",
            "weight_percent": 10,
            "actuals_till_last_fy": actuals_till_last_fy,
            "start_date": appendix_row.get("schedule_start") or first_match.get("start_date") or "",
            "finish_date": appendix_row.get("schedule_finish") or first_match.get("finish_date") or "",
            "expected_finish": appendix_row.get("schedule_finish") or first_match.get("expected_finish") or first_match.get("finish_date") or "",
            "locked_fields": ["activity_type", "actuals_till_last_fy", "start_date", "finish_date"],
        })
    return {
        "financialYear": f"{fy_start}-{fy_start + 1}",
        "lastFinancialYearEnd": last_fy_end.isoformat(),
        "activities": json_ready(seeded),
    }


@app.post("/api/projects/{project_id}/scurve/plans")
def create_project_scurve_plan(project_id: int, payload: ScurvePlanCreatePayload):
    ensure_scurve_plan_columns()
    financial_year = str(payload.financial_year or "").strip()
    if not financial_year:
        raise HTTPException(status_code=400, detail="Financial year is required")
    if financial_year not in allowed_scurve_financial_years():
        raise HTTPException(status_code=400, detail="Financial year must be within last 2 FY, current FY, or next FY")
    plan_version = normalize_scurve_plan_version(payload.plan_version)
    if not is_valid_scurve_plan_version(plan_version):
        raise HTTPException(status_code=400, detail="Invalid S-Curve plan version")
    plan_name = scurve_plan_name(financial_year, plan_version)
    fy_start = financial_year_start(financial_year)
    last_fy_end = date(fy_start, 3, 31)

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM projects WHERE id=%s", (project_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")

    cursor.execute(
        """
        SELECT plan_name
        FROM plans
        WHERE project_id=%s
          AND COALESCE(financial_year, '') = %s
          AND COALESCE(plan_version, 'Original Plan') = %s
        ORDER BY id DESC
        LIMIT 1
        """,
        (project_id, financial_year, plan_version),
    )
    existing = cursor.fetchone()
    if existing:
        conn.close()
        return {"status": "exists", "planName": existing["plan_name"]}

    appendix_rows = appendix_rows_with_contract_dates(project_id, get_appendix_activity_rows(project_id))
    source_plan_name = str(payload.source_plan_name or "").strip()
    if source_plan_name:
        cursor.execute(
            """
            SELECT plan_name
            FROM plans
            WHERE project_id=%s AND plan_name=%s
            """,
            (project_id, source_plan_name),
        )
        if not cursor.fetchone():
            source_plan_name = ""
    if not source_plan_name:
        cursor.execute(
            """
            SELECT plan_name
            FROM plans
            WHERE project_id=%s
            ORDER BY CASE WHEN is_active='Y' THEN 0 ELSE 1 END, id DESC
            LIMIT 1
            """,
            (project_id,),
        )
        source_plan = cursor.fetchone()
        source_plan_name = source_plan["plan_name"] if source_plan else ""

    seeded = []
    if source_plan_name:
        cursor.execute(
            """
            SELECT id, activity_type, uom, scope_qty, weight_percent,
                   start_date, finish_date,
                   COALESCE(NULLIF(expected_finish, ''), finish_date) AS expected_finish
            FROM activities
            WHERE project_id=%s AND plan_name=%s
            ORDER BY id
            """,
            (project_id, source_plan_name),
        )
        source_activities = [dict(row) for row in cursor.fetchall()]
        source_actuals = scurve_actuals_till_last_fy_by_activity_type(
            cursor,
            project_id,
            financial_year,
            [activity.get("activity_type") for activity in source_activities],
        )
        for activity in source_activities:
            activity_type = activity.get("activity_type") or ""
            appendix_match = next((row for row in appendix_rows if activity_matches_appendix(activity, row)), {})
            seeded.append({
                "activity_type": activity_type,
                "uom": activity.get("uom") or "",
                "scope_qty": activity.get("scope_qty"),
                "weight_percent": activity.get("weight_percent") if activity.get("weight_percent") is not None else 10,
                "actuals_till_last_fy": source_actuals.get(activity_type, 0),
                "start_date": appendix_match.get("schedule_start") or "",
                "finish_date": appendix_match.get("schedule_finish") or "",
                "expected_finish": appendix_match.get("schedule_finish") or "",
            })
    if not seeded:
        cursor.execute(
            """
            SELECT id, activity_type, uom, scope_qty, start_date, finish_date,
                   COALESCE(NULLIF(expected_finish, ''), finish_date) AS expected_finish
            FROM activities
            WHERE project_id=%s
            ORDER BY id
            """,
            (project_id,),
        )
        existing_activities = [dict(row) for row in cursor.fetchall()]
        actuals_by_type = scurve_actuals_till_last_fy_by_activity_type(
            cursor,
            project_id,
            financial_year,
            [activity.get("activity_type") for activity in existing_activities],
        )
        for index, appendix_row in enumerate(appendix_rows, start=1):
            matched = [activity for activity in existing_activities if activity_matches_appendix(activity, appendix_row)]
            activity_type = f"{appendix_row.get('category') or ''}{' -> ' if appendix_row.get('category') and appendix_row.get('item') else ''}{appendix_row.get('item') or ''}".strip()
            first_match = matched[-1] if matched else {}
            seeded.append({
                "activity_type": activity_type,
                "uom": first_match.get("uom") or "",
                "scope_qty": first_match.get("scope_qty") or None,
                "weight_percent": 10,
                "actuals_till_last_fy": actuals_by_type.get(activity_type, 0),
                "start_date": appendix_row.get("schedule_start") or first_match.get("start_date") or "",
                "finish_date": appendix_row.get("schedule_finish") or first_match.get("finish_date") or "",
                "expected_finish": appendix_row.get("schedule_finish") or first_match.get("expected_finish") or first_match.get("finish_date") or "",
            })
    if not seeded:
        seeded.append({
            "activity_type": "",
            "uom": "",
            "scope_qty": None,
            "weight_percent": 10,
            "actuals_till_last_fy": 0,
            "start_date": "",
            "finish_date": "",
            "expected_finish": "",
        })

    cursor.execute(
        """
        INSERT INTO plans (project_id, plan_name, financial_year, plan_version, is_active, is_locked)
        VALUES (%s, %s, %s, %s, 'N', 'N')
        """,
        (project_id, plan_name, financial_year, plan_version),
    )
    months = scurve_fiscal_months(financial_year)
    for activity in seeded:
        activity_type = str(activity.get("activity_type") or "").strip()
        if not activity_type:
            continue
        cursor.execute(
            """
            INSERT INTO activities (
                project_id, plan_name, activity_type, uom, scope_qty, weight_percent,
                actuals_till_last_fy, start_date, finish_date, expected_finish
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                project_id,
                plan_name,
                activity_type,
                str(activity.get("uom") or "").strip(),
                activity.get("scope_qty"),
                activity.get("weight_percent") if activity.get("weight_percent") is not None else 10,
                activity.get("actuals_till_last_fy") if activity.get("actuals_till_last_fy") is not None else 0,
                to_storage_date(activity.get("start_date")),
                to_storage_date(activity.get("finish_date")),
                to_storage_date(activity.get("expected_finish") or activity.get("finish_date")),
            ),
        )
        for month in months:
            cursor.execute(
                """
                INSERT INTO monthly_plans (project_id, plan_name, activity_type, month, planned_qty, row_type)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (project_id, plan_name, activity_type, month, 0, "planned"),
            )
    conn.commit()
    conn.close()
    return {"status": "copied" if source_plan_name else "created", "planName": plan_name, "sourcePlanName": source_plan_name}


@app.put("/api/projects/{project_id}/scurve")
def save_project_scurve(project_id: int, payload: ScurvePlanPayload):
    ensure_scurve_plan_columns()
    plan_name = payload.plan_name.strip()
    if not plan_name:
        raise HTTPException(status_code=400, detail="Plan name is required")
    parsed_financial_year, parsed_version = parse_scurve_plan_name(plan_name)
    financial_year = (payload.financial_year or parsed_financial_year).strip()
    if not financial_year:
        raise HTTPException(status_code=400, detail="Financial year is required")
    if financial_year not in allowed_scurve_financial_years():
        raise HTTPException(status_code=400, detail="Financial year must be within last 2 FY, current FY, or next FY")
    plan_version = normalize_scurve_plan_version(payload.plan_version or parsed_version or "Original Plan")
    if not is_valid_scurve_plan_version(plan_version):
        raise HTTPException(status_code=400, detail="Invalid S-Curve plan version")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM projects WHERE id=%s", (project_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    cursor.execute("SELECT id, is_locked FROM plans WHERE project_id=%s AND plan_name=%s", (project_id, plan_name))
    existing_plan = cursor.fetchone()
    admin_override = is_admin_role(payload.requested_by_role) or is_admin_role(payload.requested_by_username)
    expected_finish_override = admin_override
    if not expected_finish_override and payload.requested_by_user_id:
        rights = get_user_permissions(payload.requested_by_user_id).get("scurve_expected_finish", {})
        expected_finish_override = bool(rights.get("edit"))
    if existing_plan and existing_plan.get("is_locked") == "Y" and not admin_override:
        conn.close()
        raise HTTPException(status_code=400, detail="This plan is locked. Create a new revision for further changes.")
    if not existing_plan:
        cursor.execute(
            """
            INSERT INTO plans (project_id, plan_name, financial_year, plan_version, is_active, is_locked)
            VALUES (%s, %s, %s, %s, 'N', 'N')
            """,
            (project_id, plan_name, financial_year, plan_version),
        )
    else:
        cursor.execute(
            """
            UPDATE plans
            SET financial_year=%s,
                plan_version=%s
            WHERE project_id=%s AND plan_name=%s
            """,
            (financial_year, plan_version, project_id, plan_name),
        )

    activity_actuals_till_last_fy = scurve_actuals_till_last_fy_by_activity_type(
        cursor,
        project_id,
        financial_year,
        [activity.activity_type for activity in payload.activities],
    )

    cursor.execute("DELETE FROM daily_actuals WHERE activity_id IN (SELECT id FROM activities WHERE project_id=%s AND plan_name=%s)", (project_id, plan_name))
    cursor.execute("DELETE FROM monthly_plans WHERE project_id=%s AND plan_name=%s", (project_id, plan_name))
    cursor.execute("DELETE FROM activities WHERE project_id=%s AND plan_name=%s", (project_id, plan_name))

    appendix_rows = appendix_rows_with_contract_dates(project_id, get_appendix_activity_rows(project_id))
    parent_schedules = build_appendix_parent_schedules(appendix_rows)

    for activity in payload.activities:
        activity_type = activity.activity_type.strip()
        if not activity_type:
            continue
        activity_dates = apply_default_scurve_activity_dates(
            {
                "activity_type": activity_type,
                "start_date": activity.start_date,
                "finish_date": activity.finish_date,
                "expected_finish": activity.expected_finish,
            },
            appendix_rows,
            parent_schedules,
        )
        parent_schedule = scurve_activity_parent_schedule(activity_type, parent_schedules)
        start_date = parse_date(activity_dates.get("start_date"))
        finish_date = parse_date(activity_dates.get("finish_date"))
        if start_date and finish_date and finish_date < start_date:
            conn.close()
            raise HTTPException(status_code=400, detail=f"Finish date cannot be before start date for {activity_type}")
        expected_finish = parse_date(activity_dates.get("expected_finish")) or finish_date
        if expected_finish and finish_date and expected_finish != finish_date and not expected_finish_override:
            conn.close()
            raise HTTPException(status_code=403, detail="Only admin or permitted users can modify expected finish dates")
        if expected_finish and start_date and expected_finish < start_date:
            conn.close()
            raise HTTPException(status_code=400, detail=f"Expected finish cannot be before start date for {activity_type}")
        if parent_schedule:
            parent_start = parent_schedule.get("start")
            parent_finish = parent_schedule.get("finish")
            if start_date and parent_start and start_date < parent_start:
                conn.close()
                raise HTTPException(status_code=400, detail=f"{activity_type} start date is before parent schedule start")
            if finish_date and parent_finish and finish_date > parent_finish:
                conn.close()
                raise HTTPException(status_code=400, detail=f"{activity_type} finish date is after parent schedule finish")
            if expected_finish and parent_start and expected_finish < parent_start:
                conn.close()
                raise HTTPException(status_code=400, detail=f"{activity_type} expected finish is before parent schedule start")
            # Expected Finish can extend a later plan beyond the parent finish.
            # Such extension months are highlighted in the UI and remain bounded by Expected Finish.
        scope_qty_value = optional_float(activity.scope_qty, 0) or 0
        actual_till_last_fy_value = activity_actuals_till_last_fy.get(activity_type, 0)
        planned_qty_total = 0
        for month, value in activity.monthly.items():
            month_name = str(month or "").strip()
            if not month_name:
                continue
            planned_value = optional_float(value, 0) or 0
            if planned_value < 0:
                conn.close()
                raise HTTPException(status_code=400, detail=f"{activity_type}: planned quantity cannot be negative")
            if scurve_month_within_limits(month_name, start_date, finish_date, parent_schedule, expected_finish):
                planned_qty_total += planned_value
        if scope_qty_value > 0 and actual_till_last_fy_value + planned_qty_total > scope_qty_value:
            conn.close()
            raise HTTPException(
                status_code=400,
                detail=f"{activity_type}: Actuals Till Last FY + planned quantity total cannot exceed Scope Qty {scope_qty_value:g}",
            )
        cursor.execute(
            """
            INSERT INTO activities (
                project_id, plan_name, activity_type, uom, scope_qty, weight_percent,
                actuals_till_last_fy, start_date, finish_date, expected_finish
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                project_id,
                plan_name,
                activity_type,
                activity.uom.strip(),
                optional_float(activity.scope_qty),
                optional_float(activity.weight_percent, 10),
                actual_till_last_fy_value,
                to_storage_date(activity_dates.get("start_date")),
                to_storage_date(activity_dates.get("finish_date")),
                to_storage_date(activity_dates.get("expected_finish") or activity_dates.get("finish_date")),
            ),
        )
        for month, value in activity.monthly.items():
            month_name = str(month or "").strip()
            if not month_name:
                continue
            try:
                planned_value = float(value or 0)
            except (TypeError, ValueError):
                planned_value = 0
            if not scurve_month_within_limits(month_name, start_date, finish_date, parent_schedule, expected_finish):
                planned_value = 0
            cursor.execute(
                """
                INSERT INTO monthly_plans (project_id, plan_name, activity_type, month, planned_qty, row_type)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (project_id, plan_name, activity_type, month_name, planned_value, "planned"),
            )
    if payload.make_active:
        cursor.execute(
            """
            UPDATE plans
            SET is_active = 'N'
            WHERE project_id=%s
              AND COALESCE(financial_year, '') = COALESCE(%s, '')
            """,
            (project_id, financial_year),
        )
    cursor.execute(
        """
        UPDATE plans
        SET is_locked = 'Y',
            is_active = CASE WHEN %s THEN 'Y' ELSE is_active END
        WHERE project_id=%s AND plan_name=%s
        """,
        (bool(payload.make_active), project_id, plan_name),
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "planName": plan_name}


@app.post("/api/projects/{project_id}/scurve/active")
def set_project_scurve_active(project_id: int, payload: ScurveActivePlanPayload):
    ensure_scurve_plan_columns()
    plan_name = str(payload.plan_name or "").strip()
    if not plan_name:
        raise HTTPException(status_code=400, detail="Plan name is required")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT financial_year, is_locked FROM plans WHERE project_id=%s AND plan_name=%s", (project_id, plan_name))
    plan = cursor.fetchone()
    if not plan:
        conn.close()
        raise HTTPException(status_code=404, detail="Plan not found")
    if plan.get("is_locked") != "Y":
        conn.close()
        raise HTTPException(status_code=400, detail="Save the plan first. Only locked plans can be marked active.")
    financial_year = plan.get("financial_year") or parse_scurve_plan_name(plan_name)[0]
    cursor.execute(
        """
        UPDATE plans
        SET is_active = 'N'
        WHERE project_id=%s
          AND COALESCE(financial_year, '') = COALESCE(%s, '')
        """,
        (project_id, financial_year),
    )
    cursor.execute(
        """
        UPDATE plans
        SET is_active = 'Y'
        WHERE project_id=%s AND plan_name=%s
        """,
        (project_id, plan_name),
    )
    conn.commit()
    conn.close()
    return {"status": "ok", "planName": plan_name}


@app.delete("/api/projects/{project_id}/scurve")
def delete_project_scurve(project_id: int, plan_name: str, requested_by_role: str = ""):
    ensure_scurve_plan_columns()
    plan_name = str(plan_name or "").strip()
    if not plan_name:
        raise HTTPException(status_code=400, detail="Plan name is required")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, financial_year, is_active, is_locked FROM plans WHERE project_id=%s AND plan_name=%s", (project_id, plan_name))
    plan = cursor.fetchone()
    if not plan:
        conn.close()
        raise HTTPException(status_code=404, detail="Plan not found")
    admin_override = str(requested_by_role or "").strip().lower() == "admin"
    if plan.get("is_locked") == "Y" and not admin_override:
        conn.close()
        raise HTTPException(status_code=400, detail="Locked plans are preserved for revision history and cannot be deleted.")
    cursor.execute("DELETE FROM daily_actuals WHERE activity_id IN (SELECT id FROM activities WHERE project_id=%s AND plan_name=%s)", (project_id, plan_name))
    cursor.execute("DELETE FROM monthly_plans WHERE project_id=%s AND plan_name=%s", (project_id, plan_name))
    cursor.execute("DELETE FROM activities WHERE project_id=%s AND plan_name=%s", (project_id, plan_name))
    cursor.execute("DELETE FROM plans WHERE project_id=%s AND plan_name=%s", (project_id, plan_name))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.delete("/api/projects/{project_id}/scurve/all")
def delete_all_project_scurve_plans(project_id: int, requested_by_role: str = ""):
    ensure_scurve_plan_columns()
    if str(requested_by_role or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admin can delete all S-Curve plans")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM projects WHERE id=%s", (project_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    cursor.execute("DELETE FROM daily_actuals WHERE activity_id IN (SELECT id FROM activities WHERE project_id=%s)", (project_id,))
    cursor.execute("DELETE FROM monthly_plans WHERE project_id=%s", (project_id,))
    cursor.execute("DELETE FROM activities WHERE project_id=%s", (project_id,))
    cursor.execute("DELETE FROM plans WHERE project_id=%s", (project_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.get("/api/projects/{project_id}/daily-progress")
def daily_progress(project_id: int, as_of: str | None = None, plan_name: str | None = None, requested_by_role: str = ""):
    ensure_scurve_plan_columns()
    report_date = parse_date(as_of) or date.today()
    backdate_days = get_daily_progress_backdate_days()
    is_admin_request = str(requested_by_role or "").strip().lower() == "admin"
    requested_plan_name = str(plan_name or "").strip()
    if requested_plan_name:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT plan_name FROM plans WHERE project_id=%s AND plan_name=%s", (project_id, requested_plan_name))
        plan_exists = cursor.fetchone()
        conn.close()
        if not plan_exists:
            raise HTTPException(status_code=404, detail="Selected S-Curve plan was not found for this project")
        plan_name = requested_plan_name
    else:
        plan_name = get_scurve_plan_for_entry_date(project_id, report_date)
        if not plan_name:
            plan_name = get_latest_planned_plan(project_id)
    records = get_daily_progress_display_rows(project_id, plan_name) if plan_name else []
    plan_activities = get_activities_for_plan(project_id, plan_name) if plan_name else []
    entry_status = scurve_plan_entry_status(project_id, plan_name, report_date)
    financial_year = entry_status.get("financialYear") or financial_year_for_date(report_date)
    fy_start_date = date(financial_year_start(financial_year), 4, 1)
    has_completed_planning = bool(entry_status.get("canEnter"))
    activity_ids = [int(row["id"]) for row in plan_activities]
    active_month_label = scurve_month_label(report_date)
    active_month_targets = {}
    fiscal_months = scurve_fiscal_months(financial_year)
    active_month_index = fiscal_months.index(active_month_label) if active_month_label in fiscal_months else -1

    cumulative_actual = {}
    summary_cumulative_actual = {}
    ftm_actual = {}
    today_actual = {}
    area_of_work_by_activity = {}
    actuals_till_last_fy_by_activity_id = {}
    actuals_till_last_fy_by_activity_type = {}
    actuals_till_last_fy_by_normalized_activity = {}
    current_fy_actual_by_activity_type = {}
    current_fy_actual_by_normalized_activity = {}
    ftm_actual_by_activity_type = {}
    ftm_actual_by_normalized_activity = {}
    month_start = report_date.replace(day=1)
    month_end = date(report_date.year, report_date.month, monthrange(report_date.year, report_date.month)[1])
    if activity_ids:
        conn = get_db_connection()
        cursor = conn.cursor()
        actuals_till_last_fy_by_activity_id = daily_actuals_till_last_fy_by_activity_id(cursor, activity_ids, financial_year)
        activity_types = [row.get("activity_type") for row in plan_activities]
        actuals_till_last_fy_by_activity_type = daily_actuals_by_activity_type_between(
            cursor,
            project_id,
            activity_types,
            None,
            fy_start_date - timedelta(days=1),
        )
        actuals_till_last_fy_by_normalized_activity = daily_actuals_by_normalized_activity_between(
            cursor,
            project_id,
            None,
            fy_start_date - timedelta(days=1),
        )
        current_fy_actual_by_activity_type = daily_actuals_by_activity_type_between(
            cursor,
            project_id,
            activity_types,
            fy_start_date,
            month_end,
        )
        current_fy_actual_by_normalized_activity = daily_actuals_by_normalized_activity_between(
            cursor,
            project_id,
            fy_start_date,
            month_end,
        )
        ftm_actual_by_activity_type = daily_actuals_by_activity_type_between(
            cursor,
            project_id,
            activity_types,
            month_start,
            month_end,
        )
        ftm_actual_by_normalized_activity = daily_actuals_by_normalized_activity_between(
            cursor,
            project_id,
            month_start,
            month_end,
        )
        cursor.execute(
            """
            SELECT activity_id,
                   COALESCE(SUM(CASE WHEN actual_date::date <= %s THEN actual_qty ELSE 0 END), 0) AS cumulative_actual,
                   COALESCE(SUM(CASE WHEN actual_date::date <= %s THEN actual_qty ELSE 0 END), 0) AS summary_cumulative_actual,
                   COALESCE(SUM(CASE WHEN actual_date::date >= %s AND actual_date::date <= %s THEN actual_qty ELSE 0 END), 0) AS ftm_actual
            FROM daily_actuals
            WHERE activity_id = ANY(%s)
              AND actual_date::date >= %s
              AND actual_date::date <= %s
            GROUP BY activity_id
            """,
            (report_date, month_end, month_start, month_end, activity_ids, fy_start_date, month_end),
        )
        for row in cursor.fetchall():
            cumulative_actual[int(row["activity_id"])] = float(row["cumulative_actual"] or 0)
            summary_cumulative_actual[int(row["activity_id"])] = float(row["summary_cumulative_actual"] or 0)
            ftm_actual[int(row["activity_id"])] = float(row["ftm_actual"] or 0)
        cursor.execute(
            """
            SELECT activity_id,
                   COALESCE(SUM(actual_qty), 0) AS actual_today,
                   MAX(COALESCE(area_of_work, '')) AS area_of_work
            FROM daily_actuals
            WHERE activity_id = ANY(%s)
              AND actual_date::date = %s
            GROUP BY activity_id
            """,
            (activity_ids, report_date),
        )
        for row in cursor.fetchall():
            today_actual[int(row["activity_id"])] = float(row["actual_today"] or 0)
            area_of_work_by_activity[int(row["activity_id"])] = row.get("area_of_work") or ""
        cursor.execute(
            """
            SELECT activity_type,
                   COALESCE(SUM(CASE WHEN month = %s THEN planned_qty ELSE 0 END), 0) AS month_planned_qty,
                   COALESCE(SUM(CASE WHEN month = ANY(%s) THEN planned_qty ELSE 0 END), 0) AS fy_planned_qty
            FROM monthly_plans
            WHERE project_id = %s
              AND plan_name = %s
            GROUP BY activity_type
            """,
            (
                active_month_label,
                fiscal_months[:active_month_index + 1] if active_month_index >= 0 else [active_month_label],
                project_id,
                plan_name,
            ),
        )
        for row in cursor.fetchall():
            active_month_targets[str(row.get("activity_type") or "")] = {
                "monthPlan": float(row.get("month_planned_qty") or 0),
                "currentFyPlan": float(row.get("fy_planned_qty") or 0),
            }
        conn.close()

    activities = [activity for activity in plan_activities]
    activity_ids = [int(row["id"]) for row in activities]

    def dynamic_actual_till_last_fy(activity):
        activity_id = int(activity.get("id") or 0)
        activity_type = str(activity.get("activity_type") or "")
        direct_actual = float(actuals_till_last_fy_by_activity_id.get(activity_id, 0.0) or 0)
        if direct_actual:
            return direct_actual
        exact_actual = float(actuals_till_last_fy_by_activity_type.get(activity_type, 0.0) or 0)
        if exact_actual:
            return exact_actual
        return float(actuals_till_last_fy_by_normalized_activity.get(normalize_activity_text(activity_type), 0.0) or 0)

    activity_summary_rows = []
    for activity in activities:
        activity_id = int(activity["id"])
        actual_till_last_fy = dynamic_actual_till_last_fy(activity)
        activity_parent, activity_child = split_scurve_activity_type(activity.get("activity_type"))
        activity_name = activity_child or activity.get("activity_type") or progress_category(activity.get("activity_type"))
        activity_type = str(activity.get("activity_type") or "")
        activity_plan_targets = active_month_targets.get(activity_type, {})
        ftm_plan = activity_plan_targets.get("monthPlan", 0.0)
        current_fy_plan = activity_plan_targets.get("currentFyPlan", 0.0)
        current_fy_actual = summary_cumulative_actual.get(activity_id, 0.0)
        if not current_fy_actual:
            current_fy_actual = current_fy_actual_by_activity_type.get(activity_type, 0.0)
        if not current_fy_actual:
            current_fy_actual = current_fy_actual_by_normalized_activity.get(normalize_activity_text(activity_type), 0.0)
        activity_ftm_actual = ftm_actual.get(activity_id, 0.0)
        if not activity_ftm_actual:
            activity_ftm_actual = ftm_actual_by_activity_type.get(activity_type, 0.0)
        if not activity_ftm_actual:
            activity_ftm_actual = ftm_actual_by_normalized_activity.get(normalize_activity_text(activity_type), 0.0)
        activity_summary_rows.append({
            "id": activity_id,
            "parent": activity_parent,
            "category": activity_name,
            "activity": activity_name,
            "scope": float(activity.get("scope_qty") or 0),
            "uom": activity.get("uom") or "",
            "weightPercent": float(activity.get("weight_percent") or 0),
            "ftmPlan": ftm_plan,
            "ftmActual": activity_ftm_actual,
            "lastFyPlan": actual_till_last_fy,
            "lastFyActual": actual_till_last_fy,
            "currentFyPlan": current_fy_plan,
            "currentFyActual": current_fy_actual,
            "cumulativePlan": actual_till_last_fy + current_fy_plan,
            "cumulativeActual": actual_till_last_fy + current_fy_actual,
        })

    capex_financials = capex_project_financials_by_project().get(int(project_id), {})
    capex_scope = float(capex_financials.get("gross_cost") or 0)
    capex_monthly_plan = capex_financials.get("monthly_plan") or {}
    capex_monthly_actual = capex_financials.get("monthly_actual") or {}
    capex_current_fy_plan = sum(float(capex_monthly_plan.get(month) or 0) for month in fiscal_months[:active_month_index + 1]) if active_month_index >= 0 else 0.0
    capex_current_fy_actual = sum(float(capex_monthly_actual.get(month) or 0) for month in fiscal_months[:active_month_index + 1]) if active_month_index >= 0 else 0.0
    capex_last_fy_actual = float(capex_financials.get("expenditure_last_fy") or 0)
    activity_summary_rows.append({
        "id": "capex",
        "category": "Capex",
        "activity": "Capex",
        "source": "capex",
        "scope": capex_scope,
        "uom": "Cr.",
        "weightPercent": 0,
        "ftmPlan": float(capex_monthly_plan.get(active_month_label) or 0),
        "ftmActual": float(capex_monthly_actual.get(active_month_label) or 0),
        "lastFyPlan": capex_last_fy_actual,
        "lastFyActual": capex_last_fy_actual,
        "currentFyPlan": capex_current_fy_plan,
        "currentFyActual": capex_current_fy_actual,
        "cumulativePlan": capex_last_fy_actual + capex_current_fy_plan,
        "cumulativeActual": capex_last_fy_actual + capex_current_fy_actual,
    })

    scope_rows = activity_summary_rows
    dpr_summary = build_dpr_summary_model(scope_rows, report_date)
    planned_percent = dpr_summary["totals"]["plannedPercent"]
    actual_percent = dpr_summary["totals"]["actualPercent"]
    appendix_rows = appendix_rows_with_contract_dates(project_id, get_appendix_activity_rows(project_id))
    dpr_rows = []
    matched_activity_ids = set()
    for appendix_row in appendix_rows:
        matched = [
            dict(activity)
            for activity in activities
            if int(activity["id"]) not in matched_activity_ids and activity_matches_appendix(activity, appendix_row)
        ]
        if not matched:
            continue
        for activity in matched:
            activity_id = int(activity["id"])
            matched_activity_ids.add(activity_id)
            activity_type = activity.get("activity_type") or ""
            current_fy_actual = cumulative_actual.get(activity_id, 0.0)
            actual_till_last_fy = dynamic_actual_till_last_fy(activity)
            dpr_rows.append({
                "id": f"activity-{activity_id}",
                "appendix_id": appendix_row.get("id"),
                "activity_id": activity_id,
                "parent": appendix_row.get("category") or "",
                "activity": appendix_row.get("item") or activity.get("activity_type") or "",
                "scope": float(activity.get("scope_qty") or 0),
                "unit": activity.get("uom") or "",
                "monthTarget": active_month_targets.get(activity_type, {}).get("monthPlan", 0.0),
                "cumulativeActual": actual_till_last_fy + current_fy_actual,
                "actualsTillLastFy": actual_till_last_fy,
                "currentFyActual": current_fy_actual,
                "todayActual": today_actual.get(activity_id, 0.0),
                "areaOfWork": area_of_work_by_activity.get(activity_id, ""),
            })
    for activity in activities:
        activity_id = int(activity["id"])
        if activity_id in matched_activity_ids:
            continue
        activity_type = activity.get("activity_type") or ""
        current_fy_actual = cumulative_actual.get(activity_id, 0.0)
        actual_till_last_fy = dynamic_actual_till_last_fy(activity)
        dpr_rows.append({
            "id": f"activity-{activity_id}",
            "appendix_id": None,
            "activity_id": activity_id,
            "parent": progress_category(activity.get("activity_type")),
            "activity": activity.get("activity_type") or "",
            "scope": float(activity.get("scope_qty") or 0),
            "unit": activity.get("uom") or "",
            "monthTarget": active_month_targets.get(activity_type, {}).get("monthPlan", 0.0),
            "cumulativeActual": actual_till_last_fy + current_fy_actual,
            "actualsTillLastFy": actual_till_last_fy,
            "currentFyActual": current_fy_actual,
            "todayActual": today_actual.get(activity_id, 0.0),
            "areaOfWork": area_of_work_by_activity.get(activity_id, ""),
        })

    activity_labels = {}
    activity_report_columns = []
    seen_report_activity_ids = set()
    for row in dpr_rows:
        activity_id = row.get("activity_id")
        if not activity_id or int(activity_id) in seen_report_activity_ids:
            continue
        activity_id = int(activity_id)
        seen_report_activity_ids.add(activity_id)
        label = row.get("activity") or row.get("parent") or f"Activity {activity_id}"
        activity_labels[activity_id] = label
        activity_report_columns.append({
            "id": activity_id,
            "label": label,
            "category": row.get("parent") or "",
            "uom": row.get("unit") or "",
            "scope": row.get("scope") or 0,
        })

    report_dates = set()
    for row in records:
        parsed_report_date = parse_date(row.get("report_date"))
        if parsed_report_date:
            report_dates.add(parsed_report_date)
    activity_actuals_by_date = {}
    if activity_ids:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT actual_date::date AS report_date,
                   activity_id,
                   COALESCE(SUM(actual_qty), 0) AS actual_qty
            FROM daily_actuals
            WHERE activity_id = ANY(%s)
            GROUP BY actual_date::date, activity_id
            ORDER BY actual_date::date DESC
            """,
            (activity_ids,),
        )
        for row in cursor.fetchall():
            parsed_report_date = parse_date(row.get("report_date"))
            if not parsed_report_date:
                continue
            report_dates.add(parsed_report_date)
            bucket = activity_actuals_by_date.setdefault(parsed_report_date, {})
            bucket[str(int(row["activity_id"]))] = float(row.get("actual_qty") or 0)
        conn.close()

    activity_report_rows = [
        {
            "date": report_date,
            "values": activity_actuals_by_date.get(report_date, {}),
        }
        for report_date in sorted(report_dates, reverse=True)
    ]
    dpr_entry_rows = [
        {
            "id": row.get("id"),
            "activity_id": row.get("activity_id"),
            "parent": row.get("parent") or "",
            "activity": row.get("activity") or "",
            "scope": row.get("scope"),
            "unit": row.get("unit") or "",
            "monthTarget": row.get("monthTarget"),
            "actualsTillLastFy": row.get("actualsTillLastFy") or 0,
            "currentFyActual": row.get("currentFyActual") or 0,
            "currentFyBaseActual": float(row.get("currentFyActual") or 0) - float(row.get("todayActual") or 0),
            "baseActual": float(row.get("cumulativeActual") or 0) - float(row.get("todayActual") or 0),
            "todayProgress": row.get("todayActual") or 0,
            "area": row.get("areaOfWork") or "",
        }
        for row in dpr_rows
    ]
    manpower_rows = default_daily_progress_manpower_rows()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT section_name, category_name, contractor_name, role_name, qty, sort_order,
               COALESCE(month_target, '') AS month_target,
               COALESCE(last_month_average, 0) AS last_month_average,
               COALESCE(remarks, '') AS remarks
        FROM daily_progress_manpower
        WHERE project_id=%s AND report_date::date=%s
        ORDER BY sort_order, id
        """,
        (project_id, report_date),
    )
    saved_manpower_rows = [dict(row) for row in cursor.fetchall()]
    cursor.execute(
        """
        SELECT DISTINCT contractor_name
        FROM daily_progress_manpower
        WHERE project_id=%s
          AND category_name='Contractor'
          AND COALESCE(contractor_name, '') <> ''
        ORDER BY contractor_name
        """,
        (project_id,),
    )
    known_contractors = [row["contractor_name"] for row in cursor.fetchall() if row.get("contractor_name")]
    conn.close()
    if saved_manpower_rows:
        manpower_rows = []
        for index, row in enumerate(saved_manpower_rows, start=1):
            section_name = str(row.get("section_name") or "")
            category_name = str(row.get("category_name") or "")
            role_name = str(row.get("role_name") or "")
            contractor_name = ""
            if section_name == "Rourkela Steel Plant Manpower" and category_name == "Executives":
                category, trade = "RSP - Executive", ""
            elif section_name == "Rourkela Steel Plant Manpower" and category_name == "Non-Executives":
                category, trade = "RSP - Non Executive", ""
            elif category_name == "Contractor":
                category, trade = "Contractor", role_name
                contractor_name = row.get("contractor_name") or ""
            else:
                category, trade = "Executing Agency", role_name or category_name
                contractor_name = ""
            manpower_rows.append({
                "id": index,
                "category": category,
                "contractorGroupId": contractor_name if category == "Contractor" else "",
                "contractorName": contractor_name,
                "trade": trade,
                "designation": "",
                "scope": "",
                "unit": "",
                "lastMonth": row.get("last_month_average") or 0,
                "today": row.get("qty") or 0,
                "remarks": row.get("remarks") or "",
            })
    existing_contractors = {
        str(row.get("contractorName") or "").strip()
        for row in manpower_rows
        if row.get("category") == "Contractor" and str(row.get("contractorName") or "").strip()
    }
    next_row_id = len(manpower_rows) + 1
    for contractor_name in known_contractors:
        if contractor_name in existing_contractors:
            continue
        manpower_rows.extend([
            {
                "id": next_row_id,
                "category": "Contractor",
                "contractorGroupId": contractor_name,
                "contractorName": contractor_name,
                "trade": "Supervisor",
                "designation": "",
                "scope": "",
                "unit": "",
                "lastMonth": "0",
                "today": "0",
                "remarks": "",
            },
            {
                "id": next_row_id + 1,
                "category": "Contractor",
                "contractorGroupId": contractor_name,
                "contractorName": contractor_name,
                "trade": "Labour",
                "designation": "",
                "scope": "",
                "unit": "",
                "lastMonth": "0",
                "today": "0",
                "remarks": "",
            },
        ])
        next_row_id += 2

    return {
        "planName": plan_name,
        "planMonth": active_month_label,
        "dateWindow": {
            "backdateDays": backdate_days,
            "minDate": "" if is_admin_request else (date.today() - timedelta(days=backdate_days)).isoformat(),
            "maxDate": "" if is_admin_request else date.today().isoformat(),
            "adminUnlimited": is_admin_request,
        },
        "hasCompletedPlanning": has_completed_planning,
        "entryAllowed": has_completed_planning,
        "entryStatus": json_ready(entry_status),
        "financialYear": financial_year,
        "asOf": report_date.isoformat(),
        "records": json_ready([dict(row) for row in records]),
        "dprRows": json_ready(dpr_rows),
        "entryRows": json_ready(dpr_entry_rows),
        "manpowerRows": json_ready(manpower_rows),
        "scopeRows": json_ready(scope_rows),
        "summary": json_ready(dpr_summary),
        "activityReportColumns": json_ready(activity_report_columns),
        "activityReportRows": json_ready(activity_report_rows),
        "plannedPercent": planned_percent,
        "actualPercent": actual_percent,
        "projectContext": json_ready(daily_progress_project_context(project_id)),
    }


@app.get("/api/projects/{project_id}/daily-progress/activity-actuals")
def daily_progress_activity_actuals(
    project_id: int,
    activity_id: int,
    as_of: str | None = None,
    plan_name: str | None = None,
    requested_by_role: str = "",
):
    if str(requested_by_role or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admin can view monthly activity actuals")

    ensure_scurve_plan_columns()
    report_date = parse_date(as_of) or date.today()
    financial_year = financial_year_for_date(report_date)
    selected_plan_name = str(plan_name or "").strip() or get_scurve_plan_for_entry_date(project_id, report_date)
    if not selected_plan_name:
        raise HTTPException(status_code=400, detail=f"No S-Curve plan found for FY {financial_year}")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, activity_type, uom, scope_qty
        FROM activities
        WHERE id=%s AND project_id=%s AND plan_name=%s
        """,
        (activity_id, project_id, selected_plan_name),
    )
    activity = cursor.fetchone()
    if not activity:
        conn.close()
        raise HTTPException(status_code=404, detail="Activity was not found for the selected project plan")

    months = scurve_fiscal_months(financial_year)
    month_lookup = {
        month: {
            "actualQty": 0.0,
            "remark": "",
            "areaOfWork": "",
            "saveDate": (last_working_day_for_month(month) or date.today()).isoformat(),
        }
        for month in months
    }
    fy_start = date(financial_year_start(financial_year), 4, 1)
    fy_end = date(financial_year_start(financial_year) + 1, 4, 1)
    cursor.execute(
        """
        SELECT actual_date::date AS actual_date,
               COALESCE(actual_qty, 0) AS actual_qty,
               COALESCE(area_of_work, '') AS area_of_work,
               COALESCE(remarks, '') AS remarks
        FROM daily_actuals
        WHERE activity_id=%s
          AND actual_date::date >= %s
          AND actual_date::date < %s
        ORDER BY actual_date
        """,
        (activity_id, fy_start, fy_end),
    )
    for row in cursor.fetchall():
        month_label = scurve_month_label(parse_date(row.get("actual_date")))
        if month_label not in month_lookup:
            continue
        month_lookup[month_label]["actualQty"] += float(row.get("actual_qty") or 0)
        remark = str(row.get("remarks") or "").strip()
        area_of_work = str(row.get("area_of_work") or "").strip()
        if remark:
            month_lookup[month_label]["remark"] = remark
        elif area_of_work and not month_lookup[month_label]["remark"]:
            month_lookup[month_label]["remark"] = area_of_work
        if area_of_work:
            month_lookup[month_label]["areaOfWork"] = area_of_work
    conn.close()

    return {
        "projectId": project_id,
        "activityId": activity_id,
        "activity": activity.get("activity_type") or "",
        "unit": activity.get("uom") or "",
        "scope": activity.get("scope_qty") or 0,
        "planName": selected_plan_name,
        "financialYear": financial_year,
        "rows": [
            {
                "month": month,
                "actualQty": month_lookup[month]["actualQty"],
                "remark": month_lookup[month]["remark"],
                "areaOfWork": month_lookup[month]["areaOfWork"],
                "saveDate": month_lookup[month]["saveDate"],
            }
            for month in months
        ],
    }


@app.post("/api/projects/{project_id}/daily-progress/activity-actuals")
def save_daily_progress_activity_actuals(project_id: int, payload: DailyProgressMonthlyActualsPayload):
    if str(payload.requested_by_role or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admin can update monthly activity actuals")

    ensure_scurve_plan_columns()
    report_date = parse_date(payload.as_of) or date.today()
    financial_year = financial_year_for_date(report_date)
    selected_plan_name = str(payload.plan_name or "").strip() or get_scurve_plan_for_entry_date(project_id, report_date)
    if not selected_plan_name:
        raise HTTPException(status_code=400, detail=f"No S-Curve plan found for FY {financial_year}")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id
        FROM activities
        WHERE id=%s AND project_id=%s AND plan_name=%s
        """,
        (payload.activity_id, project_id, selected_plan_name),
    )
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Activity was not found for the selected project plan")

    allowed_months = set(scurve_fiscal_months(financial_year))
    saved_rows = 0
    for row in payload.rows or []:
        month = str(row.month or "").strip()
        if month not in allowed_months:
            continue
        month_start, month_end = scurve_month_bounds(month)
        save_date = last_working_day_for_month(month)
        if not month_start or not month_end or not save_date:
            continue
        actual_qty = optional_float(row.actual_qty, 0) or 0
        remark = str(row.remark or "").strip()
        cursor.execute(
            """
            DELETE FROM daily_actuals
            WHERE activity_id=%s
              AND actual_date::date >= %s
              AND actual_date::date < %s
            """,
            (payload.activity_id, month_start, month_end),
        )
        if actual_qty or remark:
            cursor.execute(
                """
                INSERT INTO daily_actuals (activity_id, actual_date, actual_qty, area_of_work, remarks)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (payload.activity_id, save_date, actual_qty, remark, remark),
            )
            saved_rows += 1
    conn.commit()
    conn.close()
    return {"status": "ok", "saved": saved_rows, "financialYear": financial_year}


@app.post("/api/projects/{project_id}/daily-progress/actuals")
def save_daily_progress_actuals(project_id: int, payload: DailyProgressActualsPayload):
    ensure_scurve_plan_columns()
    report_date = parse_date(payload.report_date)
    if not report_date:
        raise HTTPException(status_code=400, detail="Valid report date is required")

    is_admin_request = str(payload.requested_by_role or "").strip().lower() == "admin"
    if not is_admin_request:
        backdate_days = get_daily_progress_backdate_days()
        min_date = date.today() - timedelta(days=backdate_days)
        max_date = date.today()
        if report_date < min_date or report_date > max_date:
            raise HTTPException(
                status_code=400,
                detail=f"Daily Progress entry is allowed only from {min_date.isoformat()} to {max_date.isoformat()}",
            )

    requested_plan_name = str(payload.plan_name or "").strip()
    plan_name = requested_plan_name or get_scurve_plan_for_entry_date(project_id, report_date) or get_latest_planned_plan(project_id)
    if not plan_name:
        raise HTTPException(status_code=400, detail="No active S-Curve plan found for the selected date")
    entry_status = scurve_plan_entry_status(project_id, plan_name, report_date)
    if not entry_status.get("canEnter"):
        raise HTTPException(status_code=400, detail=entry_status.get("message") or "Confirm S-Curve planning before Daily Progress entry")

    activities = [dict(row) for row in get_activities_for_plan(project_id, plan_name)]
    allowed_activity_ids = {int(row["id"]) for row in activities}
    if not allowed_activity_ids:
        raise HTTPException(status_code=400, detail="No active S-Curve activities found for the selected date")

    normalized_actuals = {}
    area_of_work_by_activity = {}
    activity_by_id = {int(row["id"]): row for row in activities}
    for row in payload.actuals:
        if row.activity_id is None:
            continue
        activity_id = int(row.activity_id)
        if activity_id not in allowed_activity_ids:
            continue
        actual_qty = optional_float(row.actual_qty, 0) or 0
        area_of_work = str(row.area_of_work or "").strip()
        if actual_qty > 0 and not area_of_work:
            raise HTTPException(status_code=400, detail="Area of Work is mandatory where Physical Progress is greater than 0")
        normalized_actuals[activity_id] = actual_qty
        area_of_work_by_activity[activity_id] = area_of_work

    manpower_summary = {
        "rsp_executive": 0,
        "rsp_non_executive": 0,
        "executing_agency": 0,
        "labour_deployed": 0,
        "supervisor": 0,
        "contractor_supervisor": 0,
        "contractor_labour": 0,
    }
    manpower_detail_rows = []
    for index, row in enumerate(payload.manpowerRows or [], start=1):
        category = str(row.category or "").strip()
        contractor_name = str(row.contractorName or "").strip()
        trade = str(row.trade or "").strip()
        qty = max(0, int(optional_float(row.today, 0) or 0))
        month_target = str(row.monthTarget or "").strip()
        last_month = optional_float(row.lastMonth, 0) or 0
        remarks = str(row.remarks or "").strip()
        if category == "RSP - Executive":
            section_name, category_name, role_name = "Rourkela Steel Plant Manpower", "Executives", ""
            manpower_summary["rsp_executive"] += qty
        elif category == "RSP - Non Executive":
            section_name, category_name, role_name = "Rourkela Steel Plant Manpower", "Non-Executives", ""
            manpower_summary["rsp_non_executive"] += qty
        elif category == "Contractor":
            section_name, category_name, role_name = "Executing Agency", "Contractor", trade
            if trade == "Supervisor":
                manpower_summary["contractor_supervisor"] += qty
            elif trade == "Labour":
                manpower_summary["contractor_labour"] += qty
            manpower_summary["executing_agency"] += qty
        else:
            section_name, category_name, role_name = "Executing Agency", "Agency Manpower", trade or category
            manpower_summary["executing_agency"] += qty
        if qty or month_target or last_month or remarks:
            manpower_detail_rows.append({
                "section_name": section_name,
                "category_name": category_name,
                "contractor_name": contractor_name if category == "Contractor" else None,
                "role_name": role_name,
                "qty": qty,
                "month_target": month_target,
                "last_month": last_month,
                "remarks": remarks,
                "sort_order": index,
            })

    progress_summary = {
        **manpower_summary,
        "design_engineering": 0,
        "civil": 0,
        "structural_supply": 0,
        "structural_erection": 0,
        "equipment_supply": 0,
        "equipment_erection": 0,
    }
    for activity_id, actual_qty in normalized_actuals.items():
        bucket = classify_activity_progress(activity_by_id.get(activity_id, {}).get("activity_type"))
        if bucket and bucket in progress_summary:
            progress_summary[bucket] += actual_qty

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO daily_progress
        (project_id, report_date, rsp_executive, rsp_non_executive, executing_agency,
         labour_deployed, supervisor, design_engineering, civil,
         structural_supply, structural_erection, equipment_supply, equipment_erection)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (project_id, report_date)
        DO UPDATE SET
            rsp_executive=EXCLUDED.rsp_executive,
            rsp_non_executive=EXCLUDED.rsp_non_executive,
            executing_agency=EXCLUDED.executing_agency,
            labour_deployed=EXCLUDED.labour_deployed,
            supervisor=EXCLUDED.supervisor,
            design_engineering=EXCLUDED.design_engineering,
            civil=EXCLUDED.civil,
            structural_supply=EXCLUDED.structural_supply,
            structural_erection=EXCLUDED.structural_erection,
            equipment_supply=EXCLUDED.equipment_supply,
            equipment_erection=EXCLUDED.equipment_erection
        """,
        (
            project_id,
            report_date,
            manpower_summary["rsp_executive"],
            manpower_summary["rsp_non_executive"],
            manpower_summary["executing_agency"],
            manpower_summary["contractor_labour"],
            manpower_summary["contractor_supervisor"],
            int(round(progress_summary["design_engineering"])),
            int(round(progress_summary["civil"])),
            int(round(progress_summary["structural_supply"])),
            int(round(progress_summary["structural_erection"])),
            int(round(progress_summary["equipment_supply"])),
            int(round(progress_summary["equipment_erection"])),
        ),
    )
    cursor.execute("DELETE FROM daily_progress_manpower WHERE project_id=%s AND report_date=%s", (project_id, report_date))
    for row in manpower_detail_rows:
        cursor.execute(
            """
            INSERT INTO daily_progress_manpower
            (project_id, report_date, section_name, category_name, contractor_name, role_name, qty, sort_order,
             month_target, last_month_average, remarks)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                project_id,
                report_date,
                row["section_name"],
                row["category_name"],
                row.get("contractor_name"),
                row["role_name"],
                row["qty"],
                row["sort_order"],
                row["month_target"],
                row["last_month"],
                row["remarks"],
            ),
        )
    for activity_id, actual_qty in normalized_actuals.items():
        cursor.execute("DELETE FROM daily_actuals WHERE activity_id=%s AND actual_date::date=%s", (activity_id, report_date))
        if actual_qty:
            cursor.execute(
                """
                INSERT INTO daily_actuals (activity_id, actual_date, actual_qty, area_of_work, remarks)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    activity_id,
                    report_date,
                    actual_qty,
                    area_of_work_by_activity.get(activity_id, ""),
                    area_of_work_by_activity.get(activity_id, ""),
                ),
            )
    conn.commit()
    conn.close()
    return {"status": "ok", "saved": len(normalized_actuals), "reportDate": report_date.isoformat()}


@app.get("/api/dashboard/summary")
def dashboard_summary():
    ensure_project_archive_column()
    def to_float(value):
        try:
            text = str(value or "").replace(",", "").strip()
            return float(text) if text else 0.0
        except (TypeError, ValueError):
            return 0.0

    def current_financial_year():
        today = date.today()
        start = today.year if today.month >= 4 else today.year - 1
        return start, start + 1

    def in_current_fy(value):
        parsed = parse_date(value)
        if not parsed:
            return False
        start_year, end_year = current_financial_year()
        return date(start_year, 4, 1) <= parsed <= date(end_year, 3, 31)

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, unique_id, project_name, project_type, registration_date, effective_date, start_date,
               cod_cleared, stage1_cleared, final_tod_date, stage2_cleared,
               stage1_cost, stage2_cost, completion_marked, completion_date,
               commissioned_marked, schedule_completion, project_dropped, parent_project_id
        FROM projects
        WHERE COALESCE(project_archived, 'N') <> 'Y'
        ORDER BY id DESC
        """
    )
    projects = [dict(row) for row in cursor.fetchall()]
    conn.close()
    child_parent_ids = {int(project.get("parent_project_id") or 0) for project in projects if int(project.get("parent_project_id") or 0)}
    for project in projects:
        project["has_children"] = int(project.get("id") or 0) in child_parent_ids
        project["is_leaf_project"] = not project["has_children"]
    countable_projects = [project for project in projects if project.get("is_leaf_project")]
    total_projects = len(countable_projects)
    corporate_projects = sum(1 for project in countable_projects if project.get("project_type") == "Corporate AMR")
    plant_level_projects = sum(1 for project in countable_projects if project.get("project_type") == "Plant Level AMR")
    ongoing = sum(1 for project in countable_projects if project.get("stage2_cleared") == "Y" and project.get("completion_marked") != "Y")
    completed = sum(1 for project in countable_projects if project.get("completion_marked") == "Y")
    dropped = sum(1 for project in countable_projects if project.get("project_dropped") == "Y")
    completed_this_fy = sum(1 for project in countable_projects if project.get("completion_marked") == "Y" and in_current_fy(project.get("completion_date")))
    start_year, end_year = current_financial_year()
    dashboard_financial_year = normalize_financial_year(f"{start_year}-{str(end_year)[-2:]}")
    fy_classification_counts = {
        f"Started during FY {dashboard_financial_year}": {"count": 0, "color": "green"},
        "Ongoing Since Last FY": {"count": 0, "color": "orange"},
    }
    project_rows = []
    total_cost = 0.0
    stage_buckets = {
        "Formulation": {"projects": 0, "cost": 0.0},
        "Stage - 1": {"projects": 0, "cost": 0.0},
        "Tendering": {"projects": 0, "cost": 0.0},
        "Stage - 2": {"projects": 0, "cost": 0.0},
    }
    status_buckets = {
        "On Time": {"count": 0, "cost": 0.0, "color": "#2ca83f"},
        "Delay < 1 Year": {"count": 0, "cost": 0.0, "color": "#f5c400"},
        "Delay > 1 Year": {"count": 0, "cost": 0.0, "color": "#ff6a1a"},
        "Completed this FY": {"count": 0, "cost": 0.0, "color": "#0b65d8"},
    }
    heatmap = {
        stage: {
            "Stage": stage,
            "On Time": 0,
            "Delay < 1 Year": 0,
            "Delay > 1 Year": 0,
            "Completed This FY": 0,
        }
        for stage in stage_buckets
    }
    for project in projects:
        is_countable = bool(project.get("is_leaf_project"))
        gross_cost = project.get("stage2_cost")
        if gross_cost in (None, ""):
            gross_cost = project.get("stage1_cost")
        gross_cost = float(gross_cost or 0)
        if is_countable:
            total_cost += gross_cost
        status = get_project_status(project)
        if status == "Under Formulation":
            stage_name = "Formulation"
        elif status == "Stage-1":
            stage_name = "Stage - 1"
        elif status == "Tendering":
            stage_name = "Tendering"
        else:
            stage_name = "Stage - 2"
        if is_countable:
            stage_buckets[stage_name]["projects"] += 1
            stage_buckets[stage_name]["cost"] += gross_cost
        completion_date = parse_date(project.get("schedule_completion"))
        if project.get("completion_marked") == "Y" and in_current_fy(project.get("completion_date")):
            status_name = "Completed this FY"
            schedule_text = "Completed"
        elif completion_date and completion_date < date.today():
            delay_days = (date.today() - completion_date).days
            status_name = "Delay > 1 Year" if delay_days > 365 else "Delay < 1 Year"
            schedule_text = f"Behind Schedule ({delay_days} days)"
        else:
            status_name = "On Time"
            schedule_text = "On Schedule"
        if is_countable:
            status_buckets[status_name]["count"] += 1
            status_buckets[status_name]["cost"] += gross_cost
            heatmap[stage_name]["Completed This FY" if status_name == "Completed this FY" else status_name] += 1
        project_start = project.get("start_date") or project.get("effective_date") or project.get("registration_date")
        fy_context = classify_project_financial_year(project_start, dashboard_financial_year, date.today())
        fy_classification_counts.setdefault(
            fy_context["fy_classification"],
            {"count": 0, "color": fy_context["fy_classification_color"]},
        )
        if is_countable:
            fy_classification_counts[fy_context["fy_classification"]]["count"] += 1
        project_rows.append({
            "id": project.get("id"),
            "unique_id": project.get("unique_id"),
            "project_name": project.get("project_name"),
            "project_type": project.get("project_type"),
            "gross_cost": gross_cost,
            "actual_ytd": gross_cost * 0.0,
            "achievement_percent": 0.0,
            "registration_date": to_display_date(project.get("registration_date")),
            "project_start_date": fy_context["project_start_date"],
            "financial_year": fy_context["financial_year"],
            "fy_start_date": fy_context["fy_start_date"],
            "fy_end_date": fy_context["fy_end_date"],
            "fy_classification": fy_context["fy_classification"],
            "fy_classification_color": fy_context["fy_classification_color"],
            "schedule_completion": to_display_date(project.get("schedule_completion")),
            "completion_date": to_display_date(project.get("completion_date")),
            "status": status,
            "delivery_status": status_name,
            "schedule": schedule_text,
            "stage1_cleared": project.get("stage1_cleared"),
            "stage2_cleared": project.get("stage2_cleared"),
            "completion_marked": project.get("completion_marked"),
            "project_dropped": project.get("project_dropped"),
            "parent_project_id": project.get("parent_project_id"),
            "has_children": project.get("has_children"),
            "is_leaf_project": project.get("is_leaf_project"),
        })
    capex_trend = []
    total_be = 0.0
    total_actual = 0.0
    try:
        capex_payload = read_capex_payload()
        active_plan = capex_payload.get("active_plan")
        active_rows = capex_payload.get("plans", {}).get(active_plan, {}).get("rows") or []
    except Exception:
        active_rows = []
    capex_display = capex_display_rows(active_rows, capex_all_column_labels()) if active_rows else []
    top_level_capex_rows = [
        row for row in capex_display
        if int(row.get("indent") or 0) == 0
    ]
    for month in CAPEX_MONTHS:
        be_total = sum(to_float((row.get("display") or {}).get(f"{month} BE")) for row in top_level_capex_rows)
        actual_total = sum(to_float((row.get("display") or {}).get(f"{month} Actual")) for row in top_level_capex_rows)
        total_be += be_total
        total_actual += actual_total
        capex_trend.append({
            "month": month.split("-")[0],
            "be": be_total,
            "actual": actual_total,
            "achievement": (actual_total / be_total * 100) if be_total else 0,
        })
    for row in project_rows:
        cost_share = (row["gross_cost"] / total_cost) if total_cost else 0
        row["actual_ytd"] = total_actual * cost_share
        row["achievement_percent"] = (row["actual_ytd"] / row["gross_cost"] * 100) if row["gross_cost"] else 0
    variance = max(0.0, total_be - total_actual)
    stage_rows = [
        {"stage": stage, "projects": data["projects"], "cost": data["cost"]}
        for stage, data in stage_buckets.items()
    ]
    status_rows = [
        {"label": label, "value": data["count"], "cost": data["cost"], "color": data["color"]}
        for label, data in status_buckets.items()
    ]
    fy_classification_rows = [
        {"label": label, "value": data["count"], "color": data["color"]}
        for label, data in fy_classification_counts.items()
    ]
    dashboard = {
        "financialYear": f"{start_year}-{str(end_year)[-2:]}",
        "fyStartClassification": fy_classification_rows,
        "monthRange": f"Apr {start_year} - Mar {end_year}",
        "kpis": {
            "totalCapex": total_be,
            "actualCapex": total_actual,
            "achievementPercent": (total_actual / total_be * 100) if total_be else 0,
            "totalProjects": total_projects,
            "totalProjectCost": total_cost,
            "completedProjects": completed_this_fy,
            "corporateProjects": corporate_projects,
            "plantLevelProjects": plant_level_projects,
        },
        "capexTrend": capex_trend,
        "statusRows": status_rows,
        "stageRows": stage_rows,
        "heatmapRows": list(heatmap.values()),
        "capexSummary": {
            "totalBeRe": total_be,
            "totalActual": total_actual,
            "variance": variance,
            "variancePercent": (variance / total_be * 100) if total_be else 0,
        },
        "projectList": project_rows,
    }
    return {
        "cards": {
            "totalProjects": total_projects,
            "ongoingProjects": ongoing,
            "completedProjects": completed,
            "droppedProjects": dropped,
            "totalProjectCost": total_cost,
        },
        "recentProjects": json_ready(project_rows[:8]),
        "projects": json_ready(project_rows),
        "dashboard": json_ready(dashboard),
    }


@app.get("/api/capex")
def capex_snapshot(plan_name: str | None = None):
    try:
        payload = read_capex_payload()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to read CAPEX data: {exc}") from exc
    active_plan = plan_name if plan_name in (payload.get("plans") or {}) else payload.get("active_plan")
    plans = payload.get("plans") or {}
    active_plan_record = plans.get(active_plan, {})
    active_rows = active_plan_record.get("rows", [])
    all_column_keys = [label for label, _, _ in ALL_COLUMNS]
    planning_column_keys = capex_planning_column_labels()
    display_rows = capex_display_rows(active_rows, all_column_keys)
    planning_display_rows = capex_display_rows(active_rows, planning_column_keys)
    gross_total = capex_top_level_total(display_rows, "Gross Cost")
    fy_plan_total = capex_top_level_total(display_rows, "BE (FY)")
    fy_re_total = capex_top_level_total(display_rows, "RE (FY)")
    actual_till_date_total = capex_actual_till_date_total(display_rows)
    active_plan_total = fy_re_total if active_plan_record.get("plan_type") == "RE" and fy_re_total else fy_plan_total
    variance_total = active_plan_total - actual_till_date_total
    return {
        "financialYear": payload.get("financial_year"),
        "activePlan": active_plan,
        "plans": [
            {"name": name, **{key: value for key, value in plan.items() if key != "rows"}}
            for name, plan in plans.items()
        ],
        "columns": [{"key": label, "label": label, "width": width, "color": color} for label, width, color in ALL_COLUMNS],
        "planningColumns": [{"key": label, "label": label} for label in capex_planning_column_labels()],
        "months": CAPEX_MONTHS,
        "rows": json_ready(active_rows),
        "displayRows": json_ready(display_rows),
        "planningDisplayRows": json_ready(planning_display_rows),
        "grossTotal": gross_total,
        "fyPlanTotal": fy_plan_total,
        "fyReTotal": fy_re_total,
        "activePlanTotal": active_plan_total,
        "actualTillDateTotal": actual_till_date_total,
        "varianceTotal": variance_total,
        "progressPercent": capex_progress_percent(active_plan_total, actual_till_date_total),
        "validationMessage": capex_validation_message(active_rows),
        "editableCells": json_ready(capex_editable_cells(active_rows, list(set(all_column_keys + planning_column_keys)), active_plan_record)),
    }


@app.patch("/api/capex/cell")
def update_capex_cell(payload: CapexCellPayload):
    capex_payload = read_capex_payload()
    plan_name, plan = get_capex_plan(capex_payload, payload.plan_name)
    valid_columns = capex_all_column_labels()
    if payload.column not in valid_columns:
        raise HTTPException(status_code=400, detail="Invalid CAPEX column")
    rows = plan.get("rows") or []
    row = next((item for item in rows if int(item.get("row_id") or 0) == int(payload.row_id)), None)
    if not row:
        raise HTTPException(status_code=404, detail="CAPEX row not found")
    rows = sync_capex_rows(rows)
    row_index = next((idx for idx, item in enumerate(rows) if int(item.get("row_id") or 0) == int(payload.row_id)), None)
    if row_index is None or not capex_can_edit_cell(rows, row_index, payload.column, plan):
        raise HTTPException(status_code=400, detail="This CAPEX cell is locked for the selected plan type")
    row = rows[row_index]
    row.setdefault("values", capex_empty_values())[payload.column] = payload.value
    if str(plan.get("plan_type") or "BE").upper() == "RE":
        rows = capex_apply_re_effective_rules(rows, plan.get("effective_from_month"))
    finalized_rows = capex_finalize_rows(rows)
    capex_validate_plan_amounts(finalized_rows, plan.get("plan_type"))
    plan["rows"] = finalized_rows
    capex_payload["active_plan"] = plan_name
    write_capex_payload(capex_payload)
    return {"status": "ok"}


@app.put("/api/capex/rows")
def save_capex_rows(payload: CapexRowsPayload):
    capex_payload = read_capex_payload()
    plan_name, plan = get_capex_plan(capex_payload, payload.plan_name)
    rows = capex_merge_editable_rows(plan.get("rows") or [], payload.rows, plan)
    if str(plan.get("plan_type") or "BE").upper() == "RE":
        rows = capex_apply_re_effective_rules(rows, plan.get("effective_from_month"))
    finalized_rows = capex_finalize_rows(rows)
    capex_validate_plan_amounts(finalized_rows, plan.get("plan_type"))
    plan["rows"] = finalized_rows
    capex_payload["active_plan"] = plan_name
    write_capex_payload(capex_payload)
    return {"status": "ok"}


@app.post("/api/capex/plans")
def create_capex_plan(payload: CapexPlanCreatePayload):
    financial_year = (payload.financial_year or build_financial_year_label()).strip()
    plan_version = normalize_capex_plan_version(payload.plan_version)
    plan_type = (payload.plan_type or "BE").strip().upper()
    if plan_type not in ("BE", "RE"):
        raise HTTPException(status_code=400, detail="Plan type must be BE or RE")
    effective_from_month = (payload.effective_from_month or "").strip()
    if plan_type == "RE" and effective_from_month not in CAPEX_MONTHS:
        raise HTTPException(status_code=400, detail="Select RE effective month before creating an RE plan")
    if plan_version == "Final Approved Plan":
        raise HTTPException(status_code=400, detail="Final Approved Plan is created only after approval")
    capex_payload = read_capex_payload()
    plan_key = capex_plan_key(financial_year, plan_version, plan_type)
    if plan_key in capex_payload.get("plans", {}):
        raise HTTPException(status_code=400, detail="This planning dataset already exists")
    source_key = payload.source_plan_name if payload.source_plan_name in capex_payload.get("plans", {}) else capex_payload.get("active_plan")
    source_rows = capex_payload.get("plans", {}).get(source_key, {}).get("rows")
    if source_rows:
        source_rows = clone_capex_rows(source_rows)
    else:
        source_rows = capex_sync_project_rows(capex_default_rows())
    if plan_type == "RE":
        source_rows = capex_apply_re_effective_rules(source_rows, effective_from_month)
    new_rows = capex_finalize_rows(source_rows)
    capex_validate_plan_amounts(new_rows, plan_type)
    capex_payload.setdefault("plans", {})[plan_key] = capex_build_plan_record(
        new_rows,
        financial_year,
        plan_version,
        plan_type,
        approved=False,
        locked=False,
        effective=False,
        effective_from_month=effective_from_month,
    )
    capex_payload["active_plan"] = plan_key
    write_capex_payload(capex_payload)
    return {"status": "ok", "plan": plan_key}


@app.post("/api/capex/plans/effective")
def set_capex_effective(payload: CapexEffectivePayload):
    capex_payload = read_capex_payload()
    plan_name, plan = get_capex_plan(capex_payload, payload.plan_name)
    if not plan.get("approved"):
        raise HTTPException(status_code=400, detail="Only approved plans can be set effective")
    for name, item in capex_payload.get("plans", {}).items():
        item["effective"] = name == plan_name
    capex_payload["active_plan"] = plan_name
    write_capex_payload(capex_payload)
    return {"status": "ok"}


def delete_capex_plan_record(payload: CapexPlanDeletePayload):
    capex_payload = read_capex_payload()
    plan_name, plan = get_capex_plan(capex_payload, payload.plan_name)
    admin_override = str(payload.requested_by_role or "").strip().lower() == "admin"
    if not admin_override and (plan.get("locked") or plan.get("approved") or plan.get("plan_version") == "Final Approved Plan"):
        raise HTTPException(status_code=400, detail="Approved or locked CAPEX plans cannot be deleted")
    plans = capex_payload.get("plans") or {}
    if plan_name not in plans:
        raise HTTPException(status_code=404, detail="CAPEX plan not found")
    del plans[plan_name]
    if capex_payload.get("active_plan") == plan_name:
        capex_payload["active_plan"] = next(iter(plans.keys()), "")
    write_capex_payload(capex_payload)
    return {"status": "ok", "activePlan": capex_payload.get("active_plan", "")}


@app.delete("/api/capex/plans")
def delete_capex_plan(payload: CapexPlanDeletePayload):
    return delete_capex_plan_record(payload)


@app.post("/api/capex/plans/delete")
def delete_capex_plan_via_post(payload: CapexPlanDeletePayload):
    return delete_capex_plan_record(payload)


@app.post("/api/capex/plans/approve")
def approve_capex_plan(payload: CapexApprovePayload):
    capex_payload = read_capex_payload()
    plan_name, plan = get_capex_plan(capex_payload, payload.plan_name)
    if plan.get("locked") and plan.get("approved") and plan.get("effective"):
        raise HTTPException(status_code=400, detail="This plan is already approved and active")
    source_rows = capex_finalize_rows(plan.get("rows") or [])
    financial_year = str(plan.get("financial_year") or build_financial_year_label())
    plan_type = str(plan.get("plan_type") or "BE").upper()
    final_rows = clone_capex_rows(source_rows)
    effective_month = payload.effective_from_month or plan.get("effective_from_month") or ""
    if plan_type == "RE" and effective_month in CAPEX_MONTHS:
        effective_index = CAPEX_MONTHS.index(effective_month)
        approved_be_key = capex_plan_key(financial_year, "Final Approved Plan", "BE")
        base_rows = capex_payload.get("plans", {}).get(approved_be_key, {}).get("rows") or source_rows
        base_lookup = {
            str((row.get("values") or {}).get("CAPEX Plan (FY)") or "").strip(): row
            for row in base_rows
        }
        for row in final_rows:
            if row.get("level") != "Item":
                continue
            label = str((row.get("values") or {}).get("CAPEX Plan (FY)") or "").strip()
            base_values = (base_lookup.get(label, {}) or {}).get("values", {})
            values = row.get("values", {})
            for month_index, month in enumerate(CAPEX_MONTHS):
                be_key = f"{month} BE"
                re_key = f"{month} RE"
                if month_index < effective_index and str(base_values.get(be_key) or "").strip():
                    values[be_key] = str(base_values.get(be_key) or "")
                elif month_index >= effective_index and str(values.get(re_key) or "").strip():
                    values[be_key] = str(values.get(re_key) or "")
    capex_validate_plan_amounts(final_rows, plan_type)
    plan["rows"] = final_rows
    plan["financial_year"] = financial_year
    plan["plan_type"] = plan_type
    plan["approved"] = True
    plan["locked"] = True
    plan["effective_from_month"] = effective_month
    for name, item in capex_payload.get("plans", {}).items():
        item["effective"] = name == plan_name
    capex_payload["active_plan"] = plan_name
    write_capex_payload(capex_payload)
    return {"status": "ok", "plan": plan_name}


@app.post("/api/capex/rows")
def add_capex_row(payload: CapexRowPayload):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Item name is required")
    capex_payload = read_capex_payload()
    plan_name, plan = get_capex_plan(capex_payload, payload.plan_name)
    if plan.get("locked"):
        raise HTTPException(status_code=400, detail="This CAPEX plan is locked")
    rows = plan.get("rows") or []
    next_id = max([int(row.get("row_id") or 0) for row in rows] or [0]) + 1
    new_values = capex_empty_values()
    new_values["CAPEX Plan (FY)"] = payload.name.strip()
    new_row = {
        "row_id": next_id,
        "values": new_values,
        "indent": capex_normalize_indent(payload.indent),
        "level": capex_level(payload.indent),
        "children": [],
        "collapsed": False,
        "imported_for": None,
    }
    insert_at = len(rows)
    if payload.after_row_id:
        index, end = capex_row_block(rows, payload.after_row_id)
        insert_at = end + 1
    rows.insert(insert_at, new_row)
    plan["rows"] = capex_finalize_rows(rows)
    capex_payload["active_plan"] = plan_name
    write_capex_payload(capex_payload)
    return {"status": "ok", "row": json_ready(new_row)}


@app.delete("/api/capex/rows")
def delete_capex_row(payload: CapexDeleteRowPayload):
    capex_payload = read_capex_payload()
    plan_name, plan = get_capex_plan(capex_payload, payload.plan_name)
    admin_override = str(payload.requested_by_role or "").strip().lower() == "admin"
    if plan.get("locked") and not admin_override:
        raise HTTPException(status_code=400, detail="This CAPEX plan is locked")
    rows = plan.get("rows") or []
    start, end = capex_row_block(rows, payload.row_id)
    del rows[start:end + 1]
    plan["rows"] = capex_finalize_rows(rows)
    capex_payload["active_plan"] = plan_name
    write_capex_payload(capex_payload)
    return {"status": "ok"}


@app.patch("/api/capex/rows/move")
def move_capex_row(payload: CapexRowMovePayload):
    capex_payload = read_capex_payload()
    plan_name, plan = get_capex_plan(capex_payload, payload.plan_name)
    if plan.get("locked"):
        raise HTTPException(status_code=400, detail="This CAPEX plan is locked")
    rows = plan.get("rows") or []
    start, end = capex_row_block(rows, payload.row_id)
    block = rows[start:end + 1]
    del rows[start:end + 1]
    if int(payload.direction or 0) < 0:
        insert_at = max(0, start - 1)
        while insert_at > 0 and rows[insert_at]["indent"] > block[0]["indent"]:
            insert_at -= 1
    else:
        insert_at = min(len(rows), start + 1)
        while insert_at < len(rows) and rows[insert_at]["indent"] > block[0]["indent"]:
            insert_at += 1
    rows[insert_at:insert_at] = block
    plan["rows"] = capex_finalize_rows(rows)
    capex_payload["active_plan"] = plan_name
    write_capex_payload(capex_payload)
    return {"status": "ok"}


@app.patch("/api/capex/rows/indent")
def indent_capex_row(payload: CapexRowIndentPayload):
    capex_payload = read_capex_payload()
    plan_name, plan = get_capex_plan(capex_payload, payload.plan_name)
    if plan.get("locked"):
        raise HTTPException(status_code=400, detail="This CAPEX plan is locked")
    rows = plan.get("rows") or []
    start, end = capex_row_block(rows, payload.row_id)
    delta = 1 if int(payload.delta or 0) > 0 else -1
    for row in rows[start:end + 1]:
        row["indent"] = capex_normalize_indent(row.get("indent") + delta)
    plan["rows"] = capex_finalize_rows(rows)
    capex_payload["active_plan"] = plan_name
    write_capex_payload(capex_payload)
    return {"status": "ok"}


@app.get("/api/schedules")
def schedules():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT si.id, si.file_name, si.imported_at, COUNT(sa.id) AS activity_count
        FROM schedule_imports si
        LEFT JOIN schedule_activities sa ON sa.schedule_id = si.id
        GROUP BY si.id, si.file_name, si.imported_at
        ORDER BY si.id DESC
        """
    )
    rows = cursor.fetchall()
    conn.close()
    return {"schedules": json_ready([dict(row) for row in rows])}


@app.get("/api/schedules/{schedule_id}/activities")
def schedule_activities(schedule_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT activity_code, activity_name, wbs, duration_days, start_date,
               finish_date, percent_complete, total_float, is_critical
        FROM schedule_activities
        WHERE schedule_id=%s
        ORDER BY id
        LIMIT 300
        """,
        (schedule_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return {"activities": json_ready([dict(row) for row in rows])}


@app.get("/api/billing-schedule")
def billing_schedule(project_id: int | None = None):
    ensure_billing_schedule_table()
    projects = get_billing_project_rows()
    project_ids = {int(project["id"]) for project in projects}
    requested_project_id = int(project_id or 0) or None
    active_project_id = requested_project_id if requested_project_id in project_ids else (int(projects[0]["id"]) if projects else None)
    rows = []
    appendix_rows = []
    if active_project_id:
        appendix_rows = get_billing_appendix_rows(active_project_id)
        sync_billing_milestones_from_appendix(active_project_id)
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT *
            FROM billing_schedule
            WHERE project_id=%s
            ORDER BY milestone_no NULLS LAST, id
            """,
            (active_project_id,),
        )
        rows = [dict(row) for row in cursor.fetchall()]
        conn.close()
    meta = billing_plan_meta(rows)
    appendix_by_id = {int(row.get("appendix2_id") or 0): row for row in rows if row.get("appendix2_id") is not None}
    appendix_activities = []
    for index, appendix_row in enumerate(appendix_rows, start=1):
        item = billing_appendix_activity_json(appendix_row, index)
        linked = appendix_by_id.get(int(appendix_row.get("id") or 0))
        item["scheduledAmount"] = billing_float(linked.get("scheduled_amount")) if linked else 0
        item["billedAmount"] = billing_float(linked.get("billed_amount")) if linked else 0
        item["billingLinkedPercent"] = (item["billedAmount"] / item["scheduledAmount"] * 100) if item["scheduledAmount"] else 0
        item["status"] = billing_status(linked) if linked else "Not Billed"
        appendix_activities.append(item)
    workflow_steps = [
        {"label": "Draft Created", "date": "", "status": "done" if rows else "active"},
        {"label": "Submitted", "date": "", "status": "done" if rows else "pending"},
        {"label": "Reviewed by Finance", "date": "", "status": "active" if meta["approvalStatus"] == "Under Review" else "pending"},
        {"label": "Approved by ED(P)", "date": "", "status": "done" if meta["approvalStatus"] == "Approved" else "pending"},
        {"label": "Active Billing Plan", "date": "", "status": "done" if meta["isActive"] and meta["approvalStatus"] == "Approved" else "pending"},
    ]
    clearance_rows = [
        {
            "item": row.get("description"),
            "linkedMilestone": row.get("milestone_no"),
            "manufacturing": row.get("manufacturing_clearance") or "-",
            "inspection": row.get("inspection_clearance") or "-",
            "dispatch": row.get("dispatch_clearance") or "-",
            "siteReceipt": row.get("site_receipt_clearance") or "-",
            "eligibility": billing_eligibility(row),
            "remarks": row.get("remarks") or "",
        }
        for row in rows
    ]
    return {
        "projects": json_ready(projects),
        "projectId": active_project_id,
        "rows": json_ready([billing_row_json(row) for row in rows]),
        "summary": json_ready(billing_summary(rows)),
        "meta": json_ready(meta),
        "appendixActivities": json_ready(appendix_activities),
        "workflow": json_ready(workflow_steps),
        "clearanceRows": json_ready(clearance_rows),
        "auditLog": json_ready([
            {"date": "", "action": "Draft Created", "by": "Project Manager", "remarks": "Billing schedule generated from Appendix-2"}
        ] if rows else []),
    }


@app.post("/api/billing-schedule")
def create_billing_milestone(payload: BillingMilestonePayload):
    ensure_billing_schedule_table()
    ensure_billing_project_allowed(payload.project_id)
    milestone_no = billing_int(payload.milestone_no)
    if milestone_no is None:
        raise HTTPException(status_code=400, detail="Milestone number is required")
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="Description is required")
    validate_billing_payload(payload)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO billing_schedule (
            project_id, milestone_no, description, milestone_type, weightage_percent,
            schedule_start, schedule_finish,
            scheduled_amount, scheduled_date,
            billed_amount, billed_date, received_amount, received_date, remarks,
            manufacturing_clearance, inspection_clearance, dispatch_clearance,
            site_receipt_clearance, approval_clearance
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            payload.project_id,
            milestone_no,
            payload.description.strip(),
            payload.milestone_type.strip() or "Physical",
            billing_float(payload.weightage_percent),
            to_storage_date(payload.schedule_start),
            to_storage_date(payload.schedule_finish),
            billing_float(payload.scheduled_amount),
            to_storage_date(payload.scheduled_date),
            billing_float(payload.billed_amount),
            to_storage_date(payload.billed_date),
            billing_float(payload.received_amount),
            to_storage_date(payload.received_date),
            payload.remarks.strip(),
            payload.manufacturing_clearance.strip(),
            payload.inspection_clearance.strip(),
            payload.dispatch_clearance.strip(),
            payload.site_receipt_clearance.strip(),
            payload.approval_clearance.strip(),
        ),
    )
    row = dict(cursor.fetchone())
    conn.commit()
    conn.close()
    return {"status": "ok", "row": json_ready(billing_row_json(row))}


@app.put("/api/billing-schedule/{milestone_id}")
def update_billing_milestone(milestone_id: int, payload: BillingMilestonePayload):
    ensure_billing_schedule_table()
    ensure_billing_project_allowed(payload.project_id)
    milestone_no = billing_int(payload.milestone_no)
    if milestone_no is None:
        raise HTTPException(status_code=400, detail="Milestone number is required")
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="Description is required")
    validate_billing_payload(payload, milestone_id)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE billing_schedule SET
            project_id=%s,
            milestone_no=%s,
            description=%s,
            milestone_type=%s,
            weightage_percent=%s,
            schedule_start=%s,
            schedule_finish=%s,
            scheduled_amount=%s,
            scheduled_date=%s,
            billed_amount=%s,
            billed_date=%s,
            received_amount=%s,
            received_date=%s,
            remarks=%s,
            manufacturing_clearance=%s,
            inspection_clearance=%s,
            dispatch_clearance=%s,
            site_receipt_clearance=%s,
            approval_clearance=%s
        WHERE id=%s
        RETURNING *
        """,
        (
            payload.project_id,
            milestone_no,
            payload.description.strip(),
            payload.milestone_type.strip() or "Physical",
            billing_float(payload.weightage_percent),
            to_storage_date(payload.schedule_start),
            to_storage_date(payload.schedule_finish),
            billing_float(payload.scheduled_amount),
            to_storage_date(payload.scheduled_date),
            billing_float(payload.billed_amount),
            to_storage_date(payload.billed_date),
            billing_float(payload.received_amount),
            to_storage_date(payload.received_date),
            payload.remarks.strip(),
            payload.manufacturing_clearance.strip(),
            payload.inspection_clearance.strip(),
            payload.dispatch_clearance.strip(),
            payload.site_receipt_clearance.strip(),
            payload.approval_clearance.strip(),
            milestone_id,
        ),
    )
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Billing milestone not found")
    row = dict(row)
    conn.commit()
    conn.close()
    return {"status": "ok", "row": json_ready(billing_row_json(row))}


@app.delete("/api/billing-schedule/{milestone_id}")
def delete_billing_milestone(milestone_id: int):
    ensure_billing_schedule_table()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM billing_schedule WHERE id=%s RETURNING id", (milestone_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Billing milestone not found")
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.get("/api/admin/users")
def admin_users():
    users = []
    for row in get_all_users():
        user = dict(row)
        user["permissions"] = complete_user_permissions(user["id"], user.get("role"))
        user["projectIds"] = list(get_user_project_ids(user["id"]))
        users.append(user)
    return {
        "users": json_ready(users),
        "projects": json_ready([dict(row) for row in get_all_project_choices()]),
        "modules": [{"key": key, "label": label} for key, label in APP_MODULES],
    }


@app.put("/api/admin/users/rights")
def update_admin_user_rights(payload: AdminUserRightsPayload):
    if str(payload.requested_by_role or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admin can update user rights")
    save_user_permissions(payload.user_id, payload.permissions or {})
    save_user_projects(payload.user_id, payload.project_ids or [])
    target_user = next((dict(row) for row in get_all_users() if int(row["id"]) == int(payload.user_id)), {})
    return {
        "status": "ok",
        "permissions": json_ready(complete_user_permissions(payload.user_id, target_user.get("role", "user"))),
        "projectIds": list(get_user_project_ids(payload.user_id)),
    }


@app.get("/api/admin/daily-progress-settings")
def admin_daily_progress_settings():
    backdate_days = get_daily_progress_backdate_days()
    return {"backdateDays": backdate_days}


@app.put("/api/admin/daily-progress-settings")
def update_admin_daily_progress_settings(payload: DailyProgressSettingsPayload):
    if str(payload.requested_by_role or "").strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admin can update Daily Progress date settings")
    backdate_days = max(0, min(int(payload.backdate_days or 0), 365))
    set_app_setting("daily_progress_backdate_days", backdate_days)
    return {"status": "ok", "backdateDays": backdate_days}


@app.get("/api/reports/summary")
def reports_summary():
    ensure_project_archive_column()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT project_type, COUNT(*) AS count
        FROM projects
        WHERE COALESCE(project_archived, 'N') <> 'Y'
        GROUP BY project_type
        ORDER BY project_type
        """
    )
    by_type = cursor.fetchall()
    cursor.execute(
        """
        SELECT
            COALESCE(SUM(stage1_cost), 0) AS stage1_cost,
            COALESCE(SUM(stage2_cost), 0) AS stage2_cost
        FROM projects
        WHERE COALESCE(project_archived, 'N') <> 'Y'
        """
    )
    costs = cursor.fetchone()
    conn.close()
    return {
        "byType": json_ready([dict(row) for row in by_type]),
        "costs": json_ready(dict(costs or {})),
    }
