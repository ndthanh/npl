import fs from "node:fs/promises";
import path from "node:path";
import { safeRelative, scanFiles, matcher } from "./core";
export async function localRead(
  root: string,
  relative: string,
  ig: ReturnType<typeof matcher>,
) {
  safeRelative(relative);
  if (ig.ignores(relative))
    throw Error("File bị loại trừ bởi .nopilotignore hoặc quy tắc mặc định.");
  const base = await fs.realpath(root);
  let target = root;
  for (const part of relative.split("/")) {
    target = path.join(target, part);
    if ((await fs.lstat(target)).isSymbolicLink())
      throw Error("Không đọc symlink/reparse path.");
  }
  const resolved = await fs.realpath(target),
    rel = path.relative(base, resolved);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))
    throw Error("Đường dẫn ra ngoài workspace.");
  const file = await fs.open(resolved, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw Error("Chỉ đọc file thông thường.");
    const buffer = Buffer.alloc(Math.min(stat.size, 32768));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (buffer.subarray(0, bytesRead).includes(0))
      throw Error("Không đọc file nhị phân vào context local.");
    return {
      path: relative,
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: stat.size > bytesRead,
      bytes: stat.size,
    };
  } finally {
    await file.close();
  }
}
export async function localList(root: string, ig: ReturnType<typeof matcher>) {
  const files = await scanFiles(root, root, ig, 10000);
  return {
    paths: files
      .slice(0, 400)
      .map((p) => path.relative(root, p).split(path.sep).join("/")),
    truncated: files.length > 400,
    total: files.length,
  };
}
