"use client";

import Image from "next/image";
import {
  ArrowRight,
  Camera,
  Check,
  Crop,
  ImagePlus,
  LoaderCircle,
  RotateCw,
  Upload,
  UserRound,
} from "lucide-react";
import {
  ChangeEvent,
  ReactNode,
  RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { CropQuad, PhotoCropper, rotateCropQuadClockwise } from "./photo-cropper";
import { StripeCheckout } from "./stripe-checkout";
import { FlowHeader } from "./flow-header";

const standardCropQuad: CropQuad = {
  topLeft: { x: 0.08, y: 0.08 },
  topRight: { x: 0.92, y: 0.08 },
  bottomRight: { x: 0.92, y: 0.92 },
  bottomLeft: { x: 0.08, y: 0.92 },
};

type FlowStep = "select" | "camera" | "crop" | "checkout";
type CameraStatus = "idle" | "starting" | "ready" | "error";

export function RestorePhotoFlow() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraFallbackInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [step, setStep] = useState<FlowStep>("select");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [cropQuad, setCropQuad] = useState<CropQuad>(standardCropQuad);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraError, setCameraError] = useState("");
  const [isRotating, setIsRotating] = useState(false);
  const [croppedPhoto, setCroppedPhoto] = useState<Blob | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");

  async function prepareCheckout() {
    if (!imageSrc || isPreparing) return;
    setIsPreparing(true);
    setPrepareError("");
    try {
      const { cropPhoto } = await import("./crop-photo");
      setCroppedPhoto(await cropPhoto(imageSrc, cropQuad));
      setStep("checkout");
    } catch (error) {
      setPrepareError(
        error instanceof Error
          ? error.message
          : "We could not prepare your photo.",
      );
    } finally {
      setIsPreparing(false);
    }
  }

  function stopCameraStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (step !== "camera") {
      stopCameraStream();
      return;
    }

    let isCancelled = false;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStatus("error");
        setCameraError(
          "This browser cannot access your camera. Choose a saved photo or try your device's camera.",
        );
        return;
      }

      setCameraStatus("starting");
      setCameraError("");

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
          },
        });

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        setCameraStatus("ready");

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setCameraStatus("error");
        setCameraError(
          "Allow camera access in your browser settings, or choose a saved photo to continue.",
        );
      }
    }

    startCamera();

    return () => {
      isCancelled = true;
      stopCameraStream();
    };
  }, [step]);

  function selectImageFromInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        return;
      }

      setImageSrc(reader.result);
      setCropQuad(standardCropQuad);
      setStep("crop");
      event.target.value = "";
    };

    reader.readAsDataURL(file);
  }

  function capturePhoto() {
    const video = videoRef.current;

    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError("The camera is not ready yet. Try again in a moment.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      setCameraError("We could not capture this frame. Please try again.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setImageSrc(canvas.toDataURL("image/jpeg", 0.96));
    setCropQuad(standardCropQuad);
    setStep("crop");
  }

  function replaceWithUpload() {
    fileInputRef.current?.click();
  }

  function takeAnotherPhoto() {
    setStep("camera");
  }

  async function rotatePhotoClockwise() {
    if (!imageSrc || isRotating) {
      return;
    }

    setIsRotating(true);

    window.setTimeout(async () => {
      try {
        const rotated = await rotateImageSource(imageSrc);
        setImageSrc(rotated);
        setCropQuad(rotateCropQuadClockwise);
      } catch {
        setPrepareError("We could not rotate your photo. Please try again.");
      } finally {
        setIsRotating(false);
      }
    }, 230);
  }

  return (
    <main className="min-h-screen bg-[#f8f9fa] text-[#242729]">
      <input
        accept="image/*"
        className="hidden"
        onChange={selectImageFromInput}
        ref={fileInputRef}
        type="file"
      />
      <input
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={selectImageFromInput}
        ref={cameraFallbackInputRef}
        type="file"
      />

      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <FlowHeader step={step} />

        {step === "select" ? (
          <SelectPhotoStep
            onCamera={() => setStep("camera")}
            onUpload={replaceWithUpload}
          />
        ) : null}

        {step === "camera" ? (
          <CameraStep
            cameraError={cameraError}
            cameraFallbackInputRef={cameraFallbackInputRef}
            cameraStatus={cameraStatus}
            onCapture={capturePhoto}
            onUpload={replaceWithUpload}
            videoRef={videoRef}
          />
        ) : null}

        {step === "crop" && imageSrc ? (
          <CropStep
            cropQuad={cropQuad}
            imageSrc={imageSrc}
            isRotating={isRotating}
            isPreparing={isPreparing}
            onCamera={takeAnotherPhoto}
            onContinue={prepareCheckout}
            onCropChange={(quad) => {
              if (!isPreparing && !isRotating) setCropQuad(quad);
            }}
            onRotate={rotatePhotoClockwise}
            onUpload={replaceWithUpload}
          />
        ) : null}
        {prepareError ? (
          <p role="alert" className="text-center text-sm text-red-700">
            {prepareError}
          </p>
        ) : null}
        {step === "checkout" && croppedPhoto ? (
          <StripeCheckout
            croppedPhoto={croppedPhoto}
            onBack={() => setStep("crop")}
          />
        ) : null}
      </div>
    </main>
  );
}

