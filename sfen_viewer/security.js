// HTMLエスケープ関数
function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 安全なHTML生成ヘルパー
function createElementWithText(tag, text, className = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

// innerHTML用の安全なHTML文字列生成
function sanitizeForInnerHTML(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.SecurityUtils = {
  escapeHtml,
  createElementWithText,
  sanitizeForInnerHTML
};
