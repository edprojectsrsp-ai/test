"""
Schedule file importers.

Supported formats:
  - .xer : Primavera P6 export (text-based, PSU standard)
  - .mpp : MS Project (binary, private contractors)
  - .csv : Universal fallback

XER format reference:
  Section header lines start with % (e.g. %T TASK, %F id name ...)
  Data lines start with %R followed by tab-separated values

MPP format:
  Uses jpype + mpxj Java library, or python-mpxj (preferred Python alternative)
  Fallback: tell user to "Export As CSV from MS Project"

CSV format expected columns:
  activity_code, activity_name, planned_start, planned_finish, duration_days,
  predecessor_codes (comma-separated), wbs, status
"""
from __future__ import annotations
import csv
import logging
import re
from datetime import date, datetime
from typing import Optional, Iterator
import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)


# ============================================================================
# XER IMPORTER (Primavera P6)
# ============================================================================

class XERParser:
    """
    Parses Primavera P6 .xer files.

    XER is tab-separated with section markers:
      ERMHDR ...                  -- header
      %T TABLENAME                -- start of a table
      %F col1\tcol2\tcol3         -- field names
      %R val1\tval2\tval3         -- data row
      %T NEXTTABLE                -- next table starts
      %E                          -- end of file
    """

    def __init__(self, file_path: str):
        self.file_path = file_path
        self.tables: dict[str, list[dict]] = {}
        self.encoding = 'utf-8'

    def parse(self) -> dict[str, list[dict]]:
        """Parse the file, returns dict of table_name → list of row dicts."""
        # Try multiple encodings - Primavera exports vary
        for enc in ['utf-8', 'cp1252', 'latin-1']:
            try:
                with open(self.file_path, 'r', encoding=enc) as f:
                    f.read()
                self.encoding = enc
                break
            except UnicodeDecodeError:
                continue

        current_table: Optional[str] = None
        current_fields: list[str] = []

        with open(self.file_path, 'r', encoding=self.encoding) as f:
            for line_no, line in enumerate(f, 1):
                line = line.rstrip('\n').rstrip('\r')
                if not line: continue

                if line.startswith('%T\t'):
                    current_table = line[3:].strip()
                    self.tables[current_table] = []
                    current_fields = []
                elif line.startswith('%F\t'):
                    current_fields = line[3:].split('\t')
                elif line.startswith('%R\t') and current_table and current_fields:
                    values = line[3:].split('\t')
                    row = dict(zip(current_fields, values))
                    self.tables[current_table].append(row)
                elif line.startswith('%E'):
                    break
        return self.tables

    def get_activities(self) -> list[dict]:
        """Extract activities from TASK table, normalized to our schema."""
        tasks = self.tables.get('TASK', [])
        normalized = []
        for t in tasks:
            normalized.append({
                'activity_code': t.get('task_code') or '',
                'activity_name': t.get('task_name') or '',
                'planned_duration_days': self._parse_duration(t.get('target_drtn_hr_cnt')),
                'planned_start_date': self._parse_date(t.get('target_start_date')),
                'planned_finish_date': self._parse_date(t.get('target_end_date')),
                'actual_start_date': self._parse_date(t.get('act_start_date')),
                'actual_finish_date': self._parse_date(t.get('act_end_date')),
                'physical_pct_complete': self._parse_pct(t.get('phys_complete_pct')),
                'wbs_code': t.get('wbs_id'),
                'task_id': t.get('task_id'),  # XER internal ID, used for dependencies
                'activity_status': self._normalize_status(t.get('status_code')),
                '_xer_task_id': t.get('task_id'),  # keep for dep mapping
            })
        return normalized

    def get_dependencies(self) -> list[dict]:
        """Extract TASKPRED rows."""
        preds = self.tables.get('TASKPRED', [])
        out = []
        for p in preds:
            out.append({
                'predecessor_xer_id': p.get('pred_task_id'),
                'successor_xer_id': p.get('task_id'),
                'dependency_type': self._normalize_dep_type(p.get('pred_type')),
                'lag_days': self._parse_lag(p.get('lag_hr_cnt')),
            })
        return out

    @staticmethod
    def _parse_duration(hr_str: Optional[str]) -> Optional[float]:
        if not hr_str: return None
        try:
            # XER stores durations in hours; assume 8-hour workday
            return float(hr_str) / 8.0
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _parse_lag(hr_str: Optional[str]) -> float:
        if not hr_str: return 0.0
        try:
            return float(hr_str) / 8.0
        except (ValueError, TypeError):
            return 0.0

    @staticmethod
    def _parse_date(s: Optional[str]) -> Optional[date]:
        if not s or s.strip() == '': return None
        # XER dates: "2024-01-15 09:00"
        for fmt in ('%Y-%m-%d %H:%M', '%Y-%m-%d', '%d-%b-%y %H:%M', '%d-%b-%y'):
            try: return datetime.strptime(s.strip(), fmt).date()
            except ValueError: pass
        return None

    @staticmethod
    def _parse_pct(s: Optional[str]) -> float:
        if not s: return 0.0
        try: return float(s)
        except (ValueError, TypeError): return 0.0

    @staticmethod
    def _normalize_dep_type(t: Optional[str]) -> str:
        """XER stores 'PR_FS' / 'PR_SS' / 'PR_FF' / 'PR_SF'."""
        if not t: return 'FS'
        if 'SS' in t: return 'SS'
        if 'FF' in t: return 'FF'
        if 'SF' in t: return 'SF'
        return 'FS'

    @staticmethod
    def _normalize_status(s: Optional[str]) -> str:
        """XER status codes: TK_NotStart / TK_Active / TK_Complete."""
        if not s: return 'not_started'
        s = s.lower()
        if 'complete' in s: return 'completed'
        if 'active' in s or 'progress' in s: return 'in_progress'
        if 'hold' in s: return 'on_hold'
        return 'not_started'


