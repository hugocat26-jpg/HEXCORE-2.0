// hexcore2.0/src/features/auth/auth.js
import { AppState } from '../../app.js';
import { EventBus } from '../../core/events.js';
import { showToast } from '../../ui/toast.js';

const SESSION_KEY = 'hexcore2_session';
const SESSION_DURATION = 2 * 60 * 60 * 1000; // 2小时

export function initAuth() {
  checkSession();
  document.getElementById('logout-btn')?.addEventListener('click', logout);
}

function checkSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
    if (session.expiry && session.expiry > Date.now()) {
      AppState.session.role = session.role;
      AppState.session.expiry = session.expiry;
      EventBus.emit('authChanged', AppState.session);
    }
  } catch (e) {
    localStorage.removeItem(SESSION_KEY);
  }
}

export function login(role, password) {
  const settings = AppState.settings;
  const validPassword = role === 'admin' ? settings.adminPassword : settings.viewerPassword;

  if (password !== validPassword) {
    return { success: false, error: '密码错误' };
  }

  AppState.session.role = role;
  AppState.session.expiry = Date.now() + SESSION_DURATION;

  localStorage.setItem(SESSION_KEY, JSON.stringify({
    role: AppState.session.role,
    expiry: AppState.session.expiry
  }));

  EventBus.emit('authChanged', AppState.session);
  return { success: true };
}

export function logout() {
  AppState.session.role = null;
  AppState.session.expiry = 0;
  localStorage.removeItem(SESSION_KEY);
  EventBus.emit('authChanged', AppState.session);
  showToast('已登出', 'info');
}

export function isAdmin() {
  return AppState.session.role === 'admin';
}

export function isViewer() {
  return AppState.session.role === 'viewer';
}

export function requireAuth(role = 'admin') {
  if (role === 'admin' && !isAdmin()) {
    throw new Error('需要管理员权限');
  }
  return true;
}
