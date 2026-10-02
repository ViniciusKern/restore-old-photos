import { faqs } from "../../_content/landing";
import { SectionHeader } from "./section-header";
import { Plus } from "lucide-react";

export function FaqSection() {
  return (
    <section id="faq" className="border-t border-[#e8dfdb] px-6 py-24 md:px-10">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.75fr_1.25fr]">
        <SectionHeader
          eyebrow="Common questions"
          title="Frequently asked questions"
          body="What to expect from restoration and how to prepare your photo."
        />

        <div className="border-t border-[#e2e5e8]">
          {faqs.map((faq) => (
            <details
              key={faq.question}
              className="group border-b border-[#e2e5e8] py-5"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-semibold text-[#242729]">
                <span>{faq.question}</span>
                <Plus
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 text-[#677078] transition-transform duration-200 group-open:rotate-45"
                />
              </summary>
              <p className="mt-3 pr-8 text-sm leading-7 text-[#677078]">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
