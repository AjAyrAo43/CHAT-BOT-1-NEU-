"""
backend/app/scheduler.py
-------------------------
Background APScheduler job that runs every 6 hours (4x/day).

Responsibilities:
  1. Re-scrapes all URL-type KnowledgeDocuments for every active tenant
     so the AI always has fresh content from linked web pages.
  2. Logs a timestamped summary of how many tenants/docs were refreshed.

Usage:
  Called from app/main.py on the startup event.
  The scheduler runs in a background thread (BackgroundScheduler), so it
  does NOT block any async FastAPI request handling.
"""
import logging
import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _refresh_all_tenants_urls():
    """
    For every active tenant, re-scrape URL-type knowledge documents.
    This keeps the AI's web-sourced knowledge current without manual uploads.
    """
    try:
        from ..database import get_all_tenants, get_tenant_session, KnowledgeDocument
        import httpx
        from bs4 import BeautifulSoup

        tenants = get_all_tenants()
        total_refreshed = 0
        total_failed = 0

        for tenant in tenants:
            if not tenant.get("is_active"):
                continue

            tenant_id = tenant["id"]
            try:
                session = get_tenant_session(tenant_id)
                try:
                    url_docs = session.query(KnowledgeDocument).filter(
                        KnowledgeDocument.file_type == "url",
                        KnowledgeDocument.is_active == True,
                    ).all()

                    for doc in url_docs:
                        try:
                            with httpx.Client(timeout=15, follow_redirects=True) as client:
                                response = client.get(
                                    doc.filename,
                                    headers={"User-Agent": "Mozilla/5.0 AI-Training-Bot/1.0"},
                                )
                                response.raise_for_status()

                            soup = BeautifulSoup(response.text, "html.parser")
                            for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
                                tag.decompose()
                            text = soup.get_text(separator="\n", strip=True)
                            lines = [line.strip() for line in text.splitlines() if line.strip()]
                            new_content = "\n".join(lines)

                            if new_content.strip():
                                doc.content = new_content
                                total_refreshed += 1
                        except Exception as e:
                            logger.warning(f"[Scheduler] URL refresh failed for {doc.filename}: {e}")
                            total_failed += 1

                    session.commit()
                finally:
                    session.close()

            except Exception as e:
                logger.warning(f"[Scheduler] Could not process tenant {tenant_id}: {e}")

        now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        logger.info(
            f"[Scheduler] Knowledge refresh complete at {now} — "
            f"{total_refreshed} URL doc(s) refreshed, {total_failed} failed, "
            f"across {len(tenants)} tenant(s)."
        )

    except Exception as e:
        logger.error(f"[Scheduler] Fatal error during knowledge refresh: {e}")


def start_scheduler():
    """Start the background scheduler (called on FastAPI startup)."""
    global _scheduler
    _scheduler = BackgroundScheduler(timezone="UTC")

    # Run every 6 hours → 4 times per day
    _scheduler.add_job(
        _refresh_all_tenants_urls,
        trigger=IntervalTrigger(hours=6),
        id="knowledge_refresh",
        name="AI Knowledge URL Refresh",
        replace_existing=True,
        max_instances=1,  # Prevent overlapping runs
    )

    _scheduler.start()
    logger.info("[Scheduler] Started — AI knowledge URL refresh scheduled every 6 hours (4x/day).")


def stop_scheduler():
    """Stop the background scheduler (called on FastAPI shutdown)."""
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("[Scheduler] Stopped.")
