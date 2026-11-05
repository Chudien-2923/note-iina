const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { createStore } = require('../note-iina.iinaplugin/lib/store.js');
const mountSidebar = require('./helpers/sidebar.cjs');
const plugin = path.resolve(__dirname, '../note-iina.iinaplugin');
const date = '2026-11-05T12:00:00.000Z';

// Only IINA's native boundary is substituted. Both entries execute unchanged,
// with the real model/session/store and actual filesystem replacement.
async function host(t, suffix = '') {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'note-iina-host-' + suffix));
  t.after(async () => {
    await until(() => outstanding === 0 && scheduledTurns === 0, 'host shutdown writes');
    await fsp.rm(root, { recursive: true, force: true });
  });
  const draftPath = path.join(root, 'drafts.json');
  const io = { draftPath, readText: p => fsp.readFile(p, 'utf8'), writeText: (p, s) => fsp.writeFile(p, s),
    exists: p => fs.existsSync(p), replaceFile: (a, b) => fsp.rename(a, b) };
  const store = createStore(io);
  await store.createCourse(root, 'course');
  for (const name of ['A', 'B', 'C', 'X']) await fsp.writeFile(path.join(root, name + '.mp4'), '');
  const handlers = {}, notebookHandlers = {}, globalHandlers = {}, events = {}, keys = {}, sent = [];
  let outstanding = 0;
  let scheduledTurns = 0;
  function nativeTimeout(fn, delay) {
    scheduledTurns++;
    return setTimeout(() => {
      try { fn(); } finally { scheduledTurns--; }
    }, delay);
  }
  const nativeLabel = 'ordinary-player';
  const recipients = new Map();
  const deliveries = [];
  const window = { loaded: false };
  const held = [];
  let holdDraftReplies = false;
  let draftRequests = 0;
  const heldDraftReplies = [];
  const draftRequestIds = new Set();
  let holdLoads = false;
  let holdEditorMessages = false;
  const editorMessages = [];
  const chooserResults = [];
  let state;
  let webview = null;
  const copy = value => JSON.parse(JSON.stringify(value));
  const view = callbacks => ({ onMessage: (name, fn) => { callbacks[name] = fn; },
    postMessage: (name, payload) => { sent.push({ name, payload: copy(payload) }); if (name === 'state') state = copy(payload); if (callbacks === handlers && webview) webview.receive(name, copy(payload)); },
    loadFile() { for (const name of Object.keys(callbacks)) delete callbacks[name]; }, show() {}, hide() {}, setProperty() {}, setFrame() {}, open() {}, close() {} });
  const sidebar = view(handlers);
  const standaloneWindow = view(notebookHandlers);
  const player = { idle: false, url: 'file://' + path.join(root, 'A.mp4'), position: 127 };
  const seeks = [];
  const iina = {
    file: { exists: fs.existsSync, read: p => fs.readFileSync(p, 'utf8'), write: (p, s) => fs.writeFileSync(p, s) },
    utils: { resolvePath: () => draftPath, ask: () => true, chooseFile: () => chooserResults.length ? chooserResults.shift() : Promise.resolve(root),
      exec: async (binary, args) => { assert.equal(binary, '/bin/mv'); assert.equal(args[0], '-f'); await fsp.rename(args[1], args[2]); return { status: 0, stderr: '' }; } },
    core: { status: player, window,
      pause() {}, seekTo: time => seeks.push(time), open: p => { player.url = 'file://' + p; } },
    event: { on: (name, fn) => { events[name] = fn; return name; }, off() {} },
    input: { normalizeKeyCode: key => key, getAllKeyBindings: () => ({}), onKeyDown: (key, fn) => { keys[key] = fn; }, PRIORITY_LOW: 0 },
    menu: { item: (name, fn) => ({ name, fn }), addItem() {} }, sidebar, standaloneWindow
  };
  const run = (name, transport) => vm.runInNewContext(fs.readFileSync(path.join(plugin, name), 'utf8'),
    { iina: { ...iina, global: transport }, require: createRequire(path.join(plugin, name)), console, setTimeout: nativeTimeout }, { filename: name });
  run('global.js', { onMessage: (name, fn) => { globalHandlers[name] = fn; },
    postMessage: (target, name, payload) => {
      deliveries.push({ target, name });
      if (name === 'reply' && target === nativeLabel && holdDraftReplies && draftRequestIds.has(payload.requestId)) {
        heldDraftReplies.push(() => {
          outstanding--;
          if (globalReply[name]) globalReply[name](copy(payload));
        });
        return;
      }
      // Native null broadcasts reach plugin-created players only. This fixture
      // is an ordinary user-opened player, reachable solely by its sender label.
      if (target === nativeLabel) {
        if (name === 'reply') outstanding--;
        if (globalReply[name]) globalReply[name](copy(payload));
      } else if (recipients.has(target)) recipients.get(target).push({ name, payload: copy(payload) });
    } });
  const globalReply = {};
  function dispatch(name, payload) {
    Promise.resolve().then(() => globalHandlers[name](copy(payload), nativeLabel));
  }
  run('main.js', { onMessage: (name, fn) => { globalReply[name] = fn; },
    postMessage: (name, payload) => {
      if (name !== 'unregister-player' && name !== 'save-final-draft') outstanding++;
      if (name === 'list-drafts') { draftRequests++; draftRequestIds.add(payload.requestId); }
      if (holdLoads && name === 'load-course') held.push([name, copy(payload)]);
      else dispatch(name, payload);
    } });
  assert.equal(Object.keys(handlers).length, 0, 'sidebar is not loaded before the native window');
  window.loaded = true;
  events['iina.window-loaded']();
  assert.equal(typeof handlers['ui-ready'], 'function', 'loadFile listener clearing must not remove the handshake');
  handlers['ui-ready']({ view: 'sidebar' });
  async function until(predicate, label) {
    for (let n = 0; n < 500; n++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    assert.fail('Timed out waiting for ' + label + '; state=' + JSON.stringify(state));
  }
  async function settle() {
    await until(() => outstanding === 0 && scheduledTurns === 0, 'all actual global replies and scheduled native turns');
    await store.listDrafts('course', 'A.mp4');
  }
  await until(() => state && state.status === 'ready', 'initial course');
  return { root, store, draftPath, seeks, player, sent, deliveries, until, settle,
    get state() { return state; },
    send: (name, payload = {}) => handlers[name](payload),
    notebook: (name, payload = {}) => notebookHandlers[name](payload),
    mountSidebar() {
      webview = mountSidebar((name, payload) => {
        if (holdEditorMessages && (name === 'draft-change' || name === 'save-note')) editorMessages.push([name, payload]);
        else handlers[name](payload);
      });
      webview.receive('state', state);
      return webview;
    },
    openNotes: () => keys.n({ isRepeat: false }),
    change(text, context = state.editorContext) { handlers['draft-change']({ text, editorContext: context }); },
    save(context = state.editorContext) { return handlers['save-note']({ editorContext: context }); },
    async subscribe(label) {
      const messages = [];
      recipients.set(label, messages);
      globalHandlers['load-course']({ requestId: 'subscribe-' + label, ownerId: 'peer-' + label, courseRoot: root, courseId: 'course', videoPath: 'A.mp4' }, label);
      await until(() => messages.some(message => message.name === 'reply'), 'other player subscription');
      return messages;
    },
    async mutatePeer(label, note) {
      const requestId = 'mutation-' + label;
      globalHandlers['mutate-course']({ requestId, ownerId: 'peer-' + label, courseRoot: root, courseId: 'course', videoPath: note.videoPath, mutation: { kind: 'add', note } }, label);
      await until(() => recipients.get(label).some(message => message.name === 'reply' && message.payload.requestId === requestId), 'peer mutation');
    },
    holdInput() { holdEditorMessages = true; },
    flushInput() { holdEditorMessages = false; editorMessages.splice(0).forEach(([name, payload]) => handlers[name](payload)); },
    hold() { holdLoads = true; },
    holdDrafts() { holdDraftReplies = true; },
    get draftRequests() { return draftRequests; },
    releaseDrafts() { holdDraftReplies = false; heldDraftReplies.splice(0).forEach(fn => fn()); },
    release() { holdLoads = false; held.splice(0).forEach(([name, payload]) => dispatch(name, payload)); },
    select(name, loaded = true) { const p = path.join(root, name + '.mp4'); player.url = 'file://' + p; events['iina.file-started'](); if (loaded) events['iina.file-loaded'](pathToFileURL(p).href); },
    loaded(name) { events['iina.file-loaded'](pathToFileURL(path.join(root, name + '.mp4')).href); },
    close() { events['iina.window-will-close'](); },
    chooseResult(result) { chooserResults.push(result); },
    async ready(name) { await until(() => state.status === 'ready' && state.binding.videoPath === name + '.mp4', name + ' ready'); },
    async addNote(name, timestamp) { await store.commit(root, 'course', { kind: 'add', note: { id: name, videoPath: name + '.mp4', timestamp, text: name, createdAt: date, updatedAt: date } }); }
  };
}

