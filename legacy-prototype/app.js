// hexcore2.0/src/app.js
import { generateId } from './core/id.js';

export const AppState = {
  players: [],
  captains: [],

  draft: {
    enabled: false,
    round: 1,
    pickOrder: [],
    originalPickOrder: [],
    currentIndex: 0,
    phase: 'idle', // idle | global_effects | asking | captain_turn | round_end
    currentCards: [],
    poolSwap: null,
  },

  // 海克斯实例: Map<captainId, HexcoreInstance[]>
  captainHexcores: new Map(),

  // 效果: Effect[]
  effects: [],

  settings: {
    totalTeams: 12,
    playersPerTeam: 4,
    adminPassword: 'hexcore',
    viewerPassword: '0000',
  },

  session: {
    role: null,
    expiry: 0
  },

  // 初始化
  reset() {
    this.players = [];
    this.captains = [];
    this.draft = { enabled: false, round: 1, pickOrder: [], originalPickOrder: [], currentIndex: 0, phase: 'idle', currentCards: [], poolSwap: null };
    this.captainHexcores = new Map();
    this.effects = [];
  }
};