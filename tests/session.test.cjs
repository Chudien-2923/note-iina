const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession } = require('../note-iina.iinaplugin/lib/session.js');
const date = '2026-11-05T12:00:00.000Z';
const a = { courseRoot: '/Courses/A', courseId: 'course', videoPath: '01/Introduction.mp4' };
const b = { ...a, videoPath: '02/Introduction.mp4' };
function fixture() {
  let id = 0;
  return createSession({ ownerId: 'window', makeId: () => 'id-' + ++id, now: () => date });
}
const reply = (intent, overrides = {}) => ({ requestId: intent.requestId, courseId: intent.binding.courseId, videoPath: intent.binding.videoPath, ok: true, ...overrides });

test('timestamp remains the start of writing, repeated focus does not recapture it, and snapshots cannot mutate state', () => {
  const s = fixture();
  assert.deepEqual(s.snapshot(), { binding: null, draft: null, saving: false, error: null });
  s.selectVideo(a);
  s.beginNote(127);
  s.beginNote(300);
  s.changeText('  Ý thứ nhất\ndòng hai  ');
  s.beginNote(300);
  const snapshot = s.snapshot();
  snapshot.draft.text = 'corrupted';
  snapshot.binding.videoPath = 'wrong.mp4';
  const intent = s.startSave();
  assert.equal(intent.note.timestamp, 127);
  assert.equal(intent.note.text, 'Ý thứ nhất\ndòng hai');
  assert.equal(intent.binding.videoPath, a.videoPath);
  assert.equal(s.startSave(), null);
  assert.equal(s.snapshot().saving, true);
  s.settleSave(reply(intent));
  assert.equal(s.snapshot().draft, null);
  assert.equal(s.snapshot().saving, false);
});

test('blank text and an unbound course cannot produce a save', () => {
  const s = fixture();
  assert.equal(s.startSave(), null);
  s.selectVideo(a);
  s.beginNote(0);
  s.changeText(' \n ');
  assert.equal(s.startSave(), null);
  s.selectVideo({ courseRoot: '', courseId: 'pending', videoPath: '/Courses/A/01/Introduction.mp4' });
  s.beginNote(1);
  s.changeText('Chưa chọn course');
  assert.equal(s.startSave(), null);
});

test('a late save never clears later typing or accepts a mismatched reply identity', () => {
  const s = fixture();
  s.selectVideo(a); s.beginNote(127); s.changeText('Một');
  const intent = s.startSave();
  s.changeText('Một và hai');
  const revision = s.snapshot().draft.revision;
  s.settleSave(reply(intent, { videoPath: b.videoPath }));
  assert.equal(s.snapshot().saving, true);
  s.settleSave(reply(intent));
  assert.equal(s.snapshot().draft.text, 'Một và hai');
  assert.equal(s.snapshot().draft.revision, revision);
  assert.equal(intent.draft.text, 'Một');
  assert.equal(s.snapshot().saving, false);
});

test('switching lessons retains original save ownership and leaves current draft untouched', () => {
  const s = fixture();
  s.selectVideo(a); s.beginNote(127); s.changeText('Bài một');
  const intent = s.startSave();
  s.selectVideo(b); s.beginNote(40); s.changeText('Bài hai');
  const before = s.snapshot().draft;
  s.settleSave(reply(intent));
  assert.deepEqual(s.snapshot().draft, before);
  assert.deepEqual(s.snapshot().binding, b);
  s.selectVideo(a);
  assert.equal(s.snapshot().draft, null, 'successful original save clears only the cached original revision');
  s.selectVideo(b);
  assert.deepEqual(s.snapshot().draft, before);
});

test('failed save retains original draft and timestamp without assigning its error to another lesson', () => {
  const s = fixture();
  s.selectVideo(a); s.beginNote(127); s.changeText('Không được mất');
  const intent = s.startSave();
  s.settleSave(reply(intent, { ok: false, error: 'Read-only course' }));
  assert.equal(s.snapshot().draft.text, 'Không được mất');
  assert.equal(s.snapshot().draft.timestamp, 127);
  assert.equal(s.snapshot().error, 'Read-only course');
  const retry = s.startSave();
  assert.notEqual(retry.requestId, intent.requestId);
  s.selectVideo(b); s.beginNote(9); s.changeText('Khác');
  s.settleSave(reply(retry, { ok: false, error: 'Old course failed' }));
  assert.equal(s.snapshot().error, null);
  s.selectVideo(a);
  assert.equal(s.snapshot().draft.text, 'Không được mất');
});

test('restored draft is not restarted by N and explicit restoration replaces current text with a durable newer revision', () => {
  const s = fixture();
  const restored = { ownerId: 'old-window', courseId: a.courseId, videoPath: a.videoPath, timestamp: 19, text: 'Phục hồi', revision: 7, updatedAt: date };
  s.selectVideo(a, restored);
  s.beginNote(300);
  assert.equal(s.snapshot().draft.timestamp, 19);
  assert.equal(s.snapshot().draft.text, 'Phục hồi');
  s.changeText('Phục hồi và mới');
  const previousRevision = s.snapshot().draft.revision;
  s.selectVideo(a, restored);
  assert.equal(s.snapshot().draft.text, 'Phục hồi');
  assert.equal(s.snapshot().draft.timestamp, 19);
  assert.ok(s.snapshot().draft.revision > previousRevision);
  assert.equal(s.snapshot().draft.ownerId, 'window');
});

