"use client";

/* eslint-disable @next/next/no-img-element */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";

export type CropPoint = {
  x: number;
  y: number;
};

export type CropQuad = {
  topLeft: CropPoint;
  topRight: CropPoint;
  bottomRight: CropPoint;
  bottomLeft: CropPoint;
};

type CropHandle =
  | "topLeft"
  | "top"
  | "topRight"
  | "right"
  | "bottomRight"
  | "bottom"
  | "bottomLeft"
  | "left";

type PhotoCropperProps = {
  imageSrc: string;
  cropQuad: CropQuad;
  onCropChange: (cropQuad: CropQuad) => void;
  isRotating?: boolean;
};

const minimumCropSpan = 0.08;

const handleLabels: Record<CropHandle, string> = {
  topLeft: "Move top left crop corner",
  top: "Move top crop edge",
  topRight: "Move top right crop corner",
  right: "Move right crop edge",
  bottomRight: "Move bottom right crop corner",
  bottom: "Move bottom crop edge",
  bottomLeft: "Move bottom left crop corner",
  left: "Move left crop edge",
};

export function PhotoCropper({
  imageSrc,
  cropQuad,
  onCropChange,
  isRotating = false,
}: PhotoCropperProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [activeHandle, setActiveHandle] = useState<CropHandle | null>(null);

  function handlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    handle: CropHandle,
  ) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveHandle(handle);
    moveHandle(handle, event.clientX, event.clientY);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activeHandle) {
      return;
    }

    moveHandle(activeHandle, event.clientX, event.clientY);
  }

  function stopDrag() {
    setActiveHandle(null);
  }

  function moveHandle(handle: CropHandle, clientX: number, clientY: number) {
    const rect = frameRef.current?.getBoundingClientRect();

    if (!rect || rect.width === 0 || rect.height === 0) {
      return;
    }

    const point = {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };

    onCropChange(moveCropHandle(cropQuad, handle, point));
  }

  const handles = getHandles(cropQuad);
  const polygonPoints = [
    cropQuad.topLeft,
    cropQuad.topRight,
    cropQuad.bottomRight,
    cropQuad.bottomLeft,
  ]
    .map((point) => `${point.x * 100},${point.y * 100}`)
    .join(" ");
  const cutoutPath = `M0,0 H100 V100 H0 Z M ${cropQuad.topLeft.x * 100},${
    cropQuad.topLeft.y * 100
  } L ${cropQuad.topRight.x * 100},${cropQuad.topRight.y * 100} L ${
    cropQuad.bottomRight.x * 100
  },${cropQuad.bottomRight.y * 100} L ${cropQuad.bottomLeft.x * 100},${
    cropQuad.bottomLeft.y * 100
  } Z`;

  return (
    <div
      className={`mx-auto flex w-full justify-center overflow-hidden rounded-lg bg-[#252a2e] p-2 transition duration-300 ease-out ${
        isRotating ? "scale-[0.96]" : "scale-100"
      }`}
    >
      <div
        className={`relative max-w-full touch-none overflow-hidden rounded bg-black transition duration-300 ease-out ${
          isRotating ? "rotate-90 opacity-90" : "rotate-0 opacity-100"
        }`}
        ref={frameRef}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <img
          src={imageSrc}
          alt="Selected photo"
          className="block max-h-[48svh] max-w-full select-none md:max-h-[60vh]"
          draggable={false}
        />

        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
        >
          <path d={cutoutPath} fill="rgba(0,0,0,0.46)" fillRule="evenodd" />
          <polygon
            fill="none"
            points={polygonPoints}
            stroke="#d84b38"
            strokeLinejoin="round"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {handles.map(({ handle, point, cursor }) => (
          <button
            aria-label={handleLabels[handle]}
            className={`absolute grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition ${
              activeHandle === handle ? "scale-110" : "scale-100"
            } ${cursor}`}
            key={handle}
            onPointerDown={(event) => handlePointerDown(event, handle)}
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            type="button"
          >
            <span className="h-6 w-6 rounded-full border-2 border-[#d84b38] bg-white shadow-[0_5px_16px_rgba(0,0,0,0.28)] ring-4 ring-white/18" />
          </button>
        ))}
      </div>
    </div>
  );
}

