from datetime import datetime, date
from calendar import monthrange
from database import get_db_connection
from tkinter import Button, CENTER, Label, PhotoImage
from tkinter import ttk
import os

STANDARD_BUTTON_WIDTH = 24
STANDARD_BUTTON_HEIGHT = 2
STANDARD_IMAGE_BUTTON_WIDTH = 190
STANDARD_IMAGE_BUTTON_HEIGHT = 42
SMALL_BUTTON_TEXTS = {"📅"}

DISPLAY_DATE_FORMAT = "%d-%m-%y"
STORAGE_DATE_FORMAT = "%Y-%m-%d"

# ==================== FIXED WATERMARK PATH ====================
# Now portable - works for any user and any operating system
WATERMARK_DIR = os.path.join(os.path.expanduser("~"), "Documents", "New project")
WATERMARK_PATH = os.path.join(WATERMARK_DIR, "app_watermark.png")
APP_DIR = os.path.dirname(os.path.abspath(__file__))
APP_LOGO_PATH = os.path.join(APP_DIR, "Logo.png")
_WATERMARK_CACHE = None
# ============================================================

def parse_app_date(date_value):
    if isinstance(date_value, datetime):
        return date_value.date()
    if isinstance(date_value, date):
        return date_value
    text = str(date_value or "").strip()
    if not text or text == "---":
        return None
    for fmt in (
        STORAGE_DATE_FORMAT,
        DISPLAY_DATE_FORMAT,
        "%d-%m-%Y",
        "%Y/%m/%d",
        "%d/%m/%y",
        "%d/%m/%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
    ):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None

def to_display_date(date_value):
    parsed = parse_app_date(date_value)
    return parsed.strftime(DISPLAY_DATE_FORMAT) if parsed else ("" if not date_value or date_value == "---" else str(date_value))

def to_storage_date(date_value):
    parsed = parse_app_date(date_value)
    return parsed.strftime(STORAGE_DATE_FORMAT) if parsed else None

def style_button(button, width=STANDARD_BUTTON_WIDTH, height=STANDARD_BUTTON_HEIGHT):
    if button.cget("image"):
        button.config(width=STANDARD_IMAGE_BUTTON_WIDTH, height=STANDARD_IMAGE_BUTTON_HEIGHT, anchor=CENTER, justify=CENTER)
        return
    text = str(button.cget("text")).strip()
    if text in SMALL_BUTTON_TEXTS:
        button.config(anchor=CENTER, justify=CENTER)
        return
    button.config(width=width, height=height, anchor=CENTER, justify=CENTER)

def normalize_buttons(widget):
    for child in widget.winfo_children():
        if isinstance(child, Button):
            style_button(child)
        elif isinstance(child, ttk.Treeview):
            make_table_resizable(child)
        normalize_buttons(child)

def get_watermark_image():
    global _WATERMARK_CACHE
    if _WATERMARK_CACHE is not None:
        return _WATERMARK_CACHE

    # Prefer user-specific watermark, then fallback to project logo.
    for image_path in (WATERMARK_PATH, APP_LOGO_PATH):
        if not os.path.exists(image_path):
            continue
        try:
            _WATERMARK_CACHE = PhotoImage(file=image_path).subsample(3, 3)
            return _WATERMARK_CACHE
        except Exception:
            continue

    _WATERMARK_CACHE = None
    return None

def apply_page_watermark(widget, x=12, y=12):
    # Logo/watermark display is intentionally disabled globally.
    return

def make_table_resizable(tree, minwidth=70):
    try:
        for col in tree["columns"]:
            current_width = int(tree.column(col, "width") or minwidth)
            tree.column(col, width=current_width, minwidth=minwidth, stretch=True)
    except Exception:
        pass

def add_table_size_controls(parent, tree, bg="#f0f4f8"):
    controls = ttk.Frame(parent)
    controls.pack(fill="x", padx=5, pady=(2, 4))

    def change_height(delta):
        try:
            current = int(tree.cget("height"))
            tree.configure(height=max(3, current + delta))
        except Exception:
            pass

    Button(controls, text="+ Table Size", command=lambda: change_height(3),
           bg="#0066cc", fg="white", font=("Arial", 9, "bold")).pack(side="left", padx=4)
    Button(controls, text="- Table Size", command=lambda: change_height(-3),
           bg="#555", fg="white", font=("Arial", 9, "bold")).pack(side="left", padx=4)
    normalize_buttons(controls)
    return controls

def keep_window_active(window):
    try:
        window.state("normal")
    except Exception:
        pass
    try:
        window.lift()
        window.focus_force()
    except Exception:
        pass

