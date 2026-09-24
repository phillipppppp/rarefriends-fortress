// Both turret types must be buildable in a real run and gated by scrap. Scrap changes
// constantly mid-fight, so placement is asserted from the turret count and the toast
// rather than a balance delta. A stage can end mid-test, so the run pushes on.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";
import { project } from "../dist/friend-world.js";

const VIEW = { x: 320, y: 330, width: 960, height: 640 };

await testGame("./games/fortress", {
  timeout: 120_000,
  screenshot: "./artifacts/ff-turrets.png",
  check: async ({ page, game }) => {
    const canvas = game.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    const pointFor = (x: number, y: number) => {
      const [px, py] = project(x, y);
      return {
        x: ((px - VIEW.x) / VIEW.width) * box.width,
        y: ((py - VIEW.y) / VIEW.height) * box.height,
      };
    };
    const tap = (x: number, y: number) => canvas.click({ position: pointFor(x, y) });
    /** In build mode the overlay sits above the world canvas and is the real tap target. */
    const tapBuild = (x: number, y: number) =>
      game.locator(".ff-overlay").click({ position: pointFor(x, y), timeout: 3000 });
    const approve = async () => {
      const c = page.getByRole("button", { name: "Confirm preview" });
      await c.waitFor({ timeout: 10_000 });
      await c.click();
    };
    const hudNumber = async (label: string) => {
      const text = await game.locator(".ff-hud").innerText();
      const match = text.match(new RegExp(label + " (\\d+)"));
      return Number(match ? match[1] : 0);
    };
    const pushOnIfOffered = async () => {
      const push = game.getByRole("button", { name: /^Push to wave/ });
      if (await push.count() > 0) { await push.click(); await page.waitForTimeout(300); }
    };
    /** A stage menu covers the HUD and the world, so it is cleared before acting. */
    const safe = async (fn: () => Promise<unknown>) => {
      for (let i = 0; i < 15; i += 1) {
        await pushOnIfOffered();
        try { await fn(); return; } catch { await page.waitForTimeout(400); }
      }
      throw new Error("action never became possible");
    };
    const waitForScrap = async (want: number) => {
      for (let i = 0; i < 100; i += 1) {
        await pushOnIfOffered();
        if ((await hudNumber("Scrap")) >= want) return true;
        await page.waitForTimeout(500);
      }
      return false;
    };

    await tap(170, 120);
    await game.getByRole("button", { name: /^Enter Generator$/ }).click();
    await game.getByRole("button", { name: /^Buy one Power Cell/ }).click();
    await approve();
    await game.getByRole("button", { name: /^Close Generator$/ }).click();

    await tap(288, 215);
    await game.getByRole("button", { name: /^Enter The Node$/ }).click();
    await game.getByRole("button", { name: /^Begin defence run$/ }).click();

    const pulse = game.getByRole("button", { name: /^Pulse · \d+$/ });
    const arc = game.getByRole("button", { name: /^Arc · \d+$/ });
    await pulse.waitFor({ timeout: 15_000 });
    assert.equal(await arc.count(), 1, "both turret types should be offered");
    assert.equal(await hudNumber("Turrets"), 0, "a run starts with no turrets");
    console.log("PASS  both turret types offered, no turrets yet");

    assert.ok(await waitForScrap(14), "never accumulated 14 scrap");
    await safe(() => pulse.click({ timeout: 2000 }));
    await safe(() => tapBuild(230, 150));
    await page.waitForTimeout(600);
    assert.equal(await hudNumber("Turrets"), 1, "the Pulse turret should be standing");
    assert.match(await game.locator(".ff-toast").innerText(), /Pulse online/);
    console.log("PASS  Pulse placed and confirmed");
    await safe(() => game.getByRole("button", { name: /^Done · Pulse$/ }).click({ timeout: 2000 }));

    assert.ok(await waitForScrap(24), "never accumulated 24 scrap for the Arc");
    await safe(() => arc.click({ timeout: 2000 }));
    await safe(() => tapBuild(346, 234));
    await page.waitForTimeout(600);
    assert.equal(await hudNumber("Turrets"), 2, "the Arc should stand alongside the Pulse");
    assert.match(await game.locator(".ff-toast").innerText(), /Arc online/);
    console.log("PASS  Arc placed and confirmed");
  },
});
console.log("\nboth turret types verified");
