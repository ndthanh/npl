import { id } from "./core";
export type QueuedMessage = {
  id: string;
  text: string;
  createdAt: string;
  contextId: string;
  mode: string;
  tools: boolean;
  attachments: any[];
  status: "queued" | "sending" | "unconfirmed" | "needs-context" | "failed";
  priority?: boolean;
  error?: string;
};
export function queueMessage(
  conversation: any,
  text: string,
  priority = false,
): QueuedMessage {
  if (!text.trim() || text.length > 100000)
    throw Error("Prompt trống hoặc vượt 100.000 ký tự.");
  if (text.trim().startsWith("/"))
    throw Error(
      "Lệnh / cần thực hiện khi tác vụ hiện tại kết thúc. Hàng đợi nhận prompt thường.",
    );
  conversation.queue ??= [];
  if (conversation.queue.length >= 10)
    throw Error("Hàng đợi tối đa 10 tin nhắn.");
  const item: QueuedMessage = {
    id: id(),
    text,
    createdAt: new Date().toISOString(),
    contextId: conversation.contextId,
    mode: conversation.mode,
    tools: conversation.tools,
    attachments: [...conversation.attachments],
    status: "queued",
    priority,
  };
  priority ? conversation.queue.unshift(item) : conversation.queue.push(item);
  conversation.attachments = [];
  conversation.draft = "";
  return item;
}
export function prioritizeQueue(conversation: any, target: string) {
  const index = (conversation.queue ?? []).findIndex(
    (i: QueuedMessage) => i.id === target,
  );
  if (index < 0) throw Error("Không có tin nhắn trong hàng đợi.");
  const item = conversation.queue[index];
  if (item.status === "sending" || item.status === "unconfirmed")
    throw Error("Không thể steer một tin đã gửi hoặc chưa rõ kết quả.");
  conversation.queue.splice(index, 1);
  item.priority = true;
  conversation.queue.unshift(item);
}
export function removeQueued(conversation: any, target: string) {
  const item = (conversation.queue ?? []).find(
    (i: QueuedMessage) => i.id === target,
  );
  if (item?.status === "sending")
    throw Error("Tin đang gửi; không thể hủy bằng cách xóa hàng đợi.");
  conversation.queue = (conversation.queue ?? []).filter(
    (i: QueuedMessage) => i.id !== target,
  );
}
export function queueContextMatches(conversation: any, item: QueuedMessage) {
  return (
    conversation.contextId === item.contextId &&
    conversation.mode === item.mode &&
    conversation.tools === item.tools
  );
}
export type Activity = {
  id: string;
  messageId?: string;
  changeId?: string;
  kind: "command" | "tool" | "context";
  title: string;
  status: "running" | "completed" | "failed" | "stopped";
  startedAt: string;
  finishedAt?: string;
  output: string;
  truncated?: boolean;
  command?: any;
  exitCode?: number;
  artifactId?: string;
  localResult?: boolean;
  error?: string;
};
export function appendOutput(
  activity: Activity,
  text: string,
  limit = 256 * 1024,
) {
  const remaining = limit - activity.output.length;
  if (remaining > 0) activity.output += text.slice(0, remaining);
  if (text.length > remaining) activity.truncated = true;
}
