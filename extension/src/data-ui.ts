import { SqlEditor, SQL_TOKEN_CSS } from "./sql-editor";
declare function acquireVsCodeApi(): { postMessage: (m: any) => void };
const vscode = acquireVsCodeApi(),
  app = document.getElementById("app")!;
const esc = (v: any) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icon = (name: string) =>
  `<span class="codicon codicon-${name}" aria-hidden="true"></span>`;
const style = document.createElement("style");
style.nonce = (document.currentScript as HTMLScriptElement).nonce;
style.textContent = `*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:var(--vscode-font-size,13px) var(--vscode-font-family,system-ui)}button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer;padding:7px 10px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:transparent;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:disabled{opacity:.4;cursor:default}.primary{background:var(--vscode-button-background,#0078d4);color:var(--vscode-button-foreground,#fff);border-color:transparent}.primary:hover{background:var(--vscode-button-hoverBackground)}.codicon{font-size:15px}.muted,small{color:var(--vscode-descriptionForeground)}#app{max-width:1500px;margin:auto;padding:22px 24px}header{display:flex;align-items:center;gap:12px;margin-bottom:22px}header>.logo{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}h1{font-size:18px;margin:0 0 3px;font-weight:600}.subtitle{font-size:11px;color:var(--vscode-descriptionForeground)}.spacer{flex:1}.toolbar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:14px}.connection{min-width:190px;padding:7px 9px;border-radius:6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border))}select option{background:var(--vscode-dropdown-background,var(--vscode-editor-background))}.section{border:1px solid var(--vscode-panel-border);border-radius:9px;overflow:hidden;margin-bottom:16px}.section-title{display:flex;align-items:center;gap:8px;padding:10px 13px;background:var(--vscode-sideBar-background);font-size:11px;font-weight:600}.sql-editor{display:block;resize:vertical;width:100%;min-height:112px;max-height:280px;padding:15px;border:0;outline:0;font-family:var(--vscode-editor-font-family,Consolas,monospace);font-size:13px;line-height:1.6;background:var(--vscode-textCodeBlock-background,var(--vscode-editor-background));color:var(--vscode-editor-foreground,var(--vscode-foreground))}.query-actions{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--vscode-panel-border);flex-wrap:wrap}.limit{padding:5px;background:var(--vscode-input-background);border:1px solid var(--vscode-panel-border);border-radius:5px}.query-actions small{font-size:10px}.notice{display:flex;align-items:center;gap:7px;font-size:11px;padding:0 2px 15px;overflow-wrap:anywhere}.notice .codicon-check{color:var(--vscode-testing-iconPassed,#73c991)}.notice .codicon-info{color:var(--vscode-textLink-foreground)}.notice .codicon-error{color:var(--vscode-errorForeground)}.error{padding:10px 12px;margin-bottom:14px;border:1px solid var(--vscode-inputValidation-errorBorder,#be1100);background:var(--vscode-inputValidation-errorBackground);color:var(--vscode-errorForeground);border-radius:7px;white-space:pre-wrap;overflow-wrap:anywhere}.result-head{display:flex;align-items:center;gap:8px;padding:12px;flex-wrap:wrap}.result-head strong{font-size:12px}.badge{font-size:10px;border:1px solid var(--vscode-panel-border);border-radius:20px;padding:3px 7px;color:var(--vscode-descriptionForeground)}.result-head button{font-size:11px;padding:5px 8px}.grid{overflow:auto;max-height:470px;border-top:1px solid var(--vscode-panel-border)}table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;white-space:nowrap}th{position:sticky;top:0;z-index:1;text-align:left;background:var(--vscode-sideBar-background);font-weight:500;color:var(--vscode-descriptionForeground)}th,td{padding:9px 13px;border-bottom:1px solid var(--vscode-panel-border);max-width:450px;overflow:hidden;text-overflow:ellipsis}th:first-child,td:first-child{width:44px;color:var(--vscode-descriptionForeground);font-size:10px;text-align:right}tbody tr:nth-child(even){background:var(--vscode-list-hoverBackground,#ffffff03)}tbody tr:hover{background:var(--vscode-list-hoverBackground,#ffffff08)}td.number{text-align:right;font-variant-numeric:tabular-nums}td.null{font-size:10px;font-style:italic;color:var(--vscode-descriptionForeground)}.pager{display:flex;align-items:center;gap:6px;padding:9px 12px;font-size:10px;color:var(--vscode-descriptionForeground)}.pager button{padding:3px 6px}.empty{text-align:center;padding:44px 15px;color:var(--vscode-descriptionForeground);line-height:1.8}.empty>.codicon{font-size:32px;display:block;margin-bottom:12px}.footnote{font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.7}button:focus-visible,select:focus-visible{outline:1px solid var(--vscode-focusBorder)}@media(max-width:600px){#app{padding:14px 12px}.connection{min-width:150px;flex:1}.query-actions small{width:100%}.result-head .spacer{display:none}.grid{max-height:380px}}`;
style.textContent += SQL_TOKEN_CSS;
document.head.append(style);
let state: any;
let editor: SqlEditor | undefined;
const post = (type: string, extra: any = {}) =>
  vscode.postMessage({ type, ...extra });
