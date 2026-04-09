"""
api/routers/auth.py
--------------------
Prefix: /admin
Routes:
  POST /admin/auth              — client login (rate-limited)
  POST /admin/seller-auth       — super-admin login (rate-limited)
  POST /admin/resolve-username  — map username → tenant_id
  POST /admin/change-password   — client password change
"""
from fastapi import APIRouter, HTTPException, Request

from ...core.rate_limiter import limiter
from ...core.config import SELLER_PASSWORD
from ....database import (
    verify_client_password,
    update_tenant_password,
    get_tenant_by_id,
    get_tenant_by_username,
)
from ...schemas.models import (
    AuthRequest,
    SellerAuthRequest,
    ResolveUsernameRequest,
    ChangePasswordRequest,
)

router = APIRouter(prefix="/admin", tags=["Auth"])


@router.post("/auth")
@limiter.limit("5/minute")
async def authenticate_client(request: Request, payload: AuthRequest):
    """Verify a client's admin password and return their API token."""
    if verify_client_password(payload.tenant_id, payload.password):
        tenant = get_tenant_by_id(payload.tenant_id)
        return {"authenticated": True, "token": tenant.get("api_key")}
    raise HTTPException(status_code=401, detail="Invalid password.")


@router.post("/seller-auth")
@limiter.limit("5/minute")
async def authenticate_seller(request: Request, payload: SellerAuthRequest):
    """Verify the seller/developer password."""
    if payload.password == SELLER_PASSWORD:
        return {"authenticated": True, "token": "super-admin-secret"}
    raise HTTPException(status_code=401, detail="Invalid seller password.")


@router.post("/resolve-username")
async def resolve_username(payload: ResolveUsernameRequest):
    """Resolve a customer-facing username to a tenant_id.
    Clients call this first, then use the returned tenant_id for /admin/auth.
    """
    tenant = get_tenant_by_username(payload.username)
    if not tenant:
        raise HTTPException(status_code=404, detail="Username not found.")
    return {"tenant_id": tenant["id"], "username": tenant["username"]}


@router.post("/change-password")
async def change_client_password(payload: ChangePasswordRequest):
    """Allow a client to change their admin password."""
    if not verify_client_password(payload.tenant_id, payload.old_password):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    if len(payload.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters.")
    success = update_tenant_password(payload.tenant_id, payload.new_password)
    if success:
        return {"message": "Password changed successfully."}
    raise HTTPException(status_code=500, detail="Failed to change password.")