test('early N while returning to a lesson preserves cached and durable nonblank draft and its timestamp', async t => {
  const h = await host(t);
  h.openNotes(); h.change('Original A');
  await h.settle();
  const original = h.state.draft;
  h.select('B'); await h.ready('B');
  h.hold(); h.select('A'); h.player.position = 999; h.openNotes();
  h.release(); await h.ready('A'); await h.settle();
  assert.equal(h.state.draft.text, 'Original A');
  assert.equal(h.state.draft.timestamp, 127);
  assert.equal(h.state.draft.updatedAt, original.updatedAt);
  const durable = await h.store.listDrafts('course', 'A.mp4');
  assert.equal(durable[0].text, 'Original A');
  assert.equal(durable[0].timestamp, 127);
});

test('provisional typing competes with an existing draft without overwriting either and is explicitly recoverable', async t => {
  const h = await host(t);
  h.openNotes(); h.change('Original A'); await h.settle();
  h.select('B'); await h.ready('B');
  h.hold(); h.select('A'); h.player.position = 800; h.openNotes(); h.change('New provisional A');
  h.release(); await h.ready('A'); await h.settle();
  assert.equal(h.state.draft.text, 'Original A');
  const candidate = h.state.recoveryDrafts.find(d => d.text === 'New provisional A');
  assert.ok(candidate, 'competing text is offered for explicit recovery');
  assert.equal((await h.store.listDrafts('course', 'A.mp4'))[0].text, 'Original A');
  assert.equal((await h.store.listDrafts('pending', path.join(h.root, 'A.mp4')))[0].text, 'New provisional A');
  h.send('restore-draft', { ownerId: candidate.ownerId, courseId: candidate.courseId, videoPath: candidate.videoPath, revision: candidate.revision });
  await h.settle();
  assert.equal(h.state.draft.text, 'New provisional A');
  assert.equal(h.state.draft.timestamp, 800);
});

