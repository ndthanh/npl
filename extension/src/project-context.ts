import fs from "node:fs/promises";
import path from "node:path";
import { matcher, safeRelative } from "./core";

export type ProjectEntry = {
  path: string;
  directory: boolean;
  bytes: number;
  blocked?: boolean;
  reason?: string;
};
export type ProjectPicker = {
  revision: string;
  conversationId: string;
  root: string;
  entries: ProjectEntry[];
  selection?: string[];
};

// Do not descend into ignored directories, or follow links, just to display
// excluded entries. Listing a venv/node_modules should stay cheap.
export async function projectEntries(
  root: string,
  ig: ReturnType<typeof matcher>,
) {
  const entries: ProjectEntry[] = [];
  async function walk(folder: string) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      safeRelative(relative);
      const directory = entry.isDirectory();
      const blocked =
        entry.isSymbolicLink() ||
        ig.ignores(relative) ||
        (directory && ig.ignores(relative + "/"));
      entries.push({
        path: relative,
        directory,
        bytes: directory || blocked ? 0 : (await fs.stat(full)).size,
        blocked,
        reason: blocked
          ? entry.isSymbolicLink()
            ? "Không theo symbolic link; loại trừ link trong .nopilotignore."
            : "Loại bởi .nopilotignore hoặc quy tắc bảo vệ mặc định."
          : undefined,
      });
      if (directory && !blocked) await walk(full);
    }
  }
  await walk(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function selectedProjectPaths(
  snapshot: Record<string, string>,
  selection?: string[],
) {
  if (selection === undefined) return Object.keys(snapshot);
  const chosen = new Set(selection.map(safeRelative));
  // Fresh snapshot is authoritative: removed/ignored files never get sent.
  return Object.keys(snapshot).filter((name) => chosen.has(name));
}

export function validateProjectSelection(
  entries: ProjectEntry[],
  raw: unknown,
) {
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== "string"))
    throw Error("Danh sách file không hợp lệ.");
  const allowed = new Set(
    entries.filter((e) => !e.directory && !e.blocked).map((e) => e.path),
  );
  const selected = [...new Set((raw as string[]).map(safeRelative))].sort();
  for (const name of selected)
    if (!allowed.has(name))
      throw Error(
        "File đã đổi, bị ignore hoặc không thuộc project: " +
          name +
          ". Hãy làm mới cây thư mục.",
      );
  return selected;
}
