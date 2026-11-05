const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Minimal DOM boundary, not a replacement for NoteUI or its draft tracker.
module.exports = function mountSidebar(post) {
  const nodes = new Map();
  const callbacks = {};
  let document;
  function element() {
    const handlers = {};
    return { value: '', textContent: '', disabled: false, hidden: false, dataset: {}, children: [],
      selectionStart: 0, selectionEnd: 0, selectionDirection: 'none', scrollTop: 0,
      style: { setProperty() {}, removeProperty() {} }, setAttribute() {},
      addEventListener(name, fn) { handlers[name] = fn; },
      emit(name, event = {}) { if (handlers[name]) handlers[name](event); },
      focus() { document.activeElement = this; }, setSelectionRange() {},
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
      insertBefore(child, before) { const old = this.children.indexOf(child); if (old >= 0) this.children.splice(old, 1); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, child); },
      remove() {}, contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    };
  }
  document = { createElement: element, getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    documentElement: element(), body: element(), activeElement: null, addEventListener() {} };
  const context = vm.createContext({ document, window: { iina: { postMessage: post, onMessage: (name, fn) => { callbacks[name] = fn; } } } });
  const ui = path.resolve(__dirname, '../../note-iina.iinaplugin/ui');
  vm.runInContext(fs.readFileSync(path.join(ui, 'shared.js'), 'utf8'), context);
  // The shared UMD installs on globalThis, whereas WebKit's globalThis is window.
  context.window.NoteUI = context.NoteUI;
  vm.runInContext(fs.readFileSync(path.join(ui, 'sidebar.js'), 'utf8'), context);
  return { editor: document.getElementById('note-editor'),
    receive(name, payload) { if (callbacks[name]) callbacks[name](payload); },
    submit() { document.getElementById('composer').emit('submit', { preventDefault() {} }); } };
};
