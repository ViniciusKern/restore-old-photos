import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createHmac } from "node:crypto";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(code, { module: testModule, exports: testModule.exports, require: name => mocks[name] ?? require(name), process: { env: {} }, Buffer, Headers, Request, Response, File, AbortSignal, URL, setTimeout, ...globals });
  return testModule.exports;
}

test("photo upload is rejected before payment, without reading its body", async () => {
  let advanced = 0, read = 0;
  const route = load("app/api/restorations/[id]/route.ts", {
    "@/app/_lib/paid-session": { authorizedSession: async () => ({ payment_status: "unpaid" }) },
    "@/app/_lib/restoration": { restorationReady: () => true, advanceRestoration: () => advanced++ },
  });
  const response = await route.POST({ formData: () => { read++; } }, { params: Promise.resolve({ id: "cs_test_order" }) });
  assert.equal(response.status, 409);
  assert.equal(read, 0);
  assert.equal(advanced, 0);
});

test("readiness accepts Vercel Redis names and managed Blob authentication", () => {
  const env = { REPLICATE_API_TOKEN: "test", KV_REST_API_URL: "https://redis.example", KV_REST_API_TOKEN: "write-token", BLOB_STORE_ID: "store_example", VERCEL: "1" };
  const api = load("app/_lib/restoration.ts", { "./restoration-email": { deliverRestorationEmail: async () => {} } }, { process: { env } });
  assert.equal(api.restorationReady(), true);
  delete env.VERCEL;
  assert.equal(api.restorationReady(), false);
  env.VERCEL_OIDC_TOKEN = "local-managed-token";
  assert.equal(api.restorationReady(), true);
  delete env.VERCEL_OIDC_TOKEN;
  env.BLOB_READ_WRITE_TOKEN = "local-static-token";
  assert.equal(api.restorationReady(), true);
  delete env.KV_REST_API_TOKEN;
  env.KV_REST_API_READ_ONLY_TOKEN = "read-only-token";
  assert.equal(api.restorationReady(), false);
  env.UPSTASH_REDIS_REST_TOKEN = "write-token";
  assert.equal(api.restorationReady(), true);
  env.BLOB_READ_WRITE_TOKEN = "...";
  assert.equal(api.restorationReady(), false);
});

test("paid upload rejects invalid JPEG before persistence", async () => {
  let advanced = 0;
  const route = load("app/api/restorations/[id]/route.ts", {
    "@/app/_lib/paid-session": { authorizedSession: async () => ({ payment_status: "paid" }) },
    "@/app/_lib/restoration": { restorationReady: () => true, advanceRestoration: () => advanced++ },
  });
  const body = new FormData();
  body.append("cropped_image", new Blob(["not an image"], { type: "image/jpeg" }), "cropped.jpg");
  const response = await route.POST(new Request("http://localhost", { method: "POST", body }), { params: Promise.resolve({ id: "cs_test_order" }) });
  assert.equal(response.status, 400);
  assert.equal(advanced, 0);
});

test("session authorization checks secret, price and quantity", async () => {
  let price = "price_1UMAxvIq2iVVFbtuoqNAcjAx", quantity = 1;
  let stripeSecret = "secret";
  const credentials = new Map();
  const access = load("app/_lib/checkout-access.ts", {
    "@upstash/redis": { Redis: { fromEnv: () => ({ get: async k => credentials.get(k), set: async (k, v) => credentials.set(k, v) }) } },
  });
  class Stripe {
    checkout = { sessions: { retrieve: async () => ({ client_secret: stripeSecret, mode: "payment", line_items: { data: [{ price: { id: price }, quantity }] } }) } };
  }
  const api = load("app/_lib/paid-session.ts", { stripe: Stripe, "./checkout-access": access });
  const request = new Request("http://localhost", { headers: { Authorization: "Bearer secret" } });
  assert.ok(await api.authorizedSession("cs_test_order", request));
  stripeSecret = null;
  assert.ok(await api.authorizedSession("cs_test_order", request), "Completed sessions remain authorized with their original secret hash");
  assert.equal(await api.authorizedSession("cs_test_order", new Request("http://localhost", { headers: { Authorization: "Bearer wrong" } })), null);
  price = "price_wrong";
  assert.equal(await api.authorizedSession("cs_test_order", request), null);
  price = "price_1UMAxvIq2iVVFbtuoqNAcjAx"; quantity = 2;
  assert.equal(await api.authorizedSession("cs_test_order", request), null);
  quantity = 1;
  credentials.clear();
  assert.equal(await api.authorizedSession("cs_test_order", request), null, "Never authorize a completed session without proof of ownership");
});

