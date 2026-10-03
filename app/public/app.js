'use strict';
const $ = id => document.getElementById(id);
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${{
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  chat: '<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 3V6a2 2 0 0 1 2-2Z"/>',
  files: '<path d="M8 3h8l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M16 3v5h4M3 8v12M11 12h5M11 16h5"/>',
  attach: '<path d="m9 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8"/>',
  send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  explain: '<path d="M5 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H5Z"/><path d="M14 7a3 3 0 0 1 3-3h4v14h-3a4 4 0 0 0-4 3"/>',
  debug: '<path d="m8 3 2 3m6-3-2 3M5 9H2m20 0h-3M5 14H2m20 0h-3M6 18l-3 3m15-3 3 3"/><rect x="6" y="6" width="12" height="15" rx="6"/><path d="M12 10v11M6 11h12"/>',
  plan: '<path d="M5 5h14v14H5Z"/><path d="M8 9h8M8 13h5M3 7V3h4m10 0h4v4M3 17v4h4m10 0h4v-4"/>',
}[name] || ''}</svg>`;
const escape = text => String(text ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
let state, models = [], token = '', busy = false, phase = '', currentFiles = [], fileProject = '', lastStatus = null, editingProject = '', toastTimer;
let workTab = 'files', editorPath = '', editorProject = '', reviewId = '', reviewProject = '', lastTask = null;
let drafts = {};
try { drafts = JSON.parse(localStorage.getItem('localAI.drafts') || '{}'); } catch {}
const project = () => state?.projects.find(p => p.id === state.selectedProject);
const chat = () => state?.chats.find(c => c.id === state.selectedChat && c.projectId === state.selectedProject);
const selectedModel = () => composerChoices?.[draftKey()]?.model || chat()?.model || state?.preferredModel || 'gpt-oss-20b-local';
const model = id => models.find(m => m.id === id) || { label: id || 'Assistant', short: 'AI', color: 'violet', description: '' };
const draftKey = () => chat()?.id || `project-${state?.selectedProject || 'none'}`;
function saveDraft() { drafts[draftKey()] = $('prompt').value; try { localStorage.setItem('localAI.drafts', JSON.stringify(drafts)); } catch {} }
function toast(message, error = false) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, error ? 6500 : 3500); }
async function api(route, input, method, signal) {
  const response = await fetch('/api' + route, { method: method || (input === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', 'X-Local-Token': token }, body: input === undefined ? undefined : JSON.stringify(input), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function updateChat(value) { const at = state.chats.findIndex(c => c.id === value.id); if (at < 0) state.chats.push(value); else state.chats[at] = value; }
async function reloadState() { state = await api('/state'); render(); }
function inline(text) {
  const codes = [];
  let result = escape(text).replace(/`([^`]+)`/g, (_, code) => { codes.push(`<code>${code}</code>`); return `\u0001${codes.length - 1}\u0001`; });
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  return result.replace(/\u0001(\d+)\u0001/g, (_, i) => codes[+i]);
}
function markdown(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let html = '', paragraph = [], list = '', fenced = false, fence = '', language = '';
  const flush = () => { if (paragraph.length) { html += `<p>${paragraph.map(inline).join('<br>')}</p>`; paragraph = []; } if (list) { html += `</${list}>`; list = ''; } };
  const codeBlock = () => { html += `<div class="code-block" data-language="${escape(language)}"><div class="code-toolbar"><span>${escape(language || 'code')}</span><button data-action="save-code">Save to project</button><button data-action="copy-code">Copy code</button></div><pre><code>${escape(fence.replace(/\n$/, ''))}</code></pre></div>`; fence = ''; };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*```/.test(line)) { if (fenced) { codeBlock(); fenced = false; } else { flush(); language = line.trim().slice(3).trim(); fenced = true; } continue; }
    if (fenced) { fence += line + '\n'; continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || '')) {
      flush();
      const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => inline(cell.trim()));
      html += '<div class="md-table"><table><thead><tr>' + cells(line).map(cell => `<th>${cell}</th>`).join('') + '</tr></thead><tbody>';
      index++;
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) html += '<tr>' + cells(lines[++index]).map(cell => `<td>${cell}</td>`).join('') + '</tr>';
      html += '</tbody></table></div>'; continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { flush(); html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`; continue; }
    const item = line.match(/^\s*(?:([-*])|\d+[.)])\s+(.+)$/);
    if (item) { if (paragraph.length) { html += `<p>${paragraph.map(inline).join('<br>')}</p>`; paragraph = []; } const type = item[1] ? 'ul' : 'ol'; if (list !== type) { if (list) html += `</${list}>`; html += `<${type}>`; list = type; } html += `<li>${inline(item[2])}</li>`; continue; }
    if (/^\s*>/.test(line)) { flush(); html += `<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`; continue; }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) { flush(); html += '<hr>'; continue; }
    if (list) { html += `</${list}>`; list = ''; }
    paragraph.push(line);
  }
  if (fenced) codeBlock(); flush(); return html;
}
function renderSidebar() {
  const query = $('search').value.toLowerCase().trim();
  let html = '';
  for (const p of state.projects) {
    const chats = state.chats.filter(c => c.projectId === p.id && (!c.archived||c.id===state.selectedChat)).sort((a, b) => Number(Boolean(b.pinned))-Number(Boolean(a.pinned))||b.updatedAt.localeCompare(a.updatedAt));
    const matches = chats.filter(c => !query || c.title.toLowerCase().includes(query) || p.name.toLowerCase().includes(query)||(c.tags||[]).some(t=>t.toLowerCase().includes(query)));
    if (query && !p.name.toLowerCase().includes(query) && !matches.length) continue;
    const active = p.id === state.selectedProject;
    html += `<button class="project-row ${active ? 'active' : ''}" data-project="${p.id}" title="${escape(p.folder || p.name)}" ${active ? 'aria-current="true"' : ''}>${icon('folder')}<span class="project-name">${escape(p.name)}</span><span class="project-count">${chats.length || ''}</span></button>`;
    if (active || query) html += `<div class="chat-list">${matches.length ? matches.map(c => `<button class="chat-row ${c.id === state.selectedChat ? 'active' : ''}" data-chat="${c.id}" title="${escape((c.tags||[]).join(', '))}" ${c.id === state.selectedChat ? 'aria-current="page"' : ''}>${icon('chat')}<span>${c.pinned?'★ ':''}${escape(c.title)}${c.archived?' · archived':''}</span></button>`).join('') : '<div class="empty-nav">No chats yet</div>'}</div>`;
  }
  $('projects').innerHTML = html || `<div class="empty-nav">${query ? 'No matching projects or chats.' : 'Add a project to begin.'}</div>`;
}
function renderMessages(forceScroll = false) {
  const container = $('conversation'), shouldScroll = forceScroll || container.scrollHeight - container.scrollTop - container.clientHeight < 110;
  const expanded = new Set([...document.querySelectorAll('.thinking[open]')].map(el => el.dataset.message));
  const c = chat();
  $('welcome').hidden = Boolean(c?.messages.length);
  $('messages').hidden = !c?.messages.length;
  $('messages').innerHTML = (c?.messages || []).map(message => {
    const isUser = message.role === 'user', m = model(message.model), time = new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const thinking = message.thinking ? `<details class="thinking" data-message="${message.id}" ${expanded.has(message.id) ? 'open' : ''}><summary>${message.status === 'generating' && !message.content ? 'Thinking…' : 'Reasoning'}</summary><div class="thinking-body">${escape(message.thinking)}</div></details>` : '';
    const answer = isUser ? escape(message.content) : message.content ? markdown(message.content) : message.status === 'generating' ? `<div class="stream-status"><span class="stream-dot"></span>${escape(phase || 'Loading model')}</div>` : '';
    const stats = message.metrics ? `${message.metrics.tokens} tokens <span>·</span> ${message.metrics.tokensPerSecond.toFixed(1)} tokens/sec <span>·</span> ${message.metrics.totalSeconds.toFixed(1)}s total` : message.status === 'generating' ? 'Generating locally' : message.status === 'stopped' ? 'Stopped' : '';
    return `<article class="message ${isUser ? 'user' : 'assistant'}" data-message="${message.id}"><div class="message-header"><span class="avatar ${isUser ? 'user' : m.color}">${isUser ? 'Y' : escape(m.short)}</span><span>${isUser ? 'You' : escape(m.label)}</span><span class="message-time">${escape(time)}</span></div>${thinking}<div class="answer">${answer}</div>${isUser && message.files?.length ? `<div class="message-files">Attached: ${message.files.map(escape).join(' · ')}</div>` : ''}${message.error ? `<div class="message-error">${escape(message.error)}</div>` : ''}${!isUser ? `<div class="message-footer">${stats}<button data-action="copy-message" data-id="${message.id}">Copy answer</button>${message.status !== 'generating' ? `<button data-action="fork-message" data-id="${message.id}">Fork</button><button data-action="retry-message" data-id="${message.id}">Retry</button>${['error','stopped','interrupted','length'].includes(message.status) ? `<button data-action="continue-message" data-id="${message.id}">Continue</button>` : ''}` : ''}${message.status === 'length' ? '<span>Context limit reached</span>' : ''}${message.status === 'interrupted' ? '<span>Interrupted when the app stopped</span>' : ''}</div>` : ''}</article>`;
  }).join('');
  for (const message of c?.messages || []) {
    if (!message.artifacts?.length) continue;
    const article = $('messages').querySelector(`[data-message="${message.id}"]`);
    const container = document.createElement('div'); container.className = 'saved-files';
    container.innerHTML = message.artifacts.map(a => `<div class="saved-artifact">${icon('files')}<div><strong>${escape(a.path)}</strong><span>${escape(a.action)}${a.backup ? ' · Previous version backed up' : ''}${a.seconds ? ' · ' + a.seconds.toFixed(1) + 's' : ''}</span></div>${a.imageId ? `<a href="/images/${a.imageId}.png" target="_blank" rel="noopener"><img src="/images/${a.imageId}.png" alt="Generated project image" loading="lazy"></a>` : ''}</div>`).join('');
    article?.querySelector('.answer')?.after(container);
  }
  if (shouldScroll) container.scrollTop = container.scrollHeight;
}
function renderComposer() {
  const inventory = models.map(m=>`<option value="${escape(m.id)}">${escape(m.label)}</option>`).join('') || '<option value="">Choose a model in Setup</option>';
  if ($('model-select').innerHTML !== inventory) $('model-select').innerHTML = inventory;
  const m = model(selectedModel());
  $('model-select').value = m.id || selectedModel(); $('mode-select').value = composerChoices[draftKey()]?.mode || chat()?.mode || 'build';
  $('model-select').disabled = false;
  $('selected-glyph').textContent = m.short;
  $('selected-glyph').className = 'model-glyph ' + m.color;
  $('model-hint').textContent = busy ? `${phase || 'Generating'} · Running on this PC` : `${m.description} · ${$('mode-select').value === 'build' && project()?.autoFiles !== false ? 'Automatic project files' : 'Read-only project access'}`;
  $('prompt').disabled = false; $('run-stop').hidden = !busy;
  $('send-button').innerHTML = icon('send');
  $('send-button').classList.toggle('stopping', false);
  $('send-button').setAttribute('aria-label', busy ? 'Queue message' : 'Send message');
  $('send-button').title = busy ? 'Queue message' : 'Send message (Enter)';
  $('send-button').disabled = !$('prompt').value.trim() || !project() || !models.length;
  $('unload-button').disabled = busy;
  $('attach-button').disabled = busy || !project()?.folder;
  for (const button of document.querySelectorAll('[data-action="new-chat"], [data-action="add-project"]')) button.disabled = false;
  $('attachment-chips').innerHTML = (chat()?.attachments || []).map(file => `<div class="attachment-chip" title="${escape(file)}">${icon('files')}<span>${escape(file.split('/').pop())}</span><button data-remove-file="${escape(file)}" aria-label="Remove ${escape(file)}" ${busy ? 'disabled' : ''}>×</button></div>`).join('');
}
function render() {
  renderSidebar(); renderMessages(); renderComposer();
  $('project-breadcrumb').textContent = project()?.name || 'Projects';
  $('chat-breadcrumb').textContent = chat()?.title || 'New chat';
  $('welcome-description').textContent = project() ? `Work on ${project().name}. Bring in project files, ask a question, and choose the model that fits the work.` : 'Add a project to keep your conversations and files together.';
  if (!$('file-panel').hidden) { renderWorkbench(); renderFilePanel(); if (fileProject !== state.selectedProject) loadFiles(); }
}
function setPrompt(value) { $('prompt').value = value || ''; resizePrompt(); renderComposer(); }
function resizePrompt() { $('prompt').style.height = 'auto'; $('prompt').style.height = Math.min(170, Math.max(54, $('prompt').scrollHeight)) + 'px'; }
async function selectProject(id) {
  saveDraft(); state.selectedProject = id;
  state.selectedChat = state.chats.filter(c => c.projectId === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id || '';
  await api('/selection', { projectId: id, chatId: state.selectedChat });
  setPrompt(drafts[draftKey()]); $('sidebar').classList.remove('open'); render();
}
async function selectChat(id) {
  saveDraft(); const c = state.chats.find(c => c.id === id); state.selectedProject = c.projectId; state.selectedChat = id;
  await api('/selection', { projectId: c.projectId, chatId: id });
  setPrompt(drafts[draftKey()]); $('sidebar').classList.remove('open'); render(); renderMessages(true);
}
async function newChat(focus = true) {

  if (!project()) { openProjectDialog(); return; }
  const c = await api('/chats', { projectId: project().id, model: selectedModel(), mode: $('mode-select').value });
  saveDraft(); updateChat(c); state.selectedChat = c.id; setPrompt(drafts[c.id] || ''); render(); if (focus) $('prompt').focus(); return c;
}
async function refreshStatus() {
  try {
    lastStatus = await api('/status');
    const s = lastStatus;
    $('status-dot').className = 'status-dot ' + (s.online ? 'online' : 'offline');
    $('runtime-label').textContent = s.online ? `Ollama ${s.version}` : 'Ollama is offline';
    if (s.gpu) {
      $('gpu-summary').innerHTML = `<div>${escape(s.gpu.name.replace('NVIDIA GeForce ', ''))}</div><div>${(s.gpu.usedMiB / 1024).toFixed(1)} / ${(s.gpu.totalMiB / 1024).toFixed(1)} GB VRAM <span>·</span> ${s.gpu.utilization}% GPU</div>`;
      $('memory-fill').style.width = Math.min(100, s.gpu.usedMiB * 100 / s.gpu.totalMiB) + '%';
      $('memory-fill').parentElement.classList.toggle('high', s.gpu.usedMiB / s.gpu.totalMiB > .85);
    } else $('gpu-summary').textContent = 'GPU status unavailable';
    $('runtime-label').title = s.loaded.length ? s.loaded.map(m => `${model(m.name.replace(/:latest$/, '')).label}: ${Math.round(m.size_vram * 100 / m.size)}% GPU`).join('\n') : 'No models loaded';
    if (!$('file-panel').hidden && workTab === 'preview') void renderWorkbench();
    if (!s.online && !busy) $('reply-notice').textContent = 'Start Ollama, then refresh its status to send a message.';
    else if (!busy && $('reply-notice').textContent.startsWith('Start Ollama')) $('reply-notice').textContent = '';
  } catch { $('runtime-label').textContent = 'App connection lost'; $('status-dot').className = 'status-dot offline'; }
}
async function sendMessage() {
  const content = $('prompt').value.trim(); if (!content || !project()) return;
  let c = chat(); if (!c) c = await newChat(false);
  const run = await api('/runs',{chatId:c.id,content,model:$('model-select').value,mode:$('mode-select').value});
  state.runs ||= []; state.runs.push(run); setPrompt(''); saveDraft();
  toast(busy ? 'Request queued. It will run after the active task.' : 'Request started. You can close or refresh this window.');
  await syncRuns();
}

function openProjectDialog(id = '') {
  if (busy) { toast('Stop the reply before editing projects.'); return; }
  editingProject = id; const p = state.projects.find(p => p.id === id);
  $('project-dialog-title').textContent = p ? 'Project settings' : 'Add a project';
  $('save-project').textContent = p ? 'Save project' : 'Add project';
  $('project-name').value = p?.name || ''; $('project-folder').value = p?.folder || ''; $('project-instructions').value = p?.instructions || '';
  $('project-auto-files').checked = p?.autoFiles !== false;
  $('project-commands').checked = p?.allowCommands !== false;
  $('starter-label').hidden = !!p; $('project-template').value = '';
  $('remove-project').hidden = !p; $('project-error').textContent = ''; $('project-dialog').showModal(); $('project-name').focus();
}
async function saveProject(event) {
  event.preventDefault(); $('save-project').disabled = true; $('project-error').textContent = '';
  try {
    const input = { name: $('project-name').value, folder: $('project-folder').value, instructions: $('project-instructions').value, autoFiles: $('project-auto-files').checked, allowCommands: $('project-commands').checked };
    const saved = await api(editingProject ? `/projects/${editingProject}` : '/projects', input, editingProject ? 'PATCH' : 'POST');
    if (!editingProject && $('project-template').value) { try { await api('/projects/'+saved.id+'/scaffold',{template:$('project-template').value}); } catch(error) { toast('Project added; starter: '+error.message,true); } }
    await reloadState(); state.selectedProject = saved.id;
    if (!editingProject) state.selectedChat = '';
    await api('/selection', { projectId: saved.id, chatId: state.selectedChat });
    fileProject = ''; $('project-dialog').close(); setPrompt(drafts[draftKey()]); render(); toast(editingProject ? 'Project saved.' : 'Project added.');
  } catch (error) { $('project-error').textContent = error.message; }
  finally { $('save-project').disabled = false; }
}
let folderRequest, folderSelection = '';
function pickFolder() {
  $('project-error').textContent = '';
  $('folder-dialog').showModal();
  loadFolder($('project-folder').value);
}
async function loadFolder(folder = '') {
  folderRequest?.abort();
  const controller = new AbortController(); folderRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 10_000);
  folderSelection = ''; $('folder-use').disabled = true; $('folder-up').disabled = true;
  $('folder-path-input').value = folder;
  $('folder-status').textContent = 'Loading folders…'; $('folder-list').replaceChildren();
  try {
    const result = await api('/folders', { path: folder }, 'POST', controller.signal);
    if (folderRequest !== controller || !$('folder-dialog').open) return;
    folderSelection = result.folder; $('folder-path-input').value = result.folder;
    $('folder-up').disabled = !result.parent; $('folder-up').dataset.folderPath = result.parent || '';
    $('folder-locations').innerHTML = result.locations.map(item => `<button type="button" data-folder-path="${escape(item.path)}">${escape(item.name)}</button>`).join('');
    $('folder-list').innerHTML = result.folders.map(item => `<button type="button" class="folder-entry" data-folder-path="${escape(item.path)}">${icon('folder')}<span>${escape(item.name)}</span><span aria-hidden="true">›</span></button>`).join('');
    $('folder-status').textContent = result.truncated ? 'Showing part of this large folder. Enter a subfolder path to navigate directly.' : result.folders.length ? 'Open a folder below, or use the current folder.' : 'No subfolders. You can use this folder.';
    $('folder-use').disabled = false;
  } catch (error) {
    if (folderRequest === controller && $('folder-dialog').open) $('folder-status').textContent = controller.signal.aborted ? 'The folder took too long to open. Try another path or a Home shortcut.' : error.message;
  } finally { clearTimeout(timeout); }
}
$('folder-dialog').addEventListener('close', () => { folderRequest?.abort(); folderRequest = null; folderSelection = ''; });
$('folder-dialog').addEventListener('click', event => { const button = event.target.closest('[data-folder-path]'); if (button && !button.disabled) loadFolder(button.dataset.folderPath); });
$('folder-location-form').addEventListener('submit', event => { event.preventDefault(); loadFolder($('folder-path-input').value); });
$('folder-path-input').addEventListener('input', () => { folderRequest?.abort(); folderRequest = null; folderSelection = ''; $('folder-use').disabled = true; $('folder-status').textContent = 'Press Open path to browse and select this location.'; });
$('folder-use').addEventListener('click', () => { if (folderSelection) { $('project-folder').value = folderSelection; $('folder-dialog').close(); $('browse-folder').focus(); } });
async function loadFiles() {
  const p = project(); currentFiles = []; fileProject = p?.id || '';
  $('file-list').innerHTML = '<div class="file-empty">Loading files…</div>';
  if (!p?.folder) { renderFilePanel(); return; }
  try { const data = await api(`/projects/${p.id}/files`); if (state.selectedProject !== p.id) return; currentFiles = data.files; $('file-footer').textContent = data.truncated ? 'Showing the first 600 text files. Narrow the linked folder for larger repositories.' : 'Build folders and common secret-file formats are excluded.'; renderFilePanel(); }
  catch (error) { $('file-list').innerHTML = `<div class="file-empty">${escape(error.message)}</div>`; }
}
function renderFilePanel() {
  const p = project(); $('folder-name').textContent=p?.name || 'Choose a project'; $('folder-path').textContent=p?.folder || 'A folder is created when you save the first file.';
  const filtered=currentFiles.filter(f=>f.path.toLowerCase().includes($('file-search').value.toLowerCase()));
  const tree={}; for(const file of filtered){const parts=file.path.split('/');let node=tree;for(const part of parts.slice(0,-1))node=node[part] ||= {};node[parts.at(-1)]={file};}
  const selected=new Set(chat()?.attachments || []);
  const rows=node=>Object.entries(node).map(([name,item])=>item.file ? '<div class="file-row"><input type="checkbox" aria-label="Attach '+escape(item.file.path)+'" data-file="'+escape(item.file.path)+'" '+(selected.has(item.file.path)?'checked ':'')+(busy||item.file.kind!=='text'?'disabled':'')+'><button data-preview="'+escape(item.file.path)+'" title="'+escape(item.file.path)+'">'+(item.file.kind==='image'?'▧ ':item.file.kind==='audio'?'♫ ':'')+escape(name)+'</button><small>'+Math.round(item.file.bytes/1024)+' KB</small></div>' : '<details class="file-folder" open><summary>'+escape(name)+'</summary><div>'+rows(item)+'</div></details>').join('');
  $('file-list').innerHTML=filtered.length ? rows(tree) : '<p class="file-empty">No matching files. Create a file or choose a starter project.</p>';
}

