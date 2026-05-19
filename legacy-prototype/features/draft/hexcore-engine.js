// hexcore2.0/src/features/draft/hexcore-engine.js
import { AppState } from '../../app.js';
import { HEXCORES } from '../../data/hexcores-config.js';
import { EventBus } from '../../core/events.js';
import { compareIds, normalizeId } from '../../core/id.js';
import { shuffle, pickN, pickRandom } from '../../core/utils.js';

class HexcoreEngine {
  constructor() {
    this.state = AppState;
  }

  // ========== 基础查询 ==========

  getHexcoreDef(hexcoreId) {
    return HEXCORES.find(h => h.id === hexcoreId);
  }

  getCaptainHexcores(captainId) {
    return this.state.captainHexcores.get(normalizeId(captainId)) || [];
  }

  getAvailableHexcores(captainId, currentRound) {
    const hexcores = this.getCaptainHexcores(captainId);
    return hexcores.filter(h => {
      if (h.status === 'used') return false;
      const def = this.getHexcoreDef(h.hexcoreId);
      if (!def) return false;
      if (def.script.rounds && !def.script.rounds.includes(currentRound)) return false;
      if (def.script.maxUses > 0 && h.usedCount >= def.script.maxUses) return false;
      return true;
    });
  }

  // ========== 效果执行 ==========

  executeRoundStart(round) {
    const effects = [];
    const askHexcores = [];

    // 处理所有 immediate 和 round_start 海克斯
    for (const [captainId, hexcores] of this.state.captainHexcores) {
      for (const h of hexcores) {
        const def = this.getHexcoreDef(h.hexcoreId);
        if (!def || !def.script) continue;

        if (def.script.trigger === 'immediate' && h.status === 'available') {
          this.executeHexcore(captainId, h);
        } else if (def.script.trigger === 'round_start' && h.status === 'available') {
          this.executeHexcore(captainId, h);
        } else if (def.script.trigger === 'round_start_ask' && h.status === 'available') {
          askHexcores.push({ captainId, hexcore: h, def });
        }
      }
    }

    return { effects, askHexcores };
  }

  executeHexcore(captainId, hexcoreInstance) {
    const def = this.getHexcoreDef(hexcoreInstance.hexcoreId);
    if (!def || !def.script) return { success: false, error: 'Unknown hexcore' };

    const { action, params } = def.script.effect;
    const handler = ACTIONS[action];

    if (!handler) {
      console.error(`[HexcoreEngine] Unknown action: ${action}`);
      return { success: false, error: `Unknown action: ${action}` };
    }

    const ctx = {
      state: this.state,
      captainId: normalizeId(captainId),
      round: this.state.draft.round,
    };

    hexcoreInstance.usedCount = (hexcoreInstance.usedCount || 0) + 1;

    if (hexcoreInstance.usedCount >= (def.script.maxUses || 0)) {
      hexcoreInstance.status = 'used';
    }

    return handler(ctx, params);
  }

  // ========== 辅助方法 ==========

  getEffectivePool(captainId, round) {
    // 舞会女王效果
    const hexcores = this.getCaptainHexcores(captainId);
    const ballQueen = hexcores.find(h => h.hexcoreId === 11 && h.status === 'used');
    if (ballQueen) {
      return 5 - round; // 颠倒顺序
    }

    // 摄影艺术家池互换
    if (this.state.draft.poolSwap && this.state.draft.poolSwap.round === round) {
      return this.state.draft.poolSwap.to;
    }

    return round;
  }

  isBlinded(captainId) {
    return this.state.effects.some(e =>
      e.type === 'blind' && compareIds(e.target, captainId) && e.round === this.state.draft.round
    );
  }

  getSkippedTurns(captainId) {
    return this.state.effects.filter(e =>
      e.type === 'skip_turn' && compareIds(e.target, captainId)
    );
  }

  addEffect(effect) {
    this.state.effects.push(effect);
    EventBus.emit('effectAdded', effect);
  }
}

// ========== 动作处理器 ==========

