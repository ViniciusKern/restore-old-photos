"use client";

import type {
  StripeCheckoutForm,
  StripeCheckoutFormSdkOptions,
} from "@stripe/stripe-js";
import {
  ArrowLeft,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  RotateCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isRestorationId } from "@/app/_lib/restoration-id";
import { saveCheckout, type LocalCheckout } from "./local-checkout";

const appearance: StripeCheckoutFormSdkOptions["appearance"] = {
  theme: "stripe",
  labels: "auto",
  inputs: "spaced",
  variables: {
    borderRadius: "4px",
    colorBackground: "#ffffff",
    colorDanger: "#df1b41",
    colorPrimary: "#0570de",
    colorSuccess: "#00c853",
    colorText: "#30313d",
    fontFamily: "Inter",
    fontSizeBase: "16px",
    spacingUnit: "4px",
  },
};

async function createCheckout(croppedPhoto: Blob): Promise<LocalCheckout> {
  const response = await fetch("/api/create-checkout-session", {
    method: "POST",
  });
  const data = await response.json();
  if (
    !response.ok ||
    typeof data.client_secret !== "string" ||
    typeof data.session_id !== "string" ||
    typeof data.restoration_id !== "string" ||
    !isRestorationId(data.restoration_id)
  ) {
    throw new Error(
      data.error || "We could not open checkout. Please try again.",
    );
  }
  const record = {
    croppedPhoto,
    clientSecret: data.client_secret,
    sessionId: data.session_id,
    restorationId: data.restoration_id,
  };
  await saveCheckout(record);
  return record;
}

export function StripeCheckout({
  onBack,
  croppedPhoto,
}: {
  onBack: () => void;
  croppedPhoto: Blob;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<Promise<LocalCheckout> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "redirecting"
  >("loading");
  const [error, setError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false,
      confirming = false;
    let form: StripeCheckoutForm | undefined;
    const controller = new AbortController();
    async function mountCheckout() {
      try {
        const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
        if (!publishableKey || publishableKey.endsWith("..."))
          throw new Error(
            "Checkout is not available yet. Please try again later.",
          );
        if (!window.Stripe)
          throw new Error(
            "The payment form could not load. Please check your connection and try again.",
          );
        // A new flow creates a new checkout; effect replay and retries reuse only this flow's session.
        checkoutRef.current ??= createCheckout(croppedPhoto).catch((cause) => {
          checkoutRef.current = null;
          throw cause;
        });
        const record = await checkoutRef.current;
        if (cancelled) return;
        const response = await fetch(
          `/api/checkout-status/${record.sessionId}`,
          {
            headers: { Authorization: `Bearer ${record.clientSecret}` },
            signal: controller.signal,
            cache: "no-store",
          },
        );
        const payment = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(payment.error);
        if (payment.status === "approved") {
          router.replace(`/restore/${record.restorationId}`);
          return;
        }
        if (payment.status === "expired")
          throw new Error(
            "Your checkout has expired. Go back to your photo to open a new checkout.",
          );
        const stripe = window.Stripe(publishableKey, {
          betas: ["custom_checkout_payment_form_1"],
        });
        const checkout = stripe.initCheckoutFormSdk({
          clientSecret: record.clientSecret,
          appearance,
        });
        const loadActionsResult = await checkout.loadActions();
        if (cancelled) return;
        if (loadActionsResult.type !== "success")
          throw new Error(loadActionsResult.error.message);
        form = checkout.createForm({ layout: "expanded" });
        form.on("ready", () => {
          if (!cancelled) setStatus("ready");
        });
        form.on("loaderror", () => {
          if (!cancelled) {
            setError("The payment form could not load. Please try again.");
            setStatus("error");
          }
        });
        form.on("confirm", async (event) => {
          if (cancelled || confirming) return;
          confirming = true;
          setIsConfirming(true);
          setError("");
          try {
            const result = await loadActionsResult.actions.confirm({
              formConfirmEvent: event,
              redirect: "if_required",
              returnUrl: `${window.location.origin}/restore/${record.restorationId}`,
            });
            if (cancelled) return;
            if (result.type === "error") setError(result.error.message);
            else {
              form?.destroy();
              form = undefined;
              setStatus("redirecting");
              router.replace(`/restore/${record.restorationId}`);
            }
          } catch {
            if (!cancelled)
              setError("We could not confirm your payment. Please try again.");
          } finally {
            confirming = false;
            if (!cancelled) setIsConfirming(false);
          }
        });
        if (containerRef.current) form.mount(containerRef.current);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "We could not open checkout. Please try again.",
          );
          setStatus("error");
        }
      }
    }
    void mountCheckout();
    return () => {
      cancelled = true;
      controller.abort();
      form?.destroy();
    };
  }, [attempt, croppedPhoto, router]);

  return (
    <section className="restore-panel-in mx-auto w-full max-w-2xl py-8 sm:py-12">
      <button
        className="button-quiet mb-5"
        disabled={isConfirming || status === "redirecting"}
        onClick={onBack}
        type="button"
      >
        <ArrowLeft aria-hidden="true" /> Back to photo
      </button>
      <p className="flex items-center gap-2 text-sm font-medium text-[#267369]">
        <CreditCard className="h-4 w-4" aria-hidden="true" /> Checkout
      </p>
      <p className="mt-3 text-sm leading-6 text-[#677078]">
        Enter your email and payment details below.
      </p>
      <div className="mt-7 rounded-lg border border-[#e2e5e8] bg-white p-5 sm:p-7">
        {status === "loading" || status === "redirecting" ? (
          <div
            className="flex min-h-32 items-center justify-center gap-3 text-sm text-[#677078]"
            role="status"
          >
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            {status === "redirecting"
              ? "Opening your restoration..."
              : "Loading secure checkout..."}
          </div>
        ) : null}
        <div
          id="checkout-form"
          ref={containerRef}
          hidden={status === "error" || status === "redirecting"}
        />
        {error ? (
          <p className="text-sm leading-6 text-[#b42318]" role="alert">
            {error}
          </p>
        ) : null}
        {status === "error" ? (
          <button
            className="button-secondary mt-4"
            onClick={() => {
              setError("");
              setStatus("loading");
              setAttempt((n) => n + 1);
            }}
            type="button"
          >
            <RotateCw aria-hidden="true" /> Try again
          </button>
        ) : null}
      </div>
      <p className="mt-4 flex items-center justify-center gap-2 text-xs text-[#677078]">
        <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> Payments
        processed securely by Stripe
      </p>
    </section>
  );
}
