const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const {
  stageArchive,
  workspaceSnapshot,
  applyArchive,
  restoreArchive,
} = require("../dist/archive.js");
const { matcher, sha } = require("../dist/core.js");
const { execFile } = require("node:child_process"),
  { promisify } = require("node:util");
const exec = promisify(execFile);
const clean = async () => {};
const entry = (name, content) => ({
  path: name,
  base64: Buffer.from(content).toString("base64"),
});
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nopilot-archive-"));
  const root = path.join(dir, "workspace"),
    stage = path.join(dir, "revision");
  await fs.mkdir(root);
  return { dir, root, stage, ig: matcher() };
}
async function git(root, ...args) {
  return (
    await exec("git", args, { cwd: root, windowsHide: true })
  ).stdout.trim();
}
test("empty workspace receives text/binary project after Git backup; repeat update reuses runtime and restores", async () => {
  const f = await fixture();
  try {
    const plan = await stageArchive(
      f.root,
      f.stage,
      [
        entry("project/nopilot.json", '{"schemaVersion":1}'),
        entry("project/main.py", 'print("hello")'),
        entry("project/logo.png", Buffer.from([137, 80, 78, 71, 0, 255])),
      ],
      {},
      f.ig,
      "ctx",
    );
    assert.equal(plan.prefix, "project/");
    assert(plan.files.find((f) => f.path === "logo.png").binary);
    await assert.rejects(fs.stat(path.join(f.root, "main.py")));
    await applyArchive(plan, f.ig, clean);
    assert.equal(plan.state, "applied");
    assert.equal(
      await git(f.root, "rev-parse", plan.backup.ref),
      plan.backup.commit,
    );
    assert.equal(
      await git(f.root, "ls-tree", "--name-only", plan.backup.commit),
      "",
    );
    assert.deepEqual(
      await fs.readFile(path.join(f.root, "logo.png")),
      Buffer.from([137, 80, 78, 71, 0, 255]),
    );
    await fs.mkdir(path.join(f.root, ".venv"));
    await fs.writeFile(path.join(f.root, ".venv", "sentinel"), "reuse");
    const base = await workspaceSnapshot(f.root, f.ig);
    const update = await stageArchive(
      f.root,
      path.join(f.dir, "revision2"),
      [entry("main.py", 'print("updated")')],
      base,
      f.ig,
      "ctx2",
    );
    await applyArchive(update, f.ig, clean);
    assert.equal(
      await git(f.root, "show", update.backup.commit + ":main.py"),
      'print("hello")',
    );
    assert.equal(
      await fs.readFile(path.join(f.root, ".venv", "sentinel"), "utf8"),
      "reuse",
    );
    assert.equal(
      await fs.readFile(path.join(f.root, "nopilot.json"), "utf8"),
      '{"schemaVersion":1}',
    );
    await restoreArchive(update, clean);
    assert.equal(
      await fs.readFile(path.join(f.root, "main.py"), "utf8"),
      'print("hello")',
    );
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
test("backup commits actual uncommitted and untracked source without touching HEAD or user index", async () => {
  const f = await fixture();
  try {
    await git(f.root, "init", "--quiet");
    await fs.writeFile(path.join(f.root, "main.py"), "old");
    await git(f.root, "add", ".");
    await git(
      f.root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "initial",
    );
    const head = await git(f.root, "rev-parse", "HEAD");
    await fs.writeFile(path.join(f.root, "main.py"), "user staged");
    await git(f.root, "add", "main.py");
    await fs.writeFile(path.join(f.root, "main.py"), "user working");
    await fs.writeFile(path.join(f.root, "notes.txt"), "untracked");
    const indexBefore = await git(f.root, "ls-files", "--stage");
    const plan = await stageArchive(
      f.root,
      f.stage,
      [entry("main.py", "copilot update")],
      await workspaceSnapshot(f.root, f.ig),
      f.ig,
      "ctx",
    );
    await applyArchive(plan, f.ig, clean);
    assert.equal(await git(f.root, "rev-parse", "HEAD"), head);
    assert.equal(await git(f.root, "ls-files", "--stage"), indexBefore);
    assert.equal(
      await git(f.root, "show", plan.backup.commit + ":main.py"),
      "user working",
    );
    assert.equal(
      await git(f.root, "show", plan.backup.commit + ":notes.txt"),
      "untracked",
    );
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
test("missing ZIP paths are kept; deletes require matching explicit delivery metadata", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, "remove.txt"), "old");
    const base = await workspaceSnapshot(f.root, f.ig);
    const metadata = {
      schemaVersion: 1,
      baseContextId: "ctx",
      projectRoot: ".",
      commitMessage: "Remove obsolete file",
      deletePaths: ["remove.txt"],
    };
    const p = await stageArchive(
      f.root,
      f.stage,
      [
        entry("main.py", "new"),
        entry("nopilot-delivery.json", JSON.stringify(metadata)),
      ],
      base,
      f.ig,
      "ctx",
    );
    await applyArchive(p, f.ig, clean);
    await assert.rejects(fs.stat(path.join(f.root, "remove.txt")));
    await restoreArchive(p, clean);
    assert.equal(
      await fs.readFile(path.join(f.root, "remove.txt"), "utf8"),
      "old",
    );
    await assert.rejects(fs.stat(path.join(f.root, "main.py")));
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
test("stale source, edited staging, protected files and mismatched delivery base block before writes", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, "main.py"), "old");
    const base = await workspaceSnapshot(f.root, f.ig);
    await assert.rejects(
      () =>
        stageArchive(
          f.root,
          f.stage,
          [entry(".venv/python.exe", "evil")],
          base,
          f.ig,
          "ctx",
        ),
      /bảo vệ/,
    );
    await assert.rejects(
      () =>
        stageArchive(
          f.root,
          f.stage,
          [
            entry(
              "nopilot-delivery.json",
              JSON.stringify({ schemaVersion: 1, baseContextId: "wrong" }),
            ),
          ],
          base,
          f.ig,
          "ctx",
        ),
      /baseContextId/,
    );
    const p = await stageArchive(
      f.root,
      f.stage,
      [entry("main.py", "new")],
      base,
      f.ig,
      "ctx",
    );
    await fs.writeFile(path.join(f.root, "main.py"), "user edit");
    await assert.rejects(
      () => applyArchive(p, f.ig, clean),
      /Workspace đã đổi/,
    );
    await fs.writeFile(path.join(f.root, "main.py"), "old");
    await fs.writeFile(path.join(f.stage, "staged", "main.py"), "tampered");
    await assert.rejects(() => applyArchive(p, f.ig, clean), /Staged ZIP/);
    assert.equal(
      await fs.readFile(path.join(f.root, "main.py"), "utf8"),
      "old",
    );
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
test("mid-apply failure persists journal and can restore without rerunning, preserving later user edits", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.root, "a.py"), "old a");
    await fs.writeFile(path.join(f.root, "b.py"), "old b");
    const p = await stageArchive(
      f.root,
      f.stage,
      [entry("a.py", "new a"), entry("b.py", "new b")],
      await workspaceSnapshot(f.root, f.ig),
      f.ig,
      "ctx",
    );
    let checks = 0;
    await assert.rejects(
      () =>
        applyArchive(p, f.ig, async () => {
          if (++checks === 4) throw Error("injected failure");
        }),
      /injected failure/,
    );
    assert.equal(p.state, "interrupted");
    const restored = JSON.parse(
      await fs.readFile(path.join(f.stage, "apply-plan.json"), "utf8"),
    );
    await fs.writeFile(path.join(f.root, "a.py"), "user after crash");
    await assert.rejects(
      () => restoreArchive(restored, clean),
      /Source đã đổi/,
    );
    await fs.writeFile(path.join(f.root, "a.py"), "new a");
    await restoreArchive(restored, clean);
    assert.equal(await fs.readFile(path.join(f.root, "a.py"), "utf8"), "old a");
    assert.equal(await fs.readFile(path.join(f.root, "b.py"), "utf8"), "old b");
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
