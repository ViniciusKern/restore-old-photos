import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RestorationOrderPage } from "@/app/_components/restore/restoration-order-page";
import { readCheckout } from "@/app/_components/restore/local-checkout";
import { RestorationResult } from "@/app/_components/restore/restoration-result";
import { checkoutRecord, jsonResponse, restorationId } from "./helpers";

jest.mock("@/app/_components/restore/local-checkout", () => ({ readCheckout: jest.fn() }));
jest.mock("@/app/_components/restore/restoration-result", () => ({ RestorationResult: jest.fn(() => <div>Restoration result</div>) }));
const fetchMock = jest.mocked(fetch);

beforeEach(() => { jest.mocked(readCheckout).mockResolvedValue(checkoutRecord()); });
afterEach(() => { jest.useRealTimers(); });

test("missing local order offers a new flow without making payment requests", async () => {
  jest.mocked(readCheckout).mockResolvedValue(undefined);
  render(<RestorationOrderPage restorationId={restorationId} />);
  expect(await screen.findByRole("heading", { name: "Restoration unavailable" })).toBeInTheDocument();
  expect(screen.getByText(/Open this link in the browser where you placed the order/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Restore a new photo" })).toHaveAttribute("href", "/restore");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(RestorationResult).not.toHaveBeenCalled();
});

test("only an approved payment for this UUID opens the result", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ status: "approved", restoration_id: restorationId }));
  render(<RestorationOrderPage restorationId={restorationId} />);
  expect(await screen.findByText("Restoration result")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/checkout-status/cs_test_order", expect.objectContaining({ headers: { Authorization: "Bearer test-secret" }, cache: "no-store" }));
  expect(jest.mocked(RestorationResult).mock.calls[0][0]).toEqual(expect.objectContaining({ id: "cs_test_order", restorationId, secret: "test-secret", croppedPhoto: expect.any(Blob) }));
});

test("rejects a payment associated with a different restoration", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ status: "approved", restoration_id: "wrong-order" }));
  render(<RestorationOrderPage restorationId={restorationId} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("This payment does not belong to this restoration.");
  expect(RestorationResult).not.toHaveBeenCalled();
});

test.each([
  ["expired", "This checkout has expired"],
  ["declined", "Your payment was not approved"],
])("does not restore after a %s checkout", async (status, message) => {
  fetchMock.mockResolvedValue(jsonResponse({ status, restoration_id: restorationId }));
  render(<RestorationOrderPage restorationId={restorationId} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(RestorationResult).not.toHaveBeenCalled();
});

test("can recheck after a payment-status network error", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(jsonResponse({ status: "approved", restoration_id: restorationId }));
  render(<RestorationOrderPage restorationId={restorationId} />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Check again" }));
  expect(await screen.findByText("Restoration result")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("pending payment is polled and canceled on unmount", async () => {
  jest.useFakeTimers();
  fetchMock.mockResolvedValue(jsonResponse({ status: "pending", restoration_id: restorationId }));
  const { unmount } = render(<RestorationOrderPage restorationId={restorationId} />);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for payment confirmation");
  await act(async () => { await jest.advanceTimersByTimeAsync(2500); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const signal = fetchMock.mock.calls[0][1]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("reports browser-storage errors without trying to restore", async () => {
  jest.mocked(readCheckout).mockRejectedValue(new Error("Browser storage unavailable"));
  render(<RestorationOrderPage restorationId={restorationId} />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Browser storage unavailable"));
  expect(fetchMock).not.toHaveBeenCalled();
});
