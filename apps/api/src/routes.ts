import type { FastifyInstance } from "fastify";
import {
  addChatMessage,
  cancelOrder,
  createAd,
  createOrder,
  disclosureExport,
  disputeOrder,
  getOrderSnapshot,
  listAds,
  markPaid,
  releaseOrder,
  syncOrder
} from "./services/orders.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.get("/api/v1/p2p/ads", async () => listAds());
  app.post("/api/v1/p2p/ads", async (request) => createAd(request.body));

  app.post("/api/v1/p2p/orders", async (request) => createOrder(request.body));
  app.get("/api/v1/p2p/orders/:id", async (request) => {
    const { id } = request.params as { id: string };
    const snapshot = await getOrderSnapshot(id);
    if (!snapshot) {
      const error = new Error("Order not found") as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    }
    return snapshot;
  });
  app.get("/api/v1/trades/:id/sync", async (request) => {
    const { id } = request.params as { id: string };
    const { sinceEventId = "0" } = request.query as { sinceEventId?: string };
    return syncOrder(id, Number(sinceEventId));
  });
  app.post("/api/v1/p2p/orders/:id/mark-paid", async (request) => {
    const { id } = request.params as { id: string };
    return markPaid(id, request.body);
  });
  app.post("/api/v1/p2p/orders/:id/release", async (request) => {
    const { id } = request.params as { id: string };
    return releaseOrder(id, request.body);
  });
  app.post("/api/v1/p2p/orders/:id/cancel", async (request) => {
    const { id } = request.params as { id: string };
    return cancelOrder(id, request.body);
  });
  app.post("/api/v1/p2p/orders/:id/dispute", async (request) => {
    const { id } = request.params as { id: string };
    return disputeOrder(id, request.body);
  });
  app.post("/api/v1/p2p/orders/:id/chat", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { senderId: string; body: string };
    return addChatMessage(id, body.senderId, body.body);
  });

  app.post("/api/v1/compliance/disclosure", async (request) => {
    const body = request.body as { orderId: string };
    const masterKey = request.headers["x-disclosure-master-key"] as string | undefined;
    return disclosureExport(masterKey, body.orderId);
  });
}
