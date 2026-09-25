// Merging must be findable by tapping a turret, and the overlay now captures every tap,
// so walking has to keep working. Checked at phone size, where this matters most.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";
import { project } from "../dist/friend-world.js";

const VIEW = { x: 320, y: 330, width: 960, height: 640 };

for (const [label, width, height] of [["phone", 390, 760], ["desktop", 960, 800]] as const) {
  await testGame("./games/fortress", {
    width, height, timeout: 150_000,
    screenshot: label === "phone" ? "./artifacts/ff-merge.png" : undefined,
    check: async ({ page, game }) => {
      console.log(`\n=== ${label} ${width}x${height} ===`);
      const canvas = game.locator("canvas").first();
      const overlay = game.locator(".ff-overlay");
      const box = (await canvas.boundingBox())!;
      const pointFor = (x: number, y: number) => {
        const [px, py] = project(x, y);
        return {
          x: ((px - VIEW.x) / VIEW.width) * box.width,
          y: ((py - VIEW.y) / VIEW.height) * box.height,
        };
      };
      // Walking and turret selection go to the world canvas; only placement uses the overlay.
      const tap = (x: number, y: number) => canvas.click({ position: pointFor(x, y), timeout: 4000 });
      const tapBuild = (x: number, y: number) => overlay.click({ position: pointFor(x, y), timeout: 4000 });
      const at = () => canvas.evaluate((c: HTMLCanvasElement) => `${c.dataset.x},${c.dataset.y}`);
      const approve = async () => {
        const c = page.getByRole("button", { name: "Confirm preview" });
        await c.waitFor({ timeout: 10_000 });
        await c.click();
      };
      const scrap = async () => {
        const t = await game.locator(".ff-hud").innerText();
        return Number((t.match(/Scrap (\d+)/) ?? [])[1] ?? 0);
      };
      const pushOnIfOffered = async () => {
        const push = game.getByRole("button", { name: /^Push to wave/ });
        if (await push.count() > 0) { await push.click(); await page.waitForTimeout(300); }
      };
      const safe = async (fn: () => Promise<unknown>) => {
        for (let i = 0; i < 15; i += 1) {
          await pushOnIfOffered();
          try { await fn(); return; } catch { await page.waitForTimeout(400); }
        }
        throw new Error("action never became possible");
      };

      // Walking must still work now the overlay is on top of the world.
      const before = await at();
      await tap(288, 150);
      await page.waitForTimeout(1500);
      assert.notEqual(await at(), before, "a tap on open ground must still walk the Friend");
      console.log("PASS  taps still walk the Friend through the overlay");

      await tap(170, 120);
      await game.getByRole("button", { name: /^Enter Generator$/ }).click();
      await game.getByRole("button", { name: /^Buy one Power Cell/ }).click();
      await approve();
      await game.getByRole("button", { name: /^Close Generator$/ }).click();
      await tap(288, 215);
      await game.getByRole("button", { name: /^Enter The Node$/ }).click();
      await game.getByRole("button", { name: /^Begin defence run$/ }).click();
      await approve();

      // Two Pulse turrets of the same level, so a merge becomes possible.
      const pulse = game.getByRole("button", { name: /^Pulse · \d+$/ });
      for (const [x, y] of [[230, 150], [346, 234]] as const) {
        for (let i = 0; i < 100 && (await scrap()) < 14; i += 1) { await pushOnIfOffered(); await page.waitForTimeout(500); }
        await safe(() => pulse.click({ timeout: 2500 }));
        await safe(() => tapBuild(x, y));
        await page.waitForTimeout(400);
        await safe(() => game.getByRole("button", { name: /^Done · Pulse$/ }).click({ timeout: 2500 }));
      }
      console.log("PASS  two matching turrets built");

      // Tapping a turret must reveal its level and options.
      await safe(() => tap(230, 150));
      const panel = game.locator(".ff-selected");
      await panel.waitFor({ timeout: 8000 });
      const text = (await panel.innerText()).replace(/\s+/g, " ");
      assert.match(text, /Pulse/, "the panel should name the turret");
      assert.match(text, /L\d+\/8/, "the panel should show the level at any width");
      console.log(`PASS  tapping a turret opened: "${text.slice(0, 70)}"`);

      const merge = panel.getByRole("button", { name: /^Merge/ });
      assert.equal(await merge.isEnabled(), true, "Merge should be offered with a matching partner");
      await merge.click();
      await page.waitForTimeout(600);
      assert.match(await game.locator(".ff-toast").innerText(), /Merged/);
      console.log("PASS  merge combined two turrets into one");

      const turrets = Number(((await game.locator(".ff-hud").innerText()).match(/Turrets (\d+)/) ?? [])[1] ?? 0);
      assert.equal(turrets, 1, `merging should free a slot, got ${turrets} turrets`);
      console.log("PASS  a slot was freed");
    },
  });
}
console.log("\nmerge UI verified at phone and desktop");
