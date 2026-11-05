'use strict';

const { core, event, file, utils, input, menu, sidebar, standaloneWindow, global: transport } = iina;
const model = require('./lib/model.js');
const { createSession } = require('./lib/session.js');
let sequence = 0;
const ownerId = 'player-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
const makeId = () => ownerId + '-' + (++sequence);
const session = createSession({ ownerId, makeId, now: () => new Date().toISOString() });
const requests = new Map();
const listeners = [];
const ready = { sidebar: false, notebook: false };
let disposed = false;
let selectionEpoch = 0;
let currentPath = null;
let course = null;
let courseVersion = 0;
let adoptingCourse = null;
let navigationSource = null;
let status = 'no-video';
let message = 'Mở một video cục bộ để ghi chú.';
let hostError = null;
let recoveryDrafts = [];
let readerQuery = '';
let readerVideoPath = null;
let focusPending = false;
let notebookLoaded = false;
let keyConflict = null;
let keyRegistered = false;
let draftActivity = 0;
const editorContexts = new Map();
let editorContext = null;
let sidebarLoaded = false;
let sidebarRequested = false;

function issueEditorContext(binding) {
  editorContext = binding ? makeId() : null;
  if (binding) editorContexts.set(editorContext, {
    binding, position: Math.max(0, Number(core.status.position) || 0)
  });
}
function resolveEditorContext(payload) {
  return payload && typeof payload.editorContext === 'string' ? editorContexts.get(payload.editorContext) : null;
}
function pendingBinding(path) { return { courseRoot: '', courseId: 'pending', videoPath: path }; }
function recoveryChoices(candidates, active) {
  const unique = new Map();
  candidates.filter(draft => draft && draft.text.trim()).forEach(draft => {
    if (draftFingerprint(draft) !== draftFingerprint(active)) {
      const identity = [draft.ownerId, draft.courseId, draft.videoPath].join('\u0000');
      const previous = unique.get(identity);
      if (!previous || previous.revision < draft.revision) unique.set(identity, draft);
    }
  });
  return Array.from(unique.values());
}

function parentPath(path) {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}
function basename(path) { return path.slice(path.lastIndexOf('/') + 1) || path; }
function sameBinding(a, b) {
  return !!a && !!b && a.courseRoot === b.courseRoot && a.courseId === b.courseId && a.videoPath === b.videoPath;
}
function errorText(error) { return error && error.message ? error.message : String(error); }
function localPath(url) {
  const path = model.decodeLocalMediaURL(url);
  return path ? model.normalizeAbsolutePath(path) : null;
}
function livePath() {
  if (disposed || core.status.idle) return null;
  // IINA 1.5 decodes status.url already; '%' and '#' here are filename bytes,
  // not URI escapes/fragments. File-loaded event URLs remain encoded.
  const url = core.status.url;
  if (typeof url !== 'string') return null;
  const match = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(url);
  if (!match) return null;
  try { return model.normalizeAbsolutePath(match[1]); } catch (_) { return null; }
}
function rpc(name, binding, fields, requestId) {
  return new Promise((resolve, reject) => {
    const envelope = Object.assign({}, binding || {}, fields || {}, { ownerId, requestId: requestId || makeId() });
    requests.set(envelope.requestId, { resolve, reject, envelope, name });
    // Crossing back into the global JSContext from its own reply callback
    // can strand JavaScriptCore Promise jobs. Start a fresh native turn.
    setTimeout(() => {
      if (disposed) { requests.delete(envelope.requestId); reject(new Error('Player đã đóng.')); return; }
      try { transport.postMessage(name, envelope); }
      catch (error) { requests.delete(envelope.requestId); reject(error); }
    }, 0);
  });
}
transport.onMessage('reply', reply => {
  if (!reply || disposed) return;
  const pending = requests.get(reply.requestId);
  if (!pending || reply.courseId !== pending.envelope.courseId || reply.videoPath !== pending.envelope.videoPath) return;
  requests.delete(reply.requestId);
  if (reply.ok) pending.resolve(reply);
  else pending.reject(new Error(reply.error || 'Không hoàn tất được thao tác lưu trữ.'));
});

