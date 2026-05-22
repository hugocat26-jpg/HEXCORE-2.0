(function initSampleData(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  const hexcores = [
    { id: 'camp-scout', name: '阵营侦察', type: 'cyan', mode: 'manual', uses: 1, desc: '开店前使用。下一次商店额外展示1张同阵营可抽卡，仍只能购买1人。' },
    { id: 'discount-coupon', name: '压价券', type: 'amber', mode: 'manual', uses: 1, desc: '购买前使用。本次购买费用-1，最低为1金币。' },
    { id: 'reserved-seat', name: '保留席位', type: 'cyan', mode: 'manual', uses: 1, needsTarget: 'shopCard', desc: '商店打开后选择1张卡。下次刷新商店时保留该卡。' },
    { id: 'urgent-restock', name: '加急调货', type: 'cyan', mode: 'manual', uses: 1, needsTarget: 'shopCard', desc: '商店打开后选择1张卡，替换为同阵营、同费用、当前商店外的另一名可抽选手。' },
    { id: 'camp-blockade', name: '阵营封锁', type: 'violet', mode: 'manual', uses: 1, needsTarget: 'captain', desc: '选择任意队长。目标下一次商店少1张，最低3张；若本轮已行动则下轮生效。' },
    { id: 'price-interference', name: '抬价干扰', type: 'violet', mode: 'manual', uses: 1, needsTarget: 'captain', desc: '选择任意队长。目标下一次购买费用+1，无上限，卡牌显示醒目的+1标记。' },
    { id: 'steady-reinforce', name: '稳健补强', type: 'violet', mode: 'manual', uses: 1, desc: '跳过购买前使用。系统从同阵营当前最低可用费用池随机分配1人，消耗本轮购买权。' },
    { id: 'donation', name: '捐赠', type: 'amber', mode: 'passive', uses: 0, desc: '获得时初始资金+2。' },
    { id: 'sponsor-flow', name: '赞助回流', type: 'amber', mode: 'passive', uses: 0, desc: '每局2次。购买费用不低于3的选手后，返还1金币。' },
    { id: 'open-feast', name: '开饭啦', type: 'violet', mode: 'passive', uses: 0, desc: '第3轮开始时，资金+3。' },
    { id: 'vampiric-habit', name: '吸血习性', type: 'violet', mode: 'manual', uses: 1, desc: '从当前金币余额最高的三名其他队长处每人获得1金币，金币为0的队长跳过。' },
    { id: 'giant-slayer', name: '巨人杀手', type: 'violet', mode: 'passive', uses: 0, desc: '首次购买4费和5费卡时，各优惠1金币。' },
    { id: 'photographer', name: '摄影艺术家', type: 'violet', mode: 'passive', uses: 0, desc: '每轮拥有多一次免费刷新商店，刷新不累计。' },
    { id: 'wise-benevolence', name: '贤者的博爱', type: 'violet', mode: 'passive', uses: 0, desc: '每个你的选人阶段，获得+n金币和+1可累计刷新次数，n为当前轮数。' },
    { id: 'decompose-knowledge', name: '知识来源于分解', type: 'violet', mode: 'manual', uses: 0, needsTarget: 'player', desc: '每个你的选人阶段获得1层解构，最多3层；满3层后可消耗全部层数自选高费选手，金币不足时可分解队内2/3费队员抵扣。' },
    { id: 'stuck-together', name: '和我困在一起', type: 'violet', mode: 'manual', uses: 1, needsTarget: 'player', desc: '指定一名同阵营可选选手。若到你的下一轮选人开始时该选手仍在卡池，直接加入你的队伍并消耗本轮购买权。' },
    { id: 'storm-fog', name: '骤雨 血雾 清风', type: 'violet', mode: 'manual', uses: 1, needsTarget: 'captain', desc: '选择一位队长，该队长以及接下来的两位队长商店进入天气迷雾状态；不影响使用者，自动跳过使用者顺延。' },
  ];

  Hexcore2.sampleData = {
    captains: [],
    players: [],
    hexcoreAssignments: {},
    hexcores,
  };
})(window);
