// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
// Amble — bootstrap and screen flow.

/**
 * main.ts — mount the DOM, wire input to `Match`, and move between
 * menu → setup → [solo | room entry → lobby] → countdown → game → results.
 *
 * ONE Net per session, joined once and held until the player goes back to the
 * menu; every rematch happens INSIDE it via rematch.ts. Never leave and rejoin to
 * reset — see the engine README for why that is fatal.
 */

import '@ben-gy/game-engine/mobile.css';
import './styles/main.css';

import { hardenViewport } from '@ben-gy/game-engine/mobile';
import { createSfx } from '@ben-gy/game-engine/sound';
import { createStore } from '@ben-gy/game-engine/storage';
import { makeRng } from '@ben-gy/game-engine/rng';
import { createNet, type Net, type PeerId, roomAppId, setTurnConfig } from '@ben-gy/game-engine/net';
import { getTurnConfig } from '@ben-gy/game-engine/turn';
import { createRounds, type RoundInfo, type Rounds } from '@ben-gy/game-engine/rematch';
import { clearRoomInUrl, createLobby, createRoomEntry, normalizeRoomCode, setRoomInUrl } from '@ben-gy/game-engine/lobby';

import { chooseMove } from './ai';
import {
  type Action,
  type GameState,
  decodeAction,
  legalActions,
  mover,
  type WireAction,
} from './game';
import { createOneShot, Match, seatOf } from './match';
import { DEFAULT_MODE_ID, MODE_IDS, modeOf } from './modes';
import { SEAT_NAME } from './palette';
import {
  computeLayout,
  draw,
  type Layout,
  spawnBurst,
  stepParticles,
  stopAt,
  stopColor,
  stopX,
  stopY,
  type ViewState,
} from './render';
import { runCountdown } from './countdown';
import { aboutSheetHtml, helpSheetHtml, holdingsHtml, innMenuHtml, type ResultRow, resultsHtml, standingsHtml } from './ui';

const SLUG = 'amble';
const store = createStore(SLUG);
const sfx = createSfx(store.get<boolean>('muted', false) ?? false);
const reducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const app = document.getElementById('app')!;
let content: HTMLElement;

/* ── session state ────────────────────────────────────────────────────────── */

let net: Net | null = null;
let rounds: Rounds | null = null;
let match: Match | null = null;
let roomCode = '';
let hostOptsMode = DEFAULT_MODE_ID;
let myModeChoice = (store.get<string>('mode', DEFAULT_MODE_ID) ?? DEFAULT_MODE_ID) as string;
let soloBots = (store.get<number>('bots', 2) ?? 2) as number;
let soloStrength = (store.get<number>('strength', 1) ?? 1) as number; // 0 gentle,1 steady,2 fierce
let tally: number[] = [];
let roster: Array<{ id: PeerId; name: string }> = [];
let playerName = store.get<string>('name', '') || `Traveller ${Math.floor(Math.random() * 900 + 100)}`;
store.set('name', playerName);

let cleanups: Array<() => void> = [];
function onCleanup(fn: () => void): void {
  cleanups.push(fn);
}
function teardown(): void {
  for (const fn of cleanups.splice(0)) {
    try {
      fn();
    } catch {
      /* a failing teardown must never block the next screen */
    }
  }
}

/* ── shell ────────────────────────────────────────────────────────────────── */

function mountShell(): void {
  app.innerHTML = `
    <main class="main-content" id="content"></main>
    <footer class="site-footer">
      Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a>
      · <a href="https://hub.benrichardson.dev" target="_blank" rel="noopener">more games, tools &amp; sites</a>
    </footer>`;
  content = document.getElementById('content')!;
}

function setPlaying(on: boolean): void {
  document.body.classList.toggle('playing', on);
}