async function toggleAttachment(file, add) {
  if (busy) throw new Error('Stop the reply before changing attached files.');
  let c = chat(); if (!c) c = await newChat(false);
  const attachments = new Set(c.attachments || []); if (add) attachments.add(file); else attachments.delete(file);
  updateChat(await api(`/chats/${c.id}`, { attachments: [...attachments] }, 'PATCH')); renderComposer(); renderSidebar(); renderFilePanel();
}
async function previewFile(file) {
  if (['image','audio'].includes(currentFiles.find(f=>f.path===file)?.kind)) {
    const res = await fetch('/api/projects/'+project().id+'/asset?path='+encodeURIComponent(file),{headers:{'X-Local-Token':token}}); if (!res.ok) throw Error((await res.json()).error);
    if (assetUrl) URL.revokeObjectURL(assetUrl); assetUrl = URL.createObjectURL(await res.blob());
    editorPath=file;editorProject=project().id; $('preview-title').textContent=file; const isAudio=currentFiles.find(f=>f.path===file)?.kind==='audio'; $('asset-image').src=isAudio?'':assetUrl; $('asset-image').hidden=isAudio; $('asset-audio').src=isAudio?assetUrl:''; $('asset-audio').hidden=!isAudio; $('preview-content').hidden=true; document.querySelector('[data-action="save-editor"]').hidden=true; $('preview-dialog').showModal();return;
  }
  $('asset-image').hidden=true; $('asset-audio').hidden=true; $('asset-audio').pause(); $('preview-content').hidden=false; document.querySelector('[data-action="save-editor"]').hidden=false;
  const data = await api(`/projects/${project().id}/file?path=${encodeURIComponent(file)}`);
  editorPath = file; editorProject = project().id; $('preview-title').textContent = file; $('preview-content').value = data.content; $('editor-status').textContent = ''; $('preview-content').readOnly = busy; $('preview-dialog').showModal();
}
function confirm(title, description, action) {
  $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-yes').onclick = async () => { $('confirm-yes').disabled = true; try { await action(); $('confirm-dialog').close(); } catch (error) { toast(error.message, true); } finally { $('confirm-yes').disabled = false; } }; $('confirm-dialog').showModal();
}
function openChatSettings() {
  if (!chat()) { toast('Start a chat first.'); return; }
  if (busy) { toast('Stop the reply before editing the chat.'); return; }
  $('chat-name').value = chat().title; $('chat-error').textContent = ''; $('chat-dialog').showModal();
}
async function exportChat() {
  const c = chat(); if (!c) return;
  let text = `# ${c.title}\n\nProject: ${project().name}\n\n`;
  for (const message of c.messages) text += `## ${message.role === 'user' ? 'You' : model(message.model).label}\n\n${message.content}\n\n${message.files?.length ? 'Attached: ' + message.files.join(', ') + '\n\n' : ''}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = c.title.replace(/[^a-z0-9 _-]/gi, '').slice(0, 70) + '.md'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Chat exported.');
}
const actions = {
  'new-chat': () => newChat(), 'add-project': () => openProjectDialog(), 'project-settings': () => project() && openProjectDialog(project().id), 'chat-settings': openChatSettings,
  sidebar: () => $('sidebar').classList.toggle('open'), refresh: refreshStatus, send: sendMessage,
  'files-panel': () => { workTab = 'files'; syncWorkbenchTabs(); $('file-panel').hidden = !$('file-panel').hidden; $('files-toggle').setAttribute('aria-expanded', String(!$('file-panel').hidden)); if (!$('file-panel').hidden) loadFiles(); },
  attach: () => { if ($('file-panel').hidden) actions['files-panel'](); $('file-search').focus(); },
  unload: async () => { $('unload-button').disabled = true; try { await api('/unload', {}); await refreshStatus(); toast('Models unloaded. VRAM is available for other work.'); } finally { renderComposer(); } },
  export: exportChat,
  images: openImages,
  audio: openAudio,
  'save-code': target => {
    if (busy) throw new Error('Wait until the build finishes before saving a code block.');
    const block = target.closest('.code-block'); pendingCode = block.querySelector('code').textContent;
    const language = block.dataset.language.toLowerCase().split(/\s/)[0];
    $('save-file-path').value = ({ html: 'index.html', css: 'styles.css', javascript: 'app.js', js: 'app.js', typescript: 'app.ts', ts: 'app.ts', json: 'package.json', python: 'app.py' })[language] || 'code.txt';
    $('save-file-error').textContent = ''; $('save-file-dialog').showModal();
  },
  'remove-chat': () => { const c = chat(); confirm('Remove this chat?', `“${c.title}” will be removed from Local AI Studio.`, async () => { await api(`/chats/${c.id}`, undefined, 'DELETE'); $('chat-dialog').close(); await reloadState(); setPrompt(drafts[draftKey()]); }); },
  'copy-message': async target => { const message = chat()?.messages.find(m => m.id === target.dataset.id); await navigator.clipboard.writeText(message?.content || ''); toast('Answer copied.'); },
  'copy-code': async target => { await navigator.clipboard.writeText(target.closest('.code-block').querySelector('code').textContent); target.textContent = 'Copied'; setTimeout(() => { if (target.isConnected) target.textContent = 'Copy code'; }, 1600); },
};
let pendingCode = '';
function applyProject(value) { const at = state.projects.findIndex(p => p.id === value.id); if (at >= 0) state.projects[at] = value; }
function renderImageGallery() {
  const images = [...(state.images || []).filter(i => i.projectId === project()?.id), ...state.chats.filter(c => c.projectId === project()?.id).flatMap(c => c.messages.flatMap(m => m.artifacts || []).filter(a => a.imageId))];
  $('image-gallery').innerHTML = images.slice(-8).reverse().map(i => `<a href="/images/${i.imageId}.png" target="_blank" rel="noopener"><img src="/images/${i.imageId}.png" alt="${escape(i.path)}" loading="lazy"><span>${escape(i.path)}</span></a>`).join('');
}
async function openImages() {
  if (!project()) throw new Error('Add or select a project first.');
  const status = await api('/image-status');
  $('image-engine-status').textContent = status.ready ? `${status.model} · Free · Runs on this PC` : 'The local image model is not installed yet.';
  $('image-generate').disabled = busy || !status.ready; renderImageGallery(); $('image-dialog').showModal();
}
let audioEngines = {};
function renderAudioGallery() {
  $('audio-gallery').innerHTML = (state.audio || []).filter(a => a.projectId === project()?.id).slice(-8).reverse().map(a => `<div class="audio-card"><strong>${escape(a.path)}</strong><small>${escape(a.model)}</small><audio controls preload="none" src="/audio/${a.audioId}.wav"></audio></div>`).join('');
}
function audioModeChanged() {
  const mode = $('audio-mode').value, engine = audioEngines[mode];
  $('audio-form').classList.toggle('voice-mode', mode === 'voice');
  $('audio-engine-status').textContent = engine ? `${engine.model} · ${engine.ready ? 'Ready on this PC' : 'Not installed'}` : '';
  $('audio-generate').disabled = busy || !engine?.ready;
  $('audio-style-label').hidden = mode !== 'voice'; $('audio-language-label').hidden = mode !== 'voice';
  $('audio-lyrics-label').hidden = mode !== 'music'; $('audio-duration-label').hidden = mode === 'voice'; $('audio-quality-label').hidden = mode !== 'effect';
  $('audio-prompt-label').firstChild.textContent = mode === 'voice' ? 'Words to speak' : mode === 'music' ? 'Describe the music' : 'Describe the sound';
  $('audio-prompt').placeholder = mode === 'voice' ? 'Welcome to the game.' : mode === 'music' ? 'Upbeat electronic game menu music with warm synths…' : 'A crisp sword strike with a short metallic ring…';
  $('audio-duration').min = mode === 'music' ? '10' : '1'; $('audio-duration').max = mode === 'music' ? '180' : '30'; $('audio-duration').value = mode === 'music' ? '30' : '10';
  $('audio-path').value = `assets/${mode === 'effect' ? 'sound-effect' : mode}.wav`;
}
async function openAudio() {
  if (!project()) throw new Error('Add or select a project first.');
  audioEngines = await api('/audio-status'); audioModeChanged(); renderAudioGallery(); $('audio-dialog').showModal();
}
$('audio-mode').addEventListener('change', audioModeChanged);
$('audio-stop').addEventListener('click', () => api('/cancel', {}).catch(error => toast(error.message, true)));
$('audio-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const p = project(); busy = true; phase = 'Loading audio model'; renderComposer(); $('audio-generate').disabled = true; $('audio-stop').hidden = false; $('audio-result').innerHTML = ''; $('audio-progress').textContent = phase;
  try {
    const response = await fetch('/api/audio', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Token': token }, body: JSON.stringify({ projectId: p.id, mode: $('audio-mode').value, prompt: $('audio-prompt').value, duration: Number($('audio-duration').value), steps: Number($('audio-steps').value), style: $('audio-style').value, language: $('audio-language').value, lyrics: $('audio-lyrics').value, path: $('audio-path').value, seed: -1 }) });
    if (!response.ok) throw new Error((await response.json()).error);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '', finished = false;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true }); let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const item = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        if (item.type === 'phase') { phase = item.phase; $('audio-progress').textContent = phase; renderComposer(); }
        if (item.type === 'error') throw new Error(item.error);
        if (item.type === 'done') { finished = true; applyProject(item.project); state.audio ||= []; state.audio.push({ ...item.audio, projectId: p.id }); $('audio-result').innerHTML = `<div class="audio-card"><strong>${escape(item.audio.path)}</strong><audio controls src="/audio/${item.audio.audioId}.wav"></audio><small>${item.audio.seconds.toFixed(1)}s · Seed ${item.audio.settings.seed}</small></div>`; $('audio-progress').textContent = 'Clip saved to your project.'; renderAudioGallery(); }
      }
    }
    if (!finished) throw new Error('The audio connection ended before completion.');
  } catch (error) { $('audio-progress').textContent = error.message; toast(error.message, true); }
  finally { busy = false; phase = ''; $('audio-generate').disabled = !audioEngines[$('audio-mode').value]?.ready; $('audio-stop').hidden = true; render(); refreshStatus(); if (!$('file-panel').hidden) loadFiles(); }
});
$('save-file-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { const result = await api(`/projects/${project().id}/file`, { path: $('save-file-path').value, content: pendingCode }); applyProject(result.project); $('save-file-dialog').close(); toast(`Saved ${result.path}`); await loadFiles(); }
  catch (error) { $('save-file-error').textContent = error.message; }
});
$('image-stop').addEventListener('click', () => api('/cancel', {}).catch(error => toast(error.message, true)));
$('image-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const p = project(), [width, height] = $('image-shape').value.split('x').map(Number);
  busy = true; phase = 'Loading image model'; renderComposer(); $('image-generate').disabled = true; $('image-stop').hidden = false; $('image-result').innerHTML = ''; $('image-progress').textContent = phase;
  try {
    const response = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Token': token }, body: JSON.stringify({ projectId: p.id, prompt: $('image-prompt').value, negativePrompt: $('image-avoid').value, path: $('image-path').value, width, height, steps: Number($('image-quality').value), seed: Number($('image-seed').value) }) });
    if (!response.ok) throw new Error((await response.json()).error);
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '', finished = false;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true }); let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const event = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        if (event.type === 'phase') { phase = event.phase; $('image-progress').textContent = phase; renderComposer(); }
        if (event.type === 'error') throw new Error(event.error);
        if (event.type === 'done') {
          finished = true; applyProject(event.project); state.images ||= []; state.images.push({ ...event.image, projectId: p.id });
          $('image-result').innerHTML = `<a href="/images/${event.image.imageId}.png" target="_blank" rel="noopener"><img src="/images/${event.image.imageId}.png" alt="Generated image"></a><p>Saved ${escape(event.image.path)} · ${event.image.seconds.toFixed(1)}s · Seed ${event.image.settings.seed}</p>`;
          $('image-progress').textContent = 'Image saved to your project.'; renderImageGallery();
        }
      }
    }
    if (!finished) throw new Error('The image connection ended before completion.');
  } catch (error) { $('image-progress').textContent = error.message; toast(error.message, true); }
  finally { busy = false; phase = ''; $('image-generate').disabled = false; $('image-stop').hidden = true; render(); refreshStatus(); if (!$('file-panel').hidden) loadFiles(); }
});
document.addEventListener('click', async event => {
  const target = event.target.closest('button'); if (!target || target.disabled) return;
  try {
    if (target.dataset.close) $(target.dataset.close).close();
    else if (target.dataset.worktab) await switchWorkTab(target.dataset.worktab);
    else if (target.dataset.review) await openReview(target.dataset.review);
    else if (target.dataset.source) await previewFile(target.dataset.source);
    else if (target.dataset.runScript) await manualTask('task', { task: 'script', script: target.dataset.runScript });
    else if (target.dataset.action) await actions[target.dataset.action]?.(target);
    else if (target.dataset.project) await selectProject(target.dataset.project);
    else if (target.dataset.chat) await selectChat(target.dataset.chat);
    else if (target.dataset.suggestion) { if (!busy) { setPrompt(target.dataset.suggestion); saveDraft(); $('prompt').focus(); } }
    else if (target.dataset.preview) await previewFile(target.dataset.preview);
    else if (target.dataset.removeFile) await toggleAttachment(target.dataset.removeFile, false);
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('change', async event => {
  if (event.target.dataset.file) try { await toggleAttachment(event.target.dataset.file, event.target.checked); } catch (error) { renderFilePanel(); toast(error.message, true); }
});
$('project-form').addEventListener('submit', saveProject);
$('browse-folder').addEventListener('click', pickFolder);
$('remove-project').addEventListener('click', () => {
  const p = state.projects.find(p => p.id === editingProject);
  confirm('Remove this project?', `“${p.name}” and its chats will be removed from this app. The original project folder and its files will remain untouched.`, async () => { await api(`/projects/${p.id}`, undefined, 'DELETE'); $('project-dialog').close(); await reloadState(); setPrompt(drafts[draftKey()]); fileProject = ''; render(); });
});
$('chat-form').addEventListener('submit', async event => { event.preventDefault(); try { updateChat(await api(`/chats/${chat().id}`, { title: $('chat-name').value }, 'PATCH')); $('chat-dialog').close(); render(); } catch (error) { $('chat-error').textContent = error.message; } });
$('model-select').addEventListener('change', async () => {
  try { const selected = $('model-select').value; if (chat() && !busy) updateChat(await api(`/chats/${chat().id}`, { model: selected }, 'PATCH')); else if (chat()) chat().model = selected; state.preferredModel = selected; await api('/selection', { model: selected }); renderComposer(); toast(`Next reply will use ${model(selected).label}.`); }
  catch (error) { renderComposer(); toast(error.message, true); }
});
$('search').addEventListener('input', renderSidebar); $('file-search').addEventListener('input', renderFilePanel);
$('prompt').addEventListener('input', () => { resizePrompt(); saveDraft(); renderComposer(); });
$('prompt').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage().catch(error => toast(error.message, true)); } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (innerWidth < 760) $('sidebar').classList.add('open'); $('search').focus(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newChat().catch(error => toast(error.message, true)); } });
let liveOutput = '';
function syncWorkbenchTabs() {
  $('files-view').hidden = workTab !== 'files'; $('workbench-view').hidden = workTab === 'files';
  $('file-panel').classList.toggle('wide-workbench', workTab !== 'files');
  for (const button of document.querySelectorAll('[data-worktab]')) button.setAttribute('aria-selected', String(button.dataset.worktab === workTab));
}
async function switchWorkTab(tab) {
  workTab = tab; $('file-panel').hidden = false; $('files-toggle').setAttribute('aria-expanded', 'true'); syncWorkbenchTabs();
  if (tab === 'files') await loadFiles(); else { $('workbench-view').innerHTML=''; await renderWorkbench(); }
}
function activityHtml(activity) {
  const r = activity.result || {}, failed = r.success === false || r.error || r.isError;
  return '<details class="task-result" open><summary class="' + (failed ? 'failed' : '') + '">' + escape(r.command || (r.server ? r.server + ' / ' + r.tool : '') || ({ verify_project: 'Project checks', start_project_preview: 'App preview' })[activity.tool] || activity.tool) + ' · ' + (failed ? 'Failed' : r.running ? 'Running' : 'Finished') + '</summary>' + (r.checks ? '<ul>' + r.checks.map(c => '<li>' + escape(c.name) + ' · ' + (c.skipped ? 'Skipped' : c.success ? 'Passed' : 'Failed') + (c.output ? '<details><summary>Command output</summary><pre>' + escape(c.output) + '</pre></details>' : '') + '</li>').join('') + '</ul>' : '') + (r.issues?.length ? '<pre>' + escape(r.issues.map(i => (i.path || '') + ': ' + i.message + (i.output ? '\n' + i.output : '')).join('\n')) + '</pre>' : '') + (r.output || r.error || r.content ? '<pre>' + escape(r.output || r.error || r.content) + '</pre>' : '') + (r.note ? '<p class="field-help">' + escape(r.note) + '</p>' : '') + '</details>';
}
async function renderWorkbench() {
  if ($('file-panel').hidden || workTab === 'files' || !project()) return;
  const p = project(), tab = workTab, view = $('workbench-view');
  const latest = [...(chat()?.messages || [])].reverse().find(m => m.role === 'assistant');
  if (['runs','git','api','memory'].includes(tab)) return renderExtra(tab,p,view);
  if (tab === 'plan') {
    const verified = latest?.activity?.findLast(a => a.tool === 'verify_project')?.result.success;
    const steps = latest?.plan || (latest?.artifacts?.length ? [{ title: 'Create and connect project files', status: latest.status === 'generating' ? 'in_progress' : 'complete' }, { title: 'Run project checks', status: verified ? 'complete' : 'pending' }, { title: 'Start the app preview', status: latest.activity?.some(a => a.tool === 'start_project_preview' && a.result.running) ? 'complete' : 'pending' }] : []);
    view.innerHTML = '<p class="workbench-intro">The assistant tracks its build here.</p>' + (steps.length ? '<ol class="build-plan">' + steps.map(step => '<li class="' + step.status + '"><span>' + (step.status === 'complete' ? '✓' : step.status === 'in_progress' ? '◉' : '○') + '</span><div>' + escape(step.title) + '<small>' + escape(step.status.replace('_', ' ')) + '</small></div></li>').join('') + '</ol>' : '<p class="file-empty">Ask the assistant to build something. Its plan will appear here.</p>');
  } else if (tab === 'changes') {
    try { const changes = await api('/projects/' + p.id + '/changes'); if (project()?.id !== p.id || workTab !== tab) return;
      const snapshots = await api('/projects/'+p.id+'/checkpoints'); if (project()?.id !== p.id || workTab !== tab) return;
      view.innerHTML = checkpointHtml(snapshots) + '<p class="workbench-intro">Review saved edits and restore the previous version. Undo is blocked when a file has since changed.</p>' + (changes.length ? changes.map(c => '<button class="change-row" data-review="' + c.id + '"><strong>' + escape(c.path) + '</strong><span>' + escape(c.undoneAt ? 'Undone' : c.action) + ' · ' + escape(new Date(c.createdAt).toLocaleTimeString()) + '</span></button>').join('') : '<p class="file-empty">No saved edits in this project yet.</p>');
    } catch (error) { view.textContent = error.message; }
  } else if (tab === 'checks') {
    let context; try { context = await api('/projects/' + p.id + '/context'); } catch (error) { view.textContent = error.message; return; }
    if (project()?.id !== p.id || workTab !== tab) return;
    const results = [...(latest?.activity || []), ...(lastTask?.projectId === p.id ? [lastTask] : p.lastTask ? [{ tool: p.lastTask.action, result: p.lastTask.result }] : [])];
    view.innerHTML = '<p class="workbench-intro">Run project tasks, inspect errors, then ask the assistant to fix them.</p><div class="task-buttons"><button class="subtle-button" data-action="install-deps" ' + (busy || p.allowCommands === false ? 'disabled' : '') + '>Install packages</button><button class="primary-button" data-action="verify-project" ' + (busy ? 'disabled' : '') + '>Check project</button><button class="subtle-button" data-action="stop-task" ' + (!busy ? 'disabled' : '') + '>Stop</button></div><div class="task-buttons">' + Object.keys(context.package?.scripts || {}).filter(name => !/^(dev|start|serve|watch|preview)$/i.test(name)).map(name => '<button class="subtle-button" data-run-script="' + escape(name) + '" ' + (busy || p.allowCommands === false ? 'disabled' : '') + '>Run ' + escape(name) + '</button>').join('') + '</div>' + (liveOutput ? '<pre class="terminal-output">' + escape(liveOutput) + '</pre>' : '') + results.slice(-6).map(activityHtml).join('') + '<button class="subtle-button" data-action="fix-errors" ' + (busy || !results.length ? 'disabled' : '') + '>Ask assistant to fix errors</button>';
  } else if (tab === 'preview') {
    try { const preview = await api('/projects/' + p.id + '/preview'); if (project()?.id !== p.id || workTab !== tab) return;
      const oldUrl = view.querySelector('iframe')?.dataset.url;
      if (preview.running && oldUrl === preview.url) { const start = view.querySelector('[data-action=\"start-preview\"]'); if (start) start.disabled = busy; return; }
      view.innerHTML = '<div class="task-buttons"><button class="primary-button" data-action="start-preview" ' + (busy ? 'disabled' : '') + '>' + (preview.running ? 'Restart preview' : 'Start preview') + '</button><button class="subtle-button" data-action="refresh-preview">Refresh</button>' + (preview.running ? '<button class="subtle-button" data-action="stop-preview">Stop</button><a class="subtle-button" href="' + escape(preview.url) + '" target="_blank" rel="noopener">Open app ↗</a>' : '') + '</div>' + (preview.running ? '<p class="workbench-intro">' + escape(preview.url) + '</p><iframe title="Project app preview" data-url="' + escape(preview.url) + '" src="' + escape(preview.url) + '" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads"></iframe>' : '<p class="file-empty">Start your saved website or app here. Static sites work immediately; app projects need installed packages and a dev/start script.</p>') + (preview.output ? '<details class="task-result"><summary>Server output</summary><pre>' + escape(preview.output) + '</pre></details>' : '');
    } catch (error) { view.textContent = error.message; }
  }
}
async function manualTask(action, input = {}) {
  if (busy) throw new Error('Stop the current task first.');
  const p = project(); busy = true; phase = action === 'preview' ? 'Starting app preview' : 'Running project task'; renderComposer(); void renderWorkbench();
  try {
    const result = await api('/projects/' + p.id + '/' + action, input);
    lastTask = { projectId: p.id, tool: action, result }; liveOutput = '';
    p.lastTask = { action, result };
    toast(result.success === false ? 'Checks found errors. Review the output.' : action === 'preview' ? 'App preview started.' : 'Task finished.', result.success === false);
  } finally { busy = false; phase = ''; renderComposer(); await renderWorkbench(); }
}
async function openReview(id) {
  const p = project(), r = await api('/projects/' + p.id + '/review?id=' + encodeURIComponent(id));
  reviewId = id; reviewProject = p.id; $('review-title').textContent = r.path; $('review-summary').textContent = r.action + (r.undoneAt ? ' · Undone' : ''); $('review-status').textContent = '';
  $('undo-change').hidden = false; $('undo-change').disabled = busy || !r.canUndo;
  const before = r.before.split('\n'), after = r.after.split('\n'); let prefix = 0, suffix = 0;
  while (prefix < Math.min(before.length, after.length) && before[prefix] === after[prefix]) prefix++;
  while (suffix < Math.min(before.length, after.length) - prefix && before.at(-1 - suffix) === after.at(-1 - suffix)) suffix++;
  const lines = (list, kind, start) => list.slice(start, suffix ? list.length - suffix : undefined).map((line, i) => '<div class="diff-line ' + kind + '"><small>' + (start + i + 1) + '</small><span>' + (kind === 'removed' ? '− ' : '+ ') + escape(line) + '</span></div>').join('');
  $('review-diff').innerHTML = r.operation ? '<p class="file-empty">'+escape(r.operation === 'rename' ? 'Moved from '+r.oldPath+' to '+r.path+'. Undo moves the file back.' : 'File is in recoverable trash. Undo restores its contents.')+'</p>' : r.binary ? '<p class="file-empty">Binary image · ' + r.bytes + ' bytes. The previous file can be restored when available.</p>' : '<p class="field-help">Changed region · previous lines in red, current lines in green</p>' + lines(before, 'removed', prefix) + lines(after, 'added', prefix);
  $('review-dialog').showModal();
}
Object.assign(actions, {
  workbench: () => switchWorkTab('plan'),
  'save-editor': async () => { if (busy) throw new Error('Stop the current task before saving.'); await api('/projects/' + editorProject + '/file', { path: editorPath, content: $('preview-content').value }); $('editor-status').textContent = 'Saved with backup.'; await loadFiles(); },
  'undo-change': async () => { if (busy) throw new Error('Stop the current task before undoing.'); await api('/projects/' + reviewProject + '/undo', { id: reviewId }); $('review-status').textContent = 'Change undone.'; $('undo-change').disabled = true; await loadFiles(); await renderWorkbench(); },
  'source-search': () => { $('search-dialog').showModal(); $('source-search-query').focus(); },
  'install-deps': () => manualTask('task', { task: 'install' }),
  'verify-project': () => manualTask('verify'),
  'stop-task': () => api('/cancel', {}),
  'start-preview': () => manualTask('preview'),
  'stop-preview': async () => { await api('/projects/' + project().id + '/preview-stop', {}); $('workbench-view').innerHTML = ''; await renderWorkbench(); },
  'refresh-preview': async () => { const frame = $('workbench-view').querySelector('iframe'); if (frame) frame.src = frame.dataset.url; else await renderWorkbench(); },
  'fix-errors': async () => {
    const latest = [...(chat()?.messages || [])].reverse().find(m => m.role === 'assistant');
    const result = lastTask?.projectId === project().id ? lastTask.result : project().lastTask?.result || latest?.activity?.at(-1)?.result;
    setPrompt('Fix the errors from these project checks. Read the relevant files, make focused edits, then verify again.\n' + JSON.stringify(result).slice(-12000)); saveDraft(); await sendMessage();
  },
});
$('source-search-form').addEventListener('submit', async event => {
  event.preventDefault(); try { const r = await api('/projects/' + project().id + '/search?q=' + encodeURIComponent($('source-search-query').value));
    $('source-search-results').innerHTML = r.hits.length ? r.hits.map(h => '<button class="search-hit" data-source="' + escape(h.path) + '"><strong>' + escape(h.path) + ':' + h.line + '</strong><code>' + escape(h.text) + '</code></button>').join('') : '<p class="file-empty">No matches found.</p>';
  } catch (error) { $('source-search-results').textContent = error.message; }
});
for (const [id, name] of [['search-icon', 'search'], ['lock-icon', 'lock'], ['files-icon', 'files'], ['attach-button', 'attach'], ['suggest-explain', 'explain'], ['suggest-debug', 'debug'], ['suggest-plan', 'plan']]) $(id).innerHTML = icon(name);
(async () => {
  try { const bootstrap = await (await fetch('/api/bootstrap')).json(); token = bootstrap.token; state = bootstrap.state; models = bootstrap.models; setPrompt(drafts[draftKey()]); render(); document.dispatchEvent(new Event('studio-ready')); await refreshStatus(); setInterval(refreshStatus, 8000); await syncRuns(); setInterval(syncRuns,1000); }
  catch (error) { $('welcome-description').textContent = 'Could not connect to the local app. Close this window and launch Local AI Studio again.'; toast(error.message, true); }
})();
// Durable requests and additional project workspace panels.
let syncingRuns=false, runSignature='', lastRunChat='', assetUrl='', inputAction, composerChoices={};
try { composerChoices=JSON.parse(localStorage.getItem('localAI.composerChoices') || '{}'); } catch {}
function saveComposerChoices(){try{localStorage.setItem('localAI.composerChoices',JSON.stringify(composerChoices));}catch{}}
async function syncRuns() {
  if (syncingRuns || !state) return; syncingRuns=true;
  try {
    const runs=await api('/runs'); state.runs=runs;
    const signature=runs.map(r=>r.id+':'+r.status).join('|');
    const relevant=runs.find(r=>r.chatId===chat()?.id);
    const running=runs.find(r=>r.status==='running');
    if (relevant && (['running','queued'].includes(relevant.status) || signature!==runSignature || lastRunChat!==chat()?.id)) {
      const snapshot=await api('/runs/'+relevant.id); if(snapshot.run.status === 'error' && !snapshot.run.messageId) $('reply-notice').textContent=snapshot.run.error || 'Request could not start. See Runs for details.'; updateChat(snapshot.chat);applyProject(snapshot.project);liveOutput=snapshot.run.output || ''; renderMessages();renderSidebar();
      if (!$('file-panel').hidden && ['plan','checks','runs'].includes(workTab)) void renderWorkbench();
      if (!['running','queued'].includes(relevant.status) && signature!==runSignature) { void loadFiles(); if(workTab==='preview') setTimeout(()=>void renderWorkbench(),0); }
    }
    if (signature!==runSignature && workTab==='runs') void renderWorkbench();
    runSignature=signature; lastRunChat=chat()?.id || '';
    // Manual tasks and image generation still use their existing UI lifecycle.
    if (running || runs.some(r=>r.status==='queued')) { busy=true;phase=running?.phase || 'Request queued'; }
    else if (phase && !['Running project task','Starting app preview','Loading image model'].includes(phase) && $('image-stop').hidden) { busy=false;phase=''; }
    renderComposer();
  } catch(error) { $('reply-notice').textContent='Reconnecting to the app. Running requests remain on the server. '+error.message; }
  finally { syncingRuns=false; }
}
function inputDialog(title, value, action) { $('input-title').textContent=title;$('input-value').value=value;$('input-error').textContent='';inputAction=action;$('input-dialog').showModal();$('input-value').focus(); }
$('input-form').addEventListener('submit',async event=>{event.preventDefault();try{await inputAction($('input-value').value);$('input-dialog').close();}catch(error){$('input-error').textContent=error.message;}});
$('mode-select').addEventListener('change',()=>{composerChoices[draftKey()] ||= {};composerChoices[draftKey()].mode=$('mode-select').value; saveComposerChoices(); if(chat() && !busy) void api('/chats/'+chat().id,{mode:$('mode-select').value},'PATCH').then(updateChat).catch(error=>toast(error.message,true)); toast($('mode-select').value==='build'?'Build can create files and run tasks.':'This mode reads the project without making changes.');});
$('model-select').addEventListener('change',()=>{composerChoices[draftKey()] ||= {};composerChoices[draftKey()].model=$('model-select').value;saveComposerChoices();});
function checkpointHtml(items) {
  return '<div class="section-label"><span>Project checkpoints</span><button class="subtle-button" data-action="checkpoint">Create</button></div><p class="field-help">Automatic snapshot before each build. Includes supported source files and images; dependencies and build output are excluded.</p>'+items.slice(0,10).map(c=>'<details class="task-result"><summary>'+escape(c.label)+'</summary><p class="field-help">'+new Date(c.createdAt).toLocaleString()+' · '+c.fileCount+' files'+(c.restoredAt?' · Restored':'')+'</p><button class="subtle-button" data-restore-checkpoint="'+c.id+'" '+(busy?'disabled':'')+'>Restore project</button></details>').join('');
}
async function renderExtra(tab,p,view) {
  const valid=()=>project()?.id===p.id && workTab===tab;
  if(tab==='runs') {
    const runs=(state.runs || []).filter(r=>r.projectId===p.id).slice(0,30);
    view.innerHTML='<p class="workbench-intro">Requests run on the server. You can switch chats, refresh or close the window. One request runs at a time to share the GPU.</p>'+(!runs.length?'<p class="file-empty">No requests yet.</p>':runs.map(r=>'<div class="run-card"><div class="run-title"><strong>'+escape(r.status)+'</strong><span class="mode-badge">'+escape(r.mode)+' · '+escape(model(r.model).short)+'</span></div><p>'+escape(r.content.slice(0,180))+'</p><small>'+escape(r.phase || '')+'</small>'+ (r.error?'<p class="message-error">'+escape(r.error)+'</p>':'')+'<div class="task-buttons"><button class="subtle-button" data-run-chat="'+r.chatId+'">Open chat</button>'+(['running','queued'].includes(r.status)?'<button class="danger-button" data-cancel-run="'+r.id+'">Cancel</button>':'<button class="subtle-button" data-continue-run="'+r.id+'">Continue</button>')+'<button class="subtle-button" data-run-trace="'+r.id+'">Activity</button></div></div>').join(''));
  } else if(tab==='git') {
    const git=await api('/projects/'+p.id+'/git');if(!valid())return;
    if(!git.repository){view.innerHTML='<p class="workbench-intro">Track versions and commit selected project files.</p><p class="field-help">'+escape(git.error)+'</p><button class="primary-button" data-action="git-init" '+(busy?'disabled':'')+'>Initialize repository</button>';return;}
    view.innerHTML='<p class="workbench-intro">Branch: '+escape(git.branch || 'First commit')+'</p><form id="git-commit-form"><div class="git-files">'+git.files.map(f=>'<div class="file-row"><input type="checkbox" name="git-file" value="'+escape(f.path)+'" aria-label="Commit '+escape(f.path)+'" '+(!f.supported?'disabled':'')+'><span class="git-status">'+escape(f.status)+'</span><button type="button" data-git-diff="'+escape(f.path)+'" '+(!f.supported?'disabled':'')+'>'+escape(f.path)+'</button></div>').join('')+'</div><label>Commit message<input name="message" required maxlength="500" placeholder="Describe this change"></label><button class="primary-button" '+(busy||!git.files.length?'disabled':'')+'>Commit selected files</button></form><p class="field-help">Commits stay local. Other staged files are left out of this commit.</p><pre class="terminal-output">'+escape(git.commits || 'No commits yet.')+'</pre>';
  } else if(tab==='api') {
    view.innerHTML='<p class="workbench-intro">Test your running app’s API. Start the preview first. Requests stay on this project’s preview server.</p><form id="api-request-form"><div class="api-address"><select name="method" aria-label="HTTP method">'+['GET','POST','PUT','PATCH','DELETE','HEAD'].map(m=>'<option>'+m+'</option>').join('')+'</select><input name="path" required placeholder="/api/items" value="/api/items" aria-label="Endpoint path"></div><label>JSON body <span class="optional">optional</span><textarea name="body" rows="4" placeholder=\'{"name":"Example"}\'></textarea></label><button class="primary-button" '+(busy?'disabled':'')+'>Send request</button></form><div id="api-response" role="status"></div><div class="section-label">Recent responses</div>'+ (p.apiHistory || []).slice(-6).reverse().map(r=>'<details class="task-result"><summary>'+escape(r.method+' '+r.path+' · '+r.status)+'</summary><pre>'+escape(r.body)+'</pre></details>').join('');
  } else if(tab==='memory') {
    view.innerHTML='<p class="workbench-intro">Decisions saved here are included in future chats in this project. Keep credentials out of this text.</p><form id="memory-form"><label>Project memory<textarea name="memory" rows="12" maxlength="4000" placeholder="Preferred stack, naming conventions, decisions…">'+escape(p.memory || '')+'</textarea></label><button class="primary-button" '+(busy?'disabled':'')+'>Save memory</button></form><p class="field-help">The assistant also reads AGENTS.md from the project root. Project instructions remain in Project settings.</p><button class="subtle-button" data-action="agents-file">Open / create AGENTS.md</button>';
  }
}
Object.assign(actions,{
  'new-file':()=>{pendingCode='';$('save-file-path').value='src/new-file.js';$('save-file-error').textContent='';$('save-file-dialog').showModal();},
  'rename-file':()=>inputDialog('Rename / move file',editorPath,async to=>{await api('/projects/'+editorProject+'/file-op',{action:'rename',path:editorPath,to});editorPath=to;$('preview-title').textContent=to;await loadFiles();toast('File moved. Restore it from Changes if needed.');}),
  'trash-file':async()=>{await api('/projects/'+editorProject+'/file-op',{action:'trash',path:editorPath});$('preview-dialog').close();await loadFiles();toast('File moved to trash. Restore it from Changes.');},
  checkpoint:()=>inputDialog('Name this checkpoint','Project checkpoint',async label=>{await api('/projects/'+project().id+'/checkpoints',{label});await renderWorkbench();toast('Checkpoint saved.');}),
  starter:async()=>{const templates=await api('/templates');$('starter-options').innerHTML=templates.map(t=>'<button class="starter-card" data-template="'+escape(t.id)+'"><strong>'+escape(t.name)+'</strong><span>'+escape(t.description)+'</span></button>').join('');$('starter-dialog').showModal();},
  'git-init':async()=>{await api('/projects/'+project().id+'/git-init',{});await renderWorkbench();},
  'agents-file':async()=>{try{await previewFile('AGENTS.md');}catch(error){if(!/exist|404/i.test(error.message))throw error;await api('/projects/'+project().id+'/file',{path:'AGENTS.md',content:'# Project conventions\n\n'});await loadFiles();await previewFile('AGENTS.md');}},
  'fork-message':async target=>{const fork=await api('/chats/'+chat().id+'/fork',{messageId:target.dataset.id});updateChat(fork);state.selectedChat=fork.id;setPrompt('');render();toast('Chat forked. Both chats use the same project files.');},
  'retry-message':async target=>{const messages=chat().messages, index=messages.findIndex(m=>m.id===target.dataset.id), user=messages.slice(0,index).findLast(m=>m.role==='user');if(!user)throw Error('No request to retry.');setPrompt(user.content);await sendMessage();},
  'continue-message':async target=>{const message=chat().messages.find(m=>m.id===target.dataset.id);if(message.runId){await api('/runs/'+message.runId+'/continue',{});await syncRuns();}else{setPrompt('Continue the previous request from the saved project files. Inspect the current files and finish remaining work.');await sendMessage();}},
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!['git-commit-form','api-request-form','memory-form'].includes(form.id))return;event.preventDefault();const button=form.querySelector('button[type=submit],button.primary-button');button.disabled=true;
  try {
    const fields=new FormData(form);
    if(form.id==='git-commit-form'){const result=await api('/projects/'+project().id+'/git-commit',{paths:fields.getAll('git-file'),message:fields.get('message')});toast(result.output.trim());await renderWorkbench();}
    if(form.id==='memory-form'){applyProject(await api('/projects/'+project().id,{memory:fields.get('memory')},'PATCH'));toast('Project memory saved.');}
    if(form.id==='api-request-form'){
      const result=await api('/projects/'+project().id+'/http',{method:fields.get('method'),path:fields.get('path'),body:fields.get('body') || undefined});
      project().apiHistory ||= [];project().apiHistory.push(result);$('api-response').innerHTML='<p class="response-status '+(!result.success?'failed':'')+'">HTTP '+result.status+' · '+Math.round(result.seconds*1000)+' ms</p><pre class="terminal-output">'+escape(result.body)+'</pre>';
    }
  }catch(error){toast(error.message,true);}finally{button.disabled=false;}
});
document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-restore-checkpoint],[data-template],[data-git-diff],[data-cancel-run],[data-continue-run],[data-run-chat],[data-run-trace]');if(!target)return;
  try{
    if(target.dataset.restoreCheckpoint){await api('/projects/'+project().id+'/restore-checkpoint',{id:target.dataset.restoreCheckpoint});await loadFiles();await renderWorkbench();toast('Project restored. Restart the preview when ready.');}
    if(target.dataset.template){await api('/projects/'+project().id+'/scaffold',{template:target.dataset.template});$('starter-dialog').close();await reloadState();await loadFiles();toast('Connected starter files saved. Ask the assistant to customize them.');}
    if(target.dataset.gitDiff){const diff=await api('/projects/'+project().id+'/git-diff?path='+encodeURIComponent(target.dataset.gitDiff));$('review-title').textContent=diff.path;$('review-summary').textContent='Git diff';$('review-diff').innerHTML='<pre class="terminal-output">'+escape('Staged\n'+(diff.staged || '(none)')+'\nUnstaged\n'+(diff.unstaged || '(none; untracked files appear after commit)'))+'</pre>';$('undo-change').hidden=true;$('review-dialog').showModal();}
    if(target.dataset.cancelRun){await api('/runs/'+target.dataset.cancelRun+'/cancel',{});await syncRuns();}
    if(target.dataset.continueRun){await api('/runs/'+target.dataset.continueRun+'/continue',{});await syncRuns();}
    if(target.dataset.runChat)await selectChat(target.dataset.runChat);
    if(target.dataset.runTrace){const {run}=await api('/runs/'+target.dataset.runTrace);$('review-title').textContent='Run activity';$('review-summary').textContent=run.status;$('review-diff').innerHTML='<pre class="terminal-output">'+escape(run.events.map(e=>e.at+' '+(e.phase || e.type)+(e.activity?' '+JSON.stringify(e.activity):'')).join('\n')+'\n\n'+run.output)+'</pre>';$('undo-change').hidden=true;$('review-dialog').showModal();}
  }catch(error){toast(error.message,true);}
});
