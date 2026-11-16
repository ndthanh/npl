import path from "node:path";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import ignore from "ignore";

export const sha = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
export const id = () => randomUUID();
export const DEFAULT_IGNORE = [
  ".git/",
  ".vscode/",
  ".venv/",
  "venv/",
  "node_modules/",
  "__pycache__/",
  "dist/",
  "build/",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.gguf",
  "screenshots/",
  "artifacts/",
];
export const matcher = (text = "") => ignore().add(text).add(DEFAULT_IGNORE);
export async function scanFiles(
  root: string,
  scope: string,
  ig: ReturnType<typeof matcher>,
  maximum = Infinity,
) {
  const diff = path.relative(root, scope);
  if (
    diff === ".." ||
    diff.startsWith(".." + path.sep) ||
    path.isAbsolute(diff)
  )
    throw Error("Context scope leaves workspace");
  const result: string[] = [];
  async function walk(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name),
        rel = path.relative(root, full).split(path.sep).join("/");
      if (
        ig.ignores(rel) ||
        ((entry.isDirectory() || entry.isSymbolicLink()) &&
          ig.ignores(rel + "/"))
      )
        continue;
      if (entry.isSymbolicLink())
        throw Error("Exclude symlink from context: " + rel);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        result.push(full);
        if (result.length > maximum)
          throw Error(
            "Context exceeds " +
              maximum +
              " files after applying .nopilotignore",
          );
      }
    }
  }
  await walk(scope);
  return result;
}
export function safeRelative(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    value.split("/").some((x) => !x || x === "." || x === "..")
  )
    throw Error("Invalid workspace-relative path");
  if (
    value
      .split("/")
      .some(
        (x) =>
          /[. ]$/.test(x) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x),
      )
  )
    throw Error("Reserved Windows path");
  return value;
}
export interface Edit {
  path: string;
  baseSha256: string | null;
  content: string | null;
}
export interface ChangeSet {
  type: "change_set";
  baseContextId: string;
  edits: Edit[];
  commitMessage?: string;
}
export function parseContract(text: string): any {
  const fence: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(lines[i]);
    if (!open) continue;
    const closing = new RegExp(
      "^ {0,3}" + open[1][0] + "{" + open[1].length + ",}[ \\t]*$",
    );
    const body: string[] = [];
    let closed = false;
    while (++i < lines.length) {
      if (closing.test(lines[i])) {
        closed = true;
        break;
      }
      body.push(lines[i]);
    }
    // Consume every complete fence, including other languages, so a quoted
    // JSON example nested inside a Python/Markdown block is never promoted.
    if (closed && ["", "json"].includes(open[2].trim().toLowerCase()))
      fence.push(body.join("\n"));
  }
  for (const candidate of [text.trim(), ...fence]) {
    try {
      const obj = JSON.parse(candidate);
      if (["change_set", "tool_request", "run_plan"].includes(obj?.type))
        return obj;
    } catch {}
  }
  return undefined;
}
export function validateChangeset(
  raw: any,
  contextId: string,
  allowed: Map<string, string | null>,
  ig: ReturnType<typeof matcher>,
): ChangeSet {
  if (
    raw?.type !== "change_set" ||
    raw.baseContextId !== contextId ||
    !Array.isArray(raw.edits) ||
    !raw.edits.length ||
    raw.edits.length > 100
  )
    throw Error("Changeset does not match the active context");
  const seen = new Set<string>();
  let total = 0;
  for (const e of raw.edits) {
    const p = safeRelative(e.path),
      key = p.toLowerCase();
    if (
      seen.has(key) ||
      ig.ignores(p) ||
      (!allowed.has(p) && e.baseSha256 !== null)
    )
      throw Error("Duplicate, ignored or unknown base: " + p);
    if (e.baseSha256 !== (allowed.get(p) ?? null))
      throw Error("Base hash mismatch: " + p);
    if (e.content !== null && typeof e.content !== "string")
      throw Error("Edit content must be a string or null (delete)");
    if (e.content === null && !allowed.has(p))
      throw Error("Cannot delete a file absent from context");
    total += Buffer.byteLength(e.content ?? "");
    seen.add(key);
  }
  return raw;
}
export function validateRun(raw: any): {
  program: string;
  args: string[];
  cwd: string;
  timeout: number;
  shell?: "cmd";
  command?: string;
} {
  if (raw?.shell !== undefined) {
    if (
      raw.shell !== "cmd" ||
      typeof raw.command !== "string" ||
      !raw.command.trim() ||
      raw.command.length > 6000 ||
      /[\0\r\n]/.test(raw.command)
    )
      throw Error("Chỉ hỗ trợ shell cmd với một command tối đa 6.000 ký tự.");
    if (/\b(?:powershell|pwsh)(?:\.exe)?\b/i.test(raw.command))
      throw Error("PowerShell không được hỗ trợ.");
    const cwd = raw.cwd === "." ? "." : safeRelative(raw.cwd ?? "."),
      timeout = raw.timeout ?? 120;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600)
      throw Error("Timeout must be 1–600 seconds");
    const processor = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "cmd.exe",
    );
    return {
      program: processor,
      args: [
        "/d",
        "/s",
        "/c",
        '"chcp 65001>nul & cmd.exe /d /s /c "' + raw.command + '""',
      ],
      cwd,
      timeout,
      shell: "cmd",
      command: raw.command,
    };
  }
  if (
    typeof raw?.program !== "string" ||
    !raw.program ||
    raw.program.length > 500 ||
    !Array.isArray(raw.args) ||
    raw.args.some((a: any) => typeof a !== "string") ||
    raw.args.length > 100
  )
    throw Error("Invalid program/args");
  if (/(?:^|[\\/])(powershell|pwsh|cmd|bash|sh)(?:\.exe)?$/i.test(raw.program))
    throw Error("Shell execution is not supported; use an executable and argv");
  const cwd = raw.cwd === "." ? "." : safeRelative(raw.cwd ?? ".");
  const timeout = raw.timeout ?? 120;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600)
    throw Error("Timeout must be 1–600 seconds");
  return { program: raw.program, args: raw.args, cwd, timeout };
}
export function localDelete<T extends { id: string; deletedAt?: string }>(
  rows: T[],
  target: string,
): T[] {
  return rows.map((row) =>
    row.id === target ? { ...row, deletedAt: new Date().toISOString() } : row,
  );
}
