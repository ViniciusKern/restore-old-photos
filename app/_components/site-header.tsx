"use client";

import Image from "next/image";
import Link from "next/link";
import { WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";

export function SiteHeader() {
  const [hasScrolled, setHasScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setHasScrolled(window.scrollY > 24);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 px-3 transition-[padding] duration-300 ease-out ${
        hasScrolled ? "py-2" : "py-5"
      }`}
    >
      <div
        className={`mx-auto flex w-full items-center justify-between transition-all duration-300 ease-out ${
          hasScrolled
            ? "max-w-5xl rounded-lg border border-[#e2e5e8] bg-white/92 px-4 py-2 shadow-[0_8px_24px_rgba(24,35,45,0.06)] backdrop-blur-xl"
            : "max-w-7xl border border-transparent bg-transparent px-3 py-0 md:px-7"
        }`}
      >
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label="Restore Old Photos home"
        >
          <Image
            src="/app-icon.jpg"
            alt=""
            width={32}
            height={32}
            priority
            className="h-8 w-8 rounded-lg object-cover shadow-[0_6px_14px_rgba(35,23,21,0.12)]"
          />
          <span className="hidden text-sm font-semibold sm:block">Restore Old Photos</span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-[#6e625d] md:flex">
          <a href="#how-it-works" className="transition hover:text-[#231715]">
            How it works
          </a>
          <a href="#faq" className="transition hover:text-[#231715]">
            FAQ
          </a>
        </nav>

        <Link
          href="/restore"
          className="button-primary whitespace-nowrap"
        >
          <WandSparkles aria-hidden="true" />
          Restore a photo
        </Link>
      </div>
    </header>
  );
}
