/**
 * takeover.test.ts — the host-transfer contract (multiplayer gate #2), the check
 * that would have caught rhythm-relay (which shipped with no onHostChange wiring
 * at all). Amble is lockstep, so a promoted peer's BOARD needs no takeover — it
 * has re-simulated every move. What it must inherit is the CLOCK and the duty of
 * auto-playing seats that have gone silent, and the thing to prove is that after
 * promotion the round can still REACH GAME OVER — a frozen board is the failure.
 */

import { describe, expect, it, vi } from 'vitest';
import { AUTO_FAST_MS, Match, seatOf, TURN_MS } from '../src/match';
import type { GameState } from '../src/game';
import { legalActions } from '../src/game';
import { MODES } from '../src/modes';

function mk(opts: { seat: number | null; isHost: boolean; n?: number }) {
  const sent: unknown[] = [];
  const ends: GameState[] = [];
  const m = new Match({
    mode: MODES.towpath,
    n: opts.n ?? 3,
    selfSeat: opts.seat,
    isHost: opts.isHost,
    seed: 4242,
    deps: { send: (w) => sent.push(w), onChange: () => {}, onEnd: (g) => ends.push(g) },
  });
  return { m, sent, ends };
}

function run(m: Match, ms: number): void {
  for (let t = 0; t < ms; t += 500) m.tick(500);
}

describe('a guest is not authoritative', () => {
  it('does not drive the clock while someone else hosts', () => {
    const { m, sent } = mk({ seat: 1, isHost: false });
    run(m, TURN_MS * 3);
    expect(sent).toHaveLength(0);
    expect(m.state.ply).toBe(0);
    expect(m.state.over).toBe(false);
  });

  it('does not auto-play an absent seat either', () => {
    const { m, sent } = mk({ seat: 1, isHost: false });
    m.peerLeft(0);
    run(m, TURN_MS * 2);
    expect(sent).toHaveLength(0);
    expect(m.state.over).toBe(false);
  });
});

describe('promotion', () => {
  it('lets the survivor drive the clock it previously ignored', () => {
    const { m, sent } = mk({ seat: 1, isHost: false });
    run(m, TURN_MS * 2);
    expect(sent).toHaveLength(0);
    m.setHost(true);
    m.peerLeft(0);
    m.peerLeft(2);
    run(m, TURN_MS);
    expect(sent.length).toBeGreaterThan(0);
    expect(m.state.ply).toBeGreaterThan(0);
  });

  it('THE GATE: a promoted survivor can still reach game over', () => {
    // Everyone else has gone; the promoted host auto-plays the absent seats fast
    // and its own turns on the clock, all the way to the end.
    const { m, ends } = mk({ seat: 1, isHost: false });
    m.setHost(true);
    m.peerLeft(0);
    m.peerLeft(2);
    run(m, TURN_MS * 30);
    expect(m.state.over, 'the round must be able to END after a host leaves').toBe(true);
    expect(m.state.reason).toBe('complete');
    expect(ends).toHaveLength(1);
    expect(m.state.players.every((p) => p.finished)).toBe(true);
  });

  it('a spectator host auto-plays the whole field to a finish', () => {
    const { m, ends } = mk({ seat: null, isHost: true });
    for (let i = 0; i < 3; i++) m.peerLeft(i);
    run(m, AUTO_FAST_MS * 400);
    expect(m.state.over).toBe(true);
    expect(ends).toHaveLength(1);
  });

  it('a peer coming back is auto-played no more', () => {
    const { m } = mk({ seat: 1, isHost: true });
    m.peerLeft(0);
    expect(m.someoneAbsent).toBe(true);
    m.peerReturned(0);
    expect(m.someoneAbsent).toBe(false);
  });

  it('the end fires exactly once, however many ticks follow', () => {
    const { m, ends } = mk({ seat: null, isHost: true });
    for (let i = 0; i < 3; i++) m.peerLeft(i);
    run(m, AUTO_FAST_MS * 600);
    expect(ends).toHaveLength(1);
  });
});

describe('the wire is validated, never trusted', () => {
  it('rejects a move for the seat that is not to play', () => {
    const { m } = mk({ seat: 0, isHost: true });
    const first = legalActions(m.state)[0];
    const notMover = (m.toMove + 1) % m.n;
    expect(m.receive([first.to, first.dish], notMover)).toBe(false);
    expect(m.state.ply).toBe(0);
  });

  it('rejects a malformed or illegal packet without desyncing', () => {
    const { m } = mk({ seat: 1, isHost: false });
    const seat = m.toMove;
    expect(m.receive(null, seat)).toBe(false);
    expect(m.receive([1, 2, 3], seat)).toBe(false);
    expect(m.receive([0, -1], seat)).toBe(false); // backwards: legal shape, illegal move
    expect(m.state.ply).toBe(0);
    expect(m.state.over).toBe(false);
  });

  it('accepts a genuine move from the seat whose turn it is', () => {
    const { m } = mk({ seat: 1, isHost: false });
    const seat = m.toMove;
    const a = legalActions(m.state)[0];
    expect(m.receive([a.to, a.dish], seat)).toBe(true);
    expect(m.state.ply).toBe(1);
  });
});

describe('local play', () => {
  it('refuses to play out of turn', () => {
    const notMe = mk({ seat: null, isHost: true });
    void notMe;
    const { m, sent } = mk({ seat: 5, isHost: false, n: 3 }); // seat 5 does not exist -> spectator
    expect(m.myTurn).toBe(false);
    expect(m.play(legalActions(m.state)[0])).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('sends exactly one packet per local move', () => {
    // Build a match where seat is the current mover so play() is legal.
    const base = mk({ seat: 0, isHost: true });
    const seat = base.m.toMove;
    const { m, sent } = mk({ seat, isHost: true });
    expect(m.myTurn).toBe(true);
    expect(m.play(legalActions(m.state)[0])).toBe(true);
    expect(sent).toHaveLength(1);
    expect(m.state.ply).toBe(1);
  });
});

describe('seat assignment comes from the frozen roster', () => {
  it('indexes the roster and gives nothing to a peer past the cap', () => {
    const roster = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}` }));
    expect(seatOf(roster, 'p0')).toBe(0);
    expect(seatOf(roster, 'p4')).toBe(4);
    expect(seatOf(roster, 'p5'), 'the 6th peer is over the cap').toBeNull();
    expect(seatOf(roster, 'nope')).toBeNull();
  });
});

describe('the clock is interval-driven, not frame-driven', () => {
  it('advances on tick() alone with rAF stubbed out', () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0);
    const { m, sent } = mk({ seat: null, isHost: true });
    for (let i = 0; i < m.n; i++) m.peerLeft(i);
    run(m, TURN_MS + 2000);
    expect(sent.length).toBeGreaterThan(0);
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });
});
