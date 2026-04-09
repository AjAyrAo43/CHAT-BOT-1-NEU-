"""
app/core/config.py
------------------
Central place for all environment-variable-backed settings.
Import these constants instead of calling os.getenv() inside routers.
"""
import os

# ── Auth ────────────────────────────────────────────────────────────────────
SELLER_PASSWORD: str = os.getenv("SELLER_PASSWORD", "seller_secret")

# ── Alerting thresholds ──────────────────────────────────────────────────────
ALERT_TRAFFIC_RPM: int = int(os.getenv("ALERT_TRAFFIC_RPM", "50"))
ALERT_ERROR_RATE_PCT: float = float(os.getenv("ALERT_ERROR_RATE_PCT", "20"))
ALERT_TOKENS_PER_MIN: int = int(os.getenv("ALERT_TOKENS_PER_MIN", "50000"))
