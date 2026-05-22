(function initEconomyEngine(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  function captainById(captainId) {
    return Hexcore2.state.captains.find(captain => captain.id === captainId);
  }

  function roundNumber(round) {
    const value = Number(round || Hexcore2.state.draft.round);
    return Math.max(1, Math.min(4, Math.round(value) || 1));
  }

  function defaultRoundState() {
    return {
      freeShopUsed: false,
      refreshCount: 0,
      purchaseUsed: false,
      skipped: false,
      wiseBenevolenceApplied: false,
      decomposeKnowledgeApplied: false,
      photographerRefreshUsed: false,
      roundOneTierOneRefreshCount: 0,
    };
  }

  function ensureEconomy(captain) {
    if (!captain.economy || typeof captain.economy !== 'object') {
      captain.economy = {
        gold: Hexcore2.state.settings.initialGold,
        incomeAppliedRounds: [1],
        roundState: {},
      };
    }
    if (!Array.isArray(captain.economy.incomeAppliedRounds)) {
      captain.economy.incomeAppliedRounds = [1];
    }
    if (!captain.economy.roundState || typeof captain.economy.roundState !== 'object') {
      captain.economy.roundState = {};
    }
    for (let round = 1; round <= 4; round += 1) {
      captain.economy.roundState[round] = {
        ...defaultRoundState(),
        ...(captain.economy.roundState[round] || {}),
      };
    }
    captain.economy.gold = Math.max(0, Math.round(Number(captain.economy.gold) || 0));
    return captain.economy;
  }

  function roundState(captainId, round) {
    const captain = captainById(captainId);
    if (!captain) return defaultRoundState();
    const economy = ensureEconomy(captain);
    return economy.roundState[roundNumber(round)];
  }

  function hasHexcore(captainId, hexcoreId) {
    return (Hexcore2.state.hexcoreAssignments[captainId] || []).some(hex => hex.id === hexcoreId);
  }

  function ensureHexcoreEconomy(captain) {
    captain.hexcoreEconomy = captain.hexcoreEconomy || {};
    captain.hexcoreEconomy.wiseBenevolenceRefreshCredits = Math.max(
      0,
      Math.round(Number(captain.hexcoreEconomy.wiseBenevolenceRefreshCredits) || 0)
    );
    captain.hexcoreEconomy.decomposeKnowledgeStacks = Math.max(
      0,
      Math.min(3, Math.round(Number(captain.hexcoreEconomy.decomposeKnowledgeStacks) || 0))
    );
    return captain.hexcoreEconomy;
  }

  function roundOneTierOneRefreshReason(captainId, round) {
    if (roundNumber(round) !== 1) return '';
    const draw = Hexcore2.state.draft.currentDraw;
    if (!draw || draw.captainId !== captainId || draw.pickMode !== 'shop') return '';
    const cards = Array.isArray(draw.cards) ? draw.cards : [];
    if (!cards.length || cards.some(card => Number(card.price || card.tier) === 1)) return '';
    const availableTierOne = Hexcore2.selectors.availableCampPlayers(captainId)
      .some(player => Number(player.tier) === 1);
    return availableTierOne ? 'round_one_tier_one' : '';
  }

  function freeRefreshReason(captainId, round) {
    const state = roundState(captainId, round);
    const captain = captainById(captainId);
    const hasPhotographer = captain && hasHexcore(captain.id, 'photographer');
    if (hasPhotographer && !state.photographerRefreshUsed) return 'photographer';
    const tierOneReason = roundOneTierOneRefreshReason(captainId, round);
    if (tierOneReason) return tierOneReason;
    const hexcoreEconomy = captain ? ensureHexcoreEconomy(captain) : {};
    return hexcoreEconomy.wiseBenevolenceRefreshCredits > 0 ? 'wise_benevolence' : '';
  }

  Hexcore2.economyEngine = {
    ensureAll() {
      Hexcore2.state.captains.forEach(ensureEconomy);
    },

    roundState,

    applyRoundIncome(round = Hexcore2.state.draft.round) {
      const targetRound = roundNumber(round);
      let applied = 0;
      Hexcore2.state.captains.forEach(captain => {
        const economy = ensureEconomy(captain);
        const hasOpenFeast = hasHexcore(captain.id, 'open-feast');
        if (!economy.incomeAppliedRounds.includes(targetRound)) {
          if (targetRound > 1) {
            economy.gold += Hexcore2.state.settings.roundIncome;
            applied += 1;
          }
          economy.incomeAppliedRounds.push(targetRound);
        }
        captain.hexcoreEconomy = captain.hexcoreEconomy || {};
        if (hasOpenFeast && targetRound === 3 && !captain.hexcoreEconomy.openFeastApplied) {
          economy.gold += 3;
          captain.hexcoreEconomy.openFeastApplied = true;
          Hexcore2.eventStore.append('开饭啦', `${captain.name} 第3轮获得餐补 +3 金币`, 'success');
        }
      });
      if (applied) {
        Hexcore2.eventStore.append(
          '金币收入',
          `第 ${targetRound} 轮开始，${applied} 名队长各获得 ${Hexcore2.state.settings.roundIncome} 金币`,
          'info'
        );
      }
      return applied;
    },

    nextRefreshCost(captainId, round = Hexcore2.state.draft.round) {
      const costs = Hexcore2.state.settings.refreshCosts || [1, 2, 3, 4];
      if (freeRefreshReason(captainId, round)) return 0;
      const state = roundState(captainId, round);
      return costs[Math.min(state.refreshCount, costs.length - 1)] || 4;
    },

    nextRefreshReason(captainId, round = Hexcore2.state.draft.round) {
      return freeRefreshReason(captainId, round);
    },

    applyCaptainTurnStart(captainId, round = Hexcore2.state.draft.round) {
      const captain = captainById(captainId);
      const targetRound = roundNumber(round);
      if (!captain) return { applied: false };
      const economy = ensureEconomy(captain);
      const state = roundState(captain.id, targetRound);
      const hexcoreEconomy = ensureHexcoreEconomy(captain);
      const result = { applied: false };
      if (hasHexcore(captain.id, 'wise-benevolence') && !state.wiseBenevolenceApplied) {
        economy.gold += targetRound;
        hexcoreEconomy.wiseBenevolenceRefreshCredits += 1;
        state.wiseBenevolenceApplied = true;
        result.applied = true;
        result.goldBonus = targetRound;
        result.refreshCredits = hexcoreEconomy.wiseBenevolenceRefreshCredits;
        Hexcore2.eventStore.append(
          '贤者的博爱',
          `${captain.name} 第 ${targetRound} 轮获得意外之喜：+${targetRound} 金币，累计免费刷新 +1（剩余 ${hexcoreEconomy.wiseBenevolenceRefreshCredits} 次）`,
          'success'
        );
      }
      if (hasHexcore(captain.id, 'decompose-knowledge') && !state.decomposeKnowledgeApplied) {
        const before = hexcoreEconomy.decomposeKnowledgeStacks;
        hexcoreEconomy.decomposeKnowledgeStacks = Math.min(3, before + 1);
        state.decomposeKnowledgeApplied = true;
        result.applied = true;
        result.decomposeKnowledgeStacks = hexcoreEconomy.decomposeKnowledgeStacks;
        Hexcore2.eventStore.append(
          '知识来源于分解',
          `${captain.name} 获得 1 层解构（${before} → ${hexcoreEconomy.decomposeKnowledgeStacks}/3）`,
          'info'
        );
      }
      return result;
    },

    canOperate(captainId, round = Hexcore2.state.draft.round) {
      const captain = captainById(captainId);
      if (!captain || Hexcore2.state.draft.phase === 'completed') {
        return { ok: false, reason: '当前没有可操作队长' };
      }
      const state = roundState(captainId, round);
      if (state.purchaseUsed) return { ok: false, reason: '本轮购买权限已使用' };
      if (state.skipped) return { ok: false, reason: '本轮已跳过，购买权限已作废' };
      if (Hexcore2.selectors.teamSize(captainId) >= Hexcore2.selectors.teamMemberCapacity(captainId)) {
        return { ok: false, reason: '队伍已满员' };
      }
      return { ok: true, reason: '' };
    },

    markFreeShop(captainId, round = Hexcore2.state.draft.round) {
      this.applyCaptainTurnStart(captainId, round);
      roundState(captainId, round).freeShopUsed = true;
    },

    payRefresh(captainId, round = Hexcore2.state.draft.round) {
      const captain = captainById(captainId);
      if (!captain) return { ok: false, cost: 0, reason: '当前没有可操作队长' };
      const economy = ensureEconomy(captain);
      const operate = this.canOperate(captainId, round);
      if (!operate.ok) return { ok: false, cost: 0, reason: operate.reason };
      const cost = this.nextRefreshCost(captainId, round);
      if (cost === 0) {
        const reason = freeRefreshReason(captainId, round);
        const state = roundState(captainId, round);
        if (reason === 'photographer') state.photographerRefreshUsed = true;
        if (reason === 'round_one_tier_one') {
          state.roundOneTierOneRefreshCount = Math.max(0, Number(state.roundOneTierOneRefreshCount) || 0) + 1;
        }
        if (reason === 'wise_benevolence') {
          const hexcoreEconomy = ensureHexcoreEconomy(captain);
          hexcoreEconomy.wiseBenevolenceRefreshCredits = Math.max(0, hexcoreEconomy.wiseBenevolenceRefreshCredits - 1);
        }
        return { ok: true, cost, gold: economy.gold, freeReason: reason || 'free' };
      }
      if (economy.gold < cost) {
        return { ok: false, cost, reason: `金币不足，本次刷新需要 ${cost} 金币` };
      }
      economy.gold -= cost;
      roundState(captainId, round).refreshCount += 1;
      return { ok: true, cost, gold: economy.gold };
    },

    spendForPurchase(captainId, price, round = Hexcore2.state.draft.round) {
      const captain = captainById(captainId);
      if (!captain) return { ok: false, reason: '当前没有可操作队长' };
      const economy = ensureEconomy(captain);
      const operate = this.canOperate(captainId, round);
      if (!operate.ok) return { ok: false, reason: operate.reason };
      const cost = Math.max(1, Math.round(Number(price) || 1));
      if (economy.gold < cost) {
        return { ok: false, reason: `金币不足，购买该队员需要 ${cost} 金币` };
      }
      economy.gold -= cost;
      roundState(captainId, round).purchaseUsed = true;
      return { ok: true, cost, gold: economy.gold };
    },

    markSkipped(captainId, round = Hexcore2.state.draft.round) {
      const state = roundState(captainId, round);
      if (state.purchaseUsed) return { ok: false, reason: '本轮已购买，不能再跳过' };
      state.skipped = true;
      return { ok: true };
    },
  };
})(window);