function state() {
  const snapshot = session.snapshot();
  const binding = snapshot.binding;
  const readerCourse = course || (navigationSource && navigationSource.course);
  const allNotes = readerCourse ? model.selectNotes(readerCourse, {}) : [];
  return {
    status, message, error: hostError || snapshot.error,
    videoTitle: currentPath ? basename(currentPath) : '', videoPath: currentPath,
    courseName: binding && binding.courseRoot ? basename(binding.courseRoot) :
      navigationSource ? basename(navigationSource.binding.courseRoot) : '', binding,
    notes: course && binding ? model.selectNotes(course, { videoPath: binding.videoPath }) : [],
    allNotes,
    readerNotes: readerCourse ? model.selectNotes(readerCourse, {
      query: readerQuery, ...(readerVideoPath === null ? {} : { videoPath: readerVideoPath })
    }) : [],
    readerQuery, readerVideoPath, draft: snapshot.draft, recoveryDrafts, editorContext,
    saving: snapshot.saving, keyConflict, theme: null
  };
}
function render() {
  if (disposed) return;
  const next = state();
  if (ready.sidebar) sidebar.postMessage('state', next);
  if (ready.notebook) standaloneWindow.postMessage('state', next);
}
function fail(error) {
  if (disposed) return;
  hostError = errorText(error);
  render();
}
function acceptCourse(nextCourse, version, root) {
  const binding = session.snapshot().binding;
  if (!binding || binding.courseRoot !== root || !nextCourse || binding.courseId !== nextCourse.courseId) return;
  if (typeof version === 'number' && version < courseVersion) return;
  course = nextCourse;
  courseVersion = version || courseVersion;
  render();
}
transport.onMessage('course-changed', update => {
  if (disposed || !update) return;
  if (adoptingCourse && adoptingCourse.epoch === selectionEpoch &&
      adoptingCourse.root === update.courseRoot && adoptingCourse.courseId === update.courseId &&
      update.course && update.courseVersion > adoptingCourse.version) {
    adoptingCourse.course = update.course;
    adoptingCourse.version = update.courseVersion;
  }
  acceptCourse(update.course, update.courseVersion, update.courseRoot);
});

function persistDraft(draft, binding) {
  if (!draft) return Promise.resolve();
  return rpc('save-draft', binding || session.snapshot().binding, { draft });
}
function persistCurrent() {
  const snapshot = session.snapshot();
  if (snapshot.draft) persistDraft(snapshot.draft, snapshot.binding).catch(error => {
    if (sameBinding(snapshot.binding, session.snapshot().binding)) fail(error);
  });
}
function draftFingerprint(draft) {
  return draft ? [draft.ownerId, draft.courseId, draft.videoPath, draft.revision, draft.updatedAt, draft.text].join('\u0000') : '';
}
function recoverFor(binding, epoch) {
  const before = draftFingerprint(session.snapshot().draft);
  const activity = draftActivity;
  Promise.all([
    rpc('list-drafts', binding),
    binding.courseId === 'pending' ? Promise.resolve({ data: [] }) : rpc('list-drafts', pendingBinding(currentPath))
  ]).then(replies => {
    if (disposed || epoch !== selectionEpoch || !sameBinding(binding, session.snapshot().binding)) return;
    const candidates = recoveryChoices(replies[0].data.concat(replies[1].data), null);
    recoveryDrafts = candidates;
    const active = session.snapshot().draft;
    // A read may finish after typing or an N-created draft; never roll either back.
    if (activity === draftActivity && draftFingerprint(active) === before &&
        !(active && active.text.trim()) && candidates.length === 1 && candidates[0].courseId === binding.courseId) {
      restoreDraft(candidates[0], false);
    } else {
      recoveryDrafts = recoveryChoices(candidates, active);
      render();
    }
  }).catch(error => {
    if (epoch === selectionEpoch && sameBinding(binding, session.snapshot().binding)) fail(error);
  });
}
function restoreDraft(draft, confirmReplacement) {
  const binding = session.snapshot().binding;
  if (!binding || !draft) return;
  const active = session.snapshot().draft;
  if (confirmReplacement && active && active.text.trim() &&
      !utils.ask('Thay nội dung bản nháp đang viết bằng bản nháp được chọn?')) return;
  const sourceBinding = draft.courseId === 'pending' ? pendingBinding(draft.videoPath) : binding;
  session.selectVideo(binding, draft);
  if (!sameBinding(sourceBinding, binding)) {
    for (const context of editorContexts.values()) {
      if (sameBinding(context.binding, sourceBinding)) context.binding = binding;
    }
  }
  draftActivity++;
  recoveryDrafts = recoveryDrafts.filter(item => draftFingerprint(item) !== draftFingerprint(draft));
  hostError = null;
  render();
  persistDraft(session.snapshot().draft, binding).then(() => {
    if (draft.ownerId !== ownerId || !sameBinding(sourceBinding, binding)) return rpc('clear-draft', sourceBinding, { draft });
  }).catch(fail);
}