test('early N and provisional typing cannot overwrite a restart-recovered durable draft', async t => {
  const h = await host(t);
  h.select('B'); await h.ready('B');
  await h.store.saveDraft({ ownerId: 'previous-player', courseId: 'course', videoPath: 'C.mp4', text: 'Durable C', timestamp: 12, revision: 9, updatedAt: date });
  h.hold(); h.select('C'); h.openNotes(); const context = h.state.editorContext;
  h.change('New C'); h.release();
  await h.ready('C'); await h.settle();
  assert.equal(h.state.draft.text, 'Durable C');
  assert.equal(h.state.draft.timestamp, 12);
  assert.ok(h.state.recoveryDrafts.some(d => d.text === 'New C'));
  h.change('New C finalized', context); await h.settle();
  assert.equal(h.state.draft.text, 'Durable C');
  assert.ok(h.state.recoveryDrafts.some(d => d.text === 'New C finalized'));
  assert.equal((await h.store.listDrafts('pending', path.join(h.root, 'C.mp4')))[0].text, 'New C finalized');
});

test('delayed editor input and save retain A ownership before B state reaches the WebView', async t => {
  const h = await host(t);
  h.openNotes(); h.change('A before'); const aContext = h.state.editorContext; await h.settle();
  h.select('B'); await h.ready('B'); h.player.position = 25; h.openNotes(); h.change('B stays'); await h.settle();
  // A WebView callback may arrive before any native file-started notification.
  h.player.url = pathToFileURL(path.join(h.root, 'A.mp4')).href;
  h.select('A'); await h.ready('A');
  const oldAContext = h.state.editorContext;
  h.player.url = 'file://' + path.join(h.root, 'B.mp4');
  h.change('A completed IME', oldAContext);
  await h.save(oldAContext); await h.settle(); await h.ready('B');
  assert.equal(h.state.draft.text, 'B stays');
  const saved = (await h.store.readCourse(h.root)).notes;
  assert.deepEqual(saved.map(n => [n.videoPath, n.text, n.timestamp]), [['A.mp4', 'A completed IME', 127]]);
  h.change('forged', 'not-issued'); await h.save('not-issued'); await h.settle();
  assert.equal(h.state.draft.text, 'B stays');
  assert.ok(aContext && oldAContext, 'host issues nonempty editor tokens');
});

test('pending provisional input keeps its context across conflict-free course adoption', async t => {
  const h = await host(t);
  h.hold(); h.select('C'); h.openNotes();
  const context = h.state.editorContext;
  h.change('C first', context); h.release(); await h.ready('C');
  h.change('C latest in transit', context); await h.save(context); await h.settle();
  assert.deepEqual((await h.store.readCourse(h.root)).notes.map(n => [n.videoPath, n.text]), [['C.mp4', 'C latest in transit']]);
});

