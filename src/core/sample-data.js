(function initSampleData(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  const hexcores = [
    { id: 'camp-scout', name: '阵营侦察', type: 'cyan', mode: 'manual', uses: 1, desc: '开店前使用。下一次商店额外展示1张同阵营可抽卡，仍只能购买1人。' },
    { id: 'directed-recruit', name: '定向招募', type: 'cyan', mode: 'manual', uses: 1, needsTarget: 'lane', desc: '开店前选择一个位置。下一次商店至少出现1名同阵营该位置选手。' },
    { id: 'discount-coupon', name: '压价券', type: 'amber', mode: 'manual', uses: 1, desc: '购买前使用。本次购买费用-1，最低为1金币。' },
    { id: 'reserved-seat', name: '保留席位', type: 'cyan', mode: 'manual', uses: 1, needsTarget: 'shopCard', desc: '商店打开后选择1张卡。下次刷新商店时保留该卡。' },
    { id: 'urgent-restock', name: '加急调货', type: 'cyan', mode: 'manual', uses: 1, needsTarget: 'shopCard', desc: '商店打开后选择1张卡，替换为同阵营、同费用、当前商店外的另一名可抽选手。' },
    { id: 'camp-blockade', name: '阵营封锁', type: 'violet', mode: 'manual', uses: 1, needsTarget: 'sameCampCaptain', desc: '选择1名同阵营未行动队长。目标下一次商店少1张，最低3张。' },
    { id: 'price-interference', name: '抬价干扰', type: 'violet', mode: 'manual', uses: 1, needsTarget: 'sameCampCaptain', desc: '选择1名同阵营队长。目标本次购买费用+1，最高5金币。' },
    { id: 'order-overtake', name: '顺位插队', type: 'amber', mode: 'manual', uses: 1, desc: '自己行动前使用。和本轮尚未行动的前一位队长交换，不能越过已行动队长。' },
    { id: 'budget-refund', name: '预算返还', type: 'amber', mode: 'passive', uses: 0, desc: '购买后自动触发。若购买1费或2费选手，返还1金币。每队全局1次。' },
    { id: 'steady-reinforce', name: '稳健补强', type: 'violet', mode: 'manual', uses: 1, desc: '跳过购买前使用。系统从同阵营当前最低可用费用池随机分配1人，消耗本轮购买权。' },
  ];

  Hexcore2.sampleData = {
    captains: [],
    players: [],
    hexcoreAssignments: {},
    hexcores,
  };
})(window);
