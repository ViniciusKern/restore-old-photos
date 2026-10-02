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
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
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
  class Stripe {
    checkout = { sessions: { retrieve: async () => ({ client_secret: "secret", mode: "payment", line_items: { data: [{ price: { id: price }, quantity }] } }) } };
  }
  const api = load("app/_lib/paid-session.ts", { stripe: Stripe });
  const request = new Request("http://localhost", { headers: { Authorization: "Bearer secret" } });
  assert.ok(await api.authorizedSession("cs_test_order", request));
  assert.equal(await api.authorizedSession("cs_test_order", new Request("http://localhost", { headers: { Authorization: "Bearer wrong" } })), null);
  price = "price_wrong";
  assert.equal(await api.authorizedSession("cs_test_order", request), null);
  price = "price_1UMAxvIq2iVVFbtuoqNAcjAx"; quantity = 2;
  assert.equal(await api.authorizedSession("cs_test_order", request), null);
});

function restorationFixture({ failStart = false } = {}) {
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
