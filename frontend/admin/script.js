const API_BASE = 'https://chat-bot-1-neu-1.onrender.com';

// Render Static Site URLs for the other two frontends.
// IMPORTANT: Replace these with your actual Render static site URLs after deployment.
const CLIENT_CHATBOT_URL = 'https://chat-bot-1-neu-1-rf14.onrender.com/';
const CLIENT_ADMIN_URL = 'https://chat-bot-1-neu.onrender.com/';

// Global Fetch Interceptor to attach X-Auth-Token automatically
const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if (resource && typeof resource === 'string' && resource.includes('/admin/')) {
        config = config || {};
        config.headers = config.headers || {};
        const token = sessionStorage.getItem('seller_token');
        if (token && !resource.includes('/admin/auth') && !resource.includes('/admin/seller-auth')) {
            config.headers['X-Auth-Token'] = token;
        }
    }
    return originalFetch(resource, config);
};

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

    // Tab: Plans
    const planForm = document.getElementById('plan-form');
    const plansList = document.getElementById('plans-list');
    const planError = document.getElementById('plan-error');
    const chargePlanSelect = document.getElementById('charge-plan');

    let isAuthenticated = sessionStorage.getItem('seller_auth') === 'true';
    let globalTenants = [];
    let globalPlans = [];
    let selectedTenantId = null;
    let globalChatsData = [];        // For current selected tenant
    let globalLeadsDataAdmin = [];   // Leads for current selected tenant
    let _chatsLoadedForTenant = null;
    let _identityLoadedForTenant = null;
    let _adminChartInstances = {};   // Chart.js instances
    let _adminDateFilter = 30;        // Default: last 30 days

    // Pagination & Sorting State
    let currentPage = 1;
    let itemsPerPage = 10;
    let currentSortColumn = 'created_at';
    let currentSortAsc = false;
    let currentSearchTerm = '';

    // Bootstrap UI Helpers
    function showSuccessToast(message) {
        if (!window.bootstrap) return alert(message);
        const toastBody = document.getElementById('successToastBody');
        if (toastBody) toastBody.textContent = message;
        const toastEl = document.getElementById('successToast');
        if (toastEl) {
            const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
            toast.show();
        }
    }

    function showConfirmModal(message, onConfirm) {
        if (!window.bootstrap) {
            if (confirm(message)) onConfirm();
            return;
        }
        const modalBody = document.getElementById('actionModalBody');
        if (modalBody) modalBody.textContent = message;
        const modalEl = document.getElementById('actionModal');
        if (!modalEl) {
            if (confirm(message)) onConfirm();
            return;
        }
        const modal = new bootstrap.Modal(modalEl);
        
        const confirmBtn = document.getElementById('actionModalConfirmBtn');
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        
        newBtn.addEventListener('click', () => {
            modal.hide();
            onConfirm();
        });
        
        modal.show();
    }

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
                const data = await res.json();
                sessionStorage.setItem('seller_auth', 'true');
                if (data.token) sessionStorage.setItem('seller_token', data.token);
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
        sessionStorage.removeItem('seller_token');
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
        // Hide global settings that shouldn't be visible when managing a client
        const regBtn = document.querySelector('.nav-btn[data-target="tab-register"]');
        if (regBtn) regBtn.style.display = 'none';
        const configMenu = document.getElementById('client-configs-menu');
        if (configMenu) configMenu.style.display = 'block';

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

            // Show global settings if returning to global tabs
            if (['tab-register', 'tab-clients', 'tab-billing', 'tab-plans'].includes(btn.dataset.target)) {
                const regBtn = document.querySelector('.nav-btn[data-target="tab-register"]');
                if (regBtn) regBtn.style.display = 'block';
                const configMenu = document.getElementById('client-configs-menu');
                if (configMenu) configMenu.style.display = 'none';
                currentClientBanner.style.display = 'none';
                selectedTenantId = null; // Exit client context
            }

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
        if (tabId === 'tab-chatbot') loadIdentity(); // reuse same loader – populates same IDs
        if (tabId === 'tab-analytics') {
            loadTenantChatsAndAnalytics();
        }
    }

    // Wire up analytics date filter buttons (super admin)
    document.querySelectorAll('#analytics-date-filter .date-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#analytics-date-filter .date-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _adminDateFilter = parseInt(btn.dataset.days);
            const filtered = _filterAdminByDays(globalChatsData, _adminDateFilter);
            renderAnalytics(filtered);
        });
    });

    function _filterAdminByDays(data, days) {
        if (!days || days === 0) return data;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        return data.filter(d => new Date(d.created_at) >= cutoff);
    }


    const demoTenantForm = document.getElementById('create-demo-tenant-form');
    if (demoTenantForm) {
        demoTenantForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('demo-tenant-name').value;
            const dbUrl = document.getElementById('demo-db-url').value;
            const btn = demoTenantForm.querySelector('button');
            const errEl = document.getElementById('demo-create-error');

            btn.disabled = true;
            errEl.textContent = '';

            try {
                const res = await fetch(`${API_BASE}/admin/create-demo-tenant`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, db_url: dbUrl })
                });

                if (res.ok) {
                    showSuccessToast('Demo account created successfully!');
                    demoTenantForm.reset();
                    await loadAllTenants();
                } else {
                    const data = await res.json();
                    errEl.textContent = data.detail || 'Failed to create demo account';
                }
            } catch (err) {
                errEl.textContent = 'Connection error';
            } finally {
                btn.disabled = false;
            }
        });
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

    // --- Search & Pagination Handlers ---
    const searchInput = document.getElementById('clients-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchTerm = e.target.value.toLowerCase();
            currentPage = 1;
            renderTenantsTable();
        });
    }

    const prevBtn = document.getElementById('clients-prev-btn');
    const nextBtn = document.getElementById('clients-next-btn');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) { currentPage--; renderTenantsTable(); }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentPage++; renderTenantsTable();
        });
    }

    window.toggleSort = (col) => {
        if (currentSortColumn === col) {
            currentSortAsc = !currentSortAsc;
        } else {
            currentSortColumn = col;
            currentSortAsc = true;
            if (col === 'created_at') currentSortAsc = false;
        }
        renderTenantsTable();
    };

    function renderTenantsTable() {
        tenantsList.innerHTML = '';
        
        // 1. Filter
        let filtered = globalTenants;
        if (currentSearchTerm) {
            filtered = globalTenants.filter(t => 
                t.name.toLowerCase().includes(currentSearchTerm) || 
                (t.username && t.username.toLowerCase().includes(currentSearchTerm))
            );
        }

        // 2. Sort
        filtered.sort((a, b) => {
            let valA = a[currentSortColumn];
            let valB = b[currentSortColumn];
            
            if (currentSortColumn === 'name') {
                valA = valA ? valA.toLowerCase() : '';
                valB = valB ? valB.toLowerCase() : '';
            } else if (currentSortColumn === 'created_at') {
                valA = valA ? new Date(valA).getTime() : 0;
                valB = valB ? new Date(valB).getTime() : 0;
            } else if (currentSortColumn === 'is_active') {
                valA = valA ? 1 : 0;
                valB = valB ? 1 : 0;
            }
            
            if (valA < valB) return currentSortAsc ? -1 : 1;
            if (valA > valB) return currentSortAsc ? 1 : -1;
            return 0;
        });

        // 3. Paginate
        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
        if (currentPage > totalPages) currentPage = totalPages;
        
        const startIdx = (currentPage - 1) * itemsPerPage;
        const endIdx = startIdx + itemsPerPage;
        const paginated = filtered.slice(startIdx, endIdx);

        // Update UI info
        const infoEl = document.getElementById('clients-page-info');
        if (infoEl) infoEl.textContent = `Showing ${totalItems === 0 ? 0 : startIdx + 1} to ${Math.min(endIdx, totalItems)} of ${totalItems} entries`;
        
        const numEl = document.getElementById('clients-page-num');
        if (numEl) numEl.textContent = currentPage;
        
        if (prevBtn) prevBtn.disabled = currentPage === 1;
        if (nextBtn) nextBtn.disabled = currentPage === totalPages;

        if (paginated.length === 0) {
            document.getElementById('no-tenants').style.display = 'block';
            return;
        }
        document.getElementById('no-tenants').style.display = 'none';

        paginated.forEach(t => {
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
                    ${t.is_demo_account ? '<span class="badge bg-info text-dark" style="font-size:0.65rem; margin-left:4px;">DEMO</span>' : ''}
                </td>
                <td><strong>${escapeHTML(t.name)}</strong></td>
                <td>
                    <small>Username: <code style="background:#f0f4ff;padding:2px 6px;border-radius:4px;font-weight:bold;letter-spacing:0.5px">${escapeHTML(t.username || '—')}</code></small><br>
                    <small style="color:var(--text-muted)">API Key: ${t.id}</small>
                </td>
                <td>
                    <small style="${subStyle}">${subText}</small><br>
                    <small style="color:var(--text-muted); font-size:0.65rem;">Expires: ${t.subscription_end_date ? t.subscription_end_date.split('T')[0] : 'N/A'}</small>
                </td>
                <td><small>${t.created_at.substring(0, 16)}</small></td>
                <td><a href="${CLIENT_CHATBOT_URL}?tenant_id=${t.id}" target="_blank" class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.75rem; text-decoration:none;">Chatbot</a></td>
                <td><a href="${CLIENT_ADMIN_URL}?username=${t.username || t.id}" target="_blank" class="btn outline-btn" style="padding:0.3rem 0.6rem; font-size:0.75rem; text-decoration:none;">Admin</a></td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        ${t.is_active ?
                            `<button class="btn danger-btn" style="padding:0.3rem 0.5rem; font-size:0.75rem;" onclick="deactivateTenant('${t.id}')">Deactivate</button>` :
                            `<button class="btn" style="padding:0.3rem 0.5rem; font-size:0.75rem; background-color:#ff4444; color:white;" onclick="deleteTenantHard('${t.id}')">Delete</button>`
                        }
                        <button class="btn primary-btn" style="padding:0.3rem 0.5rem; font-size:0.75rem;" onclick="extendSubscription('${t.id}')">+30 Days</button>
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

    window.extendSubscription = (id) => {
        showConfirmModal('Are you sure you want to grant +30 days to this client?', async () => {
            try {
                const res = await fetch(`${API_BASE}/admin/tenant/${id}/extend-subscription`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ days: 30 })
                });
                if (res.ok) {
                    showSuccessToast('Subscription extended successfully!');
                    await loadAllTenants();
                } else {
                    alert('Failed to extend subscription.');
                }
            } catch (err) {
                alert('Connection error');
            }
        });
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
                showSuccessToast(`Client '${data.name}' registered successfully!`);
                alert(`IMPORTANT REGISTRATION INFO:\n\nClient '${data.name}' registered!\nUsername: ${data.username}\nAPI Key: ${data.api_key}\n\nShare the login username (above) with your client. Do NOT share the API key.`);
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

    window.deactivateTenant = (id) => {
        showConfirmModal('Are you sure you want to deactivate this client?', async () => {
            try {
                const res = await fetch(`${API_BASE}/admin/tenant/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    showSuccessToast('Client deactivated successfully.');
                    await loadAllTenants();
                } else alert('Failed to deactivate tenant');
            } catch (err) { alert('Connection error'); }
        });
    };

    window.deleteTenantHard = (id) => {
        const confirmMsg = "WARNING: This action is irreversible. All client configuration, chatbots, and historical data will be permanently deleted. Are you absolutely sure?";
        showConfirmModal(confirmMsg, async () => {
            try {
                const res = await fetch(`${API_BASE}/admin/tenant/${id}/hard-delete`, { method: 'DELETE' });
                if (res.ok) {
                    showSuccessToast('Client successfully deleted.');
                    await loadAllTenants();
                } else {
                    const data = await res.json();
                    alert(`Failed to delete tenant: ${data.detail || 'Unknown error'}`);
                }
            } catch (err) { alert('Connection error'); }
        });
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
                
                document.getElementById('profile-chatbot-greeting').value = p.chatbot_greeting_message || '';
                document.getElementById('profile-chatbot-prompt').value = p.chatbot_system_prompt || '';

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
                    chatbot_greeting_message: document.getElementById('profile-chatbot-greeting').value,
                    chatbot_system_prompt: document.getElementById('profile-chatbot-prompt').value,
                    logo_url: document.getElementById('profile-logo-b64').value
                })
            });
            if (res.ok) showMessage(profileMsg, 'Identity Updated!', 'success');
            else showMessage(profileMsg, 'Failed to update.', 'error');
        } catch (err) { showMessage(profileMsg, 'Connection error', 'error'); }
    });

    // --- Chatbot Settings Form (dedicated tab) ---
    const chatbotSettingsForm = document.getElementById('chatbot-settings-form');
    if (chatbotSettingsForm) {
        chatbotSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msgEl = document.getElementById('chatbot-settings-msg');
            if (msgEl) msgEl.textContent = 'Saving...';
            try {
                const res = await fetch(`${API_BASE}/admin/profile?tenant_id=${selectedTenantId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chatbot_greeting_message: document.getElementById('profile-chatbot-greeting').value,
                        chatbot_system_prompt: document.getElementById('profile-chatbot-prompt').value,
                        logo_url: document.getElementById('profile-logo-b64').value
                    })
                });
                if (res.ok) {
                    showSuccessToast('Chatbot settings saved!');
                    if (msgEl) { msgEl.textContent = ''; }
                } else {
                    if (msgEl) showMessage(msgEl, 'Failed to save.', 'error');
                }
            } catch (err) {
                if (msgEl) showMessage(msgEl, 'Connection error', 'error');
            }
        });
    }


    async function loadTenantChatsAndAnalytics() {
        if (!selectedTenantId) return;
        if (_chatsLoadedForTenant === selectedTenantId && globalChatsData.length >= 0) {
            const filtered = _filterAdminByDays(globalChatsData, _adminDateFilter);
            renderAnalytics(filtered);
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/admin/chats?tenant_id=${selectedTenantId}`);
            if (res.ok) {
                globalChatsData = await res.json();
                globalChatsData.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
                _chatsLoadedForTenant = selectedTenantId;

                // Pre-fetch leads to compute KPIs
                try {
                    const rL = await fetch(`${API_BASE}/admin/leads?tenant_id=${selectedTenantId}`);
                    if (rL.ok) globalLeadsDataAdmin = await rL.json();
                    else globalLeadsDataAdmin = [];
                } catch(e) { globalLeadsDataAdmin = []; }

                const filtered = _filterAdminByDays(globalChatsData, _adminDateFilter);
                renderAnalytics(filtered);
            }
        } catch(e) { console.error('Error fetching chats:', e); }
    }

    async function renderAnalytics(data) {
        const CHART_COLORS = ['#6366f1','#0ea5e9','#f59e0b','#10b981','#ef4444','#ec4899','#8b5cf6','#06b6d4','#f97316','#84cc16'];

        // Destroy old Chart.js instances
        Object.values(_adminChartInstances).forEach(c => { try { c.destroy(); } catch(e){} });
        _adminChartInstances = {};

        if (!data || data.length === 0) {
            ['metric-total-queries','metric-unique-users','metric-intents','metric-ai-resolved',
             'metric-human-handover','metric-leads-count','metric-conversion-rate','metric-language','metric-recent']
            .forEach(id => { const el = document.getElementById(id); if(el) el.textContent = '0'; });
            const res = document.getElementById('metric-resolution');
            if(res) res.textContent = '0%';
            const rt = document.getElementById('resolution-text');
            if(rt) rt.textContent = '0% AI Resolved';
            const rp = document.getElementById('resolution-progress-bar');
            if(rp) rp.style.width = '0%';
            const fc = document.getElementById('funnel-chart-container');
            if(fc) fc.innerHTML = '<p style="color:#999;text-align:center;">No data yet.</p>';
            return;
        }

        // Compute metrics
        const totalQueries = data.length;
        const uniqueUsers = new Set(data.map(d => d.session_id)).size;
        const intentCounts = {};
        const langCounts = {};
        let resolvedCount = 0;
        data.forEach(d => {
            intentCounts[d.intent] = (intentCounts[d.intent] || 0) + 1;
            if (d.is_resolved) resolvedCount++;
            const lang = d.language || 'en';
            langCounts[lang] = (langCounts[lang] || 0) + 1;
        });
        const humanCount = totalQueries - resolvedCount;
        const resRate = Math.round((resolvedCount / totalQueries) * 100);
        const leadsCount = globalLeadsDataAdmin.length;
        const convRate = uniqueUsers > 0 ? Math.round((leadsCount / uniqueUsers) * 100) : 0;
        let topLang = 'en', topLangCount = 0;
        Object.entries(langCounts).forEach(([l,c]) => { if(c > topLangCount){ topLang=l; topLangCount=c; } });
        const sorted = [...data].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
        const recentDate = sorted.length ? new Date(sorted[0].created_at).toLocaleDateString() : 'N/A';

        // Update KPIs
        const _set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
        _set('metric-total-queries', totalQueries);
        _set('metric-unique-users', uniqueUsers);
        _set('metric-intents', Object.keys(intentCounts).length);
        _set('metric-ai-resolved', resolvedCount);
        _set('metric-human-handover', humanCount);
        _set('metric-resolution', resRate + '%');
        _set('metric-leads-count', leadsCount);
        _set('metric-conversion-rate', convRate + '%');
        _set('metric-language', topLang.toUpperCase());
        _set('metric-recent', recentDate);
        _set('resolution-text', resRate + '% AI Resolved');
        const rp = document.getElementById('resolution-progress-bar');
        if(rp) rp.style.width = resRate + '%';

        // Quota
        try {
            const res = await fetch(`${API_BASE}/admin/tenant-info?tenant_id=${selectedTenantId}`);
            if (res.ok) {
                const info = await res.json();
                const limit = info.limits.messages_per_month;
                const now = new Date();
                const curMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
                let monthlyUsed = 0;
                globalChatsData.forEach(d => { if(d.created_at.startsWith(curMonth)) monthlyUsed++; });
                _set('quota-plan-badge', info.current_plan);
                const progressEl = document.getElementById('quota-progress-bar');
                const textEl = document.getElementById('quota-text');
                const pctLabel = document.getElementById('quota-pct-label');
                if (limit >= 999999) {
                    if(textEl) textEl.textContent = `${monthlyUsed} Messages (Unlimited)`;
                    if(progressEl) { progressEl.style.width='100%'; progressEl.style.background='#107c41'; }
                    if(pctLabel) pctLabel.textContent = 'Unlimited';
                } else {
                    if(textEl) textEl.textContent = `${monthlyUsed} / ${limit} Messages Used`;
                    const pct = Math.min((monthlyUsed/limit)*100, 100);
                    if(progressEl) { progressEl.style.width=pct+'%'; progressEl.style.background = pct>90?'var(--danger)':pct>75?'orange':'var(--primary)'; }
                    if(pctLabel) pctLabel.textContent = pct.toFixed(1)+'%';
                }
            }
        } catch(e) { console.error('Quota error', e); }

        // CHART 1 — Intent Pie
        const intentLabels = Object.keys(intentCounts);
        const intentValues = Object.values(intentCounts);
        _adminChartInstances['intent-pie'] = new Chart(document.getElementById('chart-intent-pie'), {
            type: 'doughnut',
            data: { labels: intentLabels.map(l => l.charAt(0).toUpperCase()+l.slice(1)), datasets: [{ data: intentValues, backgroundColor: CHART_COLORS, borderWidth: 2, borderColor: '#fff' }] },
            options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom', labels: { padding: 14, font: { size: 12 } } } } }
        });

        // CHART 2 — Conversations Over Time
        const dayMap = {};
        data.forEach(d => { const day = d.created_at.substring(0,10); dayMap[day] = (dayMap[day]||0)+1; });
        const dayLabels = Object.keys(dayMap).sort();
        _adminChartInstances['convos-line'] = new Chart(document.getElementById('chart-convos-line'), {
            type: 'line',
            data: { labels: dayLabels, datasets: [{ label: 'Conversations', data: dayLabels.map(d=>dayMap[d]), borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.1)', fill:true, tension:0.4, pointRadius:4 }] },
            options: { responsive:true, maintainAspectRatio:true, plugins:{legend:{display:false}}, scales:{ x:{ticks:{maxTicksLimit:8,font:{size:10}}}, y:{beginAtZero:true} } }
        });

        // CHART 3 — Resolution Over Time
        const resDayAI={}, resDayHuman={};
        data.forEach(d => { const day=d.created_at.substring(0,10); if(d.is_resolved) resDayAI[day]=(resDayAI[day]||0)+1; else resDayHuman[day]=(resDayHuman[day]||0)+1; });
        const resDayLabels=[...new Set([...Object.keys(resDayAI),...Object.keys(resDayHuman)])].sort();
        _adminChartInstances['resolution-line'] = new Chart(document.getElementById('chart-resolution-line'), {
            type:'line',
            data:{ labels:resDayLabels, datasets:[
                { label:'AI Resolved', data:resDayLabels.map(d=>resDayAI[d]||0), borderColor:'#10b981', backgroundColor:'rgba(16,185,129,0.1)', fill:true, tension:0.4, pointRadius:3 },
                { label:'Human Required', data:resDayLabels.map(d=>resDayHuman[d]||0), borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,0.1)', fill:true, tension:0.4, pointRadius:3 }
            ]},
            options:{ responsive:true, maintainAspectRatio:true, plugins:{legend:{position:'top'}}, scales:{x:{ticks:{maxTicksLimit:8,font:{size:10}}}, y:{beginAtZero:true}} }
        });

        // CHART 4 — Top 10 Questions
        const qMap={};
        data.forEach(d => { if(d.question) qMap[d.question]=(qMap[d.question]||0)+1; });
        const topQ=Object.entries(qMap).sort((a,b)=>b[1]-a[1]).slice(0,10);
        _adminChartInstances['top-questions'] = new Chart(document.getElementById('chart-top-questions'), {
            type:'bar',
            data:{ labels:topQ.map(([q])=>q.length>35?q.substring(0,35)+'…':q), datasets:[{ label:'Count', data:topQ.map(([,c])=>c), backgroundColor:CHART_COLORS.slice(0,10), borderRadius:6 }] },
            options:{ indexAxis:'y', responsive:true, maintainAspectRatio:true, plugins:{legend:{display:false}}, scales:{x:{beginAtZero:true}, y:{ticks:{font:{size:10}}}} }
        });

        // CHART 5 — Language Pie
        _adminChartInstances['language-pie'] = new Chart(document.getElementById('chart-language-pie'), {
            type:'pie',
            data:{ labels:Object.keys(langCounts).map(l=>l.toUpperCase()), datasets:[{ data:Object.values(langCounts), backgroundColor:['#6366f1','#0ea5e9','#f59e0b','#10b981','#ef4444'], borderWidth:2, borderColor:'#fff' }] },
            options:{ responsive:true, maintainAspectRatio:true, plugins:{legend:{position:'bottom', labels:{padding:14}}} }
        });

        // CHART 6 — Peak Hours
        const hourMap=new Array(24).fill(0);
        data.forEach(d => { hourMap[new Date(d.created_at).getHours()]++; });
        _adminChartInstances['peak-hours'] = new Chart(document.getElementById('chart-peak-hours'), {
            type:'bar',
            data:{ labels:Array.from({length:24},(_,i)=>i+':00'), datasets:[{ label:'Messages', data:hourMap, backgroundColor:hourMap.map(v=>{ const max=Math.max(...hourMap); const a=max>0?0.3+(v/max)*0.7:0.3; return `rgba(99,102,241,${a.toFixed(2)})`; }), borderRadius:4 }] },
            options:{ responsive:true, maintainAspectRatio:true, plugins:{legend:{display:false}}, scales:{x:{ticks:{maxTicksLimit:12,font:{size:9}}}, y:{beginAtZero:true}} }
        });

        // FUNNEL
        const fc = document.getElementById('funnel-chart-container');
        if(fc) {
            fc.innerHTML = '';
            const steps=[
                {label:'Total Visitors (Sessions)', value:uniqueUsers, color:'#6366f1'},
                {label:'Started a Chat', value:totalQueries, color:'#0ea5e9'},
                {label:'Asked Pricing / Info', value:(intentCounts['pricing']||0)+(intentCounts['information']||0), color:'#f59e0b'},
                {label:'Contact Requested', value:intentCounts['contact']||0, color:'#10b981'},
                {label:'Lead Captured', value:leadsCount, color:'#ec4899'}
            ];
            const maxVal=steps[0].value||1;
            steps.forEach((step,i) => {
                const pct=Math.round((step.value/maxVal)*100);
                const convPct=i>0&&steps[i-1].value>0?Math.round((step.value/steps[i-1].value)*100):100;
                const div=document.createElement('div');
                div.style.cssText=`width:${Math.max(pct,10)}%;max-width:100%;background:${step.color};color:white;border-radius:6px;padding:0.55rem 1.2rem;display:flex;justify-content:space-between;align-items:center;transition:width 0.5s ease;font-weight:600;font-size:0.88rem;min-width:180px;`;
                div.innerHTML=`<span>${step.label}</span><span style="opacity:0.9">${step.value} ${i>0?'('+convPct+'%)':''}</span>`;
                fc.appendChild(div);
            });
        }
    }


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
