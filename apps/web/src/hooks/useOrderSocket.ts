import { useEffect, useRef, useState } from "react";
import { WS_URL } from "../api";

export function useOrderSocket(orderId: string | null, onMessage: () => void) {
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!orderId) return;

    let closedByEffect = false;

    const connect = () => {
      const socket = new WebSocket(`${WS_URL}?orderId=${orderId}`);
      socketRef.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onmessage = () => onMessage();
      socket.onclose = () => {
        setConnected(false);
        if (!closedByEffect) {
          reconnectTimer.current = window.setTimeout(connect, 750);
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

    return () => {
      closedByEffect = true;
      window.clearInterval(heartbeat);
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      socketRef.current?.close();
    };
  }, [orderId, onMessage]);

  return connected;
}

