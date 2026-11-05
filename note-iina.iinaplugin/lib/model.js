'use strict';

function fail(message) { throw new Error(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function identifier(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.indexOf('\u0000') !== -1) fail('Invalid ' + name);
  return value;
}
function normalizeAbsolutePath(path) {
  if (typeof path !== 'string' || path.charAt(0) !== '/' || path.indexOf('\u0000') !== -1) fail('Expected an absolute local path');
  var parts = path.normalize('NFC').split('/');
  var result = [];
  parts.forEach(function (part) {
    if (!part || part === '.') return;
    if (part === '..') { if (!result.length) fail('Path escapes filesystem root'); result.pop(); }
    else result.push(part);
  });
  return '/' + result.join('/');
}
function relativePath(value) {
  identifier(value, 'video path');
  if (value.charAt(0) === '/' || value.split('/').some(function (part) { return !part || part === '.' || part === '..'; })) fail('Expected a contained relative video path');
  return value.normalize('NFC');
}
function relativeVideoPath(root, absolutePath) {
  root = normalizeAbsolutePath(root);
  absolutePath = normalizeAbsolutePath(absolutePath);
  var prefix = root === '/' ? '/' : root + '/';
  if (absolutePath.indexOf(prefix) !== 0 || absolutePath === root) fail('Video is outside the course folder');
  return relativePath(absolutePath.slice(prefix.length));
}
function decodeLocalMediaURL(url) {
  if (typeof url !== 'string') return null;
  try {
    if (url.charAt(0) === '/') return normalizeAbsolutePath(url);
    var match = /^file:\/\/([^/]*)(\/[^?#]*)$/i.exec(url);
    if (!match || (match[1] && match[1].toLowerCase() !== 'localhost')) return null;
    return normalizeAbsolutePath(decodeURIComponent(match[2]));
  } catch (_) { return null; }
}
function date(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !isFinite(Date.parse(value))) fail('Invalid ' + name);
  return value;
}
function timestamp(value) {
  if (typeof value !== 'number' || !isFinite(value) || value < 0) fail('Invalid note timestamp');
  return value;
}
function text(value) {
  if (typeof value !== 'string' || !value.trim()) fail('Note text must not be blank');
  return value.trim();
}
function validateNote(note) {
  if (!object(note)) fail('Invalid note record');
  return {
    id: identifier(note.id, 'note ID'), videoPath: relativePath(note.videoPath), timestamp: timestamp(note.timestamp),
    text: text(note.text), createdAt: date(note.createdAt, 'createdAt'), updatedAt: date(note.updatedAt, 'updatedAt')
  };
}
function validateCourse(course) {
  if (!object(course) || course.schemaVersion !== 1 || !Array.isArray(course.notes)) fail('Unsupported or malformed course schema');
  var ids = Object.create(null);
  var notes = course.notes.map(function (note) {
    var accepted = validateNote(note);
    if (ids[accepted.id]) fail('Duplicate note ID: ' + accepted.id);
    ids[accepted.id] = true;
    return accepted;
  });
  return { schemaVersion: 1, courseId: identifier(course.courseId, 'course ID'), notes: notes };
}
function parseCourse(source) {
  if (typeof source !== 'string') fail('Course document must be text');
  return validateCourse(JSON.parse(source));
}
function createCourse(courseId) {
  return { schemaVersion: 1, courseId: identifier(courseId, 'course ID'), notes: [] };
}
function applyMutation(course, mutation) {
  var next = validateCourse(course);
  if (!object(mutation)) fail('Invalid course mutation');
  if (mutation.kind === 'add') {
    var added = validateNote(mutation.note);
    if (next.notes.some(function (note) { return note.id === added.id; })) fail('Duplicate note ID: ' + added.id);
    next.notes.push(added);
  } else if (mutation.kind === 'edit' || mutation.kind === 'delete') {
    identifier(mutation.id, 'note ID');
    var index = next.notes.findIndex(function (note) { return note.id === mutation.id; });
    if (index < 0) fail('Note does not exist: ' + mutation.id);
    if (mutation.kind === 'delete') next.notes.splice(index, 1);
    else {
      next.notes[index].text = text(mutation.text);
      next.notes[index].updatedAt = date(mutation.updatedAt, 'updatedAt');
    }
  } else fail('Unknown course mutation');
  return next;
}
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function naturalPathCompare(a, b) {
  var left = a.toLowerCase().match(/\d+|\D+/g) || [];
  var right = b.toLowerCase().match(/\d+|\D+/g) || [];
  for (var i = 0; i < Math.min(left.length, right.length); i++) {
    var l = left[i]; var r = right[i]; var order;
    if (/^\d+$/.test(l) && /^\d+$/.test(r)) {
      l = l.replace(/^0+/, '') || '0'; r = r.replace(/^0+/, '') || '0';
      order = compare(l.length, r.length) || compare(l, r);
    } else order = compare(l, r);
    if (order) return order;
  }
  return compare(left.length, right.length) || compare(a, b);
}
function selectNotes(course, options) {
  options = options || {};
  var query = typeof options.query === 'string' ? options.query.toLowerCase() : '';
  return course.notes.filter(function (note) {
    return (options.videoPath == null || note.videoPath === options.videoPath) && (!query || note.text.toLowerCase().indexOf(query) !== -1);
  }).slice().sort(function (a, b) {
    return naturalPathCompare(a.videoPath, b.videoPath) || a.timestamp - b.timestamp || compare(Date.parse(a.createdAt), Date.parse(b.createdAt)) || compare(a.id, b.id);
  });
}

module.exports = {
  parseCourse: parseCourse, createCourse: createCourse, applyMutation: applyMutation,
  relativeVideoPath: relativeVideoPath, decodeLocalMediaURL: decodeLocalMediaURL,
  normalizeAbsolutePath: normalizeAbsolutePath, selectNotes: selectNotes
};
