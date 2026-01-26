const App = window.SfenViewerApp;

const fileInput = document.getElementById('csv-file');
const savedFilesList = document.getElementById('saved-files-list');
const storageStatusDiv = document.getElementById('storage-status');
const storageBreakdownDiv = document.getElementById('storage-breakdown');
const deleteFromInput = document.getElementById('delete-from');
const deleteToInput = document.getElementById('delete-to');
const deletePreview = document.getElementById('delete-preview');
const deleteByRangeButton = document.getElementById('delete-by-range');
const statusDisplay = document.getElementById('status-display');
const statusMessage = document.getElementById('status-message');

let currentUserName = null;

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusDisplay.classList.remove('hidden');
  statusDisplay.classList.toggle('is-error', isError);
}

function renderUsers(users) {
  savedFilesList.innerHTML = '';
  if (!users.length) {
    savedFilesList.innerHTML = '<li class="text-sm text-gray-500">保存済みのデータはありません。</li>';
    return;
  }
  users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  users.forEach(({ name, createdAt }) => {
    const li = document.createElement('li');
    li.className = 'user-list-item p-2 rounded-md hover:bg-white/10 transition-colors no-overflow';
    
    const mainDiv = document.createElement('div');
    mainDiv.className = 'user-list-main overflow-hidden no-overflow';
    
    const nameStrong = document.createElement('strong');
    nameStrong.className = 'text-sm block wrap-any';
    nameStrong.textContent = name;
    
    const dateSmall = document.createElement('small');
    dateSmall.className = 'text-xs text-gray-500';
    dateSmall.textContent = new Date(createdAt).toLocaleString();
    
    mainDiv.appendChild(nameStrong);
    mainDiv.appendChild(dateSmall);
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'user-list-actions';
    
    const selectBtn = document.createElement('button');
    selectBtn.dataset.name = name;
    selectBtn.className = 'select-btn text-xs btn-soft font-semibold py-1 px-2 rounded';
    selectBtn.textContent = '選択';
    
    const downloadBtn = document.createElement('button');
    downloadBtn.dataset.name = name;
    downloadBtn.className = 'download-btn text-xs bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-1 px-2 rounded';
    downloadBtn.textContent = 'CSV';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.dataset.name = name;
    deleteBtn.className = 'delete-btn text-xs bg-rose-500 hover:bg-rose-600 text-white font-semibold py-1 px-2 rounded';
    deleteBtn.textContent = '削除';
    
    actionsDiv.appendChild(selectBtn);
    actionsDiv.appendChild(downloadBtn);
    actionsDiv.appendChild(deleteBtn);
    li.appendChild(mainDiv);
    li.appendChild(actionsDiv);
    savedFilesList.appendChild(li);
  });

  document.querySelectorAll('.select-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    currentUserName = e.target.dataset.name;
    await applyDateRangeDefaults(currentUserName);
    await updateDeletePreview();
    showStatus(`ユーザー「${currentUserName}」を選択しました。`);
  }));

  document.querySelectorAll('.download-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    const name = e.target.dataset.name;
    const records = await App.loadUserRecords(name);
    const csvText = App.generateCsvFromRecords(records.map(r => ({ ...r, userName: name })));
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvText], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `${name}_commented.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }));

  document.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    const name = e.target.dataset.name;
    if (!confirm(`ユーザー「${name}」のデータをすべて削除しますか？`)) return;
    await App.deleteUser(name);
    currentUserName = null;
    await refreshUsers();
    await updateStorageStatus();
    updateDeletePreview();
  }));
}

async function applyDateRangeDefaults(userName) {
  const range = await App.getUserDateRange(userName);
  deleteFromInput.value = range.min || '';
  deleteToInput.value = range.max || '';
}

async function refreshUsers() {
  const users = await App.getUsers();
  renderUsers(users);
}

async function updateDeletePreview() {
  if (!currentUserName) {
    deletePreview.textContent = '削除対象: 0 件';
    return;
  }
  const from = deleteFromInput.value || null;
  const to = deleteToInput.value || null;
  const count = await App.countByDateRange(currentUserName, from, to);
  deletePreview.textContent = `削除対象: ${count} 件`;
}

async function handleDeleteByRange() {
  if (!currentUserName) {
    showStatus('削除するユーザーを先に選択してください。', true);
    return;
  }
  const from = deleteFromInput.value || null;
  const to = deleteToInput.value || null;
  const count = await App.countByDateRange(currentUserName, from, to);
  if (count === 0) {
    showStatus('削除対象がありません。', true);
    return;
  }
  if (!confirm(`期間内の ${count} 件を削除しますか？`)) return;
  const deleted = await App.deleteByDateRange(currentUserName, from, to);
  const remaining = await App.countUserPositions(currentUserName);
  if (remaining === 0) {
    await App.deleteUser(currentUserName);
    currentUserName = null;
  }
  await refreshUsers();
  if (currentUserName) {
    await applyDateRangeDefaults(currentUserName);
  }
  await updateStorageStatus();
  showStatus(`期間内の ${deleted} 件を削除しました。`);
}

async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  showStatus('ファイルを処理中...');

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const rawText = e.target.result;
      const records = App.parseData(rawText, file.name);
      if (!records.length) {
        showStatus('有効なデータが見つかりません。', true);
        return;
      }
      const userName = records.find(r => r.userName)?.userName || records.find(r => r.targetUserName)?.targetUserName || '未指定';
      await App.saveUserRecords(userName, records.map(r => ({ ...r, userName })));
      currentUserName = userName;
      await applyDateRangeDefaults(currentUserName);
      await refreshUsers();
      await updateStorageStatus();
      await updateDeletePreview();
      showStatus(`ユーザー「${userName}」にデータを追加しました。`);
    } catch (err) {
      console.error(err);
      showStatus(`エラー: ${err.message}`, true);
    }
  };
  reader.readAsText(file);
}

async function updateStorageStatus() {
  const estimate = await App.estimateStorage();
  if (!estimate) {
    storageStatusDiv.textContent = 'ストレージ使用量: 取得できません';
    return;
  }
  const usage = estimate.usage || 0;
  const quota = estimate.quota || 0;
  const percentage = quota > 0 ? ((usage / quota) * 100).toFixed(2) : 0;
  storageStatusDiv.textContent = `使用量: ${(usage / 1024 / 1024).toFixed(1)} MB / ${(quota / 1024 / 1024).toFixed(0)} MB (${percentage}%)`;

  const stats = await App.getUserStats();
  if (!stats.length) {
    storageBreakdownDiv.textContent = '内訳: データはありません。';
    return;
  }
  stats.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = stats.reduce((sum, s) => sum + s.bytes, 0);
  const items = stats.map(stat => {
    const mb = stat.bytes / 1024 / 1024;
    const ratio = totalBytes > 0 ? ((stat.bytes / totalBytes) * 100).toFixed(1) : '0.0';
    const dateInfo = stat.minDate && stat.maxDate ? `(${stat.minDate}〜${stat.maxDate})` : '';
    return `・${stat.name}: ${stat.count}件 / ${mb.toFixed(2)} MB (${ratio}%) ${dateInfo}`;
  });
  storageBreakdownDiv.innerHTML = `内訳（概算）:<br>${items.join('<br>')}`;
}

async function initializeApp() {
  await App.initDb();
  await refreshUsers();
  await updateStorageStatus();
}

fileInput.addEventListener('change', handleFileSelect);
deleteFromInput.addEventListener('change', updateDeletePreview);
deleteToInput.addEventListener('change', updateDeletePreview);
deleteByRangeButton.addEventListener('click', handleDeleteByRange);

initializeApp();