test("checkout status verifies a completed payment without a Stripe client_secret", async () => {
  const route = load("app/api/checkout-status/[id]/route.ts", {
    "@/app/_lib/paid-session": { authorizedSession: async () => ({ client_secret: null, status: "complete", payment_status: "paid" }) },
  }, { process: { env: { STRIPE_SECRET_KEY: "test" } } });
  const result = await route.GET(new Request("http://localhost", { headers: { Authorization: "Bearer original-secret" } }), { params: Promise.resolve({ id: "cs_test_order" }) });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).status, "approved");
});

test("new checkouts return a UUID bound to the Stripe session", async () => {
  const { isRestorationId } = load("app/_lib/restoration-id.ts");
  let params, remembered;
  class Stripe {
    checkout = { sessions: { create: async p => { params = p; return { id: "cs_test_new", client_secret: "new-secret" }; } } };
  }
  const route = load("app/api/create-checkout-session/route.ts", {
    stripe: Stripe,
    "@/app/_lib/restoration": { restorationReady: () => true },
    "@/app/_lib/checkout-access": { rememberCheckoutAccess: async (...args) => { remembered = args; } },
  }, { process: { env: { STRIPE_SECRET_KEY: "test" } } });
  const first = await (await route.POST()).json();
  assert.equal(isRestorationId(first.restoration_id), true);
  assert.equal(params.client_reference_id, first.restoration_id);
  assert.equal(first.session_id, "cs_test_new");
  assert.equal(remembered[0], "cs_test_new");
  assert.equal(remembered[1], "new-secret");
  const second = await (await route.POST()).json();
  assert.notEqual(first.restoration_id, second.restoration_id);
});

test("browser recovery is isolated by UUID and ignores the old global active checkout", async () => {
  const ids = ["a5f1c792-a5f2-4baa-a0ee-66d3b83bb1a0", "cf76137d-0399-4656-a084-7588084a056d", "dc3c6139-49da-4cdb-9376-9a9ec428f677"];
  const stores = new Map([["checkout", new Map([["active", { sessionId: "old-session" }]])]]);
  const db = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore: name => stores.set(name, new Map()),
    close: () => {},
    transaction: name => {
      const data = stores.get(name);
      const transaction = { objectStore: () => ({
        get: id => ({ result: data.get(id) }),
        put: (value, id) => { data.set(id, value); return {}; },
      }) };
      setTimeout(() => transaction.oncomplete(), 0);
      return transaction;
    },
  };
  const api = load("app/_components/restore/local-checkout.ts", {
    "@/app/_lib/restoration-id": load("app/_lib/restoration-id.ts"),
  }, {
    indexedDB: { open: (_, version) => {
      assert.equal(version, 2);
      const request = { result: db };
      setTimeout(() => { request.onupgradeneeded(); request.onsuccess(); }, 0);
      return request;
    } },
  });
  const first = { restorationId: ids[0], sessionId: "first-session", clientSecret: "first-secret", croppedPhoto: new Blob(["first-photo"]) };
  const second = { restorationId: ids[1], sessionId: "second-session", clientSecret: "second-secret", croppedPhoto: new Blob(["second-photo"]) };
  await api.saveCheckout(first);
  await api.saveCheckout(second);
  assert.equal((await api.readCheckout(ids[0])).sessionId, first.sessionId);
  assert.equal((await api.readCheckout(ids[1])).clientSecret, second.clientSecret);
  assert.equal(await api.readCheckout(ids[2]), undefined);
  stores.get("orders").set(ids[2], first);
  assert.equal(await api.readCheckout(ids[2]), undefined, "Wrong-order records are never resumed");
  await assert.rejects(api.readCheckout("active"), /Invalid restoration link/);
  assert.ok(stores.get("checkout").has("active"), "Legacy data is not destroyed");
});

