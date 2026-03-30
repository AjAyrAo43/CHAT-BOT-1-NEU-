import os
import datetime
import uuid
import json
import bcrypt
import threading
import time as _time
from typing import Optional
from sqlalchemy import create_engine, Column, String, Text, Boolean, DateTime, Float, Integer, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship, joinedload
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────
# TENANT REGISTRY (PostgreSQL)
# ──────────────────────────────────────────────
CENTRAL_DB_URL = os.getenv("CENTRAL_DB_URL")
if not CENTRAL_DB_URL:
    raise ValueError("Missing 'CENTRAL_DB_URL' in .env")

# Legacy limits (kept for backward compatibility and fallback)
PLAN_LIMITS = {
    "Starter Plan (₹499/mo)": {"messages_per_month": 1000, "docs": 5, "faqs": 20, "export": False, "languages": ["en"]},
    "Pro Plan (₹1999/mo)": {"messages_per_month": 10000, "docs": 25, "faqs": 100, "export": True, "languages": "all"},
    "Enterprise Plan (₹4999/mo)": {"messages_per_month": 999999, "docs": 999, "faqs": 9999, "export": True, "languages": "all"},
    "Custom Term": {"messages_per_month": 999999, "docs": 999, "faqs": 9999, "export": True, "languages": "all"},
    "Starter": {"messages_per_month": 1000, "docs": 5, "faqs": 20, "export": False, "languages": ["en"]}
}

CentralBase = declarative_base()

class Plan(CentralBase):
    __tablename__ = "plans"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True, index=True)
    price_inr = Column(Float, default=0.0)
    messages_per_month = Column(Integer, default=1000)
    docs_limit = Column(Integer, default=5)
    faqs_limit = Column(Integer, default=20)
    export_enabled = Column(Boolean, default=False)
    languages = Column(String, default="en") # comma separated or "all"

class CentralTenant(CentralBase):
    __tablename__ = "tenants"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True, index=True)
    username = Column(String, unique=True, index=True)  # Customer-facing login handle, e.g. "acmecorp"
    db_url = Column(String)
    api_key = Column(String, default=lambda: str(uuid.uuid4()))
    admin_password_hash = Column(String)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    subscription_end_date = Column(DateTime, default=lambda: datetime.datetime.utcnow() + datetime.timedelta(days=14))
    
    current_plan_id = Column(String, ForeignKey("plans.id"))
    notification_email = Column(String, default="")

    plan = relationship("Plan", backref="tenants")

_central_engine = None
_CentralSessionLocal = None

# ── Simple in-memory cache for tenant lookups (30s TTL) ────────────────
_tenant_cache_data = None          # list[dict]
_tenant_cache_time = 0.0           # epoch seconds
_TENANT_CACHE_TTL = 30             # seconds

def _invalidate_tenant_cache():
    global _tenant_cache_data, _tenant_cache_time
    _tenant_cache_data = None
    _tenant_cache_time = 0.0

def _get_central_engine():
    global _central_engine
    if not _central_engine:
        _central_engine = create_engine(
            CENTRAL_DB_URL,
            pool_size=5,
            max_overflow=10,
            pool_pre_ping=True,   # silently test connection before use; replaces dead SSL connections
            pool_recycle=1800,    # recycle connections every 30 min (Supabase drops idle after ~10 min)
        )
    return _central_engine

def _get_central_session():
    global _CentralSessionLocal
    if not _CentralSessionLocal:
        engine = _get_central_engine()
        _CentralSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return _CentralSessionLocal()


def get_tenant_limits(tenant_id: str) -> dict:
    session = _get_central_session()
    try:
        tenant = session.query(CentralTenant).filter(CentralTenant.id == tenant_id).first()
        if not tenant or not tenant.plan:
            return PLAN_LIMITS["Starter"]
        
        langs = tenant.plan.languages
        return {
            "messages_per_month": tenant.plan.messages_per_month,
            "docs": tenant.plan.docs_limit,
            "faqs": tenant.plan.faqs_limit,
            "export": tenant.plan.export_enabled,
            "languages": langs.split(",") if langs != "all" else "all"
        }
    finally:
        session.close()

