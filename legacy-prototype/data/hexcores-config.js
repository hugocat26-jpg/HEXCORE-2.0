// hexcore2.0/src/data/hexcores-config.js
export const HEXCORES = [
  // ========== 质变系列 ==========
  {
    id: 1,
    name: '质变：青铜阶',
    icon: '🟤',
    rarity: 'silver',
    desc: '跳过侏儒马池，直接从中等马池盲抽1人',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      effect: { action: 'skip_pool', params: { skipPool: 1, targetPool: 2 } }
    }
  },
  {
    id: 2,
    name: '质变：黄金阶',
    icon: '🟡',
    rarity: 'gold',
    desc: '跳过侏儒马池，直接从上等马池盲抽1人',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      effect: { action: 'skip_pool', params: { skipPool: 1, targetPool: 3 } }
    }
  },
  {
    id: 3,
    name: '巨人杀手',
    icon: '⚔️',
    rarity: 'prismatic',
    desc: '本轮侏儒↔猛犸池互换',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      effect: { action: 'swap_pool_tiers', params: { tier1: 1, tier2: 4 } }
    }
  },
  {
    id: 4,
    name: '优中选优',
    icon: '⭐',
    rarity: 'gold',
    desc: '抽上等马时自动激活，额外抽1人二选一',
    script: {
      trigger: 'auto',
      when: { pool: 3 },
      maxUses: 1,
      effect: { action: 'extra_pick', params: { pool: 3, count: 2, chooseOne: true } }
    }
  },
  {
    id: 5,
    name: '稳扎稳打',
    icon: '🛡️',
    rarity: 'gold',
    desc: '跳过本轮，本轮结束时从本池随机分配1人',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      effect: { action: 'skip_and_random_fill', params: {} }
    }
  },
  {
    id: 6,
    name: '双发快射',
    icon: '🔫',
    rarity: 'gold',
    desc: '当前+下一池各1人，跳过下轮，第3轮顺位-1',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3],
      maxUses: 1,
      effect: { action: 'double_shot', params: {} }
    }
  },
  {
    id: 7,
    name: '背水一战',
    icon: '🔥',
    rarity: 'prismatic',
    desc: '放弃1、2轮，第4轮必第1顺+猛犸自选',
    script: {
      trigger: 'manual',
      rounds: [1],
      maxUses: 1,
      effect: { action: 'last_stand', params: {} }
    }
  },
  // ID 8 已删除
  {
    id: 9,
    name: '锁定契约',
    icon: '⛓️',
    rarity: 'prismatic',
    desc: '绑定2人，选1得另1，满4人跳过',
    script: {
      trigger: 'round_start_ask',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      effect: { action: 'bind_pair', params: {} }
    }
  },
  {
    id: 10,
    name: '潘多拉魔盒',
    icon: '📦',
    rarity: 'prismatic',
    desc: '固定第3顺，系统随机分配，禁用自主选人',
    script: {
      trigger: 'immediate',
      maxUses: 1,
      effect: { action: 'fixed_position_3', params: {} }
    }
  },
  {
    id: 11,
    name: '舞会女王',
    icon: '👑',
    rarity: 'prismatic',
    desc: '持有者池顺序颠倒',
    script: {
      trigger: 'immediate',
      maxUses: 1,
      effect: { action: 'reverse_pool_order', params: {} }
    }
  },
  {
    id: 12,
    name: '地狱三头犬',
    icon: '🐕',
    rarity: 'prismatic',
    desc: '第1轮连续3轮自选(侏儒→中等→上等)',
    script: {
      trigger: 'manual',
      rounds: [1],
      maxUses: 1,
      effect: { action: 'triple_pick', params: {} }
    }
  },
  {
    id: 13,
    name: '恶魔契约',
    icon: '😈',
    rarity: 'prismatic',
    desc: '1-3轮第1顺，第4轮最后',
    script: {
      trigger: 'immediate',
      maxUses: 1,
      effect: { action: 'devil_contract', params: {} }
    }
  },
  {
    id: 14,
    name: '知识来源于分解',
    icon: '📚',
    rarity: 'prismatic',
    desc: '分析已有选手，显示历史战绩和战力顺位',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      condition: { hasPlayers: true },
      effect: { action: 'reveal_stats', params: {} }
    }
  },
  {
    id: 15,
    name: '雪定饿的喵',
    icon: '🐱',
    rarity: 'prismatic',
    desc: '抽最高+最低，随机互换，选后揭晓',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3, 4],
      maxUses: 0, // 每轮可用
      effect: { action: 'swap_reveal', params: {} }
    }
  },
  {
    id: 16,
    name: '神秘贤者·启元',
    icon: '🔮',
    rarity: 'prismatic',
    desc: '每轮询问，第N个使用者得第N顺位',
    script: {
      trigger: 'round_start_ask',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      effect: { action: 'priority_position', params: {} }
    }
  },
  {
    id: 17,
    name: '神秘贤者·盲盒',
    icon: '🎁',
    rarity: 'prismatic',
    desc: '可抽已选中，选走别人时那人入你队',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      effect: { action: 'steal_player', params: {} }
    }
  },
  {
    id: 18,
    name: '开饭啦',
    icon: '🍽️',
    rarity: 'prismatic',
    desc: '无视顺位，自选当前池任意1人',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      effect: { action: 'ignore_position', params: {} }
    }
  },
  {
    id: 19,
    name: '摄影艺术家',
    icon: '📷',
    rarity: 'prismatic',
    desc: '本轮与下轮池互换，1/2/3轮可用',
    script: {
      trigger: 'round_start_ask',
      rounds: [1, 2, 3],
      maxUses: 1,
      effect: { action: 'swap_current_next_pool', params: {} }
    }
  },
  {
    id: 20,
    name: '质变：棱彩阶',
    icon: '🟣',
    rarity: 'prismatic',
    desc: '跳过侏儒马池，直接从猛犸池盲抽1人',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      effect: { action: 'skip_pool', params: { skipPool: 1, targetPool: 4 } }
    }
  },
  {
    id: 21,
    name: '顺位互换',
    icon: '🔄',
    rarity: 'prismatic',
    desc: '任意2队长顺位互换',
    script: {
      trigger: 'manual',
      rounds: [1, 2, 3, 4],
      maxUses: 1,
      effect: { action: 'swap_positions', params: {} }
    }
  },
  {
    id: 22,
    name: '致盲吹箭',
    icon: '🎯',
    rarity: 'prismatic',
    desc: '选择目标队长，被致盲过的不再被选',
    script: {
      trigger: 'round_start_ask',
      rounds: [1, 2, 3, 4],
      maxUses: 0, // 每轮可用
      effect: { action: 'blind_target', params: {} }
    }
  },
];

export const RARITY_COLORS = {
  silver: '#c0c0c0',
  gold: '#ffd700',
  prismatic: '#e040fb'
};

export const TIER_NAMES = { 1: '侏儒马', 2: '中等马', 3: '上等马', 4: '猛犸' };
export const TIER_COLORS = { 1: '#8b8b8b', 2: '#4caf50', 3: '#2196f3', 4: '#ffc107' };
