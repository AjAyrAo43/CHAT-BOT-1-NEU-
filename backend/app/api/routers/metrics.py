"""
api/routers/metrics.py
-----------------------
Prefix: /admin
Routes:
  GET /admin/metrics  — live snapshot (seller/developer only)
"""
import os
from fastapi import APIRouter

from ....metrics_store import get_metrics_snapshot
from ...core.config import ALERT_TRAFFIC_RPM, ALERT_ERROR_RATE_PCT, ALERT_TOKENS_PER_MIN

router = APIRouter(prefix="/admin", tags=["Metrics"])


@router.get("/metrics")
async def get_live_metrics():
    """
    Returns a live snapshot of the last 60 seconds of activity.
    Useful for the seller dashboard and debugging.
    """
    snap = get_metrics_snapshot()
    snap["alert_thresholds"] = {
        "traffic_rpm": ALERT_TRAFFIC_RPM,
        "error_rate_pct": ALERT_ERROR_RATE_PCT,
        "tokens_per_min": ALERT_TOKENS_PER_MIN,
    }
    return snap