function sheet(html: string): void {
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = html;
  const close = (): void => {
    wrap.remove();
    document.removeEventListener('keydown', esc);
  };
  const esc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  document.addEventListener('keydown', esc);
  document.body.appendChild(wrap);
  wrap.querySelector<HTMLElement>('button')?.focus();
}

let audioUnlocked = false;
function unlockAudio(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    sfx.unlock();
  } catch {
    /* audio is a nicety */
  }
}

/* ── menu ─────────────────────────────────────────────────────────────────── */

function showMenu(): void {
  teardown();
  setPlaying(false);
  clearRoomInUrl();
  content.innerHTML = `
    <section class="screen">
      <h1 class="title">Amble</h1>
      <p class="tagline">An unhurried journey down one road — but the traveller furthest behind always
        goes next, so every stop you race to is a turn you hand your rivals.</p>
      <div class="menu-actions">
        <button class="btn primary" id="solo">Play solo</button>
        <button class="btn" id="friends">Play with friends</button>
        <div class="menu-row">
          <button class="btn ghost" id="help">How to play</button>
          <button class="btn ghost" id="about">About</button>
        </div>
        <button class="btn ghost" id="mute">${sfx.muted() ? '🔇 Sound off' : '🔊 Sound on'}</button>
      </div>
    </section>`;

  const on = (id: string, fn: () => void): void => {
    content.querySelector(`#${id}`)!.addEventListener('click', () => {
      unlockAudio();
      fn();
    });
  };
  on('solo', showSoloSetup);
  on('friends', showRoomEntry);
  on('help', () => sheet(helpSheetHtml()));
  on('about', () => sheet(aboutSheetHtml()));
  on('mute', () => {
    sfx.setMuted(!sfx.muted());
    store.set('muted', sfx.muted());
    showMenu();
  });

  if (!store.get<boolean>('seenHelp', false)) {
    store.set('seenHelp', true);
    sheet(helpSheetHtml());
  }
}

