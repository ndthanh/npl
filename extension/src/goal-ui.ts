import type { Goal } from "./goal";
const esc = (s: any) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function goalCard(
  g: Goal | undefined,
  busy: boolean,
  expanded?: boolean,
) {
  if (!g) return "";
  const labels = {
    waiting: "Chờ Copilot",
    approval: "Chờ duyệt thay đổi",
    testing: "Chờ duyệt kiểm thử",
    needs_fix: "Cần sửa",
    review: "Test đạt · xác nhận DoD",
    paused: "Tạm dừng",
    budget: "Hết lượt",
    completed: "Hoàn tất",
  };
  const b = (kind: string, text: string) =>
    `<button data-action="goalAction" data-kind="${kind}" data-id="${esc(g.id)}" ${busy ? "disabled" : ""}>${text}</button>`;
  return `<section class="changes-card goal-card"><details data-goal-key="${esc(g.id + ":" + g.status)}" ${(expanded ?? g.status === "review") ? "open" : ""}><summary><strong>Goal · ${labels[g.status]}</strong> <small>${g.round}/${g.budget} lượt</small></summary><p>${esc(g.objective)}</p>${g.error ? `<p role="alert">${esc(g.error)}</p>` : ""}<div>${g.dod.map((s, i) => `<label><input type="checkbox" data-goal-confirm="${i}" data-goal-id="${esc(g.id)}" ${g.confirmations[i] ? "checked" : ""} ${g.status !== "review" || busy ? "disabled" : ""}> ${esc(s)}</label>`).join("")}</div><small>${esc(g.scope)} · tối thiểu ${g.minTests} tests</small><details><summary>Lệnh kiểm thử</summary><code>${esc(g.verification)}</code></details>${g.evidence ? `<p>${g.evidence.passed ? "✓" : "×"} ${g.evidence.tests} tests · exit ${g.evidence.exitCode ?? "?"} · ${esc(g.evidence.at)}</p>` : ""}<div class="project-toolbar">${g.status === "completed" ? "" : b("pause", "Tạm dừng") + b("verify", "Kiểm thử") + (g.status === "paused" || g.status === "budget" ? b("resume", g.status === "budget" ? "Thêm 20 lượt" : "Tiếp tục") : "") + (g.status === "paused" ? b("stage", "Đọc lại đề xuất") : "") + (g.status === "needs_fix" ? b("feedback", "Gửi kết quả để sửa") : "") + (g.status === "review" ? b("finish", "Xác nhận hoàn tất") : "")}</div><small>Mỗi thay đổi và lệnh chạy cần duyệt. Test đạt chưa tự đánh dấu Done.</small></details></section>`;
}
let current: HTMLElement | undefined;
export function syncGoalForm(
  model: { id: string; objective: string; error?: string } | undefined,
  post: (type: string, extra?: any) => void,
) {
  if (!model) {
    current?.remove();
    current = undefined;
    return;
  }
  if (current?.dataset.id === model.id) {
    current.querySelector("[data-goal-error]")!.textContent = model.error ?? "";
    return;
  }
  current?.remove();
  current = document.createElement("div");
  current.className = "project-overlay";
  current.dataset.id = model.id;
  current.innerHTML = `<form class="project-dialog goal-dialog" role="dialog" aria-modal="true" aria-label="Thiết lập Goal"><div class="project-heading"><strong>Goal · Definition of Done</strong><button type="button" data-goal-close aria-label="Đóng">×</button></div><label>Mục tiêu<textarea name="objective" required rows="3"></textarea></label><label>Definition of Done · mỗi dòng một điều kiện<textarea name="dod" required rows="5"></textarea></label><label>Phạm vi thư mục<input name="scope" value="." required></label><label>Lệnh kiểm thử CMD<input name="verification" value="python -m unittest discover -s tests -v" required></label><label>Số test tối thiểu<input name="minTests" type="number" min="1" value="1" required></label><label>File test bảo vệ · mỗi dòng một đường dẫn<textarea name="protectedPaths" rows="2"></textarea></label><label><input name="shareLogs" type="checkbox"> Tự gửi kết quả test (tối đa 24 KB) về Copilot để sửa · source/lệnh vẫn cần duyệt</label><p data-goal-error role="alert"></p><p>Source trong phạm vi sẽ được đóng gói theo .nopilotignore và gửi Copilot.</p><p>20 lượt Copilot, sau đó xin thêm. Goal chỉ hoàn tất sau test đạt và bạn xác nhận DoD.</p><button type="submit">Bắt đầu Goal</button></form>`;
  current.querySelector<HTMLTextAreaElement>('[name="objective"]')!.value =
    model.objective;
  for (const el of current.querySelectorAll<HTMLElement>(
    "textarea,input:not([type=checkbox])",
  ))
    el.style.cssText =
      "display:block;width:100%;box-sizing:border-box;margin:5px 0 8px;padding:8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:4px;min-height:32px;font:inherit";
  current
    .querySelector("[data-goal-close]")!
    .addEventListener("click", () => post("goalClose"));
  current.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    post("goalStart", {
      formId: model.id,
      config: { ...Object.fromEntries(f), shareLogs: f.has("shareLogs") },
    });
  });
  current.addEventListener("keydown", (e) => {
    if (e.key === "Escape") post("goalClose");
  });
  document.body.append(current);
  current.querySelector<HTMLTextAreaElement>("textarea")!.focus();
}

export const goalCss = `
.goal-card { padding:16px; margin:12px 0; }
.goal-card label { display:block; margin:8px 0; }
.goal-card [role=alert], .goal-dialog [role=alert] { color:var(--vscode-errorForeground); }
.goal-dialog { display:flex; flex-direction:column; gap:8px; max-height:calc(100vh - 32px); overflow:auto; width:100%; max-width:700px; box-sizing:border-box; }
.goal-dialog > label, .goal-dialog > p, .goal-dialog > button, .goal-dialog > .project-heading { flex-shrink:0; }
.goal-dialog > button[type=submit] { position:sticky; bottom:0; color:var(--vscode-button-foreground); background:var(--vscode-button-background); padding:10px; }
.goal-dialog textarea:focus, .goal-dialog input:focus { outline:1px solid var(--vscode-focusBorder); }
`;
