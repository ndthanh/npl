const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { JSDOM } = require("jsdom"),
  fs = require("node:fs");
const { detectTrigger, suggestions } = require("../dist/autocomplete.js");
const bundle = fs.readFileSync(
  require("node:path").join(__dirname, "../dist/webview.js"),
  "utf8",
);
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
test("autocomplete detects cursor-local @ and / tokens without matching email addresses", () => {
  assert.equal(detectTrigger("mail name@example.com", 21), undefined);
  assert.equal(detectTrigger("Fix @fi", 7).query, "fi");
  assert.equal(suggestions("commands", "up")[0].id, "/upload");
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
