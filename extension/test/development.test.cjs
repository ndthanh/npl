const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { developmentPlan } = require("../dist/development-test.js");
const { sha } = require("../dist/core.js");
test("prospective commands read only selected overlay; cache reuses venv but never hides changed requirements", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "np-dev-plan-"));
  try {
    const contract = {
      schemaVersion: 1,
      name: "plan",
      runtime: "python",
      install: { requirements: "requirements.txt" },
      tasks: {
        start: { entrypoint: "main.py", args: [], timeoutSeconds: 30 },
        check: { entrypoint: "check.py", args: [], timeoutSeconds: 30 },
      },
    };
    await fs.writeFile(
      path.join(root, "nopilot.json"),
      JSON.stringify(contract),
    );
    await fs.writeFile(path.join(root, "main.py"), "old");
    await fs.writeFile(path.join(root, "check.py"), "assert True");
    await fs.writeFile(path.join(root, "requirements.txt"), "example==1");
    const options = {
      root,
      python: "python",
      task: "startAndCheck",
      overlay: new Map([["main.py", Buffer.from("accepted source")]]),
      checkPath: async (name) => path.join(root, name),
    };
    const first = await developmentPlan(options);
    assert(first.commands.some((c) => c.args.includes("venv")));
    assert(first.commands.some((c) => c.args.includes("pip")));
    assert.equal(first.inputs["main.py"], sha("accepted source"));
    assert.equal(await fs.readFile(path.join(root, "main.py"), "utf8"), "old");
    const env = path.join(root, ".venv", "Scripts", "python.exe");
    await fs.mkdir(path.dirname(env), { recursive: true });
    await fs.writeFile(env, "existing runtime");
    const uncached = await developmentPlan(options),
      cached = await developmentPlan({
        ...options,
        cachedDependencies: uncached.cacheKey,
      });
    assert.equal(cached.commands.length, 2);
    assert(
      !cached.commands.some(
        (c) => c.args.includes("pip") || c.args.includes("venv"),
      ),
    );
    const requirements = new Map(options.overlay);
    requirements.set("requirements.txt", Buffer.from("example==2"));
    assert(
      (
        await developmentPlan({
          ...options,
          overlay: requirements,
          cachedDependencies: uncached.cacheKey,
        })
      ).commands.some((c) => c.args.includes("pip")),
    );
    const deleted = new Map(options.overlay);
    deleted.set("main.py", null);
    await assert.rejects(
      () => developmentPlan({ ...options, overlay: deleted }),
      /không được áp dụng/,
    );
    const local = new Map(options.overlay);
    local.set("requirements.txt", Buffer.from("-r other.txt"));
    const localPlan = await developmentPlan({ ...options, overlay: local });
    assert(
      (
        await developmentPlan({
          ...options,
          overlay: local,
          cachedDependencies: localPlan.cacheKey,
        })
      ).commands.some((c) => c.args.includes("pip")),
    );
    const changed = await developmentPlan({
      ...options,
      overlay: new Map([["main.py", Buffer.from("different source")]]),
    });
    assert.notEqual(changed.signature, cached.signature);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
