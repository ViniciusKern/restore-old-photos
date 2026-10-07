import { createHash, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

const key = (id: string) => `checkout:access:${id}`;
const digest = (secret: string) => createHash("sha256").update(secret).digest("hex");

export async function rememberCheckoutAccess(id: string, clientSecret: string) {
  // Store only the hash. Stripe stops returning the secret once checkout completes.
  await Redis.fromEnv().set(key(id), digest(clientSecret), { nx: true });
}

export async function verifyCheckoutAccess(id: string, supplied: string, stripeSecret: string | null) {
  const cached = await Redis.fromEnv().get<string>(key(id));
  const expected = cached || (stripeSecret ? digest(stripeSecret) : null);
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const matches = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(digest(supplied), "hex"));
  // Migrate open sessions created before persistent authorization was introduced.
  if (matches && !cached && stripeSecret) await rememberCheckoutAccess(id, stripeSecret);
  return matches;
}
