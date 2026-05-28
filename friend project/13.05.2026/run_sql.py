from database import get_db_connection

conn = get_db_connection()
c = conn.cursor()

# Add plan_type column to activities table
c.execute("ALTER TABLE activities ADD COLUMN IF NOT EXISTS plan_type VARCHAR(100);")

# Add plan_type column to monthly_plans table
c.execute("ALTER TABLE monthly_plans ADD COLUMN IF NOT EXISTS plan_type VARCHAR(100);")

conn.commit()
conn.close()

print("✅ SQL executed successfully! Columns added.")