import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { id, sha, safeRelative, scanFiles, matcher } from "./core";
import { processResult } from "./process";
type Ignore = ReturnType<typeof matcher>;
export type Snapshot = Record<string, string>;
export type ArchiveEntry = { path: string; base64: string };
// Manual ZIP import never executes delivery metadata or deletion instructions.
export function zipSelection(
  entries: ArchiveEntry[],
  names?: string[],
  includeMetadata = false,
) {
  const first = entries[0]?.path.split("/")[0];
  const prefix =
    first &&
    entries.every((e) => e.path.startsWith(first + "/")) &&
    entries.some(
      (e) =>
        e.path === first + "/nopilot.json" ||
        e.path === first + "/nopilot-delivery.json",
    )
      ? first + "/"
      : "";
  const seen = new Set<string>();
  const normalized = entries
    .map((e) => {
      const name = safeRelative(e.path.slice(prefix.length));
      if (seen.has(name.toLowerCase()))
        throw Error("ZIP có đường dẫn trùng: " + name);
      seen.add(name.toLowerCase());
      return { ...e, path: name };
    })
    .filter((e) => includeMetadata || e.path !== "nopilot-delivery.json");
  if (names && names.some((n) => !normalized.some((e) => e.path === n)))
    throw Error("File không thuộc ZIP.");
  return names ? normalized.filter((e) => names.includes(e.path)) : normalized;
}
export type ArchiveFile = {
  path: string;
  before: string | null;
  after: string | null;
  binary: boolean;
  bytes: number;
};
export type ArchivePlan = {
  id: string;
  root: string;
  directory: string;
  contextId: string;
  files: ArchiveFile[];
  snapshot: Snapshot;
  prefix: string;
  commitMessage: string;
  backup?: { commit: string; ref: string; repository: string };
  state: string;
  error?: string;
};
export async function checked(root: string, name: string) {
  safeRelative(name);
  const full = path.join(root, ...name.split("/"));
  for (let cursor = full; ; cursor = path.dirname(cursor)) {
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink())
        throw Error("Symlink không được hỗ trợ: " + name);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    if (cursor === root) break;
    if (path.dirname(cursor) === cursor) throw Error("Path leaves workspace");
  }
  return full;
}
async function readOrNull(file: string) {
  try {
    return await fs.readFile(file);
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function workspaceSnapshot(
  root: string,
  ig: Ignore,
): Promise<Snapshot> {
  const result: Snapshot = {};
  let size = 0;
  for (const file of await scanFiles(root, root, ig)) {
    const name = path.relative(root, file).split(path.sep).join("/");
    await checked(root, name);
    const bytes = await fs.readFile(file);
    size += bytes.length;
    result[name] = sha(bytes);
  }
  return result;
}
function same(a: Snapshot, b: Snapshot) {
  return (
    JSON.stringify(Object.entries(a).sort()) ===
    JSON.stringify(Object.entries(b).sort())
  );
}
async function save(plan: ArchivePlan) {
  await fs.writeFile(
    path.join(plan.directory, "apply-plan.json"),
    JSON.stringify(plan, null, 2),
  );
}
function isBinary(bytes: Buffer) {
  if (bytes.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}
export async function stageArchive(
  root: string,
  directory: string,
  entries: ArchiveEntry[],
  base: Snapshot,
  ig: Ignore,
  contextId: string,
  stripWrapper = true,
): Promise<ArchivePlan> {
  await fs.mkdir(directory, { recursive: true });
  const first = entries[0]?.path.split("/")[0];
  const prefix =
    stripWrapper &&
    first &&
    entries.every((e) => e.path.startsWith(first + "/")) &&
    entries.some(
      (e) =>
        e.path === first + "/nopilot.json" ||
        e.path === first + "/nopilot-delivery.json",
    )
      ? first + "/"
      : "";
  const normalized = entries.map((e) => ({
    ...e,
    path: e.path.slice(prefix.length),
  }));
  let delivery: any = {};
  const metadata = normalized.find((e) => e.path === "nopilot-delivery.json");
  if (metadata) {
    delivery = JSON.parse(
      Buffer.from(metadata.base64, "base64").toString("utf8"),
    );
    if (delivery.schemaVersion !== 1)
      throw Error("nopilot-delivery.json schemaVersion phải là 1.");
    if (delivery.baseContextId !== contextId)
      throw Error("ZIP baseContextId không khớp lượt yêu cầu.");
    if (delivery.projectRoot && delivery.projectRoot !== ".")
      throw Error("projectRoot phải là . trong ZIP đã chuẩn hóa.");
  }
  if (
    delivery.deletePaths !== undefined &&
    (!Array.isArray(delivery.deletePaths) ||
      delivery.deletePaths.some((p: any) => typeof p !== "string"))
  )
    throw Error("deletePaths phải là danh sách đường dẫn.");
  const plan: ArchivePlan = {
    id: id(),
    root,
    directory,
    contextId,
    files: [],
    snapshot: await workspaceSnapshot(root, ig),
    prefix,
    commitMessage: String(
      delivery.commitMessage || "Update project from Copilot",
    ).slice(0, 2000),
    state: "staged",
  };
  const seen = new Set<string>();
  for (const entry of normalized) {
    const name = safeRelative(entry.path),
      key = name.toLowerCase();
    if (seen.has(key)) throw Error("ZIP có đường dẫn trùng: " + name);
    seen.add(key);
    if (ig.ignores(name) || ig.ignores(name + "/"))
      throw Error("ZIP chứa file được bảo vệ hoặc ignore: " + name);
    const full = await checked(root, name),
      before = await readOrNull(full),
      beforeHash = before === null ? null : sha(before);
    if (beforeHash !== (base[name] ?? null))
      throw Error("Workspace đã đổi sau lúc gửi yêu cầu: " + name);
    const after = Buffer.from(entry.base64, "base64");
    if (sha(after) === beforeHash) continue;
    await fs.mkdir(path.dirname(path.join(directory, "staged", name)), {
      recursive: true,
    });
    await fs.writeFile(path.join(directory, "staged", name), after);
    if (before !== null) {
      await fs.mkdir(path.dirname(path.join(directory, "before", name)), {
        recursive: true,
      });
      await fs.writeFile(path.join(directory, "before", name), before);
    }
    plan.files.push({
      path: name,
      before: beforeHash,
      after: sha(after),
      binary: isBinary(after),
      bytes: after.length,
    });
  }
  for (const value of delivery.deletePaths ?? []) {
    const name = safeRelative(value),
      key = name.toLowerCase();
    if (seen.has(key) || ig.ignores(name) || ig.ignores(name + "/"))
      throw Error("Invalid delete path: " + name);
    seen.add(key);
    const bytes = await readOrNull(await checked(root, name));
    if (bytes === null || sha(bytes) !== base[name])
      throw Error("Delete base đã đổi hoặc không có: " + name);
    await fs.mkdir(path.dirname(path.join(directory, "before", name)), {
      recursive: true,
    });
    await fs.writeFile(path.join(directory, "before", name), bytes);
    plan.files.push({
      path: name,
      before: sha(bytes),
      after: null,
      binary: isBinary(bytes),
      bytes: 0,
    });
  }
  if (!plan.files.length) throw Error("ZIP không có thay đổi cần áp dụng.");
  await save(plan);
  return plan;
}
async function verifyStaging(plan: ArchivePlan) {
  for (const f of plan.files) {
    if (
      f.after !== null &&
      sha(
        await fs.readFile(
          await checked(path.join(plan.directory, "staged"), f.path),
        ),
      ) !== f.after
    )
      throw Error("Staged ZIP đã bị chỉnh sửa: " + f.path);
    if (
      f.before !== null &&
      sha(
        await fs.readFile(
          await checked(path.join(plan.directory, "before"), f.path),
        ),
      ) !== f.before
    )
      throw Error("Backup file đã bị chỉnh sửa: " + f.path);
  }
}
async function backup(plan: ArchivePlan, ig: Ignore) {
  const hooks = path.join(plan.directory, "empty-hooks");
  await fs.mkdir(hooks, { recursive: true });
  const options = [
    "-c",
    "core.hooksPath=" + hooks,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.longpaths=true",
    "-c",
    "core.attributesFile=",
    "-c",
    "commit.gpgsign=false",
  ];
  const git = (args: string[], cwd = plan.root, env: NodeJS.ProcessEnv = {}) =>
    processResult("git", [...options, ...args], cwd, 30000, env);
  let repository: string;
  try {
    repository = (await git(["rev-parse", "--show-toplevel"])).trim();
  } catch {
    await git(["init", "--quiet"]);
    repository = plan.root;
  }
  const prefix = path.relative(repository, plan.root).split(path.sep).join("/");
  if (prefix.startsWith("..") || path.isAbsolute(prefix))
    throw Error("Git workspace mismatch");
  let parent = "";
  try {
    parent = (await git(["rev-parse", "--verify", "HEAD"])).trim();
  } catch {}
  // VS Code conversation storage can already exceed Windows MAX_PATH.
  // Git also appends .lock: keep this disposable index outside artifact storage.
  // mkdtemp isolates simultaneous backups and never touches the user's index.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "np-git-"));
  const index = path.join(scratch, "index");
  const env = {
    GIT_INDEX_FILE: index,
    GIT_AUTHOR_NAME: "Nopilot Backup",
    GIT_AUTHOR_EMAIL: "nopilot@localhost",
    GIT_COMMITTER_NAME: "Nopilot Backup",
    GIT_COMMITTER_EMAIL: "nopilot@localhost",
  };
  try {
    await git(
      parent ? ["read-tree", parent] : ["read-tree", "--empty"],
      repository,
      env,
    );
    const tracked = (await git(["ls-files", "-z"], plan.root))
      .split("\0")
      .filter(Boolean);
    for (const name of tracked) {
      if (
        !ig.ignores(name) &&
        !ig.ignores(name + "/") &&
        plan.snapshot[name] === undefined
      )
        await git(
          [
            "update-index",
            "--force-remove",
            "--",
            prefix ? prefix + "/" + name : name,
          ],
          repository,
          env,
        );
    }
    for (const name of Object.keys(plan.snapshot)) {
      const full = await checked(plan.root, name),
        hash = (
          await git(
            ["hash-object", "-w", "--no-filters", "--", full],
            repository,
          )
        ).trim();
      await git(
        [
          "update-index",
          "--add",
          "--cacheinfo",
          "100644",
          hash,
          prefix ? prefix + "/" + name : name,
        ],
        repository,
        env,
      );
    }
    const tree = (await git(["write-tree"], repository, env)).trim();
    const commit = (
      await git(
        [
          "commit-tree",
          tree,
          ...(parent ? ["-p", parent] : []),
          "-m",
          "Nopilot backup before " + plan.commitMessage,
        ],
        repository,
        env,
      )
    ).trim();
    const ref = "refs/nopilot/backups/" + plan.id;
    await git(["update-ref", ref, commit], repository);
    plan.backup = { commit, ref, repository };
    await save(plan);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
async function replace(root: string, file: string, bytes: Buffer | null) {
  const full = await checked(root, file);
  if (bytes === null) {
    await fs.unlink(full);
    return;
  }
  await fs.mkdir(path.dirname(full), { recursive: true });
  const temporary = full + ".nopilot-" + id() + ".tmp";
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    await fs.rename(temporary, full);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
export async function applyArchive(
  plan: ArchivePlan,
  ig: Ignore,
  assertClean: () => Promise<void>,
  progress: (text: string) => void = () => {},
) {
  if (plan.state !== "staged")
    throw Error("Archive proposal không còn staged.");
  await assertClean();
  await verifyStaging(plan);
  if (!same(plan.snapshot, await workspaceSnapshot(plan.root, ig)))
    throw Error("Workspace đã đổi từ lúc xem ZIP. Hãy tạo lại đề xuất.");
  progress("Đang commit backup source workspace…");
  await backup(plan, ig);
  await assertClean();
  if (!same(plan.snapshot, await workspaceSnapshot(plan.root, ig)))
    throw Error("Workspace đổi trong lúc backup; chưa áp dụng ZIP.");
  plan.state = "applying";
  await save(plan);
  try {
    for (const f of plan.files) {
      await assertClean();
      const current = await readOrNull(await checked(plan.root, f.path));
      if ((current === null ? null : sha(current)) !== f.before)
        throw Error("Source đổi trước khi ghi: " + f.path);
      if (ig.ignores(f.path) || ig.ignores(f.path + "/"))
        throw Error("Ignore đã đổi: " + f.path);
      const bytes =
        f.after === null
          ? null
          : await fs.readFile(
              await checked(path.join(plan.directory, "staged"), f.path),
            );
      if (bytes !== null && sha(bytes) !== f.after)
        throw Error("Staged data changed: " + f.path);
      await replace(plan.root, f.path, bytes);
      progress("Đã cập nhật " + f.path);
    }
    plan.state = "applied";
    await save(plan);
  } catch (error) {
    plan.state = "interrupted";
    plan.error = String(error);
    await save(plan);
    throw Error(
      String(error) +
        " · Không tự ghi đè để rollback. Dùng Khôi phục checkpoint sau khi kiểm tra; backup: " +
        plan.backup?.commit,
    );
  }
}
export async function restoreArchive(
  plan: ArchivePlan,
  assertClean: () => Promise<void>,
) {
  if (!["applied", "interrupted", "applying"].includes(plan.state))
    throw Error("Không có archive update để khôi phục.");
  await assertClean();
  await verifyStaging(plan);
  for (const f of plan.files) {
    const b = await readOrNull(await checked(plan.root, f.path)),
      h = b === null ? null : sha(b);
    if (h !== f.after && h !== f.before)
      throw Error("Source đã đổi, không restore tự động: " + f.path);
  }
  for (const f of plan.files) {
    await assertClean();
    const b = await readOrNull(await checked(plan.root, f.path)),
      h = b === null ? null : sha(b);
    if (h === f.before) continue;
    if (h !== f.after) throw Error("Source đổi trong lúc restore: " + f.path);
    await replace(
      plan.root,
      f.path,
      f.before === null
        ? null
        : await fs.readFile(
            await checked(path.join(plan.directory, "before"), f.path),
          ),
    );
  }
  plan.state = "restored";
  await save(plan);
}

// Fork a checked subset; keep the original immutable staging for the files
// the developer did not accept. Each accepted batch owns its own checkpoint.
export async function selectArchive(
  plan: ArchivePlan,
  names: string[],
  directory: string,
) {
  const chosen = new Set(names.map(safeRelative));
  if (
    !chosen.size ||
    [...chosen].some((name) => !plan.files.some((f) => f.path === name))
  )
    throw Error("Danh sách thay đổi được chọn không hợp lệ.");
  if (plan.state !== "staged") throw Error("Đề xuất gốc không còn staged.");
  const files = plan.files.filter((f) => chosen.has(f.path));
  await verifyStaging({ ...plan, files });
  const next: ArchivePlan = {
    ...plan,
    id: id(),
    directory,
    files: structuredClone(files),
    backup: undefined,
    error: undefined,
    state: "staged",
  };
  await fs.mkdir(directory, { recursive: true });
  for (const f of files)
    for (const section of ["before", "staged"] as const) {
      if ((section === "before" ? f.before : f.after) === null) continue;
      const target = path.join(directory, section, f.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(
        await checked(path.join(plan.directory, section), f.path),
        target,
      );
    }
  await save(next);
  return next;
}