function connectionCards(disabled: string) {
  return `<details class="section connection-setup" ${connectionsOpen || !state.profiles.length ? "open" : ""}><summary>Thiết lập kết nối</summary><div class="connection-cards">${[
    ["databricks", "Databricks SQL Warehouse", "Chọn DSN có Host, HTTP Path và xác thực đã cấu hình."],
    ["oracle", "Oracle Data Warehouse", "Chọn DSN có Service Name hoặc TNS đã cấu hình."],
  ].map(([engine, title, hint]) => `<section><strong>${title}</strong><p class="muted">${hint}</p><button data-action="${engine === "oracle" ? "addOracle" : "addDatabricks"}" ${disabled}>${icon("add")}Chọn DSN…</button>${state.profiles.filter((p: any) => p.engine === engine).map((p: any) => `<div class="saved-connection"><span>${esc(p.name)}</span><button data-action="test" data-profile="${esc(p.id)}" ${disabled}>Kiểm tra</button></div>`).join("")}</section>`).join("")}</div></details>`;
}
let connectionsOpen = false;
style.textContent += `.connection-setup>summary{padding:10px 12px;cursor:pointer}.connection-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:10px;padding:0 12px 12px}.connection-cards>section{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:12px}.saved-connection{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;overflow-wrap:anywhere}`;
function render() {
  if (!state) return;
  const r = state.result,
    disabled = state.busy ? "disabled" : "";
  const focused = editor?.view.hasFocus;
  app.innerHTML = `<header><div class="logo">${icon("database")}</div><div><h1>Nopilot Data</h1><div class="subtitle">Databricks · Oracle · SQLite</div></div><span class="spacer"></span><button data-action="migration">${icon("git-compare")}Migration</button><span class="badge" title="Kết nối dùng khi Execute SQL từ chat">${state.defaultProfile ? "Workspace: " + esc(state.profiles.find((p: any) => p.id === state.defaultProfile)?.name ?? "") : "Chưa đặt kết nối workspace"}</span></header>${connectionCards(disabled)}<div class="toolbar"><select class="connection" id="profile" aria-label="Kết nối database" ${disabled}><option value="">Chọn kết nối…</option>${state.profiles.map((p: any) => `<option value="${esc(p.id)}" ${p.id === state.selected ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><button data-action="test" ${!state.selected || state.busy ? "disabled" : ""}>${icon("plug")}Test connection</button><button data-action="${state.defaultProfile && state.defaultProfile === state.selected ? "clearDefault" : "setDefault"}" title="Lưu lựa chọn cho workspace; Execute snippet sẽ không hỏi lại kết nối" ${!state.selected || state.busy ? "disabled" : ""}>${icon(state.defaultProfile && state.defaultProfile === state.selected ? "star-full" : "star-empty")}${state.defaultProfile && state.defaultProfile === state.selected ? "Bỏ mặc định" : "Đặt mặc định workspace"}</button><span class="spacer"></span><button data-action="addSqlite" ${disabled}>${icon("folder-opened")}SQLite</button><button data-action="demo" ${disabled}>${icon("beaker")}Demo</button><button data-action="drivers" title="Kiểm tra ODBC drivers và DSN" aria-label="ODBC drivers" ${disabled}>${icon("info")}</button></div>${state.session?.length ? `<div class="notice"><span>Context: ${esc(state.session.join("; "))}</span><button data-action="clearSession" ${disabled}>Reset context</button></div>` : ""}<section class="section"><div class="section-title">${icon("code")}SQL query<span class="spacer"></span><span class="muted">SELECT · SHOW · USE</span></div><div id="sql-editor"></div><div class="query-actions"><button class="primary" data-action="query" ${!state.selected || state.busy ? "disabled" : ""}>${icon("play")}Run query</button>${state.busy ? `<button data-action="stop">${icon("debug-stop")}Stop</button>` : ""}<button data-action="saveSql" title="Lưu toàn bộ SQL thành file .sql" ${disabled}>${icon("save-as")}Save As…</button><small id="sql-selection">Ctrl+Enter: query hoặc phần được chọn · Ctrl+Space: gợi ý</small><span class="spacer"></span><label><small>Fetch limit</small> <select class="limit" id="limit" aria-label="Fetch limit" ${disabled}>${[1000, 10000, 100000].map((n) => `<option value="${n}" ${n === state.limit ? "selected" : ""}>${n.toLocaleString("en-US")} rows</option>`).join("")}</select></label></div></section><div class="notice">${icon(state.busy ? "loading" : state.error || state.statusKind === "error" ? "error" : state.statusKind === "success" ? "check" : "info")}<span>${esc(state.status)}</span></div>${state.error ? `<div class="error" role="alert">${esc(state.error)}</div>` : ""}<section class="section results">${r ? `<div class="result-head">${icon("table")}<strong>Query results</strong><span class="badge">${r.rowCount.toLocaleString("en-US")} rows · ${r.columns.length} columns</span><span class="badge">${r.elapsedMs} ms</span><span class="spacer"></span><button data-action="showInline" ${disabled}>${icon("comment-discussion")}Show in chat</button><button data-action="exportCsv" ${r.commandOnly ? "disabled" : disabled}>${icon("export")}CSV</button><button data-action="exportXlsx" ${r.commandOnly ? "disabled" : disabled}>${icon("file-excel")}Excel</button></div><div class="grid"><table aria-label="Query results"><thead><tr><th>#</th>${r.columns.map((c: any) => `<th title="${esc(c.type)}">${esc(c.name)}</th>`).join("")}</tr></thead><tbody>${r.rows.map((row: any[], i: number) => `<tr><td>${r.offset + i + 1}</td>${row.map((v) => `<td class="${v === null ? "null" : typeof v === "number" ? "number" : ""}" title="${esc(v === null ? "NULL" : v)}">${v === null ? "NULL" : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>${!r.rows.length ? `<div class="empty">${r.commandOnly ? "Đã áp dụng USE context cho các query tiếp theo." : "Query không trả dòng nào."}</div>` : ""}</div><div class="pager"><span>${r.rowCount ? r.offset + 1 : 0}–${Math.min(r.offset + r.rows.length, r.rowCount)} / ${r.rowCount} rows${r.truncated ? " · Chạm fetch limit; export chỉ gồm các dòng đã lấy." : ""}</span><span class="spacer"></span><button data-action="previous" aria-label="Trang trước" ${r.offset === 0 || state.busy ? "disabled" : ""}>${icon("chevron-left")}</button><button data-action="next" aria-label="Trang sau" ${r.offset + r.pageSize >= r.rowCount || state.busy ? "disabled" : ""}>${icon("chevron-right")}</button></div>` : `<div class="empty">${icon("table")}Chạy query để xem dữ liệu tại đây.<br><small>Chọn Demo để thử với SQLite local gồm 150 dòng.</small></div>`}</section><div class="footnote">Kết quả và exports ở máy local; không tự gửi Copilot. Dùng DSN/tài khoản chỉ có quyền đọc. CSV bảo vệ chuỗi công thức; Excel giữ chuỗi là dữ liệu.</div>`;
  const setup = app.querySelector<HTMLDetailsElement>(".connection-setup")!;
  setup.ontoggle = () => { if (setup.isConnected) connectionsOpen = setup.open; };
  const host = document.getElementById("sql-editor")!;
  if (!editor)
    editor = new SqlEditor(
      host,
      state.sql || "",
      style.nonce ?? "",
      (doc) => {
        state.sql = doc;
        post("draft", { sql: doc });
      },
      run,
      selectionLabel,
    );
  else host.append(editor.view.dom);
  editor.sync(
    state.sql || "",
    !!state.busy,
    (r?.columns ?? []).map((column: any) => column.name),
  );
  selectionLabel();
  if (focused) editor.view.focus();
  document
    .getElementById("profile")!
    .addEventListener("change", (e) =>
      post("select", { id: (e.target as HTMLSelectElement).value }),
    );
  app.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach(
    (b) =>
      (b.onclick = () => {
        const action = b.dataset.action;
        if (action === "query") run();
        else if (action === "saveSql")
          post("saveSql", { document: editor!.document });
        else if (action === "exportCsv" || action === "exportXlsx")
          post("export", {
            id: r.id,
            format: action === "exportCsv" ? "csv" : "xlsx",
          });
        else if (action === "previous" || action === "next")
          post("page", {
            id: r.id,
            offset: Math.max(0, r.offset + (action === "next" ? 50 : -50)),
          });
        else post(action!, b.dataset.profile ? { id: b.dataset.profile } : {});
      }),
  );
}
function selectionLabel() {
  const label = document.getElementById("sql-selection");
  if (label)
    label.textContent = editor?.hasSelection
      ? "Ctrl+Enter: chạy phần được chọn"
      : "Ctrl+Enter: chạy SQL · Ctrl+Space: gợi ý";
}
function run() {
  if (!editor || state.busy || !state.selected) return;
  post("query", {
    sql: editor.selectedSql,
    document: editor.document,
    limit: Number(
      (document.getElementById("limit") as HTMLSelectElement).value,
    ),
  });
}
window.addEventListener("message", (event) => {
  if (event.data.type === "snapshot") {
    state = event.data.state;
    render();
  }
});
window.addEventListener("pagehide", () => editor?.view.destroy());
post("ready");