const ACTIONS = {
  skip_pool(ctx, params) {
    // 质变系列: 跳过某池，直接从目标池抽
    ctx.state.draft.pendingSkipPool = { skip: params.skipPool, target: params.targetPool };
    return { success: true, message: '已跳过侏儒马池' };
  },

  swap_pool_tiers(ctx, params) {
    // 巨人杀手: 侏儒↔猛犸互换
    ctx.state.draft.poolSwap = {
      round: ctx.round,
      from: params.tier1,
      to: params.tier2
    };
    return { success: true, message: '本轮侏儒与猛犸池互换' };
  },

  extra_pick(ctx, params) {
    // 优中选优: 额外抽2张，二选一
    ctx.state.draft.pendingExtraPick = {
      pool: params.pool,
      cards: [], // 待填充
      choosing: true
    };
    return { success: true, waiting: true, message: '请选择1张' };
  },

  skip_and_random_fill(ctx, params) {
    // 稳扎稳打
    ctx.state.draft.pendingSkipTurn = { captainId: ctx.captainId, round: ctx.round };
    return { success: true, message: '本轮跳过，将在结束时随机分配' };
  },

  double_shot(ctx, params) {
    // 双发快射
    ctx.state.draft.pendingDoubleShot = { captainId: ctx.captainId, round: ctx.round };
    return { success: true, message: '连续选2人，跳过下轮' };
  },

  last_stand(ctx, params) {
    // 背水一战
    ctx.state.draft.pendingLastStand = { captainId: ctx.captainId };
    return { success: true, message: '放弃前两轮，第4轮必得第一顺位' };
  },

  bind_pair(ctx, params) {
    // 锁定契约 - 标记但不执行，选人时处理
    ctx.state.draft.pendingBindPair = { captainId: ctx.captainId };
    return { success: true, waiting: true, message: '请选择要绑定的两位选手' };
  },

  fixed_position_3(ctx, params) {
    // 潘多拉魔盒
    ctx.state.draft.pandoraHolder = ctx.captainId;
    ctx.state.draft.pandoraPosition = 3;
    return { success: true, message: '固定第3顺位' };
  },

  reverse_pool_order(ctx, params) {
    // 舞会女王
    ctx.state.draft.ballQueenHolder = ctx.captainId;
    return { success: true, message: '你的池顺序颠倒' };
  },

  triple_pick(ctx, params) {
    // 地狱三头犬
    ctx.state.draft.tripleHead = { captainId: ctx.captainId, step: 1 };
    return { success: true, message: '连续选3人!' };
  },

  devil_contract(ctx, params) {
    // 恶魔契约
    ctx.state.draft.devilContractHolders.push(ctx.captainId);
    return { success: true, message: '1-3轮第1顺，第4轮最后' };
  },

  reveal_stats(ctx, params) {
    // 知识来源于分解
    return { success: true, message: '展示选手历史战绩' };
  },

  swap_reveal(ctx, params) {
    // 雪定饿的喵
    ctx.state.draft.pendingSwapReveal = { captainId: ctx.captainId };
    return { success: true, waiting: true, message: '系统正在处理...' };
  },

  priority_position(ctx, params) {
    // 启元
    const order = ctx.state.draft.priorityOrder || [];
    const usedCount = order.length;
    ctx.state.draft.priorityOrder = [...order, ctx.captainId];
    return { success: true, message: `你的优先顺位: ${usedCount + 1}` };
  },

  steal_player(ctx, params) {
    // 盲盒
    ctx.state.draft.pendingBlindBox = { captainId: ctx.captainId };
    return { success: true, waiting: true, message: '可选已选中的选手' };
  },

  ignore_position(ctx, params) {
    // 开饭啦
    ctx.state.draft.ignorePositionHolder = ctx.captainId;
    return { success: true, message: '无视顺位，自选任意1人' };
  },

  swap_current_next_pool(ctx, params) {
    // 摄影艺术家
    ctx.state.draft.poolSwap = { round: ctx.round, from: ctx.round, to: ctx.round + 1 };
    return { success: true, message: '本轮与下轮池互换' };
  },

  swap_positions(ctx, params) {
    // 顺位互换
    ctx.state.draft.pendingSwapPositions = { captainId: ctx.captainId };
    return { success: true, waiting: true, message: '请选择要互换的两位队长' };
  },

  blind_target(ctx, params) {
    // 致盲吹箭
    ctx.state.draft.pendingBlindTarget = { captainId: ctx.captainId };
    return { success: true, waiting: true, message: '请选择致盲目标' };
  },
};

export const hexcoreEngine = new HexcoreEngine();