async function adoptCourse(root, reply, epoch) {
  if (disposed || epoch !== selectionEpoch || !currentPath) return;
  const loaded = reply.data;
  if (!loaded) throw new Error('Không tìm thấy file ghi chú course.');
  const path = currentPath;
  const binding = { courseRoot: root, courseId: loaded.courseId, videoPath: model.relativeVideoPath(root, path) };
  const adoption = { root, courseId: loaded.courseId, epoch, course: loaded, version: reply.courseVersion || 0 };
  adoptingCourse = adoption;
  // Resolve both durable owners before migrating. Early N is only a provisional
  // editor, not permission to replace an existing lesson draft.
  const replies = await Promise.all([
    rpc('list-drafts', binding), rpc('list-drafts', pendingBinding(path))
  ]);
  if (disposed || epoch !== selectionEpoch || currentPath !== path) return;
  const previous = session.snapshot();
  const provisional = previous.binding && previous.binding.courseId === 'pending' ? previous.draft : null;
  const candidates = recoveryChoices(replies[0].data, null);
  const cached = session.snapshot(binding).draft;
  const restored = !(cached && cached.text.trim()) ?
    candidates.find(draft => draft.ownerId === ownerId) || (candidates.length === 1 ? candidates[0] : null) : null;
  const destination = restored || cached;
  const migrate = !(destination && destination.text.trim()) && candidates.length === 0;
  if (migrate && provisional) session.selectVideo(binding, provisional);
  else {
    session.selectVideo(binding);
    if (restored) session.selectVideo(binding, restored);
  }
  if (migrate) {
    for (const context of editorContexts.values()) {
      if (sameBinding(context.binding, previous.binding)) context.binding = binding;
    }
  } else issueEditorContext(binding);
  course = adoption.course;
  courseVersion = adoption.version;
  adoptingCourse = null;
  navigationSource = null;
  status = 'ready';
  message = null;
  hostError = null;
  recoveryDrafts = recoveryChoices(candidates.filter(draft => draft !== restored)
    .concat(replies[1].data, migrate ? [] : [provisional]), session.snapshot().draft);
  render();
  if (migrate && provisional) {
    persistDraft(session.snapshot().draft, binding).then(() =>
      rpc('clear-draft', previous.binding, { draft: provisional })).catch(fail);
  } else if (restored) {
    persistDraft(session.snapshot().draft, binding).then(() => {
      if (restored.ownerId !== ownerId) return rpc('clear-draft', binding, { draft: restored });
    }).catch(fail);
  }
}
async function discoverCourse(path, epoch) {
  let root = parentPath(path);
  try {
    while (true) {
      if (file.exists(root + (root === '/' ? '' : '/') + '.iina-notes.json')) {
        const reply = await rpc('load-course', { courseRoot: root, courseId: 'pending', videoPath: path });
        await adoptCourse(root, reply, epoch);
        return;
      }
      if (root === '/') break;
      root = parentPath(root);
    }
    if (disposed || epoch !== selectionEpoch) return;
    status = 'choose-course';
    message = 'Chọn folder course chứa video. Bản nháp được giữ trong khi chọn.';
    render();
    recoverFor(session.snapshot().binding, epoch);
  } catch (error) {
    if (disposed || epoch !== selectionEpoch) return;
    status = 'error';
    hostError = 'Không đọc được course: ' + errorText(error);
    render();
  }
}
function selectPath(path, force) {
  if (disposed || (!force && path === currentPath)) return;
  persistCurrent();
  if (navigationSource) {
    try {
      if (!path) navigationSource = null;
      else model.relativeVideoPath(navigationSource.binding.courseRoot, path);
    } catch (_) { navigationSource = null; }
  }
  currentPath = path;
  selectionEpoch++;
  course = null;
  courseVersion = 0;
  recoveryDrafts = [];
  readerVideoPath = null;
  hostError = null;
  if (!path) {
    session.selectVideo(null);
    issueEditorContext(null);
    status = 'no-video';
    message = 'Chỉ hỗ trợ video cục bộ; mở một file video để ghi chú.';
    render();
    return;
  }
  const provisional = pendingBinding(path);
  session.selectVideo(provisional);
  issueEditorContext(provisional);
  status = 'loading';
  message = 'Đang tìm course…';
  render();
  discoverCourse(path, selectionEpoch);
}
function syncVideo() {
  if (!disposed) selectPath(livePath(), false);
}
async function chooseCourse(useCurrent) {
  syncVideo();
  if (!currentPath || disposed) return;
  let epoch = selectionEpoch;
  const path = currentPath;
  try {
    let root;
    if (useCurrent) {
      root = parentPath(path);
      if (!utils.ask('Dùng folder này làm course?\n' + root)) return;
    } else {
      root = await utils.chooseFile('Chọn folder course chứa video hiện tại', { chooseDir: true });
      if (!root) return;
      root = model.normalizeAbsolutePath(root);
    }
    model.relativeVideoPath(root, path); // Reject unrelated folders before creating anything.
    if (disposed || epoch !== selectionEpoch) return;
    // A confirmed choice supersedes discovery and any earlier chooser reply.
    epoch = ++selectionEpoch;
    const identity = { courseRoot: root, courseId: 'pending', videoPath: path };
    let reply = await rpc('load-course', identity);
    if (disposed || epoch !== selectionEpoch) return;
    if (!reply.data) {
      const courseId = makeId();
      reply = await rpc('create-course', { courseRoot: root, courseId, videoPath: path });
    }
    await adoptCourse(root, reply, epoch);
  } catch (error) {
    if (disposed || epoch !== selectionEpoch) return;
    hostError = 'Không chọn/lưu được course: ' + errorText(error);
    render();
  }
}
function requestFocus() {
  focusPending = true;
  if (ready.sidebar) { sidebar.postMessage('focus-editor', {}); focusPending = false; }
}
function openNotes() {
  if (disposed) return;
  syncVideo();
  if (currentPath) {
    draftActivity++;
    session.beginNote(Math.max(0, Number(core.status.position) || 0));
    render();
  }
  sidebarRequested = true;
  if (sidebarLoaded) sidebar.show();
  requestFocus();
}
function changeDraft(payload) {
  if (!payload || typeof payload.text !== 'string' || disposed) return;
  const context = resolveEditorContext(payload);
  if (!context) return;
  syncVideo();
  draftActivity++;
  const position = sameBinding(context.binding, session.snapshot().binding) ?
    Math.max(0, Number(core.status.position) || 0) : context.position;
  session.beginNote(position, context.binding);
  const draft = session.changeText(payload.text, context.binding);
  if (!draft) return;
  hostError = null;
  persistDraft(draft, context.binding).catch(fail);
  if (context.binding.courseId === 'pending' && currentPath === context.binding.videoPath &&
      session.snapshot().binding.courseId !== 'pending') {
    recoveryDrafts = recoveryChoices(recoveryDrafts.concat(draft), session.snapshot().draft);
  }
  render();
}
async function saveNote(payload) {
  if (disposed) return;
  const context = resolveEditorContext(payload);
  if (!context) return;
  syncVideo();
  const current = session.snapshot(context.binding);
  if (!current.binding || current.binding.courseId === 'pending') {
    hostError = 'Chọn folder course trước khi lưu. Bản nháp vẫn được giữ.';
    render();
    return;
  }
  const intent = session.startSave(context.binding);
  if (!intent) return;
  hostError = null;
  render();
  let reply;
  try {
    reply = await rpc('mutate-course', intent.binding, { mutation: { kind: 'add', note: intent.note } }, intent.requestId);
  } catch (error) {
    reply = { requestId: intent.requestId, courseId: intent.binding.courseId, videoPath: intent.binding.videoPath,
      ok: false, error: errorText(error) };
  }
  if (disposed) return;
  session.settleSave(reply);
  if (reply.ok) {
    acceptCourse(reply.data, reply.courseVersion, intent.binding.courseRoot);
    rpc('clear-draft', intent.binding, { draft: intent.draft }).catch(fail);
  }
  if (sameBinding(intent.binding, session.snapshot().binding)) {
    if (ready.sidebar) sidebar.postMessage('save-result', { ok: reply.ok, ...(reply.ok ? {} : { error: reply.error }) });
    if (reply.ok) requestFocus();
  }
  render();
}
async function mutateNote(kind, payload) {
  if (disposed || !payload || typeof payload.id !== 'string') return;
  const binding = session.snapshot().binding;
  const note = course && course.notes.find(item => item.id === payload.id);
  if (!binding || !note) return;
  if (kind === 'delete' && !utils.ask('Xóa ghi chú này? Thao tác này không thể hoàn tác.\n\n' + note.text)) return;
  if (kind === 'edit' && (typeof payload.text !== 'string' || !payload.text.trim())) {
    const error = new Error('Nội dung ghi chú không được để trống.');
    fail(error);
    mutationFailure(error);
    return;
  }
  const mutation = kind === 'delete' ? { kind, id: note.id } :
    { kind, id: note.id, text: payload.text, updatedAt: new Date().toISOString() };
  try {
    const reply = await rpc('mutate-course', binding, { mutation });
    if (!disposed && sameBinding(binding, session.snapshot().binding)) {
      hostError = null;
      acceptCourse(reply.data, reply.courseVersion, binding.courseRoot);
    }
  } catch (error) {
    if (sameBinding(binding, session.snapshot().binding)) {
      fail(error);
      mutationFailure(error);
    }
  }
}
function mutationFailure(error) {
  if (disposed) return;
  const feedback = { ok: false, error: errorText(error) };
  if (ready.sidebar) sidebar.postMessage('save-result', feedback);
  if (ready.notebook) standaloneWindow.postMessage('save-result', feedback);
}
function seekNote(payload) {
  if (disposed || !payload || typeof payload.id !== 'string') return;
  const sourceCourse = course || (navigationSource && navigationSource.course);
  const binding = course ? session.snapshot().binding : navigationSource && navigationSource.binding;
  const note = sourceCourse && sourceCourse.notes.find(item => item.id === payload.id);
  if (!binding || !note) return;
  try {
    const destination = model.normalizeAbsolutePath(binding.courseRoot + '/' + note.videoPath);
    model.relativeVideoPath(binding.courseRoot, destination);
    if (!file.exists(destination)) throw new Error('Không tìm thấy video: ' + destination + '. Ghi chú vẫn được giữ.');
    // Keep the notebook's stored-note identity available while load-course for
    // the first destination is pending, so another timestamp can supersede it.
    navigationSource = { binding, course: sourceCourse };
    hostError = null;
    const loaded = livePath();
    if (loaded === destination) {
      session.cancelSeek();
      core.pause();
      core.seekTo(note.timestamp);
    } else {
      session.beginSeek(destination, note.timestamp);
      core.open(destination);
    }
    render();
  } catch (error) { session.cancelSeek(); fail(error); }
}
function openNotebook() {
  if (disposed) return;
  if (!notebookLoaded) {
    notebookLoaded = true;
    standaloneWindow.setProperty({ title: 'Cuốn sổ course — Note IINA', resizable: true });
    standaloneWindow.setFrame(920, 680);
    standaloneWindow.loadFile('ui/notebook.html');
    registerView(standaloneWindow, 'notebook');
  }
  standaloneWindow.open();
  render();
}
function registerView(view, name) {
  const on = (messageName, callback) => view.onMessage(messageName, payload => {
    if (!disposed) callback(payload || {});
  });
  on('ui-ready', payload => {
    if (payload.view !== name) return;
    ready[name] = true;
    render();
    if (name === 'sidebar' && focusPending) requestFocus();
  });
  on('draft-change', changeDraft);
  on('save-note', saveNote);
  on('edit-note', payload => mutateNote('edit', payload));
  on('delete-note', payload => mutateNote('delete', payload));
  on('seek-note', seekNote);
  on('search-notes', payload => {
    if (typeof payload.query === 'string') readerQuery = payload.query;
    readerVideoPath = typeof payload.videoPath === 'string' ? payload.videoPath : null;
    render();
  });
  on('choose-course', payload => chooseCourse(payload.useCurrent === true));
  on('restore-draft', payload => {
    const draft = recoveryDrafts.find(item => item.ownerId === payload.ownerId && item.courseId === payload.courseId &&
      item.videoPath === payload.videoPath && item.revision === payload.revision);
    if (draft) restoreDraft(draft, true);
  });
  on('open-course', openNotebook);
  if (name === 'sidebar') on('close-sidebar', () => sidebar.hide());
}
function listen(name, callback) { listeners.push([name, event.on(name, callback)]); }
listen('iina.file-loaded', url => {
  if (disposed) return;
  const loaded = localPath(url);
  // Rejected native callbacks must not consume OR cancel the latest intent.
  const actual = livePath();
  if (loaded !== actual) return;
  const intended = loaded ? session.takePendingSeek(loaded) : (session.cancelSeek(), null);
  if (intended) { core.pause(); core.seekTo(intended.timestamp); }
  selectPath(actual, false);
});
listen('iina.file-started', syncVideo);
listen('iina.window-main.changed', active => { if (active && !disposed) { syncVideo(); render(); } });
function dispose() {
  if (disposed) return;
  // Timers are cancelled with this context. Flush all captured draft owners,
  // including delayed input for a lesson that is no longer selected.
  const finalDrafts = new Map();
  for (const pending of requests.values()) {
    if (pending.name === 'save-draft') {
      const draft = pending.envelope.draft;
      const key = JSON.stringify([draft.ownerId, draft.courseId, draft.videoPath]);
      const previous = finalDrafts.get(key);
      if (!previous || draft.revision > previous.revision) finalDrafts.set(key, draft);
    }
  }
  const closing = session.snapshot();
  if (closing.draft) finalDrafts.set(JSON.stringify([ownerId, closing.draft.courseId, closing.draft.videoPath]), closing.draft);
  finalDrafts.forEach(draft => transport.postMessage('save-final-draft', { ownerId, draft }));
  for (const pending of requests.values()) {
    if (pending.name === 'clear-draft') transport.postMessage('clear-draft', pending.envelope);
  }
  transport.postMessage('unregister-player', { ownerId });
  disposed = true;
  selectionEpoch++;
  session.cancelSeek();
  if (keyRegistered) input.onKeyDown('n', null);
  listeners.forEach(([name, id]) => event.off(name, id));
  requests.clear();
  standaloneWindow.close();
}
listen('iina.window-will-close', dispose);
listen('mpv.shutdown', dispose);
function loadSidebar() {
  if (disposed || sidebarLoaded || !core.window.loaded) return;
  sidebar.loadFile('ui/sidebar.html');
  registerView(sidebar, 'sidebar');
  sidebarLoaded = true;
  if (sidebarRequested) sidebar.show();
}
listen('iina.window-loaded', loadSidebar);
loadSidebar();
// A menu accelerator for plain n would intercept native text fields before input routing.
menu.addItem(menu.item('Mở ghi chú', openNotes));
menu.addItem(menu.item('Mở cuốn sổ course', openNotebook));
try {
  const key = input.normalizeKeyCode('n');
  const binding = input.getAllKeyBindings()[key];
  if (binding) keyConflict = 'Phím N đang gán cho: ' + binding.action + '. Dùng Plugin → Note IINA → Mở ghi chú.';
  else {
    input.onKeyDown('n', data => {
      if (disposed || data.isRepeat) return false;
      // LOW lets IINA's native/default handlers run first. WebView text routing
      // is host-owned; no application-wide menu accelerator captures plain n.
      openNotes();
      return true;
    }, input.PRIORITY_LOW);
    keyRegistered = true;
  }
} catch (error) {
  keyConflict = 'Không kiểm tra được phím N: ' + errorText(error) + '. Dùng menu Mở ghi chú.';
}
syncVideo();
