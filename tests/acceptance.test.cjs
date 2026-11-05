const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const first = { id: 'first', videoPath: '01/Introduction.mp4', timestamp: 127, text: 'Tự viết lại điều mình hiểu', createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:00:00.000Z' };

test('notes with identical basenames belong to distinct lessons', () => {
  const model = require('../note-iina.iinaplugin/lib/model.js');
  let course = model.createCourse('course-one');
  course = model.applyMutation(course, { kind: 'add', note: first });
  course = model.applyMutation(course, { kind: 'add', note: { ...first, id: 'second', videoPath: '02/Introduction.mp4', text: 'Một ý khác' } });
  assert.deepEqual(model.selectNotes(course, { videoPath: '01/Introduction.mp4' }).map(n => n.id), ['first']);
  assert.deepEqual(model.selectNotes(course, { videoPath: '02/Introduction.mp4' }).map(n => n.id), ['second']);
});

test('typing after starting a save survives its late success acknowledgement', () => {
  const { createSession } = require('../note-iina.iinaplugin/lib/session.js');
  let id = 0;
  const session = createSession({ ownerId: 'window-one', makeId: () => 'id-' + (++id), now: () => '2026-11-05T12:00:00.000Z' });
  const binding = { courseRoot: '/Courses/Thinking', courseId: 'course-one', videoPath: '01.mp4' };
  session.selectVideo(binding);
  session.beginNote(127);
  session.changeText('Ý thứ nhất');
  const intent = session.startSave();
  session.changeText('Ý thứ nhất và suy nghĩ tiếp theo');
  session.settleSave({ requestId: intent.requestId, courseId: binding.courseId, videoPath: binding.videoPath, ok: true });
  assert.equal(intent.note.timestamp, 127);
  assert.equal(session.snapshot().draft.text, 'Ý thứ nhất và suy nghĩ tiếp theo');
});

test('concurrent player saves persist both notes in the real course file', async t => {
  const { createStore } = require('../note-iina.iinaplugin/lib/store.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'note-iina-acceptance-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createStore({
    readText: p => fs.readFile(p, 'utf8'), writeText: (p, text) => fs.writeFile(p, text),
    exists: p => fs.access(p).then(() => true, () => false), replaceFile: (source, destination) => fs.rename(source, destination),
    draftPath: path.join(directory, 'drafts.json')
  });
  await store.createCourse(directory, 'course-one');
  await Promise.all([
    store.commit(directory, 'course-one', { kind: 'add', note: first }),
    store.commit(directory, 'course-one', { kind: 'add', note: { ...first, id: 'second', videoPath: '02/Introduction.mp4' } })
  ]);
  const saved = JSON.parse(await fs.readFile(path.join(directory, '.iina-notes.json'), 'utf8'));
  assert.deepEqual(saved.notes.map(n => n.id).sort(), ['first', 'second']);
});