function modePicker(selected: string, onPick: (id: string) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'modes';
  for (const id of MODE_IDS) {
    const m = modeOf(id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn mode-btn';
    b.setAttribute('aria-pressed', String(id === selected));
    b.innerHTML = `<span class="mode-name">${m.name}</span><span class="mode-blurb">${m.blurb}</span>`;
    b.addEventListener('click', () => onPick(id));
    wrap.appendChild(b);
  }
  return wrap;
}

function pillRow(labels: string[], sel: number, onPick: (i: number) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'menu-row pills';
  labels.forEach((label, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn pill';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(i === sel));
    b.addEventListener('click', () => onPick(i));
    row.appendChild(b);
  });
  return row;
}

function showSoloSetup(): void {
  teardown();
  setPlaying(false);
  content.innerHTML = `
    <section class="screen">
      <h2 class="re-title">Play solo</h2>
      <p class="re-sub">Pick a road, how many fellow travellers, and how sharp they are.</p>
      <div id="modes"></div>
      <p class="setup-label">Travellers</p>
      <div id="bots"></div>
      <p class="setup-label">Skill</p>
      <div id="skill"></div>
      <div class="menu-actions">
        <button class="btn primary" id="go">Set off</button>
        <button class="btn ghost" id="back">Back</button>
      </div>
    </section>`;

  const modesEl = content.querySelector('#modes')!;
  const paintModes = (): void => {
    modesEl.innerHTML = '';
    modesEl.appendChild(
      modePicker(myModeChoice, (id) => {
        myModeChoice = id;
        store.set('mode', id);
        paintModes();
      }),
    );
  };
  paintModes();

  const botsEl = content.querySelector('#bots')!;
  const paintBots = (): void => {
    botsEl.innerHTML = '';
    botsEl.appendChild(
      pillRow(['1', '2', '3', '4'], soloBots - 1, (i) => {
        soloBots = i + 1;
        store.set('bots', soloBots);
        paintBots();
      }),
    );
  };
  paintBots();

  const skillEl = content.querySelector('#skill')!;
  const paintSkill = (): void => {
    skillEl.innerHTML = '';
    skillEl.appendChild(
      pillRow(['Gentle', 'Steady', 'Sharp'], soloStrength, (i) => {
        soloStrength = i;
        store.set('strength', i);
        paintSkill();
      }),
    );
  };
  paintSkill();

  content.querySelector('#go')!.addEventListener('click', () => startSolo());
  content.querySelector('#back')!.addEventListener('click', showMenu);
}

/* ── the game screen ──────────────────────────────────────────────────────── */

interface GameScreen {
  view: ViewState;
  repaint: () => void;
  animateMove: (seat: number, from: number, to: number, stopIdx: number) => void;
  destroy: () => void;
}

function buildGameScreen(
  m: Match,
  opts: { onQuit: () => void; roster: string[] },
): GameScreen {
  content.innerHTML = `
    <div class="game-wrap">
      <div class="hud">
        <div class="turn-chip" id="turn"></div>
        <span class="clock" id="clock"></span>
        <button class="hud-btn" id="help" aria-label="How to play">?</button>
        <button class="hud-btn" id="quit" aria-label="Leave the round">✕</button>
      </div>
      <div class="stage" id="stage"><canvas id="board"></canvas></div>
      <div class="under" id="under"></div>
    </div>`;

  const stage = content.querySelector<HTMLElement>('#stage')!;
  const canvas = content.querySelector<HTMLCanvasElement>('#board')!;
  const ctx = canvas.getContext('2d')!;
  const turnEl = content.querySelector<HTMLElement>('#turn')!;
  const clockEl = content.querySelector<HTMLElement>('#clock')!;
  const underEl = content.querySelector<HTMLElement>('#under')!;

  const view: ViewState = {
    game: m.state,
    seat: m.selfSeat,
    reachable: [],
    selected: null,
    scrollY: 0,
    anims: m.state.players.map(() => ({ from: 0, to: 0, t: 1 })),
    particles: [],
    motion: !reducedMotion,
    shake: 0,
  };

  let layout: Layout = computeLayout(m.state.road.stops.length, 320, 480);
  let lastMover = -2;
  let userScrolled = false;

  function relayout(): void {
    const rect = stage.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (!(w > 0) || !(h > 0)) return; // transient 0-size measure; retry next frame
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout = computeLayout(m.state.road.stops.length, w, h);
  }

  function refreshReachable(): void {
    view.reachable = m.myTurn ? [...new Set(legalActions(m.state).map((a) => a.to))] : [];
  }

  /** Centre the camera on the current mover unless the player has scrolled. */
  function follow(): void {
    const cur = m.toMove;
    if (cur !== lastMover) {
      lastMover = cur;
      userScrolled = false;
    }
    if (userScrolled || cur < 0) return;
    const target = stopY(layout, m.state.players[cur].pos) - layout.h * 0.42;
    view.scrollY = clampScroll(target);
  }

  function clampScroll(y: number): number {
    return Math.max(0, Math.min(layout.contentH - layout.h + layout.sp, y));
  }

  function repaint(): void {
    view.game = m.state;
    relayout();
    refreshReachable();
    follow();
    turnEl.innerHTML = turnLabel();
    const secs = Math.ceil(m.msLeft / 1000);
    clockEl.textContent = m.state.over || m.selfSeat === null ? '' : `${secs}s`;
    clockEl.classList.toggle('urgent', secs <= 8);
    underEl.innerHTML =
      (m.selfSeat !== null ? holdingsHtml(m.state, m.selfSeat) : '') +
      standingsHtml(m.state, m.selfSeat, opts.roster);
  }

  function turnLabel(): string {
    if (m.state.over) return 'Journey’s end';
    const cur = m.toMove;
    if (cur < 0) return '';
    const mine = cur === m.selfSeat;
    const name = opts.roster[cur] ?? SEAT_NAME[cur] ?? `P${cur + 1}`;
    return `<span class="seat-dot s${cur % 5}"></span> ${mine ? 'Your move — tap an open stop' : `${escapeHtml(name)}’s move…`}`;
  }

  /* input: drag to scroll, tap to travel */
  let down: { id: number; x: number; y: number; scroll: number; moved: boolean } | null = null;

  // No canvas.setPointerCapture here on purpose: on iOS Safari a captured touch
  // that is then cancelled (a system edge gesture, an accidental second finger)
  // can leave the canvas unable to receive ANY further pointer events for the rest
  // of the round — the reported "I tapped a spot and then couldn't move for the
  // rest of the game" (the host clock keeps auto-playing your turns meanwhile).
  // Tap-to-move needs no capture: the canvas fills the stage, so a press stays on
  // it, and each new pointerdown replaces any stale gesture below.
  const onDown = (e: PointerEvent): void => {
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, scroll: view.scrollY, moved: false };
  };
  const onMove = (e: PointerEvent): void => {
    if (!down || down.id !== e.pointerId) return;
    const dy = e.clientY - down.y;
    if (Math.abs(dy) > 8 || Math.abs(e.clientX - down.x) > 8) down.moved = true;
    if (down.moved) {
      userScrolled = true;
      view.scrollY = clampScroll(down.scroll - dy);
    }
  };
  const onUp = (e: PointerEvent): void => {
    if (!down || down.id !== e.pointerId) return;
    const wasTap = !down.moved;
    down = null;
    if (!wasTap) return;
    unlockAudio();
    if (!m.myTurn) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top + view.scrollY;
    const hit = stopAt(layout, view, cx, cy);
    if (hit === null) return;
    tapStop(hit);
  };
  const onCancel = (): void => {
    down = null;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  function tapStop(to: number): void {
    const opts2 = legalActions(m.state).filter((a) => a.to === to);
    if (opts2.length === 0) return;
    if (m.state.road.stops[to].kind === 'inn') {
      openInnMenu(to);
      return;
    }
    commitLocal(opts2[0]);
  }

  let innOverlay: HTMLElement | null = null;
  function openInnMenu(to: number): void {
    view.selected = to;
    const innIdx = m.state.road.stops[to].tag;
    const menu = m.state.road.menus[innIdx];
    const taken = m.state.innTaken[innIdx];
    const eaten = m.state.players[m.selfSeat ?? 0].meals;
    innOverlay?.remove();
    innOverlay = document.createElement('div');
    innOverlay.className = 'overlay inn-overlay';
    innOverlay.innerHTML = `<div class="sheet inn-sheet">${innMenuHtml(menu, taken, eaten)}<button class="btn ghost" data-cancel>Not yet</button></div>`;
    innOverlay.querySelectorAll<HTMLElement>('.dish:not([disabled])').forEach((b) =>
      b.addEventListener('click', () => {
        const slot = Number(b.dataset.slot);
        closeInn();
        commitLocal({ to, dish: slot });
      }),
    );
    innOverlay.querySelector('[data-cancel]')!.addEventListener('click', () => {
      closeInn();
      view.selected = null;
    });
    // The tap that opened this menu (on pointerup) is followed by a `click` at the
    // SAME point, which now lands on this freshly-inserted backdrop — so ignore
    // backdrop closes for a moment, or the menu would open and vanish in one tap.
    const openedAt = performance.now();
    innOverlay.addEventListener('click', (e) => {
      if (e.target === innOverlay && performance.now() - openedAt > 350) {
        closeInn();
        view.selected = null;
      }
    });
    document.body.appendChild(innOverlay);
    sfx.play('select');
  }
  function closeInn(): void {
    innOverlay?.remove();
    innOverlay = null;
  }

  function commitLocal(a: Action): void {
    const seat = m.toMove;
    const from = m.state.players[seat]?.pos ?? 0;
    if (!m.play(a)) {
      sfx.play('blip');
      return;
    }
    view.selected = null;
    animateMove(seat, from, a.to, a.to);
    repaint();
  }

  function animateMove(seat: number, from: number, to: number, stopIdx: number): void {
    if (seat < 0 || seat >= view.anims.length) return;
    view.anims[seat] = { from, to, t: view.motion ? 0 : 1 };
    const kind = m.state.road.stops[stopIdx].kind;
    sfx.play(kind === 'inn' ? 'powerup' : kind === 'spring' ? 'jump' : 'coin');
    const cxp = stopX(layout, to);
    const cyp = stopY(layout, to);
    spawnBurst(view.particles, cxp, cyp, stopColor(kind, m.state.road.stops[stopIdx].tag), 12);
    if (kind === 'inn' && view.motion) view.shake = 5;
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === '?' || e.key === 'h') sheet(helpSheetHtml());
  };
  document.addEventListener('keydown', onKey);
  const onResize = (): void => repaint();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  content.querySelector('#help')!.addEventListener('click', () => sheet(helpSheetHtml()));
  content.querySelector('#quit')!.addEventListener('click', opts.onQuit);

  // frames
  let raf = 0;
  let last = performance.now();
  const frame = (t: number): void => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    // Self-heal: any state change (a remote move, a host auto-move) advances the
    // Match to a NEW state object. Detect it here so the board can never freeze on
    // a missed repaint, whatever the source of the change.
    if (view.game !== m.state) repaint();
    for (const a of view.anims) if (a.t < 1) a.t = Math.min(1, a.t + dt * 3);
    if (view.particles.length) stepParticles(view.particles, dt);
    if (view.shake > 0) view.shake = Math.max(0, view.shake - dt * 22);
    // gentle camera glide toward the follow target
    draw(ctx, layout, view, t);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // host clock on an interval (rAF is throttled in a background tab)
  const CLOCK_MS = 500;
  const clockTimer = setInterval(() => {
    m.tick(CLOCK_MS);
    if (!m.state.over && m.selfSeat !== null) {
      const secs = Math.ceil(m.msLeft / 1000);
      clockEl.textContent = `${secs}s`;
      clockEl.classList.toggle('urgent', secs <= 8);
    }
  }, CLOCK_MS);

  relayout();
  repaint();

  return {
    view,
    repaint,
    animateMove,
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval(clockTimer);
      closeInn();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/* ── solo ─────────────────────────────────────────────────────────────────── */

function soloRoster(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? 'You' : SEAT_NAME[i] ?? `P${i + 1}`));
}