test('late provisional input after a conflicting adoption remains separate from the lesson draft', async t => {
  const h = await host(t);
  h.openNotes(); h.change('A protected'); await h.settle(); h.select('B'); await h.ready('B');
  h.hold(); h.select('A'); h.openNotes(); const provisionalContext = h.state.editorContext;
  h.release(); await h.ready('A');
  h.change('A late provisional composition', provisionalContext); await h.settle();
  assert.equal(h.state.draft.text, 'A protected');
  assert.ok(h.state.recoveryDrafts.some(d => d.text === 'A late provisional composition'));
  assert.equal((await h.store.listDrafts('course', 'A.mp4'))[0].text, 'A protected');
});

test('stale loaded callbacks neither cancel nor consume the latest pending timestamp', async t => {
  const h = await host(t);
  await h.addNote('B', 40); await h.addNote('C', 60);
  h.select('X'); await h.ready('X');
  h.send('seek-note', { id: 'B' });
  h.loaded('X'); // native now points to B, so this old callback must be inert
  h.loaded('B');
  assert.deepEqual(h.seeks, [40]);
  h.send('seek-note', { id: 'C' });
  h.player.url = 'file://' + path.join(h.root, 'B.mp4');
  h.loaded('C'); // rejected matching callback must not consume C either
  h.player.url = 'file://' + path.join(h.root, 'C.mp4');
  h.loaded('C');
  assert.deepEqual(h.seeks, [40, 60]);
});

test('native sidebar and notebook loadFile listener clearing still permits ready handshakes without getTheme', async t => {
  const h = await host(t);
  assert.equal(h.state.theme, null);
  h.send('open-course');
  h.notebook('ui-ready', { view: 'notebook' });
  assert.ok(h.sent.some(message => message.name === 'state' && message.payload.status === 'ready'));
});

test('composition completed after switching lessons is retained for its original host context', async t => {
  const h = await host(t);
  h.openNotes(); h.change('A trước'); await h.settle();
  const ui = h.mountSidebar();
  ui.editor.emit('compositionstart');
  ui.editor.value = 'A tiếng Việt';
  ui.editor.emit('input');
  h.select('B'); await h.ready('B');
  ui.editor.emit('compositionend');
  await h.settle();
  assert.equal(ui.editor.value, '');
  assert.equal(h.state.draft, null);
  h.select('A'); await h.ready('A'); await h.settle();
  assert.equal(h.state.draft.text, 'A tiếng Việt');
  assert.equal(ui.editor.value, 'A tiếng Việt');
  assert.equal(h.state.draft.timestamp, 127);
});

test('decoded native status URLs preserve literal percent escapes, hashes and Unicode without double decoding', async t => {
  const h = await host(t, 'Khóa học 100% #1 literal%20 ');
  assert.equal(h.state.videoPath, path.join(h.root, 'A.mp4'));
  h.openNotes(); h.change('Đường dẫn thật'); await h.save(); await h.settle();
  assert.deepEqual((await h.store.readCourse(h.root)).notes.map(n => [n.videoPath, n.text]), [['A.mp4', 'Đường dẫn thật']]);
  await h.addNote('B', 47);
  h.select('X'); await h.ready('X');
  h.send('seek-note', { id: 'B' }); h.loaded('B');
  assert.deepEqual(h.seeks, [47]);
});

test('global writer replies and course changes reach ordinary native player sender labels', async t => {
  const h = await host(t);
  const other = await h.subscribe('second-ordinary-player');
  h.openNotes(); h.change('Broadcast real note'); await h.save(); await h.settle();
  const published = other.filter(message => message.name === 'course-changed');
  assert.equal(published.length, 1);
  assert.deepEqual(published[0].payload.course.notes.map(n => [n.videoPath, n.text]), [['A.mp4', 'Broadcast real note']]);
  assert.equal(h.state.notes[0].text, 'Broadcast real note');
});

test('real sidebar pending input survives course adoption and saves with the same host-issued context', async t => {
  const h = await host(t);
  const ui = h.mountSidebar();
  h.hold(); h.select('C'); h.openNotes();
  h.holdInput();
  ui.editor.value = 'C đang chờ bridge';
  ui.editor.emit('input');
  h.release(); await h.ready('C');
  assert.equal(ui.editor.value, 'C đang chờ bridge', 'adoption cannot replace unacknowledged local typing');
  h.flushInput();
  ui.submit(); await h.settle();
  assert.deepEqual((await h.store.readCourse(h.root)).notes.map(n => [n.videoPath, n.text]), [['C.mp4', 'C đang chờ bridge']]);
  assert.equal(ui.editor.value, '');
});

