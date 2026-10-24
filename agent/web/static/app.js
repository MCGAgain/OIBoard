// OIBoard Agent - Local Admin Frontend Controller (Pure Vanilla JS, 100% Offline Capable)

let state = {
  stats: {},
  folders: [],
  config: {},
  isScanning: false,
  isSyncing: false,
  files: [],
  fileSearch: '',
  selectedLang: 'all',
  theme: localStorage.getItem('agent_theme') || 'auto',
  showLoginModal: false,
};

function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  return Number(num).toLocaleString();
}

function formatDate(isoStr) {
  if (!isoStr || isoStr.startsWith('0001')) return '未扫描';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = message;
  toast.className = type;
  toast.style.display = 'block';
  toast.style.opacity = '1';
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 250);
  }, 3200);
}

async function api(path, options = {}) {
  try {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    throw err;
  }
}

async function fetchStatus() {
  try {
    const data = await api('/api/status');
    state.stats = data.stats || {};
    state.folders = data.folders || [];
    state.config = data.config || {};
    state.isScanning = data.is_scanning || false;
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
    const res = await api('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ force: forceFull })
    });
    showToast(forceFull ? '全量深度重扫完成' : '增量代码扫描完成', 'success');
    await fetchStatus();
    await fetchFiles();
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
    const res = await api('/api/sync', { method: 'POST' });
    showToast('数据已成功同步至 OIBoard 服务器！', 'success');
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
    btn.innerText = '等待选择...';
  }
  try {
    const res = await api('/api/browse-folder', { method: 'POST' });
    if (res.cancelled) return;
    if (res.path) {
      document.getElementById('new-folder-path').value = res.path;
      if (res.name && !document.getElementById('new-folder-name').value) {
        document.getElementById('new-folder-name').value = res.name;
      }
      showToast('已选取目录: ' + res.path, 'success');
    }
  } catch (err) {
    showToast('调起文件夹选择器失败: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="13" height="13" class="w-3 h-3 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"></path>
        </svg>
        <span>浏览选取文件夹...</span>
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
    showToast('请输入文件夹绝对路径或点击浏览选取', 'error');
    return;
  }

  try {
    const res = await api('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ path: p, name: n })
    });
    pathInput.value = '';
    nameInput.value = '';
    showToast('已添加并自动完成建档扫描！', 'success');
    await fetchStatus();
    await fetchFiles();
  } catch (err) {
    showToast('添加目录失败: ' + err.message, 'error');
  }
}

async function removeFolder(folderPath) {
  if (!confirm(`确定要移除监控目录：\n${folderPath}\n（不会删除您磁盘上的任何实际文件）？`)) {
    return;
  }
  try {
    await api('/api/folders', {
      method: 'DELETE',
      body: JSON.stringify({ path: folderPath })
    });
    showToast('目录已移除', 'success');
    await fetchStatus();
    await fetchFiles();
  } catch (err) {
    showToast('移除失败: ' + err.message, 'error');
  }
}

async function toggleFolder(folderPath, enabled) {
  try {
    await api('/api/folders/toggle', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath, enabled })
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
        auto_scan: true
      })
    });
    showToast('设置已保存并生效', 'success');
    await fetchStatus();
  } catch (err) {
    showToast('保存设置失败: ' + err.message, 'error');
  }
}

async function testConnection() {
  const serverInput = document.getElementById('cfg-server-url');
  const tokenInput = document.getElementById('cfg-sync-token');
  const btn = document.getElementById('btn-test-conn');
  btn.disabled = true;
  btn.innerText = '测试中...';

  try {
    const res = await api('/api/test-connection', {
      method: 'POST',
      body: JSON.stringify({
        server_url: serverInput.value.trim(),
        sync_token: tokenInput.value.trim()
      })
    });
    showToast(`连接成功！已连接至用户: ${res.username}`, 'success');
  } catch (err) {
    showToast('连接失败: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = '测试连通性';
  }
}

async function loginViaAccount() {
  const serverInput = document.getElementById('cfg-server-url');
  const uInput = document.getElementById('modal-username');
  const pInput = document.getElementById('modal-password');
  const btn = document.getElementById('btn-modal-login');

  if (!uInput.value || !pInput.value) {
    showToast('请输入用户名与密码', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerText = '正在验证...';
  try {
    const res = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        server_url: serverInput.value.trim(),
        username: uInput.value.trim(),
        password: pInput.value
      })
    });
    document.getElementById('cfg-sync-token').value = res.token;
    await saveSettings();
    showToast(`验证成功！已绑定用户 ${res.username} 的 Token`, 'success');
    closeLoginModal();
  } catch (err) {
    showToast('登录获取失败: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = '登录并提取 Token';
  }
}

