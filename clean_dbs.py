import os, sys, glob
sys.path.append(os.path.abspath("."))
from backend.database import _get_central_engine
from sqlalchemy import text

engine = _get_central_engine()
with engine.begin() as conn:
    res = conn.execute(text("DELETE FROM tenants WHERE db_url LIKE '%security_test_%' OR db_url LIKE '%pytest%'"))
    print(f"Deleted {res.rowcount} test tenants from central DB.")

deleted = 0
for f in glob.glob("security_test_*.db"):
    try:
        os.remove(f)
        deleted += 1
    except OSError:
        pass
print(f"Deleted {deleted} test database files.")
