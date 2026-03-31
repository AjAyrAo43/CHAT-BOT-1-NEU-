import os
import re
import time
import datetime
import traceback
from fastapi import FastAPI, Depends, HTTPException, Request, Query, UploadFile, File, BackgroundTasks
from fastapi.responses import JSONResponse
import io
import PyPDF2
import pandas as pd
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from .database import (
    get_tenant_session, init_tenant_db,
    register_tenant, get_all_tenants, get_tenant_by_id, get_tenant_by_username,
    deactivate_tenant, delete_tenant_hard,
    verify_client_password, update_tenant_password,
    ChatLog, FAQ, Admin, BusinessProfile, KnowledgeDocument, Lead,
    get_tenant_limits
)
from .encryption import encrypt_text, decrypt_text
from .email_notifier import send_lead_notification
from .intent_chain import detect_intent
from .faq_chain import get_answer
from .logger import log_request, log_error, log_abuse, logger
from .metrics_store import record_request, record_error, record_tokens, get_metrics_snapshot
from .alerting import check_and_alert



limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Multi-Tenant Chatbot API")
app.state.limiter = limiter


@app.on_event("startup")
async def startup_initialize_db():
    """Create central DB tables (tenants, plans) on first boot if they don't exist yet.
    Safe to run every time — SQLAlchemy's create_all is a no-op if tables already exist.
    Also migrates all existing tenant DBs (adds new tables like 'leads').
    """
    from .database import _get_central_engine, CentralBase, TenantBase, _get_tenant_engine, get_all_tenants
    try:
        engine = _get_central_engine()
        CentralBase.metadata.create_all(bind=engine)
        logger.info("Central DB tables initialized.")
    except Exception as e:
        logger.warning(f"Could not initialize central DB tables: {e}")

    # Auto-migrate every existing tenant DB (adds new tables, no-op for existing)
    try:
        tenants = get_all_tenants()
        for t in tenants:
            try:
                engine = _get_tenant_engine(t["db_url"])
                TenantBase.metadata.create_all(bind=engine)
            except Exception as te:
                logger.warning(f"Could not migrate tenant {t['id']} DB: {te}")
        logger.info(f"Tenant DB migration complete for {len(tenants)} tenants.")
    except Exception as e:
        logger.warning(f"Could not run tenant DB migrations: {e}")


# ── Abuse logging: override rate-limit handler ──────────────────────────
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    ip = request.client.host if request.client else "unknown"
    log_abuse(ip=ip, path=request.url.path, reason=f"Rate limit exceeded: {exc.detail}")
    record_error()
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}"},
    )


app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)


# ── Request logging + metrics middleware ────────────────────────────────
# Paths polled constantly — counted in metrics but NOT written to log file.
_SILENT_PATHS = {"/admin/tenants", "/health", "/admin/metrics", "/"}

