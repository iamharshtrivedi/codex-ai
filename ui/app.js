/**
 * Codex AI — Application Logic
 * Modularized and optimized for performance & reliability.
 */

// ── State & Constants ──────────────────────────────────────

const CONFIG = {
  serverUrl: localStorage.getItem('cx_server') || (window.location.protocol === 'file:' ? 'http://localhost:8000' : window.location.origin),
  userId: localStorage.getItem('cx_user') || 'user_1',
  sessionId: localStorage.getItem('cx_session') || '',
  appName: 'codex_agent',
  model: localStorage.getItem('cx_model') || 'gemini-2.5-flash',
};

const UI = {
  userInput: () => document.getElementById('user-input'),
  sendBtn: () => document.getElementById('send-btn'),
  messages: () => document.getElementById('messages'),
  welcome: () => document.getElementById('welcome'),
  sidebar: () => document.getElementById('sidebar'),
  toast: () => document.getElementById('toast'),
  fileInput: () => document.getElementById('file-input'),
  previewStrip: () => document.getElementById('file-preview-strip'),
  modelDropdown: () => document.getElementById('model-dropdown'),
  activeModelName: () => document.getElementById('active-model-name'),
  micBtn: () => document.getElementById('mic-btn'),
  voiceBanner: () => document.getElementById('voice-banner'),
  voiceLabel: () => document.getElementById('voice-transcript')
};

let chatHistory = [];
let currentChatId = localStorage.getItem('cx_session') || '';
let messageLog = [];
let sessionCreated = false;
let sidebarOpen = window.innerWidth > 640;
let editMode = false;
let editingId = null;
let editingIndex = null;
let isThinking = false;
let pendingFiles = [];
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let mediaStream = null;

// ── Initialization ──────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  initUIValues();
  initEventListeners();
  syncSidebarUI();
  updateSaveStatus();
  updateModelUI();
  renderChatList();
  ensureSession();
  initDragDrop();
});

function initUIValues() {
  document.getElementById('server-url').value = CONFIG.serverUrl;
  document.getElementById('user-id').value = CONFIG.userId;
  if (window.innerWidth < 640) sidebarOpen = false;
}

function initEventListeners() {
  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    UI.modelDropdown().classList.remove('active');
  });

  // Global paste for images
  document.addEventListener('paste', handleGlobalPaste);
}

// ── Model Management ────────────────────────────────────────

function toggleModelDropdown(e) {
  e.stopPropagation();
  UI.modelDropdown().classList.toggle('active');
}

async function selectModel(e, model, name) {
  if (e) e.stopPropagation();
  CONFIG.model = model;
  localStorage.setItem('cx_model', model);
  updateModelUI();
  UI.modelDropdown().classList.remove('active');

  try {
    await fetch(`${CONFIG.serverUrl}/api/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model })
    });
    showToast(`Model switched to ${name}`);
  } catch (err) {
    console.warn("Server sync failed:", err);
    showToast(`UI updated, but server sync failed`);
  }
}

function updateModelUI() {
  const nameMap = {
    'gemini-3-flash': 'Gemini 3.1 Flash',
    'gemini-3-pro': 'Gemini 3.Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash'
  };
  UI.activeModelName().textContent = nameMap[CONFIG.model] || CONFIG.model;
  document.querySelectorAll('.model-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.model === CONFIG.model);
  });
}

function mapFrontendToBackendModel(model) {
  const map = {
    'gemini-3-flash': 'gemini-3.1-flash-live-preview',
    'gemini-3-pro': 'gemini-3.1-pro-preview',
    'gemini-2.5-flash': 'gemini-2.5-flash'
  };
  return map[model] || model;
}

// ── Session & History ───────────────────────────────────────

function generateId() { return 'sess_' + Date.now() + Math.random().toString(36).substr(2, 4); }

async function ensureSession() {
  if (!currentChatId) {
    currentChatId = generateId();
    CONFIG.sessionId = currentChatId;
    localStorage.setItem('cx_session', currentChatId);
  }
  sessionCreated = true;
  await fetchSessions();
  if (currentChatId) loadPersistentHistory(currentChatId);
}

async function fetchSessions() {
  try {
    const res = await fetch(`${CONFIG.serverUrl}/api/sessions`);
    if (res.ok) {
      chatHistory = await res.json();
      renderChatList();
    }
  } catch (e) {
    console.error("Failed to fetch sessions:", e);
  }
}

async function saveMessageLocally(sessionId, role, text, files = []) {
  try {
    await fetch(`${CONFIG.serverUrl}/api/history/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        role,
        content: text,
        files: (files && files.length) ? JSON.stringify(files) : null
      })
    });
  } catch (e) {
    console.warn("History persistence failed:", e);
  }
}

