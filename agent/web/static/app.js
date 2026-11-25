// OIBoard Agent - Local Controller (Zero Dependency, Event-Driven)

const state = {
  stats: {},
  folders: [],
  config: {},
  isScanning: false,
  isSyncing: false,
  files: [],
  fileSearch: '',
  selectedLang: 'all',
  theme: localStorage.getItem('agent_theme') || 'auto',
  captchaId: '',
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  return Number(num).toLocaleString();
}

function formatDate(isoStr) {
  if (!isoStr || isoStr.startsWith('0001')) return '未同步';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(window.__toastTimer);
  clearTimeout(window.__toastHideTimer);
  toast.textContent = message;
  toast.className = type;
  toast.style.display = 'block';
  requestAnimationFrame(() => toast.classList.add('visible'));
  window.__toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
    window.__toastHideTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 200);
  }, 3000);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function fetchStatus() {
  try {
    const data = await api('/api/status');
    state.stats = data.stats || {};
    state.folders = data.folders || [];
    state.config = data.config || {};
    state.isScanning = !!data.is_scanning;
    render();
  } catch (err) {
    console.error('Fetch status error:', err);
  }
}

async function fetchFiles() {
  try {
    const data = await api('/api/files');
    state.files = data.files || [];
    renderFileList();
  } catch (err) {
    console.error('Fetch files error:', err);
  }
}

async function triggerScan(forceFull = false) {
  state.isScanning = true;
  renderScanButtons();
  try {
    await api('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ force: forceFull }),
    });
    showToast(forceFull ? '全量重扫完成' : '增量扫描完成', 'success');
    await Promise.all([fetchStatus(), fetchFiles()]);
  } catch (err) {
    showToast('扫描失败: ' + err.message, 'error');
  } finally {
    state.isScanning = false;
    renderScanButtons();
  }
}

async function triggerSync() {
  state.isSyncing = true;
  renderSyncButtons();
  try {
    await api('/api/sync', { method: 'POST' });
    showToast('同步成功', 'success');
    await fetchStatus();
  } catch (err) {
    showToast('同步失败: ' + err.message, 'error');
  } finally {
    state.isSyncing = false;
    renderSyncButtons();
  }
}