def get_all_plans() -> list:
    """Return all subscription plans in the central registry."""
    session = _get_central_session()
    try:
        plans = session.query(Plan).all()
        return [{
            "id": p.id,
            "name": p.name,
            "price_inr": p.price_inr,
            "messages_per_month": p.messages_per_month,
            "docs_limit": p.docs_limit,
            "faqs_limit": p.faqs_limit,
            "export_enabled": p.export_enabled,
            "languages": p.languages
        } for p in plans]
    finally:
        session.close()

def create_plan(plan_data: dict) -> dict:
    """Create a new subscription plan."""
    session = _get_central_session()
    try:
        if session.query(Plan).filter(Plan.name == plan_data["name"]).first():
            raise ValueError(f"Plan '{plan_data['name']}' already exists.")
        new_plan = Plan(
            id=str(uuid.uuid4()),
            name=plan_data["name"],
            price_inr=plan_data.get("price_inr", 0.0),
            messages_per_month=plan_data.get("messages_per_month", 1000),
            docs_limit=plan_data.get("docs_limit", 5),
            faqs_limit=plan_data.get("faqs_limit", 20),
            export_enabled=plan_data.get("export_enabled", False),
            languages=plan_data.get("languages", "en")
        )
        session.add(new_plan)
        session.commit()
        session.refresh(new_plan)
        return {
            "id": new_plan.id, "name": new_plan.name, "price_inr": new_plan.price_inr,
            "messages_per_month": new_plan.messages_per_month, "docs_limit": new_plan.docs_limit,
            "faqs_limit": new_plan.faqs_limit, "export_enabled": new_plan.export_enabled, "languages": new_plan.languages
        }
    finally:
        session.close()

def update_plan(plan_id: str, plan_data: dict) -> dict:
    """Update an existing subscription plan."""
    session = _get_central_session()
    try:
        plan = session.query(Plan).filter(Plan.id == plan_id).first()
        if not plan:
            raise ValueError(f"Plan '{plan_id}' not found.")
        
        if "name" in plan_data and plan_data["name"] != plan.name:
            if session.query(Plan).filter(Plan.name == plan_data["name"]).first():
                raise ValueError(f"Plan '{plan_data['name']}' already exists.")
            plan.name = plan_data["name"]
        
        plan.price_inr = plan_data.get("price_inr", plan.price_inr)
        plan.messages_per_month = plan_data.get("messages_per_month", plan.messages_per_month)
        plan.docs_limit = plan_data.get("docs_limit", plan.docs_limit)
        plan.faqs_limit = plan_data.get("faqs_limit", plan.faqs_limit)
        plan.export_enabled = plan_data.get("export_enabled", plan.export_enabled)
        plan.languages = plan_data.get("languages", plan.languages)
        
        session.commit()
        session.refresh(plan)
        return {
            "id": plan.id, "name": plan.name, "price_inr": plan.price_inr,
            "messages_per_month": plan.messages_per_month, "docs_limit": plan.docs_limit,
            "faqs_limit": plan.faqs_limit, "export_enabled": plan.export_enabled, "languages": plan.languages
        }
    finally:
        session.close()

def delete_plan(plan_id: str) -> bool:
    """Delete a subscription plan (checks usage first)."""
    session = _get_central_session()
    try:
        plan = session.query(Plan).filter(Plan.id == plan_id).first()
        if not plan:
            return False
        # Do not allow deletion if tenants are using it
        if session.query(CentralTenant).filter(CentralTenant.current_plan_id == plan_id).first():
            raise ValueError("Cannot delete plan currently in use by an active client.")
            
        session.delete(plan)
        session.commit()
        return True
    finally:
        session.close()

def _generate_username(name: str, session) -> str:
    """Generate a unique, clean alphanumeric username from a tenant name."""
    import re
    base = re.sub(r'[^a-z0-9]', '', name.lower())[:20] or "client"
    candidate = base
    counter = 1
    while session.query(CentralTenant).filter(CentralTenant.username == candidate).first():
        candidate = f"{base}{counter}"
        counter += 1
    return candidate


