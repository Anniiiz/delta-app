import { EventEmitter } from "node:events";

/** In-process event bus feeding the server-sent events stream (single Node process). */
const g = globalThis as unknown as { __sibus?: EventEmitter };
export const bus: EventEmitter = g.__sibus ?? (g.__sibus = new EventEmitter().setMaxListeners(100));

export function emit(kind: "alerts" | "state" | "observation", data: unknown) {
  bus.emit("message", { kind, data, at: new Date().toISOString() });
}
