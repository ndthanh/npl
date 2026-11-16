const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { JSDOM } = require("jsdom");
const bundle = fs.readFileSync(
  path.join(__dirname, "../dist/data-ui.js"),
  "utf8",
);
function setup(result, defaultProfile, extra = {}) {
  const messages = [],
    dom = new JSDOM('<div id="app"></div>', {
      runScripts: "dangerously",
      pretendToBeVisual: true,
    }),
    w = dom.window;
  w.acquireVsCodeApi = () => ({ postMessage: (m) => messages.push(m) });
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => new w.DOMRect();
  const script = w.document.createElement("script");
  script.nonce = "test";
  script.textContent = bundle;
  w.document.body.append(script);
  w.dispatchEvent(
    new w.MessageEvent("message", {
      data: {
        type: "snapshot",
        state: {
          profiles: [{ id: "local", name: "SQLite demo", kind: "sqlite" }],
          selected: "local",
          defaultProfile,
          result,
          sql: "SELECT * FROM sales",
          limit: 1000,
          status: "Connected",
          busy: false,
          error: "",
          ...extra,
        },
      },
    }),
  );
  return { w, dom, messages };
}
test("query UI submits the shown SQL and limit only when Run is clicked", () => {
  const ui = setup();
  try {
    assert(!ui.messages.some((m) => m.type === "query"));
    ui.w.document.querySelector('[data-action="query"]').click();
    assert.deepEqual(JSON.parse(JSON.stringify(ui.messages.at(-1))), {
      type: "query",
      sql: "SELECT * FROM sales",
      document: "SELECT * FROM sales",
      limit: 1000,
    });
  } finally {
    ui.w.close();
  }
});
test("SQL tokens have semantic classes and nonce-protected theme colors independent of icon colors", () => {
  const ui = setup(undefined, undefined, {
    sql: "-- comment\nSELECT 'text', CAST(42 AS INTEGER);",
  });
  try {
    for (const kind of ["keyword", "string", "number", "comment", "type"])
      assert(ui.w.document.querySelector(".np-sql-" + kind), kind);
    const css = [...ui.w.document.querySelectorAll("style")].find((s) =>
      s.textContent.includes(".np-sql-keyword"),
    );
    assert.equal(css.nonce, "test");
    assert.match(css.textContent, /body\.vscode-light/);
    assert(
      !css.textContent.includes("var(--vscode-symbolIcon-keywordForeground"),
    );
  } finally {
    ui.w.close();
  }
});
test("multiline SQL folds and expands without changing the SQL submitted to Run", () => {
  const sql = "SELECT\n  42 AS value\nFROM sales;";
  const ui = setup(undefined, undefined, { sql });
  try {
    const gutter = ui.w.document.querySelector(
      '.cm-foldGutter [title="Fold line"]',
    );
    assert(gutter);
    gutter.click();
    assert(ui.w.document.querySelector(".cm-foldPlaceholder"));
    ui.w.document.querySelector('[data-action="query"]').click();
    assert.equal(ui.messages.at(-1).sql, sql);
    assert.equal(ui.messages.at(-1).document, sql);
    ui.w.document.querySelector(".cm-foldPlaceholder").click();
    assert.equal(ui.w.document.querySelector(".cm-foldPlaceholder"), null);
    assert(ui.w.document.querySelector(".np-sql-number"));
  } finally {
    ui.w.close();
  }
});
test("table escapes database strings and offers snapshot exports and pagination", () => {
  const ui = setup({
    id: "abc",
    columns: [
      { name: "customer", type: "text" },
      { name: "value", type: "int" },
    ],
    rowCount: 150,
    offset: 0,
    pageSize: 50,
    rows: [["<img src=x onerror=alert(1)>", null]],
    elapsedMs: 9,
    truncated: false,
  });
  try {
    assert.equal(ui.w.document.querySelector("table img"), null);
    assert.match(ui.w.document.querySelector("table").textContent, /NULL/);
    ui.w.document.querySelector('[data-action="exportXlsx"]').click();
    assert.equal(ui.messages.at(-1).format, "xlsx");
    ui.w.document.querySelector('[data-action="showInline"]').click();
    assert.equal(ui.messages.at(-1).type, "showInline");
    ui.w.document.querySelector('[data-action="next"]').click();
    assert.equal(ui.messages.at(-1).offset, 50);
  } finally {
    ui.w.close();
  }
});
test("workspace default controls set or clear the selected profile without executing SQL", () => {
  for (const [value, action] of [
    [undefined, "setDefault"],
    ["local", "clearDefault"],
  ]) {
    const ui = setup(undefined, value);
    try {
      const button = ui.w.document.querySelector(
        '[data-action="' + action + '"]',
      );
      assert(button);
      button.click();
      assert.equal(ui.messages.at(-1).type, action);
      assert(!ui.messages.some((m) => m.type === "query"));
      if (value)
        assert.match(
          ui.w.document.querySelector("header .badge").textContent,
          /SQLite demo/,
        );
    } finally {
      ui.w.close();
    }
  }
});
test("driver enumeration uses an info icon; only tested success gets a green check and errors show SQLSTATE", () => {
  for (const [extra, icon] of [
    [{ statusKind: "info", status: "Chỉ liệt kê DSN: ExampleWarehouse" }, "info"],
    [{ statusKind: "success", status: "Kết nối thành công" }, "check"],
    [
      { statusKind: "error", error: "ODBC operation failed · SQLSTATE 28000" },
      "error",
    ],
  ]) {
    const ui = setup(undefined, undefined, extra);
    try {
      assert(ui.w.document.querySelector(".notice .codicon-" + icon));
      if (extra.error)
        assert.match(
          ui.w.document.querySelector('[role="alert"]').textContent,
          /28000/,
        );
    } finally {
      ui.w.close();
    }
  }
});
