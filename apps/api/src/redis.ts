import { Redis } from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true
});

export const redisPub = new Redis(config.redisUrl);
export const redisSub = new Redis(config.redisUrl);
