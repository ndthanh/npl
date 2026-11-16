import { diffLines } from "diff";
export type FileChange = {
  path: string;
  added: number | null;
  removed: number | null;
  binary: boolean;
  operation: "add" | "edit" | "delete";
};
export function fileChange(
  name: string,
  before: Buffer | null,
  after: Buffer | null,
): FileChange {
  const result: FileChange = {
    path: name,
    added: null,
    removed: null,
    binary: false,
    operation: before === null ? "add" : after === null ? "delete" : "edit",
  };
  const decode = (bytes: Buffer | null) =>
    bytes === null
      ? ""
      : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  try {
    if (before?.includes(0) || after?.includes(0)) throw Error("binary");
    const parts = diffLines(decode(before), decode(after), {
      timeout: 150,
      maxEditLength: 10000,
    });
    if (parts) {
      result.added = parts
        .filter((p) => p.added)
        .reduce((n, p) => n + p.count, 0);
      result.removed = parts
        .filter((p) => p.removed)
        .reduce((n, p) => n + p.count, 0);
    }
  } catch {
    result.binary = true;
  }
  return result;
}
