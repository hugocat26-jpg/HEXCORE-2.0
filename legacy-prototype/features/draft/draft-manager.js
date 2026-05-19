// hexcore2.0/src/features/draft/draft-manager.js
import { AppState } from '../../app.js';
import { EventBus } from '../../core/events.js';
import { hexcoreEngine } from './hexcore-engine.js';
import { shuffle, pickN, pickRandom } from '../../core/utils.js';
import { compareIds, normalizeId } from '../../core/id.js';

class DraftManager {
  constructor() {
    this.state = AppState;
  }

  initDraft() {
    // 初始化轮抽
    this.state.draft = {
      enabled: true,
      round: 1,
      pickOrder: [],
      originalPickOrder: [],
      currentIndex: 0,
      phase: 'global_effects',
      currentCards: [],
      poolSwap: null,
      pendingSkipTurn: [],
      pendingDoubleShot: [],
      pendingLastStand: [],
      priorityOrder: [],
      devilContractHolders: [],
      ballQueenHolder: null,
      pandoraHolder: null,
      ignorePositionHolder: null,
      tripleHead: null,
      pendingExtraPick: null,
      pendingSwapReveal: null,
      pendingBindPair: null,
      pendingBlindBox: null,
      pendingSwapPositions: null,
      pendingBlindTarget: null,
    };

    // 分配海克斯给队长
    this.assignHexcoresToCaptains();

    // 生成第一轮顺序
    this.generatePickOrder();
    EventBus.emit('draftStarted');
  }

  assignHexcoresToCaptains() {
    const hexcoreCount = Math.ceil(this.state.captains.length * 1.5);
    const shuffledHexcores = shuffle([...Array(21).keys()].map(i => i + 1));

    this.state.captainHexcores = new Map();

    this.state.captains.forEach((captain, i) => {
      const assigned = [];
      for (let j = 0; j < 2; j++) {
        const hId = shuffledHexcores[(i * 2 + j) % shuffledHexcores.length];
        assigned.push({
          id: `h-${captain.id}-${hId}`,
          hexcoreId: hId,
          status: 'available',
          usedCount: 0,
          usedRounds: []
        });
      }
      this.state.captainHexcores.set(captain.id, assigned);
    });
  }

  generatePickOrder() {
    // 蛇形顺序
    const captains = this.state.captains;
    const order = captains.map(c => c.id);

    if (this.state.draft.round % 2 === 0) {
      order.reverse();
    }

    this.state.draft.pickOrder = order;
    this.state.draft.originalPickOrder = [...order];
    this.state.draft.currentIndex = 0;
  }

  startRound(round) {
    this.state.draft.round = round;
    this.state.draft.phase = 'global_effects';

    // 执行全局效果
    const { askHexcores } = hexcoreEngine.executeRoundStart(round);

    // 应用优先顺位效果（启元）
    this.applyPriorityOrder();

    // 应用恶魔契约
    this.applyDevilContract();

    // 应用潘多拉魔盒
    this.applyPandora();

    // 询问需要手动选择的海克斯
    if (askHexcores.length > 0) {
      this.state.draft.pendingAskHexcores = askHexcores;
      this.state.draft.phase = 'asking';
      EventBus.emit('roundStartAsk', { round, askHexcores });
    } else {
      this.startCaptainTurns();
    }
  }

  applyPriorityOrder() {
    const { priorityOrder } = this.state.draft;
    if (!priorityOrder || priorityOrder.length === 0) return;

    const baseOrder = this.state.draft.originalPickOrder;
    priorityOrder.forEach((captainId, index) => {
      const pos = baseOrder.indexOf(captainId);
      if (pos !== -1 && pos !== index) {
        baseOrder.splice(pos, 1);
        baseOrder.splice(index, 0, captainId);
      }
    });

    this.state.draft.pickOrder = [...baseOrder];
  }

  applyDevilContract() {
    for (const captainId of this.state.draft.devilContractHolders) {
      const pos = this.state.draft.pickOrder.indexOf(captainId);
      if (pos !== -1 && this.state.draft.round <= 3) {
        // 移到第一位
        this.state.draft.pickOrder.splice(pos, 1);
        this.state.draft.pickOrder.unshift(captainId);
      } else if (pos !== -1 && this.state.draft.round === 4) {
        // 移到最后
        this.state.draft.pickOrder.splice(pos, 1);
        this.state.draft.pickOrder.push(captainId);
      }
    }
  }

  applyPandora() {
    if (!this.state.draft.pandoraHolder) return;

    const holder = this.state.draft.pandoraHolder;
    const pos = this.state.draft.pickOrder.indexOf(holder);
    if (pos !== -1 && pos !== 2) {
      this.state.draft.pickOrder.splice(pos, 1);
      this.state.draft.pickOrder.splice(2, 0, holder);
    }
  }

  startCaptainTurns() {
    this.state.draft.phase = 'captain_turn';
    this.state.draft.currentIndex = 0;
    this.processTurn();
  }

