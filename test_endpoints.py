import requests
import json
import uuid
import os

from backend.database import register_tenant, get_tenant_limits

BASE_URL = "http://127.0.0.1:8000"

print("1. Creating Test Starter Tenant...")
try:
    tenant = register_tenant(f"Test Starter API {uuid.uuid4().hex[:4]}", f"sqlite:///test_starter_api.db")
    tenant_id = tenant["id"]
    print(f"Created Tenant ID: {tenant_id}")
except Exception as e:
    print(f"Failed: {e}")
    exit(1)

print("\n2. Testing FAQ Limit (Starter allows 20)...")
faqs_added = 0
for i in range(22):
    res = requests.post(
        f"{BASE_URL}/admin/faq",
        json={"question": f"Q{i}", "answer": f"A{i}", "intent": "information"},
        params={"tenant_id": tenant_id}
    )
    if res.status_code == 200:
        faqs_added += 1
    else:
        print(f"Stopped at {i+1}th FAQ! Response: {res.status_code} - {res.text}")
        break
print(f"Total FAQs successfully added: {faqs_added}")

print("\n3. Testing Language Feature Gate (Starter allows EN only)...")
chat_res = requests.post(
    f"{BASE_URL}/chat",
    json={
        "question": "Hola",
        "session_id": "test_session",
        "tenant_id": tenant_id,
        "language": "es"
    }
)
print(f"Chat Response (ES Language): {chat_res.json()}")

print("\n4. Testing Export Gate Verification API...")
info_res = requests.get(f"{BASE_URL}/admin/tenant-info", params={"tenant_id": tenant_id})
print(f"Export allowed? {info_res.json().get('limits', {}).get('export')}")
