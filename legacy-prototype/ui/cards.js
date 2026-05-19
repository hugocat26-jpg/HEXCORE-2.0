// hexcore2.0/src/ui/cards.js
import { escapeHtml } from '../core/escape.js';

const JOKER_VARIANTS = ['joker-red', 'joker-blue', 'joker-green'];

export function renderCards(players, options = {}) {
  const { blinded = false, revealed = [], onSelect = null } = options;

  if (blinded) {
    return players.map((player, i) => ({
      ...player,
      visual: JOKER_VARIANTS[i % JOKER_VARIANTS.length],
      revealed: revealed.includes(i)
    }));
  }

  return players.map((player, i) => ({
    ...player,
    visual: 'player',
    revealed: true
  }));
}

export function buildCardHtml(cards, options = {}) {
  const { onSelect = null, disabled = false } = options;

  return cards.map((card, i) => {
    const classes = ['card', card.visual, card.revealed ? '' : 'frosted'].filter(Boolean).join(' ');
    const onclick = onSelect && !disabled ? `onclick="window.__selectCard(${i})"` : '';

    if (card.revealed || card.visual === 'player') {
      return `
        <div class="${classes}" ${onclick}>
          <div class="card-name">${escapeHtml(card.name)}</div>
          <div class="card-cost">${card.cost}星</div>
        </div>
      `;
    } else {
      return `
        <div class="${classes}" ${onclick}>
          <div class="card-joker">🃏</div>
        </div>
      `;
    }
  }).join('');
}