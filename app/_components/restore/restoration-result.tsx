"use client";

import { Download, LoaderCircle, RotateCw, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { localCheckout } from "./local-checkout";

export function RestorationResult({ id, secret, croppedPhoto, onRestart }: { id: string; secret: string; croppedPhoto: Blob; onRestart: () => void }) {
  const [status, setStatus] = useState("uploading");
  const [error, setError] = useState("");
  const [image, setImage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false, url = "";
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function check(first: boolean) {
      try {
        const body = new FormData();
        if (first) body.append("cropped_image", croppedPhoto, "cropped.jpg");
        const response = await fetch(`/api/restorations/${id}`, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, ...(first ? { body } : {}), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (cancelled) return;
        if (data.status === "awaiting_photo") { timer = setTimeout(() => void check(true), 3000); return; }
        setStatus(data.status);
        if (data.status === "complete") {
          const result = await fetch(`/api/restorations/${id}/image`, { headers: { Authorization: `Bearer ${secret}` }, signal: controller.signal });
          if (!result.ok) throw new Error("We could not load your restored photo. Please try again.");
          const blob = await result.blob();
          if (!cancelled) { url = URL.createObjectURL(blob); setImage(url); }
        } else if (data.status === "failed" || data.status === "needs_attention") {
          throw new Error("Your payment was approved, but the restoration needs attention. Keep this page saved and contact support with your order ID below. Do not pay again.");
        } else timer = setTimeout(() => void check(false), 3000);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Please try again. You will not be charged again.");
      }
    }
    void check(true);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [id, secret, croppedPhoto, attempt]);
  return (
    <section className="restore-panel-in mx-auto w-full max-w-2xl py-10">
      <p className="flex items-center gap-2 text-sm font-medium text-[#267369]"><CheckCircle2 className="h-4 w-4" /> Payment approved</p>
      <h1 className="mt-3 text-3xl font-semibold">{image ? "Your photo, restored" : error ? "Let's check your restoration" : "Restoring your photo"}</h1>
      {!image && !error ? <div className="mt-8 flex items-center gap-3 text-sm text-[#677078]" role="status"><LoaderCircle className="h-5 w-5 animate-spin" />{status === "uploading" ? "Sending your cropped photo..." : "Bringing your photo back to life..."}</div> : null}
      {image ? <>
        {/* The result is an authenticated local Blob URL, not a public image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="Your restored photo" src={image} className="mt-7 max-h-[65vh] w-full rounded-lg object-contain" />
        <div className="mt-6 flex flex-wrap gap-3"><a className="button-primary" href={image} download="restored-photo"><Download /> Download photo</a><button className="button-secondary" type="button" onClick={async () => { await localCheckout(null); onRestart(); }}><RotateCw /> Restore another photo</button></div>
      </> : null}
      {error ? <div className="mt-6"><p role="alert" className="text-sm leading-6 text-red-700">{error}</p><button type="button" className="button-secondary mt-4" onClick={() => { setError(""); setAttempt(n => n + 1); }}><RotateCw /> Check again</button></div> : null}
      <p className="mt-6 break-all text-xs text-[#677078]">Order: {id}</p>
    </section>
  );
}
