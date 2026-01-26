const App = window.SfenViewerApp;

const fileInput = document.getElementById('csv-file');
const savedFilesList = document.getElementById('saved-files-list');
const storageStatusDiv = document.getElementById('storage-status');
const boardsContainer = document.getElementById('boards-container');
const statusDisplay = document.getElementById('status-display');
const statusMessage = document.getElementById('status-message');
const minCountInput = document.getElementById('min-count');
const minMoveInput = document.getElementById('min-move');
const pageSizeInput = document.getElementById('page-size');
const dateFromInput = document.getElementById('date-from');
const dateToInput = document.getElementById('date-to');
const applySettingsButton = document.getElementById('apply-settings');
const targetUserInput = document.getElementById('target-user');
const pagination = document.getElementById('pagination');
const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
const commentModal = document.getElementById('comment-modal');
const commentTextarea = document.getElementById('comment-textarea');
const saveCommentButton = document.getElementById('save-comment');
const cancelCommentButton = document.getElementById('cancel-comment');

let allRecords = [];
let currentUserName = null;
let currentEditingSfen = null;
let currentPage = 1;
let targetUserName = '';

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusDisplay.classList.remove('hidden');
  statusDisplay.classList.toggle('is-error', isError);
}

function hideStatus() {
  statusDisplay.classList.add('hidden');
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
    li.className = 'flex items-center justify-between p-2 rounded-md hover:bg-white/10 transition-colors no-overflow';
    li.innerHTML = `
      <div class="flex-grow overflow-hidden mr-2 no-overflow">
        <strong class="text-sm block wrap-any">${name}</strong>
        <small class="text-xs text-gray-500">${new Date(createdAt).toLocaleString()}</small>
      </div>
      <div class="flex-shrink-0 space-x-1">
        <button data-name="${name}" class="load-btn text-xs btn-soft font-semibold py-1 px-2 rounded">読込</button>
      </div>
    `;
    savedFilesList.appendChild(li);
  });
  document.querySelectorAll('.load-btn').forEach(btn => btn.addEventListener('click', async (e) => {
    const name = e.target.dataset.name;
    await loadUser(name);
  }));
}

async function applyDateRangeDefaults(userName) {
  const range = await App.getUserDateRange(userName);
  dateFromInput.value = range.min || '';
  dateToInput.value = range.max || '';
}

async function loadUser(userName) {
  currentUserName = userName;
  allRecords = await App.loadUserRecords(userName);
  targetUserName = allRecords.find(r => r.targetUserName)?.targetUserName || '';
  if (targetUserName && !targetUserInput.value) targetUserInput.value = targetUserName;
  await applyDateRangeDefaults(userName);
  currentPage = 1;
  renderFilteredBoards();
}

function renderFilteredBoards() {
  if (!allRecords.length) {
    showStatus('表示するデータがありません。', true);
    return;
  }

  boardsContainer.innerHTML = '';
  const minCount = parseInt(minCountInput.value, 10) || 1;
  const minMove = parseInt(minMoveInput.value, 10) || 1;
  const pageSize = Math.max(parseInt(pageSizeInput.value, 10) || 60, 1);
  const dateFrom = dateFromInput.value || null;
  const dateTo = dateToInput.value || null;

  const filteredRecords = allRecords.filter(record => {
    const moveNumber = parseInt(record.sfen.split(' ')[3], 10);
    if (record.count < minCount || moveNumber < minMove) return false;
    if (dateFrom || dateTo) {
      if (!record.gameDate) return false;
      const recordDate = record.gameDate;
      if (dateFrom && recordDate < dateFrom) return false;
      if (dateTo && recordDate > dateTo) return false;
    }
    return true;
  });

  if (!filteredRecords.length) {
    showStatus('指定された条件に一致する局面はありません。');
    return;
  }

  const totalPages = Math.max(Math.ceil(filteredRecords.length / pageSize), 1);
  if (currentPage > totalPages) currentPage = totalPages;
  const startIndex = (currentPage - 1) * pageSize;
  const pageRecords = filteredRecords.slice(startIndex, startIndex + pageSize);

  displayBoards(pageRecords);
  pagination.classList.toggle('hidden', filteredRecords.length <= pageSize);
  pageInfo.textContent = `${currentPage} / ${totalPages} ページ (${filteredRecords.length} 件)`;
  prevPageButton.disabled = currentPage <= 1;
  nextPageButton.disabled = currentPage >= totalPages;

  showStatus(`${pageRecords.length} 件の局面を表示しています。`);
}

