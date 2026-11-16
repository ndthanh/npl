import { goalCard, syncGoalForm, goalCss } from "./goal-ui";
import { syncProjectPicker } from "./project-picker";
import { syncDecimen, receiveDecimen, decimenCss } from "./decimen-ui";
import MarkdownIt from "markdown-it";
import { isSqlFence } from "./sql-snippets";
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
const renderFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const html = renderFence(tokens, index, options, env, self);
  if (!env?.messageId || !isSqlFence(tokens[index].info)) return html;
  const snippet = env.sqlIndex++;
  const cached = state?.conversation.sqlCards?.find(
    (card: any) => card.messageId === env.messageId && card.index === snippet,
  );
  return `<section class="sql-snippet" data-sql-message="${esc(env.messageId)}" data-sql-index="${snippet}"><div class="sql-snippet-toolbar"><span>${icon("database")} SQL</span><div class="sql-snippet-actions"><button data-action="migrationSql" data-id="${esc(env.messageId)}" data-index="${snippet}" title="Đưa vào SQL đích của báo cáo Migration đang chọn; chưa chạy">${icon("git-compare")} Migration</button><button data-action="showSqlInline" data-id="${esc(env.messageId)}" data-index="${snippet}" title="Hiện kết quả trong chat; dùng snapshot đã chạy nếu có">${icon("table")} Show inline</button><button data-action="executeSql" data-id="${esc(env.messageId)}" data-index="${snippet}" title="Thực thi SQL trong Data grid">${icon("play")} Execute</button></div></div>${html}${cached?.visible ? inlineSql(cached) : ""}</section>`;
};
const post = (type: string, extra: any = {}) =>
  vscode.postMessage({
    type,
    ...extra,
    ...(type === "send" && state?.surface ? { surface: state.surface } : {}),
  });
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
let sqlAnchor:
  | {
      conversation: string;
      message?: string;
      index?: string;
      result?: string;
      top: number;
    }
  | undefined;
function rememberSqlAnchor(button: HTMLElement) {
  const main = document.querySelector("main")!,
    snippet = button.closest<HTMLElement>(".sql-snippet"),
    inline = button.closest<HTMLElement>("[data-sql-result]"),
    node = snippet ?? inline;
  if (node)
    sqlAnchor = {
      conversation: state.conversation.id,
      message: snippet?.dataset.sqlMessage,
      index: snippet?.dataset.sqlIndex,
      result: inline?.dataset.sqlResult,
      top: node.getBoundingClientRect().top - main.getBoundingClientRect().top,
    };
}

