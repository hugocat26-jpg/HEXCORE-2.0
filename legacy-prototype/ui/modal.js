// hexcore2.0/src/ui/modal.js
import { escapeHtml } from '../core/escape.js';
import { EventBus } from '../core/events.js';

let activeModal = null;

export function showModal(title, content, options = {}) {
  if (activeModal) closeModal();

  const container = document.getElementById('modal-container');
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">${content}</div>
      ${options.footer ? `<div class="modal-footer">${options.footer}</div>` : ''}
    </div>
  `;

  modal.querySelector('.modal-close').onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };

  container.appendChild(modal);
  activeModal = modal;
  return modal;
}

export function closeModal() {
  if (!activeModal) return;
  activeModal.remove();
  activeModal = null;
}

export function confirmModal(title, message) {
  return new Promise((resolve) => {
    const content = `<p>${escapeHtml(message)}</p>`;
    const footer = `
      <button class="btn btn-cancel" data-action="cancel">取消</button>
      <button class="btn btn-confirm" data-action="confirm">确认</button>
    `;
    const modal = showModal(title, content, { footer });

    modal.querySelector('[data-action="cancel"]').onclick = () => { closeModal(); resolve(false); };
    modal.querySelector('[data-action="confirm"]').onclick = () => { closeModal(); resolve(true); };
  });
}