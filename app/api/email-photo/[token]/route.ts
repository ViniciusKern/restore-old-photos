import { get } from "@vercel/blob";
import { readEmailPhoto } from "@/app/_lib/email-photo";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
  try {
    const { token } = await params;
    const order = await readEmailPhoto(token);
    if (!order?.resultUrl) return new Response(null, { status: 404, headers });
    const result = await get(order.resultUrl, { access: "private" });
    if (!result || result.statusCode !== 200) return new Response(null, { status: 404, headers });
    const type = result.blob.contentType.split(";")[0];
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[type];
    if (!extension) return new Response(null, { status: 404, headers });
    const disposition = new URL(request.url).searchParams.has("download") ? "attachment" : "inline";
    return new Response(result.stream, { headers: { ...headers, "Content-Type": type, "Content-Disposition": `${disposition}; filename="restored-photo.${extension}"` } });
  } catch { return new Response(null, { status: 503, headers }); }
}
