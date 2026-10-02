"use client";

import Image from "next/image";
import { ChevronsLeftRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function BeforeAfterSlider() {
  const [position, setPosition] = useState(50);
  const animationFrameRef = useRef<number | null>(null);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReducedMotion) {
      return;
    }

    const keyframes = [
      { progress: 0, value: 50 },
      { progress: 0.3, value: 46 },
      { progress: 0.68, value: 54 },
      { progress: 1, value: 50 },
    ];
    const duration = 1900;

    const easeInOut = (value: number) =>
      value < 0.5
        ? 4 * value * value * value
        : 1 - Math.pow(-2 * value + 2, 3) / 2;

    const interpolate = (progress: number) => {
      const nextIndex = keyframes.findIndex(
        (keyframe) => keyframe.progress >= progress,
      );

      if (nextIndex <= 0) {
        return keyframes[0].value;
      }

      const previous = keyframes[nextIndex - 1];
      const next = keyframes[nextIndex];
      const localProgress =
        (progress - previous.progress) / (next.progress - previous.progress);
      const eased = easeInOut(localProgress);

      return previous.value + (next.value - previous.value) * eased;
    };

    const timeoutId = window.setTimeout(() => {
      const start = performance.now();

      const animate = (time: number) => {
        if (userInteractedRef.current) {
          return;
        }

        const progress = Math.min((time - start) / duration, 1);
        setPosition(interpolate(progress));

        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(animate);
        } else {
          setPosition(50);
        }
      };

      animationFrameRef.current = requestAnimationFrame(animate);
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const handleManualPositionChange = (value: number) => {
    userInteractedRef.current = true;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    setPosition(value);
  };

  return (
    <div className="relative mx-auto w-full max-w-[520px] overflow-hidden rounded-lg border border-[#e2e5e8] bg-[#eef1f3] shadow-[0_12px_30px_rgba(24,35,45,0.10)]">
      <div className="relative aspect-[4/5] w-full overflow-hidden">
        <Image
          src="/photo-after.jpg"
          alt="Restored wedding portrait"
          fill
          priority
          sizes="(min-width: 1024px) 48vw, 100vw"
          className="object-cover"
        />

        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          aria-hidden="true"
        >
          <Image
            src="/photo-before.png"
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 48vw, 100vw"
            className="object-cover"
          />
        </div>

        <div
          className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_0_1px_rgba(35,23,21,0.12)]"
          style={{ left: `${position}%` }}
        >
          <div className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#231715] shadow-[0_8px_24px_rgba(35,23,21,0.18)]">
            <ChevronsLeftRight aria-hidden="true" className="h-5 w-5" />
          </div>
        </div>

        <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-[#231715]/72 px-3 py-1 text-xs font-semibold uppercase text-white backdrop-blur">
          Before
        </div>
        <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-full bg-white/84 px-3 py-1 text-xs font-semibold uppercase text-[#231715] backdrop-blur">
          After
        </div>

        <input
          type="range"
          min="0"
          max="100"
          value={position}
          aria-label="Compare damaged photo and restored photo"
          onPointerDown={() => {
            userInteractedRef.current = true;
          }}
          onKeyDown={() => {
            userInteractedRef.current = true;
          }}
          onInput={(event) =>
            handleManualPositionChange(Number(event.currentTarget.value))
          }
          onChange={(event) =>
            handleManualPositionChange(Number(event.currentTarget.value))
          }
          className="before-after-range absolute inset-0 z-30 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
    </div>
  );
}