def register_tenant(name: str, db_url: str, admin_password: str = "admin", notification_email: str = "") -> dict:
    """Register a new client and create their database tables."""
    session = _get_central_session()
    try:
        if session.query(CentralTenant).filter(CentralTenant.name == name).first():
            raise ValueError(f"Tenant '{name}' already exists.")

        # Find default plan
        starter_plan = session.query(Plan).filter(Plan.name == "Starter Plan (₹499/mo)").first()
        if not starter_plan:
             # Create it on the fly if it doesn't exist to prevent crashes
             starter_plan = Plan(name="Starter Plan (₹499/mo)", price_inr=499.0, messages_per_month=1000, docs_limit=5, faqs_limit=20, export_enabled=False, languages="en")
             session.add(starter_plan)
             session.commit()
             session.refresh(starter_plan)

        password_hash = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode()
        username = _generate_username(name, session)

        new_tenant = CentralTenant(
            id=str(uuid.uuid4()),
            name=name,
            username=username,
            db_url=db_url,
            admin_password_hash=password_hash,
            notification_email=notification_email,
            current_plan_id=starter_plan.id
        )
        session.add(new_tenant)
        session.commit()
        session.refresh(new_tenant)
        _invalidate_tenant_cache()

        # Auto-create tables in the client's database
        init_tenant_db(db_url)

        return _tenant_to_dict(new_tenant, plan_name=starter_plan.name)
    finally:
        session.close()

def _tenant_to_dict(tenant: CentralTenant, plan_name: str = None) -> dict:
    if not tenant: return None
    # Accept plan_name to avoid lazy-loading the relationship per tenant
    if plan_name is None:
        plan_name = tenant.plan.name if tenant.plan else "Starter"
    return {
        "id": tenant.id,
        "name": tenant.name,
        "username": tenant.username or "",
        "db_url": tenant.db_url,
        "api_key": tenant.api_key,
        "admin_password_hash": tenant.admin_password_hash,
        "is_active": tenant.is_active,
        "created_at": str(tenant.created_at),
        "subscription_end_date": str(tenant.subscription_end_date),
        "notification_email": tenant.notification_email,
        "current_plan": plan_name
    }

def get_all_tenants() -> list:
    """Get all registered tenants — cached for 30 seconds."""
    global _tenant_cache_data, _tenant_cache_time
    if _tenant_cache_data is not None and (datetime.datetime.utcnow().timestamp() - _tenant_cache_time) < _TENANT_CACHE_TTL:
        return _tenant_cache_data
    session = _get_central_session()
    try:
        # Use joinedload to fetch tenants + plans in ONE query (prevents N+1)
        tenants = session.query(CentralTenant).options(joinedload(CentralTenant.plan)).all()
        result = [_tenant_to_dict(t, plan_name=t.plan.name if t.plan else "Starter") for t in tenants]
        _tenant_cache_data = result
        _tenant_cache_time = datetime.datetime.utcnow().timestamp()
        return result
    finally:
        session.close()


def get_tenant_by_id(tenant_id: str) -> dict:
    """Look up a tenant by ID — uses cache when available."""
    cached = get_all_tenants()  # populates cache as a side effect
    for t in cached:
        if t["id"] == tenant_id and t.get("is_active"):
            return t
    # Cache miss or inactive — hit DB directly
    session = _get_central_session()
    try:
        t = session.query(CentralTenant).options(joinedload(CentralTenant.plan)).filter(
            CentralTenant.id == tenant_id, CentralTenant.is_active == True
        ).first()
        return _tenant_to_dict(t, plan_name=t.plan.name if t and t.plan else "Starter")
    finally:
        session.close()


def get_tenant_by_username(username: str) -> Optional[dict]:
    """Look up an active tenant by their human-readable username."""
    username = username.strip().lower()
    # Try cache first
    cached = get_all_tenants()
    for t in cached:
        if t.get("username", "").lower() == username and t.get("is_active"):
            return t
    # Fallback to DB
    session = _get_central_session()
    try:
        t = session.query(CentralTenant).options(joinedload(CentralTenant.plan)).filter(
            CentralTenant.username == username, CentralTenant.is_active == True
        ).first()
        return _tenant_to_dict(t, plan_name=t.plan.name if t and t.plan else "Starter")
    finally:
        session.close()


