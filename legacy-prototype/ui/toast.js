// hexcore2.0/src/ui/toast.js
import { escapeHtml } from '../core/escape.js';

const toastContainer = () => document.getElementById('toast-container');

export function showToast(message, type = 'info', duration = 3000) {
  const container = toastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${escapeHtml(type)}`;
  toast.innerHTML = escapeHtml(message);
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}