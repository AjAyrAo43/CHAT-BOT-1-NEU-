const API_BASE = 'http://127.0.0.1:8000';

// We'll optionally base URL for links off standard ports for local test,
// or whatever the streamlit apps used.
const CLIENT_CHATBOT_URL = 'http://127.0.0.1:8000/frontend/chatbot';
const CLIENT_ADMIN_URL = 'http://127.0.0.1:8000/frontend/client';

document.addEventListener('DOMContentLoaded', () => {
    // Views Elements
    const views = {
        login: document.getElementById('login-view'),
        dashboard: document.getElementById('dashboard-view')
    };

    // Auth
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const logoutBtn = document.getElementById('logout-btn');

    // Navigation & Tenant Selector
    const navBtns = document.querySelectorAll('.nav-btn[data-target]');
    const sections = document.querySelectorAll('.content-section');
    const tenantSelector = document.getElementById('tenant-selector');
    const currentTenantInfo = document.getElementById('current-tenant-info');

    // Tab Elements
    const tenantsList = document.getElementById('tenants-list');
    const noTenants = document.getElementById('no-tenants');
    const createForm = document.getElementById('create-tenant-form');
    const createError = document.getElementById('create-error');
    
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

    // State
    let isAuthenticated = sessionStorage.getItem('seller_auth') === 'true';
    let globalTenants = [];
    let selectedTenantId = null;
    let globalChatsData = []; // For current selected tenant

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
        // Load whatever tab is active
        const activeTabBtn = document.querySelector('.nav-btn.active');
        if(activeTabBtn) {
            handleTabSwitch(activeTabBtn.dataset.target);
        }
    }

    tenantSelector.addEventListener('change', (e) => {
        selectedTenantId = e.target.value;
        const t = globalTenants.find(x => x.id === selectedTenantId);
        if(t) currentTenantInfo.textContent = `Viewing: ${t.name}`;
        else currentTenantInfo.textContent = '';
        
        // Refresh active tab data
        const activeTabBtn = document.querySelector('.nav-btn.active');
        if(activeTabBtn) handleTabSwitch(activeTabBtn.dataset.target);
    });

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if(btn.id === 'logout-btn') return;
            navBtns.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
            
            handleTabSwitch(btn.dataset.target);
        });
    });

    function handleTabSwitch(tabId) {
        if (tabId === 'tab-clients') {
            renderTenantsTable();
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
                
                // Populate Tenant Selector
                tenantSelector.innerHTML = '<option value="">-- Select Client --</option>';
                globalTenants.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.name;
                    if(t.id === selectedTenantId) opt.selected = true;
                    tenantSelector.appendChild(opt);
                });
                
                if(!selectedTenantId && globalTenants.length > 0) {
                    // select first active automatically for better UX
                    selectedTenantId = globalTenants[0].id;
                    tenantSelector.value = selectedTenantId;
                    currentTenantInfo.textContent = `Viewing: ${globalTenants[0].name}`;
                }

                renderTenantsTable();
            }
        } catch (err) {
            console.error('Failed to load tenants:', err);
        }
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
            tr.innerHTML = `
                <td>
                    <span class="status-indicator ${t.is_active ? 'status-active-dot' : 'status-inactive-dot'}"></span>
                    <small>${t.is_active ? 'Active' : 'Inactive'}</small>
                </td>
                <td><strong>${escapeHTML(t.name)}</strong></td>
                <td>
                    <small>ID: ${t.id}</small><br>
                    <small>API Key: <code>${t.api_key}</code></small>
                </td>
                <td><small>${t.created_at.substring(0, 16)}</small></td>
                <td>
                    ${t.is_active ? `<button class="btn danger-btn" onclick="deactivateTenant('${t.id}')">Deactivate</button>` : '-'}
                    <div style="margin-top:5px;">
                        <button class="btn outline-btn" style="font-size:0.7rem; padding:0.2rem;" onclick="alert('Client Chatbot URL:\\n${CLIENT_CHATBOT_URL}/index.html?tenant_id=${t.id}\\n\\nClient Admin URL:\\n${CLIENT_ADMIN_URL}/index.html?tenant_id=${t.id}')">View Links</button>
                    </div>
                </td>
            `;
            tenantsList.appendChild(tr);
        });
    }

    createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = createForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        createError.textContent = '';

        const payload = {
            name: document.getElementById('tenant-name').value,
            admin_password: document.getElementById('admin-password').value,
        };
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
                alert(`✅ Client '${data.name}' registered!\nTenant ID: ${data.id}\nAPI Key: ${data.api_key}`);
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
            }
        } catch(e) { console.error('Failed to load profile'); }
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
                    business_description: document.getElementById('profile-desc').value
                })
            });
            if (res.ok) showMessage(profileMsg, 'Identity Updated!', 'success');
            else showMessage(profileMsg, 'Failed to update.', 'error');
        } catch (err) { showMessage(profileMsg, 'Connection error', 'error'); }
    });


    // --- Analytics, Leads, Chats ---
    async function loadTenantChatsAndAnalytics() {
        if (!selectedTenantId) return;
        try {
            const res = await fetch(`${API_BASE}/admin/chats?tenant_id=${selectedTenantId}`);
            if (res.ok) {
                globalChatsData = await res.json();
                globalChatsData.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
                
                renderAnalytics(globalChatsData);
                renderLeads(globalChatsData);

                const displayChats = [...globalChatsData].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
                renderChats(displayChats);
            }
        } catch(e) { console.error('Error fetching chats:', e); }
    }

    function renderAnalytics(data) {
        if (data.length === 0) {
            document.getElementById('metric-total-queries').textContent = '0';
            document.getElementById('metric-intents').textContent = '0';
            document.getElementById('metric-recent').textContent = 'N/A';
            document.getElementById('intent-chart-container').innerHTML = '';
            document.getElementById('intent-chart-labels').innerHTML = '';
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
