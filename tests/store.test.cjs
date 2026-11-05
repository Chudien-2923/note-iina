const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../note-iina.iinaplugin/lib/store.js');
const date = '2026-11-05T12:00:00.000Z';
const note = id => ({ id, videoPath: '01/Bài #100%.mp4', timestamp: 127, text: 'Ghi chú ' + id, createdAt: date, updatedAt: date });
const draft = (revision, overrides = {}) => ({ ownerId: 'window-a', courseId: 'course', videoPath: '01/Bài #100%.mp4', timestamp: 127, text: 'Nháp ' + revision, revision, updatedAt: date, ...overrides });
async function fixture(t, replace) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'note-iina-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const io = {
    draftPath: path.join(root, 'drafts.json'), readText: p => fs.readFile(p, 'utf8'),
    writeText: (p, text) => fs.writeFile(p, text),
    exists: p => fs.access(p).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }),
    replaceFile: async (source, destination) => {
      assert.equal(path.dirname(source), path.dirname(destination), 'atomic replacement uses a sibling temporary file');
      if (replace) await replace(source, destination);
      else await fs.rename(source, destination);
    }
  };
  return { root, io, store: createStore(io), sidecar: path.join(root, '.iina-notes.json') };
}

test('creating a course never replaces an existing sidecar', async t => {
  const { root, store, sidecar } = await fixture(t);
  assert.equal(await store.readCourse(root), null);
  await store.createCourse(root, 'course');
  await store.commit(root, 'course', { kind: 'add', note: note('first') });
  const before = await fs.readFile(sidecar, 'utf8');
  await assert.rejects(store.createCourse(root, 'different'));
  assert.equal(await fs.readFile(sidecar, 'utf8'), before);
  assert.deepEqual((await store.readCourse(root)).notes.map(n => n.id), ['first']);
});

test('concurrent saves preserve both notes after delayed real replacement and reopening', async t => {
  const { root, store, io } = await fixture(t, async (source, destination) => {
    await new Promise(resolve => setTimeout(resolve, 8));
    await fs.rename(source, destination);
  });
  await store.createCourse(root, 'course');
  await Promise.all([
    store.commit(root + '/.', 'course', { kind: 'add', note: note('first') }),
    store.commit(root, 'course', { kind: 'add', note: note('second') })
  ]);
  assert.deepEqual((await createStore(io).readCourse(root)).notes.map(n => n.id), ['first', 'second']);
});

test('failed rename preserves exact old course and durable draft and does not poison the queue', async t => {
  let fail = false;
  const { root, store, io, sidecar } = await fixture(t, async (source, destination) => {
    if (fail && destination.endsWith('.iina-notes.json')) throw new Error('Course read-only');
    await fs.rename(source, destination);
  });
  await store.createCourse(root, 'course');
  await store.saveDraft(draft(1));
  const before = await fs.readFile(sidecar, 'utf8');
  fail = true;
  await assert.rejects(store.commit(root, 'course', { kind: 'add', note: note('first') }), /read-only/);
  assert.equal(await fs.readFile(sidecar, 'utf8'), before);
  assert.deepEqual(await createStore(io).listDrafts('course', draft(1).videoPath), [draft(1)]);
  fail = false;
  await store.commit(root, 'course', { kind: 'add', note: note('second') });
  assert.deepEqual((await store.readCourse(root)).notes.map(n => n.id), ['second']);
});

test('unreadable schema and missing or mismatched courses are never silently reset', async t => {
  const { root, store, sidecar } = await fixture(t);
  await assert.rejects(store.commit(root, 'course', { kind: 'add', note: note('a') }));
  const damaged = '{"schemaVersion":2,"courseId":"course","notes":[]}';
  await fs.writeFile(sidecar, damaged);
  await assert.rejects(store.readCourse(root));
  await assert.rejects(store.commit(root, 'course', { kind: 'add', note: note('a') }));
  await assert.rejects(store.createCourse(root, 'course'));
  assert.equal(await fs.readFile(sidecar, 'utf8'), damaged);
  await fs.writeFile(sidecar, '{"schemaVersion":1,"courseId":"other","notes":[]}');
  await assert.rejects(store.commit(root, 'course', { kind: 'add', note: note('a') }));
  assert.equal((await store.readCourse(root)).courseId, 'other');
});

test('draft revisions and owner/course/video keys survive concurrent writes and restart', async t => {
  const { store, io } = await fixture(t);
  const other = draft(1, { ownerId: 'window-b' });
  const lesson = draft(1, { videoPath: '02/Bài #100%.mp4' });
  await Promise.all([store.saveDraft(draft(2)), store.saveDraft(other), store.saveDraft(lesson), store.saveDraft(draft(1))]);
  await store.clearDraft(draft(1));
  assert.deepEqual((await createStore(io).listDrafts('course', draft(1).videoPath)).map(d => [d.ownerId, d.revision]).sort(), [['window-a', 2], ['window-b', 1]]);
  await store.clearDraft(draft(2));
  assert.deepEqual(await createStore(io).listDrafts('course', draft(1).videoPath), [other]);
  assert.deepEqual(await store.listDrafts('course', lesson.videoPath), [lesson]);
});

test('failed draft replacement and corrupt draft documents retain the previous durable bytes', async t => {
  let fail = false;
  const { store, io } = await fixture(t, async (source, destination) => {
    if (fail) throw new Error('Draft write denied');
    await fs.rename(source, destination);
  });
  await store.saveDraft(draft(1));
  const before = await fs.readFile(io.draftPath, 'utf8');
  fail = true;
  await assert.rejects(store.saveDraft(draft(2)), /denied/);
  await assert.rejects(store.clearDraft(draft(1)), /denied/);
  assert.equal(await fs.readFile(io.draftPath, 'utf8'), before);
  assert.deepEqual(await store.listDrafts('course', draft(1).videoPath), [draft(1)]);
  fail = false;
  await fs.writeFile(io.draftPath, '{broken');
  await assert.rejects(store.saveDraft(draft(3)));
  assert.equal(await fs.readFile(io.draftPath, 'utf8'), '{broken');
});

