import Link from "next/link";
import { ArrowRight, Check, ImagePlus } from "lucide-react";
import { BeforeAfterSlider } from "../before-after-slider";

export function HeroSection() {
  return (
    <section className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 pb-14 pt-8 md:px-10 lg:min-h-[680px] lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pt-12">
      <div>
        <div className="inline-flex items-center gap-2 text-sm font-medium text-[#267369]">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          AI photo restoration
        </div>

        <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.08] text-[#242729] sm:text-5xl md:text-6xl 2xl:text-7xl">
          Restore your old photos.
        </h1>

        <p className="mt-6 max-w-lg text-lg leading-8 text-[#677078]">
          Improve scratched, faded, or damaged photos with AI. Upload a scan or
          take a photo of an old print, then pay for the photo you want
          restored.
        </p>

        <div className="mt-8 max-w-xl">
          <Link href="/restore" className="button-primary min-w-52">
            Restore a photo
            <ArrowRight aria-hidden="true" />
          </Link>
          <p className="mt-4 flex items-center gap-2 text-sm text-[#677078]">
            <Check
              className="h-4 w-4 shrink-0 text-[#267369]"
              aria-hidden="true"
            />
            Pay per photo. No subscription or account required.
          </p>
        </div>

        <div className="mt-10 max-w-lg border-t border-[#e2e5e8] pt-6">
          <p className="text-base font-semibold text-[#231715]">
            Restore family portraits and old prints
          </p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#677078]">
            Make wedding photos, family portraits, and travel pictures clearer
            and easier to share.
          </p>
        </div>
      </div>

      <BeforeAfterSlider />
    </section>
  );
}
