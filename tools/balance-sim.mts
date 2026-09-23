// Simulates whole defence runs headlessly to tune difficulty before any UI exists.
// A "player" here holds position near the node and builds turrets when it can afford them.
import {
  createRun, startWave, step, rollsFor, placeTurret, upgradeTurret,
  NODE, STAGE_WAVES, FINAL_WAVE, TURRET_COST, TURRET_UPGRADE_COST, dailyModifier,
  type Modifier, type Run,
} from "../games/fortress/combat.ts";

const DT = 1 / 60;
const SPOTS = [
  { x: NODE.x - 52, y: NODE.y - 40 }, { x: NODE.x + 52, y: NODE.y - 40 },
  { x: NODE.x - 52, y: NODE.y + 40 }, { x: NODE.x + 52, y: NODE.y + 40 },
  { x: NODE.x - 62, y: NODE.y }, { x: NODE.x + 62, y: NODE.y },
];

type Skill = "good" | "average" | "idle";

function playRun(modifier: Modifier, skill: Skill, pushTo: number) {
  const run = createRun();
  startWave(run, 1);
  let seconds = 0;

  while (seconds < 600) {
    // The Friend hovers near the node; a good player intercepts, an idle one does not move.
    const friend = skill === "idle"
      ? { x: NODE.x, y: NODE.y }
      : nearestThreat(run, skill === "good" ? 1 : 0.55);

    step(run, DT, friend, modifier);
    seconds += DT;

    // Spend scrap as it arrives.
    if (skill !== "idle") {
      if (run.scrap >= TURRET_COST && run.turrets.length < SPOTS.length) {
        const spot = SPOTS[run.turrets.length];
        placeTurret(run, spot.x, spot.y);
      } else if (run.scrap >= TURRET_UPGRADE_COST) {
        const weakest = [...run.turrets].sort((a, b) => a.tier - b.tier)[0];
        if (weakest) upgradeTurret(run, weakest.id);
      }
    }

    if (run.phase === "lost") break;
    if (run.phase === "briefing") {
      if (run.cleared >= pushTo || run.cleared >= FINAL_WAVE) break;
      startWave(run, run.cleared + 1);
    }
  }
  return { cleared: run.cleared, lost: run.phase === "lost", nodeHp: run.nodeHp, seconds, turrets: run.turrets.length };
}

/** Moves the notional Friend toward whichever enemy is closest to the node. */
function nearestThreat(run: Run, reach: number) {
  let best = { x: NODE.x, y: NODE.y }, bestAway = Infinity;
  for (const enemy of run.enemies) {
    const away = Math.hypot(enemy.x - NODE.x, enemy.y - NODE.y);
    if (away < bestAway) { bestAway = away; best = { x: enemy.x, y: enemy.y }; }
  }
  return { x: NODE.x + (best.x - NODE.x) * reach, y: NODE.y + (best.y - NODE.y) * reach };
}

const modifiers = [0, 1, 2, 3].map(offset =>
  dailyModifier(new Date(Date.UTC(2026, 8, 23 + offset))));

console.log("=== can a run reach each stage? (20 trials each) ===\n");
for (const skill of ["good", "average", "idle"] as const) {
  for (const target of [...STAGE_WAVES]) {
    const results = Array.from({ length: 20 }, () => playRun(modifiers[0], skill, target));
    const survived = results.filter(r => !r.lost).length;
    const avgHp = (results.reduce((t, r) => t + r.nodeHp, 0) / results.length).toFixed(0);
    const avgSecs = (results.reduce((t, r) => t + r.seconds, 0) / results.length).toFixed(0);
    console.log(`${skill.padEnd(8)} push to wave ${target}: survived ${survived}/20 · node hp left ${avgHp} · ${avgSecs}s · rolls ${rollsFor(results[0].cleared)}`);
  }
  console.log();
}

console.log("=== daily modifiers, good player pushing to 9 ===");
for (const modifier of modifiers) {
  const results = Array.from({ length: 20 }, () => playRun(modifier, "good", FINAL_WAVE));
  const survived = results.filter(r => !r.lost).length;
  const avgCleared = (results.reduce((t, r) => t + r.cleared, 0) / results.length).toFixed(1);
  console.log(`${modifier.name.padEnd(7)} survived ${survived}/20 · avg wave cleared ${avgCleared}`);
}
