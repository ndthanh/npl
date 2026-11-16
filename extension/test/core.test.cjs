const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  safeRelative,
  validateChangeset,
  matcher,
  sha,
  parseContract,
  validateRun,
  localDelete,
  scanFiles,
} = require("../dist/core.js");
test("contract fences support longer backticks/tildes and embedded Markdown source without truncating JSON", () => {
  const contract = {
    type: "change_set",
    baseContextId: "current",
    edits: [
      {
        path: "README.md",
        baseSha256: null,
        content: "# Run\n```cmd\npython main.py\n```\n",
      },
    ],
  };
  for (const fence of ["```", "````", "~~~~", "`````"]) {
    assert.deepEqual(
      parseContract(
        fence + "json\n" + JSON.stringify(contract, null, 2) + "\n" + fence,
      ),
      contract,
    );
  }
  assert.deepEqual(
    parseContract("```JSON\r\n" + JSON.stringify(contract) + "\r\n````"),
    contract,
  );
  assert.equal(
    parseContract("````json\n" + JSON.stringify(contract) + "\n```"),
    undefined,
  );
});
test("contract parser does not promote nested JSON examples from a different-language or quoted fence", () => {
  const body = '```json\n{"type":"run_plan","commands":[]}\n```';
  assert.equal(parseContract("````markdown\n" + body + "\n````"), undefined);
  assert.equal(
    parseContract('> ```json\n> {"type":"run_plan"}\n> ```'),
    undefined,
  );
  assert.equal(parseContract("```python\n" + body + "\n```"), undefined);
});
test("Windows traversal, ADS, aliases and reserved paths are rejected", () => {
  for (const bad of [
    "../secret",
    "C:/a",
    "a\\b",
    "/root",
    "a/../b",
    "a//b",
    "NUL.txt",
    "a./x",
    "ok/file:stream",
  ])
    assert.throws(() => safeRelative(bad), bad);
  assert.equal(safeRelative("src/main.py"), "src/main.py");
});
test("ignore protects runtime/secrets even after negation, honors gitignore patterns", () => {
  const ig = matcher("cache/\n*.log\n!keep.log\n!.env\n!.git/\n");
  assert(ig.ignores(".env"));
  assert(ig.ignores(".git/config"));
  assert(ig.ignores("cache/a.py"));
  assert(ig.ignores("x.log"));
  assert(!ig.ignores("keep.log"));
});
test("changesets reject stale bases, case aliases, ignored output and missing delete base", () => {
  const allowed = new Map([["main.py", sha("old")]]),
    ig = matcher(),
    edit = { path: "main.py", baseSha256: sha("old"), content: "new" };
  const cs = { type: "change_set", baseContextId: "ctx", edits: [edit] };
  assert.equal(validateChangeset(cs, "ctx", allowed, ig), cs);
  assert.throws(() => validateChangeset(cs, "other", allowed, ig));
  for (const edits of [
    [{ ...edit, baseSha256: sha("changed") }],
    [edit, { ...edit, path: "MAIN.py" }],
    [{ path: ".env", baseSha256: null, content: "secret" }],
    [{ path: "missing.py", baseSha256: null, content: null }],
  ])
    assert.throws(() =>
      validateChangeset({ ...cs, edits }, "ctx", allowed, ig),
    );
});
test("normal prose/code never becomes executable; typed fenced JSON does", () => {
  assert.equal(parseContract("Run this:\n```python\nprint(1)\n```"), undefined);
  assert.equal(
    parseContract('```json\n{"type":"tool_request","id":"x"}\n```').id,
    "x",
  );
});
test("run plan uses argv without shell and bounds time/cwd", () => {
  assert.deepEqual(
    validateRun({
      program: "python",
      args: ["main.py", "a & b"],
      cwd: ".",
      timeout: 30,
    }),
    { program: "python", args: ["main.py", "a & b"], cwd: ".", timeout: 30 },
  );
  for (const raw of [
    { program: "cmd.exe", args: ["/c", "echo hi"] },
    { program: "powershell", args: [] },
    { program: "python", args: [], cwd: "../other" },
    { program: "python", args: [], timeout: 999 },
  ])
    assert.throws(() => validateRun(raw));
});
test("local deletion preserves transcript, artifacts and service mapping", () => {
  const row = {
    id: "a",
    messages: ["hello"],
    teamsId: "service",
    artifacts: ["file"],
  };
  const result = localDelete([row], "a")[0];
  assert(result.deletedAt);
  assert.equal(result.teamsId, "service");
  assert.deepEqual(result.messages, ["hello"]);
  assert(!row.deletedAt);
});
test("CMD contract executes quoted paths and UTF-8, rejecting other shell choices", async () => {
  const { spawn } = require("node:child_process");
  const command = validateRun({
    shell: "cmd",
    command: 'echo Xin chào && echo "a b"',
    cwd: ".",
    timeout: 10,
  });
  const output = await new Promise((resolve, reject) => {
    let out = "";
    const p = spawn(command.program, command.args, {
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    p.stdout.on("data", (s) => (out += s.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(Error("exit " + code)),
    );
  });
  assert.match(output, /Xin chào/);
  assert.match(output, /a b/);
  for (const shell of ["powershell", "pwsh", "bash"])
    assert.throws(() => validateRun({ shell, command: "echo hi" }));
  assert.throws(() =>
    validateRun({ shell: "cmd", command: "powershell -c echo hi" }),
  );
});
test("context scan prunes ignored dependency trees before applying file limit", async () => {
  const fs = require("node:fs/promises"),
    os = require("node:os"),
    path = require("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nopilot-scan-"));
  try {
    await fs.mkdir(path.join(dir, "node_modules"));
    for (let i = 0; i < 5; i++)
      await fs.writeFile(
        path.join(dir, "node_modules", i + ".js"),
        "dependency",
      );
    await fs.writeFile(path.join(dir, "main.py"), "source");
    assert.equal((await scanFiles(dir, dir, matcher(), 1)).length, 1);
    await fs.writeFile(path.join(dir, "check.py"), "test");
    await assert.rejects(() => scanFiles(dir, dir, matcher(), 1), /exceeds/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
