// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
// Amble — colour system + WCAG contrast helper.

/**
 * palette.ts — the whole colour language, and the contrast maths that keeps it
 * honest.
 *
 * The play surface is a DARK ink road winding down a light paper page (an
 * Edo-woodblock-ish look, and a deliberate change from the fleet's many
 * dark-all-over games). Every waypoint mark is a BRIGHT disc on that dark road,
 * so contrast is generous — but the numbers still have to be PROVEN, not eyeballed
 * (principle #22: an invisible piece reads as atmosphere in a screenshot). Every
 * colour that carries meaning is pinned by tests/contrast.test.ts.
 *
 * Colour is never the ONLY channel: each stop kind also has a distinct icon, and
 * each traveller a numeral, so the game survives colour-blindness.
 */

export const PALETTE = {
  // page + play surface
  paper: '#efe3c8', // the page (sky / negative space)
  paperDeep: '#e4d5b4', // a lower plane of the page, for layered hills
  road: '#26221b', // the road — the surface every mark sits on
  roadEdge: '#37301f', // the road's shaded rail (marks can touch it)
  panel: '#f7eed6', // UI cards
  panelDeep: '#e8dcbe',

  // text
  text: '#2a251c',
  textMuted: '#5c5238',
  glyph: '#201c15', // dark ink icon drawn on a bright mark

  // stop marks (bright, on the dark road) — 6 distinct hues, each with an icon
  vistaSea: '#5bb8e6',
  vistaHill: '#8fce5a',
  vistaDusk: '#f0a0c2',
  market: '#f4c020',
  spring: '#3fd0c0',
  inn: '#ff8a5c',

  // feedback
  reach: '#ffe08a', // the glow on a stop you can travel to
  taken: '#6b6152', // a spent stop (drawn muted, off the road ink)
  shadow: 'rgba(20,16,10,0.35)',
} as const;

/** Traveller colours — bright enough for a dark numeral, and spread in lightness
 *  (not just hue) so consecutive travellers stay distinct under colour-blindness. */
export const SEAT_COLOUR = ['#ffd166', '#5aa0e6', '#7bdc98', '#d072b0', '#ffb066'] as const;
/** A darker rim for each seat token, so it reads on the bright disc it may pass over. */
export const SEAT_DEEP = ['#b8842a', '#2f6fb0', '#348f57', '#8f3d78', '#c07a2a'] as const;
/** The numeral drawn inside a traveller token. */
export const SEAT_INK = '#201c15';

export const SEAT_NAME = ['Amber', 'Cobalt', 'Fern', 'Rose', 'Ember'] as const;

/* ── WCAG contrast ────────────────────────────────────────────────────────── */

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a #rrggbb colour (WCAG 2.1). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => channel(parseInt(h, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours (1..21, symmetric). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
