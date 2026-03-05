import streamlit as st
import requests
import pandas as pd
import plotly.express as px
import io

st.set_page_config(page_title="Client Admin Panel", page_icon="📊", layout="wide")

# ──────────────────────────────────────────────
# Custom Styling
# ──────────────────────────────────────────────
st.markdown("""
<style>
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

st.title("📊 Client Admin Panel")

BACKEND_URL = "http://127.0.0.1:8000"

# ──────────────────────────────────────────────
# Tenant ID: MUST come from URL param
# Example: http://localhost:8502/?tenant_id=abc-123
# ──────────────────────────────────────────────
query_params = st.query_params
tenant_id = query_params.get("tenant_id", None)

if not tenant_id:
    st.error("⚠️ Missing tenant ID. Please use the admin panel link provided by the developer.")
    st.info("Your link should look like: `http://.../?tenant_id=your-id`")
    st.stop()

# ──────────────────────────────────────────────
# Password Gate (Verified against backend)
# ──────────────────────────────────────────────
if "client_authenticated" not in st.session_state:
    st.session_state.client_authenticated = False

if not st.session_state.client_authenticated:
    auth_pass = st.sidebar.text_input("Enter Admin Password", type="password")
    if auth_pass:
        try:
            auth_res = requests.post(
                f"{BACKEND_URL}/admin/auth",
                json={"tenant_id": tenant_id, "password": auth_pass}
            )
            if auth_res.status_code == 200:
                st.session_state.client_authenticated = True
                st.rerun()
            else:
                st.sidebar.error("❌ Incorrect password.")
        except Exception as e:
            st.sidebar.error(f"Backend not running: {e}")
    st.warning("Please enter the correct password to access the dashboard.")
    st.stop()

st.sidebar.success("✅ Logged In as Client Admin")

# Change Password section
st.sidebar.markdown("---")
with st.sidebar.expander("🔑 Change Password"):
    old_pw = st.text_input("Current Password", type="password", key="old_pw")
    new_pw = st.text_input("New Password", type="password", key="new_pw")
    confirm_pw = st.text_input("Confirm New Password", type="password", key="confirm_pw")
    if st.button("Update Password"):
        if not old_pw or not new_pw:
            st.error("Please fill all fields.")
        elif new_pw != confirm_pw:
            st.error("New passwords don't match.")
        elif len(new_pw) < 4:
            st.error("Password must be at least 4 characters.")
        else:
            try:
                res = requests.post(
                    f"{BACKEND_URL}/admin/change-password",
                    json={"tenant_id": tenant_id, "old_password": old_pw, "new_password": new_pw}
                )
                if res.status_code == 200:
                    st.success("✅ Password changed! Use new password next time.")
                else:
                    st.error(f"❌ {res.json().get('detail', 'Failed')}")
            except Exception as e:
                st.error(f"Error: {e}")

# ──────────────────────────────────────────────
# Dashboard Tabs (Client-facing only)
# ──────────────────────────────────────────────
tab1, tab_leads, tab2, tab3 = st.tabs(["Analytics", "Sales Leads", "Chat Logs", "FAQ Management"])

# ──────────────────────────────────────────────
# Tab 1: Analytics
# ──────────────────────────────────────────────
with tab1:
    st.header("Analytics Overview")
    if not tenant_id:
        st.info("Select a business from the sidebar to view analytics.")
    else:
        try:
            response = requests.get(f"{BACKEND_URL}/admin/chats", params={"tenant_id": tenant_id})
            if response.status_code == 200:
                df = pd.DataFrame(response.json())
                if not df.empty:
                    col1, col2, col3 = st.columns(3)
                    col1.metric("Total Queries", len(df))
                    col2.metric("Intents Detected", df['intent'].nunique())
                    col3.metric("Recent Query", df['created_at'].iloc[-1][:10] if not df.empty else "N/A")

                    st.subheader("Intent Distribution")
                    fig = px.pie(df, names="intent", hole=0.3)
                    st.plotly_chart(fig, width="stretch")
                else:
                    st.info("No chat logs found yet.")
            else:
                st.error("Failed to fetch logs.")
        except Exception as e:
            st.error(f"Connection Error: {e}")

# ──────────────────────────────────────────────
# Tab: Sales Leads
# ──────────────────────────────────────────────
with tab_leads:
    st.header("🎯 Sales Leads Dashboard")
    st.info("These users provided their contact details for follow-up.")
    if not tenant_id:
        st.info("Select a business from the sidebar.")
    else:
        try:
            response = requests.get(f"{BACKEND_URL}/admin/chats", params={"tenant_id": tenant_id})
            if response.status_code == 200:
                df = pd.DataFrame(response.json())
                if not df.empty:
                    leads_df = df[df['intent'] == 'contact'].copy()
                    if not leads_df.empty:
                        leads_data = []
                        for idx, lead in leads_df.iterrows():
                            session_id = lead['session_id']
                            session_msgs = df[df['session_id'] == session_id].sort_values('created_at')
                            inquiry = "Unknown inquiry"
                            prev_msgs = session_msgs[session_msgs['created_at'] < lead['created_at']]
                            if not prev_msgs.empty:
                                inquiry = prev_msgs.iloc[-1]['question']
                            leads_data.append({
                                "Date": lead['created_at'][:16],
                                "Contact Info (Decrypted)": lead['question'],
                                "Original Inquiry": inquiry,
                                "Session ID": session_id[:8] + "..."
                            })
                        st.table(pd.DataFrame(leads_data))
                    else:
                        st.info("No sales leads captured yet.")
                else:
                    st.info("No chat logs found.")
        except Exception as e:
            st.error(f"Error loading leads: {e}")

# ──────────────────────────────────────────────
# Tab: Chat Logs
# ──────────────────────────────────────────────
with tab2:
    st.header("Decrypted Chat History")
    if not tenant_id:
        st.info("Select a business from the sidebar.")
    else:
        try:
            response = requests.get(f"{BACKEND_URL}/admin/chats", params={"tenant_id": tenant_id})
            if response.status_code == 200:
                df = pd.DataFrame(response.json())
                if not df.empty:
                    st.dataframe(df[['created_at', 'question', 'intent', 'page_url']], width="stretch")

                    # Export buttons
                    st.markdown("---")
                    col_csv, col_excel = st.columns(2)
                    with col_csv:
                        csv_data = df[['created_at', 'question', 'intent', 'page_url']].to_csv(index=False)
                        st.download_button(
                            "📄 Download CSV", csv_data,
                            file_name="chat_logs.csv", mime="text/csv"
                        )
                    with col_excel:
                        buffer = io.BytesIO()
                        df[['created_at', 'question', 'intent', 'page_url']].to_excel(buffer, index=False, engine='openpyxl')
                        st.download_button(
                            "📗 Download Excel", buffer.getvalue(),
                            file_name="chat_logs.xlsx", mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        )
                else:
                    st.info("No logs found.")
        except Exception as e:
            st.error(f"Error: {e}")

# ──────────────────────────────────────────────
# Tab: FAQ Management
# ──────────────────────────────────────────────
with tab3:
    st.header("Manage FAQs")
    if not tenant_id:
        st.info("Select a business from the sidebar.")
    else:
        with st.form("add_faq_form"):
            st.subheader("Add New FAQ")
            q = st.text_input("Question")
            a = st.text_area("Answer")
            intent = st.selectbox("Intent Category", ["pricing", "service_inquiry", "support", "contact", "information", "eligibility"])
            submit = st.form_submit_button("Add FAQ")

            if submit:
                if q and a:
                    res = requests.post(
                        f"{BACKEND_URL}/admin/faq",
                        json={"question": q, "answer": a, "intent": intent},
                        params={"tenant_id": tenant_id}
                    )
                    if res.status_code == 200:
                        st.success("FAQ Added Successfully!")
                    else:
                        st.error(f"Failed to add FAQ: {res.text}")
                else:
                    st.warning("Please fill all fields.")

        st.markdown("---")
        st.subheader("Existing FAQs")
        try:
            res = requests.get(f"{BACKEND_URL}/admin/faqs", params={"tenant_id": tenant_id})
            if res.status_code == 200:
                faqs = res.json()
                for f in faqs:
                    with st.expander(f"{f['intent'].upper()}: {f['question']}"):
                        st.write(f['answer'])
                        if st.button(f"Deactivate {f['id'][:8]}", key=f['id']):
                            requests.delete(
                                f"{BACKEND_URL}/admin/faq/{f['id']}",
                                params={"tenant_id": tenant_id}
                            )
                            st.rerun()
        except Exception as e:
            st.error(f"Error: {e}")