test('provisional binding migration retains latest text and timestamp and cannot be cleared by an old acknowledgement', () => {
  const s = fixture();
  const pending = { courseRoot: '', courseId: 'pending', videoPath: '/Courses/A/01/Introduction.mp4' };
  s.selectVideo(pending); s.beginNote(127); s.changeText('Chưa chọn');
  const original = s.snapshot().draft;
  s.selectVideo(a, { ...original, courseId: a.courseId, videoPath: a.videoPath });
  assert.equal(s.snapshot().draft.text, 'Chưa chọn');
  assert.equal(s.snapshot().draft.timestamp, 127);
  assert.equal(s.snapshot().draft.revision, original.revision);
  const intent = s.startSave();
  s.changeText('Đã chọn và tiếp tục');
  s.settleSave(reply(intent));
  assert.equal(s.snapshot().draft.text, 'Đã chọn và tiếp tục');
  s.selectVideo(pending);
  assert.equal(s.snapshot().draft, null, 'migration removes the obsolete provisional cache');
  s.selectVideo(a);
  assert.equal(s.snapshot().draft.text, 'Đã chọn và tiếp tục');
});

test('new drafts use a later revision so delayed durable clears cannot erase a fresh draft', () => {
  const s = fixture();
  s.selectVideo(a); s.beginNote(10); s.changeText('Một');
  const intent = s.startSave();
  s.settleSave(reply(intent));
  s.beginNote(20); s.changeText('Hai');
  assert.ok(s.snapshot().draft.revision > intent.draft.revision);
  assert.equal(s.snapshot().draft.timestamp, 20);
});

test('old file-loaded cannot consume newer navigation even when repeated URLs are requested', () => {
  const s = fixture();
  const first = 'file:///Courses/B%C3%A0i%20A.mp4';
  const last = 'file:///Courses/B.mp4';
  s.beginSeek(first, 10); s.beginSeek(last, 40);
  assert.equal(s.takePendingSeek(first), null);
  assert.deepEqual(s.takePendingSeek(last), { url: last, timestamp: 40 });
  assert.equal(s.takePendingSeek(last), null);
  s.beginSeek(first, 10); s.beginSeek(first, 50);
  assert.deepEqual(s.takePendingSeek(first), { url: first, timestamp: 50 });
});

test('external selection and explicit cancellation invalidate pending navigation', () => {
  const s = fixture();
  s.beginSeek('file:///B.mp4', 40);
  assert.equal(s.takePendingSeek('file:///C.mp4'), null);
  assert.equal(s.takePendingSeek('file:///B.mp4'), null);
  s.beginSeek('file:///B.mp4', 40); s.cancelSeek();
  assert.equal(s.takePendingSeek('file:///B.mp4'), null);
});

test('completed and cancelled navigation sequences expire superseded file markers', () => {
  const s = fixture();
  s.beginSeek('/A.mp4', 10); s.beginSeek('/B.mp4', 20);
  assert.deepEqual(s.takePendingSeek('/B.mp4'), { url: '/B.mp4', timestamp: 20 });
  s.beginSeek('/C.mp4', 30);
  assert.equal(s.takePendingSeek('/A.mp4'), null, 'external A must cancel the independent C sequence');
  assert.equal(s.takePendingSeek('/C.mp4'), null);
  s.beginSeek('/A.mp4', 10); s.beginSeek('/B.mp4', 20); s.cancelSeek();
  s.beginSeek('/C.mp4', 30); s.takePendingSeek('/A.mp4');
  assert.equal(s.takePendingSeek('/C.mp4'), null);
});

test('targeted editor changes and save preserve the visible binding and original timestamp', () => {
  const s = fixture();
  s.selectVideo(a); s.beginNote(127); s.changeText('A');
  s.selectVideo(b); s.beginNote(40); s.changeText('B');
  s.beginNote(999, a);
  s.changeText('A IME complete', a);
  const intent = s.startSave(a);
  assert.deepEqual(s.snapshot().binding, b);
  assert.equal(s.snapshot().draft.text, 'B');
  assert.equal(intent.note.text, 'A IME complete');
  assert.equal(intent.note.timestamp, 127);
  s.settleSave(reply(intent));
  s.selectVideo(a);
  assert.equal(s.snapshot().draft, null);
});

test('recovery refuses invalid revisions and a draft from an unrelated lesson', () => {
  const s = fixture();
  const restored = { ownerId: 'old', courseId: a.courseId, videoPath: a.videoPath, timestamp: 19, text: 'Phục hồi', revision: 7, updatedAt: date };
  assert.throws(() => s.selectVideo(a, { ...restored, revision: Infinity }));
  assert.throws(() => s.selectVideo(a, { ...restored, videoPath: b.videoPath }));
  assert.throws(() => s.selectVideo(a, { ...restored, updatedAt: 'invalid date' }));
  s.selectVideo(a, { ...restored, text: '' });
  s.beginNote(300);
  assert.equal(s.snapshot().draft.timestamp, 19);
});
