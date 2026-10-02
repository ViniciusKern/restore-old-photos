import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyReplicateWebhook(body: string, headers: Headers, secret: string, now = Date.now()) {
  const id = headers.get("webhook-id"), timestamp = headers.get("webhook-timestamp");
  if (!id || !timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !secret.startsWith("whsec_")) return false;
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${timestamp}.${body}`).digest();
  return (headers.get("webhook-signature") || "").split(" ").some(signature => {
    const [version, value] = signature.split(",");
    if (version !== "v1" || !value) return false;
    const actual = Buffer.from(value, "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
