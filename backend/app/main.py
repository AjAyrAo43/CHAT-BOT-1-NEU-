"""
app/main.py
-----------
FastAPI application factory.

Responsibilities (only):
  - Create the FastAPI app instance
  - Register middleware (CORS, logging, rate-limit error handler)
  - Register the startup event (DB initialisation + migration)
  - Mount all APIRouters

No business logic lives here.
"""
import time
import traceback
import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from .core.rate_limiter import limiter
from ..logger import log_request, log_error, log_abuse, logger
from ..metrics_store import record_request, record_error

# ── Routers ──────────────────────────────────────────────────────────────────
from .api.routers.health import router as health_router
from .api.routers.auth import router as auth_router
from .api.routers.tenants import router as tenants_router
from .api.routers.billing import router as billing_router
from .api.routers.chat import router as chat_router
from .api.routers.faq import router as faq_router
from .api.routers.leads import router as leads_router
from .api.routers.documents import router as documents_router
from .api.routers.profile import router as profile_router
from .api.routers.metrics import router as metrics_router

# ── Scheduler ─────────────────────────────────────────────────────────────────
from .scheduler import start_scheduler, stop_scheduler

# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Multi-Tenant Chatbot API",
    description="Production-ready multi-tenant LLM chatbot backend.",
    version="2.0.0",
)

# Attach rate-limiter state so @limiter.limit() decorators work globally
app.state.limiter = limiter


# ── Startup: DB initialisation & tenant migration ────────────────────────────
@app.on_event("startup")
async def startup_initialize_db():
    """Create central DB tables on first boot. Safe to re-run (no-op if already exist).
    Also runs a no-op migration on every existing tenant DB to add new tables.
    """
    from ..database import (
        _get_central_engine, CentralBase,
        migrate_tenant_schema, get_all_tenants,
        migrate_central_schema, migrate_usernames,
    )

    try:
        engine = _get_central_engine()
        CentralBase.metadata.create_all(bind=engine)
        migrate_central_schema()
        migrate_usernames()
        logger.info("Central DB tables initialised.")
    except Exception as e:
        logger.warning(f"Could not initialise central DB tables: {e}")

    try:
        tenants = get_all_tenants()

        def _migrate_one(t):
            try:
                migrate_tenant_schema(t["db_url"])
                return (t["id"], None)
            except Exception as te:
                return (t["id"], str(te))

        # Migrate all tenant DBs in parallel (max 8 threads, timeout 60 s total)
        with ThreadPoolExecutor(max_workers=min(8, max(1, len(tenants)))) as pool:
            futures = {pool.submit(_migrate_one, t): t for t in tenants}
            try:
                for future in as_completed(futures, timeout=60):
                    tid, err = future.result()
                    if err:
                        logger.warning(f"Could not migrate tenant {tid} DB: {err}")
            except TimeoutError:
                logger.warning("Tenant DB migration timed out — some DBs may be slow/unreachable.")

        logger.info(f"Tenant DB migration complete for {len(tenants)} tenants.")
    except Exception as e:
        logger.warning(f"Could not run tenant DB migrations: {e}")

    # ── Start the background knowledge refresh scheduler ──────────────────
    try:
        start_scheduler()
    except Exception as e:
        logger.warning(f"Could not start background scheduler: {e}")


@app.on_event("shutdown")
async def shutdown_stop_scheduler():
    """Gracefully stop the APScheduler on application shutdown."""
    try:
        stop_scheduler()
    except Exception as e:
        logger.warning(f"Error stopping scheduler: {e}")


# ── Rate-limit exceeded handler (logs abuse) ─────────────────────────────────
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    ip = request.client.host if request.client else "unknown"
    log_abuse(ip=ip, path=request.url.path, reason=f"Rate limit exceeded: {exc.detail}")
    record_error()
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}"},
    )


app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)


# ── Request logging + metrics middleware ─────────────────────────────────────
# Paths polled constantly — counted in metrics but NOT written to log file.
_SILENT_PATHS = {"/admin/tenants", "/health", "/admin/metrics", "/"}


@app.middleware("http")
async def logging_middleware(request: Request, call_next):
    start = time.perf_counter()
    tenant_id = request.query_params.get("tenant_id", "-")

    record_request()
    try:
        response = await call_next(request)
    except Exception as exc:
        record_error()
        tb = traceback.format_exc()
        log_error(tenant_id=tenant_id, path=request.url.path, error=exc, tb=tb)
        raise

    duration_ms = (time.perf_counter() - start) * 1000
    status = response.status_code

    if status >= 500:
        record_error()

    if request.url.path not in _SILENT_PATHS:
        log_request(
            tenant_id=tenant_id,
            path=request.url.path,
            method=request.method,
            status=status,
            duration_ms=duration_ms,
        )
    return response


# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Mount all routers ─────────────────────────────────────────────────────────
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(tenants_router)
app.include_router(billing_router)
app.include_router(chat_router)
app.include_router(faq_router)
app.include_router(leads_router)
app.include_router(documents_router)
app.include_router(profile_router)
app.include_router(metrics_router)
