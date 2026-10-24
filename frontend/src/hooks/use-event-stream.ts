"use client";

import { useEffect, useRef, useState } from "react";
import { refreshSession } from "@/lib/api";

export type StreamStatus = "connecting" | "open" | "error" | "off";

const MAX_RETRIES = 3;

/**
 * Server-Sent Events (backend/src/shared/http/sse.ts) with the session cookie. EventSource reconnects by itself
 * when the server ends the stream; a refused connection (e.g. expired access token) gets a session refresh and a
 * reconnect, up to 3 times. Pass `url = null` to stay disconnected.
 */
export function useEventStream<T>(url: string | null, event = "update") {
  const [data, setData] = useState<T | undefined>(undefined);
  const [status, setStatus] =
    useState<Exclude<StreamStatus, "off">>("connecting");
  const [lastAt, setLastAt] = useState<Date | null>(null);
  const [connection, setConnection] = useState(0);
  const retries = useRef(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const es = new EventSource(url, { withCredentials: true });
    es.addEventListener(event, ((e: MessageEvent<string>) => {
      try {
        setData(JSON.parse(e.data) as T);
        setLastAt(new Date());
        setStatus("open");
        retries.current = 0;
      } catch {
        /* ignore a malformed frame */
      }
    }) as EventListener);
    es.onopen = () => setStatus("open");
    es.onerror = (e) => {
      // a server "event: error" frame ends the stream; CLOSED means the request itself was refused
      const serverFrame =
        e instanceof MessageEvent && typeof e.data === "string";
      if (!serverFrame && es.readyState === EventSource.CONNECTING) {
        setStatus("connecting");
        return;
      }
      es.close();
      setStatus("error");
      if (retries.current >= MAX_RETRIES) return;
      retries.current += 1;
      const delay = 1000 * retries.current;
      void refreshSession().then(() => {
        setTimeout(() => !cancelled && setConnection((c) => c + 1), delay);
      });
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, [url, event, connection]);

  return {
    data,
    status: (url ? status : "off") as StreamStatus,
    lastAt,
    reconnect: () => {
      retries.current = 0;
      setConnection((c) => c + 1);
    },
  };
}
