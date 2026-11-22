/**
 * Vedam LMS Reskin — Student Video Player Enhancer
 *
 * - Activates on /sessions/<sessionId> pages (without questionId).
 * - When opened with ?reskinPlayer=1 (from new-tab recording links),
 *   auto-opens the class recording into a dedicated full-viewport dark player.
 * - Upgrades any HTML5 <video> on the page with student-focused controls:
 *     * -10s / +10s seek (buttons + ArrowLeft/ArrowRight/J/L; Shift+Arrow for ±5s)
 *     * Playback speed selector (0.75x – 2.5x, persisted, [ / ] shortcuts)
 *     * Auto-resume timestamp per session (with 1-click Start over)
 *     * Timestamp bookmarks per session (B key or button, clickable timeline markers)
 *     * A-B segment loop for rewatching tricky explanations
 *     * Picture-in-Picture (P), Fullscreen (F), Mute (M), Volume (Up/Down)
 */
(function () {
  'use strict';

  const SPEED_KEY = 'vedam-reskin-video-speed';
  const VOLUME_KEY = 'vedam-reskin-video-volume';
  const PROGRESS_PREFIX = 'vedam-reskin-video-progress:';
  const BOOKMARKS_PREFIX = 'vedam-reskin-video-bookmarks:';
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];

  const state = {
    sessionId: '',
    courseId: '',
    dedicated: false,
    autoClickedWatch: false,
    video: null,
    playerRoot: null,
    loadingEl: null,
    hudTimer: null,
    hideControlsTimer: null,
    saveTick: 0,
    loopA: null,
    loopB: null,
    bookmarks: [],
    ui: null
  };

  function readStorage(key, fallback) {
    try {
      const val = window.localStorage.getItem(key);
      return val === null ? fallback : val;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, val) {
    try {
      window.localStorage.setItem(key, String(val));
    } catch {}
  }

  function parseSessionRoute(href) {
    let url;
    try {
      url = new URL(href || window.location.href);
    } catch {
      return { isSession: false };
    }
    const path = url.pathname.replace(/\/+$/, '');
    const match = path.match(/^\/sessions\/(\d+)$/);
    if (!match || url.searchParams.has('questionId')) {
      return { isSession: false };
    }
    return {
      isSession: true,
      sessionId: match[1],
      courseId: url.searchParams.get('courseOfferingId') || '',
      dedicated: url.searchParams.get('reskinPlayer') === '1'
    };
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function create(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function svgIcon(name, size = 18) {
    const paths = {
      play: ['M6 4l15 8-15 8z'],
      pause: ['M6 4h4v16H6z', 'M14 4h4v16h-4z'],
      back10: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
      fwd10: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
      vol: ['M11 5 6 9H2v6h4l5 4z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a9 9 0 0 1 0 14'],
      mute: ['M11 5 6 9H2v6h4l5 4z', 'm22 9-6 6', 'm16 9 6 6'],
      pip: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M12 12h7v5h-7z'],
      full: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
      bookmark: ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'],
      close: ['M18 6 6 18', 'M6 6l12 12']
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', name === 'play' || name === 'pause' ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    (paths[name] || []).forEach(d => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  function loadBookmarks(sessionId) {
    try {
      const raw = readStorage(BOOKMARKS_PREFIX + sessionId, '[]');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveBookmarks() {
    if (!state.sessionId) return;
    writeStorage(BOOKMARKS_PREFIX + state.sessionId, JSON.stringify(state.bookmarks));
  }

  function loadSavedProgress(sessionId) {
    const val = Number(readStorage(PROGRESS_PREFIX + sessionId, '0'));
    return Number.isFinite(val) && val > 5 ? val : 0;
  }

  function saveProgress(time, duration) {
    if (!state.sessionId || !Number.isFinite(time)) return;
    if (duration && time > duration - 10) {
      writeStorage(PROGRESS_PREFIX + state.sessionId, '0');
    } else {
      writeStorage(PROGRESS_PREFIX + state.sessionId, Math.floor(time));
    }
  }

  function showHud(text) {
    if (!state.ui?.hud) return;
    state.ui.hud.textContent = text;
    state.ui.hud.classList.add('is-visible');
    if (state.hudTimer) window.clearTimeout(state.hudTimer);
    state.hudTimer = window.setTimeout(() => {
      state.ui?.hud?.classList.remove('is-visible');
    }, 850);
  }

  function seekBy(delta) {
    const v = state.video;
    if (!v || !Number.isFinite(v.currentTime)) return;
    const dur = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.min(dur, Math.max(0, v.currentTime + delta));
    showHud(delta > 0 ? `+${delta}s` : `${delta}s`);
    syncControls();
  }

  function togglePlay() {
    const v = state.video;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      showHud('Play');
    } else {
      v.pause();
      showHud('Pause');
    }
    syncControls();
  }

  function setSpeed(rate) {
    const v = state.video;
    if (!v) return;
    const clamped = Math.min(3, Math.max(0.5, Number(rate) || 1));
    v.playbackRate = clamped;
    writeStorage(SPEED_KEY, clamped);
    showHud(`${clamped}×`);
    syncControls();
  }

  function stepSpeed(dir) {
    const current = state.video?.playbackRate || 1;
    let idx = SPEEDS.findIndex(s => Math.abs(s - current) < 0.01);
    if (idx === -1) idx = SPEEDS.indexOf(1);
    const nextIdx = Math.min(SPEEDS.length - 1, Math.max(0, idx + dir));
    setSpeed(SPEEDS[nextIdx]);
  }

  function toggleMute() {
    const v = state.video;
    if (!v) return;
    v.muted = !v.muted;
    showHud(v.muted ? 'Muted' : `Volume ${Math.round(v.volume * 100)}%`);
    syncControls();
  }

  function adjustVolume(delta) {
    const v = state.video;
    if (!v) return;
    v.muted = false;
    v.volume = Math.min(1, Math.max(0, Math.round((v.volume + delta) * 20) / 20));
    writeStorage(VOLUME_KEY, v.volume);
    showHud(`Volume ${Math.round(v.volume * 100)}%`);
    syncControls();
  }

  async function togglePiP() {
    const v = state.video;
    if (!v || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {}
  }

  async function toggleFullscreen() {
    const target = state.ui?.stage || state.video;
    if (!target) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch {}
  }

  function addBookmark() {
    const v = state.video;
    if (!v) return;
    const time = Math.floor(v.currentTime || 0);
    const label = window.prompt(`Bookmark note at ${formatTime(time)} (optional):`, '');
    if (label === null) return;
    state.bookmarks.push({
      id: Date.now() + Math.random(),
      time,
      label: label.trim() || `Timestamp ${formatTime(time)}`
    });
    state.bookmarks.sort((a, b) => a.time - b.time);
    saveBookmarks();
    renderBookmarks();
    showHud(`Bookmarked ${formatTime(time)}`);
  }

  function cycleLoop() {
    const v = state.video;
    if (!v) return;
    const t = v.currentTime || 0;
    if (state.loopA === null) {
      state.loopA = t;
      state.loopB = null;
      showHud(`Loop A: ${formatTime(t)}`);
    } else if (state.loopB === null) {
      if (t <= state.loopA + 1) {
        state.loopA = null;
        state.loopB = null;
        showHud('Loop cleared');
      } else {
        state.loopB = t;
        showHud(`Loop ${formatTime(state.loopA)} – ${formatTime(state.loopB)}`);
      }
    } else {
      state.loopA = null;
      state.loopB = null;
      showHud('Loop off');
    }
    syncControls();
  }

  function renderBookmarks() {
    if (!state.ui) return;
    const { markersWrap, bookmarksBar } = state.ui;
    const duration = state.video?.duration || 0;

    markersWrap.replaceChildren();
    if (duration > 0) {
      state.bookmarks.forEach(bm => {
        const pct = Math.min(100, Math.max(0, (bm.time / duration) * 100));
        const dot = create('button', 'vvp-marker');
        dot.type = 'button';
        dot.style.left = pct + '%';
        dot.title = `${formatTime(bm.time)} — ${bm.label}`;
        dot.addEventListener('click', e => {
          e.stopPropagation();
          if (state.video) state.video.currentTime = bm.time;
          showHud(formatTime(bm.time));
        });
        markersWrap.appendChild(dot);
      });
    }

    bookmarksBar.replaceChildren();
    if (!state.bookmarks.length) {
      bookmarksBar.hidden = true;
      return;
    }
    bookmarksBar.hidden = false;
    state.bookmarks.forEach(bm => {
      const chip = create('div', 'vvp-bm-chip');
      const jump = create('button', 'vvp-bm-jump');
      jump.type = 'button';
      jump.append(
        create('span', 'vvp-bm-time', formatTime(bm.time)),
        create('span', 'vvp-bm-label', bm.label)
      );
      jump.addEventListener('click', () => {
        if (state.video) {
          state.video.currentTime = bm.time;
          state.video.play().catch(() => {});
        }
      });
      const del = create('button', 'vvp-bm-del');
      del.type = 'button';
      del.title = 'Remove bookmark';
      del.appendChild(svgIcon('close', 11));
      del.addEventListener('click', () => {
        state.bookmarks = state.bookmarks.filter(item => item.id !== bm.id);
        saveBookmarks();
        renderBookmarks();
      });
      chip.append(jump, del);
      bookmarksBar.appendChild(chip);
    });
  }

  function syncControls() {
    if (!state.ui || !state.video) return;
    const v = state.video;
    const {
      playBtn,
      timeText,
      progressFill,
      bufferFill,
      loopRange,
      volBtn,
      volRange,
      speedBtn,
      loopBtn
    } = state.ui;

    playBtn.replaceChildren(svgIcon(v.paused ? 'play' : 'pause', 18));
    playBtn.title = v.paused ? 'Play (Space)' : 'Pause (Space)';

    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    const cur = Number.isFinite(v.currentTime) ? v.currentTime : 0;
    timeText.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    progressFill.style.width = dur > 0 ? `${Math.min(100, (cur / dur) * 100)}%` : '0%';

    if (dur > 0 && v.buffered.length > 0) {
      const end = v.buffered.end(v.buffered.length - 1);
      bufferFill.style.width = `${Math.min(100, (end / dur) * 100)}%`;
    }

    if (dur > 0 && state.loopA !== null && state.loopB !== null) {
      loopRange.hidden = false;
      loopRange.style.left = `${(state.loopA / dur) * 100}%`;
      loopRange.style.width = `${((state.loopB - state.loopA) / dur) * 100}%`;
    } else {
      loopRange.hidden = true;
    }

    volBtn.replaceChildren(svgIcon(v.muted || v.volume === 0 ? 'mute' : 'vol', 17));
    volRange.value = String(v.muted ? 0 : v.volume);
    speedBtn.textContent = `${v.playbackRate}×`;

    if (state.loopA !== null && state.loopB !== null) {
      loopBtn.classList.add('is-active');
      loopBtn.textContent = `Loop ${formatTime(state.loopA)}–${formatTime(state.loopB)}`;
    } else if (state.loopA !== null) {
      loopBtn.classList.add('is-active');
      loopBtn.textContent = `Loop A: ${formatTime(state.loopA)}`;
    } else {
      loopBtn.classList.remove('is-active');
      loopBtn.textContent = 'A–B';
    }
  }

  function revealControlsTemporarily() {
    if (!state.ui?.stage) return;
    state.ui.stage.classList.add('controls-visible');
    if (state.hideControlsTimer) window.clearTimeout(state.hideControlsTimer);
    state.hideControlsTimer = window.setTimeout(() => {
      if (state.video && !state.video.paused) {
        state.ui?.stage?.classList.remove('controls-visible');
      }
    }, 2600);
  }

  function detectSessionTitle() {
    const candidates = [
      document.querySelector('.css-1sa4n4o h1')?.textContent,
      document.querySelector('.css-1sa4n4o h2')?.textContent,
      document.querySelector('.css-1sa4n4o .MuiTypography-h5')?.textContent,
      document.querySelector('.css-1sa4n4o .MuiTypography-h6')?.textContent
    ];
    for (const c of candidates) {
      const clean = String(c || '').trim();
      if (clean && clean.length > 2) return clean;
    }
    return `Lecture Recording`;
  }

  function ensureDedicatedShell() {
    if (!state.dedicated || !document.body) return null;
    let shell = document.getElementById('vedam-video-player-page');
    if (!shell) {
      shell = create('div', 'vvp-page');
      shell.id = 'vedam-video-player-page';

      const topbar = create('header', 'vvp-topbar');
      const titleEl = create('h1', 'vvp-title', detectSessionTitle());
      const topActions = create('div', 'vvp-top-actions');
      const classPageUrl = new URL(window.location.href);
      classPageUrl.searchParams.delete('reskinPlayer');
      const openClassLink = create('a', 'vvp-top-link', 'Open session page');
      openClassLink.href = classPageUrl.href;
      topActions.appendChild(openClassLink);
      topbar.append(titleEl, topActions);

      const loadingEl = create('div', 'vvp-loading', 'Loading lecture recording…');
      shell.append(topbar, loadingEl);
      document.body.appendChild(shell);
      state.playerRoot = shell;
      state.loadingEl = loadingEl;
    } else {
      const titleEl = shell.querySelector('.vvp-title');
      const detected = detectSessionTitle();
      if (titleEl && detected !== 'Lecture Recording') {
        titleEl.textContent = detected;
      }
    }
    return shell;
  }

  function enhanceVideo(video) {
    if (!video || video.dataset.vvpEnhanced === 'true') return;
    video.dataset.vvpEnhanced = 'true';
    state.video = video;
    state.bookmarks = loadBookmarks(state.sessionId);
    state.loopA = null;
    state.loopB = null;

    video.controls = false;
    video.removeAttribute('controls');
    video.setAttribute('playsinline', '');

    const savedSpeed = Number(readStorage(SPEED_KEY, '1'));
    if (Number.isFinite(savedSpeed) && savedSpeed >= 0.5 && savedSpeed <= 3) {
      video.playbackRate = savedSpeed;
    }
    const savedVol = Number(readStorage(VOLUME_KEY, '1'));
    if (Number.isFinite(savedVol) && savedVol >= 0 && savedVol <= 1) {
      video.volume = savedVol;
    }

    const stage = create('div', 'vvp-stage controls-visible');
    if (state.dedicated) stage.classList.add('is-dedicated');

    const parent = video.parentElement;
    if (state.dedicated) {
      const shell = ensureDedicatedShell();
      state.loadingEl?.remove();
      state.loadingEl = null;
      shell.appendChild(stage);
      stage.appendChild(video);
      state.playerRoot = shell;
    } else if (parent) {
      parent.insertBefore(stage, video);
      stage.appendChild(video);
      state.playerRoot = stage;
    }

    const hud = create('div', 'vvp-hud');
    stage.appendChild(hud);

    const resumeBanner = create('div', 'vvp-resume-banner');
    resumeBanner.hidden = true;
    stage.appendChild(resumeBanner);

    let clickTimer = null;
    video.addEventListener('click', () => {
      if (clickTimer) {
        window.clearTimeout(clickTimer);
        clickTimer = null;
        return;
      }
      clickTimer = window.setTimeout(() => {
        clickTimer = null;
        togglePlay();
      }, 210);
    });
    video.addEventListener('dblclick', event => {
      const rect = video.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (x < rect.width * 0.35) seekBy(-10);
      else if (x > rect.width * 0.65) seekBy(10);
      else toggleFullscreen();
    });

    const controls = create('div', 'vvp-controls');

    const timeline = create('div', 'vvp-timeline');
    const track = create('div', 'vvp-track');
    const bufferFill = create('div', 'vvp-buffer');
    const progressFill = create('div', 'vvp-progress');
    const loopRange = create('div', 'vvp-loop-range');
    loopRange.hidden = true;
    const markersWrap = create('div', 'vvp-markers');
    const hoverTip = create('div', 'vvp-hover-tip');
    hoverTip.hidden = true;
    track.append(bufferFill, loopRange, progressFill, markersWrap);
    timeline.append(track, hoverTip);

    let scrubbing = false;
    const seekToPointer = clientX => {
      const rect = timeline.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = ratio * video.duration;
        syncControls();
      }
    };
    timeline.addEventListener('pointerdown', e => {
      e.preventDefault();
      scrubbing = true;
      timeline.setPointerCapture?.(e.pointerId);
      seekToPointer(e.clientX);
    });
    timeline.addEventListener('pointermove', e => {
      const rect = timeline.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      if (Number.isFinite(video.duration) && video.duration > 0) {
        hoverTip.hidden = false;
        hoverTip.style.left = `${ratio * 100}%`;
        hoverTip.textContent = formatTime(ratio * video.duration);
      }
      if (scrubbing) seekToPointer(e.clientX);
    });
    timeline.addEventListener('pointerup', e => {
      scrubbing = false;
      timeline.releasePointerCapture?.(e.pointerId);
    });
    timeline.addEventListener('pointerleave', () => {
      hoverTip.hidden = true;
    });

    const row = create('div', 'vvp-row');
    const left = create('div', 'vvp-group');
    const right = create('div', 'vvp-group');

    const playBtn = create('button', 'vvp-btn');
    playBtn.type = 'button';
    playBtn.addEventListener('click', togglePlay);

    const back10Btn = create('button', 'vvp-btn vvp-skip-btn');
    back10Btn.type = 'button';
    back10Btn.title = 'Rewind 10s (← or J)';
    back10Btn.append(svgIcon('back10', 16), create('span', '', '10s'));
    back10Btn.addEventListener('click', () => seekBy(-10));

    const fwd10Btn = create('button', 'vvp-btn vvp-skip-btn');
    fwd10Btn.type = 'button';
    fwd10Btn.title = 'Forward 10s (→ or L)';
    fwd10Btn.append(create('span', '', '10s'), svgIcon('fwd10', 16));
    fwd10Btn.addEventListener('click', () => seekBy(10));

    const volBtn = create('button', 'vvp-btn');
    volBtn.type = 'button';
    volBtn.title = 'Mute / Unmute (M)';
    volBtn.addEventListener('click', toggleMute);

    const volRange = create('input', 'vvp-vol-range');
    volRange.type = 'range';
    volRange.min = '0';
    volRange.max = '1';
    volRange.step = '0.05';
    volRange.value = String(video.volume);
    volRange.setAttribute('aria-label', 'Volume');
    volRange.addEventListener('input', () => {
      video.muted = false;
      video.volume = Number(volRange.value);
      writeStorage(VOLUME_KEY, video.volume);
      syncControls();
    });

    const timeText = create('span', 'vvp-time', '0:00 / 0:00');
    left.append(playBtn, back10Btn, fwd10Btn, volBtn, volRange, timeText);

    const speedWrap = create('div', 'vvp-speed-wrap');
    const speedBtn = create('button', 'vvp-btn vvp-text-btn', `${video.playbackRate}×`);
    speedBtn.type = 'button';
    speedBtn.title = 'Playback speed ([ / ])';

    const speedMenu = create('div', 'vvp-speed-menu');
    speedMenu.hidden = true;
    SPEEDS.forEach(s => {
      const opt = create('button', 'vvp-speed-opt', `${s}×`);
      opt.type = 'button';
      opt.addEventListener('click', () => {
        setSpeed(s);
        speedMenu.hidden = true;
      });
      speedMenu.appendChild(opt);
    });
    speedBtn.addEventListener('click', e => {
      e.stopPropagation();
      speedMenu.hidden = !speedMenu.hidden;
    });
    document.addEventListener('click', () => {
      speedMenu.hidden = true;
    });
    speedWrap.append(speedMenu, speedBtn);

    const bmBtn = create('button', 'vvp-btn vvp-text-btn');
    bmBtn.type = 'button';
    bmBtn.title = 'Add timestamp bookmark (B)';
    bmBtn.append(svgIcon('bookmark', 14), create('span', '', 'Bookmark'));
    bmBtn.addEventListener('click', addBookmark);

    const loopBtn = create('button', 'vvp-btn vvp-text-btn', 'A–B');
    loopBtn.type = 'button';
    loopBtn.title = 'Set A–B loop points';
    loopBtn.addEventListener('click', cycleLoop);

    const pipBtn = create('button', 'vvp-btn');
    pipBtn.type = 'button';
    pipBtn.title = 'Picture-in-Picture (P)';
    pipBtn.appendChild(svgIcon('pip', 17));
    pipBtn.addEventListener('click', togglePiP);

    const fullBtn = create('button', 'vvp-btn');
    fullBtn.type = 'button';
    fullBtn.title = 'Fullscreen (F)';
    fullBtn.appendChild(svgIcon('full', 17));
    fullBtn.addEventListener('click', toggleFullscreen);

    right.append(speedWrap, bmBtn, loopBtn, pipBtn, fullBtn);
    row.append(left, right);
    controls.append(timeline, row);
    stage.appendChild(controls);

    const bookmarksBar = create('div', 'vvp-bookmarks-bar');
    bookmarksBar.hidden = true;
    if (state.dedicated && state.playerRoot) {
      state.playerRoot.appendChild(bookmarksBar);
      const shortcutsHint = create('div', 'vvp-shortcuts-bar');
      shortcutsHint.textContent = 'Shortcuts: Space Play/Pause · ←/→ ±10s · Shift+←/→ ±5s · [ / ] Speed · B Bookmark · P PiP · F Fullscreen · M Mute';
      state.playerRoot.appendChild(shortcutsHint);
    } else {
      stage.after(bookmarksBar);
    }

    stage.addEventListener('mousemove', revealControlsTemporarily);
    stage.addEventListener('mouseenter', revealControlsTemporarily);

    state.ui = {
      stage,
      hud,
      resumeBanner,
      playBtn,
      timeText,
      progressFill,
      bufferFill,
      loopRange,
      markersWrap,
      volBtn,
      volRange,
      speedBtn,
      loopBtn,
      bookmarksBar
    };

    video.addEventListener('loadedmetadata', () => {
      const saved = loadSavedProgress(state.sessionId);
      if (saved > 5 && video.duration && saved < video.duration - 15) {
        video.currentTime = saved;
        resumeBanner.hidden = false;
        resumeBanner.replaceChildren(
          create('span', '', `Resumed at ${formatTime(saved)}`),
          (() => {
            const btn = create('button', 'vvp-resume-restart', 'Start over');
            btn.type = 'button';
            btn.addEventListener('click', () => {
              video.currentTime = 0;
              resumeBanner.hidden = true;
            });
            return btn;
          })()
        );
        window.setTimeout(() => { resumeBanner.hidden = true; }, 5000);
      }
      renderBookmarks();
      syncControls();
    });

    video.addEventListener('timeupdate', () => {
      if (state.loopA !== null && state.loopB !== null && video.currentTime >= state.loopB) {
        video.currentTime = state.loopA;
      }
      const now = Date.now();
      if (now - state.saveTick > 3000) {
        state.saveTick = now;
        saveProgress(video.currentTime, video.duration);
      }
      syncControls();
    });

    video.addEventListener('play', () => {
      syncControls();
      revealControlsTemporarily();
    });
    video.addEventListener('pause', () => {
      saveProgress(video.currentTime, video.duration);
      state.ui?.stage?.classList.add('controls-visible');
      syncControls();
    });
    video.addEventListener('volumechange', syncControls);
    video.addEventListener('ratechange', syncControls);
    video.addEventListener('progress', syncControls);

    renderBookmarks();
    syncControls();
  }

  function tryAutoClickWatchRecording() {
    if (!state.dedicated || state.autoClickedWatch) return;
    if (document.querySelector('video')) {
      state.autoClickedWatch = true;
      return;
    }
    const buttons = [...document.querySelectorAll('button')];
    const watchBtn = buttons.find(btn => /watch recording/i.test((btn.textContent || '').trim()));
    if (watchBtn) {
      state.autoClickedWatch = true;
      watchBtn.click();
    }
  }

  function sync() {
    const route = parseSessionRoute();
    const isDedicated = Boolean(route.isSession && route.dedicated);
    document.documentElement.classList.toggle('vedam-player-dedicated', isDedicated);
    if (document.body) {
      document.body.classList.toggle('vedam-player-dedicated', isDedicated);
    }

    if (!route.isSession) {
      state.sessionId = '';
      state.dedicated = false;
      state.autoClickedWatch = false;
      state.video = null;
      return;
    }

    if (state.sessionId !== route.sessionId || state.dedicated !== route.dedicated) {
      state.sessionId = route.sessionId;
      state.courseId = route.courseId;
      state.dedicated = route.dedicated;
      state.autoClickedWatch = false;
    }

    if (state.dedicated) ensureDedicatedShell();
    tryAutoClickWatchRecording();

    const video = document.querySelector('video');
    if (video && video.dataset.vvpEnhanced !== 'true') {
      enhanceVideo(video);
    }
  }

  document.addEventListener('keydown', event => {
    if (!state.video || !state.video.isConnected) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const key = event.key.toLowerCase();
    if (key === ' ' || key === 'k') {
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seekBy(event.shiftKey ? -5 : -10);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      seekBy(event.shiftKey ? 5 : 10);
    } else if (key === 'j') {
      event.preventDefault();
      seekBy(-10);
    } else if (key === 'l') {
      event.preventDefault();
      seekBy(10);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      adjustVolume(0.05);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      adjustVolume(-0.05);
    } else if (key === 'm') {
      event.preventDefault();
      toggleMute();
    } else if (key === 'f') {
      event.preventDefault();
      toggleFullscreen();
    } else if (key === 'p') {
      event.preventDefault();
      togglePiP();
    } else if (key === 'b') {
      event.preventDefault();
      addBookmark();
    } else if (key === '[') {
      event.preventDefault();
      stepSpeed(-1);
    } else if (key === ']') {
      event.preventDefault();
      stepSpeed(1);
    }
  }, true);

  if (document.body) sync();
  else document.addEventListener('DOMContentLoaded', sync);

  const observer = new MutationObserver(() => sync());
  const startObserving = () => {
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  };
  if (document.body) startObserving();
  else document.addEventListener('DOMContentLoaded', startObserving);

  window.setInterval(sync, 450);
})();
