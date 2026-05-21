const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=') || 'true'];
}));

const status = args.get('status') || 'incomplete';
const validStatus = new Set(['complete', 'incomplete']);

function run(command, commandArgs) {
  return execFileSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function hasFile(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function main() {
  if (!validStatus.has(status)) {
    console.error('status 只能是 complete 或 incomplete');
    process.exit(1);
  }

  const requiredFiles = [
    'docs/06_开发计划.md',
    'docs/12_任务后置钩子.md',
    'scripts/regression.js',
    'package.json',
  ];
  const missing = requiredFiles.filter(file => !hasFile(file));
  if (missing.length) {
    console.error(`后置钩子缺少必要文件：${missing.join(', ')}`);
    process.exit(1);
  }

  const gitStatus = run('git', ['status', '--short']);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const hasTestScript = Boolean(packageJson.scripts && packageJson.scripts.test);

  if (!hasTestScript) {
    console.error('package.json 缺少 test 脚本，无法执行后置门禁');
    process.exit(1);
  }

  console.log('HEXCORE2.0 任务后置钩子');
  console.log(`计划状态：${status === 'complete' ? '已完成' : '未完成'}`);
  console.log(`测试入口：npm test`);
  console.log(`工作树：${gitStatus ? '存在改动' : '无本地改动'}`);

  if (gitStatus) {
    console.log('');
    console.log(gitStatus);
  }

  console.log('');
  if (status === 'complete') {
    console.log('下一步：使用 Codex Security 技能执行全量代码审查；修复并验证后，再按改动规模决定是否提交并推送 Gitee。');
  } else {
    console.log('下一步：继续执行开发计划；UI/交互任务使用 Build Web Apps 流程，较大改动后使用 Codex Security 审查并修复。');
  }
}

main();
