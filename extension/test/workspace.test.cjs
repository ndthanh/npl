// Integration of the real orchestration with disk/Git/processes.
// Only VS Code UI/document APIs are mocked; this is not a substitute for live UI QA.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  Module = require("node:module");
let root,
  storage,
  api,
  app,
  dirty = new Set(),
  dialogs = 0,
  applyCalls = 0;
const uri = (file) => ({ fsPath: file, scheme: "file", toString: () => file });
class Edit {
  ops = [];
  replace(uri, range, content) {
    this.ops.push({ uri, content });
  }
  createFile(uri, opts) {
    this.ops.push({ uri, content: opts.contents });
  }
  deleteFile(uri) {
    this.ops.push({ uri, content: null });
  }
}
const config = new Map([
  ["pythonPath", process.env.NOPILOT_TEST_PYTHON || "python"],
]);
const vscode = {
  env: {},
  Uri: { file: uri },
  Range: class {},
  WorkspaceEdit: Edit,
  RelativePattern: class {
    constructor(root, pattern) {
      this.root = root;
      this.pattern = pattern;
    }
  },
  window: {
    createOutputChannel: () => ({
      append() {},
      appendLine() {},
      show() {},
      dispose() {},
    }),
    showWarningMessage: async () => {
      dialogs++;
      return undefined;
    },
  },
  workspace: {
    isTrusted: true,
    workspaceFolders: [],
    textDocuments: [],
    getConfiguration: () => ({ get: (k, d) => config.get(k) ?? d }),
    openTextDocument: async (u) => {
      const text = await fs.readFile(u.fsPath, "utf8");
      return {
        uri: u,
        getText: () => text,
        isDirty: dirty.has(u.fsPath),
        lineCount: text.split("\n").length,
        save: async () => true,
      };
    },
    applyEdit: async (edit) => {
      applyCalls++;
      for (const op of edit.ops) {
        if (op.content === null) await fs.unlink(op.uri.fsPath);
        else {
          await fs.mkdir(path.dirname(op.uri.fsPath), { recursive: true });
          await fs.writeFile(op.uri.fsPath, op.content);
        }
      }
      return true;
    },
    findFiles: async () => {
      const out = [];
      async function walk(dir) {
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.name === ".git" || e.name === ".venv") continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) await walk(full);
          else out.push(uri(full));
        }
      }
      await walk(root);
      return out;
    },
  },
  commands: { executeCommand: async () => {} },
  languages: { getDiagnostics: () => [] },
};
const original = Module._load;
Module._load = function (request, parent, ...rest) {
  return request === "vscode"
    ? vscode
    : original.call(this, request, parent, ...rest);
};
const { Nopilot } = require("../dist/extension.js"),
  { sha } = require("../dist/core.js");
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "nopilot-workspace-"));
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "nopilot-storage-"));
  vscode.workspace.workspaceFolders = [{ uri: uri(root) }];
  const workspaceState = new Map();
  app = new Nopilot({
    globalStorageUri: uri(storage),
    extensionPath: path.resolve(__dirname, ".."),
    workspaceState: {
      get: (k) => workspaceState.get(k),
      update: async (k, v) => workspaceState.set(k, v),
    },
    secrets: { get: async () => undefined },
  });
  await app.init();
});
after(() => app.dispose());
test("busy send queues without contacting Teams; drain pauses for approval, context mismatch, and uncertain outcomes", async () => {
  const c = app.current(),
    originalSend = app.send;
  let calls = 0;
  app.bridge.call = async () => {
    calls++;
    throw Error("must not call Teams");
  };
  app.busy = true;
  await app.send("queued first");
  await app.send("queued second");
  assert.equal(calls, 0);
  assert.equal(c.queue.length, 2);
  app.busy = false;
  c.pending = { status: "pending" };
  await app.drainQueue();
  assert.equal(c.queue.length, 2);
  c.pending = undefined;
  c.contextId = "changed";
  await app.drainQueue();
  assert.equal(c.queue[0].status, "needs-context");
  assert(c.queuePaused);
  for (const q of c.queue) {
    q.contextId = c.contextId;
    q.status = "queued";
  }
  c.queuePaused = false;
  const seen = [];
  app.send = async (text) => {
    seen.push(text);
  };
  await app.drainQueue();
  assert.deepEqual(seen, ["queued first", "queued second"]);
  assert.equal(c.queue.length, 0);
  app.busy = true;
  await originalSend.call(app, "uncertain");
  app.busy = false;
  app.send = async () => {
    app.event("RUN_ERROR", { message: "uncertain send" });
  };
  await app.drainQueue();
  assert.equal(c.queue[0].status, "unconfirmed");
  assert(c.queuePaused);
  await app.drainQueue();
  assert.equal(c.queue.length, 1);
  c.queue = [];
  c.queuePaused = false;
  app.send = originalSend;
});
async function base() {
  await fs.writeFile(path.join(root, "main.py"), 'print("old")\n');
  const c = app.current();
  c.files = [
    { path: "main.py", content: 'print("old")\n', hash: sha('print("old")\n') },
  ];
  c.contextId = "ctx";
  c.pending = undefined;
  c.mode = "develop";
  return c;
}
function proposal(content = 'print("new")\n') {
  return {
    id: "action",
    kind: "changes",
    reviewed: true,
    status: "pending",
    data: {
      type: "change_set",
      baseContextId: "ctx",
      edits: [{ path: "main.py", baseSha256: sha('print("old")\n'), content }],
    },
  };
}
test("disk edits after context block apply without WorkspaceEdit", async () => {
  await base();
  await fs.writeFile(path.join(root, "main.py"), "user edit");
  const calls = applyCalls;
  await assert.rejects(() => app.apply(proposal()), /đã thay đổi/);
  assert.equal(applyCalls, calls);
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    "user edit",
  );
});
test("dirty editor buffers block apply", async () => {
  await base();
  dirty.add(path.join(root, "main.py"));
  await assert.rejects(() => app.apply(proposal()), /chưa lưu/);
  dirty.clear();
});
test("review gate blocks code writes", async () => {
  await base();
  await assert.rejects(
    () => app.apply({ ...proposal(), reviewed: false }),
    /diff/,
  );
});
test("approved apply makes a real private Git checkpoint and updates only selected source", async () => {
  const c = await base();
  await fs.writeFile(path.join(root, "keep.txt"), "keep");
  await app.apply(proposal());
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("new")\n',
  );
  assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep");
  assert(c.checkpoint);
  assert.equal(c.checkpoint.files[0].content, 'print("old")\n');
  assert(
    (
      await fs.stat(
        path.join(storage, "conversations", c.id, "shadow-git", ".git"),
      )
    ).isDirectory(),
  );
});
test("missing base never overwrites an existing file", async () => {
  await base();
  const p = proposal();
  p.data.edits = [{ path: "keep.txt", baseSha256: null, content: "overwrite" }];
  await assert.rejects(() => app.apply(p), /đã thay đổi/);
  assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep");
});
test("run source changes expire approval before any process/dialog", async () => {
  await base();
  const fingerprint = await app.sourceFingerprint();
  await fs.writeFile(path.join(root, "main.py"), "changed");
  const count = dialogs;
  await assert.rejects(
    () =>
      app.runCommands({
        data: {
          sourceFingerprint: fingerprint,
          commands: [
            { program: "python", args: ["main.py"], cwd: ".", timeout: 30 },
          ],
        },
      }),
    /đã thay đổi/,
  );
  assert.equal(dialogs, count);
});
test("new local conversation does not call Teams new or delete", async () => {
  const before = app.current().id;
  app.bridge.call = async () => {
    throw Error("Unexpected bridge operation");
  };
  await app.newConversation();
  assert.notEqual(app.current().id, before);
});
test("an unresolved Teams identity never silently continues in the foreground chat", async () => {
  const c = app.current();
  c.started = true;
  c.teamsId = undefined;
  app.bridge.call = async () => ({
    connected: true,
    route: "/chat/conversation/wrong",
  });
  await assert.rejects(() => app.prepareTeams(), /Chưa xác định/);
});
test("project contract reuses the existing venv without recreating it", async () => {
  const c = await base();
  const env = path.join(root, ".venv", "Scripts", "python.exe");
  await fs.mkdir(path.dirname(env), { recursive: true });
  await fs.writeFile(env, "venv-sentinel");
  await fs.writeFile(
    path.join(root, "nopilot.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "fixture",
      runtime: "python",
      install: null,
      tasks: { start: { entrypoint: "main.py", args: [], timeoutSeconds: 30 } },
    }),
  );
  await app.projectPlan("start");
  assert.equal(c.pending.data.commands.length, 1);
  assert.equal(c.pending.data.commands[0].program, env);
  assert.equal(await fs.readFile(env, "utf8"), "venv-sentinel");
});
test("dependency install is skipped only with matching requirements cache", async () => {
  const c = await base();
  await fs.writeFile(path.join(root, "requirements.txt"), "requests==2.32.5\n");
  const contract = {
    schemaVersion: 1,
    name: "fixture",
    runtime: "python",
    install: { requirements: "requirements.txt", timeoutSeconds: 120 },
    tasks: { start: { entrypoint: "main.py", args: [], timeoutSeconds: 30 } },
  };
  await fs.writeFile(path.join(root, "nopilot.json"), JSON.stringify(contract));
  await app.projectPlan("start");
  assert(c.pending.data.commands.some((v) => v.args.includes("pip")));
  const key = c.pending.data.cacheKey;
  c.pending.status = "rejected";
  await app.ctx.workspaceState.update("dependencies:" + sha(root), key);
  await app.projectPlan("start");
  assert(!c.pending.data.commands.some((v) => v.args.includes("pip")));
  c.pending.status = "rejected";
  await fs.writeFile(path.join(root, "requirements.txt"), "requests==2.32.6\n");
  await app.projectPlan("start");
  assert(c.pending.data.commands.some((v) => v.args.includes("pip")));
});
test("edits to the staged diff invalidate review before applying", async () => {
  await base();
  const staged = path.join(storage, "staged.py");
  await fs.writeFile(staged, "user changed proposal");
  const p = proposal();
  p.reviewFiles = [{ path: staged, hash: sha("original proposal") }];
  const calls = applyCalls;
  await assert.rejects(() => app.apply(p), /diff đã được chỉnh sửa/);
  assert.equal(applyCalls, calls);
});
test("source changed during checkpoint creation is rechecked before WorkspaceEdit", async () => {
  await base();
  const original = vscode.workspace.openTextDocument;
  let reads = 0;
  vscode.workspace.openTextDocument = async (uri) => {
    if (uri.fsPath === path.join(root, "main.py") && ++reads === 2)
      await fs.writeFile(uri.fsPath, "user changed during checkpoint");
    return original(uri);
  };
  const calls = applyCalls;
  try {
    await assert.rejects(
      () => app.apply(proposal()),
      /trong lúc tạo checkpoint/,
    );
    assert.equal(applyCalls, calls);
    assert.equal(
      await fs.readFile(path.join(root, "main.py"), "utf8"),
      "user changed during checkpoint",
    );
  } finally {
    vscode.workspace.openTextDocument = original;
  }
});
test("turn budget pauses before running tools and consumed tool IDs cannot repeat", async () => {
  const c = await base();
  c.tools = true;
  c.turns = 20;
  c.toolIds = [];
  let calls = 0;
  app.bridge.call = async () => {
    calls++;
    throw Error("must not run");
  };
  const p = {
    id: "pending",
    kind: "tool",
    status: "running",
    data: {
      type: "tool_request",
      id: "tool-1",
      name: "web.read",
      args: { url: "https://example.com" },
    },
  };
  c.pending = p;
  await app.runTool(p);
  assert.equal(p.status, "paused");
  assert.equal(calls, 0);
  assert.deepEqual(c.toolIds, []);
  c.turns = 0;
  c.toolIds = ["tool-1"];
  await assert.rejects(() => app.runTool(p), /không chạy lặp/);
  assert.equal(calls, 0);
});
test("different workspaces persist to separate stores without overwriting legacy history", async () => {
  await app.persist();
  const originalHistory = await fs.readFile(
    path.join(storage, "history.json"),
    "utf8",
  );
  const otherRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "nopilot-other-workspace-"),
  );
  const otherStore = await fs.mkdtemp(
    path.join(os.tmpdir(), "nopilot-other-store-"),
  );
  vscode.workspace.workspaceFolders = [{ uri: uri(otherRoot) }];
  const other = new Nopilot({
    storageUri: uri(otherStore),
    globalStorageUri: uri(storage),
    extensionPath: path.resolve(__dirname, ".."),
    workspaceState: { get() {}, async update() {} },
    secrets: { async get() {} },
  });
  try {
    await other.init();
    assert.equal(other.current().root, otherRoot);
    assert.equal(other.current().messages.length, 0);
    assert.equal(
      await fs.readFile(path.join(storage, "history.json"), "utf8"),
      originalHistory,
    );
  } finally {
    other.dispose();
    await other.saveChain;
    vscode.workspace.workspaceFolders = [{ uri: uri(root) }];
  }
});
