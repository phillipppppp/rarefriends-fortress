// How far does each build get, across play styles? `reach` is how far the notional Friend
// pushes out to intercept: 0.4 hugs the node, 1.0 chases to the spawn lanes.
import {
  createRun, startWave, step, placeTurret, turretCost, upgradeGunWithScrap, gunScrapCost,
  GUN_SCRAP_MAX, repairNode, repairCost, upgradeGun,
  NODE, MAX_TURRETS, MAX_LEVEL, TUNING, dailyModifier, type Run,
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

const TRIALS = 40;
const STYLES: Array<[string, number]> = [
  ["hugs the node", 0.4],
  ["cautious", 0.55],
  ["forward", 0.7],
  ["aggressive", 0.85],
  ["reckless", 1.0],
];

const rate = (staked: boolean, reach: number) => {
  const runs = Array.from({ length: TRIALS }, () => play(staked, reach));
  return {
    won: Math.round(runs.filter(r => r.won).length / TRIALS * 100),
    avg: (runs.reduce((t, r) => t + r.cleared, 0) / TRIALS).toFixed(1),
  };
};

for (const hp of [0.20, 0.22, 0.24, 0.26]) {
  TUNING.hpGrowth = hp;
  console.log(`\n=== health growth ${hp.toFixed(2)} ===`);
  console.log("style            scrap-only (gun L4)      staked (gun L8)");
  for (const [name, reach] of STYLES) {
    const a = rate(false, reach), b = rate(true, reach);
    console.log(
      `  ${name.padEnd(14)} wave 9 ${String(a.won).padStart(3)}%  avg ${a.avg.padStart(4)}     wave 9 ${String(b.won).padStart(3)}%  avg ${b.avg.padStart(4)}`);
  }
}
