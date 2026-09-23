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
  NODE, FRIEND_RANGE, TURRET_COST, TURRET_RANGE, STAGE_WAVES, FINAL_WAVE, NODE_MAX_HP,
  type Run,
} from "./combat.js";
import "@rarefriends/friendsdk/frame.css";
import "@rarefriends/friendsdk/world-view.css";
import "./style.css";

const mesa = getWorldPreset("03-crystal-mesa-complete");
const world = validateWorld({ ...mesa, actors: [] });
const spawn = [288, 250] as const;

const interactions: readonly GameWorldInteraction[] = [
  { id: "generator", label: "Generator", position: [161, 93], reach: 58, labelOffset: -150 },
  { id: "node", label: "The Node", position: [NODE.x, NODE.y], reach: 62, labelOffset: -130 },
];

/** Mirrors the runtime camera so overlay drawing lines up with the world canvas. */
const VIEW = { x: 320, y: 330, width: 960, height: 640 };
const rf = (value: bigint) => `${formatGameAmount(value, 18)} RF`;

type Menu = "generator" | "node" | "result" | null;

/** Draws the run onto a transparent canvas stacked over the SDK world canvas. */
function paint(context: CanvasRenderingContext2D, run: Run, friend: { x: number; y: number }, buildMode: boolean) {
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
    const reach = TURRET_RANGE + turret.tier * 12;
    context.beginPath();
    context.ellipse(tx, ty, reach * 1.3, reach * 0.42, 0, 0, Math.PI * 2);
    context.strokeStyle = "rgba(124,242,255,.16)";
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = "#7fe3ff";
    context.fillRect(tx - 8, ty - 16, 16, 16);
    context.fillStyle = "#04222c";
    context.fillRect(tx - 4, ty - 12, 8, 8);
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
    context.strokeStyle = shot.power >= 30 ? "rgba(0,229,255,.95)" : "rgba(180,255,220,.9)";
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
  const [buildMode, setBuildMode] = useState(false);
  const [worldNode, setWorldNode] = useState<HTMLDivElement | null>(null);
  const [rewards, setRewards] = useState<readonly GamePlay[]>([]);
  /** Mirrors run state into React for the HUD only; the loop owns the authoritative copy. */
  const [hud, setHud] = useState({
    phase: "briefing" as Run["phase"], wave: 0, nodeHp: NODE_MAX_HP,
    scrap: 0, enemies: 0, cleared: 0,
  });

  const overlay = useRef<HTMLCanvasElement | null>(null);
  const runRef = useRef<Run>(createRun());
  const sound = useRef<FriendSoundKit | null>(null);
  const locked = useRef(false);
  const epoch = useRef(0);
  const definition = client.definition;
  const modifier = useRef(dailyModifier());

  useEffect(() => {
    const version = ++epoch.current;
    sound.current = createFriendSoundKit();
    runRef.current = createRun();
    setMenu(null); setError(""); setMessage(""); setBuildMode(false); setRewards([]);
    void client.read().then(value => { if (version === epoch.current) setSnapshot(value); }).catch(cause => {
      if (version === epoch.current) setError(cause instanceof Error ? cause.message : "Could not load the preview.");
    });
    return () => { epoch.current++; sound.current?.dispose(); sound.current = null; };
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
          if (!paused && menu === null) step(run, dt, { x: fx, y: fy }, modifier.current);
          const context = surface.getContext("2d");
          if (context) paint(context, run, { x: fx, y: fy }, buildMode);

          hudTimer -= dt;
          if (hudTimer <= 0) {
            hudTimer = 0.12;
            setHud({
              phase: run.phase, wave: run.wave, nodeHp: run.nodeHp,
              scrap: run.scrap, enemies: run.enemies.length + run.pending, cleared: run.cleared,
            });
            if ((run.phase === "briefing" && run.wave > 0) || run.phase === "lost") {
              setMenu(current => (current === null ? "node" : current));
              setBuildMode(false);
            }
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [worldNode, paused, menu, buildMode]);

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
    return <div className="ff-loading" role={error ? "alert" : "status"}>{error || "Powering the node…"}</div>;
  }
  if (snapshot.friendId !== friendId) return <p role="alert">This game session does not match the selected Friend.</p>;

  const maxPrize = maximumPrize(definition);
  const canBuy = snapshot.rfBalance >= definition.price
    && snapshot.freeStake >= maxPrize
    && snapshot.freeStake + definition.price >= maxPrize;
  const run = runRef.current;
  const rolls = rollsFor(hud.cleared);
  const payableRolls = Math.min(rolls, Number(snapshot.consumables));
  const fighting = hud.phase === "wave" || hud.phase === "respite";

  const beginRun = () => {
    if (snapshot.consumables < 1n) { setError("You need at least one Power Cell to defend the node."); return; }
    runRef.current = createRun();
    startWave(runRef.current, 1);
    setRewards([]);
    setMenu(null);
  };

  /** Banking spends one Power Cell per roll earned, then settles each play. */
  const bank = () =>
    act(async () => {
      const version = epoch.current;
      if (payableRolls < 1) throw new Error("No rolls earned. Clear wave 3 to bank a reward.");
      const plays = await client.play(BigInt(payableRolls));
      const settled: GamePlay[] = [];
      for (const play of plays) settled.push(await client.settle(play.id));
      if (version === epoch.current) {
        runRef.current.phase = "banked";
        setRewards(settled);
        setMenu("result");
      }
    });

  const pushOn = () => {
    startWave(runRef.current, hud.cleared + 1);
    setMenu(null);
  };

  const onBuildClick = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!buildMode) return;
    const box = event.currentTarget.getBoundingClientRect();
    const canvasX = VIEW.x + ((event.clientX - box.left) / box.width) * VIEW.width;
    const canvasY = VIEW.y + ((event.clientY - box.top) / box.height) * VIEW.height;
    const [wx, wy] = unproject(canvasX, canvasY);
    if (placeTurret(runRef.current, wx, wy)) {
      sound.current?.play("purchase");
      setMessage("Turret online.");
    } else {
      setMessage(`Needs ${TURRET_COST} scrap, and space away from the node and other turrets.`);
    }
  };

  const stageEnd = STAGE_WAVES.includes(hud.cleared);
  const title = menu === "generator" ? "Generator"
    : menu === "result" ? "Run banked"
    : run.phase === "lost" ? "The node fell"
    : hud.cleared > 0 ? `Wave ${hud.cleared} cleared` : "The Node";

  return (
    <section className="ff-game" aria-label={definition.name} aria-busy={busy}>
      <div className="ff-world" ref={setWorldNode} inert={Boolean(menu) || paused || undefined}>
        <GameWorld
          world={world}
          spawn={spawn}
          interactions={fighting ? [] : interactions}
          friendId={friendId}
          paused={Boolean(menu) || paused}
          reducedMotion={false}
          onInteract={id => navigate(id as Menu)}
        />
        <canvas
          ref={overlay}
          className={`ff-overlay${buildMode ? " ff-overlay-build" : ""}`}
          width={VIEW.width}
          height={VIEW.height}
          aria-hidden="true"
          onPointerDown={onBuildClick}
        />

        <div className="ff-hud">
          <span>{rf(snapshot.rfBalance)} · {snapshot.consumables.toString()} cells</span>
          {hud.wave > 0 && run.phase !== "banked" && (
            <>
              <span className="ff-wave">Wave {hud.wave}</span>
              <span className={hud.nodeHp <= 25 ? "ff-danger" : ""}>Node {hud.nodeHp}</span>
              <span>Scrap {hud.scrap}</span>
              <span>Left {hud.enemies}</span>
            </>
          )}
          {fighting && (
            <button
              type="button"
              className={buildMode ? "rf-frame-primary" : ""}
              onClick={() => { setBuildMode(value => !value); setMessage(""); }}
            >
              {buildMode ? "Done building" : `Build · ${TURRET_COST}`}
            </button>
          )}
        </div>

        <p className="ff-objective">
          {fighting
            ? buildMode ? "Tap open ground near the node to place a turret" : "Stay near the node — your Friend fires automatically"
            : snapshot.consumables < 1n ? "Buy a Power Cell at the Generator"
            : "Go to the Node to begin a defence run"}
        </p>
        {message && <p className="ff-toast" role="status">{message}</p>}
      </div>

      {menu && (
        <GameMenu title={title} onClose={busy ? undefined : () => navigate(null)}>
          {menu === "generator" ? (
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
                onClick={() => void act(() => client.buy(1n), () => setMessage("Power Cell charged."))}
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
                      onClick={() => void act(() => client.redeem(play.outcomeId!, 1n), () => setMessage("Redeemed."))}
                    >
                      Redeem
                    </button>
                  </div>
                );
              })}
              <button type="button" className="rf-frame-primary" disabled={busy || paused} onClick={() => navigate(null)}>
                Back to the mesa
              </button>
            </>
          ) : run.phase === "lost" ? (
            <>
              <p>The glitches drained the node on wave {hud.wave}. Waves already cleared still pay.</p>
              <p><strong>{rolls} roll{rolls === 1 ? "" : "s"}</strong> earned from {hud.cleared} cleared wave{hud.cleared === 1 ? "" : "s"}.</p>
              {rolls > 0
                ? <button type="button" className="rf-frame-primary" disabled={busy || paused || payableRolls < 1} onClick={() => void bank()}>
                    Bank {payableRolls} roll{payableRolls === 1 ? "" : "s"}
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
              <button type="button" className="rf-frame-primary" disabled={busy || paused || payableRolls < 1} onClick={() => void bank()}>
                Bank {payableRolls} roll{payableRolls === 1 ? "" : "s"}
              </button>
              {payableRolls < rolls && (
                <p>You hold {snapshot.consumables.toString()} cell{snapshot.consumables === 1n ? "" : "s"}, so only {payableRolls} can be rolled. Buy more to bank the full {rolls}.</p>
              )}
              {hud.cleared < FINAL_WAVE && (
                <button type="button" disabled={busy || paused} onClick={pushOn}>Push to wave {hud.cleared + 1}</button>
              )}
            </>
          ) : (
            <>
              <p>Your Friend defends the node, firing automatically at anything in range. Position is the whole skill.</p>
              <p>Today: <strong>{modifier.current.name}</strong> — {modifier.current.blurb}</p>
              <p>Clear wave 3 to earn a roll, wave 6 for two, wave 9 for three. Each roll spends one Power Cell.</p>
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
