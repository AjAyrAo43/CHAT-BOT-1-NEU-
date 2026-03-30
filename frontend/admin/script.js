const API_BASE = 'https://chat-bot-1-neu-1.onrender.com';

// Render Static Site URLs for the other two frontends.
// IMPORTANT: Replace these with your actual Render static site URLs after deployment.
const CLIENT_CHATBOT_URL = 'https://chat-bot-1-neu-1-rf14.onrender.com/';
const CLIENT_ADMIN_URL = 'https://chat-bot-1-neu.onrender.com/';

document.addEventListener('DOMContentLoaded', () => {
    // Views Elements
    const views = {
        login: document.getElementById('login-view'),
        dashboard: document.getElementById('dashboard-view')
    };

    // Auth & Navigation
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const logoutBtn = document.getElementById('logout-btn');
    const navBtns = document.querySelectorAll('.nav-btn[data-target]');
    const sections = document.querySelectorAll('.content-section');

    // Tenant Banner (replaces dropdown)
    const currentTenantInfo = document.getElementById('current-tenant-info');
    const currentClientBanner = document.getElementById('current-client-banner');

    // Clients View
    const createForm = document.getElementById('create-tenant-form');
    const createError = document.getElementById('create-error');
    const tenantsList = document.getElementById('tenants-list');
    const noTenants = document.getElementById('no-tenants');

    // Billing View
    const chargeClientForm = document.getElementById('charge-client-form');
    const chargeTenantId = document.getElementById('charge-tenant-id');
    const chargeError = document.getElementById('charge-error');
    const invoicesList = document.getElementById('invoices-list');
    // Tab: Identity
    const profileForm = document.getElementById('profile-form');
    const profileMsg = document.getElementById('profile-msg');

    // Tab: Leads & Chats & Analytics
    const leadsList = document.getElementById('leads-list');
    const chatsList = document.getElementById('chats-list');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnExportExcel = document.getElementById('btn-export-excel');

    // Tab: FAQs
    const addFaqForm = document.getElementById('add-faq-form');
    const faqsList = document.getElementById('faqs-list');

    // Tab: Plans
    const planForm = document.getElementById('plan-form');
    const plansList = document.getElementById('plans-list');
    const planError = document.getElementById('plan-error');
    const chargePlanSelect = document.getElementById('charge-plan');

    // State
    let isAuthenticated = sessionStorage.getItem('seller_auth') === 'true';
    let globalTenants = [];
    let globalPlans = [];
    let selectedTenantId = null;
    let globalChatsData = [];        // For current selected tenant
    let _chatsLoadedForTenant = null; // Cache: track which tenant's chats are loaded
    let _identityLoadedForTenant = null; // Cache: track which tenant's identity is loaded

    // Initialization
    if (isAuthenticated) {
        showView('dashboard');
        initDashboard();
    } else {
        showView('login');
    }

    // --- Authentication ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('seller-password').value;
        const btn = loginForm.querySelector('button');

        btn.disabled = true;
        loginError.textContent = '';

        try {
            const res = await fetch(`${API_BASE}/admin/seller-auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });

            if (res.ok) {
                sessionStorage.setItem('seller_auth', 'true');
                isAuthenticated = true;
                loginForm.reset();
                showView('dashboard');
                initDashboard();
            } else {
                const data = await res.json();
                loginError.textContent = data.detail || 'Invalid password';
            }
        } catch (err) {
            loginError.textContent = 'Connection error. Is backend running?';
        } finally {
            btn.disabled = false;
        }
    });

    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('seller_auth');
        isAuthenticated = false;
        showView('login');
    });

    // --- Navigation & Tenant Selection ---
    async function initDashboard() {
        await loadAllTenants();
        await loadPlans();
        // Load whatever tab is active
        const activeTabBtn = document.querySelector('.nav-btn.active');
        if(activeTabBtn) {
            handleTabSwitch(activeTabBtn.dataset.target);
        }
    }

    // --- Manage (select tenant from table row) ---
    window.manageTenant = (id) => {
        const t = globalTenants.find(x => x.id === id);
        if (!t) return;
        // Reset per-tenant caches when switching client
        if (selectedTenantId !== id) {
            _chatsLoadedForTenant = null;
            _identityLoadedForTenant = null;
            globalChatsData = [];
        }
        selectedTenantId = id;
        // Update sidebar banner
        currentTenantInfo.textContent = t.name;
        currentClientBanner.style.display = 'block';
        // Navigate to Business Identity tab
        navBtns.forEach(b => b.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));
        const identityBtn = document.querySelector('.nav-btn[data-target="tab-identity"]');
        if (identityBtn) identityBtn.classList.add('active');
        document.getElementById('tab-identity').classList.add('active');
        handleTabSwitch('tab-identity');
    };
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if(btn.id === 'logout-btn') return;

            navBtns.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');

            // Use in-memory globalTenants — do NOT re-fetch on every tab click
            if (btn.dataset.target === 'tab-clients') renderTenantsTable();
            if (btn.dataset.target === 'tab-billing') {
                updateChargeClientDropdown();
                updateChargePlanDropdown();
                loadInvoices();
            }
            if (btn.dataset.target === 'tab-plans') {
                renderPlansTable();
            }
            // handleTabSwitch handles all data loading for tenant-specific tabs
            handleTabSwitch(btn.dataset.target);
        });
    });

    function handleTabSwitch(tabId) {
        if (tabId === 'tab-clients') {
            renderTenantsTable();
            return;
        }
        if (tabId === 'tab-register') {
            return;
        }
        if (tabId === 'tab-billing' || tabId === 'tab-plans') {
            // Billing & Plans tabs handle their own data loading
            return;
        }

        // All other tabs require a specific tenant selected
        const requireEls = document.querySelectorAll(`[id$="-require-tenant"]`);
        const contentEls = document.querySelectorAll(`[id$="-content"]`);

        // Setup visibility based on selection
        const targetReqId = tabId.replace('tab-', '') + '-require-tenant';
        const targetContId = tabId.replace('tab-', '') + '-content';

        const reqEl = document.getElementById(targetReqId);
        const contEl = document.getElementById(targetContId);

        if (!selectedTenantId) {
            if(reqEl) reqEl.style.display = 'block';
            if(contEl) contEl.style.display = 'none';
            return;
        } else {
            if(reqEl) reqEl.style.display = 'none';
            if(contEl) contEl.style.display = 'block';
        }

        // Load specific tenant data
        if (tabId === 'tab-identity') loadIdentity();
        if (tabId === 'tab-analytics' || tabId === 'tab-leads' || tabId === 'tab-chats') {
            loadTenantChatsAndAnalytics();
        }
        if (tabId === 'tab-faq') loadFaqs();
    }


    // --- Global Tenants API ---
    async function loadAllTenants() {
        try {
            const res = await fetch(`${API_BASE}/admin/tenants`);
            if (res.ok) {
                globalTenants = await res.json();
                renderTenantsTable();
                updateChargeClientDropdown();
            }
        } catch (err) {
            console.error('Failed to load tenants:', err);
        }
    }

    function updateChargeClientDropdown() {
        if (!chargeTenantId) return;
        chargeTenantId.innerHTML = '<option value="" disabled selected>-- Select a Client --</option>';
        globalTenants.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.name} (ID: ${t.id.substring(0,8)})`;
            chargeTenantId.appendChild(opt);
        });
    }

    function renderTenantsTable() {
        tenantsList.innerHTML = '';
        if (globalTenants.length === 0) {
            document.getElementById('no-tenants').style.display = 'block';
            return;
        }
        document.getElementById('no-tenants').style.display = 'none';

        globalTenants.forEach(t => {
            const tr = document.createElement('tr');

            // Calculate days left
            let subText = "Expired";
            let subStyle = "color: var(--danger-color); font-weight: bold;";
            if (t.subscription_end_date) {
                const endDate = new Date(t.subscription_end_date);
                const now = new Date();
                if (endDate > now) {
                    const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
                    subText = `${daysLeft} days left`;
                    subStyle = daysLeft < 7 ? "color: orange; font-weight: bold;" : "color: var(--success-color);";
                }
            } else {
                subText = "Lifetime / Unknown";
                subStyle = "color: var(--text-muted);";
            }

            tr.innerHTML = `
                <td>
                    <span class="status-indicator ${t.is_active ? 'status-active-dot' : 'status-inactive-dot'}"></span>
                    <small>${t.is_active ? 'Active' : 'Inactive'}</small>
                </td>
                <td><strong>${escapeHTML(t.name)}</strong></td>
                <td>
                    <small>Username: <code style="background:#f0f4ff;padding:2px 6px;border-radius:4px;font-weight:bold;letter-spacing:0.5px">${escapeHTML(t.username || '—')}</code></small><br>
                    <small style="color:var(--text-muted)">ID: ${t.id.substring(0,8)}...</small>
                </td>
                <td>
                    <small style="${subStyle}">${subText}</small><br>
                    <small style="color:var(--text-muted); font-size:0.65rem;">Expires: ${t.subscription_end_date ? t.subscription_end_date.split('T')[0] : 'N/A'}</small>
                </td>
                <td><small>${t.created_at.substring(0, 16)}</small></td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        ${t.is_active ?
                            `<button class="btn danger-btn" style="padding:0.3rem 0.5rem; font-size:0.75rem;" onclick="deactivateTenant('${t.id}')">Deactivate</button>` :
                            `<button class="btn" style="padding:0.3rem 0.5rem; font-size:0.75rem; background-color:#ff4444; color:white;" onclick="deleteTenantHard('${t.id}')">Delete</button>`
                        }
                        <button class="btn primary-btn" style="padding:0.3rem 0.5rem; font-size:0.75rem;" onclick="extendSubscription('${t.id}')">+30 Days</button>
                    </div>
                    <div style="margin-top:5px; font-size:0.65rem; color: #555;">
                        <span style="display:block; margin-bottom: 2px;">Chatbot: <a href="${CLIENT_CHATBOT_URL}?tenant_id=${t.id}" target="_blank" style="color:#d35400;">Link</a></span>
                        <span>Client Admin: <a href="${CLIENT_ADMIN_URL}?username=${t.username || t.id}" target="_blank" style="color:#d35400;">Link</a></span>
                    </div>
                </td>
                <td>
                    <button class="btn primary-btn" style="padding:0.4rem 0.8rem; font-size:0.8rem; white-space:nowrap;" onclick="manageTenant('${t.id}')">
                        Manage &rarr;
                    </button>
                </td>
            `;
            tenantsList.appendChild(tr);
        });
    }

    window.extendSubscription = async (id) => {
        if (!confirm('Are you sure you want to grant +30 days to this client?')) return;
        try {
            const res = await fetch(`${API_BASE}/admin/tenant/${id}/extend-subscription`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days: 30 })
            });
            if (res.ok) {
                alert('Subscription extended successfully!');
                await loadAllTenants();
            } else {
                alert('Failed to extend subscription.');
            }
        } catch (err) {
            alert('Connection error');
        }
    };

    createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = createForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        createError.textContent = '';

        const payload = {
            name: document.getElementById('tenant-name').value,
            admin_password: document.getElementById('admin-password').value,
        };
        const logoB64 = document.getElementById('reg-profile-logo-b64').value;
        if (logoB64) payload.logo_b64 = logoB64;
        const dbUrl = document.getElementById('db-url').value;
        if (dbUrl) payload.db_url = dbUrl;
        else payload.db_url = `sqlite:///tenants/${payload.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.db`;

        try {
            const res = await fetch(`${API_BASE}/admin/tenant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                const data = await res.json();
                createForm.reset();
                alert(` Client '${data.name}' registered!\nUsername: ${data.username}\nAPI Key: ${data.api_key}\n\nShare the login username (above) with your client. Do NOT share the API key.`);
                await loadAllTenants();
            } else {
                const err = await res.json();
                createError.textContent = err.detail || 'Registration failed';
            }
        } catch (err) {
            createError.textContent = 'Connection error';
        } finally {
            submitBtn.disabled = false;
        }
    });

    window.deactivateTenant = async (id) => {
        if (!confirm('Are you sure you want to deactivate this client?')) return;
        try {
            const res = await fetch(`${API_BASE}/admin/tenant/${id}`, { method: 'DELETE' });
            if (res.ok) await loadAllTenants();
            else alert('Failed to deactivate tenant');
        } catch (err) { alert('Connection error'); }
    };

    window.deleteTenantHard = async (id) => {
        const confirmMsg = "WARNING: This action is irreversible. All client configuration, chatbots, and historical data will be permanently deleted. Are you absolutely sure?";
        if (!confirm(confirmMsg)) return;
        try {
            const res = await fetch(`${API_BASE}/admin/tenant/${id}/hard-delete`, { method: 'DELETE' });
            if (res.ok) {
                alert('Client successfully deleted.');
                await loadAllTenants();
            } else {
                const data = await res.json();
                alert(`Failed to delete tenant: ${data.detail || 'Unknown error'}`);
            }
        } catch (err) { alert('Connection error'); }
    };

    // --- Identity ---
    async function loadIdentity() {
        if (!selectedTenantId) return;
        try {
            const res = await fetch(`${API_BASE}/admin/profile?tenant_id=${selectedTenantId}`);
            if (res.ok) {
                const p = await res.json();
                document.getElementById('profile-name').value = p.company_name;
                document.getElementById('profile-ind').value = p.industry;
                document.getElementById('profile-desc').value = p.business_description;
                document.getElementById('profile-hours').value = p.business_hours || '';

                document.getElementById('profile-contact-name').value = p.contact_person_name || '';
                document.getElementById('profile-contact-role').value = p.contact_person_role || '';
                document.getElementById('profile-contact-email').value = p.contact_person_email || '';
                document.getElementById('profile-contact-phone').value = p.contact_person_phone || '';

                document.getElementById('profile-address-street').value = p.address_street || '';
                document.getElementById('profile-city').value = p.city || '';
                document.getElementById('profile-state').value = p.state || '';
                document.getElementById('profile-country').value = p.country || '';
                document.getElementById('profile-zip').value = p.zip_code || '';
                document.getElementById('profile-timezone').value = p.timezone || '';

                document.getElementById('profile-brand-primary').value = p.brand_color_primary || '';
                document.getElementById('profile-brand-secondary').value = p.brand_color_secondary || '';
                document.getElementById('profile-social-li').value = p.social_linkedin || '';
                document.getElementById('profile-social-tw').value = p.social_twitter || '';
                document.getElementById('profile-social-ig').value = p.social_instagram || '';
                
                const logoB64 = document.getElementById('profile-logo-b64');
                const logoPreview = document.getElementById('logo-preview');
                const logoPlaceholder = document.getElementById('logo-placeholder');
                const clearLogoBtn = document.getElementById('clear-logo-btn');
                const fileInput = document.getElementById('profile-logo');
                
                logoB64.value = p.logo_url || '';
                fileInput.value = ''; // clear any selected file
                if (p.logo_url) {
                    logoPreview.src = p.logo_url;
                    logoPreview.style.display = 'block';
                    logoPlaceholder.style.display = 'none';
                    clearLogoBtn.style.display = 'block';
                } else {
                    logoPreview.src = '';
                    logoPreview.style.display = 'none';
                    logoPlaceholder.style.display = 'block';
                    clearLogoBtn.style.display = 'none';
                }
            }
        } catch(e) { console.error('Failed to load profile'); }
    }

    // Handle Image Upload & Resize
    const logoInput = document.getElementById('profile-logo');
    const logoB64Input = document.getElementById('profile-logo-b64');
    const logoPreview = document.getElementById('logo-preview');
    const logoPlaceholder = document.getElementById('logo-placeholder');
    const clearLogoBtn = document.getElementById('clear-logo-btn');

    logoInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                // Resize if needed
                const MAX_SIZE = 200;
                let width = img.width;
                let height = img.height;

                if (width > MAX_SIZE || height > MAX_SIZE) {
                    if (width > height) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    } else {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Compress heavily to avoid DB bloat (webp or jpeg preferred)
                let mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                const dataUrl = canvas.toDataURL(mimeType, 0.7);
                
                logoB64Input.value = dataUrl;
                logoPreview.src = dataUrl;
                logoPreview.style.display = 'block';
                logoPlaceholder.style.display = 'none';
                clearLogoBtn.style.display = 'block';
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    clearLogoBtn.addEventListener('click', () => {
        logoInput.value = '';
        logoB64Input.value = '';
        logoPreview.src = '';
        logoPreview.style.display = 'none';
        logoPlaceholder.style.display = 'block';
        clearLogoBtn.style.display = 'none';
    });

    // --- Registration Form Logo Handler (for new client registration) ---
    const regLogoInput = document.getElementById('reg-profile-logo');
    const regLogoB64Input = document.getElementById('reg-profile-logo-b64');
    const regLogoPreview = document.getElementById('reg-logo-preview');
    const regLogoPlaceholder = document.getElementById('reg-logo-placeholder');
    const regClearLogoBtn = document.getElementById('reg-clear-logo-btn');

    if (regLogoInput) {
        regLogoInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(event) {
                const img = new Image();
                img.onload = function() {
                    const MAX_SIZE = 200;
                    let width = img.width, height = img.height;
                    if (width > MAX_SIZE || height > MAX_SIZE) {
                        if (width > height) { height *= MAX_SIZE / width; width = MAX_SIZE; }
                        else { width *= MAX_SIZE / height; height = MAX_SIZE; }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width; canvas.height = height;
                    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.7);
                    regLogoB64Input.value = dataUrl;
                    regLogoPreview.src = dataUrl;
                    regLogoPreview.style.display = 'block';
                    regLogoPlaceholder.style.display = 'none';
                    regClearLogoBtn.style.display = 'inline-block';
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
        regClearLogoBtn.addEventListener('click', () => {
            regLogoInput.value = '';
            regLogoB64Input.value = '';
            regLogoPreview.src = '';
            regLogoPreview.style.display = 'none';
            regLogoPlaceholder.style.display = 'inline';
            regClearLogoBtn.style.display = 'none';
        });
    }

    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        profileMsg.textContent = 'Saving...';
        try {
            const res = await fetch(`${API_BASE}/admin/profile?tenant_id=${selectedTenantId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    company_name: document.getElementById('profile-name').value,
                    industry: document.getElementById('profile-ind').value,
                    business_description: document.getElementById('profile-desc').value,
                    business_hours: document.getElementById('profile-hours').value,

                    contact_person_name: document.getElementById('profile-contact-name').value,
                    contact_person_role: document.getElementById('profile-contact-role').value,
                    contact_person_email: document.getElementById('profile-contact-email').value,
                    contact_person_phone: document.getElementById('profile-contact-phone').value,

                    address_street: document.getElementById('profile-address-street').value,
                    city: document.getElementById('profile-city').value,
                    state: document.getElementById('profile-state').value,
                    country: document.getElementById('profile-country').value,
                    zip_code: document.getElementById('profile-zip').value,
                    timezone: document.getElementById('profile-timezone').value,

                    brand_color_primary: document.getElementById('profile-brand-primary').value,
                    brand_color_secondary: document.getElementById('profile-brand-secondary').value,
                    social_linkedin: document.getElementById('profile-social-li').value,
                    social_twitter: document.getElementById('profile-social-tw').value,
                    social_instagram: document.getElementById('profile-social-ig').value,
                    logo_url: document.getElementById('profile-logo-b64').value
                })
            });
            if (res.ok) showMessage(profileMsg, 'Identity Updated!', 'success');
            else showMessage(profileMsg, 'Failed to update.', 'error');
        } catch (err) { showMessage(profileMsg, 'Connection error', 'error'); }
    });


    // --- Analytics, Leads, Chats ---
    async function loadTenantChatsAndAnalytics() {
        if (!selectedTenantId) return;
        // Use cached data if available for this tenant
        if (_chatsLoadedForTenant === selectedTenantId && globalChatsData.length >= 0) {
            renderAnalytics(globalChatsData);
            renderLeads(globalChatsData);
            const displayChats = [...globalChatsData].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
            renderChats(displayChats);
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/admin/chats?tenant_id=${selectedTenantId}`);
            if (res.ok) {
                globalChatsData = await res.json();
                globalChatsData.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
                _chatsLoadedForTenant = selectedTenantId; // mark cached

                renderAnalytics(globalChatsData);
                renderLeads(globalChatsData);

                const displayChats = [...globalChatsData].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
                renderChats(displayChats);
            }
        } catch(e) { console.error('Error fetching chats:', e); }
    }

    async function renderAnalytics(data) {
        if (data.length === 0) {
            document.getElementById('metric-total-queries').textContent = '0';
            document.getElementById('metric-intents').textContent = '0';
            document.getElementById('metric-recent').textContent = 'N/A';
            document.getElementById('intent-chart-container').innerHTML = '';
            document.getElementById('intent-chart-labels').innerHTML = '';
            document.getElementById('quota-text').textContent = "0 messages used this month";
            return;
        }

        document.getElementById('metric-total-queries').textContent = data.length;

        const counts = {};
        data.forEach(d => { counts[d.intent] = (counts[d.intent] || 0) + 1; });

        document.getElementById('metric-intents').textContent = Object.keys(counts).length;
        document.getElementById('metric-recent').textContent = new Date(data[data.length-1].created_at).toLocaleDateString();

        const container = document.getElementById('intent-chart-container');
        const labelsContainer = document.getElementById('intent-chart-labels');
        container.innerHTML = '';
        labelsContainer.innerHTML = '';
        const maxCount = Math.max(...Object.values(counts));

        Object.entries(counts).forEach(([intent, count]) => {
            const heightPercent = (count / maxCount) * 100;
            const col = document.createElement('div');
            col.className = 'bar-col'; col.style.height = `${heightPercent}%`; col.title = `${intent}: ${count}`; col.textContent = count;
            const label = document.createElement('div');
            label.textContent = intent; label.style.width = `${100 / Object.keys(counts).length}%`; label.style.textAlign = 'center'; label.style.textTransform = 'capitalize';
            container.appendChild(col); labelsContainer.appendChild(label);
        });

        // Calculate Monthly Quota
        try {
            const res = await fetch(`${API_BASE}/admin/tenant-info?tenant_id=${selectedTenantId}`);
            if (res.ok) {
                const info = await res.json();
                const limit = info.limits.messages_per_month;

                // Count this month's messages
                const now = new Date();
                const currentMonthString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                let monthlyUsed = 0;
                data.forEach(d => {
                    if (d.created_at.startsWith(currentMonthString)) {
                        monthlyUsed++;
                    }
                });

                document.getElementById('quota-plan-badge').textContent = info.current_plan;
                const progressEl = document.getElementById('quota-progress-bar');
                const textEl = document.getElementById('quota-text');

                if (limit >= 999999) {
                    textEl.textContent = `${monthlyUsed} Messages (Enterprise Unlimited)`;
                    progressEl.style.width = '100%';
                    progressEl.style.background = '#107c41'; // Green for unlimited
                } else {
                    textEl.textContent = `${monthlyUsed} / ${limit} Messages Used`;
                    let pct = Math.min((monthlyUsed / limit) * 100, 100);
                    progressEl.style.width = `${pct}%`;
                    if (pct > 90) progressEl.style.background = 'var(--danger-color)';
                    else if (pct > 75) progressEl.style.background = 'orange';
                    else progressEl.style.background = 'var(--primary-color)';
                }
            }
        } catch(e) { console.error('Error fetching quota limits', e); }
    }

    function renderLeads(data) {
        leadsList.innerHTML = '';
        const leadsFiles = data.filter(d => d.intent === 'contact');
        if (leadsFiles.length === 0) { document.getElementById('no-leads').style.display = 'block'; return; }
        document.getElementById('no-leads').style.display = 'none';

        const leadsDataDisplay = [];
        leadsFiles.forEach(lead => {
            const sessionMsgs = data.filter(d => d.session_id === lead.session_id);
            const prevMsgs = sessionMsgs.filter(d => new Date(d.created_at) < new Date(lead.created_at));
            let inquiry = "Unknown inquiry";
            if (prevMsgs.length > 0) inquiry = prevMsgs[prevMsgs.length - 1].question;
            leadsDataDisplay.push({
                date: lead.created_at.substring(0, 16).replace('T', ' '),
                contactInfo: lead.question,
                inquiry: inquiry,
                sessionId: lead.session_id.substring(0, 8) + '...'
            });
        });

        leadsDataDisplay.reverse().forEach(ld => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="white-space:nowrap"><small>${ld.date}</small></td>
                <td><strong>${escapeHTML(ld.contactInfo)}</strong></td>
                <td>${escapeHTML(ld.inquiry)}</td>
                <td><small style="color:var(--text-muted)">${escapeHTML(ld.sessionId)}</small></td>
            `;
            leadsList.appendChild(tr);
        });
    }

    function renderChats(chats) {
        chatsList.innerHTML = '';
        if (chats.length === 0) {
            document.getElementById('no-chats').style.display = 'block';
            btnExportCsv.disabled = true; btnExportExcel.disabled = true;
            return;
        }
        document.getElementById('no-chats').style.display = 'none';
        btnExportCsv.disabled = false; btnExportExcel.disabled = false;

        chats.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="white-space:nowrap"><small>${c.created_at.substring(0, 16).replace('T', ' ')}</small></td>
                <td><small style="color:var(--text-muted)">${escapeHTML(c.session_id.substring(0, 8))}...</small></td>
                <td>${escapeHTML(c.question)}</td>
                <td><code style="background:#f5f5f5;padding:2px 4px;">${escapeHTML(c.intent)}</code></td>
                <td><a href="${escapeHTML(c.page_url)}" target="_blank" style="color:#0066cc;text-decoration:none;">Link</a></td>
            `;
            chatsList.appendChild(tr);
        });
    }

    btnExportCsv.addEventListener('click', () => {
        if (!globalChatsData || globalChatsData.length === 0) return;
        let csvContent = "data:text/csv;charset=utf-8,created_at,question,intent,page_url\n";
        globalChatsData.forEach(r => {
            csvContent += `${r.created_at},"${r.question.replace(/"/g, '""')}",${r.intent},${r.page_url}\r\n`;
        });
        const link = document.createElement("a");
        link.href = encodeURI(csvContent); link.download = "chat_logs.csv";
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    });

    btnExportExcel.addEventListener('click', () => {
        if (!globalChatsData || globalChatsData.length === 0 || typeof XLSX === 'undefined') return;
        const exportData = globalChatsData.map(c => ({ created_at: c.created_at, question: c.question, intent: c.intent, page_url: c.page_url }));
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "ChatLogs");
        XLSX.writeFile(workbook, "chat_logs.xlsx");
    });


    // --- Billing & Invoices ---
    chargeClientForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = chargeClientForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        chargeError.textContent = '';

        const payload = {
            tenant_id: chargeTenantId.value,
            plan_name: document.getElementById('charge-plan').value,
            amount_inr: parseFloat(document.getElementById('charge-amount').value)
        };

        try {
            const res = await fetch(`${API_BASE}/admin/charge-client`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                alert('Payment recorded and subscription extended successfully!');
                chargeClientForm.reset();
                loadAllTenants();
                loadInvoices();
            } else {
                const data = await res.json();
                chargeError.textContent = data.detail || 'Failed to charge client.';
            }
        } catch (err) {
            chargeError.textContent = 'Connection error.';
        } finally {
            btn.disabled = false;
        }
    });

    async function loadInvoices() {
        try {
            const res = await fetch(`${API_BASE}/admin/invoices`);
            if(res.ok) {
                const invoices = await res.json();
                renderInvoices(invoices);
            }
        } catch(err) {
            console.error('Failed to load invoices', err);
        }
    }

    function renderInvoices(invoices) {
        invoicesList.innerHTML = '';
        if (invoices.length === 0) {
            invoicesList.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;">No payment records found.</td></tr>';
            return;
        }

        invoices.reverse().forEach(inv => {
            const tr = document.createElement('tr');

            const t = globalTenants.find(x => x.id === inv.tenant_id);
            const tName = t ? t.name : 'Unknown';

            tr.innerHTML = `
                <td><small><code>${inv.id.substring(0,8)}...</code></small></td>
                <td><strong>${escapeHTML(tName)}</strong><br><small style="color:#666">${inv.tenant_id}</small></td>
                <td><span class="tenant-badge">${escapeHTML(inv.plan_name)}</span></td>
                <td><strong>₹${(inv.amount_inr || inv.amount_usd || 0).toFixed(2)}</strong></td>
                <td><span style="color:var(--success-color); font-weight:bold;">${inv.status}</span></td>
                <td><small>${inv.payment_date.split('.')[0].replace('T', ' ')}</small></td>
            `;
            invoicesList.appendChild(tr);
        });
    }

    // --- Manage Plans ---
    async function loadPlans() {
        try {
            const res = await fetch(`${API_BASE}/admin/plans`);
            if (res.ok) {
                globalPlans = await res.json();
                if (document.getElementById('tab-plans').classList.contains('active')) {
                    renderPlansTable();
                }
                updateChargePlanDropdown();
            }
        } catch (err) { console.error('Failed to load plans', err); }
    }

    function renderPlansTable() {
        plansList.innerHTML = '';
        if (globalPlans.length === 0) {
            plansList.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2rem;">No plans found.</td></tr>';
            return;
        }

        globalPlans.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHTML(p.name)}</strong></td>
                <td>₹${p.price_inr.toFixed(2)}</td>
                <td>${p.messages_per_month}</td>
                <td>${p.docs_limit}</td>
                <td>${p.faqs_limit}</td>
                <td>${p.export_enabled ? 'Yes' : 'No'}</td>
                <td>${escapeHTML(p.languages)}</td>
                <td>
                    <button class="btn outline-btn" onclick="editPlan('${p.id}')" style="padding:0.2rem 0.6rem;font-size:0.75rem;">Edit</button>
                    <button class="btn danger-btn" onclick="deletePlan('${p.id}')" style="padding:0.2rem 0.6rem;font-size:0.75rem; margin-left:5px;">Delete</button>
                </td>
            `;
            plansList.appendChild(tr);
        });
    }

    function updateChargePlanDropdown() {
        if (!chargePlanSelect) return;
        chargePlanSelect.innerHTML = '<option value="" disabled selected>-- Select a Plan --</option>';
        globalPlans.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = `${p.name} (₹${p.price_inr}/mo)`;
            chargePlanSelect.appendChild(opt);
        });
    }

    window.editPlan = (id) => {
        const p = globalPlans.find(x => x.id === id);
        if(!p) return;
        document.getElementById('plan-id').value = p.id;
        document.getElementById('plan-name').value = p.name;
        document.getElementById('plan-price').value = p.price_inr;
        document.getElementById('plan-messages').value = p.messages_per_month;
        document.getElementById('plan-docs').value = p.docs_limit;
        document.getElementById('plan-faqs').value = p.faqs_limit;
        document.getElementById('plan-export').checked = p.export_enabled;
        document.getElementById('plan-languages').value = p.languages;
        
        document.getElementById('plan-form-title').textContent = 'Edit Plan';
        document.getElementById('plan-submit-btn').textContent = 'Update Plan';
        document.getElementById('plan-cancel-btn').style.display = 'inline-block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    if (document.getElementById('plan-cancel-btn')) {
        document.getElementById('plan-cancel-btn').addEventListener('click', () => {
            if(planForm) planForm.reset();
            document.getElementById('plan-id').value = '';
            document.getElementById('plan-form-title').textContent = 'Create New Plan';
            document.getElementById('plan-submit-btn').textContent = 'Save Plan';
            document.getElementById('plan-cancel-btn').style.display = 'none';
            if(planError) planError.textContent = '';
        });
    }

    if (planForm) {
        planForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            planError.textContent = '';
            
            const payload = {
                name: document.getElementById('plan-name').value,
                price_inr: parseFloat(document.getElementById('plan-price').value),
                messages_per_month: parseInt(document.getElementById('plan-messages').value),
                docs_limit: parseInt(document.getElementById('plan-docs').value),
                faqs_limit: parseInt(document.getElementById('plan-faqs').value),
                export_enabled: document.getElementById('plan-export').checked,
                languages: document.getElementById('plan-languages').value
            };

            const id = document.getElementById('plan-id').value;
            const method = id ? 'PUT' : 'POST';
            const url = id ? `${API_BASE}/admin/plans/${id}` : `${API_BASE}/admin/plans`;

            const btn = document.getElementById('plan-submit-btn');
            btn.disabled = true;

            try {
                const res = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if(res.ok) {
                    alert(id ? 'Plan updated successfully' : 'Plan created successfully');
                    document.getElementById('plan-cancel-btn').click(); // reset form
                    await loadPlans();
                } else {
                    const data = await res.json();
                    planError.textContent = data.detail || 'Failed to save plan';
                }
            } catch(err) { planError.textContent = 'Connection error'; }
            finally { btn.disabled = false; }
        });
    }

    window.deletePlan = async (id) => {
        if(!confirm('Are you sure you want to delete this plan?')) return;
        try {
            const res = await fetch(`${API_BASE}/admin/plans/${id}`, { method: 'DELETE' });
            if(res.ok) {
                alert('Plan deleted.');
                await loadPlans();
            } else {
                const data = await res.json();
                alert(data.detail || 'Failed to delete plan');
            }
        } catch(err) { alert('Connection error'); }
    };

    // --- FAQs ---
    async function loadFaqs() {
        if (!selectedTenantId) return;
        try {
            const res = await fetch(`${API_BASE}/admin/faqs?tenant_id=${selectedTenantId}`);
            if (res.ok) {
                const faqs = await res.json();
                faqsList.innerHTML = '';
                if (faqs.length === 0) { document.getElementById('no-faqs').style.display = 'block'; return; }
                document.getElementById('no-faqs').style.display = 'none';

                faqs.forEach(f => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${escapeHTML(f.question)}</strong></td>
                        <td><small>${escapeHTML(f.answer.substring(0, 80))}...</small></td>
                        <td><code style="background:#f5f5f5;padding:2px 4px;">${escapeHTML(f.intent).toUpperCase()}</code></td>
                        <td>${f.is_active ? `<button class="btn danger-btn" onclick="deactivateFaq('${f.id}')" style="padding:0.2rem 0.6rem;font-size:0.75rem;">Deactivate</button>` : 'Inactive'}</td>
                    `;
                    faqsList.appendChild(tr);
                });
            }
        } catch (err) { console.error(err); }
    }

    addFaqForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const res = await fetch(`${API_BASE}/admin/faq?tenant_id=${selectedTenantId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: document.getElementById('faq-q').value,
                    answer: document.getElementById('faq-a').value,
                    intent: document.getElementById('faq-i').value
                })
            });
            if (res.ok) {
                alert("FAQ Added Successfully!");
                addFaqForm.reset();
                loadFaqs();
            } else alert('Failed to add FAQ');
        } catch(e) { alert('Connection Error'); }
    });

    window.deactivateFaq = async (id) => {
        try {
            const res = await fetch(`${API_BASE}/admin/faq/${id}?tenant_id=${selectedTenantId}`, { method: 'DELETE' });
            if(res.ok) loadFaqs();
        } catch(e) {}
    };


    // --- Utils ---
    function showView(viewName) {
        Object.values(views).forEach(v => v.classList.remove('active'));
        if (views[viewName]) views[viewName].classList.add('active');
    }

    function showMessage(el, text, type) {
        el.textContent = text;
        el.className = 'msg-text' + (type === 'success' ? ' msg-success' : (type==='error'?' error-text':''));
        if (type !== '') setTimeout(() => { el.textContent = ''; el.className = 'msg-text'; }, 3000);
    }
    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
    }
});
