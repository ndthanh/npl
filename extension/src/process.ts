import { spawn } from "node:child_process";
export function processResult(
  program: string,
  args: string[],
  cwd: string,
  timeout = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(program, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: { ...process.env, PYTHONUTF8: "1" },
    });
    let out = "";
    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (out += b));
    const timer = setTimeout(() => {
      p.kill();
      reject(Error("Process timed out: " + program));
    }, timeout);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(out)
        : reject(Error(program + " exit " + code + ": " + out.slice(-4000)));
    });
  });
}
