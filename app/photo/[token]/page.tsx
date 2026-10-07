import type { Metadata } from "next";
import Link from "next/link";
import { Download, RotateCw } from "lucide-react";
import { FlowHeader } from "@/app/_components/restore/flow-header";
import { readEmailPhoto } from "@/app/_lib/email-photo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Your Restored Photo | Restore Old Photos",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PhotoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await readEmailPhoto(token);
  return (
    <main className="min-h-screen bg-[#f8f9fa] text-[#242729]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <FlowHeader step="result" />
        <section className="mx-auto w-full max-w-2xl py-10">
          <h1 className="text-3xl font-semibold">
            {order ? "Your photo, restored" : "This photo link is unavailable"}
          </h1>
          {order ? (
            <>
              {/* A bearer link streams only this result from private Blob storage. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Your restored photo"
                src={`/api/email-photo/${token}`}
                referrerPolicy="no-referrer"
                className="mt-7 max-h-[65vh] w-full rounded-lg object-contain"
              />
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  className="button-primary"
                  href={`/api/email-photo/${token}?download`}
                >
                  <Download aria-hidden="true" /> Download photo
                </a>
                <Link className="button-secondary" href="/restore">
                  <RotateCw aria-hidden="true" /> Restore another photo
                </Link>
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm leading-6 text-[#677078]">
              This link has expired or is invalid. Please contact support for
              help accessing your photo.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
