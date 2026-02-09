const sfenToKanjiMap = { 'P': '歩', 'L': '香', 'N': '桂', 'S': '銀', 'G': '金', 'B': '角', 'R': '飛', 'K': '玉', '+P': 'と', '+L': '杏', '+N': '圭', '+S': '全', '+B': '馬', '+R': '龍' };

const DB_NAME = 'sfen_viewer_idb';
const DB_VERSION = 2;
const STORE_USERS = 'users';
const STORE_POSITIONS = 'positions';
const MAX_IDB_BYTES = 10 * 1024 * 1024 * 1024;

let db = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const oldVersion = e.oldVersion || 0;
      const idb = req.result;
      const upgradeTx = req.transaction;
      if (!idb.objectStoreNames.contains(STORE_USERS)) {
        const users = idb.createObjectStore(STORE_USERS, { keyPath: 'name' });
        users.createIndex('createdAt', 'createdAt');
        users.createIndex('updatedAt', 'updatedAt');
      } else {
        const users = upgradeTx.objectStore(STORE_USERS);
        if (!users.indexNames.contains('createdAt')) {
          users.createIndex('createdAt', 'createdAt');
        }
        if (!users.indexNames.contains('updatedAt')) {
          users.createIndex('updatedAt', 'updatedAt');
        }
        if (oldVersion < 2) {
          users.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (cursor) {
              const value = cursor.value;
              const updatedAt = value.updatedAt || value.createdAt || new Date().toISOString();
              cursor.update({ ...value, updatedAt });
              cursor.continue();
            }
          };
        }
      }
      if (!idb.objectStoreNames.contains(STORE_POSITIONS)) {
        const positions = idb.createObjectStore(STORE_POSITIONS, { keyPath: 'id', autoIncrement: true });
        positions.createIndex('userName', 'userName');
        positions.createIndex('userName_gameDate', ['userName', 'gameDate']);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function initDb() {
  if (db) return db;
  db = await openDb();
  return db;
}

function estimateRecordsBytes(records) {
  if (!records || records.length === 0) return 0;
  const encoder = new TextEncoder();
  let total = 0;
  records.forEach(rec => {
    const json = JSON.stringify(rec);
    total += encoder.encode(json).length;
  });
  return total;
}

async function getExistingKeysByUser(userName) {
  const idb = await initDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_POSITIONS, 'readonly');
    const positions = tx.objectStore(STORE_POSITIONS);
    const index = positions.index('userName');
    const range = IDBKeyRange.only(userName);
    const keys = new Set();
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        keys.add(buildRecordKey(cursor.value));
        cursor.continue();
      } else {
        resolve(keys);
      }
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function enforceStorageLimit(extraBytes) {
  const estimate = await estimateStorage();
  const usage = estimate?.usage || 0;
  const quota = estimate?.quota || MAX_IDB_BYTES;
  const cappedQuota = Math.min(quota || MAX_IDB_BYTES, MAX_IDB_BYTES);
  if (usage + extraBytes > cappedQuota) {
    const limitGb = (cappedQuota / 1024 / 1024 / 1024).toFixed(1);
    const message = `ストレージの上限を超えるため保存できません。不要なデータを削除してください。`;
    const err = new Error(message);
    err.name = 'QuotaExceededError';
    throw err;
  }
  return { usage, quota: cappedQuota };
}

function normalizeDateString(raw) {
  if (!raw) return '';
  const ymdMatch = raw.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = ymdMatch[2].padStart(2, '0');
    const d = ymdMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const jpMatch = raw.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (jpMatch) {
    const y = jpMatch[1];
    const m = jpMatch[2].padStart(2, '0');
    const d = jpMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return raw;
}

function parseData(text, filename = '') {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJSONLike(trimmed);
  }
  if (filename.toLowerCase().endsWith('.jsonl')) {
    return parseJSONLines(text);
  }
  if (filename.toLowerCase().endsWith('.json')) {
    return parseJSONLike(trimmed);
  }
  return parseCSV(text);
}

function parseJSONLike(text) {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data.map(normalizeRecord).filter(r => r && r.sfen && !isNaN(r.count));
    if (data && typeof data === 'object') return [normalizeRecord(data)].filter(r => r && r.sfen && !isNaN(r.count));
  } catch (e) {
    return parseJSONLines(text);
  }
  return [];
}

function parseJSONLines(text) {
  return text.split(/\r\n|\n/).map(line => line.trim()).filter(Boolean).map(line => {
    try { return normalizeRecord(JSON.parse(line)); } catch (e) { return null; }
  }).filter(r => r && r.sfen && !isNaN(r.count));
}

