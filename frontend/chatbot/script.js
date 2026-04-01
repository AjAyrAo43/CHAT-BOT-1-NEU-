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

        let botLogoB64 = null;

        // Fetch company profile to update chat title AND the Demo Page
        fetch(`${API_BASE}/admin/profile?tenant_id=${tenantId}`)
            .then(res => res.json())
            .then(data => {
                const companyName = (data && data.company_name) ? data.company_name : tenantId;
                if (titleEl) titleEl.textContent = companyName + " Support";
                
                if (data && data.logo_url) {
                    botLogoB64 = data.logo_url;
                    const headerAvatar = document.getElementById('cb-header-avatar');
                    if (headerAvatar) {
                        headerAvatar.innerHTML = `<img src="${botLogoB64}" alt="Bot Logo" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                    }
                }
                
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

        function getBotIconHTML() {
            if (botLogoB64) {
                return `<img src="${botLogoB64}" alt="Bot" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
            }
            return `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="12" width="24" height="18" rx="5" fill="white" fill-opacity="0.95"/><rect x="19" y="5" width="2" height="7" rx="1" fill="white" fill-opacity="0.9"/><circle cx="20" cy="4.5" r="2.5" fill="white"/><circle cx="14.5" cy="20" r="3" fill="#ea580c"/><circle cx="25.5" cy="20" r="3" fill="#ea580c"/><circle cx="15.5" cy="19" r="1" fill="white"/><circle cx="26.5" cy="19" r="1" fill="white"/><rect x="13" y="25" width="14" height="2.5" rx="1.25" fill="#ea580c" fill-opacity="0.7"/><rect x="4" y="17" width="4" height="6" rx="2" fill="white" fill-opacity="0.8"/><rect x="32" y="17" width="4" height="6" rx="2" fill="white" fill-opacity="0.8"/></svg>`;
        }

        function appendMsg(sender, text) {
            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            let container = msgsArea;
            
            const msgWrapper = document.createElement('div');
            msgWrapper.className = `cb-msg-wrapper cb-wrapper-${sender}`;
            
            // For bot messages, wrap in a container to hold avatar + bubble
            if (sender === 'bot') {
                container = document.createElement('div');
                container.className = 'cb-msg-container';
                
                // Add tiny bot avatar next to bubble
                const avatar = document.createElement('div');
                avatar.className = 'cb-bot-icon';
                avatar.innerHTML = getBotIconHTML();
                container.appendChild(avatar);
                
                container.appendChild(msgWrapper);
                msgsArea.appendChild(container);
            } else if (sender === 'user') {
                container = document.createElement('div');
                container.className = 'cb-msg-container cb-user-container';
                container.appendChild(msgWrapper);
                msgsArea.appendChild(container);
            } else {
                msgsArea.appendChild(msgWrapper);
            }

            const div = document.createElement('div');
            div.className = `cb-msg cb-${sender}`;
            
            if (sender === 'bot') {
                if (typeof marked !== 'undefined') {
                    div.innerHTML = marked.parse(text);
                } else {
                    div.textContent = text;
                }
            } else {
                div.textContent = text;
            }
            
            msgWrapper.appendChild(div);
            
            if (sender !== 'system') {
                const timeDiv = document.createElement('div');
                timeDiv.className = 'cb-msg-time';
                timeDiv.textContent = timeString;
                msgWrapper.appendChild(timeDiv);
            }
            
            scrollToBottom();
        }

        function showTyping() {
            const id = 'typing-' + Date.now();
            
            const container = document.createElement('div');
            container.className = 'cb-msg-container';
            container.id = id;
            
            const avatar = document.createElement('div');
            avatar.className = 'cb-bot-icon';
            avatar.innerHTML = getBotIconHTML();
            container.appendChild(avatar);
            
            const msgWrapper = document.createElement('div');
            msgWrapper.className = 'cb-msg-wrapper cb-wrapper-bot';

            const div = document.createElement('div');
            div.className = 'cb-msg cb-bot';
            div.innerHTML = `<div class="cb-typing"><div class="cb-dot"></div><div class="cb-dot"></div><div class="cb-dot"></div></div>`;
            
            msgWrapper.appendChild(div);
            container.appendChild(msgWrapper);

            msgsArea.appendChild(container);
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
