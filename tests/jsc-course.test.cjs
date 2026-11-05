const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

test('JavaScriptCore native contexts finish course creation and saving without reentrant Promise stalls, and retain the closing draft', {
  skip: process.platform !== 'darwin', timeout: 120000
}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'note-iina-jsc-regression-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { stdout } = await execFile('/usr/bin/swift', [
    path.join(__dirname, 'helpers/jsc-course.swift'), root,
    path.resolve(__dirname, '../note-iina.iinaplugin')
  ], { timeout: 110000, maxBuffer: 1024 * 1024 });
  const course = JSON.parse(await fs.readFile(path.join(root, '.iina-notes.json'), 'utf8'));
  assert.deepEqual(course.notes.map(note => [note.videoPath, note.timestamp, note.text]), [
    ['lecture.mp4', 7, 'Nội dung đã lưu']
  ]);
  const drafts = JSON.parse(await fs.readFile(path.join(root, 'drafts.json'), 'utf8'));
  assert.deepEqual(drafts.drafts.map(draft => [draft.videoPath, draft.timestamp, draft.text]), [
    ['lecture.mp4', 7, 'Nháp giữ khi đóng']
  ]);
  assert.match(stdout, /JSC COURSE READY; NOTE SAVED; FINAL DRAFT RETAINED/);
});
