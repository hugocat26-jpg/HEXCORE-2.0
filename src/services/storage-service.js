(function initStorageService(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const STORAGE_KEY = 'hexcore2_referee_state_v1';

  function storageAvailable() {
    try {
      return typeof global.localStorage !== 'undefined';
    } catch (error) {
      return false;
    }
  }

  Hexcore2.storageService = {
    load() {
      if (!storageAvailable()) return null;
      try {
        const raw = global.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data && data.version === 1 ? data.state : null;
      } catch (error) {
        console.warn('[HEXCORE2] 本地状态读取失败', error);
        return null;
      }
    },

    save(state) {
      if (!storageAvailable()) return false;
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          version: 1,
          savedAt: new Date().toISOString(),
          state,
        }));
        return true;
      } catch (error) {
        console.warn('[HEXCORE2] 本地状态保存失败', error);
        return false;
      }
    },

    clear() {
      if (!storageAvailable()) return false;
      global.localStorage.removeItem(STORAGE_KEY);
      return true;
    },
  };
})(window);