function startSolo(): void {
  teardown();
  setPlaying(true);
  const mode = modeOf(myModeChoice);
  const n = 1 + soloBots;
  const seed = Math.floor(Math.random() * 1e9);
  tally = Array(n).fill(0);

  const m = new Match({
    mode,
    n,
    selfSeat: 0,
    isHost: true,
    seed,
    deps: {
      send: () => {},
      onChange: () => {},
      onEnd: (g) => setTimeout(() => showResults(g, null, soloRoster(n)), 700),
    },
  });
  match = m;

  let screen: GameScreen;
  const botShot = createOneShot(560, () => {
    if (m.state.over) return;
    const seat = m.toMove;
    if (seat === 0 || seat < 0) return;
    const from = m.state.players[seat].pos;
    const rng = makeRng(`${seed}:bot:${m.state.ply}`);
    const policy = soloStrength === 0 && rng() < 0.5 ? 'random' : soloStrength === 1 && rng() < 0.15 ? 'random' : 'balanced';
    const a = chooseMove(m.state, policy, rng);
    if (m.receive(encodeForSelf(a), seat)) {
      screen.animateMove(seat, from, a.to, a.to);
      screen.repaint();
    }
  });

  const poll = setInterval(() => {
    if (m.state.over) return;
    if (m.toMove !== 0 && m.toMove >= 0) botShot.poke();
  }, 300);

  screen = buildGameScreen(m, {
    onQuit: () => {
      screen.destroy();
      showMenu();
    },
    roster: soloRoster(n),
  });
  onCleanup(() => {
    botShot.cancel();
    clearInterval(poll);
    screen.destroy();
  });

  runCountdown(document.body, sfx, () => {});
}

