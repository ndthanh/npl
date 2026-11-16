import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
type Profile = {
  id: string;
  name: string;
  kind: "sqlite" | "odbc";
  engine?: "databricks" | "oracle";
  path?: string;
};
export class DatabaseExplorer {
  private panel?: vscode.WebviewPanel;
  private profiles: Profile[] = [];
  private selected = "";
  private result: any;
  private resultSql = "";
  private resultConnection = "";
  private status = "Chọn kết nối hoặc thử SQLite demo.";
  private statusKind: "info" | "success" | "error" = "info";
  private busy = false;
  private child?: ChildProcessWithoutNullStreams;
  private sql = "SELECT * FROM sales ORDER BY order_id;";
  private limit = 1000;
  private results = new Set<string>();
  private error = "";
  private defaultProfile = "";
  private loaded = false;
  private sessions: Record<string, string[]> = {};
  constructor(
    private ctx: vscode.ExtensionContext,
    private python: () => string,
    private trusted: () => void,
    private showInline?: (
      result: any,
      sql: string,
      connection: string,
    ) => Promise<void> | void,
  ) {
    this.defaultProfile =
      ctx.workspaceState?.get<string>("database.defaultProfile", "") ?? "";
    this.sessions =
      ctx.workspaceState?.get<Record<string, string[]>>(
        "database.sessions",
        {},
      ) ?? {};
  }
  private async rememberProfile(profileId: string) {
    if (profileId && !this.profiles.some((p) => p.id === profileId))
      throw Error("Unknown profile");
    await this.ctx.workspaceState?.update(
      "database.defaultProfile",
      profileId || undefined,
    );
    this.defaultProfile = profileId;
  }
  private get store() {
    return path.join(this.ctx.globalStorageUri.fsPath, "database");
  }
  private async persist() {
    await fs.mkdir(this.store, { recursive: true });
    await fs.writeFile(
      path.join(this.store, "profiles.json"),
      JSON.stringify(this.profiles),
    );
  }
  async prepare() {
    this.trusted();
    if (this.loaded) return;
    try {
      this.profiles = JSON.parse(
        await fs.readFile(path.join(this.store, "profiles.json"), "utf8"),
      );
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    if (
      this.defaultProfile &&
      !this.profiles.some((p) => p.id === this.defaultProfile)
    )
      await this.rememberProfile("");
    this.selected =
      this.selected || this.defaultProfile || this.profiles[0]?.id || "";
    this.loaded = true;
  }
  async migrationProfiles() {
    await this.prepare();
    return this.profiles.map(({ id, name, kind }) => ({ id, name, kind }));
  }
  async migrationOperation(
    method: "query" | "compare" | "schema" | "demo",
    params: any,
    profileId?: string,
  ) {
    await this.prepare();
    if (this.busy) throw Error("Đợi tác vụ Data hiện tại hoàn tất.");
    this.busy = true;
    this.send();
    try {
      let profile;
      if (profileId) {
        const p = this.profiles.find((p) => p.id === profileId);
        if (!p) throw Error("Kết nối không còn tồn tại. Chọn lại kết nối.");
        if (p.kind === "sqlite") profile = { kind: p.kind, path: p.path };
        else {
          const connectionString = await this.ctx.secrets.get(
            "database:" + p.id,
          );
          if (!connectionString) throw Error("Thiếu secret kết nối ODBC.");
          profile = { kind: p.kind, connectionString, engine: p.engine };
        }
      }
      const result = await this.worker(method, { ...params, profile });
      if (method === "query") this.registerSnapshot(result.id);
      if (method === "demo") {
        let p = this.profiles.find(
          (p) => p.kind === "sqlite" && p.path === result.path,
        );
        if (!p) {
          p = {
            id: randomUUID(),
            name: "SQLite · Sales demo",
            kind: "sqlite",
            path: result.path,
          };
          this.profiles.push(p);
          await this.persist();
        }
        return { ...result, profileId: p.id };
      }
      return result;
    } finally {
      this.busy = false;
      this.send();
    }
  }
  cancelMigration() {
    this.child?.kill();
  }
  async open() {
    await this.prepare();
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = (this.panel = vscode.window.createWebviewPanel(
      "nopilot.database",
      "Nopilot · Data",
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
      vscode.Uri.file(path.join(this.ctx.extensionPath, "dist", "data-ui.js")),
    );
    const css = panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(this.ctx.extensionPath, "dist", "codicon.css")),
    );
    panel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'nonce-${nonce}';style-src ${panel.webview.cspSource} 'nonce-${nonce}';font-src ${panel.webview.cspSource}"><link rel="stylesheet" href="${css}"></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    panel.webview.onDidReceiveMessage(
      (m) =>
        void this.handle(m).catch((e) => {
          this.error = String(e);
          this.send();
        }),
    );
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.child?.kill();
    });
  }
  private send() {
    this.panel?.webview.postMessage({
      type: "snapshot",
      state: {
        profiles: this.profiles.map(({ id, name, kind, engine }) => ({
          id,
          name,
          kind,
          engine,
        })),
        selected: this.selected,
        defaultProfile: this.defaultProfile,
        result: this.result,
        resultConnection: this.resultConnection,
        session: this.sessions[this.selected] ?? [],
        status: this.status,
        statusKind: this.statusKind,
        busy: this.busy,
        error: this.error,
        sql: this.sql,
        limit: this.limit,
      },
    });
  }
  async executeSnippet(sql: string) {
    this.trusted();
    if (this.busy)
      throw Error("Đợi query hiện tại hoàn tất trước khi Execute snippet mới.");
    if (typeof sql !== "string" || !sql.trim())
      throw Error("SQL snippet trống.");
    this.sql = sql;
    this.result = undefined;
    this.error = "";
    this.statusKind = "info";
    this.status =
      "SQL từ Copilot · chọn kết nối để Execute; hỗ trợ SELECT / WITH … SELECT.";
    this.send();
    if (!this.profiles.length) {
      this.status =
        "SQL đã sẵn sàng. Thêm kết nối ODBC hoặc SQLite rồi bấm Run query.";
      this.send();
      return;
    }
    if (this.defaultProfile) {
      if (this.profiles.some((p) => p.id === this.defaultProfile)) {
        this.selected = this.defaultProfile;
        await this.handle({ type: "query", sql, limit: this.limit });
        return this.error ? undefined : this.result;
      }
      await this.rememberProfile("");
    }
    this.busy = true;
    this.send();
    let selected: (vscode.QuickPickItem & { profileId: string }) | undefined;
    try {
      selected = await vscode.window.showQuickPick(
        this.profiles.map((p) => ({
          label: p.name,
          description: p.kind === "odbc" ? "ODBC" : "SQLite · local",
          detail: p.id === this.selected ? "Kết nối đang chọn" : "",
          profileId: p.id,
        })),
        {
          title: "Execute SQL · chọn kết nối mặc định cho workspace",
          placeHolder: sql.trim().replace(/\s+/g, " ").slice(0, 180),
          ignoreFocusOut: true,
        },
      );
      if (selected) {
        await this.rememberProfile(selected.profileId);
        this.selected = selected.profileId;
      }
    } finally {
      this.busy = false;
      this.send();
    }
    if (!selected) {
      this.status = "Đã hủy Execute; SQL được giữ trong tab Data.";
      this.send();
      return;
    }
    await this.handle({ type: "query", sql, limit: this.limit });
    return this.error ? undefined : this.result;
  }
  connectionName() {
    return (
      this.profiles.find((profile) => profile.id === this.selected)?.name ?? ""
    );
  }
  feedback() {
    return {
      status: this.status,
      error: this.error,
      hasProfiles: this.profiles.length > 0,
    };
  }
  registerSnapshot(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw Error("Invalid result ID");
    this.results.add(id);
  }
  async pageSnapshot(id: string, offset: number) {
    this.trusted();
    if (this.busy) throw Error("Đợi tác vụ dữ liệu hiện tại.");
    if (!this.results.has(id)) throw Error("Unknown query result");
    this.busy = true;
    try {
      return await this.worker("page", { id, offset });
    } finally {
      this.busy = false;
    }
  }
  async openSnapshot(result: any, sql: string, connection: string) {
    this.trusted();
    if (this.busy) throw Error("Đợi tác vụ dữ liệu hiện tại.");
    this.registerSnapshot(result.id);
    this.result = result;
    this.sql = sql;
    this.resultSql = sql;
    this.resultConnection = connection;
    this.status = "Snapshot · " + connection + " · không query lại";
    this.statusKind = "info";
    await this.open();
    this.send();
  }
  async exportSnapshot(id: string, format: "csv" | "xlsx") {
    this.trusted();
    if (this.busy) throw Error("Đợi tác vụ dữ liệu hiện tại.");
    if (!this.results.has(id)) throw Error("Unknown query result");
    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(this.store, "query-results." + format),
      ),
      filters: format === "csv" ? { CSV: ["csv"] } : { Excel: ["xlsx"] },
      saveLabel: "Export " + format.toUpperCase(),
    });
    if (!destination) return;
    this.busy = true;
    this.send();
    try {
      const data = await this.worker("export", { id, format });
      if (path.resolve(data.path) !== path.resolve(destination.fsPath))
        await fs.copyFile(data.path, destination.fsPath);
      this.status =
        "Đã export " +
        data.rows +
        " dòng vào " +
        destination.fsPath +
        (data.truncated ? " (snapshot đã chạm fetch limit)" : "");
      return destination.fsPath;
    } finally {
      this.busy = false;
      this.send();
    }
  }
  private worker(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = (this.child = spawn(
        this.python(),
        [
          "-u",
          "-B",
          path.join(this.ctx.extensionPath, "bridge", "database.py"),
        ],
        {
          windowsHide: true,
          shell: false,
          env: { ...process.env, PYTHONUTF8: "1" },
        },
      ));
      let out = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (s) => (out += s));
      child.stderr.resume();
      child.stdin.on("error", () => {});
      const timer = setTimeout(() => {
        child.kill();
        reject(
          Error(
            "Database operation quá 120 giây; client đã dừng. Kiểm tra query history của server nếu cần.",
          ),
        );
      }, 120000);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", () => {
        clearTimeout(timer);
        if (this.child === child) this.child = undefined;
        try {
          const data = JSON.parse(out);
          data.error ? reject(Error(data.error)) : resolve(data.result);
        } catch {
          reject(Error("Database worker dừng hoặc trả dữ liệu không hợp lệ."));
        }
      });
      child.stdin.end(
        JSON.stringify({ method, params: { root: this.store, ...params } }),
      );
    });
  }
  private async profile() {
    const p = this.profiles.find((p) => p.id === this.selected);
    if (!p) throw Error("Chọn kết nối trước.");
    if (p.kind === "sqlite") return { kind: p.kind, path: p.path };
    const connectionString = await this.ctx.secrets.get("database:" + p.id);
    if (!connectionString)
      throw Error("Thiếu connection secret. Tạo lại profile ODBC.");
    return { kind: p.kind, connectionString, engine: p.engine };
  }
  private async addOdbc(engine?: Profile["engine"]) {
    let dsn: string | undefined;
    if (engine) {
      const data = await this.worker("capabilities", {});
      if (!data.odbc) throw Error("Thiếu pyodbc. Chạy /setup trước khi tạo kết nối.");
      const dsns = Object.entries(data.sourceDrivers ?? {}).map(([label, driver]) => ({
        label, description: String(driver), dsn: label,
      }));
      const item = await vscode.window.showQuickPick([
        ...dsns,
        { label: "Nhập DSN hoặc chuỗi ODBC…", description: "Thiết lập nâng cao", dsn: undefined },
      ], {
        title: engine === "oracle" ? "Oracle Data Warehouse" : "Databricks SQL Warehouse",
        placeHolder: `Chọn DSN đã cấu hình · Python ${data.pythonBits}-bit`,
      });
      if (!item) return;
      dsn = item.dsn;
    }
    const name = await vscode.window.showInputBox({
      title: "Tên kết nối ODBC",
      value: dsn ?? (engine === "oracle" ? "Oracle Data Warehouse" : "Databricks warehouse"),
    });
    if (!name?.trim()) return;
    const connection = dsn ? "DSN={" + dsn.replace(/}/g, "}}") + "};" : await vscode.window.showInputBox({
      title: "ODBC connection string · chỉ lưu SecretStorage",
      prompt: engine === "oracle"
        ? "Dùng DSN Oracle đã cấu hình Service Name/TNS hoặc chuỗi ODBC của driver Oracle."
        : "Dùng DSN Databricks đã cấu hình Host/HTTP Path hoặc chuỗi ODBC của driver.",
      password: true,
      ignoreFocusOut: true,
    });
    if (!connection?.trim()) return;
    const p: Profile = { id: randomUUID(), name: name.trim(), kind: "odbc", engine };
    await this.ctx.secrets.store("database:" + p.id, connection);
    this.profiles.push(p);
    this.selected = p.id;
    this.result = undefined;
    await this.persist();
    if (!this.defaultProfile) await this.rememberProfile(p.id);
    this.status = "Profile ODBC đã lưu. Bấm Test connection.";
    this.statusKind = "info";
  }
  private async handle(m: any) {
    if (m.type === "migration") {
      this.trusted();
      await vscode.commands.executeCommand("nopilot.migration");
      return;
    }
    if (m.type === "ready") {
      this.send();
      return;
    }
    if (m.type === "draft") {
      this.sql = String(m.sql ?? "");
      return;
    }
    if (m.type === "stop") {
      this.child?.kill();
      this.status = "Đã yêu cầu dừng client query.";
      this.send();
      return;
    }
    this.trusted();
    if (this.busy) throw Error("Đợi tác vụ dữ liệu hiện tại.");
    if (m.type === "showInline") {
      if (!this.result || !this.showInline)
        throw Error("Chưa có snapshot để hiện trong chat.");
      await this.showInline(this.result, this.resultSql, this.resultConnection);
      this.status = "Snapshot đã hiện trong chat Nopilot; không gửi Copilot.";
      this.statusKind = "info";
      this.send();
      return;
    }
    if (m.type === "saveSql") {
      const text = String(m.document ?? this.sql);
      const file = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(this.ctx.globalStorageUri.fsPath, "query.sql"),
        ),
        filters: { SQL: ["sql"] },
        saveLabel: "Save SQL As",
      });
      if (file) {
        await fs.writeFile(file.fsPath, text, "utf8");
        this.status = "Đã lưu SQL vào " + file.fsPath;
        this.statusKind = "success";
        this.send();
      }
      return;
    }
    if (m.type === "clearSession") {
      if (this.selected) delete this.sessions[this.selected];
      await this.ctx.workspaceState?.update("database.sessions", this.sessions);
      this.status =
        "Đã bỏ USE context. Query tiếp theo dùng catalog/schema mặc định của DSN.";
      this.send();
      return;
    }
    if (m.type === "setDefault" || m.type === "clearDefault") {
      this.statusKind = "info";
      await this.rememberProfile(m.type === "setDefault" ? this.selected : "");
      this.status = this.defaultProfile
        ? "Đã lưu kết nối mặc định cho workspace. Execute snippet sẽ dùng lại kết nối này."
        : "Đã bỏ mặc định. Execute snippet tiếp theo sẽ hỏi kết nối.";
      this.send();
      return;
    }
    if (m.type === "select") {
      if (!this.profiles.some((p) => p.id === m.id))
        throw Error("Unknown profile");
      this.selected = m.id;
      this.result = undefined;
      this.error = "";
      this.statusKind = "info";
      this.status = "Đã chọn profile. Bấm Test connection để kiểm tra kết nối.";
      this.send();
      return;
    }
    if (m.type === "addSqlite") {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { SQLite: ["sqlite", "db", "sqlite3"] },
        openLabel: "Mở SQLite chỉ đọc",
      });
      if (!selected) return;
      const p: Profile = {
        id: randomUUID(),
        name: path.basename(selected[0].fsPath),
        kind: "sqlite",
        path: selected[0].fsPath,
      };
      this.profiles.push(p);
      this.selected = p.id;
      await this.persist();
      this.send();
      return;
    }
    this.busy = true;
    this.error = "";
    this.statusKind = "info";
    this.status = "Đang xử lý…";
    this.send();
    try {
      if (m.type === "demo") {
        const data = await this.worker("demo", {});
        let p = this.profiles.find(
          (p) => p.kind === "sqlite" && p.path === data.path,
        );
        if (!p) {
          p = {
            id: randomUUID(),
            name: "SQLite · Sales demo",
            kind: "sqlite",
            path: data.path,
          };
          this.profiles.push(p);
        }
        this.selected = p.id;
        this.sql =
          "SELECT order_id, customer, region, product, quantity, revenue, order_date\nFROM sales\nORDER BY order_id;";
        this.result = undefined;
        await this.persist();
        this.status = "SQLite local đã sẵn sàng · 150 dòng dữ liệu mẫu.";
      } else if (["addOdbc", "addDatabricks", "addOracle"].includes(m.type)) {
        await this.addOdbc(m.type === "addOracle" ? "oracle"
          : m.type === "addDatabricks" ? "databricks" : undefined);
      } else if (m.type === "test") {
        if (m.id !== undefined) {
          const profile = this.profiles.find((p) => p.id === m.id && p.kind === "odbc");
          if (!profile) throw Error("Không tìm thấy kết nối ODBC.");
          if (this.selected !== profile.id) {
            this.selected = profile.id;
            this.result = undefined;
          }
        }
        const data = await this.worker("test", {
          profile: await this.profile(),
        });
        this.status = "Kết nối thành công · " + data.provider;
        this.statusKind = "success";
      } else if (m.type === "drivers") {
        const data = await this.worker("capabilities", {});
        this.status = data.odbc
          ? "Python " +
            data.pythonBits +
            "-bit · Chỉ liệt kê, chưa kiểm tra kết nối. ODBC drivers: " +
            (data.drivers.join(", ") || "chưa có driver") +
            " · DSN: " +
            (data.dataSources.join(", ") || "chưa có DSN")
          : "Thiếu pyodbc. Chạy /setup trong Nopilot.";
      } else if (m.type === "query") {
        this.sql = String(m.document ?? m.sql ?? "");
        this.result = undefined;
        this.resultSql = String(m.sql ?? "");
        this.resultConnection = this.connectionName();
        this.limit = Number(m.limit);
        this.result = await this.worker("query", {
          profile: await this.profile(),
          sql: this.resultSql,
          limit: this.limit,
          session: this.sessions[this.selected] ?? [],
        });
        if (Array.isArray(this.result.session)) {
          this.sessions[this.selected] = this.result.session;
          await this.ctx.workspaceState?.update(
            "database.sessions",
            this.sessions,
          );
        }
        this.results.add(this.result.id);
        this.statusKind = "success";
        this.status =
          (this.result.commandOnly
            ? "USE context đã lưu · "
            : "Query hoàn tất · ") +
          this.result.rowCount +
          " dòng" +
          (this.result.truncated ? " · đã chạm fetch limit" : "");
      } else if (m.type === "page") {
        if (!this.result || !this.results.has(m.id) || this.result.id !== m.id)
          throw Error("Unknown query result");
        this.result = await this.worker("page", {
          id: m.id,
          offset: Number(m.offset),
        });
        this.status = "Trang kết quả đã tải.";
      } else if (m.type === "export") {
        if (!this.result || !this.results.has(m.id) || this.result.id !== m.id)
          throw Error("Unknown query result");
        const format = m.format === "xlsx" ? "xlsx" : "csv";
        const destination = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(this.store, "query-results." + format),
          ),
          filters: format === "csv" ? { CSV: ["csv"] } : { Excel: ["xlsx"] },
          saveLabel: "Export " + format.toUpperCase(),
        });
        if (!destination) return;
        const data = await this.worker("export", { id: m.id, format });
        if (path.resolve(data.path) !== path.resolve(destination.fsPath))
          await fs.copyFile(data.path, destination.fsPath);
        this.status =
          "Đã export " +
          data.rows +
          " dòng vào " +
          destination.fsPath +
          (data.truncated ? " (snapshot đã chạm fetch limit)" : "");
      } else throw Error("Unknown database action");
    } catch (e) {
      this.error = String(e);
      this.statusKind = "error";
      this.status = "Tác vụ dữ liệu chưa hoàn tất.";
    } finally {
      this.busy = false;
      this.send();
    }
  }
  dispose() {
    this.child?.kill();
    this.panel?.dispose();
  }
}