async function loadPersistentHistory(sessionId) {
  const msgs = UI.messages();
  msgs.innerHTML = '';

  try {
    const res = await fetch(`${CONFIG.serverUrl}/api/history/${sessionId}`);
    if (!res.ok) throw new Error("Load failed");

    const data = await res.json();

    if (!data || data.length === 0) {
      // No history — keep welcome screen visible
      showWelcome();
      return;
    }

    // Has history — switch to chat view
    showChat();
    data.forEach(msg => {
      if (msg.content?.trim()) {
        let files = [];
        if (msg.files) {
          try { files = JSON.parse(msg.files); } catch (e) { }
        }
        appendMessage(msg.role, msg.content, true, files, msg.agent_name);
      }
    });

    showToast(`Loaded ${data.length} messages`);
  } catch (err) {
    // On error — keep welcome screen
    showWelcome();
  }
}

// ── Messaging Logic ─────────────────────────────────────────

async function sendMessage(text) {
  if (isThinking) return;
  isThinking = true;
  
  const input = UI.userInput();
  const rawMsg = (text !== undefined ? text : input.value).trim();
  if (!rawMsg && pendingFiles.length === 0) {
    isThinking = false;
    return;
  }
  UI.sendBtn().disabled = true;

  const filesToSend = [...pendingFiles];
  clearPendingFiles();
  input.value = '';
  onInput(input);
  showChat();

  // Truncate if editing
  if (editMode && editingId === currentChatId && editingIndex !== null) {
    await handleHistoryTruncation(editingIndex);
  }

  // Ensure valid ID
  if (!currentChatId) {
    currentChatId = generateId();
    CONFIG.sessionId = currentChatId;
    localStorage.setItem('cx_session', currentChatId);
  }

  await saveMessageLocally(currentChatId, 'user', rawMsg, filesToSend);
  appendMessage('user', rawMsg, true, filesToSend);
  
  const thinkRow = appendThinking();

  try {
    const parts = buildMessageParts(rawMsg, filesToSend);
    const res = await fetch(`${CONFIG.serverUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appName: CONFIG.appName,
        userId: CONFIG.userId,
        sessionId: currentChatId,
        model: mapFrontendToBackendModel(CONFIG.model),
        newMessage: { role: 'user', parts },
      }),
    });

    if (!res.ok) throw new Error(`${res.status} — API Error`);

    // Handle Streaming Response
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    
    let fullResponse = "";
    const agentRow = thinkRow;
    const contentEl = agentRow.querySelector('.msg-content');
    let chunkReceived = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      if (!chunkReceived) {
        contentEl.innerHTML = ''; 
        chunkReceived = true;
      }
      
      const chunk = decoder.decode(value, { stream: true });
      fullResponse += chunk;
      contentEl.innerHTML = renderMarkdown(fullResponse);
      scrollToBottom();
    }

    // Final avatar
    const avatar = agentRow.querySelector('.msg-avatar');
    avatar.innerHTML = '🤖';
    
    // Add msg-actions and data-raw-text after stream finishes
    contentEl.dataset.rawText = encodeURIComponent(fullResponse);
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'msg-actions';
    actionsWrap.innerHTML = `
      <button class="msg-action-btn regenerate-btn" onclick="regenerateLastResponse()" title="Regenerate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></button>
      <button class="msg-action-btn copy-btn" onclick="copyMessageText(this)" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
    `;
    agentRow.querySelector('.msg-body').appendChild(actionsWrap);
    
    // Remove regenerate from previous agent messages
    document.querySelectorAll('.msg-row[data-role="agent"] .regenerate-btn').forEach((btn, idx, arr) => {
      if (idx < arr.length - 1) btn.remove();
    });
    
    agentRow.querySelectorAll('pre code').forEach(el => Prism.highlightElement(el));
    initCodeHeaders(agentRow);
    updateSaveStatus(true);
    fetchSessions();
  } catch (err) {
    if (thinkRow) thinkRow.remove();
    appendMessage('agent', `⚠️ **Server error.**\n\n\`\`\`\n${err.message}\n\`\`\``, true);
  } finally {
    isThinking = false;
    UI.sendBtn().disabled = false;
    UI.userInput().focus();
  }
}

