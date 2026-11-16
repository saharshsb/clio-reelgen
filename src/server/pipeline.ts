import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  alignAudioWordTimestamps,
  debugManimCode,
  fixManimLayout,
  generateManimCode,
  generateStoryboard,
  getWavDurationSec,
  inspectVisionQA,
  synthesizeSceneTTS,
} from "./gemini.ts";
import { generateAssSubtitles } from "./assGenerator.ts";
import { ensureAudioAssets } from "./audioAssets.ts";
import type {
  AlignedScene,
  ArtifactFile,
  PipelineProgressEvent,
  QAVerdict,
  RenderProfile,
  RunDetails,
  RunManifest,
  SceneRunStatus,
  StageKey,
  StageState,
  Storyboard,
  VoiceName,
} from "../types.ts";

export const RUNS_DIR = path.resolve(process.cwd(), "runs");
const PY_RUNNER = path.resolve(process.cwd(), "py_runtime/runner.py");
const TIMELINE_RENDERER = path.resolve(process.cwd(), "py_runtime/render_timeline.mjs");

const MAX_CODE_RETRIES = 3;
const MAX_VISION_RETRIES = 1;

export const pipelineEvents = new EventEmitter();
pipelineEvents.setMaxListeners(100);

// In-memory live logs per run for SSE replay when client reconnects
const runLogBuffer = new Map<string, PipelineProgressEvent[]>();

function emitEvent(ev: Omit<PipelineProgressEvent, "timestamp">) {
  const full: PipelineProgressEvent = {
    ...ev,
    timestamp: new Date().toISOString(),
  };
  const buf = runLogBuffer.get(ev.runId) || [];
  buf.push(full);
  if (buf.length > 250) buf.shift();
  runLogBuffer.set(ev.runId, buf);
  pipelineEvents.emit(`run:${ev.runId}`, full);
}

export function getRunLogs(runId: string): PipelineProgressEvent[] {
  return runLogBuffer.get(runId) || [];
}

function runCommandAsync(
  cmd: string,
  args: string[],
  cwd = process.cwd()
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: String(err) });
    });
  });
}

export interface WorkspaceDirs {
  runId: string;
  root: string;
  script: string;
  audio: string;
  code: string;
  qa_frames: string;
  renders: string;
  subtitles: string;
}

export function getWorkspaceDirs(runId: string): WorkspaceDirs {
  const root = path.join(RUNS_DIR, runId);
  return {
    runId,
    root,
    script: path.join(root, "01_script"),
    audio: path.join(root, "02_audio"),
    code: path.join(root, "03_code"),
    qa_frames: path.join(root, "04_qa_frames"),
    renders: path.join(root, "05_renders"),
    subtitles: path.join(root, "06_subtitles"),
  };
}

export function provisionVideoWorkspace(topic: string): WorkspaceDirs {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 38) || "video";
  const runId = `${stamp}_${slug}`;
  const dirs = getWorkspaceDirs(runId);
  Object.values(dirs).forEach((d) => {
    if (d !== runId) fs.mkdirSync(d, { recursive: true });
  });
  return dirs;
}

