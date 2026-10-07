import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { get, put } from "@vercel/blob";

type Order = {
  restorationId?: string;
  status: "stored" | "starting" | "processing" | "complete" | "failed" | "needs_attention";
  croppedImageUrl: string;
  predictionId?: string;
  resultUrl?: string;
  email: string | null;
  updatedAt: number;
};
type Prediction = { id: string; status: string; output?: string | string[] };
const redis = () => Redis.fromEnv();
const key = (id: string) => `restoration:${id}`;
const configured = (value: string | undefined) => !!value?.trim() && !value.trim().endsWith("...");
export function restorationReady() {
  const env = process.env;
  const redisReady = configured(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)
    && configured(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN);
  // Vercel supplies OIDC at runtime; the Blob SDK handles credential resolution.
  const blobReady = configured(env.BLOB_READ_WRITE_TOKEN)
    || (configured(env.BLOB_STORE_ID) && (env.VERCEL === "1" || configured(env.VERCEL_OIDC_TOKEN)));
  return configured(env.REPLICATE_API_TOKEN) && redisReady && blobReady;
}
export const readOrder = (id: string) => redis().get<Order>(key(id));
export const predictionOrder = (id: string) => redis().get<string>(`restoration:prediction:${id}`);
async function save(id: string, order: Order) {
  order.updatedAt = Date.now();
  await redis().set(key(id), order);
}
async function replicate(path: string, body?: object): Promise<Prediction> {
  const response = await fetch(`https://api.replicate.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, "Content-Type": "application/json", "Cancel-After": "10m" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  if (!response.ok) throw new Error("Restoration service unavailable");
  return response.json();
}
async function croppedBytes(url: string) {
  const blob = await get(url, { access: "private" });
  if (!blob || blob.statusCode !== 200) throw new Error("Photo unavailable");
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}

// Callers must verify the session is paid before providing any photo or starting work.
export async function advanceRestoration(id: string, croppedImage?: File, email: string | null = null, restorationId?: string) {
  const db = redis(), lockKey = `${key(id)}:lock`, lock = randomUUID();
  if (!await db.set(lockKey, lock, { nx: true, ex: 120 })) return readOrder(id);
  try {
    let order = await readOrder(id);
    if (!order) {
      if (!croppedImage) return null;
      const stored = await put(`restorations/${id}/cropped.jpg`, croppedImage, { access: "private", contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: true });
      order = { status: "stored", restorationId, croppedImageUrl: stored.url, email, updatedAt: Date.now() };
      await save(id, order);
    }
    if (order.status === "complete" || order.status === "failed" || order.status === "needs_attention") return order;
    if (!order.predictionId) {
      // A persisted start with no prediction ID is ambiguous: never charge Replicate twice.
      if (order.status === "starting") {
        order.status = "needs_attention";
        await save(id, order);
        return order;
      }
      const bytes = await croppedBytes(order.croppedImageUrl);
      order.status = "starting";
      await save(id, order);
      try {
        const prediction = await replicate("models/flux-kontext-apps/restore-image/predictions", {
          input: { input_image: `data:image/jpeg;base64,${bytes.toString("base64")}` },
          ...(process.env.APP_URL && process.env.REPLICATE_WEBHOOK_SIGNING_SECRET ? {
            webhook: new URL("/api/replicate/webhook", process.env.APP_URL).href,
            webhook_events_filter: ["completed"],
          } : {}),
        });
        if (!prediction.id) throw new Error("Missing prediction ID");
        order.predictionId = prediction.id;
        order.status = "processing";
        await db.set(`restoration:prediction:${prediction.id}`, id);
        await save(id, order);
      } catch {
        order.status = "needs_attention";
        await save(id, order);
      }
      return order;
    }
    const prediction = await replicate(`predictions/${encodeURIComponent(order.predictionId)}`);
    if (["failed", "canceled"].includes(prediction.status)) order.status = "failed";
    if (prediction.status === "succeeded") {
      const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      if (!url) throw new Error("Missing restored photo");
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !(parsed.hostname === "replicate.delivery" || parsed.hostname.endsWith(".replicate.delivery"))) throw new Error("Unexpected result host");
      const result = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
      const type = result.headers.get("content-type") || "";
      if (!result.ok || !["image/jpeg", "image/png", "image/webp"].includes(type.split(";")[0])) throw new Error("Result unavailable");
      const bytes = await result.arrayBuffer();
      if (bytes.byteLength > 20_000_000) throw new Error("Result too large");
      const stored = await put(`restorations/${id}/result`, bytes, { access: "private", contentType: type, addRandomSuffix: false, allowOverwrite: true });
      order.resultUrl = stored.url;
      order.status = "complete";
    }
    await save(id, order);
    return order;
  } finally {
    await db.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [lockKey], [lock]);
  }
}
