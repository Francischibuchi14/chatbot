// DOM Elements
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const chatMessages = document.getElementById('chat-messages');
const modelSelector = document.getElementById('model-selector');
const clearButton = document.getElementById('clear-button'); // Add to HTML

// Configuration
const API_ENDPOINT = 'http://localhost:5000/api/chat';
const DEFAULT_TIMEOUT = 120000; // 2 minutes for local Qwen
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds between retries

// State Management
let abortController = null;
let messageHistory = [];
let isProcessing = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadChatHistory();
    setupEventListeners();
});

function setupEventListeners() {
    sendButton.addEventListener('click', sendMessage);
    clearButton?.addEventListener('click', clearChat);
    
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.shiftKey) {
            return; // Allow default behavior (new line)
        }
    });
}

function addMessage(content, isUser, modelInfo = null) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(isUser ? 'user-message' : 'ai-message');
    
    if (modelInfo && !isUser) {
        const modelTag = document.createElement('div');
        modelTag.classList.add('model-tag');
        modelTag.textContent = `Qwen3-4B`;
        messageDiv.appendChild(modelTag);
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    // Convert URLs to clickable links
    contentDiv.innerHTML = isUser ? content : autolink(content);
    
    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Save to history
    if (!isUser) {
        messageHistory.push({ content, isUser, timestamp: new Date() });
        saveChatHistory();
    }
}

function autolink(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, url => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
}

// Update your showTypingIndicator function to this:
function showTypingIndicator() {
    hideTypingIndicator();
    
    const typingDiv = document.createElement('div');
    typingDiv.classList.add('typing-indicator');
    typingDiv.id = 'typing-indicator';
    typingDiv.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <span>AI is thinking...</span>
    `;
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Update your CSS in the HTML head to include this:
const style = document.createElement('style');
style.textContent = `
.typing-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background-color: var(--ai-bubble);
    border-radius: var(--border-radius);
    margin-bottom: 1rem;
    width: fit-content;
    color: var(--text-secondary);
    font-size: 0.9rem;
}

.typing-dot {
    width: 8px;
    height: 8px;
    background-color: var(--accent);
    border-radius: 50%;
    animation: typingAnimation 1.4s infinite ease-in-out;
}

@keyframes typingAnimation {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.6; }
    30% { transform: translateY(-3px); opacity: 1; }
}
`;
document.head.appendChild(style);


function hideTypingIndicator() {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

function setUIState(disabled) {
    chatInput.disabled = disabled;
    sendButton.disabled = disabled;
    if (modelSelector) modelSelector.disabled = disabled;
    isProcessing = disabled;
}

async function sendMessage() {
    if (isProcessing) return;
    
    const message = chatInput.value.trim();
    if (!message) return;
    
    // Abort any previous request
    if (abortController) {
        abortController.abort();
    }
    
    abortController = new AbortController();
    addMessage(message, true);
    chatInput.value = '';
    showTypingIndicator();
    setUIState(true);
    
    try {
        const response = await retryFetch(
            () => makeAPIRequest(message),
            MAX_RETRIES,
            RETRY_DELAY
        );
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.details || data.error);
        }
        
        addMessage(data.reply, false, true);
    } catch (error) {
        handleAPIError(error);
    } finally {
        setUIState(false);
        abortController = null;
    }
}

async function makeAPIRequest(message) {
    const timeoutId = setTimeout(() => {
        abortController.abort();
    }, DEFAULT_TIMEOUT);
    
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
            signal: abortController.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

async function retryFetch(fetchFn, maxRetries, delay) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fetchFn();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

function handleAPIError(error) {
    hideTypingIndicator();
    
    if (error.name === 'AbortError') {
        console.log('Request was aborted');
        return;
    }
    
    const errorMessage = error.message.includes('timeout') ?
        "Response timed out. Qwen3-4B might need more time." :
        error.message.includes('Failed to fetch') ?
        "Connection error. Please check your network." :
        `Error: ${error.message}`;
    
    addMessage(errorMessage, false);
    console.error('API Error:', error);
}

function clearChat() {
    if (isProcessing) return;
    
    chatMessages.innerHTML = '';
    messageHistory = [];
    localStorage.removeItem('chatHistory');
    // Add a welcome message
    addMessage("Hello! How can I help you today?", false, true);
}

function saveChatHistory() {
    if (messageHistory.length > 50) { // Keep last 50 messages
        messageHistory = messageHistory.slice(-50);
    }
    localStorage.setItem('chatHistory', JSON.stringify(messageHistory));
}

function loadChatHistory() {
    const savedHistory = localStorage.getItem('chatHistory');
    if (savedHistory) {
        try {
            messageHistory = JSON.parse(savedHistory);
            messageHistory.forEach(msg => {
                addMessage(msg.content, msg.isUser, !msg.isUser);
            });
            return;
        } catch (e) {
            console.error('Error loading chat history:', e);
        }
    }
    
    addMessage("Hello! How can I help you today?", false, true);
}