  processTurn() {
    const { pickOrder, currentIndex } = this.state.draft;

    if (currentIndex >= pickOrder.length) {
      this.endRound();
      return;
    }

    const captainId = pickOrder[currentIndex];

    // 检查是否跳过
    if (this.shouldSkipTurn(captainId)) {
      this.advanceToNextCaptain();
      return;
    }

    // 绘制卡牌
    const pool = hexcoreEngine.getEffectivePool(captainId, this.state.draft.round);
    const cards = this.drawCards(pool);

    this.state.draft.currentCards = cards;
    this.state.draft.currentCaptainId = captainId;

    EventBus.emit('turnStarted', {
      captainId,
      round: this.state.draft.round,
      cards,
      pool
    });
  }

  shouldSkipTurn(captainId) {
    const { pendingSkipTurn, pendingLastStand } = this.state.draft;

    // 稳扎稳打
    if (pendingSkipTurn.some(s => compareIds(s.captainId, captainId) && s.round === this.state.draft.round)) {
      return true;
    }

    // 背水一战
    if (pendingLastStand.some(s => compareIds(s.captainId, captainId))) {
      if (this.state.draft.round <= 2) return true;
    }

    return false;
  }

  drawCards(pool) {
    const available = this.state.players.filter(p =>
      p.cost === pool && p.status === 'available'
    );

    return pickN(available, Math.min(3, available.length));
  }

  selectCard(cardIndex) {
    const { currentCards, currentCaptainId } = this.state.draft;
    const player = currentCards[cardIndex];

    if (!player) return;

    // 添加到队伍
    this.addPlayerToTeam(currentCaptainId, player);

    // 处理双发快射
    this.handleDoubleShot(player);

    // 处理锁定契约
    this.handleBindPair(player);

    // 致盲效果
    if (hexcoreEngine.isBlinded(currentCaptainId)) {
      EventBus.emit('cardRevealed', { player });
    }

    EventBus.emit('cardSelected', { captainId: currentCaptainId, player, cardIndex });

    this.advanceToNextCaptain();
  }

  addPlayerToTeam(captainId, player) {
    const captain = this.state.captains.find(c => compareIds(c.id, captainId));
    if (!captain) return;

    captain.team.push({
      playerId: player.id,
      name: player.name,
      gameId: player.gameId,
      cost: player.cost,
      isRandom: false
    });

    player.status = 'drafted';
    player.teamId = captainId;
  }

  handleDoubleShot(player) {
    const { pendingDoubleShot, currentCaptainId } = this.state.draft;
    const shot = pendingDoubleShot.find(s => compareIds(s.captainId, currentCaptainId));

    if (shot) {
      if (!shot.firstPick) {
        shot.firstPick = player;
        // 需要再选一次
        this.state.draft.needsSecondPick = true;
      } else {
        shot.secondPick = player;
        this.state.draft.needsSecondPick = false;
        // 跳过下一轮
        const nextRound = this.state.draft.round + 1;
        if (nextRound <= 4) {
          this.state.draft.pendingSkipTurn.push({ captainId: currentCaptainId, round: nextRound });
        }
      }
    }
  }

  handleBindPair(player) {
    // 锁定契约逻辑：需要记录配对
  }

  advanceToNextCaptain() {
    this.state.draft.currentIndex++;
    this.state.draft.currentCards = [];

    if (this.state.draft.currentIndex >= this.state.draft.pickOrder.length) {
      this.endRound();
    } else {
      this.processTurn();
    }
  }

  endRound() {
    // 处理随机分配
    this.handleRandomFills();

    if (this.state.draft.round >= 4) {
      this.endDraft();
    } else {
      this.state.draft.round++;
      this.generatePickOrder();
      EventBus.emit('roundEnded', { round: this.state.draft.round - 1 });
      this.startRound(this.state.draft.round);
    }
  }

  handleRandomFills() {
    const { pendingSkipTurn, pendingLastStand } = this.state.draft;

    // 稳扎稳打随机分配
    for (const skip of pendingSkipTurn) {
      if (skip.round === this.state.draft.round) {
        this.randomFill(skip.captainId);
      }
    }

    // 背水一战随机分配
    for (const stand of pendingLastStand) {
      if (this.state.draft.round <= 2) {
        this.randomFill(stand.captainId);
      }
    }
  }

  randomFill(captainId) {
    const pool = this.state.draft.round;
    const available = this.state.players.filter(p =>
      p.cost === pool && p.status === 'available'
    );

    if (available.length > 0) {
      const player = pickRandom(available);
      this.addPlayerToTeam(captainId, { ...player, isRandom: true });
      EventBus.emit('playerRandomFilled', { captainId, player });
    }
  }

  endDraft() {
    this.state.draft.enabled = false;
    this.state.draft.phase = 'idle';
    EventBus.emit('draftEnded');
  }

  // ========== 队长回合内操作 ==========

  useHexcore(captainId, hexcoreId) {
    const hexcores = this.state.captainHexcores.get(normalizeId(captainId));
    const h = hexcores?.find(h => h.hexcoreId === hexcoreId);

    if (!h) return { success: false, error: 'No such hexcore' };

    const result = hexcoreEngine.executeHexcore(captainId, h);

    if (result.success && !result.waiting) {
      EventBus.emit('hexcoreUsed', { captainId, hexcoreId, result });
    }

    return result;
  }
}

export const draftManager = new DraftManager();
