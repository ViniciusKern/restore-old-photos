import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StripeCheckout } from "@/app/_components/restore/stripe-checkout";
import { saveCheckout } from "@/app/_components/restore/local-checkout";
import { useRouter } from "next/navigation";
import { checkoutRecord, deferred, jsonResponse, restorationId } from "./helpers";

jest.mock("next/navigation", () => ({ useRouter: jest.fn() }));
jest.mock("@/app/_components/restore/local-checkout", () => ({ saveCheckout: jest.fn() }));

const record = checkoutRecord();
const fetchMock = jest.mocked(fetch);
const replace = jest.fn();
const confirm = jest.fn();
const handlers: Record<string, (event?: unknown) => unknown> = {};
const form = { on: jest.fn((name, handler) => { handlers[name] = handler; }), mount: jest.fn(), destroy: jest.fn() };
const sdk = { loadActions: jest.fn(), createForm: jest.fn(() => form) };
const stripe = { initCheckoutFormSdk: jest.fn(() => sdk) };
const originalKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

beforeEach(() => {
  for (const event of Object.keys(handlers)) delete handlers[event];
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fake";
  jest.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>);
  jest.mocked(saveCheckout).mockResolvedValue(undefined);
  confirm.mockReset().mockResolvedValue({ type: "success" });
  sdk.loadActions.mockReset().mockResolvedValue({ type: "success", actions: { confirm } });
  Object.defineProperty(window, "Stripe", { configurable: true, writable: true, value: jest.fn(() => stripe) });
  fetchMock.mockResolvedValueOnce(jsonResponse({ session_id: record.sessionId, client_secret: record.clientSecret, restoration_id: restorationId }))
    .mockResolvedValue(jsonResponse({ status: "pending" }));
});
afterEach(() => {
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = originalKey;
  delete window.Stripe;
});

async function ready() {
  await waitFor(() => expect(form.mount).toHaveBeenCalledTimes(1));
  await act(async () => { handlers.ready(); });
}

test("creates one checkout under Strict Mode, saves the local photo, and mounts the form", async () => {
  const { unmount } = render(<StrictMode><StripeCheckout croppedPhoto={record.croppedPhoto} onBack={jest.fn()} /></StrictMode>);
  await ready();
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/create-checkout-session")).toHaveLength(1);
  expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
  expect(saveCheckout).toHaveBeenCalledWith(record);
  expect(stripe.initCheckoutFormSdk).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: record.clientSecret }));
  expect(sdk.createForm).toHaveBeenCalledWith({ layout: "expanded" });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  unmount();
  expect(form.destroy).toHaveBeenCalledTimes(1);
});

test("missing Stripe configuration shows an error without calling the API", async () => {
  delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  render(<StripeCheckout croppedPhoto={record.croppedPhoto} onBack={jest.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Checkout is not available yet");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("already-approved payment redirects to its order without mounting a new payment form", async () => {
  fetchMock.mockReset().mockResolvedValueOnce(jsonResponse({ session_id: record.sessionId, client_secret: record.clientSecret, restoration_id: restorationId }))
    .mockResolvedValueOnce(jsonResponse({ status: "approved" }));
  render(<StripeCheckout croppedPhoto={record.croppedPhoto} onBack={jest.fn()} />);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(`/restore/${restorationId}`));
  expect(form.mount).not.toHaveBeenCalled();
});

test("declined confirmation keeps the form and displays the Stripe error", async () => {
  confirm.mockResolvedValue({ type: "error", error: { message: "Your card was declined." } });
  render(<StripeCheckout croppedPhoto={record.croppedPhoto} onBack={jest.fn()} />);
  await ready();
  await act(async () => { await handlers.confirm({ type: "confirm" }); });
  expect(screen.getByRole("alert")).toHaveTextContent("Your card was declined.");
  expect(replace).not.toHaveBeenCalled();
  expect(form.destroy).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Back to photo" })).toBeEnabled();
});

test("double confirm is ignored and navigation is disabled until confirmation finishes", async () => {
  const pending = deferred<{ type: string }>();
  confirm.mockReturnValue(pending.promise);
  render(<StripeCheckout croppedPhoto={record.croppedPhoto} onBack={jest.fn()} />);
  await ready();
  act(() => { void handlers.confirm({}); void handlers.confirm({}); });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Back to photo" })).toBeDisabled();
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ redirect: "if_required", returnUrl: `${window.location.origin}/restore/${restorationId}` }));
  await act(async () => { pending.resolve({ type: "success" }); });
  expect(replace).toHaveBeenCalledWith(`/restore/${restorationId}`);
  expect(screen.getByRole("status")).toHaveTextContent("Opening your restoration");
  expect(form.destroy).toHaveBeenCalledTimes(1);
});

test("form-load retry reuses the existing checkout instead of creating another", async () => {
  render(<StripeCheckout croppedPhoto={record.croppedPhoto} onBack={jest.fn()} />);
  await ready();
  act(() => { handlers.loaderror(); });
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(form.mount).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/create-checkout-session")).toHaveLength(1);
  expect(form.destroy).toHaveBeenCalledTimes(1);
});

test("back button returns to the photo before payment confirmation", async () => {
  const onBack = jest.fn();
  render(<StripeCheckout croppedPhoto={record.croppedPhoto} onBack={onBack} />);
  await ready();
  await userEvent.setup().click(screen.getByRole("button", { name: "Back to photo" }));
  expect(onBack).toHaveBeenCalledTimes(1);
});
