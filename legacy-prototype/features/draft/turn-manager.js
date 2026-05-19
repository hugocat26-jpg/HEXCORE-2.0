// hexcore2.0/src/features/draft/turn-manager.js
import { AppState } from '../../app.js';
import { EventBus } from '../../core/events.js';
import { hexcoreEngine } from './hexcore-engine.js';
import { compareIds } from '../../core/id.js';
import { draftManager } from './draft-manager.js';

class TurnManager {
  constructor() {
    this.state = AppState;
    this.currentCaptainId = null;
    this.pendingAction = null;
  }

  initTurn(captainId, round) {
    this.currentCaptainId = captainId;
    this.pendingAction = null;

    // 检查致盲状态
    if (hexcoreEngine.isBlinded(captainId)) {
      EventBus.emit('turnBlinded', { captainId });
    }

    // 检查是否有优先权（开饭啦）
    if (this.state.draft.ignorePositionHolder === captainId) {
      this.state.draft.ignorePositionHolder = null;
      EventBus.emit('turnPriority', { captainId, reason: '开饭啦' });
    }

    // 通知UI可以开始选人
    EventBus.emit('turnReady', { captainId, round });
  }

  requestHexcoreUse(captainId) {
    const available = hexcoreEngine.getAvailableHexcores(captainId, this.state.draft.round);

    if (available.length === 0) {
      return { success: false, error: 'No hexcores available' };
    }

    this.pendingAction = 'useHexcore';
    return { success: true, hexcores: available };
  }

  selectHexcore(captainId, hexcoreId) {
    if (this.pendingAction !== 'useHexcore') {
      return { success: false, error: 'Not expecting hexcore selection' };
    }

    const result = draftManager.useHexcore(captainId, hexcoreId);
    this.pendingAction = null;

    return result;
  }

  cancelAction() {
    this.pendingAction = null;
    EventBus.emit('actionCancelled');
  }
}

export const turnManager = new TurnManager();
