/**
 * Shared Upstash Redis client instance (lazy singleton).
 *
 * Deferred so that dotenv has time to populate process.env
 * before the client reads the credentials.
 */

import { Redis } from "@upstash/redis";

let _redis: Redis | undefined;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}
