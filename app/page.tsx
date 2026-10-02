import { SiteHeader } from "./_components/site-header";
import { FaqSection } from "./_components/landing/faq-section";
import { HeroSection } from "./_components/landing/hero-section";
import { HowItWorksSection } from "./_components/landing/how-it-works-section";
import { ProblemSection } from "./_components/landing/problem-section";
import { SiteFooter } from "./_components/landing/site-footer";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#fafaf9] text-[#231715]">
      <SiteHeader />
      <HeroSection />
      <ProblemSection />
      <HowItWorksSection />
      <FaqSection />
      <SiteFooter />
    </main>
  );
}
