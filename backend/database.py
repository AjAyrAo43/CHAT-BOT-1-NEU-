import os
import datetime
import uuid
import json
import bcrypt
from sqlalchemy import create_engine, Column, String, Text, Boolean, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────
# TENANT REGISTRY (stored in tenants.json file)
# ──────────────────────────────────────────────
TENANTS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "tenants.json")


def _load_tenants() -> list:
    """Load tenants list from JSON file."""
    if not os.path.exists(TENANTS_FILE):
        return []
    with open(TENANTS_FILE, "r") as f:
        return json.load(f)


def _save_tenants(tenants: list):
    """Save tenants list to JSON file."""
    with open(TENANTS_FILE, "w") as f:
        json.dump(tenants, f, indent=2)


def register_tenant(name: str, db_url: str, admin_password: str = "admin") -> dict:
    """Register a new client and create their database tables."""
    tenants = _load_tenants()

    # Check if name already exists
    for t in tenants:
        if t["name"] == name:
            raise ValueError(f"Tenant '{name}' already exists.")

    # Hash the client admin password
    password_hash = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode()

    new_tenant = {
        "id": str(uuid.uuid4()),
        "name": name,
        "db_url": db_url,
        "api_key": str(uuid.uuid4()),
        "admin_password_hash": password_hash,
        "is_active": True,
        "created_at": str(datetime.datetime.utcnow())
    }
    tenants.append(new_tenant)
    _save_tenants(tenants)

    # Auto-create tables in the client's database
    init_tenant_db(db_url)

    return new_tenant


def get_all_tenants() -> list:
    """Get all registered tenants."""
    return _load_tenants()


def get_tenant_by_id(tenant_id: str) -> dict:
    """Look up a tenant by ID."""
    tenants = _load_tenants()
    for t in tenants:
        if t["id"] == tenant_id and t["is_active"]:
            return t
    return None


def deactivate_tenant(tenant_id: str) -> bool:
    """Soft-delete a tenant."""
    tenants = _load_tenants()
    for t in tenants:
        if t["id"] == tenant_id:
            t["is_active"] = False
            _save_tenants(tenants)
            return True
    return False


def verify_client_password(tenant_id: str, password: str) -> bool:
    """Verify a client's admin password."""
    tenant = get_tenant_by_id(tenant_id)
    if not tenant:
        return False
    stored_hash = tenant.get("admin_password_hash", "")
    if not stored_hash:
        # Legacy tenant without password — accept default "admin"
        return password == "admin"
    return bcrypt.checkpw(password.encode(), stored_hash.encode())


def update_tenant_password(tenant_id: str, new_password: str) -> bool:
    """Update a client's admin password."""
    tenants = _load_tenants()
    for t in tenants:
        if t["id"] == tenant_id:
            t["admin_password_hash"] = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
            _save_tenants(tenants)
            return True
    return False


# ──────────────────────────────────────────────
# TENANT (CLIENT) DATABASE MODELS
# ──────────────────────────────────────────────
TenantBase = declarative_base()


class Admin(TenantBase):
    __tablename__ = "admins"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role = Column(String, default="admin")


class FAQ(TenantBase):
    __tablename__ = "faqs"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    question = Column(Text)
    answer = Column(Text)
    intent = Column(String, index=True)
    is_active = Column(Boolean, default=True)


class BusinessProfile(TenantBase):
    __tablename__ = "business_profile"
    id = Column(String, primary_key=True, default="default")
    company_name = Column(String, default="Generic Corp")
    industry = Column(String, default="General Services")
    business_description = Column(Text, default="A professional business providing high-quality services.")


class ChatLog(TenantBase):
    __tablename__ = "chat_logs_v2"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, index=True)
    encrypted_question = Column(Text)
    detected_intent = Column(String)
    page_url = Column(String)
    is_resolved = Column(Boolean, default=False)
    language = Column(String, default="en")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


# ──────────────────────────────────────────────
# DYNAMIC TENANT CONNECTION MANAGEMENT
# ──────────────────────────────────────────────
_tenant_engines = {}  # Cache: db_url -> engine


def _get_tenant_engine(db_url: str):
    """Create or retrieve a cached engine for a tenant's database."""
    if db_url not in _tenant_engines:
        if db_url.startswith("sqlite"):
            _tenant_engines[db_url] = create_engine(db_url, connect_args={"check_same_thread": False})
        else:
            _tenant_engines[db_url] = create_engine(db_url, pool_size=5, max_overflow=10)
    return _tenant_engines[db_url]


def get_tenant_db_url(tenant_id: str) -> str:
    """Look up a tenant's database URL from the registry."""
    tenant = get_tenant_by_id(tenant_id)
    if not tenant:
        raise ValueError(f"Tenant '{tenant_id}' not found or is inactive.")
    return tenant["db_url"]


def get_tenant_session(tenant_id: str):
    """Get a SQLAlchemy session connected to a specific tenant's database."""
    db_url = get_tenant_db_url(tenant_id)
    engine = _get_tenant_engine(db_url)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return Session()


def init_tenant_db(db_url: str):
    """Create all tables in a tenant's database."""
    engine = _get_tenant_engine(db_url)
    TenantBase.metadata.create_all(bind=engine)


if __name__ == "__main__":
    print(f"Tenants file: {TENANTS_FILE}")
    print(f"Registered tenants: {len(_load_tenants())}")