function restorationFixture({ failStart = false, deliverEmail = async () => {} } = {}) {
  const values = new Map(), files = new Map();
  let starts = 0, completed = false;
  const db = {
    get: async k => values.get(k) ? structuredClone(values.get(k)) : null,
    set: async (k, v, options) => {
      if (options?.nx && values.has(k)) return null;
      values.set(k, structuredClone(v)); return "OK";
    },
    eval: async (_, keys, args) => { if (values.get(keys[0]) === args[0]) values.delete(keys[0]); },
  };
  const api = load("app/_lib/restoration.ts", {
    "./restoration-email": { deliverRestorationEmail: deliverEmail },
    "@upstash/redis": { Redis: { fromEnv: () => db } },
    "@vercel/blob": {
      put: async (path, body) => { files.set(path, body); return { url: path }; },
      get: async path => ({ statusCode: 200, stream: new Response(files.get(path)).body }),
    },
  }, {
    fetch: async (url, options) => {
      if (url.endsWith("/restore-image/predictions")) {
        starts++;
        const body = JSON.parse(options.body);
        assert.equal(body.input.input_image, "data:image/jpeg;base64,/9j/Y3JvcA==");
        if (failStart) throw new Error("Ambiguous network timeout");
        return Response.json({ id: "prediction1", status: "starting" });
      }
      if (url.includes("/predictions/")) return Response.json({ id: "prediction1", status: completed ? "succeeded" : "processing", output: "https://replicate.delivery/photo.png" });
      return new Response("restored", { headers: { "Content-Type": "image/png" } });
    },
  });
  return { api, files, starts: () => starts, complete: () => { completed = true; } };
}

test("duplicate and concurrent requests start only one restoration using the cropped JPEG", async () => {
  const f = restorationFixture();
  const photo = new File([new Uint8Array([255, 216, 255]), "crop"], "cropped.jpg", { type: "image/jpeg" });
  await Promise.all([f.api.advanceRestoration("order", photo), f.api.advanceRestoration("order", photo)]);
  assert.equal(f.starts(), 1);
  assert.equal((await f.api.advanceRestoration("order", photo)).status, "processing");
  assert.equal(f.starts(), 1);
  f.complete();
  assert.equal((await f.api.advanceRestoration("order")).status, "complete");
  assert.ok(f.files.has("restorations/order/result"));
  assert.equal((await f.api.advanceRestoration("order", photo)).status, "complete");
  assert.equal(f.starts(), 1);
});

test("emails are triggered only after a successful result has been persisted", async () => {
  let notifications = 0;
  const f = restorationFixture({ deliverEmail: async (_, order, persist) => {
    assert.equal(order.status, "complete");
    assert.ok(f.files.has(order.resultUrl));
    if (order.emailDelivery?.sentAt) return;
    notifications++;
    order.emailDelivery = { sentAt: Date.now() };
    await persist();
  } });
  const photo = new File([new Uint8Array([255, 216, 255]), "crop"], "cropped.jpg", { type: "image/jpeg" });
  await f.api.advanceRestoration("order", photo);
  assert.equal(notifications, 0);
  f.complete();
  await Promise.all([f.api.advanceRestoration("order"), f.api.advanceRestoration("order")]);
  await f.api.advanceRestoration("order");
  assert.equal(notifications, 1);
  assert.equal(f.starts(), 1);
});

function emailFixture() {
  const values = new Map(), requests = [];
  let fail = false;
  const env = { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "Restore Old Photos <photos@example.com>", APP_URL: "https://example.com" };
  const api = load("app/_lib/restoration-email.ts", {
    "@upstash/redis": { Redis: { fromEnv: () => ({ get: async k => values.get(k), set: async (k, v) => values.set(k, v) }) } },
  }, {
    process: { env },
    fetch: async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      requests.push(options);
      if (fail) throw new Error("Network timeout");
      return Response.json({ id: "email-id" });
    },
  });
  return { api, env, requests, values, fail: value => { fail = value; } };
}

