// On a phone, tapping is the only way to move, so nothing may cover the play area.
// Stations are entered from the HUD instead of a floating prompt; this proves the whole
// canvas stays tappable and that the HUD action and the E shortcut both still work.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";
import { project } from "../dist/friend-world.js";

const VIEW = { x: 320, y: 330, width: 960, height: 640 };

for (const [label, width, height] of [["phone", 390, 760], ["desktop", 960, 800]] as const) {
  await testGame("./games/fortress", {
    width, height, timeout: 45_000,
    check: async ({ page, game }) => {
      // How to Play opens on load, so every suite dismisses it before touching the world.
      const helpGotIt = game.getByRole("button", { name: /^Got it$/ });
      if (await helpGotIt.count() > 0) {
        await helpGotIt.click();
        await helpGotIt.waitFor({ state: "detached", timeout: 8000 });
      }
      const canvas = game.locator("canvas").first();
      const box = (await canvas.boundingBox())!;
      const at = () => canvas.evaluate((c: HTMLCanvasElement) => `${c.dataset.x},${c.dataset.y}`);

      console.log(`\n=== ${label} ${width}x${height} ===`);
      assert.equal(await game.locator(".rf-world-prompt").count(), 0,
        "no floating prompt should cover the world");

      // Nothing may intercept a tap anywhere across the play area.
      const [nx, ny] = project(288, 192);
      let blocked = 0;
      for (let dy = -90; dy <= 90; dy += 30) {
        for (let dx = -150; dx <= 150; dx += 50) {
          const pos = {
            x: ((nx + dx - VIEW.x) / VIEW.width) * box.width,
            y: ((ny + dy - VIEW.y) / VIEW.height) * box.height,
          };
          if (pos.x < 0 || pos.y < 0 || pos.x > box.width || pos.y > box.height) continue;
          const tag = await game.locator("body").evaluate((b: HTMLElement, p: { x: number; y: number }) => {
            const c = b.querySelector("canvas") as HTMLCanvasElement;
            const r = c.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + p.x, r.top + p.y) as HTMLElement | null;
            return el ? el.tagName : "none";
          }, pos);
          if (tag !== "CANVAS") blocked += 1;
        }
      }
      assert.equal(blocked, 0, `${blocked} taps around the node are intercepted`);
      console.log("PASS  every tap around the node reaches the world");

      // A ground tap walks.
      const before = await at();
      const target = project(288, 130);
      await canvas.click({ position: {
        x: ((target[0] - VIEW.x) / VIEW.width) * box.width,
        y: ((target[1] - VIEW.y) / VIEW.height) * box.height,
      } });
      await page.waitForTimeout(1500);
      const after = await at();
      assert.notEqual(before, after, "a ground tap must move the Friend");
      console.log(`PASS  ground tap walked the Friend: ${before} -> ${after}`);

      // Standing at the Node offers the HUD action.
      const nodeTarget = project(288, 215);
      await canvas.click({ position: {
        x: ((nodeTarget[0] - VIEW.x) / VIEW.width) * box.width,
        y: ((nodeTarget[1] - VIEW.y) / VIEW.height) * box.height,
      } });
      const enter = game.getByRole("button", { name: /^Enter The Node$/ });
      await enter.waitFor({ timeout: 12_000 });
      console.log("PASS  HUD offers Enter The Node when in range");

      await enter.click();
      await game.getByRole("button", { name: /^Begin defence run$/ }).waitFor({ timeout: 8000 });
      console.log("PASS  HUD action opens the station");
      await game.getByRole("button", { name: /^Close The Node$/ }).click();

      // And the keyboard shortcut still works.
      await canvas.focus();
      await page.keyboard.press("e");
      await game.getByRole("button", { name: /^Begin defence run$/ }).waitFor({ timeout: 8000 });
      console.log("PASS  E opens the station");
    },
  });
}
console.log("\ntaps and station entry behave correctly at both sizes");
