// The four decorative effects must appear, must vanish entirely under reduced motion, and must not
// cost frames at phone size. Balance is checked separately by the sims.
//
// Two things shape how this is written. First, the fixture browser reports
// prefers-reduced-motion: reduce, so effects are off on load and the "on" case has to enable them.
// Second, when the node falls the game re-opens the briefing menu on every HUD tick, which makes
// the world (and the HUD inside it) inert by design — so a run that has ended cannot be clicked out
// of, and toggling the setting mid-run is a race. Each case therefore gets its own fresh page, and
// the "off" case simply leaves the OS preference alone.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";
import { project } from "../dist/friend-world.js";

const VIEW = { x: 320, y: 330, width: 960, height: 640 };
type Timing = { frames: number; median: number; worst: number; over32: number; fps: number };

for (const [label, width, height] of [["phone", 390, 760], ["desktop", 960, 800]] as const) {
  const timings: Record<string, Timing> = {};

  // Each case gets a fresh page. The gun flash is split out because it needs the run HUD, which
  // disappears when the node falls, and a dead run cannot be restarted from the UI: buying the
  // Cell a new run needs means walking to the Generator, and an open menu makes the world inert.
  for (const motion of ["effects", "gun", "off"] as const) {
    await testGame("./games/fortress", {
      width, height, timeout: 150_000,
      check: async ({ page, game }) => {
        console.log(`\n=== ${label} ${width}x${height}: ${motion} ===`);
        const canvas = game.locator("canvas").first();
        const box = (await canvas.boundingBox())!;
        const pointFor = (x: number, y: number) => {
          const [px, py] = project(x, y);
          return {
            x: ((px - VIEW.x) / VIEW.width) * box.width,
            y: ((py - VIEW.y) / VIEW.height) * box.height,
          };
        };
        const approve = async () => {
          const confirm = page.getByRole("button", { name: "Confirm preview" });
          await confirm.waitFor({ timeout: 10_000 });
          await confirm.click();
        };
        const pushOnIfOffered = async () => {
          const push = game.getByRole("button", { name: /^Push to wave/ });
          if (await push.count() > 0) { await push.click(); await page.waitForTimeout(250); }
        };
        const hudNumber = async (field: string) => {
          const text = await game.locator(".ff-hud").innerText();
          return Number((text.match(new RegExp(`${field} (\\d+)`)) ?? [])[1] ?? 0);
        };

        // Counting the decorative draws the overlay performs. A kill strokes a burst ring in the
        // effect's yellow; an enemy that survives a hit gets refilled white. Every function passed
        // to evaluate stays anonymous — a named one, including `const f = () => {}`, makes the
        // bundler emit a __name helper that does not exist inside the page.
        const installCounters = () => game.locator("body").evaluate(() => {
          const w = window as unknown as { __fills: number; __rings: number };
          w.__fills = 0;
          w.__rings = 0;
          const proto = CanvasRenderingContext2D.prototype;
          const fill = proto.fill as (...a: unknown[]) => unknown;
          proto.fill = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
            if (this.fillStyle === "#ffffff") w.__fills += 1;
            return fill.apply(this, args);
          } as typeof proto.fill;
          const stroke = proto.stroke as (...a: unknown[]) => unknown;
          proto.stroke = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
            if (String(this.strokeStyle).startsWith("rgba(255, 224, 102")) w.__rings += 1;
            return stroke.apply(this, args);
          } as typeof proto.stroke;
        });
        const readCounters = () => game.locator("body").evaluate(() => {
          const w = window as unknown as { __fills: number; __rings: number };
          return { fills: w.__fills, rings: w.__rings };
        });
        const resetCounters = () => game.locator("body").evaluate(() => {
          const w = window as unknown as { __fills: number; __rings: number };
          w.__fills = 0;
          w.__rings = 0;
        });

        // Frame cadence, taken by wrapping the game's own loop rather than running a probe beside
        // it, so what is measured includes the overlay paint. Several callbacks share one frame and
        // carry the same timestamp, so only a change of timestamp counts — counting every callback
        // doubles the apparent rate, which is how an earlier version of this reported 120fps.
        const measure = async (): Promise<Timing> => {
          await game.locator("body").evaluate(() => {
            const w = window as unknown as {
              __gaps: number[]; __raf: typeof requestAnimationFrame; __last: number;
            };
            w.__gaps = [];
            w.__last = 0;
            w.__raf = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = function (callback: FrameRequestCallback) {
              return w.__raf(function (stamp: number) {
                if (stamp !== w.__last) {
                  if (w.__last) w.__gaps.push(stamp - w.__last);
                  w.__last = stamp;
                }
                return callback(stamp);
              });
            };
          });
          await page.waitForTimeout(3000);
          const raw = await game.locator("body").evaluate(() => {
            const w = window as unknown as { __gaps: number[]; __raf: typeof requestAnimationFrame };
            window.requestAnimationFrame = w.__raf;
            const gaps = w.__gaps.slice().sort((a, b) => a - b);
            return {
              frames: gaps.length,
              median: Math.round(gaps[Math.floor(gaps.length * 0.5)] ?? 0),
              worst: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0),
              over32: gaps.filter(gap => gap > 32).length,
            };
          });
          return { ...raw, fps: Math.round(raw.frames / 3) };
        };

        // The OS preference must be honoured on load, whichever case this is.
        const onLoad = await game.locator(".ff-game").getAttribute("class");
        assert.match(onLoad ?? "", /ff-still/, "the OS reduced-motion preference should be honoured");
        if (motion !== "off") {
          console.log("PASS  OS reduced-motion preference respected on load");
          await game.getByRole("button", { name: /^Settings$/ }).click();
          await game.getByRole("checkbox", { name: /Reduce motion/ }).uncheck();
          await game.getByRole("button", { name: /^Close Settings$/ }).click();
          await page.waitForTimeout(300);
        }

        await installCounters();

        // Start a run. Nothing here waits on a run surviving, because the Friend never moves.
        await canvas.click({ position: pointFor(170, 120) });
        await game.getByRole("button", { name: /^Enter Generator$/ }).click();
        await game.getByRole("button", { name: /^Buy one Power Cell/ }).click();
        await approve();
        await game.getByRole("button", { name: /^Close Generator$/ }).click();
        await canvas.click({ position: pointFor(288, 215) });
        await game.getByRole("button", { name: /^Enter The Node$/ }).click();
        await game.getByRole("button", { name: /^Begin defence run$/ }).click();
        await approve();

        const banner = game.locator(".ff-banner");

        if (motion === "gun") {
          // The gun flash, on its own page so it runs while the run is certainly still alive. The
          // first scrap level costs 25 and scrap passes that within the first wave.
          const upgrade = game.getByRole("button", { name: /^Gun L\d+ · \d+ scrap$/ });
          await upgrade.waitFor({ timeout: 30_000 });
          for (let i = 0; i < 90 && await upgrade.isDisabled(); i += 1) await page.waitForTimeout(300);
          await upgrade.click({ timeout: 8000 });
          await game.locator(".ff-gunflash").waitFor({ timeout: 4000 });
          console.log("PASS  gun level-up flash shown");
        } else if (motion === "effects") {
          // 1. The wave banner announces the wave, then clears itself.
          await banner.waitFor({ timeout: 40_000 });
          // CSS uppercases it, so match without regard to case.
          assert.match(await banner.innerText(), /^wave \d+$/i, "the banner should name the wave");
          console.log(`PASS  wave banner shown: "${await banner.innerText()}"`);
          await banner.waitFor({ state: "detached", timeout: 6000 });
          console.log("PASS  banner clears itself");

          // 2. Hit feedback: a kill draws a burst ring, an enemy that survives a hit flashes white.
          //
          // Which wave produces the first flash is not fixed, because the daily modifier scales
          // enemy health: under Swarm (hp x0.82) a wave-2 mote is 45-51hp and the 52-damage L1 gun
          // one-shots it, so flashes only start at wave 3, while on a neutral day they start at
          // wave 2. Waiting a fixed number of seconds at a fixed wave therefore passes or fails
          // depending on the date. This waits for the condition itself instead.
          await resetCounters();
          let seen = { fills: 0, rings: 0 };
          for (let i = 0; i < 150; i += 1) {
            await pushOnIfOffered();
            seen = await readCounters();
            if (seen.fills > 0 && seen.rings > 0) break;
            await page.waitForTimeout(400);
          }
          assert.ok(seen.rings > 0, `kills should draw a burst ring, saw ${seen.rings}`);
          console.log(`PASS  death bursts drawn (${seen.rings} ring draws)`);
          assert.ok(seen.fills > 0, `damaged enemies should flash, saw ${seen.fills} white fills`);
          console.log(`PASS  hit flashes drawn (${seen.fills} white fills)`);
        } else {
          // Reduced motion must remove the effects, not freeze them: nothing rendered, nothing
          // drawn, through a wave and past the wave boundary that would otherwise banner.
          await resetCounters();
          for (let i = 0; i < 40 && (await hudNumber("Wave")) < 2; i += 1) {
            await pushOnIfOffered();
            await page.waitForTimeout(300);
          }
          await page.waitForTimeout(5000);
          const quiet = await readCounters();
          assert.equal(await banner.count(), 0, "no wave banner under reduced motion");
          assert.equal(await game.locator(".ff-gunflash").count(), 0, "no gun flash under reduced motion");
          assert.equal(quiet.fills, 0, `no hit flashes under reduced motion, saw ${quiet.fills}`);
          assert.equal(quiet.rings, 0, `no death bursts under reduced motion, saw ${quiet.rings}`);
          console.log("PASS  reduced motion switches off all four effects");
        }

        // Frame cadence for this case; the effects/off pair is compared after the loop.
        const timing = await measure();
        timings[motion] = timing;
        console.log(`      ${timing.fps} fps, median ${timing.median}ms, 95th ${timing.worst}ms, `
          + `${timing.over32} frames over 32ms`);
        assert.ok(timing.fps >= 30, `should stay playable, got ${timing.fps}fps`);
        assert.ok(timing.median <= 32, `median frame should stay under 32ms, got ${timing.median}ms`);
        console.log("PASS  stays playable");
      },
    });
  }

  // What the effects actually cost. Comparing the two cases is independent of how loaded the host
  // is, which an absolute frame-rate floor is not.
  const cost = 1 - timings.effects.fps / timings.off.fps;
  console.log(`\n  ${label}: effects cost ${(cost * 100).toFixed(1)}% of the frame rate `
    + `(${timings.effects.fps}fps with, ${timings.off.fps}fps without)`);
  assert.ok(cost <= 0.15, `effects should cost under 15% of the frame rate, measured ${(cost * 100).toFixed(1)}%`);
  console.log(`  PASS  the effects are close to free at ${label} size`);
}
console.log("\nEffects verified: present, performant, and fully suppressed by reduced motion");
