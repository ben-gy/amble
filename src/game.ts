// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
// Amble — the pure game model: road, turn order, legality, scoring.

/**
 * game.ts — the whole rules engine, pure and deterministic.
 *
 * The road is a one-way line of typed stops built from the shared seed. On a turn
 * the mover advances FORWARD to any open stop (or the next inn / the end), takes
 * its little reward, and then the turn passes to whoever is now furthest behind.
 * Stops are single-occupancy AND consumed on landing, so a stop you skip is left
 * for the traveller behind you, and a stop you take is gone for good — that is the
 * whole competition.
 *
 * There is no randomness in play and no hidden information: the board, every stop
 * and every inn menu are pure functions of the seed. So a move is fully described
 * by `[to, dish]` and every peer re-simulates it here — LOCKSTEP. No board state
 * ever crosses the wire, an illegal packet is rejected rather than absorbed, and a
 * promoted host inherits a byte-identical board (see match.ts / takeover.test.ts).
 */

import { makeRng, type Rng, shuffle } from '@ben-gy/game-engine/rng';
import { type Mode, roadLength } from './modes';

/* ── tunable constants (the balance sim referees these) ───────────────────── */

export const VIEWS = 3; // Sea / Hills / Dusk panoramas
export const SOUV_KINDS = 3; // souvenir kinds
export const SPRING_PTS = 2; // points per spring soaked
export const SPRING_BONUS = 6; // shared among the travellers tied for most springs
export const FINE_BONUS = 6; // shared among those tied for the deepest single view
export const DISH_KINDS = 5; // cuisines; a kind scores at most once per journey
/**
 * Score for owning N DISTINCT souvenir kinds (index = distinct count). Volume of a
 * kind you already own is worth nothing — variety, not hoarding, and a hard cap so
 * a traveller who takes every market does not out-score one who took three.
 */
export const SETVAL = [0, 1, 3, 6] as const;
/**
 * Flat points for your first springs (index = spring count, capped). A trailing
 * traveller who soaks in ten springs banks no more than one who soaked in three —
 * the rest of a spring's worth is the majority race.
 */
export const SPRING_FLAT = [0, 2, 3, 4] as const;
/**
 * A view scores triangularly with depth, but capped — an unbounded per-view sum is
 * exactly what let a traveller who harvested every vista win on volume. A cap this
 * low is reachable by a focused leaper in a handful of well-routed stops, so the
 * dawdler's extra turns hit a wall.
 */
export const DEPTH_CAP = 4;
/**
 * Inn menu values by slot. A steep first-come gradient is the anti-ambler reward:
 * the traveller who rushed ahead eats the 8, the one who dawdled up last eats the 1.
 */
export const DISH_VALUES = [8, 5, 3, 1, 1] as const;
export const MAX_PLAYERS = 5;

/** The n-th triangular number — a view painted n sections deep is worth this. */
export function tri(n: number): number {
  return (n * (n + 1)) / 2;
}

/** How many distinct souvenir kinds a multiset holds. */
export function distinctKinds(counts: readonly number[]): number {
  let d = 0;
  for (const x of counts) if (x > 0) d++;
  return d;
}

/** Souvenir score — distinct kinds only, so variety pays and volume does not. */
export function souvenirScore(counts: readonly number[]): number {
  return SETVAL[Math.min(distinctKinds(counts), SETVAL.length - 1)];
}

/** Flat spring points, diminishing to a cap (the rest is the majority race). */
export function springFlat(springs: number): number {
  return SPRING_FLAT[Math.min(springs, SPRING_FLAT.length - 1)];
}

/* ── road ─────────────────────────────────────────────────────────────────── */

export type StopKind = 'start' | 'vista' | 'market' | 'spring' | 'inn' | 'end';

export interface Stop {
  kind: StopKind;
  /** vista → view (0..VIEWS-1); market → souvenir kind; inn → inn index; else 0. */
  tag: number;
}

export interface Dish {
  kind: number; // 0..DISH_KINDS-1
  value: number;
}

export interface Road {
  stops: Stop[];
  /** Positions of the inns, ascending. */
  innAt: number[];
  /** Menu per inn index. */
  menus: Dish[][];
}

/**
 * Build the road for a mode from an rng. Consumes the rng in a FIXED order so
 * every peer generating from the same seed gets a byte-identical road.
 */
