/** A subject-wide index of the questions shown in each class's Assignment tab. */
(function () {
  'use strict';

  const COURSE_ID = '22';
  const VIEW_PARAM = 'reskinProblems';
  const PAGE_ID = 'vedam-all-problems-page';
  const API_BASE = 'https://api.vedam.org/';
  const READY_STORAGE_KEY = `vedam-reskin-ready-problems:${COURSE_ID}:v1`;
  const state = {
    controller: null,
    loaded: false,
    loading: false,
    sessions: [],
    query: '',
    status: 'all',
    openClasses: new Set(),
    ready: readReady(),
    error: '',
    elements: null
  };

  function readReady() {
    try {
      const saved = JSON.parse(localStorage.getItem(READY_STORAGE_KEY) || '[]');
      return new Set(Array.isArray(saved) ? saved.filter(value => typeof value === 'string') : []);
    } catch {
      return new Set();
    }
  }

  function saveReady() {
    try {
      localStorage.setItem(READY_STORAGE_KEY, JSON.stringify([...state.ready]));
    } catch {
      if (state.elements) {
        state.elements.readyWarning.textContent = 'Ready checks could not be saved in this browser.';
      }
    }
  }

  function problemKey(session, problem) {
    const type = String(problem.questionType || 'dsa').toLowerCase();
    const id = problem.questionId ?? problem.questionUuid ?? `${session.id}:${problem.questionTitle}`;
    return `${type}:${id}`;
  }

  function syncReadyUI() {
    if (!state.elements) return;
    state.elements.list.querySelectorAll('.vedam-problem-check input').forEach(input => {
      const ready = state.ready.has(input.dataset.problemKey);
      input.checked = ready;
      input.title = ready ? 'Mark as not ready' : 'Mark ready for exam';
      input.closest('.vedam-problem-row')?.classList.toggle('is-ready', ready);
    });
    const total = state.sessions.reduce((sum, session) => sum + (session.problems?.length || 0), 0);
    const ready = state.sessions.reduce((sum, session) => sum +
      (session.problems || []).filter(problem => state.ready.has(problemKey(session, problem))).length, 0);
    state.elements.readyCount.textContent = `${ready} of ${total} ready for exam`;
  }

  function route() {
    const url = new URL(location.href);
    const isSubject = url.pathname === '/sessions'
      && url.searchParams.get('courseOfferingId') === COURSE_ID;
    return { isSubject, isProblems: isSubject && url.searchParams.get(VIEW_PARAM) === 'all' };
  }

  function create(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function icon(name) {
    const paths = {
      back: ['M19 12H5', 'm12 19-7-7 7-7'],
      arrow: ['M5 12h14', 'm12 5 7 7-7 7'],
      chevron: ['m9 18 6-6-6-6'],
      folder: ['M3 5h6l2 2h10v12H3z'],
      search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'm21 21-4.3-4.3']
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    (paths[name] || []).forEach(d => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  function navigate(show) {
    const url = new URL(location.href);
    if (show) {
      url.searchParams.delete('reskinFiles');
      url.searchParams.set(VIEW_PARAM, 'all');
    }
    else url.searchParams.delete(VIEW_PARAM);
    location.assign(url.href);
  }

  function ensureButton() {
    const header = document.querySelector('.css-1sa4n4o > .css-1wa3lbr');
    const months = header?.querySelector('.css-15q6t04');
    if (!header || !months || header.querySelector('[data-vedam-show-problems]')) return;
    const button = create('button', 'vedam-show-files-button vedam-show-problems-button', 'Show all problems');
    button.type = 'button';
    button.dataset.vedamShowProblems = 'true';
    button.addEventListener('click', () => navigate(true));
    months.before(button);
  }

  function token() {
    const cookie = document.cookie.split('; ').find(part => part.startsWith('accessToken='));
    return cookie ? decodeURIComponent(cookie.slice('accessToken='.length)) : '';
  }

  async function api(path, signal) {
    const accessToken = token();
    if (!accessToken) throw new Error('Please sign in to Vedam to view problems.');
    const response = await fetch(API_BASE + path, {
      headers: { Authorization: 'Bearer ' + accessToken }, signal
    });
    const body = await response.json();
    if (!response.ok || body.statusCode >= 400) {
      throw new Error(body.message || 'Could not load problems.');
    }
    return body.data;
  }

  async function allSessions(signal) {
    const sessions = [];
    let page = 0;
    let totalPages = 1;
    while (page < totalPages) {
      const params = new URLSearchParams({
        courseOfferingId: COURSE_ID, page: String(page), size: '100'
      });
      const data = await api('class-session/all?' + params, signal);
      sessions.push(...(data.items || []));
      totalPages = data.totalPages || 1;
      page += 1;
    }
    return sessions.sort((a, b) => Number(b.startTime) - Number(a.startTime) || b.id - a.id);
  }

  function date(seconds) {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric', month: 'long', year: 'numeric'
    }).format(new Date(Number(seconds) * 1000));
  }

  function sessionUrl(session) {
    const url = new URL('/sessions/' + session.id, location.origin);
    url.searchParams.set('courseOfferingId', COURSE_ID);
    if (session.attendanceStatus) {
      const value = String(session.attendanceStatus).toLowerCase();
      url.searchParams.set('attendanceStatus', value[0].toUpperCase() + value.slice(1));
    }
    return url;
  }

  function questionUrl(session, question) {
    const url = sessionUrl(session);
    url.pathname += '/' + encodeURIComponent(question.questionUuid);
    const kind = String(question.questionType || 'dsa').toLowerCase();
    url.searchParams.set('type', kind === 'mcms' ? 'mcq' : kind);
    url.searchParams.set('questionId', String(question.questionId));
    return url.href;
  }

  function problemStatus(problem) {
    return String(problem.bestAttemptStatus || 'NOT_ATTEMPTED').toUpperCase();
  }

  function statusLabel(status) {
    return {
      ACCEPTED: 'Accepted', PARTIALLY_ACCEPTED: 'Partial',
      FAILED: 'Failed', NOT_ATTEMPTED: 'Unattempted'
    }[status] || status.replaceAll('_', ' ').toLowerCase();
  }

  function visibleProblems(session) {
    if (!Array.isArray(session.problems)) return [];
    const classMatch = [session.label, session.title, session.topic]
      .join(' ').toLowerCase().includes(state.query);
    return session.problems.filter(problem => {
      if (state.status !== 'all' && problemStatus(problem) !== state.status) return false;
      return classMatch || [problem.questionTitle, problem.questionDifficulty, problem.questionType]
        .join(' ').toLowerCase().includes(state.query);
    });
  }

  function render() {
    if (!state.elements) return;
    const { count, progress, error, errorText, list, expand } = state.elements;
    const total = state.sessions.reduce((sum, session) => sum + (session.problems?.length || 0), 0);
    count.textContent = `${total} problems across ${state.sessions.length} classes`;
    progress.textContent = state.loading ? 'Loading class assignments…' : '';
    error.hidden = !state.error;
    errorText.textContent = state.error;
    const visible = state.sessions.filter(session =>
      session.problems === null || session.problems === undefined || visibleProblems(session).length
      || (!state.query && state.status === 'all'));
    expand.textContent = visible.length && visible.every(session => state.openClasses.has(String(session.id)))
      ? 'Collapse all' : 'Expand all';
    list.replaceChildren();
    if (!visible.length) {
      list.appendChild(create('div', 'vedam-files-empty-state',
        state.loading ? 'Loading classes…' : 'No problems match this view.'));
      syncReadyUI();
      return;
    }

    visible.forEach(session => {
      const folder = create('details', 'vedam-tree-class vedam-problem-class');
      folder.open = !!state.query || state.openClasses.has(String(session.id));
      const summary = create('summary', 'vedam-tree-class-row');
      summary.addEventListener('click', () => {
        if (folder.open) state.openClasses.delete(String(session.id));
        else state.openClasses.add(String(session.id));
      });
      summary.append(icon('chevron'), icon('folder'));
      summary.appendChild(create('span', 'vedam-tree-label', session.label || 'Class'));
      summary.appendChild(create('span', 'vedam-tree-class-title', session.title || 'Untitled class'));
      summary.appendChild(create('span', 'vedam-tree-date', date(session.startTime)));
      summary.appendChild(create('span', 'vedam-tree-count',
        session.problems === null ? '…' : String(session.problems?.length || 0)));
      folder.appendChild(summary);

      const children = create('div', 'vedam-tree-class-children');
      if (session.problems === null) {
        children.appendChild(create('p', 'vedam-tree-empty', 'Loading problems…'));
      } else if (session.problems === undefined) {
        children.appendChild(create('p', 'vedam-tree-empty', 'Could not load problems.'));
      } else if (!visibleProblems(session).length) {
        children.appendChild(create('p', 'vedam-tree-empty', 'No problems'));
      } else {
        visibleProblems(session).forEach(problem => {
          const row = create('div', 'vedam-problem-row');
          const key = problemKey(session, problem);
          const checkLabel = create('label', 'vedam-problem-check');
          const check = create('input');
          check.type = 'checkbox';
          check.checked = state.ready.has(key);
          check.dataset.problemKey = key;
          check.setAttribute('aria-label', `Ready for exam: ${problem.questionTitle || 'Untitled problem'}`);
          check.title = 'Mark ready for exam';
          check.addEventListener('change', () => {
            if (check.checked) state.ready.add(key);
            else state.ready.delete(key);
            saveReady();
            syncReadyUI();
          });
          checkLabel.appendChild(check);
          row.classList.toggle('is-ready', check.checked);
          row.appendChild(checkLabel);
          const link = create('a', 'vedam-problem-link');
          link.href = questionUrl(session, problem);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.appendChild(create('span', 'vedam-problem-title', problem.questionTitle || 'Untitled problem'));
          const difficulty = String(problem.questionDifficulty || 'Unknown').toUpperCase();
          const difficultyBadge = create('span', 'vedam-problem-difficulty', difficulty.toLowerCase());
          difficultyBadge.dataset.difficulty = difficulty;
          link.appendChild(difficultyBadge);
          const status = problemStatus(problem);
          const badge = create('span', 'vedam-problem-status', statusLabel(status));
          badge.dataset.status = status;
          link.appendChild(badge);
          link.appendChild(icon('arrow'));
          row.appendChild(link);
          children.appendChild(row);
        });
      }
      folder.appendChild(children);
      list.appendChild(folder);
    });
    syncReadyUI();
  }

  function mount() {
    const content = document.querySelector('.css-1sa4n4o');
    if (!content) return false;
    document.body.classList.add('vedam-problems-active');
    if (state.elements) return true;

    const page = create('div', 'vedam-files-page vedam-problems-page');
    page.id = PAGE_ID;
    const header = create('header', 'vedam-files-header');
    const back = create('button', 'vedam-files-back');
    back.type = 'button';
    back.setAttribute('aria-label', 'Back to classes');
    back.appendChild(icon('back'));
    back.addEventListener('click', () => navigate(false));
    const heading = create('div', 'vedam-files-heading');
    heading.appendChild(create('p', 'vedam-files-eyebrow', 'Analysis and Design of Algorithms B1'));
    heading.appendChild(create('h1', '', 'All class problems'));
    const count = create('p', 'vedam-files-summary', 'Loading classes…');
    const readyCount = create('p', 'vedam-problems-ready-count', '0 of 0 ready for exam');
    const readyWarning = create('p', 'vedam-problems-ready-warning');
    const progress = create('p', 'vedam-problems-progress');
    heading.append(count, readyCount, readyWarning, progress);
    header.append(back, heading);
    page.appendChild(header);

    const toolbar = create('div', 'vedam-files-toolbar vedam-problems-toolbar');
    const search = create('label', 'vedam-files-search');
    search.appendChild(icon('search'));
    const input = create('input');
    input.type = 'search';
    input.placeholder = 'Search classes and problems';
    input.setAttribute('aria-label', 'Search problems');
    input.addEventListener('input', () => {
      state.query = input.value.trim().toLowerCase();
      render();
    });
    search.appendChild(input);
    const select = create('select', 'vedam-problems-filter');
    select.setAttribute('aria-label', 'Filter by problem status');
    for (const [value, label] of [
      ['all', 'All statuses'], ['ACCEPTED', 'Accepted'],
      ['FAILED', 'Failed'], ['PARTIALLY_ACCEPTED', 'Partial'],
      ['NOT_ATTEMPTED', 'Unattempted']
    ]) {
      const option = create('option', '', label);
      option.value = value;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      state.status = select.value;
      render();
    });
    const expand = create('button', 'vedam-tree-expand-all', 'Expand all');
    expand.type = 'button';
    expand.addEventListener('click', () => {
      const allOpen = state.sessions.length
        && state.sessions.every(session => state.openClasses.has(String(session.id)));
      state.openClasses = allOpen ? new Set() : new Set(state.sessions.map(session => String(session.id)));
      render();
    });
    toolbar.append(search, select, expand);
    page.appendChild(toolbar);

    const error = create('div', 'vedam-files-error');
    error.hidden = true;
    const errorText = create('span');
    const retry = create('button', '', 'Retry');
    retry.type = 'button';
    retry.addEventListener('click', loadProblems);
    error.append(errorText, retry);
    page.appendChild(error);
    const list = create('div', 'vedam-files-list vedam-file-tree vedam-problem-tree');
    page.appendChild(list);
    content.appendChild(page);
    state.elements = { count, readyCount, readyWarning, progress, error, errorText, list, expand };
    render();
    return true;
  }

  function unmount() {
    document.body?.classList.remove('vedam-problems-active');
    document.getElementById(PAGE_ID)?.remove();
    state.controller?.abort();
    state.controller = null;
    state.elements = null;
    state.loaded = false;
    state.loading = false;
    state.sessions = [];
    state.openClasses.clear();
  }

  async function loadProblems() {
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    state.loading = true;
    state.error = '';
    state.sessions = [];
    render();
    try {
      const sessions = await allSessions(controller.signal);
      if (controller.signal.aborted) return;
      state.sessions = sessions.map(session => ({ ...session, problems: null }));
      render();
      let nextIndex = 0;
      const workers = Array.from({ length: Math.min(6, sessions.length) }, async () => {
        while (nextIndex < sessions.length && !controller.signal.aborted) {
          const session = state.sessions[nextIndex++];
          try {
            const problems = await api(
              `class-session-question/${session.id}/student-question`, controller.signal
            );
            session.problems = Array.isArray(problems) ? problems : [];
          } catch {
            session.problems = undefined;
            if (!controller.signal.aborted) {
              state.error = 'Some class problems could not be loaded. Retry to refresh them.';
            }
          }
          if (!controller.signal.aborted) render();
        }
      });
      await Promise.all(workers);
      if (!controller.signal.aborted) {
        state.loading = false;
        render();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      state.loading = false;
      state.error = error.message || 'Could not load problems.';
      render();
    }
  }

  function sync() {
    if (!document.body) return;
    const current = route();
    if (!current.isSubject) {
      if (state.elements) unmount();
      return;
    }
    ensureButton();
    if (!current.isProblems) {
      if (state.elements) unmount();
      return;
    }
    if (!mount()) return;
    if (!state.loaded) {
      state.loaded = true;
      loadProblems();
    }
  }

  if (document.body) sync();
  else document.addEventListener('DOMContentLoaded', sync);
  window.addEventListener('popstate', sync);
  window.addEventListener('storage', event => {
    if (event.key !== READY_STORAGE_KEY) return;
    state.ready = readReady();
    syncReadyUI();
  });
  window.setInterval(sync, 500);
})();
