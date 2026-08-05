import { AuditEventSchema, type AuditEvent } from "./model.js";
import { makeId } from "./utils.js";

export function createAuditEvent(
  event: AuditEvent["event"],
  planId: string,
  data: unknown,
  options: { actionId?: string; actor?: string; timestamp?: string } = {}
): AuditEvent {
  const base = {
    id: makeId("audit"),
    event,
    planId,
    timestamp: options.timestamp ?? new Date().toISOString(),
    data,
    ...(options.actionId === undefined ? {} : { actionId: options.actionId }),
    ...(options.actor === undefined ? {} : { actor: options.actor })
  };
  return AuditEventSchema.parse(base);
}
