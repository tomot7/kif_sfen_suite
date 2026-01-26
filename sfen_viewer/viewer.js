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
const userFilterEnableInput = document.getElementById('user-filter-enable');
const userMaxWinrateInput = document.getElementById('user-max-winrate');
const userMinCountInput = document.getElementById('user-min-count');
const pagination = document.getElementById('pagination');
const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
const analysisModal = document.getElementById('analysis-modal');
const analysisBoard = document.getElementById('analysis-board');
const analysisStatus = document.getElementById('analysis-status');
const infoDepth = document.getElementById('info-depth');
const infoNodes = document.getElementById('info-nodes');
const infoNps = document.getElementById('info-nps');
const infoScore = document.getElementById('info-score');
const infoTime = document.getElementById('info-time');
const analysisMoveTimeInput = document.getElementById('analysis-movetime');
const analysisMultiPvInput = document.getElementById('analysis-multipv');
const analysisStartButton = document.getElementById('analysis-start');
const analysisStopButton = document.getElementById('analysis-stop');
const analysisResetButton = document.getElementById('analysis-reset');
const analysisUndoButton = document.getElementById('analysis-undo');
const pvLinesDiv = document.getElementById('pv-lines');
const playedMovesDiv = document.getElementById('played-moves');
const applyPvButton = document.getElementById('apply-pv');
const closeAnalysisButton = document.getElementById('close-analysis');

let allRecords = [];
let currentUserName = null;
let currentPage = 1;
let targetUserName = '';
let analysisState = null;
let engineInstance = null;
let engineReadyPromise = null;
let engineInitialized = false;
let shogiOpsPromise = null;
let engineWaiters = [];
let legalMovesCache = [];
let manualSelection = null;
let lastInfo = null;
const FILES = ['9', '8', '7', '6', '5', '4', '3', '2', '1'];
const RANKS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

function showStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusDisplay.classList.remove('hidden');
  statusDisplay.classList.toggle('is-error', isError);
}

