"""
notifications.py - Simple email notifications for payment reminders.
Minimal implementation using existing SMTP settings.
"""
import smtplib
import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv
import os

load_dotenv()

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_EMAIL = os.getenv("SMTP_EMAIL", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")


def send_payment_reminder(client_email: str, client_name: str, amount_due: float, due_date: str):
    """Send a simple payment reminder email."""
    if not SMTP_EMAIL or not SMTP_PASSWORD or not client_email:
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Payment Reminder - {client_name}"
        msg["From"] = SMTP_EMAIL
        msg["To"] = client_email

        html = f"""
        <html><body style="font-family:Arial,sans-serif;padding:20px;">
        <h3>Payment Reminder</h3>
        <p>Dear {client_name},</p>
        <p>This is a friendly reminder that your payment of <strong>₹{amount_due}</strong> is due on <strong>{due_date}</strong>.</p>
        <p>Please contact us if you have any questions.</p>
        <p style="color:#666;font-size:12px;margin-top:20px;">
            Sent by NEU AI Technologies
        </p>
        </body></html>
        """
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.send_message(msg)

        return True
    except Exception as e:
        print(f"[NOTIFICATION] Failed to send payment reminder: {e}")
        return False


def send_expiry_reminder(client_email: str, client_name: str, expiry_date: str, days_left: int):
    """Send subscription expiry reminder."""
    if not SMTP_EMAIL or not SMTP_PASSWORD or not client_email:
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Subscription Expiry Alert - {client_name}"
        msg["From"] = SMTP_EMAIL
        msg["To"] = client_email

        html = f"""
        <html><body style="font-family:Arial,sans-serif;padding:20px;">
        <h3>Subscription Expiry Alert</h3>
        <p>Dear {client_name},</p>
        <p>Your chatbot subscription will expire in <strong>{days_left} days</strong> on <strong>{expiry_date}</strong>.</p>
        <p>Please renew your subscription to continue uninterrupted service.</p>
        <p style="color:#666;font-size:12px;margin-top:20px;">
            Sent by NEU AI Technologies
        </p>
        </body></html>
        """
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.send_message(msg)

        return True
    except Exception as e:
        print(f"[NOTIFICATION] Failed to send expiry reminder: {e}")
        return False