function displayBoards(records) {
  const chunkSize = 40;
  let index = 0;
  const renderChunk = () => {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < chunkSize && index < records.length; i++, index++) {
      fragment.appendChild(createBoardElement(records[index]));
    }
    boardsContainer.appendChild(fragment);
    if (index < records.length) requestAnimationFrame(renderChunk);
  };
  requestAnimationFrame(renderChunk);
}

function createBoardElement(record) {
  const { sfen, count, comment, senteWins, goteWins, draws, userSente, userGote, userSenteWins, userSenteDraws, userGoteWins, userGoteDraws } = record;
  const [boardState, turn, hands] = sfen.split(' ');
  const wrapper = document.createElement('div');
  wrapper.className = 'board-card panel-card rounded-lg shadow-md p-2 sm:p-3 flex flex-col items-start w-full wrap-any';
  wrapper.dataset.sfen = sfen;

  const goteHandDiv = document.createElement('div');
  goteHandDiv.className = 'hand-area w-full mb-1';
  goteHandDiv.innerHTML = `<div class="text-xs">後手持: ${App.parseHand(hands, 'gote').map(p => `<span class="piece-in-hand">${p.kanji}${p.count > 1 ? `<span class="text-xxs">${p.count}</span>` : ''}</span>`).join('') || 'なし'}</div>`;
  wrapper.appendChild(goteHandDiv);

  const boardWrap = document.createElement('div');
  boardWrap.className = 'w-full flex justify-center overflow-x-auto';
  boardWrap.appendChild(App.createBoardTable(boardState));
  wrapper.appendChild(boardWrap);

  const senteHandDiv = document.createElement('div');
  senteHandDiv.className = 'hand-area w-full mt-1';
  senteHandDiv.innerHTML = `<div class="text-xs">先手持: ${App.parseHand(hands, 'sente').map(p => `<span class="piece-in-hand">${p.kanji}${p.count > 1 ? `<span class="text-xxs">${p.count}</span>` : ''}</span>`).join('') || 'なし'}</div>`;
  wrapper.appendChild(senteHandDiv);

  const infoDiv = document.createElement('div');
  infoDiv.className = 'w-full mt-3 space-y-2 wrap-any';

  const decidedTotal = (senteWins || 0) + (goteWins || 0);
  const winRate = decidedTotal > 0 ? ((senteWins / decidedTotal) * 100).toFixed(1) : '-';
  const countHTML = (count !== null && !isNaN(count)) ? `<div class="text-center"><span class="text-xs text-gray-500">出現回数</span><p class="font-bold text-base text-emerald-300">${count}</p></div>` : '';

  infoDiv.innerHTML = `
    <div class="flex justify-around items-baseline">
      <div class="text-center"><span class="text-xs text-gray-500">手番</span><p class="font-bold text-base">${turn === 'b' ? '▲ 先手' : '△ 後手'}</p></div>
      ${countHTML}
    </div>
    <div class="mt-2 text-xs text-gray-600 text-center">
      <div>先手勝率: <span class="font-semibold">${winRate === '-' ? '-' : `${winRate}%`}</span></div>
      <div>勝敗: 先手 ${senteWins || 0} / 後手 ${goteWins || 0} / 引分 ${draws || 0}</div>
    </div>
  `;

  const buttonsContainer = document.createElement('div');
  buttonsContainer.className = 'grid grid-cols-2 gap-2 mt-2';

  const commentButton = document.createElement('button');
  commentButton.textContent = 'コメント';
  commentButton.className = 'text-xs btn-soft px-3 py-2 rounded-md w-full';
  commentButton.onclick = () => openCommentModal(sfen);
  buttonsContainer.appendChild(commentButton);

  const copyButton = document.createElement('button');
  copyButton.textContent = 'SFENコピー';
  copyButton.className = 'text-xs btn-soft px-3 py-2 rounded-md w-full';
  copyButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const tempTextArea = document.createElement('textarea');
    tempTextArea.value = sfen;
    document.body.appendChild(tempTextArea);
    tempTextArea.select();
    document.execCommand('copy');
    document.body.removeChild(tempTextArea);

    const originalText = e.target.textContent;
    e.target.textContent = 'コピー完了';
    e.target.classList.add('bg-green-500', 'text-white');
    setTimeout(() => {
      e.target.textContent = originalText;
      e.target.classList.remove('bg-green-500', 'text-white');
    }, 2000);
  });
  buttonsContainer.appendChild(copyButton);
  infoDiv.appendChild(buttonsContainer);

  const commentDisplayWrapper = document.createElement('div');
  const commentDisplay = document.createElement('p');
  commentDisplay.textContent = comment || 'コメントはありません';
  commentDisplay.className = `comment-display comment-box text-xs p-2 mt-2 rounded-md whitespace-pre-wrap ${comment ? '' : 'empty'}`;
  commentDisplayWrapper.appendChild(commentDisplay);
  infoDiv.appendChild(commentDisplayWrapper);

  const displayName = targetUserInput.value.trim() || targetUserName || record.targetUserName || '';
  if (displayName) {
    const senteLosses = Math.max((userSente || 0) - (userSenteWins || 0) - (userSenteDraws || 0), 0);
    const goteLosses = Math.max((userGote || 0) - (userGoteWins || 0) - (userGoteDraws || 0), 0);
    const senteDecided = (userSenteWins || 0) + senteLosses;
    const goteDecided = (userGoteWins || 0) + goteLosses;
    const senteWinRate = senteDecided > 0 ? ((userSenteWins / senteDecided) * 100).toFixed(1) : '-';
    const goteWinRate = goteDecided > 0 ? ((userGoteWins / goteDecided) * 100).toFixed(1) : '-';

    const userInfo = document.createElement('div');
    userInfo.className = 'text-xs text-gray-600 mt-2 text-center space-y-1';
    userInfo.innerHTML = `
      <div>ユーザー「${displayName}」: 先手 ${userSente || 0} / 後手 ${userGote || 0}</div>
      <div>先手勝率: <span class="font-semibold">${senteWinRate === '-' ? '-' : `${senteWinRate}%`}</span>（勝 ${userSenteWins || 0} / 引 ${userSenteDraws || 0} / 負 ${senteLosses}）</div>
      <div>後手勝率: <span class="font-semibold">${goteWinRate === '-' ? '-' : `${goteWinRate}%`}</span>（勝 ${userGoteWins || 0} / 引 ${userGoteDraws || 0} / 負 ${goteLosses}）</div>
    `;
    infoDiv.appendChild(userInfo);
  }

  wrapper.appendChild(infoDiv);
  return wrapper;
}

