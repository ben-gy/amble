// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
// Amble — the three shapes of road.

/**
 * modes.ts — three roads that PLAY differently, not three tuned numbers
 * (principle #14). Each changes the stop budget, the inn cadence and the mix, so a
 * mode changes which route to victory pays:
 *
 *  - Towpath  — a short budget, springs aplenty: the end-of-road majority races
 *               dominate and the whole thing is over quickly.
 *  - Long Road — a long budget, vista/market-rich: room to build one panorama deep
 *               and eat well, so commitment and inn-timing decide it.
 *  - Wayward  — the views are SCATTERED per seed, not clustered, so you cannot
 *               chain a panorama on autopilot; a routing puzzle that changes seed
 *               to seed.
 *
 * THE BUDGET IS WHY THE GAME IS A GAME. Every traveller may claim the same number
 * of open-road stops (inns are free and mandatory). That conserves turns, so the
 * "furthest-behind moves next" rule governs the ORDER and TIMING of your claims,
 * not how many you get — without it, the balance sim showed a traveller who only
 * ever takes the shortest hop banks unlimited extra turns and wins 100% (a
 * degenerate ambling dominance the whole design would rest on). With it, the only
 * question is which stops to spend your claims on: race far for a prize and hand
 * the turn to those behind, or take the sure thing near and keep moving.
 *
 * The host's pick travels frozen inside the round start (see rematch's roundOpts).
 */

export interface Mode {
  id: string;
  name: string;
  blurb: string;
  /** Open-road stops a traveller may claim (inns are free). The turn budget. */
  claims: number;
  /** How many inns (gather points) punctuate the road. */
  inns: number;
  /** Open-road stops per claim across the field — >1 leaves real choices. */
  slack: number;
  /** Relative weights for the three open-road stop kinds. */
  mix: { vista: number; market: number; spring: number };
  /** Clustered views chain into learnable runs; scattered changes every seed. */
  clusteredViews: boolean;
}

export const MODES: Record<string, Mode> = {
  towpath: {
    id: 'towpath',
    name: 'Towpath',
    blurb: 'A short stroll, springs aplenty — few stops each, so the end-of-road races decide it.',
    claims: 6,
    inns: 2,
    slack: 1.5,
    mix: { vista: 2, market: 2, spring: 4 },
    clusteredViews: true,
  },
  longroad: {
    id: 'longroad',
    name: 'Long Road',
    blurb: 'The full journey — more stops to spend, room to build one view deep and eat well.',
    claims: 9,
    inns: 3,
    slack: 1.5,
    mix: { vista: 4, market: 3, spring: 2 },
    clusteredViews: true,
  },
  wayward: {
    id: 'wayward',
    name: 'Wayward',
    blurb: 'The views are scattered, never clustered — no route learns twice, every seed is a puzzle.',
    claims: 7,
    inns: 2,
    slack: 1.6,
    mix: { vista: 4, market: 2, spring: 2 },
    clusteredViews: false,
  },
};

export const MODE_IDS = ['towpath', 'longroad', 'wayward'] as const;
export const DEFAULT_MODE_ID = 'longroad';

/** How long the road is for a given player count — enough stops that the budget bites. */
export function roadLength(mode: Mode, n: number): number {
  const open = Math.ceil(mode.claims * n * mode.slack);
  return open + mode.inns + 2; // + trailhead + destination
}

/** A generous ply ceiling for the sim's termination guard. */
export function turnCap(mode: Mode, n: number): number {
  return n * (mode.claims + mode.inns + 2) + 10;
}

/**
 * Validate an id off the wire and fall back rather than hand `undefined` to the
 * generator. Guard with hasOwn so a prototype key ('constructor') cannot slip a
 * Mode of undefined fields through `MODES[id]`.
 */
export function modeOf(id: string | null | undefined): Mode {
  if (id && Object.hasOwn(MODES, id)) return MODES[id];
  return MODES[DEFAULT_MODE_ID];
}
