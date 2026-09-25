// The How to Play screen must open before anything else, name the controls that actually apply at
// this size, stay short, close three ways, and reopen from the HUD. Checked in both games at phone
// and desktop widths.
import assert from "node:assert/strict";
import { testGame } from "../scripts/testing.mjs";

const GAMES = [
  { dir: "./games/ascension", name: "ascension", list: ".asc-help", open: ".asc-help-open" },
  { dir: "./games/fortress", name: "fortress", list: ".ff-help", open: ".ff-help-open" },
] as const;

for (const game of GAMES) {
  for (const [label, width, height] of [["phone", 390, 760], ["desktop", 960, 800]] as const) {
    await testGame(game.dir, {
      width, height, timeout: 90_000,
      check: async ({ page, game: frame }) => {
        console.log(`\n=== ${game.name} ${label} ${width}x${height} ===`);
        const menu = frame.locator(".rf-frame-menu");
        const list = frame.locator(game.list);

        // 1. It is the first thing on screen, before any station or run.
        await menu.waitFor({ timeout: 20_000 });
        await list.waitFor({ timeout: 10_000 });
        const heading = await menu.locator("h2").innerText();
        assert.match(heading, /how to play/i, `expected the help title, got "${heading}"`);
        console.log(`PASS  opens on load, titled "${heading}"`);

        // 2. Short: four or five lines, no more.
        const lines = await list.locator("li").allInnerTexts();
        assert.ok(lines.length >= 4 && lines.length <= 5,
          `help should be 4-5 lines, found ${lines.length}`);
        console.log(`PASS  ${lines.length} lines`);
        for (const line of lines) console.log(`        - ${line.replace(/\s+/g, " ").slice(0, 88)}`);

        // 3. The controls named must match the input this size implies.
        const text = lines.join(" ");
        if (label === "phone") {
          assert.match(text, /tap/i, "a phone should be told about tapping");
          assert.doesNotMatch(text, /WASD|arrow keys/i, "a phone should not be told about WASD");
        } else {
          assert.match(text, /WASD|arrow keys/i, "a desktop should be told about the keys");
          assert.match(text, /press E/i, "a desktop should be told about E");
        }
        console.log(`PASS  names ${label} controls`);

        // 4. "Got it" closes it.
        await frame.getByRole("button", { name: /^Got it$/ }).click();
        await page.waitForTimeout(400);
        assert.equal(await list.count(), 0, "Got it should close the help");
        console.log("PASS  Got it closes it");

        // 5. The "?" in the HUD reopens it.
        await frame.locator(game.open).click();
        await list.waitFor({ timeout: 8000 });
        console.log("PASS  the ? in the HUD reopens it");

        // 6. Escape closes it.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        assert.equal(await list.count(), 0, "Escape should close the help");
        console.log("PASS  Escape closes it");

        // 7. So does the X, which is what touch needs.
        await frame.locator(game.open).click();
        await list.waitFor({ timeout: 8000 });
        await menu.getByRole("button", { name: /^Close How to Play$/ }).click();
        await page.waitForTimeout(400);
        assert.equal(await list.count(), 0, "the X should close the help");
        console.log("PASS  the X closes it");

        // 8. Once closed, the world is playable: nothing is left blocking it.
        assert.equal(await frame.locator(".rf-frame-menu").count(), 0, "no menu should remain open");
        const canvas = frame.locator("canvas").first();
        assert.ok(await canvas.isVisible(), "the world should be visible once help is dismissed");
        console.log("PASS  the world is clear afterwards");
      },
    });
  }
}
console.log("\nHow to Play verified in both games, at phone and desktop");
