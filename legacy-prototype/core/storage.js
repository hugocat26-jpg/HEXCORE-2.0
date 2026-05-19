// hexcore2.0/src/core/storage.js
const STORAGE_KEY = 'hexcore2_data';
const STORAGE_QUOTA = 5 * 1024 * 1024; // 5MB localStorage 典型上限

export const Storage = {
  save(key, data) {
    try {
      const json = JSON.stringify(data);
      if (json.length > STORAGE_QUOTA * 0.9) {
        console.warn('[Storage] 数据接近容量上限');
      }
      localStorage.setItem(key, json);
      return { success: true };
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        return { success: false, error: 'storage_quota_exceeded' };
      }
      return { success: false, error: e.message };
    }
  },

  load(key) {
    try {
      const data = localStorage.getItem(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch (e) {
      console.error('[Storage] 加载失败:', e);
      return null;
    }
  },

  remove(key) {
    localStorage.removeItem(key);
  },

  clear() {
    localStorage.clear();
  }
};