function openLoginModal() {
  document.getElementById('login-modal').style.display = 'flex';
}

function closeLoginModal() {
  document.getElementById('login-modal').style.display = 'none';
}

function applyTheme(theme) {
  state.theme = theme;
  localStorage.setItem('agent_theme', theme);
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

let lastStatsJson = '';
function render() {
  const stats = state.stats || {};
  const currentStatsJson = JSON.stringify(stats);
  if (currentStatsJson !== lastStatsJson) {
    lastStatsJson = currentStatsJson;
    document.getElementById('stat-total-lines').innerText = formatNumber(stats.total_lines || 0);
    document.getElementById('stat-today-lines').innerText = '+' + formatNumber(stats.today_lines || 0);
    document.getElementById('stat-total-files').innerText = formatNumber(stats.total_files || 0);
    document.getElementById('stat-today-files').innerText = formatNumber(stats.today_files || 0) + ' 个变动';

    document.getElementById('stat-c-lines').innerText = formatNumber(stats.c_lines || 0);
    document.getElementById('stat-c-files').innerText = formatNumber(stats.c_files || 0) + ' 文件';
    document.getElementById('stat-cpp-lines').innerText = formatNumber(stats.cpp_lines || 0);
    document.getElementById('stat-cpp-files').innerText = formatNumber(stats.cpp_files || 0) + ' 文件';
    document.getElementById('stat-java-lines').innerText = formatNumber(stats.java_lines || 0);
    document.getElementById('stat-java-files').innerText = formatNumber(stats.java_files || 0) + ' 文件';

    document.getElementById('sync-last-time').innerText = formatDate(stats.last_sync_at);
    const syncStatusEl = document.getElementById('sync-status-badge');
    if (stats.last_sync_err) {
      syncStatusEl.className = 'status-badge err';
      syncStatusEl.innerText = '同步异常: ' + stats.last_sync_err;
      syncStatusEl.title = stats.last_sync_err;
    } else if (stats.last_sync_at && !stats.last_sync_at.startsWith('0001')) {
      syncStatusEl.className = 'status-badge ok';
      syncStatusEl.innerText = '已正常同步';
      syncStatusEl.title = '最近同步成功: ' + formatDate(stats.last_sync_at);
    } else {
      syncStatusEl.className = 'status-badge warn';
      syncStatusEl.innerText = '待配置同步';
    }
  }

  // 设置表单初始化 (仅未输入时回填)
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
  const btnInc = document.getElementById('btn-scan-inc');
  const btnFull = document.getElementById('btn-scan-full');
  const badge = document.getElementById('agent-status-badge');
  if (state.isScanning === lastScanningState) return;
  lastScanningState = state.isScanning;
  if (state.isScanning) {
    if (btnInc) btnInc.disabled = true;
    if (btnFull) btnFull.disabled = true;
    if (badge) {
      badge.className = 'status-badge scanning';
      badge.innerHTML = '<span class="pulse-dot"></span> 正在扫描磁盘...';
    }
  } else {
    if (btnInc) btnInc.disabled = false;
    if (btnFull) btnFull.disabled = false;
    if (badge) {
      badge.className = 'status-badge ok';
      badge.innerHTML = '<span class="pulse-dot"></span> 服务运行中';
    }
  }
}

let lastSyncingState = null;
function renderSyncButtons() {
  const btn = document.getElementById('btn-sync-now');
  if (!btn) return;
  if (state.isSyncing === lastSyncingState) return;
  lastSyncingState = state.isSyncing;
  if (state.isSyncing) {
    btn.disabled = true;
    btn.innerText = '正在同步...';
  } else {
    btn.disabled = false;
    btn.innerText = '立即同步至看板';
  }
}

let lastRenderedFoldersJson = '';
function renderFolderList() {
  const container = document.getElementById('folder-list-container');
  if (!container) return;

  const folders = state.folders || [];
  const currentFoldersJson = JSON.stringify(folders);
  if (currentFoldersJson === lastRenderedFoldersJson) {
    return;
  }
  lastRenderedFoldersJson = currentFoldersJson;
  if (folders.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 text-xs text-[var(--text-muted)] border border-dashed rounded-xl" style="padding: 1.5rem;">
        暂无监控目录，请在上方输入框或点击「浏览选取文件夹」导入您的算法刷题工程
      </div>
    `;
    return;
  }

  container.innerHTML = folders.map(f => `
    <div class="p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs" style="background: var(--bg-subtle);">
      <div class="space-y-1 overflow-hidden" style="max-width: 100%;">
        <div class="flex items-center space-x-2">
          <span class="font-bold text-[var(--text-primary)]">${f.name || '文件夹'}</span>
          <span class="status-badge ${f.enabled ? 'ok' : 'warn'}">${f.enabled ? '监控中' : '已暂停'}</span>
        </div>
        <div class="font-mono text-[11px] text-[var(--text-muted)] truncate" title="${f.path}">${f.path}</div>
        <div class="text-[10px] text-[var(--text-secondary)] flex items-center space-x-3 pt-0.5">
          <span>文件: <b class="font-mono">${f.file_count || 0}</b></span>
          <span>代码行: <b class="font-mono text-cyan-600 dark:text-cyan-400">${formatNumber(f.line_count || 0)}</b></span>
          <span>上次扫描: ${formatDate(f.last_scan)}</span>
        </div>
      </div>
      <div class="flex items-center space-x-2 shrink-0">
        <button onclick="toggleFolder('${f.path.replace(/'/g, "\\'")}', ${!f.enabled})" class="btn-secondary text-xs px-2.5 py-1">
          ${f.enabled ? '暂停' : '启用'}
        </button>
        <button onclick="removeFolder('${f.path.replace(/'/g, "\\'")}')" class="btn-secondary text-xs px-2.5 py-1" style="color: var(--apple-red);">
          移除
        </button>
      </div>
    </div>
  `).join('');
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

  document.getElementById('file-count-label').innerText = `共 ${filtered.length} 个文件`;

  if (filtered.length === 0) {
    container.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-xs text-[var(--text-muted)]">未找到匹配的源码文件</td></tr>`;
    return;
  }

  container.innerHTML = filtered.slice(0, 100).map(f => `
    <tr class="text-xs">
      <td class="font-mono text-[11px] text-[var(--text-muted)] font-semibold">
        #${f.id || '-'}
      </td>
      <td class="font-mono truncate" style="max-width: 24rem;" title="${f.path}">
        ${f.path}
      </td>
      <td>
        <span class="status-badge ${f.ext === 'c' ? 'warn' : (f.ext === 'cpp' ? 'ok' : 'scanning')} uppercase text-[10px] font-mono">
          ${f.ext}
        </span>
      </td>
      <td class="text-right font-mono font-bold text-cyan-600 dark:text-cyan-400">
        ${formatNumber(f.lines)}
      </td>
      <td class="text-right font-mono text-[var(--text-muted)] text-[11px]">
        ${(f.size / 1024).toFixed(1)} KB
      </td>
      <td class="text-right font-mono text-[var(--text-muted)] text-[11px]">
        ${formatDate(f.last_scanned)}
      </td>
    </tr>
  `).join('');
}

