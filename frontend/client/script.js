const API_BASE = 'http://127.0.0.1:8000';

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const views = {
        login: document.getElementById('login-view'),
        dashboard: document.getElementById('dashboard-view')
    };
    
    // Auth & Navigation
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const tenantBadge = document.getElementById('display-tenant-id');
    const logoutBtn = document.getElementById('logout-btn');
    const navBtns = document.querySelectorAll('.nav-btn[data-target]');
    const sections = document.querySelectorAll('.content-section');

    // Profile Elements
    const profileForm = document.getElementById('profile-form');
    const profileMsg = document.getElementById('profile-msg');
    const passwordForm = document.getElementById('password-form');
    const pwdMsg = document.getElementById('pwd-msg');

    // FAQ Elements
    const addFaqBtn = document.getElementById('show-add-faq');
    const cancelFaqBtn = document.getElementById('cancel-add-faq');
    const addFaqFormContainer = document.getElementById('add-faq-form-container');
    const addFaqForm = document.getElementById('add-faq-form');
    const faqsList = document.getElementById('faqs-list');
    const noFaqs = document.getElementById('no-faqs');

    // Chat Elements
    const chatsList = document.getElementById('chats-list');
    const noChats = document.getElementById('no-chats');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnExportExcel = document.getElementById('btn-export-excel');

    // Leads Elements
    const leadsList = document.getElementById('leads-list');
    const noLeads = document.getElementById('no-leads');

    // KB Elements
    const uploadDocForm = document.getElementById('upload-doc-form');
    const docUploadInput = document.getElementById('doc-upload-input');
    const uploadStatus = document.getElementById('upload-status');
    const docsList = document.getElementById('docs-list');
    const noDocs = document.getElementById('no-docs');

    // State
    const urlParams = new URLSearchParams(window.location.search);
    let tenantIdStr = urlParams.get('tenant_id');
    let tenantId = sessionStorage.getItem('tenant_id') || tenantIdStr;

    // We MUST have a tenant ID.
    if (!tenantId) {
        document.querySelector('.login-box').innerHTML = `
            <div class="error-text" style="font-size:1rem; color: var(--danger);">
                 Missing tenant ID in URL.<br><br>
                Please use the link provided by the developer.<br>
                Format: <code>/?tenant_id=your-id</code>
            </div>`;
        return;
    }

    if (sessionStorage.getItem('client_auth') === 'true') {
        initDashboard();
    } else {
        document.getElementById('tenant-id').value = tenantId;
        showView('login');
    }

    // --- Authentication ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tid = document.getElementById('tenant-id').value.trim();
        const pwd = document.getElementById('password').value;
        const btn = loginForm.querySelector('button');
        
        btn.disabled = true;
        loginError.textContent = '';
        
        try {
            const res = await fetch(`${API_BASE}/admin/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant_id: tid, password: pwd })
            });
            
            if (res.ok) {
                tenantId = tid;
                sessionStorage.setItem('tenant_id', tid);
                sessionStorage.setItem('client_auth', 'true');
                loginForm.reset();
                initDashboard();
            } else {
                const data = await res.json();
                loginError.textContent = data.detail || 'Invalid credentials';
            }
        } catch (err) {
            loginError.textContent = 'Connection error. Is backend running?';
        } finally {
            btn.disabled = false;
        }
    });

    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('client_auth');
        // Reset caches on logout
        _chatsLoaded = false;
        _tenantInfoLoaded = false;
        globalChatsData = [];
        showView('login');
    });

    // --- Navigation ---
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if(btn.id === 'logout-btn') return;
            navBtns.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
            
            // Use cached data — don't re-fetch on every tab click
            if (btn.dataset.target === 'section-analytics') renderAnalytics(globalChatsData);
            if (btn.dataset.target === 'section-leads') renderLeads(globalChatsData);
            if (btn.dataset.target === 'section-chats') {
                const displayChats = [...globalChatsData].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
                renderChats(displayChats);
            }
            // These are fast per-tenant DB calls — fetch only if not cached
            if (btn.dataset.target === 'section-faqs') loadFaqs();
            if (btn.dataset.target === 'section-kb') loadDocs();
        });
    });

    function initDashboard() {
        showView('dashboard');
        tenantBadge.textContent = tenantId;
        loadTenantInfo();
        loadProfile();
        loadAnalyticsAndData(); // Load chats, leads, analytics
        loadFaqs();
        loadDocs();
    }

    // --- Data Loading (Chats, Leads, Analytics) ---
    // Cache: only fetch once per session, re-render from memory on tab switch
    let globalChatsData = [];
    let _chatsLoaded = false;
    let _tenantInfoLoaded = false;
    async function loadTenantInfo() {
        if (_tenantInfoLoaded) return; // Skip fetch if already loaded
        try {
            const res = await fetch(`${API_BASE}/admin/tenant-info?tenant_id=${tenantId}`);
            if (res.ok) {
                const data = await res.json();
                _tenantInfoLoaded = true; // Mark as loaded
                tenantBadge.textContent = data.name; // Display the business name
                const banner = document.getElementById('billing-banner');
                banner.style.display = 'block';
                
                if (data.subscription_end_date) {
                    const endDate = new Date(data.subscription_end_date);
                    const now = new Date();
                    
                    if (endDate > now) {
                        const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
                        banner.style.backgroundColor = 'var(--success-color)';
                        banner.style.color = 'white';
                        banner.innerHTML = `Subscription Status: <span style="font-weight:normal">Active (${daysLeft} days left)</span> &bull; Expires: ${endDate.toLocaleDateString()}`;
                    } else {
                        banner.style.backgroundColor = 'var(--danger-color)';
                        banner.style.color = 'white';
                        banner.innerHTML = `Subscription Status: <span style="font-weight:normal">Expired</span> &bull; Your chatbot will not answer new customer requests. Please contact support to renew.`;
                    }
                } else {
                    banner.style.display = 'none'; // No end date found
                }
            }
        } catch (err) {
            console.error('Failed to load tenant info', err);
        }
    }



    async function loadAnalyticsAndData() {
        // Use cached data if already loaded
        if (_chatsLoaded) {
            renderAnalytics(globalChatsData);
            renderLeads(globalChatsData);
            const displayChats = [...globalChatsData].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
            renderChats(displayChats);
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/admin/chats?tenant_id=${tenantId}`);
            if (res.ok) {
                globalChatsData = await res.json();
                globalChatsData.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
                _chatsLoaded = true; // mark cached
                
                renderAnalytics(globalChatsData);
                renderLeads(globalChatsData);
                
                const displayChats = [...globalChatsData].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
                renderChats(displayChats);
            }
        } catch (err) {
            console.error('Failed to load chat data', err);
        }
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

        // Calculate Metrics
        document.getElementById('metric-total-queries').textContent = data.length;
        
        const counts = {};
        data.forEach(d => {
            counts[d.intent] = (counts[d.intent] || 0) + 1;
        });
        
        document.getElementById('metric-intents').textContent = Object.keys(counts).length;
        document.getElementById('metric-recent').textContent = new Date(data[data.length-1].created_at).toLocaleDateString();

        // Build simple CSS bar chart to replace Plotly pie chart
        const container = document.getElementById('intent-chart-container');
        const labelsContainer = document.getElementById('intent-chart-labels');
        container.innerHTML = '';
        labelsContainer.innerHTML = '';

        const maxCount = Math.max(...Object.values(counts));
        
        Object.entries(counts).forEach(([intent, count]) => {
            const heightPercent = (count / maxCount) * 100;
            
            const col = document.createElement('div');
            col.className = 'bar-col';
            col.style.height = `${heightPercent}%`;
            col.title = `${intent}: ${count}`;
            col.textContent = count; // Number at top of bar
            
            const label = document.createElement('div');
            label.textContent = intent;
            label.style.width = `${100 / Object.keys(counts).length}%`;
            label.style.textAlign = 'center';
            label.style.textTransform = 'capitalize';
            
            container.appendChild(col);
            labelsContainer.appendChild(label);
        });

        // Calculate Monthly Quota
        try {
            if (!_tenantInfoLoaded) {
                const res2 = await fetch(`${API_BASE}/admin/tenant-info?tenant_id=${tenantId}`);
                if (res2.ok) {
                    const info = await res2.json();
                    _tenantInfoLoaded = info; // cache the response
                    _applyQuota(info, data);
                }
            } else {
                _applyQuota(_tenantInfoLoaded, data);
            }
        } catch(e) { console.error('Error fetching quota limits', e); }
    }

    function _applyQuota(info, data) {
        const limit = info.limits.messages_per_month;
        const now = new Date();
        const currentMonthString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        let monthlyUsed = 0;
        data.forEach(d => {
            if (d.created_at.startsWith(currentMonthString)) monthlyUsed++;
        });
        document.getElementById('quota-plan-badge').textContent = info.current_plan;
        const progressEl = document.getElementById('quota-progress-bar');
        const textEl = document.getElementById('quota-text');
        if (limit >= 999999) {
            textEl.textContent = `${monthlyUsed} Messages (Unlimited Plan)`;
            progressEl.style.width = '100%';
            progressEl.style.background = '#107c41';
        } else {
            textEl.textContent = `${monthlyUsed} / ${limit} Messages Used`;
            let pct = Math.min((monthlyUsed / limit) * 100, 100);
            progressEl.style.width = `${pct}%`;
            if (pct > 90) progressEl.style.background = 'var(--danger-color)';
            else if (pct > 75) progressEl.style.background = 'orange';
            else progressEl.style.background = 'var(--primary-color)';
        }
    }

    function renderLeads(data) {
        leadsList.innerHTML = '';
        const leadsFiles = data.filter(d => d.intent === 'contact');
        
        if (leadsFiles.length === 0) {
            noLeads.style.display = 'block';
            return;
        }
        noLeads.style.display = 'none';

        // Replicating logic: find standard inquiry exactly before contact intent in the same session
        const leadsDataDisplay = [];
        leadsFiles.forEach(lead => {
            const sessionMsgs = data.filter(d => d.session_id === lead.session_id);
            const prevMsgs = sessionMsgs.filter(d => new Date(d.created_at) < new Date(lead.created_at));
            
            let inquiry = "Unknown inquiry";
            if (prevMsgs.length > 0) {
                inquiry = prevMsgs[prevMsgs.length - 1].question;
            }

            leadsDataDisplay.push({
                date: new Date(lead.created_at).toLocaleString(),
                contactInfo: lead.question,
                inquiry: inquiry,
                sessionId: lead.session_id.substring(0, 8) + '...'
            });
        });

        // Reverse to show newest leads first
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
            noChats.style.display = 'block';
            return;
        }
        noChats.style.display = 'none';

        chats.forEach(c => {
            const tr = document.createElement('tr');
            const answerPreview = c.answer ? (c.answer.length > 100 ? c.answer.substring(0, 100) + '...' : c.answer) : '';
            tr.innerHTML = `
                <td style="white-space:nowrap"><small>${new Date(c.created_at).toLocaleString()}</small></td>
                <td><small style="color:var(--text-muted)">${escapeHTML(c.session_id.substring(0, 8))}...</small></td>
                <td>${escapeHTML(c.question)}</td>
                <td><small>${escapeHTML(answerPreview)}</small></td>
                <td><code style="background:#f5f5f5;padding:2px 4px;">${escapeHTML(c.intent)}</code></td>
                <td><a href="${escapeHTML(c.page_url)}" target="_blank" style="color:#0066cc;text-decoration:none;">Link</a></td>
            `;
            chatsList.appendChild(tr);
        });
    }

    // --- Exports (CSV / EXCEL) ---
    btnExportCsv.addEventListener('click', () => {
        if (!globalChatsData || globalChatsData.length === 0) return alert("No data to export");
        
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "created_at,question,answer,intent,page_url\n"; // Headers
        
        globalChatsData.forEach(function(rowArray) {
            // Escape quotes inside fields
            const q = `"${rowArray.question.replace(/"/g, '""')}"`;
            const a = `"${(rowArray.answer || '').replace(/"/g, '""')}"`;
            let row = `${rowArray.created_at},${q},${a},${rowArray.intent},${rowArray.page_url}`;
            csvContent += row + "\r\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "chat_logs.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    btnExportExcel.addEventListener('click', () => {
        if (!globalChatsData || globalChatsData.length === 0) return alert("No data to export");
        if (typeof XLSX === 'undefined') return alert("Excel library not loaded");

        const exportData = globalChatsData.map(c => ({
            created_at: c.created_at,
            question: c.question,
            answer: c.answer || '',
            intent: c.intent,
            page_url: c.page_url
        }));

        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "ChatLogs");
        
        // Let SheetJS download it
        XLSX.writeFile(workbook, "chat_logs.xlsx");
    });

    // --- Profile Management ---
    async function loadProfile() {
        try {
            const res = await fetch(`${API_BASE}/admin/profile?tenant_id=${tenantId}`);
            if (res.ok) {
                // Notice the variable name is `profile` not `p`
                const profile = await res.json();
                document.getElementById('company-name').value = profile.company_name;
                document.getElementById('industry').value = profile.industry;
                document.getElementById('biz-desc').value = profile.business_description;
                document.getElementById('profile-hours').value = profile.business_hours || '';
                
                document.getElementById('profile-contact-name').value = profile.contact_person_name || '';
                document.getElementById('profile-contact-role').value = profile.contact_person_role || '';
                document.getElementById('profile-contact-email').value = profile.contact_person_email || '';
                document.getElementById('profile-contact-phone').value = profile.contact_person_phone || '';
                
                document.getElementById('profile-address-street').value = profile.address_street || '';
                document.getElementById('profile-city').value = profile.city || '';
                document.getElementById('profile-state').value = profile.state || '';
                document.getElementById('profile-country').value = profile.country || '';
                document.getElementById('profile-zip').value = profile.zip_code || '';
                document.getElementById('profile-timezone').value = profile.timezone || '';
                
                document.getElementById('profile-brand-primary').value = profile.brand_color_primary || '';
                document.getElementById('profile-brand-secondary').value = profile.brand_color_secondary || '';
                document.getElementById('profile-social-li').value = profile.social_linkedin || '';
                document.getElementById('profile-social-tw').value = profile.social_twitter || '';
                document.getElementById('profile-social-ig').value = profile.social_instagram || '';
            }
        } catch (e) {
            console.error('Failed to load profile');
        }
    }

    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            company_name: document.getElementById('company-name').value,
            industry: document.getElementById('industry').value,
            business_description: document.getElementById('biz-desc').value,
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
            social_instagram: document.getElementById('profile-social-ig').value
        };
        showMessage(profileMsg, 'Saving...', '');
        
        try {
            const res = await fetch(`${API_BASE}/admin/profile?tenant_id=${tenantId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) showMessage(profileMsg, 'Profile saved successfully.', 'success');
            else showMessage(profileMsg, 'Failed to save.', 'error');
        } catch (err) {
            showMessage(profileMsg, 'Connection error.', 'error');
        }
    });

    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            tenant_id: tenantId,
            old_password: document.getElementById('old-pwd').value,
            new_password: document.getElementById('new-pwd').value
        };
        showMessage(pwdMsg, 'Updating...', '');
        
        try {
            const res = await fetch(`${API_BASE}/admin/change-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                showMessage(pwdMsg, ' Password changed! Use new password next time.', 'success');
                passwordForm.reset();
            } else {
                const data = await res.json();
                showMessage(pwdMsg, ` ${data.detail || 'Failed'}`, 'error');
            }
        } catch (err) {
            showMessage(pwdMsg, 'Connection error.', 'error');
        }
    });

    // --- FAQ Management ---
    addFaqBtn.addEventListener('click', () => { addFaqFormContainer.style.display = 'block'; });
    cancelFaqBtn.addEventListener('click', () => { 
        addFaqFormContainer.style.display = 'none';
        addFaqForm.reset();
    });

    addFaqForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = addFaqForm.querySelector('button[type="submit"]');
        btn.disabled = true;

        const payload = {
            question: document.getElementById('faq-q').value,
            answer: document.getElementById('faq-a').value,
            intent: document.getElementById('faq-i').value
        };

        try {
            const res = await fetch(`${API_BASE}/admin/faq?tenant_id=${tenantId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                addFaqForm.reset();
                addFaqFormContainer.style.display = 'none';
                loadFaqs();
                // Show floating success message mimicking Streamlit
                alert("FAQ Added Successfully!");
            } else {
                alert('Failed to add FAQ');
            }
        } catch (err) {
            alert('Connection error');
        } finally {
            btn.disabled = false;
        }
    });

    async function loadFaqs() {
        try {
            const res = await fetch(`${API_BASE}/admin/faqs?tenant_id=${tenantId}`);
            if (res.ok) {
                const faqs = await res.json();
                renderFaqs(faqs);
            }
        } catch (err) {
            console.error(err);
        }
    }

    function renderFaqs(faqs) {
        faqsList.innerHTML = '';
        if (faqs.length === 0) {
            noFaqs.style.display = 'block';
            return;
        }
        noFaqs.style.display = 'none';
        
        faqs.forEach(f => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHTML(f.question)}</strong></td>
                <td><small>${escapeHTML(f.answer.substring(0, 80))}${f.answer.length > 80 ? '...' : ''}</small></td>
                <td><code style="background:#f5f5f5;padding:2px 4px;">${escapeHTML(f.intent).toUpperCase()}</code></td>
                <td><span style="color:${f.is_active?'#107c41':'#666'}">${f.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                    ${f.is_active ? `<button class="btn danger-btn" onclick="deactivateFaq('${f.id}')" style="padding:0.2rem 0.6rem;font-size:0.75rem;">Deactivate ${f.id.substring(0,8)}</button>` : '-'}
                </td>
            `;
            faqsList.appendChild(tr);
        });
    }

    window.deactivateFaq = async (id) => {
        if (!confirm('Deactivate this FAQ? It will no longer be used by the AI.')) return;
        try {
            const res = await fetch(`${API_BASE}/admin/faq/${id}?tenant_id=${tenantId}`, { method: 'DELETE' });
            if (res.ok) loadFaqs();
            else alert('Failed to deactivate');
        } catch (err) { alert('Connection error'); }
    };

    // --- Knowledge Base Management ---
    uploadDocForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const file = docUploadInput.files[0];
        if (!file) return;

        const btn = document.getElementById('btn-upload');
        btn.disabled = true;
        uploadStatus.style.display = 'block';
        uploadStatus.style.color = '#666';
        uploadStatus.textContent = 'Uploading and parsing document... Please wait.';

        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const res = await fetch(`${API_BASE}/admin/upload-doc?tenant_id=${tenantId}`, {
                method: 'POST',
                body: formData
            });
            
            if (res.ok) {
                uploadStatus.style.color = '#107c41';
                uploadStatus.textContent = ' Document uploaded and AI trained successfully!';
                uploadDocForm.reset();
                loadDocs();
            } else {
                const data = await res.json();
                uploadStatus.style.color = 'red';
                uploadStatus.textContent = ` ${data.detail || 'Upload failed'}`;
            }
        } catch (err) {
            uploadStatus.style.color = 'red';
            uploadStatus.textContent = ' Connection error during upload';
        } finally {
            btn.disabled = false;
            setTimeout(() => { if(uploadStatus.style.color==='rgb(16, 124, 65)') uploadStatus.style.display='none'}, 5000);
        }
    });

    async function loadDocs() {
        try {
            const res = await fetch(`${API_BASE}/admin/docs?tenant_id=${tenantId}`);
            if (res.ok) {
                const docs = await res.json();
                renderDocs(docs);
            }
        } catch (err) {
            console.error('Failed to load docs', err);
        }
    }

    function renderDocs(docs) {
        docsList.innerHTML = '';
        if (docs.length === 0) {
            if(noDocs) noDocs.style.display = 'block';
            return;
        }
        if(noDocs) noDocs.style.display = 'none';
        
        docs.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="white-space:nowrap"><small>${new Date(d.created_at).toLocaleDateString()}</small></td>
                <td><strong>${escapeHTML(d.filename)}</strong></td>
                <td><code style="background:#f5f5f5;padding:2px 4px;">${escapeHTML(d.file_type).toUpperCase()}</code></td>
                <td><span style="color:${d.is_active?'#107c41':'#666'}">${d.is_active ? 'Active' : 'Archived'}</span></td>
                <td>
                    ${d.is_active ? `<button class="btn danger-btn" onclick="deleteDoc('${d.id}')" style="padding:0.2rem 0.6rem;font-size:0.75rem;">Delete</button>` : '-'}
                </td>
            `;
            docsList.appendChild(tr);
        });
    }

    window.deleteDoc = async (id) => {
        if (!confirm('Delete this document? The AI will instantly forget its contents.')) return;
        try {
            const res = await fetch(`${API_BASE}/admin/doc/${id}?tenant_id=${tenantId}`, { method: 'DELETE' });
            if (res.ok) loadDocs();
            else alert('Failed to delete document');
        } catch (err) { alert('Connection error'); }
    };

    // --- Utils ---
    function showView(viewName) {
        Object.values(views).forEach(v => v.classList.remove('active'));
        if (views[viewName]) views[viewName].classList.add('active');
    }
    
    function showMessage(el, text, type) {
        el.textContent = text;
        el.className = 'msg-text' + (type === 'success' ? ' msg-success' : (type==='error'?' error-text':''));
        if (type !== '') {
            setTimeout(() => { el.textContent = ''; el.className = 'msg-text'; }, 5000);
        }
    }

    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag] || tag));
    }
});