function hideStatus() {
  statusDisplay.classList.add('hidden');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
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
    li.innerHTML = `
      <div class="user-list-main overflow-hidden no-overflow">
        <strong class="text-sm block wrap-any">${name}</strong>
        <small class="text-xs text-gray-500">${new Date(createdAt).toLocaleString()}</small>
      </div>
      <div class="user-list-actions">
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
  targetUserInput.value = targetUserName || '';
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
  const userFilterEnabled = userFilterEnableInput.checked;
  const maxUserWinRateRaw = parseFloat(userMaxWinrateInput.value);
  const maxUserWinRate = Number.isFinite(maxUserWinRateRaw)
    ? Math.min(Math.max(maxUserWinRateRaw, 0), 100)
    : 100;
  const minUserCount = Math.max(parseInt(userMinCountInput.value, 10) || 1, 1);

  if (userFilterEnabled && !targetUserName) {
    showStatus('対象ユーザー名がデータに含まれていないため、ユーザー成績の絞り込みは利用できません。', true);
    return;
  }

  const filteredRecords = allRecords.filter(record => {
    const moveNumber = parseInt(record.sfen.split(' ')[3], 10);
    if (record.count < minCount || moveNumber < minMove) return false;
    if (dateFrom || dateTo) {
      if (!record.gameDate) return false;
      const recordDate = record.gameDate;
      if (dateFrom && recordDate < dateFrom) return false;
      if (dateTo && recordDate > dateTo) return false;
    }
    if (userFilterEnabled) {
      const userWins = (record.userSenteWins || 0) + (record.userGoteWins || 0);
      const userDraws = (record.userSenteDraws || 0) + (record.userGoteDraws || 0);
      const userGames = (record.userSente || 0) + (record.userGote || 0);
      const decided = Math.max(userGames - userDraws, 0);
      const winRate = decided > 0 ? (userWins / decided) * 100 : 0;
      if (userGames < minUserCount) return false;
      if (winRate > maxUserWinRate) return false;
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

  const analysisButton = document.createElement('button');
  analysisButton.textContent = 'AI解析';
  analysisButton.className = 'text-xs btn-soft px-3 py-2 rounded-md w-full';
  analysisButton.onclick = () => openAnalysis(record);
  buttonsContainer.appendChild(analysisButton);

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

// --- AI解析関連 ---
async function loadShogiOps() {
  if (shogiOpsPromise) return shogiOpsPromise;
  shogiOpsPromise = (async () => {
    const [sfenMod, compatMod, utilMod] = await Promise.all([
      import('./vendors/shogiops/sfen.js'),
      import('./vendors/shogiops/compat.js'),
      import('./vendors/shogiops/util.js')
    ]);
    return {
      parseSfen: sfenMod.parseSfen,
      makeSfen: sfenMod.makeSfen,
      shogigroundMoveDests: compatMod.shogigroundMoveDests,
      shogigroundDropDests: compatMod.shogigroundDropDests,
      parseSquareName: utilMod.parseSquareName,
      makeUsi: utilMod.makeUsi,
      parseUsi: utilMod.parseUsi
    };
  })();
  return shogiOpsPromise;
}

function resultValue(res) {
  if (!res) return null;
  if (res.isOk) return res.value;
  if (res.ok) return res.value;
  if (res._tag === 'Ok') return res.value;
  return null;
}

async function parsePositionFromSfen(sfen) {
  const ops = await loadShogiOps();
  const parsed = ops.parseSfen('standard', sfen, false);
  const pos = resultValue(parsed);
  if (!pos) throw new Error('SFENの解析に失敗しました');
  return { ops, pos };
}

function squareNameToCoord(name) {
  const file = name.charAt(0);
  const rank = name.charAt(1);
  return { x: FILES.indexOf(file), y: RANKS.indexOf(rank) };
}

async function generateLegalMoves(pos, ops) {
  const moves = [];
  const ctx = pos.ctx();
  const moveDests = ops.shogigroundMoveDests(pos);
  moveDests.forEach((dests, fromName) => {
    const from = ops.parseSquareName(fromName);
    dests.forEach(destName => {
      const to = ops.parseSquareName(destName);
      const base = { from, to };
      const normal = { ...base };
      if (pos.isLegal(normal, ctx)) moves.push(ops.makeUsi(normal));
      const promo = { ...base, promotion: true };
      if (pos.isLegal(promo, ctx)) moves.push(ops.makeUsi(promo));
    });
  });
  const dropDests = ops.shogigroundDropDests(pos);
  dropDests.forEach((dests, pieceName) => {
    const role = (pieceName.split(' ')[1] || '').trim();
    dests.forEach(destName => {
      const to = ops.parseSquareName(destName);
      const drop = { role, to };
      if (pos.isLegal(drop, ctx)) moves.push(ops.makeUsi(drop));
    });
  });
  return moves;
}

function updateAnalysisInfo(info) {
  if (!info) {
    infoDepth.textContent = '-';
    infoNodes.textContent = '-';
    infoNps.textContent = '-';
    infoScore.textContent = '-';
    infoTime.textContent = '-';
    return;
  }
  infoDepth.textContent = info.depth ?? '-';
  infoNodes.textContent = info.nodes ?? '-';
  infoNps.textContent = info.nps ?? '-';
  infoScore.textContent = info.scoreText ?? '-';
  infoTime.textContent = info.time ?? '-';
}

function setAnalysisStatus(message, isError = false) {
  analysisStatus.textContent = message;
  analysisStatus.classList.toggle('text-red-400', isError);
}

async function renderAnalysis() {
  if (!analysisState) return;
  const { ops, pos, lastMove } = analysisState;
  const sfen = ops.makeSfen(pos);
  const boardPart = sfen.split(' ')[0];
  const table = App.createBoardTable(boardPart);
  analysisBoard.innerHTML = '';
  [...table.rows].forEach((tr, y) => {
    [...tr.cells].forEach((td, x) => {
      td.dataset.x = x;
      td.dataset.y = y;
      td.classList.add('cell-btn');
      if (lastMove) {
        if (lastMove.from && lastMove.from.x === x && lastMove.from.y === y) td.classList.add('last-move');
        if (lastMove.to && lastMove.to.x === x && lastMove.to.y === y) td.classList.add('last-move');
      }
      if (manualSelection && manualSelection.x === x && manualSelection.y === y) {
        td.classList.add('selected');
      }
      td.addEventListener('click', () => handleBoardClick(x, y));
    });
  });
  analysisBoard.appendChild(table);
  renderPlayedMoves();
}

function renderPlayedMoves() {
  if (!analysisState) return;
  playedMovesDiv.innerHTML = analysisState.moves.map((m, idx) => `<div>${idx + 1}. ${m}</div>`).join('') || '<div class="text-gray-500">まだ指し手はありません。</div>';
}

function updatePvLines(lines) {
  pvLinesDiv.innerHTML = '';
  if (!lines || !lines.length) {
    pvLinesDiv.innerHTML = '<div class="text-gray-500">まだ推奨手順がありません。</div>';
    return;
  }
  lines.forEach(line => {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-wrap items-center gap-2';
    const head = document.createElement('span');
    head.textContent = `${line.multipv}. 評価 ${line.scoreText}`;
    head.className = 'text-xs font-semibold';
    wrap.appendChild(head);
    line.pv.forEach((move, idx) => {
      const btn = document.createElement('button');
      btn.className = 'btn-soft px-2 py-1 rounded-md';
      btn.textContent = `${idx + 1}. ${move}`;
      btn.addEventListener('click', () => applyMoveAndAnalyze(move));
      wrap.appendChild(btn);
    });
    pvLinesDiv.appendChild(wrap);
  });
}

function parseInfo(msg) {
  const parts = msg.trim().split(/\s+/);
  if (!parts.length) return null;
  let depth, nodes, nps, time, scoreCp = null, scoreMate = null, pv = [], multipv = 1;
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i];
    if (t === 'depth') depth = parseInt(parts[++i], 10);
    else if (t === 'nodes') nodes = parseInt(parts[++i], 10);
    else if (t === 'nps') nps = parseInt(parts[++i], 10);
    else if (t === 'time') time = parseInt(parts[++i], 10);
    else if (t === 'multipv') multipv = parseInt(parts[++i], 10) || 1;
    else if (t === 'score') {
      const type = parts[++i];
      const val = parts[++i];
      if (type === 'cp') scoreCp = parseInt(val, 10);
      else if (type === 'mate') scoreMate = parseInt(val, 10);
    } else if (t === 'pv') {
      pv = parts.slice(i + 1);
      break;
    }
  }
  const scoreRaw = scoreMate !== null ? `mate ${scoreMate}` : scoreCp !== null ? (scoreCp / 100).toFixed(2) : '-';
  const scoreText = scoreRaw === '-' ? '-' : (scoreRaw.startsWith('mate') ? scoreRaw : (Number(scoreRaw) >= 0 ? `+${scoreRaw}` : scoreRaw));
  return { depth, nodes, nps, time, pv, multipv, scoreText };
}

function waitFor(pattern, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    engineWaiters.push({ pattern, resolve: (msg) => { clearTimeout(timer); resolve(msg); }, timer });
  });
}

function handleEngineMessage(msg) {
  engineWaiters = engineWaiters.filter(waiter => {
    if (waiter.pattern.test(msg)) {
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
      return false;
    }
    return true;
  });
  if (!analysisState) return;
  if (msg.startsWith('info')) {
    const parsed = parseInfo(msg);
    if (parsed) {
      analysisState.infos.set(parsed.multipv || 1, parsed);
      const best = analysisState.infos.get(1) || parsed;
      lastInfo = best;
      updateAnalysisInfo(best);
      const lines = Array.from(analysisState.infos.values()).sort((a, b) => (a.multipv || 1) - (b.multipv || 1)).map(info => ({
        multipv: info.multipv || 1,
        scoreText: info.scoreText,
        pv: info.pv || []
      }));
      updatePvLines(lines);
    }
  }
}

async function ensureEngine() {
  if (engineReadyPromise) return engineReadyPromise;
  engineReadyPromise = (async () => {
    if (!window.crossOriginIsolated) throw new Error('crossOriginIsolatedでないためエンジンを初期化できません。server.jsで配信してください。');
    await loadShogiOps(); // ensure wasm cache after COOP
    await loadScript('vendors/yaneuraou.k-p/lib/yaneuraou.k-p.js');
    const wasmBinary = await fetch('vendors/yaneuraou.k-p/lib/yaneuraou.k-p.wasm').then(r => r.arrayBuffer());
    const wasmMemory = new WebAssembly.Memory({ initial: 256, maximum: 256, shared: false });
    engineInstance = await window.YaneuraOu_K_P({
      wasmBinary,
      locateFile: path => `vendors/yaneuraou.k-p/lib/${path}`,
      wasmMemory
    });
    engineInstance.addMessageListener(handleEngineMessage);
    engineInstance.postMessage('usi');
    await waitFor(/usiok/);
    engineInstance.postMessage('isready');
    await waitFor(/readyok/);
    engineInitialized = true;
    return engineInstance;
  })();
  return engineReadyPromise;
}

async function startEngineAnalysis() {
  if (!analysisState) return;
  try {
    const eng = await ensureEngine();
    const sfen = analysisState.ops.makeSfen(analysisState.pos);
    const multiPv = parseInt(analysisMultiPvInput.value, 10) || 3;
    const moveTimeMs = Math.max(parseInt(analysisMoveTimeInput.value, 10) || 30, 1) * 1000;
    eng.postMessage(`setoption name MultiPV value ${multiPv}`);
    eng.postMessage(`position sfen ${sfen}`);
    eng.postMessage('stop');
    eng.postMessage(`go movetime ${moveTimeMs}`);
    analysisState.infos = new Map();
    updateAnalysisInfo(null);
    setAnalysisStatus('解析中...');
  } catch (e) {
    setAnalysisStatus(e.message || '解析開始に失敗しました', true);
  }
}

function stopEngineAnalysis() {
  if (!engineInstance) return;
  engineInstance.postMessage('stop');
  setAnalysisStatus('解析を停止しました');
}

async function refreshLegalMoves() {
  if (!analysisState) return;
  legalMovesCache = await generateLegalMoves(analysisState.pos, analysisState.ops);
}

function applyMoveAndAnalyze(usi) {
  if (!analysisState) return;
  const { ops, pos } = analysisState;
  if (!legalMovesCache.includes(usi)) {
    setAnalysisStatus('合法手ではありません', true);
    return;
  }
  const md = ops.parseUsi(usi);
  if (!md) {
    setAnalysisStatus('手の解析に失敗しました', true);
    return;
  }
  pos.play(md);
  analysisState.moves.push(usi);
  analysisState.lastMove = (() => {
    if (usi.includes('*')) {
      const to = squareNameToCoord(usi.split('*')[1]);
      return { from: null, to };
    }
    const from = squareNameToCoord(usi.slice(0, 2));
    const to = squareNameToCoord(usi.slice(2, 4));
    return { from, to };
  })();
  manualSelection = null;
  renderAnalysis();
  refreshLegalMoves().then(startEngineAnalysis);
}

function handleBoardClick(x, y) {
  if (!analysisState) return;
  const { ops, pos } = analysisState;
  const sqName = `${FILES[x]}${RANKS[y]}`;
  const sq = ops.parseSquareName(sqName);
  const piece = pos.board.get(sq);
  if (!manualSelection) {
    if (!piece) { setAnalysisStatus('駒を選択してください', true); return; }
    if (piece.color !== pos.turn) { setAnalysisStatus('手番の駒を選択してください', true); return; }
    manualSelection = { x, y };
    renderAnalysis();
    setAnalysisStatus('移動先を選択してください');
    return;
  }
  if (manualSelection.x === x && manualSelection.y === y) {
    manualSelection = null;
    renderAnalysis();
    return;
  }
  const fromName = `${FILES[manualSelection.x]}${RANKS[manualSelection.y]}`;
  const targets = legalMovesCache.filter(m => !m.includes('*') && m.startsWith(fromName) && m.slice(2, 4) === sqName);
  if (!targets.length) {
    setAnalysisStatus('合法手ではありません', true);
    return;
  }
  let chosen = targets[0];
  if (targets.length === 2 && targets[0].endsWith('+') !== targets[1].endsWith('+')) {
    const promoCandidate = targets.find(m => m.endsWith('+'));
    if (promoCandidate && window.confirm('成りますか？')) chosen = promoCandidate;
  }
  applyMoveAndAnalyze(chosen);
}

async function openAnalysis(record) {
  try {
    const { ops, pos } = await parsePositionFromSfen(record.sfen);
    analysisState = {
      ops,
      pos,
      baseSfen: record.sfen,
      moves: [],
      infos: new Map(),
      lastMove: null
    };
    analysisModal.classList.remove('hidden');
    analysisModal.classList.add('flex');
    await refreshLegalMoves();
    renderAnalysis();
    updatePvLines([]);
    updateAnalysisInfo(null);
    setAnalysisStatus('解析の準備ができました');
    startEngineAnalysis();
  } catch (e) {
    setAnalysisStatus(e.message || 'AI解析を開始できません', true);
  }
}

function resetAnalysis() {
  if (!analysisState) return;
  parsePositionFromSfen(analysisState.baseSfen).then(({ ops, pos }) => {
    analysisState.ops = ops;
    analysisState.pos = pos;
    analysisState.moves = [];
    analysisState.lastMove = null;
    manualSelection = null;
    refreshLegalMoves().then(() => {
      renderAnalysis();
      updatePvLines([]);
      updateAnalysisInfo(null);
      startEngineAnalysis();
    });
  }).catch(e => setAnalysisStatus(e.message || '初期化に失敗しました', true));
}

function undoAnalysisMove() {
  if (!analysisState || !analysisState.moves.length) return;
  const moves = analysisState.moves.slice(0, -1);
  parsePositionFromSfen(analysisState.baseSfen).then(({ ops, pos }) => {
    for (const usi of moves) {
      const md = ops.parseUsi(usi);
      if (md) pos.play(md);
    }
    analysisState.ops = ops;
    analysisState.pos = pos;
    analysisState.moves = moves;
    analysisState.lastMove = moves.length
      ? (() => {
        const last = moves[moves.length - 1];
        if (last.includes('*')) return { from: null, to: squareNameToCoord(last.split('*')[1]) };
        return { from: squareNameToCoord(last.slice(0, 2)), to: squareNameToCoord(last.slice(2, 4)) };
      })()
      : null;
    manualSelection = null;
    refreshLegalMoves().then(() => {
      renderAnalysis();
      startEngineAnalysis();
    });
  }).catch(e => setAnalysisStatus(e.message || '一手戻しに失敗しました', true));
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
userFilterEnableInput.addEventListener('change', renderFilteredBoards);
userMaxWinrateInput.addEventListener('input', () => { currentPage = 1; renderFilteredBoards(); });
userMinCountInput.addEventListener('input', () => { currentPage = 1; renderFilteredBoards(); });
dateFromInput.addEventListener('change', () => { currentPage = 1; renderFilteredBoards(); });
dateToInput.addEventListener('change', () => { currentPage = 1; renderFilteredBoards(); });

analysisStartButton.addEventListener('click', startEngineAnalysis);
analysisStopButton.addEventListener('click', stopEngineAnalysis);
analysisResetButton.addEventListener('click', resetAnalysis);
analysisUndoButton.addEventListener('click', undoAnalysisMove);
applyPvButton.addEventListener('click', () => {
  if (!analysisState || !analysisState.infos) return;
  const best = analysisState.infos.get(1);
  if (best && best.pv && best.pv.length) applyMoveAndAnalyze(best.pv[0]);
});
closeAnalysisButton.addEventListener('click', () => {
  stopEngineAnalysis();
  analysisModal.classList.add('hidden');
  analysisModal.classList.remove('flex');
  analysisState = null;
  manualSelection = null;
  legalMovesCache = [];
  updateAnalysisInfo(null);
  setAnalysisStatus('');
  pvLinesDiv.innerHTML = '';
  playedMovesDiv.innerHTML = '';
});

initializeApp();
