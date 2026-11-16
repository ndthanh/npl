const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const choose = vm.runInNewContext(
  fs.readFileSync(
    path.join(__dirname, "../bridge/ui_thread_selector.js"),
    "utf8",
  ),
);
test("Teams UI thread selection works with a hidden main window and ignores a visible notification thread", () => {
  assert.equal(
    choose([
      { tid: 1, visible: false, className: "Chrome_WidgetWin_1" },
      { tid: 2, visible: true, className: "Notification" },
    ]),
    1,
  );
  assert.equal(
    choose([
      { tid: 3, visible: false, className: "WinUI" },
      { tid: 3, visible: false, className: "Other" },
    ]),
    3,
  );
  assert.equal(choose([{ tid: 4, visible: true, className: "Main" }]), 4);
});
test("missing or ambiguous tray windows require restoring Teams rather than guessing a thread", () => {
  assert.throws(() => choose([]), /system tray/);
  assert.throws(
    () =>
      choose([
        { tid: 1, visible: false, className: "Chrome_WidgetWin_1" },
        { tid: 2, visible: false, className: "Chrome_WidgetWin_1" },
      ]),
    /duy nhất/,
  );
});
test("Frida agent template with the hidden-window selector embeds as valid JavaScript", () => {
  const agent = fs
    .readFileSync(path.join(__dirname, "../bridge/agent.js"), "utf8")
    .replace("__CONFIG__", "{}")
    .replace(
      "__THREAD_SELECTOR__",
      fs
        .readFileSync(
          path.join(__dirname, "../bridge/ui_thread_selector.js"),
          "utf8",
        )
        .trim()
        .replace(/;$/, ""),
    );
  assert(!agent.includes("__THREAD_SELECTOR__"));
  assert.doesNotThrow(() => new vm.Script(agent));
});
