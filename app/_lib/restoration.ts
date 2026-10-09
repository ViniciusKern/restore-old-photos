import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { get, put } from "@vercel/blob";
import { deliverRestorationEmail, type EmailDelivery } from "./restoration-email";
import { ambiguousRestorationFailure, classifyRestorationFailure, restorationRecovery, type RestorationFailure } from "./restoration-failure";

type Order = {
  restorationId?: string;
  status: "stored" | "starting" | "processing" | "complete" | "failed" | "needs_attention";
  croppedImageUrl: string;
  predictionId?: string;
  attemptId?: string;
  attempts?: number;
  failure?: RestorationFailure;
  history?: { attemptId: string; predictionId?: string; failure: RestorationFailure; croppedImageUrl: string }[];
  outputUrl?: string;
  resultUrl?: string;
  email: string | null;
  emailDelivery?: EmailDelivery;
  updatedAt: number;
};
type Prediction = { id: string; status: string; output?: string | string[]; error?: string | null };
export type RestorationAction = { action: "retry" | "replace"; expectedAttemptId: string };
class ReplicateRequestError extends Error {
  constructor(public status: number, public detail: unknown) { super("Restoration service unavailable"); }
}
export function publicRestoration(order: Order | null) {
  const attempts = order?.attempts ?? (order?.predictionId ? 1 : 0);
  const failure = order?.failure ?? (order?.status === "needs_attention" ? ambiguousRestorationFailure() : order?.status === "failed" ? classifyRestorationFailure("") : undefined);
  const recovery = restorationRecovery(failure, attempts);
  return { status: order?.status || "awaiting_photo", attemptId: order?.attemptId || order?.predictionId,
    error: failure ? { message: recovery.attemptsRemaining === 0 ? "The restoration could not be completed, and this order has reached its attempt limit. Please contact support with your order ID; do not pay again." : failure.message, code: failure.code } : undefined,
    ...recovery };
}
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
async function notifyCompletion(id: string, order: Order, persist: () => Promise<void>) {
  try {
    await deliverRestorationEmail(id, order, persist);
  } catch {
    // Never expose provider details or hide an already completed restoration.
    console.error("Restoration email submission failed; retry through webhook or order polling.");
  }
  return order;
}
async function replicate(path: string, body?: object): Promise<Prediction> {
  const response = await fetch(`https://api.replicate.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, "Content-Type": "application/json", "Cancel-After": "10m" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new ReplicateRequestError(response.status, detail.detail ?? detail.error ?? "");
  }
  return response.json();
}
async function croppedBytes(url: string) {
  const blob = await get(url, { access: "private" });
  if (!blob || blob.statusCode !== 200) throw new Error("Photo unavailable");
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}

// Callers must verify the session is paid before providing any photo or starting work.
export async function advanceRestoration(id: string, croppedImage?: File, email: string | null = null, restorationId?: string, recovery?: RestorationAction) {
  const db = redis(), lockKey = `${key(id)}:lock`, lock = randomUUID();
  if (!await db.set(lockKey, lock, { nx: true, ex: 120 })) return readOrder(id);
  async function persist(order: Order) {
    order.updatedAt = Date.now();
    // The lease and write are checked atomically, including after slow Blob operations.
    const saved = await db.eval("if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('set', KEYS[2], ARGV[2]); return 1 else return 0 end", [lockKey, key(id)], [lock, JSON.stringify(order)]);
    if (saved !== 1) throw new Error("Restoration lock expired; check the current order again");
  }
  try {
    let order = await readOrder(id);
    if (!order) {
      if (recovery) return null;
      if (!croppedImage) return null;
      const stored = await put(`restorations/${id}/cropped.jpg`, croppedImage, { access: "private", contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: true });
      order = { status: "stored", restorationId, croppedImageUrl: stored.url, email, updatedAt: Date.now() };
      await persist(order);
    }
    if (order.status === "complete") return await notifyCompletion(id, order, () => persist(order));
    if (recovery && order.status === "failed") {
      const attempts = order.attempts ?? 1;
      const failure = order.failure ?? classifyRestorationFailure("");
      const permissions = restorationRecovery(failure, attempts);
      // Compare the failed attempt under the lock; stale clicks cannot consume another attempt.
      if (recovery.expectedAttemptId !== (order.attemptId || order.predictionId)
        || (recovery.action === "retry" ? !permissions.canRetry : !permissions.canReplace || !croppedImage)) return order;
      const nextAttemptId = randomUUID();
      let photoUrl = order.croppedImageUrl;
      if (recovery.action === "replace" && croppedImage) {
        const stored = await put(`restorations/${id}/${nextAttemptId}/cropped.jpg`, croppedImage, { access: "private", contentType: "image/jpeg", addRandomSuffix: false });
        photoUrl = stored.url;
      }
      order.history = [...(order.history || []), { attemptId: order.attemptId || order.predictionId || "legacy", predictionId: order.predictionId, failure, croppedImageUrl: order.croppedImageUrl }];
      order.attempts = attempts;
      order.attemptId = nextAttemptId;
      order.croppedImageUrl = photoUrl;
      delete order.predictionId;
      delete order.failure;
      delete order.outputUrl;
      order.status = "stored";
      await persist(order);
    }
    if (order.status === "failed" || order.status === "needs_attention") return order;
    if (!order.predictionId) {
      // A persisted start with no prediction ID is ambiguous: never charge Replicate twice.
      if (order.status === "starting") {
        order.status = "needs_attention";
        order.failure = ambiguousRestorationFailure();
        await persist(order);
        return order;
      }
      const bytes = await croppedBytes(order.croppedImageUrl);
      order.status = "starting";
      order.attemptId ||= randomUUID();
      order.attempts = (order.attempts ?? 0) + 1;
      await persist(order);
      let prediction: Prediction;
      try {
        prediction = await replicate("models/flux-kontext-apps/restore-image/predictions", {
          input: { input_image: `data:image/jpeg;base64,${bytes.toString("base64")}` },
          ...(process.env.APP_URL && process.env.REPLICATE_WEBHOOK_SIGNING_SECRET ? {
            webhook: new URL("/api/replicate/webhook", process.env.APP_URL).href,
            webhook_events_filter: ["completed"],
          } : {}),
        });
        if (!prediction.id) throw new Error("Missing prediction ID");
      } catch (error) {
        // Only an explicit rejection proves no prediction was accepted. Network/5xx are ambiguous.
        const rejected = error instanceof ReplicateRequestError && error.status >= 400 && error.status < 500;
        order.status = rejected ? "failed" : "needs_attention";
        order.failure = rejected ? classifyRestorationFailure(error.detail, error.status) : ambiguousRestorationFailure();
        if (error instanceof ReplicateRequestError && !rejected) order.failure = { ...classifyRestorationFailure(error.detail, error.status), ...ambiguousRestorationFailure() };
        await persist(order);
        return order;
      }
      // Preserve the accepted ID before ancillary writes; a Redis mapping failure is not a model failure.
      order.predictionId = prediction.id;
      order.status = "processing";
      await persist(order);
      await db.set(`restoration:prediction:${prediction.id}`, id);
      return order;
    }
    await db.set(`restoration:prediction:${order.predictionId}`, id);
    const prediction = order.outputUrl ? { id: order.predictionId, status: "succeeded", output: order.outputUrl } : await replicate(`predictions/${encodeURIComponent(order.predictionId)}`);
    if (["failed", "canceled", "aborted"].includes(prediction.status)) {
      order.status = "failed";
      order.failure = classifyRestorationFailure(prediction.error, undefined, prediction.status);
    }
    if (prediction.status === "succeeded") {
      const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
      if (!url) throw new Error("Missing restored photo");
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !(parsed.hostname === "replicate.delivery" || parsed.hostname.endsWith(".replicate.delivery"))) throw new Error("Unexpected result host");
      order.outputUrl = url;
      await persist(order);
      const result = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
      const type = result.headers.get("content-type") || "";
      if (!result.ok || !["image/jpeg", "image/png", "image/webp"].includes(type.split(";")[0])) throw new Error("Result unavailable");
      const bytes = await result.arrayBuffer();
      if (bytes.byteLength > 20_000_000) throw new Error("Result too large");
      const stored = await put(`restorations/${id}/result`, bytes, { access: "private", contentType: type, addRandomSuffix: false, allowOverwrite: true });
      order.resultUrl = stored.url;
      order.status = "complete";
    }
    await persist(order);
    return order.status === "complete" ? await notifyCompletion(id, order, () => persist(order)) : order;
  } finally {
    await db.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [lockKey], [lock]);
  }
}