export function buildRoad(mode: Mode, rng: Rng, n: number): Road {
  const L = roadLength(mode, n);
  const stops: Stop[] = Array.from({ length: L }, () => ({ kind: 'spring', tag: 0 }));
  stops[0] = { kind: 'start', tag: 0 };
  stops[L - 1] = { kind: 'end', tag: 0 };

  // Inns: evenly spaced interior positions, never adjacent to each other or the ends.
  const innAt: number[] = [];
  for (let k = 1; k <= mode.inns; k++) {
    let p = Math.round((k * L) / (mode.inns + 1));
    p = Math.max(2, Math.min(L - 3, p));
    while (innAt.includes(p) || innAt.includes(p - 1) || innAt.includes(p + 1)) p++;
    innAt.push(p);
  }
  innAt.sort((a, b) => a - b);
  innAt.forEach((p, i) => (stops[p] = { kind: 'inn', tag: i }));

  // Normal (open-road) positions get vista/market/spring by the mode's mix.
  const normal: number[] = [];
  for (let i = 1; i < L - 1; i++) if (stops[i].kind !== 'inn') normal.push(i);

  const { vista: wv, market: wm, spring: ws } = mode.mix;
  const wsum = wv + wm + ws;
  const total = normal.length;
  const nVista = Math.round((total * wv) / wsum);
  const nMarket = Math.round((total * wm) / wsum);
  const nSpring = total - nVista - nMarket;

  const bag: StopKind[] = [
    ...Array(nVista).fill('vista'),
    ...Array(nMarket).fill('market'),
    ...Array(Math.max(0, nSpring)).fill('spring'),
  ];
  const kinds = shuffle(rng, bag);

  // View assignment: clustered modes paint views in learnable runs; Wayward
  // scatters them so no panorama chains on autopilot.
  let runView = Math.floor(rng() * VIEWS);
  let runLeft = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < normal.length; i++) {
    const pos = normal[i];
    const kind = kinds[i] ?? 'spring';
    if (kind === 'vista') {
      let view: number;
      if (mode.clusteredViews) {
        view = runView;
        if (--runLeft <= 0) {
          runView = (runView + 1) % VIEWS;
          runLeft = 2 + Math.floor(rng() * 2);
        }
      } else {
        view = Math.floor(rng() * VIEWS);
      }
      stops[pos] = { kind: 'vista', tag: view };
    } else if (kind === 'market') {
      stops[pos] = { kind: 'market', tag: Math.floor(rng() * SOUV_KINDS) };
    } else {
      stops[pos] = { kind: 'spring', tag: 0 };
    }
  }

  // Inn menus: distinct cuisines shuffled onto the descending value slots, so the
  // top-value dish is a different kind at each inn and eating breadth matters.
  const menus: Dish[][] = innAt.map(() => {
    const cuisines = shuffle(
      rng,
      Array.from({ length: DISH_KINDS }, (_, i) => i),
    );
    return DISH_VALUES.map((value, slot) => ({ kind: cuisines[slot], value }));
  });

  return { stops, innAt, menus };
}

/* ── state ────────────────────────────────────────────────────────────────── */

export interface PlayerState {
  pos: number;
  /** Arrival clock at the current stop; lower = further back in a shared stack. */
  arrived: number;
  finished: boolean;
  vista: number[]; // depth per view
  souv: number[]; // count per souvenir kind
  springs: number;
  meals: number[]; // best value eaten per dish kind (0 = not eaten)
  landings: number; // total stops landed (incl. inns) — for tie-breaks
  claims: number; // open-road stops claimed — capped at the budget
}

export interface GameState {
  mode: Mode;
  seed: number;
  n: number;
  /** Open-road stops each traveller may claim (the turn budget). */
  budget: number;
  road: Road;
  /** Which menu slots have been taken, per inn. */
  innTaken: boolean[][];
  /** Which stops have been landed on (consumed), per position. */
  taken: boolean[];
  players: PlayerState[];
  clock: number;
  ply: number;
  over: boolean;
  winner: number | null;
  ranking: number[];
  reason: 'complete' | 'unterminated' | null;
}

export interface Action {
  to: number;
  /** Inn menu slot chosen, or -1 for a non-inn stop. */
  dish: number;
}

export type WireAction = number[];

