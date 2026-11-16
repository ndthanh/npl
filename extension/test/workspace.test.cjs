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
  ViewColumn: { Active: 1 },
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
test("Goal applies approved source, stages tests without running, records failure, repairs and requires fresh DoD confirmation", async () => {
  await app.newConversation();
  const c = app.current();
  c.mode = "develop";
  c.autoWorkspace = true;
  const oracle =
    "import unittest\nfrom pathlib import Path\nclass GoalTest(unittest.TestCase):\n def test_one(self): self.assertEqual(Path('goal-qa/value.txt').read_text(), 'ready')\n def test_two(self): self.assertTrue(True)\n";
  await fs.mkdir(path.join(root, "goal-qa"), { recursive: true });
  await fs.writeFile(path.join(root, "goal-qa/test_acceptance.py"), oracle);
  const { goalConfig } = require("../dist/goal-test.js");
  c.goal = {
    ...goalConfig({
      objective: "ready",
      dod: "Value ready",
      scope: "goal-qa",
      verification: "python -m unittest discover -s goal-qa -v",
      minTests: 2,
      protectedPaths: ["goal-qa/test_acceptance.py"],
    }),
    id: "goal-test",
    protectedHashes: { "goal-qa/test_acceptance.py": sha(oracle) },
    round: 1,
    budget: 20,
    status: "waiting",
    confirmations: [false],
  };
  const stage = async (value) => {
    c.files = [];
    try {
      const content = await fs.readFile(
        path.join(root, "goal-qa/value.txt"),
        "utf8",
      );
      c.files.push({ path: "goal-qa/value.txt", content, hash: sha(content) });
    } catch {}
    c.contextId = require("node:crypto").randomUUID();
    await app.acceptResponse({
      answer: JSON.stringify({
        type: "change_set",
        baseContextId: c.contextId,
        edits: [
          {
            path: "goal-qa/value.txt",
            baseSha256: c.files[0]?.hash ?? null,
            content: value,
          },
        ],
        commitMessage: "Goal iteration",
      }),
    });
    assert.equal(c.goal.status, "approval");
    const count = c.activities?.filter((a) => a.kind === "command").length ?? 0;
    await app.approve(c.pending.id);
    assert.equal(c.pending.kind, "run");
    assert.equal(c.pending.data.goalVerification, true);
    assert.equal(c.goal.status, "testing");
    assert.equal(
      c.activities?.filter((a) => a.kind === "command").length ?? 0,
      count,
    );
  };
  await stage("broken");
  c.goal.shareLogs = true;
  const originalGoalSend = app.send,
    feedback = [];
  app.send = async (text) => {
    feedback.push(text);
  };
  try {
    await app.approve(c.pending.id);
  } finally {
    app.send = originalGoalSend;
  }
  assert.equal(feedback.length, 1);
  assert.match(feedback[0], /AssertionError/);
  assert.match(feedback[0], /CURRENT source hashes/);
  c.goal.shareLogs = false;
  assert.equal(c.goal.status, "needs_fix");
  assert.equal(c.goal.evidence.passed, false);
  assert.equal(c.goal.evidence.tests, 2);
  assert.match(c.goal.evidence.output, /AssertionError/);
  await stage("ready");
  await app.approve(c.pending.id);
  assert.equal(c.goal.status, "review");
  assert.equal(c.goal.evidence.passed, true);
  await app.goalAction("finish");
  assert.equal(c.goal.status, "review");
  assert.match(c.goal.error, /DoD/);
  await app.handle({
    type: "goalConfirm",
    id: c.goal.id,
    index: 0,
    confirmed: true,
  });
  vscode.workspace.textDocuments.push({
    uri: uri(path.join(root, "goal-qa/value.txt")),
    isDirty: true,
  });
  try {
    await app.goalAction("finish");
    assert.equal(c.goal.status, "review");
    assert.match(c.goal.error, /Lưu file/);
  } finally {
    vscode.workspace.textDocuments.pop();
  }
  await fs.writeFile(path.join(root, "goal-qa/value.txt"), "later-edit");
  await app.goalAction("finish");
  assert.equal(c.goal.status, "review");
  await fs.writeFile(path.join(root, "goal-qa/value.txt"), "ready");
  await app.goalAction("finish");
  assert.equal(c.goal.status, "completed");
});
test("Goal scope/protected tests block proposals, and rejected verification pauses without execution", async () => {
  await app.newConversation();
  const c = app.current();
  c.mode = "develop";
  c.goal = {
    ...app.rows.find((r) => r.goal?.id === "goal-test").goal,
    id: "goal-guard",
    status: "waiting",
    evidence: undefined,
  };
  c.files = [];
  await app.acceptResponse({
    answer: JSON.stringify({
      type: "change_set",
      baseContextId: c.contextId,
      edits: [{ path: "outside.txt", baseSha256: null, content: "blocked" }],
      commitMessage: "bad scope",
    }),
  });
  assert.equal(c.pending.status, "blocked");
  assert.equal(c.goal.status, "paused");
  await app.approve(c.pending.id);
  await assert.rejects(fs.stat(path.join(root, "outside.txt")));
  await app.goalAction("resume");
  assert.equal(c.pending.status, "blocked");
  assert.match(c.goal.error, /phạm vi/);
  delete c.pending;
  c.goal.status = "waiting";
  await app.stageGoalVerification();
  await app.rejectProposal(c.pending.id);
  assert.equal(c.goal.status, "paused");
  const n = c.activities?.length ?? 0;
  await app.approve(c.pending.id);
  assert.equal(c.activities?.length ?? 0, n);
  await fs.writeFile(
    path.join(root, "goal-qa/test_acceptance.py"),
    "# weakened",
  );
  await app.goalAction("verify");
  assert.match(c.goal.error, /bảo vệ/);
});
test("Goal budget never sends automatically after 20 turns and reload pauses rather than replaying commands", async () => {
  await app.newConversation();
  const c = app.current();
  const prior = app.rows.find((r) => r.goal?.id === "goal-test").goal;
  c.goal = {
    ...prior,
    id: "goal-budget",
    protectedPaths: [],
    protectedHashes: {},
    round: 20,
    budget: 20,
    status: "needs_fix",
    shareLogs: true,
  };
  const send = app.send;
  let sent = 0;
  app.send = async () => {
    sent++;
  };
  try {
    await app.goalFeedback();
    assert.equal(sent, 0);
    assert.equal(c.goal.status, "budget");
  } finally {
    app.send = send;
  }
  await app.persist();
  await app.init();
  assert.equal(app.current().goal.status, "paused");
  assert.equal(app.current().goal.round, 20);
});
test("Stop during Goal verification pauses the loop and never auto-sends failure feedback", async () => {
  await app.newConversation();
  const c = app.current();
  c.goal = {
    ...app.rows.find((r) => r.goal?.id === "goal-test").goal,
    id: "goal-stop",
    status: "waiting",
    protectedPaths: [],
    protectedHashes: {},
    verification: "python -m unittest discover -s goal-slow -v",
    minTests: 1,
    shareLogs: true,
  };
  await fs.mkdir(path.join(root, "goal-slow"), { recursive: true });
  await fs.writeFile(
    path.join(root, "goal-slow/test_slow.py"),
    "import unittest,time\nclass Slow(unittest.TestCase):\n def test_slow(self): time.sleep(60)\n",
  );
  await app.stageGoalVerification();
  const savedSend = app.send;
  let sends = 0;
  app.send = async () => {
    sends++;
  };
  try {
    const running = app.approve(c.pending.id);
    for (let i = 0; i < 100 && !app.activeChild; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert(app.activeChild);
    app.stopProcess();
    await running;
    assert.equal(c.goal.status, "paused");
    assert.equal(sends, 0);
    assert.match(c.goal.error, /dừng/);
  } finally {
    app.send = savedSend;
    await fs.rm(path.join(root, "goal-slow"), { recursive: true, force: true });
  }
});
test("Goal sends only fresh scoped source and a preflight failure pauses without consuming or replaying a turn", async () => {
  await app.newConversation();
  const c = app.current();
  c.projectSelection = ["main.py"];
  await fs.mkdir(path.join(root, "goal-scope"), { recursive: true });
  await fs.writeFile(path.join(root, "goal-scope/tool.py"), "value=1\n");
  const previous = app.bridge.call,
    prepare = app.prepareTeams,
    calls = [];
  app.bridge.call = async (method, params) => {
    calls.push({ method, params });
    if (method === "pack_project")
      return { base64: Buffer.from("test bundle").toString("base64") };
    if (method === "status") return { connected: true, route: "/chat" };
    if (method === "new") return {};
    if (method === "ask")
      return {
        route: "/chat/conversation/fixture",
        answer: "Need clarification",
      };
    throw Error(method);
  };
  try {
    await app.startGoal({
      objective: "scope goal",
      dod: "Pass suite",
      scope: "GOAL-SCOPE",
      verification: "python -m unittest discover -s goal-scope -v",
      minTests: 1,
    });
    assert.deepEqual(
      calls
        .find((x) => x.method === "pack_project")
        .params.entries.map((x) => x.path),
      ["goal-scope/tool.py"],
    );
    assert.match(
      calls.find((x) => x.method === "ask").params.prompt,
      /GOAL DEVELOPMENT CONTRACT/,
    );
    assert.equal(c.goal.round, 1);
    assert.equal(c.goal.status, "paused");
    c.goal.status = "waiting";
    app.prepareTeams = async () => {
      throw Error("fixture connection blocked");
    };
    await app.send("Continue goal");
    assert.equal(c.goal.round, 1);
    assert.equal(c.goal.status, "paused");
    assert.match(c.goal.error, /fixture connection blocked/);
    assert.equal(calls.filter((x) => x.method === "ask").length, 1);
  } finally {
    app.bridge.call = previous;
    app.prepareTeams = prepare;
    await fs.rm(path.join(root, "goal-scope"), {
      recursive: true,
      force: true,
    });
  }
});
test("Goal can explicitly restage a stored fenced reply after parser recovery without resending or writing source", async () => {
  await app.newConversation();
  const c = app.current();
  c.mode = "develop";
  c.goal = {
    ...app.rows.find((r) => r.goal?.id === "goal-test").goal,
    id: "goal-replay",
    status: "paused",
    protectedPaths: [],
    protectedHashes: {},
    scope: "goal-replay",
    round: 1,
  };
  c.files = [];
  const text =
    "````json\n" +
    JSON.stringify({
      type: "change_set",
      baseContextId: c.contextId,
      edits: [
        {
          path: "goal-replay/main.py",
          baseSha256: null,
          content: 'print("ready")\n',
        },
      ],
      commitMessage: "replay reply",
    }) +
    "\n````";
  c.messages.push({
    id: "stored-copilot",
    role: "assistant",
    text,
    source: "copilot",
  });
  const previous = app.bridge.call;
  app.bridge.call = async () => {
    throw Error("No bridge action allowed");
  };
  try {
    await app.goalAction("stage");
    assert.equal(c.pending.kind, "changes");
    assert.equal(c.pending.status, "pending");
    assert.equal(c.pending.data.goalId, c.goal.id);
    assert.equal(c.goal.status, "approval");
    assert.equal(c.goal.round, 1);
    await assert.rejects(fs.stat(path.join(root, "goal-replay/main.py")));
  } finally {
    app.bridge.call = previous;
  }
});
test("local last selects Copilot reference rather than a later local response and explicitly requests an approval proposal", async () => {
  await app.newConversation();
  const c = app.current();
  c.mode = "develop";
  c.messages.push({
    id: "copilot-source",
    role: "assistant",
    text: "COPILOT_MARKER: echo ORIGINAL",
  });
  c.messages.push({
    id: "local-source",
    role: "assistant",
    text: "LOCAL_MARKER",
    source: "local",
  });
  c.messages.push({
    id: "legacy-local",
    role: "assistant",
    text: "**Local model** · LEGACY_LOCAL_MARKER",
  });
  const previous = app.localModel;
  let task;
  app.localModel = {
    state: { status: "ready" },
    dispose() {},
    plan: async (t) => {
      task = t;
      return {
        action: {
          action: "answer",
          path: "",
          command: "",
          url: "",
          message: "ready",
        },
      };
    },
  };
  try {
    await app.send("/local last");
    assert(task.includes("run.propose"));
    assert(
      task.includes('"copilot_reference":"COPILOT_MARKER: echo ORIGINAL"'),
    );
    assert(!task.includes("LOCAL_MARKER"));
    assert.equal(c.messages.at(-1).source, "local");
  } finally {
    app.localModel = previous;
  }
});
test("local interpreter reads only allowed source, stages CMD without running, and does not submit Teams", async () => {
  await app.newConversation();
  const c = app.current();
  c.mode = "develop";
  c.pending = undefined;
  await fs.writeFile(path.join(root, "local-check.py"), 'print("local test")');
  const previous = app.localModel,
    bridge = app.bridge.call,
    observations = [];
  let calls = 0;
  app.localModel = {
    state: { status: "ready" },
    dispose() {},
    plan: async (task, seen) => {
      observations.push(structuredClone(seen));
      return {
        action:
          ++calls === 1
            ? {
                action: "workspace.read",
                path: "local-check.py",
                command: "",
                url: "",
                message: "read source",
              }
            : {
                action: "run.propose",
                path: "",
                command: "echo LOCAL_PROPOSAL",
                url: "",
                message: "approve command",
              },
      };
    },
  };
  app.bridge.call = async () => {
    throw Error("Local task must not call Teams or bridge");
  };
  try {
    await app.localTask("Read local-check.py then propose a test command.");
    assert.equal(c.pending.kind, "run");
    assert.equal(c.pending.status, "pending");
    assert.equal(c.pending.data.localOnly, true);
    assert.equal(c.pending.data.commands[0].command, "echo LOCAL_PROPOSAL");
    assert(observations[1][0].result.content.includes("local test"));
    assert(!c.activities.some((a) => a.kind === "command"));
    assert.equal(c.request, undefined);
    await assert.rejects(() => app.localTask("another task"), /đề xuất/);
  } finally {
    app.localModel = previous;
    app.bridge.call = bridge;
    await fs.unlink(path.join(root, "local-check.py"));
  }
});
test("Copilot contract → approved CMD → editable evidence stays in the same conversation", async () => {
  await app.newConversation();
  const c = app.current();
  c.mode = "develop";
  c.draft = "Bổ sung test cho trường hợp lỗi.";
  const previous = app.localModel;
  app.localModel = { state: { status: "unloaded" } };
  try {
    await app.localTask(JSON.stringify({
      type: "run_plan",
      commands: [{ shell: "cmd", command: "echo LOCAL_HANDOFF_OK", cwd: "." }],
    }), true);
    assert.equal(c.pending.kind, "run");
    assert.equal(c.pending.data.localOnly, true);
    assert.equal((c.activities ?? []).some((a) => a.kind === "command"), false);
    await app.approve(c.pending.id);
    assert.equal(c.pending.status, "completed");
    const run = c.activities.find((a) => a.kind === "command");
    assert.equal(run.exitCode, 0);
    await app.draftLocalResult(run.id);
    assert.match(c.draft, /^Bổ sung test/);
    assert(c.draft.includes(run.id));
    assert(c.draft.includes("LOCAL_HANDOFF_OK"));
    assert.equal(c.request, undefined);
    const draft = c.draft;
    await app.newConversation();
    await assert.rejects(() => app.draftLocalResult(run.id), /chưa sẵn sàng/);
    assert.equal(c.draft, draft);
  } finally {
    app.localModel = previous;
  }
});
test("local web approval stores tool output but never feeds it to Copilot", async () => {
  await app.newConversation();
  const c = app.current();
  c.tools = true;
  const previous = app.bridge.call,
    calls = [];
  app.bridge.call = async (method) => {
    calls.push(method);
    assert.equal(method, "web.read");
    return { url: "https://example.com/", text: "LOCAL_ONLY_RESULT" };
  };
  try {
    await app.acceptResponse({
      answer: JSON.stringify({
        type: "tool_request",
        id: require("node:crypto").randomUUID(),
        name: "web.read",
        args: { url: "https://example.com/" },
        localOnly: true,
      }),
    });
    c.turns = 20;
    await app.approve(c.pending.id);
    assert.equal(c.pending.status, "completed");
    assert.deepEqual(calls, ["web.read"]);
    assert.equal(c.turns, 20);
    assert.equal(c.request, undefined);
    assert(c.artifacts.some((a) => a.name.startsWith("web-context-")));
  } finally {
    app.bridge.call = previous;
  }
});
test("stopped chat without an ID can bind only through read-only exact-turn proof; unresolved identity requires a new conversation", async () => {
  await app.newConversation();
  const c = app.current(),
    previous = app.bridge.call,
    requestId = require("node:crypto").randomUUID();
  c.started = true;
  c.request = { requestId, phase: "stopped" };
  c.lastPrompt = "original stopped prompt";
  const calls = [];
  app.bridge.call = async (method, params) => {
    calls.push(method);
    if (method === "status") return { connected: true, route: "/chat" };
    if (method === "bind_stopped") {
      assert.equal(params.prompt, c.lastPrompt);
      assert.equal(params.requestId, requestId);
      return {
        confirmed: true,
        route: "/chat/conversation/11111111-1111-1111-1111-111111111111",
      };
    }
    throw Error("No send or new operation allowed");
  };
  try {
    await app.prepareTeams();
    assert.equal(c.teamsId, "11111111-1111-1111-1111-111111111111");
    assert.deepEqual(calls, ["status", "bind_stopped"]);
    c.teamsId = undefined;
    app.bridge.call = async (method) =>
      method === "status"
        ? { connected: true, route: "/chat" }
        : { confirmed: false };
    await assert.rejects(() => app.prepareTeams(), /Hội thoại mới/);
    assert.equal(c.teamsId, undefined);
  } finally {
    app.bridge.call = previous;
    c.request = undefined;
    c.started = false;
  }
});
test("only the exact active request and turn can show ephemeral previews; final reply imports once and late previews are ignored", async () => {
  await app.newConversation();
  const c = app.current();
  c.mode = "ask";
  const requestId = require("node:crypto").randomUUID();
  c.request = { requestId, phase: "submitted", turnId: "turn-1" };
  c.teamsId = "11111111-1111-1111-1111-111111111111";
  app.waitingCopilot = true;
  try {
    const count = c.messages.length,
      artifacts = c.artifacts.length;
    const send = (extra) =>
      app.requestProgress(c, {
        kind: "answer_preview",
        requestId,
        turnId: "turn-1",
        teamsId: c.teamsId,
        text: "partial",
        generating: true,
        ...extra,
      });
    send({ requestId: "wrong" });
    send({ turnId: "wrong" });
    send({ teamsId: "wrong" });
    assert.equal(app.state().copilotPreview, undefined);
    send({});
    assert.equal(app.state().copilotPreview.text, "partial");
    send({ text: "rewritten" });
    assert.equal(app.state().copilotPreview.text, "rewritten");
    assert.equal(c.messages.length, count);
    assert.equal(c.artifacts.length, artifacts);
    assert.equal(c.pending, undefined);
    assert(!JSON.stringify(c).includes("rewritten"));
    await app.ingestReply({ answer: "Final only", downloads: [] });
    assert.equal(app.state().copilotPreview, undefined);
    assert.equal(c.messages.filter((m) => m.role === "assistant").length, 1);
    send({ text: "late" });
    assert.equal(app.state().copilotPreview, undefined);
    await app.ingestReply({ answer: "Final only", downloads: [] });
    assert.equal(c.messages.filter((m) => m.role === "assistant").length, 1);
  } finally {
    app.waitingCopilot = false;
    app.copilotPreview = undefined;
    app.copilotPhase = "";
  }
});
test("reload removes old optical chat bookkeeping while preserving ordinary history and artifacts", async () => {
  await app.newConversation();
  const c = app.current();
  c.messages.push(
    {
      id: "old-optical-log",
      role: "system",
      text: "Đã đóng gói 7 file workspace theo .nopilotignore cho Decimen. ZIP chỉ lưu local; chưa gửi Copilot.",
    },
    { id: "ordinary-message", role: "assistant", text: "Keep me" },
  );
  c.artifacts.push(
    {
      id: "old-export",
      name: "decimen-deadbeef-root.zip",
      path: "unused",
      bytes: 0,
      mime: "application/zip",
    },
    {
      id: "ordinary-artifact",
      name: "project.zip",
      path: "unused",
      bytes: 0,
      mime: "application/zip",
    },
  );
  await app.persist();
  await app.init();
  const restored = app.current();
  assert(!restored.messages.some((m) => m.id === "old-optical-log"));
  assert(!restored.artifacts.some((a) => a.id === "old-export"));
  assert(restored.messages.some((m) => m.id === "ordinary-message"));
  assert(restored.artifacts.some((a) => a.id === "ordinary-artifact"));
});
test("/dec exports actual workspace independently of context selection and Copilot, with scoped close/cancellation", async () => {
  await app.newConversation();
  const c = await base();
  c.projectSelection = ["main.py"];
  await fs.writeFile(path.join(root, "dec-extra.txt"), "export this too");
  await fs.writeFile(path.join(root, "dec-ignore.txt"), "must omit");
  const ignore = path.join(root, ".nopilotignore");
  let original;
  try {
    original = await fs.readFile(ignore);
  } catch {}
  await fs.writeFile(
    ignore,
    (original?.toString() ?? "") + "\ndec-ignore.txt\n",
  );
  const bridge = app.bridge.call;
  app.bridge.call = async () => {
    throw Error("Decimen must not contact Teams or Python bridge");
  };
  try {
    const count = c.messages.filter((m) => m.role === "user").length;
    const artifactCount = c.artifacts.length,
      messageCount = c.messages.length;
    app.busy = true;
    await app.send("/dec");
    app.busy = false;
    const transfer = app.decTransfer;
    assert.equal(transfer.status, "ready", transfer.error);
    assert(transfer.files.includes("dec-extra.txt"));
    assert(!transfer.files.includes("dec-ignore.txt"));
    assert.equal(c.projectSelection.length, 1);
    assert.equal(c.messages.filter((m) => m.role === "user").length, count);
    assert(!c.queue?.some((m) => m.text === "/dec"));
    assert.equal(sha(app.decBytes), transfer.sha256);
    assert.equal(c.artifacts.length, artifactCount);
    assert.equal(c.messages.length, messageCount);
    await app.handle({ type: "decClose", id: "stale" });
    assert(app.decTransfer);
    await app.handle({ type: "decClose", id: transfer.id });
    assert.equal(app.decTransfer, undefined);
    assert.equal(app.decBytes, undefined);
    const preparing = app.openDecimen();
    const identifier = app.decTransfer.id;
    await app.handle({ type: "decClose", id: identifier });
    await preparing;
    assert.equal(app.decTransfer, undefined);
    assert.equal(app.decBytes, undefined);
  } finally {
    app.busy = false;
    app.bridge.call = bridge;
    await fs.unlink(path.join(root, "dec-extra.txt"));
    await fs.unlink(path.join(root, "dec-ignore.txt"));
    if (original) await fs.writeFile(ignore, original);
    else await fs.unlink(ignore);
  }
});
test("transient Windows history sharing locks retry; a failed save never poisons later snapshots", async () => {
  const rename = fs.rename;
  let attempts = 0;
  try {
    fs.rename = async (from, to) => {
      if (to === path.join(app.store, "history.json") && attempts++ < 2)
        throw Object.assign(Error("sharing violation"), { code: "EPERM" });
      return rename(from, to);
    };
    await app.persist();
    assert.equal(attempts, 3);
    fs.rename = async () => {
      throw Object.assign(Error("disk failure"), { code: "ENOSPC" });
    };
    await assert.rejects(app.persist(), /disk failure/);
    fs.rename = rename;
    app.current().draft = "Saved after a failed write";
    await app.persist();
    const saved = JSON.parse(
      await fs.readFile(path.join(app.store, "history.json"), "utf8"),
    );
    assert.equal(
      saved.rows.find((c) => c.id === app.current().id).draft,
      "Saved after a failed write",
    );
    assert(
      !(await fs.readdir(app.store)).some(
        (name) => name.startsWith("history.json.") && name.endsWith(".tmp"),
      ),
    );
  } finally {
    fs.rename = rename;
  }
});
test("early Teams identity survives lost RPC reply and reload; recovery restores the request and imports it only once", async () => {
  const isolated = path.join(storage, "recovery-instance");
  const context = { ...app.ctx, storageUri: { fsPath: isolated } };
  const first = new Nopilot(context);
  await first.init();
  const c = first.current();
  c.mode = "ask";
  const cid = "77777777-7777-7777-7777-777777777777";
  first.bridge.call = async (method, params, progress) => {
    if (method === "status") return { connected: true, route: "/chat" };
    if (method === "new") return {};
    if (method === "ask") {
      const journal = JSON.parse(await fs.readFile(params.journalFile, "utf8"));
      assert.equal(journal.phase, "prepared");
      assert.equal(params.requestId, c.request.requestId);
      Object.assign(journal, {
        phase: "submitted",
        teamsId: cid,
        turnId: "expected-turn",
        beforeTurns: [],
      });
      await fs.writeFile(params.journalFile, JSON.stringify(journal));
      progress({
        kind: "request",
        requestId: params.requestId,
        phase: "submitted",
        teamsId: cid,
        turnId: "expected-turn",
      });
      throw Error("Simulated lost RPC response");
    }
    throw Error(method);
  };
  await first.send("Recovery test prompt");
  assert.equal(c.teamsId, cid);
  assert.equal(c.recovery.kind, "unconfirmed");
  await first.persist();
  const second = new Nopilot(context);
  await second.init();
  const calls = [];
  second.bridge.call = async (method, params) => {
    calls.push({ method, params });
    if (method === "connect") return { connected: true, editorPresent: true };
    if (method === "recover")
      return {
        completion: "completed",
        route: "/chat/conversation/" + cid,
        question: second.current().lastPrompt,
        answer: "Recovered specific turn",
        downloads: [],
      };
    throw Error("Must not send or create a Teams chat: " + method);
  };
  try {
    assert.equal(second.current().teamsId, cid);
    assert.equal(second.current().recovery.kind, "interrupted");
    await second.handle({ type: "recoverCopilot" });
    await second.handle({ type: "recoverCopilot" });
    assert.equal(calls.filter((x) => x.method === "recover").length, 1);
    assert.equal(
      second
        .current()
        .messages.filter((m) => m.text === "Recovered specific turn").length,
      1,
    );
    assert.equal(second.current().request.imported, true);
    const third = new Nopilot(context);
    await third.init();
    assert(third.current().request.imported);
    third.dispose();
  } finally {
    first.dispose();
    second.dispose();
  }
});
test("web tool feeds small Markdown inline and uploads the complete large result as a single context file", async () => {
  for (const large of [false, true]) {
    const c = app.makeConversation();
    c.mode = "ask";
    c.tools = true;
    const receipt = "receipt-" + (large ? "large" : "small"),
      markdown =
        "# Web source\n\nContext receipt: " +
        receipt +
        "\n" +
        "Nội dung đã đọc.\n".repeat(large ? 1200 : 2);
    const result = {
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      receipt,
      markdown,
    };
    const calls = [];
    app.bridge.call = async (method, params) => {
      calls.push({ method, params });
      if (method === "web.read") return result;
      if (method === "status") return { connected: true, route: "/chat" };
      if (method === "new") return {};
      if (method === "ask")
        return {
          answer: "Context consumed",
          route: "/chat/conversation/88888888-8888-8888-8888-888888888888",
        };
      throw Error(method);
    };
    const pending = {
      id: "context-tool-" + large,
      kind: "tool",
      status: "running",
      data: {
        type: "tool_request",
        id: "web-" + large,
        name: "web.read",
        args: { url: result.url },
        question: "Summarize the supplied context",
      },
    };
    c.pending = pending;
    await app.runTool(pending);
    const sent = calls.find((call) => call.method === "ask").params;
    if (large) {
      assert.equal(sent.uploads.length, 1);
      const text = await fs.readFile(sent.uploads[0], "utf8");
      const context = JSON.parse(text);
      assert.equal(context.result.markdown, markdown);
      assert.equal(context.result.receipt, receipt);
      assert(sent.prompt.includes("Read attached tool result"));
    } else {
      assert.equal(sent.uploads.length, 0);
      assert(sent.prompt.includes(receipt));
      assert(sent.prompt.includes("Nội dung đã đọc"));
    }
    assert(c.messages.some((message) => message.text === "Context consumed"));
  }
});
test("opening chat automatically connects once, reports progress, and does not mutate the Teams conversation", async () => {
  const original = app.bridge.call;
  const readRuntime = app.readRuntime;
  app.readRuntime = async () => ({ packages: { frida: { installed: true }, pefile: { installed: true } } });
  const calls = [];
  let finish;
  app.bridge.call = async (method, params, progress) => {
    calls.push(method);
    assert.equal(method, "connect");
    progress({
      stage: "retrying",
      attempt: 2,
      retryIn: 5,
      message: "Đang thử lại",
    });
    return new Promise((resolve) => (finish = resolve));
  };
  try {
    const before = app.current().messages.length;
    await app.handle({ type: "ready" });
    await app.handle({ type: "ready" });
    const manual = app.connect();
    assert.deepEqual(calls, ["connect"]);
    assert.equal(app.connection.phase, "retrying");
    assert.equal(app.connection.retryIn, 5);
    assert.equal(app.busy, false);
    finish({
      connected: true,
      editorPresent: true,
      route: "/chat/conversation/existing",
    });
    await manual;
    assert.equal(app.connection.phase, "connected");
    assert.equal(app.current().messages.length, before);
    assert.equal(app.connectionPromise, undefined);
  } finally {
    app.bridge.call = original;
    app.readRuntime = readRuntime;
    app.runtimeSetup = undefined;
  }
});
test("missing Frida on first open shows setup and does not attempt Teams attach", async () => {
  const readRuntime = app.readRuntime;
  const call = app.bridge.call;
  app.readRuntime = async () => ({ packages: { pefile: { installed: true } } });
  app.bridge.call = async () => assert.fail("Teams attach attempted without Frida");
  try {
    await app.handle({ type: "ready" });
    assert.equal(app.state().runtimeSetup.phase, "missing");
    assert.deepEqual(app.state().runtimeSetup.missing, ["frida"]);
  } finally {
    app.readRuntime = readRuntime;
    app.bridge.call = call;
    app.runtimeSetup = undefined;
  }
});
test("new visible conversation starts discovery; failure keeps drafts, unlocks retry, and never posts an error message to chat", async () => {
  const original = app.bridge.call;
  let calls = 0;
  const view = { postMessage: async () => true };
  app.views.add(view);
  app.bridge.call = async (method) => {
    assert.equal(method, "connect");
    calls++;
    throw Error("No accessible Copilot frame found");
  };
  try {
    await app.newConversation();
    const c = app.current();
    c.draft = "Keep my draft";
    if (app.connectionPromise) await app.connectionPromise.catch(() => {});
    assert.equal(calls, 1);
    assert.equal(app.connection.phase, "failed");
    assert.equal(c.draft, "Keep my draft");
    assert.equal(c.messages.length, 0);
    assert.equal(app.busy, false);
    app.bridge.call = async (method) => {
      assert.equal(method, "connect");
      calls++;
      return { connected: true, editorPresent: true };
    };
    await app.connect();
    assert.equal(calls, 2);
    assert.equal(app.connection.phase, "connected");
  } finally {
    app.views.delete(view);
    app.bridge.call = original;
  }
});
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
  c.reviewMode = "fast";
  return c;
}
function proposal(content = 'print("new")\n') {
  return {
    id: "action",
    kind: "changes",
    reviewed: true,
    reviewConfirmed: true,
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
    (await fs.stat(path.join(c.checkpoint.gitDirectory, ".git"))).isDirectory(),
  );
});
test("JSON changes keep Git metadata short when VS Code workspaceStorage paths exceed Windows MAX_PATH", async () => {
  const c = await base(),
    originalStore = app.store;
  const deep = path.join(
    storage,
    "deep-storage-" + "a".repeat(70),
    "workspace-" + "b".repeat(70),
    "conversation-" + "c".repeat(70),
  );
  assert(deep.length > 260);
  await fs.mkdir(deep, { recursive: true });
  app.store = deep;
  try {
    await app.apply(proposal());
    assert.equal(
      await fs.readFile(path.join(root, "main.py"), "utf8"),
      'print("new")\n',
    );
    assert(!c.checkpoint.gitDirectory.startsWith(deep));
    assert(
      (
        await fs.stat(path.join(c.checkpoint.gitDirectory, ".git"))
      ).isDirectory(),
    );
    const { execFileSync } = require("node:child_process");
    assert.match(
      execFileSync(
        "git",
        [
          "--git-dir=" + path.join(c.checkpoint.gitDirectory, ".git"),
          "rev-parse",
          "HEAD",
        ],
        { encoding: "utf8" },
      ).trim(),
      /^[a-f0-9]{40}$/,
    );
  } finally {
    app.store = originalStore;
  }
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
test("ZIP response stages a review card, applies after review, and accepts changed ZIP bytes under the same name", async () => {
  const c = await base();
  c.workspaceBase = await require("../dist/archive.js").workspaceSnapshot(
    root,
    require("../dist/core.js").matcher(),
  );
  let revision = 1;
  app.bridge.call = async (method) => {
    if (method === "download")
      return {
        base64: Buffer.from("zip fixture " + revision).toString("base64"),
      };
    if (method === "unpack_project")
      return {
        entries: [
          {
            path: "main.py",
            base64: Buffer.from("zip update " + revision).toString("base64"),
          },
        ],
      };
    throw Error("Unexpected " + method);
  };
  const reply = { downloads: [{ name: "project.zip" }] };
  await app.acceptResponse(reply);
  assert.equal(c.pending.kind, "archive");
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("old")\n',
  );
  const pending = c.pending;
  await assert.rejects(() => app.applyProjectArchive(pending), /Xem thay đổi/);
  await app.review();
  if (
    app.current().pending?.status === "pending" &&
    app.current().pending.reviewed
  )
    await app.confirmReview(
      app.current().pending.id,
      app.current().pending.reviewRevision,
      true,
    );
  await app.applyProjectArchive(pending);
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    "zip update 1",
  );
  assert(c.checkpoint.archivePlan.backup.commit);
  assert.equal(c.autoWorkspace, true);
  const count = c.artifacts.length;
  await app.acceptResponse(reply);
  assert.equal(c.artifacts.length, count);
  revision = 2;
  c.workspaceBase = await require("../dist/archive.js").workspaceSnapshot(
    root,
    require("../dist/core.js").matcher(),
  );
  await app.acceptResponse(reply);
  assert.equal(c.artifacts.length, count + 1);
  assert.equal(c.pending.kind, "archive");
  assert.equal(c.pending.data.files[0].before, sha("zip update 1"));
  c.pending.status = "rejected";
});
test("failed pre-write Git backup can be explicitly reviewed and approved again, but partial updates cannot", async () => {
  const c = await base();
  const { stageArchive, workspaceSnapshot } = require("../dist/archive.js");
  const ig = await app.ignores();
  const plan = await stageArchive(
    root,
    path.join(storage, "retry-revision"),
    [
      {
        path: "main.py",
        base64: Buffer.from("retry update").toString("base64"),
      },
    ],
    await workspaceSnapshot(root, ig),
    ig,
    c.contextId,
  );
  const pending = (c.pending = {
    id: "retry-archive",
    kind: "archive",
    status: "pending",
    data: plan,
  });
  await app.review();
  if (
    app.current().pending?.status === "pending" &&
    app.current().pending.reviewed
  )
    await app.confirmReview(
      app.current().pending.id,
      app.current().pending.reviewRevision,
      true,
    );
  const mkdtemp = fs.mkdtemp;
  fs.mkdtemp = async (prefix, ...args) => {
    if (prefix.includes("np-git-")) throw Error("injected backup failure");
    return mkdtemp(prefix, ...args);
  };
  try {
    await app.approve(pending.id);
  } finally {
    fs.mkdtemp = mkdtemp;
  }
  assert.equal(pending.status, "failed");
  assert.match(pending.error, /injected backup failure/);
  assert.equal(plan.state, "staged");
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("old")\n',
  );
  await app.review();
  if (
    app.current().pending?.status === "pending" &&
    app.current().pending.reviewed
  )
    await app.confirmReview(
      app.current().pending.id,
      app.current().pending.reviewRevision,
      true,
    );
  assert.equal(pending.status, "pending");
  await app.approve(pending.id);
  assert.equal(pending.data.state, "applied", c.messages.at(-1).text);
  assert.equal(c.checkpoint.changeId, pending.id);
  await app.persist();
  await app.init();
  assert.equal(
    app.current().checkpoint.changeId,
    pending.id,
    "Undo identity survives host restart",
  );
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    "retry update",
  );
  app.current().pending = {
    ...pending,
    status: "failed",
    data: { ...plan, state: "interrupted" },
  };
  await app.review();
  if (
    app.current().pending?.status === "pending" &&
    app.current().pending.reviewed
  )
    await app.confirmReview(
      app.current().pending.id,
      app.current().pending.reviewRevision,
      true,
    );
  assert.equal(app.current().pending.status, "failed");
});
test("existing Teams attachments require a choice and preserve the local draft", async () => {
  await app.newConversation();
  const c = app.current(), original = app.bridge.call;
  const warn = vscode.window.showWarningMessage, calls = [];
  const local = { id: "local-file", name: "local.txt", path: "local.txt", bytes: 1, mime: "text/plain" };
  c.attachments = [local];
  app.bridge.call = async (method, params) => {
    calls.push(method);
    if (method === "status") return { connected: true, route: "/chat", attachments: ["in-teams.pdf"] };
    if (method === "clear_attachments") assert.deepEqual(params, { route: "/chat", attachments: ["in-teams.pdf"] });
    if (method === "ask") {
      assert.deepEqual(params.uploads, [local.path]);
      return { route: "/chat", answer: "ok" };
    }
    return {};
  };
  try {
    vscode.window.showWarningMessage = async () => "Tôi sẽ tự bỏ";
    await app.send("Keep this prompt");
    assert.deepEqual(calls, ["status"]);
    assert.equal(c.draft, "Keep this prompt");
    assert.deepEqual(c.attachments, [local]);
    vscode.window.showWarningMessage = async () => "Bỏ đính kèm và tiếp tục";
    await app.send(c.draft);
    assert.deepEqual(calls, ["status", "status", "clear_attachments", "new", "ask"]);
    assert.equal(c.draft, "");
    assert.deepEqual(c.attachments, []);
  } finally {
    app.bridge.call = original;
    vscode.window.showWarningMessage = warn;
  }
});
test("Include project defaults off and bundles fresh source when explicitly enabled", async () => {
  await app.newConversation();
  const c = app.current();
  assert.equal(c.mode, "develop");
  assert.equal(c.autoWorkspace, true);
  assert.equal(c.includeProject, false);
  await app.handle({ type: "includeProject", enabled: true });
  await fs.writeFile(path.join(root, "main.py"), "fresh source");
  const calls = [];
  app.bridge.call = async (method, params) => {
    calls.push({ method, params });
    if (method === "pack_project")
      return { base64: Buffer.from("packed fixture").toString("base64") };
    if (method === "status") return { connected: true, route: "/chat" };
    if (method === "new") return {};
    if (method === "ask")
      return { route: "/chat/conversation/fixture", answer: "ok" };
    throw Error("Unexpected " + method);
  };
  await app.send("Please update the project");
  const pack = calls.find((c) => c.method === "pack_project");
  assert(pack);
  assert.equal(
    Buffer.from(
      pack.params.entries.find((e) => e.path === "main.py").base64,
      "base64",
    ).toString(),
    "fresh source",
  );
  assert(!pack.params.entries.some((e) => e.path.includes(".venv")));
  assert(
    (await fs.readFile(path.join(root, ".nopilotignore"), "utf8")).includes(
      "node_modules/",
    ),
  );
  assert.equal(calls.filter((c) => c.method === "ask").length, 1);
  assert.match(
    calls.find((c) => c.method === "ask").params.prompt,
    /nopilot-delivery.json/,
  );
});
test("manual ZIP preview and selected import stage only chosen files, require review, and back up before copy", async () => {
  const c = await base();
  const zipPath = path.join(storage, "manual.zip");
  await fs.writeFile(zipPath, "fixture");
  c.artifacts.push({
    id: "manual",
    name: "manual.zip",
    path: zipPath,
    bytes: 7,
  });
  app.bridge.call = async (method) => {
    assert.equal(method, "unpack_project");
    return {
      entries: [
        {
          path: "project/nopilot-delivery.json",
          base64: Buffer.from(
            JSON.stringify({ deletePaths: ["keep.txt"] }),
          ).toString("base64"),
        },
        {
          path: "project/nopilot.json",
          base64: Buffer.from("{}").toString("base64"),
        },
        {
          path: "project/main.py",
          base64: Buffer.from("selected update").toString("base64"),
        },
        {
          path: "project/other.txt",
          base64: Buffer.from("not selected").toString("base64"),
        },
        {
          path: "project/.env",
          base64: Buffer.from("secret").toString("base64"),
        },
      ],
    };
  };
  await app.previewZip("manual");
  assert.equal(c.zipPreview.files.length, 5);
  assert(c.zipPreview.files.find((f) => f.path === ".env").blocked);
  assert(c.zipPreview.files.find((f) => f.path.includes("delivery")).blocked);
  await assert.rejects(
    () => app.copyZip("manual", ["missing.txt"], false),
    /không thuộc/,
  );
  await app.copyZip("manual", ["main.py"], false);
  assert.equal(c.pending.data.files.length, 1);
  assert.equal(c.pending.data.files[0].path, "main.py");
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("old")\n',
  );
  await assert.rejects(
    () => app.applyProjectArchive(c.pending),
    /Xem thay đổi/,
  );
  await app.review();
  if (
    app.current().pending?.status === "pending" &&
    app.current().pending.reviewed
  )
    await app.confirmReview(
      app.current().pending.id,
      app.current().pending.reviewRevision,
      true,
    );
  await app.applyProjectArchive(c.pending);
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    "selected update",
  );
  assert(c.checkpoint.archivePlan.backup.commit);
  assert.equal(await fs.readFile(path.join(root, "keep.txt"), "utf8"), "keep");
  await app.copyZip("manual", undefined, true);
  assert.deepEqual(c.pending.data.files.map((f) => f.path).sort(), [
    "nopilot.json",
    "other.txt",
  ]);
  await assert.rejects(() => fs.stat(path.join(root, "other.txt")), /ENOENT/);
  await app.review();
  if (
    app.current().pending?.status === "pending" &&
    app.current().pending.reviewed
  )
    await app.confirmReview(
      app.current().pending.id,
      app.current().pending.reviewRevision,
      true,
    );
  await app.applyProjectArchive(c.pending);
  assert.equal(
    await fs.readFile(path.join(root, "other.txt"), "utf8"),
    "not selected",
  );
  await assert.rejects(() => fs.stat(path.join(root, ".env")), /ENOENT/);
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
test("Execute resolves SQL from the stored assistant snippet rather than accepting webview SQL", async () => {
  const c = app.current(),
    open = app.openDatabase,
    seen = [];
  app.openDatabase = async (sql) => seen.push(sql);
  c.messages.push(
    {
      id: "sql-a",
      role: "assistant",
      text: "```python\nprint(1)\n```\n```sql\nSELECT 1;\n```\n```SQL\nSELECT '<x>';\n```",
    },
    { id: "sql-user", role: "user", text: "```sql\nSELECT 3;\n```" },
  );
  try {
    await app.handle({
      type: "executeSql",
      id: "sql-a",
      index: 1,
      sql: "DROP TABLE sales",
    });
    assert.deepEqual(seen, ["SELECT '<x>';\n"]);
    await assert.rejects(
      () => app.handle({ type: "executeSql", id: "sql-user", index: 0 }),
      /không còn/,
    );
    await assert.rejects(
      () => app.handle({ type: "executeSql", id: "sql-a", index: 99 }),
      /không còn/,
    );
  } finally {
    app.openDatabase = open;
  }
});
async function chatFixture() {
  await app.newConversation();
  const c = app.current();
  c.mode = "ask";
  c.autoWorkspace = false;
  c.files = [];
  return c;
}
async function waitFor(predicate) {
  const until = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > until) throw Error("test wait timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
test("Oops reply records Teams identity, releases busy, allows the next prompt and a new local conversation", async () => {
  const c = await chatFixture();
  let asks = 0;
  app.bridge.call = async (method) =>
    method === "status"
      ? {
          connected: true,
          route: c.teamsId
            ? "/chat/conversation/11111111-1111-1111-1111-111111111111"
            : "/chat",
        }
      : method === "new"
        ? {}
        : method === "ask"
          ? ++asks === 1
            ? {
                route:
                  "/chat/conversation/11111111-1111-1111-1111-111111111111",
                completion: "failed",
                serviceError: { retryAvailable: true },
                answer: "",
              }
            : {
                route:
                  "/chat/conversation/11111111-1111-1111-1111-111111111111",
                answer: "Recovered",
              }
          : Promise.reject(Error(method));
  await app.send("first question");
  assert.equal(app.busy, false);
  assert.equal(c.teamsId, "11111111-1111-1111-1111-111111111111");
  assert.equal(c.recovery.kind, "failed");
  assert.match(app.status, /Copilot báo lỗi/);
  await app.send("different follow-up");
  assert.equal(asks, 2);
  assert.equal(c.recovery, undefined);
  assert(c.messages.some((m) => m.text === "Recovered"));
  await app.newConversation();
  assert.notEqual(app.current().id, c.id);
});
test("steer signals Stop, waits for the previous work, then sends exactly one new instruction", async () => {
  const c = await chatFixture();
  let finish,
    asks = 0;
  const sent = [];
  const cancel = app.bridge.cancelAsk;
  app.bridge.call = async (method, params) => {
    if (method === "status")
      return {
        connected: true,
        route: c.teamsId
          ? "/chat/conversation/22222222-2222-2222-2222-222222222222"
          : "/chat",
      };
    if (method === "new") return {};
    if (method === "ask") {
      asks++;
      sent.push(params.prompt);
      if (asks === 1) return new Promise((resolve) => (finish = resolve));
      return {
        route: "/chat/conversation/22222222-2222-2222-2222-222222222222",
        answer: "new direction",
      };
    }
    throw Error(method);
  };
  app.bridge.cancelAsk = async () => {
    assert.equal(asks, 1);
    finish({
      route: "/chat/conversation/22222222-2222-2222-2222-222222222222",
      completion: "stopped",
      answer: "partial unsafe contract",
    });
    return { requested: true };
  };
  try {
    const first = app.send("long task");
    await waitFor(() => finish);
    await app.handle({ type: "steer", text: "Change direction now" });
    await first;
    assert.equal(asks, 2);
    assert.match(sent[1], /Change direction now/);
    assert.equal(c.pending, undefined);
    assert(!c.messages.some((m) => m.text === "partial unsafe contract"));
    assert.equal(app.busy, false);
  } finally {
    app.bridge.cancelAsk = cancel;
  }
});
test("unconfirmed Stop preserves steer draft and sends no new prompt", async () => {
  const c = await chatFixture();
  let finish,
    asks = 0;
  const cancel = app.bridge.cancelAsk;
  app.bridge.call = async (method) =>
    method === "status"
      ? { connected: true, route: "/chat" }
      : method === "new"
        ? {}
        : method === "ask"
          ? (asks++, new Promise((resolve) => (finish = resolve)))
          : Promise.reject(Error(method));
  app.bridge.cancelAsk = async () => {
    throw Error("Stop unconfirmed");
  };
  try {
    const first = app.send("old task");
    await waitFor(() => finish);
    await assert.rejects(
      () => app.handle({ type: "steer", text: "Keep this draft" }),
      /unconfirmed/,
    );
    assert.equal(c.draft, "Keep this draft");
    assert.equal(asks, 1);
    finish({ route: "/chat/conversation/old", answer: "finished" });
    await first;
  } finally {
    app.bridge.cancelAsk = cancel;
  }
});
test("new conversation during a Copilot wait stops the old turn before changing local identity", async () => {
  const c = await chatFixture();
  let finish;
  const cancel = app.bridge.cancelAsk;
  app.bridge.call = async (method) =>
    method === "status"
      ? { connected: true, route: "/chat" }
      : method === "new"
        ? {}
        : method === "ask"
          ? new Promise((resolve) => (finish = resolve))
          : Promise.reject(Error(method));
  app.bridge.cancelAsk = async () => {
    assert.equal(app.current(), c);
    finish({
      route: "/chat/conversation/33333333-3333-3333-3333-333333333333",
      completion: "stopped",
    });
    return { requested: true };
  };
  try {
    const first = app.send("old long request");
    await waitFor(() => finish);
    await app.newConversation();
    await first;
    assert.notEqual(app.current().id, c.id);
    assert.equal(c.recovery.kind, "stopped");
    assert.equal(app.busy, false);
  } finally {
    app.bridge.cancelAsk = cancel;
  }
});
test("Develop can disable automatic project inclusion without dropping a manually attached log, then enable it again", async () => {
  const c = await chatFixture();
  c.mode = "develop";
  c.autoWorkspace = true;
  await fs.writeFile(path.join(root, "main.py"), "DO_NOT_INCLUDE_THIS_SOURCE");
  c.files = [
    {
      path: "main.py",
      hash: sha("DO_NOT_INCLUDE_THIS_SOURCE"),
      content: "DO_NOT_INCLUDE_THIS_SOURCE",
    },
  ];
  const log = path.join(storage, "manual.log");
  await fs.writeFile(log, "log");
  c.attachments = [
    { id: "log", name: "manual.log", path: log, bytes: 3, mime: "text/plain" },
  ];
  const calls = [];
  app.bridge.call = async (method, params) => {
    calls.push({ method, params });
    if (method === "status")
      return {
        connected: true,
        route: c.teamsId
          ? "/chat/conversation/44444444-4444-4444-4444-444444444444"
          : "/chat",
      };
    if (method === "new") return {};
    if (method === "pack_project")
      return { base64: Buffer.from("zip fixture").toString("base64") };
    if (method === "ask")
      return {
        route: "/chat/conversation/44444444-4444-4444-4444-444444444444",
        answer: "ok",
      };
    throw Error(method);
  };
  await app.handle({ type: "includeProject", enabled: false });
  await app.send("Explain the next step");
  assert(!calls.some((c) => c.method === "pack_project"));
  const first = calls.find((c) => c.method === "ask");
  assert.deepEqual(first.params.uploads, [log]);
  assert(!first.params.prompt.includes("DO_NOT_INCLUDE_THIS_SOURCE"));
  assert.equal(c.includeProject, false);
  calls.length = 0;
  await app.handle({ type: "includeProject", enabled: true });
  await app.send("Now inspect source");
  const packed = calls.find((c) => c.method === "pack_project");
  assert(packed);
  assert.equal(
    Buffer.from(
      packed.params.entries.find((e) => e.path === "main.py").base64,
      "base64",
    ).toString(),
    "DO_NOT_INCLUDE_THIS_SOURCE",
  );
});
test("disposed chat editor and sidebar webviews can be closed and reopened without retaining stale getters", async () => {
  const create = vscode.window.createWebviewPanel,
    vc = vscode.ViewColumn;
  vscode.ViewColumn = { Active: 1 };
  const panels = [];
  const mock = () => {
    let disposed = false,
      close;
    const webview = {
      postMessage() {
        if (disposed) throw Error("Webview is disposed");
        return Promise.resolve(true);
      },
      asWebviewUri: (u) => u,
      onDidReceiveMessage() {},
      html: "",
    };
    return {
      webviewRef: webview,
      get webview() {
        if (disposed) throw Error("Webview is disposed");
        return webview;
      },
      onDidDispose: (fn) => {
        close = fn;
      },
      reveal() {
        if (disposed) throw Error("Webview is disposed");
      },
      dispose() {
        disposed = true;
        close();
      },
      repeatClose() {
        close();
      },
    };
  };
  vscode.window.createWebviewPanel = () => {
    const p = mock();
    panels.push(p);
    return p;
  };
  try {
    await app.expand();
    const first = panels[0];
    first.dispose();
    assert.equal(app.panel, undefined);
    await app.expand();
    const second = panels[1];
    first.repeatClose();
    assert.equal(app.panel, second);
    app.views.add(first.webviewRef);
    app.note("test stale view");
    assert(!app.views.has(first.webviewRef));
    second.dispose();
    const sidebar = mock();
    app.resolveWebviewView(sidebar);
    sidebar.dispose();
    assert.equal(app.sidebar, undefined);
    await app.expand();
    assert.equal(panels.length, 3);
    panels[2].dispose();
  } finally {
    vscode.window.createWebviewPanel = create;
    vscode.ViewColumn = vc;
  }
});
test("SQL Show inline reuses the stored snapshot, and page/export/open actions stay scoped to the conversation", async () => {
  const c = await chatFixture(),
    old = app.database,
    identifier = "a".repeat(32),
    calls = [];
  c.messages.push({
    id: "inline-message",
    role: "assistant",
    text: "```sql\nSELECT n FROM demo;\n```",
  });
  const result = {
    id: identifier,
    columns: [{ name: "n", type: "int" }],
    rows: [[1]],
    rowCount: 150,
    offset: 0,
    pageSize: 50,
  };
  app.database = {
    prepare: async () => {},
    open: async () => calls.push("open"),
    executeSnippet: async () => {
      calls.push("query");
      return result;
    },
    connectionName: () => "SQLite fixture",
    registerSnapshot: (id) => {
      assert.equal(id, identifier);
    },
    pageSnapshot: async (id, offset) => ({
      ...result,
      offset,
      rows: [[offset + 1]],
    }),
    exportSnapshot: async (id, format) => calls.push(format),
    openSnapshot: async () => calls.push("snapshot"),
  };
  try {
    await app.handle({ type: "executeSql", id: "inline-message", index: 0 });
    assert.equal(c.sqlCards[0].visible, false);
    await app.handle({ type: "showSqlInline", id: "inline-message", index: 0 });
    assert.equal(c.sqlCards[0].visible, true);
    assert.equal(calls.filter((c) => c === "query").length, 1);
    await app.handle({ type: "sqlPage", id: identifier, offset: 50 });
    assert.equal(c.sqlCards[0].result.rows[0][0], 51);
    await app.handle({ type: "sqlExport", id: identifier, format: "csv" });
    await app.handle({ type: "sqlOpenGrid", id: identifier });
    assert(calls.includes("csv"));
    assert(calls.includes("snapshot"));
    await assert.rejects(
      () => app.handle({ type: "sqlPage", id: "b".repeat(32), offset: 0 }),
      /Không tìm thấy/,
    );
  } finally {
    app.database = old;
  }
});
test("sidebar placement delegates only the Nopilot view to the native VS Code destination picker", async () => {
  const original = vscode.commands.executeCommand,
    calls = [];
  vscode.commands.executeCommand = async (...args) => calls.push(args);
  try {
    await app.moveSidebar();
    assert.deepEqual(calls, [
      ["nopilot.chat.focus"],
      ["workbench.action.moveFocusedView", "nopilot.chat"],
    ]);
  } finally {
    vscode.commands.executeCommand = original;
  }
});
test("inline snapshot collapses in place and can migrate from an unanchored SQL snapshot to its snippet", async () => {
  const c = await chatFixture(),
    id = "c".repeat(32);
  c.messages.push({
    id: "query-owner",
    role: "assistant",
    text: "```sql\nSELECT 42;\n```",
  });
  c.sqlCards = [
    {
      id,
      messageId: "",
      index: -1,
      sql: "SELECT 42;",
      visible: true,
      result: { rowCount: 1, rows: [[42]] },
    },
  ];
  await app.handle({ type: "showSqlInline", id: "query-owner", index: 0 });
  assert.equal(c.sqlCards.length, 1);
  assert.equal(c.sqlCards[0].messageId, "query-owner");
  await app.handle({ type: "sqlCollapse", id });
  assert.equal(c.sqlCards[0].collapsed, true);
  assert.equal(c.sqlCards[0].visible, true);
  await app.handle({ type: "sqlCollapse", id });
  assert.equal(c.sqlCards[0].collapsed, false);
});
test("project selection persists, packs only latest selected source, refreshes drafts and never exposes omitted manifest names", async () => {
  await app.newConversation();
  let c = app.current();
  const folder = path.join(root, "context-choice-qa"),
    keep = "context-choice-qa/keep.py",
    other = "context-choice-qa/other.py",
    hidden = "context-choice-qa/hidden.log";
  const ignoreFile = path.join(root, ".nopilotignore");
  await app.ignores();
  const before = await fs.readFile(ignoreFile);
  const calls = [];
  try {
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, "keep.py"), "old selected");
    await fs.writeFile(path.join(folder, "other.py"), "OMITTED_SOURCE_SECRET");
    await fs.writeFile(path.join(folder, "hidden.log"), "IGNORE_SECRET");
    await fs.appendFile(ignoreFile, "\n" + hidden + "\n");
    await app.handle({ type: "projectPicker" });
    let picker = app.projectPicker;
    assert(picker.entries.find((e) => e.path === hidden).blocked);
    await assert.rejects(
      () =>
        app.handle({
          type: "saveProjectSelection",
          revision: picker.revision,
          paths: [hidden],
        }),
      /ignore/,
    );
    await app.handle({
      type: "saveProjectSelection",
      revision: picker.revision,
      paths: [keep],
      defaults: false,
    });
    assert.deepEqual(c.projectSelection, [keep]);
    await fs.writeFile(path.join(folder, "keep.py"), "latest selected");
    app.bridge.call = async (method, params) => {
      calls.push({ method, params });
      if (method === "status")
        return {
          connected: true,
          route: c.teamsId
            ? "/chat/conversation/55555555-5555-5555-5555-555555555555"
            : "/chat",
        };
      if (method === "new") return {};
      if (method === "pack_project")
        return { base64: Buffer.from("zip fixture").toString("base64") };
      if (method === "ask")
        return {
          route: "/chat/conversation/55555555-5555-5555-5555-555555555555",
          answer: "ok",
        };
      throw Error(method);
    };
    await app.send("Inspect selected context");
    const packed = calls.find((x) => x.method === "pack_project");
    assert.deepEqual(
      packed.params.entries.map((e) => e.path),
      [keep],
    );
    assert.equal(
      Buffer.from(packed.params.entries[0].base64, "base64").toString(),
      "latest selected",
    );
    const prompt = calls.find((x) => x.method === "ask").params.prompt;
    assert(!prompt.includes(other));
    assert(!prompt.includes(hidden));
    assert(!prompt.includes("OMITTED_SOURCE_SECRET"));
    assert(
      c.workspaceBase[other],
      "full local safety baseline is retained without uploading it",
    );
    await app.persist();
    await app.init();
    c = app.current();
    assert.deepEqual(c.projectSelection, [keep]);
    await app.handle({ type: "projectPicker" });
    picker = app.projectPicker;
    await fs.writeFile(path.join(folder, "new.py"), "new source");
    await app.handle({
      type: "projectPicker",
      draft: { revision: picker.revision, defaults: false, paths: [other] },
    });
    assert.deepEqual(app.projectPicker.selection, [other]);
    assert(
      app.projectPicker.entries.some(
        (e) => e.path === "context-choice-qa/new.py",
      ),
    );
    await app.handle({ type: "closeProjectPicker" });
    assert.deepEqual(
      c.projectSelection,
      [keep],
      "cancel does not commit draft",
    );
    await app.handle({ type: "projectPicker" });
    picker = app.projectPicker;
    await app.handle({
      type: "saveProjectSelection",
      revision: picker.revision,
      paths: [],
      defaults: false,
    });
    calls.length = 0;
    await app.send("Discuss without source");
    assert(!calls.some((x) => x.method === "pack_project"));
    assert.match(
      calls.find((x) => x.method === "ask").params.prompt,
      /workspace is not empty/,
    );
    await app.handle({ type: "includeProject", enabled: false });
    await app.handle({ type: "includeProject", enabled: true });
    assert.deepEqual(c.projectSelection, []);
    await app.handle({ type: "projectPicker" });
    picker = app.projectPicker;
    await app.handle({
      type: "saveProjectSelection",
      revision: picker.revision,
      defaults: true,
    });
    assert.equal(c.projectSelection, undefined);
    calls.length = 0;
    await app.send("Inspect default context");
    assert(
      calls
        .find((x) => x.method === "pack_project")
        .params.entries.some((e) => e.path === "context-choice-qa/new.py"),
    );
    assert(
      !calls
        .find((x) => x.method === "pack_project")
        .params.entries.some((e) => e.path === hidden),
    );
  } finally {
    await fs.writeFile(ignoreFile, before);
    await fs.rm(folder, { recursive: true, force: true });
  }
});
test("pending approval blocks without transcript spam; explicit skip sends only main.py and stages the returned single file", async () => {
  await app.newConversation();
  const c = await base();
  c.autoWorkspace = true;
  c.includeProject = true;
  c.projectSelection = ["main.py"];
  const { stageArchive, workspaceSnapshot } = require("../dist/archive.js"),
    ig = await app.ignores();
  c.workspaceBase = await workspaceSnapshot(root, ig);
  const plan = await stageArchive(
    root,
    path.join(storage, "old-pending-zip"),
    ["old-a.txt", "old-b.txt", "old-c.txt"].map((name) => ({
      path: name,
      base64: Buffer.from("old proposal").toString("base64"),
    })),
    c.workspaceBase,
    ig,
    c.contextId,
  );
  c.pending = { id: plan.id, kind: "archive", status: "pending", data: plan };
  const text =
    "bạn có thể thay đổi trong main.py từ link cũ thành https://playwright.dev không? rồi gửi lại cho tôi file đã sửa đổi";
  const calls = [],
    messages = c.messages.length,
    turns = c.turns;
  app.bridge.call = async (method, params) => {
    calls.push({ method, params });
    if (method === "status")
      return {
        connected: true,
        route: c.teamsId
          ? "/chat/conversation/66666666-6666-6666-6666-666666666666"
          : "/chat",
      };
    if (method === "new") return {};
    if (method === "pack_project")
      return { base64: Buffer.from("packed fixture").toString("base64") };
    if (method === "ask")
      return {
        route: "/chat/conversation/66666666-6666-6666-6666-666666666666",
        answer: "File đã sửa",
        downloads: [{ name: "main.py" }],
      };
    if (method === "download")
      return {
        base64: Buffer.from('print("https://playwright.dev")\n').toString(
          "base64",
        ),
      };
    throw Error(method);
  };
  for (let i = 0; i < 4; i++) await app.send(text);
  assert.equal(c.messages.length, messages);
  assert.equal(c.turns, turns);
  assert.equal(calls.length, 0);
  assert.equal(c.draft, text);
  assert.equal(c.pending.id, plan.id);
  assert.deepEqual(c.projectSelection, ["main.py"]);
  await assert.rejects(
    () => app.handle({ type: "sendInstead", id: "wrong" }),
    /thay đổi/,
  );
  assert.equal(calls.length, 0);
  const settled = c.request;
  c.request = { requestId: "not-settled", phase: "submitted", imported: false };
  await assert.rejects(
    () => app.handle({ type: "sendInstead", id: plan.id }),
    /journal/,
  );
  assert.equal(c.pending.status, "pending");
  c.request = settled;
  await app.handle({ type: "sendInstead", id: plan.id });
  assert.equal(c.skippedProposals.at(-1).id, plan.id);
  assert.equal(c.skippedProposals.at(-1).status, "skipped");
  assert.equal(calls.filter((x) => x.method === "ask").length, 1);
  assert.deepEqual(
    calls
      .find((x) => x.method === "pack_project")
      .params.entries.map((e) => e.path),
    ["main.py"],
  );
  assert.equal(c.pending.sourceKind, "file");
  assert.deepEqual(
    c.pending.data.files.map((f) => f.path),
    ["main.py"],
  );
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("old")\n',
  );
  await app.review();
  if (
    app.current().pending?.status === "pending" &&
    app.current().pending.reviewed
  )
    await app.confirmReview(
      app.current().pending.id,
      app.current().pending.reviewRevision,
      true,
    );
  await app.applyProjectArchive(c.pending);
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("https://playwright.dev")\n',
  );
  for (const name of ["old-a.txt", "old-b.txt", "old-c.txt"])
    await assert.rejects(() => fs.stat(path.join(root, name)), /ENOENT/);
});
test("a returned filename matching multiple source paths is kept as artifact without guessing a destination", async () => {
  await app.newConversation();
  const c = await base();
  c.files = [
    { path: "one/main.py", hash: sha("one"), content: "one" },
    { path: "two/main.py", hash: sha("two"), content: "two" },
  ];
  c.workspaceBase = await require("../dist/archive.js").workspaceSnapshot(
    root,
    await app.ignores(),
  );
  app.bridge.call = async (method) => {
    assert.equal(method, "download");
    return { base64: Buffer.from("ambiguous source").toString("base64") };
  };
  await app.acceptResponse({
    answer: "file",
    downloads: [{ name: "main.py" }],
  });
  assert.equal(c.pending, undefined);
  assert.equal(c.artifacts.at(-1).name, "main.py");
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("old")\n',
  );
});
test("proposal review requires explicit confirmation, reports errors locally, and locks duplicate approvals", async () => {
  await app.newConversation();
  const c = await base(),
    ig = await app.ignores();
  const { stageArchive, workspaceSnapshot } = require("../dist/archive.js");
  const plan = await stageArchive(
    root,
    path.join(storage, "review-confirm-qa"),
    [
      {
        path: "approval-probe.txt",
        base64: Buffer.from("approved source").toString("base64"),
      },
    ],
    await workspaceSnapshot(root, ig),
    ig,
    c.contextId,
  );
  const p = (c.pending = {
    id: plan.id,
    kind: "archive",
    status: "pending",
    data: plan,
  });
  c.reviewMode = "strict";
  const count = c.messages.length;
  await app.approve(p.id);
  assert.match(p.error, /xác nhận/);
  assert.equal(p.status, "pending");
  assert.equal(c.messages.length, count);
  await app.review();
  assert(p.reviewed);
  assert.equal(p.reviewConfirmed, false);
  await app.approve(p.id);
  await assert.rejects(
    () => fs.stat(path.join(root, "approval-probe.txt")),
    /ENOENT/,
  );
  await app.handle({
    type: "confirmReview",
    id: p.id,
    revision: "stale",
    confirmed: true,
  });
  assert.equal(p.reviewConfirmed, false);
  await app.handle({
    type: "confirmReview",
    id: p.id,
    revision: p.reviewRevision,
    confirmed: true,
  });
  assert(p.reviewConfirmed);
  const mkdtemp = fs.mkdtemp;
  fs.mkdtemp = async (prefix, ...args) => {
    if (prefix.includes("np-git-")) throw Error("card-local backup error");
    return mkdtemp(prefix, ...args);
  };
  try {
    await app.approve(p.id);
  } finally {
    fs.mkdtemp = mkdtemp;
  }
  assert.equal(p.status, "failed");
  assert.match(p.error, /card-local backup error/);
  assert.equal(c.messages.length, count);
  assert.equal(p.reviewConfirmed, false);
  await app.review();
  await app.handle({
    type: "confirmReview",
    id: p.id,
    revision: p.reviewRevision,
    confirmed: true,
  });
  let backups = 0;
  fs.mkdtemp = async (prefix, ...args) => {
    if (prefix.includes("np-git-")) backups++;
    return mkdtemp(prefix, ...args);
  };
  try {
    await Promise.all([app.approve(p.id), app.approve(p.id)]);
  } finally {
    fs.mkdtemp = mkdtemp;
  }
  assert.equal(backups, 1);
  assert.equal(
    await fs.readFile(path.join(root, "approval-probe.txt"), "utf8"),
    "approved source",
  );
  await fs.unlink(path.join(root, "approval-probe.txt"));
});
test("rejecting a source proposal is explicit, prevents apply, and preserves source", async () => {
  await app.newConversation();
  const c = await base();
  const p = (c.pending = { ...proposal(), id: "reject-source" });
  await app.handle({ type: "reject", id: p.id });
  assert.equal(p.status, "rejected");
  assert.equal(p.reviewConfirmed, false);
  await app.approve(p.id);
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("old")\n',
  );
});
test("copy message resolves the stored question/answer rather than untrusted webview text", async () => {
  const c = await chatFixture();
  c.messages.push(
    { id: "copy-q", role: "user", text: "My question" },
    {
      id: "copy-a",
      role: "assistant",
      text: "**Markdown answer**\n```sql\nSELECT 1;\n```",
    },
  );
  const previous = vscode.env.clipboard,
    copied = [];
  vscode.env.clipboard = { writeText: async (text) => copied.push(text) };
  try {
    await app.handle({ type: "copyMessage", id: "copy-a", text: "injected" });
    await app.handle({ type: "copyMessage", id: "copy-q" });
    assert.deepEqual(copied, [
      "**Markdown answer**\n```sql\nSELECT 1;\n```",
      "My question",
    ]);
  } finally {
    vscode.env.clipboard = previous;
  }
});