/** Encode an action so match.receive validates it exactly as a wire packet would. */
function encodeForSelf(a: Action): WireAction {
  return [a.to, a.dish];
}

/* ── multiplayer ──────────────────────────────────────────────────────────── */

function showRoomEntry(): void {
  teardown();
  setPlaying(false);
  content.innerHTML = '<section class="screen" id="entry"></section>';
  const host = content.querySelector<HTMLElement>('#entry')!;

  const deep = new URL(location.href).searchParams.get('room');
  if (deep) {
    const code = normalizeRoomCode(deep);
    clearRoomInUrl();
    if (code.length >= 3) {
      void enterRoom(code, false);
      return;
    }
  }

  createRoomEntry({
    container: host,
    onSubmit: (code, created) => void enterRoom(normalizeRoomCode(code), created),
    onCancel: showMenu,
    title: 'Play with friends',
    subtitle: 'Start a room and share the code, or type the code a friend sent you.',
  });
}

async function enterRoom(code: string, created: boolean): Promise<void> {
  teardown();
  setPlaying(false);
  roomCode = code;
  setRoomInUrl(code);
  tally = [];

  content.innerHTML = `<section class="screen"><div class="lobby-searching"><span class="spinner"></span> Connecting…</div></section>`;

  try {
    setTurnConfig(await getTurnConfig());
  } catch {
    /* fail open — TURN is an upgrade, never a dependency */
  }

  const n = createNet(
    { appId: roomAppId(SLUG), roomId: code, claimHost: created },
    {
      onHostChange: (_id, isSelfHost) => {
        match?.setHost(isSelfHost);
        repaintLobbyIfPresent();
      },
      onPeers: () => repaintLobbyIfPresent(),
      onPeerLeave: (id) => {
        const seat = seatOf(roster, id);
        if (seat !== null) match?.peerLeft(seat);
        repaintLobbyIfPresent();
      },
      onPeerJoin: (id) => {
        const seat = seatOf(roster, id);
        if (seat !== null) match?.peerReturned(seat);
      },
    },
  );
  net = n;

  const r = createRounds({
    net: n,
    playerName,
    minPlayers: 2,
    roundOpts: () => ({ mode: myModeChoice }),
    onRound: (info) => startNetRound(info),
    onChange: (s) => {
      const ho = s.hostOpts as { mode?: string } | null;
      if (ho && typeof ho.mode === 'string') hostOptsMode = modeOf(ho.mode).id;
      repaintLobbyIfPresent();
    },
  });
  rounds = r;

  const sendMove = n.channel<WireAction>('mv', (data, from) => {
    if (!match) return;
    const seat = seatOf(roster, from);
    if (seat === null) return;
    const fromPos = match.state.players[seat]?.pos ?? 0;
    if (match.receive(data, seat)) {
      const a = decodeAction(data);
      if (a) currentScreen?.animateMove(seat, fromPos, a.to, a.to);
      currentScreen?.repaint();
    }
  });
  netSend = (w) => sendMove(w);

  // These live for the WHOLE room session and are torn down ONLY on leaveRoom.
  // They must NOT go through the per-screen teardown() — that runs on the first
  // round start (startNetRound calls teardown), which would destroy the rounds
  // and the move channel the instant a round begins.
  mvOff = () => sendMove.off();

  showLobby();
}

