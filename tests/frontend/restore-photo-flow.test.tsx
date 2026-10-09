import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RestorePhotoFlow } from "@/app/_components/restore/restore-photo-flow";
import { cropPhoto } from "@/app/_components/restore/crop-photo";
import { StripeCheckout } from "@/app/_components/restore/stripe-checkout";
import { deferred } from "./helpers";

jest.mock("@/app/_components/restore/crop-photo", () => ({ cropPhoto: jest.fn() }));
jest.mock("@/app/_components/restore/stripe-checkout", () => ({ StripeCheckout: jest.fn(() => <div>Checkout form</div>) }));

beforeEach(() => { jest.mocked(cropPhoto).mockResolvedValue(new Blob(["crop"], { type: "image/jpeg" })); });
afterEach(() => { jest.useRealTimers(); });

async function selectPhoto(container: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!, new File(["image"], "photo.jpg", { type: "image/jpeg" }));
  await screen.findByRole("img", { name: "Selected photo" });
}

test("starts at selection without creating a checkout or uploading a photo", () => {
  render(<RestorePhotoFlow />);
  expect(screen.getByRole("button", { name: /Upload a photo/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Take a photo/ })).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "Selected photo" })).not.toBeInTheDocument();
  expect(StripeCheckout).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test("selection opens crop; continuing prepares the local crop before checkout", async () => {
  const user = userEvent.setup();
  const { container } = render(<RestorePhotoFlow />);
  await selectPhoto(container, user);
  expect(screen.getByText("Crop your photo")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rotate clockwise" })).toHaveTextContent("Rotate");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByText("Checkout form")).toBeInTheDocument();
  expect(cropPhoto).toHaveBeenCalledTimes(1);
  expect(jest.mocked(StripeCheckout).mock.calls[0][0].croppedPhoto).toBe(await jest.mocked(cropPhoto).mock.results[0].value);
  expect(fetch).not.toHaveBeenCalled();
});

test("crop errors keep the selected photo and allow trying again", async () => {
  jest.mocked(cropPhoto).mockRejectedValueOnce(new Error("Invalid crop corners"));
  const user = userEvent.setup();
  const { container } = render(<RestorePhotoFlow />);
  await selectPhoto(container, user);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid crop corners");
  expect(screen.getByRole("img", { name: "Selected photo" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  expect(StripeCheckout).not.toHaveBeenCalled();
});

test("rotating preserves an adjusted crop instead of resetting it", async () => {
  const user = userEvent.setup();
  const { container } = render(<RestorePhotoFlow />);
  await selectPhoto(container, user);
  const frame = screen.getByRole("img", { name: "Selected photo" }).parentElement!;
  jest.spyOn(frame, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100, toJSON: () => ({}) });
  fireEvent.pointerDown(screen.getByRole("button", { name: "Move top left crop corner" }), { pointerId: 1, clientX: 20, clientY: 30 });
  fireEvent.pointerUp(frame);
  jest.spyOn(window, "Image").mockImplementation(() => {
    const image = document.createElement("img");
    Object.defineProperties(image, {
      naturalWidth: { value: 100 }, naturalHeight: { value: 100 },
      src: { set: () => queueMicrotask(() => image.onload?.(new Event("load"))) },
    });
    return image;
  });
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ translate: jest.fn(), rotate: jest.fn(), drawImage: jest.fn() } as unknown as CanvasRenderingContext2D);
  jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,cm90YXRlZA==");
  jest.useFakeTimers();
  await userEvent.setup({ advanceTimers: jest.advanceTimersByTime }).click(screen.getByRole("button", { name: "Rotate clockwise" }));
  expect(screen.getByRole("button", { name: "Rotate clockwise" })).toBeDisabled();
  await act(async () => { await jest.advanceTimersByTimeAsync(230); });
  const corner = screen.getByRole("button", { name: "Move top right crop corner" });
  expect(parseFloat(corner.style.left)).toBeCloseTo(70);
  expect(parseFloat(corner.style.top)).toBeCloseTo(20);
  expect(screen.getByRole("button", { name: "Rotate clockwise" })).toBeEnabled();
});

test("disables actions while preparing a paid replacement", async () => {
  const pending = deferred<void>();
  const onPrepared = jest.fn(() => pending.promise);
  const onCancel = jest.fn();
  const user = userEvent.setup();
  const { container } = render(<RestorePhotoFlow onPrepared={onPrepared} onCancel={onCancel} />);
  await selectPhoto(container, user);
  await user.click(screen.getByRole("button", { name: "Restore photo" }));
  await waitFor(() => expect(onPrepared).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Preparing photo..." })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Rotate clockwise" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Replace photo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retake photo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel photo change" })).toBeDisabled();
  expect(StripeCheckout).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(); });
});

test("camera denial shows upload fallback and disables capture", async () => {
  const getUserMedia = jest.fn().mockRejectedValue(new Error("Permission denied"));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  render(<RestorePhotoFlow />);
  await userEvent.setup().click(screen.getByRole("button", { name: /Take a photo/ }));
  expect(await screen.findByText("Camera unavailable")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Capture photo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Upload a photo" })).toBeInTheDocument();
  expect(screen.getByText("OR")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Back to photo selection" })).not.toBeInTheDocument();
});

test("stops camera tracks if permission resolves after the component unmounts", async () => {
  const pending = deferred<MediaStream>();
  const stop = jest.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: jest.fn(() => pending.promise) } });
  const { unmount } = render(<RestorePhotoFlow />);
  await userEvent.setup().click(screen.getByRole("button", { name: /Take a photo/ }));
  unmount();
  await act(async () => { pending.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream); });
  expect(stop).toHaveBeenCalledTimes(1);
});