test("Resend uses approved copy and a result-only expiring link without Stripe credentials", async () => {
  const f = emailFixture();
  const order = { status: "processing", email: "customer@example.com", resultUrl: "private-result" };
  let persisted = false;
  await f.api.deliverRestorationEmail("order", order, async () => { persisted = true; });
  assert.equal(f.requests.length, 0);
  order.status = "complete";
  await f.api.deliverRestorationEmail("order", order, async () => { persisted = true; });
  assert.ok(persisted);
  assert.equal(f.requests.length, 1);
  const payload = JSON.parse(f.requests[0].body);
  assert.equal(payload.subject, "Your restored photo is ready");
  assert.ok(payload.text.endsWith("Thank you."));
  assert.ok(payload.html.includes("View and download your photo"));
  assert.equal(payload.to[0], order.email);
  assert.match(order.emailDelivery.token, /^[a-f0-9]{64}$/);
  assert.equal(await f.api.emailLinkOrderId(order.emailDelivery.token), "order");
  assert.equal(await f.api.emailLinkOrderId("order"), null);
  assert.equal(f.api.emailLinkMatches(order, order.emailDelivery.token), true);
  assert.equal(f.api.emailLinkMatches(order, "a".repeat(64)), false);
  await f.api.deliverRestorationEmail("order", order, async () => {});
  assert.equal(f.requests.length, 1);
  order.emailDelivery.expiresAt = Date.now() - 1;
  assert.equal(f.api.emailLinkMatches(order, order.emailDelivery.token), false);
  assert.ok(!f.requests[0].body.includes("private-result"));
});

test("email retries preserve the request and idempotency key; old ambiguous sends stop", async () => {
  const f = emailFixture();
  const order = { status: "complete", email: "customer@example.com", resultUrl: "private-result" };
  f.fail(true);
  await assert.rejects(f.api.deliverRestorationEmail("order", order, async () => {}));
  f.env.APP_URL = "https://changed.example.com";
  f.env.RESEND_FROM_EMAIL = "other@example.com";
  await assert.rejects(f.api.deliverRestorationEmail("order", order, async () => {}));
  assert.equal(f.requests[0].body, f.requests[1].body);
  assert.equal(f.requests[0].headers["Idempotency-Key"], f.requests[1].headers["Idempotency-Key"]);
  order.emailDelivery.firstAttemptAt = Date.now() - 24 * 3600_000;
  await f.api.deliverRestorationEmail("order", order, async () => {});
  assert.equal(f.requests.length, 2);
  assert.equal(order.emailDelivery.needsAttention, true);
});

test("email image endpoint rejects invalid links and streams private images without caching", async () => {
  let order = null, blobReads = 0;
  const route = load("app/api/email-photo/[token]/route.ts", {
    "@/app/_lib/email-photo": { readEmailPhoto: async () => order },
    "@vercel/blob": { get: async (_, options) => {
      assert.equal(options.access, "private");
      blobReads++;
      return { statusCode: 200, blob: { contentType: "image/png" }, stream: new Response("photo").body };
    } },
  });
  const params = { params: Promise.resolve({ token: "a".repeat(64) }) };
  assert.equal((await route.GET(new Request("https://example.com"), params)).status, 404);
  assert.equal(blobReads, 0);
  order = { resultUrl: "private-result" };
  const response = await route.GET(new Request("https://example.com?download"), params);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(response.headers.get("Content-Disposition"), /attachment.*restored-photo.png/);
});

test("email lookup requires the result's matching token, completed status and expiry", async () => {
  let id = "order";
  const token = "a".repeat(64);
  const order = { status: "complete", resultUrl: "private-result", emailDelivery: { token, expiresAt: Date.now() + 60_000 } };
  const email = load("app/_lib/restoration-email.ts");
  const api = load("app/_lib/email-photo.ts", {
    "./restoration": { readOrder: async () => order },
    "./restoration-email": { emailLinkOrderId: async () => id, emailLinkMatches: email.emailLinkMatches },
  });
  assert.ok(await api.readEmailPhoto(token));
  assert.equal(await api.readEmailPhoto("b".repeat(64)), null);
  order.status = "processing";
  assert.equal(await api.readEmailPhoto(token), null);
  order.status = "complete";
  order.emailDelivery.expiresAt = Date.now() - 1;
  assert.equal(await api.readEmailPhoto(token), null);
  id = null;
  assert.equal(await api.readEmailPhoto(token), null);
});

test("Replicate webhook requests email retries without rerunning a completed restoration", async () => {
  const result = { status: "complete", email: "customer@example.com", predictionId: "prediction1", emailDelivery: {} };
  const route = load("app/api/replicate/webhook/route.ts", {
    "@/app/_lib/replicate-signature": { verifyReplicateWebhook: () => true },
    "@/app/_lib/restoration": { predictionOrder: async () => "order", readOrder: async () => result, advanceRestoration: async () => result },
    "@/app/_lib/restoration-email": { restorationEmailConfigured: () => true },
    "@/app/_lib/paid-session": { RESTORATION_PRICE: "price_test", stripeClient: () => ({ checkout: { sessions: { retrieve: async () => ({ payment_status: "paid", mode: "payment", line_items: { data: [{ price: { id: "price_test" }, quantity: 1 }] } }) } } }) },
  }, { process: { env: { REPLICATE_WEBHOOK_SIGNING_SECRET: "test" } } });
  const request = () => new Request("https://example.com", { method: "POST", body: JSON.stringify({ id: "prediction1" }) });
  assert.equal((await route.POST(request())).status, 503);
  result.emailDelivery.sentAt = Date.now();
  assert.equal((await route.POST(request())).status, 204);
});

