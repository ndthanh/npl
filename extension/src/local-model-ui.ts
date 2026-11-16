declare function acquireVsCodeApi(): { postMessage: (m: any) => void };
const api = acquireVsCodeApi(),
  app = document.getElementById("app")!,
  style = document.createElement("style");
style.nonce = (document.currentScript as HTMLScriptElement).nonce;
style.textContent = `*{box-sizing:border-box}body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font:13px var(--vscode-font-family,system-ui)}#app{max-width:900px;margin:auto;padding:30px}h1{font-size:22px}p{line-height:1.8;color:var(--vscode-descriptionForeground)}.card{border:1px solid var(--vscode-panel-border);border-radius:10px;padding:20px;margin:18px 0}label{display:flex;flex-direction:column;gap:7px;margin-bottom:18px}input,button{font:inherit;color:inherit;border:1px solid var(--vscode-panel-border);border-radius:5px;padding:9px;background:var(--vscode-input-background)}input{width:100%;min-width:0}.row{display:flex;gap:9px;align-items:center}.row input{flex:1}button{cursor:pointer;white-space:nowrap;background:var(--vscode-button-secondaryBackground)}button:disabled{opacity:.45;cursor:default}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.actions{margin-top:18px;display:flex;gap:8px;flex-wrap:wrap}.status{display:flex;gap:10px;align-items:center;line-height:1.7}.dot{width:9px;height:9px;border-radius:50%;background:var(--vscode-descriptionForeground)}.ready .dot{background:var(--vscode-testing-iconPassed,#73c991)}.busy .dot,.loading .dot{background:var(--vscode-progressBar-background);animation:pulse 1s infinite}@keyframes pulse{50%{opacity:.25}}.error{color:var(--vscode-errorForeground);white-space:pre-wrap;overflow-wrap:anywhere}code{font-family:var(--vscode-editor-font-family,monospace)}small{color:var(--vscode-descriptionForeground)}@media(max-width:650px){.grid{grid-template-columns:1fr 1fr}#app{padding:18px}}`;
document.head.append(style);
const esc = (v: any) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let state: any;
function setupCard(setup: any, disabled: string) {
  const phase = setup?.phase ?? "checking";
  const title = phase === "ready" ? "Runtime GGUF sẵn sàng" : "Thiết lập runtime GGUF";
  const detail = {
    checking: "Đang kiểm tra Python và llama-cpp-python…",
    missing: "Python này thiếu llama-cpp-python. Chọn cài runtime riêng hoặc dùng bộ wheel offline.",
    broken: "Đã thấy llama-cpp-python nhưng không nạp được thư viện. Thử runtime riêng hoặc kiểm tra wheel đúng kiến trúc.",
    unavailable: "Không chạy được Python đã chọn. Chọn python.exe rồi kiểm tra lại.",
    ready: "Có thể chọn file GGUF và bấm Load model.",
  }[phase as string];
  return `<section class="card" aria-label="Thiết lập runtime GGUF"><strong>${title}</strong><p role="status">${esc(detail)} ${setup?.pythonVersion ? esc("Python " + setup.pythonVersion + " · " + setup.architecture) : ""}</p><div class="actions">${["checking","ready","unavailable"].includes(phase) ? "" : `<button class="primary" data-action="install" ${disabled}>Cài runtime GGUF…</button><button data-action="installOffline" ${disabled}>Dùng wheel offline…</button>`}<button data-action="health" ${disabled}>Kiểm tra lại</button></div></section>`;
}
function render() {
  const c = state.config,
    r = state.runtime,
    busy = state.busy || ["loading", "busy"].includes(r.status),
    disabled = busy ? "disabled" : "";
  app.innerHTML = `<h1>Nopilot · Local Model</h1><p>Chạy GGUF offline trong Python riêng. Model đọc context được phép và đề xuất tool; lệnh CMD, web và thay đổi vẫn qua card duyệt của Nopilot.</p>${setupCard(state.setup, disabled)}<section class="card"><label>Python runtime<div class="row"><input id="pythonPath" value="${esc(c.pythonPath)}" ${disabled}><button data-action="choosePython" ${disabled}>Chọn…</button></div></label><label>Model GGUF<div class="row"><input id="modelPath" placeholder="C:\\Models\\model.gguf" value="${esc(c.modelPath)}" ${disabled}><button data-action="chooseModel" ${disabled}>Chọn…</button></div></label><div class="grid">${[
    ["contextSize", "Context tokens"],
    ["threads", "CPU threads"],
    ["gpuLayers", "GPU layers"],
    ["maxSteps", "Bước local tối đa"],
  ]
    .map(
      ([key, label]) =>
        `<label>${label}<input type="number" id="${key}" value="${esc(c[key])}" ${disabled}></label>`,
    )
    .join(
      "",
    )}</div><small>Gợi ý: Qwen3-4B-Instruct-2507 Q4_K_M · Context 8192 · Threads 4 · GPU layers 0 (CPU). GPU cần runtime tương thích; chưa tự benchmark hay cài driver.</small><div class="actions"><button class="primary" data-action="load" ${state.setup?.phase === "ready" ? disabled : "disabled"}>Load model</button><button data-action="save" ${disabled}>Lưu cấu hình</button><button data-action="test" ${r.status !== "ready" || busy ? "disabled" : ""}>Test JSON</button><button data-action="stop">${busy ? "Dừng" : "Unload"}</button><button data-action="guide">Hướng dẫn</button></div></section><section class="card"><div class="status ${esc(r.status)}" role="status"><span class="dot"></span><strong>${esc(r.status)}</strong><span>${esc(r.message)}</span></div>${r.elapsedMs ? `<p>Lượt gần nhất: ${r.elapsedMs} ms</p>` : ""}${state.error ? `<p class="error" role="alert">${esc(state.error)}</p>` : ""}</section><p>Trong chat: <code>/local nội dung cần xử lý</code>, <code>/local last</code> để dùng câu trả lời Copilot gần nhất. Có nút Local cạnh câu trả lời. Không tự gửi kết quả local lên Teams.</p>`;
}
app.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-action]",
  );
  if (!button || button.disabled) return;
  const config: any = {};
  for (const key of [
    "pythonPath",
    "modelPath",
    "contextSize",
    "threads",
    "gpuLayers",
    "maxSteps",
  ]) {
    const e = document.getElementById(key) as HTMLInputElement;
    config[key] = e.type === "number" ? Number(e.value) : e.value;
  }
  api.postMessage({ type: button.dataset.action, config });
});
window.addEventListener("message", (e) => {
  if (e.data.type === "snapshot") {
    const previous = state?.config;
    const focused = document.activeElement as HTMLInputElement | null;
    const id = focused?.id;
    const typed = previous && e.data.config.pythonPath === previous.pythonPath && e.data.config.modelPath === previous.modelPath
      ? Object.fromEntries(["pythonPath", "modelPath", "contextSize", "threads", "gpuLayers", "maxSteps"].flatMap((key) => {
        const input = document.getElementById(key) as HTMLInputElement | null;
        return input && input.value !== String(previous[key]) ? [[key, input.value]] : [];
      })) : {};
    state = e.data;
    render();
    for (const [key, value] of Object.entries(typed))
      (document.getElementById(key) as HTMLInputElement).value = String(value);
    if (id) document.getElementById(id)?.focus();
  }
});
api.postMessage({ type: "ready" });
