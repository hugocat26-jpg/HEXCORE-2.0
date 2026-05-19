// hexcore2.0/src/ui/pages/hexcore.js
import { AppState } from '../../app.js';
import { escapeHtml } from '../../core/escape.js';
import { HEXCORES, RARITY_COLORS } from '../../data/hexcores-config.js';

export function renderHexcorePage() {
  return `
    <div class="page-hexcore">
      <h2>海克斯池</h2>

      <div class="hexcore-pool">
        ${HEXCORES.map(h => `
          <div class="hexcore-card" style="border-color: ${RARITY_COLORS[h.rarity]}">
            <div class="hexcore-icon">${escapeHtml(h.icon)}</div>
            <div class="hexcore-info">
              <h4>${escapeHtml(h.name)}</h4>
              <p class="text-secondary">${escapeHtml(h.desc)}</p>
              <span class="hexcore-rarity">${escapeHtml(h.rarity)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}