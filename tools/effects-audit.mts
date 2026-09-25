// The three decorative effects must appear, must vanish entirely under reduced motion, and must
// not cost frames on a phone-sized viewport. Balance is checked separately by the sims.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";
import { project } from "../dist/friend-world.js";

const VIEW = { x: 320, y: 330, width: 960, height: 640 };

for (const [label, width, height] of [["phone", 390, 760], ["desktop", 960, 800]] as const) {
  await testGame("./games/fortress", {
    width, height, timeout: 150_000,
    check: async ({ page, game }) => {
      console.log(`\n=== ${label} ${width}x${height} ===`);
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
        const c = page.getByRole("button", { name: "Confirm preview" });
        await c.waitFor({ timeout: 10_000 });
        await c.click();
      };
      const pushOnIfOffered = async () => {
        const push = game.getByRole("button", { name: /^Push to wave/ });
        if (await push.count() > 0) { await push.click(); await page.waitForTimeout(250); }
      };
      const hudNumber = async (field: string) => {
        const text = await game.locator(".ff-hud").innerText();
        return Number((text.match(new RegExp(`${field} (\d+)`)) ?? [])[1] ?? 0);
      };

      // The fixture browser asks for reduced motion, so the game should start with effects off.
      const cls = await game.locator(".ff-game").getAttribute("class");
      assert.match(cls ?? "", /ff-still/, "the OS preference should be honoured on load");
      console.log("PASS  OS reduced-motion preference respected on load");

      // Turn motion on so the effects can be observed at all.
      await game.getByRole("button", { name: /^Settings$/ }).click();
      await game.getByRole("checkbox", { name: /Reduce motion/ }).uncheck();
      await game.getByRole("button", { name: /^Close Settings$/ }).click();
      await page.waitForTimeout(300);

      // Start a run.
      await canvas.click({ position: pointFor(170, 120) });
      await game.getByRole("button", { name: /^Enter Generator$/ }).click();
      await game.getByRole("button", { name: /^Buy one Power Cell/ }).click();
      await approve();
      await game.getByRole("button", { name: /^Close Generator$/ }).click();
      await canvas.click({ position: pointFor(288, 215) });
      await game.getByRole("button", { name: /^Enter The Node$/ }).click();
      await game.getByRole("button", { name: /^Begin defence run$/ }).click();
      await approve();

      // 1. The wave banner announces the wave.
      const banner = game.locator(".ff-banner");
      await banner.waitFor({ timeout: 40_000 });
      // CSS uppercases the banner, so match without regard to case.
      assert.match(await banner.innerText(), /^wave \d+$/i, "the banner should name the wave");
      console.log(`PASS  wave banner shown: "${await banner.innerText()}"`);
      await banner.waitFor({ state: "detached", timeout: 6000 });
      console.log("PASS  banner clears itself");

      // 2. Hit feedback. A kill draws a burst ring; a survivor flashes white. At wave 1 the L1 gun
      // one-shots every 44hp mote, so flashes only start once health scaling lets one survive a
      // hit — which is why this samples from wave 2 rather than immediately.
      const install = () => game.locator("body").evaluate(() => {
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
      const counters = () => game.locator("body").evaluate(() => {
        const w = window as unknown as { __fills: number; __rings: number };
        return { fills: w.__fills, rings: w.__rings };
      });

      await install();
      for (let i = 0; i < 120 && (await hudNumber("Wave")) < 2; i += 1) {
        await pushOnIfOffered();
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(5000);
      const seen = await counters();
      assert.ok(seen.rings > 0, `kills should draw a burst ring, saw ${seen.rings}`);
      console.log(`PASS  death bursts drawn (${seen.rings} ring draws)`);
      assert.ok(seen.fills > 0, `damaged enemies should flash, saw ${seen.fills} white fills`);
      console.log(`PASS  hit flashes drawn (${seen.fills} white fills)`);

      // 3. The gun flash fires on a level-up. Checked before the timing probe: the Friend never
      // moves in this test, so the node eventually falls and the run HUD's upgrade button goes
      // with it.
      const upgrade = game.getByRole("button", { name: /^Gun L\d+ · \d+ scrap$/ });
      await upgrade.waitFor({ timeout: 20_000 });
      for (let i = 0; i < 60 && await upgrade.isDisabled(); i += 1) await page.waitForTimeout(300);
      await upgrade.click({ timeout: 5000 });
      await game.locator(".ff-gunflash").waitFor({ timeout: 4000 });
      console.log("PASS  gun level-up flash shown");

      // 4. Frame timing while the effects run, at this viewport. This wraps the game's own frame
      // loop rather than running a probe loop beside it, so what is measured is the real cadence
      // including the overlay paint. Every function here stays anonymous: a named one (including
      // `const f = () => {}`) makes the bundler emit a __name helper the page does not have.
      await game.locator("body").evaluate(() => {
        const w = window as unknown as { __gaps: number[]; __raf: typeof requestAnimationFrame; __last: number };
        w.__gaps = [];
        w.__last = 0;
        w.__raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = function (callback: FrameRequestCallback) {
          return w.__raf(function (stamp: number) {
            if (w.__last) w.__gaps.push(stamp - w.__last);
            w.__last = stamp;
            return callback(stamp);
          });
        };
      });
      await page.waitForTimeout(3000);
      const timing = await game.locator("body").evaluate(() => {
        const w = window as unknown as { __gaps: number[]; __raf: typeof requestAnimationFrame };
        window.requestAnimationFrame = w.__raf;
        const gaps = w.__gaps.slice().sort((a, b) => a - b);
        return {
          frames: gaps.length,
          worst: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0),
          over32: gaps.filter(gap => gap > 32).length,
        };
      });
      const fps = Math.round(timing.frames / 3);
      console.log(`      ${fps} fps, 95th-percentile frame ${timing.worst}ms, ${timing.over32} frames over 32ms`);
      assert.ok(fps >= 45, `should hold at least 45fps with effects on, got ${fps}`);
      assert.ok(timing.worst <= 32, `95th-percentile frame should stay under 32ms, got ${timing.worst}ms`);
      console.log("PASS  no slowdown with effects running");


      // 5. Reduced motion removes all of it.
      await game.getByRole("button", { name: /^Settings$/ }).click();
      await game.getByRole("checkbox", { name: /Reduce motion/ }).check();
      await game.getByRole("button", { name: /^Close Settings$/ }).click();
      await page.waitForTimeout(500);
      assert.equal(await game.locator(".ff-banner").count(), 0, "no banner under reduced motion");
      assert.equal(await game.locator(".ff-gunflash").count(), 0, "no gun flash under reduced motion");

      // The canvas effects must stop too, not merely freeze: both counters stay at zero.
      const quiet = await game.locator("body").evaluate(() => {
        const w = window as unknown as { __fills: number; __rings: number };
        w.__fills = 0;
        w.__rings = 0;
        return new Promise<{ fills: number; rings: number }>(resolve => {
          window.setTimeout(() => resolve({ fills: w.__fills, rings: w.__rings }), 3500);
        });
      });
      assert.equal(quiet.fills, 0, `no hit flashes under reduced motion, saw ${quiet.fills}`);
      assert.equal(quiet.rings, 0, `no death bursts under reduced motion, saw ${quiet.rings}`);
      console.log("PASS  reduced motion switches off all four effects on screen");

      // And the banner does not come back on the next wave while it stays on.
      for (let i = 0; i < 12; i += 1) { await pushOnIfOffered(); await page.waitForTimeout(400); }
      assert.equal(await game.locator(".ff-banner").count(), 0, "still no banner on later waves");
      console.log("PASS  later waves stay quiet while reduced motion is on");
    },
  });
}
console.log("\nEffects verified: present, performant, and fully suppressed by reduced motion");
