const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  Module = require("node:module"),
  path = require("node:path");
let release,
  updates = 0;
const original = Module._load;
Module._load = function (name, ...args) {
  return name === "vscode"
    ? {
        workspace: {
          getConfiguration: () => ({
            get: (k, d) => d,
            update: async () => {
              if (++updates === 1) await new Promise((r) => (release = r));
            },
          }),
        },
        ConfigurationTarget: { Global: 1 },
      }
    : original.call(this, name, ...args);
};
const { LocalModelPanel } = require("../dist/local-model-panel-test.js");
test("Stop during async settings save cannot respawn a model after cancellation", async () => {
  let loads = 0,
    stops = 0;
  const client = {
    state: { status: "unloaded" },
    stop() {
      stops++;
      this.state.status = "unloaded";
    },
    async load() {
      loads++;
    },
  };
  const panel = new LocalModelPanel({}, client, () => {});
  const loading = panel.handle({
    type: "load",
    config: {
      pythonPath: "python",
      modelPath: path.resolve("model.gguf"),
      contextSize: 8192,
      threads: 4,
      gpuLayers: 0,
      maxSteps: 10,
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(typeof release, "function");
  await panel.handle({ type: "stop" });
  release();
  await loading;
  assert.equal(loads, 0);
  assert(stops >= 2);
  assert.equal(panel.busy, false);
});
