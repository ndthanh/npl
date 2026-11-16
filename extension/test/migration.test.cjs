const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  Module = require("node:module");
const original = Module._load;
Module._load = function (name, ...args) {
  return name === "vscode"
    ? { window: {}, Uri: { file: (fsPath) => ({ fsPath }) } }
    : original.call(this, name, ...args);
};
const { MigrationWorkbench } = require("../dist/migration-test.js");
async function fixture() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nopilot-migration-"));
  const state = new Map(),
    calls = [],
    prompts = [],
    messages = [];
  const ctx = {
    storageUri: { fsPath: folder },
    globalStorageUri: { fsPath: folder },
    workspaceState: {
      get: (k, d) => state.get(k) ?? d,
      update: async (k, v) => state.set(k, structuredClone(v)),
    },
  };
  const db = {
    migrationProfiles: async () => [{ id: "p", name: "Demo", kind: "sqlite" }],
    migrationOperation: async (method, params, profile) => {
      calls.push({ method, params, profile });
      if (method === "demo") return { profileId: "p" };
      if (method === "query")
        return {
          id: "a".repeat(32),
          rows: [[1]],
          columns: [{ name: "region" }],
          rowCount: 1,
          elapsedMs: 1,
          offset: 0,
        };
      if (method === "compare")
        return {
          status: "pass",
          missing: 0,
          extra: 0,
          changed: 0,
          sourceRows: 1,
          targetRows: 1,
          sourceMs: 1,
          targetMs: 1,
        };
    },
    cancelMigration: () => calls.push({ method: "stop" }),
  };
  const app = new MigrationWorkbench(ctx, db, async (p) => prompts.push(p));
  app.panel = {
    webview: { postMessage: (m) => messages.push(structuredClone(m)) },
  };
  return {
    app,
    ctx,
    db,
    state,
    calls,
    prompts,
    messages,
    close: () => fs.rm(folder, { recursive: true, force: true }),
  };
}
test("migration runs source then target then full snapshot comparison and reloads exact evidence", async () => {
  const f = await fixture();
  try {
    await f.app.handle({ type: "demo" });
    await f.app.handle({ type: "run" });
    assert.deepEqual(
      f.calls.map((x) => x.method),
      ["demo", "query", "query", "compare"],
    );
    const run = f.app.run;
    assert.equal(run.report.sourceSql, f.calls[1].params.sql);
    assert.equal(run.comparison.status, "pass");
    await f.app.handle({ type: "draft", values: { codeBrief: "BRIEF_REGRESSION_RULE" } });
    await f.app.handle({ type: "copilot" });
    assert(f.prompts.at(-1).includes(run.id));
    assert(!f.prompts.at(-1).includes("BRIEF_REGRESSION_RULE"));
    await f.app.handle({ type: "copilot", includeBrief: true });
    assert(f.prompts.at(-1).includes("BRIEF_REGRESSION_RULE"));
    await f.app.handle({ type: "draft", values: { targetSql: "SELECT 999" } });
    assert.notEqual(run.report.targetSql, "SELECT 999");
    await f.app.handle({ type: "copilot" });
    assert(!f.prompts.at(-1).includes(run.id));
    await f.app.handle({ type: "ready" });
    assert.equal(f.messages.at(-1).state.stale, true);
    const restored = new MigrationWorkbench(f.ctx, f.db, async () => {});
    await restored.handle({ type: "history", id: run.id });
    assert.equal(restored.run.report.targetSql, run.report.targetSql);
    assert.equal(restored.current().targetSql, "SELECT 999");
    assert.equal(restored.history.length, 1);
  } finally {
    await f.close();
  }
});
test("failed target never compares stale results; user can repair SQL and retry", async () => {
  const f = await fixture();
  try {
    await f.app.handle({ type: "demo" });
    const worker = f.db.migrationOperation;
    let queries = 0;
    f.db.migrationOperation = async (...args) => {
      if (args[0] === "query" && ++queries === 2) throw Error("invalid target");
      return worker(...args);
    };
    await f.app.handle({ type: "run" });
    assert.match(f.app.error, /invalid target/);
    assert.equal(f.app.busy, false);
    assert.equal(f.app.run, undefined);
    assert(!f.calls.some((x) => x.method === "compare"));
    f.db.migrationOperation = worker;
    await f.app.handle({ type: "run" });
    assert.equal(f.app.run.comparison.status, "pass");
    assert.equal(f.app.error, "");
  } finally {
    await f.close();
  }
});
test("Stop during source prevents target query and clears busy state without auto retry", async () => {
  const f = await fixture();
  try {
    await f.app.handle({ type: "demo" });
    const worker = f.db.migrationOperation;
    let release;
    f.db.migrationOperation = async (method, ...args) => {
      if (method === "query")
        return new Promise(
          (resolve) => (release = () => resolve({ id: "b".repeat(32) })),
        );
      return worker(method, ...args);
    };
    const running = f.app.handle({ type: "run" });
    await new Promise((resolve) => setImmediate(resolve));
    await f.app.handle({ type: "stop" });
    release();
    await running;
    assert.equal(f.app.run, undefined);
    assert.equal(f.app.busy, false);
    assert.match(f.app.error, /dừng/);
    assert(!f.calls.some((x) => x.method === "compare"));
  } finally {
    await f.close();
  }
});
test("Copilot handoff is draft only and omits data rows, credentials and snapshots", async () => {
  const f = await fixture();
  try {
    await f.app.handle({ type: "demo" });
    await f.app.handle({ type: "run" });
    f.app.run.source.rows = [["SENSITIVE CUSTOMER"]];
    await f.app.handle({ type: "copilot" });
    assert.equal(f.prompts.length, 1);
    assert(f.prompts[0].includes("SELECT region"));
    assert(!f.prompts[0].includes("SENSITIVE CUSTOMER"));
    assert(!f.prompts[0].includes("a".repeat(32)));
    const before = f.calls.length;
    await f.app.handle({ type: "duplicate", values: { name: "Case 2" } });
    assert.equal(f.calls.length, before);
    assert.equal(f.app.current().sameCutoff, false);
    assert.equal(f.app.reports.length, 2);
  } finally {
    await f.close();
  }
});
