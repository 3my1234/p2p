import { useCallback, useEffect, useRef, useState } from "react";
import type { OrderSnapshot } from "@baze/shared";
import { WS_URL } from "../api";

type ServerFrame = {
  type: string;
  orderId?: string;
  payload?: {
    snapshot?: OrderSnapshot | null;
  };
};

export function usePWAResilience(
  orderId: string | null,
  lastEventId: number,
  applySnapshot: (snapshot: OrderSnapshot) => void
) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const lastEventIdRef = useRef(lastEventId);

  useEffect(() => {
    lastEventIdRef.current = lastEventId;
  }, [lastEventId]);

  const syncActiveOrder = useCallback(() => {
    const socket = socketRef.current;
    if (!orderId || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "SYNC_ACTIVE_ORDER",
        orderId,
        sinceEventId: lastEventIdRef.current,
        priority: "HIGH"
      })
    );
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    let closedByEffect = false;

    const connect = () => {
      const socket = new WebSocket(`${WS_URL}?orderId=${orderId}`);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        syncActiveOrder();
      };

      socket.onmessage = (event) => {
        const frame = JSON.parse(event.data) as ServerFrame;
        if (frame.type === "ORDER_SYNC_DELTA" && frame.payload?.snapshot) {
          applySnapshot(frame.payload.snapshot);
          return;
        }
        if (!["ACK", "CONNECTED"].includes(frame.type)) {
          syncActiveOrder();
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (!closedByEffect) {
          reconnectTimer.current = window.setTimeout(connect, 500);
        }
      };

      socket.onerror = () => socket.close();
    };

    connect();

    const heartbeat = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send("ping");
      }
    }, 5000);

    const foregroundSync = () => {
      if (document.visibilityState === "visible") {
        syncActiveOrder();
      }
    };

    document.addEventListener("visibilitychange", foregroundSync);
    window.addEventListener("focus", foregroundSync);
    window.addEventListener("online", foregroundSync);

    return () => {
      closedByEffect = true;
      window.clearInterval(heartbeat);
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      document.removeEventListener("visibilitychange", foregroundSync);
      window.removeEventListener("focus", foregroundSync);
      window.removeEventListener("online", foregroundSync);
      socketRef.current?.close();
    };
  }, [applySnapshot, orderId, syncActiveOrder]);

  return { connected, syncActiveOrder };
}

