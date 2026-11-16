const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const {
  projectEntries,
  selectedProjectPaths,
  validateProjectSelection,
} = require("../dist/project-context.js");
const { matcher } = require("../dist/core.js");
test("project tree prunes ignored directories and blocks excluded/forged paths; fresh snapshot limits selection", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "np-context-"));
  try {
    await fs.mkdir(path.join(root, "src"));
    await fs.mkdir(path.join(root, "node_modules"));
    await fs.writeFile(path.join(root, "src", "keep.py"), "keep");
    await fs.writeFile(path.join(root, "src", "omit.py"), "omit");
    await fs.writeFile(
      path.join(root, "node_modules", "hidden.txt"),
      "must not scan",
    );
    await fs.writeFile(path.join(root, ".env"), "secret");
    const entries = await projectEntries(root, matcher("src/omit.py"));
    assert(entries.find((e) => e.path === "node_modules").blocked);
    assert(!entries.some((e) => e.path.includes("hidden.txt")));
    assert(entries.find((e) => e.path === ".env").blocked);
    assert(entries.find((e) => e.path === "src/omit.py").blocked);
    assert.equal(entries.find((e) => e.path === "src/keep.py").bytes, 4);
    assert.deepEqual(
      validateProjectSelection(entries, ["src/keep.py", "src/keep.py"]),
      ["src/keep.py"],
    );
    for (const value of [
      ["../secret"],
      [".env"],
      ["node_modules/hidden.txt"],
      ["src"],
      ["missing.py"],
      [23],
    ])
      assert.throws(() => validateProjectSelection(entries, value));
    assert.deepEqual(
      selectedProjectPaths({ "src/keep.py": "hash", "new.py": "hash" }, [
        "src/keep.py",
        "deleted.py",
      ]),
      ["src/keep.py"],
    );
    assert.deepEqual(selectedProjectPaths({ "new.py": "hash" }, []), []);
    assert.deepEqual(selectedProjectPaths({ "new.py": "hash" }), ["new.py"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