function normalizeRecord(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.s) {
    return {
      sfen: obj.s,
      gameDate: normalizeDateString(obj.dt || obj.gameDate || obj.game_date || ''),
      userName: obj.user_name || obj.userName || obj.u || '',
      count: obj.c || 0,
      senteWins: obj.sw || 0,
      goteWins: obj.gw || 0,
      draws: obj.d || 0,
      targetUserName: obj.u || '',
      userSente: obj.us || 0,
      userSenteWins: obj.usw || 0,
      userSenteDraws: obj.usd || 0,
      userGote: obj.ug || 0,
      userGoteWins: obj.ugw || 0,
      userGoteDraws: obj.ugd || 0,
      comment: obj.comment || ''
    };
  }
  return {
    sfen: obj.sfen || '',
    gameDate: normalizeDateString(obj.gameDate || obj.game_date || obj.date || ''),
    userName: obj.user_name || obj.userName || obj.targetUserName || '',
    count: obj.count || 0,
    senteWins: obj.senteWins || 0,
    goteWins: obj.goteWins || 0,
    draws: obj.draws || 0,
    targetUserName: obj.targetUserName || '',
    userSente: obj.userSente || 0,
    userSenteWins: obj.userSenteWins || 0,
    userSenteDraws: obj.userSenteDraws || 0,
    userGote: obj.userGote || 0,
    userGoteWins: obj.userGoteWins || 0,
    userGoteDraws: obj.userGoteDraws || 0,
    comment: obj.comment || ''
  };
}

