// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
// Amble — one round, plus everything the network needs from it.

/**
 * match.ts — a single journey down the road, decoupled from Trystero, the DOM and
 * the clock source. It takes a `send` function and is driven by `tick(dt)`, which
 * is what makes the host-transfer contract testable without a network
 * (tests/takeover.test.ts) — rhythm-relay shipped broken precisely because its
 * session had no such seam and its onHostChange was never wired.
 *
 * Amble is LOCKSTEP: no randomness in play, no hidden info, so a move is just
 * `[to, dish]` and every peer re-simulates it. No board state crosses the wire,
 * there is nothing to desync, and a promoted host inherits a byte-identical board.
 * All the host owns is the CLOCK: the per-move timer, and auto-playing the turns
 * of a seat that has gone silent so the round can always still finish.
 */

import { makeRng } from '@ben-gy/game-engine/rng';
import {
  abandon,
  type Action,
  applyAction,
  createGame,
  decodeAction,
  encodeAction,
  type GameState,
  isLegal,
  legalActions,
  MAX_PLAYERS,
  mover,
  scoreAll,
  type WireAction,
} from './game';
import { chooseMove } from './ai';
import { type Mode } from './modes';

/** How long a present player has to move before the host plays a sensible move. */
export const TURN_MS = 30_000;
/** How fast the host auto-plays the turns of a seat that has left. */
export const AUTO_FAST_MS = 300;

export interface MatchDeps {
  send: (w: WireAction) => void;
  onChange: (g: GameState, last: Action | null) => void;
  onEnd: (g: GameState) => void;
}

export interface MatchOpts {
  mode: Mode;
  n: number;
  selfSeat: number | null;
  isHost: boolean;
  seed: number;
  deps: MatchDeps;
}

export class Match {
  state: GameState;
  readonly selfSeat: number | null;
  readonly n: number;
  private host: boolean;
  private readonly seed: number;
  private readonly deps: MatchDeps;
  private turnLeft = TURN_MS;
  private autoLeft = AUTO_FAST_MS;
  private absent = new Set<number>();
  private ended = false;

  constructor(o: MatchOpts) {
    this.state = createGame(o.mode, o.seed, o.n);
    this.selfSeat = o.selfSeat;
    this.n = o.n;
    this.host = o.isHost;
    this.seed = o.seed;
    this.deps = o.deps;
  }

  get isHost(): boolean {
    return this.host;
  }

  get toMove(): number {
    return mover(this.state);
  }

  get myTurn(): boolean {
    return !this.state.over && this.selfSeat !== null && this.toMove === this.selfSeat;
  }

  get msLeft(): number {
    return Math.max(0, this.turnLeft);
  }

  /** Play a local action, then tell the other peers. */
  play(a: Action): boolean {
    if (!this.myTurn || !isLegal(this.state, a)) return false;
    this.commit(a);
    this.deps.send(encodeAction(a));
    return true;
  }

  /** Apply an action that arrived over the wire — fully validated, never trusted. */
  receive(w: unknown, fromSeat: number): boolean {
    if (this.state.over) return false;
    if (this.toMove !== fromSeat) return false;
    const a = decodeAction(w);
    if (!a || !isLegal(this.state, a)) return false;
    this.commit(a);
    return true;
  }

  private commit(a: Action): void {
    this.state = applyAction(this.state, a);
    this.turnLeft = TURN_MS;
    this.autoLeft = AUTO_FAST_MS;
    this.deps.onChange(this.state, a);
    if (this.state.over) this.finish();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.deps.onEnd(this.state);
  }

  /** Promotion needs no board takeover — just the clock and the absent-seat duty. */
  setHost(isHost: boolean): void {
    const gained = isHost && !this.host;
    this.host = isHost;
    if (gained) {
      this.turnLeft = Math.max(this.turnLeft, TURN_MS / 2);
      this.autoLeft = AUTO_FAST_MS;
    }
  }

  peerLeft(seat: number): void {
    if (seat < 0 || seat === this.selfSeat) return;
    this.absent.add(seat);
  }

  peerReturned(seat: number): void {
    this.absent.delete(seat);
  }

  get someoneAbsent(): boolean {
    return this.absent.size > 0;
  }

  /**
   * Drive the clock. Interval-driven, never rAF alone — a backgrounded tab stops
   * firing rAF, which would freeze the authoritative clock when the host tabs
   * away. A present player's clock runs at TURN_MS; a seat that has left is
   * auto-played fast so the survivor is never stranded.
   */
  tick(dtMs: number): void {
    if (this.state.over || !this.host) return;
    const m = this.toMove;
    if (m < 0) return;

    if (this.absent.has(m)) {
      this.autoLeft -= dtMs;
      if (this.autoLeft <= 0) this.autoPlay();
      return;
    }
    this.turnLeft -= dtMs;
    if (this.turnLeft <= 0) this.autoPlay();
  }

  private autoPlay(): void {
    const a = this.autoMove();
    this.commit(a);
    this.deps.send(encodeAction(a));
  }

  /** A deterministic, decent move — identical on every peer that computes it. */
  autoMove(): Action {
    const moves = legalActions(this.state);
    if (moves.length === 0) {
      // Nobody can move (should not happen) — retire the stuck seat so the round
      // can still end rather than spin.
      const m = this.toMove;
      if (m >= 0) this.state = abandon(this.state, m);
      return { to: this.state.players[this.toMove]?.pos ?? 0, dish: -1 };
    }
    return chooseMove(this.state, 'balanced', makeRng(`${this.seed}:auto:${this.state.ply}`));
  }

  /** Live standings for the HUD, best-first is left to the caller. */
  standings(): ReturnType<typeof scoreAll> {
    return scoreAll(this.state);
  }
}

/** Seat index from the frozen roster, or null for a spectator / unknown peer. */
export function seatOf(roster: Array<{ id: string }>, peerId: string): number | null {
  const i = roster.findIndex((p) => p.id === peerId);
  if (i < 0 || i >= MAX_PLAYERS) return null;
  return i;
}

/**
 * A one-shot timer that is safe to poke repeatedly — re-arming on every poll tick
 * (clearTimeout + setTimeout) starves the timer and the bot never moves, a real
 * shipped-in-development hang. Poking while pending is a no-op, which is the point.
 */
export function createOneShot(delayMs: number, run: () => void) {
  let pending = false;
  let id: ReturnType<typeof setTimeout> | null = null;
  return {
    poke(): void {
      if (pending) return;
      pending = true;
      id = setTimeout(() => {
        pending = false;
        id = null;
        run();
      }, delayMs);
    },
    cancel(): void {
      if (id !== null) clearTimeout(id);
      id = null;
      pending = false;
    },
    get isPending(): boolean {
      return pending;
    },
  };
}
