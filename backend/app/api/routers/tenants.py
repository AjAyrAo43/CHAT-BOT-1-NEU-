"""
api/routers/tenants.py
-----------------------
Prefix: /admin
Routes:
  POST   /admin/tenant                        — register new tenant
  GET    /admin/tenants                       — list all tenants
  GET    /admin/tenant-info                   — get single tenant info
  DELETE /admin/tenant/{tenant_id}            — soft-delete (deactivate)
  DELETE /admin/tenant/{tenant_id}/hard-delete — permanent delete
"""
from typing import List

from fastapi import APIRouter, HTTPException

from ....database import (
    register_tenant,
    get_all_tenants,
    get_tenant_by_id,
    deactivate_tenant,
    delete_tenant_hard,
    get_tenant_limits,
    create_demo_tenant,
)
from ...schemas.models import TenantCreate, TenantResponse

router = APIRouter(prefix="/admin", tags=["Tenants"])


def _build_tenant_response(t: dict) -> TenantResponse:
    """Convert a raw tenant dict to a TenantResponse schema."""
    return TenantResponse(
        id=t["id"],
        name=t["name"],
        username=t.get("username", ""),
        api_key=t["api_key"],
        is_active=t["is_active"],
        created_at=t["created_at"],
        subscription_end_date=t.get("subscription_end_date"),
        current_plan=t.get("current_plan", "Starter"),
        limits=get_tenant_limits(t["id"]),
    )


@router.post("/tenant", response_model=TenantResponse)
async def register_tenant_endpoint(payload: TenantCreate):
    """Register a new client — creates their database tables automatically."""
    try:
        new_tenant = register_tenant(
            payload.name,
            payload.db_url,
            payload.admin_password,
            payload.notification_email,
            payload.logo_b64,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initialize client database: {e}")

    return _build_tenant_response(new_tenant)


@router.post("/create-demo-tenant", response_model=TenantResponse)
async def create_demo_tenant_endpoint(payload: TenantCreate):
    """Create a new demo tenant with read-only and predefined data."""
    try:
        t = create_demo_tenant(name=payload.name, db_url=payload.db_url)
        return _build_tenant_response(t)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/tenants", response_model=List[TenantResponse])
async def list_tenants():
    """List all registered clients."""
    return [_build_tenant_response(t) for t in get_all_tenants(use_cache=False)]


@router.get("/tenant-info", response_model=TenantResponse)
async def get_tenant_info(tenant_id: str):
    """Get info for a specific tenant (used by client dashboard)."""
    t = get_tenant_by_id(tenant_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found.")
    return _build_tenant_response(t)


@router.delete("/tenant/{tenant_id}")
async def deactivate_tenant_endpoint(tenant_id: str):
    """Deactivate a client (soft delete)."""
    success = deactivate_tenant(tenant_id)
    if not success:
        raise HTTPException(status_code=404, detail="Tenant not found.")
    return {"message": "Tenant deactivated."}


@router.delete("/tenant/{tenant_id}/hard-delete")
async def hard_delete_tenant_endpoint(tenant_id: str):
    """Permanently delete a client and drop their database."""
    success = delete_tenant_hard(tenant_id)
    if not success:
        raise HTTPException(status_code=404, detail="Tenant not found or could not be deleted.")
    return {"message": "Tenant and all associated data permanently deleted."}
