import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { registerWebsocket } from "./websocket.js";
import { startExpiryWorker } from "./workers/expiry.js";

const app = Fastify({
  logger: true,
  trustProxy: true
});

await app.register(cors, {
  origin: [config.webOrigin, "https://sportbanter.online"],
  credentials: true
});
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
await app.register(websocket, { options: { maxPayload: 1024 * 64 } });

await registerRoutes(app);
await registerWebsocket(app);
startExpiryWorker();

app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
  app.log.error(error);
  const statusCode = typeof error.statusCode === "number" ? error.statusCode : 400;
  reply.status(statusCode).send({ error: error.message });
});

await app.listen({ port: config.port, host: "0.0.0.0" });
