/**
 * Chatbot Widget Embed Script
 * consolidated for easy client integration
 */
(function () {
    const scriptTag = document.currentScript;
    const tenantId = scriptTag ? scriptTag.getAttribute('data-tenant-id') || 'test_tenant' : 'test_tenant';
    const API_BASE = 'https://chat-bot-1-neu-1.onrender.com';

    // 1. Load Fonts
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);

    // 2. Inject CSS
    const style = document.createElement('style');
    style.innerHTML = `
        :root {
            --cb-primary: #c2410c;
            --cb-primary-dark: #9a3412;
            --cb-secondary: #ea580c;
            --cb-gradient: linear-gradient(135deg, #ea580c 0%, #9a3412 100%);
            --cb-bg-light: #ffffff;
            --cb-bg-tint: #fffaf3;
            --cb-text-main: #431407;
            --cb-text-muted: #78716c;
            --cb-border: #e7e5e4;
            --cb-shadow-sm: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
            --cb-shadow-md: 0 10px 15px -3px rgba(0, 0, 0, 0.08);
            --cb-shadow-lg: 0 20px 25px -5px rgba(154, 52, 18, 0.15);
        }

        .cb-container {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 999999;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: var(--cb-text-main);
            -webkit-font-smoothing: antialiased;
        }

        .cb-btn-float {
            width: 60px; height: 60px; border-radius: 50%;
            background: var(--cb-gradient); color: #ffffff;
            border: none; box-shadow: var(--cb-shadow-lg);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); outline: none;
        }

        .cb-btn-float:hover { transform: scale(1.1) rotate(5deg); box-shadow: 0 25px 30px -10px rgba(194, 65, 12, 0.4); }

        .cb-window {
            position: absolute; bottom: 80px; right: 0;
            width: 380px; height: 600px; max-height: calc(100vh - 120px);
            background-color: var(--cb-bg-light); border-radius: 16px;
            box-shadow: var(--cb-shadow-lg); display: none; flex-direction: column;
            overflow: hidden; border: 1px solid var(--cb-border);
            animation: cb-slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes cb-slide-up {
            from { opacity: 0; transform: translateY(20px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .cb-header {
            display: flex; justify-content: space-between; align-items: center;
            padding: 1.25rem 1.5rem; background: var(--cb-gradient); color: white;
        }

        .cb-title { font-family: 'Outfit', sans-serif; font-weight: 600; font-size: 1.1rem; }

        .cb-btn-close {
            background: rgba(255, 255, 255, 0.2); border: none; width: 28px; height: 28px;
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            color: white; cursor: pointer; font-size: 1.2rem; transition: all 0.2s;
        }

        .cb-messages {
            flex: 1; padding: 1.5rem; overflow-y: auto; display: flex;
            flex-direction: column; gap: 1.25rem; background-color: var(--cb-bg-tint);
        }

        .cb-msg-wrapper { display: flex; flex-direction: column; gap: 4px; max-width: 85%; }
        .cb-wrapper-user { align-items: flex-end; align-self: flex-end; }
        .cb-wrapper-bot { align-items: flex-start; align-self: flex-start; }
        .cb-msg-time { font-size: 0.65rem; color: var(--cb-text-muted); }

        .cb-msg { max-width: 100%; font-size: 0.925rem; line-height: 1.6; animation: cb-fade-in 0.3s ease-out; }
        @keyframes cb-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .cb-status { display: flex; align-items: center; gap: 4px; font-size: 0.75rem; color: #ffd8cc; margin-top: 2px; }
        .cb-status-dot { width: 6px; height: 6px; background-color: #4ade80; border-radius: 50%; display: inline-block; }

        .cb-msg.cb-system { align-self: center; color: var(--cb-text-muted); font-size: 0.75rem; background: rgba(0,0,0,0.03); padding: 4px 12px; border-radius: 12px; }
        .cb-msg.cb-user { background: var(--cb-gradient); color: white; padding: 0.875rem 1.125rem; border-radius: 18px 18px 2px 18px; }
        .cb-msg.cb-bot { background-color: var(--cb-bg-light); color: var(--cb-text-main); padding: 0.875rem 1.125rem; border-radius: 18px 18px 18px 2px; border: 1px solid var(--cb-border); }

        .cb-input-area { padding: 1.25rem; border-top: 1px solid var(--cb-border); background-color: var(--cb-bg-light); }
        #cb-form { display: flex; align-items: center; gap: 0.75rem; background: var(--cb-bg-tint); padding: 4px 4px 4px 12px; border-radius: 28px; border: 1px solid var(--cb-border); }
        #cb-input { flex: 1; border: none; background: transparent; padding: 0.6rem 0; font-size: 0.95rem; outline: none; }
        #cb-send-btn { width: 42px; height: 42px; border-radius: 50%; border: none; background: var(--cb-gradient); color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .cb-footer { text-align: center; font-size: 0.7rem; color: var(--cb-text-muted); padding: 0.5rem; }

        .cb-typing { display: inline-flex; align-items: center; gap: 4px; padding: 0.4rem 0.2rem; }
        .cb-dot { width: 6px; height: 6px; background-color: var(--cb-primary); border-radius: 50%; animation: cb-bounce 1.4s infinite ease-in-out both; }
        @keyframes cb-bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; } 40% { transform: scale(1); opacity: 1; } }

        @media (max-width: 480px) {
            .cb-window { bottom: 0; right: 0; border-radius: 0; width: 100vw; height: 100dvh; max-height: none; }
        }
    `;
    document.head.appendChild(style);

    // 3. Inject HTML
    const container = document.createElement('div');
    container.id = 'cb-widget';
    container.className = 'cb-container';
    container.innerHTML = `
        <button id="cb-toggle-btn" class="cb-btn-float" aria-label="Open Chat">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
        </button>
        <div id="cb-window" class="cb-window">
            <div class="cb-header">
                <div>
                    <div class="cb-title">Support Chat</div>
                    <div class="cb-status"><span class="cb-status-dot"></span>Online</div>
                </div>
                <button id="cb-close-btn" class="cb-btn-close" aria-label="Close Chat">&times;</button>
            </div>
            <div id="cb-messages" class="cb-messages">
                <div class="cb-msg cb-system"><p>Connecting...</p></div>
            </div>
            <div class="cb-input-area">
                <form id="cb-form">
                    <input type="text" id="cb-input" placeholder="Type a message..." required autocomplete="off">
                    <button type="submit" id="cb-send-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </form>
            </div>
            <div class="cb-footer">Powered by <a href="https://www.neuaitechnologies.com/" target="_blank" style="color: inherit; text-decoration: none; font-weight: 500;">NEUAI Technologies</a></div>
        </div>
    `;
    document.body.appendChild(container);

    // 4. Logic (from script.js)
    const toggleBtn = document.getElementById('cb-toggle-btn');
    const closeBtn = document.getElementById('cb-close-btn');
    const cbWindow = document.getElementById('cb-window');
    const cbForm = document.getElementById('cb-form');
    const cbInput = document.getElementById('cb-input');
    const msgsArea = document.getElementById('cb-messages');
    const titleEl = document.querySelector('.cb-title');

    let isOpen = false;
    let sessionId = sessionStorage.getItem('cb_session_id') || 'sess_' + Math.random().toString(36).substring(2, 9);
    sessionStorage.setItem('cb_session_id', sessionId);

    fetch(`${API_BASE}/chat/config?tenant_id=${tenantId}`)
        .then(res => res.json())
        .then(data => {
            if (data && data.company_name) titleEl.textContent = data.company_name + " Support";
        });

    toggleBtn.onclick = () => {
        isOpen = true;
        cbWindow.style.display = 'flex';
        if (window.innerWidth <= 480) toggleBtn.style.display = 'none';
        if (msgsArea.querySelectorAll('.cb-msg:not(.cb-system)').length === 0) {
            appendMsg('system', 'Connected to secure chat. How can we help?');
        }
        setTimeout(() => cbInput.focus(), 100);
    };

    closeBtn.onclick = () => {
        isOpen = false;
        cbWindow.style.display = 'none';
        toggleBtn.style.display = 'flex';
    };

    cbForm.onsubmit = async (e) => {
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
                body: JSON.stringify({ question: text, session_id: sessionId, tenant_id: tenantId })
            });
            const data = await res.json();
            removeTyping(typingId);
            appendMsg('bot', data.answer);
        } catch (err) {
            removeTyping(typingId);
            appendMsg('system', 'Connection failed.');
        }
    };

    function appendMsg(sender, text) {
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const wrapper = document.createElement('div');
        wrapper.className = `cb-msg-wrapper cb-wrapper-${sender}`;

        const div = document.createElement('div');
        div.className = `cb-msg cb-${sender}`;
        div.innerHTML = (sender === 'bot' && typeof marked !== 'undefined') ? marked.parse(text) : (sender === 'system' ? text : `<p>${text}</p>`);

        wrapper.appendChild(div);

        if (sender !== 'system') {
            const timeDiv = document.createElement('div');
            timeDiv.className = 'cb-msg-time';
            timeDiv.textContent = timeString;
            wrapper.appendChild(timeDiv);
        }

        msgsArea.appendChild(wrapper);
        msgsArea.scrollTop = msgsArea.scrollHeight;
    }

    function showTyping() {
        const id = 'typing-' + Date.now();
        const wrapper = document.createElement('div');
        wrapper.className = 'cb-msg-wrapper cb-wrapper-bot';
        wrapper.id = id;

        const div = document.createElement('div');
        div.className = 'cb-msg cb-bot';
        div.innerHTML = `<div class="cb-typing"><div class="cb-dot"></div><div class="cb-dot"></div><div class="cb-dot"></div></div>`;

        wrapper.appendChild(div);
        msgsArea.appendChild(wrapper);
        msgsArea.scrollTop = msgsArea.scrollHeight;
        return id;
    }

    function removeTyping(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }
})();
