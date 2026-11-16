import { SqlEditor, SQL_TOKEN_CSS } from "./sql-editor";
declare function acquireVsCodeApi(): { postMessage: (m: any) => void };
const api = acquireVsCodeApi(),
  app = document.getElementById("app")!;
const nonce = (document.currentScript as HTMLScriptElement).nonce;
const style = document.createElement("style");
style.nonce = nonce;
style.textContent =
  `
*{box-sizing:border-box}body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font:13px var(--vscode-font-family,system-ui)}button,input,select,textarea{font:inherit;color:inherit}button{border:1px solid var(--vscode-panel-border);background:var(--vscode-button-secondaryBackground);padding:7px 10px;border-radius:6px;cursor:pointer}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:disabled{opacity:.45;cursor:default}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}input,select,textarea{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));padding:7px;border-radius:4px;min-width:0}input[type=checkbox]{accent-color:var(--vscode-button-background)}button:focus-visible,input:focus,textarea:focus,select:focus{outline:1px solid var(--vscode-focusBorder)}header{padding:16px 20px;border-bottom:1px solid var(--vscode-panel-border);display:flex;align-items:center;gap:10px}h1{font-size:18px;margin:0}h2{font-size:14px;margin:0}.muted,small{color:var(--vscode-descriptionForeground)}.grow{flex:1}.layout{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:calc(100vh - 64px)}aside{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:15px 10px;background:var(--vscode-sideBar-background);border-right:1px solid var(--vscode-panel-border)}aside button{display:block;width:100%;text-align:left;margin-bottom:6px;background:transparent;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}aside .active{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}main{padding:18px;min-width:0}.toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}.name{flex:1;font-size:16px;font-weight:600}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pane,.box{border:1px solid var(--vscode-panel-border);border-radius:8px;overflow:hidden;margin-bottom:14px}.pane-head{padding:10px;display:flex;align-items:center;gap:8px;background:var(--vscode-sideBar-background)}.pane-head select{flex:1;width:100px}.pane label{font-weight:600}.cm-scroller{min-height:230px!important;max-height:380px!important}.settings{padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px}.settings label{display:flex;gap:6px;flex-direction:column}.settings .check{flex-direction:row;align-items:center}.settings textarea{height:64px;resize:vertical;font-family:var(--vscode-editor-font-family,monospace)}details{border-top:1px solid var(--vscode-panel-border);padding:10px}summary{cursor:pointer;color:var(--vscode-textLink-foreground)}.notice{padding:11px 13px;margin-bottom:12px;border-radius:6px;background:var(--vscode-textBlockQuote-background);line-height:1.7;overflow-wrap:anywhere}.error{color:var(--vscode-errorForeground);border:1px solid var(--vscode-inputValidation-errorBorder)}.status{font-size:12px;margin-bottom:12px;line-height:1.7}.spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--vscode-descriptionForeground);border-right-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin-right:7px}@keyframes spin{to{transform:rotate(360deg)}}.tabs{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--vscode-panel-border);flex-wrap:wrap}.tabs .active{border-color:var(--vscode-focusBorder);color:var(--vscode-textLink-foreground)}.result{padding:12px}.badge{display:inline-block;padding:4px 8px;border:1px solid var(--vscode-panel-border);border-radius:15px;font-size:12px}.pass{color:var(--vscode-testing-iconPassed,#73c991)}.fail{color:var(--vscode-testing-iconFailed,#f48771)}.inconclusive{color:var(--vscode-editorWarning-foreground,#cca700)}.grid{overflow:auto;max-height:430px}table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--vscode-panel-border);max-width:450px;overflow:hidden;text-overflow:ellipsis}th{background:var(--vscode-sideBar-background);position:sticky;top:0;z-index:1}td.changed{background:var(--vscode-diffEditor-removedTextBackground,#ff000022)}tr:hover{background:var(--vscode-list-hoverBackground)}.pager{display:flex;gap:7px;align-items:center;margin-top:12px}.empty{padding:55px 25px;text-align:center;line-height:2;color:var(--vscode-descriptionForeground)}pre{white-space:pre-wrap;overflow-wrap:anywhere}.schema{max-height:180px;overflow:auto}.schema div{padding:5px}footer{font-size:11px;line-height:1.8;color:var(--vscode-descriptionForeground);margin-top:15px}@media(max-width:900px){.layout{grid-template-columns:150px minmax(0,1fr)}.pair,.settings{grid-template-columns:1fr}main{padding:12px}header{flex-wrap:wrap}}` +
  SQL_TOKEN_CSS + `.diff-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0}.diff-summary>div{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:10px 14px;background:var(--vscode-sideBar-background)}.diff-summary strong{display:block;font-size:22px;margin-top:3px;font-variant-numeric:tabular-nums}.data-diff td{white-space:pre-wrap;overflow-wrap:anywhere}.data-diff tbody+tbody{border-top:3px solid var(--vscode-panel-border)}.data-diff td[rowspan]{vertical-align:top}.diff-before{background:var(--vscode-diffEditor-removedTextBackground,#ff000022)}.diff-after{background:var(--vscode-diffEditor-insertedTextBackground,#00aa0022)}`;
