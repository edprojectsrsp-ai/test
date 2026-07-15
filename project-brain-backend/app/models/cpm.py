"""Critical Path Method (CPM) engine for project schedule analysis."""
import os
import json
from datetime import datetime, date, timedelta
from collections import defaultdict, deque
import re
import xml.etree.ElementTree as ET

# Database models now use PostgreSQL via SQLAlchemy
from app.core.database import SessionLocal
from app.models.schedule import ScheduleImport, ScheduleActivity


# ============================================================================
# Database Functions (PostgreSQL via SQLAlchemy)
# ============================================================================

def save_schedule_to_db(project_id, filename, activities):
    """Save parsed schedule activities to PostgreSQL database."""
    db = SessionLocal()
    try:
        # Create import record
        import_record = ScheduleImport(
            project_id=int(project_id),
            file_name=filename,
            imported_at=datetime.utcnow()
        )
        db.add(import_record)
        db.flush()  # Get the ID without committing

        # Add activities
        for activity in activities:
            act = ScheduleActivity(
                schedule_id=import_record.id,
                activity_uid=activity.get("activity_uid"),
                activity_code=activity.get("activity_code"),
                activity_name=activity.get("activity_name"),
                wbs=activity.get("wbs"),
                duration_days=float(activity.get("duration_days") or 0),
                start_date=to_storage_date(activity.get("start_date")),
                finish_date=to_storage_date(activity.get("finish_date")),
                actual_start=to_storage_date(activity.get("actual_start")),
                actual_finish=to_storage_date(activity.get("actual_finish")),
                percent_complete=float(activity.get("percent_complete") or 0),
                predecessors=activity.get("predecessors"),
                successors=activity.get("successors"),
                early_start=to_storage_date(activity.get("early_start")),
                early_finish=to_storage_date(activity.get("early_finish")),
                late_start=to_storage_date(activity.get("late_start")),
                late_finish=to_storage_date(activity.get("late_finish")),
                total_float=float(activity.get("total_float") or 0),
                is_critical=activity.get("is_critical") or "No",
                raw_data=json.dumps(activity.get("raw_data") or {}, default=str)
            )
            db.add(act)

        db.commit()
        return import_record.id
    finally:
        db.close()


def get_schedule_from_db(schedule_id):
    """Retrieve schedule activities from PostgreSQL."""
    db = SessionLocal()
    try:
        activities = db.query(ScheduleActivity).filter(
            ScheduleActivity.schedule_id == schedule_id
        ).all()
        return [
            {
                'id': a.id,
                'activity_uid': a.activity_uid,
                'activity_code': a.activity_code,
                'activity_name': a.activity_name,
                'wbs': a.wbs,
                'duration_days': a.duration_days,
                'start_date': a.start_date,
                'finish_date': a.finish_date,
                'actual_start': a.actual_start,
                'actual_finish': a.actual_finish,
                'percent_complete': a.percent_complete,
                'predecessors': a.predecessors,
                'successors': a.successors,
                'early_start': a.early_start,
                'early_finish': a.early_finish,
                'late_start': a.late_start,
                'late_finish': a.late_finish,
                'total_float': a.total_float,
                'is_critical': a.is_critical,
                'raw_data': json.loads(a.raw_data) if a.raw_data else {}
            }
            for a in activities
        ]
    finally:
        db.close()


def get_latest_schedule(project_id):
    """Get the latest imported schedule for a project."""
    db = SessionLocal()
    try:
        import_record = db.query(ScheduleImport).filter(
            ScheduleImport.project_id == project_id
        ).order_by(ScheduleImport.id.desc()).first()

        if not import_record:
            return None

        return {
            'id': import_record.id,
            'project_id': import_record.project_id,
            'file_name': import_record.file_name,
            'imported_at': import_record.imported_at.isoformat()
        }
    finally:
        db.close()


# ============================================================================
# CPM Algorithm & Date Utilities
# ============================================================================

# CPM Engine Logic (from schedule.py)
def parse_app_date(date_str):
    if not date_str:
        return None
    try:
        if isinstance(date_str, date):
            return date_str
        # Try various formats
        formats = ["%Y-%m-%d", "%d-%m-%Y", "%d-%m-%y", "%Y-%m-%d %H:%M:%S"]
        for fmt in formats:
            try:
                return datetime.strptime(str(date_str).split()[0], fmt).date()
            except:
                continue
    except:
        pass
    return None

def to_storage_date(date_val):
    if not date_val:
        return None
    if isinstance(date_val, date):
        return date_val.strftime("%Y-%m-%d")
    if isinstance(date_val, datetime):
        return date_val.strftime("%Y-%m-%d")
    return date_val

def to_display_date(date_val):
    if not date_val:
        return ""
    if isinstance(date_val, str):
        try:
            return datetime.strptime(date_val, "%Y-%m-%d").strftime("%d-%m-%y")
        except:
            return date_val
    if isinstance(date_val, (date, datetime)):
        return date_val.strftime("%d-%m-%y")
    return ""