@app.middleware("http")
async def logging_middleware(request: Request, call_next):
    start = time.perf_counter()
    tenant_id = request.query_params.get("tenant_id", "-")

    record_request()
    try:
        response = await call_next(request)
    except Exception as exc:
        record_error()
        tb = traceback.format_exc()
        log_error(tenant_id=tenant_id, path=request.url.path, error=exc, tb=tb)
        raise

    duration_ms = (time.perf_counter() - start) * 1000
    status = response.status_code

    if status >= 500:
        record_error()

    # Only log meaningful endpoints — skip constant background polls
    if request.url.path not in _SILENT_PATHS:
        log_request(
            tenant_id=tenant_id,
            path=request.url.path,
            method=request.method,
            status=status,
            duration_ms=duration_ms,
        )
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# Dependency
# ──────────────────────────────────────────────
def get_tenant_db(tenant_id: str = Query(..., description="The tenant/client ID")):
    """Dependency that returns a session to the correct tenant's database."""
    try:
        db = get_tenant_session(tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        yield db
    finally:
        db.close()


# ──────────────────────────────────────────────
# Pydantic Models
# ──────────────────────────────────────────────
def format_utc(dt) -> str:
    """Format a datetime as an ISO string with UTC timezone marker.
    This ensures JavaScript's new Date() correctly interprets it as UTC."""
    if dt is None:
        return ""
    if isinstance(dt, datetime.datetime):
        return dt.strftime("%Y-%m-%dT%H:%M:%S") + "+00:00"
    return str(dt)


class ChatRequest(BaseModel):
    question: str
    session_id: str
    tenant_id: str
    page_url: Optional[str] = "direct"
    language: Optional[str] = "en"


class ChatResponse(BaseModel):
    answer: str
    intent: str
    resolved: bool


class FAQBase(BaseModel):
    question: str
    answer: str
    intent: str


class BusinessProfileBase(BaseModel):
    company_name: str
    industry: str
    business_description: str
    website: str = ""
    support_email: str = ""
    phone: str = ""
    
    # 1. Point of Contact
    contact_person_name: str = ""
    contact_person_role: str = ""
    contact_person_email: str = ""
    contact_person_phone: str = ""
    
    # 2. Location & Operations
    address_street: str = ""
    city: str = ""
    state: str = ""
    country: str = ""
    zip_code: str = ""
    timezone: str = ""
    business_hours: str = ""

    # 3. Branding & UI Customization
    brand_color_primary: str = ""
    brand_color_secondary: str = ""
    social_linkedin: str = ""
    social_twitter: str = ""
    social_instagram: str = ""
    
    logo_url: str = ""


class FAQResponse(FAQBase):
    id: str
    is_active: bool

    class Config:
        from_attributes = True


class ChatLogResponse(BaseModel):
    id: str
    session_id: str
    question: str
    answer: str
    intent: str
    page_url: str
    is_resolved: bool
    language: str
    created_at: str

class DocumentResponse(BaseModel):
    id: str
    filename: str
    file_type: str
    is_active: bool
    created_at: str

class TenantCreate(BaseModel):
    name: str
    db_url: str
    admin_password: str = "admin"
    notification_email: str = ""
    logo_b64: Optional[str] = None


class TenantResponse(BaseModel):
    id: str
    name: str
    username: str = ""
    api_key: str
    is_active: bool
    created_at: str
    subscription_end_date: Optional[str] = None
    current_plan: str = "Starter"
    limits: Optional[dict] = None

class InvoiceResponse(BaseModel):
    id: str
    tenant_id: str
    amount_inr: float
    plan_name: str
    status: str
    payment_date: str

class PlanRequest(BaseModel):
    name: str
    price_inr: float = 0.0
    messages_per_month: int = 1000
    docs_limit: int = 5
    faqs_limit: int = 20
    export_enabled: bool = False
    languages: str = "en"

class PlanResponse(PlanRequest):
    id: str


# ──────────────────────────────────────────────
# TENANT MANAGEMENT ENDPOINTS (Developer Only)
# ──────────────────────────────────────────────
@app.get("/")
async def root():
    return {"message": "Multi-Tenant Chatbot API is running. Access /docs for documentation."}


@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run readiness probes."""
    return {"status": "healthy"}


class AuthRequest(BaseModel):
    tenant_id: str
    password: str


@app.post("/admin/auth")
async def authenticate_client(payload: AuthRequest):
    """Verify a client's admin password."""
    if verify_client_password(payload.tenant_id, payload.password):
        return {"authenticated": True}
    raise HTTPException(status_code=401, detail="Invalid password.")


class ResolveUsernameRequest(BaseModel):
    username: str


@app.post("/admin/resolve-username")
async def resolve_username(payload: ResolveUsernameRequest):
    """Resolve a customer-facing username to a tenant_id.
    Clients call this first, then use the returned tenant_id for /admin/auth.
    """
    tenant = get_tenant_by_username(payload.username)
    if not tenant:
        raise HTTPException(status_code=404, detail="Username not found.")
    return {"tenant_id": tenant["id"], "username": tenant["username"]}


class ChangePasswordRequest(BaseModel):
    tenant_id: str
    old_password: str
    new_password: str


@app.post("/admin/change-password")
async def change_client_password(payload: ChangePasswordRequest):
    """Allow client to change their admin password."""
    if not verify_client_password(payload.tenant_id, payload.old_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    if len(payload.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters.")
    success = update_tenant_password(payload.tenant_id, payload.new_password)
    if success:
        return {"message": "Password changed successfully."}
    raise HTTPException(status_code=500, detail="Failed to change password.")


# Seller auth — password from env variable
SELLER_PASSWORD = os.getenv("SELLER_PASSWORD", "seller_secret")


class SellerAuthRequest(BaseModel):
    password: str


@app.post("/admin/seller-auth")
async def authenticate_seller(payload: SellerAuthRequest):
    """Verify the seller/developer password."""
    if payload.password == SELLER_PASSWORD:
        return {"authenticated": True}
    raise HTTPException(status_code=401, detail="Invalid seller password.")


@app.post("/admin/tenant", response_model=TenantResponse)
async def register_tenant_endpoint(payload: TenantCreate):
    """Register a new client — creates their database tables automatically."""
    try:
        new_tenant = register_tenant(
            payload.name, 
            payload.db_url, 
            payload.admin_password, 
            payload.notification_email,
            payload.logo_b64
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initialize client database: {e}")

    return TenantResponse(
        id=new_tenant["id"],
        name=new_tenant["name"],
        username=new_tenant.get("username", ""),
        api_key=new_tenant["api_key"],
        is_active=new_tenant["is_active"],
        created_at=new_tenant["created_at"],
        subscription_end_date=new_tenant.get("subscription_end_date"),
        current_plan=new_tenant.get("current_plan", "Starter"),
        limits=get_tenant_limits(new_tenant["id"])
    )


@app.get("/admin/tenants", response_model=List[TenantResponse])
async def list_tenants():
    """List all registered clients."""
    tenants = get_all_tenants()
    return [
        TenantResponse(
            id=t["id"], name=t["name"], username=t.get("username", ""),
            api_key=t["api_key"],
            is_active=t["is_active"], created_at=t["created_at"],
            subscription_end_date=t.get("subscription_end_date"),
            current_plan=t.get("current_plan", "Starter"),
            limits=get_tenant_limits(t["id"])
        ) for t in tenants
    ]


@app.delete("/admin/tenant/{tenant_id}")
async def deactivate_tenant_endpoint(tenant_id: str):
    """Deactivate a client (soft delete)."""
    success = deactivate_tenant(tenant_id)
    if not success:
        raise HTTPException(status_code=404, detail="Tenant not found.")
    return {"message": "Tenant deactivated."}


@app.delete("/admin/tenant/{tenant_id}/hard-delete")
async def hard_delete_tenant_endpoint(tenant_id: str):
    """Permanently delete a client and drop their database."""
    success = delete_tenant_hard(tenant_id)
    if not success:
        raise HTTPException(status_code=404, detail="Tenant not found or could not be deleted.")
    return {"message": "Tenant and all associated data permanently deleted."}


@app.get("/admin/tenant-info", response_model=TenantResponse)
async def get_tenant_info(tenant_id: str):
    """Get info for a specific tenant (used by client dashboard)."""
    t = get_tenant_by_id(tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found.")
    
    return TenantResponse(
        id=t["id"], name=t["name"], username=t.get("username", ""),
        api_key=t["api_key"],
        is_active=t["is_active"], created_at=t["created_at"],
        subscription_end_date=t.get("subscription_end_date"),
        current_plan=t.get("current_plan", "Starter"),
        limits=get_tenant_limits(t["id"])
    )


class ExtendSubscriptionRequest(BaseModel):
    days: int = 30


@app.post("/admin/tenant/{tenant_id}/extend-subscription")
async def extend_subscription_endpoint(tenant_id: str, payload: ExtendSubscriptionRequest):
    """Extend a client's subscription by a given number of days."""
    from .database import extend_subscription
    new_date = extend_subscription(tenant_id, payload.days)
    if new_date:
        return {"message": f"Subscription extended.", "new_end_date": new_date}
    raise HTTPException(status_code=404, detail="Tenant not found.")


class ChargeClientRequest(BaseModel):
    tenant_id: str
    amount_inr: float
    plan_name: str


@app.post("/admin/charge-client")
async def charge_client_endpoint(payload: ChargeClientRequest):
    """Record a payment and extend subscription."""
    from .database import record_payment
    try:
        # Starter = 30 days, Pro = 30 days, etc.
        days_to_add = 30
        result = record_payment(payload.tenant_id, payload.amount_inr, payload.plan_name, days_to_add)
        return {"message": "Payment recorded successfully", "data": result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Payment failed: {e}")


@app.get("/admin/invoices", response_model=List[InvoiceResponse])
async def list_invoices():
    """List all global payment historical records."""
    from .database import get_all_invoices_from_dbs
    return get_all_invoices_from_dbs()

@app.get("/admin/plans", response_model=List[PlanResponse])
async def list_plans():
    """List all subscription plans."""
    from .database import get_all_plans
    return get_all_plans()

@app.post("/admin/plans", response_model=PlanResponse)
async def create_new_plan(payload: PlanRequest):
    """Create a new subscription plan."""
    from .database import create_plan
    try:
        return create_plan(payload.dict())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/admin/plans/{plan_id}", response_model=PlanResponse)
async def update_existing_plan(plan_id: str, payload: PlanRequest):
    """Update an existing subscription plan."""
    from .database import update_plan
    try:
        return update_plan(plan_id, payload.dict(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/admin/plans/{plan_id}")
async def delete_existing_plan(plan_id: str):
    """Delete a subscription plan."""
    from .database import delete_plan
    try:
        success = delete_plan(plan_id)
        if not success:
            raise HTTPException(status_code=404, detail="Plan not found")
        return {"message": "Plan deleted successfully."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ──────────────────────────────────────────────
# CHAT ENDPOINT (used by client's widget)
# ──────────────────────────────────────────────
@app.post("/chat", response_model=ChatResponse)
@limiter.limit("10/minute")
async def chat_endpoint(request: Request, payload: ChatRequest, background_tasks: BackgroundTasks):
    db = None
    intent = "unknown"
    try:
        try:
            db = get_tenant_session(payload.tenant_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

        current_tenant = get_tenant_by_id(payload.tenant_id)
        if current_tenant:
            end_date_str = current_tenant.get("subscription_end_date")
            if end_date_str:
                try:
                    end_date = datetime.datetime.fromisoformat(end_date_str)
                    if end_date < datetime.datetime.utcnow():
                        return ChatResponse(
                            answer="This chatbot is currently disabled due to an expired subscription. Please contact support to renew your service.",
                            intent="error_subscription_expired",
                            resolved=False
                        )
                except (ValueError, TypeError):
                    pass
        
        intent = detect_intent(payload.question, payload.tenant_id, db=db)
        
        limits = get_tenant_limits(payload.tenant_id)
        if payload.language != "en" and limits.get("languages") != "all" and payload.language not in limits.get("languages", ["en"]):
            return ChatResponse(
                answer="Multi-language support is not available on your current plan. Please upgrade to Pro or Enterprise.",
                intent="error_feature_gated",
                resolved=False
            )
            
        first_day_of_month = datetime.datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        monthly_messages = db.query(ChatLog).filter(ChatLog.created_at >= first_day_of_month).count()
        if monthly_messages >= limits.get("messages_per_month", 1000):
            return ChatResponse(
                answer="Monthly message quota reached for your current plan. Please upgrade to continue.",
                intent="error_quota_exceeded",
                resolved=False
            )

        # Pass the existing DB session to get_answer
        answer = get_answer(payload.question, intent, payload.tenant_id, payload.language, db=db)

        # ── Token usage tracking (word-count heuristic × 1.3) ──────────
        estimated_tokens = int(
            (len(payload.question.split()) + len(answer.split())) * 1.3
        )
        record_tokens(estimated_tokens)

        encrypted_q = encrypt_text(payload.question)
        encrypted_a = encrypt_text(answer)

        is_resolved = False

        # ── Lead detection: check if the user just submitted their contact info ──────
        # We look for all three: a name-like word, a 10-digit phone, and an email
        phone_match = re.search(r'\b(\d{10})\b', payload.question)
        email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', payload.question)
        # Name heuristic: at least one word that is NOT purely digits and NOT an email
        words = payload.question.split()
        name_words = [w for w in words
                      if not re.fullmatch(r'\d+', w)
                      and '@' not in w
                      and len(w) >= 2]
        has_contact_info = bool(phone_match and email_match and name_words)

        new_log = ChatLog(
            session_id=payload.session_id,
            encrypted_question=encrypted_q,
            encrypted_answer=encrypted_a,
            detected_intent=intent,
            page_url=payload.page_url,
            language=payload.language,
            is_resolved=has_contact_info,   # mark as resolved when lead captured
            user_ip=request.client.host if request.client else None
        )
        db.add(new_log)

        if has_contact_info and current_tenant:
            # Derive the name from whatever is NOT the phone / email in the message
            phone_str = phone_match.group(1)
            email_str = email_match.group(0)
            name_str = " ".join(
                w for w in words
                if w != phone_str and w != email_str and w not in (",", ";", "-")
            ).strip()

            # Save lead to dedicated leads table
            lead_record = Lead(
                session_id=payload.session_id,
                name=name_str,
                phone=phone_str,
                email=email_str,
                raw_message=payload.question,
                page_url=payload.page_url,
                is_notified=False
            )
            db.add(lead_record)
            db.commit()  # commit both ChatLog and Lead together

            # Send notification email with the actual contact details
            notif_email = current_tenant.get("notification_email", "")
            if notif_email:
                lead_info = f"Name: {name_str}\nPhone: {phone_str}\nEmail: {email_str}"
                background_tasks.add_task(
                    send_lead_notification,
                    client_email=notif_email,
                    client_name=current_tenant.get("name", "Unknown"),
                    lead_info=lead_info,
                    inquiry=payload.question
                )
                # Mark lead as notified (best-effort in background)
                lead_record.is_notified = True
        else:
            db.commit()

        # ── Check thresholds and alert if needed (non-blocking) ──────────
        background_tasks.add_task(check_and_alert)

        return {
            "answer": answer,
            "intent": intent,
            "resolved": False
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db:
            db.close()


# ──────────────────────────────────────────────
# ADMIN ENDPOINTS (scoped to a tenant)
# ──────────────────────────────────────────────

@app.get("/admin/leads")
async def get_leads(db: Session = Depends(get_tenant_db)):
    """Return all captured leads for this tenant, newest first."""
    leads = db.query(Lead).order_by(Lead.created_at.desc()).all()
    return [
        {
            "id": lead.id,
            "session_id": lead.session_id,
            "name": lead.name,
            "phone": lead.phone,
            "email": lead.email,
            "raw_message": lead.raw_message,
            "page_url": lead.page_url,
            "is_notified": lead.is_notified,
            "created_at": format_utc(lead.created_at)
        }
        for lead in leads
    ]


@app.get("/admin/chats", response_model=List[ChatLogResponse])
async def get_all_chats(db: Session = Depends(get_tenant_db)):
    logs = db.query(ChatLog).all()
    results = []
    for log in logs:
        decrypted_q = decrypt_text(log.encrypted_question)
        decrypted_a = decrypt_text(log.encrypted_answer) if log.encrypted_answer else ""
        results.append({
            "id": log.id,
            "session_id": log.session_id if log.session_id else "unknown_session",
            "question": decrypted_q,
            "answer": decrypted_a,
            "intent": log.detected_intent,
            "page_url": log.page_url,
            "is_resolved": log.is_resolved,
            "language": log.language,
            "created_at": format_utc(log.created_at)
        })
    return results


@app.post("/admin/faq", response_model=FAQResponse)
async def create_faq(faq: FAQBase, tenant_id: str = Query(...), db: Session = Depends(get_tenant_db)):
    limits = get_tenant_limits(tenant_id)
    faq_count = db.query(FAQ).filter(FAQ.is_active == True).count()
    if faq_count >= limits.get("faqs", 20):
        raise HTTPException(status_code=403, detail=f"FAQ limit reached ({limits.get('faqs')}). Please upgrade.")
        
    new_faq = FAQ(**faq.dict())
    db.add(new_faq)
    db.commit()
    db.refresh(new_faq)
    return new_faq


@app.get("/admin/faqs", response_model=List[FAQResponse])
async def get_faqs(db: Session = Depends(get_tenant_db)):
    return db.query(FAQ).all()


@app.delete("/admin/faq/{faq_id}")
async def deactivate_faq(faq_id: str, db: Session = Depends(get_tenant_db)):
    faq = db.query(FAQ).filter(FAQ.id == faq_id).first()
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ not found")
    faq.is_active = False
    db.commit()
    return {"message": "FAQ deactivated"}


@app.get("/admin/profile", response_model=BusinessProfileBase)
async def get_profile(db: Session = Depends(get_tenant_db)):
    profile = db.query(BusinessProfile).first()
    if not profile:
        profile = BusinessProfile(id="default")
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@app.post("/admin/profile", response_model=BusinessProfileBase)
async def update_profile(profile_data: BusinessProfileBase, db: Session = Depends(get_tenant_db)):
    profile = db.query(BusinessProfile).first()
    if not profile:
        profile = BusinessProfile(id="default")
        db.add(profile)

    profile.company_name = profile_data.company_name
    profile.industry = profile_data.industry
    profile.business_description = profile_data.business_description
    profile.website = profile_data.website
    profile.support_email = profile_data.support_email
    profile.phone = profile_data.phone
    
    # Update new fields
    profile.contact_person_name = profile_data.contact_person_name
    profile.contact_person_role = profile_data.contact_person_role
    profile.contact_person_email = profile_data.contact_person_email
    profile.contact_person_phone = profile_data.contact_person_phone
    
    profile.address_street = profile_data.address_street
    profile.city = profile_data.city
    profile.state = profile_data.state
    profile.country = profile_data.country
    profile.zip_code = profile_data.zip_code
    profile.timezone = profile_data.timezone
    profile.business_hours = profile_data.business_hours
    
    profile.brand_color_primary = profile_data.brand_color_primary
    profile.brand_color_secondary = profile_data.brand_color_secondary
    profile.social_linkedin = profile_data.social_linkedin
    profile.social_twitter = profile_data.social_twitter
    profile.social_instagram = profile_data.social_instagram

    profile.logo_url = profile_data.logo_url
    db.commit()
    db.refresh(profile)
    return profile


@app.post("/admin/upload-doc", response_model=DocumentResponse)
async def upload_document(
    tenant_id: str = Query(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_tenant_db)
):
    limits = get_tenant_limits(tenant_id)
    doc_count = db.query(KnowledgeDocument).filter(KnowledgeDocument.is_active == True).count()
    if doc_count >= limits.get("docs", 5):
        raise HTTPException(status_code=403, detail=f"Document storage limit reached ({limits.get('docs')}). Please upgrade.")

    content = ""
    try:
        content_bytes = await file.read()
        if file.filename.endswith(".pdf"):
            reader = PyPDF2.PdfReader(io.BytesIO(content_bytes))
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    content += text + "\n"
        elif file.filename.endswith(".txt") or file.filename.endswith(".csv"):
            content = content_bytes.decode("utf-8")
        elif file.filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(content_bytes))
            content = df.to_string()
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse file: {str(e)}")

    doc = KnowledgeDocument(
        filename=file.filename,
        content=content,
        file_type=file.filename.split(".")[-1]
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return {
        "id": doc.id,
        "filename": doc.filename,
        "file_type": doc.file_type,
        "is_active": doc.is_active,
        "created_at": format_utc(doc.created_at)
    }


@app.get("/admin/docs", response_model=List[DocumentResponse])
async def get_documents(db: Session = Depends(get_tenant_db)):
    docs = db.query(KnowledgeDocument).filter(KnowledgeDocument.is_active == True).all()
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "file_type": d.file_type,
            "is_active": d.is_active,
            "created_at": format_utc(d.created_at)
        } for d in docs
    ]


@app.delete("/admin/doc/{doc_id}")
async def delete_document(doc_id: str, db: Session = Depends(get_tenant_db)):
    doc = db.query(KnowledgeDocument).filter(KnowledgeDocument.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.is_active = False
    db.commit()
    return {"message": "Document deleted"}


# ──────────────────────────────────────────────
# METRICS ENDPOINT (Seller / Developer only)
# ──────────────────────────────────────────────
@app.get("/admin/metrics")
async def get_live_metrics():
    """
    Returns a live snapshot of the last 60 seconds of activity.
    Useful for the seller dashboard and debugging.
    """
    snap = get_metrics_snapshot()
    snap["alert_thresholds"] = {
        "traffic_rpm": int(os.getenv("ALERT_TRAFFIC_RPM", "50")),
        "error_rate_pct": float(os.getenv("ALERT_ERROR_RATE_PCT", "20")),
        "tokens_per_min": int(os.getenv("ALERT_TOKENS_PER_MIN", "50000")),
    }
    return snap


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
