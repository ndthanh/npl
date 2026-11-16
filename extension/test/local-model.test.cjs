const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const {
  validateLocalAction,
  LocalModelClient,
} = require("../dist/local-model-test.js");
const { localRead, localList } = require("../dist/local-tools-test.js");
const { matcher } = require("../dist/core.js");
const action = (type, extra = {}) => ({
  action: type,
  path: "",
  command: "",
  url: "",
  message: "next step",
  ...extra,
});
test("local proposals are strict, single-action, CMD only, and never execute during validation", () => {
  assert.equal(
    validateLocalAction(action("run.propose", { command: "echo SAFE" }))
      .command,
    "echo SAFE",
  );
  for (const a of [
    action("run.propose", { command: "powershell -Command whoami" }),
    action("answer", { command: "echo BAD" }),
    action("workspace.read"),
    action("web.propose", { url: "file:///C:/secret" }),
    action("web.propose", { url: "https://token:secret@example.com" }),
    { ...action("answer"), approved: true },
    action("execute"),
  ])
    assert.throws(() => validateLocalAction(a));
  assert.equal(
    validateLocalAction(action("web.propose", { url: "https://example.com/" }))
      .action,
    "web.propose",
  );
});
test("local tools apply ignore rules, bound reads, exclude GGUF, block traversal/binary and list relative paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "np-local-tools-"));
  try {
    await fs.writeFile(path.join(root, "main.py"), 'print("hello")');
    await fs.writeFile(path.join(root, ".env"), "SECRET");
    await fs.writeFile(path.join(root, "model.gguf"), "GGUF");
    await fs.writeFile(path.join(root, "private.txt"), "private");
    await fs.writeFile(path.join(root, "binary.dat"), Buffer.from([0, 1, 2]));
    await fs.writeFile(path.join(root, "log.txt"), "a".repeat(40000));
    const ig = matcher("private.txt");
    const list = await localList(root, ig);
    assert(list.paths.includes("main.py"));
    assert(!list.paths.includes(".env"));
    assert(!list.paths.includes("model.gguf"));
    assert(!list.paths.includes("private.txt"));
    assert.equal(
      (await localRead(root, "main.py", ig)).content,
      'print("hello")',
    );
    const large = await localRead(root, "log.txt", ig);
    assert.equal(large.content.length, 32768);
    assert.equal(large.truncated, true);
    for (const p of [
      "../escape",
      "C:/escape",
      ".env",
      "private.txt",
      "binary.dat",
    ])
      await assert.rejects(() => localRead(root, p, ig));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("local worker startup failure unlocks requests, no automatic retry and no model stays ready", async () => {
  const changes = [],
    client = new LocalModelClient(
      __dirname,
      () => path.join(__dirname, "missing-python.exe"),
      (s) => changes.push({ ...s }),
    );
  await assert.rejects(() => client.health(), /Python|worker/);
  assert.equal(client.state.status, "unloaded");
  await assert.rejects(() => client.plan("task", []), /Load/);
  client.dispose();
  assert(changes.length > 0);
});
