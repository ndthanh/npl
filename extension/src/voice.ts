import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
export type VoiceState = {
  status:
    "idle" | "loading" | "recording" | "transcribing" | "error" | "needs-setup";
  message?: string;
};
export class VoiceSession {
  private child?: ChildProcessWithoutNullStreams;
  private timer?: NodeJS.Timeout;
  private cancelled = false;
  private timedOut = false;
  constructor(
    private update: (state: VoiceState) => void,
    private transcript: (text: string) => void,
  ) {}
  get active() {
    return !!this.child;
  }
  start(
    python: string,
    script: string,
    model: string,
    language: string,
    device?: number,
  ) {
    if (this.child) throw Error("Đang có phiên ghi âm.");
    if (!model) {
      this.update({
        status: "needs-setup",
        message:
          "Chọn model local để dùng giọng nói. Audio không được gửi lên dịch vụ bên ngoài.",
      });
      return;
    }
    this.cancelled = false;
    this.timedOut = false;
    this.update({
      status: "loading",
      message: "Đang chuẩn bị nhận dạng local…",
    });
    const args = ["-u", "-B", script, "--model", model, "--language", language];
    if (device !== undefined) args.push("--device", String(device));
    const child = (this.child = spawn(python, args, {
      windowsHide: true,
      shell: false,
      env: { ...process.env, PYTHONUTF8: "1", HF_HUB_OFFLINE: "1" },
    }));
    let failure = false,
      diagnostic = "";
    child.stdin.on("error", () => {});
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const event = JSON.parse(line);
        if (this.cancelled) return;
        if (event.type === "state") {
          if (event.status === "cancelled") this.update({ status: "idle" });
          else this.update({ status: event.status, message: event.message });
        } else if (event.type === "transcript") {
          this.transcript(event.text);
          this.update({
            status: "idle",
            message: event.text
              ? "Đã thêm vào draft · chưa gửi"
              : "Không nhận được lời nói.",
          });
        } else if (event.type === "error") {
          failure = true;
          this.update({ status: "error", message: event.message });
        }
      } catch {}
    });
    child.stderr.on("data", (data) => {
      if (diagnostic.length < 16000) diagnostic += data.toString();
    });
    child.on("error", (error) => {
      failure = true;
      this.update({ status: "error", message: String(error) });
    });
    child.on("close", (code) => {
      if (this.child === child) this.child = undefined;
      clearTimeout(this.timer);
      if (this.cancelled && !this.timedOut) this.update({ status: "idle" });
      else if (code !== 0 && !failure)
        this.update({
          status: "error",
          message: diagnostic.slice(-1000) || "Voice worker exited " + code,
        });
    });
    this.timer = setTimeout(() => {
      failure = true;
      this.cancel();
      this.timedOut = true;
      this.update({
        status: "error",
        message: "Nhận dạng quá thời gian. Không audio nào được lưu hoặc gửi.",
      });
    }, 240000);
  }
  stop() {
    if (this.child) this.child.stdin.write("stop\n");
  }
  cancel() {
    this.cancelled = true;
    this.child?.stdin.write("cancel\n");
    this.child?.kill();
    clearTimeout(this.timer);
    this.update({ status: "idle" });
  }
  dispose() {
    this.cancel();
  }
}