# ============================================================================
# CSV IMPORTER (universal)
# ============================================================================

class CSVScheduleParser:
    """
    Expects a CSV with columns (case-insensitive, flexible names):
      activity_code, activity_name, planned_start, planned_finish, duration_days,
      predecessor_codes, wbs, status, actual_start, actual_finish, pct_complete

    Predecessor codes are comma-separated activity codes (e.g. "A,B,C").
    Lag/type can be embedded: "A:FS:2" means predecessor A with FS type and 2 day lag.
    """

    COLUMN_ALIASES = {
        'activity_code': ['activity_code', 'code', 'task_code', 'id', 'activity_id'],
        'activity_name': ['activity_name', 'name', 'task_name', 'activity', 'task'],
        'planned_start_date': ['planned_start', 'start', 'planned_start_date', 'start_date'],
        'planned_finish_date': ['planned_finish', 'finish', 'planned_finish_date', 'finish_date', 'end_date'],
        'planned_duration_days': ['duration_days', 'duration', 'days'],
        'predecessor_codes': ['predecessor_codes', 'predecessors', 'preds', 'depends_on'],
        'wbs_code': ['wbs', 'wbs_code', 'wbs_path'],
        'activity_status': ['status', 'state'],
        'actual_start_date': ['actual_start', 'actual_start_date'],
        'actual_finish_date': ['actual_finish', 'actual_finish_date'],
        'physical_pct_complete': ['pct_complete', 'complete_pct', '% complete', 'progress'],
    }

    def __init__(self, file_path: str):
        self.file_path = file_path

    def _normalize_col(self, c: str) -> str:
        c = c.lower().strip().replace(' ', '_')
        for canonical, aliases in self.COLUMN_ALIASES.items():
            if c in aliases:
                return canonical
        return c

    def parse(self) -> tuple[list[dict], list[dict]]:
        """Returns (activities, dependencies)."""
        activities: list[dict] = []
        dep_specs: list[tuple[str, str, str, float]] = []  # (pred_code, succ_code, type, lag)

        with open(self.file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.reader(f)
            headers = [self._normalize_col(c) for c in next(reader)]
            for row in reader:
                if not any(row): continue
                d = dict(zip(headers, row))

                # Parse predecessors string (semicolon-separated, since comma is CSV field delim)
                pred_str = d.get('predecessor_codes', '').strip()
                if pred_str:
                    # Support both ; and , as separators inside quoted fields
                    separators = [';', ','] if ';' in pred_str else [',']
                    sep = separators[0]
                    for pred in pred_str.split(sep):
                        pred = pred.strip()
                        if not pred: continue
                        # Format: "CODE" or "CODE:TYPE" or "CODE:TYPE:LAG"
                        parts = pred.split(':')
                        pred_code = parts[0]
                        dep_type = parts[1].upper() if len(parts) > 1 else 'FS'
                        lag = float(parts[2]) if len(parts) > 2 else 0.0
                        dep_specs.append((pred_code, d.get('activity_code', ''), dep_type, lag))

                activities.append({
                    'activity_code': d.get('activity_code', ''),
                    'activity_name': d.get('activity_name', ''),
                    'planned_start_date': self._parse_date(d.get('planned_start_date')),
                    'planned_finish_date': self._parse_date(d.get('planned_finish_date')),
                    'planned_duration_days': self._parse_float(d.get('planned_duration_days')),
                    'wbs_code': d.get('wbs_code'),
                    'actual_start_date': self._parse_date(d.get('actual_start_date')),
                    'actual_finish_date': self._parse_date(d.get('actual_finish_date')),
                    'physical_pct_complete': self._parse_float(d.get('physical_pct_complete')) or 0,
                    'activity_status': (d.get('activity_status') or 'not_started').lower().replace(' ', '_'),
                })

        return activities, [{
            'predecessor_code': p, 'successor_code': s,
            'dependency_type': t, 'lag_days': l
        } for p, s, t, l in dep_specs]

    @staticmethod
    def _parse_date(s: Optional[str]) -> Optional[date]:
        if not s or not s.strip(): return None
        s = s.strip()
        for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%b-%Y', '%d-%b-%y'):
            try: return datetime.strptime(s, fmt).date()
            except ValueError: pass
        return None

    @staticmethod
    def _parse_float(s: Optional[str]) -> Optional[float]:
        if not s or not s.strip(): return None
        try: return float(s.strip().rstrip('%'))
        except (ValueError, TypeError): return None


# ============================================================================
# MPP IMPORTER (MS Project)
# ============================================================================

def parse_mpp(file_path: str) -> tuple[list[dict], list[dict]]:
    """
    Parse MS Project .mpp file.

    Uses jpype+mpxj. Requires:
        pip install mpxj
        mpxj brings in JPype1 which needs a JVM (e.g. OpenJDK 11+)

    Falls back gracefully: if mpxj not installed, raises with instructions.
    """
    try:
        import mpxj
    except ImportError:
        raise ImportError(
            "MPP parsing requires mpxj. Install: pip install mpxj\n"
            "Also requires Java 11+. Alternative: export as CSV from MS Project."
        )

    from mpxj.reader import UniversalProjectReader
    reader = UniversalProjectReader()
    project = reader.read(file_path)

    activities = []
    dep_specs = []
    task_id_to_code: dict[str, str] = {}

    for task in project.tasks:
        if task is None or task.id == 0: continue
        code = task.outline_number or f"T{task.id}"
        task_id_to_code[str(task.unique_id)] = code
        activities.append({
            'activity_code': code,
            'activity_name': task.name or '',
            'planned_start_date': task.start.toDate() if task.start else None,
            'planned_finish_date': task.finish.toDate() if task.finish else None,
            'planned_duration_days': float(task.duration.duration) if task.duration else None,
            'wbs_code': task.wbs,
            'actual_start_date': task.actual_start.toDate() if task.actual_start else None,
            'actual_finish_date': task.actual_finish.toDate() if task.actual_finish else None,
            'physical_pct_complete': float(task.percent_complete or 0),
            'activity_status': 'completed' if task.percent_complete == 100 else
                              'in_progress' if task.percent_complete > 0 else 'not_started',
        })

    # Predecessors
    for task in project.tasks:
        if task is None: continue
        for rel in task.predecessors or []:
            pred_code = task_id_to_code.get(str(rel.target_task.unique_id))
            succ_code = task_id_to_code.get(str(task.unique_id))
            if pred_code and succ_code:
                dep_specs.append({
                    'predecessor_code': pred_code,
                    'successor_code': succ_code,
                    'dependency_type': rel.type.name if hasattr(rel.type, 'name') else 'FS',
                    'lag_days': float(rel.lag.duration) if rel.lag else 0,
                })

    return activities, dep_specs


# ============================================================================
# DB LOADER — common write path for all importers
# ============================================================================

def load_schedule_to_db(
    package_id: int, schedule_name: str, activities: list[dict],
    dependencies: list[dict], source: str, source_file: str,
    user_id: int, db_url: str, warnings: list[str] = None,
) -> dict:
    """Write parsed activities & deps to DB. Returns schedule_id and stats."""
    import json
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    warnings = warnings or []

    # Create schedule
    earliest = min((a['planned_start_date'] for a in activities if a.get('planned_start_date')), default=date.today())
    cur.execute("""
        INSERT INTO cpm_schedules(
            package_id, schedule_name, source, status,
            project_start_date, data_date,
            source_file_name, imported_at, created_by, import_warnings
        ) VALUES (%s, %s, %s::schedule_source_enum, 'active'::schedule_status_enum,
                  %s, CURRENT_DATE, %s, CURRENT_TIMESTAMP, %s, %s::jsonb)
        RETURNING schedule_id
    """, (package_id, schedule_name, source, earliest, source_file, user_id,
          json.dumps(warnings)))
    schedule_id = cur.fetchone()[0]

    # Insert activities; track code → id mapping
    code_to_id: dict[str, int] = {}
    inserted = 0
    for a in activities:
        if not a.get('activity_code'): continue
        try:
            cur.execute("""
                INSERT INTO cpm_activities(
                    schedule_id, activity_code, activity_name,
                    planned_duration_days, planned_start_date, planned_finish_date,
                    actual_start_date, actual_finish_date,
                    physical_pct_complete, activity_status, wbs_code
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::cpm_activity_status_enum, %s)
                RETURNING activity_id
            """, (
                schedule_id, a['activity_code'], a['activity_name'][:500],
                a.get('planned_duration_days'),
                a.get('planned_start_date'), a.get('planned_finish_date'),
                a.get('actual_start_date'), a.get('actual_finish_date'),
                a.get('physical_pct_complete') or 0,
                a.get('activity_status') or 'not_started',
                a.get('wbs_code'),
            ))
            code_to_id[a['activity_code']] = cur.fetchone()[0]
            inserted += 1
        except Exception as e:
            warnings.append(f"Failed to insert activity {a.get('activity_code')}: {str(e)[:120]}")
            conn.rollback()
            conn = psycopg2.connect(db_url)
            cur = conn.cursor()

    # Insert dependencies
    dep_count = 0
    for d in dependencies:
        pred = code_to_id.get(d.get('predecessor_code') or d.get('predecessor_xer_id'))
        succ = code_to_id.get(d.get('successor_code') or d.get('successor_xer_id'))
        # If using XER IDs, find by task_id
        if not pred and 'predecessor_xer_id' in d:
            pred = next((aid for code, aid in code_to_id.items()), None)
        if not pred or not succ:
            warnings.append(f"Skipping dep - missing pred/succ: {d}")
            continue
        try:
            cur.execute("""
                INSERT INTO cpm_dependencies(predecessor_id, successor_id, dependency_type, lag_days)
                VALUES (%s, %s, %s::cpm_dependency_type_enum, %s)
                ON CONFLICT (predecessor_id, successor_id) DO NOTHING
            """, (pred, succ, d.get('dependency_type', 'FS'), d.get('lag_days', 0)))
            dep_count += 1
        except Exception as e:
            warnings.append(f"Failed dep: {e}")

    conn.commit()
    conn.close()

    return {
        "schedule_id": schedule_id,
        "activities_inserted": inserted,
        "dependencies_inserted": dep_count,
        "warnings": warnings,
    }


def import_file(file_path: str, package_id: int, schedule_name: str,
                user_id: int, db_url: str) -> dict:
    """One-call importer. Auto-detects format from extension."""
    ext = file_path.lower().rsplit('.', 1)[-1]
    warnings: list[str] = []

    if ext == 'xer':
        parser = XERParser(file_path)
        parser.parse()
        activities = parser.get_activities()
        deps_xer = parser.get_dependencies()
        # Convert XER task_ids to codes for our loader
        task_id_to_code = {a.get('_xer_task_id'): a['activity_code'] for a in activities if a.get('_xer_task_id')}
        deps = []
        for d in deps_xer:
            pc = task_id_to_code.get(d['predecessor_xer_id'])
            sc = task_id_to_code.get(d['successor_xer_id'])
            if pc and sc:
                deps.append({
                    'predecessor_code': pc, 'successor_code': sc,
                    'dependency_type': d['dependency_type'], 'lag_days': d['lag_days'],
                })
        result = load_schedule_to_db(package_id, schedule_name, activities, deps,
                                      'xer_import', file_path, user_id, db_url, warnings)
    elif ext == 'mpp':
        activities, deps = parse_mpp(file_path)
        result = load_schedule_to_db(package_id, schedule_name, activities, deps,
                                      'mpp_import', file_path, user_id, db_url, warnings)
    elif ext == 'csv':
        parser = CSVScheduleParser(file_path)
        activities, deps = parser.parse()
        result = load_schedule_to_db(package_id, schedule_name, activities, deps,
                                      'csv_import', file_path, user_id, db_url, warnings)
    else:
        raise ValueError(f"Unsupported format: {ext}. Use .xer, .mpp, or .csv")

    # Run CPM
    from .cpm_engine import run_cpm
    cpm_result = run_cpm(result['schedule_id'], db_url)
    result['cpm'] = cpm_result
    return result


if __name__ == "__main__":
    import argparse, json, sys
    p = argparse.ArgumentParser()
    p.add_argument("file", help="Path to .xer/.mpp/.csv")
    p.add_argument("--package-id", type=int, required=True)
    p.add_argument("--name", default="Imported Schedule")
    p.add_argument("--user-id", type=int, default=1)
    p.add_argument("--db", default="postgresql://postgres@/pb_v4?host=/tmp/pgrun&port=5433")
    args = p.parse_args()

    # Run import - relative import won't work as script, do it inline
    sys.path.insert(0, '/home/claude/v4/sprint9b_cpm')
    from cpm_engine import run_cpm

    ext = args.file.lower().rsplit('.', 1)[-1]
    warnings: list[str] = []
    if ext == 'csv':
        parser = CSVScheduleParser(args.file)
        activities, deps = parser.parse()
        result = load_schedule_to_db(args.package_id, args.name, activities, deps,
                                     'csv_import', args.file, args.user_id, args.db, warnings)
    elif ext == 'xer':
        parser = XERParser(args.file)
        parser.parse()
        activities = parser.get_activities()
        deps_xer = parser.get_dependencies()
        task_id_to_code = {a.get('_xer_task_id'): a['activity_code'] for a in activities if a.get('_xer_task_id')}
        deps = []
        for d in deps_xer:
            pc = task_id_to_code.get(d['predecessor_xer_id'])
            sc = task_id_to_code.get(d['successor_xer_id'])
            if pc and sc:
                deps.append({'predecessor_code': pc, 'successor_code': sc,
                            'dependency_type': d['dependency_type'], 'lag_days': d['lag_days']})
        result = load_schedule_to_db(args.package_id, args.name, activities, deps,
                                     'xer_import', args.file, args.user_id, args.db, warnings)
    else:
        print(f"Unsupported: {ext}"); sys.exit(1)

    print(json.dumps(result, indent=2, default=str))
    print("\n--- Running CPM ---")
    cpm = run_cpm(result['schedule_id'], args.db)
    print(json.dumps(cpm, indent=2, default=str))
