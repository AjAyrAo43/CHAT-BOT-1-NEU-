import streamlit as st
import requests
import uuid

st.set_page_config(page_title="💬 Chat Assistant", page_icon="💬", layout="centered")

import os
BACKEND_URL = os.environ.get("BACKEND_URL", "https://chat-bot-1-neu.onrender.com")

# ──────────────────────────────────────────────
# Custom Styling
# ──────────────────────────────────────────────
st.markdown("""
<style>
    /* Hide Streamlit default menu, footer & header */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}

    /* Chat container styling */
    .stChatMessage {
        border-radius: 12px;
        margin-bottom: 8px;
    }
</style>
""", unsafe_allow_html=True)

# ──────────────────────────────────────────────
# Tenant ID: MUST be provided via URL param
# Example: http://localhost:8501/?tenant_id=abc-123
# ──────────────────────────────────────────────
query_params = st.query_params
tenant_id = query_params.get("tenant_id", None)

if not tenant_id:
    st.error("⚠️ Missing tenant ID. This chatbot requires a valid URL with a tenant_id parameter.")
    st.info("Please contact your administrator for the correct chatbot link.")
    st.stop()

# ──────────────────────────────────────────────
# Chat Interface
# ──────────────────────────────────────────────
st.title("💬 Chat Assistant")

# Language selector
LANGUAGES = {
    "🇬🇧 English": "en", "🇮🇳 Hindi": "hi", "🇪🇸 Spanish": "es",
    "🇫🇷 French": "fr", "🇩🇪 German": "de", "🇵🇹 Portuguese": "pt",
    "🇸🇦 Arabic": "ar", "🇨🇳 Chinese": "zh", "🇯🇵 Japanese": "ja",
    "🇰🇷 Korean": "ko", "🇷🇺 Russian": "ru", "🇮🇹 Italian": "it",
    "🇳🇱 Dutch": "nl", "🇹🇷 Turkish": "tr", "🇮🇳 Bengali": "bn",
    "🇮🇳 Tamil": "ta", "🇮🇳 Telugu": "te", "🇮🇳 Marathi": "mr",
    "🇮🇳 Gujarati": "gu", "🇮🇳 Kannada": "kn",
}
selected_lang = st.selectbox("🌐 Language", list(LANGUAGES.keys()), index=0, label_visibility="collapsed")
language_code = LANGUAGES[selected_lang]

st.markdown("---")

# Initialize session state
if "messages" not in st.session_state:
    st.session_state.messages = []
if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())

# Display chat history
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# User input
if prompt := st.chat_input("How can I help you?"):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    # Call FastAPI backend with tenant_id
    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            try:
                response = requests.post(
                    f"{BACKEND_URL}/chat",
                    json={
                        "question": prompt,
                        "session_id": st.session_state.session_id,
                        "tenant_id": tenant_id,
                        "page_url": "streamlit_client",
                        "language": language_code
                    }
                )
                if response.status_code == 200:
                    data = response.json()
                    answer = data["answer"]
                    st.markdown(answer)
                    st.session_state.messages.append({"role": "assistant", "content": answer})
                else:
                    st.error(f"Error: {response.status_code} — {response.text}")
            except Exception as e:
                st.error(f"Failed to connect to backend: {e}")