const expandedActivities = new Set<string>();
const expandedArtifacts = new Set<string>();
const expandedChanges = new Set<string>();
const expandedRunPlans = new Set<string>();
const style = document.createElement("style");
style.nonce = (document.currentScript as HTMLScriptElement).nonce;
style.textContent = `
*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-sideBar-background,var(--vscode-editor-background));font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);height:100vh}button,input,textarea,select{font:inherit}button{cursor:pointer;border:1px solid transparent;border-radius:5px;padding:6px 9px;color:inherit;background:transparent}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}.icon-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:4px;flex:none}.codicon{font-size:16px;line-height:1;vertical-align:middle}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.primary:hover{background:var(--vscode-button-hoverBackground)}.danger{color:var(--vscode-errorForeground)}.muted,small{color:var(--vscode-descriptionForeground)}.spacer{flex:1}.active{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}#app{height:100vh;display:flex;flex-direction:column}header{position:relative;padding:8px 12px 9px;border-bottom:1px solid var(--vscode-panel-border)}.header-row{display:flex;gap:3px;align-items:center}.title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:600}.status{display:flex;align-items:center;gap:6px;color:var(--vscode-descriptionForeground);font-size:10px;margin-top:4px;min-height:14px}.status-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dot{width:5px;height:5px;border-radius:50%;background:var(--vscode-descriptionForeground);flex:none}.connected .dot{background:var(--vscode-testing-iconPassed)}.busy .dot{background:var(--vscode-progressBar-background);animation:pulse 1s infinite}@keyframes pulse{50%{opacity:.3}}main{flex:1;min-height:0;overflow:auto;padding:18px 14px}.welcome{height:100%;min-height:220px;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;color:var(--vscode-descriptionForeground);padding:20px}.welcome-symbol{position:relative;margin-bottom:20px;opacity:.65}.welcome-symbol>.codicon{font-size:48px}.welcome-symbol>.spark{position:absolute;right:-12px;top:-6px;background:var(--vscode-sideBar-background);padding:2px}.welcome-symbol>.spark .codicon{font-size:22px}.welcome h2{font-size:16px;font-weight:600;color:var(--vscode-foreground);margin:0 0 10px}.welcome p{line-height:1.6;font-size:12px;margin:0 0 14px;max-width:280px}.welcome .connect{margin:4px 0 14px}.welcome .hint{font-size:11px}.message{max-width:920px;margin:0 auto 20px;overflow-wrap:anywhere;line-height:1.6}.message-label{display:flex;align-items:center;gap:6px;color:var(--vscode-descriptionForeground);font-size:11px;margin-bottom:6px}.message-label .codicon{font-size:13px}.message.user .message-body{padding:10px 12px;border-radius:9px;background:color-mix(in srgb,var(--vscode-button-background,#007acc) 18%,var(--vscode-editor-background,#1e1e1e));border:1px solid color-mix(in srgb,var(--vscode-button-background,#007acc) 35%,transparent);white-space:pre-wrap}.message.system{font-size:11px;color:var(--vscode-descriptionForeground);padding-left:10px;border-left:2px solid var(--vscode-panel-border)}.message-body p:first-child{margin-top:0}.message-body p:last-child{margin-bottom:0}a{color:var(--vscode-textLink-foreground)}pre{position:relative;overflow:auto;padding:12px;border-radius:6px;background:var(--vscode-textCodeBlock-background);font-family:var(--vscode-editor-font-family);font-size:12px;line-height:1.5}code{font-family:var(--vscode-editor-font-family)}:not(pre)>code{background:var(--vscode-textCodeBlock-background);border-radius:3px;padding:1px 4px}pre>.copy{position:sticky;top:0;float:right;background:var(--vscode-editor-background);width:23px;height:23px;margin:-5px -5px 3px 8px}blockquote{border-left:3px solid var(--vscode-textBlockQuote-border);padding-left:10px;margin-left:0}table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}td,th{border:1px solid var(--vscode-panel-border);padding:6px}.hljs-keyword,.hljs-selector-tag{color:var(--vscode-symbolIcon-keywordForeground,#c586c0)}.hljs-string,.hljs-attr{color:var(--vscode-debugTokenExpression-string,#ce9178)}.hljs-number,.hljs-literal{color:var(--vscode-debugTokenExpression-number,#b5cea8)}.hljs-comment{color:var(--vscode-descriptionForeground);font-style:italic}details{margin:8px 0;font-size:12px}summary{cursor:pointer;color:var(--vscode-descriptionForeground)}.card{max-width:920px;margin:8px auto 18px;border:1px solid var(--vscode-panel-border);border-radius:8px;padding:12px}.card-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;margin-bottom:9px}.card p{font-size:11px;line-height:1.6}.card pre{max-height:210px;font-size:11px}.card-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px}.card-actions>button:not(.icon-button){font-size:12px}.changed-file{display:flex;align-items:center;gap:7px;font-size:12px;padding:3px 0}.artifact{display:flex;align-items:center;gap:7px;padding:7px 0;border-top:1px solid var(--vscode-panel-border)}.artifact:first-of-type{border-top:0}.artifact-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}.artifact small{font-size:10px}.project-actions{display:flex;gap:5px;align-items:center;margin-top:9px}.project-actions .run{font-size:12px}.project-actions .run>.codicon{font-size:13px;margin-right:5px}footer{position:relative;padding:6px 12px 8px}.composer{position:relative;border:1px solid var(--vscode-input-border,transparent);border-radius:12px;background:var(--vscode-input-background);padding:8px}.composer:focus-within{border-color:var(--vscode-focusBorder)}textarea{display:block;width:100%;min-height:70px;max-height:190px;resize:none;border:0;outline:0;background:transparent;color:var(--vscode-input-foreground);font:inherit;line-height:1.5;padding:5px 4px 9px}textarea::placeholder{color:var(--vscode-input-placeholderForeground)}.composer-actions{display:flex;align-items:center;gap:3px;min-height:28px}.mode{display:flex;align-items:center;gap:4px;padding:0 3px}.mode>.codicon{font-size:14px;color:var(--vscode-descriptionForeground)}select{max-width:100px;border:0;background:transparent;color:var(--vscode-foreground);font-size:12px;padding:4px 1px;cursor:pointer}select option{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground)}.toggle-on{color:var(--vscode-textLink-foreground);background:var(--vscode-toolbar-activeBackground)}.send{border-radius:6px}.footer-meta{display:flex;align-items:center;gap:10px;min-height:24px;padding:4px 2px 0;font-size:10px;color:var(--vscode-descriptionForeground)}.footer-meta .codicon{font-size:12px;margin-right:4px}.footer-meta button{display:inline-flex;align-items:center;font-size:10px;padding:1px 0;color:var(--vscode-descriptionForeground)}.chips{display:flex;gap:5px;flex-wrap:wrap;padding:0 3px}.chip{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:100%;font-size:10px;border:1px solid var(--vscode-panel-border);border-radius:5px;padding:3px 4px;margin-bottom:5px}.chip>.codicon{font-size:12px}.chip-label{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:170px}.chip .icon-button{width:18px;height:18px;padding:0}.chip .icon-button .codicon{font-size:12px}.chip img{width:34px;height:26px;object-fit:contain;border-radius:2px}.error{display:flex;gap:6px;color:var(--vscode-errorForeground);font-size:11px;padding:5px 3px 9px}.popover{position:absolute;bottom:calc(100% + 8px);left:0;right:0;z-index:10;max-height:min(330px,55vh);overflow:auto;padding:5px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:8px;box-shadow:0 6px 18px var(--vscode-widget-shadow,rgba(0,0,0,.28))}.header-popover{top:34px;bottom:auto;left:auto;right:8px;width:min(290px,calc(100vw - 24px))}.popover-title{font-size:10px;color:var(--vscode-descriptionForeground);padding:5px 7px 7px;text-transform:uppercase;letter-spacing:.06em}.suggestion{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border-radius:5px;padding:8px}.suggestion.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.suggestion .codicon{font-size:16px;flex:none}.suggestion-text{display:flex;flex-direction:column;gap:2px;min-width:0}.suggestion-label{font-size:12px}.suggestion-detail{font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.4}.selected .suggestion-detail{color:inherit;opacity:.75}.popover-hint{padding:6px 8px 2px;color:var(--vscode-descriptionForeground);font-size:9px;border-top:1px solid var(--vscode-panel-border);margin-top:4px}.no-results{padding:12px;font-size:11px;color:var(--vscode-descriptionForeground)}.history{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;background:var(--vscode-sideBar-background,var(--vscode-editor-background))}.history header{display:flex;align-items:center;gap:3px}.history-search{position:relative;margin:10px 12px}.history-search>.codicon{position:absolute;left:8px;top:8px;font-size:14px;color:var(--vscode-descriptionForeground)}.history-search input{width:100%;border:1px solid var(--vscode-input-border,transparent);padding:7px 8px 7px 29px;border-radius:5px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font:inherit;font-size:12px}.history-list{padding:0 10px;overflow:auto;flex:1}.history-item{padding:7px 3px;border-bottom:1px solid var(--vscode-panel-border)}.history-line{display:flex;align-items:center;gap:4px}.history-open{flex:1;min-width:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;padding:5px}.history-open>.codicon{font-size:12px;margin-right:6px}.history-actions{display:flex;gap:1px}.history-item small{font-size:10px;padding-left:6px}.history-note{padding:10px 13px;font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.6}@media(max-width:360px){header{padding-left:10px;padding-right:10px}main{padding:12px 10px}footer{padding:5px 8px 8px}.suggestion{padding:7px}.history-actions .icon-button{width:25px}}`;
style.textContent += `
.activity{padding:0;overflow:hidden}.activity summary{display:flex;align-items:center;gap:8px;padding:11px;list-style:none;color:var(--vscode-foreground)}.activity summary::-webkit-details-marker{display:none}.activity summary .activity-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity[open] .chevron{transform:rotate(90deg)}.activity-body{padding:0 11px 11px}.activity pre{max-height:300px;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.activity small{font-size:10px}.queue{margin:0 0 7px;border:1px solid var(--vscode-panel-border);border-radius:8px;max-height:190px;overflow:auto}.queue-head,.queue-row{display:flex;align-items:center;gap:4px;padding:4px 7px;font-size:11px}.queue-head{color:var(--vscode-descriptionForeground)}.queue-row{border-top:1px solid var(--vscode-panel-border)}.queue-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.queue-row .icon-button{width:23px;height:23px}.voice-state{display:flex;align-items:center;gap:5px;padding:5px;font-size:11px;overflow-wrap:anywhere}.recording{color:var(--vscode-errorForeground)}.recording .codicon{animation:pulse 1s infinite}.voice-state>span{flex:1}.activity-error{color:var(--vscode-errorForeground);font-size:11px}.menu-group{font-size:9px;color:var(--vscode-descriptionForeground);text-transform:uppercase;padding:7px 8px 3px}
`;
style.textContent += `.artifacts-card{padding:0}.artifacts-card>summary{display:flex;align-items:center;gap:8px;padding:10px;color:var(--vscode-foreground);list-style:none}.artifacts-card summary::-webkit-details-marker{display:none}.artifact-list{max-height:220px;overflow:auto;padding:0 10px 8px}.artifacts-card[open]>summary .codicon-chevron-right{transform:rotate(90deg)}.artifact-list .artifact{min-height:36px}`;
style.textContent += `.welcome .connect{padding:9px 17px;border-radius:7px;font-weight:600;box-shadow:0 2px 12px color-mix(in srgb,var(--vscode-button-background) 25%,transparent)}.welcome .setup-link{font-size:11px;color:var(--vscode-textLink-foreground);margin-bottom:12px}.changes-card{padding:0;overflow:hidden}.changes-top{padding:12px;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--vscode-panel-border)}.changes-symbol{display:grid;place-items:center;background:var(--vscode-textCodeBlock-background);width:36px;height:36px;border-radius:8px;flex:none}.changes-heading{font-size:12px;font-weight:600}.changes-counts{font-size:11px;margin-top:3px;font-variant-numeric:tabular-nums}.plus{color:var(--vscode-gitDecoration-addedResourceForeground,#3fbf8a)}.minus{color:var(--vscode-gitDecoration-deletedResourceForeground,#f16b6b)}.changes-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap;justify-content:flex-end}.changes-actions button{font-size:11px;padding:4px 7px}.changes-actions .outlined{border:1px solid var(--vscode-panel-border);border-radius:20px}.change-row{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--vscode-panel-border);font-size:11px;min-width:0}.change-path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}.change-stat{flex:none;font-variant-numeric:tabular-nums;font-size:10px}.change-more{margin:0}.change-more>summary{list-style:none;padding:8px 12px;background:var(--vscode-toolbar-hoverBackground);font-size:11px;color:var(--vscode-foreground)}.change-more[open]>summary{border-bottom:1px solid var(--vscode-panel-border)}.changes-footer{padding:10px 12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.changes-footer>button:not(.icon-button){font-size:11px}.changes-note{font-size:10px;padding:8px 12px;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere;line-height:1.5}@media(max-width:380px){.changes-top{gap:7px;padding:9px}.changes-symbol{width:29px;height:29px}.changes-actions{gap:1px}.changes-actions button{padding:4px;font-size:10px}}`;
document.head.append(style);
style.textContent += decimenCss + goalCss;
style.textContent += `.message-tools{display:flex;justify-content:flex-end;margin-top:3px}.message-tools button{opacity:.65}.message:hover .message-tools button{opacity:1}`;
style.textContent += `.sql-snippet-actions,.inline-sql-head,.inline-sql-pager{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.inline-sql{border-top:1px solid var(--vscode-panel-border)}.inline-sql-head,.inline-sql-pager{padding:7px 9px;font-size:10px}.inline-sql-grid{overflow:auto;max-height:270px}.inline-sql table{display:table;width:100%;border-collapse:separate;border-spacing:0;font-size:11px;white-space:nowrap}.inline-sql th{position:sticky;top:0;background:var(--vscode-sideBar-background)}.inline-sql td,.inline-sql th{padding:6px 9px;max-width:300px;overflow:hidden;text-overflow:ellipsis}.inline-sql-head button,.inline-sql-pager button{font-size:10px;padding:3px}.footer-meta{flex-wrap:wrap}.project-toggle{display:flex;align-items:center;gap:4px;cursor:pointer;font-size:10px}.project-toggle input{margin:0}`;
style.textContent += `.sql-snippet{border:1px solid var(--vscode-panel-border);border-radius:8px;overflow:hidden;margin:12px 0}.sql-snippet-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;background:var(--vscode-toolbar-hoverBackground);font-size:11px}.sql-snippet-toolbar button{display:flex;align-items:center;gap:5px;color:var(--vscode-textLink-foreground);font-size:11px}.sql-snippet pre{margin:0;border-radius:0}`;

