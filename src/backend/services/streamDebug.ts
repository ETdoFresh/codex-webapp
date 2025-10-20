export type StreamDebugEvent = { sessionId: string; type: unknown };

const streamDebugEvents: StreamDebugEvent[] = [];

declare global {
  // eslint-disable-next-line no-var
  var __STREAM_DEBUG_EVENTS__:
    | StreamDebugEvent[]
    | undefined;
}

const STREAM_EVENT_BUFFER_LIMIT = 200;

const STREAM_EVENT_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CODEX_STREAM_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
})();

globalThis.__STREAM_DEBUG_EVENTS__ = streamDebugEvents;

export const getStreamEventTimeout = (): number => STREAM_EVENT_TIMEOUT_MS;

export const recordStreamDebugEvent = (event: StreamDebugEvent): void => {
  streamDebugEvents.push(event);
  if (streamDebugEvents.length > STREAM_EVENT_BUFFER_LIMIT) {
    streamDebugEvents.splice(0, streamDebugEvents.length - STREAM_EVENT_BUFFER_LIMIT);
  }
};

export const getStreamDebugEvents = (): StreamDebugEvent[] => streamDebugEvents;
