import { get } from "@vercel/blob";
import { authorizedSession } from "@/app/_lib/paid-session";
import { readOrder } from "@/app/_lib/restoration";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authorizedSession(id, request);
    if (!session || session.payment_status !== "paid") return new Response(null, { status: 404 });
    const order = await readOrder(id);
    if (!order?.resultUrl || order.status !== "complete") return new Response(null, { status: 404 });
    const result = await get(order.resultUrl, { access: "private" });
    if (!result || result.statusCode !== 200) return new Response(null, { status: 404 });
    return new Response(result.stream, { headers: { "Content-Type": result.blob.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 503 }); }
}
