import { verifyReplicateWebhook } from "@/app/_lib/replicate-signature";
import { advanceRestoration, predictionOrder, readOrder } from "@/app/_lib/restoration";
import { stripeClient, RESTORATION_PRICE } from "@/app/_lib/paid-session";
import { restorationEmailConfigured } from "@/app/_lib/restoration-email";

export const maxDuration = 60;
export async function POST(request: Request) {
  const secret = process.env.REPLICATE_WEBHOOK_SIGNING_SECRET;
  if (!secret) return new Response(null, { status: 503 });
  const raw = await request.text();
  if (!verifyReplicateWebhook(raw, request.headers, secret)) return new Response(null, { status: 400 });
  try {
    const prediction = JSON.parse(raw);
    if (typeof prediction.id !== "string") return new Response(null, { status: 400 });
    const id = await predictionOrder(prediction.id);
    if (!id) return new Response(null, { status: 503 });
    const order = await readOrder(id);
    if (!order) return new Response(null, { status: 503 });
    // A delayed notification for an older attempt must never advance the current one.
    if (order.predictionId !== prediction.id) return new Response(null, { status: 204 });
    const session = await stripeClient().checkout.sessions.retrieve(id, { expand: ["line_items"] });
    if (session.payment_status !== "paid" || session.mode !== "payment" || session.line_items?.data.length !== 1 || session.line_items.data[0].price?.id !== RESTORATION_PRICE || session.line_items.data[0].quantity !== 1) return new Response(null, { status: 409 });
    // Fetch the prediction ourselves; never trust output URLs in a notification.
    const result = await advanceRestoration(id);
    const emailPending = result?.status === "complete" && !!result.email && restorationEmailConfigured()
      && !result.emailDelivery?.sentAt && !result.emailDelivery?.needsAttention;
    return new Response(null, { status: !result || result.status === "processing" || emailPending ? 503 : 204 });
  } catch { return new Response(null, { status: 503 }); }
}
