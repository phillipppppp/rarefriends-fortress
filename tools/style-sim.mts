// How far does each build get, across play styles? `reach` is how far the notional Friend
// pushes out to intercept: 0.4 hugs the node, 1.0 chases to the spawn lanes.
// This reproduces the tables in the README and the submission write-up.
import {
  createRun, startWave, step, placeTurret, turretCost, upgradeGunWithScrap, gunScrapCost,
  GUN_SCRAP_MAX, repairNode, repairCost, upgradeGun,
  NODE, MAX_TURRETS, MAX_LEVEL, dailyModifier, type Run,
} from "../games/fortress/combat.ts";

const DT = 1 / 60;
const SPOTS = [
  { x: NODE.x - 52, y: NODE.y - 40 }, { x: NODE.x + 52, y: NODE.y - 40 },
  { x: NODE.x - 52, y: NODE.y + 40 }, { x: NODE.x + 52, y: NODE.y + 40 },
  { x: NODE.x - 68, y: NODE.y },
];
const modifier = dailyModifier(new Date(Date.UTC(2026, 8, 26)));

function threat(run: Run, reach: number) {
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

function play(staked: boolean, reach: number) {
  const run = createRun();
  startWave(run, 1);
  for (let seconds = 0; seconds < 600; seconds += DT) {
    step(run, DT, threat(run, reach), modifier);
    spend(run);
    if (staked && run.phase === "respite" && run.gun < MAX_LEVEL) upgradeGun(run);
    if (run.phase === "lost") break;
    if (run.phase === "briefing") {
      if (run.cleared >= 9) break;
      startWave(run, run.cleared + 1);
    }
  }
  return { cleared: run.cleared, won: run.cleared >= 9 && run.phase !== "lost" };
}

// 600 trials: at 120 the top three styles swap places run to run purely from noise.
const TRIALS = 600;
const STYLES: Array<[string, number]> = [
  ["hugs the node", 0.4],
  ["cautious", 0.55],
  ["forward", 0.7],
  ["aggressive", 0.85],
  ["reckless", 1.0],
];

const rate = (staked: boolean, reach: number) => {
  const runs = Array.from({ length: TRIALS }, () => play(staked, reach));
  const share = (test: (c: number) => boolean) =>
    Math.round(runs.filter(r => test(r.cleared)).length / TRIALS * 100);
  return {
    won: Number((runs.filter(r => r.won).length / TRIALS * 100).toFixed(1)),
    wave8: share(c => c >= 8),
    avg: (runs.reduce((t, r) => t + r.cleared, 0) / TRIALS).toFixed(1),
  };
};

console.log(`\n${TRIALS} runs per cell, daily modifier ${modifier.name}\n`);
console.log("play style        scrap-only (gun L4)          staked (gun L8)");
console.log("                  wave8  wave9   avg           wave8  wave9   avg");
for (const [name, reach] of STYLES) {
  const a = rate(false, reach), b = rate(true, reach);
  console.log(
    `  ${name.padEnd(15)} ${String(a.wave8).padStart(3)}%  ${a.won.toFixed(1).padStart(5)}%  ${a.avg.padStart(4)}`
    + `          ${String(b.wave8).padStart(3)}%  ${b.won.toFixed(1).padStart(5)}%  ${b.avg.padStart(4)}`);
}
console.log("\nCamping the node is the failure case; the scrap-only wall sits below wave 8.");
