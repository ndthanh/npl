const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  Module = require("node:module");
const inputs = ["Warehouse", "DSN={Example};PWD=private-token;"];
let choice;
let saveDestination;
const pickCalls = [];
const original = Module._load;
Module._load = function (name, parent, ...rest) {
  return name === "vscode"
    ? {
        Uri:{file:fsPath=>({fsPath})},
        window: {
          showSaveDialog: async () => saveDestination,
          showInputBox: async () => inputs.shift(),
          showQuickPick: async (items, options) => {
            pickCalls.push({ items, options });
            return choice === undefined ? undefined : items[choice];
          },
        },
      }
    : original.call(this, name, parent, ...rest);
};
const { DatabaseExplorer } = require("../dist/database-test.js");
test("Save As saves the entire Unicode SQL document to the native chooser path", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nopilot-save-sql-"));
  saveDestination = { fsPath: path.join(folder, "query.sql") };
  const data = new DatabaseExplorer(
    { globalStorageUri: { fsPath: folder }, extensionPath: "extension" },
    () => "",
    () => {},
  );
  try {
    await data.handle({
      type: "saveSql",
      document: "-- kiểm tra\nSHOW TABLES;\nSELECT 'Việt Nam';",
    });
    assert.equal(
      await fs.readFile(saveDestination.fsPath, "utf8"),
      "-- kiểm tra\nSHOW TABLES;\nSELECT 'Việt Nam';",
    );
  } finally {
    saveDestination = undefined;
    assert.equal(path.dirname(folder), os.tmpdir());
    await fs.rm(folder, { recursive: true, force: true });
  }
});
test("ODBC credentials stay in SecretStorage and are absent from profiles/snapshot", async () => {
  const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nopilot-db-controller-"),
    ),
    secrets = new Map(),
    messages = [];
  const data = new DatabaseExplorer(
    {
      globalStorageUri: { fsPath: dir },
      extensionPath: "extension",
      secrets: {
        store: async (k, v) => secrets.set(k, v),
        get: async (k) => secrets.get(k),
      },
    },
    () => "",
    () => {},
  );
  data.panel = { webview: { postMessage: (m) => messages.push(m) } };
  try {
    await data.handle({ type: "addOdbc" });
    const profiles = await fs.readFile(
      path.join(dir, "database", "profiles.json"),
      "utf8",
    );
    assert(!profiles.includes("private-token"));
    assert(!JSON.stringify(messages).includes("private-token"));
    assert.equal([...secrets.values()][0], "DSN={Example};PWD=private-token;");
    await data.handle({ type: "export", id: "unknown", format: "csv" });
    assert.match(data.error, /Unknown query result/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("Oracle setup uses a discovered DSN without requesting a connection string", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "nopilot-dsn-"));
  const secrets = new Map();
  const data = new DatabaseExplorer({
    globalStorageUri: { fsPath: folder },
    secrets: { store: async (key, value) => secrets.set(key, value) },
  }, () => "", () => {});
  data.worker = async () => ({
    odbc: true, pythonBits: 64, sourceDrivers: { DWH: "Oracle" },
  });
  choice = 0;
  inputs.push("Warehouse");
  try {
    await data.handle({ type: "addOracle" });
    assert.equal(inputs.length, 0);
    assert.equal(data.profiles[0].engine, "oracle");
    assert.equal([...secrets.values()][0], "DSN={DWH};");
  } finally {
    choice = undefined;
    await fs.rm(folder, { recursive: true, force: true });
  }
});
test("Execute snippet asks for the connection and sends the exact SQL through query; cancel or missing profiles never runs", async () => {
  const data = new DatabaseExplorer(
      {
        globalStorageUri: { fsPath: "fixture" },
        extensionPath: "extension",
        secrets: { get: async () => "DSN={Example};" },
      },
      () => "",
      () => {},
    ),
    calls = [],
    snapshots = [];
  data.panel = { webview: { postMessage: (m) => snapshots.push(m) } };
  data.worker = async (method, params) => {
    calls.push({ method, params });
    return { id: "result", rowCount: 150, rows: [[1]], columns: ["n"] };
  };
  await data.executeSnippet("SELECT 1;");
  assert.equal(calls.length, 0);
  assert.match(data.status, /Thêm kết nối/);
  data.profiles = [{ id: "p", name: "Warehouse", kind: "odbc" }];
  choice = undefined;
  await data.executeSnippet("SELECT 2;");
  assert.equal(calls.length, 0);
  assert.match(data.status, /hủy/);
  choice = 0;
  await data.executeSnippet("SELECT '<x>' AS value;\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "query");
  assert.equal(calls[0].params.sql, "SELECT '<x>' AS value;\n");
  assert.equal(calls[0].params.profile.kind, "odbc");
  assert.equal(data.result.rowCount, 150);
  assert(!JSON.stringify(pickCalls).includes("DSN={Example}"));
  data.busy = true;
  await assert.rejects(() => data.executeSnippet("SELECT 3;"), /Đợi query/);
  assert.equal(calls.length, 1);
  choice = undefined;
});
test("workspace default survives controller recreation, isolates other workspaces, and can be changed or cleared", async () => {
  const state = new Map(),
    calls = [],
    workspaceState = {
      get: (k, d) => state.get(k) ?? d,
      update: async (k, v) => {
        v === undefined ? state.delete(k) : state.set(k, v);
      },
    };
  const context = {
    globalStorageUri: { fsPath: "fixture" },
    extensionPath: "extension",
    workspaceState,
    secrets: { get: async () => "DSN={Example};" },
  };
  const create = (ctx = context) => {
    const data = new DatabaseExplorer(
      ctx,
      () => "",
      () => {},
    );
    data.profiles = [
      { id: "p", name: "Warehouse", kind: "odbc" },
      { id: "q", name: "Other", kind: "odbc" },
    ];
    data.panel = { webview: { postMessage() {} } };
    data.worker = async (method, params) => {
      calls.push({ method, params, selected: data.selected });
      return { id: "result", rowCount: 0 };
    };
    return data;
  };
  const before = pickCalls.length;
  choice = 0;
  const first = create();
  await first.executeSnippet("SELECT 1;");
  assert.equal(state.get("database.defaultProfile"), "p");
  assert.equal(pickCalls.length, before + 1);
  await first.executeSnippet("SELECT 2;");
  assert.equal(pickCalls.length, before + 1);
  const reopened = create();
  await reopened.executeSnippet("SELECT 3;");
  assert.equal(reopened.selected, "p");
  assert.equal(pickCalls.length, before + 1);
  const other = create({
    ...context,
    workspaceState: { get: (k, d) => d, update: async () => {} },
  });
  assert.equal(other.defaultProfile, "");
  await reopened.handle({ type: "select", id: "q" });
  await reopened.handle({ type: "setDefault" });
  const changed = create();
  await changed.executeSnippet("SELECT 4;");
  assert.equal(calls.at(-1).selected, "q");
  assert.equal(pickCalls.length, before + 1);
  await changed.handle({ type: "clearDefault" });
  choice = undefined;
  await changed.executeSnippet("SELECT 5;");
  assert.equal(pickCalls.length, before + 2);
  assert.equal(calls.length, 4);
  assert(!JSON.stringify([...state]).includes("DSN="));
  state.set("database.defaultProfile", "missing");
  const stale = create();
  await stale.executeSnippet("SELECT 6;");
  assert.equal(calls.length, 4);
  assert.equal(state.has("database.defaultProfile"), false);
});
test("driver enumeration never claims connection success", async () => {
  const data = new DatabaseExplorer(
    {
      globalStorageUri: { fsPath: "fixture" },
      extensionPath: "extension",
      secrets: { get: async () => "DSN={ExampleWarehouse};" },
    },
    () => "",
    () => {},
  );
  data.profiles = [{ id: "p", kind: "odbc", name: "ExampleWarehouse" }];
  data.selected = "p";
  data.panel = { webview: { postMessage() {} } };
  data.worker = async (method) =>
    method === "test"
      ? { connected: true, provider: "odbc" }
      : {
          odbc: true,
          pythonBits: 64,
          drivers: ["Simba Spark"],
          dataSources: ["ExampleWarehouse"],
        };
  await data.handle({ type: "test" });
  assert.equal(data.statusKind, "success");
  await data.handle({ type: "drivers" });
  assert.equal(data.statusKind, "info");
  assert.match(data.status, /Chỉ liệt kê/);
  assert.match(data.status, /ExampleWarehouse/);
});
test("Data Show in chat publishes the query snapshot SQL rather than an edited draft and does not requery", async () => {
  const shown = [],
    calls = [],
    data = new DatabaseExplorer(
      {
        globalStorageUri: { fsPath: "fixture" },
        extensionPath: "extension",
        secrets: { get: async () => "DSN={ExampleWarehouse};" },
      },
      () => "",
      () => {},
      async (...values) => shown.push(values),
    );
  data.profiles = [{ id: "p", kind: "odbc", name: "ExampleWarehouse" }];
  data.selected = "p";
  data.worker = async (method, p) => {
    calls.push(method);
    return {
      id: "a".repeat(32),
      rowCount: 1,
      rows: [[1]],
      columns: [{ name: "n" }],
    };
  };
  await data.handle({ type: "query", sql: "SELECT 1 AS n", limit: 1000 });
  await data.handle({ type: "draft", sql: "SELECT 999" });
  await data.handle({ type: "showInline" });
  assert.equal(shown[0][1], "SELECT 1 AS n");
  assert.equal(shown[0][2], "ExampleWarehouse");
  assert.deepEqual(calls, ["query"]);
});
test("selected SQL runs without replacing the editor document; USE context is saved per profile for the next query", async () => {
  const state = new Map(),
    calls = [],
    context = {
      globalStorageUri: { fsPath: "fixture" },
      extensionPath: "extension",
      workspaceState: {
        get: (k, d) => state.get(k) ?? d,
        update: async (k, v) => state.set(k, v),
      },
      secrets: { get: async () => "DSN={Fixture};" },
    };
  const data = new DatabaseExplorer(
    context,
    () => "",
    () => {},
  );
  data.profiles = [{ id: "p", kind: "odbc", name: "Fixture" }];
  data.selected = "p";
  data.worker = async (method, params) => {
    calls.push(params);
    return {
      id: "d".repeat(32),
      rowCount: 0,
      rows: [],
      columns: [],
      session: ["USE CATALOG main"],
      commandOnly: true,
    };
  };
  const document = "USE CATALOG main;\nSELECT 1;";
  await data.handle({
    type: "query",
    sql: "USE CATALOG main;",
    document,
    limit: 1000,
  });
  assert.equal(data.sql, document);
  assert.equal(calls[0].sql, "USE CATALOG main;");
  assert.deepEqual(state.get("database.sessions").p, ["USE CATALOG main"]);
  await data.handle({ type: "query", sql: "SELECT 1;", document, limit: 1000 });
  assert.deepEqual(calls[1].session, ["USE CATALOG main"]);
});
