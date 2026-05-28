"""
Sprint0 Chunk1: model import smoke test.

This is intentionally "safe": it should not create tables or mutate the DB.

Step 1: Import key model modules to ensure they load without side effects.
Step 2: Reflect the live DB schema and compare model columns vs actual table columns.
"""

from __future__ import annotations


def main() -> int:
    # STEP 1: Importing should be side-effect free.
    from app.models import dpr, progress, scheme, user  # noqa: F401
    from app.models import god_models  # noqa: F401

    print("STEP 1 OK: models imported cleanly")

    # STEP 2: DB reflection vs model columns.
    from sqlalchemy import inspect

    from app.core.database import Base, engine

    insp = inspect(engine)
    if not insp.has_schema("public"):
        print("STEP 2 SKIP: public schema not found in DB")
        return 0

    drifts: list[str] = []

    # Only compare tables that are actually declared in SQLAlchemy metadata.
    #
    # Note: we intentionally do NOT use Base.metadata.sorted_tables here because
    # some models may contain foreign keys to tables that are not declared in
    # this codebase's metadata (legacy remnants), which makes SQLAlchemy's
    # dependency sorter raise NoReferencedTableError.
    for table in Base.metadata.tables.values():
        # Some projects use schema-qualified tables; default to public if omitted.
        schema = table.schema or "public"
        name = table.name

        if not insp.has_table(name, schema=schema):
            drifts.append(f"missing table in DB: {schema}.{name}")
            continue

        db_cols = {c["name"].lower() for c in insp.get_columns(name, schema=schema)}
        model_cols = {c.name.lower() for c in table.columns}

        missing_in_db = sorted(model_cols - db_cols)
        extra_in_db = sorted(db_cols - model_cols)
        if missing_in_db or extra_in_db:
            if missing_in_db:
                drifts.append(f"{schema}.{name}: missing cols in DB: {missing_in_db}")
            if extra_in_db:
                drifts.append(f"{schema}.{name}: extra cols in DB: {extra_in_db}")

    if drifts:
        print("STEP 2 RESULT: MODEL/DB DRIFT FOUND")
        for d in drifts:
            print(" -", d)
        return 1

    print("STEP 2 RESULT: ALL MODELS MATCH THE LIVE DB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
