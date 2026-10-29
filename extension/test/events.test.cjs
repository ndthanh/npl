const { test } = require("node:test");
const assert = require("node:assert/strict");
const { protocolEvent } = require("../dist/events.js");
test("emitted event families validate against the actual AG-UI schema", () => {
  const samples = [
    ["RUN_STARTED", { threadId: "thread", runId: "run" }],
    ["RUN_FINISHED", { threadId: "thread", runId: "run" }],
    ["RUN_ERROR", { message: "error" }],
    ["TEXT_MESSAGE_START", { messageId: "message", role: "assistant" }],
    ["TEXT_MESSAGE_CONTENT", { messageId: "message", delta: "Hello" }],
    ["TEXT_MESSAGE_END", { messageId: "message" }],
    ["TOOL_CALL_START", { toolCallId: "tool", toolCallName: "web.read" }],
    ["TOOL_CALL_ARGS", { toolCallId: "tool", delta: "{}" }],
    ["TOOL_CALL_END", { toolCallId: "tool" }],
    [
      "TOOL_CALL_RESULT",
      { toolCallId: "tool", messageId: "result", role: "tool", content: "{}" },
    ],
    ["STATE_SNAPSHOT", { snapshot: { busy: false } }],
    ["CUSTOM", { name: "nopilot.status", value: { text: "waiting" } }],
  ];
  for (const [type, extra] of samples)
    assert.equal(protocolEvent(type, extra).type, type);
});
test("invalid tool/text events cannot be emitted as valid protocol", () => {
  assert.throws(() => protocolEvent("TOOL_CALL_RESULT", {}));
  assert.throws(() =>
    protocolEvent("TEXT_MESSAGE_CONTENT", { messageId: "x" }),
  );
});
