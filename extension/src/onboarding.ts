import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_IGNORE } from "./core";
import { checked } from "./archive";
export async function ensureIgnore(root: string) {
  if (!root) throw Error("Mở folder project trước.");
  const file = await checked(root, ".nopilotignore");
  const template =
    "# Nopilot source context — gitignore syntax\n# Defaults below are always protected by Nopilot.\n" +
    DEFAULT_IGNORE.join("\n") +
    "\n\n# Add project-specific exclusions below.\n# .next/\n# coverage/\n# logs/\n# *.log\n";
  let created = false;
  try {
    await fs.writeFile(file, template, { flag: "wx" });
    created = true;
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
  }
  return { path: file, created };
}
export function setupPlan(
  bootstrap: string,
  storage: string,
  extension: string,
  exists: boolean,
  voice = false,
  wheelhouse?: string,
) {
  const runtime = path.join(storage, "runtime"),
    python = path.join(runtime, "Scripts", "python.exe");
  const commands: any[] = [];
  if (!exists)
    commands.push({
      program: bootstrap,
      args: ["-m", "venv", runtime],
      cwd: ".",
      timeout: 120,
    });
  const args = [
    "-m",
    "pip",
    "install",
    ...(wheelhouse ? ["--no-index", "--find-links", wheelhouse] : []),
    "-r",
    path.join(extension, "bridge", "requirements.txt"),
    "-r",
    path.join(extension, "bridge", "requirements-data.txt"),
  ];
  if (voice)
    args.push("-r", path.join(extension, "bridge", "requirements-voice.txt"));
  commands.push({ program: python, args, cwd: ".", timeout: 600 });
  return { commands, activatePython: python, runtime, voice };
}

export function localModelSetupPlan(
  bootstrap: string,
  localAppData: string,
  extension: string,
  exists: boolean,
  wheelhouse?: string,
) {
  const runtime = path.join(localAppData, "Nopilot", "llm"),
    python = path.join(runtime, "Scripts", "python.exe"),
    scratch = path.join(runtime, "tmp");
  return {
    activateLocalPython: python,
    scratch,
    commands: [
      ...(exists ? [] : [
        { program: bootstrap, args: ["-m", "venv", runtime], cwd: ".", timeout: 120 },
      ]),
      {
        program: python,
        args: ["-m", "pip", ...(wheelhouse ? ["--isolated"] : []), "install", "--no-cache-dir",
          ...(wheelhouse
            ? ["--no-index", "--find-links", wheelhouse, "--only-binary=:all:", "llama-cpp-python==0.3.36"]
            : ["-r", path.join(extension, "bridge", "requirements-local-model.txt")])],
        cwd: ".",
        timeout: 600,
      },
      {
        program: python,
        args: ["-I", "-c", "from llama_cpp import Llama; print('GGUF runtime ready')"],
        cwd: ".",
        timeout: 30,
      },
    ],
  };
}