async function browseFolder() {
  const btn = document.getElementById('btn-browse-folder');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '选择中...';
  }
  try {
    const res = await api('/api/browse-folder', { method: 'POST' });
    if (res.cancelled) return;
    if (res.path) {
      document.getElementById('new-folder-path').value = res.path;
      if (res.name && !document.getElementById('new-folder-name').value) {
        document.getElementById('new-folder-name').value = res.name;
      }
      showToast('已选择: ' + res.path, 'success');
    }
  } catch (err) {
    showToast('选择失败: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <span>选择文件夹</span>
      `;
    }
  }
}

async function addFolder() {
  const pathInput = document.getElementById('new-folder-path');
  const nameInput = document.getElementById('new-folder-name');
  const p = pathInput.value.trim();
  const n = nameInput.value.trim();
  if (!p) {
    showToast('请输入文件夹路径', 'error');
    return;
  }
  try {
    await api('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ path: p, name: n }),
    });
    pathInput.value = '';
    nameInput.value = '';
    showToast('已添加目录', 'success');
    await Promise.all([fetchStatus(), fetchFiles()]);
  } catch (err) {
    showToast('添加失败: ' + err.message, 'error');
  }
}

async function removeFolder(folderPath) {
  if (!confirm(`移除监控目录：\n${folderPath}\n（不会删除本地文件）`)) return;
  try {
    await api('/api/folders', {
      method: 'DELETE',
      body: JSON.stringify({ path: folderPath }),
    });
    showToast('已移除', 'success');
    await Promise.all([fetchStatus(), fetchFiles()]);
  } catch (err) {
    showToast('移除失败: ' + err.message, 'error');
  }
}

async function toggleFolder(folderPath, enabled) {
  try {
    await api('/api/folders/toggle', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath, enabled }),
    });
    await fetchStatus();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
  }
}

async function saveSettings() {
  const serverInput = document.getElementById('cfg-server-url');
  const tokenInput = document.getElementById('cfg-sync-token');
  try {
    await api('/api/config', {
      method: 'POST',
      body: JSON.stringify({
        server_url: serverInput.value.trim(),
        sync_token: tokenInput.value.trim(),
        auto_sync: true,
        auto_scan: true,
      }),
    });
    showToast('配置已保存', 'success');
    await fetchStatus();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function testConnection() {
  const serverInput = document.getElementById('cfg-server-url');
  const tokenInput = document.getElementById('cfg-sync-token');
  const btn = document.getElementById('btn-test-conn');
  btn.disabled = true;
  btn.textContent = '测试中...';
  try {
    const res = await api('/api/test-connection', {
      method: 'POST',
      body: JSON.stringify({
        server_url: serverInput.value.trim(),
        sync_token: tokenInput.value.trim(),
      }),
    });
    showToast(`连接正常 (${res.username})`, 'success');
  } catch (err) {
    showToast('连接失败: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

// --- Login Modal + CAPTCHA Flow ---
function setLoginError(msg) {
  const el = document.getElementById('modal-login-err');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.style.display = 'block';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

async function fetchLoginCaptcha() {
  const img = document.getElementById('modal-captcha-img');
  const placeholder = document.getElementById('modal-captcha-placeholder');
  const serverUrl = (document.getElementById('cfg-server-url')?.value || '').trim();
  state.captchaId = '';
  if (img) img.style.display = 'none';
  if (placeholder) {
    placeholder.textContent = '加载中...';
    placeholder.style.display = 'inline';
  }

  try {
    const qs = serverUrl ? `?server_url=${encodeURIComponent(serverUrl)}` : '';
    const data = await api(`/api/captcha${qs}`);
    state.captchaId = data.captcha_id || '';
    if (img && data.captcha_image) {
      img.src = data.captcha_image;
      img.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
    }
  } catch (err) {
    if (placeholder) {
      placeholder.textContent = '点击重试';
      placeholder.style.display = 'inline';
    }
    setLoginError('获取验证码失败: ' + err.message);
  }
}

function openLoginModal() {
  setLoginError('');
  const captchaInput = document.getElementById('modal-captcha');
  if (captchaInput) captchaInput.value = '';
  const modal = document.getElementById('login-modal');
  if (modal) modal.classList.add('open');
  fetchLoginCaptcha();
  setTimeout(() => document.getElementById('modal-username')?.focus(), 50);
}

function closeLoginModal() {
  const modal = document.getElementById('login-modal');
  if (modal) modal.classList.remove('open');
}

async function loginViaAccount(e) {
  if (e) e.preventDefault();
  setLoginError('');
  const serverUrl = (document.getElementById('cfg-server-url')?.value || '').trim();
  const username = (document.getElementById('modal-username')?.value || '').trim();
  const password = document.getElementById('modal-password')?.value || '';
  const captchaCode = (document.getElementById('modal-captcha')?.value || '').trim();
  const btn = document.getElementById('btn-modal-login');

  if (!username || !password) {
    setLoginError('请输入用户名和密码');
    return;
  }
  if (!state.captchaId || !captchaCode) {
    setLoginError('请输入图形验证码');
    return;
  }

  btn.disabled = true;
  btn.textContent = '登录中...';
  try {
    const res = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        server_url: serverUrl,
        username,
        password,
        captcha_id: state.captchaId,
        captcha_code: captchaCode,
      }),
    });
    if (res.token) {
      document.getElementById('cfg-sync-token').value = res.token;
    }
    document.getElementById('modal-password').value = '';
    document.getElementById('modal-captcha').value = '';
    closeLoginModal();
    showToast(`已绑定账号 ${res.username}`, 'success');
    await fetchStatus();
  } catch (err) {
    setLoginError(err.message);
    document.getElementById('modal-captcha').value = '';
    await fetchLoginCaptcha();
  } finally {
    btn.disabled = false;
    btn.textContent = '登录并绑定';
  }
}

// --- Theme ---
function applyTheme(theme) {
  state.theme = theme;
  localStorage.setItem('agent_theme', theme);
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
  const sun = document.getElementById('icon-sun');
  const moon = document.getElementById('icon-moon');
  if (sun) sun.style.display = isDark ? 'none' : 'inline-block';
  if (moon) moon.style.display = isDark ? 'inline-block' : 'none';
}

// --- Render ---
let lastStatsJson = '';
function render() {
  const stats = state.stats || {};
  const currentStatsJson = JSON.stringify(stats);
  if (currentStatsJson !== lastStatsJson) {
    lastStatsJson = currentStatsJson;
    document.getElementById('stat-total-lines').textContent = formatNumber(stats.total_lines || 0);
    document.getElementById('stat-today-lines').textContent = '+' + formatNumber(stats.today_lines || 0);
    document.getElementById('stat-total-files').textContent = formatNumber(stats.total_files || 0);
    document.getElementById('stat-today-files').textContent = formatNumber(stats.today_files || 0) + ' 个文件';

    document.getElementById('stat-c-lines').textContent = formatNumber(stats.c_lines || 0);
    document.getElementById('stat-c-files').textContent = `(${formatNumber(stats.c_files || 0)})`;
    document.getElementById('stat-cpp-lines').textContent = formatNumber(stats.cpp_lines || 0);
    document.getElementById('stat-cpp-files').textContent = `(${formatNumber(stats.cpp_files || 0)})`;
    document.getElementById('stat-java-lines').textContent = formatNumber(stats.java_lines || 0);
    document.getElementById('stat-java-files').textContent = `(${formatNumber(stats.java_files || 0)})`;

    document.getElementById('sync-last-time').textContent = formatDate(stats.last_sync_at);
    const syncStatusEl = document.getElementById('sync-status-badge');
    if (stats.last_sync_err) {
      syncStatusEl.className = 'status-badge err';
      syncStatusEl.textContent = '异常: ' + stats.last_sync_err;
      syncStatusEl.title = stats.last_sync_err;
    } else if (stats.last_sync_at && !stats.last_sync_at.startsWith('0001')) {
      syncStatusEl.className = 'status-badge ok';
      syncStatusEl.textContent = '已同步';
      syncStatusEl.title = formatDate(stats.last_sync_at);
    } else {
      syncStatusEl.className = 'status-badge warn';
      syncStatusEl.textContent = '待配置';
    }
  }

  const serverInput = document.getElementById('cfg-server-url');
  if (serverInput && !serverInput.matches(':focus')) {
    serverInput.value = state.config.server_url || 'http://198.44.63.140:2053';
  }
  const tokenInput = document.getElementById('cfg-sync-token');
  if (tokenInput && !tokenInput.matches(':focus')) {
    tokenInput.value = state.config.sync_token || '';
  }

  renderFolderList();
  renderScanButtons();
  renderSyncButtons();
}

let lastScanningState = null;
function renderScanButtons() {
  if (state.isScanning === lastScanningState) return;
  lastScanningState = state.isScanning;
  const btnInc = document.getElementById('btn-scan-inc');
  const btnFull = document.getElementById('btn-scan-full');
  const badge = document.getElementById('agent-status-badge');
  if (btnInc) btnInc.disabled = state.isScanning;
  if (btnFull) btnFull.disabled = state.isScanning;
  if (badge) {
    badge.className = state.isScanning ? 'status-badge scanning' : 'status-badge ok';
    badge.innerHTML = state.isScanning
      ? '<span class="dot"></span>扫描中'
      : '<span class="dot"></span>运行中';
  }
}

let lastSyncingState = null;
function renderSyncButtons() {
  if (state.isSyncing === lastSyncingState) return;
  lastSyncingState = state.isSyncing;
  const btn = document.getElementById('btn-sync-now');
  if (!btn) return;
  btn.disabled = state.isSyncing;
  btn.textContent = state.isSyncing ? '同步中...' : '立即同步';
}

let lastRenderedFoldersJson = '';
function renderFolderList() {
  const container = document.getElementById('folder-list-container');
  if (!container) return;

  const folders = state.folders || [];
  const currentFoldersJson = JSON.stringify(folders);
  if (currentFoldersJson === lastRenderedFoldersJson) return;
  lastRenderedFoldersJson = currentFoldersJson;

  if (folders.length === 0) {
    container.innerHTML = '<div class="folder-empty">暂无监控目录</div>';
    return;
  }

  container.innerHTML = folders.map(f => {
    const safePath = escapeHtml(f.path);
    const jsPath = f.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
      <div class="folder-item">
        <div class="folder-info">
          <div class="folder-name-row">
            <span class="folder-name">${escapeHtml(f.name || '目录')}</span>
            <span class="status-badge ${f.enabled ? 'ok' : 'warn'}">${f.enabled ? '监控中' : '已暂停'}</span>
          </div>
          <div class="folder-path mono" title="${safePath}">${safePath}</div>
          <div class="folder-stats mono">
            <span>${f.file_count || 0} 文件</span>
            <span>${formatNumber(f.line_count || 0)} 行</span>
            <span>${formatDate(f.last_scan)}</span>
          </div>
        </div>
        <div class="btn-group shrink-0">
          <button onclick="toggleFolder('${jsPath}', ${!f.enabled})" class="btn btn-secondary btn-sm">${f.enabled ? '暂停' : '启用'}</button>
          <button onclick="removeFolder('${jsPath}')" class="btn btn-danger-ghost btn-sm">移除</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderFileList() {
  const container = document.getElementById('file-list-body');
  if (!container) return;

  const q = (state.fileSearch || '').toLowerCase().trim();
  const langFilter = state.selectedLang || 'all';

  const filtered = (state.files || []).filter(f => {
    if (langFilter !== 'all' && f.ext !== langFilter) return false;
    if (q && !f.path.toLowerCase().includes(q)) return false;
    return true;
  });

  document.getElementById('file-count-label').textContent = String(filtered.length);

  if (filtered.length === 0) {
    container.innerHTML = '<tr><td colspan="6" class="empty-cell">暂无匹配文件</td></tr>';
    return;
  }

  container.innerHTML = filtered.slice(0, 120).map(f => `
    <tr>
      <td class="mono muted">#${f.id || '-'}</td>
      <td class="mono path-cell" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</td>
      <td><span class="chip mono">${escapeHtml((f.ext || '').toUpperCase())}</span></td>
      <td class="right mono strong">${formatNumber(f.lines)}</td>
      <td class="right mono muted">${(f.size / 1024).toFixed(1)} KB</td>
      <td class="right mono muted">${formatDate(f.last_scanned)}</td>
    </tr>
  `).join('');
}

function initEventHandlers() {
  document.getElementById('btn-browse-folder')?.addEventListener('click', browseFolder);
  document.getElementById('btn-add-folder')?.addEventListener('click', addFolder);
  document.getElementById('new-folder-path')?.addEventListener('keydown', e => { if (e.key === 'Enter') addFolder(); });
  document.getElementById('new-folder-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') addFolder(); });

  document.getElementById('btn-scan-inc')?.addEventListener('click', () => triggerScan(false));
  document.getElementById('btn-scan-full')?.addEventListener('click', () => triggerScan(true));
  document.getElementById('btn-sync-now')?.addEventListener('click', triggerSync);
  document.getElementById('btn-save-cfg')?.addEventListener('click', saveSettings);
  document.getElementById('btn-test-conn')?.addEventListener('click', testConnection);

  document.getElementById('btn-open-login-modal')?.addEventListener('click', openLoginModal);
  document.getElementById('btn-modal-cancel')?.addEventListener('click', closeLoginModal);
  document.getElementById('btn-modal-close')?.addEventListener('click', closeLoginModal);
  document.getElementById('btn-refresh-captcha')?.addEventListener('click', fetchLoginCaptcha);
  document.getElementById('login-form')?.addEventListener('submit', loginViaAccount);
  document.getElementById('login-modal')?.addEventListener('click', e => {
    if (e.target.id === 'login-modal') closeLoginModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLoginModal();
  });

  document.getElementById('file-search')?.addEventListener('input', e => {
    state.fileSearch = e.target.value;
    renderFileList();
  });

  document.querySelectorAll('.filter-lang-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('.filter-lang-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.selectedLang = e.currentTarget.dataset.lang;
      renderFileList();
    });
  });

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    if (typeof document.startViewTransition === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(() => applyTheme(next));
    } else {
      applyTheme(next);
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  applyTheme(state.theme);
  initEventHandlers();
  await Promise.all([fetchStatus(), fetchFiles()]);

  setInterval(() => {
    if (!document.hidden) fetchStatus();
  }, 5000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      fetchStatus();
      fetchFiles();
    }
  });
});
