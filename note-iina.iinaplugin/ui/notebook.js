(function () {
  'use strict';
  const UI = window.NoteUI;
  const get = id => document.getElementById(id);
  const search = get('search');
  const all = get('all-lessons');
  const lessonNodes = new Map();
  let transport = null;
  let courseId;
  let query = '';
  let videoPath = null;
  let pendingSearch = false;
  let composing = false;
  let latestState = null;
  const post = (name, payload) => { if (transport) transport(name, payload); };
  const notes = UI.createNoteList(get('reader-notes'), post, true);

  function requestSearch() {
    query = search.value;
    pendingSearch = true;
    get('reader-notes').hidden = true;
    get('reader-empty').hidden = false;
    UI.setText(get('reader-empty'), 'Đang tìm ghi chú…');
    post('search-notes', { query, videoPath });
    renderSelection();
  }

  function renderSelection() {
    if (videoPath === null) all.setAttribute('aria-current', 'page');
    else all.removeAttribute('aria-current');
    for (const [path, record] of lessonNodes) {
      if (videoPath === path) record.button.setAttribute('aria-current', 'page');
      else record.button.removeAttribute('aria-current');
    }
    UI.setText(get('reader-title'), videoPath || 'Tất cả ghi chú');
  }

  function renderLessons(state) {
    const groups = UI.groupNotes(state.allNotes || []);
    const paths = new Set(groups.map(group => group.videoPath));
    for (const [path, record] of lessonNodes) if (!paths.has(path)) { record.item.remove(); lessonNodes.delete(path); }
    let index = 0;
    for (const group of groups) {
      let record = lessonNodes.get(group.videoPath);
      if (!record) {
        const item = UI.element('li');
        const choice = UI.button('', () => { videoPath = group.videoPath; requestSearch(); }, 'lesson-choice');
        const title = UI.element('span', 'lesson-path', group.videoPath);
        const count = UI.element('span', 'lesson-count');
        choice.append(title, count);
        choice.title = group.videoPath;
        item.append(choice);
        record = { item, button: choice, count };
        lessonNodes.set(group.videoPath, record);
      }
      UI.setText(record.count, String(group.notes.length));
      record.button.setAttribute('aria-label', group.videoPath + ', ' + group.notes.length + ' ghi chú');
      const list = get('lessons');
      if (list.children[index] !== record.item) list.insertBefore(record.item, list.children[index] || null);
      index++;
    }
    all.disabled = !state.binding || state.binding.courseId === 'pending';
    renderSelection();
  }

  function receive(state) {
    latestState = state;
    const nextCourse = state.binding ? state.binding.courseId : null;
    if (courseId !== nextCourse) {
      courseId = nextCourse;
      query = state.readerQuery || '';
      videoPath = state.readerVideoPath || null;
      pendingSearch = false;
      if (search.value !== query) search.value = query;
    } else if (!pendingSearch && document.activeElement !== search && !composing) {
      query = state.readerQuery || '';
      videoPath = state.readerVideoPath || null;
      if (search.value !== query) search.value = query;
    }
    if ((state.readerQuery || '') === query && (state.readerVideoPath || null) === videoPath) pendingSearch = false;
    UI.renderFeedback(state);
    UI.setText(get('course-title'), state.courseName || 'Cuốn sổ course');
    document.title = state.courseName ? state.courseName + ' — Cuốn sổ course' : 'Cuốn sổ course';
    search.disabled = !state.binding || state.binding.courseId === 'pending';
    get('course-choice').hidden = state.status !== 'choose-course';
    renderLessons(state);
    const readerNotes = state.readerNotes || [];
    const container = get('reader-notes');
    const empty = get('reader-empty');
    container.hidden = pendingSearch;
    if (!pendingSearch) notes.update(readerNotes, courseId);
    empty.hidden = !pendingSearch && readerNotes.length > 0;
    UI.setText(get('result-count'), pendingSearch ? 'Đang tìm…' : readerNotes.length + ' ghi chú');
    UI.setText(empty, pendingSearch ? 'Đang tìm ghi chú…' : state.status === 'loading' ? 'Đang đọc ghi chú…' : state.status === 'no-video' ? 'Mở một video local và chọn course để đọc ghi chú.' : state.status === 'error' ? 'Kiểm tra thông báo lỗi ở trên. Các ghi chú đã đọc được vẫn hiển thị.' : query ? 'Không có ghi chú khớp với nội dung tìm kiếm. Thử cụm từ khác hoặc chọn tất cả bài.' : videoPath ? 'Bài này chưa có ghi chú.' : 'Course chưa có ghi chú. Mở bảng Ghi chú trong IINA để viết khi xem bài.');
  }

  search.addEventListener('compositionstart', () => { composing = true; });
  search.addEventListener('compositionend', () => { composing = false; requestSearch(); });
  search.addEventListener('input', () => { if (!composing) requestSearch(); });
  get('search-form').addEventListener('submit', event => { event.preventDefault(); if (!composing) requestSearch(); });
  all.addEventListener('click', () => { videoPath = null; requestSearch(); });
  get('choose-course').addEventListener('click', () => post('choose-course', { useCurrent: false }));
  get('use-current').addEventListener('click', () => post('choose-course', { useCurrent: true }));
  transport = UI.connect('notebook', {
    state: receive,
    result(result) {
      notes.result(result);
      if (!result.ok) {
        get('error').hidden = false;
        UI.setText(get('error'), result.error || 'Không lưu được thay đổi. Nội dung đang sửa vẫn được giữ.');
      } else if (latestState) {
        // The next state, not this acknowledgement, supplies saved note content.
        UI.setText(get('result-count'), (latestState.readerNotes || []).length + ' ghi chú');
      }
    }
  });
})();
