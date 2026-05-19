(function initHexcoreEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const transmuteTiers = {
    'transmute-bronze': 2,
    'transmute-auric': 3,
    'transmute-prismatic': 4,
  };

  function hasHexcore(captainId, hexcoreId) {
    return (Hexcore2.state.hexcoreAssignments[captainId] || []).some(hexcore => hexcore.id === hexcoreId);
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

  function nextAvailableTier(startTier) {
    for (let tier = startTier; tier <= 4; tier += 1) {
      if (Hexcore2.selectors.availablePlayers(tier).length > 0) return tier;
    }
    return null;
  }

  Hexcore2.hexcoreEngine = {
    hasHexcore,

    activate(hexcoreId, options = {}) {
      const state = Hexcore2.state;
      const captain = Hexcore2.selectors.currentCaptain();
      if (!captain) return { ok: false };

      const hexcore = (state.hexcoreAssignments[captain.id] || []).find(item => item.id === hexcoreId);
      if (!hexcore || hexcore.mode === 'passive') return { ok: false };
      if (hexcore.status === 'used' && hexcore.id !== 'blind') return { ok: false };

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
        state.draft.runtimeEffects.push({
          type: 'move_first',
          captainId: captain.id,
          round: state.draft.round,
          priority: 800,
          reason: '启元优先：本轮获得最高可用顺位',
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

      if (hexcore.id !== 'blind') {
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

    extraDrawCount(captainId) {
      const tier = Hexcore2.poolEngine.effectiveTier(captainId);
      const passiveBonus = hasHexcore(captainId, 'elite-choice') && tier === 3 ? 1 : 0;
      const runtimeBonus = Hexcore2.state.draft.runtimeEffects
        .filter(effect => effect.type === 'extra_draw' && effect.captainId === captainId && effect.round === Hexcore2.state.draft.round)
        .reduce((sum, effect) => sum + (effect.countBonus || 0), 0);
      return passiveBonus + runtimeBonus;
    },

    drawReasons(captainId) {
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
