import Image from "next/image";
import Link from "next/link";
import { CreditCard, Crop, ImagePlus, Images } from "lucide-react";
import type { ReactNode } from "react";

export function FlowHeader({ step }: { step: "select" | "camera" | "crop" | "checkout" | "result" }) {
  const currentStep = step === "checkout" || step === "result" ? 3 : step === "crop" ? 2 : 1;
  return (
    <header className="sticky top-3 z-30">
      <div className="mx-auto grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-[#e2e5e8] bg-[#f8f9fa]/95 px-1 py-3 backdrop-blur-xl">
        <Link aria-label="Back to Restore Old Photos home" className="flex min-w-0 items-center gap-3 justify-self-start" href="/">
          <Image alt="" className="h-9 w-9 rounded-lg object-cover shadow-[0_6px_14px_rgba(35,23,21,0.12)]" height={36} priority src="/app-icon.jpg" width={36} />
          <span className="hidden text-sm font-semibold sm:block">Restore Old Photos</span>
        </Link>
        <div className="hidden items-center gap-2 text-xs font-medium text-[#9a8f89] md:flex" aria-label={`Step ${currentStep} of 3`}>
          <ProgressStep active={currentStep >= 1}><ImagePlus className="h-3.5 w-3.5" aria-hidden="true" /> Photo</ProgressStep>
          <span className="h-px w-8 bg-[#e8dfdb]" />
          <ProgressStep active={currentStep >= 2}><Crop className="h-3.5 w-3.5" aria-hidden="true" /> Crop</ProgressStep>
          <span className="h-px w-8 bg-[#e8dfdb]" />
          <ProgressStep active={currentStep >= 3}>{step === "result" ? <><Images className="h-3.5 w-3.5" aria-hidden="true" /> Result</> : <><CreditCard className="h-3.5 w-3.5" aria-hidden="true" /> Checkout</>}</ProgressStep>
        </div>
      </div>
    </header>
  );
}

function ProgressStep({ active, children }: { active: boolean; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 px-2 py-1.5 ${active ? "text-[#267369]" : "text-[#9a8f89]"}`}>{children}</span>;
}
