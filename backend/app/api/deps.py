"""
app/api/deps.py
---------------
Convenience re-export so routers can write:

    from ..deps import get_tenant_db

instead of following the full path to core/security.
"""
from ..core.security import get_tenant_db

__all__ = ["get_tenant_db"]