async function handleHistoryTruncation(idx) {
  try {
    const rows = [...document.querySelectorAll('.msg-row')];
    // Backend truncate
    await fetch(`${CONFIG.serverUrl}/api/history/truncate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: currentChatId, keep_count: idx })
    });
    // Frontend UI truncate
    for (let i = idx; i < rows.length; i++) rows[i].remove();
  } catch (e) { console.error('Truncate failed:', e); }
  editMode = false;
  editingId = null;
  editingIndex = null;
  document.querySelectorAll('.editing-highlight').forEach(el => el.classList.remove('editing-highlight'));
}

function buildMessageParts(text, files) {
  const parts = [];
  if (text) parts.push({ text });
  files.forEach(f => {
    if (f.isImage) {
      parts.push({ text: `[Image: ${f.name}]` });
    } else {
      parts.push({ text: `[File: ${f.name}]` });
      if (f.textContent) parts.push({ text: `\`\`\`\n${f.textContent.slice(0, 5000)}\n\`\`\`` });
    }
  });
  return parts.length ? parts : [{ text: '' }];
}

// processAgentResponse removed - streaming replaces it

// ── UI Components ───────────────────────────────────────────

function appendMessage(role, text, done = false, files = [], customName = null) {
  const msgs = UI.messages();
  const row = document.createElement('div');
  row.className = 'msg-row';
  row.dataset.role = role;

  const isAgent = role === 'agent' || role === 'assistant';

  // Generate actions
  let actions = '';
  if (role === 'user') {
    actions += `<button class="message-edit-btn" onclick="editPrompt(this)" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  } else {
    actions += `<button class="msg-action-btn regenerate-btn" onclick="regenerateLastResponse()" title="Regenerate"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></button>`;
  }
  
  // Safe copy button using reference to current message text
  actions += `<button class="msg-action-btn copy-btn" onclick="copyMessageText(this)" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>`;

  const innerHTML = `
    <div class="msg-avatar ${role === 'user' ? 'user' : 'agent'}">${isAgent ? (done ? '🤖' : '⌨️') : 'U'}</div>
    <div class="msg-body">
      <div class="msg-name">${role === 'user' ? 'You' : (customName || 'Codex')}</div>
      <div class="msg-content" data-raw-text="${encodeURIComponent(text)}">${done && isAgent ? renderMarkdown(text) : `<p>${text}</p>`}</div>
      ${renderAttachments(files)}
      <div class="msg-actions">${actions}</div>
    </div>
  `;
  row.innerHTML = innerHTML;

  // REMOVE edit and regenerate buttons from all previous rows
  if (role === 'user') {
    msgs.querySelectorAll('.msg-row[data-role="user"] .message-edit-btn').forEach(btn => btn.remove());
  } else if (isAgent) {
    msgs.querySelectorAll('.msg-row[data-role="agent"] .regenerate-btn').forEach(btn => btn.remove());
  }

  msgs.appendChild(row);

  if (done && role === 'agent') {
    row.querySelectorAll('pre code').forEach(el => Prism.highlightElement(el));
    initCodeHeaders(row);
  }

  scrollToBottom();
  return row;
}

function renderAttachments(files) {
  if (!files || !files.length) return '';
  let html = '<div class="msg-attachments">';
  files.forEach(f => {
    if (f.isImage) {
      html += `<img class="msg-img-preview" src="${f.dataUrl}" onclick="openLightbox('${f.dataUrl}')">`;
    } else {
      html += `<div class="msg-file-chip"><div class="file-chip-icon">${fileEmoji(f.name)}</div><div class="file-chip-info"><span>${f.name}</span><small>${formatSize(f.size)}</small></div></div>`;
    }
  });
  return html + '</div>';
}

function appendThinking() {
  const row = document.createElement('div');
  row.className = 'msg-row';
  row.innerHTML = `
    <div class="msg-avatar agent">⌨️</div>
    <div class="msg-body">
      <div class="msg-name">Codex</div>
      <div class="msg-content">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
      </div>
    </div>`;
  UI.messages().appendChild(row);
  scrollToBottom();
  return row;
}

function renderToolPills(calls) {
  const wrap = document.createElement('div');
  wrap.className = 'tool-call-row';
  wrap.innerHTML = calls.map(n => `<span class="tool-call-pill"><span class="tool-pill-dot"></span>${n}()</span>`).join(' ');
  UI.messages().appendChild(wrap);
}

// ── Input Handling ──────────────────────────────────────────

UI.promptInput().addEventListener('keydown', (e) => {
  // Cmd/Ctrl + Enter to send
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    sendMessage();
  }
});

function scrollToBottom() {
  const container = UI.messages();
  container.scrollTo({
    top: container.scrollHeight,
    behavior: 'smooth'
  });
}

function focusInput() {
  UI.promptInput().focus();
}

// ── Utilities ───────────────────────────────────────────────

function showChat() {
  const welcome = UI.welcome();
  const msgs = UI.messages();
  if (welcome) welcome.style.display = 'none';
  if (msgs) msgs.style.display = 'flex';
}

function showWelcome() {
  const welcome = UI.welcome();
  const msgs = UI.messages();
  if (welcome) welcome.style.display = 'flex';
  if (msgs) { msgs.style.display = 'none'; msgs.innerHTML = ''; }
}

function renderMarkdown(raw) {
  if (typeof marked === 'undefined') return raw.replace(/\n/g, '<br>');
  marked.setOptions({ breaks: true, gfm: true });
  return marked.parse(raw);
}

function copyText(val) {
  navigator.clipboard.writeText(val);
  showToast('Copied to clipboard');
}

function showToast(msg) {
  const t = UI.toast();
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function editPrompt(btn) {
  const row = btn.closest('.msg-row');
  const text = row.querySelector('.msg-content p').textContent;
  const idx = [...document.querySelectorAll('.msg-row')].indexOf(row);
  
  UI.userInput().value = text;
  UI.userInput().focus();
  onInput(UI.userInput());

  editMode = true;
  editingId = currentChatId;
  editingIndex = idx;
  document.querySelectorAll('.editing-highlight').forEach(el => el.classList.remove('editing-highlight'));
  row.classList.add('editing-highlight');
  showToast('Editing prompt... send to resume from here.');
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function onInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  UI.sendBtn().classList.toggle('ready', el.value.trim().length > 0 || pendingFiles.length > 0);
}

function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  syncSidebarUI();
}

function syncSidebarUI() {
  UI.sidebar().classList.toggle('collapsed', !sidebarOpen);
  document.getElementById('open-sidebar-btn').style.display = sidebarOpen ? 'none' : 'flex';
}

function clearChat() {
  UI.welcome().style.display = 'flex';
  UI.messages().innerHTML = '';
  UI.messages().style.display = 'none';
  currentChatId = null;
  messageLog = [];
  clearPendingFiles();
  ensureSession();
  renderChatList();
}

function renderChatList() {
  const el = document.getElementById('chats-list');
  if (!chatHistory.length) {
    el.innerHTML = '<div class="no-chats">No chats yet</div>';
    return;
  }
  el.innerHTML = chatHistory.slice(0, 20).map(c => `
    <div class="chat-item ${c.session_id === currentChatId ? 'active' : ''}" onclick="selectChat('${c.session_id}')">
      <span class="chat-item-icon">💬</span>
      <span class="chat-item-label">${c.title || 'Untitled'}</span>
      <button class="chat-item-del" onclick="deleteHistory(event, '${c.session_id}')">✕</button>
    </div>
  `).join('');
}

function selectChat(id) {
  if (id === currentChatId) return;
  currentChatId = id;
  CONFIG.sessionId = id;
  localStorage.setItem('cx_session', id);
  renderChatList();
  loadPersistentHistory(id);
}

async function deleteHistory(e, id) {
  e.stopPropagation();
  if (!confirm("Delete this chat?")) return;
  try {
    await fetch(`${CONFIG.serverUrl}/api/history/${id}`, { method: 'DELETE' });
    chatHistory = chatHistory.filter(c => c.session_id !== id);
    if (id === currentChatId) clearChat();
    else renderChatList();
    showToast('Chat deleted');
  } catch (err) { }
}

function clearAllHistory() {
  if (!confirm("Clear ALL chat history?")) return;
  chatHistory = [];
  clearAllHistoryOnServer();
  clearChat();
}

async function clearAllHistoryOnServer() {
  try {
    await fetch(`${CONFIG.serverUrl}/api/history/clear`, { method: 'POST' });
    showToast('All history wiped.');
  } catch (err) {
    showToast('Failed to wipe server history.');
  }
}

// ── File Management ─────────────────────────────────────────

function handleFileSelect(input) {
  if (input.files.length) addFiles(input.files);
}

async function addFiles(list) {
  for (const file of Array.from(list)) {
    if (file.size > 10 * 1024 * 1024) continue;
    const data = await readFile(file);
    pendingFiles.push({
      id: Math.random().toString(36),
      name: file.name,
      size: file.size,
      isImage: file.type.startsWith('image/'),
      ...data
    });
  }
  renderPendingFiles();
  onInput(UI.userInput());
}

function readFile(file) {
  return new Promise(res => {
    const r = new FileReader();
    const isImg = file.type.startsWith('image/');
    r.onload = e => res(isImg ? { dataUrl: e.target.result } : { textContent: e.target.result });
    if (isImg) r.readAsDataURL(file); else r.readAsText(file);
  });
}

function renderPendingFiles() {
  const s = UI.previewStrip();
  s.innerHTML = '';
  s.classList.toggle('has-files', pendingFiles.length > 0);
  pendingFiles.forEach(f => {
    const c = document.createElement('div');
    c.className = `file-chip ${f.isImage ? 'is-image' : ''}`;
    c.innerHTML = `
      ${f.isImage ? `<img class="file-chip-thumb" src="${f.dataUrl}">` : `<div class="file-chip-icon">${fileEmoji(f.name)}</div>`}
      <div class="file-chip-info"><span>${f.name}</span><small>${formatSize(f.size)}</small></div>
      <button class="file-chip-remove" onclick="removeFile('${f.id}')">✕</button>
    `;
    s.appendChild(c);
  });
}

function removeFile(id) {
  pendingFiles = pendingFiles.filter(f => f.id !== id);
  renderPendingFiles();
  onInput(UI.userInput());
}

function clearPendingFiles() {
  pendingFiles = [];
  renderPendingFiles();
}

function fileEmoji(n) {
  const ext = n.split('.').pop().toLowerCase();
  const map = { py:'🐍', js:'🟡', ts:'🔷', html:'🌐', css:'🎨', json:'📋', md:'📝', pdf:'📕' };
  return map[ext] || '📄';
}

function formatSize(b) {
  return b < 1024 ? b+'B' : (b/1024).toFixed(1)+'KB';
}

// ── Voice & Media ──────────────────────────────────────────

async function toggleVoice() {
  if (isRecording) stopRecording();
  else startRecording();
}

async function startRecording() {
  const key = localStorage.getItem('cx_stt_key');
  if (!key) return showVoiceKeyModal();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStream = stream;
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      transcribe(blob, key);
    };
    mediaRecorder.start();
    setVoiceUI(true);
  } catch (err) { showToast('Mic error'); }
}

function stopRecording() {
  if (mediaRecorder) mediaRecorder.stop();
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  setVoiceUI(false, 'Transcribing...');
}

async function transcribe(blob, key) {
  try {
    const base64 = await new Promise(r => {
      const f = new FileReader();
      f.onload = () => r(f.result.split(',')[1]);
      f.readAsDataURL(blob);
    });
    
    const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${key}`, {
      method:'POST',
      body: JSON.stringify({
        config: { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, languageCode: 'en-US' },
        audio: { content: base64 }
      })
    });
    
    const data = await res.json();
    const text = data.results?.[0]?.alternatives?.[0]?.transcript;
    if (text) {
      UI.userInput().value += (UI.userInput().value ? ' ' : '') + text;
      onInput(UI.userInput());
    }
  } catch (e) { showToast('STT Failed'); }
  finally { setVoiceUI(false); }
}

