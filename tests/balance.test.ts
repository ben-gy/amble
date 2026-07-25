/**
 * balance.test.ts — MANDATORY for a competitive game (principle #18). A ratchet,
 * not a discovery tool: the discovery happened while building, recorded in
 * BALANCE.md, and its headline is worth carrying because it is the idea's own
 * balance flag (a):
 *
 *   "furthest-behind moves next" is such a strong catch-up device that, WITHOUT a
 *   turn budget, a traveller who only ever takes the shortest hop banks unlimited
 *   extra turns and wins 100% of games — the road's central decision would be
 *   fake. The budget (every traveller claims the same number of open-road stops)
 *   is what makes it a game: turn ORDER matters, turn COUNT does not, and the only
 *   question is which stops to spend your claims on.
 *
 * With the budget in place the sim referees four things, at wide bounds set to
 * survive the sampling noise at this n (~±10 points) and catch a regression of the
 * size the pre-budget bug had:
 *   1. no single pure style dominates (adaptive play beats both extremes);
 *   2. skill beats random;
 *   3. no seat is favoured by the start order (uniform-policy control arm);
 *   4. the winner is not decided in the opening.
 */

import { describe, expect, it } from 'vitest';
import { MODE_IDS } from '../src/modes';
import {
  blowoutRate,
  CHECKPOINTS,
  leaderWinRate,
  policyWinRates,
  runRotations,
  runUniform,
  seatWinShare,
  seedFamily,
  totalUnterminated,
  type GameResult,
} from './helpers/sim';

const SEEDS = seedFamily(31_000, 60);
// 4-player per-seat win share has a ~±11 point CI at n=60 — enough that a fair
// game throws an 8% seat by luck (it did). A 4-way split needs more games before
// a seat bound means anything, so the seat-fairness arm runs at higher n.
const SEEDS4 = seedFamily(31_000, 200);

/** Uniform balanced control, per mode and player count — the seat-fairness arm. */
const UNIFORM: Record<string, Record<number, GameResult[]>> = Object.fromEntries(
  MODE_IDS.map((m) => [m, { 2: runUniform(m, SEEDS, 2, 'balanced'), 3: runUniform(m, SEEDS, 3, 'balanced'), 4: runUniform(m, SEEDS4, 4, 'balanced') }]),
);

describe('every game terminates', () => {
  for (const mode of MODE_IDS) {
    it(`${mode}: no run reaches the guard`, () => {
      for (const n of [2, 3, 4]) {
        const r = UNIFORM[mode][n];
        expect(r.length).toBeGreaterThan(50);
        expect(totalUnterminated(r), `${mode} @ ${n}p had unterminated runs`).toBe(0);
      }
    });
  }
});

describe('seat fairness — the start order favours no one (uniform control)', () => {
  // The control arm is what tells a seat effect apart from a policy schedule
  // leaking into the seat axis (sporeline's artifact). Every seat plays the same
  // policy, so any gap here is the turn order itself.
  for (const mode of MODE_IDS) {
    it(`${mode} @ 2p: within noise of 50/50`, () => {
      const s0 = seatWinShare(UNIFORM[mode][2], 0);
      expect(s0).toBeGreaterThan(0.35);
      expect(s0).toBeLessThan(0.65);
    });
    it(`${mode} @ 3p: every seat within noise of 33%`, () => {
      for (let s = 0; s < 3; s++) {
        const share = seatWinShare(UNIFORM[mode][3], s);
        expect(share, `${mode} 3p seat ${s}`).toBeGreaterThan(0.18);
        expect(share, `${mode} 3p seat ${s}`).toBeLessThan(0.5);
      }
    });
    it(`${mode} @ 4p: every seat within noise of 25%`, () => {
      for (let s = 0; s < 4; s++) {
        const share = seatWinShare(UNIFORM[mode][4], s);
        expect(share, `${mode} 4p seat ${s}`).toBeGreaterThan(0.14);
        expect(share, `${mode} 4p seat ${s}`).toBeLessThan(0.38);
      }
    });
  }
});

describe('no pure style dominates — adaptive play is the skill', () => {
  for (const mode of MODE_IDS) {
    it(`${mode}: neither ambler nor balanced runs away (2p)`, () => {
      // The two viable extremes head to head. If either exceeds ~3/4 the game has
      // a dominant simple strategy — the pre-budget failure. Adaptive 'balanced'
      // wins or ties in the routing modes; 'ambler' edges the short spring mode.
      const rot = runRotations(mode, SEEDS, ['balanced', 'ambler']);
      const wr = policyWinRates(rot);
      expect(wr.balanced, `${mode} balanced`).toBeGreaterThan(0.25);
      expect(wr.balanced, `${mode} balanced`).toBeLessThan(0.75);
      expect(wr.ambler, `${mode} ambler`).toBeGreaterThan(0.25);
      expect(wr.ambler, `${mode} ambler`).toBeLessThan(0.75);
    });

    it(`${mode}: skill beats random handily`, () => {
      const rot = runRotations(mode, SEEDS, ['balanced', 'random']);
      const wr = policyWinRates(rot);
      expect(wr.balanced, `${mode} balanced vs random`).toBeGreaterThan(0.82);
    });
  }
});

describe('the winner is not decided in the opening', () => {
  const EARLY = 0; // checkpoint .3 of the road
  const LATE = CHECKPOINTS.length - 1; // checkpoint .85
  for (const mode of MODE_IDS) {
    it(`${mode}: an early leader barely predicts the winner`, () => {
      const early = leaderWinRate(UNIFORM[mode][3], EARLY);
      expect(early, `${mode} early`).not.toBeNull();
      expect(early!, `${mode} early`).toBeLessThan(0.7);
    });
    it(`${mode}: a late lead does predict it — the drama resolves`, () => {
      const late = leaderWinRate(UNIFORM[mode][3], LATE);
      expect(late, `${mode} late`).not.toBeNull();
      expect(late!, `${mode} late`).toBeGreaterThan(0.6);
    });
  }
});

describe('games are not blowouts', () => {
  for (const mode of MODE_IDS) {
    it(`${mode}: bounded blowout rate at 3p`, () => {
      expect(blowoutRate(UNIFORM[mode][3], 12)).toBeLessThan(0.4);
    });
  }
});
