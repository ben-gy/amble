/**
 * rng.test.ts — the P2P-sync determinism invariant (MANDATORY).
 *
 * Amble is LOCKSTEP: no board state ever crosses the wire, so two peers stay in
 * sync only if the same seed builds the same road and the same action sequence
 * produces the same state on both. A desync here breaks every multiplayer session
 * silently — the peers diverge with no error anywhere.
 */

import { describe, expect, it } from 'vitest';
import { makeRng, shuffle } from '@ben-gy/game-engine/rng';
import { applyAction, buildRoad, createGame, decodeAction, encodeAction, mover } from '../src/game';
import { chooseMove, type Policy } from '../src/ai';
import { MODES, MODE_IDS, roadLength } from '../src/modes';

describe('the engine RNG is deterministic', () => {
  it('the same seed yields the same stream', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('shuffle is a pure function of the seed', () => {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(shuffle(makeRng(7), arr)).toEqual(shuffle(makeRng(7), arr));
  });
});

describe('the road is a pure function of the seed', () => {
  for (const id of MODE_IDS) {
    for (const n of [2, 3, 4, 5]) {
      it(`${id} @ ${n}p: two peers build the identical road`, () => {
        const a = buildRoad(MODES[id], makeRng(9001), n);
        const b = buildRoad(MODES[id], makeRng(9001), n);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(a.stops.length).toBe(roadLength(MODES[id], n));
      });
    }
  }

  it('different seeds produce different roads', () => {
    const a = buildRoad(MODES.longroad, makeRng(1), 3);
    const b = buildRoad(MODES.longroad, makeRng(2), 3);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('two peers replaying the same moves stay byte-identical', () => {
  for (const id of MODE_IDS) {
    for (const n of [2, 3, 5]) {
      it(`${id} @ ${n}p`, () => {
        const seed = 20260725 + n;
        let host = createGame(MODES[id], seed, n);
        let guest = createGame(MODES[id], seed, n);
        const styles: Policy[] = ['balanced', 'ambler', 'sprinter', 'balanced', 'ambler'];
        let g = 0;
        while (!host.over && g++ < 400) {
          const seat = mover(host);
          const a = chooseMove(host, styles[seat % styles.length], makeRng(`${seed}:${g}`));
          host = applyAction(host, a);
          // The guest only ever receives the encoded action and re-simulates it.
          guest = applyAction(guest, decodeAction(encodeAction(a))!);
          expect(JSON.stringify(guest), `desync at ply ${g}`).toBe(JSON.stringify(host));
        }
        expect(host.over).toBe(true);
        expect(guest.winner).toBe(host.winner);
      });
    }
  }
});
