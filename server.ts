import fs from "node:fs";
import path from "node:path";
import express from "express";
import dotenv from "dotenv";
import {
  RUNS_DIR,
  executePipelineRun,
  getRunDetails,
  getRunLogs,
  listRuns,
  pipelineEvents,
  rerunSingleScene,
} from "./src/server/pipeline.ts";
import { ensureAudioAssets } from "./src/server/audioAssets.ts";
import type { PipelineProgressEvent, RenderProfile, VoiceName } from "./src/types.ts";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const activeRunIds = new Set<string>();

async function startServer() {
  ensureAudioAssets();
  fs.mkdirSync(RUNS_DIR, { recursive: true });

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      activeRuns: Array.from(activeRunIds),
    });
  });

  app.get("/api/runs", (_req, res) => {
    res.json({ runs: listRuns() });
  });

  app.post("/api/runs", async (req, res) => {
    const topic = String(req.body?.topic || "").trim();
    if (!topic) {
      res.status(400).json({ error: "Topic is required." });
      return;
    }
    const voice = (req.body?.voice || "Kore") as VoiceName;
    const renderProfile = (req.body?.renderProfile || "master") as RenderProfile;
    const includeBgMusic = req.body?.includeBgMusic !== false;
    const enableVisionQa = req.body?.enableVisionQa !== false;

    try {
      // Wait briefly for Stage 0 workspace provisioning by wrapping in promise
      let responded = false;
      const runPromise = executePipelineRun({
        topic,
        voice,
        renderProfile,
        includeBgMusic,
        enableVisionQa,
      });

      const onStage = (ev: PipelineProgressEvent) => {
        if (!responded && ev.stage === "stage_0" && ev.manifest?.topic === topic) {
          responded = true;
          activeRunIds.add(ev.runId);
          pipelineEvents.off(`run:${ev.runId}`, onStage);
          res.status(202).json({ runId: ev.runId, manifest: ev.manifest });
        }
      };

      // Listen on global hook via polling runs or direct listener
      const checkTimer = setInterval(() => {
        if (responded) {
          clearInterval(checkTimer);
          return;
        }
        const latest = listRuns().find((r) => r.topic === topic && r.status === "IN_PROGRESS");
        if (latest) {
          responded = true;
          activeRunIds.add(latest.run_id);
          clearInterval(checkTimer);
          res.status(202).json({ runId: latest.run_id, manifest: latest });
        }
      }, 60);

      runPromise
        .then((m) => {
          activeRunIds.delete(m.run_id);
          if (!responded) {
            responded = true;
            clearInterval(checkTimer);
            res.status(202).json({ runId: m.run_id, manifest: m });
          }
        })
        .catch((err) => {
          clearInterval(checkTimer);
          const latest = listRuns().find((r) => r.topic === topic);
          if (latest) activeRunIds.delete(latest.run_id);
          if (!responded) {
            responded = true;
            res.status(500).json({ error: err?.message || "Pipeline execution failed" });
          }
        });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to start pipeline" });
    }
  });

  app.post("/api/runs/:runId/resume", (req, res) => {
    const { runId } = req.params;
    const details = getRunDetails(runId);
    if (!details) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    if (activeRunIds.has(runId)) {
      res.status(409).json({ error: "Run is already active" });
      return;
    }
    activeRunIds.add(runId);
    executePipelineRun({
      topic: details.manifest.topic,
      voice: details.manifest.voice,
      renderProfile: details.manifest.render_profile,
      includeBgMusic: details.manifest.include_bg_music,
      enableVisionQa: details.manifest.enable_vision_qa !== false,
      resumeRunId: runId,
    })
      .finally(() => activeRunIds.delete(runId))
      .catch(() => {});

    res.status(202).json({ runId, status: "RESUMING" });
  });

  app.post("/api/runs/:runId/scenes/:sceneId/rerun", (req, res) => {
    const { runId, sceneId } = req.params;
    const sid = parseInt(sceneId, 10);
    if (!Number.isFinite(sid)) {
      res.status(400).json({ error: "Invalid scene ID" });
      return;
    }
    if (activeRunIds.has(runId)) {
      res.status(409).json({ error: "Run is currently busy" });
      return;
    }
    activeRunIds.add(runId);
    const overrideCode = typeof req.body?.code === "string" ? req.body.code : undefined;
    const overrideDirective = typeof req.body?.directive === "string" ? req.body.directive : undefined;

    rerunSingleScene(runId, sid, { overrideCode, overrideDirective })
      .finally(() => activeRunIds.delete(runId))
      .catch(() => {});

    res.status(202).json({ runId, sceneId: sid, status: "RERUNNING" });
  });

  app.get("/api/runs/:runId", (req, res) => {
    const details = getRunDetails(req.params.runId);
    if (!details) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(details);
  });

  app.delete("/api/runs/:runId", (req, res) => {
    const { runId } = req.params;
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
      res.status(400).json({ error: "Invalid runId" });
      return;
    }
    if (activeRunIds.has(runId)) {
      res.status(409).json({ error: "Cannot delete an active run" });
      return;
    }
    const target = path.join(RUNS_DIR, runId);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
    res.json({ deleted: true });
  });

  app.get("/api/runs/:runId/events", (req, res) => {
    const { runId } = req.params;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (ev: PipelineProgressEvent) => {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    };

    // Replay buffered events
    for (const past of getRunLogs(runId)) {
      send(past);
    }

    const listener = (ev: PipelineProgressEvent) => send(ev);
    pipelineEvents.on(`run:${runId}`, listener);

    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      pipelineEvents.off(`run:${runId}`, listener);
    });
  });

  // Serve run artifacts securely with Range support for MP4/WAV playback
  app.get("/api/runs/:runId/files/*", (req, res) => {
    const { runId } = req.params;
    const relPath = (req.params as Record<string, string>)[0] || "";
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
      res.status(400).end();
      return;
    }
    const runRoot = path.resolve(RUNS_DIR, runId);
    const fullPath = path.resolve(runRoot, relPath);
    if (!fullPath.startsWith(runRoot + path.sep) && fullPath !== runRoot) {
      res.status(403).end();
      return;
    }
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      res.status(404).end();
      return;
    }

    if (fullPath.endsWith(".mp4") || fullPath.endsWith(".wav")) {
      const stat = fs.statSync(fullPath);
      const mime = fullPath.endsWith(".mp4") ? "video/mp4" : "audio/wav";
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": mime,
        });
        fs.createReadStream(fullPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
        });
        fs.createReadStream(fullPath).pipe(res);
      }
      return;
    }

    res.sendFile(fullPath);
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Kinema Pipeline Studio server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
