// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
// Amble — bot policies for solo play, host auto-moves, and the balance sim.

/**
 * ai.ts — how a bot chooses a move, and the deliberately DIFFERENT playing
 * styles the balance sim pits against each other.
 *
 * The sim's whole job (principle #18, and the idea's own balance flags) is to
 * answer: is "furthest-behind moves next" so strong a catch-up device that
 * ambling — always taking the shortest hop to bank another turn — strictly
 * dominates rushing? So the policies below are real strategies, not difficulty
 * dials: `ambler` never leaps, `sprinter` always reaches for the distant prize
 * and the inn, `balanced` maximises immediate value. If any single style wins
 * everywhere, the road's central decision is fake.
 */

import type { Rng } from '@ben-gy/game-engine/rng';
import {
  type Action,
  type GameState,
  mover,
  legalActions,
  souvenirScore,
  springFlat,
  tri,
  DEPTH_CAP,
} from './game';

export type Policy = 'balanced' | 'ambler' | 'sprinter' | 'random';

/** Immediate points a landing would add to the mover's projected score. */
export function marginalValue(state: GameState, seat: number, a: Action): number {
  const p = state.players[seat];
  const stop = state.road.stops[a.to];
  switch (stop.kind) {
    case 'vista': {
      // Only the deepest view scores, capped, so a tile helps only if it deepens
      // your best view and only up to the cap.
      const curMax = Math.min(DEPTH_CAP, Math.max(0, ...p.vista));
      const newMax = Math.min(DEPTH_CAP, Math.max(curMax, p.vista[stop.tag] + 1));
      return tri(newMax) - tri(curMax);
    }
    case 'market': {
      const c = [...p.souv];
      c[stop.tag]++;
      return souvenirScore(c) - souvenirScore(p.souv);
    }
    case 'spring':
      return springFlat(p.springs + 1) - springFlat(p.springs);
    case 'inn': {
      const dish = state.road.menus[stop.tag][a.dish];
      return Math.max(0, dish.value - p.meals[dish.kind]);
    }
    default:
      return 0; // the end
  }
}

/** Pick a move for the current mover under the given policy. Deterministic in rng. */
export function chooseMove(state: GameState, policy: Policy, rng: Rng): Action {
  const seat = mover(state);
  const all = legalActions(state);
  if (all.length === 0) return { to: state.players[seat]?.pos ?? 0, dish: -1 };
  if (all.length === 1) return all[0];

  // A claim is free value, so a sensible traveller never walks past an open stop
  // to the barrier while budget remains — that just wastes a claim (which is
  // exactly the artifact that faked ambling dominance in the sim). Only when no
  // open stop is left before the next barrier do we take the inn / the end.
  const from = state.players[seat].pos;
  const open = all.filter((m) => {
    const k = state.road.stops[m.to].kind;
    return k === 'vista' || k === 'market' || k === 'spring';
  });
  const moves = open.length > 0 ? open : all;

  if (policy === 'random') return moves[Math.floor(rng() * moves.length)];

  const scored = moves.map((m) => ({
    m,
    val: marginalValue(state, seat, m),
    hop: m.to - from,
  }));

  let best = scored[0];
  for (const s of scored) {
    if (better(policy, s, best)) best = s;
  }
  return best.m;
}

type Scored = { m: Action; val: number; hop: number };

function better(policy: Policy, s: Scored, b: Scored): boolean {
  if (policy === 'ambler') {
    // Hug the back of the field: nearest open stop, value breaking ties.
    if (s.hop !== b.hop) return s.hop < b.hop;
    return s.val > b.val;
  }
  if (policy === 'sprinter') {
    // Reach for the prize and the inn: value plus a bonus for covering ground.
    const ss = s.val + s.hop * 0.15;
    const bb = b.val + b.hop * 0.15;
    if (ss !== bb) return ss > bb;
    return s.hop > b.hop;
  }
  // balanced: maximise immediate value, then stay back for another turn.
  if (s.val !== b.val) return s.val > b.val;
  return s.hop < b.hop;
}
