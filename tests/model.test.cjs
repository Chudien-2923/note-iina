const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../note-iina.iinaplugin/lib/model.js');
const date = '2026-11-05T12:00:00.000Z';
const note = (id, overrides = {}) => ({ id, videoPath: '01/Introduction.mp4', timestamp: 127, text: '  Nội dung\ndòng hai  ', createdAt: date, updatedAt: date, ...overrides });

test('file paths retain identity including Vietnamese, spaces, hashes and literal percent escapes', () => {
  const root = '/Khóa học 100%';
  assert.equal(model.decodeLocalMediaURL('file:///Kh%C3%B3a%20h%E1%BB%8Dc%20100%25/%231%20B%C3%A0i.mp4'), root + '/#1 Bài.mp4');
  assert.equal(model.decodeLocalMediaURL('file:///Courses/a%2520b.mp4'), '/Courses/a%20b.mp4');
  assert.equal(model.decodeLocalMediaURL('file://localhost/Courses/a.mp4'), '/Courses/a.mp4');
  assert.equal(model.decodeLocalMediaURL('https://example.com/a.mp4'), null);
  assert.equal(model.decodeLocalMediaURL('file://server/Courses/a.mp4'), null);
  assert.equal(model.decodeLocalMediaURL('file:///bad%ZZ.mp4'), null);
  assert.equal(model.relativeVideoPath(root, root + '/01/Introduction.mp4'), '01/Introduction.mp4');
  assert.equal(model.relativeVideoPath(root, root + '/02/Introduction.mp4'), '02/Introduction.mp4');
  assert.equal(model.relativeVideoPath('/Courses/./A/', '/Courses/A/chapter/../bài #%.mp4'), 'bài #%.mp4');
  assert.throws(() => model.relativeVideoPath(root, root + ' sibling/a.mp4'));
  assert.throws(() => model.relativeVideoPath(root, root + '/../other/a.mp4'));
  assert.throws(() => model.relativeVideoPath(root, root));
  assert.equal(model.normalizeAbsolutePath('/Courses//A/./b/../'), '/Courses/A');
});

test('macOS composed and decomposed Vietnamese paths share course and lesson identity', () => {
  const root = '/private/Courses/Khóa học 100% #1';
  const video = (root + '/Bài 01/Lecture.mp4').normalize('NFD');
  assert.equal(model.relativeVideoPath(root, video), 'Bài 01/Lecture.mp4');
  assert.equal(model.relativeVideoPath(root.normalize('NFD'), root + '/Bài 01/Lecture.mp4'), 'Bài 01/Lecture.mp4');
  const course = model.applyMutation(model.createCourse('unicode-course'), {
    kind: 'add', note: note('unicode', { videoPath: 'Bài 01/Lecture.mp4'.normalize('NFD') })
  });
  assert.deepEqual(model.selectNotes(course, { videoPath: 'Bài 01/Lecture.mp4' }).map(n => n.id), ['unicode']);
});

test('schema refuses corrupt documents instead of dropping malformed notes', () => {
  assert.throws(() => model.parseCourse('{'));
  const valid = { schemaVersion: 1, courseId: 'course', notes: [note('a')] };
  for (const value of [
    { ...valid, schemaVersion: 2 }, { ...valid, courseId: '' }, { ...valid, notes: [note('a'), note('a')] },
    { ...valid, notes: [note('a', { timestamp: -1 })] }, { ...valid, notes: [note('a', { timestamp: null })] },
    { ...valid, notes: [note('a', { text: ' \n ' })] }, { ...valid, notes: [note('a', { videoPath: '../a.mp4' })] },
    { ...valid, notes: [note('a', { videoPath: '/a.mp4' })] }, { ...valid, notes: [note('a', { createdAt: 'yesterday' })] }
  ]) assert.throws(() => model.parseCourse(JSON.stringify(value)));
  assert.throws(() => model.applyMutation(model.createCourse('course'), { kind: 'add', note: note('a', { timestamp: Infinity }) }));
  assert.throws(() => model.createCourse(''));
});

test('notes at the same timestamp can be independently edited and deleted without mutating callers', () => {
  const empty = model.createCourse('course');
  const original = note('a');
  let course = model.applyMutation(empty, { kind: 'add', note: original });
  course = model.applyMutation(course, { kind: 'add', note: note('b') });
  const edited = model.applyMutation(course, { kind: 'edit', id: 'a', text: ' Đã sửa\nxong ', updatedAt: date });
  assert.equal(edited.notes[0].text, 'Đã sửa\nxong');
  assert.equal(course.notes[0].text, 'Nội dung\ndòng hai');
  assert.equal(original.text, '  Nội dung\ndòng hai  ');
  assert.deepEqual(empty.notes, []);
  assert.deepEqual(model.applyMutation(edited, { kind: 'delete', id: 'a' }).notes.map(n => n.id), ['b']);
  assert.throws(() => model.applyMutation(course, { kind: 'add', note: note('a') }));
  assert.throws(() => model.applyMutation(course, { kind: 'edit', id: 'missing', text: 'x', updatedAt: date }));
  assert.throws(() => model.applyMutation(course, { kind: 'delete', id: 'missing' }));
});

test('course review naturally orders paths then timestamp, creation and ID while retaining Vietnamese search accents', () => {
  let course = model.createCourse('course');
  for (const n of [
    note('ten', { videoPath: 'bài 10.mp4', text: 'Khác' }),
    note('later', { videoPath: 'bài 2.mp4', timestamp: 12, text: 'HỌC\nhiểu' }),
    note('b', { videoPath: 'bài 2.mp4', timestamp: 10, text: 'học lại' }),
    note('a', { videoPath: 'bài 2.mp4', timestamp: 10, text: 'học nữa' }),
    note('older', { videoPath: 'bài 2.mp4', timestamp: 10, createdAt: '2026-11-04T12:00:00.000Z' })
  ]) course = model.applyMutation(course, { kind: 'add', note: n });
  assert.deepEqual(model.selectNotes(course, {}).map(n => n.id), ['older', 'a', 'b', 'later', 'ten']);
  assert.deepEqual(model.selectNotes(course, { videoPath: 'bài 2.mp4', query: 'HỌC' }).map(n => n.id), ['a', 'b', 'later']);
  assert.deepEqual(model.selectNotes(course, { query: 'hoc' }), []);
  assert.deepEqual(model.selectNotes(course, { query: 'không tồn tại' }), []);
  assert.equal(model.selectNotes(course, { query: 'HỌC\nHIỂU' })[0].text, 'HỌC\nhiểu');
});
