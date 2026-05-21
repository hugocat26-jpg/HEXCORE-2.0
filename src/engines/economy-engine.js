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

  Hexcore2.economyEngine = {
    ensureAll() {
      Hexcore2.state.captains.forEach(ensureEconomy);
    },

    roundState,

    applyRoundIncome(round = Hexcore2.state.draft.round) {
      const targetRound = roundNumber(round);
      if (targetRound <= 1) return 0;
      let applied = 0;
      Hexcore2.state.captains.forEach(captain => {
        const economy = ensureEconomy(captain);
        if (economy.incomeAppliedRounds.includes(targetRound)) return;
        economy.gold += Hexcore2.state.settings.roundIncome;
        economy.incomeAppliedRounds.push(targetRound);
        applied += 1;
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
      const state = roundState(captainId, round);
      const costs = Hexcore2.state.settings.refreshCosts || [1, 2, 3, 4];
      return costs[Math.min(state.refreshCount, costs.length - 1)] || 4;
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
      roundState(captainId, round).freeShopUsed = true;
    },

    payRefresh(captainId, round = Hexcore2.state.draft.round) {
      const captain = captainById(captainId);
      if (!captain) return { ok: false, cost: 0, reason: '当前没有可操作队长' };
      const economy = ensureEconomy(captain);
      const operate = this.canOperate(captainId, round);
      if (!operate.ok) return { ok: false, cost: 0, reason: operate.reason };
      const cost = this.nextRefreshCost(captainId, round);
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
      const cost = Math.max(1, Math.min(5, Math.round(Number(price) || 1)));
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
