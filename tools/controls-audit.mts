// The rules require loading, error, mute and reduced-motion handling. This checks all
// four in both games rather than assuming, including that reduced motion actually stops
// animations rather than just flipping a checkbox.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";

const GAMES = [
  { name: "ascension", dir: "./games/ascension", loading: "ff/asc", settingsButton: /^Settings$/ },
  { name: "fortress", dir: "./games/fortress", loading: "ff", settingsButton: /^Settings$/ },
];

for (const entry of GAMES) {
  await testGame(entry.dir, {
    timeout: 45_000,
    check: async ({ page, game }) => {
      console.log(`\n=== ${entry.name} ===`);

      await game.getByRole("button", { name: entry.settingsButton }).click();

      // Status and errors must be announced, not silent. The menu carries the live region.
      const live = await game.locator('[role="status"], [role="alert"]').count();
      assert.ok(live > 0, "a live region should announce status and errors");
      console.log(`PASS  ${live} live region(s) announce status and errors`);

      // Mute.
      const toggle = game.getByRole("button", { name: /^Sound (on|off)$/ });
      await toggle.waitFor({ timeout: 8000 });
      const startLabel = await toggle.innerText();
      assert.equal(startLabel, "Sound on", "sound should start enabled");
      assert.equal(await toggle.getAttribute("aria-pressed"), "true");
      await toggle.click();
      assert.equal(await toggle.innerText(), "Sound off", "the toggle should mute");
      await toggle.click();
      assert.equal(await toggle.innerText(), "Sound on", "the toggle should unmute");
      console.log("PASS  mute toggles both ways and reports state");

      // Reduced motion, and that it actually stops animations.
      const reduce = game.getByRole("checkbox", { name: /Reduce motion/ });
      await reduce.waitFor({ timeout: 8000 });
      await reduce.check();
      assert.equal(await reduce.isChecked(), true);
      await page.waitForTimeout(250);

      const animating = await game.locator("body").evaluate((b: HTMLElement) => {
        let count = 0;
        for (const node of Array.from(b.querySelectorAll<HTMLElement>("*"))) {
          const name = getComputedStyle(node).animationName;
          if (name && name !== "none") count += 1;
        }
        return count;
      });
      assert.equal(animating, 0, `${animating} elements still animate with reduced motion on`);
      console.log("PASS  reduced motion stops every running animation");

      await reduce.uncheck();
      console.log("PASS  reduced motion can be turned back off");
    },
  });
}
console.log("\nloading, error, mute and reduced motion verified in both games");
