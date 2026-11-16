import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseExplorer } from "./database";

type Report = {
  id: string;
  name: string;
  source: string;
  target: string;
  sourceSql: string;
  targetSql: string;
  mapping: string;
  keys: string;
  numeric: string;
  tolerance: string;
  trim: boolean;
  sameCutoff: boolean;
  limit: number;
  caseName: string;
  cutoff: string;
  codeBrief?: string;
};
const fields = [
  "name",
  "source",
  "target",
  "sourceSql",
  "targetSql",
  "mapping",
  "keys",
  "numeric",
  "tolerance",
  "caseName",
  "cutoff",
] as const;
const fingerprint = ({ codeBrief: _brief, ...r }: Report) =>
  createHash("sha256").update(JSON.stringify(r)).digest("hex");
export class MigrationWorkbench {
  private panel?: vscode.WebviewPanel;
  private reports: Report[];
  private selected: string;
  private profiles: any[] = [];
  private history: any[];
  private run: any;
  private schema: Record<string, any> = {};
  private busy = false;
  private cancelled = false;
  private status =
    "Chọn hoặc tạo báo cáo. SQL chỉ chạy khi bấm Chạy đối chiếu.";
  private error = "";
  constructor(
    private ctx: vscode.ExtensionContext,
    private db: DatabaseExplorer,
    private copilot: (prompt: string) => Promise<void>,
  ) {
    this.reports = ctx.workspaceState.get<Report[]>("migration.reports", []);
    this.selected = ctx.workspaceState.get<string>("migration.selected", "");
    this.history = ctx.workspaceState.get<any[]>("migration.history", []);
  }
  private current() {
    return this.reports.find((r) => r.id === this.selected);
  }
  private async persist() {
    await this.ctx.workspaceState.update("migration.reports", this.reports);
    await this.ctx.workspaceState.update("migration.selected", this.selected);
    await this.ctx.workspaceState.update("migration.history", this.history);
  }
  private async detach() {
    const command = "workbench.action.moveEditorToNewWindow";
    if (!(await vscode.commands.getCommands(true)).includes(command))
      throw Error("IDE này chưa hỗ trợ chuyển tab sang cửa sổ riêng.");
    this.panel?.reveal();
    await vscode.commands.executeCommand(command);
  }
  async open() {
    this.profiles = await this.db.migrationProfiles();
    if (this.panel) {
      this.panel.reveal();
      this.send();
      return;
    }
    const panel = (this.panel = vscode.window.createWebviewPanel(
      "nopilot.migration",
      "Nopilot · Migration",
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
    const script = panel.webview.asWebviewUri(
      vscode.Uri.file(
        path.join(this.ctx.extensionPath, "dist", "migration-ui.js"),
      ),
    );
    panel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'nonce-${nonce}';style-src ${panel.webview.cspSource} 'nonce-${nonce}'"></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    panel.webview.onDidReceiveMessage(
      (m) =>
        void this.handle(m).catch((e) => {
          this.error = String(e);
          this.send();
        }),
    );
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.cancel();
    });
  }
  private send() {
    this.panel?.webview.postMessage({
      type: "snapshot",
      state: {
        reports: this.reports,
        selected: this.selected,
        profiles: this.profiles,
        report: this.current(),
        history: this.history.filter((h) => h.reportId === this.selected),
        run: this.run,
        stale:
          !!this.run && fingerprint(this.current()!) !== this.run.fingerprint,
        schema: this.schema,
        busy: this.busy,
        status: this.status,
        error: this.error,
      },
    });
  }
  private cancel() {
    if (this.busy) {
      this.cancelled = true;
      this.db.cancelMigration();
      this.status = "Đã yêu cầu dừng. Không tự chạy lại.";
      this.send();
    }
  }
  private newReport(name = "Báo cáo mới"): Report {
    return {
      id: randomUUID(),
      name,
      source: "",
      target: "",
      sourceSql: "",
      targetSql: "",
      mapping: "",
      keys: "",
      numeric: "",
      tolerance: "0",
      trim: false,
      sameCutoff: false,
      limit: 10000,
      caseName: "Mặc định",
      cutoff: "",
    };
  }
  private update(values: any) {
    const r = this.current();
    if (!r) throw Error("Chọn báo cáo trước.");
    for (const key of fields)
      if (typeof values[key] === "string") {
        if ((key === "source" || key === "target") && r[key] !== values[key])
          delete this.schema[key];
        r[key] = values[key].slice(0, 100000);
      }
    for (const key of ["trim", "sameCutoff"] as const)
      if (typeof values[key] === "boolean") r[key] = values[key];
    if ([1000, 10000, 100000].includes(values.limit)) r.limit = values.limit;
    if (typeof values.codeBrief === "string")
      r.codeBrief = values.codeBrief.slice(0, 12000);
  }
  async receiveSql(sql: string) {
    if (this.busy) throw Error("Đợi lượt đối chiếu hiện tại.");
    let r = this.current();
    if (!r) {
      r = this.newReport();
      this.reports.push(r);
      this.selected = r.id;
    }
    r.targetSql = sql;
    await this.persist();
    this.status =
      "Đã đưa SQL từ chat vào phía đích. Chưa thực thi; kiểm tra rồi Chạy đối chiếu.";
    await this.open();
    this.send();
  }
  private async handle(m: any) {
    if (m.type === "ready") {
      this.send();
      return;
    }
    if (m.type === "detach") {
      if (!this.busy && m.values && this.current()) {
        this.update(m.values);
        await this.persist();
      }
      await this.detach();
      return;
    }
    if (m.type === "stop") {
      this.cancel();
      return;
    }
    if (m.type === "guide") {
      await vscode.commands.executeCommand(
        "markdown.showPreview",
        vscode.Uri.file(path.join(this.ctx.extensionPath, "MIGRATION.md")),
      );
      return;
    }
    if (this.busy) throw Error("Đợi hoặc dừng lượt đối chiếu hiện tại.");
    this.error = "";
    if (m.values && this.current()) this.update(m.values);
    if (m.type === "draft") {
      this.update(m.values ?? {});
      await this.persist();
      return;
    }
    if (m.type === "new") {
      const r = this.newReport();
      this.reports.push(r);
      this.selected = r.id;
      this.run = undefined;
      this.schema = {};
    } else if (m.type === "select") {
      if (!this.reports.some((r) => r.id === m.id))
        throw Error("Không tìm thấy báo cáo.");
      this.selected = m.id;
      this.run = undefined;
      this.schema = {};
    } else if (m.type === "duplicate") {
      const original = this.current();
      if (!original) return;
      const r = {
        ...original,
        id: randomUUID(),
        name: original.name + " · bản sao",
        sameCutoff: false,
      };
      this.reports.push(r);
      this.selected = r.id;
      this.run = undefined;
      this.schema = {};
    } else if (m.type === "delete") {
      const r = this.current();
      if (!r) return;
      if (
        (await vscode.window.showWarningMessage(
          `Xóa báo cáo “${r.name}” và lịch sử local?`,
          { modal: true },
          "Xóa",
        )) !== "Xóa"
      )
        return;
      this.reports = this.reports.filter((x) => x.id !== r.id);
      this.history = this.history.filter((x) => x.reportId !== r.id);
      this.selected = this.reports[0]?.id ?? "";
      this.run = undefined;
    } else if (m.type === "import") {
      const files = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { JSON: ["json"] },
        openLabel: "Mở định nghĩa Migration",
      });
      if (files?.length) {
        const stat = await fs.stat(files[0].fsPath);
        if (stat.size > 2 * 1024 * 1024)
          throw Error(
            "Định nghĩa báo cáo quá lớn (tối đa 2 MiB; không phải giới hạn dữ liệu query).",
          );
        const data = JSON.parse(await fs.readFile(files[0].fsPath, "utf8"));
        if (
          data.version !== 1 ||
          !data.report ||
          typeof data.report.sourceSql !== "string" ||
          typeof data.report.targetSql !== "string"
        )
          throw Error("File định nghĩa Migration không hợp lệ.");
        const r = this.newReport();
        this.reports.push(r);
        this.selected = r.id;
        this.update(data.report);
        r.sameCutoff = false;
        this.run = undefined;
        this.schema = {};
        this.status =
          "Đã nhập SQL và cấu hình. Kiểm tra lại hai kết nối, tham số và mốc dữ liệu trước khi chạy.";
      }
    } else if (m.type === "data") {
      await this.db.open();
      return;
    } else if (m.type === "refresh") {
      this.profiles = await this.db.migrationProfiles();
    } else if (m.type === "history") {
      const h = this.history.find(
        (x) => x.id === m.id && x.reportId === this.selected,
      );
      if (!h) throw Error("Không tìm thấy lượt chạy.");
      this.run = JSON.parse(await fs.readFile(this.runPath(h.id), "utf8"));
    } else if (m.type === "page" || m.type === "export") {
      if (!this.run || !["source", "target"].includes(m.side))
        throw Error("Chưa có kết quả.");
      const result = this.run[m.side];
      if (!result) throw Error("Chưa có snapshot phía này.");
      this.db.registerSnapshot(result.id);
      if (m.type === "page")
        this.run[m.side] = await this.db.pageSnapshot(
          result.id,
          Math.max(0, Number(m.offset) || 0),
        );
      else
        await this.db.exportSnapshot(
          result.id,
          m.format === "xlsx" ? "xlsx" : "csv",
        );
    } else if (m.type === "save") {
      if (m.values) this.update(m.values);
      const r = this.current();
      if (!r) return;
      const dest = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
              this.ctx.globalStorageUri.fsPath,
            "migration-report.json",
          ),
        ),
        filters: { JSON: ["json"] },
      });
      if (dest) {
        // Definitions + summary only; never credentials or result rows.
        await fs.writeFile(
          dest.fsPath,
          JSON.stringify(
            {
              version: 1,
              report: { ...r, codeBrief: undefined },
              history: this.history.filter((h) => h.reportId === r.id),
            },
            null,
            2,
          ),
        );
        this.status =
          "Đã lưu định nghĩa SQL, mapping và lịch sử tóm tắt. Không có dữ liệu kết quả hay secret.";
      }
    } else if (m.type === "copilot") {
      if (m.values) this.update(m.values);
      const r = this.current();
      if (!r) return;
      const evidence = this.run?.fingerprint === fingerprint(r) ? this.run : undefined;
      const summary = evidence?.comparison;
      const prompt = `Hỗ trợ migrate báo cáo ${r.name} sang Databricks SQL. Chỉ đề xuất SQL; không tự chạy.\nTham số/mốc dữ liệu: ${r.cutoff}\nSQL nguồn:\n\`\`\`sql\n${r.sourceSql}\n\`\`\`\nSQL đích hiện tại:\n\`\`\`sql\n${r.targetSql}\n\`\`\`\nMapping: ${r.mapping || "Ghép cột cùng tên"}\nKhóa: ${r.keys || "Chưa có"}\n${summary ? "Đối chiếu local: " + JSON.stringify({ evidenceId: evidence.id, ranAt: evidence.createdAt, status: summary.status, reasons: summary.reasons, sourceRows: summary.sourceRows, targetRows: summary.targetRows, missing: summary.missing, extra: summary.extra, changed: summary.changed }) : ""}\nKhông đoán schema. Hỏi thêm nếu thiếu tên bảng/cột. Trả câu SQL Databricks trong code block sql và giải thích thay đổi.`;
      const brief = m.includeBrief === true ? r.codeBrief?.trim() : undefined;
      await this.copilot(brief ? prompt + "\n\nCode Brief (tham khảo nghiệp vụ):\n" + brief : prompt);
      this.status =
        "Đã chuẩn bị bản nháp trong chat. Kiểm tra rồi bấm gửi; chưa gửi dữ liệu kết quả.";
    } else if (["run", "schema", "demo"].includes(m.type)) {
      if (m.values) this.update(m.values);
      this.busy = true;
      this.cancelled = false;
      this.status = "Đang chuẩn bị…";
      this.send();
      try {
        if (m.type === "demo") {
          const d = await this.db.migrationOperation("demo", {});
          const r = this.newReport("Demo · Doanh thu theo vùng");
          r.source = r.target = d.profileId;
          r.keys = "region";
          r.numeric = "revenue";
          r.sameCutoff = true;
          r.cutoff = "SQLite demo local tĩnh · toàn bộ 150 đơn hàng";
          r.sourceSql =
            "SELECT region, SUM(revenue) AS revenue, COUNT(*) AS orders\nFROM sales GROUP BY region;";
          r.targetSql = r.sourceSql;
          this.reports.push(r);
          this.selected = r.id;
          this.run = undefined;
          this.profiles = await this.db.migrationProfiles();
          this.status =
            "Demo sẵn sàng. Chạy đối chiếu, rồi thử cộng 1 vào SUM(revenue) phía đích để thấy sai khác.";
        } else {
          const r = structuredClone(this.current());
          if (!r) throw Error("Chọn báo cáo trước.");
          if (m.type === "schema") {
            if (!["source", "target"].includes(m.side))
              throw Error("Chọn phía đọc schema.");
            const profile = m.side === "source" ? r.source : r.target;
            if (!profile) throw Error("Chọn kết nối trước khi đọc schema.");
            this.schema[m.side] = await this.db.migrationOperation(
              "schema",
              {},
              profile,
            );
            this.status = "Đã tải metadata local; chưa gửi Copilot.";
          } else {
            if (
              !r.source ||
              !r.target ||
              !r.sourceSql.trim() ||
              !r.targetSql.trim()
            )
              throw Error("Chọn hai kết nối và nhập SQL nguồn/đích.");
            this.run = undefined;
            this.status = "1/3 · Đang chạy SQL nguồn…";
            this.send();
            const source = await this.db.migrationOperation(
              "query",
              { sql: r.sourceSql, limit: r.limit },
              r.source,
            );
            if (this.cancelled) throw Error("Đã dừng đối chiếu.");
            this.status = "2/3 · Đang chạy SQL đích…";
            this.send();
            const target = await this.db.migrationOperation(
              "query",
              { sql: r.targetSql, limit: r.limit },
              r.target,
            );
            if (this.cancelled) throw Error("Đã dừng đối chiếu.");
            this.status = "3/3 · Đang đối chiếu toàn bộ snapshot…";
            this.send();
            const comparison = await this.db.migrationOperation("compare", {
              source: source.id,
              target: target.id,
              options: r,
            });
            if (this.cancelled) throw Error("Đã dừng đối chiếu.");
            const id = randomUUID(),
              createdAt = new Date().toISOString();
            const run = {
              id,
              createdAt,
              report: r,
              fingerprint: fingerprint(r),
              source,
              target,
              comparison,
            };
            await fs.mkdir(path.dirname(this.runPath(id)), { recursive: true });
            await fs.writeFile(this.runPath(id), JSON.stringify(run));
            this.run = run;
            this.history.unshift({
              id,
              reportId: r.id,
              createdAt,
              caseName: r.caseName,
              status: comparison.status,
              sourceRows: comparison.sourceRows,
              targetRows: comparison.targetRows,
              missing: comparison.missing,
              extra: comparison.extra,
              changed: comparison.changed,
              sourceMs: comparison.sourceMs,
              targetMs: comparison.targetMs,
            });
            this.history = this.history.slice(0, 200);
            this.status =
              "Đối chiếu hoàn tất. Kết quả gắn với đúng SQL và tùy chọn tại thời điểm chạy.";
          }
        }
      } catch (e) {
        this.error = this.status + "\n" + String(e);
        this.status = this.cancelled
          ? "Đã dừng. Có thể sửa SQL và chạy lại."
          : "Chưa hoàn tất. Sửa lỗi rồi chạy lại; không tự gửi lại query.";
      } finally {
        this.busy = false;
      }
    } else throw Error("Unknown migration action");
    await this.persist();
    this.send();
  }
  private runPath(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid run ID");
    return path.join(
      this.ctx.storageUri?.fsPath ?? this.ctx.globalStorageUri.fsPath,
      "migration",
      id + ".json",
    );
  }
  dispose() {
    this.cancel();
    this.panel?.dispose();
  }
}