function parseCSV(text) {
  const lines = text.trim().split(/\r\n|\n/);
  const headerLine = lines.shift();
  if (!headerLine || !headerLine.toLowerCase().startsWith('sfen')) {
    throw new Error('CSVヘッダーの最初の列が "SFEN" ではありません。');
  }
  const header = headerLine.split(',');
  const dateIndex = header.findIndex(h => h.toLowerCase().includes('対局日時') || h.toLowerCase().includes('開始日時') || h.toLowerCase().includes('日時'));
  const userNameIndex = header.findIndex(h => h.toLowerCase().includes('user_name'));
  const countIndex = header.findIndex(h => h.toLowerCase().includes('出現回数'));
  const commentIndex = header.findIndex(h => h.toLowerCase().includes('コメント'));
  const senteWinIndex = header.findIndex(h => h.toLowerCase().includes('先手勝利数'));
  const goteWinIndex = header.findIndex(h => h.toLowerCase().includes('後手勝利数'));
  const drawIndex = header.findIndex(h => h.toLowerCase().includes('引分'));
  const targetUserIndex = header.findIndex(h => h.toLowerCase().includes('対象ユーザー名'));
  const userSenteIndex = header.findIndex(h => h.toLowerCase().includes('ユーザー先手数'));
  const userGoteIndex = header.findIndex(h => h.toLowerCase().includes('ユーザー後手数'));
  const userSenteWinIndex = header.findIndex(h => h.toLowerCase().includes('ユーザー先手勝利数'));
  const userSenteDrawIndex = header.findIndex(h => h.toLowerCase().includes('ユーザー先手引分数'));
  const userGoteWinIndex = header.findIndex(h => h.toLowerCase().includes('ユーザー後手勝利数'));
  const userGoteDrawIndex = header.findIndex(h => h.toLowerCase().includes('ユーザー後手引分数'));

  if (countIndex === -1) throw new Error('CSVヘッダーに "出現回数" が見つかりません。');

  return lines.map(line => {
    const values = line.match(/(?:[^\s",]+|"[^"]*")+/g) || [];
    const sfen = (values[0] || '').replace(/"/g, '');
    const gameDateRaw = dateIndex !== -1 ? (values[dateIndex] || '').replace(/"/g, '') : '';
    const gameDate = normalizeDateString(gameDateRaw);
    const userName = userNameIndex !== -1 ? (values[userNameIndex] || '').replace(/"/g, '') : '';
    const count = parseInt(values[countIndex], 10);
    const comment = commentIndex !== -1 ? (values[commentIndex] || '').replace(/"/g, '') : '';
    const senteWins = senteWinIndex !== -1 ? parseInt(values[senteWinIndex], 10) || 0 : 0;
    const goteWins = goteWinIndex !== -1 ? parseInt(values[goteWinIndex], 10) || 0 : 0;
    const draws = drawIndex !== -1 ? parseInt(values[drawIndex], 10) || 0 : 0;
    const targetUserName = targetUserIndex !== -1 ? (values[targetUserIndex] || '').replace(/"/g, '') : '';
    const userSente = userSenteIndex !== -1 ? parseInt(values[userSenteIndex], 10) || 0 : 0;
    const userGote = userGoteIndex !== -1 ? parseInt(values[userGoteIndex], 10) || 0 : 0;
    const userSenteWins = userSenteWinIndex !== -1 ? parseInt(values[userSenteWinIndex], 10) || 0 : 0;
    const userSenteDraws = userSenteDrawIndex !== -1 ? parseInt(values[userSenteDrawIndex], 10) || 0 : 0;
    const userGoteWins = userGoteWinIndex !== -1 ? parseInt(values[userGoteWinIndex], 10) || 0 : 0;
    const userGoteDraws = userGoteDrawIndex !== -1 ? parseInt(values[userGoteDrawIndex], 10) || 0 : 0;
    return { sfen, gameDate, userName, count, comment, senteWins, goteWins, draws, targetUserName, userSente, userGote, userSenteWins, userSenteDraws, userGoteWins, userGoteDraws };
  }).filter(r => r.sfen && !isNaN(r.count));
}

function generateCsvFromRecords(records) {
  const header = '"SFEN","対局日時","user_name","出現回数","先手勝利数","後手勝利数","引分数","対象ユーザー名","ユーザー先手数","ユーザー先手勝利数","ユーザー先手引分数","ユーザー後手数","ユーザー後手勝利数","ユーザー後手引分数","コメント"\n';
  const rows = records.map(rec => {
    const sfen = `"${rec.sfen}"`;
    const gameDate = `"${(rec.gameDate || '').replace(/"/g, '""')}"`;
    const userName = `"${(rec.userName || rec.targetUserName || '').replace(/"/g, '""')}"`;
    const count = rec.count;
    const senteWins = rec.senteWins || 0;
    const goteWins = rec.goteWins || 0;
    const draws = rec.draws || 0;
    const targetName = `"${(rec.targetUserName || '').replace(/"/g, '""')}"`;
    const userSente = rec.userSente || 0;
    const userSenteWins = rec.userSenteWins || 0;
    const userSenteDraws = rec.userSenteDraws || 0;
    const userGote = rec.userGote || 0;
    const userGoteWins = rec.userGoteWins || 0;
    const userGoteDraws = rec.userGoteDraws || 0;
    const comment = `"${(rec.comment || '').replace(/"/g, '""')}"`;
    return `${sfen},${gameDate},${userName},${count},${senteWins},${goteWins},${draws},${targetName},${userSente},${userSenteWins},${userSenteDraws},${userGote},${userGoteWins},${userGoteDraws},${comment}`;
  });
  return header + rows.join('\n');
}

async function getUsers() {
  const idb = await initDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_USERS, 'readonly');
    const store = tx.objectStore(STORE_USERS);
    const req = store.getAll();
    req.onsuccess = () => {
      const users = (req.result || []).map(user => ({
        ...user,
        updatedAt: user.updatedAt || user.createdAt
      }));
      resolve(users);
    };
    req.onerror = () => reject(req.error);
  });
}

function buildRecordKey(rec) {
  return [
    rec.sfen || '',
    rec.gameDate || '',
    rec.targetUserName || '',
    rec.count || 0,
    rec.senteWins || 0,
    rec.goteWins || 0,
    rec.draws || 0,
    rec.userSente || 0,
    rec.userGote || 0,
    rec.userSenteWins || 0,
    rec.userSenteDraws || 0,
    rec.userGoteWins || 0,
    rec.userGoteDraws || 0
  ].join('|');
}

async function saveUserRecords(userName, records) {
  const name = (userName || '未指定').trim() || '未指定';
  const now = new Date().toISOString();
  const existingKeys = await getExistingKeysByUser(name);
  const normalizedRecords = [];
  records.forEach(rec => {
    const normalized = {
      userName: name,
      sfen: rec.sfen,
      gameDate: normalizeDateString(rec.gameDate || ''),
      count: rec.count || 0,
      senteWins: rec.senteWins || 0,
      goteWins: rec.goteWins || 0,
      draws: rec.draws || 0,
      targetUserName: rec.targetUserName || '',
      userSente: rec.userSente || 0,
      userSenteWins: rec.userSenteWins || 0,
      userSenteDraws: rec.userSenteDraws || 0,
      userGote: rec.userGote || 0,
      userGoteWins: rec.userGoteWins || 0,
      userGoteDraws: rec.userGoteDraws || 0,
      comment: rec.comment || ''
    };
    const key = buildRecordKey(normalized);
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      normalizedRecords.push(normalized);
    }
  });
  const extraBytes = estimateRecordsBytes(normalizedRecords);
  await enforceStorageLimit(extraBytes);

  const idb = await initDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction([STORE_USERS, STORE_POSITIONS], 'readwrite');
    const users = tx.objectStore(STORE_USERS);
    const positions = tx.objectStore(STORE_POSITIONS);
    users.get(name).onsuccess = e => {
      const existing = e.target.result;
      users.put({
        name,
        createdAt: existing?.createdAt || now,
        updatedAt: now
      });
    };

    normalizedRecords.forEach(rec => {
      positions.add(rec);
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadUserRecords(userName, options = {}) {
  const aggregate = options.aggregate !== false;
  const idb = await initDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_POSITIONS, 'readonly');
    const positions = tx.objectStore(STORE_POSITIONS);
    const index = positions.index('userName');
    const range = IDBKeyRange.only(userName);
    const records = [];
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        records.push(cursor.value);
        cursor.continue();
      } else {
        resolve(aggregate ? aggregateBySfen(records) : records);
      }
    };
    tx.onerror = () => reject(tx.error);
  });
}

function aggregateBySfen(records) {
  const map = new Map();
  records.forEach(rec => {
    const current = map.get(rec.sfen) || {
      sfen: rec.sfen,
      gameDate: rec.gameDate || '',
      userName: rec.userName,
      count: 0,
      senteWins: 0,
      goteWins: 0,
      draws: 0,
      targetUserName: rec.targetUserName || '',
      userSente: 0,
      userSenteWins: 0,
      userSenteDraws: 0,
      userGote: 0,
      userGoteWins: 0,
      userGoteDraws: 0,
      comment: rec.comment || ''
    };
    current.count += rec.count || 0;
    current.senteWins += rec.senteWins || 0;
    current.goteWins += rec.goteWins || 0;
    current.draws += rec.draws || 0;
    current.userSente += rec.userSente || 0;
    current.userSenteWins += rec.userSenteWins || 0;
    current.userSenteDraws += rec.userSenteDraws || 0;
    current.userGote += rec.userGote || 0;
    current.userGoteWins += rec.userGoteWins || 0;
    current.userGoteDraws += rec.userGoteDraws || 0;
    if (!current.gameDate || (rec.gameDate && rec.gameDate > current.gameDate)) {
      current.gameDate = rec.gameDate || current.gameDate;
    }
    map.set(rec.sfen, current);
  });
  return Array.from(map.values());
}

async function deleteUser(userName) {
  const idb = await initDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction([STORE_USERS, STORE_POSITIONS], 'readwrite');
    const users = tx.objectStore(STORE_USERS);
    const positions = tx.objectStore(STORE_POSITIONS);
    users.delete(userName);
    const index = positions.index('userName');
    const range = IDBKeyRange.only(userName);
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function updateComment(userName, sfen, comment) {
  const idb = await initDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction([STORE_POSITIONS, STORE_USERS], 'readwrite');
    const positions = tx.objectStore(STORE_POSITIONS);
    const users = tx.objectStore(STORE_USERS);
    const now = new Date().toISOString();
    const index = positions.index('userName');
    const range = IDBKeyRange.only(userName);
    let commentUpdated = false;
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.sfen === sfen) {
          const nextValue = { ...cursor.value, comment };
          cursor.update(nextValue);
          commentUpdated = true;
        }
        cursor.continue();
      } else {
        if (commentUpdated) {
          users.get(userName).onsuccess = ev => {
            const existing = ev.target.result;
            if (existing) {
              users.put({ ...existing, updatedAt: now });
            }
          };
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function countUserPositions(userName) {
  const idb = await initDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_POSITIONS, 'readonly');
    const positions = tx.objectStore(STORE_POSITIONS);
    const index = positions.index('userName');
    const range = IDBKeyRange.only(userName);
    let count = 0;
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) { count++; cursor.continue(); }
      else resolve(count);
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function getUserDateRange(userName) {
  const idb = await initDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_POSITIONS, 'readonly');
    const positions = tx.objectStore(STORE_POSITIONS);
    const index = positions.index('userName');
    const range = IDBKeyRange.only(userName);
    let min = '';
    let max = '';
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        const date = normalizeDateString(cursor.value.gameDate || '');
        if (date) {
          if (!min || date < min) min = date;
          if (!max || date > max) max = date;
        }
        cursor.continue();
      } else {
        resolve({ min, max });
      }
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteByDateRange(userName, from, to) {
  const idb = await initDb();
  const hasRange = !!from || !!to;
  const start = normalizeDateString(from || '') || '0000-00-00';
  const end = normalizeDateString(to || '') || '9999-12-31';
  return new Promise((resolve, reject) => {
    const tx = idb.transaction([STORE_POSITIONS, STORE_USERS], 'readwrite');
    const positions = tx.objectStore(STORE_POSITIONS);
    const users = tx.objectStore(STORE_USERS);
    const index = positions.index('userName');
    const range = IDBKeyRange.only(userName);
    let deleted = 0;
    const now = new Date().toISOString();
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        const recordDate = normalizeDateString(cursor.value.gameDate || '');
        const shouldDelete = recordDate
          ? (recordDate >= start && recordDate <= end)
          : !hasRange;
        if (shouldDelete) { cursor.delete(); deleted++; }
        cursor.continue();
      } else {
        if (deleted > 0) {
          users.get(userName).onsuccess = ev => {
            const existing = ev.target.result;
            if (existing) {
              users.put({ ...existing, updatedAt: now });
            }
          };
        }
      }
    };
    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error);
  });
}

