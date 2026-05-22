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

const implementationDoc = 'docs/14_阵营锁定10队金币商店模式_实施规范.md';
const hookDoc = 'docs/15_阵营锁定实施循环钩子.md';

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

function assertRequiredFiles() {
  const requiredFiles = [
    implementationDoc,
    hookDoc,
    'AGENTS.md',
    'scripts/regression.js',
    'package.json',
  ];
  const missing = requiredFiles.filter(file => !hasFile(file));
  if (missing.length) {
    console.error(`阵营锁定循环钩子缺少必要文件：${missing.join(', ')}`);
    process.exit(1);
  }
}

function assertPackageScripts() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!packageJson.scripts || !packageJson.scripts.test) {
    console.error('package.json 缺少 test 脚本，无法执行本地门禁');
    process.exit(1);
  }
}

function main() {
  if (!validStatus.has(status)) {
    console.error('status 只能是 complete 或 incomplete');
    process.exit(1);
  }

  assertRequiredFiles();
  assertPackageScripts();

  const gitStatus = run('git', ['status', '--short']);
  const branch = run('git', ['branch', '--show-current']) || '(detached)';

  console.log('HEXCORE2.0 阵营锁定实施循环钩子');
  console.log(`实施文档：${implementationDoc}`);
  console.log(`循环状态：${status === 'complete' ? '全部计划已完成' : '仍有计划未完成'}`);
  console.log(`当前分支：${branch}`);
  console.log(`测试入口：npm test`);
  console.log(`工作树：${gitStatus ? '存在改动' : '无本地改动'}`);

  if (gitStatus) {
    console.log('');
    console.log(gitStatus);
  }

  console.log('');
  console.log('固定执行顺序：');
  console.log(`1. 读取 ${implementationDoc}`);
  console.log('2. 加载 Build Web Apps 技能，按文档推荐执行顺序继续实施');
  console.log('3. 执行完一个阶段后运行 npm test 与 git diff --check');
  console.log('4. 使用 Codex Security 审查本轮代码并修复成立问题');
  console.log(`5. 重新读取 ${implementationDoc} 判断是否全部完成`);

  console.log('');
  if (status === 'complete') {
    console.log('下一步：计划已完成。必须使用 Codex Security 与 Build Web Apps 联合审查代码，修复问题，更新实施文档和执行记录，通过门禁后提交并推送 Gitee。');
  } else {
    console.log('下一步：计划未完成。必须继续加载 Build Web Apps 技能，按 14 号文档下一项计划实施；完成后重复本循环。');
  }
}

main();
