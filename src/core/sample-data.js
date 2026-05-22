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

  const lanes = ['上路', '打野', '中路', '下路', '辅助'];
  const localNames = [
    '林间石', '薄雾铃', '晨星桥', '北风盾', '墨雨刀',
    '白露弦', '长夜渡', '青灯客', '雪岸声', '折月人',
    '云外之人', '风缝蝶', '夜雨声烦', '青山隐', '林深见鹿',
    '南枝雪', '孤月', '星坠', '赤锋', '雪烛',
    '雾刃', '白昼弦', '流光盾', '寒江火', '竹影归',
  ];
  const outsiderNames = [
    '霜叶落', '听潮生', '暮云开', '星河远', '轻舟客',
    '折竹风', '山海尽', '落星河', '问剑人', '映雪白',
    '千灯夜', '听雨眠', '孤帆影', '白沙洲', '秋水长',
    '雁回时', '燃灯者', '断虹声', '苍岚', '归棹',
    '无声雪', '破晓刃', '渡鸦', '眠山客', '星火',
  ];

  function seasonResults(score, index) {
    const labels = score >= 92
      ? ['冠军', '亚军', '4强', '冠军', 'FMVP', '冠军']
      : score >= 82
        ? ['4强', '亚军', '1轮游', '4强', '亚军', '4强']
        : score >= 70
          ? ['1轮游', '4强', '未参赛', '4强', '1轮游', '亚军']
          : ['未参赛', '1轮游', '未参赛', '1轮游', '未参赛', '4强'];
    return labels.reduce((result, value, offset) => {
      result[`s${offset + 1}`] = labels[(offset + index) % labels.length];
      return result;
    }, {});
  }

  function buildPlayers(names, camp, startIndex, scoreBase) {
    return names.map((name, index) => {
      const number = startIndex + index;
      const score = scoreBase - index;
      const fmvp = index < 2 ? [`S${index + 1}`] : [];
      return {
        id: `p${String(number).padStart(3, '0')}`,
        name,
        camp,
        lane: lanes[index % lanes.length],
        gameId: `${camp === 'local' ? 'LOCAL' : 'OUT'}_${String(index + 1).padStart(2, '0')}`,
        score,
        tier: 1,
        kda: (2.0 + (index % 5) * 0.4).toFixed(1),
        damage: `${8 + (index % 9)}.${index % 10}K`,
        winRate: `${45 + (index % 12)}%`,
        heroes: ['奥恩', '蔚', '发条', '霞', '洛'].slice(index % 3, index % 3 + 3),
        manifesto: camp === 'local' ? '本地人阵营参赛选手' : '外地人阵营参赛选手',
        status: 'available',
        seasonResults: seasonResults(score, index),
        fmvpSeasons: fmvp,
        isFmvp: Boolean(fmvp.length),
      };
    });
  }

  const players = [
    ...buildPlayers(localNames, 'local', 1, 100),
    ...buildPlayers(outsiderNames, 'outsider', 26, 100),
  ];

  const captainPlayerIds = ['p001', 'p002', 'p003', 'p004', 'p005', 'p026', 'p027', 'p028', 'p029', 'p030'];
  const captains = captainPlayerIds.map((playerId, index) => {
    const player = players.find(item => item.id === playerId);
    return {
      id: `c${index + 1}`,
      name: `C${index + 1} ${player.name}`,
      record: player.camp === 'local' ? '本地队长' : '外地队长',
      team: [],
      playerId: player.id,
      playerGameId: player.gameId,
    };
  });

  function take(...ids) {
    return ids
      .map(id => hexcores.find(hexcore => hexcore.id === id))
      .filter(Boolean)
      .map(hexcore => ({ ...hexcore, status: hexcore.mode === 'passive' ? 'passive' : 'available' }));
  }

  Hexcore2.sampleData = {
    captains,
    players,
    hexcoreAssignments: {
      c1: take('camp-scout', 'discount-coupon', 'budget-refund'),
      c2: take('directed-recruit', 'reserved-seat', 'order-overtake'),
      c3: take('urgent-restock', 'camp-blockade', 'steady-reinforce'),
      c4: take('price-interference', 'camp-scout', 'budget-refund'),
      c5: take('reserved-seat', 'urgent-restock', 'discount-coupon'),
      c6: take('camp-scout', 'camp-blockade', 'budget-refund'),
      c7: take('directed-recruit', 'price-interference', 'order-overtake'),
      c8: take('reserved-seat', 'steady-reinforce', 'discount-coupon'),
      c9: take('urgent-restock', 'camp-scout', 'budget-refund'),
      c10: take('camp-blockade', 'price-interference', 'order-overtake'),
    },
    hexcores,
  };
})(window);
