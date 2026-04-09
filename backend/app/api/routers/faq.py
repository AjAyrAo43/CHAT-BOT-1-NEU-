"""
api/routers/faq.py
-------------------
Prefix: /admin
Routes:
  POST   /admin/faq         — create FAQ (limit-checked, thread-safe)
  GET    /admin/faqs        — list all FAQs for this tenant
  DELETE /admin/faq/{id}    — deactivate (soft-delete) a FAQ
"""
import threading
from collections import defaultdict
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..deps import get_tenant_db
from ....database import FAQ, get_tenant_limits
from ...schemas.models import FAQBase, FAQResponse

router = APIRouter(prefix="/admin", tags=["FAQ"])

# Per-tenant write lock — prevents duplicate FAQs under concurrent requests
_tenant_locks: dict = defaultdict(threading.Lock)


def _get_tenant_lock(tenant_id: str) -> threading.Lock:
    return _tenant_locks[tenant_id]


@router.post("/faq", response_model=FAQResponse)
def create_faq(
    faq: FAQBase,
    tenant_id: str = Query(...),
    db: Session = Depends(get_tenant_db),
):
    """Create a new FAQ entry (enforces per-plan FAQ limit)."""
    lock = _get_tenant_lock(tenant_id)
    with lock:
        limits = get_tenant_limits(tenant_id)
        faq_count = db.query(FAQ).filter(FAQ.is_active == True).count()
        if faq_count >= limits.get("faqs", 20):
            raise HTTPException(
                status_code=403,
                detail=f"FAQ limit reached ({limits.get('faqs')}). Please upgrade.",
            )
        new_faq = FAQ(**faq.dict())
        db.add(new_faq)
        db.commit()
        db.refresh(new_faq)
        return new_faq


@router.get("/faqs", response_model=List[FAQResponse])
async def get_faqs(db: Session = Depends(get_tenant_db)):
    """Return all FAQs for this tenant."""
    return db.query(FAQ).all()


@router.delete("/faq/{faq_id}")
async def deactivate_faq(faq_id: str, db: Session = Depends(get_tenant_db)):
    """Soft-delete a FAQ (sets is_active=False)."""
    faq = db.query(FAQ).filter(FAQ.id == faq_id).first()
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ not found")
    faq.is_active = False
    db.commit()
    return {"message": "FAQ deactivated"}
