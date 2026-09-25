/**
 * Wave-defense simulation, in world coordinates and free of any DOM.
 * The SDK owns the Friend position and movement; this module owns everything else, so it
 * can be stepped deterministically in tests without a browser.
 */
export type Vec = Readonly<{ x: number; y: number }>;

export type Enemy = {
  id: number; x: number; y: number; hp: number; maxHp: number;
  speed: number; damage: number; scrap: number; kind: "mote" | "shard" | "hulk";
};
export type Shot = { id: number; x: number; y: number; tx: number; ty: number; life: number; power: number };
export type TurretKind = "pulse" | "arc";
export type Turret = { id: number; x: number; y: number; tier: number; cooldown: number; kind: TurretKind };

/**
 * Pulse is the reliable single-target option. Arc trades range and rate for hitting a
 * cluster at once, which is what makes placement a decision rather than a formality.
 */
export const TURRETS: Record<TurretKind, { label: string; cost: number; range: number; power: number; cooldown: number; splash: number; blurb: string }> = {
  pulse: { label: "Pulse", cost: 14, range: 78, power: 18, cooldown: 0.9, splash: 0, blurb: "Single target, steady rate." },
  arc: { label: "Arc", cost: 24, range: 62, power: 13, cooldown: 1.25, splash: 34, blurb: "Shorter reach, hits a cluster." },
};

export type RunPhase = "briefing" | "wave" | "respite" | "lost" | "banked";

export type Run = {
  phase: RunPhase;
  wave: number;
  /** Enemies still to release in this wave. */
  pending: number;
  spawnTimer: number;
  respiteTimer: number;
  nodeHp: number;
  nodeMaxHp: number;
  scrap: number;
  enemies: Enemy[];
  shots: Shot[];
  turrets: Turret[];
  friendCooldown: number;
  /** Gun level, 1 to MAX_LEVEL. Resets with every run. */
  gun: number;
  nextId: number;
  /** Deepest wave fully cleared. The reward is paid against this. */
  cleared: number;
};

export const MAX_LEVEL = 8;

/**
 * Cells needed to take the gun from its current level to the next, indexed from level 1.
 * Cumulative to level 8 is 12, against a backing ceiling of 11 pending plays, so a full
 * build is deliberately just out of reach in one run.
 */
export const GUN_STEP = [1, 1, 1, 2, 2, 2, 3];
export const gunStepCost = (level: number) => GUN_STEP[level - 1] ?? 0;
export const gunTotalCost = (level: number) =>
  GUN_STEP.slice(0, Math.max(0, level - 1)).reduce((total, cost) => total + cost, 0);

/** Damage and rate both improve, so an upgraded gun feels different rather than just bigger. */
export const gunPower = (level: number) => FRIEND_POWER + (level - 1) * 8;
export const gunCooldown = (level: number) => FRIEND_COOLDOWN * Math.pow(0.94, level - 1);

/**
 * Cells recoverable as rolls at each depth. Everything staked beyond this is forfeited,
 * so the stake is a bet on how far the run will get.
 */
export const ROLLS_AT: Readonly<Record<number, number>> = { 3: 3, 6: 7, 9: 11 };

export const NODE: Vec = { x: 288, y: 192 };
export const FRIEND_RANGE = 95;
export const FRIEND_COOLDOWN = 0.42;
export const FRIEND_POWER = 34;
export const TURRET_RANGE = 78;
export const TURRET_COOLDOWN = 0.9;
export const TURRET_COST = 14;
export const TURRET_UPGRADE_COST = 18;
export const MAX_TURRETS = 5;

/**
 * Difficulty knobs, kept together and mutable so the balance simulation can sweep them.
 * Gameplay never writes to this; only the tuning harness does.
 */
export const TUNING = { countPerWave: 2.15, hpGrowth: 0.23, burstFloor: 0.17 };
export const NODE_MAX_HP = 100;
export const RESPITE_SECONDS = 6;
/** Waves that end a stage, where the player may bank or push on. */
export const STAGE_WAVES: readonly number[] = [3, 6, 9];
export const FINAL_WAVE = 9;

const KINDS = {
  mote: { hp: 44, speed: 24, damage: 11, scrap: 5 },
  shard: { hp: 84, speed: 33, damage: 16, scrap: 7 },
  hulk: { hp: 240, speed: 15, damage: 34, scrap: 16 },
} as const;

export function createRun(): Run {
  return {
    phase: "briefing", wave: 0, pending: 0, spawnTimer: 0, respiteTimer: 0,
    nodeHp: NODE_MAX_HP, nodeMaxHp: NODE_MAX_HP, scrap: 0,
    enemies: [], shots: [], turrets: [], friendCooldown: 0, gun: 1, nextId: 1, cleared: 0,
  };
}