function openCommentModal(sfen) {
  currentEditingSfen = sfen;
  const record = allRecords.find(r => r.sfen === sfen);
  commentTextarea.value = record ? record.comment : '';
  commentModal.classList.remove('hidden');
  commentModal.classList.add('flex');
  commentTextarea.focus();
}

async function handleSaveComment() {
  if (!currentEditingSfen || !currentUserName) return;
  const record = allRecords.find(r => r.sfen === currentEditingSfen);
  if (record) record.comment = commentTextarea.value;
  await App.updateComment(currentUserName, currentEditingSfen, commentTextarea.value || '');
  commentModal.classList.add('hidden');
  commentModal.classList.remove('flex');
  renderFilteredBoards();
  currentEditingSfen = null;
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
}

async function initializeApp() {
  await App.initDb();
  const users = await App.getUsers();
  renderUsers(users);
  await updateStorageStatus();
}

applySettingsButton.addEventListener('click', renderFilteredBoards);
pageSizeInput.addEventListener('input', () => { currentPage = 1; renderFilteredBoards(); });
prevPageButton.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderFilteredBoards(); } });
nextPageButton.addEventListener('click', () => { currentPage++; renderFilteredBoards(); });
targetUserInput.addEventListener('input', renderFilteredBoards);
dateFromInput.addEventListener('change', () => { currentPage = 1; renderFilteredBoards(); });
dateToInput.addEventListener('change', () => { currentPage = 1; renderFilteredBoards(); });
cancelCommentButton.addEventListener('click', () => commentModal.classList.add('hidden'));
saveCommentButton.addEventListener('click', handleSaveComment);

initializeApp();
