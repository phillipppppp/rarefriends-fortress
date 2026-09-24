// Sound was only ever wired to turret placement. This counts real Web Audio playback
// inside the game frame, so it fails if a cue is merely called but never sounds.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";
import { project } from "../dist/friend-world.js";

const VIEW = { x: 320, y: 330, width: 960, height: 640 };

for (const [label, width, height] of [["desktop", 960, 800], ["phone", 390, 760]] as const) {
  await testGame("./games/fortress", {
    width, height, timeout: 90_000,
    check: async ({ page, game }) => {
      console.log(`\n=== ${label} ${width}x${height} ===`);

      // Count every buffer actually started, inside the sandboxed frame.
      await game.locator("body").evaluate(() => {
        const w = window as unknown as { __cues: number };
        w.__cues = 0;
        const proto = (window as unknown as { AudioBufferSourceNode: { prototype: AudioBufferSourceNode } }).AudioBufferSourceNode.prototype;
        const original = proto.start;
        proto.start = function patched(this: AudioBufferSourceNode, ...args: unknown[]) {
          w.__cues += 1;
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        } as typeof proto.start;
      });
      const cues = () => game.locator("body").evaluate(() => (window as unknown as { __cues: number }).__cues);

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

      // Buying a Power Cell used to be silent.
      await tap(170, 120);
      await game.getByRole("button", { name: /^Enter Generator$/ }).click();
      await game.getByRole("button", { name: /^Buy one Power Cell/ }).click();
      await approve();
      await page.waitForTimeout(700);
      const afterBuy = await cues();
      assert.ok(afterBuy > 0, "buying a Power Cell should make a sound");
      console.log(`PASS  purchase sounded (${afterBuy} cue(s))`);
      await game.getByRole("button", { name: /^Close Generator$/ }).click();

      // Starting a run and fighting used to be silent.
      await tap(288, 215);
      await game.getByRole("button", { name: /^Enter The Node$/ }).click();
      await game.getByRole("button", { name: /^Begin defence run$/ }).click();
      await page.waitForTimeout(600);
      const afterStart = await cues();
      assert.ok(afterStart > afterBuy, "starting a run should make a sound");
      console.log(`PASS  run start sounded (${afterStart - afterBuy} cue(s))`);

      // Let a wave play so kills and the wave-clear cue fire.
      let combat = afterStart;
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(500);
        combat = await cues();
        if (combat > afterStart + 3) break;
        if (await game.getByRole("button", { name: /^Bank \d+ roll/ }).count() > 0) break;
      }
      assert.ok(combat > afterStart, `combat should make sounds (got ${combat - afterStart} during the wave)`);
      console.log(`PASS  combat sounded (${combat - afterStart} cue(s) during the wave)`);

      // Muting must actually silence it.
      await game.getByRole("button", { name: /^Settings$/ }).click();
      await game.getByRole("button", { name: /^Sound on$/ }).click();
      await game.getByRole("button", { name: /^Close Settings$/ }).click();
      const beforeMuted = await cues();
      await page.waitForTimeout(2500);
      const afterMuted = await cues();
      assert.equal(afterMuted, beforeMuted, `muting should stop playback (${afterMuted - beforeMuted} cues slipped through)`);
      console.log("PASS  mute silences playback");
    },
  });
}
console.log("\nsound verified on desktop and phone");
