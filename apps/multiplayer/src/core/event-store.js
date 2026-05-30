(function initEventStore(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  const initialEvents = [
    ['14:31:52', '规则载入', '金币模式已启用：默认10队、允许空闲选手、四轮商店', 'info'],
    ['14:31:48', '免费商店生成', 'C1 林间石 第1轮免费生成5张商店卡', 'draw'],
    ['14:31:20', '金币规则', '刷新费用为1/2/3/4封顶，每轮首次商店免费', 'info'],
    ['14:30:55', '海克斯规则', '入队型、转队型、补偿回合型海克斯在金币模式下禁用', 'warn'],
  ];

  if (!Hexcore2.state.events || Hexcore2.state.events.length === 0) {
    Hexcore2.state.events = initialEvents.map(([time, title, body, level]) => ({ time, title, body, level }));
  }

  Hexcore2.eventStore = {
    append(title, body, level = 'info', payload = {}) {
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const createdAt = Date.now();
      Hexcore2.state.events.unshift({ time, title, body, level, payload });
      Hexcore2.state.events = Hexcore2.state.events.slice(0, 16);
      Hexcore2.state.ui = Hexcore2.state.ui || {};
      Hexcore2.state.ui.feedback = { title, body, level, time, createdAt };
      if (global.clearTimeout) global.clearTimeout(Hexcore2.feedbackTimer);
      if (global.setTimeout) {
        Hexcore2.feedbackTimer = global.setTimeout(() => {
          if (Hexcore2.state.ui && Hexcore2.state.ui.feedback && Hexcore2.state.ui.feedback.createdAt === createdAt) {
            delete Hexcore2.state.ui.feedback;
            if (Hexcore2.storageService) Hexcore2.storageService.save(Hexcore2.state);
            if (Hexcore2.ui && Hexcore2.ui.renderFeedback) Hexcore2.ui.renderFeedback();
          }
        }, 2200);
      }
      if (Hexcore2.storageService) Hexcore2.storageService.save(Hexcore2.state);
      if (Hexcore2.ui && Hexcore2.ui.renderFeedback) Hexcore2.ui.renderFeedback();
    },
  };
})(window);
