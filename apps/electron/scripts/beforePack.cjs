const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

/** Prepare pinned runtimes and the target's installer assets before packaging. */
module.exports = async function beforePack(context) {
  // electron-builder Arch enum: x64 = 1, arm64 = 3.
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch];
  if (!arch) throw new Error(`Unsupported packaging architecture: ${context.arch}`);
  const rootDir = resolve(context.packager.projectDir, '../..');
  execFileSync('bun', ['run', 'scripts/provision-runtime.ts', context.electronPlatformName, arch], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  // beforeBuild belongs to dependency rebuilding and is skipped with npmRebuild:
  // false. The Windows installer plugin must also exist in a fresh checkout.
  if (context.electronPlatformName === 'win32') {
    require('./prepare-windows-installer.cjs').buildInstallerPlugin();
  }
};
