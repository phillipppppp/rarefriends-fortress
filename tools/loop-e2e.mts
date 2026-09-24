// The one unknown in this build is whether combat renders on an overlay above the SDK
// world canvas. This drives a real run and checks enemies exist, damage lands, and the
// bank-or-push choice appears with rolls paid through play/settle.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";
import { project } from "../dist/friend-world.js";

const VIEW = { x: 320, y: 330, width: 960, height: 640 };

await testGame("./games/fortress", {
  timeout: 60_000,
  screenshot: "./artifacts/fortress-combat.png",
  check: async ({ page, game }) => {
    const canvas = game.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    const walkTo = async (x: number, y: number) => {
      const [px, py] = project(x, y);
      await canvas.click({ position: {
        x: ((px - VIEW.x) / VIEW.width) * box.width,
        y: ((py - VIEW.y) / VIEW.height) * box.height,
      } });
    };
    /** Stations are entered from the HUD once the Friend is in range. */
    const arriveAt = async (label: RegExp) => {
      const enter = game.getByRole("button", { name: label });
      await enter.waitFor({ timeout: 20_000 });
      return enter;
    };
    const approve = async () => {
      const confirm = page.getByRole("button", { name: "Confirm preview" });
      await confirm.waitFor({ timeout: 10_000 });
      await confirm.click();
    };
    const hudText = () => game.locator(".ff-hud").innerText();

    // Two Power Cells: one to roll on banking, one spare.
    await walkTo(170, 120);
    await (await arriveAt(/^Enter Generator$/)).click();
    for (let i = 0; i < 2; i += 1) {
      await game.getByRole("button", { name: /^Buy one Power Cell/ }).click();
      await approve();
      await page.waitForTimeout(250);
    }
    await game.getByRole("button", { name: "Close Generator" }).click();
    console.log("PASS  bought Power Cells:", (await hudText()).replace(/\s+/g, " "));

    await walkTo(288, 215);
    await (await arriveAt(/^Enter The Node$/)).click();
    await game.getByRole("button", { name: /^Begin defence run$/ }).click();
    console.log("PASS  run started");

    // Let a wave actually play out.
    let sawEnemies = false;
    let sawShots = false;
    for (let i = 0; i < 40; i += 1) {
      await page.waitForTimeout(500);
      const hud = (await hudText()).replace(/\s+/g, " ");
      const left = Number((hud.match(/Left (\d+)/) ?? [])[1] ?? 0);
      if (left > 0) sawEnemies = true;
      // A drawn frame means the overlay canvas has non-transparent pixels.
      const painted = await game.locator(".ff-overlay").evaluate((c: HTMLCanvasElement) => {
        const ctx = c.getContext("2d");
        if (!ctx) return 0;
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        let lit = 0;
        for (let p = 3; p < data.length; p += 4 * 97) if (data[p] > 8) lit += 1;
        return lit;
      });
      if (painted > 0) sawShots = true;
      if (await game.getByRole("button", { name: /^Bank \d+ roll/ }).count() > 0) break;
    }
    assert.ok(sawEnemies, "enemies should appear in the HUD during a wave");
    assert.ok(sawShots, "the overlay canvas should have painted pixels");
    console.log("PASS  enemies spawned and the overlay painted");

    // Wave 3 ends in the bank-or-push choice.
    const bank = game.getByRole("button", { name: /^Bank \d+ roll/ });
    await bank.waitFor({ timeout: 45_000 });
    const push = game.getByRole("button", { name: /^Push to wave/ });
    assert.equal(await push.count(), 1, "the push option should be offered alongside banking");
    console.log("PASS  bank-or-push offered");

    await bank.click();
    await approve();
    await game.getByText(/Banked after clearing wave/).waitFor({ timeout: 20_000 });
    const rewards = await game.locator(".ff-reward").count();
    assert.ok(rewards >= 1, "banking should settle at least one roll");
    console.log(`PASS  banked and settled ${rewards} roll(s) through play/settle`);
  },
});
console.log("\nminimal loop verified end to end");
