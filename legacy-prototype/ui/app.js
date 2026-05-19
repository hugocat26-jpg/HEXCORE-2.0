// hexcore2.0/src/ui/app.js
import { EventBus } from '../core/events.js';
import { AppState } from '../app.js';
import { showModal, closeModal } from './modal.js';
import { showToast } from './toast.js';
import { navigateTo } from './navigation.js';
import { renderHomePage } from './pages/home.js';
import { renderTeamsPage } from './pages/teams.js';
import { renderDraftPage } from './pages/draft.js';
import { renderHexcorePage } from './pages/hexcore.js';

export const UIController = {
  init() {
    EventBus.on('navigate', this.handleNavigate.bind(this));
    EventBus.on('showModal', ({ title, content, options }) => showModal(title, content, options));
    EventBus.on('closeModal', closeModal);
    EventBus.on('toast', ({ message, type }) => showToast(message, type));

    navigateTo('home');
  },

  handleNavigate(pageId) {
    const main = document.getElementById('main-content');
    switch (pageId) {
      case 'home':
        main.innerHTML = renderHomePage();
        break;
      case 'teams':
        main.innerHTML = renderTeamsPage();
        break;
      case 'draft':
        main.innerHTML = renderDraftPage();
        break;
      case 'hexcore':
        main.innerHTML = renderHexcorePage();
        break;
      default:
        main.innerHTML = '<p>页面不存在</p>';
    }
  }
};