document.head.append(style);
const esc = (v: any) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const post = (type: string, extra: any = {}) =>
  api.postMessage({ type, ...extra });
let state: any,
  editors: Record<string, SqlEditor> = {},
  reportId = "",
  tab = "diff",
  timer: any;
const briefConsent = new Set<string>();
const labels: Record<string, string> = {
  pass: "Đạt",
  fail: "Có sai khác",
  inconclusive: "Chưa kết luận",
};
function values() {
  const result: any = {};
  app
    .querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("[data-field]")
    .forEach((el) => {
      result[el.dataset.field!] =
        el instanceof HTMLInputElement && el.type === "checkbox"
          ? el.checked
          : el.value;
    });
  result.limit = Number(result.limit);
  for (const side of ["source", "target"])
    if (editors[side]) result[side + "Sql"] = editors[side].document;
  return result;
}
function draft() {
  const v = values();
  if (state?.report) Object.assign(state.report, v);
  const stale = document.getElementById("stale");
  if (stale && state?.run) stale.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => post("draft", { values: v }), 150);
}
function field(name: string, label: string, placeholder = "") {
  return `<label>${label}<input data-field="${name}" value="${esc(state.report[name])}" placeholder="${esc(placeholder)}" ${state.busy ? "disabled" : ""}></label>`;
}
function render() {
  if (!state) return;
  const r = state.report,
    disabled = state.busy ? "disabled" : "";
  if (reportId !== (r?.id ?? "")) {
    tab = "diff";
    Object.values(editors).forEach((e) => e.view.destroy());
    editors = {};
    reportId = r?.id ?? "";
  }
  const focusedSide = Object.keys(editors).find(
    (s) => editors[s].view.hasFocus,
  );
  app.innerHTML = `<header><h1>Nopilot Migration</h1><span class="muted">Warehouse → Databricks</span><span class="grow"></span><button data-action="detach">Mở cửa sổ riêng ↗</button><button data-action="guide">Hướng dẫn</button><button data-action="data">Kết nối / Data</button><button data-action="refresh" ${disabled}>Làm mới kết nối</button><button data-action="demo" ${disabled}>Thử demo local</button></header><div class="layout"><aside><button class="primary" data-action="new" ${disabled}>＋ Báo cáo mới</button><button data-action="import" ${disabled}>Mở định nghĩa…</button>${state.reports.map((x: any) => `<button class="${x.id === state.selected ? "active" : ""}" data-report="${esc(x.id)}" ${disabled} title="${esc(x.name)}">${esc(x.name || "Chưa đặt tên")}</button>`).join("")}<small>SQL và cấu hình tự lưu theo workspace. Nhân bản để lưu một bộ tham số kiểm thử khác.</small></aside><main>${r ? `<div class="toolbar"><input class="name" data-field="name" aria-label="Tên báo cáo" value="${esc(r.name)}" ${disabled}><button data-action="duplicate" ${disabled}>Nhân bản</button><button data-action="save" ${disabled}>Save As…</button><button data-action="delete" ${disabled}>Xóa</button></div><div class="pair">${["source", "target"].map((side) => `<section class="pane"><div class="pane-head"><label>${side === "source" ? "Nguồn" : "Databricks / Đích"}</label><select data-field="${side}" aria-label="Kết nối ${side}" ${disabled}><option value="">Chọn kết nối…</option>${state.profiles.map((p: any) => `<option value="${esc(p.id)}" ${r[side] === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><button data-schema="${side}" ${disabled}>Schema</button></div><div id="editor-${side}"></div>${state.schema[side] ? `<details open><summary>Metadata · ${state.schema[side].tables.length} bảng${state.schema[side].truncated ? " (giới hạn 200)" : ""}</summary><div class="schema">${state.schema[side].tables.map((t: any) => `<div><strong>${esc([t.catalog, t.schema, t.name].filter(Boolean).join("."))}</strong>${t.columns ? `<small> · ${t.columns.map((c: any) => `${esc(c.name)} ${esc(c.type)}`).join(", ")}</small>` : ""}</div>`).join("")}</div></details>` : ""}</section>`).join("")}</div><section class="box"><details class="brief" ${document.querySelector("details.brief[open]") ? "open" : ""}><summary>Code Brief</summary><div class="settings"><label>Quy tắc nghiệp vụ<textarea data-field="codeBrief" maxlength="12000" placeholder="Nguồn báo cáo · bảng/cột · join/filter · công thức · file:dòng" ${disabled}>${esc(r.codeBrief)}</textarea></label><label class="check"><input type="checkbox" id="brief-consent" ${briefConsent.has(r.id) ? "checked" : ""} ${disabled}>Thêm brief vào bản nháp Copilot</label></div></details><details><summary>Mapping, khóa và quy tắc đối chiếu</summary><div class="settings"><label>Mapping cột (để trống: cùng tên)<textarea data-field="mapping" placeholder="old_column=new_column\namount=revenue" ${disabled}>${esc(r.mapping)}</textarea></label><div>${field("keys", "Khóa duy nhất phía nguồn", "order_id hoặc region,month")}${field("numeric", "Cột nguồn so như số (Decimal)", "revenue,quantity")}</div>${field("tolerance", "Sai số tuyệt đối cho cột numeric", "0")}${field("caseName", "Tên bộ kiểm thử", "Tháng 10 / toàn bộ vùng")}<label class="check"><input type="checkbox" data-field="trim" ${r.trim ? "checked" : ""} ${disabled}>Bỏ khoảng trắng đầu/cuối chuỗi</label><small>NULL khác chuỗi rỗng. Không tự đổi hoa/thường hay múi giờ. Không có khóa: so đa tập, giữ số lần xuất hiện của dòng. Tolerance &gt; 0 cần khóa duy nhất.</small></div></details><div class="settings">${field("cutoff", "Tham số / mốc dữ liệu", "Cùng tháng báo cáo, timezone và thời điểm đồng bộ")}<label>Giới hạn lấy dữ liệu mỗi bên<select data-field="limit" ${disabled}>${[1000, 10000, 100000].map((n) => `<option ${r.limit === n ? "selected" : ""} value="${n}">${n.toLocaleString()} dòng</option>`).join("")}</select></label><label class="check"><input type="checkbox" data-field="sameCutoff" ${r.sameCutoff ? "checked" : ""} ${disabled}>Tôi xác nhận hai bên cùng mốc dữ liệu và tham số</label><small>Query tuần tự nguồn rồi đích. Dữ liệu biến động cần snapshot hoặc điều kiện thời gian cố định.</small></div></section><div class="toolbar"><button class="primary" data-action="run" ${disabled}>▶ Chạy đối chiếu</button>${state.busy ? `<button data-action="stop">■ Dừng</button>` : ""}<button data-action="copilot" ${disabled}>Nhờ Copilot chuyển / sửa SQL…</button><small>Ctrl+Enter trong editor: chạy đối chiếu cả hai câu SQL</small></div>` : `<div class="empty"><h2>Migrate từng báo cáo, kiểm chứng từng thay đổi</h2>Chọn “Báo cáo mới” để bắt đầu với hai kết nối đã lưu.<br>Hoặc “Thử demo local” để trải nghiệm luồng đối chiếu ngay.</div>`}<div class="status" role="status">${state.busy ? '<span class="spinner"></span>' : ""}${esc(state.status)}</div>${state.error ? `<div class="notice error" role="alert">${esc(state.error)}</div>` : ""}${
    r
      ? `<section class="box"><nav class="tabs">${[
          ["diff", "Sai khác"],
          ["source", "Kết quả nguồn"],
          ["target", "Kết quả đích"],
          ["performance", "Hiệu năng"],
          ["history", "Lịch sử"],
        ]
          .map(
            ([id, name]) =>
              `<button data-tab="${id}" class="${id === tab ? "active" : ""}">${name}</button>`,
          )
          .join(
            "",
          )}</nav><div class="result" id="result">${resultMarkup()}</div></section><footer>Snapshot và dữ liệu ở máy local. Nhờ Copilot chỉ tạo bản nháp SQL + số liệu tóm tắt, không tự gửi hàng dữ liệu. Kết nối dùng lại SecretStorage của Data. Đối chiếu kỹ thuật không thay thế UAT báo cáo.</footer>`
      : ""
  }</main></div>`;
  if (r)
    for (const side of ["source", "target"]) {
      const host = document.getElementById("editor-" + side)!;
      if (!editors[side])
        editors[side] = new SqlEditor(
          host,
          r[side + "Sql"],
          nonce ?? "",
          draft,
          run,
          () => {},
        );
      else host.append(editors[side].view.dom);
      editors[side].sync(
        r[side + "Sql"],
        state.busy,
        state.schema[side]?.tables.flatMap((t: any) =>
          (t.columns ?? []).map((c: any) => c.name),
        ) ?? [],
      );
    }
  if (focusedSide) editors[focusedSide]?.view.focus();
  app
    .querySelectorAll<HTMLElement>("[data-field]")
    .forEach((el) =>
      el.addEventListener(
        el.tagName === "SELECT" || (el as HTMLInputElement).type === "checkbox"
          ? "change"
          : "input",
        draft,
      ),
    );
}
function grid(columns: string[], rows: any[][], offset = 0) {
  return `<div class="grid"><table><thead><tr><th>#</th>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, i) => `<tr><td>${offset + i + 1}</td>${row.map((v) => `<td title="${esc(v)}">${v === null ? '<i class="muted">NULL</i>' : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function resultMarkup() {
  if (tab === "history")
    return state.history.length
      ? `<div class="grid"><table><thead><tr><th>Thời gian</th><th>Bộ kiểm thử</th><th>Trạng thái</th><th>Thiếu / Thừa / Khác</th><th></th></tr></thead><tbody>${state.history.map((h: any) => `<tr><td>${esc(new Date(h.createdAt).toLocaleString())}</td><td>${esc(h.caseName)}</td><td class="${h.status}">${labels[h.status]}</td><td>${h.missing} / ${h.extra} / ${h.changed}</td><td><button data-history="${esc(h.id)}" ${state.busy ? "disabled" : ""}>Xem lượt này</button></td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty">Chưa có lượt đối chiếu.</div>';
  const run = state.run,
    c = run?.comparison;
  if (!c)
    return '<div class="empty">Chạy đối chiếu để xem kết quả và sai khác tại đây.</div>';
  const banner = `<div class="notice" id="stale" ${state.stale ? "" : "hidden"}>SQL hoặc tùy chọn đã thay đổi. Đây là kết quả của lượt cũ; chạy lại trước khi kết luận.</div><div class="toolbar"><strong class="badge ${c.status}">${labels[c.status]}</strong><small>${esc(new Date(run.createdAt).toLocaleString())} · ${esc(run.report.caseName)}</small></div><details><summary>Bằng chứng · SQL và cấu hình của lượt này</summary><p><code>${esc(run.id)}</code></p><pre>${esc(JSON.stringify(Object.fromEntries(Object.entries(run.report).filter(([key]) => key !== "codeBrief")), null, 2))}</pre></details>`;
  if (tab === "source" || tab === "target") {
    const r = run[tab];
    return (
      banner +
      `<div class="toolbar"><span>${r.rowCount} dòng${r.truncated ? " · CHẠM FETCH LIMIT" : ""} · ${r.elapsedMs} ms</span><span class="grow"></span><button data-export="csv">CSV</button><button data-export="xlsx">Excel</button></div>` +
      grid(
        r.columns.map((c: any) => c.name),
        r.rows,
        r.offset,
      ) +
      `<div class="pager"><button data-page="${Math.max(0, r.offset - 50)}" ${r.offset === 0 || state.busy ? "disabled" : ""}>←</button><span>${r.rowCount ? r.offset + 1 : 0}–${r.offset + r.rows.length} / ${r.rowCount}</span><button data-page="${r.offset + 50}" ${r.offset + r.rows.length >= r.rowCount || state.busy ? "disabled" : ""}>→</button></div>`
    );
  }
  if (tab === "performance")
    return (
      banner +
      grid(
        ["Phía", "Số dòng đã lấy", "Thời gian execute + fetch (ms)"],
        [
          ["Nguồn", c.sourceRows, c.sourceMs],
          ["Đích", c.targetRows, c.targetMs],
        ],
      ) +
      '<p class="muted">Không phải benchmark đồng thời. Cache, mạng, warehouse và thời điểm chạy có thể khác nhau.</p>'
    );
  return (
    banner +
    `<div class="diff-summary">${[["Thiếu ở đích", c.missing], ["Thừa ở đích", c.extra], ["Khác giá trị", c.changed]].map(([label, count]) => `<div><small>${label}</small><strong>${count}</strong></div>`).join("")}</div>
    <p class="muted">Nguồn ${c.sourceRows} dòng · Đích ${c.targetRows} dòng · ${c.mode === "key" ? "Ghép khóa" : "So toàn dòng"}${c.duplicateSource || c.duplicateTarget ? ` · Dòng có khóa trùng: ${c.duplicateSource} / ${c.duplicateTarget}` : ""}</p>
    ${c.reasons.map((reason: string) => `<div class="notice inconclusive">${esc(reason)}</div>`).join("")}
    ${dataDiff(c)}
    <p class="muted">Hiện tối đa ${c.sampleLimit} mẫu sai khác. Số đếm tính trên toàn bộ snapshot đã lấy.</p>`
  );
}
function dataDiff(c: any) {
  if (!c.samples.length) return '<p class="empty">Không có mẫu sai khác.</p>';
  const kindLabels: Record<string, string> = { missing: "Thiếu", extra: "Thừa", changed: "Khác" };
  const cell = (row: any[] | null, index: number) =>
    !row ? '<span class="muted">—</span>' :
      row[index] === null ? "<i>NULL</i>" :
        row[index] === "" ? '<span class="muted">""</span>' : esc(row[index]);
  return `<div class="grid"><table class="data-diff"><thead><tr><th>Loại</th><th>Cột</th><th>Nguồn</th><th>Đích</th></tr></thead>${c.samples.map((sample: any) => `<tbody>${c.columns.map((name: string, i: number) => {
    const changed = sample.columns.includes(name);
    return `<tr>${i === 0 ? `<td rowspan="${c.columns.length}"><strong>${kindLabels[sample.kind] || esc(sample.kind)}</strong></td>` : ""}<td>${esc(name)}</td><td class="${changed || sample.kind === "missing" ? "diff-before" : ""}">${cell(sample.source, i)}</td><td class="${changed || sample.kind === "extra" ? "diff-after" : ""}">${cell(sample.target, i)}</td></tr>`;
  }).join("")}</tbody>`).join("")}</table></div>`;
}
function run() {
  if (!state?.busy) {
    clearTimeout(timer);
    post("run", { values: values() });
  }
}
app.addEventListener("click", (event) => {
  const b = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!b || b.disabled) return;
  clearTimeout(timer);
  if (b.dataset.tab) {
    if (state.report && !state.busy) post("draft", { values: values() });
    tab = b.dataset.tab;
    render();
    return;
  }
  if (b.dataset.report) {
    post("select", { id: b.dataset.report, values: values() });
    return;
  }
  if (b.dataset.schema) {
    post("schema", { side: b.dataset.schema, values: values() });
    return;
  }
  if (b.dataset.history) {
    tab = "diff";
    post("history", { id: b.dataset.history });
    return;
  }
  if (b.dataset.page) {
    post("page", { side: tab, offset: Number(b.dataset.page) });
    return;
  }
  if (b.dataset.export) {
    post("export", { side: tab, format: b.dataset.export });
    return;
  }
  const action = b.dataset.action;
  if (!action) return;
  if (action === "run") run();
  else post(action, state.report ? { values: values(), ...(action === "copilot" ? { includeBrief: briefConsent.has(state.report.id) } : {}) } : {});
});
app.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "brief-consent") {
    if (input.checked) briefConsent.add(state.report.id);
    else briefConsent.delete(state.report.id);
  }
});
window.addEventListener("message", (e) => {
  if (e.data.type === "snapshot") {
    state = e.data.state;
    render();
  }
});
window.addEventListener("pagehide", () => {
  clearTimeout(timer);
  Object.values(editors).forEach((e) => e.view.destroy());
});
post("ready");
