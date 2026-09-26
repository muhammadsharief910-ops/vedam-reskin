/**
 * Subject file index. Runs in the page's MAIN world so it can use the same
 * Vedam session cookie and API as the existing student pages.
 */
(function () {
  'use strict';

  const VIEW_PARAM = 'reskinFiles';
  const VIEW_VALUE = 'all';
  const API_BASE = 'https://api.vedam.org/';
  const PAGE_ID = 'vedam-all-files-page';
  const state = {
    activeCourseId: '',
    controller: null,
    sessions: [],
    query: '',
    openMonths: new Set(),
    openClasses: new Set(),
    loading: false,
    error: '',
    elements: null
  };

  function getRoute() {
    const url = new URL(window.location.href);
    const courseId = url.searchParams.get('courseOfferingId');
    const isSubject = url.pathname === '/sessions' && /^\d+$/.test(courseId || '');
    return {
      courseId: isSubject ? courseId : '',
      isFiles: isSubject && url.searchParams.get(VIEW_PARAM) === VIEW_VALUE
    };
  }

  function create(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function icon(name) {
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
    const paths = {
      back: ['M19 12H5', 'm12 19-7-7 7-7'],
      arrow: ['M5 12h14', 'm12 5 7 7-7 7'],
      download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 19h14'],
      search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'm21 21-4.3-4.3'],
      folder: ['M3 5h6l2 2h10v12H3z'],
      chevron: ['m9 18 6-6-6-6'],
      file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h6']
    };
    (paths[name] || []).forEach(d => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  function updateUrl(showFiles) {
    const url = new URL(window.location.href);
    if (showFiles) {
      url.searchParams.delete('reskinProblems');
      url.searchParams.set(VIEW_PARAM, VIEW_VALUE);
    }
    else url.searchParams.delete(VIEW_PARAM);
    window.location.assign(url.href);
  }

  function ensureButton() {
    const header = document.querySelector('.css-1sa4n4o > .css-1wa3lbr');
    const months = header?.querySelector('.css-15q6t04');
    if (!header || !months || header.querySelector('[data-vedam-show-files]')) return;

    const button = create('button', 'vedam-show-files-button', 'Show all files');
    button.type = 'button';
    button.dataset.vedamShowFiles = 'true';
    button.addEventListener('click', () => updateUrl(true));
    months.before(button);
  }

  function subjectName() {
    return document.querySelector('.css-1sa4n4o > .css-1wa3lbr .css-bt172e')?.textContent?.trim()
      || 'Your subject';
  }

  function sessionUrl(session) {
    const url = new URL('/sessions/' + session.id, window.location.origin);
    url.searchParams.set('courseOfferingId', String(session.courseOfferingId || state.activeCourseId));
    if (session.attendanceStatus) {
      const status = session.attendanceStatus.toLowerCase();
      url.searchParams.set('attendanceStatus', status[0].toUpperCase() + status.slice(1));
    }
    return url.pathname + url.search;
  }

  function authToken() {
    const cookie = document.cookie.split('; ').find(part => part.startsWith('accessToken='));
    return cookie ? decodeURIComponent(cookie.slice('accessToken='.length)) : '';
  }

  async function api(path, signal) {
    const token = authToken();
    if (!token) throw new Error('Please sign in to Vedam to view class files.');
    const response = await fetch(API_BASE + path, {
      headers: { Authorization: 'Bearer ' + token },
      signal
    });
    const body = await response.json();
    if (!response.ok || body.statusCode >= 400) {
      throw new Error(body.message || 'Could not load class files.');
    }
    return body.data;
  }

  async function allSessions(courseId, signal) {
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

  async function allResources(sessionId, signal) {
    const resources = [];
    let page = 0;
    let totalPages = 1;
    while (page < totalPages) {
      const params = new URLSearchParams({
        productId: String(sessionId),
        page: String(page),
        size: '100'
      });
      const data = await api('resource?' + params, signal);
      resources.push(...(data.items || []));
      totalPages = data.totalPages || 1;
      page += 1;
    }
    return resources;
  }

  function formatDate(seconds) {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric', month: 'long', year: 'numeric'
    }).format(new Date(seconds * 1000));
  }

  function monthName(seconds) {
    return new Intl.DateTimeFormat(undefined, {
      month: 'long', year: 'numeric'
    }).format(new Date(seconds * 1000));
  }

  function matchesSearch(session) {
    const haystack = [
      session.label, session.title, session.topic,
      ...(session.attachments || []).map(file => file.title)
    ].join(' ').toLowerCase();
    return haystack.includes(state.query);
  }

  function fileCount() {
    return state.sessions.reduce((sum, session) => sum + (session.attachments?.length || 0), 0);
  }

  function renderStatus() {
    if (!state.elements) return;
    const attachments = fileCount();
    const suffix = state.loading ? ' · Loading attachments…' : '';
    state.elements.summary.textContent =
      state.sessions.length + ' classes · ' + attachments + ' attachments' + suffix;
    state.elements.error.hidden = !state.error;
    state.elements.errorText.textContent = state.error;
    const months = new Set(state.sessions.map(session => monthName(session.startTime)));
    const allOpen = state.sessions.length > 0
      && state.openClasses.size === state.sessions.length
      && state.openMonths.size === months.size;
    state.elements.expand.textContent = allOpen ? 'Collapse all' : 'Expand all';
  }

  function makeLink(label, href, className, iconName) {
    const link = create('a', className);
    link.href = href;
    link.appendChild(create('span', '', label));
    if (iconName) link.appendChild(icon(iconName));
    return link;
  }

  function makeClassFolder(session) {
    const folder = create('details', 'vedam-tree-class');
    folder.open = !!state.query || state.openClasses.has(String(session.id));
    const summary = create('summary', 'vedam-tree-class-row');
    summary.addEventListener('click', () => {
      const key = String(session.id);
      if (folder.open) state.openClasses.delete(key);
      else state.openClasses.add(key);
    });
    summary.appendChild(icon('chevron'));
    summary.appendChild(icon('folder'));
    summary.appendChild(create('span', 'vedam-tree-label', session.label || 'Class'));
    summary.appendChild(create('span', 'vedam-tree-class-title', session.title || session.topic || 'Untitled class'));
    summary.appendChild(create('span', 'vedam-tree-date', formatDate(session.startTime)));
    const count = session.attachments === null ? '…' : String(session.attachments?.length || 0);
    summary.appendChild(create('span', 'vedam-tree-count', count));
    folder.appendChild(summary);

    const children = create('div', 'vedam-tree-class-children');
    if (session.attachments === null) {
      children.appendChild(create('p', 'vedam-tree-empty', 'Loading attachments…'));
    } else if (session.attachments === undefined) {
      children.appendChild(create('p', 'vedam-tree-empty', 'Could not load attachments.'));
    } else {
      const classMatches = [session.label, session.title, session.topic]
        .join(' ').toLowerCase().includes(state.query);
      const attachments = state.query && !classMatches
        ? session.attachments.filter(file => (file.title || '').toLowerCase().includes(state.query))
        : session.attachments;
      if (!attachments.length) {
        children.appendChild(create('p', 'vedam-tree-empty', 'No attachments'));
      } else {
        attachments.forEach(file => {
          const title = file.title || 'Untitled file';
          if (file.url) {
            const link = makeLink(title, file.url, 'vedam-tree-file', 'download');
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = 'Open ' + title;
            link.prepend(icon('file'));
            children.appendChild(link);
          } else {
            const unavailable = create('div', 'vedam-tree-file vedam-tree-file-unavailable');
            unavailable.appendChild(icon('file'));
            unavailable.appendChild(create('span', '', title + ' (unavailable)'));
            children.appendChild(unavailable);
          }
        });
      }
    }
    children.appendChild(makeLink('View class details', sessionUrl(session), 'vedam-tree-view-class', 'arrow'));
    folder.appendChild(children);
    return folder;
  }

  function makeMonthFolder(month, sessions) {
    const folder = create('details', 'vedam-tree-month');
    folder.open = !!state.query || state.openMonths.has(month);
    const summary = create('summary', 'vedam-tree-month-row');
    summary.addEventListener('click', () => {
      if (folder.open) state.openMonths.delete(month);
      else state.openMonths.add(month);
    });
    summary.appendChild(icon('chevron'));
    summary.appendChild(icon('folder'));
    summary.appendChild(create('span', 'vedam-tree-month-name', month));
    const attachmentCount = sessions.reduce((sum, session) => sum + (session.attachments?.length || 0), 0);
    summary.appendChild(create('span', 'vedam-tree-month-meta',
      sessions.length + ' classes · ' + attachmentCount + ' attachments'));
    folder.appendChild(summary);
    const children = create('div', 'vedam-tree-month-children');
    sessions.forEach(session => children.appendChild(makeClassFolder(session)));
    folder.appendChild(children);
    return folder;
  }

  function renderTree() {
    if (!state.elements) return;
    renderStatus();
    const list = state.elements.list;
    list.replaceChildren();
    const visible = state.sessions.filter(matchesSearch);
    if (!visible.length) {
      list.appendChild(create(
        'div', 'vedam-files-empty-state',
        state.loading && !state.sessions.length ? 'Loading classes…' : 'No classes match this view.'
      ));
      return;
    }
    const groups = new Map();
    visible.forEach(session => {
      const month = monthName(session.startTime);
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(session);
    });
    groups.forEach((sessions, month) => list.appendChild(makeMonthFolder(month, sessions)));
  }

  function mountPage() {
    const content = document.querySelector('.css-1sa4n4o');
    if (!content) return false;
    document.body.classList.add('vedam-files-active');
    if (document.getElementById(PAGE_ID)) return true;

    const page = create('div', 'vedam-files-page');
    page.id = PAGE_ID;
    const header = create('header', 'vedam-files-header');
    const back = create('button', 'vedam-files-back');
    back.type = 'button';
    back.setAttribute('aria-label', 'Back to classes');
    back.appendChild(icon('back'));
    back.addEventListener('click', () => updateUrl(false));
    header.appendChild(back);
    const heading = create('div', 'vedam-files-heading');
    heading.appendChild(create('p', 'vedam-files-eyebrow', subjectName()));
    heading.appendChild(create('h1', '', 'All class files'));
    const summary = create('p', 'vedam-files-summary', 'Loading classes…');
    heading.appendChild(summary);
    header.appendChild(heading);
    page.appendChild(header);

    const toolbar = create('div', 'vedam-files-toolbar');
    const search = create('label', 'vedam-files-search');
    search.appendChild(icon('search'));
    const input = create('input');
    input.type = 'search';
    input.placeholder = 'Search classes and attachments';
    input.setAttribute('aria-label', 'Search class files');
    input.addEventListener('input', () => {
      state.query = input.value.trim().toLowerCase();
      renderTree();
    });
    search.appendChild(input);
    toolbar.appendChild(search);
    const expand = create('button', 'vedam-tree-expand-all', 'Expand all');
    expand.type = 'button';
    expand.addEventListener('click', () => {
      const months = new Set(state.sessions.map(session => monthName(session.startTime)));
      const allOpen = state.sessions.length > 0
        && state.openClasses.size === state.sessions.length
        && state.openMonths.size === months.size;
      if (allOpen) {
        state.openMonths.clear();
        state.openClasses.clear();
      } else {
        state.openMonths = months;
        state.openClasses = new Set(state.sessions.map(session => String(session.id)));
      }
      renderTree();
    });
    toolbar.appendChild(expand);
    page.appendChild(toolbar);

    const error = create('div', 'vedam-files-error');
    error.hidden = true;
    const errorText = create('span');
    error.appendChild(errorText);
    const retry = create('button', '', 'Retry');
    retry.type = 'button';
    retry.addEventListener('click', () => loadFiles(state.activeCourseId));
    error.appendChild(retry);
    page.appendChild(error);
    const list = create('div', 'vedam-files-list vedam-file-tree');
    page.appendChild(list);
    content.appendChild(page);
    state.elements = { page, summary, error, errorText, list, expand };
    renderTree();
    return true;
  }

  function unmountPage() {
    document.body?.classList.remove('vedam-files-active');
    document.getElementById(PAGE_ID)?.remove();
    state.elements = null;
    state.controller?.abort();
    state.controller = null;
    state.activeCourseId = '';
    state.sessions = [];
    state.openMonths.clear();
    state.openClasses.clear();
    state.loading = false;
    state.error = '';
  }

  async function loadFiles(courseId) {
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    state.loading = true;
    state.error = '';
    state.sessions = [];
    renderTree();

    try {
      const sessions = await allSessions(courseId, controller.signal);
      if (controller.signal.aborted) return;
      state.sessions = sessions.map(session => ({
        ...session, attachments: null
      }));
      if (sessions.length && !state.openMonths.size) {
        state.openMonths.add(monthName(sessions[0].startTime));
      }
      renderTree();
      let nextIndex = 0;
      const workers = Array.from({ length: Math.min(6, state.sessions.length) }, async () => {
        while (nextIndex < state.sessions.length && !controller.signal.aborted) {
          const session = state.sessions[nextIndex++];
          try {
            session.attachments = await allResources(session.id, controller.signal);
          } catch {
            session.attachments = undefined;
            if (!controller.signal.aborted) {
              state.error = 'Some attachments could not be loaded. Retry to refresh them.';
            }
          }
          if (controller.signal.aborted) return;
          renderTree();
        }
      });
      await Promise.all(workers);
      if (!controller.signal.aborted) {
        state.loading = false;
        renderTree();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      state.loading = false;
      state.error = error.message || 'Could not load class files.';
      renderTree();
    }
  }

  function sync() {
    if (!document.body) return;
    const route = getRoute();
    if (!route.courseId) {
      unmountPage();
      return;
    }
    ensureButton();
    if (!route.isFiles) {
      if (state.activeCourseId || state.elements) unmountPage();
      return;
    }
    if (!mountPage()) return;
    if (state.activeCourseId !== route.courseId) {
      state.activeCourseId = route.courseId;
      state.query = '';
      loadFiles(route.courseId);
    }
  }

  if (document.body) sync();
  else document.addEventListener('DOMContentLoaded', sync);
  window.addEventListener('popstate', sync);
  window.setInterval(sync, 500);
})();
/** Open the LMS's purple class arrow in a new tab on subject session lists. */
(function () {
  'use strict';

  const API_BASE = 'https://api.vedam.org/';
  const cache = { courseId: '', sessions: [], promise: null };
  let replayingNativeClick = false;

  function courseId() {
    const url = new URL(location.href);
    const id = url.searchParams.get('courseOfferingId');
    if (url.pathname !== '/sessions' || !/^\d+$/.test(id || '')
        || url.searchParams.has('reskinFiles') || url.searchParams.has('reskinProblems')) {
      return '';
    }
    return id;
  }

  function token() {
    const cookie = document.cookie.split('; ').find(part => part.startsWith('accessToken='));
    return cookie ? decodeURIComponent(cookie.slice('accessToken='.length)) : '';
  }

  async function loadSessions(id) {
    if (cache.courseId === id && cache.promise) return cache.promise;
    cache.courseId = id;
    cache.sessions = [];
    cache.promise = (async () => {
      const accessToken = token();
      if (!accessToken) throw new Error('Not signed in');
      const sessions = [];
      let page = 0;
      let totalPages = 1;
      while (page < totalPages) {
        const query = new URLSearchParams({
          courseOfferingId: id, page: String(page), size: '100'
        });
        const response = await fetch(API_BASE + 'class-session/all?' + query, {
          headers: { Authorization: 'Bearer ' + accessToken }
        });
        const body = await response.json();
        if (!response.ok || body.statusCode >= 400) throw new Error('Could not load classes');
        sessions.push(...(body.data?.items || []));
        totalPages = body.data?.totalPages || 1;
        page += 1;
      }
      if (cache.courseId === id) cache.sessions = sessions;
      return sessions;
    })().catch(() => {
      if (cache.courseId === id) cache.promise = null;
      return [];
    });
    return cache.promise;
  }

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function sessionDate(seconds) {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata'
    }).format(new Date(Number(seconds) * 1000));
  }

  function matchSession(arrow) {
    const row = arrow.closest('.css-j2x81n');
    if (!row) return null;
    const label = normalize(row.querySelector('.css-1jkn8z2')?.textContent);
    const title = normalize(row.querySelector('.css-14qfd52')?.textContent);
    const date = normalize(row.querySelector('.css-p8z22x')?.textContent);
    return cache.sessions.find(session =>
      normalize(session.label) === label
      && normalize(session.title) === title
      && normalize(sessionDate(session.startTime)) === date
    ) || null;
  }

  function sessionUrl(session, id) {
    const url = new URL('/sessions/' + session.id, location.origin);
    url.searchParams.set('courseOfferingId', id);
    if (session.attendanceStatus) {
      const status = String(session.attendanceStatus).toLowerCase();
      url.searchParams.set('attendanceStatus', status[0].toUpperCase() + status.slice(1));
    }
    return url.href;
  }

  document.addEventListener('click', event => {
    if (replayingNativeClick) {
      replayingNativeClick = false;
      return;
    }
    const id = courseId();
    if (!id || !(event.target instanceof Element)) return;
    const arrow = event.target.closest('.css-2z60tk');
    if (!arrow?.closest('.css-j2x81n')
        || !arrow.querySelector('path[fill="#8A18FF"],path[fill="#8a18ff"]')) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const tab = window.open('about:blank', '_blank');
    const finish = () => {
      const session = matchSession(arrow);
      if (session && tab && !tab.closed) {
        tab.opener = null;
        tab.location.replace(sessionUrl(session, id));
        return;
      }
      tab?.close();
      replayingNativeClick = true;
      arrow.click();
    };

    if (cache.courseId === id && cache.sessions.length) finish();
    else loadSessions(id).then(finish);
  }, true);

  window.setInterval(() => {
    const id = courseId();
    if (id && document.querySelector('.css-j2x81n')) loadSessions(id);
  }, 1000);
})();
