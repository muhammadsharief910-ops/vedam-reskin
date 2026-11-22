/**
 * Vedam LMS Reskin — Unified Dark Course Shell
 *
 * Replaces the multi-hop white course/session navigation with a single,
 * persistent dark "Course content" sidebar + unified workspace across:
 *   - /sessions?courseOfferingId=<id>                (Course Hub / Start here)
 *   - /sessions/<sessionId>?courseOfferingId=<id>    (Session Recording & Notes)
 *   - /sessions/<sessionId>/<uuid>?questionId=<qid>  (Coding Lab, paired with content.js)
 *
 * Runs in the page's MAIN world using the existing Vedam session cookie and APIs.
 */
(function () {
  'use strict';

  const API_BASE = 'https://api.vedam.org/';
  const SHELL_ENABLED_KEY = 'vedam-reskin-course-shell-enabled';
  const SIDEBAR_OPEN_KEY = 'vedam-reskin-course-sidebar-open';
  const SIDEBAR_WIDTH_KEY = 'vedam-reskin-course-sidebar-width';
  const SORT_ORDER_KEY = 'vedam-reskin-course-sort-order';
  const COURSE_TITLE_PREFIX = 'vedam-reskin-course-title:';
  const CACHE_PREFIX = 'vedam-reskin-course-cache:v1:';
  const LAST_ITEM_PREFIX = 'vedam-reskin-last-item:';
  const SHELL_ID = 'vedam-course-shell';
  const HUB_ID = 'vedam-course-hub';
  const REOPEN_ID = 'vedam-course-reopen';

  const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

  const state = {
    courseId: '',
    courseTitle: '',
    sessions: [],
    loading: false,
    loadingDetails: false,
    error: '',
    query: '',
    filter: 'all', // 'all' | 'problems' | 'unsolved' | 'files'
    hubTab: 'all', // 'all' | 'unsolved' | 'notes'
    sortOrder: readStorage(SORT_ORDER_KEY, 'desc'), // 'desc' (newest) | 'asc' (oldest)
    openSections: new Set(),
    controller: null,
    sidebarOpen: readStorage(SIDEBAR_OPEN_KEY, 'on') !== 'off',
    sidebarWidth: clampWidth(Number(readStorage(SIDEBAR_WIDTH_KEY, '304'))),
    elements: null,
    hubElements: null,
    lastRouteKey: '',
    autoScrolledToActive: false
  };

  function readStorage(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {}
  }

  function readSessionStorage(key) {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeSessionStorage(key, value) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function clampWidth(value) {
    if (!Number.isFinite(value)) return 304;
    return Math.min(460, Math.max(240, Math.round(value)));
  }

  function isShellEnabled() {
    return readStorage(SHELL_ENABLED_KEY, 'on') !== 'off';
  }

  function setShellEnabled(enabled) {
    writeStorage(SHELL_ENABLED_KEY, enabled ? 'on' : 'off');
  }

  function parseRoute(href) {
    let url;
    try {
      url = new URL(href || window.location.href);
    } catch {
      return { inCourse: false };
    }

    const path = url.pathname.replace(/\/+$/, '') || '/';
    const courseId = url.searchParams.get('courseOfferingId') || '';
    const hasValidCourseId = /^\d+$/.test(courseId);

    // Respect explicit legacy all-files / all-problems routes and dedicated video player tabs
    if (
      url.searchParams.get('reskinFiles') === 'all'
      || url.searchParams.get('reskinProblems') === 'all'
      || url.searchParams.get('reskinPlayer') === '1'
    ) {
      return { inCourse: false, isLegacyToolView: true };
    }

    if (path === '/sessions' && hasValidCourseId) {
      return {
        inCourse: true,
        kind: 'hub',
        courseId,
        sessionId: '',
        questionId: '',
        questionUuid: ''
      };
    }

    const sessionMatch = path.match(/^\/sessions\/(\d+)(?:\/([^/]+))?$/);
    if (sessionMatch && hasValidCourseId) {
      const sessionId = sessionMatch[1];
      const questionUuid = sessionMatch[2] ? decodeURIComponent(sessionMatch[2]) : '';
      const questionId = url.searchParams.get('questionId') || '';
      const isCoding = Boolean(questionId || questionUuid);
      return {
        inCourse: true,
        kind: isCoding ? 'coding' : 'session',
        courseId,
        sessionId,
        questionId,
        questionUuid
      };
    }

    return { inCourse: false, path };
  }

  function authToken() {
    const cookie = document.cookie.split('; ').find(part => part.startsWith('accessToken='));
    return cookie ? decodeURIComponent(cookie.slice('accessToken='.length)) : '';
  }

  async function api(path, signal) {
    const token = authToken();
    if (!token) throw new Error('Please sign in to Vedam to load course content.');
    const response = await fetch(API_BASE + path, {
      headers: { Authorization: 'Bearer ' + token },
      signal
    });
    const body = await response.json();
    if (!response.ok || body.statusCode >= 400) {
      throw new Error(body.message || 'Could not load course content.');
    }
    return body.data;
  }

  async function fetchAllSessions(courseId, signal) {
    const sessions = [];
    let page = 0;
    let totalPages = 1;
    while (page < totalPages) {
      const params = new URLSearchParams({
        courseOfferingId: courseId,
        page: String(page),
        size: '100',
        sort: 'startTime,desc'
      });
      const data = await api('class-session/all?' + params, signal);
      sessions.push(...(data.items || []));
      totalPages = data.totalPages || 1;
      page += 1;
    }
    return sessions;
  }

  async function fetchSessionResources(sessionId, signal) {
    const items = [];
    let page = 0;
    let totalPages = 1;
    while (page < totalPages) {
      const params = new URLSearchParams({
        productId: String(sessionId),
        page: String(page),
        size: '100'
      });
      const data = await api('resource?' + params, signal);
      items.push(...(data.items || []));
      totalPages = data.totalPages || 1;
      page += 1;
    }
    return items;
  }

  async function fetchSessionQuestions(sessionId, signal) {
    const data = await api(`class-session-question/${sessionId}/student-question`, signal);
    return Array.isArray(data) ? data : [];
  }

  function create(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function svgIcon(name, size = 16) {
    const icons = {
      close: ['M18 6 6 18', 'M6 6l12 12'],
      back: ['m15 18-6-6 6-6'],
      home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20h14V9.5', 'M9.5 20v-6h5v6'],
      search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'm21 21-4.3-4.3'],
      chevron: ['m9 18 6-6-6-6'],
      check: ['M20 6 9 17l-5-5'],
      video: ['M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z', 'm10 9 5 3-5 3z'],
      book: ['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'],
      code: ['m8 6-6 6 6 6', 'm16 6 6 6-6 6'],
      quiz: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
      sidebar: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 3v18'],
      sort: ['M3 6h18', 'M6 12h12', 'M10 18h4'],
      external: ['M14 3h7v7', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
      play: ['m8 5 11 7-11 7z'],
      refresh: ['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6'],
      classic: ['M4 4h16v16H4z', 'M4 9h16', 'M9 9v11']
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    (icons[name] || []).forEach(d => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  function formatShortDate(seconds) {
    if (!seconds) return '';
    try {
      return new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Kolkata'
      }).format(new Date(Number(seconds) * 1000));
    } catch {
      return '';
    }
  }

  function capitalizeStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    return value ? value[0].toUpperCase() + value.slice(1) : '';
  }

  function buildSessionUrl(session, courseId) {
    const url = new URL('/sessions/' + session.id, window.location.origin);
    url.searchParams.set('courseOfferingId', String(session.courseOfferingId || courseId));
    const attendance = capitalizeStatus(session.attendanceStatus);
    if (attendance) url.searchParams.set('attendanceStatus', attendance);
    return url.href;
  }

  function buildRecordingUrl(session, courseId) {
    const url = new URL(buildSessionUrl(session, courseId));
    url.searchParams.set('reskinPlayer', '1');
    return url.href;
  }

  function buildQuestionUrl(session, question, courseId) {
    const url = new URL(buildSessionUrl(session, courseId));
    url.pathname += '/' + encodeURIComponent(question.questionUuid);
    const kind = String(question.questionType || 'dsa').toLowerCase();
    url.searchParams.set('type', kind === 'mcms' ? 'mcq' : kind);
    url.searchParams.set('questionId', String(question.questionId));
    return url.href;
  }

  function buildHubUrl(courseId) {
    const url = new URL('/sessions', window.location.origin);
    url.searchParams.set('courseOfferingId', String(courseId));
    return url.href;
  }

  function problemStatus(problem) {
    return String(problem?.bestAttemptStatus || 'NOT_ATTEMPTED').toUpperCase();
  }

  function isProblemDone(problem) {
    return problemStatus(problem) === 'ACCEPTED';
  }

  function isSessionAttended(session) {
    const att = String(session?.attendanceStatus || '').toUpperCase();
    const st = String(session?.status || '').toUpperCase();
    return att === 'PRESENT' || st === 'COMPLETED';
  }

  function detectCourseTitleFromDom() {
    const candidates = [
      document.querySelector('.css-1sa4n4o > .css-1wa3lbr .css-bt172e')?.textContent,
      document.querySelector('.css-1sa4n4o h1')?.textContent,
      document.querySelector('.css-1sa4n4o h2')?.textContent
    ];
    for (const text of candidates) {
      const clean = String(text || '').trim();
      if (clean && !/^class$/i.test(clean) && clean.length > 2) return clean;
    }
    return '';
  }

  function resolveCourseTitle(courseId) {
    const fromDom = detectCourseTitleFromDom();
    if (fromDom) {
      writeStorage(COURSE_TITLE_PREFIX + courseId, fromDom);
      return fromDom;
    }
    const stored = readStorage(COURSE_TITLE_PREFIX + courseId, '');
    if (stored) return stored;
    const first = state.sessions[0];
    if (first?.courseName) return first.courseName;
    if (first?.subjectName) return first.subjectName;
    return `Course #${courseId}`;
  }

  function saveCache(courseId) {
    if (!courseId || !state.sessions.length) return;
    writeSessionStorage(CACHE_PREFIX + courseId, {
      ts: Date.now(),
      courseTitle: state.courseTitle,
      sessions: state.sessions
    });
  }

  function loadCache(courseId) {
    const cached = readSessionStorage(CACHE_PREFIX + courseId);
    if (!cached || !Array.isArray(cached.sessions)) return null;
    return cached;
  }

  function rememberLastItem(route) {
    if (!route.inCourse || route.kind === 'hub') return;
    writeStorage(LAST_ITEM_PREFIX + route.courseId, JSON.stringify({
      href: window.location.href,
      kind: route.kind,
      sessionId: route.sessionId,
      questionId: route.questionId,
      ts: Date.now()
    }));
  }

  function getLastItem(courseId) {
    try {
      const raw = readStorage(LAST_ITEM_PREFIX + courseId, '');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function sortedSessions() {
    const list = [...state.sessions];
    list.sort((a, b) => {
      const diff = (Number(a.startTime) || 0) - (Number(b.startTime) || 0);
      if (diff !== 0) return state.sortOrder === 'desc' ? -diff : diff;
      return state.sortOrder === 'desc' ? (b.id - a.id) : (a.id - b.id);
    });
    return list;
  }

  function sessionStats(session) {
    const questions = Array.isArray(session.questions) ? session.questions : [];
    const resources = Array.isArray(session.resources) ? session.resources : [];
    const totalItems = 1 + resources.length + questions.length;
    const doneQuestions = questions.filter(isProblemDone).length;
    const doneItems = (isSessionAttended(session) ? 1 : 0) + resources.length + doneQuestions;
    return {
      totalItems,
      doneItems,
      questionsCount: questions.length,
      doneQuestions,
      resourcesCount: resources.length
    };
  }

  function filterSessionItems(session, query, filter) {
    const q = query.trim().toLowerCase();
    const sessionText = [session.label, session.title, session.topic].join(' ').toLowerCase();
    const sessionMatchesQuery = !q || sessionText.includes(q);

    const resources = Array.isArray(session.resources) ? session.resources : [];
    const questions = Array.isArray(session.questions) ? session.questions : [];

    const showLive = filter === 'all' && sessionMatchesQuery;

    const visibleResources = (filter === 'all' || filter === 'files')
      ? resources.filter(file => sessionMatchesQuery || String(file.title || '').toLowerCase().includes(q))
      : [];

    const visibleQuestions = (filter === 'all' || filter === 'problems' || filter === 'unsolved')
      ? questions.filter(prob => {
          if (filter === 'unsolved' && isProblemDone(prob)) return false;
          if (!q) return true;
          const probText = [prob.questionTitle, prob.questionDifficulty, prob.questionType].join(' ').toLowerCase();
          return sessionMatchesQuery || probText.includes(q);
        })
      : [];

    const hasMatches = showLive || visibleResources.length > 0 || visibleQuestions.length > 0;
    const stillLoading = session.questions === null || session.resources === null;

    return {
      showLive,
      visibleResources,
      visibleQuestions,
      hasMatches,
      stillLoading
    };
  }

  function applyLayoutClasses(route) {
    const active = Boolean(route.inCourse && isShellEnabled());
    document.documentElement.classList.toggle('vedam-shell-active', active);
    document.documentElement.classList.toggle('vedam-shell-open', active && state.sidebarOpen);
    document.documentElement.classList.toggle('vedam-shell-hub-mode', active && route.kind === 'hub');
    document.documentElement.classList.toggle('vedam-shell-session-mode', active && route.kind === 'session');
    document.documentElement.classList.toggle('vedam-shell-coding-mode', active && route.kind === 'coding');
    document.documentElement.style.setProperty('--vedam-shell-width', state.sidebarWidth + 'px');

    if (document.body) {
      document.body.classList.toggle('vedam-shell-active', active);
      document.body.classList.toggle('vedam-shell-open', active && state.sidebarOpen);
      document.body.classList.toggle('vedam-shell-hub-mode', active && route.kind === 'hub');
      document.body.classList.toggle('vedam-shell-session-mode', active && route.kind === 'session');
      document.body.classList.toggle('vedam-shell-coding-mode', active && route.kind === 'coding');
    }

    if (state.elements?.shell) {
      state.elements.shell.classList.toggle('is-collapsed', !state.sidebarOpen);
    }
    if (state.elements?.reopenBtn) {
      state.elements.reopenBtn.hidden = !active || state.sidebarOpen;
    }
  }

  function setSidebarOpen(open) {
    state.sidebarOpen = Boolean(open);
    writeStorage(SIDEBAR_OPEN_KEY, state.sidebarOpen ? 'on' : 'off');
    applyLayoutClasses(parseRoute());
    window.dispatchEvent(new Event('resize'));
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 180);
  }

  function bindSidebarResize(resizer) {
    resizer.addEventListener('pointerdown', event => {
      event.preventDefault();
      resizer.setPointerCapture?.(event.pointerId);
      document.body?.classList.add('vedam-shell-resizing');

      const onMove = moveEvent => {
        const next = clampWidth(moveEvent.clientX);
        state.sidebarWidth = next;
        document.documentElement.style.setProperty('--vedam-shell-width', next + 'px');
      };

      const onUp = upEvent => {
        resizer.releasePointerCapture?.(upEvent.pointerId);
        document.body?.classList.remove('vedam-shell-resizing');
        writeStorage(SIDEBAR_WIDTH_KEY, state.sidebarWidth);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.dispatchEvent(new Event('resize'));
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  function mountShell() {
    if (!document.body) return false;
    if (state.elements?.shell?.isConnected) return true;

    const shell = create('aside', 'vcs-sidebar');
    shell.id = SHELL_ID;
    shell.setAttribute('aria-label', 'Course content');

    // Header: "Course content" + Close button
    const header = create('div', 'vcs-header');
    const title = create('h2', 'vcs-title', 'Course content');
    const closeBtn = create('button', 'vcs-icon-btn vcs-close-btn');
    closeBtn.type = 'button';
    closeBtn.title = `Collapse sidebar (${IS_MAC ? '⌘B' : 'Ctrl+B'})`;
    closeBtn.setAttribute('aria-label', 'Collapse course content sidebar');
    closeBtn.appendChild(svgIcon('close', 18));
    closeBtn.addEventListener('click', () => setSidebarOpen(false));
    header.append(title, closeBtn);
    shell.appendChild(header);

    // Quick links: Back to dashboard + Start here
    const nav = create('div', 'vcs-nav');
    const backLink = create('a', 'vcs-nav-link');
    backLink.href = '/home';
    backLink.append(svgIcon('back', 15), create('span', '', 'Back to dashboard'));

    const startLink = create('a', 'vcs-nav-link vcs-start-link');
    startLink.href = buildHubUrl(state.courseId);
    startLink.append(svgIcon('home', 15), create('span', '', 'Start here'));
    nav.append(backLink, startLink);
    shell.appendChild(nav);

    // Quick search box (Ctrl+K / ⌘K)
    const searchWrap = create('div', 'vcs-search-wrap');
    const searchBox = create('label', 'vcs-search-box');
    const searchInput = create('input', 'vcs-search-input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Quick search';
    searchInput.setAttribute('aria-label', 'Quick search course content');
    searchInput.addEventListener('input', () => {
      state.query = searchInput.value;
      renderSidebar();
    });
    searchInput.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (searchInput.value) {
          searchInput.value = '';
          state.query = '';
          renderSidebar();
        } else {
          searchInput.blur();
        }
      }
    });
    const kbd = create('kbd', 'vcs-kbd', IS_MAC ? '⌘K' : 'Ctrl+K');
    searchBox.append(searchInput, kbd);
    searchWrap.appendChild(searchBox);

    // Filter pills + sort button
    const filterRow = create('div', 'vcs-filter-row');
    const filterButtons = {};
    [
      ['all', 'All'],
      ['problems', 'Problems'],
      ['unsolved', 'Unsolved'],
      ['files', 'Notes']
    ].forEach(([key, label]) => {
      const btn = create('button', 'vcs-filter-pill', label);
      btn.type = 'button';
      btn.dataset.filter = key;
      btn.addEventListener('click', () => {
        state.filter = key;
        renderSidebar();
      });
      filterButtons[key] = btn;
      filterRow.appendChild(btn);
    });

    const sortBtn = create('button', 'vcs-sort-btn');
    sortBtn.type = 'button';
    sortBtn.title = 'Toggle class order (Newest / Oldest)';
    sortBtn.append(svgIcon('sort', 13));
    const sortText = create('span', '', state.sortOrder === 'desc' ? 'New' : 'Old');
    sortBtn.append(sortText);
    sortBtn.addEventListener('click', () => {
      state.sortOrder = state.sortOrder === 'desc' ? 'asc' : 'desc';
      writeStorage(SORT_ORDER_KEY, state.sortOrder);
      sortText.textContent = state.sortOrder === 'desc' ? 'New' : 'Old';
      renderSidebar();
      renderHub();
    });
    filterRow.appendChild(sortBtn);
    searchWrap.appendChild(filterRow);
    shell.appendChild(searchWrap);

    // Status / Error banner
    const statusBanner = create('div', 'vcs-status-banner');
    statusBanner.hidden = true;
    shell.appendChild(statusBanner);

    // Scrollable sections list
    const sections = create('div', 'vcs-sections');
    shell.appendChild(sections);

    // Subtle footer with Refresh + Classic UI toggle
    const footer = create('div', 'vcs-footer');
    const progressText = create('span', 'vcs-footer-progress', '');
    const footerActions = create('div', 'vcs-footer-actions');

    const refreshBtn = create('button', 'vcs-footer-btn');
    refreshBtn.type = 'button';
    refreshBtn.title = 'Refresh course content';
    refreshBtn.append(svgIcon('refresh', 13));
    refreshBtn.addEventListener('click', () => loadCourse(state.courseId, true));

    const classicBtn = create('button', 'vcs-footer-btn vcs-classic-btn', 'Classic UI');
    classicBtn.type = 'button';
    classicBtn.title = 'Switch back to original Vedam course UI';
    classicBtn.addEventListener('click', () => {
      setShellEnabled(false);
      sync();
    });

    footerActions.append(refreshBtn, classicBtn);
    footer.append(progressText, footerActions);
    shell.appendChild(footer);

    // Drag-to-resize handle on the right edge
    const resizer = create('div', 'vcs-resizer');
    resizer.title = 'Drag to resize sidebar';
    bindSidebarResize(resizer);
    shell.appendChild(resizer);

    document.body.appendChild(shell);

    // Floating reopen button when sidebar is collapsed
    let reopenBtn = document.getElementById(REOPEN_ID);
    if (!reopenBtn) {
      reopenBtn = create('button', 'vcs-reopen-btn');
      reopenBtn.id = REOPEN_ID;
      reopenBtn.type = 'button';
      reopenBtn.title = `Open Course content (${IS_MAC ? '⌘B' : 'Ctrl+B'})`;
      reopenBtn.append(svgIcon('sidebar', 16), create('span', '', 'Course content'));
      reopenBtn.addEventListener('click', () => setSidebarOpen(true));
      document.body.appendChild(reopenBtn);
    }

    state.elements = {
      shell,
      startLink,
      searchInput,
      filterButtons,
      sortText,
      statusBanner,
      sections,
      progressText,
      reopenBtn
    };
    return true;
  }

  function unmountShell() {
    document.getElementById(SHELL_ID)?.remove();
    document.getElementById(HUB_ID)?.remove();
    document.getElementById(REOPEN_ID)?.remove();
    state.elements = null;
    state.hubElements = null;
  }

  function ensureClassicReenableButton(route) {
    const existing = document.getElementById('vedam-shell-enable-btn');
    if (!route.inCourse || isShellEnabled()) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const btn = create('button', 'vcs-enable-floating-btn');
    btn.id = 'vedam-shell-enable-btn';
    btn.type = 'button';
    btn.append(svgIcon('sidebar', 15), create('span', '', 'Dark Course View'));
    btn.addEventListener('click', () => {
      setShellEnabled(true);
      sync();
    });
    document.body?.appendChild(btn);
  }

  function makeCheckBox(status) {
    // status: 'done' | 'partial' | 'failed' | 'none'
    const box = create('span', `vcs-check is-${status}`);
    if (status === 'done') {
      box.appendChild(svgIcon('check', 11));
    } else if (status === 'partial') {
      box.textContent = '~';
    }
    return box;
  }

  function renderSidebar() {
    if (!state.elements) return;
    const route = parseRoute();
    const {
      startLink,
      filterButtons,
      statusBanner,
      sections,
      progressText
    } = state.elements;

    startLink.href = buildHubUrl(state.courseId);
    startLink.classList.toggle('is-active', route.kind === 'hub');

    Object.entries(filterButtons).forEach(([key, btn]) => {
      btn.classList.toggle('is-active', state.filter === key);
    });

    if (state.error) {
      statusBanner.hidden = false;
      statusBanner.className = 'vcs-status-banner is-error';
      statusBanner.textContent = state.error;
    } else if (state.loading && !state.sessions.length) {
      statusBanner.hidden = false;
      statusBanner.className = 'vcs-status-banner';
      statusBanner.textContent = 'Loading classes…';
    } else {
      statusBanner.hidden = true;
    }

    // Overall progress in footer
    const totalProblems = state.sessions.reduce((sum, s) => sum + (s.questions?.length || 0), 0);
    const solvedProblems = state.sessions.reduce(
      (sum, s) => sum + (s.questions || []).filter(isProblemDone).length,
      0
    );
    if (state.sessions.length) {
      progressText.textContent = totalProblems
        ? `${solvedProblems}/${totalProblems} solved${state.loadingDetails ? ' · syncing…' : ''}`
        : `${state.sessions.length} classes${state.loadingDetails ? ' · syncing…' : ''}`;
    } else {
      progressText.textContent = '';
    }

    const ordered = sortedSessions();
    const prevScroll = sections.scrollTop;
    const fragment = document.createDocumentFragment();
    let renderedCount = 0;

    ordered.forEach(session => {
      const sid = String(session.id);
      const isCurrentSession = route.sessionId && route.sessionId === sid;
      const filtered = filterSessionItems(session, state.query, state.filter);

      if ((state.query.trim() || state.filter !== 'all') && !filtered.hasMatches && !filtered.stillLoading) {
        return;
      }

      renderedCount += 1;
      const isOpen = Boolean(state.query.trim()) || state.filter !== 'all' || state.openSections.has(sid);
      const stats = sessionStats(session);

      const sectionEl = create('div', 'vcs-section');
      if (isOpen) sectionEl.classList.add('is-open');
      if (isCurrentSession) sectionEl.classList.add('is-current');

      const headerBtn = create('button', 'vcs-section-header');
      headerBtn.type = 'button';
      headerBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      headerBtn.addEventListener('click', () => {
        if (state.openSections.has(sid)) state.openSections.delete(sid);
        else state.openSections.add(sid);
        renderSidebar();
      });

      const headerText = create('div', 'vcs-section-text');
      const labelPrefix = session.label ? `${session.label}: ` : '';
      const rawTitle = session.title || session.topic || 'Untitled class';
      const titleLine = create('div', 'vcs-section-title', `${labelPrefix}${rawTitle}`);

      let metaLabel = `${stats.doneItems}/${stats.totalItems} items`;
      if (session.questions === null || session.resources === null) {
        metaLabel = 'Loading items…';
      } else if (stats.questionsCount > 0) {
        metaLabel = `${stats.doneQuestions}/${stats.questionsCount} solved · ${stats.totalItems} items`;
      }
      const metaLine = create('div', 'vcs-section-meta', metaLabel);
      headerText.append(titleLine, metaLine);

      const chevron = create('span', 'vcs-section-chevron');
      chevron.appendChild(svgIcon('chevron', 15));

      headerBtn.append(headerText, chevron);
      sectionEl.appendChild(headerBtn);

      if (isOpen) {
        const itemsWrap = create('div', 'vcs-items');

        // 1. Live event / Class Recording (opens in new tab with upgraded video player)
        if (filtered.showLive) {
          const item = create('a', 'vcs-item');
          item.href = buildRecordingUrl(session, state.courseId);
          item.target = '_blank';
          item.rel = 'noopener noreferrer';
          if (route.kind === 'session' && isCurrentSession) {
            item.classList.add('is-active');
          }
          item.appendChild(makeCheckBox(isSessionAttended(session) ? 'done' : 'none'));

          const body = create('div', 'vcs-item-body');
          body.appendChild(create('div', 'vcs-item-title', session.label || 'Lecture'));
          const sub = create('div', 'vcs-item-sub');
          sub.appendChild(svgIcon('video', 12));
          const subParts = ['Recording'];
          const shortDate = formatShortDate(session.startTime);
          if (shortDate) subParts.push(shortDate);
          if (session.attendanceStatus) subParts.push(capitalizeStatus(session.attendanceStatus));
          sub.appendChild(create('span', '', subParts.join(' · ')));
          body.appendChild(sub);
          item.appendChild(body);
          const ext = create('span', 'vcs-item-ext');
          ext.appendChild(svgIcon('external', 12));
          item.appendChild(ext);
          itemsWrap.appendChild(item);
        }

        // 2. Lecture Notes / Resources
        filtered.visibleResources.forEach(file => {
          const hasUrl = Boolean(file.url);
          const item = create(hasUrl ? 'a' : 'div', 'vcs-item' + (hasUrl ? '' : ' is-disabled'));
          if (hasUrl) {
            item.href = file.url;
            item.target = '_blank';
            item.rel = 'noopener noreferrer';
          }
          item.appendChild(makeCheckBox('done'));

          const body = create('div', 'vcs-item-body');
          body.appendChild(create('div', 'vcs-item-title', file.title || 'Lecture note'));
          const sub = create('div', 'vcs-item-sub');
          sub.appendChild(svgIcon('book', 12));
          sub.appendChild(create('span', '', hasUrl ? 'Lecture note' : 'Lecture note (unavailable)'));
          body.appendChild(sub);
          item.appendChild(body);
          if (hasUrl) {
            const ext = create('span', 'vcs-item-ext');
            ext.appendChild(svgIcon('external', 12));
            item.appendChild(ext);
          }
          itemsWrap.appendChild(item);
        });

        // 3. Coding Labs / Problems
        filtered.visibleQuestions.forEach(problem => {
          const item = create('a', 'vcs-item');
          item.href = buildQuestionUrl(session, problem, state.courseId);
          const isActiveProblem = route.kind === 'coding' && (
            (route.questionId && String(problem.questionId) === String(route.questionId)) ||
            (route.questionUuid && String(problem.questionUuid) === String(route.questionUuid))
          );
          if (isActiveProblem) {
            item.classList.add('is-active');
          }

          const status = problemStatus(problem);
          const checkState = status === 'ACCEPTED'
            ? 'done'
            : status === 'PARTIALLY_ACCEPTED'
              ? 'partial'
              : status === 'FAILED'
                ? 'failed'
                : 'none';
          item.appendChild(makeCheckBox(checkState));

          const body = create('div', 'vcs-item-body');
          body.appendChild(create('div', 'vcs-item-title', problem.questionTitle || 'Untitled problem'));
          const sub = create('div', 'vcs-item-sub');
          const kind = String(problem.questionType || 'DSA').toUpperCase();
          const isQuiz = kind === 'MCQ' || kind === 'MCMS';
          sub.appendChild(svgIcon(isQuiz ? 'quiz' : 'code', 12));
          sub.appendChild(create('span', '', isQuiz ? 'Quiz' : 'Coding lab'));

          const diff = String(problem.questionDifficulty || '').toUpperCase();
          if (diff) {
            const diffBadge = create('span', `vcs-diff is-${diff.toLowerCase()}`, diff.toLowerCase());
            sub.appendChild(diffBadge);
          }
          body.appendChild(sub);
          item.appendChild(body);
          itemsWrap.appendChild(item);
        });

        if (filtered.stillLoading && !filtered.visibleQuestions.length && !filtered.visibleResources.length) {
          itemsWrap.appendChild(create('div', 'vcs-item-loading', 'Loading notes & problems…'));
        }

        sectionEl.appendChild(itemsWrap);
      }

      fragment.appendChild(sectionEl);
    });

    sections.replaceChildren();
    if (!renderedCount && !state.loading) {
      sections.appendChild(create(
        'div',
        'vcs-empty',
        state.query.trim() ? 'No matching classes, notes, or problems.' : 'No classes found for this subject.'
      ));
    } else {
      sections.appendChild(fragment);
    }

    sections.scrollTop = prevScroll;

    if (!state.autoScrolledToActive && (route.kind === 'coding' || route.kind === 'session')) {
      const activeEl = sections.querySelector('.vcs-item.is-active');
      if (activeEl) {
        state.autoScrolledToActive = true;
        activeEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
  }

  function mountHub() {
    if (!document.body) return false;
    if (state.hubElements?.root?.isConnected) return true;

    const root = create('main', 'vcs-hub');
    root.id = HUB_ID;
    document.body.appendChild(root);
    state.hubElements = { root };
    return true;
  }

  function unmountHub() {
    document.getElementById(HUB_ID)?.remove();
    state.hubElements = null;
  }

  function findNextUnsolvedProblem() {
    // Check newest-first so students land on their current week's unsolved work first
    const ordered = [...state.sessions].sort((a, b) => (Number(b.startTime) || 0) - (Number(a.startTime) || 0));
    for (const session of ordered) {
      for (const prob of (session.questions || [])) {
        if (!isProblemDone(prob)) {
          return { session, problem: prob };
        }
      }
    }
    return null;
  }

  function findFirstProblem() {
    const ordered = [...state.sessions].sort((a, b) => (Number(b.startTime) || 0) - (Number(a.startTime) || 0));
    for (const session of ordered) {
      if (session.questions && session.questions.length) {
        return { session, problem: session.questions[0] };
      }
    }
    return null;
  }

  function renderHub() {
    const route = parseRoute();
    if (!route.inCourse || route.kind !== 'hub' || !isShellEnabled()) {
      unmountHub();
      return;
    }
    if (!mountHub()) return;

    const root = state.hubElements.root;
    const totalSessions = state.sessions.length;
    const totalProblems = state.sessions.reduce((sum, s) => sum + (s.questions?.length || 0), 0);
    const solvedProblems = state.sessions.reduce(
      (sum, s) => sum + (s.questions || []).filter(isProblemDone).length,
      0
    );
    const unsolvedCount = Math.max(0, totalProblems - solvedProblems);
    const totalNotes = state.sessions.reduce((sum, s) => sum + (s.resources?.length || 0), 0);
    const pct = totalProblems ? Math.round((solvedProblems / totalProblems) * 100) : 0;

    const nextUnsolved = findNextUnsolvedProblem();
    const firstProblem = findFirstProblem();
    const lastItem = getLastItem(state.courseId);

    const container = create('div', 'vcs-hub-inner');

    // Clean, restrained page header (light/white editorial layout)
    const header = create('header', 'vcs-hub-header');
    const headerLeft = create('div', 'vcs-hub-header-left');
    headerLeft.appendChild(create('h1', 'vcs-hub-title', state.courseTitle || resolveCourseTitle(state.courseId)));

    const metaParts = [];
    if (totalSessions) metaParts.push(`${totalSessions} classes`);
    if (totalProblems) metaParts.push(`${solvedProblems} of ${totalProblems} problems solved`);
    if (totalNotes) metaParts.push(`${totalNotes} notes`);
    headerLeft.appendChild(create(
      'p',
      'vcs-hub-meta',
      metaParts.length ? metaParts.join(' · ') : (state.loading ? 'Loading course…' : 'No sessions yet')
    ));

    if (totalProblems > 0) {
      const bar = create('div', 'vcs-hub-progress');
      const fill = create('div', 'vcs-hub-progress-fill');
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      headerLeft.appendChild(bar);
    }

    const headerActions = create('div', 'vcs-hub-actions');
    const primaryTarget = nextUnsolved || firstProblem;
    if (primaryTarget) {
      const link = create('a', 'vcs-hub-continue');
      link.href = buildQuestionUrl(primaryTarget.session, primaryTarget.problem, state.courseId);
      link.textContent = nextUnsolved
        ? `Continue: ${nextUnsolved.problem.questionTitle}`
        : `Open latest: ${firstProblem.problem.questionTitle}`;
      headerActions.appendChild(link);
    } else if (lastItem?.href) {
      const link = create('a', 'vcs-hub-continue');
      link.href = lastItem.href;
      link.textContent = 'Resume last visited';
      headerActions.appendChild(link);
    }

    header.append(headerLeft, headerActions);
    container.appendChild(header);

    // Simple flat underline tabs
    const tabs = create('nav', 'vcs-hub-tabs');
    tabs.setAttribute('aria-label', 'Course view');
    [
      ['all', `All classes${totalSessions ? ` (${totalSessions})` : ''}`],
      ['unsolved', `Unsolved${unsolvedCount ? ` (${unsolvedCount})` : ''}`],
      ['notes', `Notes${totalNotes ? ` (${totalNotes})` : ''}`]
    ].forEach(([key, label]) => {
      const tab = create('button', 'vcs-hub-tab', label);
      tab.type = 'button';
      tab.classList.toggle('is-active', state.hubTab === key);
      tab.addEventListener('click', () => {
        state.hubTab = key;
        renderHub();
      });
      tabs.appendChild(tab);
    });
    container.appendChild(tabs);

    if (state.loading && !state.sessions.length) {
      container.appendChild(create('div', 'vcs-hub-empty', 'Loading classes…'));
    } else if (state.error && !state.sessions.length) {
      container.appendChild(create('div', 'vcs-hub-empty is-error', state.error));
    } else {
      const list = create('div', 'vcs-syllabus');
      let visibleCount = 0;

      sortedSessions().forEach(session => {
        const problems = Array.isArray(session.questions) ? session.questions : [];
        const resources = Array.isArray(session.resources) ? session.resources : [];
        const shownProblems = state.hubTab === 'unsolved'
          ? problems.filter(p => !isProblemDone(p))
          : state.hubTab === 'notes'
            ? []
            : problems;
        const shownResources = state.hubTab === 'unsolved' ? [] : resources;

        if (state.hubTab === 'unsolved' && !shownProblems.length) return;
        if (state.hubTab === 'notes' && !shownResources.length) return;
        visibleCount += 1;

        const rowGroup = create('section', 'vcs-syl-session');
        const head = create('div', 'vcs-syl-head');

        const headLeft = create('div', 'vcs-syl-head-left');
        if (session.label) headLeft.appendChild(create('span', 'vcs-syl-lec', session.label));
        headLeft.appendChild(create('h2', 'vcs-syl-title', session.title || session.topic || 'Untitled class'));

        const headRight = create('div', 'vcs-syl-head-right');
        const d = formatShortDate(session.startTime);
        if (d) headRight.appendChild(create('span', 'vcs-syl-date', d));
        if (session.attendanceStatus) {
          const att = capitalizeStatus(session.attendanceStatus);
          headRight.appendChild(create('span', `vcs-syl-att is-${att.toLowerCase()}`, att));
        }
        const recLink = create('a', 'vcs-syl-rec');
        recLink.href = buildRecordingUrl(session, state.courseId);
        recLink.target = '_blank';
        recLink.rel = 'noopener noreferrer';
        recLink.append(svgIcon('video', 13), create('span', '', 'Recording'));
        headRight.appendChild(recLink);

        head.append(headLeft, headRight);
        rowGroup.appendChild(head);

        if (session.questions === null || session.resources === null) {
          rowGroup.appendChild(create('div', 'vcs-syl-muted', 'Loading items…'));
        } else {
          if (shownProblems.length) {
            const probList = create('div', 'vcs-syl-items');
            shownProblems.forEach(prob => {
              const row = create('a', 'vcs-syl-prob');
              row.href = buildQuestionUrl(session, prob, state.courseId);
              const status = problemStatus(prob);
              const checkState = status === 'ACCEPTED'
                ? 'done'
                : status === 'PARTIALLY_ACCEPTED'
                  ? 'partial'
                  : status === 'FAILED'
                    ? 'failed'
                    : 'none';
              row.appendChild(makeCheckBox(checkState));
              row.appendChild(create('span', 'vcs-syl-prob-name', prob.questionTitle || 'Untitled problem'));

              const diff = String(prob.questionDifficulty || '').toLowerCase();
              if (diff) row.appendChild(create('span', `vcs-syl-diff is-${diff}`, diff));

              const statusLabel = {
                ACCEPTED: 'Solved',
                PARTIALLY_ACCEPTED: 'Partial',
                FAILED: 'Attempted',
                NOT_ATTEMPTED: ''
              }[status] || '';
              if (statusLabel) {
                row.appendChild(create('span', `vcs-syl-status is-${checkState}`, statusLabel));
              }
              probList.appendChild(row);
            });
            rowGroup.appendChild(probList);
          }

          if (shownResources.length) {
            const notesRow = create('div', 'vcs-syl-notes');
            shownResources.forEach(file => {
              if (!file.url) return;
              const link = create('a', 'vcs-syl-note');
              link.href = file.url;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              link.append(svgIcon('book', 13), create('span', '', file.title || 'Lecture note'));
              notesRow.appendChild(link);
            });
            if (notesRow.childNodes.length) rowGroup.appendChild(notesRow);
          }
        }

        list.appendChild(rowGroup);
      });

      if (!visibleCount) {
        container.appendChild(create(
          'div',
          'vcs-hub-empty',
          state.hubTab === 'unsolved' ? 'All problems in this course are solved.' : 'No items in this view.'
        ));
      } else {
        container.appendChild(list);
      }
    }

    root.replaceChildren(container);
  }

  async function loadCourse(courseId, forceRefresh = false) {
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    state.error = '';

    // Hydrate immediately from sessionStorage cache for zero-flicker navigation
    if (!forceRefresh) {
      const cached = loadCache(courseId);
      if (cached && cached.sessions.length) {
        state.sessions = cached.sessions;
        if (cached.courseTitle) state.courseTitle = cached.courseTitle;
        ensureDefaultExpanded(parseRoute());
        renderSidebar();
        renderHub();
      }
    }

    state.loading = !state.sessions.length;
    state.loadingDetails = true;
    renderSidebar();
    renderHub();

    try {
      const freshSessions = await fetchAllSessions(courseId, controller.signal);
      if (controller.signal.aborted) return;

      // Preserve already-cached questions/resources while refreshing
      const existingMap = new Map(state.sessions.map(s => [String(s.id), s]));
      state.sessions = freshSessions.map(s => {
        const prev = existingMap.get(String(s.id));
        return {
          ...s,
          questions: prev && Array.isArray(prev.questions) ? prev.questions : null,
          resources: prev && Array.isArray(prev.resources) ? prev.resources : null
        };
      });
      state.courseTitle = resolveCourseTitle(courseId);
      state.loading = false;
      ensureDefaultExpanded(parseRoute());
      saveCache(courseId);
      renderSidebar();
      renderHub();

      // Prioritize the currently active session first, then newest sessions
      const route = parseRoute();
      const queue = [...state.sessions].sort((a, b) => {
        if (route.sessionId) {
          if (String(a.id) === route.sessionId) return -1;
          if (String(b.id) === route.sessionId) return 1;
        }
        return (Number(b.startTime) || 0) - (Number(a.startTime) || 0);
      });

      let cursor = 0;
      let renderScheduled = false;
      const scheduleRender = () => {
        if (renderScheduled || controller.signal.aborted) return;
        renderScheduled = true;
        window.requestAnimationFrame(() => {
          renderScheduled = false;
          if (controller.signal.aborted) return;
          renderSidebar();
          renderHub();
        });
      };

      const workerCount = Math.min(6, queue.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < queue.length && !controller.signal.aborted) {
          const session = queue[cursor++];
          const [questionsRes, resourcesRes] = await Promise.allSettled([
            fetchSessionQuestions(session.id, controller.signal),
            fetchSessionResources(session.id, controller.signal)
          ]);
          if (controller.signal.aborted) return;
          session.questions = questionsRes.status === 'fulfilled' ? questionsRes.value : [];
          session.resources = resourcesRes.status === 'fulfilled' ? resourcesRes.value : [];
          scheduleRender();
        }
      });

      await Promise.all(workers);
      if (!controller.signal.aborted) {
        state.loadingDetails = false;
        saveCache(courseId);
        renderSidebar();
        renderHub();
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      state.loading = false;
      state.loadingDetails = false;
      state.error = err?.message || 'Could not load course content.';
      renderSidebar();
      renderHub();
    }
  }

  function ensureDefaultExpanded(route) {
    if (route.sessionId) {
      state.openSections.add(String(route.sessionId));
      return;
    }
    if (!state.openSections.size && state.sessions.length) {
      const ordered = sortedSessions();
      state.openSections.add(String(ordered[0].id));
    }
  }

  function sync() {
    const route = parseRoute();
    const enabled = isShellEnabled();

    // Always capture course title when user clicks "Go to Class" from /home
    applyLayoutClasses(route);
    ensureClassicReenableButton(route);

    if (!route.inCourse || !enabled) {
      if (state.elements) unmountShell();
      state.lastRouteKey = '';
      return;
    }

    if (!document.body) return;
    if (!mountShell()) return;

    const detected = detectCourseTitleFromDom();
    if (detected && detected !== state.courseTitle) {
      state.courseTitle = detected;
      writeStorage(COURSE_TITLE_PREFIX + route.courseId, detected);
      renderHub();
    }

    const routeKey = `${route.kind}|${route.courseId}|${route.sessionId}|${route.questionId}|${route.questionUuid}`;
    if (routeKey !== state.lastRouteKey) {
      state.lastRouteKey = routeKey;
      state.autoScrolledToActive = false;
      rememberLastItem(route);

      if (state.courseId !== route.courseId) {
        state.courseId = route.courseId;
        state.courseTitle = resolveCourseTitle(route.courseId);
        state.sessions = [];
        state.openSections.clear();
        state.query = '';
        if (state.elements?.searchInput) state.elements.searchInput.value = '';
        loadCourse(route.courseId);
      } else {
        ensureDefaultExpanded(route);
        renderSidebar();
        renderHub();
      }

      if (route.kind === 'coding') {
        window.setTimeout(() => window.dispatchEvent(new Event('resize')), 250);
        window.setTimeout(() => window.dispatchEvent(new Event('resize')), 900);
      }
    }
  }

  // Global keyboard shortcuts: Cmd/Ctrl+K for quick search, Cmd/Ctrl+B for sidebar toggle
  document.addEventListener('keydown', event => {
    const route = parseRoute();
    if (!route.inCourse || !isShellEnabled()) return;

    const mod = IS_MAC ? event.metaKey : event.ctrlKey;
    if (!mod || event.altKey) return;

    if (event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (!state.sidebarOpen) setSidebarOpen(true);
      state.elements?.searchInput?.focus();
      state.elements?.searchInput?.select();
    } else if (event.key.toLowerCase() === 'b' && !event.shiftKey) {
      // Avoid hijacking if user is typing inside Monaco editor or an input
      const active = document.activeElement;
      const inEditor = active?.closest?.('.monaco-editor') || active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT';
      if (inEditor) return;
      event.preventDefault();
      setSidebarOpen(!state.sidebarOpen);
    }
  }, true);

  // Immediately apply dark background classes at document_start to prevent white flash
  applyLayoutClasses(parseRoute());

  if (document.body) sync();
  else document.addEventListener('DOMContentLoaded', sync);

  // React to SPA route changes
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    const res = origPush.apply(this, args);
    sync();
    return res;
  };
  history.replaceState = function (...args) {
    const res = origReplace.apply(this, args);
    sync();
    return res;
  };
  window.addEventListener('popstate', sync);
  window.addEventListener('storage', event => {
    if (event.key === SHELL_ENABLED_KEY || event.key === SIDEBAR_OPEN_KEY) {
      state.sidebarOpen = readStorage(SIDEBAR_OPEN_KEY, 'on') !== 'off';
      sync();
    }
  });
  window.setInterval(sync, 400);
})();
