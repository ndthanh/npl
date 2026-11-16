import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { matcher, sha } from "./core";
import { checked, workspaceSnapshot } from "./archive";
import { DECIMEN_MAX_BYTES } from "./decimen";

export async function workspaceZip(
  root: string,
  ig: ReturnType<typeof matcher>,
  checkClean: () => Promise<void>,
  cancelled = () => false,
) {
  const ensureActive = () => {
    if (cancelled()) throw Error("Đã đóng phiên Decimen.");
  };
  await checkClean();
  ensureActive();
  const before = await workspaceSnapshot(root, ig),
    names = Object.keys(before).sort();
  if (!names.length)
    throw Error(
      "Workspace không có file hợp lệ sau khi áp dụng .nopilotignore.",
    );
  const zip = new ZipFile(),
    chunks: Buffer[] = [];
  let size = 0;
  const result = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > DECIMEN_MAX_BYTES || cancelled())
        (zip.outputStream as Readable).destroy(
          Error(
            cancelled()
              ? "Đã đóng phiên Decimen."
              : "ZIP lớn hơn 64 MiB mà bộ nhận Decimen hỗ trợ.",
          ),
        );
      else chunks.push(chunk);
    });
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
    zip.on("error", reject);
  });
  // Attach rejection handling immediately while asynchronous reads are in flight.
  void result.catch(() => {});
  try {
    for (const name of names) {
      ensureActive();
      const bytes = await fs.readFile(await checked(root, name));
      if (sha(bytes) !== before[name])
        throw Error("File đổi trong lúc đóng gói: " + name);
      zip.addBuffer(bytes, name, {
        mtime: new Date("2000-01-01T00:00:00Z"),
        mode: 0o100644,
      });
    }
    zip.end();
    const bytes = await result;
    ensureActive();
    await checkClean();
    const after = await workspaceSnapshot(root, ig);
    if (
      JSON.stringify(Object.entries(after).sort()) !==
      JSON.stringify(Object.entries(before).sort())
    )
      throw Error("Workspace đổi trong lúc đóng gói; thử /dec lại.");
    return {
      bytes,
      files: names,
      sha256: sha(bytes),
      name: path.basename(root) + ".zip",
    };
  } catch (error) {
    (zip.outputStream as Readable).destroy();
    throw error;
  }
}
