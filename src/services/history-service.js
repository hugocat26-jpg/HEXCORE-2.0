(function initHistoryService(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  const MAX_SNAPSHOTS = 30;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  Hexcore2.historyService = {
    push(label) {
      const state = Hexcore2.state;
      state.undoStack = state.undoStack || [];
      state.undoStack.unshift({
        id: `snapshot_${Date.now()}`,
        label,
        createdAt: new Date().toISOString(),
        state: clone({
          settings: state.settings,
          captains: state.captains,
          players: state.players,
          hexcoreAssignments: state.hexcoreAssignments,
          draft: state.draft,
          events: state.events,
        }),
      });
      state.undoStack = state.undoStack.slice(0, MAX_SNAPSHOTS);
    },

    undo() {
      const state = Hexcore2.state;
      const snapshot = state.undoStack && state.undoStack.shift();
      if (!snapshot) return null;

      state.settings = clone(snapshot.state.settings);
      state.captains = clone(snapshot.state.captains);
      state.players = clone(snapshot.state.players);
      state.hexcoreAssignments = clone(snapshot.state.hexcoreAssignments);
      state.draft = clone(snapshot.state.draft);
      state.events = clone(snapshot.state.events);
      state.undoStack = state.undoStack || [];
      return snapshot;
    },

    clear() {
      Hexcore2.state.undoStack = [];
    },
  };
})(window);