export function createGame(mode: Mode, seed: number, n: number): GameState {
  const players = Math.max(1, Math.min(MAX_PLAYERS, n));
  const rng = makeRng(seed);
  const road = buildRoad(mode, rng, players);

  // Randomise the start stack from the seed so seat 0 is not always first to move.
  const order = shuffle(
    rng,
    Array.from({ length: players }, (_, i) => i),
  );

  const ps: PlayerState[] = Array.from({ length: players }, (_, seat) => ({
    pos: 0,
    arrived: order.indexOf(seat), // 0 = bottom of the start stack = moves first
    finished: false,
    vista: Array(VIEWS).fill(0),
    souv: Array(SOUV_KINDS).fill(0),
    springs: 0,
    meals: Array(DISH_KINDS).fill(0),
    landings: 0,
    claims: 0,
  }));

  return {
    mode,
    seed,
    n: players,
    budget: mode.claims,
    road,
    innTaken: road.menus.map((m) => m.map(() => false)),
    taken: road.stops.map(() => false),
    players: ps,
    clock: players - 1,
    ply: 0,
    over: false,
    winner: null,
    ranking: [],
    reason: null,
  };
}

/* ── turn order ───────────────────────────────────────────────────────────── */

/** The next inn or the end, strictly ahead of `pos`. Always exists (the end). */
export function barrierAfter(state: GameState, pos: number): number {
  for (let i = pos + 1; i < state.road.stops.length; i++) {
    const k = state.road.stops[i].kind;
    if (k === 'inn' || k === 'end') return i;
  }
  return state.road.stops.length - 1;
}

/** Whose turn it is: the furthest-behind traveller not yet finished, or -1. */
export function mover(state: GameState): number {
  let best = -1;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p.finished) continue;
    if (best < 0) {
      best = i;
      continue;
    }
    const b = state.players[best];
    if (p.pos < b.pos || (p.pos === b.pos && p.arrived < b.arrived)) best = i;
  }
  return best;
}

/** Every legal move for the current mover. Never empty while the game is live. */
export function legalActions(state: GameState): Action[] {
  const m = mover(state);
  if (m < 0) return [];
  const from = state.players[m].pos;
  const barrier = barrierAfter(state, from);
  const out: Action[] = [];
  // Once a traveller has spent their claim budget, they may no longer stop at
  // open-road stops — only walk on to the next inn or the end. This is what
  // conserves turns and keeps ambling from winning on volume.
  const spent = state.players[m].claims >= state.budget;
  if (!spent) {
    for (let q = from + 1; q < barrier; q++) {
      const s = state.road.stops[q];
      if ((s.kind === 'vista' || s.kind === 'market' || s.kind === 'spring') && !state.taken[q]) {
        out.push({ to: q, dish: -1 });
      }
    }
  }
  const bStop = state.road.stops[barrier];
  if (bStop.kind === 'end') {
    out.push({ to: barrier, dish: -1 });
  } else {
    // inn: one move per still-available dish slot (first-come menu)
    const innIdx = bStop.tag;
    state.innTaken[innIdx].forEach((taken, slot) => {
      if (!taken) out.push({ to: barrier, dish: slot });
    });
  }
  return out;
}

export function isLegal(state: GameState, a: Action | null): boolean {
  if (!a) return false;
  for (const m of legalActions(state)) if (m.to === a.to && m.dish === a.dish) return true;
  return false;
}

/* ── applying a move ──────────────────────────────────────────────────────── */

function clonePlayer(p: PlayerState): PlayerState {
  return {
    pos: p.pos,
    arrived: p.arrived,
    finished: p.finished,
    vista: [...p.vista],
    souv: [...p.souv],
    springs: p.springs,
    meals: [...p.meals],
    landings: p.landings,
    claims: p.claims,
  };
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    innTaken: state.innTaken.map((r) => [...r]),
    taken: [...state.taken],
    players: state.players.map(clonePlayer),
    ranking: [...state.ranking],
  };
}

/** Apply a validated legal action for the current mover, returning a new state. */
export function applyAction(state: GameState, a: Action): GameState {
  if (state.over || !isLegal(state, a)) return state;
  const next = cloneState(state);
  const m = mover(next);
  const p = next.players[m];
  const stop = next.road.stops[a.to];

  if (stop.kind === 'vista') {
    p.vista[stop.tag]++;
    p.claims++;
    next.taken[a.to] = true;
  } else if (stop.kind === 'market') {
    p.souv[stop.tag]++;
    p.claims++;
    next.taken[a.to] = true;
  } else if (stop.kind === 'spring') {
    p.springs++;
    p.claims++;
    next.taken[a.to] = true;
  } else if (stop.kind === 'inn') {
    const dish = next.road.menus[stop.tag][a.dish];
    next.innTaken[stop.tag][a.dish] = true;
    p.meals[dish.kind] = Math.max(p.meals[dish.kind], dish.value);
  } else if (stop.kind === 'end') {
    p.finished = true;
  }

  p.pos = a.to;
  next.clock++;
  p.arrived = next.clock;
  p.landings++;
  next.ply++;

  if (next.players.every((q) => q.finished)) finalize(next);
  return next;
}

