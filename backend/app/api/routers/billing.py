"""
api/routers/billing.py
-----------------------
Prefix: /admin
Routes:
  POST   /admin/tenant/{tenant_id}/extend-subscription
  POST   /admin/charge-client
  GET    /admin/invoices
  GET    /admin/plans
  POST   /admin/plans
  PUT    /admin/plans/{plan_id}
  DELETE /admin/plans/{plan_id}
"""
from typing import List

from fastapi import APIRouter, BackgroundTasks, HTTPException

from ...schemas.models import (
    ExtendSubscriptionRequest,
    ChargeClientRequest,
    InvoiceResponse,
    PlanRequest,
    PlanResponse,
)

router = APIRouter(prefix="/admin", tags=["Billing"])


@router.post("/tenant/{tenant_id}/extend-subscription")
async def extend_subscription_endpoint(tenant_id: str, payload: ExtendSubscriptionRequest):
    """Extend a client's subscription by a given number of days."""
    from ....database import extend_subscription
    new_date = extend_subscription(tenant_id, payload.days)
    if new_date:
        return {"message": "Subscription extended.", "new_end_date": new_date}
    raise HTTPException(status_code=404, detail="Tenant not found.")


@router.post("/charge-client")
async def charge_client_endpoint(payload: ChargeClientRequest, background_tasks: BackgroundTasks):
    """Record a payment and extend subscription by 30 days."""
    from ....database import record_payment, get_tenant_by_id
    from ....notifications import send_payment_reminder

    try:
        days_to_add = 30
        result = record_payment(payload.tenant_id, payload.amount_inr, payload.plan_name, days_to_add)

        # Send payment confirmation email
        tenant = get_tenant_by_id(payload.tenant_id)
        if tenant and tenant.get("notification_email"):
            background_tasks.add_task(
                send_payment_reminder,
                tenant.get("notification_email"),
                tenant.get("name", "Client"),
                payload.amount_inr,
                result.get("new_end_date", "")
            )

        return {"message": "Payment recorded successfully"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Payment failed: {e}")


@router.get("/invoices", response_model=List[InvoiceResponse])
async def list_invoices():
    """List all global payment historical records."""
    from ....database import get_all_invoices_from_dbs
    return get_all_invoices_from_dbs()


@router.get("/plans", response_model=List[PlanResponse])
async def list_plans():
    """List all subscription plans."""
    from ....database import get_all_plans
    return get_all_plans()


@router.post("/plans", response_model=PlanResponse)
async def create_new_plan(payload: PlanRequest):
    """Create a new subscription plan."""
    from ....database import create_plan
    try:
        return create_plan(payload.dict())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/plans/{plan_id}", response_model=PlanResponse)
async def update_existing_plan(plan_id: str, payload: PlanRequest):
    """Update an existing subscription plan."""
    from ....database import update_plan
    try:
        return update_plan(plan_id, payload.dict(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/plans/{plan_id}")
async def delete_existing_plan(plan_id: str):
    """Delete a subscription plan."""
    from ....database import delete_plan
    try:
        success = delete_plan(plan_id)
        if not success:
            raise HTTPException(status_code=404, detail="Plan not found")
        return {"message": "Plan deleted successfully."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/tenant/{tenant_id}/send-expiry-reminder")
async def send_expiry_reminder_endpoint(tenant_id: str, background_tasks: BackgroundTasks):
    """Send subscription expiry reminder email to client."""
    from ....database import get_tenant_by_id
    from ....notifications import send_expiry_reminder

    tenant = get_tenant_by_id(tenant_id)
    if not tenant or not tenant.get("notification_email"):
        raise HTTPException(status_code=404, detail="Tenant or email not found.")

    expiry_date = tenant.get("subscription_end_date", "")
    days_left = 30  # Default estimate

    background_tasks.add_task(
        send_expiry_reminder,
        tenant.get("notification_email"),
        tenant.get("name", "Client"),
        expiry_date,
        days_left
    )

    return {"message": "Expiry reminder sent."}
