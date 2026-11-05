'use strict';

var model = require('./model.js');
function bindingCopy(binding) {
  return binding && { courseRoot: binding.courseRoot, courseId: binding.courseId, videoPath: binding.videoPath };
}
function draftCopy(draft) {
  return draft && { ownerId: draft.ownerId, courseId: draft.courseId, videoPath: draft.videoPath, timestamp: draft.timestamp, text: draft.text, revision: draft.revision, updatedAt: draft.updatedAt };
}
function key(binding) { return JSON.stringify([binding.courseRoot, binding.courseId, binding.videoPath]); }
function validPosition(position) {
  if (typeof position !== 'number' || !isFinite(position) || position < 0) throw new Error('Invalid playback position');
  return position;
}
function validBinding(binding) {
  if (!binding || typeof binding.courseId !== 'string' || !binding.courseId.trim()) throw new Error('Invalid course binding');
  if (binding.courseId === 'pending' && binding.courseRoot === '') model.normalizeAbsolutePath(binding.videoPath);
  else {
    model.normalizeAbsolutePath(binding.courseRoot);
    if (typeof binding.videoPath !== 'string' || binding.videoPath.charAt(0) === '/' || model.relativeVideoPath(binding.courseRoot, binding.courseRoot + '/' + binding.videoPath) !== binding.videoPath) throw new Error('Invalid video binding');
  }
  return bindingCopy(binding);
}
function createSession(options) {
  if (!options || typeof options.ownerId !== 'string' || !options.ownerId.trim() || typeof options.makeId !== 'function' || typeof options.now !== 'function') throw new Error('Session requires owner, ID generator and clock');
  var ownerId = options.ownerId;
  var entries = Object.create(null);
  var current = null;
  var pendingSave = null;
  var pendingSeek = null;
  var superseded = Object.create(null);
  function entry(binding) { return binding ? entries[key(binding)] : current ? entries[key(current)] : null; }
  function seekIdentity(url) {
    var path = model.decodeLocalMediaURL(url);
    if (path === null) throw new Error('Navigation requires a local media URL');
    return path;
  }
  function captureIntent(intent) {
    return {
      requestId: intent.requestId, binding: bindingCopy(intent.binding), draft: draftCopy(intent.draft),
      note: { id: intent.note.id, videoPath: intent.note.videoPath, timestamp: intent.note.timestamp, text: intent.note.text, createdAt: intent.note.createdAt, updatedAt: intent.note.updatedAt }
    };
  }
  return {
    selectVideo: function (binding, restored) {
      if (binding == null) { current = null; return; }
      var accepted = validBinding(binding);
      var identity = key(accepted);
      var selected = entries[identity];
      if (!selected) selected = entries[identity] = { binding: accepted, draft: null, revision: 0, error: null };
      // Supplying a recovered draft is an explicit restore; the host guards asynchronous reads.
      if (restored) {
        if (typeof restored.text !== 'string' || typeof restored.revision !== 'number' || !isFinite(restored.revision) || restored.revision < 0 || Math.floor(restored.revision) !== restored.revision || typeof restored.updatedAt !== 'string' || !isFinite(Date.parse(restored.updatedAt))) throw new Error('Invalid recovered draft');
        validPosition(restored.timestamp);
        if (restored.courseId !== accepted.courseId || restored.videoPath !== accepted.videoPath) {
          var provisionalPath = restored.courseId === 'pending' ? model.normalizeAbsolutePath(restored.videoPath) : null;
          if (provisionalPath === null || accepted.courseId === 'pending' || model.relativeVideoPath(accepted.courseRoot, provisionalPath) !== accepted.videoPath) throw new Error('Recovered draft belongs to another video');
        }
        var revision = selected.revision === 0 ? restored.revision : Math.max(selected.revision + 1, restored.revision);
        selected.draft = {
          ownerId: ownerId, courseId: accepted.courseId, videoPath: accepted.videoPath,
          timestamp: restored.timestamp, text: restored.text, revision: revision, updatedAt: restored.updatedAt
        };
        selected.revision = revision;
      }
      // Only an accepted migration/explicit restore retires its provisional cache.
      var source = restored && restored.courseId === 'pending' ?
        { courseRoot: '', courseId: 'pending', videoPath: restored.videoPath } : current;
      if (restored && accepted.courseId !== 'pending' && source && source.courseId === 'pending' && source.courseRoot === '') {
        var destination = model.normalizeAbsolutePath(accepted.courseRoot + '/' + accepted.videoPath);
        if (model.normalizeAbsolutePath(source.videoPath) === destination) delete entries[key(source)];
      }
      current = accepted;
    },
    beginNote: function (position, binding) {
      var selected = entry(binding);
      if (!selected) return null;
      if (selected.draft) return draftCopy(selected.draft);
      selected.revision += 1;
      selected.draft = {
        ownerId: ownerId, courseId: selected.binding.courseId, videoPath: selected.binding.videoPath,
        timestamp: validPosition(position), text: '', revision: selected.revision, updatedAt: options.now()
      };
      selected.error = null;
      return draftCopy(selected.draft);
    },
    changeText: function (text, binding) {
      if (typeof text !== 'string') throw new Error('Draft text must be a string');
      var selected = entry(binding);
      if (!selected || !selected.draft) return null;
      selected.revision += 1;
      selected.draft = {
        ownerId: ownerId, courseId: selected.binding.courseId, videoPath: selected.binding.videoPath,
        timestamp: selected.draft.timestamp, text: text, revision: selected.revision, updatedAt: options.now()
      };
      selected.error = null;
      return draftCopy(selected.draft);
    },
    startSave: function (binding) {
      var selected = entry(binding);
      if (pendingSave || !selected || selected.binding.courseId === 'pending' || !selected.draft || !selected.draft.text.trim()) return null;
      var date = options.now();
      pendingSave = {
        requestId: options.makeId(), binding: bindingCopy(selected.binding), draft: draftCopy(selected.draft),
        note: { id: options.makeId(), videoPath: selected.binding.videoPath, timestamp: selected.draft.timestamp, text: selected.draft.text.trim(), createdAt: date, updatedAt: date }
      };
      selected.error = null;
      return captureIntent(pendingSave);
    },
    settleSave: function (reply) {
      if (!pendingSave || !reply || reply.requestId !== pendingSave.requestId || reply.courseId !== pendingSave.binding.courseId || reply.videoPath !== pendingSave.binding.videoPath) return;
      var intent = pendingSave;
      pendingSave = null;
      var selected = entries[key(intent.binding)];
      var matches = selected && selected.draft && selected.draft.ownerId === intent.draft.ownerId && selected.draft.revision === intent.draft.revision;
      if (reply.ok === true) {
        if (matches) selected.draft = null;
        if (selected) selected.error = null;
      } else if (selected) selected.error = typeof reply.error === 'string' && reply.error ? reply.error : 'Could not save note';
    },
    beginSeek: function (url, timestamp) {
      var identity = seekIdentity(url);
      validPosition(timestamp);
      if (pendingSeek && pendingSeek.identity !== identity) superseded[pendingSeek.identity] = true;
      delete superseded[identity];
      pendingSeek = { identity: identity, url: url, timestamp: timestamp };
    },
    takePendingSeek: function (loadedURL) {
      var identity = model.decodeLocalMediaURL(loadedURL);
      if (!pendingSeek) return null;
      if (identity === pendingSeek.identity) {
        var result = { url: pendingSeek.url, timestamp: pendingSeek.timestamp };
        pendingSeek = null;
        superseded = Object.create(null);
        return result;
      }
      if (identity !== null && superseded[identity]) { delete superseded[identity]; return null; }
      pendingSeek = null;
      superseded = Object.create(null);
      return null;
    },
    cancelSeek: function () { pendingSeek = null; superseded = Object.create(null); },
    snapshot: function (binding) {
      var selected = entry(binding);
      return { binding: bindingCopy(binding || current), draft: selected ? draftCopy(selected.draft) : null, saving: pendingSave !== null, error: selected ? selected.error : null };
    }
  };
}

module.exports = { createSession: createSession };
