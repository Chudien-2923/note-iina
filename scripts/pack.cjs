const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const plugin = path.join(root, 'note-iina.iinaplugin');
const info = JSON.parse(fs.readFileSync(path.join(plugin, 'Info.json'), 'utf8'));
const archive = path.join(root, `note-iina-${info.version}.iinaplgz`);
fs.rmSync(archive, { force: true });
const result = spawnSync('/usr/bin/zip', ['-q', '-r', archive, 'Info.json', 'main.js', 'global.js', 'lib', 'ui'], {
  cwd: plugin,
  encoding: 'utf8'
});
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'Unable to package plugin.\n');
  process.exit(result.status || 1);
}
if (!fs.statSync(archive).size) throw new Error('Plugin archive is empty.');
console.log(archive);
