import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      const key = k.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      args[key] = val;
    }
  }
  return args;
}

function hexToRgba(hex, alpha = 1) {
  let h = (hex || "#FFFFFF").replace("#", "").trim();
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function drawArrowTip(ctx, x1, y1, x2, y2, tipPx, color, alpha) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const wing = 0.42;
  ctx.save();
  ctx.fillStyle = hexToRgba(color, alpha);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - tipPx * Math.cos(ang - wing), y2 - tipPx * Math.sin(ang - wing));
  ctx.lineTo(x2 - tipPx * Math.cos(ang + wing), y2 - tipPx * Math.sin(ang + wing));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFrame(ctx, width, height, timeline, frameItems) {
  const fw = timeline.frame_width || 8.0;
  const fh = timeline.frame_height || 14.22;
  const scaleX = width / fw;
  const scaleY = height / fh;
  const toPxX = (x) => (x + fw / 2) * scaleX;
  const toPxY = (y) => (fh / 2 - y) * scaleY;

  // Background
  ctx.fillStyle = timeline.background_color || "#0F172A";
  ctx.fillRect(0, 0, width, height);

  // Subtle radial ambient vignette for broadcast depth
  const grad = ctx.createRadialGradient(
    width * 0.5,
    height * 0.36,
    width * 0.05,
    width * 0.5,
    height * 0.4,
    height * 0.65
  );
  grad.addColorStop(0, "rgba(56, 189, 248, 0.05)");
  grad.addColorStop(1, "rgba(2, 6, 23, 0.25)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  for (const item of frameItems) {
    if (item.kind === "path") {
      const paths = item.paths || [];
      if (paths.length === 0) continue;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      for (const poly of paths) {
        if (poly.length < 2) continue;
        ctx.moveTo(toPxX(poly[0][0]), toPxY(poly[0][1]));
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(toPxX(poly[i][0]), toPxY(poly[i][1]));
        }
        if (item.closed) {
          ctx.closePath();
        }
      }

      if (item.fill_opacity > 0.005) {
        ctx.fillStyle = hexToRgba(item.fill_color, item.fill_opacity);
        ctx.fill("evenodd");
      }

      if (item.stroke_width > 0 && item.stroke_opacity > 0.005) {
        const pxStroke = Math.max(1.0, (item.stroke_width / 4.0) * (width / 1080) * 4.5);
        ctx.lineWidth = pxStroke;
        ctx.strokeStyle = hexToRgba(item.stroke_color, item.stroke_opacity);
        if (item.dashed) {
          const dashPx = Math.max(4, (item.dash_length || 0.12) * scaleX);
          ctx.setLineDash([dashPx, dashPx * 0.75]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const firstPoly = paths[0];
      if (firstPoly && firstPoly.length >= 2) {
        const tipPx = (item.tip_length || 0.22) * scaleX;
        if (item.arrow_tip_end && item.stroke_opacity > 0.005) {
          const a = firstPoly[firstPoly.length - 2];
          const b = firstPoly[firstPoly.length - 1];
          drawArrowTip(ctx, toPxX(a[0]), toPxY(a[1]), toPxX(b[0]), toPxY(b[1]), tipPx, item.stroke_color, item.stroke_opacity);
        }
        if (item.arrow_tip_start && item.stroke_opacity > 0.005) {
          const a = firstPoly[1];
          const b = firstPoly[0];
          drawArrowTip(ctx, toPxX(a[0]), toPxY(a[1]), toPxX(b[0]), toPxY(b[1]), tipPx, item.stroke_color, item.stroke_opacity);
        }
      }
      ctx.restore();
    } else if (item.kind === "text") {
      if (!item.text || item.opacity <= 0.005) continue;
      ctx.save();
      const px = toPxX(item.x);
      const py = toPxY(item.y);
      ctx.translate(px, py);
      if (item.angle) {
        ctx.rotate(-item.angle);
      }
      // Manim font_size=48 roughly maps to ~50px at 1080px width
      const fontPx = Math.max(8, (item.font_size || 48) * (width / 1080) * 1.04);
      const weight = item.weight === "BOLD" ? "700" : "500";
      const family = item.font && item.font !== "Inter" ? `"${item.font}", "Noto Sans", sans-serif` : `"Noto Sans", sans-serif`;
      ctx.font = `${weight} ${fontPx}px ${family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = hexToRgba(item.color || "#FFFFFF", item.opacity);

      const lines = String(item.text).split("\n");
      const lineH = fontPx * 1.24;
      const startY = -((lines.length - 1) * lineH) / 2;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], 0, startY + i * lineH);
      }
      ctx.restore();
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const timelinePath = args.timeline;
  const outMp4 = args.out;
  const width = parseInt(args.width || "1080", 10);
  const height = parseInt(args.height || "1920", 10);
  const qaDir = args["qa-dir"] || "";
  const qaPrefix = args["qa-prefix"] || "scene";

  if (!timelinePath || !outMp4) {
    console.error("Usage: node render_timeline.mjs --timeline <json> --out <mp4> [--width 1080 --height 1920 --qa-dir <dir> --qa-prefix <prefix>]");
    process.exit(1);
  }

  const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
  const fps = timeline.fps || 15;
  const frames = timeline.frames || [];
  if (frames.length === 0) {
    console.error("Timeline contains 0 frames.");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outMp4), { recursive: true });
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const ffmpegArgs = [
    "-y",
    "-f", "rawvideo",
    "-vcodec", "rawvideo",
    "-pix_fmt", "rgba",
    "-s", `${width}x${height}`,
    "-r", String(fps),
    "-i", "-",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", width >= 1080 ? "fast" : "ultrafast",
    "-crf", width >= 1080 ? "18" : "24",
    outMp4,
  ];

  const ff = spawn("ffmpeg", ffmpegArgs, { stdio: ["pipe", "ignore", "pipe"] });
  let ffStderr = "";
  ff.stderr.on("data", (d) => {
    ffStderr += d.toString();
  });

  // Compute QA frame indices at 25%, 60%, 95%
  const qaTargets = qaDir
    ? [
        { pct: 25, idx: Math.min(frames.length - 1, Math.max(0, Math.floor((frames.length - 1) * 0.25))) },
        { pct: 60, idx: Math.min(frames.length - 1, Math.max(0, Math.floor((frames.length - 1) * 0.60))) },
        { pct: 95, idx: Math.min(frames.length - 1, Math.max(0, Math.floor((frames.length - 1) * 0.95))) },
      ]
    : [];

  if (qaDir) {
    fs.mkdirSync(qaDir, { recursive: true });
  }

  for (let i = 0; i < frames.length; i++) {
    drawFrame(ctx, width, height, timeline, frames[i]);

    for (const qt of qaTargets) {
      if (qt.idx === i) {
        const pngBuf = canvas.toBuffer("image/png");
        fs.writeFileSync(path.join(qaDir, `${qaPrefix}_frame_${qt.pct}.png`), pngBuf);
      }
    }

    const raw = Buffer.from(ctx.getImageData(0, 0, width, height).data.buffer);
    if (!ff.stdin.write(raw)) {
      await new Promise((resolve) => ff.stdin.once("drain", resolve));
    }
  }
  ff.stdin.end();

  const exitCode = await new Promise((resolve) => ff.on("close", resolve));
  if (exitCode !== 0) {
    console.error("FFmpeg rasterization failed:", ffStderr);
    process.exit(exitCode || 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