test("ambiguous prediction creation is not automatically retried", async () => {
  const f = restorationFixture({ failStart: true });
  const photo = new File([new Uint8Array([255, 216, 255]), "crop"], "cropped.jpg");
  assert.equal((await f.api.advanceRestoration("order", photo)).status, "needs_attention");
  await f.api.advanceRestoration("order", photo);
  assert.equal(f.starts(), 1);
});

test("Replicate webhook rejects tampered signatures and stale timestamps", () => {
  const api = load("app/_lib/replicate-signature.ts");
  const raw = '{"id":"prediction1"}', timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = `whsec_${Buffer.from("test secret").toString("base64")}`;
  const signature = createHmac("sha256", "test secret").update(`message.${timestamp}.${raw}`).digest("base64");
  const headers = new Headers({ "webhook-id": "message", "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` });
  assert.equal(api.verifyReplicateWebhook(raw, headers, secret), true);
  assert.equal(api.verifyReplicateWebhook(raw + " ", headers, secret), false);
  assert.equal(api.verifyReplicateWebhook(raw, headers, secret, Date.now() + 600_000), false);
});

test("clockwise rotation preserves an asymmetric crop and restores it after four turns", () => {
  const { rotateCropQuadClockwise } = load("app/_components/restore/photo-cropper.tsx");
  const quad = { topLeft: { x: .12, y: .2 }, topRight: { x: .78, y: .15 }, bottomRight: { x: .88, y: .7 }, bottomLeft: { x: .25, y: .82 } };
  const original = structuredClone(quad);
  const rotated = rotateCropQuadClockwise(quad);
  const expected = { topLeft: { x: .18, y: .25 }, topRight: { x: .8, y: .12 }, bottomRight: { x: .85, y: .78 }, bottomLeft: { x: .3, y: .88 } };
  function close(actual, expected) {
    for (const corner of Object.keys(expected)) for (const axis of ["x", "y"]) assert.ok(Math.abs(actual[corner][axis] - expected[corner][axis]) < 1e-12);
  }
  close(rotated, expected);
  let roundTrip = rotated;
  for (let i = 0; i < 3; i++) roundTrip = rotateCropQuadClockwise(roundTrip);
  close(roundTrip, quad);
  assert.deepEqual(quad, original);
});

test("local crop exports only the selected area, not the full source photo", async () => {
  const canvases = [];
  class Image { naturalWidth = 100; naturalHeight = 100; async decode() {} }
  const api = load("app/_components/restore/crop-photo.ts", {}, {
    Image,
    document: { createElement: () => {
      const canvas = {
        width: 0, height: 0, pixels: null,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => {
            const data = new Uint8ClampedArray(100 * 100 * 4);
            for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
              const offset = (y * 100 + x) * 4;
              data[offset] = x; data[offset + 1] = y; data[offset + 3] = 255;
            }
            return { data };
          },
          createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          putImageData: pixels => { canvas.pixels = pixels.data; },
        }),
        toBlob: callback => callback(new Blob(["cropped"], { type: "image/jpeg" })),
      };
      canvases.push(canvas); return canvas;
    } },
  });
  const quad = { topLeft: { x: .25, y: .25 }, topRight: { x: .75, y: .25 }, bottomRight: { x: .75, y: .75 }, bottomLeft: { x: .25, y: .75 } };
  const photo = await api.cropPhoto("local-only", quad);
  const result = canvases[1];
  assert.equal(result.width, 50); assert.equal(result.height, 50);
  assert.equal(result.pixels[0], 25); assert.equal(result.pixels[1], 25);
  assert.equal(result.pixels.at(-4), 74); assert.equal(result.pixels.at(-3), 74);
  assert.equal(photo.type, "image/jpeg");
  await assert.rejects(api.cropPhoto("local-only", { ...quad, topRight: quad.bottomLeft }), /crop corners/);
});
