const test = require('node:test');
const assert = require('node:assert/strict');
const { createDraftTracker, shortcutAction, formatTimestamp, groupNotes } = require('../note-iina.iinaplugin/ui/shared.js');

const state = (text, revision = 1, videoPath = '/Course/Bài 1.mp4') => ({ videoPath, editorContext: 'context:' + videoPath, draft: text === null ? null : { ownerId: 'player', text, revision } });

test('draft echoes and a late save never replace newer local typing', () => {
  const tracker = createDraftTracker();
  tracker.receive(state('Ý đầu'));
  tracker.type('Ý đầu và một ý mới');
  assert.equal(tracker.receive(state('Ý đầu')).text, 'Ý đầu và một ý mới');
  assert.equal(tracker.receive(state(null)).text, 'Ý đầu và một ý mới');
  assert.equal(tracker.receive(state('Ý đầu và một ý mới', 2)).text, 'Ý đầu và một ý mới');
  assert.equal(tracker.receive(state('Ý đầu', 1)).text, 'Ý đầu và một ý mới');
});

test('confirmed save clears unchanged text but switching lessons replaces the draft', () => {
  const tracker = createDraftTracker();
  tracker.receive(state('Ghi chú'));
  assert.equal(tracker.receive(state(null)).text, '');
  tracker.type('Chưa được host trả lời');
  assert.equal(tracker.receive(state('Bài khác', 1, '/Course/Bài 2.mp4')).text, 'Bài khác');
});

test('a new draft after a confirmed save accepts its restarted revision sequence', () => {
  const tracker = createDraftTracker();
  tracker.receive(state('Ghi chú đã lưu', 12));
  tracker.receive(state(null));
  tracker.type('Ý tiếp theo');
  assert.equal(tracker.receive(state('Ý tiếp theo', 1)).pending, false);
  assert.equal(tracker.receive(state(null)).text, '');
});

test('provisional course binding does not discard unacknowledged typing', () => {
  const tracker = createDraftTracker();
  tracker.receive(state(null));
  tracker.type('Bản nháp đang viết');
  const selected = { ...state(null), binding: { courseId: 'selected', videoPath: 'Bài 1.mp4' } };
  assert.equal(tracker.receive(selected).text, 'Bản nháp đang viết');
});

test('only non-composing Command Enter saves and Escape closes the sidebar only', () => {
  assert.equal(shortcutAction({ key: 'Enter', metaKey: true }, 'sidebar'), 'save');
  assert.equal(shortcutAction({ key: 'Enter', metaKey: true, isComposing: true }, 'sidebar'), null);
  assert.equal(shortcutAction({ key: 'Enter', metaKey: true, keyCode: 229 }, 'sidebar'), null);
  assert.equal(shortcutAction({ key: 'Escape' }, 'sidebar'), 'close');
  assert.equal(shortcutAction({ key: 'Escape' }, 'notebook'), null);
  for (const key of ['n', 'N', ' ', 'Enter']) assert.equal(shortcutAction({ key }, 'sidebar'), null);
});

test('reader groups preserve host order and full paths, not duplicate basenames', () => {
  const notes = [{ id: 'a', videoPath: '02/Bài.mp4' }, { id: 'b', videoPath: '02/Bài.mp4' }, { id: 'c', videoPath: '10/Bài.mp4' }];
  assert.deepEqual(groupNotes(notes).map(group => [group.videoPath, group.notes.map(note => note.id)]), [['02/Bài.mp4', ['a', 'b']], ['10/Bài.mp4', ['c']]]);
  assert.equal(formatTimestamp(127), '2:07');
  assert.equal(formatTimestamp(3661), '1:01:01');
});
