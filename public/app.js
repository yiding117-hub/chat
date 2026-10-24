const authScreen = document.getElementById('auth-screen');
const chatScreen = document.getElementById('chat-screen');
const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const authError = document.getElementById('auth-error');
const loginBtn = document.getElementById('login-btn');
const signupBtn = document.getElementById('signup-btn');
const whoami = document.getElementById('whoami');
const logoutBtn = document.getElementById('logout-btn');
const enablePushBtn = document.getElementById('enable-push-btn');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

let currentUser = null;
let socket = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function renderMessage(msg) {
  const div = document.createElement('div');
  div.className = 'msg' + (currentUser && msg.user_id === currentUser.id ? ' mine' : '');
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `<span class="meta">${msg.username} · ${time}</span>${escapeHtml(msg.body)}`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showChatScreen() {
  authScreen.hidden = true;
  chatScreen.hidden = false;
  whoami.textContent = currentUser.username;
}

function showAuthScreen() {
  chatScreen.hidden = true;
  authScreen.hidden = false;
  messagesEl.innerHTML = '';
}

async function loadHistory() {
  const { messages } = await api('/api/messages');
  messagesEl.innerHTML = '';
  messages.forEach(renderMessage);
}

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io();
  socket.on('message', renderMessage);
}

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push notifications are not supported in this browser.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    alert('Notification permission was not granted.');
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('/api/vapid-public-key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  await api('/api/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
  enablePushBtn.textContent = 'Notifications on';
  enablePushBtn.disabled = true;
}

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(console.error);
  }

  const { user } = await api('/api/me');
  if (user) {
    currentUser = user;
    showChatScreen();
    await loadHistory();
    connectSocket();
  }
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value }),
    });
    currentUser = data;
    showChatScreen();
    await loadHistory();
    connectSocket();
  } catch (err) {
    authError.textContent = err.message;
  }
});

signupBtn.addEventListener('click', async () => {
  authError.textContent = '';
  try {
    const data = await api('/api/signup', {
      method: 'POST',
      body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value }),
    });
    currentUser = data;
    showChatScreen();
    await loadHistory();
    connectSocket();
  } catch (err) {
    authError.textContent = err.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  currentUser = null;
  if (socket) socket.disconnect();
  showAuthScreen();
});

enablePushBtn.addEventListener('click', () => {
  enablePush().catch((err) => alert(err.message));
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const body = messageInput.value.trim();
  if (!body || !socket) return;
  socket.emit('message', body);
  messageInput.value = '';
});

init();
