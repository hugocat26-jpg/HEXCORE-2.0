const { runTaskLoop } = require('./task-loop-runner');

try {
  runTaskLoop({
    title: 'HEXCORE2.0 通用任务执行循环钩子',
    defaultDoc: 'docs/06_开发计划.md',
  });
} catch (error) {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
}