let netSend: (w: WireAction) => void = () => {};
let mvOff: () => void = () => {};
let currentScreen: GameScreen | null = null;
let lobbyMounted = false;
let lobby: { repaint(): void; destroy(): void } | null = null;

/**
 * A net event must NOT rebuild the lobby — the engine guards qrOpen and the
 * "host this room" clock across its OWN repaints (keyed by the container), and
 * wiping the container to recreate the lobby defeats that guard, yanking the QR
 * off screen mid-scan. So repaint in place.
 */
function repaintLobbyIfPresent(): void {
  if (lobbyMounted) lobby?.repaint();
}

function showLobby(): void {
  const n = net;
  const r = rounds;
  if (!n || !r) return;
  lobbyMounted = true;
  setPlaying(false);

  content.innerHTML = `<section class="screen"><div id="lobby-host"></div></section>`;

  const isHost = (): boolean => n.isHost() && n.hostSettled();

  lobby = createLobby({
    container: content.querySelector<HTMLElement>('#lobby-host')!,
    net: n,
    rounds: r,
    roomCode,
    minPlayers: 2,
    maxPlayers: 5,
    onCancel: () => void leaveRoom(),
    modeSlot: () => {
      if (isHost()) {
        return `<div class="lobby-modes" id="lm">${MODE_IDS.map(
          (id) =>
            `<button class="btn mode-btn" data-mode="${id}" aria-pressed="${id === myModeChoice}"><span class="mode-name">${modeOf(id).name}</span><span class="mode-blurb">${modeOf(id).blurb}</span></button>`,
        ).join('')}</div>`;
      }
      return `<p class="host-pick">${n.hostSettled() ? `The host has chosen <strong>${modeOf(hostOptsMode).name}</strong>.` : 'Waiting for the host…'}</p>`;
    },
    onModeMount: () => {
      if (!isHost()) return;
      content.querySelectorAll<HTMLElement>('#lm .mode-btn').forEach((b) =>
        b.addEventListener('click', () => {
          myModeChoice = b.dataset.mode!;
          store.set('mode', myModeChoice);
          lobby?.repaint(); // repaint in place — never rebuild
        }),
      );
    },
  });
  onCleanup(() => {
    lobby?.destroy();
    lobby = null;
  });
}

