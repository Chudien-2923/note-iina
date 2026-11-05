'use strict';

var model = require('./model.js');
var temporarySequence = 0;
var instanceSequence = 0;

function copyDraft(draft) {
  if (!draft || typeof draft !== 'object') throw new Error('Invalid draft');
  return {
    ownerId: draft.ownerId, courseId: draft.courseId, videoPath: draft.videoPath,
    timestamp: draft.timestamp, text: draft.text, revision: draft.revision, updatedAt: draft.updatedAt
  };
}
function validateDraft(value) {
  var draft = copyDraft(value);
  ['ownerId', 'courseId', 'videoPath'].forEach(function (key) {
    if (typeof draft[key] !== 'string' || !draft[key].trim() || draft[key].indexOf('\u0000') !== -1) throw new Error('Invalid draft ' + key);
  });
  draft.videoPath = draft.videoPath.normalize('NFC');
  if (draft.courseId === 'pending') draft.videoPath = model.normalizeAbsolutePath(draft.videoPath);
  else if (draft.videoPath.charAt(0) === '/' || model.relativeVideoPath('/draft-course', '/draft-course/' + draft.videoPath) !== draft.videoPath) invalidPath();
  if (typeof draft.timestamp !== 'number' || !isFinite(draft.timestamp) || draft.timestamp < 0) throw new Error('Invalid draft timestamp');
  if (typeof draft.text !== 'string') throw new Error('Invalid draft text');
  if (typeof draft.revision !== 'number' || !isFinite(draft.revision) || draft.revision < 0 || Math.floor(draft.revision) !== draft.revision) throw new Error('Invalid draft revision');
  if (typeof draft.updatedAt !== 'string' || !isFinite(Date.parse(draft.updatedAt))) throw new Error('Invalid draft updatedAt');
  return draft;
}
function invalidPath() { throw new Error('Invalid draft video path'); }
function draftKey(draft) { return JSON.stringify([draft.ownerId, draft.courseId, draft.videoPath]); }
function createStore(io) {
  if (!io || ['readText', 'writeText', 'exists', 'replaceFile'].some(function (name) { return typeof io[name] !== 'function'; })) throw new Error('Store requires filesystem IO');
  var draftPath = model.normalizeAbsolutePath(io.draftPath);
  var queues = Object.create(null);
  var draftsTail = Promise.resolve();
  var instance = ++instanceSequence;
  function enqueue(root, action) {
    root = model.normalizeAbsolutePath(root);
    var result = (queues[root] || Promise.resolve()).then(function () { return action(root); });
    queues[root] = result.then(function () {}, function () {});
    return result;
  }
  function enqueueDraft(action) {
    var result = draftsTail.then(action);
    draftsTail = result.then(function () {}, function () {});
    return result;
  }
  function sidecar(root) { return (root === '/' ? '' : root) + '/.iina-notes.json'; }
  function atomicWrite(destination, document) {
    var temporary = destination + '.tmp-' + instance + '-' + Date.now() + '-' + (++temporarySequence);
    var source = JSON.stringify(document, null, 2) + '\n';
    return Promise.resolve().then(function () { return io.writeText(temporary, source); })
      .then(function () { return io.replaceFile(temporary, destination); });
  }
  function readCourseAt(root) {
    var path = sidecar(root);
    return Promise.resolve().then(function () { return io.exists(path); }).then(function (exists) {
      if (!exists) return null;
      return Promise.resolve(io.readText(path)).then(model.parseCourse);
    });
  }
  function readDraftDocument() {
    return Promise.resolve().then(function () { return io.exists(draftPath); }).then(function (exists) {
      if (!exists) return { schemaVersion: 1, drafts: [] };
      return Promise.resolve(io.readText(draftPath)).then(function (source) {
        var document = JSON.parse(source);
        if (!document || document.schemaVersion !== 1 || !Array.isArray(document.drafts)) throw new Error('Unsupported or malformed draft schema');
        var originalKeys = Object.create(null);
        var seen = Object.create(null);
        return { schemaVersion: 1, drafts: document.drafts.map(function (value) {
          var original = draftKey(value);
          if (originalKeys[original]) throw new Error('Duplicate draft identity');
          originalKeys[original] = true;
          var draft = validateDraft(value); var key = draftKey(draft);
          // Legacy NFC/NFD spellings may converge. Preserve each record for
          // explicit recovery instead of dropping text or blocking all courses.
          var suffix = 0;
          var ownerId = draft.ownerId;
          while (seen[key]) {
            draft.ownerId = ownerId + ':unicode-recovery-' + (++suffix);
            key = draftKey(draft);
          }
          seen[key] = true;
          return draft;
        }) };
      });
    });
  }
  return {
    readCourse: function (root) { return enqueue(root, readCourseAt); },
    createCourse: function (root, courseId) {
      return enqueue(root, function (normalized) {
        return Promise.resolve(io.exists(sidecar(normalized))).then(function (exists) {
          if (exists) throw new Error('A course sidecar already exists; it will not be overwritten');
          var course = model.createCourse(courseId);
          return atomicWrite(sidecar(normalized), course).then(function () { return course; });
        });
      });
    },
    commit: function (root, expectedCourseId, mutation) {
      // Capture the caller's intent before it waits behind another player's write.
      var captured = mutation && { kind: mutation.kind, id: mutation.id, text: mutation.text, updatedAt: mutation.updatedAt, note: mutation.note && {
        id: mutation.note.id, videoPath: mutation.note.videoPath, timestamp: mutation.note.timestamp,
        text: mutation.note.text, createdAt: mutation.note.createdAt, updatedAt: mutation.note.updatedAt
      } };
      return enqueue(root, function (normalized) {
        return readCourseAt(normalized).then(function (course) {
          if (!course) throw new Error('Course sidecar does not exist; choose or create a course first');
          if (course.courseId !== expectedCourseId) throw new Error('Course identity changed; reload before saving');
          var next = model.applyMutation(course, captured);
          return atomicWrite(sidecar(normalized), next).then(function () { return next; });
        });
      });
    },
    saveDraft: function (value) {
      var captured = copyDraft(value);
      return enqueueDraft(function () {
        var draft = validateDraft(captured);
        return readDraftDocument().then(function (document) {
          var key = draftKey(draft);
          var index = document.drafts.findIndex(function (item) { return draftKey(item) === key; });
          if (index >= 0 && document.drafts[index].revision >= draft.revision) return;
          if (index < 0) document.drafts.push(draft);
          else document.drafts[index] = draft;
          return atomicWrite(draftPath, document);
        });
      });
    },
    listDrafts: function (courseId, videoPath) {
      videoPath = videoPath.normalize('NFC');
      if (courseId === 'pending') videoPath = model.normalizeAbsolutePath(videoPath);
      return enqueueDraft(function () {
        return readDraftDocument().then(function (document) {
          return document.drafts.filter(function (draft) { return draft.courseId === courseId && draft.videoPath === videoPath; });
        });
      });
    },
    clearDraft: function (value) {
      var captured = copyDraft(value);
      return enqueueDraft(function () {
        var draft = validateDraft(captured);
        return readDraftDocument().then(function (document) {
          var key = draftKey(draft);
          var index = document.drafts.findIndex(function (item) { return draftKey(item) === key && item.revision === draft.revision; });
          if (index < 0) return;
          document.drafts.splice(index, 1);
          return atomicWrite(draftPath, document);
        });
      });
    }
  };
}

module.exports = { createStore: createStore };