function setVoiceUI(on, text) {
  isRecording = on;
  UI.micBtn().classList.toggle('recording', on);
  UI.voiceBanner().classList.toggle('active', on || text);
  if (on || text) UI.voiceLabel().textContent = text || 'Listening...';
}

// ── Modal & Config ──────────────────────────────────────────

function openConfig() { document.getElementById('config-modal').classList.add('active'); }
function closeConfig() { document.getElementById('config-modal').classList.remove('active'); }

function saveConfig() {
  CONFIG.serverUrl = document.getElementById('server-url').value.trim() || window.location.origin;
  CONFIG.userId = document.getElementById('user-id').value.trim() || 'user_1';
  localStorage.setItem('cx_server', CONFIG.serverUrl);
  localStorage.setItem('cx_user', CONFIG.userId);
  closeConfig();
  showToast('Settings saved');
  ensureSession();
}

function showVoiceKeyModal() { document.getElementById('voice-key-modal').classList.add('active'); }
function closeVoiceKeyModal() { document.getElementById('voice-key-modal').classList.remove('active'); }
function saveVoiceKey() {
  const key = document.getElementById('stt-api-key').value.trim();
  if (key) { localStorage.setItem('cx_stt_key', key); closeVoiceKeyModal(); startRecording(); }
}

