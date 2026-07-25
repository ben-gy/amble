/**
 * contrast.test.ts — MANDATORY (principle #22). "Screenshot it and look" cannot
 * see an invisible game piece (Scrapwall's 1.14:1 walls read as atmosphere). So
 * every colour that carries meaning on the play surface, in every state, against
 * every surface it can sit on, is held to the WCAG 2.1 §1.4.11 graphic floor of
 * 3:1 — and text to the 4.5:1 body floor. Pure, instant, no canvas.
 *
 * This proves the CONSTANTS. Only the in-browser pixel probe proves what was
 * actually painted; both are needed.
 */

import { describe, expect, it } from 'vitest';
import { contrast, PALETTE, SEAT_COLOUR, SEAT_DEEP, SEAT_INK } from '../src/palette';

const MIN = 3;
const MIN_TEXT = 4.5;

/** The dark road is the surface every waypoint mark and traveller sits on. */
const ROAD_SURFACES = { road: PALETTE.road, roadEdge: PALETTE.roadEdge } as const;
/** The light surfaces UI text sits on. */
const PANEL_SURFACES = { panel: PALETTE.panel, panelDeep: PALETTE.panelDeep, paper: PALETTE.paper } as const;

describe('the contrast helper is right', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
  it('is symmetric', () => {
    expect(contrast(PALETTE.spring, PALETTE.road)).toBeCloseTo(contrast(PALETTE.road, PALETTE.spring), 6);
  });
});

describe('every waypoint mark is visible on the road', () => {
  const marks = {
    'vista: Sea': PALETTE.vistaSea,
    'vista: Hills': PALETTE.vistaHill,
    'vista: Dusk': PALETTE.vistaDusk,
    market: PALETTE.market,
    spring: PALETTE.spring,
    inn: PALETTE.inn,
    'reachable glow': PALETTE.reach,
  };
  for (const [name, mark] of Object.entries(marks)) {
    for (const [surfName, surf] of Object.entries(ROAD_SURFACES)) {
      it(`${name} on ${surfName}`, () => {
        const ratio = contrast(mark, surf);
        expect(ratio, `${mark} on ${surf} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN);
      });
    }
  }
});

describe('a mark’s dark icon is legible against the mark', () => {
  const marks = [PALETTE.vistaSea, PALETTE.vistaHill, PALETTE.vistaDusk, PALETTE.market, PALETTE.spring, PALETTE.inn];
  for (const [i, mark] of marks.entries()) {
    it(`glyph on mark ${i}`, () => {
      expect(contrast(PALETTE.glyph, mark)).toBeGreaterThanOrEqual(MIN);
    });
  }
});

describe('travellers are visible and told apart', () => {
  for (const [i, seat] of SEAT_COLOUR.entries()) {
    it(`seat ${i} reads on the road`, () => {
      expect(contrast(seat, PALETTE.road)).toBeGreaterThanOrEqual(MIN);
    });
    it(`seat ${i} numeral is legible on the token`, () => {
      expect(contrast(SEAT_INK, seat)).toBeGreaterThanOrEqual(MIN);
    });
    it(`seat ${i} reads against its own rim`, () => {
      expect(contrast(seat, SEAT_DEEP[i])).toBeGreaterThanOrEqual(1.5);
    });
  }

  it('adjacent seats differ in lightness, not only hue', () => {
    // A hue difference is no difference to a player who cannot separate the hues,
    // so consecutive traveller colours must also differ in luminance.
    for (let i = 1; i < SEAT_COLOUR.length; i++) {
      const ratio = contrast(SEAT_COLOUR[i], SEAT_COLOUR[i - 1]);
      expect(ratio, `seats ${i - 1}/${i} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(1.15);
    }
  });
});

describe('text is readable on every panel surface', () => {
  it('body text', () => {
    for (const surf of Object.values(PANEL_SURFACES)) {
      expect(contrast(PALETTE.text, surf)).toBeGreaterThanOrEqual(MIN_TEXT);
    }
  });
  it('muted text still clears the body floor', () => {
    for (const surf of Object.values(PANEL_SURFACES)) {
      expect(contrast(PALETTE.textMuted, surf)).toBeGreaterThanOrEqual(MIN_TEXT);
    }
  });
});
