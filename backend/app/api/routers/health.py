"""
api/routers/health.py
---------------------
GET /        — API root
GET /health  — Cloud Run / Render readiness probe
"""
from fastapi import APIRouter

router = APIRouter(tags=["Health"])


@router.get("/")
async def root():
    return {"message": "Multi-Tenant Chatbot API is running. Access /docs for documentation."}


@router.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run / Render readiness probes."""
    return {"status": "healthy"}
