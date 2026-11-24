/**
 * Turns any picture (PNG, JPG, WEBP, even a big one) into a small PNG or JPEG data URL that fits the 200 KB limit for logos,
 * signatures and stamps. Keeps transparency when it can; shrinks step by step until it fits.
 */
const MAX_CHARS = 270_000; // the settings schema allows 280,000 characters of base64

export async function fitImage(file: File, maxSide = 600): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a picture (PNG, JPG or WEBP)");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("This picture could not be read. Try saving it as PNG or JPG.");
  }
  let scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  for (let i = 0; i < 8; i++) {
    const w = Math.max(16, Math.round(bmp.width * scale));
    const h = Math.max(16, Math.round(bmp.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("This browser cannot resize pictures");
    ctx.drawImage(bmp, 0, 0, w, h);
    const png = c.toDataURL("image/png");
    if (png.length <= MAX_CHARS) return png;
    // Photos compress far better as JPEG; paint white first since JPEG has no transparency.
    const flat = document.createElement("canvas");
    flat.width = w;
    flat.height = h;
    const fctx = flat.getContext("2d")!;
    fctx.fillStyle = "#fff";
    fctx.fillRect(0, 0, w, h);
    fctx.drawImage(bmp, 0, 0, w, h);
    const jpg = flat.toDataURL("image/jpeg", 0.88);
    if (jpg.length <= MAX_CHARS) return jpg;
    scale *= 0.75;
  }
  throw new Error("This picture is too detailed to shrink enough. Try a simpler one.");
}
