"""
app/core/security.py
--------------------
FastAPI dependency that validates the X-Auth-Token header and yields
the correct tenant DB session.  All protected endpoints depend on this.
"""
from typing import Iterator, Optional

from fastapi import Depends, HTTPException, Query, Header, Request
from sqlalchemy.orm import Session

from ...database import get_tenant_session, get_tenant_by_id


def get_tenant_db(
    request: Request,
    tenant_id: str = Query(..., description="The tenant/client ID"),
    x_auth_token: Optional[str] = Header(None, alias="X-Auth-Token"),
) -> Iterator[Session]:
    """Dependency that returns a session to the correct tenant's database.

    - Super-admin token ("super-admin-secret") bypasses per-tenant auth.
    - All other callers must supply the tenant's own API key.
    """
    if x_auth_token == "super-admin-secret":
        # Super-admin bypass — no tenant-level check needed
        pass
    else:
        if not x_auth_token:
            raise HTTPException(status_code=401, detail="Authentication token missing")

        tenant = get_tenant_by_id(tenant_id)
        if not tenant or tenant.get("api_key") != x_auth_token:
            raise HTTPException(
                status_code=403,
                detail="Invalid token or unauthorized for this tenant",
            )

        # Demo account read-only enforcement
        if tenant.get("is_demo_account") and request.method in ["POST", "PUT", "DELETE"]:
            # Allow chat endpoints since they need to POST messages
            if not request.url.path.endswith("/chat"):
                raise HTTPException(status_code=403, detail="Action not permitted on demo accounts.")

    try:
        db = get_tenant_session(tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    try:
        yield db
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        raise
    finally:
        db.close()
