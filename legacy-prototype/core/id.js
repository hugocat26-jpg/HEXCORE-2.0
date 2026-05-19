// hexcore2.0/src/core/id.js
let idCounter = Date.now();

export function generateId(prefix = '') {
  return `${prefix}${++idCounter}-${Math.random().toString(36).slice(2, 9)}`;
}

export function isStringId(val) {
  return typeof val === 'string' && /^\d+-[a-z0-9]+$/.test(val);
}

export function normalizeId(id) {
  return String(id);
}

export function compareIds(a, b) {
  return String(a) === String(b);
}