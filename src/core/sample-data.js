(function initSampleData(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});
  Hexcore2.meta = {
    product: 'HEXCORE 2.0',
    version: '2.0.10',
    releaseDate: '2026-05-27',
  };

  const hexcores = [
    { id: 'camp-scout', name: '阵营侦察', type: 'cyan', category: 'shop_control', tags: ['shop', 'camp'], mode: 'manual', uses: 1, desc: '开店前使用。下一次商店额外展示1张同阵营可抽卡，仍只能购买1人。' },
    { id: 'discount-coupon', name: '压价券', type: 'amber', category: 'shop_control', tags: ['shop', 'economy', 'discount'], mode: 'manual', uses: 1, desc: '购买前使用。本次购买费用-1，最低为1金币。' },
    { id: 'reserved-seat', name: '保留席位', type: 'cyan', category: 'shop_control', tags: ['shop', 'refresh'], mode: 'manual', uses: 1, needsTarget: 'shopCard', desc: '商店打开后选择1张卡。下次刷新商店时保留该卡。' },
    { id: 'urgent-restock', name: '加急调货', type: 'cyan', category: 'shop_control', tags: ['shop', 'replace'], mode: 'manual', uses: 1, needsTarget: 'shopCard', desc: '商店打开后选择1张卡，替换为同阵营、同费用、当前商店外的另一名可抽选手。' },
    { id: 'camp-blockade', name: '阵营封锁', type: 'violet', category: 'disruption', tags: ['target', 'shop'], mode: 'manual', uses: 1, needsTarget: 'captain', desc: '选择任意队长。目标下一次商店少1张，最低3张；若本轮已行动则下轮生效。' },
    { id: 'price-interference', name: '抬价干扰', type: 'violet', category: 'disruption', tags: ['target', 'economy'], mode: 'manual', uses: 1, needsTarget: 'captain', desc: '选择任意队长。目标下一次购买费用+1，无上限，卡牌显示醒目的+1标记。' },
    { id: 'steady-reinforce', name: '稳健补强', type: 'violet', category: 'roster_replace', tags: ['direct_roster', 'camp'], mode: 'manual', uses: 1, desc: '跳过购买前使用。第1-2轮至少2费，第3轮至少3费，第4轮至少4费；系统从符合条件的最低可用费用池随机分配1人，消耗本轮购买权。' },
    { id: 'donation', name: '捐赠', type: 'amber', category: 'economy', tags: ['gold', 'acquire'], mode: 'passive', uses: 0, desc: '获得时初始资金+2。' },
    { id: 'sponsor-flow', name: '赞助回流', type: 'amber', category: 'economy', tags: ['gold', 'refund'], mode: 'passive', uses: 0, desc: '每局2次。购买费用不低于3的选手后，返还1金币。' },
    { id: 'hungry-wave', name: '海浪，我没吃饭', type: 'violet', category: 'order_response', tags: ['round_start', 'steal', 'refund'], mode: 'passive', uses: 0, desc: '每轮开始随机1名持有者触发：失去全部金币并跳过本轮，免疫其他海克斯。本轮其他队长购买后按剩余机会判定；命中同阵营时夺取该队员，命中异阵营时仅退回该购买并返还金币、刷新和购买权，轮末按本轮概率从自己同阵营卡池随机获得1名队员。' },
    { id: 'last-stand', name: '背水一战', type: 'violet', category: 'roster_replace', tags: ['team_swap', 'direct_roster'], mode: 'manual', uses: 1, desc: '当前队伍已有4名队员后可发动。放弃当前4名队员，从本阵营非禁用、非队长、非当前4人的全场候选中随机获得4人；若抽中别队队员，该队从原4人中随机获得1人补偿，未补偿原队员回到可选池。' },
    { id: 'open-feast', name: '开饭啦', type: 'violet', category: 'economy', tags: ['gold', 'round_income'], mode: 'passive', uses: 0, desc: '第3轮开始时，资金+3。' },
    { id: 'vampiric-habit', name: '吸血习性', type: 'violet', category: 'disruption', tags: ['target', 'economy'], mode: 'manual', uses: 1, desc: '从当前金币余额最高的三名其他队长处每人获得1金币，金币为0的队长跳过。' },
    { id: 'giant-slayer', name: '巨人杀手', type: 'violet', category: 'economy', tags: ['discount', 'high_tier'], mode: 'passive', uses: 0, desc: '首次购买4费和5费卡时，各优惠1金币。' },
    { id: 'ballroom-queen', name: '舞会女王', type: 'violet', category: 'shop_control', tags: ['shop', 'high_tier'], mode: 'passive', uses: 0, desc: '本轮选人商店优先只抽3-5费卡；若同阵营3-5费不足以填满商店，则降级补足。' },
    { id: 'photographer', name: '摄影艺术家', type: 'violet', category: 'shop_control', tags: ['shop', 'refresh'], mode: 'passive', uses: 0, desc: '每轮拥有多一次免费刷新商店，刷新不累计。' },
    { id: 'wise-benevolence', name: '贤者的博爱', type: 'violet', category: 'economy', tags: ['gold', 'refresh'], mode: 'passive', uses: 0, desc: '每个你的选人阶段，获得+n金币和+1可累计刷新次数，n为当前轮数。' },
    { id: 'origin-sage', name: '神秘贤者·启元', type: 'violet', category: 'order_response', tags: ['order', 'economy'], mode: 'manual', uses: 0, maxUsesPerRound: 1, desc: '获得时初始资金+2；每轮开始自动提到第一顺位，原第一及后续顺延。' },
    { id: 'mystery-box', name: '神秘贤者·盲盒', type: 'violet', category: 'roster_replace', tags: ['random', 'direct_roster'], mode: 'manual', uses: 1, desc: '支付3金币，从同阵营2-5费可选选手中随机盲抽1人，消耗本轮购买权。' },
    { id: 'transmute-gold', name: '质变：黄金阶', type: 'amber', category: 'roster_replace', tags: ['direct_roster', 'tier4'], mode: 'manual', uses: 1, desc: '商店打开前免费发动，从同阵营4费可选池随机获得1人，消耗本轮购买权。' },
    { id: 'transmute-prismatic', name: '质变：棱彩阶', type: 'violet', category: 'roster_replace', tags: ['direct_roster', 'tier5'], mode: 'manual', uses: 1, desc: '商店打开前免费发动，从同阵营5费可选池随机获得1人，消耗本轮购买权。' },
    { id: 'decompose-knowledge', name: '知识来源于分解', type: 'violet', category: 'roster_replace', tags: ['target', 'economy', 'direct_roster'], mode: 'manual', uses: 0, needsTarget: 'player', desc: '每个你的选人阶段获得1层解构，最多3层；满3层后可消耗全部层数自选高费选手，金币不足时可分解队内2/3费队员抵扣。' },
    { id: 'stuck-together', name: '和我困在一起', type: 'violet', category: 'roster_replace', tags: ['target', 'delay', 'direct_roster'], mode: 'manual', uses: 1, needsTarget: 'player', desc: '从本阵营全池指定一名费用不高于当前上限且未入队的可选选手。若到你的下一轮选人开始时该选手仍在卡池，直接加入你的队伍并消耗本轮购买权；跨阵营目标不可选择。' },
    { id: 'storm-fog', name: '骤雨 血雾 清风', type: 'violet', category: 'disruption', tags: ['target', 'shop', 'weather'], mode: 'manual', uses: 1, needsTarget: 'captain', desc: '选择一位队长作为起点，按顺位环形向后影响最多3名仍有购买权且未满员的非使用者队长；不足3名时顺延到下一轮。刷新商店不会清除血雾。' },
    { id: 'snow-cat', name: '雪定饿的喵', type: 'violet', category: 'disruption', tags: ['target', 'shop', 'blind'], mode: 'manual', uses: 1, needsTarget: 'captain', desc: '对非自己的任意队长使用。目标下一次商店显示选手信息被打乱，费用不参与打乱，购买后才揭示真实选手并按真实卡位费用结算。' },
    { id: 'charged-cannon', name: '大炮已充能', type: 'violet', category: 'order_response', tags: ['target', 'order'], mode: 'manual', uses: 0, maxUsesPerRound: 1, needsTarget: 'captain', desc: '转换技。雷霆一击：选择一名未行动队长，使其本轮顺位延后一位；加速之门：将自己本轮顺位提升一位。每轮最多使用1次。' },
    { id: 'heavenly-descent', name: '神兵天降', type: 'violet', category: 'order_response', tags: ['response', 'steal', 'refund'], mode: 'manual', uses: 1, desc: '每局1次。其它队长刚确认购买后的10秒内可发动，但只能夺取同阵营选手；自己购买和跨阵营目标不可发动。成功时将该选手从原队伍移除，发动者未满员则入队并跳过下一轮选人，满员则回到卡池；原购买队长返还金币和购买权，不返还刷新次数。' },
  ];

  Hexcore2.sampleData = {
    captains: [],
    players: [],
    hexcoreAssignments: {},
    hexcores,
  };
})(window);
