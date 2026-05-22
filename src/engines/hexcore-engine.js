(function initHexcoreEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const CAMP_HEXCORE_IDS = new Set([
    'camp-scout',
    'discount-coupon',
    'reserved-seat',
    'urgent-restock',
    'camp-blockade',
    'price-interference',
    'steady-reinforce',
    'donation',
    'sponsor-flow',
    'open-feast',
    'vampiric-habit',
    'giant-slayer',
    'photographer',
  ]);

  function hasHexcore(captainId, hexcoreId) {
    return Hexcore2.selectors.isHexcoreEnabled(hexcoreId)
      && (Hexcore2.state.hexcoreAssignments[captainId] || []).some(hexcore => hexcore.id === hexcoreId);
  }

  function markUsed(hexcore) {
    if (hexcore && hexcore.mode !== 'passive') hexcore.status = 'used';
  }

  function currentCaptain() {
    return Hexcore2.selectors.currentCaptain();
  }

  function currentRoundState(captainId) {
    return Hexcore2.economyEngine.roundState(captainId, Hexcore2.state.draft.round);
  }

  function captainCamp(captainId) {
    return Hexcore2.selectors.captainCamp ? Hexcore2.selectors.captainCamp(captainId) : '';
  }

  function sameCampCaptains(sourceCaptainId) {
    const camp = captainCamp(sourceCaptainId);
    return Hexcore2.state.captains.filter(captain => captain.id !== sourceCaptainId && captainCamp(captain.id) === camp);
  }

  function isShopOpenFor(captainId) {
    return Boolean(Hexcore2.state.draft.currentDraw && Hexcore2.state.draft.currentDraw.captainId === captainId);
  }

  function hasOpenSlot(captainId) {
    return Hexcore2.selectors.teamSize(captainId) < Hexcore2.selectors.teamMemberCapacity(captainId);
  }

  function unusedSameCampCaptains(sourceCaptainId) {
    const order = Hexcore2.state.draft.currentOrder || [];
    const currentIndex = Hexcore2.state.draft.currentIndex;
    const pending = new Set(order.slice(currentIndex));
    return sameCampCaptains(sourceCaptainId).filter(captain => pending.has(captain.id));
  }

  function targetableCaptains(sourceCaptainId) {
    const state = Hexcore2.state;
    const order = state.draft.currentOrder || [];
    const currentIndex = state.draft.currentIndex;
    return state.captains.filter(captain => {
      if (captain.id === sourceCaptainId) return false;
      if (Hexcore2.selectors.teamSize(captain.id) >= Hexcore2.selectors.teamMemberCapacity(captain.id)) return false;
      const index = order.indexOf(captain.id);
      if (index >= currentIndex) return true;
      return state.draft.round < state.draft.maxRounds;
    });
  }

  function pushEffect(effect) {
    Hexcore2.state.draft.runtimeEffects.push({
      round: Hexcore2.state.draft.round,
      priority: 500,
      ...effect,
    });
  }

  function captainName(captainId) {
    const captain = Hexcore2.state.captains.find(item => item.id === captainId);
    return captain ? captain.name : '未知队长';
  }

  function effectLabel(effect) {
    const sourceName = effect.sourceCaptainId ? captainName(effect.sourceCaptainId) : '本队';
    const labels = {
      camp_scout: `${sourceName} 的【阵营侦察】：本次商店额外展示 ${Number(effect.countBonus) || 1} 张同阵营卡`,
      discount_coupon: `${sourceName} 的【压价券】：本次购买费用 -1，最低 1 金币`,
      reserved_seat: `${sourceName} 的【保留席位】：本次刷新保留指定卡牌`,
      camp_blockade: `${sourceName} 的【阵营封锁】：本次商店展示数量 -${Number(effect.countPenalty) || 1}`,
      price_interference: `${sourceName} 的【抬价干扰】：下一次购买费用 +1 金币`,
      skip_round: `${sourceName} 的【跳过效果】：本轮行动被跳过`,
      move_first: `${sourceName} 的【顺位效果】：本轮顺位前移`,
      fixed_position: `${sourceName} 的【顺位效果】：本轮固定到指定顺位`,
      move_down_one: `${sourceName} 的【顺位效果】：本轮顺位后移 1 位`,
    };
    return labels[effect.type] || (effect.reason || effect.type || '未知效果');
  }

  function effectStatus(effect, status) {
    return {
      type: effect.type,
      status,
      sourceCaptainId: effect.sourceCaptainId || '',
      sourceCaptainName: effect.sourceCaptainId ? captainName(effect.sourceCaptainId) : '',
      label: effectLabel(effect),
      reason: effect.reason || '',
    };
  }

  function activeCardPlayer(card) {
    return card && Hexcore2.state.players.find(player => player.id === card.playerId);
  }

  function logFail(message, payload) {
    Hexcore2.eventStore.append('海克斯执行失败', message, 'warn', payload || {});
    return { ok: false, reason: message };
  }

  function lowestCampTierPlayer(captainId) {
    for (let tier = 1; tier <= 5; tier += 1) {
      const candidates = Hexcore2.selectors.availablePlayers(tier, captainCamp(captainId));
      if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return null;
  }

  Hexcore2.hexcoreEngine = {
    hasHexcore,

    isDisabledInGoldMode(hexcoreId) {
      return !CAMP_HEXCORE_IDS.has(hexcoreId);
    },

    isDisabledByPandora() {
      return false;
    },

    executionQueue(captainId) {
      const captain = Hexcore2.state.captains.find(item => item.id === captainId) || currentCaptain();
      if (!captain) return [];
      const roundState = currentRoundState(captain.id);
      const shopOpen = isShopOpenFor(captain.id);
      const remainingSlots = Hexcore2.selectors.teamMemberCapacity(captain.id) - Hexcore2.selectors.teamSize(captain.id);
      const hexcores = Hexcore2.state.hexcoreAssignments[captain.id] || [];
      const blocked = (base, status, reason) => ({ ...base, type: 'blocked', status, reason, executable: false });
      const active = (base, status, reason, extra = {}) => ({ ...base, type: 'active', status, reason, executable: true, ...extra });
      const passive = (base, status, reason) => ({ ...base, type: 'passive', status, reason, executable: false });
      const target = (base, status, reason, extra = {}) => ({ ...base, type: 'target', status, reason, executable: true, needsTarget: true, ...extra });
      const labels = {
        'camp-scout': '开店强化',
        'discount-coupon': '购买减费',
        'reserved-seat': '保留卡牌',
        'urgent-restock': '替换卡牌',
        'camp-blockade': '商店干扰',
        'price-interference': '费用干扰',
        'steady-reinforce': '稳健补强',
        donation: '初始经济',
        'sponsor-flow': '被动返还',
        'open-feast': '轮次经济',
        'vampiric-habit': '经济干扰',
        'giant-slayer': '高费优惠',
        photographer: '免费刷新',
      };

      return hexcores.map((hex, index) => {
        const base = {
          id: hex.id,
          name: hex.name,
          captainId: captain.id,
          captainName: captain.name,
          priority: index + 1,
          mode: hex.mode,
          needsTarget: false,
          executable: false,
          actionLabel: labels[hex.id] || '裁判执行',
          actionType: labels[hex.id] || '裁判执行',
        };
        if (!Hexcore2.selectors.isHexcoreEnabled(hex.id)) return blocked(base, '已禁用', '规则设置已禁用该海克斯。');
        if (!CAMP_HEXCORE_IDS.has(hex.id)) return blocked(base, '旧海克斯禁用', '阵营锁定模式不执行旧海克斯。');
        if (hex.mode === 'passive') return passive(base, '被动待机', hex.desc || '被动效果自动生效。');
        if (hex.status === 'used') return { ...base, type: 'used', status: '已使用', reason: '该海克斯次数已消耗。', executable: false };
        if (remainingSlots <= 0 && !['camp-blockade', 'price-interference', 'vampiric-habit'].includes(hex.id)) return blocked(base, '队伍已满', '队伍已满员，不能再执行选人相关海克斯。');
        if (hex.id === 'camp-scout') {
          if (shopOpen) return blocked(base, '商店已打开', '该海克斯必须在开店前使用。');
          return active(base, '可执行', '下一次商店额外展示1张同阵营可抽卡。');
        }
        if (['discount-coupon', 'reserved-seat', 'urgent-restock'].includes(hex.id)) {
          if (!shopOpen || roundState.purchaseUsed) return blocked(base, '无可处理商店', '该海克斯必须在当前商店打开且购买前使用。');
          return hex.id === 'discount-coupon'
            ? active(base, '可执行', '本次购买费用-1，最低1金币。')
            : target(base, '需选择卡牌', '请选择当前商店中的1张卡。');
        }
        if (['camp-blockade', 'price-interference'].includes(hex.id)) {
          const targets = targetableCaptains(captain.id);
          return targets.length
            ? target(base, '需选择队长', `当前可选择 ${targets.length} 名队长；若目标本轮已行动，则下轮生效。`, { targetCount: targets.length })
            : blocked(base, '无可用目标', '没有满足条件的目标队长。');
        }
        if (hex.id === 'steady-reinforce') {
          return lowestCampTierPlayer(captain.id)
            ? active(base, '可执行', '系统将从同阵营当前最低可用费用池随机分配1人。')
            : blocked(base, '无可抽选手', '同阵营没有任何可抽选手。');
        }
        if (hex.id === 'vampiric-habit') {
          return Hexcore2.state.captains.some(item => item.id !== captain.id && item.economy && Number(item.economy.gold) > 0)
            ? active(base, '可执行', '从金币最高的三名其他队长处每人获得1金币。')
            : blocked(base, '无可吸取目标', '其他队长当前没有可吸取金币。');
        }
        return active(base, '可执行', '当前条件满足。');
      });
    },

    activate(hexcoreId, options = {}) {
      const state = Hexcore2.state;
      const captain = currentCaptain();
      if (!captain) return logFail('当前没有可操作队长');
      const hexcore = (state.hexcoreAssignments[captain.id] || []).find(item => item.id === hexcoreId);
      if (!hexcore || hexcore.mode === 'passive') return logFail('请选择可手动执行的新海克斯');
      if (!CAMP_HEXCORE_IDS.has(hexcore.id)) return logFail('阵营锁定模式不执行旧海克斯');
      if (hexcore.status === 'used') return logFail(`【${hexcore.name}】已经使用过`);
      if (!Hexcore2.selectors.isHexcoreEnabled(hexcore.id)) return logFail(`【${hexcore.name}】已被规则设置禁用`);

      if (hexcore.id === 'camp-scout') {
        if (isShopOpenFor(captain.id)) return logFail('阵营侦察必须在开店前使用');
        pushEffect({ type: 'camp_scout', captainId: captain.id, countBonus: 1, reason: `${captain.name} 使用阵营侦察` });
      }

      if (hexcore.id === 'discount-coupon') {
        if (!isShopOpenFor(captain.id)) return logFail('压价券必须在商店打开后使用');
        pushEffect({ type: 'discount_coupon', captainId: captain.id, reason: `${captain.name} 使用压价券` });
      }

      if (hexcore.id === 'reserved-seat') {
        const draw = state.draft.currentDraw;
        if (!draw || draw.captainId !== captain.id) return logFail('保留席位必须在当前商店打开后使用');
        const card = draw.cards[Number(options.shopCardIndex)] || draw.cards.find(item => item.playerId === options.targetPlayerId) || draw.cards[state.draft.selectedSlot];
        const player = activeCardPlayer(card);
        if (!player || player.camp !== captainCamp(captain.id)) return logFail('请选择当前商店中的同阵营卡牌');
        pushEffect({ type: 'reserved_seat', captainId: captain.id, playerId: player.id, reason: `${captain.name} 保留 ${player.name}` });
      }

      if (hexcore.id === 'urgent-restock') {
        const draw = state.draft.currentDraw;
        if (!draw || draw.captainId !== captain.id) return logFail('加急调货必须在当前商店打开后使用');
        const cardIndex = Number.isInteger(Number(options.shopCardIndex)) ? Number(options.shopCardIndex) : state.draft.selectedSlot;
        const card = draw.cards[cardIndex];
        const player = activeCardPlayer(card);
        if (!player) return logFail('请选择当前商店中的卡牌');
        const shown = new Set(draw.cards.map(item => item.playerId));
        const candidates = Hexcore2.selectors.availableCampPlayers(captain.id, shown)
          .filter(item => item.tier === player.tier);
        if (!candidates.length) return logFail('没有同阵营同费用的替换目标');
        const replacement = candidates[Math.floor(Math.random() * candidates.length)];
        draw.cards[cardIndex] = { ...card, playerId: replacement.id, tier: replacement.tier, price: replacement.tier, camp: replacement.camp };
      }

      if (hexcore.id === 'camp-blockade') {
        const target = targetableCaptains(captain.id).find(item => item.id === options.targetCaptainId);
        if (!target) return logFail('阵营封锁需要选择一名仍有生效窗口的队长');
        pushEffect({ type: 'camp_blockade', sourceCaptainId: captain.id, captainId: target.id, countPenalty: 1, reason: `${captain.name} 对 ${target.name} 使用阵营封锁，目标下次商店少展示 1 张卡` });
      }

      if (hexcore.id === 'price-interference') {
        const target = targetableCaptains(captain.id).find(item => item.id === options.targetCaptainId);
        if (!target) return logFail('抬价干扰需要选择一名仍有生效窗口的队长');
        pushEffect({ type: 'price_interference', sourceCaptainId: captain.id, captainId: target.id, reason: `${captain.name} 对 ${target.name} 使用抬价干扰，目标下次购买费用 +1 金币` });
      }

      if (hexcore.id === 'steady-reinforce') {
        const roundState = currentRoundState(captain.id);
        if (roundState.purchaseUsed || roundState.skipped) return logFail('本轮购买权已使用或已跳过');
        const player = lowestCampTierPlayer(captain.id);
        if (!player) return logFail('同阵营没有任何可抽选手');
        const assigned = Hexcore2.assignmentEngine.assign(captain.id, player.id, 'steady_reinforce');
        if (!assigned) return logFail('稳健补强分配失败');
        roundState.purchaseUsed = true;
        state.draft.pickedThisTurn = true;
      }

      if (hexcore.id === 'vampiric-habit') {
        const targets = [...state.captains]
          .filter(item => item.id !== captain.id && item.economy && Number(item.economy.gold) > 0)
          .sort((a, b) => Number(b.economy.gold) - Number(a.economy.gold))
          .slice(0, 3);
        if (!targets.length) return logFail('当前没有可吸取金币的队长');
        targets.forEach(target => {
          target.economy.gold -= 1;
          captain.economy.gold += 1;
        });
        Hexcore2.eventStore.append('吸血习性', `${captain.name} 从 ${targets.map(item => item.name).join('、')} 处共获得 ${targets.length} 金币`, 'warn');
      }

      markUsed(hexcore);
      Hexcore2.eventStore.append('海克斯激活', `${captain.name} 使用【${hexcore.name}】${options.targetCaptainId ? `，目标：${captainName(options.targetCaptainId)}` : ''}`, 'info');
      return { ok: true, advanceTurn: hexcore.id === 'steady-reinforce' };
    },

    effectStatusForCaptain(captainId) {
      const effects = Hexcore2.state.draft.runtimeEffects || [];
      const pending = effects
        .filter(effect => effect.captainId === captainId && !effect.consumed)
        .map(effect => effectStatus(effect, '待生效'));
      const draw = Hexcore2.state.draft.currentDraw;
      const appliedFromShop = draw && draw.captainId === captainId && Array.isArray(draw.appliedEffects)
        ? draw.appliedEffects.map(effect => effectStatus(effect, '已生效'))
        : [];
      const appliedFromPurchase = draw && draw.captainId === captainId && Array.isArray(draw.purchaseEffects)
        ? draw.purchaseEffects.map(effect => effectStatus(effect, '已生效'))
        : [];
      return [...pending, ...appliedFromShop, ...appliedFromPurchase].slice(0, 4);
    },

    isBlinded() { return false; },
    blindUsedBy() { return false; },
    blindTargetOptions(sourceCaptainId) { return sameCampCaptains(sourceCaptainId); },
    snowCatUsedBy() { return false; },
    infoBoostFor() { return null; },
    powerRank(playerId) {
      const sorted = [...Hexcore2.state.players].sort((a, b) => b.score - a.score);
      return sorted.findIndex(player => player.id === playerId) + 1;
    },
    lockContractPairs() { return []; },
    resolveLockContracts() { return false; },
    grantCompensationTurn() { return false; },
    currentHellhoundSequence() { return null; },
    startHellhoundStep() { return { completed: true }; },
    advanceHellhound() { return { handled: false }; },
    extraDrawCount() { return 0; },
    drawReasons() { return []; },
    autoAssignBeforeDraw() { return { handled: false }; },
    drawOverrideBeforeDraw() { return { handled: false }; },
    nextCaptain(captainId) {
      const order = Hexcore2.state.draft.currentOrder;
      const index = order.indexOf(captainId);
      const nextId = order[index + 1];
      return Hexcore2.state.captains.find(captain => captain.id === nextId);
    },
  };
})(window);
