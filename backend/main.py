import os
from fastapi import FastAPI, Depends, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from .database import (
    get_tenant_session, init_tenant_db,
    register_tenant, get_all_tenants, get_tenant_by_id, deactivate_tenant,
    verify_client_password, update_tenant_password,
    ChatLog, FAQ, Admin, BusinessProfile
)
from .encryption import encrypt_text, decrypt_text
from .email_notifier import send_lead_notification
from .intent_chain import detect_intent
from .faq_chain import get_answer

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Multi-Tenant Chatbot API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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


class FAQResponse(FAQBase):
    id: str
    is_active: bool

    class Config:
        from_attributes = True


class ChatLogResponse(BaseModel):
    id: str
    session_id: str
    question: str
    intent: str
    page_url: str
    is_resolved: bool
    language: str
    created_at: str


class TenantCreate(BaseModel):
    name: str
    db_url: str
    admin_password: str = "admin"
    notification_email: str = ""


class TenantResponse(BaseModel):
    id: str
    name: str
    api_key: str
    is_active: bool
    created_at: str


# ──────────────────────────────────────────────
# TENANT MANAGEMENT ENDPOINTS (Developer Only)
# ──────────────────────────────────────────────
@app.get("/")
async def root():
    return {"message": "Multi-Tenant Chatbot API is running. Access /docs for documentation."}


class AuthRequest(BaseModel):
    tenant_id: str
    password: str


@app.post("/admin/auth")
async def authenticate_client(payload: AuthRequest):
    """Verify a client's admin password."""
    if verify_client_password(payload.tenant_id, payload.password):
        return {"authenticated": True}
    raise HTTPException(status_code=401, detail="Invalid password.")


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
        new_tenant = register_tenant(payload.name, payload.db_url, payload.admin_password, payload.notification_email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initialize client database: {e}")

    return TenantResponse(
        id=new_tenant["id"],
        name=new_tenant["name"],
        api_key=new_tenant["api_key"],
        is_active=new_tenant["is_active"],
        created_at=new_tenant["created_at"]
    )


@app.get("/admin/tenants", response_model=List[TenantResponse])
async def list_tenants():
    """List all registered clients."""
    tenants = get_all_tenants()
    return [
        TenantResponse(
            id=t["id"], name=t["name"], api_key=t["api_key"],
            is_active=t["is_active"], created_at=t["created_at"]
        ) for t in tenants
    ]


@app.delete("/admin/tenant/{tenant_id}")
async def deactivate_tenant_endpoint(tenant_id: str):
    """Deactivate a client (soft delete)."""
    success = deactivate_tenant(tenant_id)
    if not success:
        raise HTTPException(status_code=404, detail="Tenant not found.")
    return {"message": "Tenant deactivated."}


# ──────────────────────────────────────────────
# CHAT ENDPOINT (used by client's widget)
# ──────────────────────────────────────────────
@app.post("/chat", response_model=ChatResponse)
@limiter.limit("10/minute")
async def chat_endpoint(request: Request, payload: ChatRequest):
    try:
        # Get tenant-specific DB session
        try:
            db = get_tenant_session(payload.tenant_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

        # 1. Detect Intent (using tenant's business profile for context)
        intent = detect_intent(payload.question, payload.tenant_id)

        # 2. Get AI Answer (using tenant-specific FAQs and profile)
        answer = get_answer(payload.question, intent, payload.tenant_id, payload.language)

        # 3. Encrypt Question before saving
        encrypted_q = encrypt_text(payload.question)

        # 4. Save to tenant's DB
        new_log = ChatLog(
            session_id=payload.session_id,
            encrypted_question=encrypted_q,
            detected_intent=intent,
            page_url=payload.page_url,
            language=payload.language
        )
        db.add(new_log)
        db.commit()
        db.close()

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
        # Send email notification for contact intents (runs in background)
        try:
            if intent == "contact":
                tenant = get_tenant_by_id(payload.tenant_id)
                if tenant:
                    notif_email = tenant.get("notification_email", "")
                    send_lead_notification(
                        client_email=notif_email,
                        client_name=tenant.get("name", "Unknown"),
                        lead_info=payload.question,
                        inquiry="Contact request via chatbot"
                    )
        except Exception:
            pass  # Don't break chat if email fails


# ──────────────────────────────────────────────
# ADMIN ENDPOINTS (scoped to a tenant)
# ──────────────────────────────────────────────
@app.get("/admin/chats", response_model=List[ChatLogResponse])
async def get_all_chats(db: Session = Depends(get_tenant_db)):
    logs = db.query(ChatLog).all()
    results = []
    for log in logs:
        decrypted_q = decrypt_text(log.encrypted_question)
        results.append({
            "id": log.id,
            "session_id": log.session_id if log.session_id else "unknown_session",
            "question": decrypted_q,
            "intent": log.detected_intent,
            "page_url": log.page_url,
            "is_resolved": log.is_resolved,
            "language": log.language,
            "created_at": str(log.created_at)
        })
    return results


@app.post("/admin/faq", response_model=FAQResponse)
async def create_faq(faq: FAQBase, db: Session = Depends(get_tenant_db)):
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
    db.commit()
    db.refresh(profile)
    return profile


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
