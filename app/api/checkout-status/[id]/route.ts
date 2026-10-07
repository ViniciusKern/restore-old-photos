import { authorizedSession } from "@/app/_lib/paid-session";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = process.env.STRIPE_SECRET_KEY;
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  if (!key) return Response.json({ error: "Payment verification is unavailable." }, { status: 503 });
  if (!/^cs_(test_|live_)?[a-zA-Z0-9]+$/.test(id) || !token) return Response.json({ error: "Invalid checkout." }, { status: 400 });
  try {
    const session = await authorizedSession(id, request, true);
    if (!session) {
      return Response.json({ error: "This checkout is unavailable." }, { status: 404 });
    }
    const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
    const status = session.payment_status === "paid" ? "approved"
      : session.status === "expired" ? "expired"
      : intent?.status === "canceled" || intent?.status === "requires_payment_method" ? "failed"
      : "pending";
    return Response.json({ status, restoration_id: session.client_reference_id }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "We could not verify your payment. Please try again." }, { status: 503 });
  }
}
