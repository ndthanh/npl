const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { ensureIgnore, setupPlan } = require("../dist/onboarding.js");
const { fileChange } = require("../dist/changes.js");
test("/ignore creates a template once and preserves an existing user file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nopilot-ignore-"));
  try {
    const first = await ensureIgnore(dir);
    assert(first.created);
    assert.match(await fs.readFile(first.path, "utf8"), /node_modules/);
    await fs.writeFile(first.path, "my-custom-folder/\n");
    assert.equal((await ensureIgnore(dir)).created, false);
    assert.equal(await fs.readFile(first.path, "utf8"), "my-custom-folder/\n");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("setup plan uses a managed venv and includes bridge/data dependencies; a repeat does not recreate it", () => {
  const plan = setupPlan("python", "C:/managed", "C:/extension", false);
  assert.deepEqual(plan.commands[0].args.slice(0, 2), ["-m", "venv"]);
  assert(
    plan.commands[1].args.some((a) => a.endsWith("requirements-data.txt")),
  );
  assert.equal(
    setupPlan("python", "C:/managed", "C:/extension", true).commands.length,
    1,
  );
  assert(
    setupPlan(
      "python",
      "C:/managed",
      "C:/extension",
      true,
      true,
    ).commands[0].args.some((a) => a.endsWith("requirements-voice.txt")),
  );
});
test("file summary counts exact changed lines, additions/deletions, and binary files", () => {
  let change = fileChange(
    "main.py",
    Buffer.from("a\nb\n"),
    Buffer.from("a\nc\nd\n"),
  );
  assert.equal(change.added, 2);
  assert.equal(change.removed, 1);
  change = fileChange("new.py", null, Buffer.from("one\ntwo\n"));
  assert.equal(change.added, 2);
  assert.equal(change.operation, "add");
  assert(fileChange("image.png", null, Buffer.from([0, 255])).binary);
});
test("offline setup installs exclusively from the selected local wheelhouse", () => {
  const folder = "C:/Offline Wheels";
  const { commands } = setupPlan("python", "C:/managed", "C:/extension", true, false, folder);
  assert.deepEqual(commands[0].args.slice(0, 6), ["-m", "pip", "install", "--no-index", "--find-links", folder]);
});
