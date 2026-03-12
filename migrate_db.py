import os
import sys

# Add the current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.database import get_all_tenants, init_tenant_db

def migrate():
    tenants = get_all_tenants()
    if not tenants:
        print("No tenants found.")
        return

    for t in tenants:
        name = t.get('name', 'Unknown')
        db_url = t.get('db_url')
        print(f"Migrating tenant: {name}")
        try:
            init_tenant_db(db_url)
            print("  -> Success! Tables created.")
        except Exception as e:
            print(f"  -> Failed: {e}")

if __name__ == "__main__":
    print("Starting Multi-Tenant DB Migration...")
    migrate()
    print("Migration complete!")
