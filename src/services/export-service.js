(function initExportService(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  function downloadText(filename, content, mimeType) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') {
      return false;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  function fileDate() {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  }

  function validateStateBackup(state) {
    if (!state || !Array.isArray(state.captains) || !Array.isArray(state.players) || !state.draft) {
      throw new Error('备份文件结构不正确');
    }
    if (state.captains.length < 5 || state.captains.length > 20) {
      throw new Error('队伍数量必须在5-20之间');
    }

    const captainIds = new Set();
    state.captains.forEach(captain => {
      if (!captain || typeof captain.id !== 'string' || !captain.id.trim()) {
        throw new Error('队长数据缺少有效ID');
      }
      if (captainIds.has(captain.id)) {
        throw new Error('队长ID不能重复');
      }
      captainIds.add(captain.id);
    });
  }

  Hexcore2.exportService = {
    exportEvents() {
      const lines = Hexcore2.state.events.map(event =>
        `[${event.time}] ${event.title} - ${event.body}`
      );
      const ok = downloadText(`HEXCORE2_事件日志_${fileDate()}.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
      if (ok) Hexcore2.eventStore.append('日志导出', '裁判导出了当前事件日志', 'info');
      return ok;
    },

    exportState() {
      const json = JSON.stringify(Hexcore2.state, null, 2);
      const ok = downloadText(`HEXCORE2_状态备份_${fileDate()}.json`, json, 'application/json;charset=utf-8');
      if (ok) Hexcore2.eventStore.append('数据备份', '裁判导出了当前状态备份', 'info');
      return ok;
    },

    readStateFile(file, onSuccess, onError) {
      if (!file || typeof FileReader === 'undefined') {
        if (onError) onError(new Error('当前环境不支持文件读取'));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const state = JSON.parse(String(reader.result || ''));
          validateStateBackup(state);
          onSuccess(state);
        } catch (error) {
          if (onError) onError(error);
        }
      };
      reader.onerror = () => {
        if (onError) onError(new Error('备份文件读取失败'));
      };
      reader.readAsText(file, 'utf-8');
    },
  };
})(window);
