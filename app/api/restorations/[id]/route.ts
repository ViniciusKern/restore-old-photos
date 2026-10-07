import { authorizedSession } from "@/app/_lib/paid-session";
import { advanceRestoration, restorationReady } from "@/app/_lib/restoration";

export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const session = await authorizedSession(id, request);
    if (!session) return Response.json({ error: "Payment not found." }, { status: 404 });
    // No photo is read, stored or shared until Stripe confirms approval.
    if (session.payment_status !== "paid") return Response.json({ error: "Your payment is not approved yet." }, { status: 409 });
    if (!restorationReady()) return Response.json({ error: "Restoration is temporarily unavailable. Your payment is saved; please try again later." }, { status: 503 });
    let croppedImage: File | undefined;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      if (Number(request.headers.get("content-length")) > 4_200_000) return Response.json({ error: "Photo is too large." }, { status: 413 });
      const file = (await request.formData()).get("cropped_image");
      if (!(file instanceof File) || file.type !== "image/jpeg" || !file.size || file.size > 4_000_000) return Response.json({ error: "Please select a valid cropped JPEG." }, { status: 400 });
      const signature = new Uint8Array(await file.slice(0, 3).arrayBuffer());
      if (signature[0] !== 255 || signature[1] !== 216 || signature[2] !== 255) return Response.json({ error: "Invalid photo." }, { status: 400 });
      croppedImage = file;
    }
    const order = await advanceRestoration(id, croppedImage, session.customer_details?.email || null, session.client_reference_id || undefined);
    return Response.json({ status: order?.status || "awaiting_photo" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "We could not check your restoration. Please try again; you will not be charged again." }, { status: 503 });
  }
}
