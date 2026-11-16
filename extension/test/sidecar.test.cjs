const { test } = require("node:test"),
  assert = require("node:assert/strict");
const Module = require("node:module"),
  { EventEmitter } = require("node:events"),
  { PassThrough } = require("node:stream");
const original = Module._load;
let child;
Module._load = function (name, ...args) {
  if (name === "node:child_process")
    return {
      spawn() {
        child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdin = new PassThrough();
        return child;
      },
    };
  return original.call(this, name, ...args);
};
const { Sidecar } = require("../dist/sidecar-test.js");
Module._load = original;
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("sidecar progress does not settle the RPC; final result settles it exactly once", async () => {
  const sidecar = new Sidecar(
    "unused",
    () => "python",
    () => {},
  );
  const events = [];
  const pending = sidecar.call("connect", {}, (value) => events.push(value));
  const id = [...sidecar.pending.keys()][0];
  child.stdout.write(
    JSON.stringify({
      id,
      type: "progress",
      value: { stage: "retrying", attempt: 2 },
    }) + "\n",
  );
  await flush();
  assert.equal(events.length, 1);
  assert.equal(sidecar.pending.size, 1);
  child.stdout.write(
    JSON.stringify({ id, result: { connected: true, editorPresent: true } }) +
      "\n",
  );
  assert((await pending).connected);
  assert.equal(sidecar.pending.size, 0);
  sidecar.dispose();
});
test("recovery RPC budget includes history navigation as well as response observation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sidecar = new Sidecar(
    "unused",
    () => "python",
    () => {},
  );
  const request = sidecar.call("recover", { timeout: 30 });
  const id = [...sidecar.pending.keys()][0];
  t.mock.timers.tick(45000);
  assert.equal(sidecar.pending.size, 1);
  child.stdout.write(
    JSON.stringify({ id, result: { completion: "completed" } }) + "\n",
  );
  assert.equal((await request).completion, "completed");
  sidecar.dispose();
});
test("connect watchdog releases UI but prevents another attach until the old RPC settles", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sidecar = new Sidecar(
    "unused",
    () => "python",
    () => {},
  );
  const pending = sidecar.call("connect");
  const id = [...sidecar.pending.keys()][0];
  const failed = assert.rejects(pending, /unconfirmed/);
  t.mock.timers.tick(105000);
  await failed;
  await assert.rejects(sidecar.call("connect"), /không attach chồng/);
  child.stdout.write(
    JSON.stringify({ id, type: "progress", value: { stage: "finding" } }) +
      "\n",
  );
  await flush();
  await assert.rejects(sidecar.call("connect"), /không attach chồng/);
  child.stdout.write(
    JSON.stringify({ id, result: { connected: true } }) + "\n",
  );
  await flush();
  const next = sidecar.call("connect");
  const nextId = [...sidecar.pending.keys()][0];
  child.stdout.write(
    JSON.stringify({ id: nextId, result: { connected: true } }) + "\n",
  );
  assert((await next).connected);
  sidecar.dispose();
});
