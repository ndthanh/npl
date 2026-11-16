const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { JSDOM } = require("jsdom");
const source = fs.readFileSync(
  path.join(__dirname, "../bridge/copilot_controls.js"),
  "utf8",
);
test("manual stop requires the status text and Regenerate on the same turn", () => {
  const dom = new JSDOM(`<div id="stopped"><div role="status">OK, I've stopped generating the response.</div><button>Regenerate</button></div>
    <div id="quoted"><div data-testid="chatQuestion"><p>OK, I've stopped generating the response.</p></div><button>Regenerate</button></div>
    <div id="normal"><p>Normal answer</p><button>Regenerate</button></div>`, { runScripts: "outside-only" });
  try {
    const controls = dom.window.eval(source);
    for (const [id, expected] of [["stopped",true], ["quoted",false], ["normal",false]])
      assert.equal(controls.stopped(dom.window.document.getElementById(id)), expected);
  } finally {
    dom.window.close();
  }
});
test("attachment removal checks the composer snapshot and route before clicking", () => {
  const dom = new JSDOM('<div id="chat-input-wrapper"><button aria-label="Remove attachment draft.pdf"></button></div><div data-testid="markdown-reply"><button aria-label="Remove attachment old.pdf"></button></div>', {
    url: "https://example.test/chat", runScripts: "outside-only",
  });
  try {
    const controls = dom.window.eval(source);
    let clicks = 0;
    dom.window.document.querySelector("#chat-input-wrapper button").onclick = () => clicks++;
    assert.deepEqual(Array.from(controls.attachmentNames()), ["draft.pdf"]);
    assert.equal(controls.removeAttachment("/another", ["draft.pdf"]), false);
    assert.equal(controls.removeAttachment("/chat", ["other.pdf"]), false);
    assert.equal(clicks, 0);
    assert.equal(controls.removeAttachment("/chat", ["draft.pdf"]), true);
    assert.equal(clicks, 1);
  } finally {
    dom.window.close();
  }
});
test("background Copilot detects Stop and Oops/Try again without treating quoted code as service errors", () => {
  const dom = new JSDOM(
    `<body style="display:none"><div id="turn"><div><span>Oops! Something happened. Can you try again?</span><button>Try again</button></div></div><button aria-label="Stop responding">Stop</button><div id="quote"><div data-testid="markdown-reply">Oops! Something happened. Can you try again?<pre><code>Try again</code></pre></div><button>Try again</button></div></body>`,
    { runScripts: "outside-only" },
  );
  try {
    const controls = dom.window.eval(source);
    assert.equal(controls.stopButtons().length, 1);
    assert(
      controls.failure(dom.window.document.querySelector("#turn"))
        .retryAvailable,
    );
    assert.equal(
      controls.failure(dom.window.document.querySelector("#quote")),
      null,
    );
  } finally {
    dom.window.close();
  }
});
test("the exact embedded Stop expression clicks only the latest matching turn and rejects ambiguous controls", () => {
  const dom = new JSDOM(
    '<div data-testid="m365-chat-llm-web-ui-chat-message"><div data-testid="chatQuestion"><div data-testid="chatOutput">test</div></div></div><button aria-label="Stop generating response">Stop</button>',
    { runScripts: "outside-only" },
  );
  try {
    const question = dom.window.document.querySelector(
      '[data-testid="chatOutput"]',
    );
    Object.defineProperty(question, "innerText", {
      get: () => question.textContent,
    });
    let clicked = 0;
    dom.window.document.querySelector("button").onclick = () => clicked++;
    const expression = "(" + source.trim().replace(/;$/, "") + ").stop";
    assert(dom.window.eval(expression + '("other")').error);
    assert.equal(clicked, 0);
    assert(dom.window.eval(expression + '("test")').clicked);
    assert.equal(clicked, 1);
    dom.window.document.body.insertAdjacentHTML(
      "beforeend",
      '<button aria-label="Stop responding">Stop</button>',
    );
    assert(dom.window.eval(expression + '("test")').error);
    assert.equal(clicked, 1);
  } finally {
    dom.window.close();
  }
});
