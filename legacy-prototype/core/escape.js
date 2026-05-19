// hexcore2.0/src/core/escape.js
const ESCAPE_CHARS = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, char => ESCAPE_CHARS[char]);
}

export function escapeAttr(str) {
  if (str == null) return '';
  return String(str).replace(/"/g, '&quot;');
}