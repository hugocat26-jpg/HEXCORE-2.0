(function initIcons(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  const icons = {
    draft: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    team: '<path d="M16 21v-2a4 4 0 0 0-8 0v2"/><circle cx="12" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M2 21v-2a4 4 0 0 1 3-3.87"/>',
    users: '<circle cx="9" cy="7" r="4"/><path d="M17 11a4 4 0 1 0 0-8"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>',
    hex: '<path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M12 22V12M3 7l9 5 9-5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a2 2 0 0 0 2 5h1M17 6h3a2 2 0 0 1-2 5h-1"/>',
    rule: '<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    log: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20h-3v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 5 15a1.7 1.7 0 0 0-1.55-1H3v-3h.45A1.7 1.7 0 0 0 5 10a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06A1.7 1.7 0 0 0 8.66 6.34 1.7 1.7 0 0 0 9.66 4.8V4h3v.8a1.7 1.7 0 0 0 1 1.54 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19 10a1.7 1.7 0 0 0 1.55 1H21v3h-.45A1.7 1.7 0 0 0 19.4 15z"/>',
    cube: '<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7.7 12 13l8.7-5.3M12 22V13"/>',
    pick: '<path d="m9 12 2 2 4-5"/><circle cx="12" cy="12" r="10"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4M6 22v-4h4"/>',
    arrowUp: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  };

  Hexcore2.icon = function icon(name) {
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.cube}</svg>`;
  };
})(window);
