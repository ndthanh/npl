export type Suggestion = {
  id: string;
  label: string;
  detail: string;
  icon: string;
  action: string;
  kind?: string;
};
export const CONTEXT: Suggestion[] = [
  {
    id: "selection",
    label: "Selection",
    detail: "Đoạn code đang chọn trong editor",
    icon: "selection",
    action: "context",
    kind: "selection",
  },
  {
    id: "file",
    label: "File",
    detail: "File đang mở hoặc chọn file trong workspace",
    icon: "file-code",
    action: "context",
    kind: "file",
  },
  {
    id: "folder",
    label: "Folder",
    detail: "Chọn thư mục con · áp dụng .nopilotignore",
    icon: "folder",
    action: "context",
    kind: "folder",
  },
  {
    id: "workspace",
    label: "Workspace",
    detail: "Source theo .nopilotignore · tự đóng gói khi cần",
    icon: "root-folder",
    action: "context",
    kind: "workspace",
  },
  {
    id: "problems",
    label: "Problems",
    detail: "Diagnostics từ VS Code",
    icon: "warning",
    action: "context",
    kind: "problems",
  },
  {
    id: "gitdiff",
    label: "Git diff",
    detail: "Thay đổi chưa staged trong repo",
    icon: "git-compare",
    action: "context",
    kind: "gitdiff",
  },
];
export const COMMANDS: Suggestion[] = [
  {
    id: "/goal",
    label: "/goal",
    detail: "Mục tiêu phát triển · Definition of Done · 20 lượt",
    icon: "target",
    action: "command",
  },
  {
    id: "/local",
    label: "/local",
    detail: "Model GGUF local · thiết lập hoặc diễn giải nhiệm vụ",
    icon: "chip",
    action: "command",
  },
  {
    id: "/ignore",
    label: "/ignore",
    detail: "Tạo hoặc mở .nopilotignore của project",
    icon: "exclude",
    action: "command",
  },
  {
    id: "/setup",
    label: "/setup",
    detail: "Chuẩn bị Python runtime và dependencies Nopilot",
    icon: "tools",
    action: "command",
  },
  {
    id: "/db",
    label: "/db",
    detail: "Mở Data explorer · ODBC, SQLite, CSV/Excel",
    icon: "database",
    action: "command",
  },
  {
    id: "/upload",
    label: "/upload",
    detail: "Chọn file và điền đường dẫn · chưa gửi",
    icon: "attach",
    action: "command",
  },
  {
    id: "/workspace",
    label: "/workspace",
    detail: "Thêm source project làm context",
    icon: "root-folder",
    action: "command",
  },
  {
    id: "/new",
    label: "/new",
    detail: "Hội thoại mới trong Nopilot",
    icon: "add",
    action: "command",
  },
  {
    id: "/read",
    label: "/read",
    detail: "Đọc kết quả Teams · không gửi lại prompt",
    icon: "comment",
    action: "command",
  },
  {
    id: "/reconnect",
    label: "/reconnect",
    detail: "Kết nối lại bridge Teams",
    icon: "refresh",
    action: "command",
  },
  {
    id: "/url",
    label: "/url",
    detail: "Đọc URL và đưa context cho Copilot",
    icon: "globe",
    action: "command",
  },
  {
    id: "/assist",
    label: "/assist",
    detail: "Hỏi model phụ đã cấu hình",
    icon: "sparkle",
    action: "command",
  },
];
export function detectTrigger(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match =
    /(?:^|\s)(@\w*)$/.exec(before) ?? /(?:^|\s)(\/\w*)$/.exec(before);
  if (!match) return undefined;
  const token = match[1];
  return {
    kind: token[0] === "@" ? ("context" as const) : ("commands" as const),
    start: caret - token.length,
    end: caret,
    query: token.slice(1),
  };
}
export function suggestions(kind: "context" | "commands", query: string) {
  return (
    kind === "context" ? [...CONTEXT, ...COMMANDS] : [...COMMANDS, ...CONTEXT]
  ).filter(
    (x) =>
      x.id.replace(/^\//, "").toLowerCase().startsWith(query.toLowerCase()) ||
      x.label.toLowerCase().startsWith(query.toLowerCase()),
  );
}