function updateSaveStatus(s) {
  document.getElementById('save-time').textContent = s ? 'Saved ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Ready';
}

// ── Helper UI ───────────────────────────────────────────────

function initCodeHeaders(root) {
  root.querySelectorAll('.msg-content pre').forEach(pre => {
    if (pre.parentNode.classList.contains('code-wrap')) return;
    const code = pre.querySelector('code');
    const lang = (code?.className.match(/language-(\w+)/) || [])[1] || 'code';
    const wrap = document.createElement('div');
    wrap.className = 'code-wrap';
    const hdr = `<div class="code-header"><span class="code-lang">${lang}</span><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>`;
    pre.parentNode.insertBefore(wrap, pre);
    wrap.innerHTML = hdr;
    wrap.appendChild(pre);
  });
}

window.copyCode = (btn) => {
  const code = btn.closest('.code-wrap').querySelector('code').innerText;
  navigator.clipboard.writeText(code);
  btn.textContent = '✓ Copied';
  setTimeout(() => btn.textContent = 'Copy', 2000);
};

function handleGlobalPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const files = Array.from(items).filter(i => i.type.startsWith('image/')).map(i => i.getAsFile());
  if (files.length) { addFiles(files); showToast('Image pasted'); }
}

function initDragDrop() {
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    document.getElementById('drop-overlay').classList.remove('active');
  });
  document.addEventListener('dragenter', () => document.getElementById('drop-overlay').classList.add('active'));
  document.getElementById('drop-overlay').addEventListener('dragleave', () => document.getElementById('drop-overlay').classList.remove('active'));
}

function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = src;
  lb.classList.add('active');
}

function copyMessageText(btn) {
  const content = btn.closest('.msg-body').querySelector('.msg-content');
  const text = decodeURIComponent(content.dataset.rawText || '');
  copyText(text);
}

async function regenerateLastResponse() {
  const rows = [...document.querySelectorAll('.msg-row')];
  const lastUserRow = [...document.querySelectorAll('.msg-row[data-role="user"]')].pop();
  if (!lastUserRow) return;
  
  const idx = rows.indexOf(lastUserRow);
  const text = decodeURIComponent(lastUserRow.querySelector('.msg-content').dataset.rawText || '');
  
  // Truncate from the index AFTER the last user message
  await handleHistoryTruncation(idx + 1);
  
  // Re-send the last user prompt
  sendMessage(text);
}
