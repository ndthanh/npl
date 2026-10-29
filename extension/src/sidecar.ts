import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class Sidecar {
  private process?: ChildProcessWithoutNullStreams;
  private pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    private directory: string,
    private python: () => string,
    private log: (s: string) => void,
  ) {}
  async call(method: string, params: any = {}): Promise<any> {
    if (!this.process) {
      const proc = spawn(
        this.python(),
        ["-u", "-B", path.join(this.directory, "rpc.py")],
        { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" } },
      );
      this.process = proc;
      createInterface({ input: proc.stdout }).on("line", (line) => {
        try {
          const m = JSON.parse(line),
            p = this.pending.get(m.id);
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
      proc.stderr.on("data", (d) => this.log(d.toString()));
      const fail = (e: Error) => {
        if (this.process === proc) this.process = undefined;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(e);
        }
        this.pending.clear();
      };
      proc.on("error", fail);
      proc.on("exit", (code) =>
        fail(Error("Bridge exited (" + code + "). Nothing was resent.")),
      );
    }
    const id = randomUUID();
    this.log("RPC request " + method + " " + id);
    return new Promise((resolve, reject) => {
      const seconds =
        params.timeout ??
        (method === "ask"
          ? 300
          : ["connect", "new", "restore"].includes(method)
            ? 60
            : method.startsWith("browser.")
              ? 60
              : method === "web.read"
                ? 45
                : 30);
      const timer = setTimeout(
        () => {
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
      this.pending.set(id, { resolve, reject, timer });
      this.process!.stdin.write(
        JSON.stringify({ id, method, params }) + "\n",
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
  dispose() {
    this.process?.stdin.end();
  }
}
