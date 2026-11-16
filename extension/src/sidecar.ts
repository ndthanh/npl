import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";
import fs from "node:fs/promises";

export class Sidecar {
  private process?: ChildProcessWithoutNullStreams;
  private stalledConnect?: string;
  private controlFile = path.join(
    os.tmpdir(),
    "nopilot-control-" + randomUUID() + ".json",
  );
  private pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
      method: string;
      progress?: (value: any) => void;
    }
  >();
  constructor(
    private directory: string,
    private python: () => string,
    private log: (s: string) => void,
  ) {}
  async call(
    method: string,
    params: any = {},
    progress?: (value: any) => void,
  ): Promise<any> {
    if (method === "connect" && this.stalledConnect)
      throw Error(
        "Lượt kết nối trước chưa kết thúc trong bridge. Chờ bridge trả về hoặc reload VS Code; không attach chồng.",
      );
    if (!this.process) {
      const python = this.python();
      let diagnostics = "";
      const proc = spawn(
        python,
        ["-u", "-B", path.join(this.directory, "rpc.py")],
        {
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONUTF8: "1",
            NOPILOT_CONTROL_FILE: this.controlFile,
          },
        },
      );
      this.process = proc;
      createInterface({ input: proc.stdout }).on("line", (line) => {
        try {
          const m = JSON.parse(line),
            p = this.pending.get(m.id);
          if (m.id === this.stalledConnect && m.type !== "progress")
            this.stalledConnect = undefined;
          if (m.type === "progress") {
            p?.progress?.(m.value);
            return;
          }
          this.log(
            "RPC received " +
              m.id +
              (m.error ? " error: " + m.error : " result"),
          );
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(m.id);
            m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
          }
        } catch (e) {
          this.log("Protocol error: " + String(e));
        }
      });
      proc.stderr.on("data", (d) => {
        this.log(d.toString());
        diagnostics = (diagnostics + d.toString()).slice(-16000);
      });
      const fail = (e: Error) => {
        this.stalledConnect = undefined;
        void fs.rm(this.controlFile, { force: true }).catch(() => {});
        if (this.process === proc) this.process = undefined;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(e);
        }
        this.pending.clear();
      };
      proc.on("error", fail);
      proc.on("close", (code) =>
        fail(
          Error(
            (/No module named ['"]([^'"]+)/.exec(diagnostics)?.[1]
              ? "Python " +
                python +
                " thiếu " +
                /No module named ['"]([^'"]+)/.exec(diagnostics)![1] +
                ". Chạy Nopilot: Check Runtime / Repair Bridge Dependencies. "
              : "") +
              "Bridge exited (" +
              code +
              "). Nothing was resent.",
          ),
        ),
      );
    }
    const id = randomUUID();
    this.log("RPC request " + method + " " + id);
    return new Promise((resolve, reject) => {
      const seconds =
        (params.timeout ??
          (method === "ask"
            ? 300
            : method === "connect"
              ? 90
              : ["new", "restore"].includes(method)
                ? 60
                : method.startsWith("browser.")
                  ? 60
                  : method === "web.read"
                    ? 45
                    : [
                          "download",
                          "pack",
                          "pack_project",
                          "unpack",
                          "unpack_project",
                        ].includes(method)
                      ? 300
                      : 30)) +
        (method === "ask" ? (params.uploads?.length ?? 0) * 300 : 0) +
        (method === "recover" ? 45 : 0);
      const timer = setTimeout(
        () => {
          if (method === "connect") this.stalledConnect = id;
          if (method === "ask")
            void fs
              .writeFile(this.controlFile, JSON.stringify({ cancel: id }), {
                encoding: "utf8",
              })
              .catch(() => {});
          this.pending.delete(id);
          reject(
            Error(
              "Bridge response unconfirmed for " +
                method +
                ". Inspect Teams; do not automatically resend.",
            ),
          );
        },
        seconds * 1000 + 15000,
      );
      this.pending.set(id, { resolve, reject, timer, method, progress });
      this.process!.stdin.write(
        JSON.stringify({
          id,
          method,
          params: { ...params, ...(method === "ask" ? { controlId: id } : {}) },
        }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }
  async cancelAsk() {
    const asks = Array.from(this.pending).filter(
      ([, request]) => request.method === "ask",
    );
    if (asks.length !== 1)
      throw Error("Không có đúng một lượt Copilot đang chờ; không gửi Stop.");
    await fs.writeFile(
      this.controlFile,
      JSON.stringify({ cancel: asks[0][0] }),
      { encoding: "utf8" },
    );
    return { requested: true };
  }
  dispose() {
    this.process?.stdin.end();
  }
  async shutdown() {
    const child = this.process;
    if (!child) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            Error(
              "Bridge chưa đóng xong. Reload VS Code trước khi dùng runtime mới.",
            ),
          ),
        15000,
      );
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }
}
