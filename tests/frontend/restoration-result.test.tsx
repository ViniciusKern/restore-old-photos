import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RestorationResult } from "@/app/_components/restore/restoration-result";
import { saveCheckout } from "@/app/_components/restore/local-checkout";
import { cropPhoto } from "@/app/_components/restore/crop-photo";
import { StripeCheckout } from "@/app/_components/restore/stripe-checkout";
import { checkoutRecord, deferred, jsonResponse } from "./helpers";

jest.mock("@/app/_components/restore/local-checkout", () => ({ saveCheckout: jest.fn() }));
jest.mock("@/app/_components/restore/crop-photo", () => ({ cropPhoto: jest.fn() }));
jest.mock("@/app/_components/restore/stripe-checkout", () => ({ StripeCheckout: jest.fn(() => <div>Unexpected checkout</div>) }));

const failed = {
  status: "failed", attemptId: "attempt1", canRetry: true, canReplace: true, attemptsRemaining: 2,
  error: { message: "The restoration was interrupted. Please try again.", code: "E1000" },
};
const processing = { status: "processing", canRetry: false, canReplace: false, attemptsRemaining: 1 };
const fetchMock = jest.mocked(fetch);
const record = checkoutRecord();
const props = { id: record.sessionId, restorationId: record.restorationId, secret: record.clientSecret, croppedPhoto: record.croppedPhoto };

beforeEach(() => {
  jest.mocked(saveCheckout).mockResolvedValue(undefined);
  jest.mocked(cropPhoto).mockResolvedValue(new Blob(["new crop"], { type: "image/jpeg" }));
});
afterEach(() => { jest.useRealTimers(); });

test("sends the cropped photo with authorization and shows progress", async () => {
  fetchMock.mockResolvedValue(jsonResponse(processing));
  render(<RestorationResult {...props} />);
  expect(screen.getByRole("heading", { name: "Restoring your photo" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Bringing your photo back to life"));
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe(`/api/restorations/${record.sessionId}`);
  expect(options?.headers).toEqual({ Authorization: `Bearer ${record.clientSecret}` });
  expect((options?.body as FormData).get("cropped_image")).toBeInstanceOf(File);
  expect((options?.body as FormData).get("action")).toBeNull();
});

test("shows failure details, permitted actions and remaining attempts", async () => {
  fetchMock.mockResolvedValue(jsonResponse(failed));
  render(<RestorationResult {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(failed.error.message);
  expect(screen.getByText("Error code: E1000")).toBeInTheDocument();
  expect(screen.getByText(/2 attempts remaining/)).toHaveTextContent("You will not be charged again");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Use another photo" })).toBeInTheDocument();
});

test("double clicking retry submits only one action for the failed attempt", async () => {
  const pending = deferred<Response>();
  fetchMock.mockResolvedValueOnce(jsonResponse(failed)).mockReturnValueOnce(pending.promise);
  render(<RestorationResult {...props} />);
  await userEvent.setup().dblClick(await screen.findByRole("button", { name: "Try again" }));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const body = fetchMock.mock.calls[1][1]?.body as FormData;
  expect(body.get("action")).toBe("retry");
  expect(body.get("expected_attempt_id")).toBe("attempt1");
  expect(body.get("cropped_image")).toBeNull();
  await act(async () => { pending.resolve(jsonResponse(processing)); });
});

test("uses the real selection and crop UI to replace the photo without checkout", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(failed)).mockResolvedValue(jsonResponse(processing));
  const user = userEvent.setup();
  const { container } = render(<RestorationResult {...props} />);
  await user.click(await screen.findByRole("button", { name: "Use another photo" }));
  expect(screen.getByText(/This photo will use your existing payment/)).toBeInTheDocument();
  const input = container.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!;
  await user.upload(input, new File(["replacement"], "photo.jpg", { type: "image/jpeg" }));
  expect(await screen.findByRole("img", { name: "Selected photo" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Restore photo" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(saveCheckout).toHaveBeenCalledWith({ ...record, croppedPhoto: await jest.mocked(cropPhoto).mock.results[0].value });
  const body = fetchMock.mock.calls[1][1]?.body as FormData;
  expect(body.get("action")).toBe("replace");
  expect(body.get("expected_attempt_id")).toBe("attempt1");
  expect(body.get("cropped_image")).toBeInstanceOf(File);
  expect(StripeCheckout).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("checkout"))).toBe(true);
});

test("canceling a photo change checks the existing order without starting a retry", async () => {
  fetchMock.mockResolvedValue(jsonResponse(failed));
  const user = userEvent.setup();
  render(<RestorationResult {...props} />);
  await user.click(await screen.findByRole("button", { name: "Use another photo" }));
  await user.click(screen.getByRole("button", { name: "Cancel photo change" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(failed.error.message);
  expect((fetchMock.mock.calls[1][1]?.body as FormData).get("action")).toBeNull();
  expect(saveCheckout).not.toHaveBeenCalled();
});

test.each([
  ["photo", "failed", false, true],
  ["configuration", "failed", false, false],
  ["limit", "failed", false, false],
  ["ambiguous", "needs_attention", false, false],
])("respects server action permissions for %s failures", async (_, status, canRetry, canReplace) => {
  fetchMock.mockResolvedValue(jsonResponse({ ...failed, status, canRetry, canReplace }));
  render(<RestorationResult {...props} />);
  await screen.findByRole("alert");
  expect(!!screen.queryByRole("button", { name: "Try again" })).toBe(canRetry);
  expect(!!screen.queryByRole("button", { name: "Use another photo" })).toBe(canReplace);
  expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
});

test("connection errors offer a status check, not a new model execution", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(jsonResponse(processing));
  const user = userEvent.setup();
  render(<RestorationResult {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect((fetchMock.mock.calls[1][1]?.body as FormData).get("action")).toBeNull();
});

test("completed result has download links, hides payment approval, and releases its Blob URL", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ status: "complete" })).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["restored"]) } as Response);
  const { unmount } = render(<RestorationResult {...props} />);
  expect(await screen.findByRole("heading", { name: "Your photo, restored" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Your restored photo" })).toHaveAttribute("src", "blob:restored-photo");
  expect(screen.getByRole("link", { name: "Download photo" })).toHaveAttribute("download", "restored-photo");
  expect(screen.getByRole("link", { name: "Restore another photo" })).toHaveAttribute("href", "/restore");
  expect(screen.queryByText("Payment approved")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:restored-photo");
});

test("polls without reuploading and stops polling when unmounted", async () => {
  jest.useFakeTimers();
  fetchMock.mockResolvedValue(jsonResponse(processing));
  const { unmount } = render(<RestorationResult {...props} />);
  await act(async () => {});
  await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1]?.body).toBeUndefined();
  const signal = fetchMock.mock.calls[0][1]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(6000); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("renders safely under React Strict Mode effect replay", async () => {
  fetchMock.mockResolvedValue(jsonResponse(failed));
  render(<StrictMode><RestorationResult {...props} /></StrictMode>);
  expect(await screen.findByRole("alert")).toHaveTextContent(failed.error.message);
  expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1);
});