function saveManifest(dirs: WorkspaceDirs, manifest: RunManifest) {
  manifest.updated_at = new Date().toISOString();
  fs.writeFileSync(path.join(dirs.root, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function setStage(dirs: WorkspaceDirs, manifest: RunManifest, stage: StageKey, state: StageState, message: string) {
  manifest.current_stage = stage;
  manifest.stages[stage] = state;
  saveManifest(dirs, manifest);
  emitEvent({
    type: "stage",
    runId: dirs.runId,
    stage,
    state,
    message,
    manifest: structuredClone(manifest),
  });
}

function updateSceneStatus(
  dirs: WorkspaceDirs,
  manifest: RunManifest,
  sceneId: number,
  patch: Partial<SceneRunStatus>,
  message: string
) {
  const target = manifest.scene_statuses.find((s) => s.scene_id === sceneId);
  if (target) {
    Object.assign(target, patch);
  }
  saveManifest(dirs, manifest);
  emitEvent({
    type: "scene",
    runId: dirs.runId,
    sceneId,
    message,
    manifest: structuredClone(manifest),
  });
}

function appendQaVerdict(dirs: WorkspaceDirs, verdict: QAVerdict) {
  const qaReportPath = path.join(dirs.qa_frames, "qa_report.json");
  let list: QAVerdict[] = [];
  if (fs.existsSync(qaReportPath)) {
    try {
      list = JSON.parse(fs.readFileSync(qaReportPath, "utf8"));
    } catch {
      list = [];
    }
  }
  const existingIdx = list.findIndex((x) => x.scene_id === verdict.scene_id && x.attempt === verdict.attempt);
  if (existingIdx >= 0) {
    list[existingIdx] = verdict;
  } else {
    list.push(verdict);
  }
  list.sort((a, b) => a.scene_id - b.scene_id || a.attempt - b.attempt);
  fs.writeFileSync(qaReportPath, JSON.stringify(list, null, 2), "utf8");
}

async function renderAndValidateScene(
  scene: AlignedScene,
  palette: Storyboard["theme_palette"],
  dirs: WorkspaceDirs,
  manifest: RunManifest,
  overrideCode?: string,
  reuseExistingScript = false
): Promise<string> {
  const sid = scene.scene_id;
  const sPad = String(sid).padStart(2, "0");
  const scriptPath = path.join(dirs.code, `scene_${sPad}.py`);
  const cacheDir = path.join(dirs.renders, `manim_cache_${sPad}`);
  fs.mkdirSync(cacheDir, { recursive: true });

  const logStatus = (msg: string) => {
    emitEvent({
      type: "log",
      runId: dirs.runId,
      stage: "stage_3",
      sceneId: sid,
      message: msg,
    });
  };

  // 1. Generate initial Manim Python script (or use override / resumed script)
  let code = overrideCode;
  if (!code && reuseExistingScript && fs.existsSync(scriptPath)) {
    code = fs.readFileSync(scriptPath, "utf8");
    logStatus(`Scene ${sPad}: Reusing existing Manim script from 03_code/scene_${sPad}.py`);
  }
  if (!code) {
    updateSceneStatus(dirs, manifest, sid, { status: "generating_code" }, `Scene ${sPad}: Generating 9:16 Manim Python script via Gemini...`);
    code = await generateManimCode(scene, palette, logStatus);
  }
  fs.writeFileSync(scriptPath, code, "utf8");

  let totalCodeAttempts = 0;
  let totalVisionAttempts = 0;

  const enableVisionQa = manifest.enable_vision_qa !== false;
  const maxVisionLoops = enableVisionQa ? MAX_VISION_RETRIES : 0;

  for (let visionAttempt = 0; visionAttempt <= maxVisionLoops; visionAttempt++) {
    totalVisionAttempts = visionAttempt + 1;
    let compiledPreviewTimeline = "";

    // 2. Execution & Compiler Self-Healing Loop (Agent 3)
    for (let codeAttempt = 0; codeAttempt < MAX_CODE_RETRIES; codeAttempt++) {
      totalCodeAttempts++;
      const attemptSnapshot = path.join(dirs.code, `scene_${sPad}_v${visionAttempt}_c${codeAttempt}.py`);
      fs.writeFileSync(attemptSnapshot, code, "utf8");

      updateSceneStatus(
        dirs,
        manifest,
        sid,
        { status: "compiling", code_attempts: totalCodeAttempts, vision_attempts: totalVisionAttempts },
        `Scene ${sPad}: Compiling Manim script (attempt ${codeAttempt + 1}/${MAX_CODE_RETRIES})...`
      );

      const previewTimelinePath = path.join(cacheDir, `preview_v${visionAttempt}.json`);
      const pyRes = await runCommandAsync("python3", [
        PY_RUNNER,
        scriptPath,
        "GeneratedScene",
        "--fps", "15",
        "--out", previewTimelinePath,
      ]);

      if (pyRes.code === 0 && fs.existsSync(previewTimelinePath)) {
        compiledPreviewTimeline = previewTimelinePath;
        break;
      }

      const stderrMsg = (pyRes.stderr || pyRes.stdout || "Unknown Python execution error").slice(-2500);
      updateSceneStatus(
        dirs,
        manifest,
        sid,
        { status: "debugging", last_error: stderrMsg.split("\n").slice(-3).join(" ") },
        `Scene ${sPad}: Compilation failed; invoking Gemini Debugger Agent...`
      );

      if (codeAttempt === MAX_CODE_RETRIES - 1) {
        throw new Error(`Scene ${sid} failed compilation after ${MAX_CODE_RETRIES} retries:\n${stderrMsg}`);
      }

      code = await debugManimCode(scene, code, stderrMsg, logStatus);
      fs.writeFileSync(scriptPath, code, "utf8");
    }

    // 3. Rasterize low-res preview (540x960@15fps) & extract 3 PNG QA frames at 25%, 60%, 95%
    const previewMp4 = path.join(cacheDir, `preview_v${visionAttempt}.mp4`);
    const qaPrefix = `scene_${sPad}_attempt_${visionAttempt}`;
    const renderPreviewRes = await runCommandAsync("node", [
      TIMELINE_RENDERER,
      "--timeline", compiledPreviewTimeline,
      "--out", previewMp4,
      "--width", "540",
      "--height", "960",
      "--qa-dir", dirs.qa_frames,
      "--qa-prefix", qaPrefix,
    ]);

    if (renderPreviewRes.code !== 0) {
      throw new Error(`Scene ${sid} preview rasterizer failed: ${renderPreviewRes.stderr}`);
    }

    const frameNames = [`${qaPrefix}_frame_25.png`, `${qaPrefix}_frame_60.png`, `${qaPrefix}_frame_95.png`];
    const framePaths = frameNames.map((n) => path.join(dirs.qa_frames, n));

    if (!enableVisionQa) {
      appendQaVerdict(dirs, {
        scene_id: sid,
        attempt: visionAttempt,
        status: "PASS",
        issues_detected: [],
        code_fix_instructions: "Vision QA skipped (low-quota mode); 3 preview frames saved.",
        frames: frameNames,
      });
      updateSceneStatus(
        dirs,
        manifest,
        sid,
        { qa_status: "PASS" },
        `Scene ${sPad}: Preview frames saved (Vision QA skipped)`
      );
      break;
    }

    // 4. Vision-LLM Layout QA Inspection (Agent 4 via gemini-3.1-flash-lite)
    updateSceneStatus(
      dirs,
      manifest,
      sid,
      { status: "vision_qa" },
      `Scene ${sPad}: Inspecting 3 extracted frames with Gemini Vision QA...`
    );

    const qa = await inspectVisionQA(framePaths, scene, logStatus);
    appendQaVerdict(dirs, {
      scene_id: sid,
      attempt: visionAttempt,
      status: qa.status,
      issues_detected: qa.issues_detected,
      code_fix_instructions: qa.code_fix_instructions,
      frames: frameNames,
    });

    updateSceneStatus(
      dirs,
      manifest,
      sid,
      { qa_status: qa.status },
      `Scene ${sPad}: Vision QA ${qa.status}${qa.issues_detected.length ? ` (${qa.issues_detected[0]})` : ""}`
    );

    if (qa.status === "PASS" || visionAttempt === maxVisionLoops) {
      break;
    }

    // Self-heal layout via Gemini
    code = await fixManimLayout(scene, code, qa.code_fix_instructions, qa.issues_detected, logStatus);
    fs.writeFileSync(scriptPath, code, "utf8");
  }

  // 5. Final Render (Master 1080x1920@60fps or Fast 540x960@30fps)
  const isMaster = manifest.render_profile === "master";
  const targetFps = isMaster ? 60 : 30;
  const targetW = isMaster ? 1080 : 540;
  const targetH = isMaster ? 1920 : 960;

  updateSceneStatus(
    dirs,
    manifest,
    sid,
    { status: "rendering_final" },
    `Scene ${sPad}: Rendering final ${targetW}x${targetH}@${targetFps}fps clip...`
  );

  const finalTimelinePath = path.join(cacheDir, "final_timeline.json");
  const finalPy = await runCommandAsync("python3", [
    PY_RUNNER,
    scriptPath,
    "GeneratedScene",
    "--fps", String(targetFps),
    "--out", finalTimelinePath,
  ]);
  if (finalPy.code !== 0) {
    throw new Error(`Scene ${sid} final timeline compile failed: ${finalPy.stderr}`);
  }

  const rawMp4 = path.join(dirs.renders, `raw_scene_${sPad}.mp4`);
  const finalRender = await runCommandAsync("node", [
    TIMELINE_RENDERER,
    "--timeline", finalTimelinePath,
    "--out", rawMp4,
    "--width", String(targetW),
    "--height", String(targetH),
  ]);
  if (finalRender.code !== 0) {
    throw new Error(`Scene ${sid} final rasterize failed: ${finalRender.stderr}`);
  }

  // 6. Per-Scene Audio-Video Muxing (zero cumulative drift)
  updateSceneStatus(dirs, manifest, sid, { status: "muxing" }, `Scene ${sPad}: Muxing audio & video...`);
  const muxedMp4 = path.join(dirs.renders, `muxed_scene_${sPad}.mp4`);
  const absAudio = path.isAbsolute(scene.audio_file_path)
    ? scene.audio_file_path
    : path.resolve(process.cwd(), scene.audio_file_path);

  const muxRes = await runCommandAsync("ffmpeg", [
    "-y",
    "-i", rawMp4,
    "-i", absAudio,
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-ac", "2",
    "-shortest",
    muxedMp4,
  ]);
  if (muxRes.code !== 0) {
    throw new Error(`Scene ${sid} muxing failed: ${muxRes.stderr}`);
  }

  updateSceneStatus(dirs, manifest, sid, { status: "completed" }, `Scene ${sPad}: Ready.`);
  return muxedMp4;
}

async function compositeStage4(
  dirs: WorkspaceDirs,
  manifest: RunManifest,
  alignedScenes: AlignedScene[],
  accentHex: string
): Promise<string> {
  setStage(dirs, manifest, "stage_4", "running", "Stage 4: Generating ASS karaoke subtitles & compositing master video...");

  // 1. Subtitles
  const { assPath } = generateAssSubtitles(alignedScenes, dirs.subtitles, accentHex);

  // 2. Concat list
  const muxedClips = alignedScenes.map((s) =>
    path.join(dirs.renders, `muxed_scene_${String(s.scene_id).padStart(2, "0")}.mp4`)
  );
  const concatListPath = path.join(dirs.renders, "concat_list.txt");
  const concatContent = muxedClips.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
  fs.writeFileSync(concatListPath, concatContent, "utf8");

  const combinedPath = path.join(dirs.renders, "combined_silent_subs.mp4");
  const concatRes = await runCommandAsync("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatListPath,
    "-c", "copy",
    combinedPath,
  ]);
  if (concatRes.code !== 0) {
    throw new Error(`Stage 4 concat failed: ${concatRes.stderr}`);
  }

  // 3. Burn ASS subtitles + mix ducked background music (-22dB)
  const finalVideoPath = path.join(dirs.root, "final_short.mp4");
  const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

  let ffArgs: string[];
  if (manifest.include_bg_music) {
    const { bgMusicPath } = ensureAudioAssets();
    ffArgs = [
      "-y",
      "-i", combinedPath,
      "-i", bgMusicPath,
      "-filter_complex",
      `[1:a]volume=-22dB,aloop=loop=-1:size=2e+09,aformat=sample_rates=44100:channel_layouts=stereo[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[aout];[0:v]ass='${escapedAss}'[vout]`,
      "-map", "[vout]",
      "-map", "[aout]",
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "fast",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      finalVideoPath,
    ];
  } else {
    ffArgs = [
      "-y",
      "-i", combinedPath,
      "-vf", `ass='${escapedAss}'`,
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "fast",
      "-c:a", "copy",
      "-movflags", "+faststart",
      finalVideoPath,
    ];
  }

  const finalRes = await runCommandAsync("ffmpeg", ffArgs);
  if (finalRes.code !== 0) {
    throw new Error(`Stage 4 master render failed: ${finalRes.stderr}`);
  }

  setStage(dirs, manifest, "stage_4", "completed", "Stage 4: Master video `final_short.mp4` rendered.");
  return finalVideoPath;
}

export interface StartPipelineOptions {
  topic: string;
  voice?: VoiceName;
  renderProfile?: RenderProfile;
  includeBgMusic?: boolean;
  enableVisionQa?: boolean;
  resumeRunId?: string;
}

export async function executePipelineRun(opts: StartPipelineOptions): Promise<RunManifest> {
  const dirs = opts.resumeRunId ? getWorkspaceDirs(opts.resumeRunId) : provisionVideoWorkspace(opts.topic);
  const voice: VoiceName = opts.voice || "Kore";
  const renderProfile: RenderProfile = opts.renderProfile || "master";
  const includeBgMusic = opts.includeBgMusic ?? true;
  const enableVisionQa = opts.enableVisionQa ?? true;

  const emitStageLog = (stage: StageKey, message: string) => {
    emitEvent({
      type: "log",
      runId: dirs.runId,
      stage,
      message,
    });
  };

  const manifestPath = path.join(dirs.root, "manifest.json");
  let manifest: RunManifest;

  if (opts.resumeRunId && fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.status = "IN_PROGRESS";
    manifest.error = undefined;
    if (manifest.enable_vision_qa === undefined) {
      manifest.enable_vision_qa = enableVisionQa;
    }
  } else {
    manifest = {
      run_id: dirs.runId,
      topic: opts.topic,
      voice,
      render_profile: renderProfile,
      include_bg_music: includeBgMusic,
      enable_vision_qa: enableVisionQa,
      status: "IN_PROGRESS",
      current_stage: "stage_0",
      stages: {
        stage_0: "completed",
        stage_1: "pending",
        stage_2: "pending",
        stage_3: "pending",
        stage_4: "pending",
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      scene_statuses: [],
    };
  }
  saveManifest(dirs, manifest);

  emitEvent({
    type: "stage",
    runId: dirs.runId,
    stage: "stage_0",
    state: "completed",
    message: `Stage 0: Provisioned isolated workspace runs/${dirs.runId}/`,
    manifest: structuredClone(manifest),
  });

  try {
    // STAGE 1: Storyboard Director
    const storyboardPath = path.join(dirs.script, "storyboard.json");
    let storyboard: Storyboard;
    if (fs.existsSync(storyboardPath)) {
      storyboard = JSON.parse(fs.readFileSync(storyboardPath, "utf8"));
      manifest.video_title = storyboard.video_title;
      setStage(dirs, manifest, "stage_1", "completed", "Stage 1: Loaded existing storyboard.json");
    } else {
      setStage(dirs, manifest, "stage_1", "running", "Stage 1: Directing atomic 9:16 storyboard via Gemini...");
      storyboard = await generateStoryboard(opts.topic, (m) => emitStageLog("stage_1", m));
      fs.writeFileSync(storyboardPath, JSON.stringify(storyboard, null, 2), "utf8");
      manifest.video_title = storyboard.video_title;
      manifest.scene_statuses = storyboard.scenes.map((s) => ({
        scene_id: s.scene_id,
        header_text: s.header_text,
        status: "pending",
        code_attempts: 0,
        vision_attempts: 0,
      }));
      setStage(
        dirs,
        manifest,
        "stage_1",
        "completed",
        `Stage 1: Generated ${storyboard.scenes.length}-scene storyboard "${storyboard.video_title}"`
      );
    }

    if (manifest.scene_statuses.length === 0) {
      manifest.scene_statuses = storyboard.scenes.map((s) => ({
        scene_id: s.scene_id,
        header_text: s.header_text,
        status: "pending",
        code_attempts: 0,
        vision_attempts: 0,
      }));
      saveManifest(dirs, manifest);
    }

    // STAGE 2: Audio & Alignment Engine (Audio-First!)
    const alignedPath = path.join(dirs.script, "aligned_storyboard.json");
    let alignedScenes: AlignedScene[];
    if (fs.existsSync(alignedPath)) {
      alignedScenes = JSON.parse(fs.readFileSync(alignedPath, "utf8"));
      setStage(dirs, manifest, "stage_2", "completed", "Stage 2: Loaded existing audio alignment");
    } else {
      setStage(
        dirs,
        manifest,
        "stage_2",
        "running",
        `Stage 2: Synthesizing Gemini TTS (${voice}) & extracting word timestamps...`
      );
      alignedScenes = [];
      for (const scene of storyboard.scenes) {
        const sPad = String(scene.scene_id).padStart(2, "0");
        const wavPath = path.join(dirs.audio, `scene_${sPad}.wav`);
        if (!fs.existsSync(wavPath)) {
          emitEvent({
            type: "log",
            runId: dirs.runId,
            stage: "stage_2",
            sceneId: scene.scene_id,
            message: `Synthesizing voiceover for Scene ${sPad}...`,
          });
          await synthesizeSceneTTS(scene.narration, voice, wavPath, (m) => emitStageLog("stage_2", m));
        }
        const exactDuration = getWavDurationSec(wavPath);
        const wordTimestamps = await alignAudioWordTimestamps(wavPath, scene.narration, exactDuration, (m) =>
          emitStageLog("stage_2", m)
        );
        const relAudio = path.relative(process.cwd(), wavPath);
        alignedScenes.push({
          ...scene,
          audio_file_path: relAudio,
          exact_duration_sec: exactDuration,
          word_timestamps: wordTimestamps,
        });
        updateSceneStatus(
          dirs,
          manifest,
          scene.scene_id,
          { exact_duration_sec: exactDuration },
          `Scene ${sPad} audio ready (${exactDuration.toFixed(2)}s, ${wordTimestamps.length} words aligned)`
        );
      }
      fs.writeFileSync(alignedPath, JSON.stringify(alignedScenes, null, 2), "utf8");
      fs.writeFileSync(
        path.join(dirs.subtitles, "full_transcript.txt"),
        alignedScenes.map((s) => s.narration).join("\n\n"),
        "utf8"
      );
      manifest.total_duration_sec = Number(
        alignedScenes.reduce((acc, s) => acc + s.exact_duration_sec, 0).toFixed(2)
      );
      setStage(
        dirs,
        manifest,
        "stage_2",
        "completed",
        `Stage 2: Audio & forced alignment complete (${manifest.total_duration_sec}s total)`
      );
    }

    // STAGE 3: Rate-Limit-Safe Sequential Scene Generation, Self-Healing & Vision QA
    setStage(
      dirs,
      manifest,
      "stage_3",
      "running",
      `Stage 3: Processing ${alignedScenes.length} scenes sequentially (free-tier rate-limit pacing enabled)...`
    );

    for (const scene of alignedScenes) {
      const sPad = String(scene.scene_id).padStart(2, "0");
      const muxedPath = path.join(dirs.renders, `muxed_scene_${sPad}.mp4`);
      if (opts.resumeRunId && fs.existsSync(muxedPath)) {
        updateSceneStatus(dirs, manifest, scene.scene_id, { status: "completed" }, `Scene ${sPad}: Resumed existing render.`);
        continue;
      }
      await renderAndValidateScene(
        scene,
        storyboard.theme_palette,
        dirs,
        manifest,
        undefined,
        Boolean(opts.resumeRunId)
      );
    }
    setStage(dirs, manifest, "stage_3", "completed", "Stage 3: All scenes validated & rendered.");

    // STAGE 4: Master Compositor
    const finalVideoPath = await compositeStage4(
      dirs,
      manifest,
      alignedScenes,
      storyboard.theme_palette.primary_accent
    );

    manifest.status = "COMPLETED";
    manifest.final_video = path.relative(process.cwd(), finalVideoPath);
    saveManifest(dirs, manifest);

    emitEvent({
      type: "completed",
      runId: dirs.runId,
      stage: "stage_4",
      state: "completed",
      message: "Pipeline complete! Master video ready for playback.",
      manifest: structuredClone(manifest),
    });
    return manifest;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    manifest.status = "FAILED";
    manifest.error = errMsg;
    manifest.stages[manifest.current_stage] = "failed";
    saveManifest(dirs, manifest);
    emitEvent({
      type: "error",
      runId: dirs.runId,
      stage: manifest.current_stage,
      state: "failed",
      message: errMsg,
      manifest: structuredClone(manifest),
    });
    throw err;
  }
}

export async function rerunSingleScene(
  runId: string,
  sceneId: number,
  options: { overrideCode?: string; overrideDirective?: string }
): Promise<RunManifest> {
  const dirs = getWorkspaceDirs(runId);
  const manifestPath = path.join(dirs.root, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Run ${runId} not found.`);
  }
  const manifest: RunManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const storyboard: Storyboard = JSON.parse(fs.readFileSync(path.join(dirs.script, "storyboard.json"), "utf8"));
  const alignedScenes: AlignedScene[] = JSON.parse(
    fs.readFileSync(path.join(dirs.script, "aligned_storyboard.json"), "utf8")
  );

  const scene = alignedScenes.find((s) => s.scene_id === sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} not found in run ${runId}`);

  if (options.overrideDirective && options.overrideDirective.trim()) {
    scene.visual_directive = options.overrideDirective.trim();
    fs.writeFileSync(path.join(dirs.script, "aligned_storyboard.json"), JSON.stringify(alignedScenes, null, 2), "utf8");
  }

  manifest.status = "IN_PROGRESS";
  manifest.error = undefined;
  setStage(dirs, manifest, "stage_3", "running", `Re-rendering Scene ${String(sceneId).padStart(2, "0")}...`);

  try {
    await renderAndValidateScene(scene, storyboard.theme_palette, dirs, manifest, options.overrideCode);
    setStage(dirs, manifest, "stage_3", "completed", `Scene ${String(sceneId).padStart(2, "0")} updated.`);

    const finalVideoPath = await compositeStage4(
      dirs,
      manifest,
      alignedScenes,
      storyboard.theme_palette.primary_accent
    );
    manifest.status = "COMPLETED";
    manifest.final_video = path.relative(process.cwd(), finalVideoPath);
    saveManifest(dirs, manifest);

    emitEvent({
      type: "completed",
      runId,
      stage: "stage_4",
      state: "completed",
      message: `Scene ${String(sceneId).padStart(2, "0")} re-rendered & master video recomposited.`,
      manifest: structuredClone(manifest),
    });
    return manifest;
  } catch (err: any) {
    manifest.status = "FAILED";
    manifest.error = err?.message || String(err);
    saveManifest(dirs, manifest);
    emitEvent({
      type: "error",
      runId,
      stage: manifest.current_stage,
      state: "failed",
      message: manifest.error || "Scene rerun failed",
      manifest: structuredClone(manifest),
    });
    throw err;
  }
}

export function listRuns(): RunManifest[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const entries = fs.readdirSync(RUNS_DIR, { withFileTypes: true });
  const manifests: RunManifest[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const mp = path.join(RUNS_DIR, ent.name, "manifest.json");
    if (fs.existsSync(mp)) {
      try {
        manifests.push(JSON.parse(fs.readFileSync(mp, "utf8")));
      } catch {
        // skip corrupted manifest
      }
    }
  }
  return manifests.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function collectArtifacts(rootDir: string): ArtifactFile[] {
  const results: ArtifactFile[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.startsWith("manim_cache_")) continue;
        walk(full);
      } else {
        const rel = path.relative(rootDir, full).replace(/\\/g, "/");
        const stat = fs.statSync(full);
        let category: ArtifactFile["category"] = "manifest";
        if (rel.startsWith("01_script/")) category = "script";
        else if (rel.startsWith("02_audio/")) category = "audio";
        else if (rel.startsWith("03_code/")) category = "code";
        else if (rel.startsWith("04_qa_frames/")) category = "qa";
        else if (rel.startsWith("05_renders/")) category = "render";
        else if (rel.startsWith("06_subtitles/")) category = "subtitle";
        else if (rel === "final_short.mp4") category = "master";
        results.push({
          relativePath: rel,
          name: ent.name,
          sizeBytes: stat.size,
          category,
        });
      }
    }
  }
  walk(rootDir);
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function getRunDetails(runId: string): RunDetails | null {
  const dirs = getWorkspaceDirs(runId);
  const manifestPath = path.join(dirs.root, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;

  const manifest: RunManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const storyboardPath = path.join(dirs.script, "storyboard.json");
  const alignedPath = path.join(dirs.script, "aligned_storyboard.json");
  const qaPath = path.join(dirs.qa_frames, "qa_report.json");
  const transcriptPath = path.join(dirs.subtitles, "full_transcript.txt");
  const wordsPath = path.join(dirs.subtitles, "word_timestamps.json");
  const assPath = path.join(dirs.subtitles, "captions.ass");

  const storyboard: Storyboard | null = fs.existsSync(storyboardPath)
    ? JSON.parse(fs.readFileSync(storyboardPath, "utf8"))
    : null;
  const alignedScenes: AlignedScene[] = fs.existsSync(alignedPath)
    ? JSON.parse(fs.readFileSync(alignedPath, "utf8"))
    : [];
  const qaReport: QAVerdict[] = fs.existsSync(qaPath) ? JSON.parse(fs.readFileSync(qaPath, "utf8")) : [];

  const sceneCode: RunDetails["sceneCode"] = {};
  if (fs.existsSync(dirs.code)) {
    const pyFiles = fs.readdirSync(dirs.code).filter((f) => f.endsWith(".py")).sort();
    for (const f of pyFiles) {
      const mMain = f.match(/^scene_(\d+)\.py$/);
      const mAtt = f.match(/^scene_(\d+)_v\d+_c\d+\.py$/);
      const codeText = fs.readFileSync(path.join(dirs.code, f), "utf8");
      if (mMain) {
        const sid = parseInt(mMain[1], 10);
        if (!sceneCode[sid]) sceneCode[sid] = { finalCode: "", attempts: [] };
        sceneCode[sid].finalCode = codeText;
      } else if (mAtt) {
        const sid = parseInt(mAtt[1], 10);
        if (!sceneCode[sid]) sceneCode[sid] = { finalCode: "", attempts: [] };
        sceneCode[sid].attempts.push({ name: f, code: codeText });
      }
    }
  }

  return {
    manifest,
    storyboard,
    alignedScenes,
    qaReport,
    sceneCode,
    subtitles: {
      transcript: fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, "utf8") : "",
      wordTimestamps: fs.existsSync(wordsPath) ? JSON.parse(fs.readFileSync(wordsPath, "utf8")) : [],
      assContent: fs.existsSync(assPath) ? fs.readFileSync(assPath, "utf8") : "",
    },
    artifacts: collectArtifacts(dirs.root),
  };
}
