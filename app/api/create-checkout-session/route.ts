import Stripe from "stripe";
import { restorationReady } from "@/app/_lib/restoration";

export async function POST() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = "price_1UMAxvIq2iVVFbtuoqNAcjAx";

  if (!secretKey || secretKey.endsWith("...") || !restorationReady()) {
    return Response.json(
      { error: "Checkout is not available yet. Please try again later." },
      { status: 503 },
    );
  }

  const stripe = new Stripe(secretKey, {
    // The preview version includes a beta flag outside the SDK's version literal.
    apiVersion: "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1" as Stripe.LatestApiVersion,
  });

  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: "form",
      mode: "payment",
      billing_address_collection: "auto",
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      submit_type: "auto",
      integration_identifier: "custom_embedded_web_0001",
      line_items: [{ price: priceId, quantity: 1 }],
    });

    if (!session.client_secret) {
      return Response.json(
        { error: "We could not open checkout. Please try again." },
        { status: 502 },
      );
    }

    return Response.json(
      { client_secret: session.client_secret },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "We could not open checkout. Please try again." },
      { status: 502 },
    );
  }
}