def hours_to_days(value):
    try:
        return round(float(str(value or "0").strip()) / 8, 2)
    except ValueError:
        return 0

def duration_to_days(value):
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
        return round(number / 8, 2) if number > 100 else round(number, 2)
    except ValueError:
        return 0

def percent_value(value):
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        number = float(text.replace("%", ""))
        return round(number * 100, 2) if 0 < number <= 1 else round(number, 2)
    except ValueError:
        return 0

def parse_xer(file_path):
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
        uid = next((task.get(k) for k in ["task_id", "guid", "task_code"] if task.get(k)), None)
        name = next((task.get(k) for k in ["task_name", "name"] if task.get(k)), None)
        if not uid or not name:
            continue

        duration = hours_to_days(next((task.get(k) for k in ["target_drtn_hr_cnt", "remain_drtn_hr_cnt", "orig_drtn_hr_cnt"] if task.get(k)), 0))
        start = next((task.get(k) for k in ["target_start_date", "act_start_date", "early_start_date", "restart_date"] if task.get(k)), None)
        finish = next((task.get(k) for k in ["target_end_date", "act_end_date", "early_end_date", "reend_date"] if task.get(k)), None)
        actual_start = task.get("act_start_date")
        actual_finish = task.get("act_end_date")
        percent = percent_value(next((task.get(k) for k in ["phys_complete_pct", "complete_pct"] if task.get(k)), 0))

        activities.append({
            "activity_uid": str(uid),
            "activity_code": next((task.get(k) for k in ["task_code", "task_id"] if task.get(k)), ""),
            "activity_name": name,
            "wbs": next((task.get(k) for k in ["wbs_id", "wbs_name", "proj_id"] if task.get(k)), ""),
            "duration_days": duration,
            "start_date": start,
            "finish_date": finish,
            "actual_start": actual_start,
            "actual_finish": actual_finish,
            "percent_complete": percent,
            "raw_data": dict(task),
        })

    # Apply relationships
    for relation in relations:
        pred = str(relation.get("pred_task_id") or "").strip()
        succ = str(relation.get("task_id") or "").strip()
        if pred and succ:
            pred_activity = next((a for a in activities if str(a["activity_uid"]) == pred), None)
            succ_activity = next((a for a in activities if str(a["activity_uid"]) == succ), None)
            if pred_activity and succ_activity:
                pred_activity.setdefault("_succ_set", set()).add(succ)
                succ_activity.setdefault("_pred_set", set()).add(pred)

    for activity in activities:
        activity["predecessors"] = ", ".join(sorted(activity.get("_pred_set", set())))
        activity["successors"] = ", ".join(sorted(activity.get("_succ_set", set())))

    return activities

def parse_xml(file_path):
    tree = ET.parse(file_path)
    root = tree.getroot()
    activities = []

    def local_name(tag):
        return str(tag).split("}", 1)[-1]

    def child_text_map(elem):
        data = {}
        for child in list(elem):
            key = local_name(child.tag)
            text = (child.text or "").strip()
            if text:
                data[key] = text
        return data

    for elem in root.iter():
        tag = local_name(elem.tag)
        if tag not in ("Activity", "Task"):
            continue
        fields = child_text_map(elem)
        name = next((fields.get(k) for k in ["Name", "ActivityName", "TaskName"] if fields.get(k)), None)
        uid = next((fields.get(k) for k in ["ObjectId", "UID", "Id", "ID", "ActivityId", "TaskId"] if fields.get(k)), None)
        if not uid or not name:
            continue
        if fields.get("Summary") in ("1", "true", "True"):
            continue

        code = next((fields.get(k) for k in ["ActivityId", "Id", "ID", "Code", "UID", "ObjectId"] if fields.get(k)), "")
        duration = duration_to_days(next((fields.get(k) for k in ["PlannedDuration", "Duration", "OriginalDuration", "RemainingDuration"] if fields.get(k)), 0))
        start = next((fields.get(k) for k in ["StartDate", "Start", "PlannedStartDate", "BaselineStartDate"] if fields.get(k)), None)
        finish = next((fields.get(k) for k in ["FinishDate", "Finish", "PlannedFinishDate", "BaselineFinishDate"] if fields.get(k)), None)
        actual_start = next((fields.get(k) for k in ["ActualStartDate", "ActualStart"] if fields.get(k)), None)
        actual_finish = next((fields.get(k) for k in ["ActualFinishDate", "ActualFinish"] if fields.get(k)), None)
        percent = percent_value(next((fields.get(k) for k in ["PercentComplete", "PhysicalPercentComplete", "CompletePercent"] if fields.get(k)), 0))

        activity = {
            "activity_uid": str(uid),
            "activity_code": code,
            "activity_name": name,
            "wbs": next((fields.get(k) for k in ["WBSName", "WBSObjectId", "OutlineNumber", "WBS"] if fields.get(k)), ""),
            "duration_days": duration,
            "start_date": start,
            "finish_date": finish,
            "actual_start": actual_start,
            "actual_finish": actual_finish,
            "percent_complete": percent,
            "raw_data": fields,
        }
        activities.append(activity)

        for pred_link in elem:
            if local_name(pred_link.tag) != "PredecessorLink":
                continue
            pred_fields = child_text_map(pred_link)
            pred_uid = next((pred_fields.get(k) for k in ["PredecessorUID", "PredecessorObjectId", "PredecessorActivityObjectId"] if pred_fields.get(k)), None)
            if pred_uid:
                activity.setdefault("_pred_set", set()).add(str(pred_uid))

    return activities

