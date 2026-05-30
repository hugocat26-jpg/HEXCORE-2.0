const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const validStatus = new Set(['complete', 'incomplete']);
const defaultMaxIncompleteAttempts = 5;

function parseArgs(argv) {
  return new Map(argv.map(arg => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=') || 'true'];
  }));
}

function boolArg(args, key, fallback = false) {
  if (!args.has(key)) return fallback;
  return ['1', 'true', 'yes', 'y'].includes(String(args.get(key)).toLowerCase());
}

function positiveIntegerArg(args, keys, fallback) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  const key = keyList.find(item => args.has(item));
  const rawValue = key ? args.get(key) : process.env.POST_TASK_MAX_ATTEMPTS;
  if (rawValue === undefined || rawValue === '') return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${key || 'POST_TASK_MAX_ATTEMPTS'} 必须是大于0的整数`);
  }
  return value;
}

function resolveInsideRoot(relativePath) {
  const target = path.resolve(root, relativePath || '');
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`任务文档必须位于项目目录内：${relativePath}`);
  }
  return target;
}

function resolveStateFile(filePath) {
  if (!filePath) {
    return path.join(os.tmpdir(), 'hexcore2-post-task-loop-state.json');
  }
  const target = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  const allowedRoots = [root, os.tmpdir()].map(item => path.resolve(item));
  const insideAllowedRoot = allowedRoots.some(allowedRoot => {
    const relative = path.relative(allowedRoot, target);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (!insideAllowedRoot) {
    throw new Error(`循环状态文件必须位于项目目录或系统临时目录内：${filePath}`);
  }
  return target;
}

function run(command, commandArgs) {
  const isWindowsNpm = process.platform === 'win32' && command === 'npm';
  const executable = isWindowsNpm ? 'cmd.exe' : command;
  const args = isWindowsNpm ? ['/c', command, ...commandArgs] : commandArgs;
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error || '').trim(),
    label: [command, ...commandArgs].join(' '),
  };
}

function printCommandResult(result) {
  console.log(`- ${result.ok ? '通过' : '失败'}：${result.label}`);
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.log(result.stderr);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readLoopState(stateFile) {
  if (!fs.existsSync(stateFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (error) {
    return {};
  }
}

function writeLoopState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function updateLoopRetryState({ analysis, status, maxAttempts, stateFile, shouldTrack }) {
  const state = readLoopState(stateFile);
  const key = `${root}|${analysis.docRelativePath}`;
  const current = state[key] || { incompleteAttempts: 0 };

  if (!shouldTrack) {
    return { attempts: current.incompleteAttempts || 0, maxAttempts, exceeded: false, tracked: false };
  }

  if (status === 'complete') {
    delete state[key];
    writeLoopState(stateFile, state);
    return { attempts: 0, maxAttempts, exceeded: false, tracked: true, reset: true };
  }

  const attempts = (current.incompleteAttempts || 0) + 1;
  state[key] = {
    incompleteAttempts: attempts,
    maxAttempts,
    taskDoc: analysis.docRelativePath,
    updatedAt: new Date().toISOString(),
  };
  writeLoopState(stateFile, state);
  return { attempts, maxAttempts, exceeded: attempts > maxAttempts, tracked: true };
}

function headingLevel(line) {
  const match = line.match(/^(#{1,6})\s+/);
  return match ? match[1].length : 0;
}

function extractSection(lines, titlePattern) {
  const start = lines.findIndex(line => /^#{1,6}\s+/.test(line) && titlePattern.test(line));
  if (start < 0) return [];
  const level = headingLevel(lines[start]);
  const end = lines.findIndex((line, index) => index > start && headingLevel(line) > 0 && headingLevel(line) <= level);
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

function collectListItems(lines, limit = 16) {
  const items = [];
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    const text = bullet ? bullet[1] : (ordered ? ordered[1] : '');
    if (text) items.push(text.trim());
    if (items.length >= limit) break;
  }
  return items;
}

function collectCheckboxes(lines) {
  return lines.map((line, index) => {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (!match) return null;
    return {
      line: index + 1,
      checked: match[1].toLowerCase() === 'x',
      text: match[2].trim(),
    };
  }).filter(Boolean);
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function markdownTableCells(line) {
  const text = line.trim();
  if (!text.startsWith('|') || !text.endsWith('|')) return null;
  return text.slice(1, -1).split('|').map(cell => stripMarkdown(cell));
}

function isMarkdownTableSeparator(cells) {
  return Boolean(cells && cells.length && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim())));
}

function nearestHeading(lines, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const match = lines[cursor].match(/^(#{1,6})\s+(.*)$/);
    if (match) return stripMarkdown(match[2]);
  }
  return '';
}

function normalizeStatus(status) {
  return stripMarkdown(status).replace(/\s+/g, '');
}

function isDoneLikeStatus(status) {
  const value = normalizeStatus(status);
  if (!value) return false;
  if (/未完成|待完成|尚未完成|待处理|待验证|待修复|失败|阻断|进行中|TODO|FIXME/i.test(value)) return false;
  return /^(已完成|完成|已验证|通过|已通过|当前固定|固定|无需处理|不适用|已删除|不进入默认池)$/.test(value);
}

function isOpenLikeStatus(status) {
  const value = normalizeStatus(status);
  if (!value) return true;
  if (isDoneLikeStatus(value)) return false;
  return true;
}

function collectOpenTableRows(lines) {
  const rows = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = markdownTableCells(lines[index]);
    const separator = markdownTableCells(lines[index + 1]);
    if (!header || !isMarkdownTableSeparator(separator)) continue;

    const statusIndex = header.findIndex(cell => /^(状态|完成状态|进度|优先级)$/.test(cell));
    if (statusIndex < 0) continue;

    const section = nearestHeading(lines, index);
    for (let cursor = index + 2; cursor < lines.length; cursor += 1) {
      const cells = markdownTableCells(lines[cursor]);
      if (!cells) break;
      const status = cells[statusIndex] || '';
      if (!isOpenLikeStatus(status)) continue;
      const primary = cells.find((cell, cellIndex) => cellIndex !== statusIndex && cell) || cells[0] || '(未命名项)';
      rows.push({
        line: cursor + 1,
        section,
        primary,
        status,
        header,
        cells,
      });
    }
    index += 1;
  }
  return rows.slice(0, 24);
}

function collectAfterLabel(lines, labelPattern, limit = 16) {
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const label = lines[index].match(labelPattern);
    if (label && label[1]) {
      items.push(label[1].trim());
    }
    if (!label) continue;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (/^#{1,6}\s+/.test(line) || /^\S.*[:：]\s*$/.test(line)) break;
      collectListItems([line], 1).forEach(item => items.push(item));
      if (items.length >= limit) return items;
    }
  }
  return items.slice(0, limit);
}

function collectBlockers(lines) {
  const blockers = [];
  const blockerSection = extractSection(lines, /环境阻断|阻断|待处理|未完成/);
  collectListItems(blockerSection, 12).forEach(item => blockers.push(item));
  return blockers.slice(0, 16);
}

function collectOpenPlanSignals(lines) {
  const signals = [];
  const patterns = [
    /TODO|FIXME|待处理|待完成|尚未完成|未完成|未实现|待验证|待修复|未通过|失败[:：]|门禁失败|阻断[:：]|等待用户/i,
    /下一步[:：]|剩余[:：]/,
  ];
  let inCodeBlock = false;
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) return;
    const text = line.trim();
    if (!text || /^#{1,6}\s+/.test(text)) return;
    if (/不应.*(未完成|失败|阻断|待处理|待验证|待修复)/.test(text)) return;
    if (patterns.some(pattern => pattern.test(text))) {
      signals.push({ line: index + 1, text: text.slice(0, 180) });
    }
  });
  return signals.slice(0, 24);
}

function summarizeOpenTableRow(row) {
  const section = row.section ? `${row.section} / ` : '';
  return `L${row.line}: ${section}${row.primary}（状态：${row.status || '空'}）`;
}

function collectNextActions(analysis, limit = 8) {
  const actions = [];
  analysis.unchecked.slice(0, 4).forEach(item => {
    actions.push(`完成未勾选清单 L${item.line}：${item.text}`);
  });
  analysis.openTableRows.slice(0, 6).forEach(row => {
    actions.push(`推进表格计划项：${summarizeOpenTableRow(row)}`);
  });
  analysis.blockers.slice(0, 4).forEach(item => {
    actions.push(`处理阻断/待处理线索：${item}`);
  });
  analysis.openPlanSignals.slice(0, 4).forEach(item => {
    actions.push(`核对严格计划线索 L${item.line}：${item.text}`);
  });
  if (!actions.length) {
    actions.push('任务文档未发现机械阻断项；若本轮必要验证已闭环，可申请 complete，并按改动风险决定是否追加安全或浏览器审查。');
  }
  return actions.slice(0, limit);
}

function parseGitChangedFiles(statusOutput) {
  return String(statusOutput || '').split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^.{1,3}\s+/, '').replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function inferSkillHints({ analysis, changedFiles }) {
  const joined = [
    ...analysis.nextActions,
    ...analysis.openPlanSignals.map(item => item.text),
    ...changedFiles,
  ].join('\n');
  const hints = [];
  const hasFrontendFiles = changedFiles.some(file => /^(index\.html|src[\\/](ui|styles)|src[\\/]main\.js)|\.css$/.test(file));
  const hasCodeFiles = changedFiles.some(file => /\.(js|html|css)$/.test(file));
  const hasSecuritySensitiveFiles = changedFiles.some(file =>
    /^package(-lock)?\.json$/.test(file)
    || /^scripts[\\/]serve\.js$/.test(file)
    || /^src[\\/](services|core|engines)[\\/]/.test(file)
  );
  const hasSecurityKeywords = /安全|导入|导出|状态|本地存储|路径|XSS|权限|删除|重置|覆盖|命令|依赖|token|鉴权/.test(joined);
  if (hasFrontendFiles || /UI|界面|浏览器|交互|布局|视觉|按钮|样式|响应式/.test(joined)) {
    hints.push('前端/交互相关：只有实际改动渲染、布局或关键交互时，使用 build-web-apps:frontend-testing-debugging 和内置 Browser 验证。');
  }
  if (hasSecuritySensitiveFiles || hasSecurityKeywords) {
    hints.push('安全敏感改动：涉及导入/导出、本地存储、静态服务、状态归一化、删除重置、依赖或命令执行时，再使用 Codex Security 做差异范围审查。');
  } else if (hasCodeFiles) {
    hints.push('普通代码改动：优先本地门禁和针对性自查；不需要默认追加 Codex Security 全量审查。');
  }
  if (!hints.length) {
    hints.push('当前更像文档/流程整理：跑必要门禁即可；若准备推送，确认未包含无关未跟踪文件。');
  }
  return hints;
}

function printItems(title, items) {
  console.log('');
  console.log(title);
  if (!items.length) {
    console.log('- 未在任务文档中提取到明确条目');
    return;
  }
  items.forEach(item => console.log(`- ${item}`));
}

function analyzeTaskDoc(docRelativePath) {
  const docPath = resolveInsideRoot(docRelativePath);
  if (!fs.existsSync(docPath)) {
    throw new Error(`任务文档不存在：${docRelativePath}`);
  }

  const text = fs.readFileSync(docPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const checkboxes = collectCheckboxes(lines);
  const sectionGoals = collectListItems(extractSection(lines, /目标|实施目标/), 12);
  const sectionAcceptance = collectListItems(extractSection(lines, /验收标准|验收|完成定义/), 18);
  const analysis = {
    docPath,
    docRelativePath: path.relative(root, docPath),
    goals: sectionGoals.length ? sectionGoals : collectAfterLabel(lines, /^\s*目标[:：]\s*(.*)$/).slice(0, 12),
    forbidden: collectListItems(extractSection(lines, /禁止事项|禁止|约束/), 12),
    acceptance: sectionAcceptance.length ? sectionAcceptance : collectAfterLabel(lines, /^\s*验收[:：]\s*(.*)$/).slice(0, 18),
    order: collectListItems(extractSection(lines, /推荐执行顺序|固定循环|标准流程/), 18),
    statusItems: collectListItems(extractSection(lines, /当前实施状态|已完成|已验证/), 18),
    checkboxes,
    unchecked: checkboxes.filter(item => !item.checked),
    openTableRows: collectOpenTableRows(lines),
    blockers: collectBlockers(lines),
    openPlanSignals: collectOpenPlanSignals(lines),
  };
  analysis.nextActions = collectNextActions(analysis);
  return analysis;
}

function runLocalGates(skipGates) {
  if (skipGates) return [];
  const packageJson = readJson('package.json');
  if (!packageJson.scripts || !packageJson.scripts.test) {
    throw new Error('package.json 缺少 test 脚本，无法执行本地门禁');
  }

  return [
    run('npm', ['test']),
    run('git', ['diff', '--check']),
  ];
}

function runTaskLoop(options = {}) {
  const args = options.args || parseArgs(process.argv.slice(2));
  const status = args.get('status') || options.status || 'incomplete';
  if (!validStatus.has(status)) {
    throw new Error('status 只能是 complete 或 incomplete');
  }

  const taskDoc = args.get('doc') || args.get('task') || options.defaultDoc || 'docs/planning/当前待开发计划.md';
  const title = args.get('title') || options.title || 'HEXCORE2.0 任务执行循环钩子';
  const skipGates = boolArg(args, 'skip-gates', false);
  const maxAttempts = positiveIntegerArg(args, ['max-attempts', 'max-incomplete-runs'], defaultMaxIncompleteAttempts);
  const stateFile = resolveStateFile(args.get('state-file'));
  if (status === 'complete' && skipGates) {
    throw new Error('status=complete 时不允许使用 --skip-gates=true，完成判定必须经过本地门禁');
  }
  const analysis = analyzeTaskDoc(taskDoc);
  const gitStatus = run('git', ['status', '--short']);
  const branch = run('git', ['branch', '--show-current']);
  const changedFiles = parseGitChangedFiles(gitStatus.stdout);
  const skillHints = inferSkillHints({ analysis, changedFiles });
  const gateResults = runLocalGates(skipGates);
  const gateFailed = gateResults.some(result => !result.ok);

  console.log(title);
  console.log(`任务文档：${analysis.docRelativePath}`);
  console.log(`计划状态：${status === 'complete' ? '申请完成' : '继续推进'}`);
  console.log(`当前分支：${branch.stdout || '(detached)'}`);
  console.log(`工作树：${gitStatus.stdout ? '存在改动' : '无本地改动'}`);
  if (gitStatus.stdout) {
    console.log('');
    console.log(gitStatus.stdout);
  }

  printItems('目标摘要', analysis.goals);
  printItems('禁止/约束摘要', analysis.forbidden);
  printItems('验收/完成标准', analysis.acceptance);
  printItems('推荐执行顺序', analysis.order);
  printItems('当前状态线索', analysis.statusItems);
  printItems('下一步建议', analysis.nextActions);
  printItems('技能/验证提示', skillHints);

  console.log('');
  console.log('本地门禁');
  if (skipGates) {
    console.log('- 已按参数跳过本地门禁');
  } else {
    gateResults.forEach(printCommandResult);
  }

  if (analysis.unchecked.length) {
    console.log('');
    console.log('未勾选清单');
    analysis.unchecked.slice(0, 16).forEach(item => console.log(`- L${item.line}: ${item.text}`));
  }

  if (analysis.openTableRows.length) {
    console.log('');
    console.log('未完成表格项');
    analysis.openTableRows.slice(0, 16).forEach(item => console.log(`- ${summarizeOpenTableRow(item)}`));
  }

  if (analysis.blockers.length) {
    console.log('');
    console.log('阻断/待处理线索');
    analysis.blockers.forEach(item => console.log(`- ${item}`));
  }

  if (analysis.openPlanSignals.length) {
    console.log('');
    console.log('严格计划线索');
    analysis.openPlanSignals.forEach(item => console.log(`- L${item.line}: ${item.text}`));
  }

  const hasOpenPlanWork = analysis.unchecked.length || analysis.openTableRows.length || analysis.blockers.length || analysis.openPlanSignals.length;
  const completeBlocked = status === 'complete' && hasOpenPlanWork;
  const retryState = updateLoopRetryState({
    analysis,
    status,
    maxAttempts,
    stateFile,
    shouldTrack: status === 'incomplete' || (!gateFailed && !completeBlocked),
  });
  const retryLimitExceeded = status === 'incomplete' && retryState.exceeded;
  console.log('');
  console.log('循环重试上限');
  if (retryState.tracked && status === 'incomplete') {
    console.log(`- 当前连续 incomplete 次数：${retryState.attempts}/${retryState.maxAttempts}`);
  } else if (retryState.reset) {
    console.log('- complete 门禁通过后已清零当前任务文档的 incomplete 计数');
  } else {
    console.log(`- 当前计数未更新，允许上限：${retryState.maxAttempts} 次`);
  }

  console.log('');
  if (gateFailed) {
    console.log('结论：本地门禁未通过。请先修复测试或空白错误，再继续执行任务文档。');
    process.exitCode = 1;
  } else if (completeBlocked) {
    console.log('结论：当前不允许标记 complete。请先处理失败门禁、未勾选清单、阻断线索或严格计划线索，再重新运行。');
    process.exitCode = 1;
  } else if (retryLimitExceeded) {
    console.log(`结论：已超过 incomplete 循环上限 ${retryState.maxAttempts} 次。请停止自动重试，先汇总剩余问题并等待用户确认后再继续。`);
    process.exitCode = 1;
  } else if (status === 'complete') {
    console.log('结论：机械门禁通过。下一步按改动风险决定是否追加审查；低风险文档、样式或钩子整理不需要冗余全量安全扫描。');
  } else {
    console.log(`结论：计划未完成，必须继续按任务文档推进下一项；当前仍在允许重试次数内。完成一个阶段后再次运行本循环，最多连续 ${retryState.maxAttempts} 次 incomplete。`);
  }

  return { analysis, gateResults, completeBlocked, retryState, retryLimitExceeded };
}

if (require.main === module) {
  try {
    runTaskLoop();
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  analyzeTaskDoc,
  runTaskLoop,
};