def deactivate_tenant(tenant_id: str) -> bool:
    """Soft-delete a tenant."""
    session = _get_central_session()
    try:
        t = session.query(CentralTenant).filter(CentralTenant.id == tenant_id).first()
        if t:
            t.is_active = False
            session.commit()
            _invalidate_tenant_cache()
            return True
        return False
    finally:
        session.close()


def delete_tenant_hard(tenant_id: str) -> bool:
    """Hard-delete a tenant from central DB and remove their SQLite DB file if it exists."""
    session = _get_central_session()
    try:
        t = session.query(CentralTenant).filter(CentralTenant.id == tenant_id).first()
        if not t:
            return False
            
        db_url = t.db_url
        
        session.delete(t)
        session.commit()
        _invalidate_tenant_cache()
        
        # Delete associated SQLite file if it exists
        if db_url and db_url.startswith('sqlite:///'):
            import os
            filepath = db_url.replace('sqlite:///', '')
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception as e:
                    print(f"Warning: Could not delete SQLite file {filepath}: {e}")
                    
        return True
    except Exception as e:
        session.rollback()
        print(f"Error during hard delete: {e}")
        return False
    finally:
        session.close()


def verify_client_password(tenant_id: str, password: str) -> bool:
    """Verify a client's admin password."""
    session = _get_central_session()
    try:
        t = session.query(CentralTenant).filter(CentralTenant.id == tenant_id).first()
        if not t:
            return False
        stored_hash = t.admin_password_hash
        if not stored_hash:
            return password == "admin"
        return bcrypt.checkpw(password.encode(), stored_hash.encode())
    finally:
        session.close()


def update_tenant_password(tenant_id: str, new_password: str) -> bool:
    """Update a client's admin password."""
    session = _get_central_session()
    try:
        t = session.query(CentralTenant).filter(CentralTenant.id == tenant_id).first()
        if t:
            t.admin_password_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
            session.commit()
            return True
        return False
    finally:
        session.close()

def extend_subscription(tenant_id: str, days: int = 30, plan_name: Optional[str] = None) -> Optional[str]:
    """Extend a tenant's subscription by a given number of days."""
    session = _get_central_session()
    try:
        t = session.query(CentralTenant).filter(CentralTenant.id == tenant_id).first()
        if not t: return None

        current_end = t.subscription_end_date
        if not current_end or current_end < datetime.datetime.utcnow():
            new_end = datetime.datetime.utcnow() + datetime.timedelta(days=days)
        else:
            new_end = current_end + datetime.timedelta(days=days)
            
        t.subscription_end_date = new_end
        
        if plan_name:
            plan = session.query(Plan).filter(Plan.name == plan_name).first()
            if plan:
                t.current_plan_id = plan.id
                
        session.commit()
        return str(new_end)
    finally:
        session.close()

def record_payment(tenant_id: str, amount_inr: float, plan_name: str, days_to_add: int = 30) -> dict:
    """Record a payment in the tenant's database and extend their subscription."""
    # 1. Extend the subscription globally in tenants.json
    new_end_date = extend_subscription(tenant_id, days_to_add, plan_name)
    if not new_end_date:
        raise ValueError(f"Tenant {tenant_id} not found.")

    # 2. Record the invoice in the tenant's isolated database
    session = get_tenant_session(tenant_id)
    try:
        new_invoice = Invoice(
            tenant_id=tenant_id,
            amount_inr=amount_inr,
            plan_name=plan_name,
            status="Paid"
        )
        session.add(new_invoice)
        session.commit()
        session.refresh(new_invoice)
        invoice_id = new_invoice.id
    finally:
        session.close()
    
    return {
        "invoice_id": invoice_id,
        "new_end_date": new_end_date
    }

