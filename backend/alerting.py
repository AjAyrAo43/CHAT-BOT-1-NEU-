"""
alerting.py — Automated alert system for the Chatbot Backend.

Reads thresholds from environment variables and fires email alerts when
any metric crosses its threshold. A per-alert-type cooldown prevents
duplicate emails within the cooldown window.

Env Vars:
    ALERT_EMAIL             — recipient address (required for alerts to fire)
    ALERT_TRAFFIC_RPM       — requests/min threshold  (default: 50)
    ALERT_ERROR_RATE_PCT    — error % threshold        (default: 20)
    ALERT_TOKENS_PER_MIN    — tokens/min threshold     (default: 50000)
    ALERT_COOLDOWN_MINUTES  — min gap between same alert type (default: 15)

Public API:
    check_and_alert()  — call this as a FastAPI BackgroundTask
"""

import os
import time
import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

from .metrics_store import get_metrics_snapshot
from .logger import logger

load_dotenv()

# ── Config from env -----------------------------------------------------
ALERT_EMAIL = os.getenv("ALERT_EMAIL", "")
ALERT_TRAFFIC_RPM = int(os.getenv("ALERT_TRAFFIC_RPM", "50"))
ALERT_ERROR_RATE_PCT = float(os.getenv("ALERT_ERROR_RATE_PCT", "20"))
ALERT_TOKENS_PER_MIN = int(os.getenv("ALERT_TOKENS_PER_MIN", "50000"))
ALERT_COOLDOWN_MINUTES = int(os.getenv("ALERT_COOLDOWN_MINUTES", "15"))

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_EMAIL = os.getenv("SMTP_EMAIL", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

# ── Cooldown state (in-process, not persistent) -------------------------
_last_alert_times: dict[str, float] = {}
_COOLDOWN_SEC = ALERT_COOLDOWN_MINUTES * 60


def _is_on_cooldown(alert_type: str) -> bool:
    last = _last_alert_times.get(alert_type, 0.0)
    return (time.time() - last) < _COOLDOWN_SEC


def _mark_alerted(alert_type: str) -> None:
    _last_alert_times[alert_type] = time.time()


# ── Email sender --------------------------------------------------------

def _send_alert_email(subject: str, body_html: str) -> bool:
    """Send an alert email using the project's SMTP credentials."""
    if not SMTP_EMAIL or not SMTP_PASSWORD:
        logger.warning("[ALERT] SMTP not configured — cannot send alert.")
        return False
    if not ALERT_EMAIL:
        logger.warning("[ALERT] ALERT_EMAIL not set — no recipient for alert.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_EMAIL
        msg["To"] = ALERT_EMAIL

        html = f"""
        <html><body style="font-family:Arial,sans-serif;padding:20px;background:#1a1a2e;color:#eee;">
        <div style="max-width:600px;margin:0 auto;background:#16213e;padding:30px;border-radius:12px;">
        <h2 style="color:#f44747;">🚨 Chatbot Alert</h2>
        {body_html}
        <p style="color:#999;font-size:12px;margin-top:20px;">
            Sent by your AI Chatbot monitoring system at {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC.
        </p>
        </div></body></html>
        """
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.send_message(msg)

        logger.info("[ALERT] Alert email sent to %s | Subject: %s", ALERT_EMAIL, subject)
        return True

    except Exception as e:
        logger.error("[ALERT] Failed to send alert email: %s", repr(e))
        return False


# ── Core check function -------------------------------------------------

def check_and_alert() -> None:
    """
    Evaluate current metrics and fire alert emails for any crossed threshold.
    Designed to be called as a FastAPI BackgroundTask after each chat request.
    """
    snap = get_metrics_snapshot()

    # 1. High traffic spike
    if snap["requests_per_min"] > ALERT_TRAFFIC_RPM:
        if not _is_on_cooldown("traffic"):
            logger.warning(
                "[ALERT] High traffic spike: %d RPM (threshold: %d)",
                snap["requests_per_min"], ALERT_TRAFFIC_RPM
            )
            _send_alert_email(
                subject=f"🚨 High Traffic Spike — {snap['requests_per_min']} req/min",
                body_html=f"""
                <div style="background:#0f3460;padding:15px;border-radius:8px;margin:15px 0;">
                    <p><strong style="color:#f44747;">⚡ Traffic Spike Detected</strong></p>
                    <p>Current: <strong>{snap['requests_per_min']} requests/min</strong></p>
                    <p>Threshold: {ALERT_TRAFFIC_RPM} requests/min</p>
                </div>
                <p>Check your server logs for potential DDoS or abnormal usage.</p>
                """
            )
            _mark_alerted("traffic")

    # 2. High error rate
    if snap["error_rate_pct"] > ALERT_ERROR_RATE_PCT and snap["requests_per_min"] >= 3:
        if not _is_on_cooldown("error_rate"):
            logger.warning(
                "[ALERT] Error rate elevated: %.1f%% (threshold: %.1f%%)",
                snap["error_rate_pct"], ALERT_ERROR_RATE_PCT
            )
            _send_alert_email(
                subject=f"🚨 High Error Rate — {snap['error_rate_pct']}% errors",
                body_html=f"""
                <div style="background:#0f3460;padding:15px;border-radius:8px;margin:15px 0;">
                    <p><strong style="color:#f44747;">❌ Error Rate Alert</strong></p>
                    <p>Current error rate: <strong>{snap['error_rate_pct']}%</strong>
                       ({snap['errors_per_min']} errors / {snap['requests_per_min']} requests per min)</p>
                    <p>Threshold: {ALERT_ERROR_RATE_PCT}%</p>
                </div>
                <p>Review <code>logs/chatbot.log</code> for error details.</p>
                """
            )
            _mark_alerted("error_rate")

    # 3. Abnormal token usage
    if snap["tokens_per_min"] > ALERT_TOKENS_PER_MIN:
        if not _is_on_cooldown("tokens"):
            logger.warning(
                "[ALERT] Abnormal token usage: %d tokens/min (threshold: %d)",
                snap["tokens_per_min"], ALERT_TOKENS_PER_MIN
            )
            _send_alert_email(
                subject=f"🚨 High Token Usage — {snap['tokens_per_min']:,} tokens/min",
                body_html=f"""
                <div style="background:#0f3460;padding:15px;border-radius:8px;margin:15px 0;">
                    <p><strong style="color:#f44747;">🔥 Token Usage Alert</strong></p>
                    <p>Current: <strong>{snap['tokens_per_min']:,} tokens/min</strong></p>
                    <p>Threshold: {ALERT_TOKENS_PER_MIN:,} tokens/min</p>
                </div>
                <p>This may indicate abnormal LLM usage or a prompt injection attack.
                   Check <code>logs/chatbot.log</code> for details.</p>
                """
            )
            _mark_alerted("tokens")
