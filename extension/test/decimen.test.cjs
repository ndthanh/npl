const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const {
  wireFrame,
  zipContainer,
  DecimenSender,
  composition,
  fnv,
} = require("../dist/decimen-test.js");
const { workspaceZip } = require("../dist/workspace-zip-test.js"),
  { matcher } = require("../dist/core.js");
test("Decimen v3 canonical frame matches published golden bytes", () => {
  const actual = wireFrame(
    {
      sessionId: 0xbeef,
      seq: 0x01020304,
      k: 0x111,
      blockLen: 6,
      totalLen: 0xfedcba,
      payloadFnv: 0x89abcdef,
    },
    new Uint8Array([1, 2, 3, 4, 5, 6]),
  );
  assert.equal(
    Buffer.from(actual).toString("hex"),
    "d1c30300efbe0403020111010600badcfe00efcdab89010203040506",
  );
});
test("ZIP container preserves filename, MIME, bytes and SHA-256 without redundant gzip", async () => {
  const bytes = crypto.randomBytes(1000),
    container = await zipContainer("test-việt.zip", bytes),
    view = new DataView(container.buffer);
  assert.equal(
    Buffer.from(container.slice(0, 5)).toString("hex"),
    "4443463200",
  );
  assert.equal(view.getUint32(9, true), bytes.length);
  assert.equal(view.getUint32(13, true), bytes.length);
  assert.deepEqual(
    Buffer.from(container.slice(17, 49)),
    crypto.createHash("sha256").update(bytes).digest(),
  );
  assert.equal(
    new TextDecoder().decode(container.slice(49, 49 + view.getUint16(5, true))),
    "test-việt.zip",
  );
  assert.deepEqual(Buffer.from(container.slice(-1000)), bytes);
  await assert.rejects(
    () => zipContainer("large.zip", new Uint8Array(64 * 1024 * 1024 + 1)),
    /64 MiB/,
  );
});
test("systematic carousel continues across cycles; repair subsets are deterministic and unique", () => {
  for (const k of [1, 2, 7, 200]) {
    for (let i = 0; i < k; i++)
      assert.deepEqual(composition(k, 0xbeef, i), [i]);
    for (let i = k; i < 2 * k; i++) {
      const indices = composition(k, 0xbeef, i);
      assert.equal(indices.length, new Set(indices).size);
      assert(indices.every((index) => index >= 0 && index < k));
      assert.deepEqual(indices, composition(k, 0xbeef, i));
    }
    assert.deepEqual(composition(k, 0xbeef, 2 * k), [0]);
  }
  const s = new DecimenSender(new Uint8Array(10000), 7);
  assert.equal(s.frame(0).length, s.blockLen + 22);
  assert.equal(fnv(s.container), s.checksum);
});
test("workspace export includes all allowed files, handles binary and Unicode, and detects mid-export changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "np-dec-"));
  try {
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "Việt.py"), 'print("xin chào")');
    await fs.writeFile(path.join(root, "image.bin"), Buffer.from([0, 255, 1]));
    await fs.writeFile(path.join(root, ".nopilotignore"), "excluded.txt\n");
    await fs.writeFile(path.join(root, "excluded.txt"), "never export");
    await fs.writeFile(path.join(root, ".env"), "secret");
    await fs.mkdir(path.join(root, ".venv"));
    await fs.writeFile(path.join(root, ".venv", "runtime"), "never export");
    const rules = matcher("excluded.txt\n");
    const result = await workspaceZip(root, rules, async () => {});
    assert.deepEqual(result.files, [
      ".nopilotignore",
      "image.bin",
      "src/Việt.py",
    ]);
    assert.equal(result.bytes.slice(0, 2).toString(), "PK");
    assert.equal(
      result.sha256,
      crypto.createHash("sha256").update(result.bytes).digest("hex"),
    );
    let count = 0;
    await assert.rejects(
      () =>
        workspaceZip(root, rules, async () => {
          if (++count === 2)
            await fs.writeFile(path.join(root, "image.bin"), "changed");
        }),
      /Workspace đổi/,
    );
    await assert.rejects(
      () =>
        workspaceZip(
          root,
          rules,
          async () => {},
          () => true,
        ),
      /Đã đóng/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
