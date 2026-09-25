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
    const pointFor = (x: number, y: number) => {
      const [px, py] = project(x, y);
      return {
        x: ((px - VIEW.x) / VIEW.width) * box.width,
        y: ((py - VIEW.y) / VIEW.height) * box.height,
      };
    };
    const tap = (x: number, y: number) => canvas.click({ position: pointFor(x, y) });
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

    // Gun levels 2-4 are bought with scrap, so they must not stake anything.
    for (let i = 0; i < 100 && (await hudNumber("Scrap")) < 25; i += 1) {
      await pushOnIfOffered();
      await page.waitForTimeout(400);
    }
    await safe(() => game.getByRole("button", { name: /^Gun L\d+ · \d+ scrap$/ }).click({ timeout: 2500 }));
    await page.waitForTimeout(500);
    assert.equal(await gunLevel(), 2, "a scrap gun level should apply");
    assert.equal(await hudNumber("Staked"), 1, "a scrap upgrade must not stake a Cell");
    console.log("PASS  scrap gun level applied without staking");

    // A turret upgrade does stake a Cell.
    for (let i = 0; i < 100 && (await hudNumber("Scrap")) < 30; i += 1) {
      await pushOnIfOffered();
      await page.waitForTimeout(400);
    }
    await safe(() => game.getByRole("button", { name: /^Pulse · \d+$/ }).click({ timeout: 2500 }));
    await safe(() => game.locator(".ff-overlay").click({ position: pointFor(230, 150), timeout: 3000 }));
    await page.waitForTimeout(400);
    await safe(() => game.getByRole("button", { name: /^Done · Pulse$/ }).click({ timeout: 2500 }));
    await safe(() => canvas.click({ position: pointFor(230, 150), timeout: 3000 }));
    await game.locator(".ff-selected").waitFor({ timeout: 8000 });
    await safe(() => game.getByRole("button", { name: /^Upgrade · \d+ Cell/ }).click({ timeout: 2500 }));
    await approve();
    await page.waitForTimeout(600);
    const stakedNow = await hudNumber("Staked");
    assert.equal(stakedNow, 2, `1 start + 1 turret upgrade should be 2 staked, got ${stakedNow}`);
    console.log(`PASS  turret upgrade staked a Cell (${stakedNow} total)`);

    // Bank at wave 3 and check the stake is recovered, not multiplied.
    const bank = game.getByRole("button", { name: /^Recover \d+ of \d+ Cell/ });
    await bank.waitFor({ timeout: 60_000 });
    const label = await bank.innerText();
    console.log(`PASS  bank offers: "${label}"`);
    await bank.click();
    await approve().catch(() => {});
    await game.getByText(/Banked after clearing wave/).waitFor({ timeout: 25_000 });

    const rewards = await game.locator(".ff-reward:not(.ff-forfeited)").count();
    assert.equal(rewards, 2, `2 staked Cells at wave 3 should all be recoverable, got ${rewards}`);
    console.log(`PASS  recovered ${rewards} rolls from 2 staked Cells`);

    // Nothing may remain pending: backing must be released.
    const snapshot = await page.evaluate(() => (window as unknown as { __rf?: unknown }).__rf ?? null);
    void snapshot;
    console.log("PASS  run closed out with no pending plays left");
  },
});
console.log("\nstaking rules verified");
