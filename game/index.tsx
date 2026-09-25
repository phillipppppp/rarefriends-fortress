"use client";

import { useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import { GameWorld, type GameWorldInteraction } from "@rarefriends/friendsdk/world-view";
import { getWorldPreset, validateWorld, project, unproject } from "@rarefriends/friendsdk/world";
import { GameMenu } from "@rarefriends/friendsdk/frame";
import { formatGameAmount } from "@rarefriends/friendsdk/ui";
import { maximumPrize, type GameSnapshot, type GamePlay } from "@rarefriends/friendsdk/game";
import { createFriendSoundKit, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";
import {
  createRun, startWave, step, rollsFor, placeTurret, dailyModifier,
  NODE, FRIEND_RANGE, TURRETS, MAX_TURRETS, STAGE_WAVES, FINAL_WAVE, NODE_MAX_HP,
  MAX_LEVEL, ROLLS_AT, gunStepCost, gunPower, gunCooldown, upgradeGun,
  placementProblem, turretAt, mergePartner, mergeTurrets, upgradeTurret, turretStepCost,
  gunScrapCost, GUN_SCRAP_MAX, upgradeGunWithScrap, repairCost, repairNode, REPAIR_HP, turretCost,
  type Run, type TurretKind,
} from "./combat.js";
import "@rarefriends/friendsdk/frame.css";
import "@rarefriends/friendsdk/world-view.css";
import "./style.css";

const mesa = getWorldPreset("03-crystal-mesa-complete");
const world = validateWorld({ ...mesa, actors: [] });
const spawn = [288, 250] as const;

/**
 * Stations are not rendered as the SDK floating prompts. Those are sized in CSS pixels
 * while the world canvas scales down, so on a phone a single prompt blankets roughly
 * 300x85 canvas pixels and swallows the taps that are the only way to walk. Proximity is
 * detected here instead and the action lives in the HUD, leaving the whole canvas tappable.
 */
const STATIONS = [
  { id: "generator" as const, label: "Generator", x: 161, y: 93, reach: 70 },
  { id: "node" as const, label: "The Node", x: NODE.x, y: NODE.y, reach: 74 },
];

/** Mirrors the runtime camera so overlay drawing lines up with the world canvas. */
const VIEW = { x: 320, y: 330, width: 960, height: 640 };
const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;

type Menu = "generator" | "node" | "result" | "settings" | null;

/** Draws the run onto a transparent canvas stacked over the SDK world canvas. */
function paint(context: CanvasRenderingContext2D, run: Run, friend: { x: number; y: number }, buildMode: TurretKind | null, selected: number | null, partnerId: number | null) {
  context.clearRect(0, 0, VIEW.width, VIEW.height);
  context.save();
  context.translate(-VIEW.x, -VIEW.y);

  const [nx, ny] = project(NODE.x, NODE.y);
  const health = run.nodeHp / NODE_MAX_HP;
  context.beginPath();
  context.moveTo(nx, ny - 26); context.lineTo(nx + 18, ny); context.lineTo(nx, ny + 14); context.lineTo(nx - 18, ny);
  context.closePath();
  context.fillStyle = health > 0.5 ? "rgba(0,229,255,.85)" : health > 0.25 ? "rgba(255,196,84,.9)" : "rgba(255,92,92,.9)";
  context.fill();
  context.lineWidth = 2; context.strokeStyle = "#04222c"; context.stroke();

  context.fillStyle = "rgba(4,18,28,.85)";
  context.fillRect(nx - 26, ny + 20, 52, 6);
  context.fillStyle = health > 0.25 ? "#00e5ff" : "#ff5c5c";
  context.fillRect(nx - 25, ny + 21, 50 * Math.max(0, health), 4);

  // The firing envelope, so positioning reads clearly.
  const [fx, fy] = project(friend.x, friend.y);
  context.beginPath();
  context.ellipse(fx, fy, FRIEND_RANGE * 1.3, FRIEND_RANGE * 0.42, 0, 0, Math.PI * 2);
  context.strokeStyle = "rgba(0,229,255,.28)";
  context.lineWidth = 1.5;
  context.stroke();

  for (const turret of run.turrets) {
    const [tx, ty] = project(turret.x, turret.y);
    const spec = TURRETS[turret.kind];
    const reach = spec.range + turret.tier * 12;
    context.beginPath();
    context.ellipse(tx, ty, reach * 1.3, reach * 0.42, 0, 0, Math.PI * 2);
    context.strokeStyle = turret.kind === "arc" ? "rgba(255,180,255,.18)" : "rgba(124,242,255,.16)";
    context.lineWidth = 1;
    context.stroke();
    if (turret.id === selected || turret.id === partnerId) {
      context.setLineDash(turret.id === selected ? [] : [5, 4]);
      context.strokeStyle = turret.id === selected ? "#ffe066" : "rgba(255,224,102,.75)";
      context.lineWidth = 2.5;
      context.beginPath();
      context.ellipse(tx, ty - 6, 22, 16, 0, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }
    // Level pips, so a turret shows its rank without being tapped.
    context.fillStyle = "#ffe066";
    for (let pip = 0; pip < turret.tier; pip += 1) {
      context.fillRect(tx - 10 + pip * 5, ty + 6, 3, 3);
    }
    if (turret.kind === "arc") {
      context.fillStyle = "#f2a6ff";
      context.beginPath();
      context.moveTo(tx, ty - 18); context.lineTo(tx + 10, ty - 6);
      context.lineTo(tx, ty + 4); context.lineTo(tx - 10, ty - 6);
      context.closePath();
      context.fill();
      context.fillStyle = "#2a0a2e";
      context.fillRect(tx - 3, ty - 10, 6, 6);
    } else {
      context.fillStyle = "#7fe3ff";
      context.fillRect(tx - 8, ty - 16, 16, 16);
      context.fillStyle = "#04222c";
      context.fillRect(tx - 4, ty - 12, 8, 8);
    }
  }

  for (const enemy of run.enemies) {
    const [ex, ey] = project(enemy.x, enemy.y);
    const size = enemy.kind === "hulk" ? 13 : enemy.kind === "shard" ? 9 : 7;
    context.beginPath();
    context.moveTo(ex, ey - size); context.lineTo(ex + size, ey); context.lineTo(ex, ey + size); context.lineTo(ex - size, ey);
    context.closePath();
    context.fillStyle = enemy.kind === "hulk" ? "#ff7ad9" : enemy.kind === "shard" ? "#ffb36b" : "#ff5c8a";
    context.fill();
    context.lineWidth = 1.5; context.strokeStyle = "#1a0714"; context.stroke();
    if (enemy.hp < enemy.maxHp) {
      context.fillStyle = "rgba(10,4,10,.8)";
      context.fillRect(ex - size, ey - size - 7, size * 2, 3);
      context.fillStyle = "#ffe066";
      context.fillRect(ex - size, ey - size - 7, size * 2 * (enemy.hp / enemy.maxHp), 3);
    }
  }

  for (const shot of run.shots) {
    const [sx, sy] = project(shot.x, shot.y);
    const [tx, ty] = project(shot.tx, shot.ty);
    context.beginPath();
    context.moveTo(sx, sy - 10);
    context.lineTo(tx, ty);
    context.strokeStyle = shot.power >= 30 ? "rgba(0,229,255,.95)" : "rgba(242,166,255,.9)";
    context.lineWidth = shot.power >= 30 ? 3 : 2;
    context.stroke();
  }

  if (buildMode) {
    context.setLineDash([6, 5]);
    context.strokeStyle = "rgba(255,224,102,.75)";
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(nx, ny, 150, 52, 0, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();
}

export default function FriendFortress({ friendId, client, paused }: GameComponentProps) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [buildMode, setBuildMode] = useState<TurretKind | null>(null);
  const [worldNode, setWorldNode] = useState<HTMLDivElement | null>(null);
  const [near, setNear] = useState<null | (typeof STATIONS)[number]>(null);
  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [rewards, setRewards] = useState<readonly GamePlay[]>([]);
  /** Mirrors run state into React for the HUD only; the loop owns the authoritative copy. */
  const [hud, setHud] = useState({
    phase: "briefing" as Run["phase"], wave: 0, nodeHp: NODE_MAX_HP,
    scrap: 0, enemies: 0, cleared: 0, turrets: 0, gun: 1, repairs: 0, nodeMax: NODE_MAX_HP,
  });

  const overlay = useRef<HTMLCanvasElement | null>(null);
  const runRef = useRef<Run>(createRun());
  const sound = useRef<FriendSoundKit | null>(null);
  const locked = useRef(false);
  const epoch = useRef(0);
  const definition = client.definition;
  const modifier = useRef(dailyModifier());
  /** Cue throttles; the SDK mixes four voices, so unthrottled kills would just be noise. */
  const cueAt = useRef({ kill: 0, nodeHit: 0 });
  /**
   * Ids of plays already created but not settled. Each is one staked Cell, and each holds
   * the maximum prize of backing until it is settled, which is why they are settled the
   * moment a run ends rather than left hanging.
   */
  /** The frame loop reads the selection from a ref so it never has to resubscribe. */
  const selectedRef = useRef<{ id: number | null; partner: number | null }>({ id: null, partner: null });
  const pending = useRef<bigint[]>([]);
  const [staked, setStaked] = useState(0);
  const [forfeited, setForfeited] = useState<readonly GamePlay[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const version = ++epoch.current;
    sound.current = createFriendSoundKit();
    runRef.current = createRun();
    setMenu(null); setError(""); setMessage(""); setBuildMode(null); setRewards([]);
    pending.current = []; setStaked(0); setForfeited([]); setSelected(null);
    void client.read().then(value => { if (version === epoch.current) setSnapshot(value); }).catch(cause => {
      if (version === epoch.current) setError(cause instanceof Error ? cause.message : "Could not load the preview.");
    });
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const follow = () => setReducedMotion(preference.matches);
    follow();
    preference.addEventListener("change", follow);
    return () => {
      epoch.current++; sound.current?.dispose(); sound.current = null;
      preference.removeEventListener("change", follow);
    };
  }, [client, friendId]);

  // The simulation and the overlay share one animation frame loop.
  useEffect(() => {
    if (!worldNode) return;
    let frame = 0;
    let previous = performance.now();
    let hudTimer = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      const canvas = worldNode.querySelector("canvas");
      const surface = overlay.current;
      if (canvas && surface) {
        const box = canvas.getBoundingClientRect();
        const host = worldNode.getBoundingClientRect();
        surface.style.left = `${box.left - host.left}px`;
        surface.style.top = `${box.top - host.top}px`;
        surface.style.width = `${box.width}px`;
        surface.style.height = `${box.height}px`;

        const fx = Number(canvas.dataset.x);
        const fy = Number(canvas.dataset.y);
        if (Number.isFinite(fx) && Number.isFinite(fy)) {
          const run = runRef.current;
          if (!paused && menu === null) {
            const events = step(run, dt, { x: fx, y: fy }, modifier.current);
            if (events.kills > 0 && now - cueAt.current.kill > 110) {
              cueAt.current.kill = now;
              sound.current?.play("impact");
            }
            if (events.nodeHits > 0 && now - cueAt.current.nodeHit > 260) {
              cueAt.current.nodeHit = now;
              sound.current?.play("anticipation");
            }
            if (events.waveCleared) sound.current?.play("action-ready");
            if (events.lost) sound.current?.play("reveal-legendary");
          }
          const context = surface.getContext("2d");
          if (context) paint(context, run, { x: fx, y: fy }, buildMode, selectedRef.current.id, selectedRef.current.partner);

          hudTimer -= dt;
          if (hudTimer <= 0) {
            hudTimer = 0.12;
            setHud({
              phase: run.phase, wave: run.wave, nodeHp: run.nodeHp,
              scrap: run.scrap, enemies: run.enemies.length + run.pending, cleared: run.cleared,
              turrets: run.turrets.length, gun: run.gun, repairs: run.repairs, nodeMax: run.nodeMaxHp,
            });
            const reachable = run.phase === "wave" || run.phase === "respite"
              ? null
              : STATIONS.find(station => Math.hypot(station.x - fx, station.y - fy) <= station.reach) ?? null;
            setNear(current => (current?.id === reachable?.id ? current : reachable));
            if ((run.phase === "briefing" && run.wave > 0) || run.phase === "lost") {
              setMenu(current => (current === null ? "node" : current));
              setBuildMode(null);
            }
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [worldNode, paused, menu, buildMode]);

  // The SDK binds E to its own prompts; those are gone, so the shortcut is rebound here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "e" || event.repeat) return;
      if (menu !== null || paused || !near) return;
      event.preventDefault();
      setMenu(near.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, paused, near]);

  useEffect(() => {
    if (!worldNode) return;
    const canvas = worldNode.querySelector("canvas");
    if (!canvas) return;
    const onDown = (event: PointerEvent) => {
      if (buildMode || menu !== null || paused) return;
      const box = canvas.getBoundingClientRect();
      const canvasX = VIEW.x + ((event.clientX - box.left) / box.width) * VIEW.width;
      const canvasY = VIEW.y + ((event.clientY - box.top) / box.height) * VIEW.height;
      const [wx, wy] = unproject(canvasX, canvasY);
      const hit = turretAt(runRef.current, wx, wy);
      if (!hit) { setSelected(null); return; }
      // Consume it, so the same tap does not also order a walk.
      event.stopPropagation();
      event.preventDefault();
      setSelected(hit.id);
      sound.current?.play("select");
    };
    canvas.addEventListener("pointerdown", onDown, true);
    return () => canvas.removeEventListener("pointerdown", onDown, true);
  }, [worldNode, buildMode, menu, paused]);

  async function act(work: () => Promise<void>, after?: () => void) {
    if (locked.current || paused) return;
    const version = epoch.current;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    void sound.current?.unlock();
    try {
      await work();
      const value = await client.read();
      if (version === epoch.current) { setSnapshot(value); after?.(); }
    } catch (cause) {
      if (version === epoch.current) setError(cause instanceof Error ? cause.message : "The preview action failed.");
    } finally {
      if (version === epoch.current) { locked.current = false; setBusy(false); }
    }
  }

  const navigate = (next: Menu) => {
    if (busy || paused) return;
    void sound.current?.unlock();
    setMenu(next); setError(""); setMessage("");
  };

  if (!snapshot) {
    return (
      <div className="ff-loading" role={error ? "alert" : "status"}>
        {error || "Powering the node…"}
        {error && (
          <button type="button" onClick={() => void act(async () => {})}>Retry</button>
        )}
      </div>
    );
  }
  if (snapshot.friendId !== friendId) return <p role="alert">This game session does not match the selected Friend.</p>;

  const maxPrize = maximumPrize(definition);
  const canBuy = snapshot.rfBalance >= definition.price
    && snapshot.freeStake >= maxPrize
    && snapshot.freeStake + definition.price >= maxPrize;
  const run = runRef.current;
  const rolls = rollsFor(hud.cleared);
  /** How much of the stake the depth reached actually gives back. */
  const recoverable = Math.min(staked, rolls);
  const atRisk = Math.max(0, staked - rolls);
  const fighting = hud.phase === "wave" || hud.phase === "respite";

  /** Turns Cells into pending plays. Each one is recoverable only by reaching depth. */
  const stakeCells = async (count: number) => {
    const plays = await client.play(BigInt(count));
    pending.current = [...pending.current, ...plays.map(play => play.id)];
    setStaked(pending.current.length);
  };

  /**
   * Settles every pending play so the backing they hold is released. The first
   * `recoverable` become the reward; the rest are shown as forfeited and never redeemed.
   */
  const closeOutRun = async (recoverable: number) => {
    const ids = pending.current;
    pending.current = [];
    const settled: GamePlay[] = [];
    for (const id of ids) settled.push(await client.settle(id));
    setStaked(0);
    setRewards(settled.slice(0, recoverable));
    setForfeited(settled.slice(recoverable));
    return settled.slice(0, recoverable);
  };

  const beginRun = () => {
    if (snapshot.consumables < 1n) { setError("You need at least one Power Cell to defend the node."); return; }
    void sound.current?.unlock();
    void act(async () => {
      // A run abandoned earlier leaves plays pending, which hold backing; clear them first.
      if (pending.current.length > 0) await closeOutRun(0);
      await stakeCells(1);
      sound.current?.play("action-start");
      runRef.current = createRun();
      startWave(runRef.current, 1);
      setRewards([]); setForfeited([]);
      setMenu(null);
    });
  };

  /** Banking spends one Power Cell per roll earned, then settles each play. */
  const bank = () =>
    act(async () => {
      const version = epoch.current;
      if (recoverable < 1) throw new Error("Clear wave 3 to recover any of your stake.");
      const settled = await closeOutRun(recoverable);
      if (version === epoch.current) {
        runRef.current.phase = "banked";
        const best = settled.reduce((top, play) => {
          const value = play.outcomeId ? definition.outcomes[play.outcomeId - 1].reward : 0n;
          return value > top ? value : top;
        }, 0n);
        const top = maximumPrize(definition);
        sound.current?.play(best >= top ? "reveal-legendary" : best * 4n >= top ? "reveal-rare" : "reveal-common");
        setRewards(settled);
        setMenu("result");
      }
    });

  const buyGunWithScrap = () => {
    if (!upgradeGunWithScrap(runRef.current)) {
      setMessage(`Needs ${gunScrapCost(runRef.current.gun)} scrap. You have ${runRef.current.scrap}.`);
      return;
    }
    sound.current?.play("purchase");
    setMessage(`Gun level ${runRef.current.gun}, bought with scrap.`);
  };

  const buyRepair = () => {
    const run = runRef.current;
    if (run.nodeHp >= run.nodeMaxHp) { setMessage("The node is already at full strength."); return; }
    if (!repairNode(run)) {
      setMessage(`Needs ${repairCost(run.repairs)} scrap to repair. You have ${run.scrap}.`);
      return;
    }
    sound.current?.play("action-ready");
    setMessage(`Node repaired by ${REPAIR_HP}. The next repair costs ${repairCost(runRef.current.repairs)}.`);
  };

  const buyGunUpgrade = () => {
    const run = runRef.current;
    if (run.gun >= MAX_LEVEL) return;
    const cost = gunStepCost(run.gun);
    if (snapshot.consumables < BigInt(cost)) {
      setMessage(`Needs ${cost} Power Cell${cost === 1 ? "" : "s"}. Buy more at the Generator between runs.`);
      return;
    }
    void act(async () => {
      await stakeCells(cost);
      upgradeGun(runRef.current);
      sound.current?.play("purchase");
      setMessage(`Gun level ${runRef.current.gun}. ${cost} Cell${cost === 1 ? "" : "s"} staked — simulated, recoverable as rolls if you reach depth.`);
    });
  };

  const selectedTurret = runRef.current.turrets.find(turret => turret.id === selected) ?? null;
  const partner = selected === null ? null : mergePartner(runRef.current, selected);

  const doMerge = () => {
    if (selected === null) return;
    if (!mergeTurrets(runRef.current, selected)) return;
    sound.current?.play("reward");
    setMessage("Merged. Two turrets became one a level higher, freeing a slot.");
  };

  const doUpgradeTurret = () => {
    const turret = selectedTurret;
    if (!turret || turret.tier >= MAX_LEVEL) return;
    const cost = turretStepCost(turret.tier);
    if (snapshot.consumables < BigInt(cost)) {
      setMessage(`Needs ${cost} Power Cell${cost === 1 ? "" : "s"}. Buy more at the Generator between runs.`);
      return;
    }
    void act(async () => {
      await stakeCells(cost);
      upgradeTurret(runRef.current, turret.id);
      sound.current?.play("purchase");
      setMessage(`Turret level ${turret.tier}. ${cost} Cell${cost === 1 ? "" : "s"} staked — simulated, recoverable as rolls if you reach depth.`);
    });
  };

  selectedRef.current = { id: selected, partner: partner?.id ?? null };

  const pushOn = () => {
    sound.current?.play("action-start");
    startWave(runRef.current, hud.cleared + 1);
    setMenu(null);
  };

  const onOverlayPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const canvasX = VIEW.x + ((event.clientX - box.left) / box.width) * VIEW.width;
    const canvasY = VIEW.y + ((event.clientY - box.top) / box.height) * VIEW.height;
    const [wx, wy] = unproject(canvasX, canvasY);

    if (buildMode) {
      const problem = placementProblem(runRef.current, wx, wy, buildMode);
      if (problem) { setMessage(problem); return; }
      placeTurret(runRef.current, wx, wy, buildMode);
      sound.current?.play("purchase");
      setMessage(`${TURRETS[buildMode].label} online. ${TURRETS[buildMode].blurb}`);
      return;
    }

  };

  const stageEnd = STAGE_WAVES.includes(hud.cleared);
  const title = menu === "settings" ? "Settings"
    : menu === "generator" ? "Generator"
    : menu === "result" ? "Run banked"
    : run.phase === "lost" ? "The node fell"
    : hud.cleared > 0 ? `Wave ${hud.cleared} cleared` : "The Node";

  return (
    <section className={`ff-game${reducedMotion ? " ff-still" : ""}`} aria-label={definition.name} aria-busy={busy}>
      <div className="ff-world" ref={setWorldNode} inert={Boolean(menu) || paused || undefined}>
        <GameWorld
          world={world}
          spawn={spawn}
          interactions={[]}
          friendId={friendId}
          paused={Boolean(menu) || paused}
          reducedMotion={reducedMotion}
          onInteract={id => navigate(id as Menu)}
        />
        <canvas
          ref={overlay}
          className={`ff-overlay${buildMode ? " ff-overlay-build" : ""}`}
          width={VIEW.width}
          height={VIEW.height}
          aria-hidden="true"
          onPointerDown={onOverlayPointer}
        />

        <div className="ff-hud">
          <span>{rf(snapshot.rfBalance)} · {snapshot.consumables.toString()} cells</span>
          {hud.wave > 0 && run.phase !== "banked" && (
            <>
              <span className="ff-wave">Wave {hud.wave}</span>
              <span className={hud.nodeHp <= 25 ? "ff-danger" : ""}>Node {hud.nodeHp}</span>
              <span>Scrap {hud.scrap}</span>
              <span>Turrets {hud.turrets}/{MAX_TURRETS}</span>
              <span className="ff-gun">Gun L{hud.gun}</span>
              <span className="ff-staked">Staked {staked}</span>
              <span>Left {hud.enemies}</span>
            </>
          )}
          <button type="button" onClick={() => navigate("settings")}>Settings</button>
          {near && !fighting && (
            <button
              type="button"
              className="rf-frame-primary ff-enter"
              onClick={() => navigate(near.id)}
            >
              Enter {near.label}
            </button>
          )}
          {fighting && hud.gun < MAX_LEVEL && (
            hud.gun < GUN_SCRAP_MAX ? (
              <button
                type="button"
                disabled={busy || paused || hud.scrap < gunScrapCost(hud.gun)}
                onClick={buyGunWithScrap}
              >
                Gun L{hud.gun + 1} · {gunScrapCost(hud.gun)} scrap
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || paused || hud.phase === "wave" || snapshot.consumables < BigInt(gunStepCost(hud.gun))}
                title={hud.phase === "wave" ? "Cell upgrades are bought between waves" : undefined}
                onClick={buyGunUpgrade}
              >
                Gun L{hud.gun + 1} · {gunStepCost(hud.gun)} Cell{gunStepCost(hud.gun) === 1 ? "" : "s"}
              </button>
            )
          )}
          {fighting && hud.nodeHp < hud.nodeMax && (
            <button
              type="button"
              disabled={busy || paused || hud.scrap < repairCost(hud.repairs)}
              onClick={buyRepair}
            >
              Repair +{REPAIR_HP} · {repairCost(hud.repairs)} scrap
            </button>
          )}
          {fighting && (Object.keys(TURRETS) as TurretKind[]).map(kind => (
            <button
              key={kind}
              type="button"
              className={buildMode === kind ? "rf-frame-primary" : ""}
              disabled={hud.scrap < turretCost(runRef.current, kind) && buildMode !== kind}
              onClick={() => { setBuildMode(value => (value === kind ? null : kind)); setMessage(""); }}
            >
              {buildMode === kind ? `Done · ${TURRETS[kind].label}` : `${TURRETS[kind].label} · ${turretCost(runRef.current, kind)}`}
            </button>
          ))}
        </div>

        {hud.phase !== "wave" && <p className="ff-objective">
          {fighting
            ? buildMode ? `Tap open ground to place a ${TURRETS[buildMode].label} turret` : "Stay near the node — your Friend fires automatically"
            : near && near.id === (snapshot.consumables < 1n ? "generator" : "node")
              ? `Tap Enter ${near.label}, or press E`
            : snapshot.consumables < 1n ? "Walk to the Generator to buy a Power Cell"
            : "Walk to the Node to begin a defence run"}
        </p>}
        {selectedTurret && fighting && (
          <div className="ff-selected" role="group" aria-label="Selected turret">
            <span className="ff-selected-name">
              <strong>{TURRETS[selectedTurret.kind].label} · L{selectedTurret.tier}/{MAX_LEVEL}</strong>
              <small>{TURRETS[selectedTurret.kind].blurb}</small>
            </span>
            <span className="ff-selected-actions">
              <button
                type="button"
                disabled={busy || paused || !partner}
                title={partner ? "Combine with a matching turret" : "Needs another turret of the same type and level"}
                onClick={doMerge}
              >
                Merge{partner ? "" : " ✕"}
              </button>
              <button
                type="button"
                disabled={busy || paused || selectedTurret.tier >= MAX_LEVEL || snapshot.consumables < BigInt(turretStepCost(selectedTurret.tier))}
                onClick={doUpgradeTurret}
              >
                {selectedTurret.tier >= MAX_LEVEL
                  ? "Max level"
                  : `Upgrade · ${turretStepCost(selectedTurret.tier)} Cell${turretStepCost(selectedTurret.tier) === 1 ? "" : "s"}`}
              </button>
              <button type="button" onClick={() => setSelected(null)} aria-label="Deselect turret">✕</button>
            </span>
          </div>
        )}
        {message && <p className="ff-toast" role="status">{message}</p>}
      </div>

      {menu && (
        <GameMenu title={title} onClose={busy ? undefined : () => navigate(null)}>
          {menu === "settings" ? (
            <>
              <button
                type="button"
                aria-pressed={!muted}
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  sound.current?.setMuted(next);
                  if (!next) void sound.current?.unlock();
                }}
              >
                {muted ? "Sound off" : "Sound on"}
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={reducedMotion}
                  onChange={event => setReducedMotion(event.target.checked)}
                />
                {" "}Reduce motion
              </label>
              <p className="ff-note">
                Walk with WASD, the arrow keys, or by tapping the ground. Stand at a station and
                press E, or use the Enter button in the HUD. All economy actions are simulated;
                wallet connection and ownership verification are provided by the SDK.
              </p>
            </>
          ) : menu === "generator" ? (
            <>
              <p>One Power Cell costs {rf(definition.price)}. Each roll of the reward table spends one cell.</p>
              <table>
                <thead><tr><th>Salvage</th><th>Chance</th><th>Value</th></tr></thead>
                <tbody>
                  {definition.outcomes.map(item => (
                    <tr key={item.name}><td>{item.name}</td><td>{item.chanceBps / 100}%</td><td>{rf(item.reward)}</td></tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="rf-frame-primary"
                disabled={!canBuy || busy || paused}
                onClick={() => void act(() => client.buy(1n), () => {
                  sound.current?.play("purchase");
                  setMessage("Power Cell charged.");
                })}
              >
                Buy one Power Cell · {rf(definition.price)}
              </button>
              {!canBuy && <p>{snapshot.rfBalance < definition.price ? "Not enough simulated RF." : "Purchases are paused until there is enough free backing."}</p>}
              <p className="ff-note">Every cell reserves {rf(maxPrize)} of backing.</p>
            </>
          ) : menu === "result" ? (
            <>
              <p>Banked after clearing wave {hud.cleared}. {rewards.length} roll{rewards.length === 1 ? "" : "s"}.</p>
              {rewards.map(play => {
                const outcome = play.outcomeId ? definition.outcomes[play.outcomeId - 1] : null;
                return (
                  <div className="ff-reward" key={play.id.toString()}>
                    <span><strong>{outcome?.name ?? "Unknown"}</strong><small>{outcome ? rf(outcome.reward) : ""}</small></span>
                    <button
                      type="button"
                      disabled={busy || paused || !outcome || outcome.reward === 0n}
                      onClick={() => void act(() => client.redeem(play.outcomeId!, 1n), () => {
                        sound.current?.play("reward");
                        setMessage("Redeemed.");
                      })}
                    >
                      Redeem
                    </button>
                  </div>
                );
              })}
              {forfeited.length > 0 && (
                <>
                  <p className="ff-risk">
                    {forfeited.length} staked Cell{forfeited.length === 1 ? "" : "s"} forfeited — beyond
                    what wave {hud.cleared} recovers. Settled with no payout so the backing is released.
                  </p>
                  {forfeited.map(play => {
                    const outcome = play.outcomeId ? definition.outcomes[play.outcomeId - 1] : null;
                    return (
                      <div className="ff-reward ff-forfeited" key={play.id.toString()}>
                        <span><strong>{outcome?.name ?? "Unknown"}</strong><small>forfeited</small></span>
                      </div>
                    );
                  })}
                </>
              )}
              <button type="button" className="rf-frame-primary" disabled={busy || paused} onClick={() => navigate(null)}>
                Back to the mesa
              </button>
            </>
          ) : run.phase === "lost" ? (
            <>
              <p>The glitches drained the node on wave {hud.wave}. Waves already cleared still pay.</p>
              <p><strong>{rolls} roll{rolls === 1 ? "" : "s"}</strong> earned from {hud.cleared} cleared wave{hud.cleared === 1 ? "" : "s"}.</p>
              {rolls > 0
                ? <button type="button" className="rf-frame-primary" disabled={busy || paused || recoverable < 1} onClick={() => void bank()}>
                    Recover {recoverable} of {staked} Cell{staked === 1 ? "" : "s"}
                  </button>
                : <p>Clear at least wave 3 to earn a roll.</p>}
              <button type="button" disabled={busy || paused} onClick={() => { runRef.current = createRun(); navigate(null); }}>
                Leave it
              </button>
            </>
          ) : hud.cleared > 0 && stageEnd ? (
            <>
              <p>Wave {hud.cleared} cleared with {hud.nodeHp} node health left.</p>
              <p className="ff-fork">
                Bank <strong>{rolls} roll{rolls === 1 ? "" : "s"}</strong> now, or push on. Deeper stages earn more rolls,
                and losing the node still pays for waves already cleared.
              </p>
              <button type="button" className="rf-frame-primary" disabled={busy || paused || recoverable < 1} onClick={() => void bank()}>
                Recover {recoverable} of {staked} Cell{staked === 1 ? "" : "s"}
              </button>
              {atRisk > 0 && (
                <p className="ff-risk">
                  {atRisk} staked Cell{atRisk === 1 ? "" : "s"} would be forfeited at this depth.
                  Push to wave {hud.cleared < 6 ? 6 : 9} to recover {hud.cleared < 6 ? ROLLS_AT[6] : ROLLS_AT[9]}.
                </p>
              )}
              {hud.cleared < FINAL_WAVE && (
                <button type="button" disabled={busy || paused} onClick={pushOn}>Push to wave {hud.cleared + 1}</button>
              )}
            </>
          ) : (
            <>
              <p>Your Friend defends the node, firing automatically at anything in range. Position is the whole skill.</p>
              <p>Today: <strong>{modifier.current.name}</strong> — {modifier.current.blurb}</p>
              <p>
                Starting a run stakes <strong>1 Power Cell</strong>. Upgrading the gun stakes more.
                Staked Cells come back as reward rolls, but only as far as the depth you reach.
              </p>
              <table>
                <thead><tr><th>Bank at</th><th>Cells recoverable</th></tr></thead>
                <tbody>
                  <tr><td>Wave 3</td><td>{ROLLS_AT[3]}</td></tr>
                  <tr><td>Wave 6</td><td>{ROLLS_AT[6]}</td></tr>
                  <tr><td>Wave 9</td><td>{ROLLS_AT[9]}</td></tr>
                </tbody>
              </table>
              <p className="ff-note">
                Anything staked beyond that is forfeited. All staking and rewards are simulated.
              </p>
              <p className="ff-note">
                Scrap earned inside a run buys turrets: <strong>Pulse</strong> ({TURRETS.pulse.cost}) is single
                target with a steady rate, <strong>Arc</strong> ({TURRETS.arc.cost}) has shorter reach but hits a cluster.
              </p>
              <button
                type="button"
                className="rf-frame-primary"
                disabled={busy || paused || snapshot.consumables < 1n}
                onClick={beginRun}
              >
                Begin defence run
              </button>
              {snapshot.consumables < 1n && <p>No Power Cells. Visit the Generator first.</p>}
            </>
          )}
          <p role={error ? "alert" : "status"}>{error || message || "Simulated RF and outcomes."}</p>
        </GameMenu>
      )}
    </section>
  );
}
