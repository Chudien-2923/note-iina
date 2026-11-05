(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NoteUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function formatTimestamp(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const remainder = String(total % 60).padStart(2, '0');
    return minutes < 60 ? minutes + ':' + remainder : Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0') + ':' + remainder;
  }

  function groupNotes(notes) {
    const groups = new Map();
    for (const note of notes) {
      if (!groups.has(note.videoPath)) groups.set(note.videoPath, { videoPath: note.videoPath, notes: [] });
      groups.get(note.videoPath).notes.push(note);
    }
    return Array.from(groups.values());
  }

  function shortcutAction(event, view) {
    if (event.isComposing || event.keyCode === 229 || event.repeat) return null;
    if (event.key === 'Enter' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) return 'save';
    if (event.key === 'Escape' && view === 'sidebar' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) return 'close';
    return null;
  }

  // A state echo may arrive after another keystroke. Only an echo of that text
  // acknowledges it; unrelated state refreshes cannot replace pending input.
  function createDraftTracker() {
    let identity;
    let text = '';
    let pending = [];
    let owner = null;
    let revision = -1;
    return {
      type(value) { text = value; pending.push(value); },
      receive(state) {
        const nextIdentity = state.editorContext;
        const draft = state.draft;
        const incoming = draft ? draft.text : '';
        if (identity !== nextIdentity) {
          identity = nextIdentity;
          pending = [];
          owner = draft ? draft.ownerId : null;
          revision = draft ? draft.revision : -1;
          text = incoming;
        } else if (!(draft && draft.ownerId === owner && draft.revision < revision)) {
          const matched = pending.lastIndexOf(incoming);
          if (matched >= 0) pending.splice(0, matched + 1);
          if (!pending.length) {
            text = incoming;
            if (!draft) { owner = null; revision = -1; }
          }
          if (draft) { owner = draft.ownerId; revision = draft.revision; }
        }
        return { text, pending: pending.length > 0 };
      }
    };
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, action, className) {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function setText(node, value) {
    const text = value || '';
    if (node.textContent !== text) node.textContent = text;
  }

  function applyTheme(theme) {
    const html = document.documentElement;
    if (theme && (theme.appearance === 'light' || theme.appearance === 'dark')) html.dataset.appearance = theme.appearance;
    else delete html.dataset.appearance; // Inherit WebKit's native prefers-color-scheme.
    const accent = theme && theme.accentColor;
    if (typeof accent === 'string' && typeof CSS !== 'undefined' && CSS.supports('color', accent)) html.style.setProperty('--accent', accent);
    else html.style.removeProperty('--accent');
  }

  function connect(view, handlers) {
    // This surface has no browser demo mode or simulated persistence.
    if (!window.iina || typeof window.iina.postMessage !== 'function' || typeof window.iina.onMessage !== 'function') {
      const error = document.getElementById('error');
      error.hidden = false;
      error.textContent = 'Không kết nối được với IINA. Mở giao diện này từ plugin Note IINA.';
      return null;
    }
    const post = (name, payload) => window.iina.postMessage(name, payload || {});
    window.iina.onMessage('state', handlers.state);
    window.iina.onMessage('focus-editor', () => { if (handlers.focus) handlers.focus(); });
    window.iina.onMessage('save-result', result => { if (handlers.result) handlers.result(result); });
    post('ui-ready', { view });
    return post;
  }

  function renderFeedback(state) {
    applyTheme(state.theme);
    const error = document.getElementById('error');
    setText(error, state.error);
    error.hidden = !state.error;
    const message = document.getElementById('message');
    setText(message, state.message || (state.status === 'loading' ? 'Đang đọc ghi chú…' : ''));
    message.hidden = !message.textContent;
    document.body.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');
  }

  function createNoteList(container, post, grouped) {
    const rows = new Map();
    const sections = new Map();
    let context = null;

    function createRow(note) {
      const row = element('li', 'note');
      const header = element('div', 'note-header');
      const seek = button(formatTimestamp(note.timestamp), () => post('seek-note', { id: note.id }), 'timestamp');
      const actions = element('div', 'note-actions');
      const body = element('p', 'note-text', note.text);
      const edit = button('Sửa', startEdit, 'text-button');
      edit.setAttribute('aria-label', 'Sửa ghi chú tại ' + formatTimestamp(note.timestamp));
      const remove = button('Xóa', () => post('delete-note', { id: note.id }), 'text-button');
      remove.setAttribute('aria-label', 'Xóa ghi chú tại ' + formatTimestamp(note.timestamp));
      actions.append(edit, remove);
      header.append(seek, actions);
      row.append(header, body);
      const record = { row, body, seek, note, editor: null, submitted: null, edit, remove };

      function finishEdit() {
        const restoreFocus = record.editor && record.editor.form.contains(document.activeElement);
        if (record.editor) record.editor.form.remove();
        record.editor = null;
        record.submitted = null;
        body.hidden = false;
        actions.hidden = false;
        if (restoreFocus) edit.focus();
      }

      function startEdit() {
        if (record.editor) { record.editor.input.focus(); return; }
        const form = element('form', 'note-edit');
        const label = element('label', null, 'Sửa ghi chú');
        const input = element('textarea', 'edit-input');
        input.id = 'edit-' + note.id;
        label.htmlFor = input.id;
        input.rows = 4;
        input.value = record.note.text;
        const controls = element('div', 'editor-actions');
        const cancel = button('Hủy', finishEdit);
        const save = element('button', 'primary', 'Lưu thay đổi');
        save.type = 'submit';
        save.disabled = true;
        const feedback = element('p', 'edit-feedback');
        feedback.setAttribute('role', 'status');
        controls.append(cancel, save);
        form.append(label, input, controls, feedback);
        body.hidden = true;
        actions.hidden = true;
        row.append(form);
        record.editor = { form, input, save, cancel, feedback };
        function submit() {
          if (record.submitted !== null || !input.value.trim() || input.value.trim() === record.note.text) return;
          record.submitted = input.value;
          save.disabled = true;
          cancel.disabled = true;
          setText(feedback, 'Đang lưu thay đổi…');
          post('edit-note', { id: note.id, text: input.value });
        }
        input.addEventListener('input', () => { save.disabled = record.submitted !== null || !input.value.trim() || input.value.trim() === record.note.text; });
        input.addEventListener('keydown', event => {
          if (shortcutAction(event, 'notebook') === 'save') { event.preventDefault(); event.stopPropagation(); submit(); }
        });
        form.addEventListener('submit', event => { event.preventDefault(); submit(); });
        input.focus();
      }
      record.update = next => {
        record.note = next;
        setText(body, next.text);
        setText(seek, formatTimestamp(next.timestamp));
        seek.setAttribute('aria-label', 'Mở video tại ' + formatTimestamp(next.timestamp));
        if (record.editor && record.submitted !== null && next.text === record.submitted.trim()) {
          if (record.editor.input.value === record.submitted) finishEdit();
          else {
            record.submitted = null;
            record.editor.save.disabled = !record.editor.input.value.trim() || record.editor.input.value.trim() === next.text;
            record.editor.cancel.disabled = false;
            setText(record.editor.feedback, 'Đã lưu. Phần đang viết thêm chưa được lưu.');
          }
        }
        if (record.editor && record.submitted === null) {
          record.editor.save.disabled = !record.editor.input.value.trim() || record.editor.input.value.trim() === next.text;
        }
      };
      return record;
    }

    return {
      update(notes, nextContext) {
        if (context !== nextContext) {
          rows.clear(); sections.clear(); container.replaceChildren(); context = nextContext;
        }
        const ids = new Set(notes.map(note => note.id));
        for (const [id, record] of rows) if (!ids.has(id)) { record.row.remove(); rows.delete(id); }
        const groups = grouped ? groupNotes(notes) : [{ videoPath: '', notes }];
        const paths = new Set(groups.map(group => group.videoPath));
        for (const [path, section] of sections) if (!paths.has(path)) { section.root.remove(); sections.delete(path); }
        let groupIndex = 0;
        for (const group of groups) {
          let section = sections.get(group.videoPath);
          if (!section) {
            const root = element(grouped ? 'section' : 'div', grouped ? 'lesson-section' : 'notes-section');
            const list = element('ol', 'notes-list');
            if (grouped) root.append(element('h2', 'lesson-heading', group.videoPath));
            root.append(list);
            section = { root, list };
            sections.set(group.videoPath, section);
          }
          if (container.children[groupIndex] !== section.root) container.insertBefore(section.root, container.children[groupIndex] || null);
          groupIndex++;
          let rowIndex = 0;
          for (const note of group.notes) {
            let record = rows.get(note.id);
            if (!record) { record = createRow(note); rows.set(note.id, record); }
            record.update(note);
            if (section.list.children[rowIndex] !== record.row) section.list.insertBefore(record.row, section.list.children[rowIndex] || null);
            rowIndex++;
          }
        }
      },
      result(result) {
        if (result.ok) return; // Only authoritative note content confirms an edit.
        for (const record of rows.values()) {
          if (record.editor && record.submitted !== null) {
            record.submitted = null;
            record.editor.save.disabled = !record.editor.input.value.trim() || record.editor.input.value.trim() === record.note.text;
            record.editor.cancel.disabled = false;
            setText(record.editor.feedback, result.error || 'Không lưu được thay đổi. Nội dung đang sửa vẫn được giữ.');
          }
        }
      }
    };
  }

  function renderRecovery(container, drafts, post) {
    const signature = JSON.stringify(drafts.map(draft => [draft.ownerId, draft.courseId, draft.videoPath, draft.revision]));
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    container.replaceChildren();
    container.hidden = !drafts.length;
    if (!drafts.length) return;
    container.append(element('h2', null, 'Khôi phục bản nháp'));
    container.append(element('p', 'secondary', 'Chọn bản nháp muốn tiếp tục. Các bản nháp chưa chọn vẫn được giữ.'));
    const list = element('ul', 'recovery-list');
    for (const draft of drafts) {
      const item = element('li');
      const date = new Date(draft.updatedAt);
      const detail = Number.isNaN(date.getTime()) ? '' : ' · ' + date.toLocaleString('vi-VN');
      const choice = button(formatTimestamp(draft.timestamp) + detail, () => post('restore-draft', {
        ownerId: draft.ownerId, courseId: draft.courseId, videoPath: draft.videoPath, revision: draft.revision
      }));
      choice.setAttribute('aria-label', 'Khôi phục bản nháp tại ' + formatTimestamp(draft.timestamp) + detail);
      item.append(choice, element('p', 'recovery-preview', draft.text));
      list.append(item);
    }
    container.append(list);
  }

  return { formatTimestamp, groupNotes, shortcutAction, createDraftTracker, element, button, setText, applyTheme, connect, renderFeedback, createNoteList, renderRecovery };
});
