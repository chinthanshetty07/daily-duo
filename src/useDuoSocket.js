import { useCallback, useEffect, useRef, useState } from "react";
import { backoffDelay } from "./logic.js";

/**
 * Keeps one live connection per open screen. Reconnects with backoff, re-sends the hello on every
 * reconnect, and holds an answer typed while offline until the socket is back.
 * status: "connecting" | "open" | "reconnecting" | "offline" | "expired"
 */
export function useDuoSocket(token, { url = defaultUrl(), WebSocketImpl = globalThis.WebSocket } = {}) {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const pendingRef = useRef(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!token) return undefined;
    let closedByUs = false;
    let timer = null;

    const connect = () => {
      const ws = new WebSocketImpl(url);
      wsRef.current = ws;
      ws.onopen = () => {
        attemptRef.current = 0;
        setStatus("open");
        ws.send(JSON.stringify({ type: "hello", token }));
        if (pendingRef.current) ws.send(JSON.stringify(pendingRef.current));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") setState(msg.state);
        if (msg.type === "ack") {
          pendingRef.current = null;
          setError(null);
        }
        if (msg.type === "error") {
          if (msg.requestId && pendingRef.current?.requestId === msg.requestId) pendingRef.current = null;
          setError(msg.message);
        }
      };
      ws.onclose = (event) => {
        if (closedByUs) return;
        if (event.code === 4401) {
          setStatus("expired"); // token unknown: the demo server restarted and its memory is gone
          return;
        }
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        setStatus(offline ? "offline" : "reconnecting");
        timer = setTimeout(connect, backoffDelay(attemptRef.current++));
      };
    };

    const onOnline = () => {
      if (wsRef.current?.readyState === 3) {
        clearTimeout(timer);
        attemptRef.current = 0;
        connect();
      }
    };
    globalThis.addEventListener?.("online", onOnline);
    connect();
    return () => {
      closedByUs = true;
      clearTimeout(timer);
      globalThis.removeEventListener?.("online", onOnline);
      wsRef.current?.close();
    };
  }, [token, url, WebSocketImpl]);

  const send = useCallback((msg) => {
    if (msg.type === "answer") pendingRef.current = msg; // survives a reconnect until the server acks it
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }, []);

  return { state, status, error, send, hasPending: () => Boolean(pendingRef.current) };
}

function defaultUrl() {
  if (typeof location === "undefined") return "ws://localhost:8787/ws";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}