def get_current_fy():
    now = datetime.now()
    y = now.year
    return f"{y}-{y+1}" if now.month >= 4 else f"{y-1}-{y}"

def normalize_financial_year(value=None, as_on=None):
    text = str(value or "").strip().upper().replace("FY", "").replace(" ", "")
    if text:
        import re
        match = re.search(r"(\d{4})\D+(\d{2}|\d{4})", text)
        if match:
            start = int(match.group(1))
            end_text = match.group(2)
            end = int(end_text) if len(end_text) == 4 else (start // 100) * 100 + int(end_text)
            if end <= start:
                end += 100
            return f"{start}-{str(end)[-2:]}"
        match = re.search(r"(\d{4})", text)
        if match:
            start = int(match.group(1))
            return f"{start}-{str(start + 1)[-2:]}"

    reference = parse_app_date(as_on) or date.today()
    start = reference.year if reference.month >= 4 else reference.year - 1
    return f"{start}-{str(start + 1)[-2:]}"

def financial_year_start_date(financial_year=None, as_on=None):
    normalized = normalize_financial_year(financial_year, as_on)
    start_year = int(normalized.split("-")[0])
    return date(start_year, 4, 1)

def financial_year_end_date(financial_year=None, as_on=None):
    start = financial_year_start_date(financial_year, as_on)
    return date(start.year + 1, 3, 31)

def status_as_on_from_month(month_label=None, financial_year=None, today=None):
    today = today or date.today()
    text = str(month_label or "").strip()
    if not text:
        return today
    try:
        parsed = datetime.strptime(text, "%b-%y").date()
    except ValueError:
        return parse_app_date(text) or today
    month_end = date(parsed.year, parsed.month, monthrange(parsed.year, parsed.month)[1])
    return min(month_end, today)

def get_project_fy_status(schedule_start_date, as_on_date=None):
    start = parse_app_date(schedule_start_date)
    if not start:
        return "-"
    as_on = parse_app_date(as_on_date) or date.today()
    fy_start_year = as_on.year if as_on.month >= 4 else as_on.year - 1
    fy_start = date(fy_start_year, 4, 1)
    last_fy_end = date(fy_start_year, 3, 31)
    fy_label = f"FY {fy_start_year}-{str(fy_start_year + 1)[-2:]}"
    if start <= last_fy_end:
        return "Ongoing Since Last FY"
    return f"Started during {fy_label}"

def classify_project_financial_year(project_start_date, financial_year=None, status_as_on=None):
    as_on = parse_app_date(status_as_on) or date.today()
    normalized_fy = normalize_financial_year(financial_year, as_on)
    fy_start = financial_year_start_date(normalized_fy, as_on)
    start = parse_app_date(project_start_date)
    classification = get_project_fy_status(project_start_date, as_on)
    if classification == "-":
        color = "neutral"
    elif start and start >= fy_start:
        color = "green"
    else:
        color = "orange"
    return {
        "financial_year": normalized_fy,
        "fy_start_date": fy_start.isoformat(),
        "fy_end_date": financial_year_end_date(normalized_fy, as_on).isoformat(),
        "status_as_on_date": as_on.isoformat(),
        "project_start_date": start.isoformat() if start else None,
        "fy_classification": classification,
        "fy_classification_color": color,
    }

def generate_unique_id():
    fy = get_current_fy()
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT unique_id FROM projects WHERE unique_id LIKE %s ORDER BY unique_id DESC LIMIT 1", (f"RSP/Proj/{fy}/%",))
    row = c.fetchone()
    seq = int(row['unique_id'].split('/')[-1]) + 1 if row else 1
    conn.close()
    return f"RSP/Proj/{fy}/{seq:03d}"

def add_months(source_date_str, months):
    if not source_date_str: return None
    d = parse_app_date(source_date_str)
    if not d:
        return None
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month-1])
    return datetime(year, month, day).strftime(STORAGE_DATE_FORMAT)

def get_project_status(p):
    if p.get("project_dropped") == "Y":
        return "Project Dropped"
    elif p.get("commissioned_marked") == "Y":
        return "Commissioned"
    elif p.get("completion_marked") == "Y":
        return "Complete"
    elif p.get("stage2_cleared") == "Y":
        return "Ongoing"
    elif p.get("final_tod_date") and str(p.get("final_tod_date")).strip():
        return "Stage-2"
    elif p.get("stage1_cleared") == "Y":
        return "Tendering"
    elif p.get("cod_cleared") == "Y":
        return "Stage-1"
    else:
        return "Under Formulation"