def calculate_cpm(activities):
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
        duration[uid] = max(0.0, float(activity.get("duration_days") or 1))
        pred_finishes = []
        for pred in pred_map.get(uid, set()):
            if pred in ef:
                pred_finishes.append(ef[pred])
        uploaded_start = parse_app_date(activity.get("start_date"))
        es[uid] = max(pred_finishes) if pred_finishes else (uploaded_start or project_start)
        ef[uid] = es[uid] + timedelta(days=duration[uid])

    project_finish = max(ef.values()) if ef else project_start
    ls = {}
    lf = {}
    for uid in reversed(order):
        succ_starts = []
        for succ in succ_map.get(uid, set()):
            if succ in ls:
                succ_starts.append(ls[succ])
        lf[uid] = min(succ_starts) if succ_starts else project_finish
        ls[uid] = lf[uid] - timedelta(days=duration[uid])

    for activity in activities:
        uid = str(activity["activity_uid"])
        total_float = (ls.get(uid, es.get(uid, project_start)) - es.get(uid, project_start)).total_seconds() / 86400
        activity["early_start"] = to_storage_date(es.get(uid))
        activity["early_finish"] = to_storage_date(ef.get(uid))
        activity["late_start"] = to_storage_date(ls.get(uid))
        activity["late_finish"] = to_storage_date(lf.get(uid))
        activity["total_float"] = round(total_float, 2)
        activity["is_critical"] = "Y" if total_float <= 0.01 else "N"
        activity["predecessors"] = ", ".join(sorted(pred_map.get(uid, set())))
        activity["successors"] = ", ".join(sorted(succ_map.get(uid, set())))

    return activities

# API Routes

#@app.route('/api/schedule/<int:project_id>', methods=['GET'])
def get_schedule(project_id):
    schedule = get_latest_schedule(project_id)

    if schedule:
        activities = get_schedule_from_db(schedule['id'])
        return {'schedule_id': schedule['id'], 'activities': activities}

    return {'schedule_id': None, 'activities': []}

#@app.route('/api/schedule/upload', methods=['POST'])
def upload_schedule():
    project_id = request.form.get('project_id')
    file = request.files.get('file')

    if not file:
        return jsonify({'error': 'No file uploaded'}), 400

    temp_path = f"/tmp/{file.filename}"
    file.save(temp_path)

    try:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext == '.xer':
            activities = parse_xer(temp_path)
        elif ext == '.xml':
            activities = parse_xml(temp_path)
        else:
            return jsonify({'error': 'Unsupported file type. Please upload .xml or .xer'}), 400

        if not activities:
            return jsonify({'error': 'No activities found in schedule file'}), 400

        # Calculate CPM
        activities = calculate_cpm(activities)

        # Save to PostgreSQL database
        schedule_id = save_schedule_to_db(project_id, file.filename, activities)

        os.remove(temp_path)
        return jsonify({'success': True, 'activity_count': len(activities)})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

#@app.route('/api/schedule/analyze/<int:schedule_id>', methods=['GET'])
def analyze_schedule(schedule_id):
    activities = get_schedule_from_db(schedule_id)

    if not activities:
        return {'error': 'No activities found'}

    # Calculate statistics
    critical_count = sum(1 for a in activities if a.get('is_critical') == 'Yes')
    completed_count = sum(1 for a in activities if float(a.get('percent_complete') or 0) >= 100)
    avg_progress = sum(float(a.get('percent_complete') or 0) for a in activities) / max(1, len(activities))
    total_duration = sum(float(a.get('duration_days') or 0) for a in activities)

    # Find critical path activities
    critical_path = [a for a in activities if a.get('is_critical') == 'Yes']
    critical_path.sort(key=lambda x: parse_app_date(x.get('early_start')) or date.today())

    return {
        'total_activities': len(activities),
        'critical_activities': critical_count,
        'completed_activities': completed_count,
        'average_progress': round(avg_progress, 2),
        'total_duration_days': round(total_duration, 2),
        'critical_path': [
            {
                'code': a.get('activity_code'),
                'name': a.get('activity_name'),
                'early_start': to_display_date(a.get('early_start')),
                'early_finish': to_display_date(a.get('early_finish')),
                'float': a.get('total_float')
            } for a in critical_path[:50]
        ]
    }