def get_all_invoices_from_dbs() -> list:
    """Dynamically reach into every active tenant's database and collect all historical invoices."""
    all_invoices = []
    tenants = get_all_tenants()
    
    for t in tenants:
        if not t.get("is_active", True):
            continue
            
        tenant_id = t["id"]
        try:
            session = get_tenant_session(tenant_id)
            try:
                # Query all invoices for this tenant
                tenant_invoices = session.query(Invoice).all()
                for inv in tenant_invoices:
                    all_invoices.append({
                        "id": inv.id,
                        "tenant_id": inv.tenant_id,
                        "amount_inr": inv.amount_inr,
                        "plan_name": inv.plan_name,
                        "status": inv.status,
                        "payment_date": str(inv.payment_date)
                    })
            finally:
                session.close()
        except Exception as e:
            # If the table doesn't exist yet or connection fails, skip
            print(f"Skipping invoices for tenant {tenant_id}: {e}")
            
    # Sort by payment date descending (newest first)
    all_invoices.sort(key=lambda x: x["payment_date"], reverse=True)
    return all_invoices


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
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class Invoice(TenantBase):
    __tablename__ = "invoices"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id = Column(String, index=True)
    amount_inr = Column(String)
    plan_name = Column(String)
    status = Column(String, default="Paid")
    payment_date = Column(DateTime, default=datetime.datetime.utcnow)



class FAQ(TenantBase):
    __tablename__ = "faqs"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    question = Column(Text)
    answer = Column(Text)
    intent = Column(String, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class BusinessProfile(TenantBase):
    __tablename__ = "business_profile"
    id = Column(String, primary_key=True, default="default")
    company_name = Column(String, default="Generic Corp")
    industry = Column(String, default="General Services")
    business_description = Column(Text, default="A professional business providing high-quality services.")
    website = Column(String, default="")
    support_email = Column(String, default="")
    phone = Column(String, default="")
    
    # 1. Point of Contact
    contact_person_name = Column(String, default="")
    contact_person_role = Column(String, default="")
    contact_person_email = Column(String, default="")
    contact_person_phone = Column(String, default="")
    
    # 2. Location & Operations
    address_street = Column(String, default="")
    city = Column(String, default="")
    state = Column(String, default="")
    country = Column(String, default="")
    zip_code = Column(String, default="")
    timezone = Column(String, default="")
    business_hours = Column(String, default="")

    # 3. Branding & UI Customization
    brand_color_primary = Column(String, default="")
    brand_color_secondary = Column(String, default="")
    social_linkedin = Column(String, default="")
    social_twitter = Column(String, default="")
    social_instagram = Column(String, default="")
    
    logo_url = Column(String, default="")
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class ChatLog(TenantBase):
    __tablename__ = "chat_logs_v2"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, index=True)
    encrypted_question = Column(Text)
    encrypted_answer = Column(Text)
    detected_intent = Column(String)
    page_url = Column(String)
    is_resolved = Column(Boolean, default=False)
    language = Column(String, default="en")
    user_ip = Column(String)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class KnowledgeDocument(TenantBase):
    __tablename__ = "knowledge_documents"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String)
    content = Column(Text)
    file_type = Column(String)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


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
            _tenant_engines[db_url] = create_engine(
                db_url,
                pool_size=5,
                max_overflow=10,
                pool_pre_ping=True,   # handle dropped SSL connections for tenant DBs too
                pool_recycle=1800,
            )
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


def migrate_usernames():
    """Backfill username for any existing tenants that don't have one yet.
    Safe to run multiple times (skips tenants that already have a username).
    Called automatically on module load so no manual migration step is needed.
    """
    session = _get_central_session()
    try:
        tenants_without_username = session.query(CentralTenant).filter(
            (CentralTenant.username == None) | (CentralTenant.username == "")
        ).all()
        if not tenants_without_username:
            return
        for tenant in tenants_without_username:
            tenant.username = _generate_username(tenant.name, session)
        session.commit()
        _invalidate_tenant_cache()
        print(f"[migrate_usernames] Backfilled usernames for {len(tenants_without_username)} tenants.")
    except Exception as e:
        session.rollback()
        print(f"[migrate_usernames] Warning: could not backfill usernames: {e}")
    finally:
        session.close()


# Run migration on import so existing tenants get usernames automatically
try:
    migrate_usernames()
except Exception:
    pass  # Non-fatal: app still starts normally


if __name__ == "__main__":
    print(f"Registered tenants: {len(get_all_tenants())}")
