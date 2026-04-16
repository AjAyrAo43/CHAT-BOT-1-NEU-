"""
api/routers/incidents.py
-------------------------
Prefix: /admin
Routes:
  POST   /admin/incidents            — client creates an incident
  GET    /admin/incidents            — client gets their own incidents
  GET    /admin/all-incidents        — seller gets ALL incidents (super-admin only)
  PUT    /admin/incidents/{id}       — seller updates status + response
  DELETE /admin/incidents/{id}       — seller permanently deletes an incident
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query
from dotenv import load_dotenv

from ....database import (
    create_incident,
    get_incidents_by_tenant,
    get_all_incidents,
    update_incident,
    delete_incident,
    get_tenant_by_id,
)
from ...schemas.models import IncidentCreate, IncidentUpdate, IncidentResponse

load_dotenv()

router = APIRouter(prefix="/admin", tags=["Incidents"])

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_EMAIL = os.getenv("SMTP_EMAIL", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
ALERT_EMAIL = os.getenv("ALERT_EMAIL", "")


def _send_email(to: str, subject: str, body_html: str):
    """Send a plain SMTP email. Silent fail — never crash a request."""
    if not SMTP_EMAIL or not SMTP_PASSWORD or not to:
        return
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_EMAIL
        msg["To"] = to
        msg.attach(MIMEText(body_html, "html"))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        print(f"[INCIDENTS] Email send failed: {e}")


def _notify_seller_new_incident(incident: dict, tenant_name: str):
    """Email the seller when a client opens a new incident."""
    if not ALERT_EMAIL:
        return
    severity_color = {
        "critical": "#dc2626", "high": "#f97316",
        "medium": "#f59e0b",   "low":  "#10b981"
    }.get(incident["severity"], "#6b7280")

    body = f"""
    <html><body style="font-family:Arial,sans-serif;padding:20px;background:#f9fafb;">
    <div style="max-width:600px;margin:0 auto;background:#fff;padding:30px;border-radius:12px;border:1px solid #e5e7eb;">
        <h2 style="color:#1f2937;">New Incident Reported</h2>
        <p style="color:#6b7280;">A client has opened a new support incident.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
            <tr><td style="padding:8px;font-weight:600;color:#374151;width:140px;">Client</td>
                <td style="padding:8px;color:#1f2937;">{tenant_name}</td></tr>
            <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:600;color:#374151;">Title</td>
                <td style="padding:8px;color:#1f2937;">{incident['title']}</td></tr>
            <tr><td style="padding:8px;font-weight:600;color:#374151;">Category</td>
                <td style="padding:8px;color:#1f2937;">{incident['category'].replace('_',' ').title()}</td></tr>
            <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:600;color:#374151;">Severity</td>
                <td style="padding:8px;"><span style="color:{severity_color};font-weight:700;">{incident['severity'].upper()}</span></td></tr>
            <tr><td style="padding:8px;font-weight:600;color:#374151;vertical-align:top;">Description</td>
                <td style="padding:8px;color:#1f2937;">{incident['description']}</td></tr>
        </table>
        <p style="margin-top:1.5rem;color:#9ca3af;font-size:12px;">
            Log in to your Seller Admin Panel to respond to this incident.
        </p>
    </div></body></html>
    """
    _send_email(ALERT_EMAIL, f"New Incident [{incident['severity'].upper()}] — {tenant_name}: {incident['title']}", body)


def _notify_client_incident_update(incident: dict, client_email: str, client_name: str):
    """Email the client when the seller responds or resolves their incident."""
    if not client_email:
        return
    status_label = incident["status"].replace("_", " ").title()
    status_color = {
        "open": "#f59e0b", "in_progress": "#3b82f6",
        "resolved": "#10b981", "closed": "#6b7280"
    }.get(incident["status"], "#6b7280")

    response_block = ""
    if incident.get("seller_response"):
        response_block = f"""
        <div style="background:#f0fdf4;border-left:4px solid #10b981;padding:1rem;border-radius:0 8px 8px 0;margin-top:1rem;">
            <strong style="color:#065f46;">Response from Support Team:</strong>
            <p style="color:#1f2937;margin-top:0.5rem;">{incident['seller_response']}</p>
        </div>"""

    body = f"""
    <html><body style="font-family:Arial,sans-serif;padding:20px;background:#f9fafb;">
    <div style="max-width:600px;margin:0 auto;background:#fff;padding:30px;border-radius:12px;border:1px solid #e5e7eb;">
        <h2 style="color:#1f2937;">Your Incident Has Been Updated</h2>
        <p style="color:#6b7280;">Dear {client_name}, your support incident has been updated.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
            <tr><td style="padding:8px;font-weight:600;color:#374151;width:120px;">Title</td>
                <td style="padding:8px;color:#1f2937;">{incident['title']}</td></tr>
            <tr style="background:#f9fafb;"><td style="padding:8px;font-weight:600;color:#374151;">Status</td>
                <td style="padding:8px;"><span style="color:{status_color};font-weight:700;">{status_label}</span></td></tr>
        </table>
        {response_block}
        <p style="margin-top:1.5rem;color:#9ca3af;font-size:12px;">
            Log in to your Admin Panel to view the full details.
        </p>
    </div></body></html>
    """
    _send_email(client_email, f"Incident Updated: {incident['title']}", body)


# ─────────────────────────────────────────────────────────────────────────────
# POST /admin/incidents  — client creates
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/incidents", response_model=IncidentResponse)
async def create_incident_endpoint(
    payload: IncidentCreate,
    background_tasks: BackgroundTasks,
    x_auth_token: Optional[str] = Header(None, alias="X-Auth-Token"),
):
    """Client opens a new support incident."""
    # Validate client token
    if x_auth_token != "super-admin-secret":
        if not x_auth_token:
            raise HTTPException(status_code=401, detail="Authentication token missing.")
        tenant = get_tenant_by_id(payload.tenant_id)
        if not tenant or tenant.get("api_key") != x_auth_token:
            raise HTTPException(status_code=403, detail="Invalid token.")

    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty.")
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="Description cannot be empty.")

    incident = create_incident(payload.tenant_id, payload.dict())

    # Notify seller in background
    tenant_info = get_tenant_by_id(payload.tenant_id)
    tenant_name = tenant_info.get("name", "Unknown") if tenant_info else "Unknown"
    background_tasks.add_task(_notify_seller_new_incident, incident, tenant_name)

    return incident


# ─────────────────────────────────────────────────────────────────────────────
# GET /admin/incidents  — client gets their own
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/incidents", response_model=List[IncidentResponse])
async def get_my_incidents(
    tenant_id: str = Query(...),
    x_auth_token: Optional[str] = Header(None, alias="X-Auth-Token"),
):
    """Client fetches their own incident list."""
    if x_auth_token != "super-admin-secret":
        if not x_auth_token:
            raise HTTPException(status_code=401, detail="Authentication token missing.")
        tenant = get_tenant_by_id(tenant_id)
        if not tenant or tenant.get("api_key") != x_auth_token:
            raise HTTPException(status_code=403, detail="Invalid token.")

    return get_incidents_by_tenant(tenant_id)


# ─────────────────────────────────────────────────────────────────────────────
# GET /admin/all-incidents  — seller gets all
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/all-incidents", response_model=List[IncidentResponse])
async def get_all_incidents_endpoint(
    x_auth_token: Optional[str] = Header(None, alias="X-Auth-Token"),
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
):
    """Seller fetches all incidents from all clients with optional filters."""
    if x_auth_token != "super-admin-secret":
        raise HTTPException(status_code=403, detail="Seller access only.")

    incidents = get_all_incidents()

    if status:
        incidents = [i for i in incidents if i["status"] == status]
    if severity:
        incidents = [i for i in incidents if i["severity"] == severity]

    return incidents


# ─────────────────────────────────────────────────────────────────────────────
# PUT /admin/incidents/{id}  — seller updates
# ─────────────────────────────────────────────────────────────────────────────
@router.put("/incidents/{incident_id}", response_model=IncidentResponse)
async def update_incident_endpoint(
    incident_id: str,
    payload: IncidentUpdate,
    background_tasks: BackgroundTasks,
    x_auth_token: Optional[str] = Header(None, alias="X-Auth-Token"),
):
    """Seller updates incident status and/or writes a response."""
    if x_auth_token != "super-admin-secret":
        raise HTTPException(status_code=403, detail="Seller access only.")

    updated = update_incident(incident_id, payload.dict(exclude_none=True))
    if not updated:
        raise HTTPException(status_code=404, detail="Incident not found.")

    # Notify client in background
    tenant_info = get_tenant_by_id(updated["tenant_id"])
    if tenant_info:
        client_email = tenant_info.get("notification_email", "")
        client_name = tenant_info.get("name", "Client")
        background_tasks.add_task(_notify_client_incident_update, updated, client_email, client_name)

    return updated


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /admin/incidents/{id}  — seller deletes
# ─────────────────────────────────────────────────────────────────────────────
@router.delete("/incidents/{incident_id}")
async def delete_incident_endpoint(
    incident_id: str,
    x_auth_token: Optional[str] = Header(None, alias="X-Auth-Token"),
):
    """Seller permanently deletes an incident."""
    if x_auth_token != "super-admin-secret":
        raise HTTPException(status_code=403, detail="Seller access only.")

    success = delete_incident(incident_id)
    if not success:
        raise HTTPException(status_code=404, detail="Incident not found.")
    return {"message": "Incident deleted."}
