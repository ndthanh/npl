import { EventSchema } from "@ag-ui/core/schemas";
export function protocolEvent(
  type: string,
  extra: Record<string, unknown> = {},
) {
  return EventSchema.parse({ type, ...extra });
}