/** Enemy count and mix per wave. Hulks arrive only once there has been time to build. */
export function wavePlan(wave: number) {
  const count = 4 + Math.round(wave * TUNING.countPerWave);
  const hulks = wave >= 5 ? Math.floor((wave - 3) / 2) : 0;
  const shards = wave >= 4 ? Math.round((wave - 2) * 1.1) : 0;
  return { count, hulks, shards, motes: Math.max(0, count - hulks - shards) };
}

export type Modifier = Readonly<{ id: string; name: string; blurb: string; speed: number; hp: number; scrap: number }>;

/** A deterministic daily modifier: the same for everyone on a given UTC day, with no server. */
export function dailyModifier(now = new Date()): Modifier {
  const day = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000);
  const table: readonly Modifier[] = [
    { id: "steady", name: "Steady", blurb: "No modifier today.", speed: 1, hp: 1, scrap: 1 },
    { id: "swarm", name: "Swarm", blurb: "Glitches move faster but break easier.", speed: 1.28, hp: 0.82, scrap: 1 },
    { id: "dense", name: "Dense", blurb: "Tougher glitches, richer scrap.", speed: 0.9, hp: 1.3, scrap: 1.25 },
    { id: "lean", name: "Lean", blurb: "Less scrap. Spend it well.", speed: 1, hp: 1, scrap: 0.75 },
  ];
  return table[((day % table.length) + table.length) % table.length];
}

/** Four approach lanes, so pressure comes from several directions at once. */
function spawnPoint(index: number): Vec {
  const lanes: readonly Vec[] = [{ x: 110, y: 130 }, { x: 430, y: 140 }, { x: 110, y: 265 }, { x: 445, y: 265 }];
  return lanes[index % lanes.length];
}

export function startWave(run: Run, wave: number) {
  run.phase = "wave";
  run.wave = wave;
  run.pending = wavePlan(wave).count;
  run.spawnTimer = 0;
  return run;
}

function makeEnemy(run: Run, wave: number, index: number, modifier: Modifier): Enemy {
  const plan = wavePlan(wave);
  const kind: Enemy["kind"] = index < plan.hulks ? "hulk" : index < plan.hulks + plan.shards ? "shard" : "mote";
  const base = KINDS[kind];
  const scaling = 1 + (wave - 1) * TUNING.hpGrowth;
  const point = spawnPoint(index + wave);
  // Jitter keeps repeat runs from being byte-identical without making outcomes lottery-like.
  const spread = 26;
  const jitterX = (Math.random() - 0.5) * spread;
  const jitterY = (Math.random() - 0.5) * spread;
  const hp = Math.round(base.hp * scaling * modifier.hp * (0.92 + Math.random() * 0.16));
  return {
    id: run.nextId++, x: point.x + jitterX, y: point.y + jitterY, hp, maxHp: hp,
    speed: base.speed * modifier.speed, damage: base.damage,
    scrap: Math.max(1, Math.round(base.scrap * modifier.scrap)), kind,
  };
}

const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export type StepEvents = { kills: number; scrap: number; nodeHits: number; waveCleared: boolean; lost: boolean };

/**
 * Advances the simulation by dt seconds, where friend is the live position the SDK reports.
 * Returns events the interface may react to, so rendering stays out of the model.
 */
