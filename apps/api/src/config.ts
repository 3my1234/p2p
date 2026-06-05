import "dotenv/config";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8080),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://baze:baze@localhost:5432/baze_p2p",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  disclosureMasterKey: process.env.DISCLOSURE_MASTER_KEY ?? "dev-only-disclosure-key"
};