function initEventHandlers() {
  document.getElementById('btn-browse-folder')?.addEventListener('click', browseFolder);
  document.getElementById('btn-add-folder')?.addEventListener('click', addFolder);
  document.getElementById('new-folder-path')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFolder();
  });
  document.getElementById('new-folder-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFolder();
  });

  document.getElementById('btn-scan-inc')?.addEventListener('click', () => triggerScan(false));
  document.getElementById('btn-scan-full')?.addEventListener('click', () => triggerScan(true));
  document.getElementById('btn-sync-now')?.addEventListener('click', triggerSync);
  document.getElementById('btn-save-cfg')?.addEventListener('click', saveSettings);
  document.getElementById('btn-test-conn')?.addEventListener('click', testConnection);
  document.getElementById('btn-open-login-modal')?.addEventListener('click', openLoginModal);
  document.getElementById('btn-modal-cancel')?.addEventListener('click', closeLoginModal);
  document.getElementById('btn-modal-login')?.addEventListener('click', loginViaAccount);

  document.getElementById('file-search')?.addEventListener('input', (e) => {
    state.fileSearch = e.target.value;
    renderFileList();
  });

  document.querySelectorAll('.filter-lang-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-lang-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.selectedLang = e.target.dataset.lang;
      renderFileList();
    });
  });

  // 昼夜模式切换
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(next);
  });
}

// 页面初始化与自动轮询 (智能节流：后台标签页自动休眠，前台唤醒即时刷新)
window.addEventListener('DOMContentLoaded', async () => {
  applyTheme(state.theme);
  initEventHandlers();
  await fetchStatus();
  await fetchFiles();

  setInterval(() => {
    if (document.hidden) return;
    fetchStatus();
  }, 4000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      fetchStatus();
      fetchFiles();
    }
  });
});
