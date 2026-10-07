import Stripe from "stripe";
import { verifyCheckoutAccess } from "./checkout-access";

export const RESTORATION_PRICE = "price_1UMAxvIq2iVVFbtuoqNAcjAx";
export function stripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1" as Stripe.LatestApiVersion,
  });
}
export async function authorizedSession(id: string, request: Request, expandPaymentIntent = false) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  if (!/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(id) || !token) return null;
  const session = await stripeClient().checkout.sessions.retrieve(id, { expand: expandPaymentIntent ? ["line_items", "payment_intent"] : ["line_items"] });
  if (session.mode !== "payment" || session.line_items?.data.length !== 1 || session.line_items.data[0].price?.id !== RESTORATION_PRICE || session.line_items.data[0].quantity !== 1) return null;
  if (!await verifyCheckoutAccess(id, token, session.client_secret)) return null;
  return session;
}
