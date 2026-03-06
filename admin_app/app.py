import streamlit as st
import requests
import pandas as pd
import plotly.express as px
import io

st.set_page_config(page_title="Seller Admin Panel", page_icon="⚙️", layout="wide")

# ──────────────────────────────────────────────
# Custom Styling
# ──────────────────────────────────────────────
st.markdown("""
<style>
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

st.title("⚙️ Seller Admin Panel")
st.caption("Developer dashboard — manage all clients and their chatbot configurations.")

# ──────────────────────────────────────────────
# Password Gate (Verified against backend)
# ──────────────────────────────────────────────
import os
BACKEND_URL = os.environ.get("BACKEND_URL", "https://chat-bot-1-neu.onrender.com")

if "seller_authenticated" not in st.session_state:
    st.session_state.seller_authenticated = False

if not st.session_state.seller_authenticated:
    auth_pass = st.sidebar.text_input("Enter Developer Password", type="password")
    if auth_pass:
        try:
            auth_res = requests.post(
                f"{BACKEND_URL}/admin/seller-auth",
                json={"password": auth_pass}
            )
            if auth_res.status_code == 200:
                st.session_state.seller_authenticated = True
                st.rerun()
            else:
                st.sidebar.error("❌ Incorrect password.")
        except Exception as e:
            st.sidebar.error(f"Backend not running: {e}")
    st.warning("Please enter the developer password to access this panel.")
    st.stop()

st.sidebar.success("✅ Logged In as Developer")



# ──────────────────────────────────────────────
# Tenant Selection
# ──────────────────────────────────────────────
st.sidebar.markdown("---")
st.sidebar.subheader("🏢 Select Client")

try:
    tenants_res = requests.get(f"{BACKEND_URL}/admin/tenants")
    if tenants_res.status_code == 200:
        tenants = tenants_res.json()
        if tenants:
            tenant_options = {t["name"]: t["id"] for t in tenants}
            selected_tenant_name = st.sidebar.selectbox("Client", list(tenant_options.keys()))
            tenant_id = tenant_options[selected_tenant_name]
            st.sidebar.info(f"Viewing: **{selected_tenant_name}**")
        else:
            st.sidebar.warning("No clients registered yet. Go to 'Manage Clients' tab.")
            selected_tenant_name = None
            tenant_id = None
    else:
        st.sidebar.error("Cannot connect to backend.")
        selected_tenant_name = None
        tenant_id = None
except Exception as e:
    st.sidebar.error(f"Backend not running: {e}")
    selected_tenant_name = None
    tenant_id = None

# ──────────────────────────────────────────────
# Dashboard Tabs (All tabs — Developer access)
# ──────────────────────────────────────────────
tab_clients, tab_identity, tab1, tab_leads, tab2, tab3 = st.tabs([
    "Manage Clients", "Business Identity",
    "Analytics", "Sales Leads", "Chat Logs", "FAQ Management"
])

# ──────────────────────────────────────────────
# Tab: Manage Clients
# ──────────────────────────────────────────────
with tab_clients:
    st.header("🏢 Manage Clients")
    st.info("Register new clients and assign them their own database.")

    with st.form("add_tenant_form"):
        st.subheader("Register New Client")
        t_name = st.text_input("Client Name (e.g., 'Hotel Sunrise')")
        t_db_url = st.text_input(
            "Database URL",
            placeholder="postgresql://user:pass@host/db_name",
            help="Each client needs their own PostgreSQL database. Create one on Neon/Supabase first."
        )
        t_password = st.text_input(
            "Client Admin Password",
            value="admin",
            help="Password for the client to access their admin panel."
        )
        register = st.form_submit_button("🚀 Register Client")

        if register:
            if t_name and t_db_url:
                res = requests.post(
                    f"{BACKEND_URL}/admin/tenant",
                    json={"name": t_name, "db_url": t_db_url, "admin_password": t_password}
                )
                if res.status_code == 200:
                    data = res.json()
                    st.success(f"✅ Client '{t_name}' registered successfully!")
                    st.code(f"Tenant ID: {data['id']}\nAPI Key:   {data['api_key']}", language="text")
                    st.info("Tables have been auto-created in the client's database. Refresh the page to select this client.")
                else:
                    st.error(f"Failed: {res.text}")
            else:
                st.warning("Please fill in both fields.")

    st.markdown("---")
    st.subheader("Registered Clients")

    try:
        res = requests.get(f"{BACKEND_URL}/admin/tenants")
        if res.status_code == 200:
            tenants_list = res.json()
            if tenants_list:
                for t in tenants_list:
                    with st.expander(f"{'🟢' if t['is_active'] else '🔴'} {t['name']}"):
                        st.write(f"**ID:** `{t['id']}`")
                        st.write(f"**API Key:** `{t['api_key']}`")
                        st.write(f"**Status:** {'Active' if t['is_active'] else 'Inactive'}")
                        st.write(f"**Created:** {t['created_at'][:16]}")

                        col_url, col_deact = st.columns(2)
                        with col_url:
                            st.code(f"Client Chatbot URL:\nhttp://127.0.0.1:8501/?tenant_id={t['id']}\n\nClient Admin URL:\nhttp://127.0.0.1:8502/?tenant_id={t['id']}", language="text")
                        with col_deact:
                            if t['is_active']:
                                if st.button(f"Deactivate {t['name']}", key=f"deact_{t['id']}"):
                                    requests.delete(f"{BACKEND_URL}/admin/tenant/{t['id']}")
                                    st.rerun()
            else:
                st.info("No clients registered yet.")
    except Exception as e:
        st.error(f"Error: {e}")

# ──────────────────────────────────────────────
# Tab: Business Identity
# ──────────────────────────────────────────────
with tab_identity:
    st.header("Customize Chatbot Identity")
    if not tenant_id:
        st.info("Select a client from the sidebar.")
    else:
        st.info(f"Configure the chatbot identity for **{selected_tenant_name}**.")
        try:
            res = requests.get(f"{BACKEND_URL}/admin/profile", params={"tenant_id": tenant_id})
            current_profile = res.json() if res.status_code == 200 else {
                "company_name": "", "industry": "", "business_description": ""
            }

            with st.form("profile_form"):
                name = st.text_input("Company Name", value=current_profile.get("company_name", ""))
                ind = st.text_input("Industry", value=current_profile.get("industry", ""))
                desc = st.text_area("Business Description", value=current_profile.get("business_description", ""))
                save = st.form_submit_button("Update Identity")

                if save:
                    update_res = requests.post(
                        f"{BACKEND_URL}/admin/profile",
                        json={"company_name": name, "industry": ind, "business_description": desc},
                        params={"tenant_id": tenant_id}
                    )
                    if update_res.status_code == 200:
                        st.success("Business Identity Updated!")
                    else:
                        st.error("Failed to update profile.")
        except Exception as e:
            st.error(f"Error: {e}")

# ──────────────────────────────────────────────
# Tab: Analytics
# ──────────────────────────────────────────────
with tab1:
    st.header("Analytics Overview")
    if not tenant_id:
        st.info("Select a client from the sidebar to view analytics.")
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
                    st.info("No chat logs found yet for this client.")
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
        st.info("Select a client from the sidebar.")
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
        st.info("Select a client from the sidebar.")
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
                            file_name="chat_logs.csv", mime="text/csv",
                            key="seller_csv"
                        )
                    with col_excel:
                        buffer = io.BytesIO()
                        df[['created_at', 'question', 'intent', 'page_url']].to_excel(buffer, index=False, engine='openpyxl')
                        st.download_button(
                            "📗 Download Excel", buffer.getvalue(),
                            file_name="chat_logs.xlsx", mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            key="seller_excel"
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
        st.info("Select a client from the sidebar.")
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
