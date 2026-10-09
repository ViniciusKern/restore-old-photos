export const MAX_RESTORATION_ATTEMPTS = 3;

export type RestorationFailure = {
  kind: "temporary" | "photo" | "configuration" | "unknown" | "ambiguous";
  message: string;
  code?: string;
  httpStatus?: number;
  detail?: string;
};

export function classifyRestorationFailure(detail: unknown, httpStatus?: number, status?: string): RestorationFailure {
  const raw = typeof detail === "string" ? detail : JSON.stringify(detail ?? "");
  const code = raw.match(/\bE\d{4}\b/)?.[0];
  // Provider diagnostics stay server-side and must not retain input URLs or credentials.
  const safeDetail = raw.replace(/data:[^\s"']+/gi, "[image]").replace(/https?:\/\/[^\s"']+/gi, "[url]")
    .replace(/\b(?:r8_|sk_|pk_)[\w-]+/g, "[credential]").replace(/Bearer\s+\S+/gi, "Bearer [credential]").slice(0, 1000);
  let kind: RestorationFailure["kind"] = "unknown";
  let message = "The restoration could not be completed. Try again or choose another photo.";
  if ([401, 402, 403, 404].includes(httpStatus ?? 0) || ["E4875", "E8765"].includes(code ?? "")) {
    kind = "configuration";
    message = "Restoration is unavailable right now. Your payment is saved. Please contact support with your order ID; do not pay again.";
  } else if (/\b(nsfw|unsafe|safety|content policy|content moderation)\b/i.test(raw)) {
    kind = "photo";
    message = "The image was blocked by the restoration service's safety filter. Please choose another photo.";
  } else if (code === "E1001" || /(?:invalid|unsupported|corrupt|cannot decode|failed to decode).*(?:image|file)|(?:image|file).*(?:invalid|unsupported|corrupt)/i.test(raw)) {
    kind = "photo";
    message = code === "E1001" ? "The service could not process this photo within its memory limit. Try a smaller photo or crop." : "The service could not read this image. Please choose another photo.";
  } else if (httpStatus === 400 || httpStatus === 422) {
    kind = "configuration";
    message = "The restoration service could not accept the request. Please contact support with your order ID; do not pay again.";
  } else if (httpStatus === 429 || (httpStatus ?? 0) >= 500 || ["E1000", "E6716", "E8367", "E9825"].includes(code ?? "") || ["canceled", "aborted"].includes(status ?? "")) {
    kind = "temporary";
    message = httpStatus === 429 ? "The restoration service is busy. Wait a moment, then try again." : "The restoration was interrupted. Please try again.";
  }
  return { kind, message, code, httpStatus, detail: safeDetail };
}

export function ambiguousRestorationFailure(): RestorationFailure {
  return { kind: "ambiguous", message: "We could not confirm whether the restoration started. Please contact support with your order ID; do not pay again." };
}

export function restorationRecovery(failure: RestorationFailure | undefined, attempts: number) {
  const allowed = !!failure && attempts < MAX_RESTORATION_ATTEMPTS;
  return {
    canRetry: allowed && ["temporary", "unknown"].includes(failure.kind),
    canReplace: allowed && ["temporary", "unknown", "photo"].includes(failure.kind),
    attemptsRemaining: Math.max(0, MAX_RESTORATION_ATTEMPTS - attempts),
  };
}
