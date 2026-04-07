import { useEffect, useRef } from "react";
import { eventStream } from "@/services/event-stream";

/**
 * Subscribe to a realtime channel for the lifetime of the component.
 * The handler is invoked with the event payload.
 *
 * Subscribes once per channel; the latest handler closure (which may close
 * over fresh React state) is always called via a ref. Pass `null` as the
 * channel to skip subscribing.
 */
export function useRealtime(channel: string | null, handler: (payload: unknown) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!channel) return;
    return eventStream.subscribe(channel, (payload) => {
      handlerRef.current(payload);
    });
  }, [channel]);
}
