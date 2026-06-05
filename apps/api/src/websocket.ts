import type { FastifyInstance } from "fastify";
import { redis, redisSub } from "./redis.js";
import { cacheOrderSnapshot } from "./services/orders.js";

type Socket = {
  OPEN: number;
  readyState: number;
  send: (payload: string) => void;
  ping: () => void;
  close: (code?: number, reason?: string) => void;
  on: (event: "message" | "close" | "error", listener: (...args: any[]) => void) => void;
};

const orderSockets = new Map<string, Set<Socket>>();

export async function registerWebsocket(app: FastifyInstance) {
  app.get("/ws", { websocket: true }, (connection, request) => {
    const url = new URL(request.url ?? "", "http://localhost");
    const orderId = url.searchParams.get("orderId");
    if (!orderId) {
      connection.socket.close(1008, "orderId required");
      return;
    }

    const sockets = orderSockets.get(orderId) ?? new Set<Socket>();
    sockets.add(connection.socket);
    orderSockets.set(orderId, sockets);

    connection.socket.send(JSON.stringify({ type: "CONNECTED", orderId, heartbeatMs: 5000 }));

    const heartbeat = setInterval(() => {
      if (connection.socket.readyState === connection.socket.OPEN) {
        connection.socket.ping();
      }
    }, 5000);

    connection.socket.on("message", (raw: Buffer) => {
      const message = raw.toString();
      if (message === "pong" || message === "ping") return;
      try {
        const frame = JSON.parse(message) as { type?: string; orderId?: string; sinceEventId?: number };
        if (frame.type === "SYNC_ACTIVE_ORDER" && frame.orderId === orderId) {
          void redis.hgetall(`order:${orderId}`).then(async (cached) => {
            let snapshot = cached.snapshot;
            if (!snapshot) {
              const rebuilt = await cacheOrderSnapshot(orderId);
              snapshot = rebuilt ? JSON.stringify(rebuilt) : "";
            }
            connection.socket.send(
              JSON.stringify({
                type: "ORDER_SYNC_DELTA",
                orderId,
                payload: {
                  snapshot: snapshot ? JSON.parse(snapshot) : null,
                  lastEventId: snapshot ? JSON.parse(snapshot).lastEventId : 0
                },
                ts: new Date().toISOString()
              })
            );
          });
          return;
        }
      } catch {
        connection.socket.send(JSON.stringify({ type: "ACK", receivedAt: new Date().toISOString() }));
        return;
      }
      connection.socket.send(JSON.stringify({ type: "ACK", receivedAt: new Date().toISOString() }));
    });

    connection.socket.on("close", () => {
      clearInterval(heartbeat);
      sockets.delete(connection.socket);
      if (sockets.size === 0) orderSockets.delete(orderId);
    });
  });

  await redisSub.psubscribe("order:*");
  redisSub.on("pmessage", (_pattern: string, channel: string, message: string) => {
    const orderId = channel.replace("order:", "");
    const sockets = orderSockets.get(orderId);
    if (!sockets) return;
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(message);
    }
  });
}
