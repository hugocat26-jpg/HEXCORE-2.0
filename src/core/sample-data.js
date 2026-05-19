(function initSampleData(global) {
  const Hexcore2 = global.Hexcore2 || (global.Hexcore2 = {});

  Hexcore2.sampleData = {
    captains: [
      { id: 'c1', name: 'C1 夜阑', record: '1-1', team: ['p101', 'p102'] },
      { id: 'c2', name: 'C2 星海', record: '1-2', team: ['p103'] },
      { id: 'c3', name: 'C3 烬灭', record: '2-2', team: ['p104', 'p105', 'p106'] },
      { id: 'c4', name: 'C4 龙牙', record: '2-11', team: ['p107', 'p108'] },
      { id: 'c5', name: 'C5 无痕', record: '2-3', team: ['p109'] },
      { id: 'c6', name: 'C6 孤城', record: '2-10', team: ['p110', 'p111'] },
      { id: 'c7', name: 'C7 神秘贤者', record: '当前', team: [] },
      { id: 'c8', name: 'C8 凌云', record: '待定', team: [] },
      { id: 'c9', name: 'C9 破晓', record: '待定', team: [] },
      { id: 'c10', name: 'C10 幻影', record: '待定', team: [] },
      { id: 'c11', name: 'C11 锋芒', record: '待定', team: [] },
      { id: 'c12', name: 'C12 逐风', record: '待定', team: [] },
    ],

    players: [
      { id: 'p201', lane: '上路', name: '青山隐', gameId: 'QS_Yin', score: 78, tier: 2, kda: '2.6', damage: '12.4K', winRate: '40%', heroes: ['影', '猎', '炮'], status: 'available' },
      { id: 'p202', lane: '打野', name: '林深见鹿', gameId: 'LS_Deer', score: 85, tier: 2, kda: '4.1', damage: '15.8K', winRate: '60%', heroes: ['霜', '刃', '巫'], status: 'available' },
      { id: 'p203', lane: '中路', name: '云外之人', gameId: 'YW_ZhiRen', score: 72, tier: 2, kda: '2.3', damage: '10.7K', winRate: '40%', heroes: ['夜', '术', '金'], status: 'available' },
      { id: 'p204', lane: '下路', name: '夜雨声烦', gameId: 'YR_Fan', score: 81, tier: 2, kda: '3.7', damage: '14.2K', winRate: '55%', heroes: ['枪', '羽', '月'], status: 'available' },
      { id: 'p205', lane: '辅助', name: '风缝蝶吹', gameId: 'FF_Die', score: 69, tier: 2, kda: '2.9', damage: '8.1K', winRate: '48%', heroes: ['盾', '琴', '灵'], status: 'available' },
      { id: 'p301', lane: '上路', name: '赤锋', gameId: 'CF_Red', score: 91, tier: 3, kda: '3.9', damage: '17.6K', winRate: '64%', heroes: ['剑', '鳄', '武'], status: 'available' },
      { id: 'p302', lane: '中路', name: '雪烛', gameId: 'XZ_Light', score: 93, tier: 3, kda: '5.0', damage: '18.8K', winRate: '67%', heroes: ['球', '影', '沙'], status: 'available' },
      { id: 'p401', lane: '打野', name: '孤月', gameId: 'GY_Moon', score: 98, tier: 4, kda: '5.5', damage: '21.0K', winRate: '72%', heroes: ['盲', '破', '豹'], status: 'available' },
      { id: 'p402', lane: '下路', name: '星坠', gameId: 'XZ_Star', score: 96, tier: 4, kda: '4.8', damage: '22.4K', winRate: '70%', heroes: ['霞', '厄', '泽'], status: 'available' },
      { id: 'p101', lane: '上路', name: '已选一', gameId: 'Team_A', score: 60, tier: 1, status: 'drafted' },
      { id: 'p102', lane: '打野', name: '已选二', gameId: 'Team_B', score: 62, tier: 1, status: 'drafted' },
      { id: 'p103', lane: '辅助', name: '已选三', gameId: 'Team_C', score: 58, tier: 1, status: 'drafted' },
      { id: 'p104', lane: '中路', name: '已选四', gameId: 'Team_D', score: 77, tier: 2, status: 'drafted' },
      { id: 'p105', lane: '下路', name: '已选五', gameId: 'Team_E', score: 79, tier: 2, status: 'drafted' },
      { id: 'p106', lane: '辅助', name: '已选六', gameId: 'Team_F', score: 74, tier: 2, status: 'drafted' },
      { id: 'p107', lane: '上路', name: '已选七', gameId: 'Team_G', score: 86, tier: 3, status: 'drafted' },
      { id: 'p108', lane: '打野', name: '已选八', gameId: 'Team_H', score: 84, tier: 3, status: 'drafted' },
      { id: 'p109', lane: '中路', name: '已选九', gameId: 'Team_I', score: 65, tier: 1, status: 'drafted' },
      { id: 'p110', lane: '下路', name: '已选十', gameId: 'Team_J', score: 83, tier: 2, status: 'drafted' },
      { id: 'p111', lane: '辅助', name: '已选十一', gameId: 'Team_K', score: 71, tier: 2, status: 'drafted' },
    ],

    hexcores: [
      { id: 'origin', name: '启元', type: 'cyan', desc: '立刻获得本轮下一位优先顺位。', status: 'available', uses: 1 },
      { id: 'blind', name: '致盲吹箭', type: 'amber', desc: '指定下一位队长本轮抽卡致盲，选中后揭示。', status: 'available', uses: 1 },
      { id: 'double-shot', name: '双发快射', type: 'violet', desc: '本轮抽卡数量 +1，下一轮跳过。', status: 'available', uses: 1 },
    ],
  };
})(window);
