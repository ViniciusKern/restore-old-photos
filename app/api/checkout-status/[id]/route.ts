import { timingSafeEqual } from "node:crypto";
import Stripe from "stripe";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = process.env.STRIPE_SECRET_KEY;
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  if (!key) return Response.json({ error: "Payment verification is unavailable." }, { status: 503 });
  if (!/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(id) || !token) return Response.json({ error: "Invalid checkout." }, { status: 400 });
  try {
    const stripe = new Stripe(key, {
      apiVersion: "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1" as Stripe.LatestApiVersion,
    });
    const session = await stripe.checkout.sessions.retrieve(id, { expand: ["line_items", "payment_intent"] });
    const expected = Buffer.from(session.client_secret || "");
    const supplied = Buffer.from(token);
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return Response.json({ error: "This checkout is unavailable." }, { status: 404 });
    }
    if (session.mode !== "payment" || session.line_items?.data.length !== 1 || session.line_items.data[0].price?.id !== "price_1UMAxvIq2iVVFbtuoqNAcjAx" || session.line_items.data[0].quantity !== 1) {
      return Response.json({ error: "Payment does not match this restoration." }, { status: 409 });
    }
    const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
    const status = session.payment_status === "paid" ? "approved"
      : session.status === "expired" ? "expired"
      : intent?.status === "canceled" || intent?.status === "requires_payment_method" ? "failed"
      : "pending";
    return Response.json({ status }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "We could not verify your payment. Please try again." }, { status: 503 });
  }
}
