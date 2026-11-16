import QRCode from "qrcode";
import { DecimenSender, zipContainer } from "./decimen";
type Transfer = {
  id: string;
  status: "preparing" | "ready" | "error";
  name?: string;
  bytes?: number;
  sha256?: string;
  fileCount?: number;
  files?: string[];
  error?: string;
};
let active: Transfer | undefined,
  host: HTMLDivElement | undefined,
  sender: DecimenSender | undefined,
  timer: ReturnType<typeof setTimeout> | undefined;
let post: (type: string, extra?: any) => void,
  seq = 0,
  fps = 8,
  requested = "",
  version: number | undefined;
let dismissed = "";
export const decimenCss = `.dec-overlay{position:fixed;inset:0;background:#000a;z-index:2000;display:flex;align-items:center;justify-content:center;padding:12px}.dec-dialog{width:760px;max-width:100%;max-height:calc(100vh - 24px);overflow:auto;padding:12px;border-radius:12px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);box-shadow:0 8px 32px #0008}.dec-close-row{display:flex;justify-content:flex-end;margin-bottom:8px}.dec-dialog button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border)}.dec-screen{background:#fff;display:flex;align-items:center;justify-content:center;width:min(72vh,100%);aspect-ratio:1;margin:auto}.dec-screen canvas{image-rendering:pixelated;max-width:100%;max-height:100%}`;
function stop() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
function close() {
  const id = active?.id;
  dismissed = id ?? "";
  stop();
  host?.remove();
  host = undefined;
  active = undefined;
  sender = undefined;
  requested = "";
  if (id) post("decClose", { id });
  document.getElementById("prompt")?.focus();
}
function fail(error: unknown) {
  if (active) post("decError", { id: active.id, text: String(error) });
  close();
}
function draw() {
  if (!sender || !host || document.hidden) return;
  try {
    const qr = QRCode.create(
      [{ data: sender.frame(seq), mode: "byte" } as any],
      { errorCorrectionLevel: "L", maskPattern: 4, version },
    );
    version = qr.version;
    const canvas = host.querySelector("canvas")!,
      screen = host.querySelector<HTMLElement>(".dec-screen")!,
      modules = qr.modules.size + 8;
    const scale = Math.max(
      1,
      Math.floor(Math.min(screen.clientWidth, screen.clientHeight) / modules),
    );
    canvas.width = canvas.height = modules * scale;
    canvas.setAttribute("aria-busy", "false");
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000";
    for (let row = 0; row < qr.modules.size; row++)
      for (let col = 0; col < qr.modules.size; col++)
        if (qr.modules.get(row, col))
          context.fillRect((col + 4) * scale, (row + 4) * scale, scale, scale);
    seq = (seq + 1) >>> 0;
    timer = setTimeout(draw, 1000 / fps);
  } catch (error) {
    stop();
    fail(error);
  }
}
export function receiveDecimen(payload: { id: string; base64: string }) {
  if (active?.id !== payload.id || !host || sender) return;
  const identifier = payload.id;
  void (async () => {
    try {
      const binary = atob(payload.base64),
        bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const container = await zipContainer(active!.name!, bytes);
      if (active?.id !== identifier || !host) return;
      const digest = Array.from(container.slice(17, 49), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== active.sha256)
        throw Error("SHA-256 của ZIP không khớp; đóng modal và thử /dec lại.");
      sender = new DecimenSender(container);
      seq = 0;
      version = undefined;
      draw();
    } catch (error) {
      if (active?.id === identifier) fail(error);
    }
  })();
}
export function syncDecimen(transfer: Transfer | undefined, send: typeof post) {
  post = send;
  if (transfer?.id === dismissed) return;
  if (!transfer) {
    stop();
    host?.remove();
    host = undefined;
    active = undefined;
    sender = undefined;
    requested = "";
    return;
  }
  if (active?.id !== transfer.id) {
    stop();
    host?.remove();
    sender = undefined;
    requested = "";
    active = transfer;
    fps = 8;
    host = document.createElement("div");
    host.className = "dec-overlay";
    host.innerHTML = `<section class="dec-dialog" role="dialog" aria-modal="true" aria-label="QR"><div class="dec-close-row"><button data-dec-close aria-label="Đóng">Đóng ✕</button></div><div class="dec-screen"><canvas aria-label="QR động" aria-busy="true"></canvas></div></section>`;
    document.body.append(host);
    host.querySelector("[data-dec-close]")!.addEventListener("click", close);
    host.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key === "Tab") {
        const items = [
            ...host!.querySelectorAll<HTMLElement>(
              "button:not([disabled]),input,summary",
            ),
          ].filter((node) => node.getClientRects().length > 0),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });
  }
  active = transfer;
  if (transfer.status === "error") {
    fail(transfer.error || "Không tạo được ZIP.");
    return;
  }
  if (transfer.status === "ready" && requested !== transfer.id) {
    requested = transfer.id;
    post("decPayload", { id: transfer.id });
  }
  if (!host!.contains(document.activeElement))
    host!.querySelector<HTMLButtonElement>("[data-dec-close]")!.focus();
}
document.addEventListener("visibilitychange", () => {
  stop();
  if (!document.hidden) draw();
});
window.addEventListener("pagehide", stop);
