// @ts-nocheck
interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

let conversationHistory: HistoryEntry[] = [];
let isProcessing = false;
let selectedModel = 'glm-5.1'; // default; overridden once loadModels() resolves

// Populate model selector buttons from /api/assistant/models
async function loadModels() {
    try {
        const res = await fetch('/api/assistant/models');
        if (!res.ok) return;
        const data = await res.json();
        selectedModel = data.default || 'glm-5.1';

        const container = document.getElementById('modelSelector');
        // keep the label, remove any existing buttons
        const label = container.querySelector('.model-selector-label');
        container.innerHTML = '';
        container.appendChild(label);

        data.models.forEach(m => {
            const btn = document.createElement('button');
            btn.className = 'model-btn' + (m.key === selectedModel ? ' active' : '');
            btn.dataset.key = m.key;
            btn.textContent = m.label;
            btn.addEventListener('click', () => selectModel(m.key));
            container.appendChild(btn);
        });
    } catch (_) {
        // silently ignore — model selector just won't render
    }
}

function selectModel(key) {
    selectedModel = key;
    document.querySelectorAll('.model-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.key === key);
    });
}

// Check AI status
async function checkStatus() {
    try {
        const response = await fetch('/api/assistant/health');
        const data = await response.json();

        const indicator = document.getElementById('statusIndicator');
        if (data.status === 'ok') {
            indicator.className = 'status-indicator';
            indicator.innerHTML = '<span class="status-dot"></span><span>AI Engineer Online</span>';
        } else {
            indicator.className = 'status-indicator offline';
            indicator.innerHTML = '<span class="status-dot"></span><span>AI Offline</span>';
        }
    } catch (error) {
        const indicator = document.getElementById('statusIndicator');
        indicator.className = 'status-indicator offline';
        indicator.innerHTML = '<span class="status-dot"></span><span>Connection Error</span>';
    }
}

// Auto-resize textarea
const chatInput = document.getElementById('chatInput');
chatInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 150) + 'px';
});

// Send on Enter (Shift+Enter for new line)
chatInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function askQuestion(question) {
    chatInput.value = question;
    sendMessage();
}

function addMessage(role, content) {
    const messagesContainer = document.getElementById('chatMessages');

    // Remove welcome message if exists
    const welcome = messagesContainer.querySelector('.welcome-message');
    if (welcome) {
        welcome.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🏁';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // Format message content (basic markdown-like formatting)
    let formattedContent = content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

    contentDiv.innerHTML = formattedContent;

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showTypingIndicator() {
    const messagesContainer = document.getElementById('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant';
    typingDiv.id = 'typingIndicator';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '🏁';

    const typingContent = document.createElement('div');
    typingContent.className = 'typing-indicator active';
    typingContent.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';

    typingDiv.appendChild(avatar);
    typingDiv.appendChild(typingContent);

    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function hideTypingIndicator() {
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

async function sendMessage() {
    if (isProcessing) return;

    const message = chatInput.value.trim();
    if (!message) return;

    isProcessing = true;
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.disabled = true;
    chatInput.disabled = true;

    // Add user message to UI
    addMessage('user', message);
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Show typing indicator
    showTypingIndicator();

    try {
        const response = await fetch('/api/assistant/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                conversation_history: conversationHistory,
                model: selectedModel
            })
        });

        hideTypingIndicator();

        if (response.ok) {
            const data = await response.json();

            // Add assistant response to UI
            addMessage('assistant', data.response);

            // Update conversation history
            conversationHistory.push({
                role: 'user',
                content: message
            });
            conversationHistory.push({
                role: 'assistant',
                content: data.response
            });

            // Keep only last 10 messages in history to avoid token limits
            if (conversationHistory.length > 20) {
                conversationHistory = conversationHistory.slice(-20);
            }
        } else {
            const error = await response.json();
            addMessage('assistant', `❌ Error: ${error.error || 'Failed to get response'}`);
        }
    } catch (error) {
        hideTypingIndicator();
        console.error('Chat error:', error);
        addMessage('assistant', '❌ Network error. Please check your connection and try again.');
    } finally {
        isProcessing = false;
        sendBtn.disabled = false;
        chatInput.disabled = false;
        chatInput.focus();
    }
}

// Initialize
loadModels();
checkStatus();
chatInput.focus();

// Refresh status every 5 minutes (health check is cached server-side)
setInterval(checkStatus, 300000);

// Expose functions referenced by inline onclick attributes
(window as any).askQuestion = askQuestion;
(window as any).sendMessage = sendMessage;
