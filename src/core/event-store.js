(function initEventStore(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  const initialEvents = [
    ['14:31:52', '海克斯询问', 'C7 神秘贤者 询问可用海克斯', 'info'],
    ['14:31:48', '抽卡完成', 'C7 神秘贤者 抽取 3 张选手卡', 'draw'],
    ['14:31:20', '顺位变更', 'C3 烬灭 使用【启元】，顺延至第 2 位', 'warn'],
    ['14:30:55', '选手入队', 'C6 孤城 选择了选手「夜雨声烦」加入队伍（2/4）', 'success'],
    ['14:30:33', '海克斯询问', 'C6 孤城 询问可用海克斯', 'info'],
    ['14:30:29', '抽卡完成', 'C6 孤城 抽取 2 张选手卡', 'draw'],
    ['14:29:58', '选手入队', 'C5 无痕 选择了选手「风缝蝶吹」加入队伍（1/4）', 'success'],
    ['14:29:41', '海克斯询问', 'C5 无痕 询问可用海克斯', 'info'],
  ];

  Hexcore2.state.events = initialEvents.map(([time, title, body, level]) => ({ time, title, body, level }));

  Hexcore2.eventStore = {
    append(title, body, level = 'info', payload = {}) {
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      Hexcore2.state.events.unshift({ time, title, body, level, payload });
      Hexcore2.state.events = Hexcore2.state.events.slice(0, 16);
    },
  };
})(window);
