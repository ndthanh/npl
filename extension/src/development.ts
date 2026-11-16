import fs from "node:fs/promises";
import path from "node:path";
import { sha, safeRelative, validateRun } from "./core";
export type DevelopmentTask = "start" | "check" | "startAndCheck";
export type DevelopmentPlan = {
  task: DevelopmentTask;
  commands: ReturnType<typeof validateRun>[];
  cacheKey: string;
  signature: string;
  inputs: Record<string, string>;
};
export async function developmentPlan(options: {
  root: string;
  python: string;
  task: DevelopmentTask;
  overlay: Map<string, Buffer | null>;
  cachedDependencies?: string;
  checkPath: (name: string) => Promise<string>;
}): Promise<DevelopmentPlan> {
  const { root, python, task, overlay } = options,
    inputs: Record<string, string> = {};
  const read = async (name: string) => {
    safeRelative(name);
    const bytes = overlay.has(name)
      ? overlay.get(name)
      : await fs.readFile(await options.checkPath(name));
    if (bytes === null || bytes === undefined)
      throw Error("Kế hoạch cần file không được áp dụng: " + name);
    inputs[name] = sha(bytes);
    return bytes;
  };
  const raw = JSON.parse((await read("nopilot.json")).toString("utf8"));
  if (
    raw.schemaVersion !== 1 ||
    raw.runtime !== "python" ||
    typeof raw.name !== "string"
  )
    throw Error(
      "Cần nopilot.json schemaVersion 1, runtime python để chạy thử.",
    );
  const env = path.join(root, ".venv", "Scripts", "python.exe");
  let exists = false,
    identity = python;
  try {
    const stat = await fs.stat(env);
    exists = stat.isFile();
    identity += ":" + stat.size + ":" + stat.mtimeMs;
  } catch {}
  const commands: any[] = [];
  let cacheKey = "";
  if (!exists)
    commands.push({
      program: python,
      args: ["-m", "venv", ".venv"],
      cwd: ".",
      timeout: 120,
    });
  if (raw.install !== null && raw.install !== undefined) {
    if (raw.install.requirements !== "requirements.txt")
      throw Error("Contract install chỉ hỗ trợ requirements.txt.");
    const requirements = (await read("requirements.txt")).toString("utf8");
    cacheKey = sha(requirements + "\n" + identity);
    if (
      !exists ||
      options.cachedDependencies !== cacheKey ||
      /^\s*(?:-r|--requirement|-e|--editable)|file:/m.test(requirements)
    )
      commands.push({
        program: env,
        args: ["-m", "pip", "install", "-r", "requirements.txt"],
        cwd: ".",
        timeout: raw.install.timeoutSeconds ?? 600,
      });
  }
  for (const name of task === "startAndCheck" ? ["start", "check"] : [task]) {
    const t = raw.tasks?.[name];
    if (
      !t ||
      !Array.isArray(t.args) ||
      typeof t.entrypoint !== "string" ||
      !t.entrypoint.endsWith(".py")
    )
      throw Error("Contract thiếu task " + name);
    await read(t.entrypoint);
    commands.push({
      program: env,
      args: [t.entrypoint, ...t.args],
      cwd: ".",
      timeout: t.timeoutSeconds ?? 120,
    });
  }
  const validated = commands.map(validateRun);
  return {
    task,
    commands: validated,
    cacheKey,
    inputs,
    signature: sha(
      JSON.stringify({ task, commands: validated, cacheKey, inputs }),
    ),
  };
}
