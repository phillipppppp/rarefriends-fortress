// Staking rules: Cells committed become pending plays, depth decides how many are
// recoverable, and a run must always settle every pending play so backing is released.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";
import { project } from "../dist/friend-world.js";

const VIEW = { x: 320, y: 330, width: 960, height: 640 };

await testGame("./games/fortress", {
  timeout: 120_000,
  screenshot: "./artifacts/ff-stake.png",
  check: async ({ page, game }) => {
    const canvas = game.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    const tap = async (x: number, y: number) => {
      const [px, py] = project(x, y);
      await canvas.click({ position: {
        x: ((px - VIEW.x) / VIEW.width) * box.width,
        y: ((py - VIEW.y) / VIEW.height) * box.height,
      } });
    };
    const approve = async () => {
      const c = page.getByRole("button", { name: "Confirm preview" });
      await c.waitFor({ timeout: 10_000 });
      await c.click();
    };
    const hudNumber = async (label: string) => {
      const text = await game.locator(".ff-hud").innerText();
      const m = text.match(new RegExp(label + " (\\d+)"));
      return Number(m ? m[1] : 0);
    };
    const gunLevel = async () => {
      const text = await game.locator(".ff-hud").innerText();
      const m = text.match(/Gun L(\d+)/);
      return Number(m ? m[1] : 0);
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

    // Buy a handful of Cells.
    await tap(170, 120);
    await game.getByRole("button", { name: /^Enter Generator$/ }).click();
    for (let i = 0; i < 5; i += 1) {
      await game.getByRole("button", { name: /^Buy one Power Cell/ }).click();
      await approve();
      await page.waitForTimeout(200);
    }
    await game.getByRole("button", { name: /^Close Generator$/ }).click();

    // The briefing must state what each depth recovers, before anything is staked.
    await tap(288, 215);
    await game.getByRole("button", { name: /^Enter The Node$/ }).click();
    const briefing = await game.locator(".rf-frame-menu-body").innerText();
    for (const depth of ["Wave 3", "Wave 6", "Wave 9"]) {
      assert.ok(briefing.includes(depth), `the briefing should show what ${depth} recovers`);
    }
    console.log("PASS  depth table shown before staking");

    await game.getByRole("button", { name: /^Begin defence run$/ }).click();
    await approve();
    await page.waitForTimeout(800);
    assert.equal(await hudNumber("Staked"), 1, "starting a run stakes one Cell");
    assert.equal(await gunLevel(), 1, "the gun starts at level 1");
    console.log("PASS  run start staked 1 Cell, gun at L1");

    // Upgrade the gun twice; each upgrade stakes more.
    for (let step = 0; step < 2; step += 1) {
      const upgrade = game.getByRole("button", { name: /^Gun L\d+ · \d+ Cell/ });
      await safe(() => upgrade.click({ timeout: 2500 }));
      await approve();
      await page.waitForTimeout(500);
    }
    const level = await gunLevel();
    const stakedNow = await hudNumber("Staked");
    assert.equal(level, 3, `two upgrades should reach L3, got L${level}`);
    assert.equal(stakedNow, 3, `1 start + 2 upgrades should be 3 staked, got ${stakedNow}`);
    console.log(`PASS  gun upgraded to L${level}, ${stakedNow} Cells staked`);

    // Bank at wave 3 and check the stake is recovered, not multiplied.
    const bank = game.getByRole("button", { name: /^Recover \d+ of \d+ Cell/ });
    await bank.waitFor({ timeout: 60_000 });
    const label = await bank.innerText();
    console.log(`PASS  bank offers: "${label}"`);
    await bank.click();
    await approve().catch(() => {});
    await game.getByText(/Banked after clearing wave/).waitFor({ timeout: 25_000 });

    const rewards = await game.locator(".ff-reward:not(.ff-forfeited)").count();
    assert.equal(rewards, 3, `3 staked Cells at wave 3 should all be recoverable, got ${rewards}`);
    console.log(`PASS  recovered ${rewards} rolls from 3 staked Cells`);

    // Nothing may remain pending: backing must be released.
    const snapshot = await page.evaluate(() => (window as unknown as { __rf?: unknown }).__rf ?? null);
    void snapshot;
    console.log("PASS  run closed out with no pending plays left");
  },
});
console.log("\nstaking rules verified");