export function step(run: Run, dt: number, friend: Vec, modifier: Modifier = dailyModifier()): StepEvents {
  const events: StepEvents = { kills: 0, scrap: 0, nodeHits: 0, waveCleared: false, lost: false };
  if (run.phase !== "wave" && run.phase !== "respite") return events;

  if (run.phase === "respite") {
    run.respiteTimer -= dt;
    if (run.respiteTimer <= 0) startWave(run, run.wave + 1);
    return events;
  }

  // Release the wave a few at a time rather than all at once.
  run.spawnTimer -= dt;
  if (run.pending > 0 && run.spawnTimer <= 0) {
    const plan = wavePlan(run.wave);
    run.enemies.push(makeEnemy(run, run.wave, plan.count - run.pending, modifier));
    run.pending -= 1;
    run.spawnTimer = Math.max(TUNING.burstFloor, 0.8 - run.wave * 0.075);
  }

  // Enemies walk at the node and damage it on arrival.
  const reached = new Set<number>();
  for (const enemy of run.enemies) {
    const dx = NODE.x - enemy.x, dy = NODE.y - enemy.y;
    const away = Math.hypot(dx, dy);
    if (away <= 16) {
      run.nodeHp -= enemy.damage;
      enemy.hp = 0;
      events.nodeHits += 1;
      reached.add(enemy.id);
      continue;
    }
    enemy.x += (dx / away) * enemy.speed * dt;
    enemy.y += (dy / away) * enemy.speed * dt;
  }

  const nearestTo = (x: number, y: number, range: number) => {
    let best: Enemy | null = null, bestAway = range;
    for (const enemy of run.enemies) {
      if (enemy.hp <= 0) continue;
      const away = distance(x, y, enemy.x, enemy.y);
      if (away <= bestAway) { best = enemy; bestAway = away; }
    }
    return best;
  };

  // The Friend is the primary attacker. Turrets are support.
  run.friendCooldown -= dt;
  if (run.friendCooldown <= 0) {
    const target = nearestTo(friend.x, friend.y, FRIEND_RANGE);
    if (target) {
      const power = gunPower(run.gun);
      run.shots.push({ id: run.nextId++, x: friend.x, y: friend.y, tx: target.x, ty: target.y, life: 0.12, power });
      target.hp -= power;
      run.friendCooldown = gunCooldown(run.gun);
    }
  }
  for (const turret of run.turrets) {
    turret.cooldown -= dt;
    if (turret.cooldown > 0) continue;
    const spec = TURRETS[turret.kind];
    const target = nearestTo(turret.x, turret.y, spec.range + turret.tier * 12);
    if (!target) continue;
    const power = spec.power + turret.tier * 15;
    run.shots.push({ id: run.nextId++, x: turret.x, y: turret.y, tx: target.x, ty: target.y, life: 0.12, power });
    target.hp -= power;
    // Arc carries into anything clustered around the target.
    if (spec.splash > 0) {
      for (const other of run.enemies) {
        if (other === target || other.hp <= 0) continue;
        if (distance(other.x, other.y, target.x, target.y) <= spec.splash) other.hp -= Math.round(power * 0.6);
      }
    }
    turret.cooldown = spec.cooldown;
  }

  for (const shot of run.shots) shot.life -= dt;
  run.shots = run.shots.filter(shot => shot.life > 0);

  // Anything killed short of the node pays scrap. Anything that reached it does not.
  const survivors: Enemy[] = [];
  for (const enemy of run.enemies) {
    if (enemy.hp > 0) { survivors.push(enemy); continue; }
    if (!reached.has(enemy.id)) {
      events.kills += 1;
      events.scrap += enemy.scrap;
      run.scrap += enemy.scrap;
    }
  }
  run.enemies = survivors;

  if (run.nodeHp <= 0) {
    run.nodeHp = 0;
    run.phase = "lost";
    events.lost = true;
    return events;
  }
  if (run.pending === 0 && run.enemies.length === 0) {
    run.cleared = run.wave;
    events.waveCleared = true;
    if (STAGE_WAVES.includes(run.wave) || run.wave >= FINAL_WAVE) {
      run.phase = "briefing";
    } else {
      run.phase = "respite";
      run.respiteTimer = RESPITE_SECONDS;
    }
  }
  return events;
}

/** Cells recoverable as rolls at the depth reached. Depth never changes the odds. */
export function rollsFor(cleared: number) {
  if (cleared >= 9) return ROLLS_AT[9];
  if (cleared >= 6) return ROLLS_AT[6];
  if (cleared >= 3) return ROLLS_AT[3];
  return 0;
}

/** Upgrades the gun if the level allows it. The caller pays the Cells. */
export function upgradeGun(run: Run) {
  if (run.gun >= MAX_LEVEL) return false;
  run.gun += 1;
  return true;
}

export function canPlaceTurret(run: Run, x: number, y: number, kind: TurretKind = "pulse") {
  if (run.scrap < TURRETS[kind].cost) return false;
  if (run.turrets.length >= MAX_TURRETS) return false;
  if (distance(x, y, NODE.x, NODE.y) < 28) return false;
  return run.turrets.every(turret => distance(turret.x, turret.y, x, y) > 34);
}

export function placeTurret(run: Run, x: number, y: number, kind: TurretKind = "pulse") {
  if (!canPlaceTurret(run, x, y, kind)) return false;
  run.scrap -= TURRETS[kind].cost;
  run.turrets.push({ id: run.nextId++, x, y, tier: 1, cooldown: 0, kind });
  return true;
}

export function upgradeTurret(run: Run, id: number) {
  const turret = run.turrets.find(item => item.id === id);
  if (!turret || turret.tier >= 3 || run.scrap < TURRET_UPGRADE_COST) return false;
  run.scrap -= TURRET_UPGRADE_COST;
  turret.tier += 1;
  return true;
}
