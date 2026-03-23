// Widget specific isolated JS
(function() {
    const API_BASE = 'https://chat-bot-1-neu-1.onrender.com';
    
    // Get tenant ID from URL for testing, or use a default
    const urlParams = new URLSearchParams(window.location.search);
    const tenantId = urlParams.get('tenant_id') || 'test_tenant';
    
    // Generate a simple session ID
    if (!sessionStorage.getItem('cb_session_id')) {
        sessionStorage.setItem('cb_session_id', 'sess_' + Math.random().toString(36).substring(2, 9));
    }
    const sessionId = sessionStorage.getItem('cb_session_id');

    window.addEventListener('DOMContentLoaded', () => {
        const toggleBtn = document.getElementById('cb-toggle-btn');
        const closeBtn = document.getElementById('cb-close-btn');
        const cbWindow = document.getElementById('cb-window');
        const cbForm = document.getElementById('cb-form');
        const cbInput = document.getElementById('cb-input');
        const msgsArea = document.getElementById('cb-messages');
        const sendBtn = document.getElementById('cb-send-btn');
        const titleEl = document.querySelector('.cb-title');

        // Fetch company profile to update chat title AND the Demo Page
        fetch(`${API_BASE}/admin/profile?tenant_id=${tenantId}`)
            .then(res => res.json())
            .then(data => {
                const companyName = (data && data.company_name) ? data.company_name : tenantId;
                if (titleEl) titleEl.textContent = companyName + " Support";
                
                // Update Demo page elements if they exist
                const demoTitle = document.getElementById('demo-title');
                if (demoTitle) {
                    demoTitle.textContent = companyName;
                }
            })
            .catch(e => console.error("Could not load company profile:", e));

        let isOpen = false;

        toggleBtn.addEventListener('click', () => {
            isOpen = true;
            renderView();
            // initialize if first time
            if (msgsArea.querySelectorAll('.cb-msg:not(.cb-system)').length === 0) {
                appendMsg('system', 'Connected to secure chat. How can we help?');
            }
            // focus input
            setTimeout(() => cbInput.focus(), 100);
        });

        closeBtn.addEventListener('click', () => {
            isOpen = false;
            renderView();
        });

        function renderView() {
            if (isOpen) {
                cbWindow.style.display = 'flex';
                // optional: hide toggle button on mobile
                if(window.innerWidth <= 480) toggleBtn.style.display = 'none';
            } else {
                cbWindow.style.display = 'none';
                toggleBtn.style.display = 'flex';
            }
        }

        cbForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = cbInput.value.trim();
            if (!text) return;

            appendMsg('user', text);
            cbInput.value = '';
            
            const typingId = showTyping();
            
            try {
                const res = await fetch(`${API_BASE}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        question: text,
                        session_id: sessionId,
                        tenant_id: tenantId,
                        page_url: window.location.href,
                        language: 'en'
                    })
                });

                removeTyping(typingId);

                if (res.ok) {
                    const data = await res.json();
                    appendMsg('bot', data.answer);
                } else {
                    const err = await res.json();
                    appendMsg('system', `Error: ${err.detail || 'Service unavailable'}`);
                }
            } catch (err) {
                removeTyping(typingId);
                appendMsg('system', 'Connection failed. Please try again later.');
            }
        });

        function appendMsg(sender, text) {
            const div = document.createElement('div');
            div.className = `cb-msg cb-${sender}`;
            
            if (sender === 'bot') {
                // If marked.js is available, use it, otherwise simple escape
                if (typeof marked !== 'undefined') {
                    div.innerHTML = marked.parse(text);
                } else {
                    div.textContent = text;
                }
            } else {
                div.textContent = text;
            }
            
            msgsArea.appendChild(div);
            scrollToBottom();
        }

        function showTyping() {
            const id = 'typing-' + Date.now();
            const div = document.createElement('div');
            div.className = 'cb-msg cb-bot';
            div.id = id;
            div.innerHTML = `<div class="cb-typing"><div class="cb-dot"></div><div class="cb-dot"></div><div class="cb-dot"></div></div>`;
            msgsArea.appendChild(div);
            scrollToBottom();
            return id;
        }

        function removeTyping(id) {
            const el = document.getElementById(id);
            if (el) el.remove();
        }

        function scrollToBottom() {
            msgsArea.scrollTop = msgsArea.scrollHeight;
        }
    });

})();