/**
 * Force a traveller to the end without collecting — how the host retires a peer
 * that vanished, so the round can still terminate and everyone reach the results.
 */
export function abandon(state: GameState, seat: number): GameState {
  if (state.over || seat < 0 || seat >= state.players.length) return state;
  const p = state.players[seat];
  if (p.finished) return state;
  const next = cloneState(state);
  const q = next.players[seat];
  q.finished = true;
  q.pos = next.road.stops.length - 1;
  next.clock++;
  q.arrived = next.clock;
  if (next.players.every((r) => r.finished)) finalize(next);
  return next;
}

/* ── scoring ──────────────────────────────────────────────────────────────── */

export interface Breakdown {
  vista: number;
  souv: number;
  spring: number;
  meal: number;
  fineBonus: number;
  springBonus: number;
  total: number;
  /** Deepest single view — the finest-view contest value. */
  finest: number;
  distinctSouv: number;
  distinctDish: number;
}

/**
 * Score every player as if the road ended now. Pure — used both to finalise and
 * to show live standings. Majorities are computed across all players here.
 */
export function scoreAll(state: GameState): Breakdown[] {
  const ps = state.players;

  const finestOf = (p: PlayerState): number => Math.max(0, ...p.vista);
  const bestFinest = Math.max(0, ...ps.map(finestOf));
  const finestLeaders = ps.filter((p) => finestOf(p) === bestFinest && bestFinest > 0).length;

  const bestSprings = Math.max(0, ...ps.map((p) => p.springs));
  const springLeaders = ps.filter((p) => p.springs === bestSprings && bestSprings > 0).length;

  return ps.map((p) => {
    // Only your DEEPEST view scores triangularly — commit to one panorama; a
    // shallow tile in a second view is worth nothing, so taking every vista does
    // not out-score routing to one. (This is the change the balance sim demanded:
    // an unbounded per-view sum let the ambler win 100% on volume.)
    const finest = finestOf(p);
    const vista = tri(Math.min(finest, DEPTH_CAP));
    const souv = souvenirScore(p.souv);
    const spring = springFlat(p.springs);
    const meal = p.meals.reduce((s, v) => s + v, 0);
    const fineBonus =
      finest === bestFinest && bestFinest > 0 ? Math.floor(FINE_BONUS / finestLeaders) : 0;
    const springBonus =
      p.springs === bestSprings && bestSprings > 0
        ? Math.floor(SPRING_BONUS / springLeaders)
        : 0;
    return {
      vista,
      souv,
      spring,
      meal,
      fineBonus,
      springBonus,
      total: vista + souv + spring + meal + fineBonus + springBonus,
      finest,
      distinctSouv: p.souv.filter((c) => c > 0).length,
      distinctDish: p.meals.filter((v) => v > 0).length,
    };
  });
}

/** Rank comparison: score, then a chain of tie-breakers, so draws are rare. */
function rankKeys(state: GameState, bd: Breakdown[], i: number): number[] {
  const p = state.players[i];
  return [
    bd[i].total,
    bd[i].meal,
    p.springs,
    bd[i].distinctSouv,
    p.landings,
    -p.arrived, // finished earlier ranks higher
  ];
}

function finalize(state: GameState): void {
  const bd = scoreAll(state);
  const idx = state.players.map((_, i) => i);
  const cmp = (a: number, b: number): number => {
    const ka = rankKeys(state, bd, a);
    const kb = rankKeys(state, bd, b);
    for (let j = 0; j < ka.length; j++) if (ka[j] !== kb[j]) return kb[j] - ka[j];
    return 0;
  };
  idx.sort(cmp);
  state.ranking = idx;
  state.over = true;
  state.reason = 'complete';
  state.winner = idx.length >= 2 && cmp(idx[0], idx[1]) === 0 ? null : idx[0];
}

/* ── wire encoding ────────────────────────────────────────────────────────── */

export function encodeAction(a: Action): WireAction {
  return [a.to, a.dish];
}

export function decodeAction(w: unknown): Action | null {
  if (!Array.isArray(w) || w.length !== 2) return null;
  const [to, dish] = w;
  if (typeof to !== 'number' || typeof dish !== 'number') return null;
  if (!Number.isInteger(to) || !Number.isInteger(dish)) return null;
  return { to, dish };
}
