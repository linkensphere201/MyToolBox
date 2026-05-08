const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const [major = '0', minor = '0'] = String(manifest.version || '0.0.0').split('.');
const outDir = path.join(rootDir, 'release-artifacts');
const outFile = path.join(outDir, `${manifest.name}-v${major}.${minor}.vsix`);
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

fs.mkdirSync(outDir, { recursive: true });

const result = spawnSync(npxCommand, ['vsce', 'package', '--out', outFile], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
