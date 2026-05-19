// hexcore2.0/src/core/utils.js
export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

export function shuffle(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function groupBy(arr, keyFn) {
  return arr.reduce((groups, item) => {
    const key = keyFn(item);
    (groups[key] = groups[key] || []).push(item);
    return groups;
  }, {});
}

export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickN(arr, n) {
  return shuffle(arr).slice(0, n);
}