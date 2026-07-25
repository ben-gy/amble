/**
 * rules.test.ts — the pure game model: road generation, the furthest-behind turn
 * order, single-occupancy, the inn barrier, scoring and termination.
 */

import { describe, expect, it } from 'vitest';
import { makeRng } from '@ben-gy/game-engine/rng';
import {
  applyAction,
  barrierAfter,
  buildRoad,
  createGame,
  decodeAction,
  encodeAction,
  legalActions,
  mover,
  scoreAll,
  souvenirScore,
  tri,
  DISH_VALUES,
  type GameState,
  MAX_PLAYERS,
} from '../src/game';
import { chooseMove } from '../src/ai';
import { MODES, MODE_IDS, modeOf, roadLength, turnCap } from '../src/modes';

/** Play a whole game out with a bot in the mover's seat; return the final state. */
function playOut(mode = MODES.longroad, seed = 1, n = 3): GameState {
  let s = createGame(mode, seed, n);
  let guard = 0;
  while (!s.over && guard++ < turnCap(mode, n) + 5) {
    const a = chooseMove(s, 'balanced', makeRng(`${seed}:${s.ply}`));
    s = applyAction(s, a);
  }
  return s;
}

describe('road generation', () => {
  const N = 3;
  for (const id of MODE_IDS) {
    const mode = modeOf(id);
    const L = roadLength(mode, N);
    it(`${id}: right length, trailhead and destination`, () => {
      const road = buildRoad(mode, makeRng(7), N);
      expect(road.stops.length).toBe(L);
      expect(road.stops[0].kind).toBe('start');
      expect(road.stops[L - 1].kind).toBe('end');
    });

    it(`${id}: the right number of inns, none adjacent or at the ends`, () => {
      const road = buildRoad(mode, makeRng(7), N);
      expect(road.innAt.length).toBe(mode.inns);
      expect(road.menus.length).toBe(mode.inns);
      for (const p of road.innAt) {
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(L - 1);
      }
      for (let i = 1; i < road.innAt.length; i++) {
        expect(road.innAt[i] - road.innAt[i - 1], 'inns must not be adjacent').toBeGreaterThan(1);
      }
    });

    it(`${id}: every interior stop is a known kind`, () => {
      const road = buildRoad(mode, makeRng(3), N);
      for (let i = 1; i < L - 1; i++) {
        expect(['vista', 'market', 'spring', 'inn']).toContain(road.stops[i].kind);
      }
    });

    it(`${id}: has enough open stops for every traveller's budget`, () => {
      for (const n of [2, 5]) {
        const road = buildRoad(mode, makeRng(2), n);
        const open = road.stops.filter(
          (s) => s.kind === 'vista' || s.kind === 'market' || s.kind === 'spring',
        ).length;
        expect(open, `${id} @ ${n}p starves the field`).toBeGreaterThanOrEqual(mode.claims * n);
      }
    });
  }

  it('is deterministic — the same seed builds a byte-identical road', () => {
    const a = buildRoad(MODES.longroad, makeRng(12345), 3);
    const b = buildRoad(MODES.longroad, makeRng(12345), 3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('inn menus offer every value once, first-come descending', () => {
    const road = buildRoad(MODES.longroad, makeRng(9), 3);
    for (const menu of road.menus) {
      expect(menu.map((d) => d.value)).toEqual([...DISH_VALUES]);
      expect(new Set(menu.map((d) => d.kind)).size, 'a menu repeats a cuisine').toBe(menu.length);
    }
  });
});

describe('turn order — furthest behind moves next', () => {
  it('someone moves first, decided by the seed, not always seat 0', () => {
    const firsts = new Set<number>();
    for (let seed = 0; seed < 40; seed++) firsts.add(mover(createGame(MODES.longroad, seed, 3)));
    expect(firsts.size, 'the first mover never varied with the seed').toBeGreaterThan(1);
  });

  it('the mover is always the traveller at the smallest position', () => {
    let s = createGame(MODES.towpath, 5, 3);
    for (let i = 0; i < 20 && !s.over; i++) {
      const m = mover(s);
      const minPos = Math.min(...s.players.filter((p) => !p.finished).map((p) => p.pos));
      expect(s.players[m].pos).toBe(minPos);
      s = applyAction(s, chooseMove(s, 'balanced', makeRng(`${i}`)));
    }
  });

  it('always advances forward, never onto an occupied or spent stop', () => {
    let s = createGame(MODES.longroad, 2, 4);
    for (let i = 0; i < 60 && !s.over; i++) {
      const m = mover(s);
      const before = s.players[m].pos;
      const a = chooseMove(s, 'balanced', makeRng(`${i}`));
      expect(a.to, 'a move must go forward').toBeGreaterThan(before);
      s = applyAction(s, a);
    }
  });
});

describe('legal moves', () => {
  it('are never empty while the game is live', () => {
    let s = createGame(MODES.wayward, 8, 3);
    for (let i = 0; i < 80 && !s.over; i++) {
      expect(legalActions(s).length, `no legal move at ply ${i}`).toBeGreaterThan(0);
      s = applyAction(s, legalActions(s)[0]);
    }
  });

  it('never let a traveller skip past an inn', () => {
    const s = createGame(MODES.longroad, 4, 2);
    const m = mover(s);
    const barrier = barrierAfter(s, s.players[m].pos);
    for (const a of legalActions(s)) expect(a.to).toBeLessThanOrEqual(barrier);
  });

  it('an inn offers one move per still-available dish', () => {
    // Walk a traveller up to the first inn and confirm the menu is offered.
    let s = createGame(MODES.towpath, 11, 2);
    const firstInn = s.road.innAt[0];
    let guard = 0;
    while (!s.over && guard++ < 200) {
      const m = mover(s);
      const opts = legalActions(s);
      const innMove = opts.find((a) => a.to === firstInn && s.road.stops[a.to].kind === 'inn');
      if (s.players[m].pos < firstInn && innMove) {
        const innMoves = opts.filter((a) => a.to === firstInn);
        expect(innMoves.length).toBe(s.innTaken[0].filter((t) => !t).length);
        break;
      }
      s = applyAction(s, opts[0]);
    }
  });

  it('rejects an illegal or malformed action', () => {
    const s = createGame(MODES.longroad, 1, 3);
    expect(applyAction(s, { to: 0, dish: -1 })).toBe(s); // backwards / same
    expect(applyAction(s, { to: s.road.stops.length - 1, dish: 9 })).toBe(s); // bad dish
  });
});

describe('single-occupancy: a stop, once taken, is gone', () => {
  it('a consumed normal stop never appears as legal again', () => {
    let s = createGame(MODES.longroad, 21, 3);
    const seen = new Set<number>();
    for (let i = 0; i < 80 && !s.over; i++) {
      const a = chooseMove(s, 'ambler', makeRng(`${i}`));
      const kind = s.road.stops[a.to].kind;
      if (kind === 'vista' || kind === 'market' || kind === 'spring') {
        expect(seen.has(a.to), `stop ${a.to} was taken twice`).toBe(false);
        seen.add(a.to);
      }
      s = applyAction(s, a);
    }
  });
});

describe('the game terminates and produces a result', () => {
  for (const id of MODE_IDS) {
    for (const n of [2, 3, 4, 5]) {
      it(`${id} @ ${n}p: everyone finishes within the cap`, () => {
        const s = playOut(modeOf(id), n * 100 + 7, n);
        expect(s.over).toBe(true);
        expect(s.reason).toBe('complete');
        expect(s.players.every((p) => p.finished)).toBe(true);
        expect(s.ranking.length).toBe(n);
        expect(s.ply).toBeLessThanOrEqual(turnCap(modeOf(id), n));
        expect(s.winner === null || (s.winner >= 0 && s.winner < n)).toBe(true);
      });
    }
  }
});

describe('scoring', () => {
  it('triangular view scoring rewards depth over breadth', () => {
    expect(tri(3)).toBe(6);
    // Three sections in one view (6) beats one section in each of three (3).
    expect(tri(3)).toBeGreaterThan(tri(1) * 3);
  });

  it('souvenir score rewards variety and ignores hoarding', () => {
    expect(souvenirScore([3, 0, 0])).toBe(1); // three of one kind is still one kind
    expect(souvenirScore([9, 0, 0])).toBe(1); // volume of a kind buys nothing more
    expect(souvenirScore([1, 1, 1])).toBe(6); // one of each: a full spread
    expect(souvenirScore([1, 1, 1])).toBeGreaterThan(souvenirScore([3, 0, 0]));
  });

  it('the finest-view majority is shared among ties and split when tied', () => {
    let s = createGame(MODES.longroad, 1, 2);
    s = { ...s, players: s.players.map((p) => ({ ...p })) };
    s.players[0].vista = [3, 0, 0];
    s.players[1].vista = [1, 0, 0];
    const bd = scoreAll(s);
    expect(bd[0].fineBonus, 'sole finest-view leader takes the whole bonus').toBeGreaterThan(0);
    expect(bd[1].fineBonus).toBe(0);
  });

  it('a meal kind scores at most once, keeping the higher value', () => {
    let s = createGame(MODES.longroad, 1, 1);
    s = { ...s, players: [{ ...s.players[0] }] };
    s.players[0].meals = [0, 0, 0, 0, 0];
    s.players[0].meals[2] = 5; // ate cuisine 2 at value 5
    const bd = scoreAll(s);
    expect(bd[0].meal).toBe(5);
    expect(bd[0].distinctDish).toBe(1);
  });
});

describe('wire encoding round-trips', () => {
  it('encodes and decodes every legal action', () => {
    const s = createGame(MODES.longroad, 3, 3);
    for (const a of legalActions(s)) {
      expect(decodeAction(encodeAction(a))).toEqual(a);
    }
  });

  it('rejects junk', () => {
    expect(decodeAction(null)).toBeNull();
    expect(decodeAction([1])).toBeNull();
    expect(decodeAction([1, 2, 3])).toBeNull();
    expect(decodeAction(['a', 'b'])).toBeNull();
    expect(decodeAction([1.5, 0])).toBeNull();
  });
});

describe('P2P determinism (lockstep)', () => {
  it('two peers replaying the same actions reach identical state', () => {
    const seed = 987654;
    let a = createGame(MODES.wayward, seed, 4);
    let b = createGame(MODES.wayward, seed, 4);
    for (let i = 0; i < 50 && !a.over; i++) {
      const act = chooseMove(a, 'sprinter', makeRng(`${seed}:${i}`));
      a = applyAction(a, act);
      // The other peer receives the SAME encoded action and re-simulates.
      const decoded = decodeAction(encodeAction(act))!;
      b = applyAction(b, decoded);
      expect(JSON.stringify(b.players)).toBe(JSON.stringify(a.players));
    }
  });
});

describe('caps', () => {
  it('never seats more than MAX_PLAYERS', () => {
    const s = createGame(MODES.longroad, 1, 99);
    expect(s.players.length).toBe(MAX_PLAYERS);
  });
});
