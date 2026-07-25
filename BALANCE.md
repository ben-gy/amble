# Amble — balance record

The balance sim (`tests/helpers/sim.ts`) was built FIRST and overruled the design.
The idea's own balance flag (a) was the exact failure it caught.

## The finding: unbounded turns = ambling wins 100%

"Furthest-behind moves next" is such a strong catch-up device that, with no limit on
how many stops a traveller may claim, a player who only ever takes the **shortest
hop** banks unlimited extra turns and harvests almost the whole road. Measured, over
120 seeds × 3 modes:

- `ambler` vs `balanced` (2p): **100% / 0%** in every mode.
- Debug of one game: the ambler took **41 landings to the leaper's 6** — a 6× turn
  advantage. It filled every scoring bucket; the leaper could not.

Capping the scoring routes (single deepest view, distinct-only souvenirs, diminishing
springs, a steep first-come inn gradient) improved the *leader-decided-early* curve
but did **not** touch ambling dominance — because the dawdler still filled the capped
buckets while the leaper, with far fewer turns, could not.

## The fix: a claim budget conserves turns

Every traveller may claim the **same number of open-road stops** (inns are free and
mandatory). Turn ORDER still comes from furthest-behind; turn COUNT is now equal. The
only decision left is *which* stops to spend your claims on — race far for a prize
(handing the turn to those behind) or take the sure thing near.

A second, quieter bug hid inside this: `clonePlayer` dropped the new `claims` field,
so `NaN >= budget` was always false and the budget silently never fired (the ambler
still had 18 claims to the budget's 9). Fixed, and pinned by the rules tests that
assert equal landings and the balance tests that would revert to 100% ambling.

## Final numbers (n=60 per cell, replicated across families, 4p seat arm at n=200)

- **No pure style dominates.** Adaptive `balanced` wins 56-67% of longroad/wayward and
  beats the pure extremes; `ambler` (nearest) edges the short spring-heavy Towpath
  (~60%) but never runs away; `sprinter` (always overshoot) is a genuinely weak style,
  not a dominant one. Rushing is correct *when the right stop is far* — which
  `balanced` does, and wins — so it is not strictly dominated (flag a satisfied).
- **Skill beats random** 97-99%.
- **Seat fairness:** at n=400 every 4p seat lands 22-30%; the start order (seed-shuffled)
  favours no one. An 8% seat at n=60 was pure sampling noise.
- **Not decided early:** leader at 30% of the road wins 43-54% of the time (near
  chance), rising to 84-98% at 85% — that curve is the drama.
- Blowouts bounded (<40% at 3p), every run terminates.
