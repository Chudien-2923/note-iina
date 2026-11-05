const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const plugin = path.resolve(__dirname, '../note-iina.iinaplugin');

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'note-iina-lifecycle-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const handlers = {}, turns = [], deliveries = [], invalidTargets = [];
  const registered = new Set();
  // IINA executes JavaScriptCore Promise jobs before the surrounding native
  // JavascriptPluginInstance initializer has returned to install pluginMap.
  vm.runInNewContext(fs.readFileSync(path.join(plugin, 'global.js'), 'utf8'), {
    require: createRequire(path.join(plugin, 'global.js')),
    setTimeout(fn, delay) { assert.equal(delay, 0); turns.push(fn); },
    iina: {
      file: { exists: fs.existsSync, read: p => fs.readFileSync(p, 'utf8'), write: (p, s) => fs.writeFileSync(p, s) },
      utils: { resolvePath: () => path.join(root, 'drafts.json'), exec: async (_, args) => { fs.renameSync(args[1], args[2]); return { status: 0 }; } },
      global: { onMessage: (name, fn) => { handlers[name] = fn; },
        postMessage(label, name, payload) {
          if (!registered.has(label)) invalidTargets.push(label);
          else deliveries.push({ label, name, payload: JSON.parse(JSON.stringify(payload)) });
        } }
    }
  }, { filename: 'global.js' });
  const request = (id, ownerId = 'instance-a') => ({ requestId: id, ownerId, courseRoot: root, courseId: 'course', videoPath: 'A.mp4' });
  async function drainJobs() { for (let n = 0; n < 60; n++) await Promise.resolve(); }
  function nextTurn() { turns.splice(0).forEach(fn => fn()); }
  return { root, handlers, registered, deliveries, invalidTargets, request, drainJobs, nextTurn };
}

test('global replies cross a native main-loop turn after Promise completion before targeting a newly initialized player', async t => {
  const h = await fixture(t);
  h.handlers['list-drafts'](h.request('initial'), 'native-player');
  await h.drainJobs();
  assert.deepEqual(h.invalidTargets, [], 'no delivery may touch the not-yet-installed native pluginMap');
  assert.equal(h.deliveries.length, 0);
  h.registered.add('native-player');
  h.nextTurn();
  assert.deepEqual(h.deliveries.map(d => [d.label, d.name, d.payload.requestId, d.payload.ok, d.payload.data]),
    [['native-player', 'reply', 'initial', true, []]]);
});

test('deregistering a disposed main cancels queued deliveries and excludes it from later course broadcasts', async t => {
  const h = await fixture(t);
  h.registered.add('closed-player'); h.registered.add('active-player');
  h.handlers['list-drafts'](h.request('old'), 'closed-player');
  await h.drainJobs();
  h.handlers['unregister-player']({ ownerId: 'instance-a' }, 'closed-player');
  h.registered.delete('closed-player');
  h.nextTurn();
  h.handlers['create-course'](h.request('create', 'instance-b'), 'active-player');
  await h.drainJobs(); h.nextTurn();
  assert.deepEqual(h.invalidTargets, []);
  assert.deepEqual(h.deliveries.map(d => [d.label, d.name]), [['active-player', 'course-changed'], ['active-player', 'reply']]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.root, '.iina-notes.json'), 'utf8')).courseId, 'course');
});

test('a late disposal from an older instance cannot unregister the replacement at the same native label', async t => {
  const h = await fixture(t);
  h.registered.add('same-player');
  h.handlers['list-drafts'](h.request('old', 'old-instance'), 'same-player');
  await h.drainJobs();
  h.handlers['list-drafts'](h.request('new', 'new-instance'), 'same-player');
  await h.drainJobs();
  h.handlers['unregister-player']({ ownerId: 'old-instance' }, 'same-player');
  h.nextTurn();
  assert.deepEqual(h.deliveries.map(d => d.payload.requestId), ['new']);
  assert.deepEqual(h.invalidTargets, []);
});
