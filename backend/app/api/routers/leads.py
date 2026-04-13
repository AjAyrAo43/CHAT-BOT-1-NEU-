"""
api/routers/leads.py
---------------------
Prefix: /admin
Routes:
  GET /admin/leads  — all captured leads for this tenant
  GET /admin/chats  — all chat logs (decrypted) for this tenant
"""
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from collections import defaultdict

from ..deps import get_tenant_db
from ....database import Lead, ChatLog, ChatFeedback
from ....encryption import decrypt_text
from ...schemas.models import ChatLogResponse
from ...utils.formatters import format_utc

router = APIRouter(prefix="/admin", tags=["Leads"])


@router.get("/leads")
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
            "created_at": format_utc(lead.created_at),
        }
        for lead in leads
    ]


@router.get("/chats", response_model=List[ChatLogResponse])
async def get_all_chats(db: Session = Depends(get_tenant_db)):
    """Return all chat logs (decrypted) for this tenant."""
    logs = db.query(ChatLog).all()
    feedbacks = db.query(ChatFeedback).all()
    fb_dict = {f.session_id: f for f in feedbacks}
    
    session_times = defaultdict(list)
    for log in logs:
        if log.session_id:
            session_times[log.session_id].append(log.created_at)
            
    session_durations = {}
    for sid, times in session_times.items():
        if times:
            delta = max(times) - min(times)
            session_durations[sid] = int(delta.total_seconds())

    results = []
    for log in logs:
        decrypted_q = decrypt_text(log.encrypted_question)
        decrypted_a = decrypt_text(log.encrypted_answer) if log.encrypted_answer else ""
        results.append(
            {
                "id": log.id,
                "session_id": log.session_id if log.session_id else "unknown_session",
                "question": decrypted_q,
                "answer": decrypted_a,
                "intent": log.detected_intent,
                "page_url": log.page_url,
                "is_resolved": log.is_resolved,
                "language": log.language,
                "created_at": format_utc(log.created_at),
                "response_time_ms": getattr(log, "response_time_ms", 0),
                "feedback_rating": fb_dict[log.session_id].rating if log.session_id in fb_dict else None,
                "feedback_comment": fb_dict[log.session_id].comment if log.session_id in fb_dict else None,
                "duration_seconds": session_durations.get(log.session_id)
            }
        )
    return results

@router.get("/feedback/stats")
async def get_feedback_stats(db: Session = Depends(get_tenant_db)):
    """Return average feedback rating and count."""
    feedbacks = db.query(ChatFeedback).all()
    if not feedbacks:
        return {"average": 0, "count": 0}
    avg = sum(f.rating for f in feedbacks) / len(feedbacks)
    return {"average": round(avg, 1), "count": len(feedbacks)}
