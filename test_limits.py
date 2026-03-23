import os
import sys

sys.path.append(os.getcwd())

from backend.database import register_tenant, get_tenant_limits, extend_subscription, record_payment

print("Testing Plan Limits...")

# Test Default (Starter)
try:
    tenant = register_tenant("Test Starter Client", "sqlite:///test_starter.db")
    print(f"New Tenant Plan: {tenant.get('current_plan')}")
    limits = get_tenant_limits(tenant["id"])
    print(f"Starter Limits: {limits}")
except Exception as e:
    print(f"Error registering tenant: {e}")

# Test Upgrade to Pro
try:
    record_payment(tenant["id"], 8200, "Pro Plan (₹8200/mo)", 30)
    limits_pro = get_tenant_limits(tenant["id"])
    print(f"Upgraded to Pro. New Limits: {limits_pro}")
except Exception as e:
    print(f"Error upgrading tenant: {e}")