test("fast acceptance applies only chosen JSON files; remainder can become the next incremental change", async () => {
  await app.newConversation();
  const c = await base();
  const p = (c.pending = {
    ...proposal(),
    id: "partial-json",
    reviewed: false,
    reviewConfirmed: false,
  });
  p.data.edits.push({
    path: "not-selected.txt",
    baseSha256: null,
    content: "later",
  });
  await app.selectChange(p.id, "not-selected.txt", false);
  await app.approve(p.id);
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("new")\n',
  );
  await assert.rejects(fs.stat(path.join(root, "not-selected.txt")));
  const record = c.changeHistory.at(-1);
  assert.deepEqual(
    record.files.map((f) => f.path),
    ["main.py"],
  );
  assert.deepEqual(record.remainingPaths, ["not-selected.txt"]);
  assert.equal(record.appliedFingerprint, await app.sourceFingerprint());
  await app.remainingChange(record.id);
  assert.deepEqual(
    c.pending.data.files.map((f) => f.path),
    ["not-selected.txt"],
  );
  await app.approve(c.pending.id);
  assert.equal(
    await fs.readFile(path.join(root, "not-selected.txt"), "utf8"),
    "later",
  );
  await fs.unlink(path.join(root, "not-selected.txt"));
});
test("empty selection and stale prospective command plan never write source", async () => {
  await app.newConversation();
  const c = await base();
  const contract = {
    schemaVersion: 1,
    name: "test",
    runtime: "python",
    install: null,
    tasks: { start: { entrypoint: "main.py", args: [], timeoutSeconds: 30 } },
  };
  await fs.writeFile(path.join(root, "nopilot.json"), JSON.stringify(contract));
  const p = (c.pending = {
    ...proposal(),
    id: "stale-execution",
    reviewed: false,
  });
  await app.selectChange(p.id, "*", false);
  await app.approve(p.id);
  assert.match(p.error, /ít nhất/);
  await app.selectChange(p.id, "*", true);
  assert(p.runPreview);
  contract.tasks.start.args = ["new-unapproved-argument"];
  await fs.writeFile(path.join(root, "nopilot.json"), JSON.stringify(contract));
  await app.approve(p.id, true);
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("old")\n',
  );
  assert.match(p.error, /Kế hoạch chạy đã đổi/);
  await fs.unlink(path.join(root, "nopilot.json"));
});
test("accept-and-run failure leaves accepted source, checkpoint and same-card logs; rerun can pass", async () => {
  await app.newConversation();
  const c = await base();
  // Real Python process; use the existing interpreter as the fixture venv executable.
  const { execFileSync } = require("node:child_process");
  const python = execFileSync(
    config.get("pythonPath"),
    ["-c", "import sys;print(sys.executable)"],
    { encoding: "utf8" },
  ).trim();
  const env = path.join(root, ".venv", "Scripts", "python.exe");
  await fs.mkdir(path.dirname(env), { recursive: true });
  await fs.copyFile(python, env);
  // A copied Windows launcher needs its home to discover the stdlib.
  await fs.writeFile(
    path.join(root, ".venv", "pyvenv.cfg"),
    "home = " +
      path.dirname(python) +
      "\ninclude-system-site-packages = false\nversion = 3.14\n",
  );
  const contract = {
    schemaVersion: 1,
    name: "run fixture",
    runtime: "python",
    install: null,
    tasks: { start: { entrypoint: "main.py", args: [], timeoutSeconds: 30 } },
  };
  await fs.writeFile(path.join(root, "nopilot.json"), JSON.stringify(contract));
  const p = (c.pending = {
    ...proposal('print("FAIL-PROBE"); raise SystemExit(1)\n'),
    id: "run-fail",
    reviewed: false,
  });
  await app.refreshRunPreview(p);
  assert(p.runPreview);
  await app.approve(p.id, true);
  const r = c.changeHistory.at(-1);
  assert.equal(r.status, "applied");
  assert.equal(r.run.status, "failed");
  assert.equal(c.checkpoint.changeId, p.id);
  assert.equal(c.pending, undefined);
  assert(
    c.activities.some(
      (a) => a.changeId === r.id && a.output.includes("FAIL-PROBE"),
    ),
  );
  assert(c.artifacts.some((a) => a.changeId === r.id && /\.log$/.test(a.name)));
  await fs.writeFile(path.join(root, "main.py"), 'print("PASS-PROBE")\n');
  await app.changeTask(r.id, "start");
  const run = c.pending;
  assert.equal(run.data.changeId, r.id);
  await app.approve(run.id);
  assert.equal(r.run.status, "completed");
  assert.equal(r.error, undefined);
  assert.equal(r.runs.length, 2);
  assert.equal(r.runs[0].status, "failed");
  assert.equal(r.runs[1].status, "completed");
  await fs.unlink(path.join(root, "nopilot.json"));
});
test("restart expires execution approval but fresh fast source acceptance still works", async () => {
  await app.newConversation();
  const c = await base();
  c.pending = {
    ...proposal(),
    id: "reload-fast",
    reviewed: false,
    runPreview: { signature: "stale approval" },
    previewBusy: true,
  };
  await app.persist();
  await app.init();
  const restored = app.current();
  assert.equal(restored.pending.status, "expired");
  assert.equal(restored.pending.runPreview, undefined);
  assert.equal(restored.pending.previewBusy, false);
  await app.approve("reload-fast");
  assert.equal(
    await fs.readFile(path.join(root, "main.py"), "utf8"),
    'print("new")\n',
  );
  assert.equal(app.current().changeHistory.at(-1).id, "reload-fast");
});
