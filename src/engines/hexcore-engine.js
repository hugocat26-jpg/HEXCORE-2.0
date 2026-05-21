(function initHexcoreEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const transmuteTiers = {
    'transmute-bronze': 2,
    'transmute-auric': 3,
    'transmute-prismatic': 4,
  };
  const pandoraDisabledHexcores = [
    'origin',
    'open-feast',
    'mystery-box',
    'snow-cat',
    'hellhound',
    'double-shot',
    'steady',
    'transmute-bronze',
    'transmute-auric',
    'transmute-prismatic',
  ];
  const goldModeDisabledHexcores = new Set([
    'transmute-bronze',
    'transmute-auric',
    'transmute-prismatic',
    'mystery-box',
    'double-shot',
    'last-stand',
    'lock-contract',
    'hellhound',
    'elite-choice',
    'pandora-box',
    'snow-cat',
    'steady',
    'open-feast',
  ]);

  function hasHexcore(captainId, hexcoreId) {
    return Hexcore2.selectors.isHexcoreEnabled(hexcoreId)
      && (Hexcore2.state.hexcoreAssignments[captainId] || []).some(hexcore => hexcore.id === hexcoreId);
  }

  function blindEffectForSource(captainId) {
    return Hexcore2.state.draft.runtimeEffects.find(effect =>
      effect.type === 'blind_draw'
      && effect.sourceCaptainId === captainId
      && effect.round === Hexcore2.state.draft.round
    );
  }

  function blindEffectForTarget(captainId) {
    return Hexcore2.state.draft.runtimeEffects.find(effect =>
      effect.type === 'blind_draw'
      && effect.captainId === captainId
      && effect.round === Hexcore2.state.draft.round
    );
  }

  function roundEffectForSource(type, captainId) {
    return Hexcore2.state.draft.runtimeEffects.find(effect =>
      effect.type === type
      && effect.sourceCaptainId === captainId
      && effect.round === Hexcore2.state.draft.round
    );
  }

  function nextAvailableTier(startTier) {
    for (let tier = startTier; tier <= 4; tier += 1) {
      if (Hexcore2.selectors.availablePlayers(tier).length > 0) return tier;
    }
    return null;
  }

  Hexcore2.hexcoreEngine = {
    hasHexcore,

    isDisabledInGoldMode(hexcoreId) {
      return Hexcore2.state.settings.economyMode === 'gold_shop' && goldModeDisabledHexcores.has(hexcoreId);
    },

    isDisabledByPandora(captainId, hexcoreId) {
      return hasHexcore(captainId, 'pandora-box') && pandoraDisabledHexcores.includes(hexcoreId);
    },

    executionQueue(captainId) {
      const state = Hexcore2.state;
      const captain = state.captains.find(item => item.id === captainId) || Hexcore2.selectors.currentCaptain();
      if (!captain) return [];

      const currentTier = Hexcore2.poolEngine.effectiveTier(captain.id);
      const tierName = state.settings.tierNames[currentTier];
      const hexcores = state.hexcoreAssignments[captain.id] || [];
      const teamSize = Hexcore2.selectors.teamSize(captain.id);
      const capacity = Hexcore2.selectors.teamMemberCapacity(captain.id);
      const remainingSlots = Math.max(0, capacity - teamSize);
      const pendingDraw = state.draft.currentDraw
        && state.draft.currentDraw.captainId === captain.id
        && !state.draft.pickedThisTurn;
      const availableInTier = tier => Hexcore2.selectors.availablePlayers(tier).length;
      const allPlayersInTier = tier => state.players.filter(player => player.tier === tier).length;
      const blocked = (base, status, reason) => ({ ...base, type: 'blocked', status, reason, executable: false });
      const active = (base, status, reason, extra = {}) => ({ ...base, type: 'active', status, reason, executable: true, ...extra });
      const target = (base, status, reason, extra = {}) => ({ ...base, type: 'target', status, reason, needsTarget: true, executable: true, ...extra });
      const passiveReasons = {
        'giant-slayer': `本轮按规则进入${tierName}池，巨人杀手会在侏儒马与猛犸池之间互换。`,
        'elite-choice': currentTier === 3 ? '本轮抽上等马时，基础抽卡会额外展示1张。' : '未到上等马池时仅待机。',
        'ballroom-queen': `持有者个人卡池顺序反转，本轮实际进入${tierName}池。`,
        'demon-contract': state.draft.round <= 3 ? '第1-3轮自动争取第1顺位，若启元存在则启元优先。' : '第4轮自动调整为最后顺位。',
        'pandora-box': `抽卡前自动从${tierName}评分前5随机分配1人，并禁用自主选人类海克斯。`,
        'last-stand': [1, 2].includes(state.draft.round)
          ? `本轮抽卡前自动跳过并从${tierName}随机分配1人。`
          : (state.draft.round === 4 ? '第4轮获得第一顺位，并可从猛犸池全池自选。' : '本轮仅待机。'),
      };

      const targetRequiredIds = new Set(['blind', 'order-swap', 'decompose-knowledge', 'lock-contract']);
      const actionLabels = {
        blind: '选择致盲目标',
        'order-swap': '选择两名队长',
        'decompose-knowledge': '选择队内选手',
        'lock-contract': '选择两名选手',
        'snow-cat': '生成高低分暗牌',
        'open-feast': '展开全池自选',
        'mystery-box': '生成盲盒抽卡',
        steady: '跳过并随机分配',
        'double-shot': '立即双池分配',
        hellhound: '开启三段自选',
        photographer: '交换本轮与下轮池',
        origin: '加入启元顺位',
      };
      const actionTypes = {
        'transmute-bronze': '直接入队',
        'transmute-auric': '直接入队',
        'transmute-prismatic': '直接入队',
        steady: '直接入队',
        'double-shot': '直接入队',
        'open-feast': '生成抽卡',
        'mystery-box': '生成抽卡',
        'snow-cat': '生成抽卡',
        hellhound: '生成抽卡',
        blind: '抽卡修饰',
        'decompose-knowledge': '抽卡修饰',
        'elite-choice': '抽卡修饰',
        'giant-slayer': '抽卡修饰',
        'ballroom-queen': '抽卡修饰',
        origin: '顺位控制',
        'order-swap': '顺位控制',
        photographer: '流程控制',
        'demon-contract': '顺位控制',
        'lock-contract': '绑定触发',
        'pandora-box': '被动待触发',
        'last-stand': '被动待触发',
      };

      return hexcores.map((hex, index) => {
        const globallyDisabled = !Hexcore2.selectors.isHexcoreEnabled(hex.id);
        const goldModeDisabled = this.isDisabledInGoldMode(hex.id);
        const pandoraDisabled = this.isDisabledByPandora(captain.id, hex.id);
        const blindUsed = hex.id === 'blind' && this.blindUsedBy(captain.id);
        const snowUsed = hex.id === 'snow-cat' && this.snowCatUsedBy(captain.id);
        const normallyUsed = hex.status === 'used' && hex.id !== 'blind' && hex.id !== 'snow-cat';
        const base = {
          id: hex.id,
          name: hex.name,
          captainId: captain.id,
          captainName: captain.name,
          priority: index + 1,
          mode: hex.mode,
          needsTarget: false,
          executable: false,
          actionLabel: actionLabels[hex.id] || '裁判执行',
          actionType: actionTypes[hex.id] || (hex.mode === 'passive' ? '被动待触发' : '裁判执行'),
        };

        if (globallyDisabled) {
          return blocked(base, '已禁用', '规则设置已禁用该海克斯，本轮不会执行。');
        }
        if (goldModeDisabled) {
          return blocked(
            { ...base, actionType: '金币模式禁用', actionLabel: '不可执行' },
            '金币模式禁用',
            '该海克斯会额外入队、免费入队、转队、补偿回合或改变选人数量，金币模式下暂不执行。'
          );
        }
        if (pandoraDisabled) {
          return blocked(base, '潘多拉失效', '潘多拉魔盒禁用自主抽卡或选人类海克斯。');
        }
        if (hex.mode === 'passive') {
          if ((hex.id === 'pandora-box' || hex.id === 'last-stand') && remainingSlots <= 0) {
            return blocked(base, '队伍已满', '队伍已满员，自动分配类被动不会再入队。');
          }
          if (hex.id === 'pandora-box' && availableInTier(currentTier) === 0) {
            return blocked(base, '当前池不足', `${tierName}池暂无可自动分配选手，抽卡时会继续检查下一等级池。`);
          }
          return { ...base, type: 'passive', status: '被动生效', reason: passiveReasons[hex.id] || '该海克斯由引擎在顺位、卡池或抽卡阶段自动结算。', executable: true };
        }
        if (blindUsed || snowUsed || normallyUsed) {
          return { ...base, type: 'used', status: '已使用', reason: hex.id === 'blind' || hex.id === 'snow-cat' ? '该海克斯本轮已使用。' : '该海克斯全程次数已消耗。', executable: false };
        }
        if (pendingDraw) {
          return blocked(base, '先完成抽卡', '当前队长已有抽卡结果未处理，请先选择、随机、跳过或撤销。');
        }
        if (hex.id === 'blind') {
          const targets = this.blindTargetOptions(captain.id);
          return targets.length
            ? target(base, '需选择目标', `本轮可指定 ${targets.length} 名未被致盲过的队长之一。`, { targetCount: targets.length })
            : blocked(base, '无可选目标', '本轮其他队长都已被致盲或不存在可选目标。');
        }
        if (remainingSlots <= 0 && !['origin', 'order-swap', 'photographer'].includes(hex.id)) {
          return blocked(base, '队伍已满', '当前队伍已满员，不能再执行会产生选手入队或抽卡结果的海克斯。');
        }
        if (hex.id === 'order-swap') {
          return state.captains.length >= 2
            ? target(base, '需选择目标', '需要裁判选择两名不同队长，交换基础顺位。')
            : blocked(base, '目标不足', '当前队长数量不足2名，无法执行顺位互换。');
        }
        if (hex.id === 'decompose-knowledge') {
          return captain.team.length > 0
            ? target(base, '需选择目标', `可从当前队伍 ${captain.team.length} 名已有选手中选择1名进行分析。`, { targetCount: captain.team.length })
            : blocked(base, '条件不足', '当前队伍还没有已入队选手，无法分解分析。');
        }
        if (hex.id === 'lock-contract') {
          const availableCount = state.players.filter(player => player.status === 'available').length;
          return availableCount >= 2
            ? target(base, '需选择目标', `当前有 ${availableCount} 名可选选手，可绑定其中任意两名。`, { targetCount: availableCount })
            : blocked(base, '选手不足', '当前可选选手少于2名，无法建立锁定契约。');
        }
        if (hex.id === 'origin') {
          return active(base, '可执行', '当前无未处理抽卡，可加入本轮启元顺位队列。');
        }
        if (hex.id === 'photographer') {
          return state.draft.round >= 1 && state.draft.round <= 3
            ? active(base, '可执行', `可交换第 ${state.draft.round} 轮与第 ${state.draft.round + 1} 轮卡池，影响所有队长。`)
            : blocked(base, '轮次不符', '摄影艺术家仅可在第1-3轮开始时使用。');
        }
        if (transmuteTiers[hex.id]) {
          const targetTier = transmuteTiers[hex.id];
          const targetTierName = state.settings.tierNames[targetTier];
          const count = availableInTier(targetTier);
          return count > 0
            ? active(base, '可执行', `${targetTierName}池当前有 ${count} 名可选选手，可跳过当前池盲抽1人。`)
            : blocked(base, '目标池不足', `${targetTierName}池暂无可选选手，无法完成质变盲抽。`);
        }
        if (hex.id === 'double-shot') {
          if (state.draft.round < 1 || state.draft.round > 3) return blocked(base, '轮次不符', '双发快射仅可在第1/2/3轮使用。');
          if (remainingSlots < 2) return blocked(base, '队伍空间不足', '双发快射会尝试本池和下一池各入队1人，当前队伍至少需要2个空位。');
          const nextTier = Hexcore2.poolEngine.effectiveTierForRound(captain.id, Math.min(4, state.draft.round + 1));
          const currentCount = availableInTier(currentTier);
          const nextCount = availableInTier(nextTier);
          if (currentCount === 0 || nextCount === 0) {
            return blocked(base, '卡池不足', `${tierName}池可选 ${currentCount} 人，${state.settings.tierNames[nextTier]}池可选 ${nextCount} 人，不足以完成双发。`);
          }
          return active(base, '可执行', `${tierName}池和${state.settings.tierNames[nextTier]}池均有可选选手，且队伍有 ${remainingSlots} 个空位。`);
        }
        if (hex.id === 'steady') {
          const count = availableInTier(currentTier);
          return count > 0
            ? active(base, '可执行', `${tierName}池当前有 ${count} 名可选选手，可跳过本轮并随机分配1人。`)
            : blocked(base, '当前池不足', `${tierName}池暂无可选选手，无法随机分配。`);
        }
        if (hex.id === 'open-feast') {
          const count = availableInTier(currentTier);
          return count > 0
            ? active(base, '可执行', `${tierName}池当前有 ${count} 名可选选手，可展开全池自选。`)
            : blocked(base, '当前池不足', `${tierName}池暂无可选选手，无法自选。`);
        }
        if (hex.id === 'mystery-box') {
          const count = allPlayersInTier(currentTier);
          return count > 0
            ? active(base, '可执行', `${tierName}池含已选选手共 ${count} 人，可生成盲盒抽卡。`)
            : blocked(base, '当前池不足', `${tierName}池没有任何选手，无法生成盲盒。`);
        }
        if (hex.id === 'hellhound') {
          if (state.draft.round !== 1) return blocked(base, '轮次不符', '地狱三头犬仅可在第1轮使用。');
          const total = [1, 2, 3].reduce((sum, tier) => sum + availableInTier(tier), 0);
          return total > 0
            ? active(base, '可执行', `前三个卡池当前共有 ${total} 名可选选手，可开始三段自选。`)
            : blocked(base, '卡池不足', '侏儒马、中等马、上等马池均无可选选手，无法开始三段自选。');
        }
        if (hex.id === 'snow-cat') {
          const count = availableInTier(currentTier);
          return count >= 2
            ? active(base, '本轮可用', `${tierName}池当前有 ${count} 名可选选手，可抽出最高分和最低分进行暗牌二选一。`)
            : blocked(base, '选手不足', `${tierName}池可选选手少于2名，无法生成高低分二选一。`);
        }
        if (targetRequiredIds.has(hex.id)) {
          return target(base, '需选择目标', '需要裁判打开目标选择面板，选择对象后才能执行。');
        }
        return active(base, '可执行', '当前执行条件满足，可由裁判点击使用。');
      });
    },

    activate(hexcoreId, options = {}) {
      const state = Hexcore2.state;
      const captain = Hexcore2.selectors.currentCaptain();
      if (!captain) return { ok: false };

      const hexcore = (state.hexcoreAssignments[captain.id] || []).find(item => item.id === hexcoreId);
      if (!hexcore || hexcore.mode === 'passive') return { ok: false };
      if (!Hexcore2.selectors.isHexcoreEnabled(hexcore.id)) {
        Hexcore2.eventStore.append('海克斯执行失败', `【${hexcore.name}】已被规则设置禁用`, 'warn');
        return { ok: false };
      }
      if (this.isDisabledInGoldMode(hexcore.id)) {
        Hexcore2.eventStore.append('海克斯执行失败', `【${hexcore.name}】属于入队型或额外选人型效果，金币模式下暂时禁用`, 'warn');
        return { ok: false };
      }
      if (hexcore.status === 'used' && hexcore.id !== 'blind' && hexcore.id !== 'snow-cat') return { ok: false };
      if (this.isDisabledByPandora(captain.id, hexcore.id)) {
        Hexcore2.eventStore.append('海克斯执行失败', `潘多拉魔盒禁用了【${hexcore.name}】这类自主选人或抽卡效果`, 'warn');
        return { ok: false };
      }

      if (transmuteTiers[hexcore.id]) {
        const tier = transmuteTiers[hexcore.id];
        const tierName = state.settings.tierNames[tier];
        const assigned = Hexcore2.assignmentEngine.assignBlindFromTier(captain.id, tier, `transmute_${tier}`);
        state.draft.currentDraw = null;
        state.draft.pickedThisTurn = true;
        Hexcore2.eventStore.append(
          assigned ? '海克斯自动执行' : '海克斯执行失败',
          assigned ? `${captain.name} 使用【${hexcore.name}】，跳过当前池并从${tierName}盲抽1名选手入队` : `${tierName}暂无可用选手，【${hexcore.name}】无法完成盲抽`,
          assigned ? 'success' : 'warn'
        );
      }

      if (hexcore.id === 'origin') {
        const position = state.draft.runtimeEffects.filter(effect =>
          effect.type === 'fixed_position'
          && effect.source === 'origin'
          && effect.round === state.draft.round
        ).length + 1;
        state.draft.runtimeEffects.push({
          type: 'fixed_position',
          source: 'origin',
          captainId: captain.id,
          round: state.draft.round,
          position,
          priority: 800,
          reason: `启元优先队列：本轮第 ${position} 个使用者，固定第 ${position} 顺位`,
        });
        Hexcore2.turnOrderEngine.recompute();
        state.draft.currentIndex = state.draft.currentOrder.indexOf(captain.id);
      }

      if (hexcore.id === 'blind') {
        if (blindEffectForSource(captain.id)) {
          Hexcore2.eventStore.append('海克斯执行失败', '致盲吹箭本轮已经使用过', 'warn');
          return { ok: false };
        }

        const target = state.captains.find(item => item.id === options.targetCaptainId);
        if (!target || target.id === captain.id) {
          Hexcore2.eventStore.append('海克斯执行失败', '请选择另一位队长作为致盲目标', 'warn');
          return { ok: false };
        }

        if (blindEffectForTarget(target.id)) {
          Hexcore2.eventStore.append('海克斯执行失败', `${target.name} 本轮已被致盲，不能重复选择`, 'warn');
          return { ok: false };
        }

        state.draft.runtimeEffects.push({
          type: 'blind_draw',
          sourceCaptainId: captain.id,
          captainId: target.id,
          round: state.draft.round,
          priority: 500,
          reason: `${captain.name} 对 ${target.name} 使用致盲吹箭`,
        });
        Hexcore2.eventStore.append('海克斯公告', `${captain.name} 化身提莫，对 ${target.name} 使用了致盲吹箭，哼哈哈哈哈`, 'warn');
      }

      if (hexcore.id === 'double-shot') {
        if (state.draft.round < 1 || state.draft.round > 3) {
          Hexcore2.eventStore.append('海克斯执行失败', '双发快射仅可在第1/2/3轮使用', 'warn');
          return { ok: false };
        }

        const currentTier = Hexcore2.poolEngine.effectiveTier(captain.id);
        const nextTier = Hexcore2.poolEngine.effectiveTierForRound(captain.id, Math.min(4, state.draft.round + 1));
        const currentTierName = state.settings.tierNames[currentTier];
        const nextTierName = state.settings.tierNames[nextTier];
        const assignedCurrent = Hexcore2.assignmentEngine.assignRandomFromTier(captain.id, currentTier, 'double_shot_current');
        const assignedNext = Hexcore2.assignmentEngine.assignRandomFromTier(captain.id, nextTier, 'double_shot_next');

        state.draft.runtimeEffects.push({
          type: 'skip_round',
          captainId: captain.id,
          round: Math.min(4, state.draft.round + 1),
          priority: 500,
          reason: '双发快射：下一轮跳过选人',
        });

        if (state.draft.round < 3) {
          state.draft.runtimeEffects.push({
            type: 'move_down_one',
            captainId: captain.id,
            round: 3,
            priority: 500,
            reason: '双发快射：第3轮顺位下降1位',
          });
        }

        state.draft.currentDraw = null;
        state.draft.pickedThisTurn = true;
        Hexcore2.eventStore.append(
          assignedCurrent || assignedNext ? '海克斯自动执行' : '海克斯执行失败',
          `${captain.name} 使用【双发快射】，${currentTierName}${assignedCurrent ? '已入队1人' : '无可用选手'}，${nextTierName}${assignedNext ? '已入队1人' : '无可用选手'}，第 ${Math.min(4, state.draft.round + 1)} 轮将自动跳过`,
          assignedCurrent || assignedNext ? 'success' : 'warn'
        );
      }

      if (hexcore.id === 'steady') {
        const tier = Hexcore2.poolEngine.effectiveTier(captain.id);
        const assigned = Hexcore2.assignmentEngine.assignRandomFromTier(captain.id, tier, 'steady_auto_assign');
        const tierName = state.settings.tierNames[tier];
        Hexcore2.eventStore.append(
          assigned ? '海克斯自动执行' : '海克斯执行失败',
          assigned ? `${captain.name} 使用【稳扎稳打】，系统已从${tierName}随机分配1名选手` : `${tierName}暂无可用选手，【稳扎稳打】无法完成自动分配`,
          assigned ? 'success' : 'warn'
        );
        state.draft.currentDraw = null;
        state.draft.pickedThisTurn = true;
      }

      if (hexcore.id === 'open-feast') {
        const tier = Hexcore2.poolEngine.effectiveTier(captain.id);
        const tierName = state.settings.tierNames[tier];
        state.draft.currentDraw = Hexcore2.probabilityEngine.drawAll(captain.id, tier, '开饭啦：当前池全量自选');
        state.draft.selectedSlot = 0;
        state.draft.pickedThisTurn = false;
        Hexcore2.eventStore.append(
          state.draft.currentDraw.cards.length ? '海克斯自选' : '海克斯执行失败',
          state.draft.currentDraw.cards.length
            ? `${captain.name} 使用【开饭啦】，裁判可从${tierName}全部可用选手中选择1名`
            : `${tierName}暂无可用选手，【开饭啦】无法生成自选列表`,
          state.draft.currentDraw.cards.length ? 'info' : 'warn'
        );
      }

      if (hexcore.id === 'mystery-box') {
        const tier = Hexcore2.poolEngine.effectiveTier(captain.id);
        const tierName = state.settings.tierNames[tier];
        const draw = Hexcore2.probabilityEngine.drawTierIncludingDrafted(captain.id, tier, 3, '神秘贤者·盲盒：本轮卡池包含已被选中的选手');
        state.draft.currentDraw = draw;
        state.draft.selectedSlot = 0;
        state.draft.pickedThisTurn = false;
        Hexcore2.eventStore.append(
          draw.cards.length ? '海克斯盲盒' : '海克斯执行失败',
          draw.cards.length ? `${captain.name} 使用【神秘贤者·盲盒】，从${tierName}全部选手中抽取 ${draw.cards.length} 张，可能包含已入队选手` : `${tierName}没有可抽取选手，【神秘贤者·盲盒】无法生成抽卡结果`,
          draw.cards.length ? 'warn' : 'warn'
        );
      }

      if (hexcore.id === 'hellhound') {
        if (state.draft.round !== 1) {
          Hexcore2.eventStore.append('海克斯执行失败', '地狱三头犬仅可在第1轮使用', 'warn');
          return { ok: false };
        }

        const sequence = {
          type: 'hellhound_sequence',
          sourceCaptainId: captain.id,
          captainId: captain.id,
          round: state.draft.round,
          tiers: [1, 2, 3],
          timeLimits: { 1: 15, 2: 10, 3: 5 },
          step: 0,
          priority: 500,
          reason: '地狱三头犬：连续三池自选',
        };
        state.draft.runtimeEffects.push(sequence);
        this.startHellhoundStep(captain.id, sequence);
        Hexcore2.eventStore.append('海克斯连选', `${captain.name} 使用【地狱三头犬】，开始侏儒马→中等马→上等马连续三段自选`, 'warn');
      }

      if (hexcore.id === 'photographer') {
        if (state.draft.round < 1 || state.draft.round > 3) {
          Hexcore2.eventStore.append('海克斯执行失败', '摄影艺术家仅可在第1/2/3轮使用', 'warn');
          return { ok: false };
        }
        state.draft.runtimeEffects.push({
          type: 'global_pool_swap',
          captainId: captain.id,
          round: state.draft.round,
          priority: 500,
          reason: '摄影艺术家：本轮池与下轮池互换',
        });
        state.draft.currentDraw = null;
        state.draft.pickedThisTurn = false;
        const currentTier = Hexcore2.poolEngine.effectiveTier(captain.id);
        Hexcore2.eventStore.append(
          '海克斯全局生效',
          `${captain.name} 使用【摄影艺术家】，第 ${state.draft.round} 轮与第 ${state.draft.round + 1} 轮卡池互换，当前执行${state.settings.tierNames[currentTier]}池`,
          'warn'
        );
      }

      if (hexcore.id === 'order-swap') {
        const first = state.captains.find(item => item.id === options.firstCaptainId);
        const second = state.captains.find(item => item.id === options.secondCaptainId);
        if (!first || !second || first.id === second.id) {
          Hexcore2.eventStore.append('海克斯执行失败', '请选择两名不同队长进行基础顺位互换', 'warn');
          return { ok: false };
        }

        const firstIndex = state.draft.baseOrder.indexOf(first.id);
        const secondIndex = state.draft.baseOrder.indexOf(second.id);
        if (firstIndex < 0 || secondIndex < 0) {
          Hexcore2.eventStore.append('海克斯执行失败', '目标队长不在基础顺位中，无法互换', 'warn');
          return { ok: false };
        }

        state.draft.baseOrder[firstIndex] = second.id;
        state.draft.baseOrder[secondIndex] = first.id;
        Hexcore2.turnOrderEngine.recompute();
        state.draft.currentIndex = Math.max(0, state.draft.currentOrder.indexOf(captain.id));
        Hexcore2.eventStore.append(
          '海克斯顺位调整',
          `${captain.name} 使用【顺位互换】，交换 ${first.name} 与 ${second.name} 的基础选人顺位；固定顺位类海克斯仍按规则单独结算`,
          'warn'
        );
      }

      if (hexcore.id === 'snow-cat') {
        if (roundEffectForSource('snow_cat_used', captain.id)) {
          Hexcore2.eventStore.append('海克斯执行失败', '雪定饿的喵本轮已经使用过', 'warn');
          return { ok: false };
        }

        const tier = Hexcore2.poolEngine.effectiveTier(captain.id);
        const tierName = state.settings.tierNames[tier];
        const draw = Hexcore2.probabilityEngine.drawHighestLowestSwap(captain.id, tier, '雪定饿的喵：最高分与最低分身份可能互换');
        if (draw.cards.length < 2) {
          Hexcore2.eventStore.append('海克斯执行失败', `${tierName}可用选手不足2人，【雪定饿的喵】无法生成二选一`, 'warn');
          return { ok: false };
        }

        state.draft.runtimeEffects.push({
          type: 'snow_cat_used',
          sourceCaptainId: captain.id,
          captainId: captain.id,
          round: state.draft.round,
          priority: 500,
          reason: '雪定饿的喵：本轮已生成高低分身份扰动抽卡',
        });
        state.draft.currentDraw = draw;
        state.draft.selectedSlot = 0;
        state.draft.pickedThisTurn = false;
        Hexcore2.eventStore.append('海克斯暗牌', `${captain.name} 使用【雪定饿的喵】，系统抽出${tierName}最高分与最低分选手，身份${draw.mysterySwapped ? '已互换展示' : '未互换展示'}`, 'warn');
      }

      if (hexcore.id === 'decompose-knowledge') {
        const player = state.players.find(item => item.id === options.targetPlayerId);
        if (!player || !captain.team.includes(player.id)) {
          Hexcore2.eventStore.append('海克斯执行失败', '请选择当前队伍内已有选手进行分析', 'warn');
          return { ok: false };
        }

        state.draft.runtimeEffects.push({
          type: 'info_boost',
          sourceCaptainId: captain.id,
          captainId: captain.id,
          sourcePlayerId: player.id,
          round: state.draft.round,
          priority: 500,
          reason: `知识来源于分解：分析 ${player.name}，本轮显示战力顺位信息`,
        });
        Hexcore2.eventStore.append('海克斯信息增强', `${captain.name} 使用【知识来源于分解】，分析已有选手「${player.name}」，本轮商店将显示战力顺位信息`, 'info');
      }

      if (hexcore.id === 'lock-contract') {
        const first = state.players.find(item => item.id === options.firstPlayerId);
        const second = state.players.find(item => item.id === options.secondPlayerId);
        if (!first || !second || first.id === second.id) {
          Hexcore2.eventStore.append('海克斯执行失败', '请选择两名不同选手建立锁定契约', 'warn');
          return { ok: false };
        }
        if (first.status !== 'available' || second.status !== 'available') {
          Hexcore2.eventStore.append('海克斯执行失败', '锁定契约只能绑定当前仍可被选择的选手', 'warn');
          return { ok: false };
        }

        state.draft.runtimeEffects.push({
          type: 'locked_pair',
          sourceCaptainId: captain.id,
          captainId: captain.id,
          playerIds: [first.id, second.id],
          priority: 500,
          reason: `锁定契约：${first.name} 与 ${second.name} 已绑定`,
        });
        Hexcore2.eventStore.append('海克斯契约', `${captain.name} 使用【锁定契约】，绑定「${first.name}」与「${second.name}」；任意一人被选中时另一人会自动加入同一队伍`, 'warn');
      }

      if (hexcore.id !== 'blind' && hexcore.id !== 'snow-cat') {
        hexcore.status = 'used';
      }
      Hexcore2.eventStore.append('海克斯激活', `${captain.name} 使用【${hexcore.name}】`, hexcore.id === 'blind' ? 'warn' : 'info');
      return { ok: true, advanceTurn: hexcore.id === 'steady' || hexcore.id === 'double-shot' || Boolean(transmuteTiers[hexcore.id]) };
    },

    isBlinded(captainId) {
      return Boolean(blindEffectForTarget(captainId));
    },

    blindUsedBy(captainId) {
      return Boolean(blindEffectForSource(captainId));
    },

    blindTargetOptions(sourceCaptainId) {
      return Hexcore2.state.captains.filter(captain =>
        captain.id !== sourceCaptainId
        && !blindEffectForTarget(captain.id)
      );
    },

    snowCatUsedBy(captainId) {
      return Boolean(roundEffectForSource('snow_cat_used', captainId));
    },

    infoBoostFor(captainId) {
      return roundEffectForSource('info_boost', captainId);
    },

    powerRank(playerId) {
      const sorted = [...Hexcore2.state.players].sort((a, b) => b.score - a.score);
      return sorted.findIndex(player => player.id === playerId) + 1;
    },

    lockContractPairs() {
      return Hexcore2.state.draft.runtimeEffects.filter(effect =>
        effect.type === 'locked_pair'
        && Array.isArray(effect.playerIds)
        && effect.playerIds.length === 2
      );
    },

    resolveLockContracts(captainId, playerId) {
      if (Hexcore2.state.settings.economyMode === 'gold_shop') return false;
      const state = Hexcore2.state;
      const captain = state.captains.find(item => item.id === captainId);
      if (!captain || captain.team.length >= Hexcore2.selectors.teamMemberCapacity(captainId)) return false;

      const pair = this.lockContractPairs().find(effect => effect.playerIds.includes(playerId) && !effect.resolved);
      if (!pair) return false;

      const pairedPlayerId = pair.playerIds.find(id => id !== playerId);
      const pairedPlayer = state.players.find(item => item.id === pairedPlayerId);
      const pickedPlayer = state.players.find(item => item.id === playerId);
      if (!pairedPlayer || pairedPlayer.status !== 'available') {
        pair.resolved = true;
        Hexcore2.eventStore.append('锁定契约失效', `锁定契约的另一名选手已不可用，无法随「${pickedPlayer ? pickedPlayer.name : playerId}」自动入队`, 'warn');
        return false;
      }

      const assigned = Hexcore2.assignmentEngine.assign(captainId, pairedPlayer.id, 'lock_contract_pair');
      pair.resolved = true;
      if (assigned) {
        Hexcore2.eventStore.append('锁定契约触发', `「${pickedPlayer ? pickedPlayer.name : playerId}」入队触发契约，「${pairedPlayer.name}」自动加入 ${captain.name} 队伍`, 'success');
      }
      return assigned;
    },

    grantCompensationTurn(captainId, reason) {
      if (Hexcore2.state.settings.economyMode === 'gold_shop') {
        Hexcore2.eventStore.append('补偿回合失败', '金币模式禁用额外补偿回合', 'warn', { reason });
        return false;
      }
      const state = Hexcore2.state;
      const captain = state.captains.find(item => item.id === captainId);
      if (!captain || captain.team.length >= Hexcore2.selectors.teamMemberCapacity(captainId)) return false;

      const currentIndex = state.draft.currentIndex;
      const existingLaterIndex = state.draft.currentOrder
        .slice(currentIndex + 1)
        .findIndex(id => id === captainId);
      if (existingLaterIndex < 0) {
        state.draft.currentOrder.splice(currentIndex + 1, 0, captainId);
      }
      state.draft.runtimeEffects.push({
        type: 'compensation_turn',
        captainId,
        round: state.draft.round,
        priority: 500,
        reason,
      });
      Hexcore2.eventStore.append('补偿回合', `${captain.name} 获得1次补偿抽卡和选人机会，顺位在当前队长之后`, 'info');
      return true;
    },

    currentHellhoundSequence(captainId) {
      return Hexcore2.state.draft.runtimeEffects.find(effect =>
        effect.type === 'hellhound_sequence'
        && effect.captainId === captainId
        && effect.round === Hexcore2.state.draft.round
        && !effect.completed
      );
    },

    startHellhoundStep(captainId, sequence) {
      const state = Hexcore2.state;
      const tier = sequence.tiers[sequence.step];
      if (!tier || Hexcore2.selectors.teamSize(captainId) >= Hexcore2.selectors.teamMemberCapacity(captainId)) {
        sequence.completed = true;
        state.draft.currentDraw = null;
        state.draft.pickedThisTurn = true;
        return { completed: true };
      }

      const tierName = state.settings.tierNames[tier];
      const draw = Hexcore2.probabilityEngine.drawAll(captainId, tier, `地狱三头犬：${tierName}池限时 ${sequence.timeLimits[tier]} 秒自选`);
      draw.pickMode = 'hellhound';
      draw.hellhoundStep = sequence.step;
      draw.timeLimitSeconds = sequence.timeLimits[tier];
      state.draft.currentDraw = draw;
      state.draft.selectedSlot = 0;
      state.draft.pickedThisTurn = false;
      Hexcore2.eventStore.append(
        draw.cards.length ? '地狱三头犬阶段' : '地狱三头犬空池',
        draw.cards.length ? `进入${tierName}池自选，限时 ${sequence.timeLimits[tier]} 秒` : `${tierName}池暂无可用选手，可进入下一段或由裁判处理`,
        draw.cards.length ? 'info' : 'warn'
      );
      return { completed: false, draw };
    },

    advanceHellhound(captainId) {
      const sequence = this.currentHellhoundSequence(captainId);
      if (!sequence) return { handled: false };

      sequence.step += 1;
      if (sequence.step >= sequence.tiers.length || Hexcore2.selectors.teamSize(captainId) >= Hexcore2.selectors.teamMemberCapacity(captainId)) {
        sequence.completed = true;
        Hexcore2.state.draft.currentDraw = null;
        Hexcore2.state.draft.pickedThisTurn = true;
        Hexcore2.eventStore.append('地狱三头犬完成', '连续三段自选已完成或队伍已满员', 'success');
        return { handled: true, completed: true };
      }

      return { handled: true, ...this.startHellhoundStep(captainId, sequence) };
    },

    extraDrawCount(captainId) {
      if (Hexcore2.state.settings.economyMode === 'gold_shop') return 0;
      const tier = Hexcore2.poolEngine.effectiveTier(captainId);
      const passiveBonus = hasHexcore(captainId, 'elite-choice') && tier === 3 ? 1 : 0;
      const runtimeBonus = Hexcore2.state.draft.runtimeEffects
        .filter(effect => effect.type === 'extra_draw' && effect.captainId === captainId && effect.round === Hexcore2.state.draft.round)
        .reduce((sum, effect) => sum + (effect.countBonus || 0), 0);
      return passiveBonus + runtimeBonus;
    },

    drawReasons(captainId) {
      if (Hexcore2.state.settings.economyMode === 'gold_shop') return [];
      const tier = Hexcore2.poolEngine.effectiveTier(captainId);
      const reasons = [];
      if (hasHexcore(captainId, 'pandora-box')) {
        reasons.push('潘多拉魔盒：自动从评分前5随机分配');
      }
      if (hasHexcore(captainId, 'elite-choice') && tier === 3) {
        reasons.push('优中选优：上等马池额外展示1张');
      }
      Hexcore2.state.draft.runtimeEffects
        .filter(effect => effect.type === 'extra_draw' && effect.captainId === captainId && effect.round === Hexcore2.state.draft.round)
        .forEach(effect => reasons.push(effect.reason));
      return reasons;
    },

    autoAssignBeforeDraw(captainId) {
      if (Hexcore2.state.settings.economyMode === 'gold_shop') return { handled: false };
      if (hasHexcore(captainId, 'last-stand') && [1, 2].includes(Hexcore2.state.draft.round)) {
        const tier = Hexcore2.poolEngine.effectiveTier(captainId);
        const assigned = Hexcore2.assignmentEngine.assignRandomFromTier(captainId, tier, 'last_stand_auto_assign');
        const captain = Hexcore2.state.captains.find(item => item.id === captainId);
        const tierName = Hexcore2.state.settings.tierNames[tier];
        Hexcore2.state.draft.currentDraw = null;
        Hexcore2.state.draft.pickedThisTurn = true;
        Hexcore2.eventStore.append(
          assigned ? '海克斯自动执行' : '海克斯执行失败',
          assigned ? `${captain.name} 触发【背水一战】，第 ${Hexcore2.state.draft.round} 轮跳过抽卡和选人，系统已从${tierName}随机分配1名选手` : `${tierName}暂无可用选手，【背水一战】无法完成自动分配`,
          assigned ? 'success' : 'warn'
        );
        return { handled: true, assigned, tier };
      }

      if (!hasHexcore(captainId, 'pandora-box')) return { handled: false };

      const startTier = Hexcore2.poolEngine.effectiveTier(captainId);
      const tier = nextAvailableTier(startTier);
      if (!tier) {
        Hexcore2.eventStore.append('海克斯执行失败', '潘多拉魔盒未找到可自动分配的选手', 'warn');
        return { handled: true, assigned: false };
      }

      const assigned = Hexcore2.assignmentEngine.assignRandomFromTopScored(captainId, tier, 5, 'pandora_auto_assign');
      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const tierName = Hexcore2.state.settings.tierNames[tier];
      Hexcore2.state.draft.currentDraw = null;
      Hexcore2.state.draft.pickedThisTurn = true;
      Hexcore2.eventStore.append(
        assigned ? '海克斯自动执行' : '海克斯执行失败',
        assigned ? `${captain.name} 触发【潘多拉魔盒】，系统从${tierName}评分前5中随机分配1名选手` : `${tierName}暂无可用选手，【潘多拉魔盒】无法完成自动分配`,
        assigned ? 'success' : 'warn'
      );
      return { handled: true, assigned, tier };
    },

    drawOverrideBeforeDraw(captainId) {
      if (Hexcore2.state.settings.economyMode === 'gold_shop') return { handled: false };
      if (!hasHexcore(captainId, 'last-stand') || Hexcore2.state.draft.round !== 4) {
        return { handled: false };
      }

      const captain = Hexcore2.state.captains.find(item => item.id === captainId);
      const tier = 4;
      const tierName = Hexcore2.state.settings.tierNames[tier];
      const draw = Hexcore2.probabilityEngine.drawAll(captainId, tier, '背水一战：第4轮猛犸池全池自选');
      Hexcore2.state.draft.currentDraw = draw;
      Hexcore2.state.draft.selectedSlot = 0;
      Hexcore2.state.draft.pickedThisTurn = false;
      Hexcore2.eventStore.append(
        draw.cards.length ? '海克斯自选' : '海克斯执行失败',
        draw.cards.length ? `${captain.name} 触发【背水一战】，裁判可从${tierName}池自选1名选手` : `${tierName}暂无可用选手，【背水一战】无法生成自选列表`,
        draw.cards.length ? 'info' : 'warn'
      );
      return { handled: true, draw };
    },

    nextCaptain(captainId) {
      const order = Hexcore2.state.draft.currentOrder;
      const index = order.indexOf(captainId);
      const nextId = order[index + 1];
      return Hexcore2.state.captains.find(captain => captain.id === nextId);
    },
  };
})(window);
