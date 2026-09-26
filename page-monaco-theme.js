(function () {
  'use strict';

  if (window.__vedamReskinMonacoThemeInstaller) {
    window.__vedamReskinMonacoThemeInstaller.requestApply('duplicate-injection');
    return;
  }

  var THEME_NAME = 'vedam-onedark';
  var EDITOR_FONT_FAMILY = 'Menlo, Monaco, monospace';
  var APPLY_INTERVAL_MS = 200;
  var APPLY_TIMEOUT_MS = 30000;
  var JAVA_TYPES = [
    'Boolean', 'Byte', 'Character', 'CharSequence', 'Double', 'Float',
    'Integer', 'Long', 'Object', 'Scanner', 'Short', 'String',
    'StringBuilder', 'StringBuffer'
  ];
  var JAVA_KEYWORD_SET = Object.create(null);
  [
    'abstract', 'assert', 'break', 'case', 'catch', 'class', 'continue',
    'default', 'do', 'else', 'extends', 'final', 'finally', 'for', 'if',
    'implements', 'import', 'instanceof', 'interface', 'native', 'new',
    'package', 'private', 'protected', 'public', 'return', 'static',
    'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw',
    'throws', 'transient', 'try', 'volatile', 'while'
  ].forEach(function (keyword) {
    JAVA_KEYWORD_SET[keyword] = true;
  });
  var JAVA_PRIMITIVE_SET = Object.create(null);
  [
    'boolean', 'byte', 'char', 'double', 'float', 'int', 'long', 'short',
    'void'
  ].forEach(function (keyword) {
    JAVA_PRIMITIVE_SET[keyword] = true;
  });
  var CONTROL_WORD_SET = Object.create(null);
  [
    'catch', 'do', 'for', 'if', 'switch', 'synchronized', 'try', 'while'
  ].forEach(function (keyword) {
    CONTROL_WORD_SET[keyword] = true;
  });
  var MONARCH_PROVIDER_INSTALLED = false;
  var monarchDisposable = null;

  var state = window.__vedamReskinMonacoThemeInstaller = {
    defined: false,
    hooksInstalled: false,
    requirePending: false,
    lastApplySource: '',
    lastApplyAt: 0,
    timer: 0,
    poller: 0,
    requestApply: requestApply,
    setEnabled: setEnabled,
    nativeTheme: 'vs',
    monaco: null
  };

  function reskinEnabled() {
    var setting = document.documentElement?.dataset.vedamReskinEnabled;
    if (setting) return setting === 'on';
    try {
      return window.localStorage.getItem('vedam-reskin-coding-enabled') !== 'off';
    } catch (error) {
      return true;
    }
  }

  function setEnabled(enabled) {
    window.clearTimeout(state.timer);
    if (!enabled) {
      if (monarchDisposable?.dispose) {
        monarchDisposable.dispose();
        monarchDisposable = null;
        MONARCH_PROVIDER_INSTALLED = false;
      }
      if (state.monaco?.editor?.setTheme) {
        state.monaco.editor.setTheme(state.nativeTheme || 'vs');
        layoutEditors(state.monaco, true);
      }
      return;
    }
    requestApply('reskin-enabled', 0);
  }

  function isCodingLab() {
    try {
      return new URL(window.location.href).searchParams.has('questionId');
    } catch (error) {
      return false;
    }
  }

  var ONE_DARK_THEME = {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'abb2bf' },

      { token: 'keyword', foreground: 'e06c75' },
      { token: 'keyword.abstract', foreground: 'e06c75' },
      { token: 'keyword.assert', foreground: 'e06c75' },
      { token: 'keyword.break', foreground: 'e06c75' },
      { token: 'keyword.case', foreground: 'e06c75' },
      { token: 'keyword.catch', foreground: 'e06c75' },
      { token: 'keyword.class', foreground: 'e06c75' },
      { token: 'keyword.continue', foreground: 'e06c75' },
      { token: 'keyword.default', foreground: 'e06c75' },
      { token: 'keyword.do', foreground: 'e06c75' },
      { token: 'keyword.else', foreground: 'e06c75' },
      { token: 'keyword.extends', foreground: 'e06c75' },
      { token: 'keyword.final', foreground: 'e06c75' },
      { token: 'keyword.finally', foreground: 'e06c75' },
      { token: 'keyword.for', foreground: 'e06c75' },
      { token: 'keyword.if', foreground: 'e06c75' },
      { token: 'keyword.implements', foreground: 'e06c75' },
      { token: 'keyword.import', foreground: 'e06c75' },
      { token: 'keyword.instanceof', foreground: 'e06c75' },
      { token: 'keyword.interface', foreground: 'e06c75' },
      { token: 'keyword.native', foreground: 'e06c75' },
      { token: 'keyword.new', foreground: 'e06c75' },
      { token: 'keyword.package', foreground: 'e06c75' },
      { token: 'keyword.private', foreground: 'e06c75' },
      { token: 'keyword.protected', foreground: 'e06c75' },
      { token: 'keyword.public', foreground: 'e06c75' },
      { token: 'keyword.return', foreground: 'e06c75' },
      { token: 'keyword.static', foreground: 'e06c75' },
      { token: 'keyword.strictfp', foreground: 'e06c75' },
      { token: 'keyword.super', foreground: 'e06c75' },
      { token: 'keyword.switch', foreground: 'e06c75' },
      { token: 'keyword.synchronized', foreground: 'e06c75' },
      { token: 'keyword.this', foreground: 'e06c75' },
      { token: 'keyword.throw', foreground: 'e06c75' },
      { token: 'keyword.throws', foreground: 'e06c75' },
      { token: 'keyword.transient', foreground: 'e06c75' },
      { token: 'keyword.try', foreground: 'e06c75' },
      { token: 'keyword.volatile', foreground: 'e06c75' },
      { token: 'keyword.while', foreground: 'e06c75' },

      { token: 'keyword.boolean', foreground: '56b6c2' },
      { token: 'keyword.byte', foreground: '56b6c2' },
      { token: 'keyword.char', foreground: '56b6c2' },
      { token: 'keyword.double', foreground: '56b6c2' },
      { token: 'keyword.float', foreground: '56b6c2' },
      { token: 'keyword.int', foreground: '56b6c2' },
      { token: 'keyword.long', foreground: '56b6c2' },
      { token: 'keyword.short', foreground: '56b6c2' },
      { token: 'keyword.void', foreground: '56b6c2' },

      { token: 'keyword.false', foreground: 'd19a66' },
      { token: 'keyword.null', foreground: 'd19a66' },
      { token: 'keyword.true', foreground: 'd19a66' },

      { token: 'identifier', foreground: '61afef' },
      { token: 'identifier.class', foreground: '61afef' },
      { token: 'identifier.function', foreground: '98c379' },
      { token: 'identifier.method', foreground: '98c379' },
      { token: 'identifier.parameter', foreground: 'd19a66', fontStyle: 'italic' },
      { token: 'identifier.property', foreground: '61afef' },
      { token: 'identifier.variable', foreground: 'ffffff' },
      { token: 'type.identifier', foreground: '56b6c2' },
      { token: 'keyword.type', foreground: '56b6c2' },
      { token: 'number', foreground: 'c678dd' },
      { token: 'number.float', foreground: 'c678dd' },
      { token: 'number.hex', foreground: 'c678dd' },
      { token: 'string', foreground: '98c379' },
      { token: 'string.escape', foreground: '56b6c2' },
      { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
      { token: 'comment.block', foreground: '5c6370', fontStyle: 'italic' },
      { token: 'comment.line', foreground: '5c6370', fontStyle: 'italic' },
      { token: 'comment.doc', foreground: '5c6370', fontStyle: 'italic' },
      { token: 'delimiter', foreground: 'ffffff' },
      { token: 'delimiter.bracket', foreground: 'ffffff' },
      { token: 'delimiter.curly', foreground: 'ffffff' },
      { token: 'delimiter.parenthesis', foreground: 'ffffff' },
      { token: 'delimiter.square', foreground: 'ffffff' },
      { token: 'operator', foreground: 'e06c75' },
      { token: 'annotation', foreground: 'e5c07b' },
      { token: 'invalid', foreground: 'f44747' }
    ],
    colors: {
      'editor.background': '#27272a',
      'editor.foreground': '#abb2bf',
      'editor.lineHighlightBackground': '#2c313c',
      'editor.lineHighlightBorder': '#2c313c00',
      'editor.selectionBackground': '#3e4451',
      'editor.inactiveSelectionBackground': '#3a3f4b',
      'editorLineNumber.foreground': '#495162',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editorCursor.foreground': '#528bff',
      'editorBracketMatch.background': '#515a6b',
      'editorBracketMatch.border': '#9ca3af',
      'editorIndentGuide.background': '#3b4048',
      'editorIndentGuide.activeBackground': '#c8c8c859',
      'editorWhitespace.foreground': '#3b4048',
      'editorGutter.background': '#27272a',
      'editorOverviewRuler.border': '#27272a',
      'editorWidget.background': '#181a1f',
      'editorSuggestWidget.background': '#181a1f',
      'editorSuggestWidget.border': '#181a1f',
      'editorSuggestWidget.foreground': '#abb2bf',
      'editorSuggestWidget.selectedBackground': '#2c313c',
      'editorHoverWidget.background': '#181a1f',
      'editorHoverWidget.border': '#181a1f',
      'scrollbar.shadow': '#000000',
      'scrollbarSlider.background': 'rgba(78, 86, 102, 0.5)',
      'scrollbarSlider.hoverBackground': 'rgba(90, 99, 117, 0.5)',
      'scrollbarSlider.activeBackground': 'rgba(90, 99, 117, 0.7)',
      'input.background': '#1b1d23',
      'focusBorder': '#528bff'
    }
  };

  function ownKeys(map) {
    return Object.keys(map);
  }

  function createJavaMonarchProvider() {
    return {
      defaultToken: '',
      tokenPostfix: '.java',
      keywords: ownKeys(JAVA_KEYWORD_SET),
      typeKeywords: ownKeys(JAVA_PRIMITIVE_SET),
      builtins: JAVA_TYPES,
      controlWords: ownKeys(CONTROL_WORD_SET),
      operators: [
        '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||',
        '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>',
        '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '>>>='
      ],
      symbols: /[=><!~?:&|+\-*\/\^%]+/,
      escapes: /\\(?:[btnfr"'\\]|u[0-9A-Fa-f]{4})/,
      tokenizer: {
        root: [
          [/[ \t\r\n]+/, 'white'],
          [/\/\*/, 'comment', '@comment'],
          [/\/\/.*$/, 'comment'],

          [
            /(boolean|byte|char|double|float|int|long|short|void|Boolean|Byte|Character|CharSequence|Double|Float|Integer|Long|Object|Scanner|Short|String|StringBuilder|StringBuffer)(\s*(?:\[\s*\])?)(\s+)([A-Za-z_$][\w$]*)(?=\s*[,)\{])/,
            ['keyword.type', 'delimiter', 'white', 'identifier.parameter']
          ],
          [/(\.)([A-Za-z_$][\w$]*)(?=\s*\()/, ['delimiter', 'identifier.method']],
          [/(\.)([A-Za-z_$][\w$]*)/, ['delimiter', 'identifier.property']],
          [
            /[A-Za-z_$][\w$]*(?=\s*\()/,
            {
              cases: {
                '@controlWords': 'keyword',
                '@keywords': 'keyword',
                '@typeKeywords': 'keyword.type',
                '@builtins': 'type.identifier',
                '@default': 'identifier.function'
              }
            }
          ],
          [
            /[A-Z][\w$]*/,
            {
              cases: {
                '@builtins': 'type.identifier',
                '@default': 'identifier.class'
              }
            }
          ],
          [
            /[A-Za-z_$][\w$]*/,
            {
              cases: {
                '@typeKeywords': 'keyword.type',
                '@keywords': 'keyword',
                '@builtins': 'type.identifier',
                '@default': 'identifier.variable'
              }
            }
          ],

          [/0[xX][0-9a-fA-F_]+[lL]?/, 'number.hex'],
          [/\d*\.\d+(?:[eE][\-+]?\d+)?[fFdD]?/, 'number.float'],
          [/\d+(?:[eE][\-+]?\d+)?[lLfFdD]?/, 'number'],
          [/[{}()\[\]]/, '@brackets'],
          [/[;,.]/, 'delimiter'],
          [/@symbols/, { cases: { '@operators': 'operator', '@default': 'delimiter' } }],
          [/"([^"\\]|\\.)*$/, 'string.invalid'],
          [/"/, 'string', '@string'],
          [/'[^\\']'/, 'string'],
          [/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
          [/'/, 'string.invalid']
        ],
        comment: [
          [/[^\/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[\/*]/, 'comment']
        ],
        string: [
          [/[^\\"]+/, 'string'],
          [/@escapes/, 'string.escape'],
          [/\\./, 'string.escape.invalid'],
          [/"/, 'string', '@pop']
        ]
      }
    };
  }

  function installJavaMonarchProvider(monaco) {
    if (MONARCH_PROVIDER_INSTALLED || !monaco || !monaco.languages) return;
    if (typeof monaco.languages.setMonarchTokensProvider !== 'function') return;

    try {
      monarchDisposable = monaco.languages.setMonarchTokensProvider('java', createJavaMonarchProvider());
      MONARCH_PROVIDER_INSTALLED = true;
    } catch (error) {
      console.warn('[Vedam Reskin] Java tokenizer install failed:', error);
    }
  }

  function hasUsableMonaco(monaco) {
    return !!(
      monaco &&
      monaco.editor &&
      typeof monaco.editor.defineTheme === 'function' &&
      typeof monaco.editor.setTheme === 'function'
    );
  }

  function getAmdRequire() {
    if (typeof window.require === 'function') return window.require;
    try {
      if (typeof require === 'function') return require;
    } catch (error) {}
    return null;
  }

  function getEditors(monaco) {
    if (!monaco || !monaco.editor || typeof monaco.editor.getEditors !== 'function') return [];
    try {
      return monaco.editor.getEditors() || [];
    } catch (error) {
      return [];
    }
  }

  function patchEditorOptions(editor, nativeFontFamily) {
    if (!editor || typeof editor.updateOptions !== 'function') return;
    if (editor.__vedamReskinOptionsHooked) {
      if (nativeFontFamily) editor.__vedamReskinNativeOptions.fontFamily = nativeFontFamily;
      return;
    }

    var original = typeof editor.getRawOptions === 'function' ? editor.getRawOptions() : {};
    editor.__vedamReskinNativeOptions = {
      automaticLayout: original.automaticLayout,
      bracketPairColorization: original.bracketPairColorization,
      fontFamily: nativeFontFamily || original.fontFamily,
      matchBrackets: original.matchBrackets,
      tabFocusMode: original.tabFocusMode,
      semanticHighlighting: original.semanticHighlighting
    };

    var originalUpdateOptions = editor.updateOptions;
    editor.updateOptions = function (options) {
      if (!this.__vedamReskinUpdatingOptions && options) {
        var nativeOptions = this.__vedamReskinNativeOptions;
        Object.keys(nativeOptions).forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(options, key)) nativeOptions[key] = options[key];
        });
        if (reskinEnabled() && Object.prototype.hasOwnProperty.call(options, 'fontFamily')) {
          options = Object.assign({}, options, { fontFamily: EDITOR_FONT_FAMILY });
        }
      }
      return originalUpdateOptions.call(this, options);
    };
    editor.__vedamReskinOptionsHooked = true;
  }

  function updateReskinOptions(editor, options) {
    editor.__vedamReskinUpdatingOptions = true;
    try {
      editor.updateOptions(options);
    } finally {
      editor.__vedamReskinUpdatingOptions = false;
    }
  }

  function layoutEditors(monaco, restore) {
    getEditors(monaco).forEach(function (editor) {
      try {
        if (typeof editor.updateOptions === 'function') {
          patchEditorOptions(editor);
          if (restore && editor.__vedamReskinOptionsApplied) {
            updateReskinOptions(editor, editor.__vedamReskinNativeOptions);
            editor.__vedamReskinOptionsApplied = false;
          } else if (!restore && !editor.__vedamReskinOptionsApplied) {
            updateReskinOptions(editor, {
              automaticLayout: true,
              bracketPairColorization: { enabled: false },
              fontFamily: EDITOR_FONT_FAMILY,
              matchBrackets: 'always',
              tabFocusMode: false,
              semanticHighlighting: { enabled: false }
            });
            editor.__vedamReskinOptionsApplied = true;
          }
        }
        if (typeof editor.layout === 'function') editor.layout();
      } catch (error) {}
    });
  }

  function applyTheme(monaco, source) {
    if (!reskinEnabled() || !hasUsableMonaco(monaco)) return false;

    try {
      state.monaco = monaco;
      if (!state.hooksInstalled) {
        var existingEditor = document.querySelector('.monaco-editor');
        if (existingEditor?.classList.contains('vs-dark')) state.nativeTheme = 'vs-dark';
      }
      if (!state.defined) {
        installJavaMonarchProvider(monaco);
        monaco.editor.defineTheme(THEME_NAME, ONE_DARK_THEME);
        state.defined = true;
      }
      installJavaMonarchProvider(monaco);

      installMonacoHooks(monaco);
      monaco.editor.setTheme(THEME_NAME);
      layoutEditors(monaco);

      state.lastApplySource = source;
      state.lastApplyAt = Date.now();
      if (state.poller) {
        window.clearInterval(state.poller);
        state.poller = 0;
      }
      console.log(
        '%c[Vedam Reskin] One Dark Pro Monaco theme applied (' + source + ').',
        'color: #98c379; font-weight: bold;'
      );
      return true;
    } catch (error) {
      console.warn('[Vedam Reskin] Monaco theme apply failed:', error);
      state.defined = false;
      return false;
    }
  }

  function installMonacoHooks(monaco) {
    if (state.hooksInstalled || !hasUsableMonaco(monaco)) return;
    state.hooksInstalled = true;

    var originalCreate = monaco.editor.create;
    if (typeof originalCreate === 'function') {
      monaco.editor.create = function (container, options) {
        if (options?.theme && options.theme !== THEME_NAME) state.nativeTheme = options.theme;
        var nativeFontFamily = options?.fontFamily;
        var editorOptions = reskinEnabled() && nativeFontFamily
          ? Object.assign({}, options, { fontFamily: EDITOR_FONT_FAMILY })
          : options;
        var editor = originalCreate.call(this, container, editorOptions);
        patchEditorOptions(editor, nativeFontFamily);
        requestApply('editor.create', 0);
        window.setTimeout(function () { if (reskinEnabled()) layoutEditors(monaco); }, 50);
        window.setTimeout(function () { if (reskinEnabled()) layoutEditors(monaco); }, 300);
        return editor;
      };
    }

    var originalSetTheme = monaco.editor.setTheme;
    if (typeof originalSetTheme === 'function') {
      monaco.editor.setTheme = function (themeName) {
        var result = originalSetTheme.apply(this, arguments);
        if (themeName !== THEME_NAME) {
          if (reskinEnabled()) {
            state.nativeTheme = themeName;
            requestApply('theme-reset:' + themeName, 0);
          }
        }
        return result;
      };
    }
  }

  function tryApply(source) {
    if (!isCodingLab() || !reskinEnabled()) return;

    if (applyTheme(window.monaco, source + ':window-monaco')) return;

    var amdRequire = getAmdRequire();
    if (!amdRequire || state.requirePending) return;

    state.requirePending = true;
    try {
      amdRequire(['vs/editor/editor.main'], function (monaco) {
        state.requirePending = false;
        if (reskinEnabled()) applyTheme(monaco || window.monaco, source + ':amd-require');
      });
    } catch (error) {
      state.requirePending = false;
    }
  }

  function requestApply(source, delay) {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(function () {
      tryApply(source || 'scheduled');
    }, typeof delay === 'number' ? delay : 50);
  }

  function hookWindowProperty(name) {
    var currentValue = window[name];
    var descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && descriptor.configurable === false) return;

    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function () {
          return currentValue;
        },
        set: function (nextValue) {
          currentValue = nextValue;
          requestApply('window.' + name + '-set', 0);
        }
      });
    } catch (error) {}
  }

  function inspectNode(node) {
    if (!node || node.nodeType !== 1) return;

    var isMonacoScript = node.tagName === 'SCRIPT' &&
      typeof node.src === 'string' &&
      (node.src.indexOf('/vs/') !== -1 || node.src.indexOf('monaco-editor') !== -1);

    if (isMonacoScript) {
      node.addEventListener('load', function () {
        requestApply('script-load', 0);
      }, { once: true });
      requestApply('script-seen', 0);
      return;
    }

    if (
      (node.classList && node.classList.contains('monaco-editor')) ||
      (typeof node.querySelector === 'function' && node.querySelector('.monaco-editor'))
    ) {
      requestApply('editor-node', 0);
    }

    if (typeof node.querySelectorAll === 'function') {
      node.querySelectorAll('script[src*="/vs/"], script[src*="monaco-editor"]').forEach(inspectNode);
    }
  }

  function installDomHooks() {
    var originalAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function (child) {
      var result = originalAppendChild.apply(this, arguments);
      inspectNode(child);
      return result;
    };

    var originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (child) {
      var result = originalInsertBefore.apply(this, arguments);
      inspectNode(child);
      return result;
    };

    var originalReplaceChild = Node.prototype.replaceChild;
    Node.prototype.replaceChild = function (newChild) {
      var result = originalReplaceChild.apply(this, arguments);
      inspectNode(newChild);
      return result;
    };

    if (window.Element && Element.prototype.append) {
      var originalAppend = Element.prototype.append;
      Element.prototype.append = function () {
        var result = originalAppend.apply(this, arguments);
        Array.prototype.forEach.call(arguments, inspectNode);
        return result;
      };
    }

    if (window.Element && Element.prototype.prepend) {
      var originalPrepend = Element.prototype.prepend;
      Element.prototype.prepend = function () {
        var result = originalPrepend.apply(this, arguments);
        Array.prototype.forEach.call(arguments, inspectNode);
        return result;
      };
    }
  }

  hookWindowProperty('monaco');
  hookWindowProperty('require');
  installDomHooks();

  new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      Array.prototype.forEach.call(mutation.addedNodes, inspectNode);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  requestApply('initial', 0);
  state.poller = window.setInterval(function () {
    requestApply('poll', 0);
  }, APPLY_INTERVAL_MS);
  window.setTimeout(function () {
    window.clearInterval(state.poller);
  }, APPLY_TIMEOUT_MS);

  document.addEventListener('DOMContentLoaded', function () { requestApply('domcontentloaded', 0); });
  window.addEventListener('load', function () { requestApply('window-load', 0); });
  window.addEventListener('pageshow', function () { requestApply('pageshow', 0); });
  window.addEventListener('resize', function () { requestApply('resize', 0); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      requestApply('visible', 0);
    }
  });
})();