function SelectPhotoStep({
  onCamera,
  onUpload,
}: {
  onCamera: () => void;
  onUpload: () => void;
}) {
  return (
    <section className="restore-panel-in mx-auto grid w-full max-w-5xl flex-1 content-center gap-10 py-10 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-20 lg:py-16">
      <div className="max-w-lg">
        <p className="flex items-center gap-2 text-sm font-medium text-[#267369]">
          <ImagePlus className="h-4 w-4" aria-hidden="true" /> Choose a photo to
          restore
        </p>
        <p className="mt-4 text-base leading-7 text-[#677078]">
          Choose a saved photo or scan, or take a picture of an old print. You
          can adjust the crop before continuing.
        </p>

        <div className="mt-7 space-y-3">
          <SourceOptionButton
            description="Select a saved photo or scan from your device."
            icon={<Upload className="h-5 w-5" aria-hidden="true" />}
            onClick={onUpload}
            title="Upload a photo"
          />

          <SourceOptionButton
            description="Use your camera to photograph an old print."
            icon={<Camera className="h-5 w-5" aria-hidden="true" />}
            onClick={onCamera}
            title="Take a photo"
          />
        </div>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[#677078]">
          <span className="flex items-center gap-1.5">
            <UserRound className="h-3.5 w-3.5" aria-hidden="true" /> No account
            required
          </span>
        </div>
      </div>

      <figure className="mx-auto hidden w-full max-w-sm md:block lg:max-w-none">
        <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-[#e2e5e8] shadow-[0_12px_30px_rgba(24,35,45,0.10)]">
          <Image
            alt="Restored wedding portrait"
            className="object-cover"
            fill
            sizes="(min-width: 1024px) 420px, 90vw"
            src="/photo-after.jpg"
          />
          <div className="absolute inset-0 w-1/2 overflow-hidden border-r-2 border-white">
            <Image
              alt="Original damaged wedding portrait"
              className="h-full max-w-none object-cover"
              height={1402}
              src="/photo-before.png"
              width={1122}
              style={{ width: "200%" }}
            />
          </div>
          <span className="absolute bottom-3 left-3 rounded bg-black/65 px-2.5 py-1 text-xs font-medium text-white">
            Before
          </span>
          <span className="absolute bottom-3 right-3 rounded bg-white/90 px-2.5 py-1 text-xs font-medium text-[#242729]">
            After
          </span>
        </div>
        <figcaption className="mt-3 text-center text-xs text-[#677078]">
          Restoration example
        </figcaption>
      </figure>
    </section>
  );
}

function CameraStep({
  cameraError,
  cameraFallbackInputRef,
  cameraStatus,
  onCapture,
  onUpload,
  videoRef,
}: {
  cameraError: string;
  cameraFallbackInputRef: RefObject<HTMLInputElement | null>;
  cameraStatus: CameraStatus;
  onCapture: () => void;
  onUpload: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  return (
    <section className="restore-panel-in flex flex-1 flex-col py-8">
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
        <div className="relative overflow-hidden rounded-xl border border-[#e8dfdb] bg-black shadow-[0_24px_70px_rgba(35,23,21,0.18)]">
          {cameraStatus === "error" ? (
            <div className="grid min-h-[420px] place-items-center px-8 text-center text-white">
              <div>
                <p className="text-lg font-bold">Camera unavailable</p>
                <p className="mt-3 max-w-md text-sm leading-6 text-white/72">
                  {cameraError}
                </p>
                <button
                  className="button-secondary mt-6"
                  onClick={() => cameraFallbackInputRef.current?.click()}
                  type="button"
                >
                  <Camera aria-hidden="true" />
                  Use device camera
                </button>
              </div>
            </div>
          ) : (
            <>
              <video
                autoPlay
                className="aspect-[4/3] h-full min-h-[420px] w-full object-cover"
                muted
                playsInline
                ref={videoRef}
              />
              <div className="pointer-events-none absolute inset-5 rounded-[10px] border-2 border-white/62" />
              <div className="pointer-events-none absolute bottom-5 left-5 rounded-full bg-black/56 px-3 py-1.5 text-xs font-bold text-white/88 backdrop-blur">
                Keep the print inside the frame
              </div>
            </>
          )}
        </div>

        <div className="py-5 lg:pl-2">
          <p className="text-sm font-medium text-[#267369]">Camera</p>
          <p className="mt-4 text-sm leading-6 text-[#6e625d]">
            Place the print flat in even light and avoid glare. Include the
            whole photo in the frame.
          </p>

          <div className="mt-7 grid gap-3">
            <button
              className="button-primary"
              disabled={cameraStatus !== "ready"}
              onClick={onCapture}
              type="button"
            >
              {cameraStatus === "starting" ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Camera aria-hidden="true" />
              )}
              {cameraStatus === "starting"
                ? "Starting camera..."
                : "Capture photo"}
            </button>
            <div className="flex items-center gap-3 py-1 text-xs text-[#677078]">
              <span className="h-px flex-1 bg-[#e2e5e8]" aria-hidden="true" />
              <span>OR</span>
              <span className="h-px flex-1 bg-[#e2e5e8]" aria-hidden="true" />
            </div>
            <button
              className="button-secondary"
              onClick={onUpload}
              type="button"
            >
              <Upload aria-hidden="true" />
              Upload a photo
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function CropStep({
  cropQuad,
  imageSrc,
  isRotating,
  isPreparing,
  onCamera,
  onContinue,
  onCropChange,
  onRotate,
  onUpload,
}: {
  cropQuad: CropQuad;
  imageSrc: string;
  isRotating: boolean;
  isPreparing: boolean;
  onCamera: () => void;
  onContinue: () => void;
  onCropChange: (cropQuad: CropQuad) => void;
  onRotate: () => void;
  onUpload: () => void;
}) {
  return (
    <section className="restore-panel-in flex flex-1 flex-col py-6">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-[#267369]">
              <Crop className="h-4 w-4" aria-hidden="true" /> Crop your photo
            </p>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-[#6e625d]">
              Select the area you want restored.
            </p>
          </div>

          <div className="flex gap-2">
            <ToolButton
              disabled={isRotating || isPreparing}
              onClick={onRotate}
              label="Rotate clockwise"
            >
              <RotateCw aria-hidden="true" />
              Rotate
            </ToolButton>
          </div>
        </div>

        <PhotoCropper
          cropQuad={cropQuad}
          imageSrc={imageSrc}
          isRotating={isRotating}
          onCropChange={onCropChange}
        />

        <div className="mt-5 grid gap-3 rounded-lg border border-[#e2e5e8] bg-white/95 p-3 shadow-[0_8px_24px_rgba(24,35,45,0.08)] backdrop-blur md:sticky md:bottom-4 md:grid-cols-[1fr_auto] md:items-center">
          <div className="grid grid-cols-2 gap-2 md:flex">
            <ToolButton disabled={isPreparing || isRotating} onClick={onUpload}>
              <Upload aria-hidden="true" /> Replace photo
            </ToolButton>
            <ToolButton disabled={isPreparing || isRotating} onClick={onCamera}>
              <Camera aria-hidden="true" /> Retake photo
            </ToolButton>
          </div>

          <button
            className="button-primary"
            disabled={isRotating || isPreparing}
            onClick={onContinue}
            type="button"
          >
            {isPreparing ? "Preparing photo..." : "Continue"}
            {isPreparing ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </section>
  );
}

function SourceOptionButton({
  description,
  icon,
  onClick,
  title,
}: {
  description: string;
  icon: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className="group grid w-full min-h-24 grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-4 rounded-lg border border-[#e2e5e8] bg-white p-4 text-left shadow-[0_2px_4px_rgba(24,35,45,0.02)] transition duration-200 hover:border-[#d84b38] hover:bg-[#fffaf8]"
      onClick={onClick}
      type="button"
    >
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#f3f5f6] text-[#677078] transition group-hover:bg-[#fff0eb] group-hover:text-[#d84b38]">
        {icon}
      </span>
      <span>
        <span className="block text-base font-semibold text-[#242729]">
          {title}
        </span>
        <span className="mt-1 block text-sm leading-5 text-[#677078]">
          {description}
        </span>
      </span>
      <ArrowRight
        className="h-4 w-4 text-[#9aa2a8] transition group-hover:text-[#d84b38]"
        aria-hidden="true"
      />
    </button>
  );
}

function ToolButton({
  children,
  disabled = false,
  onClick,
  label,
  iconOnly = false,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  label?: string;
  iconOnly?: boolean;
}) {
  return (
    <button
      className={iconOnly ? "icon-control" : "button-secondary"}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
      {iconOnly && label ? (
        <span className="control-tooltip" aria-hidden="true">
          {label}
        </span>
      ) : null}
    </button>
  );
}

async function rotateImageSource(imageSrc: string) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalHeight;
  canvas.height = image.naturalWidth;

  const context = canvas.getContext("2d");

  if (!context) {
    return imageSrc;
  }

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

  return canvas.toDataURL("image/jpeg", 0.96);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
