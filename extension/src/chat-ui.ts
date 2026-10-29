import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/common";
import {
  CONTEXT,
  COMMANDS,
  detectTrigger,
  suggestions,
  Suggestion,
} from "./autocomplete";
declare function acquireVsCodeApi(): {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
};
const vscode = acquireVsCodeApi(),
  app = document.getElementById("app")!;
const esc = (value: any) => md.utils.escapeHtml(String(value ?? ""));
const icon = (name: string) =>
  `<span class="codicon codicon-${name}" aria-hidden="true"></span>`;
const button = (
  action: string,
  name: string,
  label: string,
  extra = "",
  classes = "",
) =>
  `<button class="icon-button ${classes}" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}" ${extra}>${icon(name)}</button>`;
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight: (code, language) => {
    if (language === "json") {
      try {
        code = JSON.stringify(JSON.parse(code), null, 2);
      } catch {}
    }
    return code.length < 30000 && hljs.getLanguage(language)
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value
      : "";
  },
});
md.renderer.rules.image = (tokens, index) =>
  `<span>[Ảnh: ${esc(tokens[index].content)}]</span>`;
const post = (type: string, extra: any = {}) =>
  vscode.postMessage({ type, ...extra });
let state: any,
  error = "",
  historyOpen = false,
  trash = false,
  historyQuery = "",
  atBottom = true;
