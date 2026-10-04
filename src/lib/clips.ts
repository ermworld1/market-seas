/**
 * Auto-clip: records 12 s of the battle canvas (+ audio) into 16:9 and 9:16
 * crops with a top banner and bottom watermark. Clips never leave the device.
 */
export interface ClipFile {
  name: string;
  url: string;
  blob: Blob;
}

const CLIP_MS = 12_000;
let busy = false;

function pickMime() {
  const c = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return c.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

export function clipsSupported() {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

export async function recordClip(opts: {
  source: HTMLCanvasElement;
  banner: () => string;
  audio: MediaStream | null;
  vertical: boolean;
}): Promise<ClipFile[] | null> {
  if (busy || !clipsSupported()) return null;
  busy = true;
  try {
    const mime = pickMime();
    const formats = [{ w: 1280, h: 720, tag: "16x9" }, ...(opts.vertical ? [{ w: 720, h: 1280, tag: "9x16" }] : [])];
    const outs = formats.map((f) => {
      const c = document.createElement("canvas");
      c.width = f.w;
      c.height = f.h;
      const stream = c.captureStream(30);
      opts.audio?.getAudioTracks().forEach((t) => stream.addTrack(t.clone()));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<Blob>((res) => (rec.onstop = () => res(new Blob(chunks, { type: mime || "video/webm" }))));
      rec.start(500);
      return { ...f, c, ctx: c.getContext("2d")!, rec, done, stream };
    });
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const draw = () => {
        const src = opts.source;
        const text = opts.banner();
        for (const o of outs) {
          const { ctx, w, h } = o;
          ctx.fillStyle = "#061014";
          ctx.fillRect(0, 0, w, h);
          // cover-crop around the horizontal battle front; 9:16 stays centred on the crossing fire
          const sr = src.width / src.height;
          const dr = w / h;
          let sw = src.width;
          let sh = src.height;
          if (sr > dr) sw = sh * dr;
          else sh = sw / dr;
          ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
          const bh = Math.round(h * 0.075);
          ctx.fillStyle = "rgba(4,10,12,0.78)";
          ctx.fillRect(0, 0, w, bh);
          ctx.fillStyle = "#f0c46a";
          ctx.font = `700 ${Math.round(bh * 0.42)}px "Saira Condensed", sans-serif`;
          ctx.textBaseline = "middle";
          ctx.fillText(text, Math.round(w * 0.03), bh / 2, w * 0.94);
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.font = `600 ${Math.round(h * 0.022)}px "IBM Plex Mono", monospace`;
          ctx.fillText("No Man's Sea · live Binance Futures data · not financial advice", Math.round(w * 0.03), h - h * 0.03, w * 0.94);
        }
        if (performance.now() - t0 >= CLIP_MS) resolve();
        else requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    });
    const files: ClipFile[] = [];
    for (const o of outs) {
      o.rec.stop();
      const blob = await o.done;
      o.stream.getTracks().forEach((t) => t.stop());
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      files.push({ name: `no-mans-sea-${o.tag}-${Date.now()}.${ext}`, url: URL.createObjectURL(blob), blob });
    }
    return files;
  } catch (err) {
    console.error("[clips] recording failed", err);
    return null;
  } finally {
    busy = false;
  }
}
