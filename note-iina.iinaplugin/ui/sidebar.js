(function () {
  'use strict';
  const UI = window.NoteUI;
  const get = id => document.getElementById(id);
  const editor = get('note-editor');
  const save = get('save-note');
  const tracker = UI.createDraftTracker();
  let state = null;
  let transport = null;
  let composing = false;
  let compositionContext = null;
  let deferredText = null;
  let feedback = '';
  let saved = false;
  let previousContext;
  const post = (name, payload) => { if (transport) transport(name, payload); };
  const notes = UI.createNoteList(get('notes'), post, false);

  function updateSave() {
    save.disabled = !state || !state.editorContext || editor.disabled || composing || !editor.value.trim() || state.saving || state.status !== 'ready';
    UI.setText(save, state && state.saving ? 'Đang lưu…' : 'Lưu');
  }

  function updateDraftStatus() {
    const text = state && state.saving ? 'Đang lưu ghi chú… Bạn vẫn có thể viết tiếp.' : state && state.error ? (editor.value ? 'Nội dung đang viết vẫn được giữ.' : '') : feedback || (saved ? (editor.value ? 'Đã lưu ghi chú trước. Bản nháp trong ô viết chưa được lưu.' : 'Đã lưu ghi chú.') : (editor.value ? 'Bản nháp chưa lưu thành ghi chú.' : ''));
    UI.setText(get('draft-status'), text);
  }

  function replaceEditor(text, switched) {
    if (editor.value === text) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const direction = editor.selectionDirection;
    const scroll = editor.scrollTop;
    editor.value = text;
    if (!switched && document.activeElement === editor) {
      editor.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length), direction);
      editor.scrollTop = scroll;
    }
  }

  function receive(next) {
    state = next;
    const switched = previousContext !== next.editorContext;
    previousContext = next.editorContext;
    if (switched) { feedback = ''; saved = false; }
    UI.renderFeedback(next);
    UI.setText(get('video-title'), next.videoTitle || 'Chưa mở video');
    UI.setText(get('course-name'), next.courseName);
    get('open-course').disabled = !next.binding || next.binding.courseId === 'pending';
    get('course-choice').hidden = next.status !== 'choose-course';
    UI.setText(get('key-conflict'), next.keyConflict);
    get('key-conflict').hidden = !next.keyConflict;
    UI.renderRecovery(get('recovery'), next.recoveryDrafts || [], post);
    notes.update(next.notes || [], next.videoPath);
    const empty = get('notes-empty');
    empty.hidden = !!(next.notes && next.notes.length);
    UI.setText(empty, next.status === 'loading' ? 'Đang đọc ghi chú…' : next.status === 'no-video' ? 'Mở một video local trong IINA để ghi chú.' : next.status === 'error' ? 'Không đọc được ghi chú. Kiểm tra thông báo lỗi ở trên.' : 'Chưa có ghi chú cho bài này. Viết ý đầu tiên ở bên dưới.');
    editor.disabled = !next.videoPath || next.status === 'no-video';
    const tracked = tracker.receive(next);
    if (composing) deferredText = { text: tracked.text, switched: compositionContext !== next.editorContext };
    else replaceEditor(tracked.text, switched);
    UI.setText(get('draft-time'), next.draft ? UI.formatTimestamp(next.draft.timestamp) : '');
    updateDraftStatus();
    updateSave();
  }

  function submit() {
    if (composing || save.disabled) return;
    feedback = '';
    saved = false;
    editor.focus();
    post('save-note', { editorContext: state.editorContext });
  }

  editor.addEventListener('compositionstart', () => {
    composing = true;
    compositionContext = state && state.editorContext;
    updateSave();
  });
  editor.addEventListener('compositionend', () => {
    composing = false;
    // Finish the original editor even if a new lesson's state arrived mid-IME.
    // The host owns the token -> binding mapping; never relabel composed text.
    const text = editor.value;
    const deferred = deferredText;
    deferredText = null;
    const context = compositionContext;
    compositionContext = null;
    if (state && state.editorContext === context) tracker.type(text);
    post('draft-change', { text, editorContext: context });
    if (deferred && deferred.switched) replaceEditor(deferred.text, true);
    updateSave();
  });
  editor.addEventListener('input', () => {
    if (composing) return;
    feedback = '';
    saved = false;
    tracker.type(editor.value);
    deferredText = null;
    UI.setText(get('draft-status'), editor.value ? 'Bản nháp chưa lưu thành ghi chú.' : '');
    post('draft-change', { text: editor.value, editorContext: state && state.editorContext });
    updateSave();
  });
  get('composer').addEventListener('submit', event => { event.preventDefault(); submit(); });
  get('close').addEventListener('click', () => post('close-sidebar', {}));
  get('open-course').addEventListener('click', () => post('open-course', {}));
  get('choose-course').addEventListener('click', () => post('choose-course', { useCurrent: false }));
  get('use-current').addEventListener('click', () => post('choose-course', { useCurrent: true }));
  document.addEventListener('keydown', event => {
    if (composing) return;
    const action = UI.shortcutAction(event, 'sidebar');
    if (action === 'close') { event.preventDefault(); event.stopPropagation(); post('close-sidebar', {}); }
    else if (action === 'save' && event.target === editor) { event.preventDefault(); event.stopPropagation(); submit(); }
    // Ordinary n, Space and Enter remain native text input. No player shortcuts
    // are registered in this WebView.
  });

  transport = UI.connect('sidebar', {
    state: receive,
    focus() { if (!editor.disabled) editor.focus(); },
    result(result) {
      notes.result(result);
      saved = result.ok;
      feedback = result.ok ? '' : result.error || 'Không lưu được ghi chú. Nội dung đang viết vẫn được giữ.';
      updateDraftStatus();
      if (result.ok && !editor.disabled && (document.activeElement === save || document.activeElement === editor)) editor.focus();
      // A result is feedback, never permission to clear the editor.
    }
  });
})();
