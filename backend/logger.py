"""
logger.py — Centralised structured logging for the Chatbot Backend.

Creates rotating log files at  logs/chatbot.log  (10 MB × 5 backups)
plus a console handler for Docker/Cloud Run stdout.

Public helpers:
    log_request(tenant_id, path, method, status, duration_ms)
    log_error(tenant_id, path, error, tb)
    log_abuse(ip, path, reason)
"""

import logging
import os
import traceback
from logging.handlers import RotatingFileHandler

# ── Directory -----------------------------------------------------------
_LOG_DIR = os.path.join(os.path.dirname(__file__), "..", "logs")
os.makedirs(_LOG_DIR, exist_ok=True)
_LOG_FILE = os.path.join(_LOG_DIR, "chatbot.log")

# ── Formatter -----------------------------------------------------------
_FMT = "%(asctime)s | %(levelname)-8s | %(message)s"
_DATEFMT = "%Y-%m-%d %H:%M:%S"
formatter = logging.Formatter(_FMT, datefmt=_DATEFMT)

# ── Handlers ------------------------------------------------------------
_file_handler = RotatingFileHandler(
    _LOG_FILE, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
)
_file_handler.setFormatter(formatter)

_console_handler = logging.StreamHandler()
_console_handler.setFormatter(formatter)

# ── Root logger ---------------------------------------------------------
logger = logging.getLogger("chatbot")
logger.setLevel(logging.DEBUG)

# Avoid duplicate handlers on hot-reload
if not logger.handlers:
    logger.addHandler(_file_handler)
    logger.addHandler(_console_handler)

# Don't propagate to the root asyncio/uvicorn loggers
logger.propagate = False


# ── Public helpers -------------------------------------------------------

def log_request(
    tenant_id: str,
    path: str,
    method: str,
    status: int,
    duration_ms: float,
) -> None:
    """Log a completed HTTP request."""
    logger.info(
        "[REQUEST] tenant=%s  %s %s  →  %s  (%.1f ms)",
        tenant_id or "-",
        method,
        path,
        status,
        duration_ms,
    )


def log_error(
    tenant_id: str,
    path: str,
    error: Exception,
    tb: str = "",
) -> None:
    """Log an exception/error, including optional traceback string."""
    logger.error(
        "[ERROR] tenant=%s  path=%s  error=%s",
        tenant_id or "-",
        path,
        repr(error),
    )
    if tb:
        logger.debug("[TRACEBACK]\n%s", tb)


def log_abuse(ip: str, path: str, reason: str) -> None:
    """Log a detected abuse pattern (rate limit, suspicious activity, etc.)."""
    logger.warning(
        "[ABUSE] ip=%s  path=%s  reason=%s",
        ip or "unknown",
        path,
        reason,
    )
