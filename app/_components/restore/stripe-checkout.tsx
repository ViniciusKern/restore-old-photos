"use client";

import type {
  StripeCheckoutForm,
  StripeCheckoutFormSdkOptions,
} from "@stripe/stripe-js";
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  RotateCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { localCheckout } from "./local-checkout";
import { RestorationResult } from "./restoration-result";

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

async function createClientSecret(croppedPhoto: Blob) {
  const saved = await localCheckout();
  if (saved) return saved.clientSecret;
  const response = await fetch("/api/create-checkout-session", {
    method: "POST",
  });
  const data = await response.json();

  if (!response.ok || typeof data.client_secret !== "string") {
    throw new Error(
      data.error || "We could not open checkout. Please try again.",
    );
  }

  await localCheckout({ croppedPhoto, clientSecret: data.client_secret });
  return data.client_secret as string;
}

export function StripeCheckout({
  onBack,
  onRestart,
  croppedPhoto,
}: {
  onBack: () => void;
  onRestart: () => void;
  croppedPhoto: Blob;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clientSecretRef = useRef<Promise<string> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "verifying" | "complete"
  >("loading");
  const [error, setError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmedSessionRef = useRef<{ id: string; secret: string } | null>(
    null,
  );
  const [confirmedSession, setConfirmedSession] = useState<{
    id: string;
    secret: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let confirming = false;
    let form: StripeCheckoutForm | undefined;
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    async function verifyPayment(id: string, secret: string) {
      if (cancelled) return;
      setStatus("verifying");
      try {
        const response = await fetch(
          `/api/checkout-status/${encodeURIComponent(id)}`,
          {
            headers: { Authorization: `Bearer ${secret}` },
            signal: controller.signal,
            cache: "no-store",
          },
        );
        const result = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(result.error);
        if (result.status === "approved") {
          setConfirmedSession({ id, secret });
          setStatus("complete");
        } else if (result.status === "pending") {
          pollTimer = setTimeout(() => {
            void verifyPayment(id, secret);
          }, 2500);
        } else {
          confirmedSessionRef.current = null;
          setConfirmedSession(null);
          await localCheckout(null);
          throw new Error(
            result.status === "expired"
              ? "Your checkout has expired."
              : "Your payment was not approved.",
          );
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "We could not verify your payment. Please try again.",
          );
          setStatus("error");
        }
      }
    }

    async function mountCheckout() {
      try {
        const saved = await localCheckout();
        if (cancelled) return;
        if (saved?.sessionId && !confirmedSessionRef.current) {
          const response = await fetch(
            `/api/checkout-status/${saved.sessionId}`,
            {
              headers: { Authorization: `Bearer ${saved.clientSecret}` },
              signal: controller.signal,
              cache: "no-store",
            },
          );
          const payment = await response.json();
          if (!response.ok) throw new Error(payment.error);
          if (cancelled) return;
          if (payment.status === "approved")
            confirmedSessionRef.current = {
              id: saved.sessionId,
              secret: saved.clientSecret,
            };
          if (payment.status === "expired")
            throw new Error(
              "Your checkout has expired. Go back to your photo to open a new checkout.",
            );
        }
        if (confirmedSessionRef.current) {
          await verifyPayment(
            confirmedSessionRef.current.id,
            confirmedSessionRef.current.secret,
          );
          return;
        }
        const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

        if (!publishableKey || publishableKey.endsWith("...")) {
          throw new Error(
            "Checkout is not available yet. Please try again later.",
          );
        }

        if (!window.Stripe) {
          throw new Error(
            "The payment form could not load. Please check your connection and try again.",
          );
        }

        const stripe = window.Stripe(publishableKey, {
          betas: ["custom_checkout_payment_form_1"],
        });

        // Reuse the session when React replays effects in development.
        clientSecretRef.current ??= createClientSecret(croppedPhoto);
        const clientSecret = await clientSecretRef.current;
        const sessionId = clientSecret.split("_secret_")[0];
        await localCheckout({ croppedPhoto, clientSecret, sessionId });

        if (cancelled) return;

        const checkout = stripe.initCheckoutFormSdk({
          clientSecret,
          appearance,
        });
        const loadActionsResult = await checkout.loadActions();

        if (cancelled) return;
        if (loadActionsResult.type !== "success") {
          throw new Error(loadActionsResult.error.message);
        }

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
              returnUrl: `${window.location.origin}/restore`,
            });

            if (cancelled) return;
            if (result.type === "error") {
              setError(result.error.message);
            } else {
              form?.destroy();
              form = undefined;
              confirmedSessionRef.current = {
                id: result.session.id,
                secret: clientSecret,
              };
              setConfirmedSession(confirmedSessionRef.current);
              await localCheckout({
                croppedPhoto,
                clientSecret,
                sessionId: result.session.id,
              });
              await verifyPayment(result.session.id, clientSecret);
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

    mountCheckout();

    return () => {
      cancelled = true;
      controller.abort();
      if (pollTimer) clearTimeout(pollTimer);
      form?.destroy();
    };
  }, [attempt, croppedPhoto]);

  if (status === "complete" && confirmedSession) {
    return (
      <RestorationResult
        id={confirmedSession.id}
        secret={confirmedSession.secret}
        croppedPhoto={croppedPhoto}
        onRestart={onRestart}
      />
    );
  }

  return (
    <section className="restore-panel-in mx-auto w-full max-w-2xl py-8 sm:py-12">
      {status !== "complete" ? (
        <button
          className="button-quiet mb-5"
          disabled={
            isConfirming || status === "verifying" || !!confirmedSession
          }
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" /> Back to photo
        </button>
      ) : null}

      <p className="flex items-center gap-2 text-sm font-medium text-[#267369]">
        <CreditCard className="h-4 w-4" aria-hidden="true" /> Checkout
      </p>
      <h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">
        {status === "complete"
          ? "Payment approved"
          : status === "verifying"
            ? "Confirming your payment"
            : "Pay for your restoration"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#677078]">
        {status === "complete"
          ? "Your payment has been confirmed by Stripe."
          : status === "verifying"
            ? "Please wait while we check your payment status. You will not be charged again."
            : "One photo, one payment. Enter your email and payment details below."}
      </p>

      <div className="mt-7 rounded-lg border border-[#e2e5e8] bg-white p-5 sm:p-7">
        {status === "loading" ? (
          <div
            className="flex min-h-32 items-center justify-center gap-3 text-sm text-[#677078]"
            role="status"
          >
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />{" "}
            Loading secure checkout...
          </div>
        ) : null}
        {status === "verifying" ? (
          <div
            className="flex min-h-32 items-center justify-center gap-3 text-sm text-[#677078]"
            role="status"
          >
            <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />{" "}
            Waiting for payment confirmation...
          </div>
        ) : null}
        <div
          id="checkout-form"
          ref={containerRef}
          hidden={
            status === "error" ||
            status === "verifying" ||
            status === "complete"
          }
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
              clientSecretRef.current = null;
              setError("");
              setStatus("loading");
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            <RotateCw aria-hidden="true" /> Try again
          </button>
        ) : null}
        {status === "complete" ? (
          <div
            className="flex items-center gap-3 text-sm text-[#267369]"
            role="status"
          >
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Payment
            approved
          </div>
        ) : null}
      </div>

      <p className="mt-4 flex items-center justify-center gap-2 text-xs text-[#677078]">
        <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> Payments
        processed securely by Stripe
      </p>
    </section>
  );
}