style.textContent += `.welcome .connect[aria-busy="true"]{opacity:1}.icon-button[aria-busy="true"]{opacity:.9;color:var(--vscode-progressBar-background,#0078d4)}`;
function modelPicker() {
  const current = state.copilotModel || "GPT-5.6 Sol Think deeper";
  const choices = ["Auto", "GPT-5.6 Sol Think deeper", "GPT-5.6 Sol Quick response"];
  if (!choices.includes(current)) choices.push(current);
  return `<select id="copilot-model" class="model-picker" aria-label="Model Copilot Teams" title="${esc(current)}" ${state.busy ? "disabled" : ""}>${choices.map((name) => `<option value="${esc(name)}" ${name === current ? "selected" : ""}>${esc(name.replace("GPT-5.6 Sol ", ""))}</option>`).join("")}</select>`;
}
function setupCard() {
  const phase = state.runtimeSetup?.phase;
  const connection = state.connection;
  const manifest = phase === "ready" && connection?.phase === "failed" && /has no manifest|manifest.*unusable/i.test(connection.message || "");
  if (!phase || (phase === "ready" && !manifest)) return "";
  const pending = state.busy || state.conversation.pending?.status === "pending";
  const disabled = pending ? "disabled" : "";
  if (phase === "checking")
    return '<section class="card setup-card" role="status">Đang kiểm tra Python và Teams bridge…</section>';
  const detail = manifest ? "Teams đang dùng bản WebView2 cần manifest tương ứng."
    : phase === "missing" ? "Python đã sẵn sàng. Còn thiếu " + state.runtimeSetup.missing.join(", ") + "."
      : "Không chạy được Python đã cấu hình. Chọn python.exe đã cài rồi kiểm tra lại.";
  return `<section class="card setup-card"><div class="card-title">${icon("tools")} Thiết lập Nopilot</div><p>${esc(detail)}</p><div class="card-actions">${manifest
    ? `<button class="primary" data-action="generateTeamsManifest" ${disabled}>Tạo manifest</button>`
    : `${phase === "missing" ? `<button class="primary" data-action="setup" ${disabled}>Cài runtime…</button><button data-action="setupOffline" ${disabled}>Dùng wheel offline…</button>` : ""}<button data-action="setupPython" ${disabled}>Chọn Python…</button>`}<button data-action="setupRecheck" ${disabled}>Kiểm tra lại</button></div></section>`;
}
style.textContent += `.model-picker{max-width:138px;min-width:0;padding:3px 4px;border:1px solid var(--vscode-input-border,transparent);border-radius:4px;background:var(--vscode-input-background);color:var(--vscode-input-foreground)}.setup-card p{margin:8px 0}.setup-card .card-actions{flex-wrap:wrap}`;
function teamsButton(compact = false) {
  const connection = state.connection ?? {
    phase: "idle",
    message: "Chưa kết nối Teams",
  };
  const connecting = ["finding", "retrying"].includes(connection.phase);
  const label = connecting
    ? `Đang kết nối Teams · ${connection.attempt || 1}/3${connection.retryIn ? ` · thử lại sau ${connection.retryIn}s` : ""}`
    : connection.phase === "connected"
      ? "Teams đã kết nối"
      : connection.phase === "failed"
        ? "Thử kết nối lại Teams"
        : "Kết nối Teams";
  return `<button class="${compact ? "connect-indicator" : "connect primary"}" data-action="connect" aria-label="${esc(label)}" title="${esc(connection.message || label)}" aria-busy="${connecting}" ${connecting || state.busy ? "disabled" : ""}><span class="codicon codicon-${connecting ? "loading codicon-modifier-spin" : connection.phase === "connected" ? "debug-connected" : "plug"}" aria-hidden="true"></span>${compact ? `<span class="connection-label" id="statusText">${esc(label)}</span>` : " " + esc(label)}</button>`;
}
function inlineSql(card: any) {
  const r = card.result;
  const rows = r.rows
    .map(
      (row: any[]) =>
        `<tr>${row.map((v) => `<td title="${esc(v === null ? "NULL" : v)}">${esc(v === null ? "NULL" : v)}</td>`).join("")}</tr>`,
    )
    .join("");
  const exports = r.commandOnly
    ? ""
    : `${button("sqlExportCsv", "export", "Export CSV", `data-id="${esc(card.id)}"`)}<button data-action="sqlExportXlsx" data-id="${esc(card.id)}" title="Export Excel">Excel</button>`;
  const body = card.collapsed
    ? ""
    : `${!card.messageId ? `<details><summary>SQL</summary><pre><code>${esc(card.sql)}</code></pre></details>` : ""}<div class="inline-sql-grid"><table><thead><tr>${r.columns.map((c: any) => `<th>${esc(c.name)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>${r.rowCount ? "" : `<p>${r.commandOnly ? "Đã áp dụng USE context." : "Query không trả dòng nào."}</p>`}</div><div class="inline-sql-pager"><span>${r.rowCount ? r.offset + 1 : 0}–${Math.min(r.offset + r.rows.length, r.rowCount)} / ${r.rowCount}</span><span class="spacer"></span><button data-action="sqlPage" data-id="${esc(card.id)}" data-offset="${Math.max(0, r.offset - r.pageSize)}" aria-label="SQL trang trước" ${r.offset === 0 ? "disabled" : ""}>${icon("chevron-left")}</button><button data-action="sqlPage" data-id="${esc(card.id)}" data-offset="${r.offset + r.pageSize}" aria-label="SQL trang sau" ${r.offset + r.pageSize >= r.rowCount ? "disabled" : ""}>${icon("chevron-right")}</button></div>`;
  return `<section class="inline-sql" data-sql-result="${esc(card.id)}" aria-label="SQL inline results"><div class="inline-sql-head"><span>${esc(card.connection)} · ${r.commandOnly ? "USE context" : r.rowCount + " rows"}${r.truncated ? " · truncated" : ""}</span><span class="spacer"></span>${button("sqlCollapse", card.collapsed ? "chevron-down" : "chevron-up", card.collapsed ? "Mở rộng bảng" : "Thu gọn bảng", `data-id="${esc(card.id)}" aria-expanded="${!card.collapsed}"`)}${button("sqlOpenGrid", "open-preview", "Mở snapshot trong Data", `data-id="${esc(card.id)}"`)}${exports}${button("sqlHide", "close", "Ẩn kết quả inline", `data-id="${esc(card.id)}"`)}</div>${body}</section>`;
}
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
style.textContent += `.zip-files{max-height:300px;overflow:auto}.zip-entry{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--vscode-panel-border);font-size:12px}.zip-entry>label{display:flex;align-items:center;gap:8px;flex:1;min-width:0;overflow-wrap:anywhere}.zip-entry:has(input:disabled){opacity:.5}`;
function zipPreview(c: any) {
  const zip = c.zipPreview;
  if (!zip) return "";
  return `<section class="card zip-preview"><div class="card-title">${icon("file-zip")}<span class="artifact-name">${esc(zip.name)}</span>${button("closeZip", "close", "Đóng preview ZIP")}</div><p>Bấm icon copy cạnh file hoặc chọn nhiều file. File ignore được giữ nguyên. Tiếp theo sẽ review và duyệt backup Git.</p><div class="zip-files">${zip.files.map((f: any) => `<div class="zip-entry"><label><input type="checkbox" data-zip-path="${esc(f.path)}" ${f.blocked ? "disabled" : ""}><span>${esc(f.path)}</span></label><small>${f.blocked ? "Ignored" : Math.ceil(f.bytes / 1024) + " KB"}</small>${button("copyZipFile", "files", "Copy " + f.path + " vào workspace", `data-id="${esc(zip.id)}" data-path="${esc(f.path)}" ${f.blocked ? "disabled" : ""}`)}</div>`).join("")}</div><div class="card-actions"><button class="primary" data-action="copyZipSelected" data-id="${esc(zip.id)}">Copy selected…</button><button data-action="copyZipAll" data-id="${esc(zip.id)}">Copy all…</button></div></section>`;
}
function artifacts(c: any, messageId?: string) {
  const rows = c.artifacts
    .filter((a: any) => !/^decimen-[a-f0-9]{8}-.*\.zip$/i.test(a.name))
    .filter((a: any) =>
      messageId
        ? a.messageId === messageId || a.messageIds?.includes(messageId)
        : !a.messageId && !a.messageIds?.length,
    );
  if (!rows.length) return "";
  const key = c.id + ":" + (messageId || "legacy");
  return `<details class="card artifacts-card" data-artifacts="${esc(key)}" ${expandedArtifacts.has(key) ? "open" : ""}><summary>${icon("files")} ${messageId ? "File của lượt này" : "Artifacts lịch sử"} · ${rows.length}</summary><div class="artifact-list">${rows.map((a: any) => `<div class="artifact">${icon(/\.zip$/i.test(a.name) ? "file-zip" : "file")}<span class="artifact-name">${esc(a.name)}</span><small>${Math.ceil(a.bytes / 1024)} KB</small>${/\.zip$/i.test(a.name) ? button("previewZip", "list-tree", "Xem ZIP / chọn file", `data-id="${esc(a.id)}"`) + button("copyZipAll", "files", "Đề xuất toàn bộ ZIP", `data-id="${esc(a.id)}"`) : ""}${button("openArtifact", "go-to-file", "Mở file", `data-id="${esc(a.id)}"`)}${button("folder", "folder-opened", "Mở folder", `data-id="${esc(a.id)}"`)}</div>`).join("")}</div></details>`;
}
function assistantMarkup(text: string, messageId?: string) {
  const blocks = md.parse(text, {});
  const fence =
    blocks.length === 1 &&
    blocks[0].type === "fence" &&
    blocks[0].info.trim().toLowerCase() === "json"
      ? blocks[0]
      : undefined;
  if (fence) {
    try {
      const raw = JSON.parse(fence.content);
      if (["change_set", "tool_request", "run_plan"].includes(raw.type))
        return `<p>${esc(raw.type === "change_set" ? `Đã chuẩn bị thay đổi ${raw.edits.length} file.` : raw.type === "tool_request" ? `Đề xuất dùng ${raw.name}.` : "Đã chuẩn bị kế hoạch chạy.")}</p><details><summary>Xem contract JSON</summary>${md.render(text)}</details>`;
    } catch {}
  }
  return md.render(text, { messageId, sqlIndex: 0 });
}
function changeCard(record: any, c: any, pending?: any): string {
  const files = record.files ?? [],
    id = esc(record.id),
    active =
      pending &&
      ["pending", "failed", "expired"].includes(pending.status) &&
      !["applied", "interrupted", "applying"].includes(pending.data?.state),
    locked = state.busy || pending?.reviewBusy,
    strict = c.reviewMode === "strict",
    selected = pending?.selectedPaths ?? files.map((f: any) => f.path),
    ready =
      active &&
      selected.length &&
      !locked &&
      (!strict || (pending.diffOpened && pending.reviewConfirmed)),
    canUndo =
      !pending &&
      record.status === "applied" &&
      c.checkpoint?.changeId === record.id;
  const row = (f: any) =>
    `<div class="change-row">${active ? `<input type="checkbox" aria-label="Chọn ${esc(f.path)}" data-select-change="${id}" data-path="${esc(f.path)}" ${selected.includes(f.path) ? "checked" : ""} ${locked ? "disabled" : ""}>` : ""}<span class="change-path">${esc(f.path)}</span><span class="change-stat"><span class="plus">+${f.added ?? "—"}</span> <span class="minus">-${f.removed ?? "—"}</span></span></div>`;
  const execution = pending?.data?.goalId ? undefined : pending?.runPreview;
  const footer = pending
    ? `<div class="changes-footer proposal-flow">
    ${active ? `<label class="proposal-confirm"><input type="checkbox" data-select-change="${id}" data-path="*" ${selected.length === files.length ? "checked" : ""} ${locked ? "disabled" : ""}>Chọn tất cả · ${selected.length}/${files.length} file</label><label><input type="checkbox" data-review-mode ${strict ? "checked" : ""} ${locked ? "disabled" : ""}> Bắt buộc xem diff và xác nhận</label>` : ""}
    ${active && strict ? `<label class="proposal-confirm"><input type="checkbox" data-confirm-review="${id}" data-revision="${esc(pending.reviewRevision || "")}" ${pending.reviewConfirmed ? "checked" : ""} ${!pending.diffOpened || locked ? "disabled" : ""}>Tôi đã xem diff và đồng ý áp dụng</label>` : ""}
    ${pending.error ? `<div class="proposal-error" role="alert">${esc(pending.error)}</div>` : ""}
    ${
      active && !pending?.data?.goalId
        ? `<details data-run-preview="${id}" ${expandedRunPlans.has(record.id) ? "open" : ""}><summary>Lệnh khi chấp nhận và chạy</summary><select data-change-task="${id}" aria-label="Task sau cập nhật" ${locked ? "disabled" : ""}>${[
            ["start", "Chạy"],
            ["check", "Test"],
            ["startAndCheck", "Chạy + test"],
          ]
            .map(
              ([value, label]) =>
                `<option value="${value}" ${(pending.runTask || "start") === value ? "selected" : ""}>${label}</option>`,
            )
            .join(
              "",
            )}</select><button data-action="previewChangeRun" data-id="${id}" data-task="${pending.runTask || "start"}" ${locked ? "disabled" : ""}>${icon("refresh")} Làm mới lệnh</button>${pending.previewBusy ? `<p>Đang chuẩn bị lệnh…</p>` : execution ? `<pre>${esc(JSON.stringify(execution.commands, null, 2))}</pre>` : `<p class="muted">${esc(pending.runError || "Chưa có contract chạy. Vẫn có thể chấp nhận source.")}</p>`}</details>`
        : ""
    }
    <div class="card-actions">${active ? `<button class="primary" data-action="approve" data-id="${id}" ${ready ? "" : "disabled"}>${icon("check")} Chấp nhận ${selected.length} file</button><button data-action="acceptRun" data-id="${id}" ${ready && execution && !pending.previewBusy ? "" : "disabled"}>${icon("play")} Chấp nhận và chạy</button><button data-action="reject" data-id="${id}" ${locked ? "disabled" : ""}>${icon("close")} Bỏ qua</button>` : `<span>${pending.status === "running" ? "Đang backup và cập nhật…" : ["rejected", "skipped"].includes(pending.status) ? "Đã bỏ qua · workspace giữ nguyên" : esc(pending.status)}</span>`}</div>
    ${(c.activities ?? [])
      .filter((a: any) => a.changeId === pending.id)
      .map(activityCard)
      .join(
        "",
      )}${pending.kind === "archive" && ["applying", "interrupted"].includes(pending.data.state) && c.checkpoint?.archivePlan?.id === pending.data.id ? `<button data-action="checkpoint" ${state.busy ? "disabled" : ""}>${icon("history")} Khôi phục cập nhật dở</button>` : ""}<small>Backup Git trước khi ghi file đã chọn. Xem diff là tùy chọn khi tắt chế độ bắt buộc.</small></div>`
    : `<div class="changes-footer proposal-flow"><p>${record.status === "restored" ? "Đã khôi phục" : "Đã cập nhật workspace"} · ${files.length} file</p>${record.remainingPaths?.length ? `<details><summary>${record.remainingPaths.length} file chưa áp dụng trong lượt này</summary><pre>${esc(record.remainingPaths.join("\n"))}</pre><button data-action="remainingChange" data-id="${id}" ${state.busy ? "disabled" : ""}>Tạo đề xuất cho phần còn lại</button></details>` : ""}${(record.runs ?? (record.run ? [record.run] : [])).map((run: any) => `<p role="status">${run.task === "check" ? "Test" : run.task === "startAndCheck" ? "Chạy + test" : "Chạy"}: ${esc(run.status)}</p>`).join("")}${record.error ? `<div class="proposal-error" role="alert">${esc(record.error)}</div>` : ""}${(
        c.activities ?? []
      )
        .filter((a: any) => a.changeId === record.id)
        .map(activityCard)
        .join(
          "",
        )}${c.pending?.kind === "run" && c.pending.data.changeId === record.id ? pendingCard(c.pending) : ""}${canUndo ? `<div class="card-actions"><button data-action="changeTask" data-id="${id}" data-task="start" ${state.busy ? "disabled" : ""}>${icon("play")} Chạy</button><button data-action="changeTask" data-id="${id}" data-task="check" ${state.busy ? "disabled" : ""}>${icon("beaker")} Test</button><button data-action="validateChange" data-id="${id}" ${state.busy ? "disabled" : ""}>${icon("verified")} Developer/tester xác nhận</button></div>` : ""}${record.validation ? `<p>${esc(record.validation.label)} · ${esc(record.validation.at)}</p>` : ""}</div>`;
  return `<section class="card changes-card" data-proposal="${id}"><div class="changes-top"><div class="changes-symbol">${icon("diff-multiple")}</div><div class="changes-heading">${pending ? "Thay đổi đề xuất" : record.status === "restored" ? "Đã khôi phục" : "Đã chấp nhận"} · ${files.length} file</div><span class="spacer"></span><div class="changes-actions">${!pending ? `<button data-action="checkpoint" data-id="${id}" ${canUndo && !state.busy ? "" : "disabled"}>Undo ${icon("discard")}</button>` : ""}<button class="outlined" data-action="viewChange" data-id="${id}" ${locked ? "disabled" : ""}>Xem thay đổi</button></div></div>${files.slice(0, 3).map(row).join("")}${files.length > 3 ? `<details class="change-more" data-more-changes="${id}" ${expandedChanges.has(record.id) ? "open" : ""}><summary>Show ${files.length - 3} more files</summary>${files.slice(3).map(row).join("")}</details>` : ""}${footer}</section>`;
}
function pendingCard(p: any): string {
  if (p.kind === "changes" || p.kind === "archive") {
    const fallback =
      p.kind === "archive"
        ? p.data.files.map((f: any) => ({
            path: f.path,
            added: null,
            removed: null,
            binary: f.binary,
          }))
        : p.data.edits.map((e: any) => ({
            path: e.path,
            added: null,
            removed: null,
            binary: false,
          }));
    return changeCard(
      { id: p.id, files: p.allDiffFiles ?? p.diffFiles ?? fallback },
      state.conversation,
      p,
    );
  }
  const active = p.status === "pending";
  let title = "",
    body = "",
    action = "",
    symbol = "";
  if (p.kind === "setup") {
    title = p.data.activateLocalPython ? "Cài runtime GGUF" : "Chuẩn bị môi trường Nopilot";
    symbol = "tools";
    body = `<p>Tạo hoặc tái sử dụng venv riêng, cài Frida, web/Playwright, ODBC và Excel${p.data.voice ? ", nhận giọng nói" : ""}.</p><p>Runtime sau setup: <code>${esc(p.data.activatePython)}</code></p><details><summary>Xem lệnh cài đặt</summary><pre>${esc(JSON.stringify(p.data.commands, null, 2))}</pre></details><p>Sau khi hoàn tất, Nopilot sẽ dùng runtime này. Driver ODBC Databricks và model giọng nói được chuẩn bị riêng.</p>`;
    if (p.data.activateLocalPython) body = `<p>Cài wheel CPU vào venv riêng. Python GGUF: <code>${esc(p.data.activateLocalPython)}</code></p><details><summary>Xem lệnh cài đặt</summary><pre>${esc(JSON.stringify(p.data.commands, null, 2))}</pre></details>`;
    action = `<button class="primary" data-action="approve" data-id="${esc(p.id)}">${icon("tools")}Duyệt cài đặt</button>`;
  } else if (p.kind === "tool") {
    title = p.data.name;
    symbol = "tools";
    body = `<pre>${esc(JSON.stringify(p.data.args, null, 2))}</pre><p>${p.data.localOnly ? "Kết quả sẽ lưu local. Bạn có thể đưa kết quả vào bản nháp sau khi chạy." : "Kết quả sẽ được đưa lại cho Copilot sau khi duyệt."}</p>`;
    action = `<button class="primary" data-action="approve" data-id="${esc(p.id)}">${icon("play")}Duyệt tool</button>`;
  } else {
    title = "Chạy trên workspace";
    symbol = "terminal";
    body = `<pre>${esc(JSON.stringify(p.data.commands, null, 2))}</pre><p>Kiểm tra executable, args, cwd và timeout trước khi chạy.</p>`;
    action = `<button class="primary" data-action="approve" data-id="${esc(p.id)}">${icon("play")}Duyệt và chạy</button>`;
  }
  return `<section class="card"><div class="card-title">${icon(symbol)}${esc(title)}</div>${body}${p.error ? `<p class="error" role="alert">${esc(p.error)}</p>` : ""}${active ? `<div class="card-actions">${action}${button("reject", "close", "Từ chối đề xuất", `data-id="${esc(p.id)}"`)}</div>` : `<p class="muted">${esc(p.status)}</p>${p.status === "paused" ? '<button class="primary" data-action="more">Thêm 20 vòng</button>' : ""}`}</section>`;
}
function activityCard(a: any) {
  const running = a.status === "running",
    failed = a.status === "failed";
  return `<details class="card activity" data-activity="${esc(a.id)}" ${expandedActivities.has(a.id) ? "open" : ""}><summary>${icon(running ? "loading" : failed ? "error" : a.status === "stopped" ? "debug-stop" : "check")}<span class="activity-title">${esc(a.title)}</span><small>${a.exitCode !== undefined ? "exit " + esc(a.exitCode) : esc(a.status)}</small>${icon("chevron-right")}</summary><div class="activity-body">${a.command ? `<p><code>${esc(typeof a.command === "string" ? a.command : JSON.stringify(a.command))}</code></p>` : ""}<pre><code>${esc(a.output || "Đang chờ output…")}</code></pre>${a.truncated ? "<small>Output hiển thị đã rút gọn; mở log để xem đầy đủ.</small>" : ""}${a.error ? `<p class="activity-error">${esc(a.error)}</p>` : ""}<div class="card-actions">${button("showOutput", "output", "Mở Output channel")}${a.artifactId ? button("openArtifact", "go-to-file", "Mở log đầy đủ", `data-id="${esc(a.artifactId)}"`) : ""}${a.localResult && !running ? `<button data-action="draftLocalResult" data-id="${esc(a.id)}">Đưa kết quả vào bản nháp</button>` : ""}</div></div></details>`;
}
function activityAnchored(c: any, a: any) {
  return !!a.messageId && c.messages.some((m: any) => m.id === a.messageId);
}
const expandedActivityHistory = new Set<string>();
function activityHistory(c: any) {
  const old = (c.activities ?? []).filter(
    (a: any) =>
      a.status !== "running" && !a.changeId && !activityAnchored(c, a),
  );
  return old.length
    ? `<details class="card activity-history" data-activity-history="${esc(c.id)}" ${expandedActivityHistory.has(c.id) ? "open" : ""}><summary>${icon("history")} Nhật ký hoạt động trước đây · ${old.length}</summary>${old.map(activityCard).join("")}</details>`
    : "";
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
function blockedSendCard(c: any) {
  if (
    !c.blockedSend ||
    c.pending?.id !== c.blockedSend.proposalId ||
    c.pending.status !== "pending"
  )
    return "";
  return `<section class="card send-choice" role="status"><strong>Còn đề xuất chưa áp dụng</strong><p>Yêu cầu mới chưa được gửi. Bạn có thể xem đề xuất cũ hoặc bỏ qua nó để gửi nội dung đang nhập. Source và ZIP đã tải vẫn được giữ nguyên.</p><div class="card-actions"><button data-action="reviewBlockedSend">${icon("diff")} Xem đề xuất cũ</button><button class="primary" data-action="sendInstead" data-id="${esc(c.pending.id)}">${icon("arrow-up")} Bỏ qua đề xuất cũ và gửi</button>${button("cancelBlockedSend", "close", "Đóng lựa chọn, giữ nội dung đang nhập")}</div></section>`;
}
function visibleMessages(messages: any[]) {
  const result: any[] = [];
  for (const m of messages) {
    if (
      m.role === "system" &&
      /^Đã đóng gói \d+ file workspace theo \.nopilotignore cho Decimen\./.test(
        m.text,
      )
    )
      continue;
    const previous = result.at(-1);
    if (
      m.role === "system" &&
      m.text === "Error: Duyệt hoặc từ chối đề xuất hiện tại trước." &&
      previous?.role === m.role &&
      previous.text === m.text
    )
      previous.repeated = (previous.repeated ?? 1) + 1;
    else result.push({ ...m });
  }
  return result;
}
const goalDisclosure = new Map<string, boolean>();
function render() {
  for (const details of app.querySelectorAll<HTMLDetailsElement>(
    "details[data-goal-key]",
  ))
    goalDisclosure.set(details.dataset.goalKey!, details.open);
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
  app.innerHTML = `<header><div class="header-row"><strong class="nopilot-brand">Nopilot</strong><span class="spacer"></span>${button("new", "add", "Hội thoại mới")}${button("history", "history", "Lịch sử")}${teamsButton(true)}${button("moreMenu", "ellipsis", "Thao tác hội thoại")}</div><div class="conversation-row"><span class="title" title="${esc(c.title)}">${esc(c.title)}</span><small>${c.goal ? c.goal.round + "/" + c.goal.budget : c.turns + "/20"}</small></div><div id="headerPopover"></div></header><main>${setupCard()}${goalCard(c.goal, state.busy, c.goal ? goalDisclosure.get(c.goal.id + ":" + c.goal.status) : undefined)}${artifacts(c)}${activityHistory(c)}${!c.messages.length && !c.pending ? `<div class="welcome"><div class="welcome-symbol">${icon("comment-discussion")}<span class="spark">${icon("sparkle")}</span></div><h2>Làm việc cùng Nopilot</h2><p>Copilot, ngay trong workspace.<br>Review thay đổi trước khi áp dụng.</p>${teamsButton()}<button class="setup-link" data-action="setupRecheck">Kiểm tra thiết lập</button><span class="hint">Gõ @ để thêm context · Ctrl+V để dán ảnh</span></div>` : ""}${visibleMessages(
    c.messages,
  )
    .map(
      (m: any) =>
        `<article class="message ${esc(m.role)}"><div class="message-body">${m.role === "assistant" ? assistantMarkup(m.text, m.id) : m.repeated ? `<details class="repeated-notice"><summary>Thông báo cũ lặp ${m.repeated} lần</summary>${esc(m.text)}</details>` : esc(m.text)}</div>${m.id && ["user", "assistant"].includes(m.role) ? `<div class="message-tools">${button("copyMessage", "copy", m.role === "user" ? "Copy câu hỏi" : "Copy câu trả lời", `data-id="${esc(m.id)}"`)}${m.role === "assistant" && !["local", "smallModel"].includes(m.source) ? button("localFromMessage", "chip", "Diễn giải bằng model local · chưa thực thi", `data-id="${esc(m.id)}"`) : ""}</div>` : ""}</article>${(
          c.changeHistory ?? []
        )
          .filter((change: any) => change.messageId === m.id)
          .map((change: any) => changeCard(change, c))
          .join("")}${(c.skippedProposals ?? [])
          .filter(
            (p: any) =>
              p.messageId === m.id &&
              p.id !== c.pending?.id &&
              !(c.changeHistory ?? []).some((r: any) => r.id === p.id),
          )
          .map(pendingCard)
          .join(
            "",
          )}${c.pending && m.id && c.pending.messageId === m.id && ["archive", "changes"].includes(c.pending.kind) ? pendingCard(c.pending) : ""}${(
          c.activities ?? []
        )
          .filter(
            (a: any) => !a.changeId && a.messageId && a.messageId === m.id,
          )
          .map(activityCard)
          .join("")}${artifacts(c, m.id)}`,
    )
    .join("")}${(c.changeHistory ?? [])
    .filter((change: any) => !change.messageId)
    .map((change: any) => changeCard(change, c))
    .join(
      "",
    )}${c.recovery ? `<section class="card recovery-card"><div class="card-title">${icon(c.recovery.kind === "stopped" ? "debug-stop" : "warning")}<span>Copilot · ${esc(c.recovery.kind)}</span></div><p>${esc(c.recovery.message)}</p>${c.request ? `<small>Request: ${esc(c.request.requestId)}<br>Copilot: ${esc(c.teamsId || "Chưa xác định ID")} · ${esc(c.request.phase)}</small>` : ""}<div class="card-actions"><button data-action="recoverCopilot" ${state.busy ? "disabled" : ""}>${icon("refresh")} ${c.request ? "Khôi phục đúng lượt" : "Kiểm tra trạng thái"}</button><button data-action="new">${icon("add")} Hội thoại mới</button></div></section>` : ""}${c.pending && !c.pending.data?.changeId && !(["archive", "changes"].includes(c.pending.kind) && c.pending.messageId && c.messages.some((m: any) => m.id === c.pending.messageId)) ? pendingCard(c.pending) : ""}${(
    c.activities ?? []
  )
    .filter(
      (a: any) =>
        a.status === "running" && !a.changeId && !activityAnchored(c, a),
    )
    .map(activityCard)
    .join("")}${(c.sqlCards ?? [])
    .filter((card: any) => !card.messageId && card.visible)
    .map(inlineSql)
    .join(
      "",
    )}${c.checkpoint && !c.pending && !c.changeHistory?.length ? projectActions(c) : ""}${zipPreview(c)}${previewMarkup()}${c.archiveQueue?.length ? `<section class="card"><button data-action="archiveNext">${icon("file-zip")}Chọn ZIP đã stage (${c.archiveQueue.length})</button></section>` : ""}</main><footer>${workIndicator()}${blockedSendCard(c)}${queueMarkup(c)}${error ? `<div class="error">${icon("error")}<span>${esc(error)}</span>${button("dismissError", "close", "Đóng thông báo")}</div>` : ""}<div class="composer">${voiceMarkup()}<div id="composerPopover"></div><div class="chips">${contextChips(c)}</div><textarea id="prompt" aria-label="Nhắn Copilot" aria-autocomplete="list" aria-controls="nopilot-options" aria-expanded="false" placeholder="Bạn muốn phát triển điều gì?" title="Enter gửi · Shift+Enter xuống dòng · @ context · / lệnh">${esc(c.draft)}</textarea><div class="composer-actions">${button("addMenu", "add", "Thêm file hoặc context")}${button("tools", "globe", c.tools ? "Tắt web tools" : "Bật web tools", `aria-pressed="${c.tools}"`, c.tools ? "toggle-on" : "")}${c.files.length ? button("previewContext", "eye", "Xem nội dung context sẽ gửi") : ""}<span class="spacer"></span>${state.canStopCopilot ? button("stopCopilot", "debug-stop", "Dừng Copilot qua bridge", "", "danger") : ""}${state.canStop ? button("stop", "debug-stop", "Dừng lệnh local đang chạy", "", "danger") : ""}${state.busy ? button("steer", "arrow-up", state.canStopCopilot ? "Steer: dừng Copilot rồi gửi chỉ dẫn mới" : "Ưu tiên draft cho lượt kế tiếp · không đổi lượt đang chạy") : ""}${modelPicker()}${button("voiceToggle", state.voice?.status === "recording" ? "debug-stop" : "mic", state.voice?.status === "recording" ? "Dừng ghi và nhận dạng" : "Nhập giọng nói local", "", state.voice?.status === "recording" ? "recording" : "")}${button("send", state.busy ? "add" : "arrow-up", state.busy ? "Thêm vào hàng đợi" : "Gửi tin nhắn", "", "send primary")}</div></div><div class="footer-meta"><label class="project-toggle" title="Gửi các file hợp lệ trong workspace sau khi áp dụng quy tắc loại trừ mặc định và .nopilotignore. Nếu đã chọn file, chỉ gửi các file đó."><input id="includeProject" type="checkbox" aria-label="Include project" ${c.mode === "develop" && c.autoWorkspace && c.includeProject === true ? "checked" : ""} ${state.busy || !state.root ? "disabled" : ""}>Include project</label><button data-action="projectPicker" title="Chọn file, thư mục hoặc khôi phục tất cả file hợp lệ" ${state.busy || !state.root ? "disabled" : ""}>${icon("list-tree")} ${c.projectSelection === undefined ? "Tất cả file hợp lệ" : `Đã chọn ${c.projectSelection.length} file`}</button><button data-action="initIgnore" title="Mở quy tắc loại trừ khi gửi project">.nopilotignore</button><button data-action="help" title="Hướng dẫn context, duyệt thay đổi và chạy project">${icon("shield")}Duyệt thao tác</button><span class="spacer"></span>${c.attachments.length ? `<span title="Tối đa 3 attachments">${icon("attach")}${c.attachments.length}/3</span>` : ""}</div></footer>${historyOpen ? historyMarkup() : ""}`;
  app
    .querySelectorAll<HTMLDetailsElement>("details[data-activity-history]")
    .forEach((el) =>
      el.addEventListener("toggle", () => {
        if (el.open) expandedActivityHistory.add(el.dataset.activityHistory!);
        else expandedActivityHistory.delete(el.dataset.activityHistory!);
      }),
    );
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
  app
    .querySelectorAll<HTMLDetailsElement>("details[data-more-changes]")
    .forEach((el) =>
      el.addEventListener("toggle", () => {
        if (el.open) expandedChanges.add(el.dataset.moreChanges!);
        else expandedChanges.delete(el.dataset.moreChanges!);
      }),
    );
  document
    .getElementById("includeProject")
    ?.addEventListener("change", (event) =>
      post("includeProject", {
        enabled: (event.target as HTMLInputElement).checked,
      }),
    );
  const main = document.querySelector("main")!;
  main.scrollTop =
    sqlAnchor?.conversation === c.id || proposalAnchor?.conversation === c.id
      ? scroll
      : atBottom
        ? main.scrollHeight
        : scroll;
  if (sqlAnchor && sqlAnchor.conversation === c.id) {
    const anchor = sqlAnchor;
    const node = Array.from(
      main.querySelectorAll<HTMLElement>(
        anchor.message ? ".sql-snippet" : "[data-sql-result]",
      ),
    ).find((node) =>
      anchor.message
        ? node.dataset.sqlMessage === anchor.message &&
          node.dataset.sqlIndex === anchor.index
        : node.dataset.sqlResult === anchor.result,
    );
    if (node)
      main.scrollTop +=
        node.getBoundingClientRect().top -
        main.getBoundingClientRect().top -
        anchor.top;
  }
  if (
    proposalAnchor &&
    proposalAnchor.conversation === c.id &&
    main.getBoundingClientRect().height > 0
  ) {
    const node = [
      ...main.querySelectorAll<HTMLElement>("[data-proposal]"),
    ].find((n) => n.dataset.proposal === proposalAnchor!.id);
    if (node)
      main.scrollTop +=
        node.getBoundingClientRect().top -
        main.getBoundingClientRect().top -
        proposalAnchor.top;
  }
  main.addEventListener(
    "wheel",
    () => {
      proposalAnchor = undefined;
    },
    { passive: true },
  );
  main.addEventListener("wheel", () => (sqlAnchor = undefined), {
    passive: true,
  });
  main.addEventListener("pointerdown", () => (sqlAnchor = undefined));
  main.addEventListener("keydown", (event) => {
    if (
      ["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(
        event.key,
      )
    )
      sqlAnchor = undefined;
  });
  main.addEventListener("touchstart", () => (sqlAnchor = undefined), {
    passive: true,
  });
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
    .getElementById("copilot-model")
    ?.addEventListener("change", (e) =>
      post("copilotModel", { model: (e.target as HTMLSelectElement).value }),
    );
  app
    .querySelectorAll<HTMLDetailsElement>("details[data-run-preview]")
    .forEach((detail) =>
      detail.addEventListener("toggle", () => {
        if (detail.open) expandedRunPlans.add(detail.dataset.runPreview!);
        else expandedRunPlans.delete(detail.dataset.runPreview!);
      }),
    );
  app
    .querySelectorAll<HTMLInputElement>(
      'input[data-select-change][data-path="*"]',
    )
    .forEach((box) => {
      const p = c.pending;
      if (p && p.selectedPaths)
        box.indeterminate =
          p.selectedPaths.length > 0 &&
          p.selectedPaths.length <
            (
              p.allDiffFiles ??
              p.diffFiles ??
              (p.kind === "archive" ? p.data.files : p.data.edits)
            ).length;
    });
  app
    .querySelectorAll<HTMLInputElement>("input[data-select-change]")
    .forEach((box) =>
      box.addEventListener("change", () => {
        rememberProposalAnchor(box);
        post("selectChange", {
          id: box.dataset.selectChange,
          path: box.dataset.path,
          selected: box.checked,
        });
      }),
    );
  app
    .querySelectorAll<HTMLInputElement>("input[data-review-mode]")
    .forEach((box) =>
      box.addEventListener("change", () => {
        rememberProposalAnchor(box);
        post("setReviewMode", { mode: box.checked ? "strict" : "fast" });
      }),
    );
  app
    .querySelectorAll<HTMLSelectElement>("select[data-change-task]")
    .forEach((select) =>
      select.addEventListener("change", () => {
        rememberProposalAnchor(select);
        post("previewChangeRun", {
          id: select.dataset.changeTask,
          task: select.value,
        });
      }),
    );
  app
    .querySelectorAll<HTMLInputElement>("input[data-confirm-review]")
    .forEach((box) =>
      box.addEventListener("change", () => {
        rememberProposalAnchor(box);
        post("confirmReview", {
          id: box.dataset.confirmReview,
          revision: box.dataset.revision,
          confirmed: box.checked,
        });
      }),
    );
  app.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((b) =>
    b.addEventListener("click", () => {
      if (
        ["showSqlInline", "sqlPage", "sqlHide", "sqlCollapse"].includes(
          b.dataset.action!,
        )
      )
        rememberSqlAnchor(b);
      if (b.closest(".changes-card")) rememberProposalAnchor(b);
      action(b.dataset.action!, {
        id: b.dataset.id,
        kind: b.dataset.kind,
        task: b.dataset.task,
        path: b.dataset.path,
        ...(b.dataset.offset !== undefined
          ? { offset: Number(b.dataset.offset) }
          : {}),
        ...(b.dataset.index !== undefined
          ? { index: Number(b.dataset.index) }
          : {}),
      });
    }),
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
  syncProjectPicker(state.projectPicker, post);
  syncGoalForm(
    !state.goalForm?.surface || state.goalForm.surface === state.surface
      ? state.goalForm
      : undefined,
    post,
  );
  app
    .querySelectorAll<HTMLInputElement>("input[data-goal-confirm]")
    .forEach((box) =>
      box.addEventListener("change", () =>
        post("goalConfirm", {
          id: box.dataset.goalId,
          index: Number(box.dataset.goalConfirm),
          confirmed: box.checked,
        }),
      ),
    );
  refreshWorkIndicator();
  syncDecimen(state.decTransfer, post);
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
        id: "moveSidebar",
        label: "Chuyển chat sang sidebar…",
        detail: "Chọn New Secondary Side Bar Entry để đặt bên phải",
        icon: "layout-sidebar-right",
        action: "moveSidebar",
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
      id: "placement",
      label: state.surface === "editor" ? "Về sidebar" : "Mở chat trong editor",
      detail: "Vị trí cửa sổ Nopilot",
      icon:
        state.surface === "editor" ? "layout-sidebar-right" : "open-preview",
      action: state.surface === "editor" ? "sidebar" : "expand",
    },
    {
      id: "moveSidebar",
      label: "Đặt chat bên phải…",
      detail: "Chọn New Secondary Side Bar Entry",
      icon: "layout-sidebar-right",
      action: "moveSidebar",
    },
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
      id: "switchMode",
      label: state.conversation.mode === "develop" ? "Chỉ hỏi" : "Cho phép đề xuất thay đổi",
      detail: state.conversation.mode === "develop" ? "Trao đổi mà không stage thay đổi workspace" : "Xem và duyệt thay đổi workspace",
      icon: "shield",
      action: "switchMode",
    },
    {
      id: "setup",
      label: "Thiết lập Python",
      detail: "Tạo runtime và cài dependencies sau khi duyệt",
      icon: "tools",
      action: "setup",
    },
    {
      id: "initIgnore",
      label: ".nopilotignore",
      detail: "Tạo hoặc mở danh sách loại trừ project",
      icon: "exclude",
      action: "initIgnore",
    },
    {
      id: "database",
      label: "Data explorer",
      detail: "ODBC / SQLite · query và export CSV/Excel",
      icon: "database",
      action: "database",
    },
    {
      id: "migration",
      label: "Migration workbench",
      detail: "SQL nguồn / Databricks · đối chiếu và kiểm thử",
      icon: "git-compare",
      action: "migration",
    },
    {
      id: "localModel",
      label: "Local model",
      detail: "Python + GGUF · load, test, unload",
      icon: "chip",
      action: "localModel",
    },
    {
      id: "checkRuntime",
      label: "Check Runtime",
      detail: "Kiểm tra Python, dependencies và Microsoft Edge",
      icon: "pulse",
      action: "checkRuntime",
    },
    {
      id: "generateTeamsManifest",
      label: "Tạo manifest cho bản Teams này",
      detail: "Đọc PDB Microsoft hoặc phân tích DLL WebView2",
      icon: "tools",
      action: "generateTeamsManifest",
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
  // Project menu targets the latest checkpoint, not the conversation ID.
  // Individual change-card Undo buttons still send their explicit change ID.
  action(
    row.action,
    row.action === "checkpoint" ? {} : { id: state.conversation.id },
  );
}
function action(type: string, extra: any = {}) {
  if (
    ![
      "viewChange",
      "approve",
      "acceptRun",
      "reject",
      "checkpoint",
      "changeTask",
      "remainingChange",
      "validateChange",
    ].includes(type)
  )
    proposalAnchor = undefined;
  if (type === "sqlExportCsv" || type === "sqlExportXlsx") {
    post("sqlExport", {
      id: extra.id,
      format: type === "sqlExportCsv" ? "csv" : "xlsx",
    });
    return;
  }

  if (
    type === "copyZipFile" ||
    type === "copyZipSelected" ||
    type === "copyZipAll"
  ) {
    post("copyZip", {
      id: extra.id,
      all: type === "copyZipAll",
      paths:
        type === "copyZipFile"
          ? [extra.path]
          : type === "copyZipAll"
            ? []
            : Array.from(
                app.querySelectorAll<HTMLInputElement>(
                  "input[data-zip-path]:checked",
                ),
              ).map((e) => e.dataset.zipPath),
    });
    return;
  }

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
  if (type === "switchMode") {
    post("mode", { mode: state.conversation.mode === "develop" ? "ask" : "develop" });
    return;
  }
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
  sqlAnchor = undefined;
  proposalAnchor = undefined;
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
  if (
    ["migrationDraft", "focusDraft"].includes(event.data.type) &&
    state?.conversation.id === event.data.conversationId
  ) {
    const prompt = document.getElementById(
      "prompt",
    ) as HTMLTextAreaElement | null;
    if (prompt) {
      prompt.value = event.data.text;
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
      prompt.focus();
    }
    return;
  }
  const m = event.data;
  if (m.type === "decPayload") {
    receiveDecimen(m);
    return;
  }
  if (
    m.type === "copilotPreview" &&
    state &&
    m.conversationId === state.conversation.id &&
    m.preview.requestId === state.conversation.request?.requestId
  ) {
    state.copilotPreview = m.preview;
    state.copilotPhase = m.phase;
    updatePreview();
    return;
  }
  if (m.type === "snapshot") {
    if (state?.conversation.id !== m.state.conversation.id) {
      error = "";
      sqlAnchor = undefined;
      proposalAnchor = undefined;
      menu = undefined;
      historyQuery = "";
    }
    if (!state?.busy && m.state.busy) error = "";
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
    refreshWorkIndicator();
  } else if (m.type === "error") {
    error = m.text;
    render();
  }
});
post("ready");

style.textContent += `.project-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:#0007;padding:10px;box-sizing:border-box;font-family:var(--vscode-font-family);color:var(--vscode-foreground)}.project-dialog{display:flex;flex-direction:column;width:640px;max-width:100%;max-height:calc(100vh - 24px);background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:10px;padding:14px;box-sizing:border-box;box-shadow:0 8px 32px #0005;gap:9px}.project-heading{display:flex;align-items:center;justify-content:space-between}.project-root{font-size:11px;color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}.project-help{font-size:12px;margin:0}.project-search{box-sizing:border-box;width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);padding:7px}.project-toolbar,.project-footer{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.project-toolbar label{font-size:11px}.project-tree{overflow:auto;min-height:100px;max-height:50vh;border:1px solid var(--vscode-panel-border);padding:6px}.project-row{display:flex;align-items:center;gap:6px;padding:5px 2px;font-size:12px;cursor:pointer}.project-row>span{flex:1;overflow-wrap:anywhere}.project-row small{font-size:10px;color:var(--vscode-descriptionForeground);max-width:45%;overflow-wrap:anywhere}.project-row input{flex-shrink:0}.project-blocked{opacity:.65}.project-children{padding-left:18px}.project-tree details>summary{list-style:none}.project-tree details>summary:before{content:"▸";width:10px;flex-shrink:0}.project-tree details[open]>summary:before{content:"▾"}.project-summary{font-size:12px;font-weight:600}.project-policy{color:var(--vscode-descriptionForeground);font-size:11px}.project-footer{justify-content:flex-end}.project-all{font-weight:600;border-bottom:1px solid var(--vscode-panel-border)}.project-dialog button{cursor:pointer;padding:5px 9px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border);border-radius:5px}.project-dialog button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.project-dialog input:focus-visible,.project-dialog button:focus-visible,.project-dialog summary:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}`;

style.textContent += `.send-choice{padding:10px;margin-bottom:8px}.send-choice p{font-size:11px;color:var(--vscode-descriptionForeground);margin:5px 0}.send-choice .card-actions{flex-wrap:wrap}`;

let proposalAnchor:
  { conversation: string; id: string; top: number } | undefined;
function rememberProposalAnchor(element: HTMLElement) {
  const card = element.closest<HTMLElement>("[data-proposal]"),
    main = document.querySelector("main");
  if (card && main)
    proposalAnchor = {
      conversation: state.conversation.id,
      id: card.dataset.proposal!,
      top: card.getBoundingClientRect().top - main.getBoundingClientRect().top,
    };
}
style.textContent += `.proposal-flow{display:flex;flex-direction:column;gap:9px}.proposal-step,.proposal-confirm{font-size:12px}.proposal-confirm{display:flex;align-items:center;gap:7px}.proposal-flow small{color:var(--vscode-descriptionForeground);font-size:11px}.proposal-error{border-left:3px solid var(--vscode-errorForeground);padding:8px;color:var(--vscode-errorForeground);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.proposal-flow .card-actions{flex-wrap:wrap}`;

style.textContent += `.changes-footer.proposal-flow{align-items:stretch;flex-wrap:nowrap}.proposal-flow>.activity{width:100%;max-width:none;margin:0}.proposal-flow>p{margin:0;font-size:12px}.proposal-flow>details{margin:0}.proposal-flow>.card{max-width:100%;width:100%;margin:0}.proposal-flow pre{max-width:100%;overflow:auto}.changes-footer .proposal-confirm{justify-content:flex-start}.change-row>input{flex:none}`;

let workTicker: ReturnType<typeof setInterval> | undefined;
function workLabel() {
  const phase = state.copilotPhase || "";
  if (phase === "model") return "Đang chọn model Copilot…";
  if (phase.startsWith("upload:"))
    return "Đang đưa file lên Copilot · " + phase.slice(7);
  if (phase === "streaming") return "Copilot đang trả lời…";
  if (phase === "finishing") return "Đang nhận kết quả và file từ Copilot…";
  if (state.waitingCopilot) return "Teams Copilot đang chuẩn bị câu trả lời…";
  return state.status?.startsWith("Đang")
    ? state.status
    : "Đang chuẩn bị yêu cầu…";
}
function workIndicator() {
  return state.busy
    ? `<div class="work-indicator" role="status"><span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span><span id="workStatusText">${esc(workLabel())}</span><span class="spacer"></span><small id="workElapsed" aria-hidden="true"></small></div>`
    : "";
}
function refreshWorkIndicator() {
  const label = document.getElementById("workStatusText");
  if (label) label.textContent = workLabel();
  if (workTicker) clearInterval(workTicker);
  workTicker = undefined;
  const tick = () => {
    const elapsed = document.getElementById("workElapsed");
    if (elapsed && state.workStartedAt)
      elapsed.textContent =
        Math.max(0, Math.floor((Date.now() - state.workStartedAt) / 1000)) +
        "s";
  };
  if (state.busy) {
    tick();
    workTicker = setInterval(tick, 1000);
  }
}
function previewMarkup() {
  const preview = state.copilotPreview;
  return preview?.text &&
    preview.requestId === state.conversation.request?.requestId
    ? `<article class="message assistant stream-preview" aria-busy="true"><div class="stream-label">Copilot · đang soạn</div><div class="message-body">${md.render(preview.text)}</div></article>`
    : "";
}
function updatePreview() {
  const article = document.querySelector(".stream-preview"),
    main = document.querySelector("main");
  if (!article) {
    render();
    return;
  }
  article.querySelector(".message-body")!.innerHTML = md.render(
    state.copilotPreview.text,
  );
  refreshWorkIndicator();
  if (atBottom && main) main.scrollTop = main.scrollHeight;
}
style.textContent += `.connect-indicator:disabled{opacity:1;cursor:default}`;
style.textContent += `.nopilot-brand{font-size:12px;font-weight:600;color:var(--vscode-foreground)}.conversation-row{display:flex;align-items:center;gap:8px;margin-top:7px;color:var(--vscode-descriptionForeground)}.conversation-row small{font-size:10px;flex:none}.connect-indicator{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:180px;font-size:10px;padding:5px 7px;border:1px solid var(--vscode-panel-border);border-radius:5px}.connect-indicator .connection-label{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.connect-indicator .codicon-debug-connected{color:var(--vscode-testing-iconPassed)}.work-indicator{display:flex;align-items:center;gap:8px;padding:9px 4px 12px;font-size:12px;color:var(--vscode-descriptionForeground);min-height:32px}.work-indicator>.codicon{color:var(--vscode-progressBar-background)}.work-indicator>#workStatusText{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.stream-label{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:8px}.stream-preview{border-left:2px solid var(--vscode-progressBar-background);padding-left:12px}`;