type Menu = {
  kind: "context" | "commands" | "add" | "more" | "project";
  query: string;
  start: number;
  end: number;
  typed: boolean;
  selected: number;
};
let menu: Menu | undefined;
const expandedActivities = new Set<string>();
const expandedArtifacts = new Set<string>();
const style = document.createElement("style");
style.nonce = (document.currentScript as HTMLScriptElement).nonce;
style.textContent = `
*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-sideBar-background,var(--vscode-editor-background));font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);height:100vh}button,input,textarea,select{font:inherit}button{cursor:pointer;border:1px solid transparent;border-radius:5px;padding:6px 9px;color:inherit;background:transparent}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}.icon-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:4px;flex:none}.codicon{font-size:16px;line-height:1;vertical-align:middle}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.primary:hover{background:var(--vscode-button-hoverBackground)}.danger{color:var(--vscode-errorForeground)}.muted,small{color:var(--vscode-descriptionForeground)}.spacer{flex:1}.active{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}#app{height:100vh;display:flex;flex-direction:column}header{position:relative;padding:8px 12px 9px;border-bottom:1px solid var(--vscode-panel-border)}.header-row{display:flex;gap:3px;align-items:center}.title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:600}.status{display:flex;align-items:center;gap:6px;color:var(--vscode-descriptionForeground);font-size:10px;margin-top:4px;min-height:14px}.status-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dot{width:5px;height:5px;border-radius:50%;background:var(--vscode-descriptionForeground);flex:none}.connected .dot{background:var(--vscode-testing-iconPassed)}.busy .dot{background:var(--vscode-progressBar-background);animation:pulse 1s infinite}@keyframes pulse{50%{opacity:.3}}main{flex:1;min-height:0;overflow:auto;padding:18px 14px}.welcome{height:100%;min-height:220px;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;color:var(--vscode-descriptionForeground);padding:20px}.welcome-symbol{position:relative;margin-bottom:20px;opacity:.65}.welcome-symbol>.codicon{font-size:48px}.welcome-symbol>.spark{position:absolute;right:-12px;top:-6px;background:var(--vscode-sideBar-background);padding:2px}.welcome-symbol>.spark .codicon{font-size:22px}.welcome h2{font-size:16px;font-weight:600;color:var(--vscode-foreground);margin:0 0 10px}.welcome p{line-height:1.6;font-size:12px;margin:0 0 14px;max-width:280px}.welcome .connect{margin:4px 0 14px}.welcome .hint{font-size:11px}.message{max-width:920px;margin:0 auto 20px;overflow-wrap:anywhere;line-height:1.6}.message-label{display:flex;align-items:center;gap:6px;color:var(--vscode-descriptionForeground);font-size:11px;margin-bottom:6px}.message-label .codicon{font-size:13px}.message.user .message-body{padding:10px 12px;border-radius:9px;background:var(--vscode-input-background);white-space:pre-wrap}.message.system{font-size:11px;color:var(--vscode-descriptionForeground);padding-left:10px;border-left:2px solid var(--vscode-panel-border)}.message-body p:first-child{margin-top:0}.message-body p:last-child{margin-bottom:0}a{color:var(--vscode-textLink-foreground)}pre{position:relative;overflow:auto;padding:12px;border-radius:6px;background:var(--vscode-textCodeBlock-background);font-family:var(--vscode-editor-font-family);font-size:12px;line-height:1.5}code{font-family:var(--vscode-editor-font-family)}:not(pre)>code{background:var(--vscode-textCodeBlock-background);border-radius:3px;padding:1px 4px}pre>.copy{position:sticky;top:0;float:right;background:var(--vscode-editor-background);width:23px;height:23px;margin:-5px -5px 3px 8px}blockquote{border-left:3px solid var(--vscode-textBlockQuote-border);padding-left:10px;margin-left:0}table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}td,th{border:1px solid var(--vscode-panel-border);padding:6px}.hljs-keyword,.hljs-selector-tag{color:var(--vscode-symbolIcon-keywordForeground,#c586c0)}.hljs-string,.hljs-attr{color:var(--vscode-debugTokenExpression-string,#ce9178)}.hljs-number,.hljs-literal{color:var(--vscode-debugTokenExpression-number,#b5cea8)}.hljs-comment{color:var(--vscode-descriptionForeground);font-style:italic}details{margin:8px 0;font-size:12px}summary{cursor:pointer;color:var(--vscode-descriptionForeground)}.card{max-width:920px;margin:8px auto 18px;border:1px solid var(--vscode-panel-border);border-radius:8px;padding:12px}.card-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;margin-bottom:9px}.card p{font-size:11px;line-height:1.6}.card pre{max-height:210px;font-size:11px}.card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px}.card-actions>button:not(.icon-button){font-size:12px}.changed-file{display:flex;align-items:center;gap:7px;font-size:12px;padding:3px 0}.artifact{display:flex;align-items:center;gap:7px;padding:7px 0;border-top:1px solid var(--vscode-panel-border)}.artifact:first-of-type{border-top:0}.artifact-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}.artifact small{font-size:10px}.project-actions{display:flex;gap:5px;align-items:center;margin-top:9px}.project-actions .run{font-size:12px}.project-actions .run>.codicon{font-size:13px;margin-right:5px}footer{position:relative;padding:6px 12px 8px}.composer{position:relative;border:1px solid var(--vscode-input-border,transparent);border-radius:12px;background:var(--vscode-input-background);padding:8px}.composer:focus-within{border-color:var(--vscode-focusBorder)}textarea{display:block;width:100%;min-height:70px;max-height:190px;resize:none;border:0;outline:0;background:transparent;color:var(--vscode-input-foreground);font:inherit;line-height:1.5;padding:5px 4px 9px}textarea::placeholder{color:var(--vscode-input-placeholderForeground)}.composer-actions{display:flex;align-items:center;gap:3px;min-height:28px}.mode{display:flex;align-items:center;gap:4px;padding:0 3px}.mode>.codicon{font-size:14px;color:var(--vscode-descriptionForeground)}select{max-width:100px;border:0;background:transparent;color:var(--vscode-foreground);font-size:12px;padding:4px 1px;cursor:pointer}select option{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground)}.toggle-on{color:var(--vscode-textLink-foreground);background:var(--vscode-toolbar-activeBackground)}.send{border-radius:6px}.footer-meta{display:flex;align-items:center;gap:10px;min-height:24px;padding:4px 2px 0;font-size:10px;color:var(--vscode-descriptionForeground)}.footer-meta .codicon{font-size:12px;margin-right:4px}.footer-meta button{display:inline-flex;align-items:center;font-size:10px;padding:1px 0;color:var(--vscode-descriptionForeground)}.chips{display:flex;gap:5px;flex-wrap:wrap;padding:0 3px}.chip{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:100%;font-size:10px;border:1px solid var(--vscode-panel-border);border-radius:5px;padding:3px 4px;margin-bottom:5px}.chip>.codicon{font-size:12px}.chip-label{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:170px}.chip .icon-button{width:18px;height:18px;padding:0}.chip .icon-button .codicon{font-size:12px}.chip img{width:34px;height:26px;object-fit:contain;border-radius:2px}.error{display:flex;gap:6px;color:var(--vscode-errorForeground);font-size:11px;padding:5px 3px 9px}.popover{position:absolute;bottom:calc(100% + 8px);left:0;right:0;z-index:10;max-height:min(330px,55vh);overflow:auto;padding:5px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:8px;box-shadow:0 6px 18px var(--vscode-widget-shadow,rgba(0,0,0,.28))}.header-popover{top:34px;bottom:auto;left:auto;right:8px;width:min(290px,calc(100vw - 24px))}.popover-title{font-size:10px;color:var(--vscode-descriptionForeground);padding:5px 7px 7px;text-transform:uppercase;letter-spacing:.06em}.suggestion{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border-radius:5px;padding:8px}.suggestion.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.suggestion .codicon{font-size:16px;flex:none}.suggestion-text{display:flex;flex-direction:column;gap:2px;min-width:0}.suggestion-label{font-size:12px}.suggestion-detail{font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.4}.selected .suggestion-detail{color:inherit;opacity:.75}.popover-hint{padding:6px 8px 2px;color:var(--vscode-descriptionForeground);font-size:9px;border-top:1px solid var(--vscode-panel-border);margin-top:4px}.no-results{padding:12px;font-size:11px;color:var(--vscode-descriptionForeground)}.history{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;background:var(--vscode-sideBar-background,var(--vscode-editor-background))}.history header{display:flex;align-items:center;gap:3px}.history-search{position:relative;margin:10px 12px}.history-search>.codicon{position:absolute;left:8px;top:8px;font-size:14px;color:var(--vscode-descriptionForeground)}.history-search input{width:100%;border:1px solid var(--vscode-input-border,transparent);padding:7px 8px 7px 29px;border-radius:5px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font:inherit;font-size:12px}.history-list{padding:0 10px;overflow:auto;flex:1}.history-item{padding:7px 3px;border-bottom:1px solid var(--vscode-panel-border)}.history-line{display:flex;align-items:center;gap:4px}.history-open{flex:1;min-width:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;padding:5px}.history-open>.codicon{font-size:12px;margin-right:6px}.history-actions{display:flex;gap:1px}.history-item small{font-size:10px;padding-left:6px}.history-note{padding:10px 13px;font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.6}@media(max-width:360px){header{padding-left:10px;padding-right:10px}main{padding:12px 10px}footer{padding:5px 8px 8px}.suggestion{padding:7px}.history-actions .icon-button{width:25px}}`;
style.textContent += `
.activity{padding:0;overflow:hidden}.activity summary{display:flex;align-items:center;gap:8px;padding:11px;list-style:none;color:var(--vscode-foreground)}.activity summary::-webkit-details-marker{display:none}.activity summary .activity-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity[open] .chevron{transform:rotate(90deg)}.activity-body{padding:0 11px 11px}.activity pre{max-height:300px;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.activity small{font-size:10px}.queue{margin:0 0 7px;border:1px solid var(--vscode-panel-border);border-radius:8px;max-height:190px;overflow:auto}.queue-head,.queue-row{display:flex;align-items:center;gap:4px;padding:4px 7px;font-size:11px}.queue-head{color:var(--vscode-descriptionForeground)}.queue-row{border-top:1px solid var(--vscode-panel-border)}.queue-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.queue-row .icon-button{width:23px;height:23px}.voice-state{display:flex;align-items:center;gap:5px;padding:5px;font-size:11px;overflow-wrap:anywhere}.recording{color:var(--vscode-errorForeground)}.recording .codicon{animation:pulse 1s infinite}.voice-state>span{flex:1}.activity-error{color:var(--vscode-errorForeground);font-size:11px}.menu-group{font-size:9px;color:var(--vscode-descriptionForeground);text-transform:uppercase;padding:7px 8px 3px}
`;
style.textContent += `.artifacts-card{padding:0}.artifacts-card>summary{display:flex;align-items:center;gap:8px;padding:10px;color:var(--vscode-foreground);list-style:none}.artifacts-card summary::-webkit-details-marker{display:none}.artifact-list{max-height:220px;overflow:auto;padding:0 10px 8px}.artifacts-card[open]>summary .codicon-chevron-right{transform:rotate(90deg)}.artifact-list .artifact{min-height:36px}`;
document.head.append(style);