async function countByDateRange(userName, from, to) {
  const idb = await initDb();
  const hasRange = !!from || !!to;
  const start = normalizeDateString(from || '') || '0000-00-00';
  const end = normalizeDateString(to || '') || '9999-12-31';
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_POSITIONS, 'readonly');
    const positions = tx.objectStore(STORE_POSITIONS);
    const index = positions.index('userName');
    const range = IDBKeyRange.only(userName);
    let count = 0;
    index.openCursor(range).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        const recordDate = normalizeDateString(cursor.value.gameDate || '');
        const shouldCount = recordDate
          ? (recordDate >= start && recordDate <= end)
          : !hasRange;
        if (shouldCount) count++;
        cursor.continue();
      } else resolve(count);
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function estimateStorage() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      if (!estimate) return null;
      const quota = Math.min(estimate.quota || MAX_IDB_BYTES, MAX_IDB_BYTES);
      return { ...estimate, quota };
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function getUserStats() {
  const idb = await initDb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_POSITIONS, 'readonly');
    const positions = tx.objectStore(STORE_POSITIONS);
    const stats = new Map();
    const encoder = new TextEncoder();
    positions.openCursor().onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        const rec = cursor.value;
        const name = rec.userName || '未指定';
        const current = stats.get(name) || { name, count: 0, minDate: '', maxDate: '', bytes: 0 };
        current.count += 1;
        const date = normalizeDateString(rec.gameDate || '');
        if (date) {
          if (!current.minDate || date < current.minDate) current.minDate = date;
          if (!current.maxDate || date > current.maxDate) current.maxDate = date;
        }
        const json = JSON.stringify(rec);
        current.bytes += encoder.encode(json).length;
        stats.set(name, current);
        cursor.continue();
      } else {
        resolve(Array.from(stats.values()));
      }
    };
    tx.onerror = () => reject(tx.error);
  });
}

