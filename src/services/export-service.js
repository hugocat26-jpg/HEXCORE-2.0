(function initExportService(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const OFFICIAL_PLAYER_LIMIT = 50;

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

  function enforceFileSize(file, maxBytes, label) {
    if (file && Number.isFinite(file.size) && file.size > maxBytes) {
      throw new Error(`${label}不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`);
    }
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

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function campLabel(camp) {
    return camp === 'local' ? '本地人' : (camp === 'outsider' ? '外地人' : '');
  }

  function buildPlayersCsv(players) {
    const headers = ['id', 'name', 'gameId', 'lane', 'camp', '阵营', 'score', 'tier', 'status', 'heroes', 'manifesto'];
    const rows = (players || []).map(player => [
      player.id,
      player.name,
      player.gameId,
      player.lane,
      player.camp,
      campLabel(player.camp),
      player.score,
      player.tier,
      player.status,
      Array.isArray(player.heroes) ? player.heroes.join('、') : player.heroes,
      player.manifesto,
    ]);
    return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
  }

  function validateStateBackup(state) {
    if (!state || !Array.isArray(state.captains) || !Array.isArray(state.players) || !state.draft) {
      throw new Error('备份文件结构不正确');
    }
    if (state.captains.length < 5 || state.captains.length > 20) {
      throw new Error('队伍数量必须在5-20之间');
    }
    if (!Array.isArray(state.players) || state.players.length > OFFICIAL_PLAYER_LIMIT) {
      throw new Error('参赛选手总数不能超过50人');
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

  function splitCsvLine(line) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  function readImportField(source, keys) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        return source[key];
      }
    }
    return '';
  }

  function normalizeCamp(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text === 'local' || text === '本地' || text === '本地人') return 'local';
    if (text === 'outsider' || text === 'away' || text === '外地' || text === '外地人') return 'outsider';
    return '';
  }

  function parsePlayerRows(filename, text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('导入文件为空');
    const isJson = /\.json$/i.test(filename || '') || raw.startsWith('[') || raw.startsWith('{');
    let rows;

    if (isJson) {
      const parsed = JSON.parse(raw);
      rows = Array.isArray(parsed) ? parsed : parsed.players;
      if (!Array.isArray(rows)) throw new Error('JSON 需为选手数组或包含 players 数组');
    } else {
      const lines = raw.split(/\r?\n/).filter(line => line.trim());
      const headers = splitCsvLine(lines.shift() || '').map(header => header.trim());
      rows = lines.map(line => {
        const cells = splitCsvLine(line);
        return headers.reduce((record, header, index) => {
          record[header] = cells[index] || '';
          return record;
        }, {});
      });
    }

    if (!rows.length) throw new Error('没有可导入的选手数据');
    if (rows.length > 500) throw new Error('单次最多导入 500 名选手');
    return rows;
  }

  function normalizeImportedPlayer(row, index) {
    const source = row && typeof row === 'object' ? row : {};
    const rawScore = readImportField(source, ['score', '评分']);
    const scoreNumber = Number(rawScore);
    const score = Math.max(0, Math.min(120, Math.round(scoreNumber)));
    const status = String(source.status || source.状态 || 'available') === 'disabled' || String(source.status || source.状态) === '禁用'
      ? 'disabled'
      : 'available';
    const name = String(readImportField(source, ['name', '名称', 'playerName', '选手名称'])).trim();
    const lane = String(readImportField(source, ['lane', '位置', '偏好位置'])).trim();
    const gameId = String(readImportField(source, ['gameId', '游戏ID', 'ID', 'uid'])).trim();
    const camp = normalizeCamp(readImportField(source, ['camp', '阵营', 'campLabel']));
    if (!name) {
      throw new Error(`第 ${index + 1} 行缺少选手名称`);
    }
    if (!lane) {
      throw new Error(`第 ${index + 1} 行缺少偏好位置`);
    }
    if (!gameId) {
      throw new Error(`第 ${index + 1} 行缺少游戏ID`);
    }
    if (!camp) {
      throw new Error(`第 ${index + 1} 行缺少或无法识别阵营`);
    }
    if (String(rawScore).trim() === '' || !Number.isFinite(scoreNumber) || scoreNumber < 0 || scoreNumber > 120) {
      throw new Error(`第 ${index + 1} 行评分非法`);
    }

    const seasonResults = {};
    for (let season = 1; season <= 6; season += 1) {
      seasonResults[`s${season}`] = String(readImportField(source, [
        `s${season}`,
        `S${season}`,
        `season${season}`,
        `第${season}届`,
        `第${season}屆`,
      ]) || '未参赛').trim();
    }
    const fmvpRaw = readImportField(source, ['fmvpSeasons', 'FMVP届数', 'FMVP', 'fmvp']);
    const fmvpSeasons = Array.isArray(fmvpRaw)
      ? fmvpRaw
      : String(fmvpRaw || '').split(/[，,、|/]/).map(value => value.trim()).filter(Boolean);

    return {
      id: String(source.id || source.playerId || source.内部ID || '').trim(),
      name: name.slice(0, 32),
      camp,
      lane: lane.slice(0, 16),
      gameId: gameId.slice(0, 40),
      score,
      tier: 1,
      kda: String(source.kda || source.KDA || '0.0').trim().slice(0, 12),
      damage: String(source.damage || source.伤害 || '0K').trim().slice(0, 12),
      winRate: String(source.winRate || source.胜率 || '0%').trim().slice(0, 12),
      heroes: Array.isArray(source.heroes)
        ? source.heroes.map(hero => String(hero).slice(0, 8)).slice(0, 5)
        : String(source.heroes || source.英雄 || source.擅长英雄 || '待,定,位').split(/[，,|/]/).map(hero => hero.trim()).filter(Boolean).slice(0, 5),
      manifesto: String(source.manifesto || source.参赛宣言 || source.slogan || '').trim().slice(0, 80),
      seasonResults,
      fmvpSeasons,
      isFmvp: Boolean(fmvpSeasons.length || Object.values(seasonResults).some(value => String(value).toUpperCase() === 'FMVP')),
      status,
    };
  }

  function parsePlayerImport(filename, text) {
    return parsePlayerRows(filename, text).map(normalizeImportedPlayer);
  }

  function buildPlayerImportPreview(filename, text, existingPlayers) {
    const rows = parsePlayerRows(filename, text);
    const existingGameIds = new Set((existingPlayers || [])
      .map(player => String(player.gameId || '').trim().toLowerCase())
      .filter(Boolean));
    const seenGameIds = new Set();
    const accepted = [];
    const skipped = [];
    const stats = {
      missingField: 0,
      invalidScore: 0,
      duplicateGameId: 0,
      overflow: 0,
    };
    const remainingSlots = Math.max(0, OFFICIAL_PLAYER_LIMIT - (existingPlayers || []).length);

    rows.forEach((row, index) => {
      try {
        const player = normalizeImportedPlayer(row, index);
        const gameIdKey = String(player.gameId || '').toLowerCase();
        if (existingGameIds.has(gameIdKey) || seenGameIds.has(gameIdKey)) {
          stats.duplicateGameId += 1;
          skipped.push({ row: index + 1, name: player.name, gameId: player.gameId, reason: '游戏ID重复' });
          return;
        }
        if (accepted.length >= remainingSlots) {
          stats.overflow += 1;
          skipped.push({ row: index + 1, name: player.name, gameId: player.gameId, reason: '超过50人参赛上限' });
          return;
        }
        seenGameIds.add(gameIdKey);
        accepted.push(player);
      } catch (error) {
        const reason = error && error.message ? error.message : '数据格式错误';
        if (reason.includes('评分')) {
          stats.invalidScore += 1;
        } else {
          stats.missingField += 1;
        }
        skipped.push({ row: index + 1, name: '', gameId: '', reason });
      }
    });

    return {
      fileName: String(filename || '未命名文件').slice(0, 120),
      totalRows: rows.length,
      accepted,
      skipped,
      stats,
      createdAt: new Date().toISOString(),
    };
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
        `HEXCORE2 选人抽卡复盘`,
        `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        `队伍数量：${state.captains.length}`,
        `当前轮次：${state.draft.round}/${state.draft.maxRounds}`,
        `抽选流程状态：${state.draft.phase}`,
        '',
        '队伍阵容：',
        ...state.captains.map(captain => {
          const members = captain.team
            .map(playerId => state.players.find(player => player.id === playerId))
            .filter(Boolean)
            .map(player => `${player.name}(${player.lane || '未知'} / ${state.settings.tierNames[player.tier] || player.tier} / ${player.tier}金币)`);
          const gold = captain.economy ? captain.economy.gold : 0;
          return `- ${captain.name}（剩余金币${gold}）：${members.length ? members.join('、') : '暂无队员'}`;
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

    buildPlayersCsv,

    exportPlayersCsv() {
      const csv = buildPlayersCsv(Hexcore2.state.players);
      const ok = downloadText(`HEXCORE2_选手库_${fileDate()}.csv`, csv, 'text/csv;charset=utf-8');
      if (ok) Hexcore2.eventStore.append('选手导出', `裁判导出了选手库 CSV（${Hexcore2.state.players.length} 人，含阵营字段）`, 'info');
      return ok;
    },

    readStateFile(file, onSuccess, onError) {
      if (!file || typeof FileReader === 'undefined') {
        if (onError) onError(new Error('当前环境不支持文件读取'));
        return;
      }

      try {
        enforceFileSize(file, 2 * 1024 * 1024, '状态备份文件');
      } catch (error) {
        if (onError) onError(error);
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

    parsePlayerImport,
    buildPlayerImportPreview,

    readPlayerFile(file, onSuccess, onError) {
      if (!file || typeof FileReader === 'undefined') {
        if (onError) onError(new Error('当前环境不支持文件读取'));
        return;
      }

      try {
        enforceFileSize(file, 2 * 1024 * 1024, '选手导入文件');
      } catch (error) {
        if (onError) onError(error);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          onSuccess(parsePlayerImport(file.name || '', String(reader.result || '')));
        } catch (error) {
          if (onError) onError(error);
        }
      };
      reader.onerror = () => {
        if (onError) onError(new Error('选手文件读取失败'));
      };
      reader.readAsText(file, 'utf-8');
    },

    readPlayerImportPreview(file, existingPlayers, onSuccess, onError) {
      if (!file || typeof FileReader === 'undefined') {
        if (onError) onError(new Error('当前环境不支持文件读取'));
        return;
      }

      try {
        enforceFileSize(file, 2 * 1024 * 1024, '选手导入文件');
      } catch (error) {
        if (onError) onError(error);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          onSuccess(buildPlayerImportPreview(file.name || '', String(reader.result || ''), existingPlayers));
        } catch (error) {
          if (onError) onError(error);
        }
      };
      reader.onerror = () => {
        if (onError) onError(new Error('选手文件读取失败'));
      };
      reader.readAsText(file, 'utf-8');
    },
  };
})(window);
