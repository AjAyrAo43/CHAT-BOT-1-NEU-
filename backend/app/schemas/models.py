"""
app/schemas/models.py
---------------------
All Pydantic request/response models for the API.
Moved here from backend/main.py to keep routers lean.
"""
from typing import List, Optional
from pydantic import BaseModel


# ── Chat ────────────────────────────────────────────────────────────────────

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

class FeedbackRequest(BaseModel):
    tenant_id: str
    session_id: str
    rating: int  # 1-5
    comment: Optional[str] = ""

# ── FAQ ─────────────────────────────────────────────────────────────────────

class FAQBase(BaseModel):
    question: str
    answer: str
    intent: str


class FAQResponse(FAQBase):
    id: str
    is_active: bool

    class Config:
        from_attributes = True


# ── Business Profile ────────────────────────────────────────────────────────

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
    chatbot_greeting_message: str = "Hi! How can I help you today?"
    chatbot_system_prompt: str = "You are a helpful customer support assistant."


# ── Chat Logs ───────────────────────────────────────────────────────────────

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
    response_time_ms: int = 0
    feedback_rating: Optional[int] = None
    feedback_comment: Optional[str] = None
    duration_seconds: Optional[int] = None


# ── Documents ───────────────────────────────────────────────────────────────

class DocumentResponse(BaseModel):
    id: str
    filename: str
    file_type: str
    is_active: bool
    created_at: str
    file_size_bytes: int = 0


# ── Tenants ─────────────────────────────────────────────────────────────────

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
    is_demo_account: bool = False
    created_at: str
    subscription_start_date: Optional[str] = None
    subscription_end_date: Optional[str] = None
    deactivated_at: Optional[str] = None
    current_plan: str = "Starter"
    limits: Optional[dict] = None


# ── Billing ─────────────────────────────────────────────────────────────────

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
    default_trial_days: int = 14


class PlanResponse(PlanRequest):
    id: str
    created_at: str = ""
    active_users_count: int = 0


# ── Auth ────────────────────────────────────────────────────────────────────

class AuthRequest(BaseModel):
    tenant_id: str
    password: str


class ResolveUsernameRequest(BaseModel):
    username: str


class ChangePasswordRequest(BaseModel):
    tenant_id: str
    old_password: str
    new_password: str


class SellerAuthRequest(BaseModel):
    password: str


# ── Subscription / Billing helpers ──────────────────────────────────────────

class ExtendSubscriptionRequest(BaseModel):
    days: int = 30


class ChargeClientRequest(BaseModel):
    tenant_id: str
    amount_inr: float
    plan_name: str


# ── Incidents ────────────────────────────────────────────────────────────────

class IncidentCreate(BaseModel):
    tenant_id: str
    title: str
    description: str
    category: str = "other"   # chatbot_error | billing | configuration | performance | other
    severity: str = "medium"  # low | medium | high | critical


class IncidentUpdate(BaseModel):
    status: Optional[str] = None        # open | in_progress | resolved | closed
    seller_response: Optional[str] = None
    notes: Optional[str] = None         # internal seller notes


class IncidentResponse(BaseModel):
    id: str
    tenant_id: str
    title: str
    description: str
    category: str
    severity: str
    status: str
    seller_response: str = ""
    client_read: bool = True
    notes: Optional[str] = None         # only populated in seller view
    created_at: str
    updated_at: str
    resolved_at: Optional[str] = None
    tenant_name: Optional[str] = None   # populated in seller view only
