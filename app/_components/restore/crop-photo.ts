import perspective from "perspective-transform";
import type { CropQuad } from "./photo-cropper";

/** Creates the selected photo locally; this function performs no uploads. */
export async function cropPhoto(src: string, quad: CropQuad): Promise<Blob> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  const source = document.createElement("canvas");
  source.width = Math.round(image.naturalWidth * scale);
  source.height = Math.round(image.naturalHeight * scale);
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("We could not prepare your photo.");
  context.drawImage(image, 0, 0, source.width, source.height);
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
    .map(p => ({ x: p.x * (source.width - 1), y: p.y * (source.height - 1) }));
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || a.x < 0 || a.y < 0 || a.x >= source.width || a.y >= source.height || (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) {
      throw new Error("Please adjust the crop corners so they do not cross.");
    }
  }
  const distance = (a: typeof points[number], b: typeof points[number]) => Math.hypot(a.x - b.x, a.y - b.y);
  const output = document.createElement("canvas");
  output.width = Math.round((distance(points[0], points[1]) + distance(points[3], points[2])) / 2);
  output.height = Math.round((distance(points[0], points[3]) + distance(points[1], points[2])) / 2);
  if (output.width < 16 || output.height < 16) throw new Error("Select a larger area of the photo.");
  const target = output.getContext("2d");
  if (!target) throw new Error("We could not prepare your photo.");
  const transform = perspective(points.flatMap(p => [p.x, p.y]), [0, 0, output.width - 1, 0, output.width - 1, output.height - 1, 0, output.height - 1]);
  const input = context.getImageData(0, 0, source.width, source.height).data;
  const pixels = target.createImageData(output.width, output.height);
  // Inverse mapping excludes the area outside the crop and corrects perspective.
  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      const [sx, sy] = transform.transformInverse(x, y);
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) throw new Error("Please adjust the crop corners.");
      const px = Math.max(0, Math.min(source.width - 1, sx));
      const py = Math.max(0, Math.min(source.height - 1, sy));
      const x0 = Math.floor(px), y0 = Math.floor(py);
      const x1 = Math.min(source.width - 1, x0 + 1), y1 = Math.min(source.height - 1, y0 + 1);
      const dx = px - x0, dy = py - y0;
      const offset = (y * output.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const sample = (a: number, b: number) => input[(b * source.width + a) * 4 + c];
        pixels.data[offset + c] = sample(x0, y0) * (1 - dx) * (1 - dy) + sample(x1, y0) * dx * (1 - dy) + sample(x0, y1) * (1 - dx) * dy + sample(x1, y1) * dx * dy;
      }
      pixels.data[offset + 3] = 255;
    }
    if (y % 64 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  target.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) => output.toBlob(blob => {
    if (blob && blob.size <= 4_000_000) resolve(blob);
    else reject(new Error("This photo is too large. Please choose a smaller image."));
  }, "image/jpeg", 0.9));
}
