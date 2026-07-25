# Game Plan: Amble

## Overview
- **Name:** Amble
- **Repo name:** amble
- **Tagline:** An unhurried journey down one long road — but the traveller furthest behind always goes next, so every stop you race to is a turn you hand your rivals.
- **Genre (directory category):** board

## Core Loop
You are a traveller on a single one-way road of numbered stops. On your turn you advance your token
**forward to any open stop you like** and take that stop's little reward (paint a view, pick up a
souvenir, soak in a spring). Then — the signature rule — the turn passes to **whoever is now furthest
behind**. So a short hop keeps you at the back and hands you *another* turn soon; a long leap grabs a
coveted distant stop before a rival can, but then you sit idle while everyone behind you takes many
turns and mops up all the stops you skipped. Stops are single-occupancy, so being there when a rival
passes denies it to them — and the road is one-way, so they never come back for it. The whole game is
the tension of *how much do I give up to reach that one spot first* — no dice, no combat, no attacks.

The road is punctuated by a few **inns** (gather points) you cannot skip: everyone must stop at each
inn, and the meal menu there is **first-come**, so the traveller who rushed ahead eats best. That
re-levels the field and gives the journey a rhythm of chapters. Win by scoring the most at the end of
the road across several set-collection routes.

Win condition: highest total score when every traveller has reached the end. Lose: someone scores
more. No sudden death — the whole road is played out.

## Controls
- **Primary input:** touch — tap an open stop ahead to travel there; at an inn, tap a dish. **Why
  touch and not a sensor (principle #23):** this is a turn-based, zero-hidden-information board game
  whose entire verb is "choose a spot on the map"; a tilt/shout/shake would be noise bolted onto a
  deliberative game. The last sensor build (uproar) was only two runs ago, so the fleet is not overdue
  a sensor. Touch is chosen on purpose, not by default.
- **Desktop:** number keys / arrow keys to move the highlight between reachable stops, Enter to travel;
  the same tap targets are clickable.
- **Mobile:** direct tap on the stop disc (hit target ≥44px, expanded independent of the drawn size).
  A vertical road that scrolls, with the active traveller's reachable stops glowing. No D-pad (there
  is no continuous avatar) and no reach-across "point where to go" — you tap the destination itself,
  which is the natural gesture for a map.

## Multiplayer
- **Mode:** live P2P (2–5) **and** solo-vs-bots **and** async-seed (share a seed, everyone plays the
  same road, compare final scores).
- **Shape:** **versus** — 2–5 travellers competing for a shared, finite pool of stops on one board.
  Why versus and not co-op: the scarcity *is* the game (single-occupancy stops on a one-way road, a
  first-come inn menu). There is nothing to co-operate on — every stop one traveller takes is one
  another cannot — so a shared-fate co-op would erase the only decision. The "furthest-behind moves
  next" catch-up device keeps a versus game from snowballing without needing a co-op framing.
- **Topology:** **lockstep**. Zero randomness in play and zero hidden information — the road, every
  stop and every inn menu are pure functions of the shared seed — so a turn is fully described by
  `{to, dish}` and every peer re-simulates it through `game.ts`. **No board state ever crosses the
  wire**, so there is structurally nothing to desync; an illegal packet is rejected, not absorbed; and
  host transfer is a pure display concern because the promoted peer already holds a byte-identical
  board. All the host owns is the **clock** (the per-turn timer + auto-move for a vanished seat).
- **Channels:** `mv` (a `[to, dish]` wire action, ≤12 bytes). That is the only gameplay channel.
- **Room entry:** all three ways in — scan the lobby QR, open the invite link, or type the 4-char
  code (`createRoomEntry` + `normalizeRoomCode`). QR is free from the stock lobby.
- **Late joiner:** connects mid-round → `seated:false` → spectates with the live board, readies for the
  next round. Handled by the engine's `RoundInfo.seated`.
- **Host leaves:** `net.ts` re-elects at epoch+1 and fires `onHostChange`; `Match.setHost(true)` makes
  the survivor authoritative — it resumes the turn clock and the abandonment timer and can drive the
  round (auto-moving vanished seats) all the way to the end. Proven by `takeover.test.ts` and the
  manual host-leave smoke test.
- **End of round → rematch:** "Play again" is a **vote inside the living room** via
  `@ben-gy/game-engine/rematch` — it never touches the Net. Quorum + a visible countdown starts the
  next round (host can force-start); a straggler who never votes cannot hold the room (the round starts
  without them, they spectate); the host broadcasts the new seed **and the frozen roster** so seat
  indices match on every peer. A **running match tally** (wins per seat) persists across rounds.
  "Back to lobby" does not leave the room; "Main menu" does. The results screen shows **every
  player's full breakdown** (principle #9), not just yours, plus the retrospective best line.

