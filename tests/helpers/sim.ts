/**
 * sim.ts — the AI-vs-AI harness the balance test and the tuning both run on
 * (principle #18). It answers the questions the idea itself flagged:
 *
 *  - Is "furthest-behind moves next" so strong a catch-up that AMBLING (banking
 *    extra turns with short hops) strictly dominates rushing? -> policy win rates.
 *  - Is any seat favoured by the start order? -> uniform-policy seat shares.
 *  - Is the winner decided in the opening? -> leader-at-checkpoint win rates.
 *
 * Deterministic (seeded rng, no Math.random), so a baseline is a baseline.
 */

import { makeRng } from '@ben-gy/game-engine/rng';
import { applyAction, createGame, mover, scoreAll, type GameState } from '../../src/game';
import { chooseMove, type Policy } from '../../src/ai';
import { modeOf, roadLength, turnCap } from '../../src/modes';

/** Checkpoints as a fraction of total road progress covered by the whole field. */
export const CHECKPOINTS = [0.3, 0.6, 0.85] as const;

export interface GameResult {
  seed: number;
  plies: number;
  reason: string;
  winner: number | null; // seat index, null = drawn
  scores: number[]; // final total per seat
  policies: Policy[];
  /** The projected leader at each checkpoint (seat index, -1 if tied). */
  leaders: number[];
  margin: number; // winner score minus runner-up
}

function projectedLeader(s: GameState): number {
  const bd = scoreAll(s);
  let best = -1;
  let bestVal = -Infinity;
  let tie = false;
  for (let i = 0; i < bd.length; i++) {
    if (bd[i].total > bestVal) {
      bestVal = bd[i].total;
      best = i;
      tie = false;
    } else if (bd[i].total === bestVal) {
      tie = true;
    }
  }
  return tie ? -1 : best;
}

export function simulate(modeId: string, seed: number, policies: Policy[]): GameResult {
  const mode = modeOf(modeId);
  const n = policies.length;
  let s = createGame(mode, seed, n);
  const cap = turnCap(mode, n) + 5;
  const maxProgress = n * (roadLength(mode, n) - 1);
  const leaders: number[] = CHECKPOINTS.map(() => -2); // -2 = not yet reached
  let g = 0;

  while (!s.over && g++ < cap) {
    const prog = s.players.reduce((a, p) => a + p.pos, 0) / maxProgress;
    for (let c = 0; c < CHECKPOINTS.length; c++) {
      if (leaders[c] === -2 && prog >= CHECKPOINTS[c]) leaders[c] = projectedLeader(s);
    }
    const seat = mover(s);
    const a = chooseMove(s, policies[seat], makeRng(`${seed}:${g}:${seat}`));
    s = applyAction(s, a);
  }
  for (let c = 0; c < leaders.length; c++) if (leaders[c] === -2) leaders[c] = projectedLeader(s);

  const scores = scoreAll(s).map((b) => b.total);
  const sorted = [...scores].sort((a, b) => b - a);
  return {
    seed,
    plies: s.ply,
    reason: s.over ? s.reason ?? 'complete' : 'unterminated',
    winner: s.winner,
    scores,
    policies,
    leaders,
    margin: sorted.length >= 2 ? sorted[0] - sorted[1] : 0,
  };
}

/** A spread-out family of seeds from a base, so a family is not consecutive ints. */
export function seedFamily(base: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => base + i * 2654435761);
}

/** All seats the same policy: any win-rate gap is then a seat/turn-order effect. */
export function runUniform(modeId: string, seeds: number[], n: number, policy: Policy): GameResult[] {
  const tuple = Array(n).fill(policy) as Policy[];
  return seeds.map((seed) => simulate(modeId, seed, tuple));
}

/** Rotate a policy tuple across the seeds so seat bias cancels out of policy stats. */
export function runRotations(modeId: string, seeds: number[], tuple: Policy[]): GameResult[] {
  const out: GameResult[] = [];
  for (const seed of seeds) {
    for (let r = 0; r < tuple.length; r++) {
      const rot = tuple.map((_, i) => tuple[(i + r) % tuple.length]);
      out.push(simulate(modeId, seed, rot));
    }
  }
  return out;
}

/* ── reducers ─────────────────────────────────────────────────────────────── */

export function seatWinShare(results: GameResult[], seat: number): number {
  const decided = results.filter((r) => r.winner !== null);
  if (decided.length === 0) return 0;
  return decided.filter((r) => r.winner === seat).length / decided.length;
}

export function drawRate(results: GameResult[]): number {
  return results.filter((r) => r.winner === null).length / results.length;
}

export function meanPlies(results: GameResult[]): number {
  return results.reduce((a, r) => a + r.plies, 0) / results.length;
}

export function blowoutRate(results: GameResult[], threshold: number): number {
  const decided = results.filter((r) => r.winner !== null);
  if (decided.length === 0) return 0;
  return decided.filter((r) => r.margin >= threshold).length / decided.length;
}

/** Win rate of each policy across rotated games. */
export function policyWinRates(results: GameResult[]): Record<string, number> {
  const wins: Record<string, number> = {};
  const games: Record<string, number> = {};
  for (const r of results) {
    if (r.winner === null) continue;
    for (let seat = 0; seat < r.policies.length; seat++) {
      const pol = r.policies[seat];
      games[pol] = (games[pol] ?? 0) + 1;
      if (r.winner === seat) wins[pol] = (wins[pol] ?? 0) + 1;
    }
  }
  const out: Record<string, number> = {};
  for (const pol of Object.keys(games)) out[pol] = (wins[pol] ?? 0) / games[pol];
  return out;
}

/** Among games with a clear leader at checkpoint c, how often that leader wins. */
export function leaderWinRate(results: GameResult[], c: number): number | null {
  const rel = results.filter((r) => r.leaders[c] >= 0 && r.winner !== null);
  if (rel.length < 20) return null;
  return rel.filter((r) => r.leaders[c] === r.winner).length / rel.length;
}

export function totalUnterminated(results: GameResult[]): number {
  return results.filter((r) => r.reason === 'unterminated').length;
}
