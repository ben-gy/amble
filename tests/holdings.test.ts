/**
 * holdings.test.ts — the live "what you've collected" strip.
 *
 * Reported via feedback: a player could see the running totals but not what they
 * personally held (views, souvenirs, springs, meals) or how many claims they had
 * left, so they couldn't strategise. holdingsHtml() surfaces that for the local
 * traveller; these tests pin that it reflects the real state.
 */

import { describe, expect, it } from 'vitest';
import { holdingsHtml } from '../src/ui';
import { applyAction, createGame, legalActions, mover, type StopKind } from '../src/game';
import { modeOf, DEFAULT_MODE_ID } from '../src/modes';

const CLAIM_KINDS: StopKind[] = ['vista', 'market', 'spring'];

describe("the holdings strip shows what you've collected", () => {
  it('starts with the full claim budget and empty collections', () => {
    const g = createGame(modeOf(DEFAULT_MODE_ID), 42, 3);
    const html = holdingsHtml(g, 0);
    expect(html, 'shows how many claims are still available').toContain(`${g.budget} claim`);
    expect(html, 'labels the springs count').toMatch(/Springs/);
    expect(html, 'labels the souvenir spread').toMatch(/Souvenir/);
  });

  it('spends a claim when the mover takes an open-road stop', () => {
    const g = createGame(modeOf(DEFAULT_MODE_ID), 7, 3);
    const seat = mover(g);
    const claim = legalActions(g).find((a) => CLAIM_KINDS.includes(g.road.stops[a.to].kind));
    expect(claim, 'the opening position offers at least one claimable stop').toBeTruthy();
    const g2 = applyAction(g, claim!);
    // The mover's claims-left must drop by exactly one.
    expect(holdingsHtml(g, seat)).toContain(`${g.budget} claim`);
    expect(holdingsHtml(g2, seat)).toContain(`${g.budget - 1} claim`);
  });
});
