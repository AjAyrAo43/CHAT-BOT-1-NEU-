"""
api/routers/chat.py
--------------------
Prefix: (none)
Routes:
  POST /chat  — main LLM endpoint used by the public-facing widget
"""
import re
import html
import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import JSONResponse

from ...core.rate_limiter import limiter
from ....database import (
    get_tenant_session,
    get_tenant_by_id,
    get_tenant_limits,
    ChatLog,
    Lead,
)
from ....encryption import encrypt_text
from ....email_notifier import send_lead_notification
from ....intent_chain import detect_intent
from ....faq_chain import get_answer
from ....metrics_store import record_tokens
from ....alerting import check_and_alert
from ...schemas.models import ChatRequest, ChatResponse, FeedbackRequest

router = APIRouter(tags=["Chat"])


@router.post("/chat", response_model=ChatResponse)
@limiter.limit("10/minute")
async def chat_endpoint(
    request: Request,
    payload: ChatRequest,
    background_tasks: BackgroundTasks,
):
    """
    Main conversational endpoint called by every chatbot widget.

    Security measures applied here:
    - XSS: html.escape() sanitises input before DB write
    - Subscription gate: blocks expired tenants
    - Language gate: blocks non-English on Starter plan
    - Quota gate: blocks when monthly message limit reached
    - Lead capture: detects name + phone + email patterns, skips LLM entirely
    """
    db = None
    intent = "unknown"
    try:
        # ── 1. XSS sanitisation ────────────────────────────────────────────
        payload.question = html.escape(payload.question)

        # ── 2. Open tenant DB session ──────────────────────────────────────
        try:
            db = get_tenant_session(payload.tenant_id)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

        # ── 3. Subscription expiry check ───────────────────────────────────
        current_tenant = get_tenant_by_id(payload.tenant_id)
        if current_tenant:
            end_date_str = current_tenant.get("subscription_end_date")
            if end_date_str:
                try:
                    end_date = datetime.datetime.fromisoformat(end_date_str)
                    if end_date < datetime.datetime.utcnow():
                        return ChatResponse(
                            answer="Service temporarily unavailable",
                            intent="error_subscription_expired",
                            resolved=False,
                        )
                except (ValueError, TypeError):
                    pass

        # ── 4. Intent detection ────────────────────────────────────────────
        intent = detect_intent(payload.question, payload.tenant_id, db=db)

        # ── 5. Language gate ───────────────────────────────────────────────
        limits = get_tenant_limits(payload.tenant_id)
        if (
            payload.language != "en"
            and limits.get("languages") != "all"
            and payload.language not in limits.get("languages", ["en"])
        ):
            return ChatResponse(
                answer="Multi-language support is not available on your current plan. Please upgrade to Pro or Enterprise.",
                intent="error_feature_gated",
                resolved=False,
            )

        # ── 6. Monthly quota check ─────────────────────────────────────────
        first_day_of_month = datetime.datetime.utcnow().replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        monthly_messages = (
            db.query(ChatLog).filter(ChatLog.created_at >= first_day_of_month).count()
        )
        if monthly_messages >= limits.get("messages_per_month", 1000):
            return ChatResponse(
                answer="Monthly message quota reached for your current plan. Please upgrade to continue.",
                intent="error_quota_exceeded",
                resolved=False,
            )

        # ── 7. Lead capture (before LLM call) ─────────────────────────────
        phone_match = re.search(r'\b(\d{10})\b', payload.question)
        email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', payload.question)
        words = payload.question.split()
        name_words = [
            w for w in words
            if not re.fullmatch(r'\d+', w) and '@' not in w and len(w) >= 2
        ]
        has_contact_info = bool(phone_match and email_match and name_words)

        if has_contact_info:
            phone_str = phone_match.group(1)
            email_str = email_match.group(0)
            name_str = " ".join(
                w for w in words
                if w != phone_str and w != email_str and w not in (",", ";", "-")
            ).strip()

            thank_you = "Thank you! Our support team has received your details and will contact you shortly."
            intent = "lead_captured"

            encrypted_q = encrypt_text(payload.question)
            encrypted_a = encrypt_text(thank_you)
            record_tokens(int((len(words) + len(thank_you.split())) * 1.3))

            new_log = ChatLog(
                session_id=payload.session_id,
                encrypted_question=encrypted_q,
                encrypted_answer=encrypted_a,
                detected_intent=intent,
                page_url=payload.page_url,
                language=payload.language,
                is_resolved=True,
                user_ip=request.client.host if request.client else None,
            )
            db.add(new_log)

            lead_record = Lead(
                session_id=payload.session_id,
                name=name_str,
                phone=phone_str,
                email=email_str,
                raw_message=payload.question,
                page_url=payload.page_url,
                is_notified=False,
            )
            db.add(lead_record)
            db.commit()

            notif_email = current_tenant.get("notification_email", "") if current_tenant else ""
            if notif_email:
                lead_info = f"Name: {name_str}\nPhone: {phone_str}\nEmail: {email_str}"
                background_tasks.add_task(
                    send_lead_notification,
                    client_email=notif_email,
                    client_name=current_tenant.get("name", "Unknown"),
                    lead_info=lead_info,
                    inquiry=payload.question,
                )
                lead_record.is_notified = True
                db.commit()

            background_tasks.add_task(check_and_alert)
            return {"answer": thank_you, "intent": intent, "resolved": True}

        # ── 8. LLM answer ──────────────────────────────────────────────────
        answer = get_answer(payload.question, intent, payload.tenant_id, payload.language, db=db)

        estimated_tokens = int(
            (len(payload.question.split()) + len(answer.split())) * 1.3
        )
        record_tokens(estimated_tokens)

        encrypted_q = encrypt_text(payload.question)
        encrypted_a = encrypt_text(answer)

        new_log = ChatLog(
            session_id=payload.session_id,
            encrypted_question=encrypted_q,
            encrypted_answer=encrypted_a,
            detected_intent=intent,
            page_url=payload.page_url,
            language=payload.language,
            is_resolved=False,
            user_ip=request.client.host if request.client else None,
        )
        db.add(new_log)
        db.commit()

        background_tasks.add_task(check_and_alert)

        return {"answer": answer, "intent": intent, "resolved": False}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db:
            db.close()


@router.post("/chat/feedback")
@limiter.limit("5/minute")
async def chat_feedback_endpoint(
    request: Request,
    payload: FeedbackRequest
):
    """
    Receives end-of-chat feedback from the widget.
    """
    db = None
    try:
        db = get_tenant_session(payload.tenant_id)
        from ....database import ChatFeedback

        # Upsert feedback for the session
        existing = db.query(ChatFeedback).filter(ChatFeedback.session_id == payload.session_id).first()
        if existing:
            existing.rating = payload.rating
            existing.comment = payload.comment
        else:
            new_fb = ChatFeedback(
                session_id=payload.session_id,
                rating=payload.rating,
                comment=payload.comment
            )
            db.add(new_fb)
        db.commit()
        return {"status": "success", "message": "Feedback recorded."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db:
            db.close()
