// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson
// Amble — DOM UI: help, about, the inn menu, live standings, results.

import { type Dish, type GameState, scoreAll } from './game';
import { SEAT_COLOUR, SEAT_NAME } from './palette';

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function helpSheetHtml(): string {
  return `
  <div class="sheet" role="dialog" aria-modal="true" aria-label="How to play">
    <h2>How to play</h2>
    <p>Travel down the road, tapping any <strong>open stop ahead</strong> to go there and collect
       what it offers. Then whoever is <strong>furthest behind</strong> goes next — so racing ahead
       for a prize means sitting still while rivals mop up everything you skipped.</p>
    <ul class="help-list">
      <li><span class="dot sea"></span><strong>Views</strong> — paint a panorama. Only your deepest
        single view scores, and it grows fast, so <em>commit to one</em>.</li>
      <li><span class="dot market"></span><strong>Markets</strong> — collect souvenirs. A spread of
        different kinds pays; hoarding one does not.</li>
      <li><span class="dot spring"></span><strong>Springs</strong> — a soak worth a little, and the
        traveller with the <em>most</em> springs takes a bonus.</li>
      <li><span class="dot inn"></span><strong>Inns</strong> — everyone must stop; the menu is
        first-come, so the <em>first to arrive eats best</em>.</li>
    </ul>
    <p>You may claim only so many open stops before your journey's end, so spend them well. Most
       points when everyone reaches the end wins.</p>
    <button class="btn primary" data-close>Set off</button>
  </div>`;
}

export function aboutSheetHtml(): string {
  return `
  <div class="sheet" role="dialog" aria-modal="true" aria-label="About Amble">
    <h2>About Amble</h2>
    <p>A quiet, competitive travel game: no dice, no combat, no hidden cards — just a one-way road and
       the question of how much you give up to reach a spot first.</p>
    <p>Play solo against travellers of the road, or with friends over a shared link. Multiplayer is
       peer-to-peer: your browsers talk directly, with a public signalling relay used only to make the
       first connection. No account, no server, nothing stored.</p>
    <p class="muted">Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a>
       · <a href="https://hub.benrichardson.dev" target="_blank" rel="noopener">more games, tools &amp; sites</a></p>
    <button class="btn primary" data-close>Close</button>
  </div>`;
}

/** The first-come inn menu, for the player to pick a dish on arrival. */
export function innMenuHtml(menu: Dish[], taken: boolean[], eaten: number[]): string {
  const cuisines = ['Noodles', 'Dumplings', 'Grilled fish', 'Rice bowl', 'Sweet buns'];
  const rows = menu
    .map((d, slot) => {
      const gone = taken[slot];
      const dup = eaten[d.kind] > 0;
      return `<button class="dish${gone ? ' gone' : ''}" data-slot="${slot}" ${gone ? 'disabled' : ''}>
        <span class="dish-name">${esc(cuisines[d.kind] ?? 'Dish')}</span>
        <span class="dish-val">${gone ? 'taken' : dup ? 'already eaten · +0' : '+' + d.value}</span>
      </button>`;
    })
    .join('');
  return `<div class="inn-menu"><p class="inn-title">Choose a dish</p>${rows}</div>`;
}

/** A compact live standings strip: each traveller, projected score, what they lead. */
export function standingsHtml(game: GameState, selfSeat: number | null, roster: string[]): string {
  const bd = scoreAll(game);
  const rows = game.players
    .map((_, i) => i)
    .sort((a, b) => bd[b].total - bd[a].total)
    .map((i) => {
      const name = roster[i] ?? SEAT_NAME[i] ?? `P${i + 1}`;
      const you = i === selfSeat ? ' you' : '';
      const done = game.players[i].finished ? ' done' : '';
      return `<div class="stand-row${you}${done}">
        <span class="pawn" style="--c:${SEAT_COLOUR[i % SEAT_COLOUR.length]}">${i + 1}</span>
        <span class="stand-name">${esc(name)}</span>
        <span class="stand-score">${bd[i].total}</span>
      </div>`;
    })
    .join('');
  return `<div class="standings">${rows}</div>`;
}

export interface ResultRow {
  seat: number;
  name: string;
  isSelf: boolean;
}

export function resultsHtml(game: GameState, rows: ResultRow[], tally: number[]): string {
  const bd = scoreAll(game);
  const ranked = [...rows].sort((a, b) => bd[b.seat].total - bd[a.seat].total);
  const top = bd[game.ranking[0]]?.total ?? 0;

  const chip = (label: string, v: number, cls = ''): string =>
    v > 0 ? `<span class="chip ${cls}">${label} ${v}</span>` : '';

  const cards = ranked
    .map((r, place) => {
      const b = bd[r.seat];
      const isWinner = game.winner === r.seat;
      const crown = isWinner ? '👑 ' : `${place + 1}. `;
      return `<div class="result-card${r.isSelf ? ' you' : ''}${isWinner ? ' win' : ''}">
        <div class="rc-head">
          <span class="pawn" style="--c:${SEAT_COLOUR[r.seat % SEAT_COLOUR.length]}">${r.seat + 1}</span>
          <span class="rc-name">${crown}${esc(r.name)}${r.isSelf ? ' (you)' : ''}</span>
          <span class="rc-total">${b.total}</span>
        </div>
        <div class="rc-chips">
          ${chip('View', b.vista, 'sea')}
          ${chip('Souvenirs', b.souv, 'market')}
          ${chip('Springs', b.spring, 'spring')}
          ${chip('Meals', b.meal, 'inn')}
          ${chip('Finest view', b.fineBonus, 'bonus')}
          ${chip('Most springs', b.springBonus, 'bonus')}
        </div>
      </div>`;
    })
    .join('');

  const tallyLine =
    tally.some((t) => t > 0)
      ? `<p class="tally">Match: ${rows
          .map((r) => `${esc(r.name)} ${tally[r.seat] ?? 0}`)
          .join(' · ')}</p>`
      : '';

  const heading =
    game.winner === null
      ? 'A shared road'
      : rows.find((r) => r.isSelf && r.seat === game.winner)
        ? 'You reach the end ahead'
        : `${esc(rows.find((r) => r.seat === game.winner)?.name ?? 'A traveller')} reaches the end ahead`;

  return `
  <h2 class="results-title">${heading}</h2>
  ${tallyLine}
  <div class="results">${cards}</div>
  <p class="muted small">Top score ${top}. Every traveller's tally is shown above.</p>`;
}
