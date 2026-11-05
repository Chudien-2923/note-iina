'use strict';

const { file, utils, global: transport } = iina;
const { createStore } = require('./lib/store.js');
const { normalizeAbsolutePath } = require('./lib/model.js');

const store = createStore({
  readText: path => file.read(path),
  writeText: (path, text) => file.write(path, text),
  exists: path => file.exists(path),
  draftPath: utils.resolvePath('@data/drafts.json'),
  async replaceFile(temp, destination) {
    const result = await utils.exec('/bin/mv', ['-f', temp, destination]);
    if (!result || result.status !== 0) {
      throw new Error('Không thay được file ' + destination + ': ' +
        (result && result.stderr ? result.stderr.trim() : 'lệnh mv thất bại'));
    }
  }
});

// Reads share the writer queue, so an older read can never acquire a newer version.
const queues = new Map();
const versions = new Map();
const playerOwners = new Map();
function deliver(label, ownerId, name, payload) {
  // JavaScriptCore drains Promise jobs during the native instance initializer.
  // The next main-loop turn is the first safe point to resolve its pluginMap.
  setTimeout(() => {
    if (playerOwners.get(label) === ownerId) transport.postMessage(label, name, payload);
  }, 0);
}
transport.onMessage('unregister-player', (request, senderLabel) => {
  if (request && playerOwners.get(senderLabel) === request.ownerId) playerOwners.delete(senderLabel);
});
transport.onMessage('save-final-draft', request => {
  if (!request || !request.draft || request.draft.ownerId !== request.ownerId) return;
  store.saveDraft(request.draft).catch(error => {
    iina.console.error('Không lưu được bản nháp khi đóng player: ' + errorText(error));
  });
});
function courseTask(root, operation) {
  root = normalizeAbsolutePath(root);
  const previous = queues.get(root) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(root, next);
  next.then(() => { if (queues.get(root) === next) queues.delete(root); },
    () => { if (queues.get(root) === next) queues.delete(root); });
  return next;
}
function errorText(error) {
  return error && error.message ? error.message : String(error);
}
function register(name, operation) {
  transport.onMessage(name, (request, senderLabel) => {
    if (!request || typeof request.requestId !== 'string' || typeof request.ownerId !== 'string' || typeof senderLabel !== 'string') return;
    // Native labels come from IINA's callback, never from the DOM/envelope.
    playerOwners.set(senderLabel, request.ownerId);
    const identity = {
      requestId: request.requestId, courseId: request.courseId,
      videoPath: request.videoPath, courseRoot: request.courseRoot
    };
    Promise.resolve().then(() => operation(request)).then(result => {
      deliver(senderLabel, request.ownerId, 'reply', Object.assign(identity, { ok: true }, result));
    }, error => {
      deliver(senderLabel, request.ownerId, 'reply', Object.assign(identity, { ok: false, error: errorText(error) }));
    });
  });
}
function readOrWrite(request, operation, publish) {
  return courseTask(request.courseRoot, async () => {
    const course = await operation();
    const courseVersion = (versions.get(request.courseRoot) || 0) + 1;
    versions.set(request.courseRoot, courseVersion);
    if (publish) playerOwners.forEach((ownerId, label) => deliver(label, ownerId, 'course-changed', {
      courseRoot: request.courseRoot, courseId: course.courseId, course, courseVersion
    }));
    return { data: course, courseVersion };
  });
}
register('load-course', request => readOrWrite(request,
  () => store.readCourse(request.courseRoot), false));
register('create-course', request => readOrWrite(request,
  () => store.createCourse(request.courseRoot, request.courseId), true));
register('mutate-course', request => readOrWrite(request,
  () => store.commit(request.courseRoot, request.courseId, request.mutation), true));
register('save-draft', async request => { await store.saveDraft(request.draft); return {}; });
register('list-drafts', async request => ({ data: await store.listDrafts(request.courseId, request.videoPath) }));
register('clear-draft', async request => { await store.clearDraft(request.draft); return {}; });
