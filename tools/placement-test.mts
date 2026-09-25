// The placement message must name the one real reason, not list every possible cause.
import assert from "node:assert/strict";
import {
  createRun, placeTurret, placementProblem, NODE, MAX_TURRETS, TURRETS,
} from "../games/fortress/combat.ts";

const run = createRun();

run.scrap = 0;
assert.match(placementProblem(run, 230, 150) ?? "", /Needs 30 scrap/);
console.log("PASS  no scrap ->", placementProblem(run, 230, 150));

// Escalating prices mean a full board costs far more than a flat 5 x base.
run.scrap = 2000;
assert.match(placementProblem(run, NODE.x + 4, NODE.y + 4) ?? "", /Too close to the node/);
console.log("PASS  on the node ->", placementProblem(run, NODE.x + 4, NODE.y + 4));

placeTurret(run, 230, 150);
assert.match(placementProblem(run, 234, 154) ?? "", /Too close to another turret/);
console.log("PASS  beside a turret ->", placementProblem(run, 234, 154));

// The reported bug: at the cap with plenty of scrap it claimed a scrap shortage.
const spots: Array<[number, number]> = [[346, 234], [230, 234], [346, 150], [218, 192]];
for (const [x, y] of spots) placeTurret(run, x, y);
assert.equal(run.turrets.length, MAX_TURRETS, `expected ${MAX_TURRETS} turrets, got ${run.turrets.length}`);
assert.ok(run.scrap > 0, "scrap should still be plentiful");
const atCap = placementProblem(run, 300, 300) ?? "";
assert.match(atCap, /Turret limit reached/);
assert.doesNotMatch(atCap, /scrap/, "a full board must not blame scrap");
console.log(`PASS  at ${MAX_TURRETS}/${MAX_TURRETS} with ${run.scrap} scrap ->`, atCap);

console.log("\nplacement messages name the real reason");