function startNetRound(info: RoundInfo): void {
  teardown();
  lobbyMounted = false;
  roster = info.players;
  if (tally.length !== roster.length) tally = Array(roster.length).fill(0);
  const opts = info.opts as { mode?: string } | null;
  const mode = modeOf(opts?.mode);
  const selfSeat = info.seated ? seatOf(roster, net?.selfId ?? '') : null;
  const names = roster.map((p) => p.name);

  const m = new Match({
    mode,
    n: roster.length,
    selfSeat,
    isHost: info.isHost,
    seed: info.seed,
    deps: {
      send: (w) => netSend(w),
      onChange: () => {},
      onEnd: (g) => {
        if (g.winner !== null && g.winner < tally.length) tally[g.winner]++;
        setTimeout(() => showResults(g, roster, names), 700);
      },
    },
  });
  match = m;
  setPlaying(true);

  const screen = buildGameScreen(m, {
    onQuit: () => backToLobby(),
    roster: names,
  });
  currentScreen = screen;
  onCleanup(() => {
    currentScreen = null;
    screen.destroy();
  });

  const cd = runCountdown(document.body, sfx, () => {});
  onCleanup(() => cd.cancel());
}

/* ── results ──────────────────────────────────────────────────────────────── */

function showResults(
  game: GameState,
  players: Array<{ id: PeerId; name: string }> | null,
  names: string[],
): void {
  teardown();
  setPlaying(false);
  const selfId = net?.selfId ?? '';
  const rows: ResultRow[] = names.map((name, i) => ({
    seat: i,
    name,
    isSelf: players ? players[i]?.id === selfId : i === 0,
  }));

  const iWon = game.winner !== null && rows.find((r) => r.isSelf)?.seat === game.winner;
  sfx.play(game.winner === null ? 'blip' : iWon ? 'win' : 'lose');

  content.innerHTML = `
    <section class="screen">
      ${resultsHtml(game, rows, tally)}
      <p class="waiting-note" id="waiting"></p>
      <div class="menu-actions">
        <button class="btn primary" id="again">Play again</button>
        <button class="btn ghost" id="lobby"${players ? '' : ' hidden'}>Back to lobby</button>
        <button class="btn ghost" id="menu">Main menu</button>
        <button class="btn ghost" id="feedback">Report a problem</button>
      </div>
    </section>`;

  content.querySelector('#feedback')!.addEventListener('click', (e) =>
    window.feedback?.open({ returnFocusTo: e.currentTarget as HTMLElement }),
  );
  content.querySelector('#menu')!.addEventListener('click', () => void leaveRoom());

  if (!players) {
    content.querySelector('#again')!.addEventListener('click', () => startSolo());
    return;
  }

  const r = rounds;
  const waiting = content.querySelector<HTMLElement>('#waiting')!;
  const again = content.querySelector<HTMLButtonElement>('#again')!;
  content.querySelector('#lobby')!.addEventListener('click', () => backToLobby());
  again.addEventListener('click', () => {
    r?.vote();
    again.disabled = true;
    again.textContent = 'Waiting for the others…';
  });

  const paint = (): void => {
    if (!r) return;
    const s = r.state();
    const nv = s.votes.length;
    const total = Math.max(s.present.length, 1);
    if (s.startsInMs !== null) {
      waiting.textContent = `Setting off in ${Math.ceil(s.startsInMs / 1000)}s — ${nv}/${total} ready`;
    } else if (nv > 0) {
      waiting.textContent = `${nv} of ${total} ready for another road`;
    } else {
      waiting.textContent = '';
    }
  };
  paint();
  const t = setInterval(paint, 400);
  onCleanup(() => clearInterval(t));
}

