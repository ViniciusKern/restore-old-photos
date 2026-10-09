"use client";

import { Download, LoaderCircle, RotateCw, CheckCircle2, ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RestorePhotoFlow } from "./restore-photo-flow";
import { saveCheckout } from "./local-checkout";

type Recovery = { attemptId?: string; canRetry: boolean; canReplace: boolean; attemptsRemaining: number; error?: { code?: string } };
type RecoveryRequest = { action: "retry" | "replace"; expectedAttemptId: string; photo?: Blob };

export function RestorationResult({ id, restorationId, secret, croppedPhoto, onStepChange }: { id: string; restorationId: string; secret: string; croppedPhoto: Blob; onStepChange?: (step: "select" | "camera" | "crop" | "checkout" | "result") => void }) {
  const [status, setStatus] = useState("uploading");
  const [error, setError] = useState("");
  const [image, setImage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [choosingPhoto, setChoosingPhoto] = useState(false);
  const pendingRequest = useRef<RecoveryRequest | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (choosingPhoto) return;
    let cancelled = false, url = "";
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function check(first: boolean) {
      try {
        const body = new FormData();
        const request = first ? pendingRequest.current : null;
        if (first) pendingRequest.current = null;
        if (request) {
          body.append("action", request.action);
          body.append("expected_attempt_id", request.expectedAttemptId);
          if (request.photo) body.append("cropped_image", request.photo, "cropped.jpg");
        } else if (first) body.append("cropped_image", croppedPhoto, "cropped.jpg");
        const response = await fetch(`/api/restorations/${id}`, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, ...(first ? { body } : {}), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "We could not check your restoration. Please try again; you will not be charged again.");
        if (cancelled) return;
        submitting.current = false;
        if (data.status === "awaiting_photo") { timer = setTimeout(() => void check(true), 3000); return; }
        setStatus(data.status);
        setRecovery(data);
        if (data.status === "complete") {
          const result = await fetch(`/api/restorations/${id}/image`, { headers: { Authorization: `Bearer ${secret}` }, signal: controller.signal });
          if (!result.ok) throw new Error("We could not load your restored photo. Please try again.");
          const blob = await result.blob();
          if (!cancelled) { url = URL.createObjectURL(blob); setImage(url); }
        } else if (data.status === "failed" || data.status === "needs_attention") {
          setError(data.error?.message || "The restoration could not be completed. Please contact support with your order ID; do not pay again.");
        } else timer = setTimeout(() => void check(false), 3000);
      } catch (cause) {
        if (!cancelled) {
          submitting.current = false;
          setRecovery(null);
          setError(cause instanceof Error ? cause.message : "Please try again. You will not be charged again.");
        }
      }
    }
    void check(true);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [id, secret, croppedPhoto, attempt, choosingPhoto]);
  function retry(request?: RecoveryRequest) {
    if (submitting.current) return;
    submitting.current = true;
    pendingRequest.current = request || null;
    setError("");
    setRecovery(null);
    setStatus("processing");
    setAttempt(n => n + 1);
  }
  if (choosingPhoto && recovery?.attemptId) {
    const expectedAttemptId = recovery.attemptId;
    return <RestorePhotoFlow onStepChange={onStepChange} onCancel={() => { onStepChange?.("result"); setChoosingPhoto(false); }} onPrepared={async photo => {
      await saveCheckout({ restorationId, sessionId: id, clientSecret: secret, croppedPhoto: photo });
      retry({ action: "replace", expectedAttemptId, photo });
      onStepChange?.("result");
      setChoosingPhoto(false);
    }} />;
  }
  return (
    <section className="restore-panel-in mx-auto w-full max-w-2xl py-10">
      {!image ? <p className="flex items-center gap-2 text-sm font-medium text-[#267369]"><CheckCircle2 className="h-4 w-4" /> Payment approved</p> : null}
      <h1 className={`${image ? "" : "mt-3 "}text-3xl font-semibold`}>{image ? "Your photo, restored" : error ? "Restoration interrupted" : "Restoring your photo"}</h1>
      {!image && !error ? <div className="mt-8 flex items-center gap-3 text-sm text-[#677078]" role="status"><LoaderCircle className="h-5 w-5 animate-spin" />{status === "uploading" ? "Sending your cropped photo..." : "Bringing your photo back to life..."}</div> : null}
      {image ? <>
        {/* The result is an authenticated local Blob URL, not a public image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="Your restored photo" src={image} className="mt-7 max-h-[65vh] w-full rounded-lg object-contain" />
        <div className="mt-6 flex flex-wrap gap-3"><a className="button-primary" href={image} download="restored-photo"><Download /> Download photo</a><Link className="button-secondary" href="/restore"><RotateCw /> Restore another photo</Link></div>
      </> : null}
      {error ? <div className="mt-6">
        <p role="alert" className="text-sm leading-6 text-red-700">{error}</p>
        {recovery?.error?.code ? <p className="mt-2 text-xs text-[#677078]">Error code: {recovery.error.code}</p> : null}
        {recovery?.canRetry || recovery?.canReplace ? <p className="mt-3 text-sm text-[#677078]">You will not be charged again. {recovery.attemptsRemaining} {recovery.attemptsRemaining === 1 ? "attempt" : "attempts"} remaining.</p> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          {recovery?.canRetry && recovery.attemptId ? <button type="button" className="button-primary" onClick={() => retry({ action: "retry", expectedAttemptId: recovery.attemptId! })}><RotateCw aria-hidden="true" /> Try again</button> : null}
          {recovery?.canReplace && recovery.attemptId ? <button type="button" className="button-secondary" onClick={() => setChoosingPhoto(true)}><ImagePlus aria-hidden="true" /> Use another photo</button> : null}
          {!recovery ? <button type="button" className="button-secondary" onClick={() => retry()}><RotateCw aria-hidden="true" /> Check again</button> : null}
        </div>
      </div> : null}
      <p className="mt-6 break-all text-xs text-[#677078]">Order: {restorationId}</p>
    </section>
  );
}