test('real sidebar sends queued input to its old lesson even after the new lesson is rendered', async t => {
  const h = await host(t);
  h.openNotes(); const ui = h.mountSidebar();
  h.holdInput();
  ui.editor.value = 'A chưa nhận được';
  ui.editor.emit('input');
  h.select('B'); await h.ready('B');
  assert.equal(ui.editor.value, '');
  h.flushInput(); await h.settle();
  assert.equal(h.state.draft, null);
  h.select('A'); await h.ready('A');
  assert.equal(ui.editor.value, 'A chưa nhận được');
  assert.equal(h.state.draft.timestamp, 127);
});

test('main disposal unregisters its native label before another player mutates the course', async t => {
  const h = await host(t);
  await h.subscribe('remaining-player');
  await h.settle();
  h.close();
  await Promise.resolve();
  const before = h.deliveries.length;
  await h.mutatePeer('remaining-player', { id: 'after-close', videoPath: 'B.mp4', timestamp: 5, text: 'Still active', createdAt: date, updatedAt: date });
  assert.deepEqual(h.deliveries.slice(before).map(d => [d.target, d.name]),
    [['remaining-player', 'course-changed'], ['remaining-player', 'reply']]);
  assert.equal((await h.store.readCourse(h.root)).notes[0].text, 'Still active');
});

test('course broadcasts received during adoption draft resolution retain newer peer notes', async t => {
  const h = await host(t);
  await h.subscribe('peer-player'); await h.settle();
  h.holdDrafts();
  const before = h.draftRequests;
  h.select('B');
  await h.until(() => h.draftRequests >= before + 2, 'adoption waiting on draft reads');
  await h.mutatePeer('peer-player', { id: 'peer-new', videoPath: 'B.mp4', timestamp: 88, text: 'Newer peer note', createdAt: date, updatedAt: date });
  h.releaseDrafts(); await h.ready('B'); await h.settle();
  assert.deepEqual(h.state.notes.map(n => [n.id, n.text, n.timestamp]), [['peer-new', 'Newer peer note', 88]]);
});

test('Promise-shaped native folder selection creates the real course without clearing its provisional draft', async t => {
  const h = await host(t);
  await h.settle();
  await fsp.unlink(path.join(h.root, '.iina-notes.json'));
  h.select('B');
  await h.until(() => h.state.status === 'choose-course', 'unbound course');
  h.openNotes(); h.change('B đang chọn folder'); await h.settle();
  const timestamp = h.state.draft.timestamp;
  let resolveChoice;
  h.chooseResult(new Promise(resolve => { resolveChoice = resolve; }));
  h.send('choose-course', { useCurrent: false });
  assert.equal(h.state.status, 'choose-course');
  assert.equal(h.state.draft.text, 'B đang chọn folder');
  assert.equal(fs.existsSync(path.join(h.root, '.iina-notes.json')), false);
  resolveChoice(h.root);
  await h.ready('B'); await h.settle();
  assert.equal(h.state.error, null);
  assert.equal(h.state.draft.text, 'B đang chọn folder');
  assert.equal(h.state.draft.timestamp, timestamp);
  await h.save(); await h.settle();
  assert.deepEqual((await h.store.readCourse(h.root)).notes.map(n => [n.videoPath, n.text]), [['B.mp4', 'B đang chọn folder']]);
});

test('a cancelled native chooser that never resolves does not block a subsequent successful selection', async t => {
  const h = await host(t);
  await h.settle();
  await fsp.unlink(path.join(h.root, '.iina-notes.json'));
  h.select('C');
  await h.until(() => h.state.status === 'choose-course', 'unbound course');
  h.openNotes(); h.change('C vẫn được giữ'); await h.settle();
  h.chooseResult(new Promise(() => {}));
  h.send('choose-course', { useCurrent: false });
  await Promise.resolve();
  assert.equal(h.state.error, null);
  assert.equal(h.state.draft.text, 'C vẫn được giữ');
  assert.equal(fs.existsSync(path.join(h.root, '.iina-notes.json')), false);
  h.chooseResult(Promise.resolve(h.root));
  h.send('choose-course', { useCurrent: false });
  await h.ready('C'); await h.settle();
  assert.equal(h.state.error, null);
  assert.equal(h.state.draft.text, 'C vẫn được giữ');
  assert.ok(await h.store.readCourse(h.root));
});
