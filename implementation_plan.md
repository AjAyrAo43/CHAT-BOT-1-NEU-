# Plan Differentiation Strategies

We currently have 3 plans: Starter (₹2400/mo), Pro (₹8200/mo), and Enterprise (₹41000/mo). To make these plans distinct and incentivize upgrades, we can implement the following differences:

## 1. Message Quotas & Rate Limiting (Your Suggestion)
Instead of a flat `10/minute` limit for everyone, we can introduce monthly quotas and variable rate limits.
* **Starter**: 1,000 messages/month, 10 messages/minute.
* **Pro**: 10,000 messages/month, 30 messages/minute.
* **Enterprise**: Unlimited messages, 60 messages/minute.
**Implementation**: 
1. Add `current_plan` to the `tenants.json` schema. 
2. Add a message counter dependency to the `/chat` endpoint that checks [ChatLog](file:///c:/Users/Ajayr/OneDrive/Desktop/NEU%20AI%20TECH/CHATBOT%20PROJECT/CHAT%20BOT%201/backend/database.py#248-260) counts for the current month.

## 2. Knowledge Base Storage Limits
Restrict how much data the AI can learn from based on the plan.
* **Starter**: Max 5 Documents (PDFs/Text), Max 20 FAQs.
* **Pro**: Max 25 Documents, Max 100 FAQs.
* **Enterprise**: Unlimited Documents & FAQs.
**Implementation**: 
In the `/admin/upload-doc` and `/admin/faq` endpoints, check the tenant's current plan and count existing records before allowing new insertions.

## 3. Advanced Features & Analytics Gating
Gate premium features built into the admin dashboard.
* **Starter**: Chat English-only. Basic Chat Logs. No CSV/Excel export.
* **Pro & Enterprise**: Multi-language support. Intent distribution analytics. CSV/Excel data export capabilities.
**Implementation**: 
Check the client's plan in the API. If a 'Starter' client tries to query in a different language or export logs, return an "Upgrade Required" message.

## User Review Required
Please review these three strategies. Which of these would you like to implement first? 
I highly recommend starting with **#2 (Knowledge Base Limits)** or **#1 (Monthly Message Quotas)** as they directly tie to your server and LLM API costs. Let me know what you think, and I will write the code to enforce them!