function moveCropHandle(
  cropQuad: CropQuad,
  handle: CropHandle,
  point: CropPoint,
): CropQuad {
  const next: CropQuad = {
    topLeft: { ...cropQuad.topLeft },
    topRight: { ...cropQuad.topRight },
    bottomRight: { ...cropQuad.bottomRight },
    bottomLeft: { ...cropQuad.bottomLeft },
  };

  switch (handle) {
    case "topLeft":
      next.topLeft = {
        x: clamp(point.x, 0, next.topRight.x - minimumCropSpan),
        y: clamp(point.y, 0, next.bottomLeft.y - minimumCropSpan),
      };
      break;
    case "topRight":
      next.topRight = {
        x: clamp(point.x, next.topLeft.x + minimumCropSpan, 1),
        y: clamp(point.y, 0, next.bottomRight.y - minimumCropSpan),
      };
      break;
    case "bottomRight":
      next.bottomRight = {
        x: clamp(point.x, next.bottomLeft.x + minimumCropSpan, 1),
        y: clamp(point.y, next.topRight.y + minimumCropSpan, 1),
      };
      break;
    case "bottomLeft":
      next.bottomLeft = {
        x: clamp(point.x, 0, next.bottomRight.x - minimumCropSpan),
        y: clamp(point.y, next.topLeft.y + minimumCropSpan, 1),
      };
      break;
    case "top": {
      const y = clamp(
        point.y,
        0,
        Math.min(next.bottomLeft.y, next.bottomRight.y) - minimumCropSpan,
      );
      next.topLeft.y = y;
      next.topRight.y = y;
      break;
    }
    case "right": {
      const x = clamp(
        point.x,
        Math.max(next.topLeft.x, next.bottomLeft.x) + minimumCropSpan,
        1,
      );
      next.topRight.x = x;
      next.bottomRight.x = x;
      break;
    }
    case "bottom": {
      const y = clamp(
        point.y,
        Math.max(next.topLeft.y, next.topRight.y) + minimumCropSpan,
        1,
      );
      next.bottomLeft.y = y;
      next.bottomRight.y = y;
      break;
    }
    case "left": {
      const x = clamp(
        point.x,
        0,
        Math.min(next.topRight.x, next.bottomRight.x) - minimumCropSpan,
      );
      next.topLeft.x = x;
      next.bottomLeft.x = x;
      break;
    }
  }

  return next;
}

function getHandles(cropQuad: CropQuad) {
  return [
    {
      handle: "topLeft",
      point: cropQuad.topLeft,
      cursor: "cursor-nwse-resize",
    },
    {
      handle: "top",
      point: midpoint(cropQuad.topLeft, cropQuad.topRight),
      cursor: "cursor-ns-resize",
    },
    {
      handle: "topRight",
      point: cropQuad.topRight,
      cursor: "cursor-nesw-resize",
    },
    {
      handle: "right",
      point: midpoint(cropQuad.topRight, cropQuad.bottomRight),
      cursor: "cursor-ew-resize",
    },
    {
      handle: "bottomRight",
      point: cropQuad.bottomRight,
      cursor: "cursor-nwse-resize",
    },
    {
      handle: "bottom",
      point: midpoint(cropQuad.bottomLeft, cropQuad.bottomRight),
      cursor: "cursor-ns-resize",
    },
    {
      handle: "bottomLeft",
      point: cropQuad.bottomLeft,
      cursor: "cursor-nesw-resize",
    },
    {
      handle: "left",
      point: midpoint(cropQuad.topLeft, cropQuad.bottomLeft),
      cursor: "cursor-ew-resize",
    },
  ] satisfies Array<{
    handle: CropHandle;
    point: CropPoint;
    cursor: string;
  }>;
}

function midpoint(first: CropPoint, second: CropPoint): CropPoint {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
