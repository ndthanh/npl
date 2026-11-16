import * as vscode from "vscode";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { LocalModelClient } from "./local-model";
import { processResult } from "./process";
export function localModelConfig() {
  const c = vscode.workspace.getConfiguration("nopilot.localModel");
  return {
    pythonPath:
      c.get<string>("pythonPath", "") ||
      vscode.workspace
        .getConfiguration("nopilot")
        .get<string>("pythonPath", "python"),
    modelPath: c.get<string>("modelPath", ""),
    contextSize: c.get<number>("contextSize", 8192),
    threads: c.get<number>("threads", 4),
    gpuLayers: c.get<number>("gpuLayers", 0),
    maxSteps: c.get<number>("maxSteps", 10),
  };
}
export class LocalModelPanel {
  private panel?: vscode.WebviewPanel;
  private busy = false;
  private generation = 0;
  private error = "";
  private setup?: { phase: "checking" | "missing" | "ready" | "broken" | "unavailable"; pythonVersion?: string; architecture?: string };
  constructor(
    private ctx: vscode.ExtensionContext,
    private client: LocalModelClient,
    private trusted: () => void,
    private install?: (python: string, wheelhouse?: string) => Promise<void>,
  ) {}
  update() {
    this.panel?.webview.postMessage({
      type: "snapshot",
      config: localModelConfig(),
      runtime: this.client.state,
      busy: this.busy,
      error: this.error,
      setup: this.setup,
    });
  }
  async checkRuntime(python = localModelConfig().pythonPath) {
    this.setup = { phase: "checking" };
    this.update();
    try {
      const data = JSON.parse(await processResult(python, [
        "-I", "-c", [
          "import importlib.util, json, platform",
          "phase = 'missing'",
          "if importlib.util.find_spec('llama_cpp'):",
          "    try:",
          "        from llama_cpp import Llama",
          "        phase = 'ready'",
          "    except Exception:",
          "        phase = 'broken'",
          "print(json.dumps(dict(phase=phase, pythonVersion=platform.python_version(), architecture=platform.machine())))",
        ].join("\n"),
      ], this.ctx.extensionPath, 15000));
      this.setup = data;
    } catch {
      this.setup = { phase: "unavailable" };
    }
    this.update();
  }
  async open() {
    this.trusted();
    if (this.panel) {
      this.panel.reveal();
      this.update();
      return;
    }
    const p = (this.panel = vscode.window.createWebviewPanel(
      "nopilot.localModel",
      "Nopilot · Local Model",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.ctx.extensionPath, "dist")),
        ],
      },
    ));
    const nonce = randomUUID().replace(/-/g, "");
    const script = p.webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.ctx.extensionPath, "dist/local-model-ui.js"),
      ),
    );
    p.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'nonce-${nonce}';style-src 'nonce-${nonce}'"></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    p.onDidDispose(() => {
      this.panel = undefined;
    });
    p.webview.onDidReceiveMessage(
      (m) =>
        void this.handle(m).catch((e) => {
          this.error = String(e);
          this.update();
        }),
    );
  }
  private async handle(m: any) {
    if (m.type === "ready") {
      if (!this.busy) await this.checkRuntime();
      return;
    }
    this.trusted();
    if (m.type === "stop") {
      this.generation++;
      this.client.stop();
      this.update();
      return;
    }
    if (this.busy || ["busy", "loading"].includes(this.client.state.status))
      throw Error("Đợi hoặc dừng local model trước khi đổi cấu hình.");
    this.error = "";
    const generation = ++this.generation;
    this.busy = true;
    this.update();
    try {
      if (m.type === "chooseModel" || m.type === "choosePython") {
        const files = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters:
            m.type === "chooseModel" ? { GGUF: ["gguf"] } : { Python: ["exe"] },
        });
        if (files?.length) {
          this.client.stop();
          await vscode.workspace
            .getConfiguration("nopilot.localModel")
            .update(
              m.type === "chooseModel" ? "modelPath" : "pythonPath",
              files[0].fsPath,
              vscode.ConfigurationTarget.Global,
            );
          if (m.type === "choosePython") await this.checkRuntime();
        }
      } else if (m.type === "save" || m.type === "load") {
        const v = m.config;
        if (
          !v ||
          typeof v.pythonPath !== "string" ||
          typeof v.modelPath !== "string" ||
          !path.isAbsolute(v.modelPath) ||
          !v.modelPath.toLowerCase().endsWith(".gguf")
        )
          throw Error(
            "Nhập đường dẫn tuyệt đối tới model .gguf và Python runtime.",
          );
        for (const [key, low, high] of [
          ["contextSize", 2048, 32768],
          ["threads", 1, 64],
          ["gpuLayers", -1, 256],
          ["maxSteps", 1, 10],
        ] as const)
          if (!Number.isInteger(v[key]) || v[key] < low || v[key] > high)
            throw Error("Cấu hình " + key + " không hợp lệ.");
        this.client.stop();
        const c = vscode.workspace.getConfiguration("nopilot.localModel");
        for (const key of [
          "pythonPath",
          "modelPath",
          "contextSize",
          "threads",
          "gpuLayers",
          "maxSteps",
        ])
          await c.update(key, v[key], vscode.ConfigurationTarget.Global);
        await this.checkRuntime();
        if (m.type === "load" && generation === this.generation && this.setup?.phase === "ready")
          await this.client.load(localModelConfig());
      } else if (m.type === "install" || m.type === "installOffline") {
        const python = m.config?.pythonPath;
        if (typeof python !== "string" || !python.trim() || !this.install)
          throw Error("Chọn Python đã cài để tạo runtime GGUF.");
        let wheelhouse: string | undefined;
        if (m.type === "installOffline") {
          const selected = await vscode.window.showOpenDialog({
            canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
            openLabel: "Dùng thư mục wheel GGUF",
          });
          if (!selected?.length) return;
          wheelhouse = selected[0].fsPath;
          if (!(await fs.readdir(wheelhouse)).some((name) => /^llama_cpp_python-.*\.whl$/i.test(name)))
            throw Error("Thư mục cần chứa wheel llama-cpp-python và các wheel phụ thuộc.");
        }
        if (generation !== this.generation) return;
        await this.install(python.trim(), wheelhouse);
        await vscode.commands.executeCommand("nopilot.chat.focus");
      } else if (m.type === "health") {
        await this.checkRuntime(m.config?.pythonPath?.trim() || undefined);
      } else if (m.type === "test") {
        const result = await this.client.plan(
          "Reply with action answer, message LOCAL_MODEL_READY. Do not read files, propose commands or call any tool.",
          [],
        );
        if (
          result.action.action !== "answer" ||
          !result.action.message.includes("LOCAL_MODEL_READY")
        )
          throw Error("Model không vượt qua bài kiểm tra JSON cơ bản.");
        this.client.state = {
          ...this.client.state,
          message: "Inference JSON thành công · " + result.elapsedMs + " ms.",
          usage: result.usage,
        };
      } else if (m.type === "guide") {
        await vscode.commands.executeCommand(
          "markdown.showPreview",
          vscode.Uri.file(path.join(this.ctx.extensionPath, "LOCAL_MODEL.md")),
        );
      } else throw Error("Unknown local model action");
    } finally {
      this.busy = false;
      this.update();
    }
  }
  dispose() {
    this.panel?.dispose();
  }
}
