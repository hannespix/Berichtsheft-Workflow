const UndoManager = {
  _stack: [],    // [{desc, undo(), redo()}]
  _redoStack: [],
  MAX: 30,

  push(desc, undoFn, redoFn) {
    this._stack.push({ desc, undo: undoFn, redo: redoFn });
    if (this._stack.length > this.MAX) this._stack.shift();
    this._redoStack = []; // clear redo on new action
  },

  undo() {
    const entry = this._stack.pop();
    if (!entry) return App.toast('Nichts zum Rückgängigmachen', 'warning');
    try {
      entry.undo();
      this._redoStack.push(entry);
      App.toast(`↩︎ Rückgängig: ${entry.desc}`, 'info');
    } catch(e) {
      console.error('Undo error:', e);
      App.toast('Undo fehlgeschlagen', 'error');
    }
  },

  redo() {
    const entry = this._redoStack.pop();
    if (!entry) return App.toast('Nichts zum Wiederholen', 'warning');
    try {
      entry.redo();
      this._stack.push(entry);
      App.toast(`↪︎ Wiederholt: ${entry.desc}`, 'info');
    } catch(e) {
      console.error('Redo error:', e);
    }
  },

  canUndo() { return this._stack.length > 0; },
  canRedo() { return this._redoStack.length > 0; },
  lastDesc() { return this._stack.length ? this._stack[this._stack.length-1].desc : ''; },
};
