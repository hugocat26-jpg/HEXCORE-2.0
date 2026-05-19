// hexcore2.0/src/ui/pages/draft.js
import { AppState } from '../../app.js';
import { escapeHtml } from '../../core/escape.js';
import { hexcoreEngine } from '../../features/draft/hexcore-engine.js';
import { draftManager } from '../../features/draft/draft-manager.js';
import { buildCardHtml, renderCards } from '../cards.js';

export function renderDraftPage() {
  const { draft } = AppState;

  if (!draft.enabled) {
    return `
      <div class="page-draft">
        <h2>轮抽系统</h2>
        <p class="text-secondary">轮抽未开始</p>
        <button class="btn btn-primary mt-2" onclick="window.__initDraft()">初始化轮抽</button>
      </div>
    `;
  }

  return `
    <div class="page-draft">
      <div class="draft-header">
        <h2>第 ${draft.round} 轮</h2>
        <div class="draft-info">
          <span>顺位: ${draft.currentIndex + 1} / ${draft.pickOrder.length}</span>
        </div>
      </div>

      <div class="current-captain">
        <h3>当前队长: ${getCurrentCaptainName()}</h3>
        ${renderHexcoreButtons()}
      </div>

      <div class="cards-area mt-2">
        ${renderCardsArea()}
      </div>

      <div class="pick-order mt-2">
        <h4>选人顺序</h4>
        <div class="order-list">
          ${draft.pickOrder.map((id, i) => `
            <span class="order-item ${i === draft.currentIndex ? 'active' : ''}">
              ${i + 1}. ${getCaptainName(id)}
            </span>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function getCurrentCaptainName() {
  const id = AppState.draft.pickOrder[AppState.draft.currentIndex];
  const captain = AppState.captains.find(c => c.id === id);
  return captain ? escapeHtml(captain.name) : '未知';
}

function getCaptainName(id) {
  const captain = AppState.captains.find(c => c.id === id);
  return captain ? escapeHtml(captain.name) : '未知';
}

function renderHexcoreButtons() {
  const captainId = AppState.draft.pickOrder[AppState.draft.currentIndex];
  const available = hexcoreEngine.getAvailableHexcores(captainId, AppState.draft.round);

  if (available.length === 0) return '';

  return `
    <div class="hexcore-buttons">
      <span class="text-secondary">使用海克斯:</span>
      ${available.map(h => `
        <button class="btn btn-secondary" onclick="window.__useHexcore(${h.hexcoreId})">
          ${h.hexcoreId}
        </button>
      `).join('')}
    </div>
  `;
}

function renderCardsArea() {
  const { currentCards, currentCaptainId } = AppState.draft;

  if (!currentCards || currentCards.length === 0) {
    return '<p class="text-center text-secondary">等待抽卡...</p>';
  }

  const blinded = hexcoreEngine.isBlinded(currentCaptainId);
  const renderedCards = renderCards(currentCards, { blinded });

  return `
    <div class="cards-container">
      ${buildCardHtml(renderedCards, {
        onSelect: 'window.__selectCard',
        disabled: blinded
      })}
    </div>
  `;
}