import { parseSfen, makeSfen } from '../sfen_viewer/vendors/shogiops/sfen.js';
import { shogigroundMoveDests, shogigroundDropDests } from '../sfen_viewer/vendors/shogiops/compat.js';
import { parseSquareName, parseUsi, makeUsi } from '../sfen_viewer/vendors/shogiops/util.js';
import { makeJapaneseMoveOrDrop } from '../sfen_viewer/vendors/shogiops/notation/japanese.js';

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
const applyPvButton = document.getElementById('apply-pv');
const pvLinesDiv = document.getElementById('pv-lines');
const playedMovesDiv = document.getElementById('played-moves');
const replayStatus = document.getElementById('replay-status');
const replayNextButton = document.getElementById('replay-next');
const replayAdoptButton = document.getElementById('replay-adopt');
const replayStopButton = document.getElementById('replay-stop');
const handSenteDiv = document.getElementById('hand-sente');
const handGoteDiv = document.getElementById('hand-gote');
const sfenInput = document.getElementById('sfen-input');
const applySfenButton = document.getElementById('apply-sfen');
const loadStartButton = document.getElementById('load-startpos');
const currentSfenSpan = document.getElementById('current-sfen');

const FILES = ['9', '8', '7', '6', '5', '4', '3', '2', '1'];
const RANKS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
const roleKanji = {
  pawn: '歩', lance: '香', knight: '桂', silver: '銀', gold: '金',
  bishop: '角', rook: '飛', king: '玉'
};

let analysisState = null;
let replayState = null;
let engineInstance = null;
let engineWaiters = [];
let engineReadyPromise = null;
let legalMovesCache = [];
let manualSelection = null;
let handSelection = null;

