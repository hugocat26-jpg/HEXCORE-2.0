const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const versionedTarget = path.resolve(root, 'apps', 'multiplayer');
const defaultExternalSource = path.resolve('E:\\only_why\\HEXCORE2.0\\multiplayer');
const ignoredNames = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db']);

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafePaths(source, target) {
  const sourcePath = path.resolve(source);
  const targetPath = path.resolve(target);
  const refereeRepo = path.resolve('E:\\only_why\\HEXCORE2.0\\hex-core2.0');
  const expectedParent = path.resolve('E:\\only_why\\HEXCORE2.0');

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`多人端本机副本不存在：${sourcePath}`);
  }
  if (!fs.statSync(sourcePath).isDirectory()) {
    throw new Error(`多人端本机副本必须是目录：${sourcePath}`);
  }
  if (!isInside(root, targetPath) || targetPath !== versionedTarget) {
    throw new Error(`同步目标必须是仓库内 apps/multiplayer：${targetPath}`);
  }
  if (!isInside(expectedParent, sourcePath) || sourcePath === expectedParent) {
    throw new Error(`同步来源必须位于 ${expectedParent} 下的独立多人端目录：${sourcePath}`);
  }
  if (sourcePath === refereeRepo || isInside(refereeRepo, sourcePath) || isInside(sourcePath, refereeRepo)) {
    throw new Error(`同步来源不能是裁判端仓库或其父目录：${sourcePath}`);
  }
  if (sourcePath === targetPath || isInside(targetPath, sourcePath) || isInside(sourcePath, targetPath)) {
    throw new Error('同步来源和目标不能互相包含');
  }
  return { sourcePath, targetPath };
}

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) continue;
    const sourceChild = path.join(source, entry.name);
    const targetChild = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourceChild, targetChild);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourceChild, targetChild);
    }
  }
}

function syncMultiplayerCopy(options = {}) {
  const source = options.source || process.env.MULTIPLAYER_APP_ROOT || defaultExternalSource;
  const target = options.target || versionedTarget;
  const { sourcePath, targetPath } = assertSafePaths(source, target);

  if (options.dryRun) {
    return { sourcePath, targetPath, dryRun: true };
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  copyDirectory(sourcePath, targetPath);
  return { sourcePath, targetPath, dryRun: false };
}

if (require.main === module) {
  try {
    const result = syncMultiplayerCopy();
    console.log(`多人端副本已同步：${result.sourcePath} -> ${result.targetPath}`);
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  assertSafePaths,
  defaultExternalSource,
  ignoredNames,
  syncMultiplayerCopy,
  versionedTarget,
};
