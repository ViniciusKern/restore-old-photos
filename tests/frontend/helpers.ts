export function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export const restorationId = "32fae5e0-a83f-4b13-a23d-a75fdba4c9f5";
export function checkoutRecord() {
  return { restorationId, sessionId: "cs_test_order", clientSecret: "test-secret", croppedPhoto: new Blob(["cropped"], { type: "image/jpeg" }) };
}
