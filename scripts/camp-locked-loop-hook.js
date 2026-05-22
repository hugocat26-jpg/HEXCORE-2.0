const { runTaskLoop } = require('./task-loop-runner');

try {
  runTaskLoop({
    title: 'HEXCORE2.0 阵营锁定实施循环钩子',
    defaultDoc: 'docs/14_阵营锁定10队金币商店模式_实施规范.md',
  });
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
}