## Juice Plan
- Procedural SFX (`@ben-gy/game-engine/sound`): `select` on picking a stop, `coin` on a souvenir,
  `jump` on travelling, `powerup` on completing a panorama section / eating a top dish, `blip` on
  invalid, `win`/`lose` on results. Muted toggle persisted.
- The token slides along the road with an eased tween; the road auto-scrolls to keep the active
  traveller in view.
- Particle burst in the stop's colour on landing; a bigger burst + brief screen-shake when a panorama
  deepens or the finest-view lead changes. All shake/particles respect `prefers-reduced-motion`.
- 3-2-1-GO count-in (`countdown.ts`, principle #15) with audio between the host's start and play.
- A soft lantern glow pulses on reachable stops so "it's your move" reads instantly.

## Style Direction
**Vibe:** cozy / clean-minimal in the spirit of Edo-period woodblock landscape prints — flat layered
colour planes, lots of negative space, a warm paper page.
**Palette:** a light cream **paper** page with a dark ink **road** winding down it; each waypoint is a
bright, saturated disc with a dark-ink icon; travellers are bright lantern-pawns with a dark ring and a
numeral. Bright-on-dark-road gives every mark ≥3:1 and each stop kind also carries a distinct **icon**,
so meaning survives colour-blindness. Seat colours from an Okabe-Ito-derived set.
**Theme:** light (paper) page, dark road — a deliberate differentiator from the fleet's many dark games.
**Reference feel:** the serenity of a woodblock travel print and the gentle set-collection of a good
tableau game — feel only, no IP, all art procedural.

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite.
- **Render:** Canvas 2D — a vertical scrolling road with layered landscape planes, tweened tokens and
  particles suit canvas; DOM is used for menus/HUD/results.
- **Engine modules (imported, never copied):** net, rematch, turn, lobby, qr (via lobby), rng, sound,
  storage, mobile. `loop`/`input`/`joystick`/`drag` not needed (tap-to-a-target, no continuous avatar).
- **Persistence:** localStorage via `storage.ts` — mute, name, last mode, solo best score, seen-help.

## The stops & scoring (the set-collection routes)
- **Vista** (3 views — Sea, Hills, Dusk): landing paints the next section of that view; your depth in a
  view scores triangularly (`n(n+1)/2`), so **depth beats breadth** — commit to a view. End majority:
  *finest view* (deepest single view) shares a bonus.
- **Market** (3 souvenir kinds): landing gives that kind; end scoring rewards **variety** — greedily
  formed sets of distinct kinds score `[1,3,6]` by size, so a balanced spread beats hoarding one.
- **Spring:** flat points each; end majority: *most springs* shares a bonus (a contested race).
- **Inn** (gather points, first-come menu): pick a dish; each dish **kind scores once** per journey, so
  breadth of dishes matters, and arriving first gets the higher-value dish. The anti-ambler force.

Several genuinely different routes to a win: deep-view committer, souvenir-variety collector, spring
grinder, meal-breadth rusher — which one wins depends on the seed and what rivals contest.

## Modes (3, real spread — principle #14)
- **Towpath:** short road (~28 stops, 2 inns), spring-heavy mix — quick, the majority races dominate.
- **Long Road:** long road (~44 stops, 3 inns), vista/market-rich — the full journey, deep panoramas
  and meal breadth pay off.
- **Wayward:** medium road (~36, 2 inns) where the vista views are **scattered/shuffled** per seed
  instead of clustered, so you cannot chain a panorama on autopilot — a routing puzzle that changes
  every seed. This is the idea's "shuffled panoramas" variant.
The host's pick travels frozen inside the round start (`roundOpts`); guests render the host's gossiped
choice, never their own.

## Non-Goals
- No economy/currency layer (the cost of everything is *time*/position, not coins).
- No hidden information, no dice, no direct attacks.
- No continuous/real-time movement — purely turn-based.

## How To Play (player-facing copy)
Travel down the road, tapping any open stop ahead to go there and collect what it offers. Then whoever
is **furthest behind** goes next — so racing ahead for a prize means sitting still while rivals mop up
everything you skipped. You must stop at every inn; the first to arrive gets the best meal. Build one
view deep, collect a spread of souvenirs, soak in springs, eat well — most points at the end of the
road wins.