function createBoardTable(boardState) {
  const table = document.createElement('table');
  table.className = 'shogi-board';
  const rows = boardState.split('/');
  for (let y = 0; y < 9; y++) {
    const tr = table.insertRow();
    let x = 0, isPromotedFlag = false;
    for (const char of rows[y]) {
      if (char === '+') { isPromotedFlag = true; continue; }
      if (!isNaN(parseInt(char))) {
        for (let i = 0; i < parseInt(char); i++) { tr.insertCell(); x++; }
      } else {
        const td = tr.insertCell();
        const isGote = char === char.toLowerCase();
        const pieceKey = (isPromotedFlag ? '+' : '') + char.toUpperCase();
        td.textContent = sfenToKanjiMap[pieceKey] || '?';
        if (isGote) td.classList.add('gote');
        if (isPromotedFlag) td.classList.add('promoted');
        isPromotedFlag = false; x++;
      }
    }
  }
  return table;
}

function parseHand(handsStr, player) {
  if (!handsStr || handsStr === '-') return [];
  const hand = []; let count = 1;
  for (const char of handsStr) {
    if (!isNaN(parseInt(char))) { count = parseInt(char); }
    else {
      const isSente = char === char.toUpperCase();
      if ((player === 'sente' && isSente) || (player === 'gote' && !isSente)) {
        hand.push({ kanji: sfenToKanjiMap[char.toUpperCase()] || '?', count: count });
      }
      count = 1;
    }
  }
  return hand;
}

window.SfenViewerApp = {
  initDb,
  parseData,
  saveUserRecords,
  loadUserRecords,
  deleteUser,
  deleteByDateRange,
  countByDateRange,
  getUsers,
  generateCsvFromRecords,
  estimateStorage,
  createBoardTable,
  parseHand,
  updateComment,
  countUserPositions,
  getUserDateRange,
  aggregateBySfen,
  getUserStats
};