test('draft queue remains independent of a stalled course writer and persists provisional identity', async t => {
  let release;
  let blocked;
  const entered = new Promise(resolve => { blocked = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let stall = false;
  const { root, store, io } = await fixture(t, async (source, destination) => {
    if (stall && destination.endsWith('.iina-notes.json')) { blocked(); await gate; }
    await fs.rename(source, destination);
  });
  await store.createCourse(root, 'course');
  stall = true;
  const commit = store.commit(root, 'course', { kind: 'add', note: note('a') });
  await entered;
  const pending = draft(4, { courseId: 'pending', videoPath: '/Courses/Bài #100%.mp4' });
  try {
    await store.saveDraft(pending);
    assert.deepEqual(await createStore(io).listDrafts('pending', pending.videoPath), [pending]);
  } finally { release(); }
  await commit;
});

test('queued edits and deletes operate on the latest accepted document', async t => {
  const { root, store, io } = await fixture(t);
  await store.createCourse(root, 'course');
  await store.commit(root, 'course', { kind: 'add', note: note('a') });
  await store.commit(root, 'course', { kind: 'add', note: note('b') });
  await Promise.all([
    store.commit(root, 'course', { kind: 'edit', id: 'a', text: 'Đã sửa\nnguyên dòng', updatedAt: date }),
    store.commit(root, 'course', { kind: 'delete', id: 'b' })
  ]);
  const course = await createStore(io).readCourse(root);
  assert.deepEqual(course.notes.map(n => [n.id, n.text]), [['a', 'Đã sửa\nnguyên dòng']]);
});

test('moving an entire course retains note and relative media identity', async t => {
  const { root, store, io } = await fixture(t);
  const original = path.join(root, 'Khóa học 100%');
  const moved = path.join(root, 'Đã chuyển #1');
  await fs.mkdir(path.join(original, '01'), { recursive: true });
  await fs.writeFile(path.join(original, '01', 'Bài #100%.mp4'), 'local fixture');
  await store.createCourse(original, 'stable-id');
  await store.commit(original, 'stable-id', { kind: 'add', note: note('a') });
  await fs.rename(original, moved);
  const reopened = await createStore(io).readCourse(moved);
  assert.equal(reopened.courseId, 'stable-id');
  assert.equal(reopened.notes[0].videoPath, '01/Bài #100%.mp4');
  assert.equal(await fs.readFile(path.join(moved, reopened.notes[0].videoPath), 'utf8'), 'local fixture');
});

test('a temporary-file write failure never changes the previous accepted sidecar', async t => {
  const { root, store, io, sidecar } = await fixture(t);
  await store.createCourse(root, 'course');
  await store.saveDraft(draft(1));
  const before = await fs.readFile(sidecar, 'utf8');
  const failing = createStore({ ...io, writeText: async (p, text) => {
    await fs.writeFile(p, text.slice(0, 10));
    throw new Error('Disk full');
  } });
  await assert.rejects(failing.commit(root, 'course', { kind: 'add', note: note('a') }), /Disk full/);
  assert.equal(await fs.readFile(sidecar, 'utf8'), before);
  assert.deepEqual(await createStore(io).listDrafts('course', draft(1).videoPath), [draft(1)]);
});

test('legacy decomposed draft paths remain recoverable and cannot poison other courses', async t => {
  const { store, io } = await fixture(t);
  const legacy = draft(4, { videoPath: '01/Bài #100%.mp4'.normalize('NFD') });
  const pending = draft(2, { courseId: 'pending', videoPath: '/Courses/Bài.mp4'.normalize('NFD') });
  await fs.writeFile(io.draftPath, JSON.stringify({ schemaVersion: 1, drafts: [legacy, pending] }));
  assert.equal((await store.listDrafts('course', '01/Bài #100%.mp4'))[0].text, 'Nháp 4');
  assert.equal((await store.listDrafts('pending', '/Courses/Bài.mp4'))[0].text, 'Nháp 2');
  await store.saveDraft(draft(1, { courseId: 'unrelated' }));
  assert.equal((await store.listDrafts('unrelated', draft(1).videoPath))[0].text, 'Nháp 1');
  await store.clearDraft(legacy);
  assert.deepEqual(await store.listDrafts('course', '01/Bài #100%.mp4'), []);
});

test('converging Unicode draft identities preserve distinct text for explicit recovery', async t => {
  const { store, io } = await fixture(t);
  const composed = draft(3, { text: 'Bản thứ nhất' });
  const decomposed = draft(3, { text: 'Bản thứ hai', videoPath: composed.videoPath.normalize('NFD') });
  await fs.writeFile(io.draftPath, JSON.stringify({ schemaVersion: 1, drafts: [composed, decomposed] }));
  const recovered = await store.listDrafts('course', composed.videoPath);
  assert.deepEqual(recovered.map(d => d.text).sort(), ['Bản thứ hai', 'Bản thứ nhất']);
  await store.saveDraft(draft(1, { ownerId: 'different-player' }));
  const reopened = await createStore(io).listDrafts('course', composed.videoPath);
  assert.equal(reopened.length, 3);
  assert.equal(new Set(reopened.map(d => d.ownerId)).size, 3);
});
