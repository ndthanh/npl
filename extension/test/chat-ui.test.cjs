const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { JSDOM } = require("jsdom"),
  fs = require("node:fs");
const { detectTrigger, suggestions } = require("../dist/autocomplete.js");
const bundle = fs.readFileSync(
  require("node:path").join(__dirname, "../dist/webview.js"),
  "utf8",
);
test("Copilot contract with a four-backtick fence stays a compact expandable card", () => {
  const ui = setup({
    conversation: {
      id: "c",
      title: "Goal",
      draft: "",
      files: [],
      attachments: [],
      artifacts: [],
      mode: "develop",
      turns: 1,
      messages: [
        {
          id: "a",
          role: "assistant",
          text:
            "````json\n" +
            JSON.stringify({
              type: "change_set",
              edits: [
                { path: "README.md", content: "```cmd\npython main.py\n```" },
              ],
            }) +
            "\n````",
        },
      ],
    },
  });
  try {
    const body = ui.w.document.querySelector(".message-body");
    assert.match(body.textContent, /Đã chuẩn bị thay đổi 1 file/);
    assert(body.querySelector("details"));
    assert.equal(body.querySelector("details").open, false);
  } finally {
    ui.w.close();
  }
});
test("Goal setup keeps form edits across progress updates and sends explicit DoD and feedback consent", () => {
  const ui = setup({ goalForm: { id: "form1", objective: "CSV tool" } });
  try {
    const doc = ui.w.document,
      form = doc.querySelector('form[aria-label="Thiết lập Goal"]');
    assert(form);
    const objective = form.querySelector('[name="objective"]');
    objective.value = "edited goal";
    form.querySelector('[name="dod"]').value = "Acceptance passes";
    form.querySelector('[name="minTests"]').value = "8";
    assert.equal(form.querySelector('[name="shareLogs"]').checked, false);
    form.querySelector('[name="shareLogs"]').checked = true;
    ui.w.dispatchEvent(
      new ui.w.MessageEvent("message", {
        data: {
          type: "snapshot",
          state: {
            conversation: {
              id: "conversation",
              title: "Test",
              draft: "",
              messages: [],
              files: [],
              attachments: [],
              artifacts: [],
              mode: "develop",
              turns: 0,
            },
            history: [],
            surface: "sidebar",
            busy: false,
            goalForm: {
              id: "form1",
              objective: "server original",
              error: "Fix configuration",
            },
          },
        },
      }),
    );
    assert.equal(doc.querySelector('form[aria-label="Thiết lập Goal"]'), form);
    assert.equal(objective.value, "edited goal");
    assert.equal(
      form.querySelector("[data-goal-error]").textContent,
      "Fix configuration",
    );
    form.dispatchEvent(
      new ui.w.Event("submit", { bubbles: true, cancelable: true }),
    );
    const sent = ui.messages.at(-1);
    assert.equal(sent.type, "goalStart");
    assert.equal(sent.formId, "form1");
    assert.equal(sent.config.objective, "edited goal");
    assert.equal(sent.config.shareLogs, true);
    assert.equal(sent.config.dod, "Acceptance passes");
    assert(suggestions("commands", "go").some((s) => s.id === "/goal"));
  } finally {
    ui.w.close();
  }
});
test("Goal header uses its granted cumulative budget rather than the ordinary twenty-turn label", () => {
  const ui = setup({
    conversation: {
      id: "c",
      title: "Goal",
      draft: "",
      files: [],
      attachments: [],
      artifacts: [],
      messages: [],
      mode: "develop",
      turns: 21,
      goal: {
        id: "g",
        objective: "Tool",
        dod: ["Pass tests"],
        scope: ".",
        verification: "python -m unittest discover -v",
        minTests: 1,
        round: 21,
        budget: 40,
        status: "approval",
        confirmations: [false],
      },
    },
  });
  try {
    assert.equal(
      ui.w.document.querySelector(".conversation-row small").textContent,
      "21/40",
    );
    assert.match(
      ui.w.document.querySelector(".goal-card").textContent,
      /21\/40 lượt/,
    );
  } finally {
    ui.w.close();
  }
});
test("Goal checklist and completion are explicit actions; untrusted labels are escaped", () => {
  const conversation = {
    id: "c",
    title: "Goal",
    draft: "",
    messages: [],
    files: [],
    attachments: [],
    artifacts: [],
    mode: "develop",
    turns: 1,
    goal: {
      id: "g",
      objective: "<img src=x onerror=bad()>",
      dod: ["<b>criteria</b>"],
      scope: ".",
      verification: "python -m unittest discover -v",
      minTests: 1,
      round: 2,
      budget: 20,
      status: "review",
      confirmations: [false],
      evidence: { passed: true, tests: 1, exitCode: 0, at: "now" },
    },
  };
  const ui = setup({ conversation });
  try {
    const doc = ui.w.document;
    const disclosure = doc.querySelector(".goal-card > details");
    disclosure.open = false;
    ui.w.dispatchEvent(
      new ui.w.MessageEvent("message", {
        data: {
          type: "snapshot",
          state: {
            conversation,
            history: [],
            surface: "sidebar",
            busy: false,
            status: "Teams progress",
          },
        },
      }),
    );
    assert.equal(doc.querySelector(".goal-card > details").open, false);
    doc.querySelector(".goal-card > details").open = true;
    assert(!doc.querySelector(".goal-card img"));
    assert(!doc.querySelector(".goal-card b"));
    const check = doc.querySelector("[data-goal-confirm]");
    assert(!check.disabled);
    check.checked = true;
    check.dispatchEvent(new ui.w.Event("change"));
    assert.deepEqual(JSON.parse(JSON.stringify(ui.messages.at(-1))), {
      type: "goalConfirm",
      id: "g",
      index: 0,
      confirmed: true,
    });
    doc.querySelector('[data-action="goalAction"][data-kind="finish"]').click();
    assert.equal(ui.messages.at(-1).kind, "finish");
  } finally {
    ui.w.close();
  }
});
test("connection label belongs to its button; waiting spinner stays above composer and partial Markdown has no executable SQL actions", () => {
  const conversation = {
    id: "c",
    title: "Streaming",
    draft: "keep draft",
    messages: [],
    files: [],
    attachments: [],
    artifacts: [],
    mode: "ask",
    turns: 1,
    request: { requestId: "req" },
  };
  const ui = setup({
    conversation,
    busy: true,
    waitingCopilot: true,
    workStartedAt: Date.now() - 3000,
    connection: { phase: "connected", message: "Teams đã kết nối" },
  });
  try {
    const doc = ui.w.document;
    assert(doc.querySelector('header [data-action="connect"] #statusText'));
    assert(doc.querySelector("footer .work-indicator .codicon-modifier-spin"));
    assert(!doc.querySelector("header .work-indicator"));
    assert.match(doc.getElementById("workStatusText").textContent, /chuẩn bị/);
    const preview = (text) =>
      ui.w.dispatchEvent(
        new ui.w.MessageEvent("message", {
          data: {
            type: "copilotPreview",
            conversationId: "c",
            phase: "streaming",
            preview: { requestId: "req", text },
          },
        }),
      );
    preview("First **partial**");
    assert(doc.querySelector(".stream-preview strong"));
    const prompt = doc.getElementById("prompt");
    prompt.focus();
    prompt.value = "typing while streaming";
    prompt.setSelectionRange(5, 5);
    preview("Rewritten\n```sql\nSELECT 1\n```");
    assert.equal(doc.getElementById("prompt"), prompt);
    assert.equal(prompt.value, "typing while streaming");
    assert.equal(prompt.selectionStart, 5);
    assert(!doc.querySelector('.stream-preview [data-action="executeSql"]'));
    assert.equal(doc.querySelectorAll(".stream-preview").length, 1);
    assert.match(
      doc.getElementById("workStatusText").textContent,
      /đang trả lời/,
    );
    assert.match(
      doc.querySelector('[data-action="connect"]').textContent,
      /Teams đã kết nối/,
    );
  } finally {
    ui.w.close();
  }
});
test("legacy optical logs and cards are absent while ordinary messages and ZIPs stay visible", () => {
  const c = {
    id: "c",
    title: "Logs",
    draft: "",
    messages: [
      {
        id: "old",
        role: "system",
        text: "Đã đóng gói 7 file workspace theo .nopilotignore cho Decimen. ZIP chỉ lưu local; chưa gửi Copilot.",
      },
      { id: "normal", role: "assistant", text: "Normal response" },
    ],
    files: [],
    attachments: [],
    artifacts: [
      {
        id: "hidden",
        messageId: "old",
        name: "decimen-deadbeef-workspace.zip",
        bytes: 50,
      },
      { id: "normal", messageId: "normal", name: "project.zip", bytes: 50 },
    ],
    mode: "develop",
    turns: 1,
  };
  const ui = setup({ conversation: c });
  try {
    const main = ui.w.document.querySelector("main");
    assert(!main.textContent.includes("Decimen"));
    assert(!main.textContent.includes("decimen-deadbeef"));
    assert.match(main.textContent, /Normal response/);
    assert.match(main.textContent, /project.zip/);
  } finally {
    ui.w.close();
  }
});
test("hidden command is absent from all suggestions and prefixes; full command still submits to the host", () => {
  const ui = setup();
  try {
    input(ui, "/de");
    key(ui, "Tab");
    assert(!suggestions("commands", "").some((m) => m.id === "/dec"));
    assert(!suggestions("context", "").some((m) => m.id === "/dec"));
    assert.equal(suggestions("commands", "dec").length, 0);
    assert(!ui.messages.some((m) => m.type === "decOpen"));
    assert(!ui.messages.some((m) => m.type === "send"));
    assert.equal(ui.prompt.value, "/de");
    input(ui, "/dec");
    key(ui, "Enter");
    assert.equal(ui.messages.at(-1).type, "send");
    assert.equal(ui.messages.at(-1).text, "/dec");
  } finally {
    ui.w.close();
  }
});
test("Decimen modal stays separate from chat rerenders, escapes metadata and closes with Escape", () => {
  const transfer = { id: "dec-1", status: "preparing" },
    ui = setup({ decTransfer: transfer });
  try {
    const modal = ui.w.document.querySelector('[role="dialog"]');
    assert(modal);
    assert.equal(modal.querySelectorAll("button").length, 1);
    assert.equal(modal.querySelectorAll("canvas").length, 1);
    assert.equal(modal.textContent.trim(), "Đóng ✕");
    assert.equal(
      modal.querySelectorAll("p,details,input,small,strong").length,
      0,
    );
    ui.w.dispatchEvent(
      new ui.w.MessageEvent("message", {
        data: {
          type: "event",
          conversationId: "conversation",
          event: {
            type: "CUSTOM",
            name: "nopilot.activity",
            value: { id: "unrelated", status: "running", title: "Output" },
          },
        },
      }),
    );
    assert.equal(ui.w.document.querySelector('[role="dialog"]'), modal);
    modal.dispatchEvent(
      new ui.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(ui.w.document.querySelector('[role="dialog"]'), null);
    assert.equal(ui.messages.at(-1).type, "decClose");
    assert.equal(ui.messages.at(-1).id, "dec-1");
  } finally {
    ui.w.close();
  }
});
test("a new single-file reply never inherits old ZIPs; accepted run output remains inside its change card", () => {
  const c = {
    id: "c",
    title: "Iteration",
    draft: "",
    mode: "develop",
    files: [],
    attachments: [],
    artifacts: [
      { id: "z", name: "old.zip", bytes: 10, messageId: "old" },
      { id: "py", name: "main.py", bytes: 12, messageId: "new" },
    ],
    messages: [
      { id: "old", role: "assistant", text: "Old ZIP" },
      { id: "new", role: "assistant", text: "Updated main.py" },
    ],
    checkpoint: { changeId: "change" },
    changeHistory: [
      {
        id: "change",
        messageId: "new",
        status: "applied",
        files: [{ path: "main.py", added: 1, removed: 1 }],
        run: { status: "failed" },
        error: "test failed",
      },
    ],
    activities: [
      {
        id: "run",
        messageId: "new",
        changeId: "change",
        title: "Python test",
        status: "failed",
        output: "FAIL",
      },
    ],
  };
  const ui = setup({ conversation: c });
  try {
    const doc = ui.w.document,
      lists = doc.querySelectorAll(".artifacts-card");
    assert.equal(lists.length, 2);
    assert.equal(lists[0].open, false);
    assert.equal(lists[1].open, false);
    assert.match(lists[0].textContent, /old.zip/);
    assert(!lists[1].textContent.includes("old.zip"));
    assert.match(lists[1].textContent, /main.py/);
    assert.equal(doc.querySelector(".zip-bundles"), null);
    const card = doc.querySelector('[data-proposal="change"]');
    assert(card.querySelector('[data-activity="run"]'));
    assert.equal(doc.querySelectorAll('[data-activity="run"]').length, 1);
    card.querySelector('[data-action="changeTask"][data-task="check"]').click();
    assert.equal(ui.messages.at(-1).task, "check");
    assert.equal(ui.messages.at(-1).id, "change");
    assert(card.querySelector('[data-action="checkpoint"]'));
  } finally {
    ui.w.close();
  }
});
test("fast approval is default, supports subsets, and never auto-executes while rendering", () => {
  const c = {
    id: "c",
    title: "Fast",
    draft: "",
    mode: "develop",
    files: [],
    attachments: [],
    artifacts: [],
    messages: [{ id: "a", role: "assistant", text: "Files" }],
    pending: {
      id: "p",
      kind: "changes",
      status: "pending",
      messageId: "a",
      data: { edits: [{ path: "a.py" }, { path: "b.py" }] },
      selectedPaths: ["a.py"],
    },
  };
  const ui = setup({ conversation: c });
  try {
    const card = ui.w.document.querySelector('[data-proposal="p"]');
    assert(!card.querySelector('[data-action="approve"]').disabled);
    assert(card.querySelector('[data-action="acceptRun"]').disabled);
    assert.equal(card.querySelector("[data-confirm-review]"), null);
    assert(
      !ui.messages.some((m) => m.type === "approve" || m.type === "acceptRun"),
    );
    card.querySelector('[data-select-change][data-path="b.py"]').click();
    assert.equal(ui.messages.at(-1).type, "selectChange");
    assert.equal(ui.messages.at(-1).path, "b.py");
    card.querySelector("[data-review-mode]").click();
    assert.equal(ui.messages.at(-1).mode, "strict");
  } finally {
    ui.w.close();
  }
});
function setup(overrides = {}) {
  const messages = [];
  const dom = new JSDOM(
    '<!doctype html><head></head><body><div id="app"></div></body>',
    { runScripts: "dangerously", url: "https://nopilot.test/" },
  );
  const w = dom.window;
  w.acquireVsCodeApi = () => ({
    postMessage: (m) => messages.push(m),
    setState() {},
    getState() {},
  });
  const script = w.document.createElement("script");
  script.nonce = "test";
  script.textContent = bundle;
  w.document.body.append(script);
  w.dispatchEvent(
    new w.MessageEvent("message", {
      data: {
        type: "snapshot",
        state: {
          conversation: {
            id: "conversation",
            title: "Test",
            draft: "",
            messages: [],
            files: [],
            attachments: [],
            artifacts: [],
            mode: "ask",
            tools: false,
            turns: 0,
          },
          history: [],
          root: "C:/fixture",
          busy: false,
          status: "Chưa kết nối Teams",
          surface: "sidebar",
          ...overrides,
        },
      },
    }),
  );
  return { dom, w, messages, prompt: w.document.getElementById("prompt") };
}
function input(ui, text) {
  ui.prompt.value = text;
  ui.prompt.setSelectionRange(text.length, text.length);
  ui.prompt.dispatchEvent(new ui.w.Event("input", { bubbles: true }));
}
function key(ui, value) {
  ui.prompt.dispatchEvent(
    new ui.w.KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    }),
  );
}
test("Teams buttons show a spinner and retry countdown while connecting; draft input stays enabled", () => {
  const ui = setup({
    connection: {
      phase: "retrying",
      attempt: 2,
      retryIn: 5,
      message: "Đang chờ thử lại",
    },
  });
  try {
    const buttons = [
      ...ui.w.document.querySelectorAll('[data-action="connect"]'),
    ];
    assert.equal(buttons.length, 2);
    for (const b of buttons) {
      assert(b.disabled);
      assert.equal(b.getAttribute("aria-busy"), "true");
      assert(b.querySelector(".codicon-modifier-spin"));
    }
    assert.match(buttons[1].textContent, /2\/3.*5s/);
    assert.equal(ui.prompt.disabled, false);
    assert.equal(ui.messages.filter((m) => m.type === "ready").length, 1);
  } finally {
    ui.dom.window.close();
  }
});
test("failed Teams connection keeps an actionable retry button with the cause in its tooltip", () => {
  const ui = setup({
    connection: { phase: "failed", message: "Open Teams first" },
  });
  try {
    const b = ui.w.document.querySelector('.welcome [data-action="connect"]');
    assert(!b.disabled);
    assert.equal(b.title, "Open Teams first");
    assert.match(b.textContent, /Thử kết nối lại/);
    b.click();
    assert.equal(ui.messages.at(-1).type, "connect");
  } finally {
    ui.dom.window.close();
  }
});
test("messages omit speaker labels; ZIP preview sends only selected paths or explicit all", () => {
  const c = {
    id: "c",
    title: "ZIP",
    draft: "",
    files: [],
    attachments: [],
    artifacts: [{ id: "z", name: "project.zip", bytes: 1024 }],
    mode: "develop",
    tools: false,
    turns: 0,
    messages: [
      { role: "user", text: "Update project" },
      { role: "assistant", text: "Ready" },
    ],
    zipPreview: {
      id: "z",
      name: "project.zip",
      files: [
        { path: "main.py", bytes: 20 },
        { path: ".env", bytes: 10, blocked: true },
      ],
    },
  };
  const ui = setup({ conversation: c });
  try {
    assert.equal(ui.w.document.querySelector(".message-label"), null);
    assert(ui.w.document.querySelector(".message.user .message-body"));
    ui.w.document.querySelector('[data-action="previewZip"]').click();
    assert.equal(ui.messages.at(-1).type, "previewZip");
    const checks = ui.w.document.querySelectorAll("input[data-zip-path]");
    assert(checks[1].disabled);
    const fileButtons = ui.w.document.querySelectorAll(
      '[data-action="copyZipFile"]',
    );
    assert(fileButtons[1].disabled);
    fileButtons[0].click();
    assert.deepEqual(JSON.parse(JSON.stringify(ui.messages.at(-1))), {
      type: "copyZip",
      id: "z",
      all: false,
      paths: ["main.py"],
    });
    assert.equal(checks[0].checked, false);
    checks[0].checked = true;
    ui.w.document.querySelector('[data-action="copyZipSelected"]').click();
    assert.deepEqual(JSON.parse(JSON.stringify(ui.messages.at(-1))), {
      type: "copyZip",
      id: "z",
      all: false,
      paths: ["main.py"],
    });
    ui.w.document.querySelector('[data-action="copyZipAll"]').click();
    assert.equal(ui.messages.at(-1).all, true);
    assert.equal(ui.messages.at(-1).id, "z");
    assert.deepEqual(JSON.parse(JSON.stringify(ui.messages.at(-1).paths)), []);
    assert(ui.w.document.querySelector('.artifact [data-action="copyZipAll"]'));
  } finally {
    ui.w.close();
  }
});
test("autocomplete detects cursor-local @ and / tokens without matching email addresses", () => {
  assert.equal(detectTrigger("mail name@example.com", 21), undefined);
  assert.equal(detectTrigger("Fix @fi", 7).query, "fi");
  assert.equal(suggestions("commands", "up")[0].id, "/upload");
});
test("inline results belong to their SQL fence, can minimize in place, and questions/answers have copy icons", () => {
  const c = {
    id: "c",
    title: "Nested",
    draft: "",
    mode: "ask",
    files: [],
    attachments: [],
    artifacts: [],
    turns: 1,
    messages: [
      { id: "q", role: "user", text: "Question" },
      {
        id: "a",
        role: "assistant",
        text: "Before\n```sql\nSELECT 1;\n```\nAfter",
      },
    ],
    sqlCards: [
      {
        id: "f".repeat(32),
        messageId: "a",
        index: 0,
        visible: true,
        collapsed: true,
        connection: "DB",
        result: {
          rowCount: 1,
          rows: [[1]],
          columns: [{ name: "n" }],
          offset: 0,
          pageSize: 50,
        },
      },
    ],
  };
  const ui = setup({ conversation: c });
  try {
    const snippet = ui.w.document.querySelector(".sql-snippet");
    assert(snippet.querySelector(".inline-sql"));
    assert.equal(snippet.querySelector("table"), null);
    snippet.querySelector('[data-action="sqlCollapse"]').click();
    assert.equal(ui.messages.at(-1).type, "sqlCollapse");
    assert.equal(
      ui.w.document.querySelectorAll('[data-action="copyMessage"]').length,
      2,
    );
    ui.w.document
      .querySelector('.message.user [data-action="copyMessage"]')
      .click();
    assert.equal(ui.messages.at(-1).id, "q");
  } finally {
    ui.w.close();
  }
});
test("SQL fences expose Execute per snippet, preserve code, and never execute during rendering", () => {
  const c = {
    id: "c",
    title: "SQL",
    draft: "",
    files: [],
    attachments: [],
    artifacts: [],
    mode: "ask",
    tools: false,
    turns: 0,
    messages: [
      {
        id: "a",
        role: "assistant",
        text: "```python\nprint(1)\n```\n```SQL\nSELECT '<tag>' AS value;\n```\n```tsql\nSELECT 2;\n```",
      },
    ],
  };
  const ui = setup({ conversation: c });
  try {
    const buttons = ui.w.document.querySelectorAll(
      '[data-action="executeSql"]',
    );
    assert.equal(buttons.length, 2);
    assert(!ui.messages.some((m) => m.type === "executeSql"));
    assert.match(
      ui.w.document.querySelector(".sql-snippet code").textContent,
      /<tag>/,
    );
    buttons[1].click();
    const m = ui.messages.at(-1);
    assert.equal(m.type, "executeSql");
    assert.equal(m.id, "a");
    assert.equal(m.index, 1);
    assert.equal(m.sql, undefined);
  } finally {
    ui.w.close();
  }
});
test("waiting Copilot exposes Stop and real steer; service-error recovery offers a new conversation", () => {
  const ui = setup({ busy: true, canStopCopilot: true });
  try {
    assert(ui.w.document.querySelector('[data-action="stopCopilot"]'));
    assert.match(
      ui.w.document.querySelector('[data-action="steer"]').title,
      /dừng Copilot/,
    );
    ui.w.document.querySelector('[data-action="stopCopilot"]').click();
    assert.equal(ui.messages.at(-1).type, "stopCopilot");
  } finally {
    ui.w.close();
  }
  const c = {
    id: "c",
    title: "Failed",
    draft: "",
    messages: [],
    files: [],
    attachments: [],
    artifacts: [],
    mode: "ask",
    turns: 1,
    recovery: { kind: "failed", message: "Oops! Try again" },
  };
  const failed = setup({ conversation: c });
  try {
    const card = failed.w.document.querySelector(".recovery-card");
    assert(card);
    card.querySelector('[data-action="new"]').click();
    assert.equal(failed.messages.at(-1).type, "new");
    assert(!failed.messages.some((m) => m.type === "send"));
  } finally {
    failed.w.close();
  }
});
test("Develop exposes Include project; SQL inline grids escape data and emit snapshot page/export actions", () => {
  const id = "a".repeat(32),
    c = {
      id: "c",
      title: "Inline",
      draft: "",
      mode: "develop",
      autoWorkspace: true,
      includeProject: true,
      messages: [
        {
          id: "sql",
          role: "assistant",
          text: "```sql\nSELECT value FROM data;\n```",
        },
      ],
      files: [],
      attachments: [],
      artifacts: [],
      turns: 1,
      sqlCards: [
        {
          id,
          messageId: "sql",
          index: 0,
          visible: true,
          connection: "Local",
          result: {
            rows: [["<img src=x onerror=alert(1)>"]],
            columns: [{ name: "value" }],
            rowCount: 150,
            offset: 0,
            pageSize: 50,
          },
        },
      ],
    };
  const ui = setup({ conversation: c });
  try {
    const toggle = ui.w.document.getElementById("includeProject");
    assert(toggle.checked);
    toggle.click();
    assert.equal(ui.messages.at(-1).type, "includeProject");
    assert.equal(ui.messages.at(-1).enabled, false);
    assert(ui.w.document.querySelector(".inline-sql"));
    assert.equal(ui.w.document.querySelector(".inline-sql img"), null);
    ui.w.document.querySelector('[aria-label="SQL trang sau"]').click();
    assert.equal(ui.messages.at(-1).type, "sqlPage");
    assert.equal(ui.messages.at(-1).offset, 50);
    ui.w.document.querySelector('[data-action="sqlExportXlsx"]').click();
    assert.equal(ui.messages.at(-1).format, "xlsx");
    assert(!ui.messages.some((m) => m.type === "executeSql"));
  } finally {
    ui.w.close();
  }
});
test("composer is clean by default; secondary icon controls have accessible names", () => {
  const ui = setup();
  try {
    assert.equal(ui.w.document.querySelectorAll(".suggestion").length, 0);
    assert.equal(ui.w.document.querySelectorAll(".context-menu").length, 0);
    const send = ui.w.document.querySelector('[data-action="send"]');
    assert.equal(send.getAttribute("aria-label"), "Gửi tin nhắn");
    assert(send.querySelector(".codicon-arrow-up"));
  } finally {
    ui.dom.window.close();
  }
});
test("typing @fi opens File suggestion and Tab selects context without submitting the prompt", () => {
  const ui = setup();
  try {
    input(ui, "Sửa @fi");
    assert.match(ui.w.document.querySelector(".popover").textContent, /File/);
    key(ui, "Tab");
    assert.equal(ui.prompt.value, "Sửa ");
    assert(ui.messages.some((m) => m.type === "context" && m.kind === "file"));
    assert(!ui.messages.some((m) => m.type === "send"));
  } finally {
    ui.dom.window.close();
  }
});
test("/up + Tab fills /upload and opens a path-only native chooser", () => {
  const ui = setup();
  try {
    input(ui, "/up");
    key(ui, "Tab");
    assert.equal(ui.prompt.value, "/upload ");
    assert(
      ui.messages.some((m) => m.type === "chooseFile" && m.pathOnly === true),
    );
    assert(!ui.messages.some((m) => m.type === "send"));
  } finally {
    ui.dom.window.close();
  }
});
test("arrow keys choose context, Escape closes suggestions and preserves the draft", () => {
  const ui = setup();
  try {
    input(ui, "@");
    key(ui, "ArrowDown");
    key(ui, "Enter");
    assert(ui.messages.some((m) => m.type === "context" && m.kind === "file"));
    input(ui, "giữ @work");
    key(ui, "Escape");
    assert.equal(ui.w.document.querySelector(".popover"), null);
    assert.equal(ui.prompt.value, "giữ @work");
  } finally {
    ui.dom.window.close();
  }
});
test("unknown triggers do not trap Tab in an empty popup", () => {
  const ui = setup();
  try {
    input(ui, "@doesnotexist");
    assert.equal(ui.w.document.querySelector(".popover"), null);
  } finally {
    ui.dom.window.close();
  }
});
test("context menu button exposes folder/workspace without a permanent row of @ buttons", () => {
  const ui = setup();
  try {
    input(ui, "@");
    assert.match(
      ui.w.document.querySelector(".popover").textContent,
      /@folder/,
    );
    assert.match(
      ui.w.document.querySelector(".popover").textContent,
      /@workspace/,
    );
  } finally {
    ui.dom.window.close();
  }
});
test("both trigger prefixes share context and command choices", () => {
  const ui = setup();
  try {
    for (const prefix of ["@", "/"]) {
      input(ui, prefix);
      const text = ui.w.document.querySelector(".popover").textContent;
      assert.match(text, /@file/);
      assert.match(text, /\/upload/);
    }
  } finally {
    ui.dom.window.close();
  }
});
test("welcome uses a primary connection button and slash menu includes ignore/setup/database", () => {
  const ui = setup();
  try {
    assert(
      ui.w.document
        .querySelector('.welcome [data-action="connect"]')
        .classList.contains("primary"),
    );
    input(ui, "/");
    const text = ui.w.document.querySelector(".popover").textContent;
    assert.match(text, /\/ignore/);
    assert.match(text, /\/setup/);
    assert.match(text, /\/db/);
  } finally {
    ui.w.close();
  }
});
test("setup suggestions and model selection are available directly in chat", () => {
  const ui = setup({
    runtimeSetup: { phase: "missing", missing: ["frida"] },
    copilotModel: "GPT-5.6 Sol Think deeper",
  });
  try {
    const d = ui.w.document;
    assert.match(d.querySelector(".setup-card").textContent, /frida/);
    assert(d.querySelector('.setup-card [data-action="setupOffline"]'));
    assert.equal(d.querySelector("#mode"), null);
    const model = d.querySelector("#copilot-model");
    assert.equal(model.nextElementSibling.dataset.action, "voiceToggle");
    model.value = "Auto";
    model.dispatchEvent(new ui.w.Event("change", { bubbles: true }));
    assert.equal(ui.messages.at(-1).type, "copilotModel");
    assert.equal(ui.messages.at(-1).model, "Auto");
  } finally {
    ui.w.close();
  }
});
test("edited files card is compact, expandable, and exposes Undo/View changes after apply", () => {
  const change = {
    id: "change",
    messageId: "answer",
    status: "applied",
    files: Array.from({ length: 9 }, (_, i) => ({
      path: "src/file-" + i + ".py",
      added: i + 1,
      removed: 1,
      binary: false,
    })),
  };
  const conversation = {
    id: "conversation",
    title: "Changes",
    draft: "",
    messages: [{ id: "answer", role: "assistant", text: "Updated" }],
    files: [],
    attachments: [],
    artifacts: [],
    mode: "develop",
    tools: false,
    turns: 1,
    checkpoint: { changeId: "change" },
    changeHistory: [change],
  };
  const ui = setup({ conversation });
  try {
    assert.match(
      ui.w.document.querySelector(".changes-heading").textContent,
      /Đã chấp nhận · 9 file/,
    );
    assert.equal(ui.w.document.querySelector(".change-more").open, false);
    assert.match(
      ui.w.document.querySelector(".change-more summary").textContent,
      /6 more/,
    );
    ui.w.document.querySelector('[data-action="viewChange"]').click();
    assert.equal(ui.messages.at(-1).id, "change");
    assert(
      !ui.w.document.querySelector(
        '.changes-actions [data-action="checkpoint"]',
      ).disabled,
    );
  } finally {
    ui.w.close();
  }
});
test("project picker supports tri-state folders, ignored visibility, local drafts and default/empty selection", () => {
  const model = {
    revision: "picker-r1",
    conversationId: "conversation",
    root: "C:/fixture",
    entries: [
      { path: "src", directory: true, bytes: 0 },
      { path: "src/a.py", directory: false, bytes: 10 },
      { path: "src/b.py", directory: false, bytes: 20 },
      {
        path: ".env",
        directory: false,
        bytes: 0,
        blocked: true,
        reason: "Ignored secret",
      },
      {
        path: "node_modules",
        directory: true,
        bytes: 0,
        blocked: true,
        reason: "Ignored dependency directory",
      },
    ],
  };
  const ui = setup({ projectPicker: model });
  try {
    const doc = ui.w.document,
      dialog = doc.querySelector('[role="dialog"]');
    assert(dialog);
    assert.equal(doc.querySelector('[data-project-path=".env"]'), null);
    const folder = doc.querySelector('[data-project-path="src"]');
    assert(folder.checked);
    doc.querySelector('[data-project-path="src/a.py"]').click();
    assert(folder.indeterminate);
    assert(!folder.checked);
    assert.match(
      doc.querySelector(".project-summary").textContent,
      /1\/2 file/,
    );
    doc.querySelector("[data-picker-ignored]").click();
    assert(doc.querySelector('[data-project-path=".env"]').disabled);
    const search = doc.querySelector(".project-search");
    search.value = "b.py";
    search.dispatchEvent(new ui.w.Event("input"));
    assert.equal(doc.querySelector('[data-project-path="src/a.py"]'), null);
    assert(doc.querySelector('[data-project-path="src/b.py"]'));
    doc.querySelector("[data-picker-save]").click();
    assert.equal(ui.messages.at(-1).type, "saveProjectSelection");
    assert.deepEqual([...ui.messages.at(-1).paths], ["src/b.py"]);
    assert.equal(ui.messages.at(-1).defaults, false);
    doc.querySelector("[data-picker-none]").click();
    doc.querySelector("[data-picker-save]").click();
    assert.deepEqual([...ui.messages.at(-1).paths], []);
    doc.querySelector("[data-picker-default]").click();
    doc.querySelector("[data-picker-save]").click();
    assert.equal(ui.messages.at(-1).defaults, true);
    search.focus();
    const before = doc.querySelector(".project-overlay");
    ui.w.dispatchEvent(
      new ui.w.MessageEvent("message", {
        data: {
          type: "event",
          conversationId: "conversation",
          event: {
            type: "CUSTOM",
            name: "nopilot.activity",
            value: {
              id: "progress",
              status: "running",
              title: "Background",
              output: "tick",
            },
          },
        },
      }),
    );
    assert.equal(doc.querySelector(".project-overlay"), before);
    assert.equal(doc.activeElement, search);
    assert.equal(search.value, "b.py");
    search.dispatchEvent(
      new ui.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(ui.messages.at(-1).type, "closeProjectPicker");
    assert(!ui.messages.some((m) => m.type === "send"));
  } finally {
    ui.w.close();
  }
});
test("pending-send choice is beside the composer, targets the proposal and does not silently reject or send", () => {
  const ui = setup({
    conversation: {
      id: "c",
      title: "Pending",
      draft: "Change main.py",
      files: [],
      attachments: [],
      artifacts: [],
      messages: [],
      mode: "develop",
      tools: false,
      turns: 0,
      pending: {
        id: "proposal",
        kind: "archive",
        status: "pending",
        data: { root: "C:/fixture", files: [] },
      },
      blockedSend: { proposalId: "proposal" },
    },
  });
  try {
    const card = ui.w.document.querySelector("footer .send-choice");
    assert(card);
    assert.match(card.textContent, /Yêu cầu mới chưa được gửi/);
    assert(!ui.messages.some((m) => m.type === "sendInstead"));
    card.querySelector('[data-action="sendInstead"]').click();
    assert.equal(ui.messages.at(-1).type, "sendInstead");
    assert.equal(ui.messages.at(-1).id, "proposal");
    card.querySelector('[data-action="cancelBlockedSend"]').click();
    assert.equal(ui.messages.at(-1).type, "cancelBlockedSend");
    assert.equal(ui.prompt.value, "Change main.py");
  } finally {
    ui.w.close();
  }
});
test("legacy repeated pending-approval errors collapse without mutating saved transcript", () => {
  const messages = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    role: "system",
    text: "Error: Duyệt hoặc từ chối đề xuất hiện tại trước.",
  }));
  const ui = setup({
    conversation: {
      id: "c",
      title: "Old errors",
      draft: "",
      messages,
      files: [],
      attachments: [],
      artifacts: [],
      mode: "develop",
      tools: false,
      turns: 0,
    },
  });
  try {
    const notice = ui.w.document.querySelector(".repeated-notice");
    assert(notice);
    assert.equal(notice.open, false);
    assert.match(notice.textContent, /lặp 5 lần/);
    assert.equal(messages.length, 5);
    assert.equal(messages[0].repeated, undefined);
  } finally {
    ui.w.close();
  }
});
test("source approval steps stay on their originating card and require explicit review confirmation", () => {
  const pending = {
    id: "p",
    kind: "archive",
    status: "pending",
    messageId: "origin",
    data: { root: "C:/fixture", state: "staged", files: [{ path: "main.py" }] },
  };
  const conversation = {
    id: "c",
    title: "Review",
    draft: "",
    messages: [
      { id: "origin", role: "assistant", text: "A proposal" },
      { id: "later", role: "user", text: "Later message" },
    ],
    files: [],
    attachments: [],
    artifacts: [],
    mode: "develop",
    tools: false,
    turns: 1,
    pending,
    reviewMode: "strict",
  };
  const ui = setup({ conversation });
  const update = () =>
    ui.w.dispatchEvent(
      new ui.w.MessageEvent("message", {
        data: {
          type: "snapshot",
          state: {
            conversation,
            history: [],
            root: "C:/fixture",
            busy: false,
            status: "Teams đã kết nối",
            surface: "editor",
          },
        },
      }),
    );
  try {
    const doc = ui.w.document;
    let card = doc.querySelector('[data-proposal="p"]');
    assert.equal(doc.querySelector("article.message").nextElementSibling, card);
    assert(card.querySelector('[data-action="approve"]').disabled);
    assert(card.querySelector("[data-confirm-review]").disabled);
    const n = ui.messages.length;
    card.querySelector('[data-action="approve"]').click();
    assert.equal(ui.messages.length, n);
    assert.match(
      card.querySelector('[data-action="reject"]').textContent,
      /Bỏ qua/,
    );
    pending.reviewed = true;
    pending.diffOpened = true;
    pending.reviewRevision = "r1";
    update();
    card = doc.querySelector('[data-proposal="p"]');
    assert(card.querySelector('[data-action="approve"]').disabled);
    assert(!card.querySelector("[data-confirm-review]").disabled);
    card.querySelector("[data-confirm-review]").click();
    assert.equal(ui.messages.at(-1).type, "confirmReview");
    assert.equal(ui.messages.at(-1).id, "p");
    assert.equal(ui.messages.at(-1).revision, "r1");
    pending.reviewConfirmed = true;
    update();
    card = doc.querySelector('[data-proposal="p"]');
    assert(!card.querySelector('[data-action="approve"]').disabled);
    pending.status = "failed";
    pending.error = "Backup failed on this proposal";
    update();
    card = doc.querySelector('[data-proposal="p"]');
    assert.match(
      card.querySelector('[role="alert"]').textContent,
      /Backup failed/,
    );
    assert.equal(doc.querySelector("footer .error"), null);
    assert.equal(doc.querySelectorAll('[data-proposal="p"]').length, 1);
  } finally {
    ui.w.close();
  }
});
test("activities stay beside their originating messages; unanchored legacy failures are collapsed at the start", () => {
  const ui = setup({
    conversation: {
      id: "c",
      title: "Timeline",
      draft: "",
      files: [],
      attachments: [],
      artifacts: [],
      mode: "develop",
      tools: false,
      turns: 2,
      messages: [
        { id: "old", role: "user", text: "Old request" },
        { id: "new", role: "user", text: "New successful request" },
      ],
      activities: [
        {
          id: "legacy",
          title: "Old backup",
          status: "failed",
          output: "historic failure",
        },
        {
          id: "old-run",
          messageId: "old",
          title: "Backup",
          status: "failed",
          output: "failed",
        },
        {
          id: "new-run",
          messageId: "new",
          title: "Backup",
          status: "completed",
          output: "success",
        },
      ],
    },
  });
  try {
    const doc = ui.w.document,
      main = doc.querySelector("main"),
      history = doc.querySelector(".activity-history");
    assert.equal(main.firstElementChild, history);
    assert.equal(history.open, false);
    assert(history.querySelector('[data-activity="legacy"]'));
    const messages = doc.querySelectorAll("article.message");
    assert.equal(messages[0].nextElementSibling.dataset.activity, "old-run");
    assert.equal(messages[1].nextElementSibling.dataset.activity, "new-run");
    assert.equal(doc.querySelectorAll('[data-activity="old-run"]').length, 1);
  } finally {
    ui.w.close();
  }
});
test("ZIP history stays collapsed and never renders a global recent-ZIP area", () => {
  const ui = setup({
    conversation: {
      id: "c",
      title: "History",
      draft: "",
      messages: [],
      files: [],
      attachments: [],
      mode: "develop",
      artifacts: [{ id: "old", name: "old.zip", bytes: 40 }],
    },
  });
  try {
    const doc = ui.w.document;
    assert.equal(doc.querySelector(".zip-bundles"), null);
    assert.equal(doc.querySelector(".artifacts-card").open, false);
    doc.querySelector('[data-action="previewZip"]').click();
    assert.equal(ui.messages.at(-1).id, "old");
  } finally {
    ui.w.close();
  }
});

