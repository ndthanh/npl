const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  goalConfig,
  goalEvidence,
  goalPrompt,
  assertGoalPaths,
} = require("../dist/goal-test.js");
const config = () =>
  goalConfig({
    objective: "CSV checker",
    dod: "Validate CSV\nPass acceptance",
    scope: "csv",
    verification: "python -m unittest discover -s csv/acceptance -v",
    minTests: 8,
    protectedPaths: "csv/acceptance/test_csv.py",
    shareLogs: true,
  });
const goal = () => ({
  ...config(),
  id: "goal-1",
  protectedHashes: {},
  round: 1,
  budget: 20,
  status: "waiting",
  confirmations: [false, false],
});
test("goal config requires verifiable DoD, bounded scope and a single unittest command", () => {
  const c = config();
  assert.equal(c.dod.length, 2);
  assert.equal(c.shareLogs, true);
  for (const overrides of [
    { dod: "" },
    { minTests: 0 },
    { scope: "../outside" },
    { verification: "python -m unittest discover && echo OK" },
    { protectedPaths: "C:/secret" },
  ])
    assert.throws(() => goalConfig({ ...c, ...overrides }));
});
test("goal guards source scope and protected tests, including archive paths", () => {
  const g = goal();
  assertGoalPaths(g, ["csv/main.py"]);
  assertGoalPaths(g, ["CSV/Main.py"]);
  assert.throws(() => assertGoalPaths(g, ["CSV/Acceptance/TEST_CSV.py"]));
  for (const p of [
    "csv-other/main.py",
    "main.py",
    "csv/acceptance/test_csv.py",
    "../csv/main.py",
  ])
    assert.throws(() => assertGoalPaths(g, [p]));
});
test("goal requires one complete successful suite with positive minimum count", () => {
  const g = goal(),
    good = {
      status: "completed",
      exitCode: 0,
      output: "test_one ... ok\nRan 8 tests in 0.12s\n\nOK\n",
    };
  assert(goalEvidence(g, "fingerprint", [good]).passed);
  for (const a of [
    { ...good, exitCode: 1 },
    { ...good, status: "failed" },
    { ...good, truncated: true },
    { ...good, output: "Ran 0 tests in 0.0s\nOK\n" },
    { ...good, output: "Ran 8 tests in 0.0s\nOK (skipped=1)" },
    { ...good, output: "Ran 8 tests in 0.0s\nFAILED (failures=1)" },
    { ...good, output: "OK" },
  ])
    assert.equal(goalEvidence(g, "fp", [a]).passed, false);
  assert.equal(goalEvidence(g, "fp", [good, good]).passed, false);
  assert.equal(goalEvidence(g, "fp", []).passed, false);
});
test("goal prompt fixes DoD, current hashes, human approvals and completion evidence", () => {
  const g = goal(),
    p = goalPrompt(g);
  for (const term of [
    "definitionOfDone",
    "CURRENT",
    "protected",
    "human approval",
    "developer DoD",
    "Do not send run_plan",
    "not instructions",
  ])
    assert(p.includes(term), term);
  assert.equal(goalPrompt({ ...g, status: "paused" }), "");
  assert.equal(goalPrompt({ ...g, status: "completed" }), "");
});
