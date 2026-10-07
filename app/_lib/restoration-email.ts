import { createHash, randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";

export type EmailDelivery = {
  token: string;
  expiresAt: number;
  from: string;
  to: string;
  link: string;
  firstAttemptAt?: number;
  sentAt?: number;
  messageId?: string;
  needsAttention?: boolean;
};
type EmailOrder = {
  status: string;
  resultUrl?: string;
  email: string | null;
  emailDelivery?: EmailDelivery;
};
const linkKey = (token: string) =>
  `restoration:email-link:${createHash("sha256").update(token).digest("hex")}`;
const validToken = (token: string) => /^[a-f0-9]{64}$/.test(token);
const configured = (value: string | undefined) =>
  !!value?.trim() && !value.trim().endsWith("...");

export function restorationEmailConfigured() {
  return (
    configured(process.env.RESEND_API_KEY) &&
    configured(process.env.RESEND_FROM_EMAIL) &&
    configured(process.env.APP_URL)
  );
}

export async function emailLinkOrderId(token: string): Promise<string | null> {
  if (!validToken(token)) return null;
  const record = await Redis.fromEnv().get<{ id: string; expiresAt: number }>(
    linkKey(token),
  );
  return record && record.expiresAt > Date.now() ? record.id : null;
}

export function emailLinkMatches(order: EmailOrder, token: string) {
  return (
    validToken(token) &&
    order.status === "complete" &&
    !!order.resultUrl &&
    order.emailDelivery?.token === token &&
    order.emailDelivery.expiresAt > Date.now()
  );
}

function emailBody(link: string) {
  const safeLink = link
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return {
    subject: "Your restored photo is ready",
    text: `Hi,\n\nYour photo has been restored and is ready to download.\n\nView and download your photo: ${link}\n\nThank you.`,
    html: `<div style="font-family:Arial,sans-serif;color:#242729;font-size:16px;line-height:1.6"><p>Hi,</p><p>Your photo has been restored and is ready to download.</p><p style="margin:28px 0"><a href="${safeLink}" style="display:inline-block;background:#d94b32;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none">View and download your photo</a></p><p>Thank you.</p></div>`,
  };
}

// The caller holds the order lock and persists delivery state before contacting Resend.
export async function deliverRestorationEmail(
  id: string,
  order: EmailOrder,
  persist: () => Promise<void>,
) {
  if (
    order.status !== "complete" ||
    !order.resultUrl ||
    !order.email ||
    !restorationEmailConfigured()
  )
    return;
  if (order.emailDelivery?.sentAt || order.emailDelivery?.needsAttention)
    return;
  if (!order.emailDelivery) {
    const origin = new URL(process.env.APP_URL!);
    if (
      origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      )
    )
      throw new Error("Invalid email link origin");
    if (origin.username || origin.password)
      throw new Error("Invalid email link origin");
    const token = randomBytes(32).toString("hex");
    order.emailDelivery = {
      token,
      expiresAt: Date.now() + 30 * 86400_000,
      from: process.env.RESEND_FROM_EMAIL!,
      to: order.email,
      link: new URL(`/photo/${token}`, origin.origin).href,
    };
    await persist();
  }
  const delivery = order.emailDelivery;
  // Resend deduplicates for 24 hours; ambiguous older sends require manual review.
  if (
    delivery.firstAttemptAt &&
    Date.now() - delivery.firstAttemptAt >= 23 * 3600_000
  ) {
    delivery.needsAttention = true;
    await persist();
    return;
  }
  await Redis.fromEnv().set(
    linkKey(delivery.token),
    { id, expiresAt: delivery.expiresAt },
    { ex: Math.max(1, Math.ceil((delivery.expiresAt - Date.now()) / 1000)) },
  );
  delivery.firstAttemptAt ??= Date.now();
  await persist();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `restoration-complete/${id}`,
    },
    body: JSON.stringify({
      from: delivery.from,
      to: [delivery.to],
      ...emailBody(delivery.link),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Email provider returned ${response.status}`);
  const result = await response.json();
  if (typeof result.id !== "string")
    throw new Error("Email provider did not confirm submission");
  delivery.messageId = result.id;
  delivery.sentAt = Date.now();
  await persist();
}
