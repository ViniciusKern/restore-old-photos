import { restorationFixes } from "../../_content/landing";
import { SectionHeader } from "./section-header";
import { Eraser, ScanFace, Sun } from "lucide-react";

const fixIcons = [Eraser, ScanFace, Sun];

export function ProblemSection() {
  return (
    <section className="border-t border-[#e8dfdb] bg-white/60 px-6 py-24 md:px-10">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Photo restoration"
          title="Repair damage and bring back detail"
          body="Scratches, fading, and low contrast can make old photos hard to see. AI restoration helps improve the image so you can share and preserve it."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {restorationFixes.map((fix, index) => {
            const Icon = fixIcons[index];
            return (
            <article
              key={fix.label}
              className="border-t border-[#e2e5e8] py-6 md:pr-8"
            >
              <Icon aria-hidden="true" className="h-6 w-6 text-[#267369]" strokeWidth={1.6} />
              <h3 className="mt-5 text-xl font-semibold leading-7">
                {fix.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-[#677078]">
                {fix.body}
              </p>
            </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
