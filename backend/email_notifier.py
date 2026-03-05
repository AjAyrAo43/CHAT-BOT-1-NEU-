import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

# Email config from environment variables
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_EMAIL = os.getenv("SMTP_EMAIL", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")


def send_lead_notification(client_email: str, client_name: str, lead_info: str, inquiry: str):
    """Send email notification to client when a new sales lead is captured."""
    if not SMTP_EMAIL or not SMTP_PASSWORD:
        print("[EMAIL] SMTP not configured — skipping notification.")
        return False

    if not client_email:
        print("[EMAIL] No client email configured — skipping notification.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🎯 New Sales Lead — {client_name}"
        msg["From"] = SMTP_EMAIL
        msg["To"] = client_email

        html_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; padding: 20px; background: #1a1a2e; color: #eee;">
            <div style="max-width: 600px; margin: 0 auto; background: #16213e; padding: 30px; border-radius: 12px;">
                <h2 style="color: #4fc3f7;">🎯 New Sales Lead Captured!</h2>
                <p>A visitor on your chatbot provided their contact information:</p>

                <div style="background: #0f3460; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <p><strong style="color: #4fc3f7;">Contact Details:</strong></p>
                    <p style="font-size: 16px;">{lead_info}</p>
                </div>

                <div style="background: #0f3460; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <p><strong style="color: #4fc3f7;">Original Inquiry:</strong></p>
                    <p>{inquiry}</p>
                </div>

                <p style="color: #999; font-size: 12px; margin-top: 20px;">
                    This is an automated notification from your AI Chatbot Platform.
                    Check your Admin Panel for full details.
                </p>
            </div>
        </body>
        </html>
        """

        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.send_message(msg)

        print(f"[EMAIL] Lead notification sent to {client_email}")
        return True

    except Exception as e:
        print(f"[EMAIL] Failed to send notification: {e}")
        return False
