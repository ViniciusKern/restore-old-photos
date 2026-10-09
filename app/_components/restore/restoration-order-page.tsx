"use client";

import Link from "next/link";
import { ArrowLeft, LoaderCircle, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { FlowHeader } from "./flow-header";
import { readCheckout, type LocalCheckout } from "./local-checkout";
import { RestorationResult } from "./restoration-result";

export function RestorationOrderPage({ restorationId }: { restorationId: string }) {
  const [order, setOrder] = useState<LocalCheckout | null>(null);
  const [status, setStatus] = useState<"loading" | "pending" | "approved" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<"select" | "camera" | "crop" | "checkout" | "result">("result");
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function verify(saved: LocalCheckout) {
      try {
        const response = await fetch(`/api/checkout-status/${saved.sessionId}`, {
          headers: { Authorization: `Bearer ${saved.clientSecret}` }, signal: controller.signal, cache: "no-store",
        });
        const payment = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(payment.error);
        if (payment.restoration_id !== restorationId) throw new Error("This payment does not belong to this restoration.");
        if (payment.status === "approved") setStatus("approved");
        else if (payment.status === "pending") {
          setStatus("pending");
          timer = setTimeout(() => void verify(saved), 2500);
        } else throw new Error(payment.status === "expired" ? "This checkout has expired. Your photo has not been sent for restoration." : "Your payment was not approved. Your photo has not been sent for restoration.");
      } catch (cause) {
        if (!cancelled) { setError(cause instanceof Error ? cause.message : "We could not check your payment. Please try again."); setStatus("error"); }
      }
    }
    async function loadOrder() {
      try {
        const saved = await readCheckout(restorationId);
        if (cancelled) return;
        if (!saved) { setStatus("missing"); return; }
        setOrder(saved);
        await verify(saved);
      } catch (cause) {
        if (!cancelled) { setError(cause instanceof Error ? cause.message : "We could not open your restoration."); setStatus("error"); }
      }
    }
    void loadOrder();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [restorationId, attempt]);

  return (
    <main className="min-h-screen bg-[#f8f9fa] text-[#242729]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <FlowHeader step={step} />
        {status === "approved" && order ? <RestorationResult id={order.sessionId} restorationId={restorationId} secret={order.clientSecret} croppedPhoto={order.croppedPhoto} onStepChange={setStep} /> : (
          <section className="restore-panel-in mx-auto w-full max-w-2xl py-10">
            <h1 className="text-3xl font-semibold">{status === "missing" ? "Restoration unavailable" : status === "error" ? "Let's check your payment" : "Confirming your payment"}</h1>
            {status === "loading" || status === "pending" ? <p className="mt-6 flex items-center gap-3 text-sm text-[#677078]" role="status"><LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> Waiting for payment confirmation...</p> : null}
            {status === "missing" ? <p className="mt-4 text-sm leading-6 text-[#677078]">Open this link in the browser where you placed the order. We could not find its saved details here.</p> : null}
            {error ? <p role="alert" className="mt-4 text-sm leading-6 text-red-700">{error}</p> : null}
            {status === "error" ? <button className="button-secondary mt-5" type="button" onClick={() => { setError(""); setStatus("loading"); setAttempt(n => n + 1); }}><RotateCw aria-hidden="true" /> Check again</button> : null}
            <Link className="button-quiet mt-6" href="/restore"><ArrowLeft aria-hidden="true" /> Restore a new photo</Link>
            <p className="mt-6 break-all text-xs text-[#677078]">Order: {restorationId}</p>
          </section>
        )}
      </div>
    </main>
  );
}
