# GCP Deployment Guide (Cloud Run & Neon DB)

This walkthrough documents the final steps required to deploy the AI Chatbot platform to Google Cloud Platform for production traffic.

## 1. Backend Deployment (Google Cloud Run)
Your backend FastAPI service has been containerized using a `Dockerfile` and a `.dockerignore`.

**Prerequisites:**
- Google Cloud CLI (`gcloud`) installed on your computer.
- A project created on GCP.
- Your Neon DB PostgreSQL Connection String.

**Steps:**
1. Open your terminal in the root `CHAT BOT 1` project folder.
2. Login to Google Cloud:
   ```cmd
   gcloud auth login
   ```
3. Set your active GCP project (replace `your-project-id` with your actual GCP Project ID):
   ```cmd
   gcloud config set project your-project-id
   ```
4. Deploy the backend directly to Cloud Run:
   ```cmd
   gcloud run deploy chatbot-backend --source . --region us-central1 --allow-unauthenticated
   ```
5. During the deployment, it will prompt you for environment variables. You must provide:
   - `GROQ_API_KEY`: Your Groq API key for Llama 3.
   - `SELLER_PASSWORD`: The super-admin password.
   - `DATABASE_URL`: Your Neon DB connection string (e.g., `postgresql://user:pass@ep-lucky-smoke.../neondb`).
6. Once deployed, `gcloud` will return a live **Service URL** (e.g., `https://chatbot-backend-abc123.a.run.app`). **Copy this URL.**

---

## 2. Frontend Deployment (Firebase Hosting)
Once your backend is live, you must update the frontends to point to the new Cloud Run URL instead of your local machine.

**Steps:**
1. Open `frontend/admin/script.js`, `frontend/client/script.js`, and `frontend/chatbot/script.js`.
2. Change the `API_BASE` variable at the top of all three files:
   ```javascript
   // Change from this:
   const API_BASE = 'http://127.0.0.1:8000';
   
   // To your new Cloud Run URL:
   const API_BASE = 'https://chatbot-backend-abc123.a.run.app';
   ```
3. Deploy the `frontend/` folder using Firebase Hosting or Vercel. 
   - *Example using Firebase CLI:*
     ```cmd
     npm install -g firebase-tools
     firebase login
     firebase init hosting  (Select the "frontend" folder)
     firebase deploy
     ```

## 3. The Chatbot Widget Snippet
Once your frontend is deployed to Firebase, provide your clients with a simple HTML snippet to embed the chatbot on their own websites. 

Example snippet format:
```html
<script>
    window.ChatbotTenantID = "THEIR-TENANT-UUID-HERE";
</script>
<script src="https://your-firebase-domain.web.app/chatbot/script.js"></script>
```
