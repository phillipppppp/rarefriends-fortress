# Friend Fortress

Your Friend guards a crystal node from waves of glitches — **not as a sprite in the scene, but as the
weapon.** It fires automatically at anything in range — a deliberately short range — so where you
stand decides how much of a wave you actually stop. Turrets only ever fill the gaps you leave.

Built with [FriendSDK](https://github.com/spokesz/friendsdk) v0.1.2 for the Rare Friends Vibeathon.

- **Playable preview:** **https://phillipppppp.github.io/rarefriends-fortress/**
- **Builder:** [@phillipppppp](https://github.com/phillipppppp)
- **Category:** Token Activity

Every run spends Power Cells — one to start, one per roll banked — and runs are short and repeatable by design, so the token leaves circulation continuously rather than once.

![Your Friend defending the node mid-wave](docs/combat.png)

---

## The loop

1. **Buy a Power Cell** at the Generator — 1 RF each.
2. **Start a defence run** at the Node.
3. **Waves arrive from four lanes.** Your Friend auto-fires; you reposition to intercept and to keep
   the node covered. Turrets are support, bought with scrap earned inside the run rather than with RF.
4. **After wave 3, choose:** bank your reward, or push deeper.



Each roll spends one Power Cell. **Losing the node still pays for the waves you cleared**, so pushing
risks time and cells, never everything.

## Why depth buys rolls rather than better odds

The obvious design is "deeper runs get better odds." The SDK does not allow it: `game.json` defines one
fixed outcome table and the client enforces it, so shifting weights by performance would mean paying out
RF the client never issued. Buying **more rolls** raises expected reward honestly, keeps the published
table true, and leaves the bank-or-push tension intact.

## Controls

Walk with **WASD**, arrow keys, or tap anywhere on the ground. Stand near a station and an
**Enter** button appears in the HUD; **E** does the same. During a run, tap **Build** and then tap
open ground near the node to place a turret. Tap a placed turret to upgrade or merge it.

**A How to Play card opens on load**, before anything else: four lines covering the goal, the
controls, what scrap buys and the bank-or-push choice. It names taps on a phone and keys on a
desktop, decided by a media query rather than a guess about the device. Close it with **Got it**,
the **X**, or **Escape**, and reopen it any time from the **?** in the HUD.

**Escape** closes whatever is open, one layer at a time — the turret panel first, then a menu —
and does nothing when nothing is open. It deliberately never interferes with the SDK's purchase
confirmation, which is the host's to dismiss. Every panel keeps its own close control, so touch
is never left without a way out.

Stations deliberately have no floating label over the world. The SDK prompt is sized in CSS pixels
while the world canvas scales down, so on a phone one prompt covers roughly 300x85 canvas pixels and
swallows the taps that are the only way to walk. Keeping the action in the HUD leaves the whole
canvas tappable.

## The economy

One Power Cell costs **1 RF**.

| Salvage | Chance | Redeems for |
|---|---:|---:|
| Slag Fragment | 16% | 0 RF |
| Cracked Core | 29% | 0.30 RF |
| Charged Cell | 26% | 0.70 RF |
| Focus Lens | 18% | 1.50 RF |
| Prime Shard | 9% | 2.90 RF |
| Node Heart | 2% | 5.00 RF |

**Expected reward 0.90 RF against a 1 RF price — a 10% house edge**, matching both shipped SDK examples
and verified by the SDK's own `expectedReward`.

## Staking, and why the top prize is 5 RF

Every Cell you commit becomes a **pending play**. Starting a run stakes one; each gun upgrade
stakes more. **Depth decides how many you are allowed to settle**, so the stake is a bet on how
far the run will get:

| Bank at | Cells recoverable |
|---|---|
| Wave 3 | 3 |
| Wave 6 | 7 |
| Wave 9 | 11 |

Match your stake to the depth you can reach and you lose only the 10% house edge. Over-stake and
fall short, and the difference is forfeited — that is the sink.

| Staked | Bank at | RF out | RF back | Net | Break-even |
|---|---|---|---|---|---|
| 1 | any | 1 | 0.90 | −0.10 | 29% |
| 4 | wave 6 | 4 | 3.61 | −0.39 | 37% |
| 7 | wave 6 | 7 | 6.29 | −0.71 | 35% |
| 11 | wave 9 | 11 | 9.89 | −1.11 | 34% |
| 11 | wave 3 | 11 | 2.70 | −8.30 | 0% |

**No configuration can be net-positive in expectation** — every Cell returns 0.90 against a 1 RF
cost, and the SDK will not let a game alter that. What staking buys is *more shots at the table*,
which is why break-even rises from 10% on a plain run to 34–37% on a well-judged one.

The top prize is deliberately **5 RF rather than 10**. A pending play holds the maximum prize of
backing until it settles, so an 8.1 RF prize capped the stake at ten pending plays; 5 RF allows
eleven while keeping expected reward at exactly 0.900.


### Two currencies, deliberately

**Scrap** is earned inside a run and never costs RF. **Cells** cost RF and are staked.

| Bought with scrap | Cost |
|---|---|
| Gun levels 2–4 | 25 / 45 / 75 — available any time, including mid-wave |
| Turret placement | base × 1.6 per turret standing: Pulse 30 → 48 → 77 → 123 → 197 |
| Node repair (+15 HP) | 20, rising by 10 each time |

| Staked in Cells | Cost |
|---|---|
| Gun levels 5–8 | 2 / 2 / 3 / 3 — between waves only |
| Turret upgrades | 1 / 1 / 1 / 1 / 2 / 2 / 2 |
| Merging | free |

Scrap income climbs steeply — about 120 by wave 3 and 819 by wave 9 — so every scrap cost
**escalates**. A flat price stops competing with anything by wave 6. At 120 scrap you can afford
two Pulses, *or* gun L2+L3, *or* three repairs, never all three.

**Staking is what unlocks the deepest waves.** Simulated over 120 runs per profile, playing the
Friend forward:

| Build | Reaches wave 8 | Clears wave 9 | Average wave |
|---|---|---|---|
| Scrap only, gun capped at L4 | **0%** | **0%** | 6.8 |
| Staked build, gun to L8 | **100%** | **≈82%** | 8.8 |

A scrap-only run clears waves 3 and 6 comfortably and then stalls around wave 7. **It cannot reach
wave 8 at all**, and this is a hard wall rather than a difficulty setting: the L4 gun tops out at
roughly 386 damage per second against the staked build's 668, and no amount of scrap spent on
turrets or repairs closes that gap. Staking Cells on gun levels 5–8 is the only route past it, and
even then wave 9 fails about one run in six — so the stake is a real bet, not a formality.

This is a design choice worth naming plainly: scrap-only play is a complete, repeatable game up to
wave 7, not a viable path to the deepest reward.

### What happens to pending plays

A run always settles every play it staked. The first *recoverable* become your reward; the rest
are settled with their outcome shown but never redeemed, so the backing they held is released
rather than stranded. **If you quit mid-run**, those plays stay pending and keep holding backing —
so the next run you start settles them first, discarding them, before staking anew. Nothing is
left hanging, and purchases never silently stop working.

## Difficulty, measured rather than guessed

`combat.ts` is pure simulation with no DOM, so whole runs can be played headlessly. That is how the curve
was tuned before any pixel existed.

```bash
node tools/balance-sim.mts
```

Survival by how far the Friend pushes out from the node, staked build, 600 runs per row:

| Play style | Clears wave 9 | Average wave |
|---|---|---|
| Hugs the node | **≈2%** | 8.0 |
| Cautious | ≈70–75% | 8.7 |
| Forward | ≈80–85% | 8.8 |
| Aggressive | ≈80–85% | 8.8 |
| Chases to the spawn lanes | ≈80–85% | 8.8 |

**Camping the node is what fails** — about 2% against about 82%. With the gun's range cut to 68
units, standing on the node means most of each wave is simply never engaged, and the node soaks
damage the Friend should have absorbed. That one decision is the skill the game actually asks for.

The ranges are deliberate. Repeated 600-run batches move the bottom three rows by up to five points
either way, so **forward, aggressive and chasing are indistinguishable from each other** — the game
rewards leaving the node, not pushing to any particular distance. Reporting them as a ranking would
be reading noise. The simulated Friend also teleports to the ideal intercept and never mistimes a
move, so a human chasing the spawn lanes pays a cost the sim does not model.

The simulation also showed combat was fully deterministic, with every wave identical between runs, so
spawn position and health now carry a little jitter. Runs vary without becoming lotteries.

A **daily modifier** — Steady, Swarm, Dense or Lean — is derived from the UTC date, so it is the same for
everyone that day and needs no server.

## Checks

`game/` is a FriendSDK game directory, so these run once it sits in a FriendSDK workspace
(`npm i -g friendsdk`, then point the commands at wherever it is checked out):

```bash
npx tsc -p game/tsconfig.json   # typecheck
npx friendsdk check game        # manifest, expected reward, bundle size
npx friendsdk test  game
node tools/balance-sim.mts      # headless difficulty simulation
node tools/style-sim.mts        # clear rates by play style, 600 runs per row
node tools/loop-e2e.mts         # buy, run, fight, bank, settle, in the real runtime
node tools/effects-audit.mts    # effects present, performant, and off under reduced motion
node tools/esc-audit.mts        # Escape closes the topmost layer and nothing else
node tools/help-audit.mts       # How to Play: opens first, names the right controls, closes 3 ways
node tools/controls-audit.mts   # live regions, mute, and reduced motion both ways
node tools/tap-audit.mts        # every tap reaches the world at 390px and 960px
node tools/merge-e2e.mts        # merging two turrets, at phone and desktop widths
node tools/stake-e2e.mts        # what stakes a Cell, what recovers one, what forfeits
node tools/placement-test.mts   # placement refusals name the real reason
node tools/turrets-e2e.mts      # both turret types place and confirm
node tools/sound-audit.mts      # every cue actually reaches Web Audio
```

`loop-e2e` drives the real sandboxed runtime: it buys Power Cells, starts a run, confirms enemies spawn
and the overlay actually paints, waits for the bank-or-push choice, then banks and settles the rolls
through `play`/`settle`.

## How the Friend is rendered as the fighter

The SDK paints the Friend onto its own `<canvas>`, so combat is drawn on a second transparent canvas
stacked exactly over it. Each frame reads the live Friend position the runtime publishes and projects
enemies, beams, turrets and the node through the SDK's exported `project()`. Nothing reaches into the
SDK canvas, the parent page, or the wallet.

## Effects, and how they stay out of the way

Four decorative touches, and nothing that changes how the game plays:

| Effect | What it does |
|---|---|
| Hit flash | An enemy that survives a hit flashes white for 0.14s |
| Death burst | A ring expands where an enemy dies, over 0.32s |
| Wave banner | The wave number sweeps across the arena once, for 1.15s |
| Gun pulse | Levelling the gun lights the arena edge for 0.62s |

**None of it touches `combat.ts`.** Hits are detected in the renderer by comparing each enemy's
health with the previous frame, so the simulation is still the only thing that decides balance and a
visual change cannot move a number. At gun L1 a 52-damage shot kills a 44hp mote outright, so early
waves show bursts and flashes only begin once health scaling lets something survive a hit — the
feedback distinguishes a hit from a kill for free.

**Reduced motion removes them rather than freezing them.** The frame loop reads the setting through
a ref, so toggling it never restarts the loop, and switching it on clears whatever is already on
screen. The banner and the pulse are not rendered at all, not merely un-animated.

**Measured rather than assumed.** At 390px the game holds the display's full 60fps with a median
and 95th-percentile frame of 17ms. The cost of the effects is measured by repeating the same
reading with reduced motion on and comparing: **within ±2%, which is measurement noise.** That
comparison is the real test — an absolute frame-rate floor would only tell you how busy the
machine was. Bursts are capped at 24 so a heavy wave cannot grow the draw list without bound, and
the flash refills the path already built for the enemy instead of constructing a second one.

The first version of this measurement reported 120fps, which was wrong: several callbacks share one
animation frame and each was counted, doubling the apparent rate. Only a change of timestamp counts
as a frame now.

```bash
node tools/effects-audit.mts    # all four effects, at 390px and 960px
```

## Simulated mechanics and known issues

**All balances, purchases and rewards are simulated**, as the SDK preview client intends. No RF moves.
Wallet connection, NFT ownership verification and Friend selection are handled entirely by the SDK
runtime and are not reimplemented here.

- **Content is deliberately small.** Three enemy kinds: motes throughout, shards from wave 4 and
  hulks from wave 5. Two turret types, Pulse and Arc, both buildable, upgradeable and mergeable.
  Nine waves is the full run; there is no endless mode.
- **Run progress does not survive a reload.** The SDK preview ledger is held in memory.
- **The game does not load inside MetaMask's in-app mobile browser.** The SDK renders games in
  `<iframe sandbox="allow-scripts">` and the bridge handshake does not complete there. It works in
  Chromium and WebKit at desktop and phone viewports, so it is that app's webview rather than the
  engine, and it affects every FriendSDK game equally. Desktop with a browser-extension wallet works.

## Credits

Built on [FriendSDK](https://github.com/spokesz/friendsdk) (Apache-2.0). World scenery, character sprites
and the sound kit are the SDK's. Combat simulation, economy, overlay renderer, wave design and the
bank-or-push structure are original to this submission.
