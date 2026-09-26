(function () {
  'use strict';

  if (window.__vedamCursorFixInstalled) return;
  window.__vedamCursorFixInstalled = true;
  document.documentElement.dataset.vedamCursorFixLoaded = 'true';

  var POLL_MS = 150;
  var TIMEOUT_MS = 30000;
  var ACTIVE_EDIT_WINDOW_MS = 1600;
  var startedAt = Date.now();
  var lastFocusedEditAt = 0;
  var lastUserInputAt = 0;

  function isCodingLab() {
    try {
      return new URL(window.location.href).searchParams.has('questionId');
    } catch (error) {
      return false;
    }
  }

  function normalizedValue(value) {
    return String(value ?? '').replace(/\r\n/g, '\n');
  }

  function hasFocus(editor) {
    try {
      return typeof editor.hasTextFocus === 'function' && editor.hasTextFocus();
    } catch (error) {
      return false;
    }
  }

  function getEditors() {
    try {
      return window.monaco?.editor?.getEditors?.() || [];
    } catch (error) {
      return [];
    }
  }

  function focusedEditorForModel(model) {
    var editors = getEditors();
    for (var index = 0; index < editors.length; index += 1) {
      var editor = editors[index];
      try {
        if (editor.getModel?.() === model && hasFocus(editor)) return editor;
      } catch (error) {}
    }
    return null;
  }

  function isActiveEdit() {
    var lastActivity = Math.max(lastFocusedEditAt, lastUserInputAt);
    return Date.now() - lastActivity <= ACTIVE_EDIT_WINDOW_MS;
  }

  function incrementCounter(name) {
    document.documentElement.dataset[name] =
      String(Number(document.documentElement.dataset[name] || 0) + 1);
  }

  function markEdit() {
    lastFocusedEditAt = Date.now();
    document.documentElement.dataset.vedamCursorFixLastEditAt = String(lastFocusedEditAt);
  }

  function markUserInput() {
    lastUserInputAt = Date.now();
    document.documentElement.dataset.vedamCursorFixLastUserInputAt = String(lastUserInputAt);
  }

  function shouldSkipSetValue(editor, currentValue, nextValue) {
    if (nextValue === currentValue) return true;
    return !!editor && hasFocus(editor) && isActiveEdit();
  }

  function isFullModelRange(model, range) {
    if (!model || !range || !model.getLineCount || !model.getLineMaxColumn) return false;

    var lastLine = model.getLineCount();
    var lastColumn = model.getLineMaxColumn(lastLine);
    return (
      range.startLineNumber === 1 &&
      range.startColumn === 1 &&
      range.endLineNumber === lastLine &&
      range.endColumn === lastColumn
    );
  }

  function isFullModelReplace(model, edits) {
    if (!Array.isArray(edits) || edits.length !== 1) return false;
    var edit = edits[0];
    if (!edit || !isFullModelRange(model, edit.range)) return false;

    try {
      return normalizedValue(edit.text) !== normalizedValue(model.getValue());
    } catch (error) {
      return true;
    }
  }

  function hasWholeModelSelection(editor, model) {
    if (!editor || !model || typeof editor.getSelections !== 'function') return false;

    try {
      var selections = editor.getSelections() || [];
      return selections.some(function (selection) {
        return isFullModelRange(model, selection);
      });
    } catch (error) {
      return false;
    }
  }

  function isUserEditSource(source) {
    if (typeof source !== 'string') return false;
    return /^(keyboard|paste|delete|undo|redo|snippet|suggest|composition|tab|editor\.action|vedam-probe)/i.test(source);
  }

  function shouldSkipFullReplace(model, edits, source) {
    var editor = focusedEditorForModel(model);
    return !!editor &&
      hasFocus(editor) &&
      isActiveEdit() &&
      isFullModelReplace(model, edits) &&
      !hasWholeModelSelection(editor, model) &&
      !isUserEditSource(source);
  }

  function patchModel(model) {
    if (!model || model.__vedamCursorFixModelPatched || !model.setValue || !model.getValue) return;
    model.__vedamCursorFixModelPatched = true;

    var originalSetValue = model.setValue;
    model.setValue = function (value) {
      var currentValue = '';
      var nextValue = normalizedValue(value);

      try {
        currentValue = normalizedValue(this.getValue());
      } catch (error) {}

      var editor = focusedEditorForModel(this);
      if (shouldSkipSetValue(editor, currentValue, nextValue)) {
        incrementCounter('vedamCursorFixSkippedModelSetValue');
        return;
      }

      return originalSetValue.apply(this, arguments);
    };

    if (typeof model.applyEdits === 'function') {
      var originalApplyEdits = model.applyEdits;
      model.applyEdits = function (edits) {
        if (shouldSkipFullReplace(this, edits, 'model.applyEdits')) {
          incrementCounter('vedamCursorFixSkippedApplyEdits');
          return [];
        }
        return originalApplyEdits.apply(this, arguments);
      };
    }

    if (typeof model.pushEditOperations === 'function') {
      var originalPushEditOperations = model.pushEditOperations;
      model.pushEditOperations = function (beforeCursorState, editOperations, cursorStateComputer) {
        if (shouldSkipFullReplace(this, editOperations, 'model.pushEditOperations')) {
          incrementCounter('vedamCursorFixSkippedPushEditOperations');
          return beforeCursorState || null;
        }
        return originalPushEditOperations.apply(this, arguments);
      };
    }
  }

  function patchEditor(editor) {
    if (!editor || editor.__vedamCursorFixEditorPatched) return;
    if (!editor.getValue || !editor.setValue) return;
    editor.__vedamCursorFixEditorPatched = true;

    patchModel(editor.getModel?.());
    editor.onDidChangeModel?.(function () {
      patchModel(editor.getModel?.());
    });

    editor.onDidChangeModelContent?.(function (event) {
      if (!hasFocus(editor)) return;
      if (event && event.isFlush) return;
      markEdit();
    });

    var originalSetValue = editor.setValue;
    editor.setValue = function (value) {
      var currentValue = '';
      var nextValue = normalizedValue(value);

      try {
        currentValue = normalizedValue(this.getValue());
      } catch (error) {}

      if (shouldSkipSetValue(this, currentValue, nextValue)) {
        incrementCounter('vedamCursorFixSkippedEditorSetValue');
        return;
      }

      return originalSetValue.apply(this, arguments);
    };

    if (typeof editor.executeEdits === 'function') {
      var originalExecuteEdits = editor.executeEdits;
      editor.executeEdits = function (source, edits) {
        var model = this.getModel?.();
        if (shouldSkipFullReplace(model, edits, source || 'editor.executeEdits')) {
          incrementCounter('vedamCursorFixSkippedExecuteEdits');
          return false;
        }
        return originalExecuteEdits.apply(this, arguments);
      };
    }
  }

  function patchMonaco() {
    if (!isCodingLab()) return false;
    var monaco = window.monaco;
    if (!monaco?.editor) return false;

    document.documentElement.dataset.vedamCursorFixMonacoSeen = 'true';
    getEditors().forEach(patchEditor);
    document.documentElement.dataset.vedamCursorFixEditors = String(getEditors().length);

    if (!monaco.editor.__vedamCursorFixCreatePatched && typeof monaco.editor.create === 'function') {
      monaco.editor.__vedamCursorFixCreatePatched = true;
      var originalCreate = monaco.editor.create;
      monaco.editor.create = function () {
        var editor = originalCreate.apply(this, arguments);
        patchEditor(editor);
        return editor;
      };
    }

    return true;
  }

  var poller = window.setInterval(function () {
    patchMonaco();
    if (Date.now() - startedAt > TIMEOUT_MS) window.clearInterval(poller);
  }, POLL_MS);

  patchMonaco();

  document.addEventListener('keydown', function (event) {
    if (event.target?.closest?.('.monaco-editor')) markUserInput();
  }, true);
  document.addEventListener('beforeinput', function (event) {
    if (event.target?.closest?.('.monaco-editor')) markUserInput();
  }, true);
  document.addEventListener('paste', function (event) {
    if (event.target?.closest?.('.monaco-editor')) markUserInput();
  }, true);
})();