test("switching conversations clears a previous transient footer error", () => {
  const ui = setup();
  try {
    ui.w.dispatchEvent(
      new ui.w.MessageEvent("message", {
        data: { type: "error", text: "old transient error" },
      }),
    );
    assert(ui.w.document.querySelector("footer .error"));
    ui.w.dispatchEvent(
      new ui.w.MessageEvent("message", {
        data: {
          type: "snapshot",
          state: {
            conversation: {
              id: "new",
              title: "New",
              draft: "",
              messages: [],
              files: [],
              attachments: [],
              artifacts: [],
              mode: "develop",
              tools: false,
              turns: 0,
            },
            history: [],
            root: "C:/fixture",
            busy: false,
            status: "Teams đã kết nối",
            surface: "sidebar",
          },
        },
      }),
    );
    assert.equal(ui.w.document.querySelector("footer .error"), null);
  } finally {
    ui.w.close();
  }
});
test("project restore menu targets the latest checkpoint without sending the conversation ID", () => {
  const ui = setup({
    conversation: {
      id: "conversation",
      title: "Restore",
      draft: "",
      messages: [],
      files: [],
      attachments: [],
      artifacts: [],
      mode: "develop",
      tools: false,
      turns: 0,
      checkpoint: { changeId: "last-change" },
    },
  });
  try {
    ui.w.document.querySelector('[data-action="projectMenu"]').click();
    const restore = [...ui.w.document.querySelectorAll('[role="option"]')].find(
      (b) => b.textContent.includes("Khôi phục checkpoint"),
    );
    restore.click();
    assert.equal(ui.messages.at(-1).type, "checkpoint");
    assert.equal(ui.messages.at(-1).id, undefined);
  } finally {
    ui.dom.window.close();
  }
});
test("many artifacts start collapsed, can expand, and retain expansion through live updates", () => {
  const conversation = {
    id: "conversation",
    title: "Artifacts",
    draft: "",
    messages: [{ role: "assistant", text: "Chat remains readable" }],
    files: [],
    attachments: [],
    artifacts: Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      name: "artifact-" + i + ".txt",
      bytes: 1024,
    })),
    mode: "develop",
    tools: false,
    turns: 0,
  };
  const ui = setup({ conversation });
  try {
    const card = ui.w.document.querySelector("details.artifacts-card");
    assert(card);
    assert.equal(card.open, false);
    assert.match(card.querySelector("summary").textContent, /100/);
    assert(ui.w.document.querySelector(".message-body"));
    card.open = true;
    card.dispatchEvent(new ui.w.Event("toggle"));
    ui.w.dispatchEvent(
      new ui.w.MessageEvent("message", {
        data: {
          type: "event",
          conversationId: "conversation",
          event: {
            type: "CUSTOM",
            name: "nopilot.activity",
            value: {
              id: "output",
              title: "Tool output",
              status: "completed",
              output: "done",
            },
          },
        },
      }),
    );
    assert(ui.w.document.querySelector("details.artifacts-card").open);
    assert(ui.w.document.querySelector(".artifact-list"));
  } finally {
    ui.dom.window.close();
  }
});
test("busy composer submits to queue and exposes explicit next-turn priority", () => {
  const ui = setup({ busy: true });
  try {
    input(ui, "next instruction");
    ui.w.document.querySelector('[data-action="send"]').click();
    assert(
      ui.messages.some(
        (m) => m.type === "send" && m.text === "next instruction",
      ),
    );
    ui.w.document.querySelector('[data-action="steer"]').click();
    assert(ui.messages.some((m) => m.type === "steer"));
    assert.match(
      ui.w.document.querySelector('[data-action="steer"]').title,
      /lượt kế tiếp/,
    );
  } finally {
    ui.dom.window.close();
  }
});
test("microphone starts only on click and never submits text", () => {
  const ui = setup();
  try {
    assert(!ui.messages.some((m) => m.type === "voiceToggle"));
    ui.w.document.querySelector('[data-action="voiceToggle"]').click();
    assert(ui.messages.some((m) => m.type === "voiceToggle"));
    assert(!ui.messages.some((m) => m.type === "send"));
  } finally {
    ui.dom.window.close();
  }
});
test("activity output is escaped, collapsible and updates without losing expansion", () => {
  const ui = setup();
  try {
    const event = (value) =>
      ui.w.dispatchEvent(
        new ui.w.MessageEvent("message", {
          data: {
            type: "event",
            conversationId: "conversation",
            event: { type: "CUSTOM", name: "nopilot.activity", value },
          },
        }),
      );
    event({
      id: "a",
      title: "CMD",
      status: "running",
      output: "<script>bad()</script>",
    });
    let card = ui.w.document.querySelector('[data-activity="a"]');
    assert(card);
    assert(!card.open);
    assert.equal(card.querySelector("script"), null);
    card.open = true;
    card.dispatchEvent(new ui.w.Event("toggle"));
    event({
      id: "a",
      title: "CMD",
      status: "completed",
      output: "PASS",
      exitCode: 0,
    });
    card = ui.w.document.querySelector('[data-activity="a"]');
    assert(card.open);
    assert.match(card.textContent, /PASS/);
  } finally {
    ui.dom.window.close();
  }
});
