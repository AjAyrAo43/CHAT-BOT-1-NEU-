const API_BASE = 'https://chat-bot-1-neu-1.onrender.com';

// Global Fetch Interceptor to attach X-Auth-Token automatically
const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if (resource && typeof resource === 'string' && resource.includes('/admin/')) {
        config = config || {};
        config.headers = config.headers || {};
        const token = sessionStorage.getItem('tenant_token');
        if (token && !resource.includes('/admin/auth') && !resource.includes('/admin/resolve-username')) {
            config.headers['X-Auth-Token'] = token;
        }
    }
    return originalFetch(resource, config);
};

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

    // State — tenant_id is resolved from username at login; never shown raw to user
    let tenantId = sessionStorage.getItem('tenant_id') || null;

    // Toast Notification Helper
    function showToast(message, duration = 3000) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.style.display = 'block';
        setTimeout(() => {
            toast.style.display = 'none';
        }, duration);
    }

    // Check if already authenticated
    if (sessionStorage.getItem('client_auth') === 'true' && tenantId) {
        initDashboard();
    } else {
        showView('login');
    }

    // --- Authentication ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('username-input').value.trim();
        const pwd = document.getElementById('password').value;
        const btn = loginForm.querySelector('button');
        
        btn.disabled = true;
        loginError.textContent = '';
        
        try {
            // Step 1: resolve username → tenant_id
            const resolveRes = await fetch(`${API_BASE}/admin/resolve-username`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: usernameInput })
            });
            if (!resolveRes.ok) {
                loginError.textContent = 'Username not found. Check your credentials.';
                return;
            }
            const { tenant_id } = await resolveRes.json();

            // Step 2: authenticate with the resolved tenant_id
            const res = await fetch(`${API_BASE}/admin/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant_id, password: pwd })
            });
            
            if (res.ok) {
                const data = await res.json();
                tenantId = tenant_id;
                sessionStorage.setItem('tenant_id', tenant_id);
                sessionStorage.setItem('client_auth', 'true');
                if (data.token) sessionStorage.setItem('tenant_token', data.token);
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
        sessionStorage.removeItem('tenant_token');
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
            if (btn.dataset.target === 'section-analytics') {
                const filtered = filterByDays(globalChatsData, _activeDateFilter);
                renderAnalytics(filtered);
            }
            if (btn.dataset.target === 'section-leads') renderLeads();
            if (btn.dataset.target === 'section-chats') {
                const displayChats = [...globalChatsData].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
                renderChats(displayChats);
            }
            // AI Training loads both FAQs and Docs
            if (btn.dataset.target === 'section-ai-training') {
                loadFaqs();
                loadDocs();
            }
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
        initAiTrainingTabs();
        initCharCounters();
    }

    // Data Loading (Chats, Leads, Analytics)
    // Cache: only fetch once per session, re-render from memory on tab switch
    let globalChatsData = [];
    let globalLeadsData = [];
    let _chatsLoaded = false;
    let _tenantInfoLoaded = false;
    let _activeChartInstances = {};   // track Chart.js instances for cleanup
    let _activeDateFilter = 30;        // default: last 30 days
    async function loadTenantInfo() {
        if (_tenantInfoLoaded) return; // Skip fetch if already loaded
        try {
            const res = await fetch(`${API_BASE}/admin/tenant-info?tenant_id=${tenantId}`);
            if (res.ok) {
                const data = await res.json();
                _tenantInfoLoaded = true; // Mark as loaded
                tenantBadge.textContent = data.name;

                // ── Update sidebar brand header ──
                const sidebarName = document.getElementById('sidebar-company-name');
                if (sidebarName) sidebarName.textContent = data.name;
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
                        
                        // Disable admin actions
                        const disableEl = id => {
                            const e = document.getElementById(id);
                            if(e) { e.disabled = true; e.style.opacity = '0.5'; e.style.cursor = 'not-allowed'; }
                        };
                        disableEl('show-add-faq');
                        disableEl('btn-upload');
                        disableEl('btn-add-url');
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
            const filtered = filterByDays(globalChatsData, _activeDateFilter);
            renderAnalytics(filtered);
            renderLeads();
            const displayChats = [...globalChatsData].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
            renderChats(displayChats);
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/admin/chats?tenant_id=${tenantId}`);
            if (res.ok) {
                globalChatsData = await res.json();
                globalChatsData.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
                _chatsLoaded = true;

                // Pre-load leads too
                try {
                    const rLeads = await fetch(`${API_BASE}/admin/leads?tenant_id=${tenantId}`);
                    if (rLeads.ok) globalLeadsData = await rLeads.json();
                } catch(e) { globalLeadsData = []; }

                try {
                    const rFb = await fetch(`${API_BASE}/admin/feedback/stats?tenant_id=${tenantId}`);
                    if (rFb.ok) {
                        const fbData = await rFb.json();
                        const fbEl = document.getElementById('metric-avg-feedback');
                        if (fbEl) fbEl.textContent = fbData.average > 0 ? fbData.average.toFixed(1) + ' / 5.0' : 'N/A';
                    }
                } catch(e) {}

                const filtered = filterByDays(globalChatsData, _activeDateFilter);
                renderAnalytics(filtered);
                renderLeads();

                const displayChats = [...globalChatsData].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
                renderChats(displayChats);
            }
        } catch (err) {
            console.error('Failed to load chat data', err);
        }
    }

    // --- Date filter helper ---
    function filterByDays(data, days) {
        if (!days || days === 0) return data;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        return data.filter(d => new Date(d.created_at) >= cutoff);
    }

    // Wire up date filter buttons
    document.querySelectorAll('.date-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.date-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _activeDateFilter = parseInt(btn.dataset.days);
            const filtered = filterByDays(globalChatsData, _activeDateFilter);
            renderAnalytics(filtered);
        });
    });

    async function renderAnalytics(data) {
        const CHART_COLORS = ['#6366f1','#0ea5e9','#f59e0b','#10b981','#ef4444','#ec4899','#8b5cf6','#06b6d4','#f97316','#84cc16'];

        // --- Destroy existing Chart.js instances to avoid canvas reuse errors ---
        Object.values(_activeChartInstances).forEach(c => { try { c.destroy(); } catch(e){} });
        _activeChartInstances = {};

        // --- Empty state ---
        if (!data || data.length === 0) {
            ['metric-total-queries','metric-unique-users','metric-intents','metric-ai-resolved',
             'metric-human-handover','metric-resolution','metric-leads-count','metric-conversion-rate',
             'metric-language','metric-recent'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '0';
            });
            document.getElementById('metric-resolution').textContent = '0%';
            document.getElementById('metric-conversion-rate').textContent = '0%';
            document.getElementById('metric-language').textContent = 'N/A';
            document.getElementById('metric-recent').textContent = 'N/A';
            document.getElementById('resolution-text').textContent = '0% AI Resolved';
            document.getElementById('resolution-progress-bar').style.width = '0%';
            document.getElementById('quota-text').textContent = '0 messages used this month';
            document.getElementById('funnel-chart-container').innerHTML = '<p style="color:#999;text-align:center;">No data yet.</p>';
            return;
        }

        // ── Compute core metrics ──
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
        const leadsCount = globalLeadsData.length;
        const convRate = totalQueries > 0 ? Math.round((leadsCount / uniqueUsers) * 100) : 0;

        let topLang = 'en', topLangCount = 0;
        Object.entries(langCounts).forEach(([l, c]) => { if (c > topLangCount) { topLang = l; topLangCount = c; } });

        const sortedDates = [...data].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
        const recentDate = sortedDates.length ? new Date(sortedDates[0].created_at).toLocaleDateString() : 'N/A';

        // ── KPI Updates ──
        document.getElementById('metric-total-queries').textContent = totalQueries;
        document.getElementById('metric-unique-users').textContent = uniqueUsers;
        document.getElementById('metric-intents').textContent = Object.keys(intentCounts).length;
        document.getElementById('metric-ai-resolved').textContent = resolvedCount;
        document.getElementById('metric-human-handover').textContent = humanCount;
        document.getElementById('metric-resolution').textContent = resRate + '%';
        document.getElementById('metric-leads-count').textContent = leadsCount;
        document.getElementById('metric-conversion-rate').textContent = convRate + '%';
        document.getElementById('metric-language').textContent = topLang.toUpperCase();
        document.getElementById('metric-recent').textContent = recentDate;
        document.getElementById('resolution-text').textContent = resRate + '% AI Resolved';
        document.getElementById('resolution-progress-bar').style.width = resRate + '%';

        // ── Quota ──
        try {
            if (!_tenantInfoLoaded) {
                const res2 = await fetch(`${API_BASE}/admin/tenant-info?tenant_id=${tenantId}`);
                if (res2.ok) {
                    const info = await res2.json();
                    _tenantInfoLoaded = info;
                    _applyQuota(info, globalChatsData);
                }
            } else {
                _applyQuota(_tenantInfoLoaded, globalChatsData);
            }
        } catch(e) { console.error('Quota error', e); }

        // ─────────────────────────────────────────────────
        // CHART 1 — Intent Distribution (Pie)
        // ─────────────────────────────────────────────────
        const intentLabels = Object.keys(intentCounts);
        const intentValues = Object.values(intentCounts);
        _activeChartInstances['intent-pie'] = new Chart(document.getElementById('chart-intent-pie'), {
            type: 'doughnut',
            data: {
                labels: intentLabels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
                datasets: [{ data: intentValues, backgroundColor: CHART_COLORS, borderWidth: 2, borderColor: '#fff' }]
            },
            options: {
                responsive: true, maintainAspectRatio: true,
                plugins: { legend: { position: 'bottom', labels: { padding: 14, font: { size: 12 } } } }
            }
        });

        // ─────────────────────────────────────────────────
        // CHART 2 — Conversations Over Time (Line)
        // ─────────────────────────────────────────────────
        const dayMap = {};
        data.forEach(d => {
            const day = d.created_at.substring(0, 10);
            dayMap[day] = (dayMap[day] || 0) + 1;
        });
        const dayLabels = Object.keys(dayMap).sort();
        const dayValues = dayLabels.map(d => dayMap[d]);
        _activeChartInstances['convos-line'] = new Chart(document.getElementById('chart-convos-line'), {
            type: 'line',
            data: {
                labels: dayLabels,
                datasets: [{
                    label: 'Conversations',
                    data: dayValues,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99,102,241,0.1)',
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#6366f1',
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } },
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });

        // ─────────────────────────────────────────────────
        // CHART 3 — AI vs Human Resolution Over Time (Line)
        // ─────────────────────────────────────────────────
        const resDayAI = {}, resDayHuman = {};
        data.forEach(d => {
            const day = d.created_at.substring(0, 10);
            if (d.is_resolved) resDayAI[day] = (resDayAI[day] || 0) + 1;
            else resDayHuman[day] = (resDayHuman[day] || 0) + 1;
        });
        const resDayLabels = [...new Set([...Object.keys(resDayAI), ...Object.keys(resDayHuman)])].sort();
        _activeChartInstances['resolution-line'] = new Chart(document.getElementById('chart-resolution-line'), {
            type: 'line',
            data: {
                labels: resDayLabels,
                datasets: [
                    {
                        label: 'AI Resolved',
                        data: resDayLabels.map(d => resDayAI[d] || 0),
                        borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)',
                        fill: true, tension: 0.4, pointRadius: 3
                    },
                    {
                        label: 'Human Required',
                        data: resDayLabels.map(d => resDayHuman[d] || 0),
                        borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)',
                        fill: true, tension: 0.4, pointRadius: 3
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: true,
                plugins: { legend: { position: 'top' } },
                scales: { x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } }, y: { beginAtZero: true } }
            }
        });

        // ─────────────────────────────────────────────────
        // CHART 4 — Top 10 Questions (Horizontal Bar)
        // ─────────────────────────────────────────────────
        const qMap = {};
        data.forEach(d => { if (d.question) qMap[d.question] = (qMap[d.question] || 0) + 1; });
        const topQ = Object.entries(qMap).sort((a,b) => b[1] - a[1]).slice(0, 10);
        const topQLabels = topQ.map(([q]) => q.length > 35 ? q.substring(0,35)+'…' : q);
        const topQValues = topQ.map(([,c]) => c);
        _activeChartInstances['top-questions'] = new Chart(document.getElementById('chart-top-questions'), {
            type: 'bar',
            data: {
                labels: topQLabels,
                datasets: [{ label: 'Count', data: topQValues, backgroundColor: CHART_COLORS.slice(0,10), borderRadius: 6 }]
            },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { ticks: { font: { size: 10 } } } }
            }
        });

        // ─────────────────────────────────────────────────
        // CHART 5 — Language Distribution (Pie)
        // ─────────────────────────────────────────────────
        const langLabels = Object.keys(langCounts).map(l => l.toUpperCase());
        const langValues = Object.values(langCounts);
        _activeChartInstances['language-pie'] = new Chart(document.getElementById('chart-language-pie'), {
            type: 'pie',
            data: {
                labels: langLabels,
                datasets: [{ data: langValues, backgroundColor: ['#6366f1','#0ea5e9','#f59e0b','#10b981','#ef4444'], borderWidth: 2, borderColor: '#fff' }]
            },
            options: {
                responsive: true, maintainAspectRatio: true,
                plugins: { legend: { position: 'bottom', labels: { padding: 14 } } }
            }
        });

        // ─────────────────────────────────────────────────
        // CHART 6 — Peak Usage by Hour (Bar)
        // ─────────────────────────────────────────────────
        const hourMap = new Array(24).fill(0);
        data.forEach(d => {
            const h = new Date(d.created_at).getHours();
            hourMap[h]++;
        });
        const hourLabels = Array.from({length:24}, (_,i) => i + ':00');
        _activeChartInstances['peak-hours'] = new Chart(document.getElementById('chart-peak-hours'), {
            type: 'bar',
            data: {
                labels: hourLabels,
                datasets: [{
                    label: 'Messages',
                    data: hourMap,
                    backgroundColor: hourMap.map(v => {
                        const max = Math.max(...hourMap);
                        const alpha = max > 0 ? 0.3 + (v/max)*0.7 : 0.3;
                        return `rgba(99,102,241,${alpha.toFixed(2)})`;
                    }),
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: { x: { ticks: { maxTicksLimit: 12, font: { size: 9 } } }, y: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });

        // ─────────────────────────────────────────────────
        // FUNNEL — Lead Conversion (CSS-based)
        // ─────────────────────────────────────────────────
        const funnelContainer = document.getElementById('funnel-chart-container');
        funnelContainer.innerHTML = '';
        const funnelSteps = [
            { label: 'Total Visitors (Sessions)', value: uniqueUsers, color: '#6366f1' },
            { label: 'Started a Chat', value: totalQueries, color: '#0ea5e9' },
            { label: 'Asked Pricing / Info', value: (intentCounts['pricing'] || 0) + (intentCounts['information'] || 0), color: '#f59e0b' },
            { label: 'Contact Requested', value: intentCounts['contact'] || 0, color: '#10b981' },
            { label: 'Lead Captured', value: leadsCount, color: '#ec4899' }
        ];
        const maxFunnelVal = funnelSteps[0].value || 1;
        funnelSteps.forEach((step, i) => {
            const pct = Math.round((step.value / maxFunnelVal) * 100);
            const convPct = i > 0 && funnelSteps[i-1].value > 0
                ? Math.round((step.value / funnelSteps[i-1].value) * 100) : 100;
            const div = document.createElement('div');
            div.style.cssText = `width: ${Math.max(pct, 10)}%; max-width: 100%; background: ${step.color};
                color: white; border-radius: 6px; padding: 0.55rem 1.2rem;
                display: flex; justify-content: space-between; align-items: center;
                transition: width 0.5s ease; font-weight: 600; font-size: 0.88rem; min-width: 180px;`;
            div.innerHTML = `<span>${step.label}</span><span style="opacity:0.9">${step.value} ${i>0?'('+convPct+'%)':''}</span>`;
            funnelContainer.appendChild(div);
        });
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
        const pctLabel = document.getElementById('quota-pct-label');
        if (limit >= 999999) {
            textEl.textContent = `${monthlyUsed} Messages (Unlimited Plan)`;
            progressEl.style.width = '100%';
            progressEl.style.background = '#107c41';
            if (pctLabel) pctLabel.textContent = 'Unlimited';
        } else {
            textEl.textContent = `${monthlyUsed} / ${limit} Messages Used`;
            let pct = Math.min((monthlyUsed / limit) * 100, 100);
            progressEl.style.width = `${pct}%`;
            if (pctLabel) pctLabel.textContent = pct.toFixed(1) + '%';
            if (pct > 90) progressEl.style.background = 'var(--danger-color)';
            else if (pct > 75) progressEl.style.background = 'orange';
            else progressEl.style.background = 'var(--primary-color)';
        }
    }

    async function renderLeads() {
        leadsList.innerHTML = '';
        try {
            const res = await fetch(`${API_BASE}/admin/leads?tenant_id=${tenantId}`);
            if (!res.ok) { noLeads.style.display = 'block'; return; }
            const leads = await res.json();
            globalLeadsData = leads || [];

            if (!leads || leads.length === 0) {
                noLeads.style.display = 'block';
                return;
            }
            noLeads.style.display = 'none';

            leads.forEach(lead => {
                const tr = document.createElement('tr');
                const contactInfo = [lead.name, lead.phone, lead.email].filter(Boolean).join(' · ');
                tr.innerHTML = `
                    <td style="white-space:nowrap"><small>${new Date(lead.created_at).toLocaleString()}</small></td>
                    <td><strong>${escapeHTML(contactInfo)}</strong></td>
                    <td>${escapeHTML(lead.raw_message || '')}</td>
                    <td><small style="color:var(--text-muted)">${escapeHTML((lead.session_id || '').substring(0, 8))}...</small></td>
                `;
                leadsList.appendChild(tr);
            });
        } catch (err) {
            console.error('Failed to load leads', err);
            noLeads.style.display = 'block';
        }
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

                document.getElementById('profile-logo-url').value = profile.logo_url || '';
                document.getElementById('profile-chatbot-greeting').value = profile.chatbot_greeting_message || '';
                document.getElementById('profile-chatbot-prompt').value = profile.chatbot_system_prompt || '';

                // ── Update sidebar brand logo ──
                const logoImg = document.getElementById('sidebar-logo-img');
                const logoPlaceholder = document.getElementById('sidebar-logo-placeholder');
                const sidebarName = document.getElementById('sidebar-company-name');
                if (profile.logo_url && logoImg) {
                    logoImg.src = profile.logo_url;
                    logoImg.style.display = 'block';
                    if (logoPlaceholder) logoPlaceholder.style.display = 'none';
                } else if (logoPlaceholder) {
                    // Show initials as fallback
                    const initials = (profile.company_name || 'C').trim().charAt(0).toUpperCase();
                    logoPlaceholder.textContent = initials;
                    logoPlaceholder.style.display = 'flex';
                    if (logoImg) logoImg.style.display = 'none';
                }
                // Also set company name if not already set by loadTenantInfo
                if (sidebarName && sidebarName.textContent === 'Loading...') {
                    sidebarName.textContent = profile.company_name || 'Dashboard';
                }
                
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
            if (res.ok) {
                showToast('Profile saved successfully!');
                showMessage(profileMsg, '', '');
            }
            else showToast('Failed to save profile');
        } catch (err) {
            showToast('Connection error');
        }
    });

    // --- Chatbot Settings Form (dedicated page) ---
    const chatbotSettingsForm = document.getElementById('chatbot-settings-form');
    if (chatbotSettingsForm) {
        chatbotSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msgEl = document.getElementById('chatbot-settings-msg');
            if (msgEl) msgEl.textContent = 'Saving...';
            try {
                const payload = {
                    logo_url: document.getElementById('profile-logo-url').value,
                    chatbot_greeting_message: document.getElementById('profile-chatbot-greeting').value,
                    chatbot_system_prompt: document.getElementById('profile-chatbot-prompt').value
                };
                const res = await fetch(`${API_BASE}/admin/profile?tenant_id=${tenantId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    showToast('Chatbot settings saved!');
                    if (msgEl) msgEl.textContent = '';
                } else {
                    showToast('Failed to save chatbot settings');
                }
            } catch (err) {
                showToast('Connection error');
            }
        });
    }

    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            tenant_id: tenantId,
            old_password: document.getElementById('old-pwd').value,
            new_password: document.getElementById('new-pwd').value
        };

        try {
            const res = await fetch(`${API_BASE}/admin/change-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                showToast('Password changed!');
                passwordForm.reset();
            } else {
                const data = await res.json();
                showToast(data.detail || 'Failed to change password');
            }
        } catch (err) {
            showToast('Connection error');
        }
    });

    // --- AI Training Inner Tab Switching ---
    function initAiTrainingTabs() {
        document.querySelectorAll('.ai-tab-btn').forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
                // Update button styles
                document.querySelectorAll('.ai-tab-btn').forEach(b => {
                    b.style.borderBottom = '3px solid transparent';
                    b.style.color = 'var(--text-muted)';
                });
                tabBtn.style.borderBottom = '3px solid var(--primary-color)';
                tabBtn.style.color = 'var(--primary-color)';

                // Show/hide panels
                const targetTab = tabBtn.dataset.tab;
                document.querySelectorAll('.ai-tab-panel').forEach(panel => {
                    panel.style.display = panel.id === targetTab ? 'block' : 'none';
                });
            });
        });
    }

    // --- Live Character Counters ---
    function initCharCounters() {
        const counters = [
            { inputId: 'faq-q',                  counterId: 'cnt-faq-q',    max: 500  },
            { inputId: 'faq-a',                  counterId: 'cnt-faq-a',    max: 1000 },
            { inputId: 'biz-desc',               counterId: 'cnt-biz-desc', max: 2000 },
            { inputId: 'profile-chatbot-greeting', counterId: 'cnt-greeting', max: 300 },
            { inputId: 'profile-chatbot-prompt', counterId: 'cnt-prompt',   max: 3000 },
        ];
        counters.forEach(({ inputId, counterId, max }) => {
            const input = document.getElementById(inputId);
            const counter = document.getElementById(counterId);
            if (!input || !counter) return;
            const update = () => {
                const len = input.value.length;
                counter.textContent = len;
                counter.style.color = len >= max * 0.9 ? (len >= max ? '#dc2626' : '#f59e0b') : '#999';
            };
            input.addEventListener('input', update);
            update(); // initialise on load
        });
    }

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
                showToast('FAQ added successfully!');
            } else {
                showToast('Failed to add FAQ');
            }
        } catch (err) {
            showToast('Connection error');
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
            if (res.ok) {
                loadFaqs();
                showToast('FAQ deactivated');
            }
            else showToast('Failed to deactivate');
        } catch (err) { showToast('Connection error'); }
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
                showToast('Document uploaded successfully!');
            } else {
                const data = await res.json();
                uploadStatus.style.color = 'red';
                uploadStatus.textContent = ` ${data.detail || 'Upload failed'}`;
                showToast('Upload failed');
            }
        } catch (err) {
            uploadStatus.style.color = 'red';
            uploadStatus.textContent = ' Connection error during upload';
            showToast('Connection error');
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
            const isUrl = d.file_type === 'url';
            const sourceDisplay = isUrl
                ? `<a href="${escapeHTML(d.filename)}" target="_blank" style="color:#0066cc;word-break:break-all;font-size:0.85rem;">${escapeHTML(d.filename.replace(/^https?:\/\//, '').substring(0, 60))}${d.filename.length > 60 ? '…' : ''}</a>`
                : `<strong>${escapeHTML(d.filename)}</strong>`;
            const typeLabel = isUrl
                ? `<span style="background:#eef2ff;color:#4338ca;padding:2px 7px;border-radius:20px;font-size:0.78rem;font-weight:600;">🔗 URL</span>`
                : `<code style="background:#f5f5f5;padding:2px 4px;">${escapeHTML(d.file_type).toUpperCase()}</code>`;
            tr.innerHTML = `
                <td style="white-space:nowrap"><small>${new Date(d.created_at).toLocaleDateString()}</small></td>
                <td>${sourceDisplay}</td>
                <td>${typeLabel}</td>
                <td><span style="color:${d.is_active?'#107c41':'#666'}">${d.is_active ? 'Active' : 'Archived'}</span></td>
                <td>
                    ${d.is_active ? `<button class="btn danger-btn" onclick="deleteDoc('${d.id}')" style="padding:0.2rem 0.6rem;font-size:0.75rem;">Delete</button>` : '-'}
                </td>
            `;
            docsList.appendChild(tr);
        });
    }

    // --- URL Add Handler ---
    const addUrlForm = document.getElementById('add-url-form');
    const urlInput = document.getElementById('url-input');
    const urlStatus = document.getElementById('url-status');

    if (addUrlForm) {
        addUrlForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const url = urlInput.value.trim();
            if (!url) return;

            const btn = document.getElementById('btn-add-url');
            btn.disabled = true;
            urlStatus.style.display = 'block';
            urlStatus.style.color = '#666';
            urlStatus.textContent = '🔄 Scraping page... This may take a moment.';

            try {
                const res = await fetch(`${API_BASE}/admin/add-url?tenant_id=${tenantId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });

                if (res.ok) {
                    urlStatus.style.color = '#107c41';
                    urlStatus.textContent = '✅ URL scraped and added to knowledge base!';
                    addUrlForm.reset();
                    loadDocs();
                    showToast('URL added successfully!');
                } else {
                    const data = await res.json();
                    urlStatus.style.color = 'red';
                    urlStatus.textContent = `❌ ${data.detail || 'Failed to scrape URL'}`;
                }
            } catch (err) {
                urlStatus.style.color = 'red';
                urlStatus.textContent = '❌ Connection error. Please try again.';
            } finally {
                btn.disabled = false;
                setTimeout(() => { if (urlStatus.style.color === 'rgb(16, 124, 65)') urlStatus.style.display = 'none'; }, 6000);
            }
        });
    }

    window.deleteDoc = async (id) => {
        if (!confirm('Delete this document? The AI will instantly forget its contents.')) return;
        try {
            const res = await fetch(`${API_BASE}/admin/doc/${id}?tenant_id=${tenantId}`, { method: 'DELETE' });
            if (res.ok) {
                loadDocs();
                showToast('Document deleted');
            }
            else showToast('Failed to delete document');
        } catch (err) { showToast('Connection error'); }
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