function contextChips(c: any) {
  const visible = c.files.slice(0, 4);
  return (
    visible
      .map(
        (f: any) =>
          `<div class="chip">${icon("file-code")}<span class="chip-label" title="${esc(f.path)}">${esc(f.path.split("/").at(-1))}</span>${button("removeContext", "close", "Bỏ context " + f.path, `data-path="${esc(f.path)}"`)}</div>`,
      )
      .join("") +
    (c.files.length > 4
      ? `<button class="chip" data-action="previewContext" title="Xem toàn bộ context">+${c.files.length - 4} files</button>`
      : "") +
    c.attachments
      .map(
        (a: any) =>
          `<div class="chip">${a.previewUri ? `<img alt="Ảnh đính kèm" src="${esc(a.previewUri)}">` : icon("attach")}<span class="chip-label" title="${esc(a.name)}">${esc(a.name)}</span>${button("removeAttachment", "close", "Bỏ attachment " + a.name, `data-id="${a.id}"`)}</div>`,
      )
      .join("")
  );
}
function projectActions(c: any) {
  if (c.checkpoint?.archivePlan && c.checkpoint.archivePlan.state !== "applied")
    return `<div class="project-actions"><span class="danger">Cập nhật ZIP chưa hoàn tất</span>${button("checkpoint", "history", "Khôi phục trước cập nhật ZIP")}</div>`;
  if (!c.checkpoint || ["pending", "running"].includes(c.pending?.status))
    return "";
  return `<div class="project-actions"><button class="run primary" data-action="projectStart">${icon("play")}Chạy dự án</button>${button("projectCheck", "beaker", "Chạy kiểm tra từ nopilot.json")}${button("projectMenu", "ellipsis", "Git và khôi phục checkpoint")}</div>`;
}
function artifacts(c: any) {
  if (!c.artifacts.length)
    return c.checkpoint
      ? `<section class="card"><div class="card-title">${icon("check")}Project đã cập nhật</div>${projectActions(c)}</section>`
      : "";
  return `<details class="card artifacts-card" data-artifacts="${esc(c.id)}" ${expandedArtifacts.has(c.id) ? "open" : ""}><summary>${icon("chevron-right")}${icon("files")}<span>Artifacts</span><small>${c.artifacts.length}</small></summary><div class="artifact-list">${c.artifacts.map((a: any) => `<div class="artifact">${icon(/\.zip$/i.test(a.name) ? "file-zip" : /\.log$/i.test(a.name) ? "output" : "file")}<span class="artifact-name" title="${esc(a.name)}">${esc(a.name)}</span><small>${Math.ceil(a.bytes / 1024)} KB</small>${button("openArtifact", "go-to-file", "Mở " + a.name, `data-id="${a.id}"`)}${button("folder", "folder-opened", "Mở thư mục chứa " + a.name, `data-id="${a.id}"`)}</div>`).join("")}</div></details>${c.checkpoint ? `<section class="card">${projectActions(c)}</section>` : ""}`;
}
function assistantMarkup(text: string) {
  const match = /^\s*```json\s*\n([\s\S]*?)```\s*$/.exec(text);
  if (match) {
    try {
      const raw = JSON.parse(match[1]);
      if (["change_set", "tool_request", "run_plan"].includes(raw.type))
        return `<p>${esc(raw.type === "change_set" ? `Đã chuẩn bị thay đổi ${raw.edits.length} file.` : raw.type === "tool_request" ? `Đề xuất dùng ${raw.name}.` : "Đã chuẩn bị kế hoạch chạy.")}</p><details><summary>Xem contract JSON</summary>${md.render(text)}</details>`;
    } catch {}
  }
  return md.render(text);
}
function pendingCard(p: any) {
  const active = p.status === "pending";
  let title = "",
    body = "",
    action = "",
    symbol = "";
  if (p.kind === "archive") {
    title = "Cập nhật project từ ZIP";
    symbol = "file-zip";
    const files = p.data.files;
    body = `<p>Workspace: <code>${esc(p.data.root)}</code></p><p>${files.filter((f: any) => f.before === null).length} mới · ${files.filter((f: any) => f.before !== null && f.after !== null).length} sửa · ${files.filter((f: any) => f.after === null).length} xóa</p>${p.data.prefix ? `<p>Bỏ folder bọc ZIP: <code>${esc(p.data.prefix)}</code></p>` : ""}<p>Commit backup source vào ref Git riêng trước khi cập nhật. Giữ venv, dependencies và file ngoài danh sách.</p>${files.map((f: any) => `<div class="changed-file">${icon(f.after === null ? "diff-removed" : f.before === null ? "diff-added" : f.binary ? "file-media" : "file-code")}<span>${esc(f.path)}</span><small>${f.after === null ? "Xóa" : f.binary ? "Binary · " + f.bytes + " B" : ""}</small></div>`).join("")}`;
    action = `<button data-action="review">${icon("diff")} Xem thay đổi</button><button class="primary" data-action="approve" data-id="${p.id}" ${p.reviewed ? "" : "disabled"}>${icon("check")} Backup và cập nhật</button>`;
  } else if (p.kind === "changes") {
    title = `${p.data.edits.length} file thay đổi`;
    symbol = "git-compare";
    body = p.data.edits
      .map(
        (e: any) =>
          `<div class="changed-file">${icon(e.content === null ? "diff-removed" : "file-code")}<span>${esc(e.path)}</span>${e.content === null ? '<small class="danger">Xóa</small>' : ""}</div>`,
      )
      .join("");
    action = `<button data-action="review">${icon("diff")} Xem diff</button><button class="primary" data-action="approve" data-id="${p.id}" ${p.reviewed ? "" : "disabled"}>${icon("check")} Áp dụng</button>`;
  } else if (p.kind === "tool") {
    title = p.data.name;
    symbol = "tools";
    body = `<pre>${esc(JSON.stringify(p.data.args, null, 2))}</pre><p>Kết quả sẽ được đưa lại cho Copilot sau khi duyệt.</p>`;
    action = `<button class="primary" data-action="approve" data-id="${p.id}">${icon("play")} Duyệt tool</button>`;
  } else {
    title = "Chạy trên workspace";
    symbol = "terminal";
    body = `<pre>${esc(JSON.stringify(p.data.commands, null, 2))}</pre><p>Kiểm tra executable, args, cwd và timeout trước khi chạy.</p>`;
    action = `<button class="primary" data-action="approve" data-id="${p.id}">${icon("play")} Duyệt và chạy</button>`;
  }
  return `<section class="card"><div class="card-title">${icon(symbol)}${esc(title)}</div>${body}${active ? `<div class="card-actions">${action}${button("reject", "close", "Từ chối đề xuất", `data-id="${p.id}"`)}</div>` : `<p class="muted">${icon(p.status === "completed" ? "check" : "circle-outline")} ${esc(({ completed: "Hoàn tất", failed: "Thất bại", expired: "Đề xuất đã hết hiệu lực", rejected: "Đã từ chối", running: "Đang chạy", paused: "Chờ thêm lượt" } as any)[p.status] ?? p.status)}</p>${p.status === "paused" ? '<button class="primary" data-action="more">Thêm 20 vòng</button>' : ""}`}</section>`;
}
function activityCard(a: any) {
  const running = a.status === "running",
    failed = a.status === "failed";
  return `<details class="card activity" data-activity="${esc(a.id)}" ${expandedActivities.has(a.id) ? "open" : ""}><summary>${icon(running ? "loading" : failed ? "error" : a.status === "stopped" ? "debug-stop" : "check")}<span class="activity-title">${esc(a.title)}</span><small>${a.exitCode !== undefined ? "exit " + esc(a.exitCode) : esc(a.status)}</small>${icon("chevron-right")}</summary><div class="activity-body">${a.command ? `<p><code>${esc(typeof a.command === "string" ? a.command : JSON.stringify(a.command))}</code></p>` : ""}<pre><code>${esc(a.output || "Đang chờ output…")}</code></pre>${a.truncated ? "<small>Output hiển thị đã rút gọn; mở log để xem đầy đủ.</small>" : ""}${a.error ? `<p class="activity-error">${esc(a.error)}</p>` : ""}<div class="card-actions">${button("showOutput", "output", "Mở Output channel")}${a.artifactId ? button("openArtifact", "go-to-file", "Mở log đầy đủ", `data-id="${esc(a.artifactId)}"`) : ""}</div></div></details>`;
}
function queueMarkup(c: any) {
  if (!c.queue?.length) return "";
  return `<section class="queue" aria-label="Hàng đợi"><div class="queue-head">${icon("list-ordered")}<span>Hàng đợi · ${c.queue.length}${c.queuePaused ? " · tạm dừng" : ""}</span><span class="spacer"></span>${button(c.queuePaused ? "queueResume" : "queuePause", c.queuePaused ? "play" : "debug-pause", c.queuePaused ? "Tiếp tục hàng đợi" : "Tạm dừng hàng đợi")}</div>${c.queue.map((q: any) => `<div class="queue-row"><span class="queue-text" title="${esc(q.error || q.text)}">${q.priority ? "↑ " : ""}${esc(q.text)}<small> · ${esc(q.status)}</small></span>${q.status === "needs-context" ? button("queueRefresh", "refresh", "Dùng context hiện tại", `data-id="${esc(q.id)}"`) : ""}${q.status === "queued" ? button("queuePriority", "arrow-up", "Ưu tiên lượt kế tiếp", `data-id="${esc(q.id)}"`) : ""}${q.status !== "sending" ? button("queueRemove", "close", "Bỏ tin khỏi hàng đợi", `data-id="${esc(q.id)}"`) : ""}</div>`).join("")}</section>`;
}
function voiceMarkup() {
  const v = state.voice;
  if (!v || v.status === "idle") return "";
  return `<div class="voice-state ${v.status === "recording" ? "recording" : ""}">${icon(v.status === "recording" ? "mic" : "info")}<span>${esc(v.message || v.status)}</span>${v.status === "needs-setup" ? button("voiceSetup", "folder-opened", "Chọn model local") : ""}${["loading", "recording", "transcribing"].includes(v.status) ? button("voiceCancel", "close", "Hủy ghi âm") : ""}</div>`;
}
function render() {
  if (!state) return;
  const c = state.conversation,
    oldMain = document.querySelector("main"),
    scroll = oldMain?.scrollTop ?? 0;
  const textarea = document.getElementById(
    "prompt",
  ) as HTMLTextAreaElement | null;
  const selection =
    document.activeElement === textarea && textarea
      ? { start: textarea.selectionStart, end: textarea.selectionEnd }
      : undefined;
  app.innerHTML = `<header><div class="header-row"><span class="title" title="${esc(c.title)}">${esc(c.title)}</span>${state.surface === "editor" ? button("new", "add", "Hội thoại mới") + button("history", "history", "Lịch sử") + button("sidebar", "screen-normal", "Về sidebar") : ""}${button("moreMenu", "ellipsis", "Thao tác hội thoại")}</div><div class="status ${state.busy ? "busy" : state.status.includes("kết nối") && !state.status.includes("Chưa") ? "connected" : ""}"><span class="dot"></span><span class="status-text" id="statusText">${esc(state.status)}</span><span class="spacer"></span><span>${c.turns}/20</span></div><div id="headerPopover"></div></header><main>${!c.messages.length && !c.pending ? `<div class="welcome"><div class="welcome-symbol">${icon("comment-discussion")}<span class="spark">${icon("sparkle")}</span></div><h2>Làm việc cùng Nopilot</h2><p>Copilot, ngay trong workspace.<br>Review thay đổi trước khi áp dụng.</p><button class="connect" data-action="connect">${icon("plug")} Kết nối Teams</button><span class="hint">Gõ @ để thêm context · Ctrl+V để dán ảnh</span></div>` : ""}${c.messages.map((m: any) => `<article class="message ${esc(m.role)}"><div class="message-label">${icon(m.role === "user" ? "account" : m.role === "assistant" ? "hubot" : "pulse")}${m.role === "user" ? "Bạn" : m.role === "assistant" ? "Copilot" : "Nopilot"}</div><div class="message-body">${m.role === "assistant" ? assistantMarkup(m.text) : esc(m.text)}</div></article>`).join("")}${c.pending ? pendingCard(c.pending) : ""}${(c.activities ?? []).map(activityCard).join("")}${artifacts(c)}${c.archiveQueue?.length ? `<section class="card"><button data-action="archiveNext">${icon("file-zip")}Chọn ZIP đã stage (${c.archiveQueue.length})</button></section>` : ""}</main><footer>${queueMarkup(c)}${error ? `<div class="error">${icon("error")}<span>${esc(error)}</span>${button("dismissError", "close", "Đóng thông báo")}</div>` : ""}<div class="composer">${voiceMarkup()}<div id="composerPopover"></div><div class="chips">${contextChips(c)}</div><textarea id="prompt" aria-label="Nhắn Copilot" aria-autocomplete="list" aria-controls="nopilot-options" aria-expanded="false" placeholder="Bạn muốn phát triển điều gì?" title="Enter gửi · Shift+Enter xuống dòng · @ context · / lệnh">${esc(c.draft)}</textarea><div class="composer-actions">${button("addMenu", "add", "Thêm file hoặc context")}<div class="mode">${icon(c.mode === "develop" ? "code" : "comment")}<select id="mode" aria-label="Chế độ" title="Develop: sửa project và duyệt chạy. Ask: chỉ hỏi với context, không áp dụng code."><option value="ask" ${c.mode === "ask" ? "selected" : ""}>Chỉ hỏi</option><option value="develop" ${c.mode === "develop" ? "selected" : ""}>Develop</option></select></div>${button("tools", "globe", c.tools ? "Tắt web tools" : "Bật web tools", `aria-pressed="${c.tools}"`, c.tools ? "toggle-on" : "")}${c.files.length ? button("previewContext", "eye", "Xem nội dung context sẽ gửi") : ""}<span class="spacer"></span>${button("voiceToggle", state.voice?.status === "recording" ? "debug-stop" : "mic", state.voice?.status === "recording" ? "Dừng ghi và nhận dạng" : "Nhập giọng nói local", "", state.voice?.status === "recording" ? "recording" : "")}${state.canStop ? button("stop", "debug-stop", "Dừng lệnh local đang chạy", "", "danger") : ""}${state.busy ? button("steer", "arrow-up", "Ưu tiên draft cho lượt kế tiếp · không đổi lượt đang chạy") : ""}${button("send", state.busy ? "add" : "arrow-up", state.busy ? "Thêm vào hàng đợi" : "Gửi tin nhắn", "", "send primary")}</div></div><div class="footer-meta"><span title="${esc(state.root || "Chưa mở workspace")}">${icon("device-desktop")}${state.root ? (c.autoWorkspace && c.mode === "develop" ? "Workspace tự động" : "Context đã chọn") : "Local"}</span><button data-action="help" title="Hướng dẫn context, duyệt thay đổi và chạy project">${icon("shield")}Duyệt thao tác</button><span class="spacer"></span>${c.attachments.length ? `<span title="Tối đa 3 attachments">${icon("attach")}${c.attachments.length}/3</span>` : ""}</div></footer>${historyOpen ? historyMarkup() : ""}`;
  app
    .querySelectorAll<HTMLDetailsElement>("details[data-activity]")
    .forEach((el) =>
      el.addEventListener("toggle", () => {
        if (el.open) expandedActivities.add(el.dataset.activity!);
        else expandedActivities.delete(el.dataset.activity!);
      }),
    );
  app
    .querySelectorAll<HTMLDetailsElement>("details[data-artifacts]")
    .forEach((el) =>
      el.addEventListener("toggle", () => {
        if (el.open) expandedArtifacts.add(el.dataset.artifacts!);
        else expandedArtifacts.delete(el.dataset.artifacts!);
      }),
    );
  const main = document.querySelector("main")!;
  main.scrollTop = atBottom ? main.scrollHeight : scroll;
  main.addEventListener(
    "scroll",
    () =>
      (atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 60),
  );
  const prompt = document.getElementById("prompt") as HTMLTextAreaElement;
  prompt.addEventListener("input", () => {
    saveDraft(prompt.value);
    autoMenu(prompt);
    resize(prompt);
  });
  prompt.addEventListener("click", () => autoMenu(prompt));
  prompt.addEventListener("compositionend", () => autoMenu(prompt));
  prompt.addEventListener("keydown", (e) => {
    if (
      menu &&
      ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key) &&
      !e.isComposing
    ) {
      e.preventDefault();
      menuKey(e.key);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  prompt.addEventListener("paste", (event) => {
    const item = Array.from(event.clipboardData?.items ?? []).find((x) =>
      x.type.startsWith("image/"),
    );
    if (!item) return;
    event.preventDefault();
    const file = item.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      post("image", { base64: String(reader.result).split(",")[1] });
    reader.readAsDataURL(file);
  });
  document
    .getElementById("mode")
    ?.addEventListener("change", (e) =>
      post("mode", { mode: (e.target as HTMLSelectElement).value }),
    );
  app.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((b) =>
    b.addEventListener("click", () =>
      action(b.dataset.action!, {
        id: b.dataset.id,
        kind: b.dataset.kind,
        path: b.dataset.path,
      }),
    ),
  );
  app.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) =>
    a.addEventListener("click", (event) => {
      event.preventDefault();
      post("external", { url: a.href });
    }),
  );
  app.querySelectorAll("pre code").forEach((code) => {
    const b = document.createElement("button");
    b.className = "icon-button copy";
    b.title = "Copy code";
    b.setAttribute("aria-label", "Copy code");
    b.innerHTML = icon("copy");
    b.onclick = async () => {
      try {
        await navigator.clipboard.writeText(code.textContent ?? "");
        b.innerHTML = icon("check");
      } catch {
        error = "Không copy được code vào clipboard.";
        render();
      }
    };
    code.parentElement!.prepend(b);
  });
  document.getElementById("search")?.addEventListener("input", (e) => {
    historyQuery = (e.target as HTMLInputElement).value;
    for (const row of app.querySelectorAll<HTMLElement>(".history-item"))
      row.hidden = !row.dataset.title!.includes(historyQuery.toLowerCase());
  });
  resize(prompt);
  if (selection) {
    prompt.focus();
    prompt.setSelectionRange(selection.start, selection.end);
  }
  renderPopover();
}
function resize(prompt: HTMLTextAreaElement) {
  prompt.style.height = "auto";
  prompt.style.height = Math.min(190, Math.max(70, prompt.scrollHeight)) + "px";
}
function saveDraft(text: string) {
  state.conversation.draft = text;
  vscode.setState({ conversationId: state.conversation.id, draft: text });
  post("draft", { text });
}
function autoMenu(prompt: HTMLTextAreaElement) {
  const found = detectTrigger(prompt.value, prompt.selectionStart);
  if (found && suggestions(found.kind, found.query).length) {
    menu = { ...found, typed: true, selected: 0 };
  } else if (menu?.typed) menu = undefined;
  renderPopover();
}
function options(): Suggestion[] {
  if (!menu) return [];
  if (menu.kind === "context" || menu.kind === "commands")
    return suggestions(menu.kind, menu.query);
  if (menu.kind === "add")
    return [
      {
        id: "attach",
        label: "Đính kèm file",
        detail: "Chọn bằng hộp thoại VS Code",
        icon: "attach",
        action: "chooseFile",
      },
      {
        id: "context",
        label: "Context và lệnh",
        detail: "@file, @workspace, /upload, /url…",
        icon: "mention",
        action: "contextMenu",
      },
      {
        id: "/upload",
        label: "Nhập đường dẫn file",
        detail: "Chọn path và điền /upload · chưa gửi",
        icon: "folder-opened",
        action: "command",
      },
      {
        id: "/url",
        label: "Đọc URL",
        detail: "Lấy nội dung web làm context",
        icon: "globe",
        action: "command",
      },
    ];
  if (menu.kind === "project")
    return [
      {
        id: "commit",
        label: "Git commit…",
        detail: "Chỉ commit file đã duyệt, không push",
        icon: "git-commit",
        action: "commit",
      },
      {
        id: "restore",
        label: "Khôi phục checkpoint…",
        detail: "Kiểm tra source trước khi khôi phục",
        icon: "history",
        action: "checkpoint",
      },
    ];
  return [
    {
      id: "new",
      label: "Hội thoại mới",
      detail: "Giữ phiên Teams cũ",
      icon: "add",
      action: "new",
    },
    {
      id: "history",
      label: "Lịch sử hội thoại",
      detail: "Pin, đổi tên, xóa local",
      icon: "history",
      action: "history",
    },
    {
      id: "rename",
      label: "Đổi tên hội thoại",
      detail: "Chỉ đổi tên trong Nopilot",
      icon: "edit",
      action: "rename",
    },
    {
      id: "pin",
      label: state.conversation.pinned ? "Bỏ pin" : "Pin hội thoại",
      detail: "Chỉ áp dụng trong Nopilot",
      icon: "pin",
      action: "pin",
    },
    {
      id: "read",
      label: "Đọc kết quả",
      detail: "Không gửi lại prompt",
      icon: "comment",
      action: "read",
    },
    {
      id: "connect",
      label: "Kết nối lại Teams",
      detail: "Dò lại bridge, không tự gửi lại",
      icon: "refresh",
      action: "connect",
    },
    {
      id: "checkRuntime",
      label: "Check Runtime",
      detail: "Kiểm tra Python, dependencies và Microsoft Edge",
      icon: "pulse",
      action: "checkRuntime",
    },
    {
      id: "repairRuntime",
      label: "Repair Bridge Dependencies",
      detail: "Tạo card duyệt cài thư viện đúng Python bridge",
      icon: "tools",
      action: "repairRuntime",
    },
    {
      id: "settings",
      label: "Cài đặt",
      detail: "Python bridge, gateway, model phụ",
      icon: "settings-gear",
      action: "settings",
    },
    {
      id: "help",
      label: "Hướng dẫn",
      detail: "Vòng phát triển và contract project",
      icon: "question",
      action: "help",
    },
  ];
}
function renderPopover() {
  const composer = document.getElementById("composerPopover"),
    header = document.getElementById("headerPopover"),
    prompt = document.getElementById("prompt");
  if (!composer || !header) return;
  composer.innerHTML = "";
  header.innerHTML = "";
  prompt?.setAttribute("aria-expanded", String(!!menu));
  if (!menu) return;
  const rows = options();
  menu.selected = Math.min(menu.selected, Math.max(0, rows.length - 1));
  const host = menu.kind === "more" ? header : composer;
  host.innerHTML = `<div class="popover ${menu.kind === "more" ? "header-popover" : ""}"><div class="popover-title">${({ context: "Context và lệnh", commands: "Context và lệnh", add: "Thêm vào hội thoại", more: "Hội thoại", project: "Project" } as any)[menu.kind]}</div><div id="nopilot-options" role="listbox" aria-label="${menu.kind === "context" ? "Context" : "Lệnh và thao tác"}">${rows.map((row, index) => `<button class="suggestion ${index === menu!.selected ? "selected" : ""}" role="option" aria-selected="${index === menu!.selected}" data-index="${index}" title="${esc(row.detail)}">${icon(row.icon)}<span class="suggestion-text"><span class="suggestion-label">${esc(row.action === "context" ? "@" + row.id : row.label)}</span><span class="suggestion-detail">${esc(row.detail)}</span></span></button>`).join("") || '<div class="no-results">Không có mục phù hợp.</div>'}</div><div class="popover-hint">↑↓ chọn · Enter / Tab xác nhận · Esc đóng</div></div>`;
  host
    .querySelectorAll<HTMLButtonElement>("button[data-index]")
    .forEach((b) => {
      b.addEventListener("pointerdown", (e) => e.preventDefault());
      b.addEventListener("click", () => choose(Number(b.dataset.index)));
    });
}
function openMenu(kind: Menu["kind"]) {
  if (menu?.kind === kind && !menu.typed) {
    menu = undefined;
  } else {
    const p = document.getElementById("prompt") as HTMLTextAreaElement;
    menu = {
      kind,
      query: "",
      start: p.selectionStart,
      end: p.selectionEnd,
      typed: false,
      selected: 0,
    };
  }
  renderPopover();
  if (kind === "context" || kind === "commands")
    document.getElementById("prompt")?.focus();
}
function menuKey(key: string) {
  if (!menu) return;
  const length = options().length;
  if (key === "Escape") {
    menu = undefined;
    renderPopover();
    return;
  }
  if (key === "ArrowDown" || key === "ArrowUp") {
    menu.selected =
      (menu.selected + (key === "ArrowDown" ? 1 : -1) + Math.max(length, 1)) %
      Math.max(length, 1);
    renderPopover();
    return;
  }
  if (length) choose(menu.selected);
}
function choose(index: number) {
  const row = options()[index],
    selected = menu;
  if (!row || !selected) return;
  const p = document.getElementById("prompt") as HTMLTextAreaElement;
  menu = undefined;
  renderPopover();
  if (row.action === "contextMenu") {
    openMenu("context");
    return;
  }
  if (row.action === "context") {
    if (selected.typed) {
      p.value = p.value.slice(0, selected.start) + p.value.slice(selected.end);
      saveDraft(p.value);
      p.setSelectionRange(selected.start, selected.start);
    }
    post("context", { kind: row.kind });
    p.focus();
    return;
  }
  if (row.action === "command") {
    const before = selected.typed ? p.value.slice(0, selected.start) : "",
      after = selected.typed ? p.value.slice(selected.end) : "";
    p.value = before + row.id + " " + after;
    saveDraft(p.value);
    p.focus();
    p.setSelectionRange(
      (before + row.id + " ").length,
      (before + row.id + " ").length,
    );
    resize(p);
    if (row.id === "/upload") post("chooseFile", { pathOnly: true });
    return;
  }
  action(row.action, { id: state.conversation.id });
}
function action(type: string, extra: any = {}) {
  if (["addMenu", "contextMenu", "moreMenu", "projectMenu"].includes(type)) {
    openMenu(
      (
        {
          addMenu: "add",
          contextMenu: "context",
          moreMenu: "more",
          projectMenu: "project",
        } as any
      )[type],
    );
    return;
  }
  menu = undefined;
  renderPopover();
  if (type === "steer") {
    const p = document.getElementById("prompt") as HTMLTextAreaElement;
    if (p.value.trim()) post("steer", { text: p.value });
    return;
  }
  if (type === "send") {
    send();
    return;
  }
  if (type === "history") {
    historyOpen = true;
    render();
    return;
  }
  if (type === "closeHistory") {
    historyOpen = false;
    render();
    return;
  }
  if (type === "trash") {
    trash = !trash;
    render();
    return;
  }
  if (type === "tools") {
    post("tools", { enabled: !state.conversation.tools });
    return;
  }
  if (type === "dismissError") {
    error = "";
    render();
    return;
  }
  if (type === "new" || type === "openConversation") historyOpen = false;
  post(type, extra);
}
function send() {
  const prompt = document.getElementById("prompt") as HTMLTextAreaElement;
  if (!prompt.value.trim()) return;
  error = "";
  atBottom = true;
  menu = undefined;
  renderPopover();
  post("send", { text: prompt.value });
}
function historyMarkup() {
  return `<section class="history"><header><span class="title">${trash ? "Thùng rác" : "Lịch sử hội thoại"}</span>${button("new", "add", "Hội thoại mới")}${button("trash", trash ? "history" : "trash", trash ? "Về lịch sử" : "Thùng rác")}${button("closeHistory", "close", "Đóng lịch sử")}</header><div class="history-search">${icon("search")}<input id="search" aria-label="Tìm hội thoại" placeholder="Tìm hội thoại…" value="${esc(historyQuery)}"></div><div class="history-list">${state.history
    .filter((r: any) => !!r.deletedAt === trash)
    .map(
      (r: any) =>
        `<div class="history-item" data-title="${esc(r.title.toLowerCase())}" ${r.title.toLowerCase().includes(historyQuery.toLowerCase()) ? "" : "hidden"}><div class="history-line"><button class="history-open" data-action="openConversation" data-id="${r.id}" title="${esc(r.title)}" ${trash ? "disabled" : ""}>${icon(r.pinned ? "pin" : "comment")}${esc(r.title)}</button><div class="history-actions">${trash ? button("restoreConversation", "discard", "Khôi phục hội thoại", `data-id="${r.id}"`) : button("rename", "edit", "Đổi tên hội thoại", `data-id="${r.id}"`) + button("pin", r.pinned ? "pinned" : "pin", r.pinned ? "Bỏ pin" : "Pin hội thoại", `data-id="${r.id}"`) + button("delete", "trash", "Xóa hội thoại local", `data-id="${r.id}"`)}</div></div><small>${esc(r.updatedAt.slice(0, 10))}</small></div>`,
    )
    .join(
      "",
    )}</div><div class="history-note">Lịch sử theo workspace. Đổi tên / xóa chỉ áp dụng trong Nopilot; Teams chat và source được giữ nguyên.</div></section>`;
}
document.addEventListener("pointerdown", (event) => {
  const el = event.target as HTMLElement;
  if (menu && !el.closest(".popover") && !el.closest('[data-action$="Menu"]')) {
    menu = undefined;
    renderPopover();
  }
});
document.addEventListener("keydown", (event) => {
  if (!menu || (event.target as HTMLElement).id === "prompt") return;
  if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
    event.preventDefault();
    menuKey(event.key);
  }
});
window.addEventListener("message", (event) => {
  const m = event.data;
  if (m.type === "snapshot") {
    if (state?.conversation.id !== m.state.conversation.id) {
      menu = undefined;
      historyQuery = "";
    }
    state = m.state;
    render();
  } else if (
    m.type === "event" &&
    state &&
    m.conversationId === state.conversation.id &&
    m.event.type === "CUSTOM" &&
    m.event.name === "nopilot.activity"
  ) {
    const a = m.event.value;
    state.conversation.activities ??= [];
    const i = state.conversation.activities.findIndex(
      (x: any) => x.id === a.id,
    );
    if (i < 0) state.conversation.activities.push(a);
    else state.conversation.activities[i] = a;
    render();
  } else if (
    m.type === "event" &&
    state &&
    m.conversationId === state.conversation.id &&
    m.event.type === "CUSTOM" &&
    m.event.name === "nopilot.status"
  ) {
    state.status = m.event.value.text;
    const text = document.getElementById("statusText");
    if (text) text.textContent = state.status;
  } else if (m.type === "error") {
    error = m.text;
    render();
  }
});
post("ready");
