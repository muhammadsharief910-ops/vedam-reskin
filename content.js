/**
 * Vedam LMS Reskin - Content Script
 *
 * Only activates on coding lab pages (URLs with questionId parameter).
 * Runs after page-monaco-theme.js, which installs the Monaco theme/tokenizer
 * from the extension's MAIN-world content script.
 */

(function () {
  'use strict';

  const RESKIN_PREFERENCE = 'vedam-reskin-coding-enabled';
  let lastMode = '';
  let isTagging = false;
  let initTimer = null;
  let initAttempts = 0;
  let fallbackReskinEnabled = true;
  const panelStyles = new Map();
  const headingStyles = new Map();
  const headingProperties = ['font-size', 'font-weight', 'line-height', 'letter-spacing'];

  function rememberStyles(store, element, properties) {
    if (store.has(element)) return;
    store.set(element, properties.map(property => ({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property)
    })));
  }

  function restoreStyles(store) {
    store.forEach((properties, element) => {
      if (!element.isConnected) return;
      properties.forEach(({ property, value, priority }) => {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      });
    });
    store.clear();
  }

  function reskinEnabled() {
    try {
      return window.localStorage.getItem(RESKIN_PREFERENCE) !== 'off';
    } catch {
      return fallbackReskinEnabled;
    }
  }

  function isCodingLab(url) {
    try {
      return new URL(url || window.location.href).searchParams.has('questionId');
    } catch {
      return false;
    }
  }

  function syncReskin() {
    const currentUrl = window.location.href;
    const codingLab = isCodingLab(currentUrl);
    const enabled = codingLab && reskinEnabled();
    const mode = `${currentUrl}|${enabled}`;
    if (mode === lastMode) return;
    lastMode = mode;
    document.documentElement.dataset.vedamReskinEnabled = enabled ? 'on' : 'off';
    window.__vedamReskinMonacoThemeInstaller?.setEnabled?.(enabled);

    if (enabled) {
      injectPageCursorFix();
      document.documentElement.classList.add('vedam-reskin');
      document.documentElement.classList.remove('vedam-reskin-ready');
      document.documentElement.classList.add('vedam-reskin-booting');
      if (document.body) document.body.classList.add('vedam-reskin');
      window.__vedamReskinMonacoThemeInstaller?.requestApply?.('coding-url');
      startInitLoop();
    } else {
      const wasReskinned = document.documentElement.classList.contains('vedam-reskin');
      if (initTimer) {
        window.clearInterval(initTimer);
        initTimer = null;
      }
      document.documentElement.classList.remove('vedam-reskin', 'vedam-reskin-ready', 'vedam-reskin-booting');
      if (document.body) document.body.classList.remove('vedam-reskin', 'vedam-reskin-resizing');
      if (wasReskinned) {
        document.querySelectorAll('[data-reskin-resizer]').forEach(handle => handle.remove());
        restoreStyles(panelStyles);
        restoreStyles(headingStyles);
      }
    }
  }

  function ensureToggle() {
    const existing = document.getElementById('vedam-reskin-toggle');
    if (!isCodingLab()) {
      existing?.remove();
      return;
    }

    const actions = document.querySelector('.css-1n07oit > .css-172hjuw:last-child');
    if (!actions) return;

    let toggle = existing;
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'vedam-reskin-toggle';
      toggle.type = 'button';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', 'Reskin problem page');
      toggle.innerHTML = '<span class="vedam-reskin-toggle-label">Reskin</span><span class="vedam-reskin-toggle-track" aria-hidden="true"><span class="vedam-reskin-toggle-thumb"></span></span><span class="vedam-reskin-toggle-state"></span>';
    }
    if (toggle.parentElement !== actions) actions.prepend(toggle);
    const enabled = reskinEnabled();
    const value = enabled ? 'true' : 'false';
    if (toggle.getAttribute('aria-checked') !== value) {
      toggle.setAttribute('aria-checked', value);
      toggle.querySelector('.vedam-reskin-toggle-state').textContent = enabled ? 'On' : 'Off';
      toggle.title = enabled ? 'Turn off the problem page reskin' : 'Turn on the problem page reskin';
    }
  }

  document.addEventListener('click', event => {
    if (!event.target?.closest?.('#vedam-reskin-toggle')) return;
    event.preventDefault();
    event.stopPropagation();
    const next = !reskinEnabled();
    fallbackReskinEnabled = next;
    try {
      window.localStorage.setItem(RESKIN_PREFERENCE, next ? 'on' : 'off');
    } catch {}
    syncReskin();
    ensureToggle();
    if (next) runReskinUpdate();
    window.dispatchEvent(new Event('resize'));
  }, true);

  function injectPageCursorFix() {
    if (document.documentElement.dataset.vedamCursorFixInjected === 'true') return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return;

    document.documentElement.dataset.vedamCursorFixInjected = 'true';
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-cursor-fix.js');
    script.async = false;
    script.dataset.vedamCursorFix = 'true';
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  syncReskin();

  function startInitLoop() {
    if (initTimer) return;
    initAttempts = 0;
    initTimer = window.setInterval(() => {
      runReskinUpdate();
      initAttempts += 1;
      if (document.documentElement.classList.contains('vedam-reskin-ready') || initAttempts > 40) {
        document.documentElement.classList.remove('vedam-reskin-booting');
        window.clearInterval(initTimer);
        initTimer = null;
      }
    }, 50);
  }

  function maybeMarkReady() {
    const hasMainLayout = !!document.querySelector('.css-knn3zu .css-ig9lpx')
      && !!document.querySelector('.css-knn3zu .css-14tvm1h');
    const hasMainResizer = !!document.querySelector('.css-knn3zu > [data-reskin-resizer="main"]');
    const rightPanel = document.querySelector('.css-14tvm1h');
    const needsRightResizer = !!rightPanel?.querySelector('.css-10fxlwj')
      && !!rightPanel?.querySelector('.css-7fsbrp');
    const hasRightResizer = !needsRightResizer
      || !!rightPanel?.querySelector(':scope > [data-reskin-resizer="right"]');

    if (hasMainLayout && hasMainResizer && hasRightResizer) {
      document.documentElement.classList.add('vedam-reskin-ready');
      document.documentElement.classList.remove('vedam-reskin-booting');
      if (initTimer) {
        window.clearInterval(initTimer);
        initTimer = null;
      }
    }
  }

  function bindDrag(handle, onMove) {
    if (handle.dataset.reskinDragBound === 'true') return;
    handle.dataset.reskinDragBound = 'true';

    handle.addEventListener('pointerdown', event => {
      event.preventDefault();
      handle.setPointerCapture?.(event.pointerId);
      document.body?.classList.add('vedam-reskin-resizing');

      const move = moveEvent => onMove(moveEvent);
      const up = upEvent => {
        handle.releasePointerCapture?.(upEvent.pointerId);
        document.body?.classList.remove('vedam-reskin-resizing');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.dispatchEvent(new Event('resize'));
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function ensureResizers() {
    const main = document.querySelector('.css-knn3zu');
    if (!main) return;

    const mainChildren = [...main.children];
    const leftPanel = mainChildren.find(el => el.classList.contains('css-ig9lpx'));
    const rightPanel = mainChildren.find(el => el.classList.contains('css-14tvm1h'));

    if (leftPanel && rightPanel && !main.querySelector(':scope > [data-reskin-resizer="main"]')) {
      const handle = document.createElement('div');
      handle.setAttribute('data-reskin-resizer', 'main');
      leftPanel.after(handle);

      bindDrag(handle, event => {
        const rect = main.getBoundingClientRect();
        const handleWidth = handle.getBoundingClientRect().width || 8;
        const min = Math.max(320, rect.width * 0.25);
        const max = Math.min(rect.width - 360, rect.width * 0.72);
        const next = Math.min(max, Math.max(min, event.clientX - rect.left - handleWidth / 2));

        rememberStyles(panelStyles, leftPanel, ['flex', 'width']);
        rememberStyles(panelStyles, rightPanel, ['flex', 'width']);
        leftPanel.style.setProperty('flex', `0 0 ${next}px`, 'important');
        leftPanel.style.setProperty('width', `${next}px`, 'important');
        rightPanel.style.setProperty('flex', '1 1 0', 'important');
        rightPanel.style.removeProperty('width');
        window.dispatchEvent(new Event('resize'));
      });
    }

    const rightChildren = rightPanel ? [...rightPanel.children] : [];
    const editorPanel = rightChildren.find(el => el.classList.contains('css-10fxlwj'));
    const testPanel = rightChildren.find(el => el.classList.contains('css-7fsbrp'));

    if (rightPanel && editorPanel && testPanel && !rightPanel.querySelector(':scope > [data-reskin-resizer="right"]')) {
      const handle = document.createElement('div');
      handle.setAttribute('data-reskin-resizer', 'right');
      editorPanel.after(handle);

      bindDrag(handle, event => {
        const rect = rightPanel.getBoundingClientRect();
        const handleHeight = handle.getBoundingClientRect().height || 8;
        const min = Math.max(230, rect.height * 0.24);
        const max = Math.min(rect.height - 220, rect.height * 0.74);
        const next = Math.min(max, Math.max(min, event.clientY - rect.top - handleHeight / 2));

        rememberStyles(panelStyles, editorPanel, ['flex']);
        rememberStyles(panelStyles, testPanel, ['flex']);
        editorPanel.style.setProperty('flex', `0 0 ${next}px`, 'important');
        testPanel.style.setProperty('flex', '1 1 0', 'important');
        window.dispatchEvent(new Event('resize'));
      });
    }
  }

  function toastTypeFromText(text) {
    if (/success|executed successfully|accepted/i.test(text)) return 'success';
    if (/error|failed|wrong answer|compilation/i.test(text)) return 'error';
    return '';
  }

  function elementClassText(el) {
    const className = el?.className;
    if (!className) return '';
    return typeof className === 'string' ? className : String(className.baseVal || className);
  }

  function looksLikeToastShell(el) {
    const classText = elementClassText(el);
    if (/snackbar|toast|notistack|alert/i.test(classText)) return true;
    if (el.getAttribute?.('role') === 'alert') return true;

    const style = window.getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'absolute') return false;

    const rect = el.getBoundingClientRect();
    const zIndex = Number.parseInt(style.zIndex, 10);
    return rect.width >= 220 && rect.height >= 42 && (Number.isNaN(zIndex) || zIndex >= 100);
  }

  function toastContainerFor(el) {
    let container = el;
    let fixedShell = null;

    for (let depth = 0; container && depth < 8; depth += 1) {
      if (looksLikeToastShell(container)) fixedShell = container;
      const parent = container.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      container = parent;
    }

    return fixedShell;
  }

  function tagToasts() {
    document.querySelectorAll('[data-reskin-toast]').forEach(el => {
      const text = (el.textContent || '').trim();
      const type = toastTypeFromText(text);
      if (type) {
        el.setAttribute('data-reskin-toast', type);
      } else {
        el.removeAttribute('data-reskin-toast');
      }
    });

    const selector = [
      '[role="alert"]',
      '.MuiSnackbar-root',
      '.MuiAlert-root',
      '[class*="Snackbar"]',
      '[class*="snackbar"]',
      '[class*="Toast"]',
      '[class*="toast"]',
      '[class*="notistack"]'
    ].join(',');

    document.querySelectorAll(selector).forEach(el => {
      const text = (el.textContent || '').trim();
      const type = toastTypeFromText(text);
      if (!type) return;

      const container = toastContainerFor(el) || el;
      const rect = container.getBoundingClientRect();
      if (rect.width < 220 || rect.height < 42) return;

      container.setAttribute('data-reskin-toast', type);
    });
  }

  function resultStatusType(text) {
    const value = text.replace(/\s+/g, ' ').trim().toUpperCase();
    if (value === 'ACCEPTED' || value === 'PASSED') return 'success';
    if (value === 'PARTIALLY ACCEPTED') return 'warning';
    if (
      value === 'WRONG ANSWER'
      || value === 'COMPILATION ERROR'
      || value === 'RUNTIME ERROR'
      || value === 'TIME LIMIT EXCEEDED'
      || value === 'FAILED'
    ) return 'error';
    return '';
  }

  function tagResultStatusText() {
    document.querySelectorAll('[data-reskin-result-status]').forEach(el => {
      el.removeAttribute('data-reskin-result-status');
    });

    document.querySelectorAll('.MuiTypography-root, h1, h2, h3, p').forEach(el => {
      const type = resultStatusType(el.textContent || '');
      if (!type) return;

      el.setAttribute('data-reskin-result-status', type);
      const parent = el.parentElement;
      if (parent?.classList.contains('MuiBox-root') && resultStatusType(parent.textContent || '') === type) {
        parent.setAttribute('data-reskin-result-status', type);
      }
    });
  }

  function tagElements() {
    if (!isCodingLab() || !reskinEnabled()) return;
    if (document.body) document.body.classList.add('vedam-reskin');
    if (isTagging) return;
    isTagging = true;

    try {
      document.querySelectorAll('button').forEach(btn => {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text === 'submit') {
          btn.setAttribute('data-reskin', 'submit-btn');
        } else if (text === 'complete') {
          btn.setAttribute('data-reskin', 'complete-btn');
        }
      });

      document.querySelectorAll('.monaco-editor').forEach(el => {
        const container = el.closest('.MuiBox-root') || el.parentElement;
        if (container) container.setAttribute('data-reskin', 'editor-area');
      });

      ensureResizers();
      tagToasts();
      tagResultStatusText();

      const leftPanel = document.querySelector('.css-ig9lpx');
      const selectedLeftTab = leftPanel?.querySelector('.MuiTab-root.Mui-selected');
      if (leftPanel && selectedLeftTab) {
        const selectedText = (selectedLeftTab.textContent || '').trim().toLowerCase();
        leftPanel.setAttribute(
          'data-reskin-active-tab',
          selectedText.includes('submission') ? 'submissions' : 'description'
        );
      }

      const descriptionPanel = document.querySelector('.css-ubznp');
      if (descriptionPanel) {
        const resetTypography = heading => {
          heading.removeAttribute('data-reskin');
          rememberStyles(headingStyles, heading, headingProperties);
          headingProperties.forEach(prop => {
            heading.style.removeProperty(prop);
          });
        };

        const headings = [...descriptionPanel.querySelectorAll('.MuiTypography-root')];
        headings.forEach(resetTypography);

        const selectedTab = document.querySelector('.css-ig9lpx .MuiTab-root.Mui-selected');
        const isDescriptionTab = /description/i.test(selectedTab?.textContent || '');

        if (isDescriptionTab) {
          headings.forEach((heading, index) => {
            if (index === 0) {
              heading.setAttribute('data-reskin', 'problem-title');
            } else {
              heading.setAttribute('data-reskin', 'problem-label');
            }
          });
        }
      }

      maybeMarkReady();
    } finally {
      isTagging = false;
    }
  }

  function runReskinUpdate() {
    syncReskin();
    ensureToggle();
    tagElements();
  }

  if (document.body) runReskinUpdate();
  else document.addEventListener('DOMContentLoaded', runReskinUpdate);

  const observer = new MutationObserver(() => {
    if (!isTagging) runReskinUpdate();
  });

  function startObserving() {
    const target = document.body || document.documentElement;
    observer.observe(target, { childList: true, characterData: true, subtree: true });
  }

  if (document.body) startObserving();
  else document.addEventListener('DOMContentLoaded', startObserving);

  setInterval(syncReskin, 500);

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    const result = origPush.apply(this, args);
    runReskinUpdate();
    return result;
  };
  history.replaceState = function (...args) {
    const result = origReplace.apply(this, args);
    runReskinUpdate();
    return result;
  };
  window.addEventListener('popstate', runReskinUpdate);
  window.addEventListener('storage', event => {
    if (event.key === RESKIN_PREFERENCE) runReskinUpdate();
  });
})();
