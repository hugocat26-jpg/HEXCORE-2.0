// hexcore2.0/src/ui/navigation.js
import { EventBus } from '../core/events.js';
import { escapeHtml } from '../core/escape.js';

let currentPage = 'home';

const PAGES = [
  { id: 'home', label: '首页', icon: '🏠' },
  { id: 'teams', label: '队伍', icon: '👥', adminOnly: true },
  { id: 'draft', label: '抽卡', icon: '🎴', adminOnly: true },
  { id: 'hexcore', label: '海克斯', icon: '✨', adminOnly: true },
  { id: 'history', label: '历史', icon: '📊' },
];

export function initNavigation() {
  const nav = document.getElementById('navigation');
  nav.innerHTML = `
    <div class="nav-brand">海克斯大乱斗 S4</div>
    <div class="nav-links">
      ${PAGES.map(p => `<button class="nav-btn" data-page="${p.id}">${p.icon} ${escapeHtml(p.label)}</button>`).join('')}
    </div>
    <div class="nav-user">
      <span id="user-role"></span>
      <button id="logout-btn" class="hidden">登出</button>
    </div>
  `;

  nav.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => navigateTo(btn.dataset.page);
  });

  EventBus.on('authChanged', updateNavAuth);
  updateNavAuth();
}

export function navigateTo(pageId) {
  currentPage = pageId;
  EventBus.emit('navigate', pageId);
}

export function updateNavAuth() {
  const role = document.getElementById('user-role');
  const logoutBtn = document.getElementById('logout-btn');
  // 根据权限显示/隐藏页面
}