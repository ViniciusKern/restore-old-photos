import { steps } from "../../_content/landing";
import { SectionHeader } from "./section-header";
import { Upload, Crop, CreditCard, Download } from "lucide-react";

const stepIcons = [Upload, Crop, CreditCard, Download];

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="border-t border-[#e8dfdb] px-6 py-24 md:px-10"
    >
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="How it works"
          title="From old print to restored photo"
          body="Choose your photo, adjust the crop, and pay for a single restoration. Get a download link by email when the result is ready."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => {
            const Icon = stepIcons[index];
            return (
            <article
              key={step.number}
              className="border-t border-[#e2e5e8] py-6 lg:pr-6"
            >
              <div className="flex items-center justify-between text-[#677078]">
                <span className="text-sm font-medium">{step.number}</span>
                <Icon className="h-5 w-5 text-[#267369]" aria-hidden="true" strokeWidth={1.6} />
              </div>
              <h3 className="mt-5 text-lg font-semibold leading-7">
                {step.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-[#677078]">
                {step.body}
              </p>
            </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
