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

  function filteredEvents(options = {}) {
    const ui = Hexcore2.state.ui || {};
    const filter = options.filter || ui.eventFilter || 'all';
    const captainId = options.captainId || ui.eventCaptainFilter || 'all';
    const search = String(options.search ?? ui.eventSearch ?? '').trim().toLowerCase();
    const captain = captainId === 'all'
      ? null
      : Hexcore2.state.captains.find(item => item.id === captainId);

    return Hexcore2.state.events.filter(event => {
      const title = String(event.title || '');
      const body = String(event.body || '');
      const haystack = `${title} ${body}`.toLowerCase();
      if (filter === 'hexcore' && !title.includes('海克斯') && !body.includes('海克斯')) return false;
      if (filter === 'team' && !title.includes('入队') && !body.includes('加入队伍') && !body.includes('队员')) return false;
      if (filter === 'warning' && event.level !== 'warn') return false;
      if (filter === 'draw' && event.level !== 'draw') return false;
      if (captain && !haystack.includes(captain.name.toLowerCase()) && !haystack.includes(captain.id.toLowerCase())) return false;
      if (search && !haystack.includes(search)) return false;
      return true;
    });
  }

  function eventLines(events) {
    return events.map(event => `[${event.time}] ${event.title} - ${event.body}`);
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
    filteredEvents,

    exportEvents() {
      const lines = eventLines(filteredEvents());
      const ok = downloadText(`HEXCORE2_事件日志_${fileDate()}.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
      if (ok) Hexcore2.eventStore.append('日志导出', `裁判导出了当前筛选日志（${lines.length} 条）`, 'info');
      return ok;
    },

    exportEventsJson() {
      const events = filteredEvents();
      const ok = downloadText(`HEXCORE2_事件日志_${fileDate()}.json`, JSON.stringify(events, null, 2), 'application/json;charset=utf-8');
      if (ok) Hexcore2.eventStore.append('日志导出', `裁判导出了 JSON 日志（${events.length} 条）`, 'info');
      return ok;
    },

    exportRecapText() {
      const state = Hexcore2.state;
      const lines = [
        `HEXCORE2 裁判复盘`,
        `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        `队伍数量：${state.captains.length}`,
        `当前轮次：${state.draft.round}/${state.draft.maxRounds}`,
        `流程状态：${state.draft.phase}`,
        '',
        '队伍阵容：',
        ...state.captains.map(captain => {
          const members = captain.team
            .map(playerId => state.players.find(player => player.id === playerId))
            .filter(Boolean)
            .map(player => `${player.name}(${player.lane || '未知'} / ${state.settings.tierNames[player.tier] || player.tier})`);
          return `- ${captain.name}：${members.length ? members.join('、') : '暂无队员'}`;
        }),
        '',
        '关键事件：',
        ...eventLines(filteredEvents()).slice(0, 80),
      ];
      const ok = downloadText(`HEXCORE2_裁判复盘_${fileDate()}.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
      if (ok) Hexcore2.eventStore.append('日志导出', '裁判导出了复盘文本', 'info');
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
