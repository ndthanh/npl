const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  queueMessage,
  removeQueued,
  prioritizeQueue,
  queueContextMatches,
  appendOutput,
} = require("../dist/queue.js");
function conversation() {
  return {
    contextId: "ctx",
    mode: "ask",
    tools: false,
    attachments: [{ id: "image" }],
    draft: "draft",
  };
}
test("queue captures attachments, clears only staged draft, and supports FIFO and priority", () => {
  const c = conversation(),
    a = queueMessage(c, "first"),
    b = queueMessage(c, "second");
  assert.deepEqual(a.attachments, [{ id: "image" }]);
  assert.deepEqual(b.attachments, []);
  assert.equal(c.draft, "");
  assert.deepEqual(
    c.queue.map((i) => i.text),
    ["first", "second"],
  );
  prioritizeQueue(c, b.id);
  assert.equal(c.queue[0], b);
  removeQueued(c, a.id);
  assert.equal(c.queue.length, 1);
});
test("queue rejects slash commands and overflow; does not remove a sending message", () => {
  const c = conversation();
  assert.throws(() => queueMessage(c, "/new"));
  for (let i = 0; i < 10; i++) queueMessage(c, "item " + i);
  assert.throws(() => queueMessage(c, "overflow"));
  c.queue[0].status = "sending";
  assert.throws(() => removeQueued(c, c.queue[0].id));
  assert.throws(() => prioritizeQueue(c, c.queue[0].id));
});
test("queued context changes require an explicit refresh", () => {
  const c = conversation(),
    i = queueMessage(c, "fix");
  assert(queueContextMatches(c, i));
  c.contextId = "new";
  assert(!queueContextMatches(c, i));
});
test("large live output is bounded and marked truncated", () => {
  const a = { output: "" };
  appendOutput(a, "123456", 4);
  assert.equal(a.output, "1234");
  assert.equal(a.truncated, true);
  appendOutput(a, "more", 4);
  assert.equal(a.output, "1234");
});
