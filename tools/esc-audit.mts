// Escape must close the topmost open thing, one layer at a time, and do nothing when
// nothing is open. The X stays for touch. Checked in both games.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";
import { project } from "../dist/friend-world.js";

const VIEW = { x: 320, y: 330, width: 960, height: 640 };
const menuOpen = (game: any) => game.locator(".rf-frame-menu").count();

// --- Ascension: station menus ---
await testGame("./games/ascension", {
  timeout: 45_000,
  check: async ({ page, game }) => {
      // How to Play opens on load, so every suite dismisses it before touching the world.
      const helpGotIt = game.getByRole("button", { name: /^Got it$/ });
      if (await helpGotIt.count() > 0) {
        await helpGotIt.click();
        await helpGotIt.waitFor({ state: "detached", timeout: 8000 });
      }
    console.log("\n=== ascension ===");
    assert.equal(await menuOpen(game), 0, "nothing should be open at the start");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    assert.equal(await menuOpen(game), 0, "Escape with nothing open must do nothing");
    console.log("PASS  Escape with nothing open does nothing");

    await game.getByRole("button", { name: /^Settings$/ }).click();
    assert.equal(await menuOpen(game), 1, "settings should open");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    assert.equal(await menuOpen(game), 0, "Escape should close settings");
    console.log("PASS  Escape closes settings");

    // The X must still work for touch.
    await game.getByRole("button", { name: /^Settings$/ }).click();
    await game.getByRole("button", { name: /^Close Settings$/ }).click();
    await page.waitForTimeout(300);
    assert.equal(await menuOpen(game), 0, "the close control should still work");
    console.log("PASS  the X still closes it");
  },
});

// --- Fortress: turret panel sits above the menus ---
await testGame("./games/fortress", {
  timeout: 120_000,
  check: async ({ page, game }) => {
      // How to Play opens on load, so every suite dismisses it before touching the world.
      const helpGotIt = game.getByRole("button", { name: /^Got it$/ });
      if (await helpGotIt.count() > 0) {
        await helpGotIt.click();
        await helpGotIt.waitFor({ state: "detached", timeout: 8000 });
      }
    console.log("\n=== fortress ===");
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

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    assert.equal(await menuOpen(game), 0, "Escape with nothing open must do nothing");
    console.log("PASS  Escape with nothing open does nothing");

    await game.getByRole("button", { name: /^Settings$/ }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    assert.equal(await menuOpen(game), 0, "Escape should close settings");
    console.log("PASS  Escape closes settings");

    // Get into a run and build a turret so the panel exists.
    await canvas.click({ position: pointFor(170, 120) });
    await game.getByRole("button", { name: /^Enter Generator$/ }).click();
    await game.getByRole("button", { name: /^Buy one Power Cell/ }).click();
    await approve();
    await game.getByRole("button", { name: /^Close Generator$/ }).click();
    await canvas.click({ position: pointFor(288, 215) });
    await game.getByRole("button", { name: /^Enter The Node$/ }).click();
    await game.getByRole("button", { name: /^Begin defence run$/ }).click();
    await approve();

    for (let i = 0; i < 100 && (await scrap()) < 30; i += 1) { await pushOnIfOffered(); await page.waitForTimeout(400); }
    await safe(() => game.getByRole("button", { name: /^Pulse · \d+$/ }).click({ timeout: 2500 }));
    await safe(() => overlay.click({ position: pointFor(230, 150), timeout: 3000 }));
    await safe(() => game.getByRole("button", { name: /^Done · Pulse$/ }).click({ timeout: 2500 }));

    await safe(() => canvas.click({ position: pointFor(230, 150), timeout: 3000 }));
    const panel = game.locator(".ff-selected");
    await panel.waitFor({ timeout: 8000 });
    console.log("PASS  turret panel open");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    assert.equal(await panel.count(), 0, "Escape should close the turret panel");
    assert.equal(await menuOpen(game), 0, "closing the panel must not also open or close a menu");
    console.log("PASS  Escape closes the turret panel and nothing else");

    // And the panel's own X still works.
    await safe(() => canvas.click({ position: pointFor(230, 150), timeout: 3000 }));
    await panel.waitFor({ timeout: 8000 });
    await panel.getByRole("button", { name: "Deselect turret" }).click();
    await page.waitForTimeout(300);
    assert.equal(await panel.count(), 0, "the panel X should still work for touch");
    console.log("PASS  the panel X still works");
  },
});
console.log("\nEscape behaves correctly in both games");