function backToLobby(): void {
  teardown();
  match = null;
  if (net && rounds) showLobby();
  else showMenu();
}

async function leaveRoom(): Promise<void> {
  teardown();
  lobbyMounted = false;
  match = null;
  const n = net;
  const r = rounds;
  net = null;
  rounds = null;
  netSend = () => {};
  // Room-level teardown happens HERE, not in the per-screen teardown().
  try {
    mvOff();
  } catch {
    /* channel may already be gone */
  }
  mvOff = () => {};
  r?.destroy();
  if (n) {
    try {
      await n.leave();
    } catch {
      /* leaving is best-effort; the menu must appear regardless */
    }
  }
  showMenu();
}

/* ── boot ─────────────────────────────────────────────────────────────────── */

function boot(): void {
  hardenViewport();
  mountShell();
  // An invite link (?room=CODE) should land the friend in the join flow, not the
  // cold menu. showRoomEntry consumes the deep link once and enters the room.
  const room = new URL(location.href).searchParams.get('room');
  if (room && normalizeRoomCode(room).length >= 3) showRoomEntry();
  else showMenu();
  if (new URL(location.href).searchParams.get('netdebug') === '1') mountNetDebug();
  window.addEventListener('beforeunload', () => {
    void net?.leave();
  });
}

function mountNetDebug(): void {
  const el = document.createElement('div');
  el.className = 'netdebug';
  document.body.appendChild(el);
  setInterval(() => {
    if (!net) {
      el.textContent = 'no room';
      return;
    }
    const d = net.netDiag();
    el.textContent = [
      `self ${d.selfId.slice(0, 6)}`,
      `host ${d.host ? d.host.slice(0, 6) : '—'} e${d.epoch} ${d.settled ? 'settled' : 'unsettled'}`,
      `peers ${d.peers.length} turn ${d.turn ? 'yes' : 'NO'}`,
      `seat ${match?.selfSeat ?? '—'} ply ${match?.state.ply ?? '—'} mover ${match ? mover(match.state) : '—'}`,
    ].join('\n');
  }, 500);
}

boot();