function setAnalysisStatus(message, isError = false) {
  analysisStatus.textContent = message;
  analysisStatus.classList.toggle('text-red-400', isError);
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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function resultValue(res) {
  if (!res) return null;
  if (res.isOk) return res.value;
  if (res.ok) return res.value;
  if (res._tag === 'Ok') return res.value;
  return null;
}

function squareNameToCoord(name) {
  const file = name.charAt(0);
  const rank = name.charAt(1);
  return { x: FILES.indexOf(file), y: RANKS.indexOf(rank) };
}

function makeJapaneseFromUsi(usi, pos) {
  try {
    const md = parseUsi(usi);
    if (!md) return usi;
    const txt = makeJapaneseMoveOrDrop(pos, md, undefined);
    return txt || usi;
  } catch {
    return usi;
  }
}

function waitFor(pattern, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    engineWaiters.push({ pattern, resolve: (msg) => { clearTimeout(timer); resolve(msg); }, timer });
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
  const scoreText = scoreRaw === '-'
    ? '-'
    : scoreRaw.startsWith('mate')
      ? scoreRaw
      : (Number(scoreRaw) >= 0 ? `+${scoreRaw}` : `${scoreRaw}`);
  return { depth, nodes, nps, time, pv, multipv, scoreText };
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
  if (!analysisState || replayState) return;
  if (msg.startsWith('info')) {
    const parsed = parseInfo(msg);
    if (parsed) {
      analysisState.infos.set(parsed.multipv || 1, parsed);
      const best = analysisState.infos.get(1) || parsed;
      updateAnalysisInfo(best);
      const lines = Array.from(analysisState.infos.values())
        .sort((a, b) => (a.multipv || 1) - (b.multipv || 1))
        .map(info => ({
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
    if (!window.crossOriginIsolated) throw new Error('エンジンの初期化に必要な環境が整っていません。');
    await loadScript('../sfen_viewer/vendors/yaneuraou.k-p/lib/yaneuraou.k-p.js');
    const wasmBinary = await fetch('../sfen_viewer/vendors/yaneuraou.k-p/lib/yaneuraou.k-p.wasm').then(r => r.arrayBuffer());
    const wasmMemory = new WebAssembly.Memory({ initial: 256, maximum: 256, shared: false });
    engineInstance = await window.YaneuraOu_K_P({
      wasmBinary,
      locateFile: path => `../sfen_viewer/vendors/yaneuraou.k-p/lib/${path}`,
      wasmMemory
    });
    engineInstance.addMessageListener(handleEngineMessage);
    engineInstance.postMessage('usi');
    await waitFor(/usiok/);
    engineInstance.postMessage('isready');
    await waitFor(/readyok/);
    return engineInstance;
  })();
  return engineReadyPromise;
}

function updatePvLines(lines) {
  pvLinesDiv.innerHTML = '';
  if (!lines || !lines.length) {
    pvLinesDiv.innerHTML = '<div class="text-gray-500">まだ推奨手順がありません。</div>';
    return;
  }
  const basePos = analysisState?.pos?.clone();
  lines.forEach(line => {
    const row = document.createElement('div');
    row.className = 'flex flex-wrap items-center gap-2';
    const head = document.createElement('span');
    head.className = 'text-xs font-semibold';
    let jpMove = line.pv?.[0] || '';
    if (basePos && line.pv?.[0]) jpMove = makeJapaneseFromUsi(line.pv[0], basePos) || jpMove;
    head.textContent = `候補${line.multipv}: ${jpMove} / 評価 ${line.scoreText}`;
    row.appendChild(head);
    const replayBtn = document.createElement('button');
    replayBtn.className = 'btn-soft px-2 py-1 rounded-md';
    replayBtn.textContent = '手順を再現';
    replayBtn.addEventListener('click', () => startReplay(line));
    row.appendChild(replayBtn);
    pvLinesDiv.appendChild(row);
  });
}

async function refreshLegalMoves() {
  if (!analysisState) return;
  const pos = analysisState.pos;
  const ctx = pos.ctx();
  const moves = [];
  const moveDests = shogigroundMoveDests(pos);
  moveDests.forEach((dests, fromName) => {
    const from = parseSquareName(fromName);
    dests.forEach(destName => {
      const to = parseSquareName(destName);
      const base = { from, to };
      const normal = { ...base };
      if (pos.isLegal(normal, ctx)) moves.push(makeUsi(normal));
      const promo = { ...base, promotion: true };
      if (pos.isLegal(promo, ctx)) moves.push(makeUsi(promo));
    });
  });
  const dropDests = shogigroundDropDests(pos);
  dropDests.forEach((dests, pieceName) => {
    const role = (pieceName.split(' ')[1] || '').trim();
    dests.forEach(destName => {
      const to = parseSquareName(destName);
      const drop = { role, to };
      if (pos.isLegal(drop, ctx)) moves.push(makeUsi(drop));
    });
  });
  legalMovesCache = moves;
}

async function startEngineAnalysis() {
  if (!analysisState || replayState) return;
  try {
    const eng = await ensureEngine();
    const sfen = makeSfen(analysisState.pos);
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

function renderBoard() {
  if (!analysisState) return;
  const viewPos = replayState ? replayState.pos : analysisState.pos;
  const lastMove = replayState ? replayState.lastMove : analysisState.lastMove;
  const sfen = makeSfen(viewPos).split(' ')[0];
  const table = window.SfenViewerApp.createBoardTable(sfen);
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
  renderReplayControls();
  renderHands(viewPos);
}

function renderPlayedMoves() {
  if (!analysisState) return;
  const baseParsed = resultValue(parseSfen('standard', analysisState.baseSfen, false));
  if (!baseParsed) {
    playedMovesDiv.innerHTML = '<div class="text-gray-500">履歴を表示できません。</div>';
    return;
  }
  const basePos = baseParsed;
  const lines = [];
  let lastDest = undefined;
  for (let i = 0; i < analysisState.moves.length; i++) {
    const usi = analysisState.moves[i];
    const md = parseUsi(usi);
    if (!md) break;
    const jp = makeJapaneseMoveOrDrop(basePos, md, lastDest) || usi;
    lines.push(`<div>${i + 1}. ${jp}</div>`);
    basePos.play(md);
    lastDest = md.to ?? md.midStep ?? md.from;
  }
  playedMovesDiv.innerHTML = lines.join('') || '<div class="text-gray-500">まだ指し手はありません。</div>';
}

function handleBoardClick(x, y) {
  if (!analysisState || replayState) return;
  if (handSelection) {
    const sqName = `${FILES[x]}${RANKS[y]}`;
    const candidate = legalMovesCache.find(m => {
      if (!m.includes('*') || !m.endsWith(sqName)) return false;
      const md = parseUsi(m);
      return md && md.role === handSelection.role && analysisState.pos.turn === handSelection.color;
    });
    if (!candidate) { setAnalysisStatus('持ち駒の合法手ではありません', true); return; }
    applyMoveAndAnalyze(candidate);
    handSelection = null;
    return;
  }
  const pos = analysisState.pos;
  const sqName = `${FILES[x]}${RANKS[y]}`;
  const sq = parseSquareName(sqName);
  const piece = pos.board.get(sq);
  if (!manualSelection) {
    if (!piece) { setAnalysisStatus('駒を選択してください', true); return; }
    if (piece.color !== pos.turn) { setAnalysisStatus('手番の駒を選択してください', true); return; }
    manualSelection = { x, y };
    renderBoard();
    setAnalysisStatus('移動先を選択してください');
    return;
  }
  if (manualSelection.x === x && manualSelection.y === y) {
    manualSelection = null;
    renderBoard();
    return;
  }
  const fromName = `${FILES[manualSelection.x]}${RANKS[manualSelection.y]}`;
  const targets = legalMovesCache.filter(m => !m.includes('*') && m.startsWith(fromName) && m.slice(2, 4) === sqName);
  if (!targets.length) { setAnalysisStatus('合法手ではありません', true); return; }
  let chosen = targets[0];
  if (targets.length === 2 && targets[0].endsWith('+') !== targets[1].endsWith('+')) {
    const promoCandidate = targets.find(m => m.endsWith('+'));
    if (promoCandidate && window.confirm('成りますか？')) chosen = promoCandidate;
  }
  applyMoveAndAnalyze(chosen);
}

function applyMoveAndAnalyze(usi) {
  if (!analysisState || replayState) return;
  if (!legalMovesCache.includes(usi)) { setAnalysisStatus('合法手ではありません', true); return; }
  const md = parseUsi(usi);
  if (!md) { setAnalysisStatus('手の解析に失敗しました', true); return; }
  analysisState.pos.play(md);
  analysisState.moves.push(usi);
  analysisState.lastMove = usi.includes('*')
    ? { from: null, to: squareNameToCoord(usi.split('*')[1]) }
    : { from: squareNameToCoord(usi.slice(0, 2)), to: squareNameToCoord(usi.slice(2, 4)) };
  manualSelection = null;
  handSelection = null;
  refreshLegalMoves().then(() => {
    renderBoard();
    startEngineAnalysis();
  });
}

function startReplay(line) {
  if (!analysisState || !line?.pv?.length) { setAnalysisStatus('再現できる手順がありません', true); return; }
  replayState = {
    pos: analysisState.pos.clone(),
    line,
    index: 0,
    movesApplied: [],
    lastMove: null
  };
  renderBoard();
  renderReplayControls();
  const jp = makeJapaneseFromUsi(line.pv[0], replayState.pos) || line.pv[0];
  setAnalysisStatus(`手順再現を開始: 候補${line.multipv} ${jp}`);
}

function advanceReplay() {
  if (!replayState) { setAnalysisStatus('再現を開始してください', true); return; }
  if (replayState.index >= replayState.line.pv.length) { setAnalysisStatus('これ以上手はありません'); return; }
  const move = replayState.line.pv[replayState.index];
  const md = parseUsi(move);
  if (!md) { setAnalysisStatus('手の解析に失敗しました', true); return; }
  replayState.pos.play(md);
  replayState.movesApplied.push(move);
  replayState.lastMove = move.includes('*')
    ? { from: null, to: squareNameToCoord(move.split('*')[1]) }
    : { from: squareNameToCoord(move.slice(0, 2)), to: squareNameToCoord(move.slice(2, 4)) };
  replayState.index += 1;
  renderBoard();
  renderReplayControls();
}

function adoptReplayPosition() {
  if (!replayState) { setAnalysisStatus('再現中の局面がありません', true); return; }
  analysisState.pos = replayState.pos.clone();
  analysisState.moves = analysisState.moves.concat(replayState.movesApplied);
  analysisState.lastMove = replayState.lastMove;
  replayState = null;
  manualSelection = null;
  handSelection = null;
  refreshLegalMoves().then(() => {
    renderBoard();
    startEngineAnalysis();
  });
  setAnalysisStatus('この局面で解析を再開しました');
}

function stopReplay() {
  replayState = null;
  manualSelection = null;
  handSelection = null;
  renderBoard();
  renderReplayControls();
  setAnalysisStatus('手順再現を終了しました');
}

function renderReplayControls() {
  if (!replayState) {
    replayStatus.textContent = '候補手の「手順を再現」を押してください。';
    replayNextButton.disabled = true;
    replayAdoptButton.disabled = true;
    replayStopButton.disabled = true;
    return;
  }
  const total = replayState.line.pv.length;
  const idx = replayState.index;
  const nextMove = replayState.line.pv[idx] ? makeJapaneseFromUsi(replayState.line.pv[idx], replayState.pos) : 'なし';
  replayStatus.textContent = `手順再現中: 候補${replayState.line.multipv} の ${idx}/${total} 手目（次: ${nextMove}）`;
  replayNextButton.disabled = idx >= total;
  replayAdoptButton.disabled = false;
  replayStopButton.disabled = false;
}

function renderHands(pos) {
  if (!handSenteDiv || !handGoteDiv || !pos?.hands) return;
  const render = (color, el) => {
    el.innerHTML = '';
    const roles = ['rook', 'bishop', 'gold', 'silver', 'knight', 'lance', 'pawn'];
    roles.forEach(role => {
      const count = pos.hands[color]?.get?.(role) || 0;
      if (!count) return;
      const btn = document.createElement('button');
      btn.className = 'btn-soft px-2 py-1 rounded-md';
      btn.textContent = `${roleKanji[role] || role}${count > 1 ? `(${count})` : ''}`;
      if (handSelection && handSelection.role === role && handSelection.color === color) {
        btn.classList.add('bg-emerald-600');
      }
      btn.addEventListener('click', () => {
        handSelection = { role, color };
        manualSelection = null;
        setAnalysisStatus('盤上のマスを選んで打ちます');
        renderHands(pos);
      });
      el.appendChild(btn);
    });
  };
  render('sente', handSenteDiv);
  render('gote', handGoteDiv);
}

function resetAnalysis() {
  const sfen = sfenInput.value.trim() || 'startpos';
  const parsed = parseSfen('standard', sfen, false);
  const pos = resultValue(parsed);
  if (!pos) { setAnalysisStatus('SFENの解析に失敗しました', true); return; }
  analysisState = {
    pos,
    baseSfen: sfen,
    moves: [],
    infos: new Map(),
    lastMove: null
  };
  replayState = null;
  manualSelection = null;
  currentSfenSpan.textContent = sfen;
  refreshLegalMoves().then(() => {
    renderBoard();
    updateAnalysisInfo(null);
    updatePvLines([]);
    setAnalysisStatus('解析の準備ができました');
  });
}

function initEvents() {
  applySfenButton.addEventListener('click', resetAnalysis);
  loadStartButton.addEventListener('click', () => {
    sfenInput.value = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
    resetAnalysis();
  });
  analysisStartButton.addEventListener('click', startEngineAnalysis);
  analysisStopButton.addEventListener('click', stopEngineAnalysis);
  analysisResetButton.addEventListener('click', resetAnalysis);
  applyPvButton.addEventListener('click', () => {
    if (!analysisState?.infos) return;
    const best = analysisState.infos.get(1);
    if (best?.pv?.length) applyMoveAndAnalyze(best.pv[0]);
  });
  replayNextButton.addEventListener('click', () => advanceReplay());
  replayAdoptButton.addEventListener('click', () => adoptReplayPosition());
  replayStopButton.addEventListener('click', () => stopReplay());
}

function bootstrap() {
  initEvents();
  // 初期局面でセット
  sfenInput.value = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
  resetAnalysis();
}

bootstrap();
