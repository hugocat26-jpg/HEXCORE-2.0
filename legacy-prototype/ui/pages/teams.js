// hexcore2.0/src/ui/pages/teams.js
import { AppState } from '../../app.js';
import { escapeHtml } from '../../core/escape.js';
import { EventBus } from '../../core/events.js';

export function renderTeamsPage() {
  return `
    <div class="page-teams">
      <h2>队伍管理</h2>

      <div class="teams-controls mb-2">
        <button class="btn btn-primary" onclick="window.__addCaptain()">添加队长</button>
      </div>

      <div class="teams-grid">
        ${AppState.captains.map(captain => renderCaptainCard(captain)).join('')}
      </div>
    </div>
  `;
}

function renderCaptainCard(captain) {
  return `
    <div class="captain-card" data-captain-id="${escapeHtml(captain.id)}">
      <h3>${escapeHtml(captain.name)}</h3>
      <div class="team-members">
        ${captain.team.length === 0 ? '<p class="text-secondary">暂无成员</p>' :
          captain.team.map(m => `
            <div class="member tier-${escapeHtml(m.cost)}">
              <span>${escapeHtml(m.name)}</span>
              <span>${m.cost}星</span>
            </div>
          `).join('')
        }
      </div>
      <div class="team-hexcores mt-1">
        ${AppState.captainHexcores.get(captain.id)?.map(h => `
          <span class="hexcore-badge">${h.hexcoreId}</span>
        `).join('') || ''}
      </div>
    </div>
  `;
}