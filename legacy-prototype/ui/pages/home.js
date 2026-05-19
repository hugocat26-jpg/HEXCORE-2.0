// hexcore2.0/src/ui/pages/home.js
import { AppState } from '../../app.js';
import { escapeHtml } from '../../core/escape.js';

export function renderHomePage() {
  const players = AppState.players;
  const captains = AppState.captains;

  const tierCounts = [1, 2, 3, 4].map(tier =>
    players.filter(p => p.cost === tier).length
  );

  return `
    <div class="page-home">
      <h1>海克斯大乱斗 S4</h1>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${players.length}</div>
          <div class="stat-label">选手总数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${captains.length}</div>
          <div class="stat-label">队长数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${tierCounts[0]}</div>
          <div class="stat-label">侏儒马</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${tierCounts[1]}</div>
          <div class="stat-label">中等马</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${tierCounts[2]}</div>
          <div class="stat-label">上等马</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${tierCounts[3]}</div>
          <div class="stat-label">猛犸</div>
        </div>
      </div>

      <div class="actions mt-2">
        ${!AppState.draft.enabled ? `
          <button class="btn btn-primary" onclick="window.__startDraft()">开始轮抽</button>
        ` : `
          <button class="btn btn-secondary" onclick="window.__continueDraft()">继续轮抽</button>
        `}
      </div>
    </div>
  `;
}