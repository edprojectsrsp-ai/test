from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db

router = APIRouter()

@router.post("/plan/save_hierarchy")
def save_capex_hierarchy(payload: dict, db: Session = Depends(get_db)):
    """Saves the entire CAPEX tree structure and month-wise values."""
    try:
        # 1. Save or Update Header (Plan Status, FY, Version)
        header_result = db.execute(text("""
            INSERT INTO capex_plan_header (fy_year, plan_type, plan_status, effective_from_month)
            VALUES (:fy, :type, :status, :eff) RETURNING id
        """), {
            "fy": payload["fy"], "type": payload["planType"],
            "status": payload["status"], "eff": payload.get("effMonth")
        }).fetchone()

        plan_id = header_result[0]

        # 2. Iterate through flat rows and reconstruct parent_row_ids
        parent_stack = {} # Tracks the last row_id seen at each indent level

        for index, row in enumerate(payload["rows"]):
            # Determine Parent based on indent
            parent_id = None
            if row["indent"] > 0:
                 parent_id = parent_stack.get(row["indent"] - 1)

            # Insert Row
            row_result = db.execute(text("""
                INSERT INTO capex_plan_rows (plan_id, parent_row_id, scheme_id, row_name, row_level, indent_level, display_order)
                VALUES (:pid, :prid, :sid, :name, :level, :indent, :order) RETURNING id
            """), {
                "pid": plan_id, "prid": parent_id, "sid": row.get("scheme_id"),
                "name": row["name"], "level": row["level"], "indent": row["indent"], "order": index
            }).fetchone()

            new_row_id = row_result[0]
            parent_stack[row["indent"]] = new_row_id # Update stack for future children

            # 3. Insert Values (Gross, CumLast) if Item
            if row["level"] == "Item":
                db.execute(text("""
                    INSERT INTO capex_plan_values (plan_row_id, gross_cost, cumulative_exp_till_last_fy, be_fy, re_fy)
                    VALUES (:rid, :gross, :cum, :be, :re)
                """), {
                    "rid": new_row_id, "gross": row.get("gross", 0), "cum": row.get("cumLast", 0),
                    "be": row.get("beFY", 0), "re": row.get("reFY", 0)
                })

                # 4. Insert Monthly matrix
                for m_no, m_vals in row.get("months", {}).items():
                    if m_vals["be"] > 0 or m_vals["actual"] > 0:
                        db.execute(text("""
                            INSERT INTO capex_month_values (plan_row_id, month_no, be_amount, actual_amount)
                            VALUES (:rid, :mno, :be, :act)
                        """), {
                            "rid": new_row_id, "mno": m_no, "be": m_vals["be"], "act": m_vals["actual"]
                        })

        db.commit()
        return {"status": "success", "message": "Hierarchical CAPEX Saved Successfully"}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
