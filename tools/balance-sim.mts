// Simulates whole defence runs headlessly to tune difficulty before touching the game.
// The notional player now spends scrap the way a real one can: early gun levels first
// because they are the best value, then turrets, then repairs when the node is hurt.
import {
  createRun, startWave, step, rollsFor, placeTurret, turretCost,
  upgradeGunWithScrap, gunScrapCost, GUN_SCRAP_MAX, repairNode, repairCost,
  NODE, FINAL_WAVE, MAX_TURRETS, dailyModifier,
  type Modifier, type Run,
} from "../games/fortress/combat.ts";

const DT = 1 / 60;
const SPOTS = [
  { x: NODE.x - 52, y: NODE.y - 40 }, { x: NODE.x + 52, y: NODE.y - 40 },
  { x: NODE.x - 52, y: NODE.y + 40 }, { x: NODE.x + 52, y: NODE.y + 40 },
  { x: NODE.x - 68, y: NODE.y },
];

type Skill = "good" | "average" | "idle";

/** Moves the notional Friend toward whichever enemy is closest to the node. */
function nearestThreat(run: Run, reach: number) {
  let best = { x: NODE.x, y: NODE.y }, bestAway = Infinity;
  for (const enemy of run.enemies) {
    const away = Math.hypot(enemy.x - NODE.x, enemy.y - NODE.y);
    if (away < bestAway) { bestAway = away; best = { x: enemy.x, y: enemy.y }; }
  }
  return { x: NODE.x + (best.x - NODE.x) * reach, y: NODE.y + (best.y - NODE.y) * reach };
}

/** One scrap decision per tick, in the order a sensible player would take them. */
function spend(run: Run) {
  if (run.nodeHp <= run.nodeMaxHp * 0.45 && run.scrap >= repairCost(run.repairs)) {
    if (repairNode(run)) return;
  }
  if (run.gun < GUN_SCRAP_MAX && run.scrap >= gunScrapCost(run.gun)) {
    if (upgradeGunWithScrap(run)) return;
  }
  if (run.turrets.length < Math.min(MAX_TURRETS, SPOTS.length) && run.scrap >= turretCost(run, "pulse")) {
    const spot = SPOTS[run.turrets.length];
    if (placeTurret(run, spot.x, spot.y, "pulse")) return;
  }
  if (run.nodeHp < run.nodeMaxHp && run.scrap >= repairCost(run.repairs)) repairNode(run);
}

function playRun(modifier: Modifier, skill: Skill, pushTo: number) {
  const run = createRun();
  startWave(run, 1);
  let seconds = 0;
  while (seconds < 600) {
    const friend = skill === "idle"
      ? { x: NODE.x, y: NODE.y }
      : nearestThreat(run, skill === "good" ? 0.85 : 0.55);
    step(run, DT, friend, modifier);
    seconds += DT;
    if (skill !== "idle") spend(run);
    if (run.phase === "lost") break;
    if (run.phase === "briefing") {
      if (run.cleared >= pushTo || run.cleared >= FINAL_WAVE) break;
      startWave(run, run.cleared + 1);
    }
  }
  return {
    cleared: run.cleared, lost: run.phase === "lost", nodeHp: run.nodeHp,
    seconds, turrets: run.turrets.length, gun: run.gun, repairs: run.repairs,
  };
}

const modifiers = [0, 1, 2, 3].map(offset => dailyModifier(new Date(Date.UTC(2026, 8, 25 + offset))));

console.log("=== can a run reach each stage? (20 trials each) ===\n");
for (const skill of ["good", "average", "idle"] as const) {
  for (const target of [3, 6, 9]) {
    const results = Array.from({ length: 20 }, () => playRun(modifiers[0], skill, target));
    const survived = results.filter(r => !r.lost).length;
    const avg = (key: "nodeHp" | "seconds" | "turrets" | "gun" | "repairs") =>
      (results.reduce((t, r) => t + (r[key] as number), 0) / results.length);
    console.log(
      `${skill.padEnd(8)} push to wave ${target}: survived ${String(survived).padStart(2)}/20 · node ${avg("nodeHp").toFixed(0).padStart(3)} · ${avg("seconds").toFixed(0).padStart(3)}s · gun L${avg("gun").toFixed(1)} · ${avg("turrets").toFixed(1)} turrets · ${avg("repairs").toFixed(1)} repairs · recovers ${rollsFor(results[0].cleared)} Cells`);
  }
  console.log();
}

console.log("=== daily modifiers, good player pushing to 9 ===");
for (const modifier of modifiers) {
  const results = Array.from({ length: 20 }, () => playRun(modifier, "good", FINAL_WAVE));
  const survived = results.filter(r => !r.lost).length;
  const avgCleared = (results.reduce((t, r) => t + r.cleared, 0) / results.length).toFixed(1);
  console.log(`${modifier.name.padEnd(7)} survived ${String(survived).padStart(2)}/20 · avg wave cleared ${avgCleared}`);
}
