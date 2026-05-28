"""
Restore a plain-text pg_dump (.sql) into the Postgres DB configured by DATABASE_URL.

Why this exists:
- Windows environment may not have `psql` / `pg_dump`.
- We still want an idempotent, "no legacy duplicates" restore path.

What it does:
1. Drops and recreates the `public` schema (wipes all tables/data in it).
2. Executes SQL statements from the dump.
3. Streams COPY ... FROM stdin blocks correctly.

Usage (PowerShell):
  .\\.venv\\Scripts\\python.exe tools\\restore_from_sql.py C:\\Users\\USER-1\\Downloads\\restore_source.sql
"""

from __future__ import annotations

import io
import os
import re
import sys
from typing import Iterable

from dotenv import load_dotenv


COPY_RE = re.compile(
    r"^COPY\s+([^\s(]+)\s*\((.*?)\)\s+FROM\s+stdin;\s*$", re.IGNORECASE
)


def _iter_sql_items(lines: Iterable[str]):
    """
    Yields either:
    - ("stmt", sql_text)
    - ("copy", table_name, columns_list, data_text)

    Handles dollar-quoted function bodies so we don't split on `;` inside them.
    """

    stmt_parts: list[str] = []
    in_copy = False
    copy_table = ""
    copy_cols: list[str] = []
    copy_buf: list[str] = []

    dollar_tag: str | None = None  # e.g. "$$" or "$func$"

    def flush_stmt():
        nonlocal stmt_parts
        s = "".join(stmt_parts).strip()
        stmt_parts = []
        if s:
            yield ("stmt", s)

    for raw in lines:
        if in_copy:
            if raw.startswith("\\."):
                yield ("copy", copy_table, copy_cols, "".join(copy_buf))
                in_copy = False
                copy_table = ""
                copy_cols = []
                copy_buf = []
            else:
                copy_buf.append(raw)
            continue

        line = raw
        stripped = line.strip()

        # Detect COPY blocks.
        m = COPY_RE.match(stripped)
        if m:
            # Flush anything before COPY.
            yield from flush_stmt()
            in_copy = True
            copy_table = m.group(1)
            copy_cols = [c.strip() for c in m.group(2).split(",") if c.strip()]
            copy_buf = []
            continue

        # Ignore psql meta commands (e.g. \connect, \restrict)
        if stripped.startswith("\\"):
            continue
        # Ignore SQL comments completely; pg_dump contains huge TOC comment blocks.
        if stripped.startswith("--"):
            continue
        if not stripped:
            continue

        # Track dollar-quoted blocks to avoid splitting on semicolons inside.
        # We only need a simple heuristic: toggle when we see an opening tag and
        # close it when we see the same tag again.
        if dollar_tag is None:
            # opening can be $$ or $tag$
            m_open = re.search(r"(\$[A-Za-z_0-9]*\$)", line)
            if m_open:
                tag = m_open.group(1)
                # If it's an odd count on this line, it opens a block.
                if line.count(tag) % 2 == 1:
                    dollar_tag = tag
        else:
            if dollar_tag in line and (line.count(dollar_tag) % 2 == 1):
                dollar_tag = None

        stmt_parts.append(line)

        # Only split on semicolon when not in dollar-quoted block.
        if dollar_tag is None and ";" in line:
            # pg_dump statements are typically line-terminated with ';'
            # We keep it simple: flush the whole buffer as one statement.
            yield from flush_stmt()

    # trailing statement
    yield from flush_stmt()


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: restore_from_sql.py PATH_TO_DUMP.sql", file=sys.stderr)
        return 2

    dump_path = argv[1]
    if not os.path.exists(dump_path):
        print(f"Dump not found: {dump_path}", file=sys.stderr)
        return 2

    load_dotenv(".env")
    db_url = os.environ.get("DATABASE_URL") or os.environ.get("PROJECT_BRAIN_DB_URL")
    if not db_url:
        print("DATABASE_URL not set in environment/.env", file=sys.stderr)
        return 2

    import psycopg2  # noqa: WPS433

    print(f"Restoring into: {db_url}")
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("DROP SCHEMA IF EXISTS public CASCADE;")
    cur.execute("CREATE SCHEMA public;")
    cur.execute("GRANT ALL ON SCHEMA public TO postgres;")
    cur.execute("GRANT ALL ON SCHEMA public TO public;")
    conn.autocommit = False

    with open(dump_path, "r", encoding="utf-8", errors="replace") as f:
        for item in _iter_sql_items(f):
            if item[0] == "stmt":
                sql_text = item[1]
                try:
                    cur.execute(sql_text)
                    conn.commit()
                except Exception:
                    conn.rollback()
                    # pg_dump contains some privilege/ownership/comment statements
                    # that can fail harmlessly. For everything else, fail fast so
                    # we don't end up restoring data into a half-built schema.
                    prefix = sql_text.lstrip().upper()
                    harmless = (
                        prefix.startswith("COMMENT ON ")
                        or prefix.startswith("ALTER SCHEMA ")
                        or prefix.startswith("ALTER TYPE ")
                        or prefix.startswith("ALTER TABLE ")
                        or prefix.startswith("ALTER SEQUENCE ")
                        or prefix.startswith("ALTER FUNCTION ")
                        or prefix.startswith("ALTER DEFAULT PRIVILEGES")
                        or prefix.startswith("REVOKE ")
                        or prefix.startswith("GRANT ")
                    )
                    if harmless:
                        continue
                    print("FAILED STMT (aborting):", file=sys.stderr)
                    print(sql_text[:5000], file=sys.stderr)
                    return 1
            else:
                _, table, cols, data = item
                try:
                    # psycopg2.copy_from() does not reliably support schema-qualified
                    # names like "public.table" on all platforms, so we use COPY ... STDIN.
                    col_list = ", ".join(cols)
                    copy_sql = f"COPY {table} ({col_list}) FROM STDIN WITH (FORMAT text)"
                    cur.copy_expert(copy_sql, io.StringIO(data))
                    conn.commit()
                except Exception as e:
                    conn.rollback()
                    print(f"FAILED COPY {table}: {e}", file=sys.stderr)
                    return 1

    # Verify key counts
    cur.execute("SELECT COUNT(*) FROM public.scheme_master;")
    schemes = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM public.packages;")
    packages = cur.fetchone()[0]
    # capex rows table name can vary across sprints; prefer capex_plan_rows if present
    cur.execute("SELECT to_regclass('public.capex_plan_rows') IS NOT NULL;")
    has_capex_rows = cur.fetchone()[0]
    capex_rows = None
    if has_capex_rows:
        cur.execute("SELECT COUNT(*) FROM public.capex_plan_rows;")
        capex_rows = cur.fetchone()[0]

    print(f"scheme_master={schemes} packages={packages} capex_plan_rows={capex_rows}")
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
