import fs from "node:fs";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import type {
  AlignedScene,
  Storyboard,
  ThemePalette,
  VoiceName,
  WordTimestamp,
} from "../types.ts";

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in environment.");
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

export type GeminiStatusCallback = (message: string) => void;

const MODEL_MIN_GAP_MS: Record<string, number> = {
  "gemini-4-hydrogen": 5500,
  "gemini-3.1-flash-lite": 3500,
  "gemini-3.8-flash-lite-tts": 3500,
};

const modelQueues = new Map<string, Promise<unknown>>();
const modelLastCallAt = new Map<string, number>();

function scheduleModelCall<T>(model: string, fn: () => Promise<T>): Promise<T> {
  const prev = modelQueues.get(model) ?? Promise.resolve();
  const gapMs = MODEL_MIN_GAP_MS[model] ?? 4000;

  const next = prev.then(async () => {
    const last = modelLastCallAt.get(model) ?? 0;
    const waitMs = last + gapMs - Date.now();
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
    modelLastCallAt.set(model, Date.now());
    return fn();
  });

  modelQueues.set(
    model,
    next.catch(() => {})
  );
  return next;
}

function parseRetryDelayMs(errMsg: string, attempt: number): number {
  const match = errMsg.match(/retry(?:Delay| in)\s*[:=]?\s*"?(\d+(?:\.\d+)?)s/i);
  if (match && match[1]) {
    const sec = parseFloat(match[1]);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(90000, Math.ceil((sec + 2) * 1000));
    }
  }
  const schedule = [20000, 35000, 50000, 65000, 75000];
  return schedule[Math.min(attempt, schedule.length - 1)];
}

async function withRetry<T>(
  model: string,
  label: string,
  fn: () => Promise<T>,
  onStatus?: GeminiStatusCallback,
  maxRetries = 6
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await scheduleModelCall(model, fn);
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || err);
      const isRateLimit =
        msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
      const isTransient =
        isRateLimit ||
        msg.includes("503") ||
        msg.includes("500") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("ECONNRESET") ||
        msg.includes("fetch failed");

      if (!isTransient || attempt === maxRetries - 1) {
        throw err;
      }

      const delayMs = isRateLimit
        ? parseRetryDelayMs(msg, attempt)
        : 2000 * Math.pow(2, attempt);
      const waitSec = Math.round(delayMs / 1000);
      onStatus?.(
        `${label}: ${isRateLimit ? "Rate limit reached" : "Transient API error"}; cooling down ${waitSec}s (retry ${attempt + 1}/${maxRetries - 1})...`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`);
}

function extractPythonCode(raw: string): string {
  const fenced = raw.match(/```python\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    return fenced[1].trim() + "\n";
  }
  return raw.trim() + "\n";
}

// ---------------------------------------------------------------------------
// AGENT 1: Storyboard & Script Director (Gemini)
// ---------------------------------------------------------------------------
const STORYBOARD_SYSTEM_PROMPT = `### SYSTEM PROMPT: STORYBOARD & SCRIPT DIRECTOR

You are an elite short-form infotainment director specializing in high-retention programmatic animations (similar to 3Blue1Brown, Vox, and Kurzgesagt adapted for 9:16 vertical video).

Your job is to convert the user's topic into a structured JSON storyboard consisting of 6 to 8 atomic scenes (45-55 seconds total).

#### NARRATION RULES:
1. **Zero Fluff Hook:** Scene 1 must immediately state a counter-intuitive fact, visual paradox, or direct question in under 15 words. Never start with "Hey guys" or "Today we will learn".
2. **Atomic Pacing:** Each scene's \`narration\` must be 10 to 22 words long (approx. 4 to 7 seconds of speech).
3. **Conversational & Punchy:** Write for the ear, not the eye. Use active voice, short clauses, and concrete nouns.

#### VISUAL DIRECTIVE RULES (MANIM CONSTRAINTS):
1. **Concrete Geometric Primitives:** You are directing a Manim Community code generator. Do NOT ask for photorealistic 3D humans, complex SVG illustrations, or external video clips.
2. **Allowed Visual Building Blocks:**
   - Geometric shapes (\`Circle\`, \`RoundedRectangle\`, \`Arrow\`, \`Line\`, \`DashedLine\`, \`Polygon\`, \`CurvedArrow\`, \`Dot\`)
   - Data visualizations (\`Axes\`, \`BarChart\`, function graphs, number lines, dynamic \`ValueTracker\` counters)
   - Node-and-edge flowcharts, comparison boxes, mathematical equations, and clean geometric transformations.
3. **One Core Idea Per Scene:** Never crowd more than 4 distinct visual elements into a single scene.
4. **Explicit Synchronization:** In \`visual_directive\`, explicitly mention which spoken word triggers the primary animation change.

#### OUTPUT FORMAT:
Respond ONLY with valid JSON adhering strictly to the provided schema.`;

export async function generateStoryboard(
  topic: string,
  onStatus?: GeminiStatusCallback
): Promise<Storyboard> {
  const ai = getClient();
  return withRetry("gemini-4-hydrogen", "Agent1 Storyboard", async () => {
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: `Create a 6-to-8 scene vertical infotainment storyboard for the topic: "${topic}"`,
      config: {
        systemInstruction: STORYBOARD_SYSTEM_PROMPT,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            video_title: { type: Type.STRING },
            target_duration_sec: { type: Type.NUMBER },
            theme_palette: {
              type: Type.OBJECT,
              properties: {
                background: { type: Type.STRING },
                primary_accent: { type: Type.STRING },
                secondary_accent: { type: Type.STRING },
                text_primary: { type: Type.STRING },
              },
              required: ["background", "primary_accent", "secondary_accent", "text_primary"],
            },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  scene_id: { type: Type.INTEGER },
                  scene_type: { type: Type.STRING },
                  narration: { type: Type.STRING },
                  visual_directive: { type: Type.STRING },
                  header_text: { type: Type.STRING },
                  pacing_notes: { type: Type.STRING },
                },
                required: ["scene_id", "scene_type", "narration", "visual_directive", "header_text", "pacing_notes"],
              },
            },
          },
          required: ["video_title", "target_duration_sec", "theme_palette", "scenes"],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? "{}").trim()) as Storyboard;
    // Ensure sequential scene_id 1..N
    parsed.scenes = (parsed.scenes || []).map((s, idx) => ({
      ...s,
      scene_id: idx + 1,
      scene_type: s.scene_type || "manim_diagram",
    }));
    if (!parsed.theme_palette?.background) {
      parsed.theme_palette = {
        background: "#0F172A",
        primary_accent: "#38BDF8",
        secondary_accent: "#F43F5E",
        text_primary: "#F8FAFC",
      };
    }
    return parsed;
  }, onStatus);
}

// ---------------------------------------------------------------------------
// STAGE 2: Gemini TTS + Forced Word-Level Alignment
// ---------------------------------------------------------------------------
export async function synthesizeSceneTTS(
  narration: string,
  voiceName: VoiceName,
  outWavPath: string,
  onStatus?: GeminiStatusCallback
): Promise<void> {
  const ai = getClient();
  await withRetry("gemini-3.8-flash-lite-tts", "Stage2 Gemini TTS", async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash-lite-tts",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: narration,
              speechMetadata: {
                style: "Clear, authoritative, engaging short-form documentary narrator",
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error("Gemini TTS returned empty audio payload.");
    }
    const wavBuffer = Buffer.from(base64Audio, "base64");
    fs.writeFileSync(outWavPath, wavBuffer);
  }, onStatus);
}

/**
 * Computes exact duration of a PCM WAV file directly from RIFF header or file bytes.
 */
export function getWavDurationSec(wavPath: string): number {
  const buf = fs.readFileSync(wavPath);
  if (buf.length < 44) return 4.0;
  const sampleRate = buf.readUInt32LE(24) || 24000;
  const channels = buf.readUInt16LE(22) || 1;
  const bitsPerSample = buf.readUInt16LE(34) || 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  // Find 'data' chunk
  let offset = 12;
  let dataSize = buf.length - 44;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }
  return Number(Math.max(0.5, dataSize / Math.max(1, byteRate)).toFixed(3));
}

/**
 * Normalizes word timestamps so they strictly match every word in `narration`
 * and monotonically span [0, exactDurationSec] with zero overlaps.
 */
function normalizeWordTimestamps(
  narration: string,
  rawWords: WordTimestamp[],
  exactDurationSec: number
): WordTimestamp[] {
  const expectedTokens = narration.trim().split(/\s+/).filter(Boolean);
  if (expectedTokens.length === 0) return [];

  // Fallback proportional syllable-weighted timings
  const weights = expectedTokens.map((w) => Math.max(1, w.replace(/[^a-zA-Z0-9]/g, "").length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  if (!rawWords || rawWords.length !== expectedTokens.length) {
    let cursor = 0;
    return expectedTokens.map((word, idx) => {
      const dur = (weights[idx] / totalWeight) * exactDurationSec;
      const start = Number(cursor.toFixed(3));
      cursor += dur;
      const end = idx === expectedTokens.length - 1 ? exactDurationSec : Number(cursor.toFixed(3));
      return { word, start, end: Math.max(start + 0.04, end) };
    });
  }

  // Clamp and enforce monotonic order on Gemini's aligned timestamps
  const out: WordTimestamp[] = [];
  let prevEnd = 0;
  for (let i = 0; i < expectedTokens.length; i++) {
    const raw = rawWords[i];
    const start = Math.max(prevEnd, Math.min(exactDurationSec - 0.05, Number(raw.start) || prevEnd));
    let end = i === expectedTokens.length - 1
      ? exactDurationSec
      : Math.max(start + 0.04, Math.min(exactDurationSec, Number(raw.end) || start + 0.2));
    if (end <= start) end = Math.min(exactDurationSec, start + 0.05);
    out.push({
      word: expectedTokens[i],
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
    });
    prevEnd = end;
  }
  return out;
}

export async function alignAudioWordTimestamps(
  wavPath: string,
  narration: string,
  exactDurationSec: number,
  onStatus?: GeminiStatusCallback
): Promise<WordTimestamp[]> {
  const ai = getClient();
  const expectedTokens = narration.trim().split(/\s+/).filter(Boolean);
  if (expectedTokens.length === 0) return [];

  try {
    const wavBase64 = fs.readFileSync(wavPath).toString("base64");
    const aligned = await withRetry("gemini-3.1-flash-lite", "Stage2 Word Alignment", async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: wavBase64,
              },
            },
            {
              text: `Listen closely to this ${exactDurationSec.toFixed(2)}-second narration clip and provide exact start and end timestamps (in seconds, between 0.0 and ${exactDurationSec.toFixed(2)}) for EVERY word in this exact list of ${expectedTokens.length} words:\n${JSON.stringify(expectedTokens)}`,
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING },
                start: { type: Type.NUMBER },
                end: { type: Type.NUMBER },
              },
              required: ["word", "start", "end"],
            },
          },
        },
      });
      return JSON.parse((response.text ?? "[]").trim()) as WordTimestamp[];
    }, onStatus, 3);

    return normalizeWordTimestamps(narration, aligned, exactDurationSec);
  } catch {
    // Graceful deterministic fallback if alignment call fails
    return normalizeWordTimestamps(narration, [], exactDurationSec);
  }
}

// ---------------------------------------------------------------------------
// AGENT 2: Manim 9:16 Scene Code Generator (Gemini)
// ---------------------------------------------------------------------------
const MANIM_CODER_SYSTEM_PROMPT = `### SYSTEM PROMPT: MANIM 9:16 CINEMATIC MOTION ENGINEER

You are a World-Class Motion Graphics Animator and Senior Manim Community (manim v0.19+) engineer producing broadcast-grade vertical short-form infotainment (similar to Vox, Kurzgesagt, and 3Blue1Brown adapted for 9:16 vertical video).

Your job is to generate a complete, high-aesthetic, production-ready Python script for a single vertical (9:16) scene based on the provided JSON scene specification and word-level audio timestamps.

#### 1. CANVAS CONFIGURATION & STRICT 9:16 SPATIAL BOUNDARIES:
You MUST include these exact configuration settings at the top of the file:
\`\`\`python
from manim import *
import numpy as np

config.pixel_width = 1080
config.pixel_height = 1920
config.frame_width = 8.0
config.frame_height = 14.22
\`\`\`

- **X-Axis Range:** -4.0 (left edge) to +4.0 (right edge). Keep all content within x in [-3.2, 3.2].
- **Y-Axis Range:** -7.11 (bottom edge) to +7.11 (top edge).
- **TOP DEAD ZONE:** y in [6.0, 7.11] (mobile status bar / UI). Keep empty.
- **HEADER ZONE:** y in [4.8, 5.8]. Position scene header_text at y = 5.2. Max width = 6.2 (always scale to fit).
- **PRIMARY VISUAL SAFE ZONE:** y in [-1.4, 4.6], x in [-3.2, 3.2]. All diagrams, icons, charts, and animations MUST stay strictly in this zone.
- **FORBIDDEN CAPTION ZONE (CRITICAL):** y < -1.5 (the bottom 25% of the screen). NEVER place any object, text, or arrow below y = -1.5. This area is strictly reserved for burned-in subtitles.

#### 2. KINETIC ANIMATION PRINCIPLES (SMOOTH & NATURAL MOTION):
1. **NO TOPOLOGICAL MORPHS:** Never use Transform() or ReplacementTransform() between completely different shapes (e.g. Circle to Square, or Text to Arrow). That causes awkward vertex warping. Instead, use choreographed exit and entry pairs:
   \`\`\`python
   self.play(
       FadeOut(old_mob, shift=DOWN * 0.25, scale=0.85),
       FadeIn(new_mob, shift=UP * 0.25, scale=1.05),
       run_time=0.6,
       rate_func=rush_from
   )
   \`\`\`
2. **MANDATORY STAGGERING (NO SYNCHRONIZED ROBOTIC POPS):**
   When revealing multiple elements (e.g. cards, labels, icons, indicators), NEVER spawn them all at the exact same instant. ALWAYS use AnimationGroup with lag_ratio:
   \`\`\`python
   self.play(
       AnimationGroup(
           FadeIn(box, shift=UP * 0.2),
           Write(title),
           FadeIn(icon, scale=0.5),
           lag_ratio=0.15,
           run_time=1.2
       )
   )
   \`\`\`
3. **INTENTIONAL EASINGS (RATE FUNCTIONS):**
   - **Entrances (Pops, slides, reveals):** Use rate_func=rush_from or ease_out_cubic for snappy, punchy arrivals that glide smoothly to a halt.
   - **Exits (Dismissing items):** Use rate_func=rush_into (accelerates out).
   - **Continuous transitions / motions:** Use rate_func=smooth.
   - **Emphasis & Callouts:** Use Indicate(obj, color=YELLOW, scale_factor=1.15) or Circumscribe(obj).
4. **LIVING SCREEN (SECONDARY & AMBIENT MOTION):**
   - Avoid completely frozen screens where nothing moves for multiple seconds during long narration clauses.
   - During explanatory narration clauses, keep the visual alive with subtle secondary motion:
     - Ambient breathing: self.play(diagram.animate.shift(UP * 0.08), run_time=wait_chunk, rate_func=there_and_back)
     - Dynamic progress or values: ValueTracker.animate.set_value(...) with always_redraw(DecimalNumber)
     - Curved path travel: MoveAlongPath or tracing a dashed route with Create() or ShowPassingFlash().
5. **AUDIO SYNCHRONIZATION BEATS:**
   - Use the provided word_timestamps to trigger key visual shifts right on the onset of their keyword.
   - Fast hook: Scene 1 MUST reveal its primary visual within the first 0.3 seconds.

#### 3. STRICT TIMING CONTRACT:
- You are provided exact_duration_sec and word_timestamps.
- The sum of all run_time and self.wait() calls in construct(self) MUST match exact_duration_sec within ±0.03 seconds.
- Maintain an accurate elapsed = 0.0 accumulator. End every scene with:
  \`\`\`python
  remaining = max(0.05, exact_duration_sec - elapsed)
  self.wait(remaining)
  \`\`\`
- NEVER pass 0 or negative numbers to self.wait() or run_time.

#### 4. MANIM COMMUNITY v0.19+ CODE STABILITY:
- **Typography:** Use Text("...", font="Arial") or Text("..."). Use weight=BOLD for headers. Do NOT use Tex() or MathTex() unless strictly necessary for math equations.
- **VGroup Safety:** Always check .width and use .scale_to_fit_width(min(mob.width, 6.0)) to prevent horizontal clipping.
- **Relative Positioning:** Anchor elements using .next_to(target, DOWN, buff=0.25) or .shift().
- **Colors:** Use the provided theme_palette hex codes (e.g., theme_palette.primary_accent, theme_palette.background). Set self.camera.background_color = theme_palette.background at the beginning of construct(self).
- **Class Naming:** Class name MUST be GeneratedScene(Scene).

#### OUTPUT FORMAT:
Output ONLY a single Python code block (\`\`\`python ... \`\`\`) containing the executable script.`;

export async function generateManimCode(
  scene: AlignedScene,
  palette: ThemePalette,
  onStatus?: GeminiStatusCallback
): Promise<string> {
  const ai = getClient();
  const payload = {
    scene_id: scene.scene_id,
    header_text: scene.header_text,
    narration: scene.narration,
    visual_directive: scene.visual_directive,
    pacing_notes: scene.pacing_notes,
    exact_duration_sec: scene.exact_duration_sec,
    word_timestamps: scene.word_timestamps,
    theme_palette: palette,
  };

  return withRetry("gemini-4-hydrogen", `Agent2 ManimCoder S${scene.scene_id}`, async () => {
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: `Generate the complete 9:16 Manim Python script for this scene:\n\n${JSON.stringify(payload, null, 2)}`,
      config: {
        systemInstruction: MANIM_CODER_SYSTEM_PROMPT,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      },
    });
    return extractPythonCode(response.text ?? "");
  }, onStatus);
}

// ---------------------------------------------------------------------------
// AGENT 3: Code Execution Debugger (Gemini)
// ---------------------------------------------------------------------------
const DEBUGGER_SYSTEM_PROMPT = `### SYSTEM PROMPT: MANIM COMMUNITY EXECUTION DEBUGGER

You are an automated Python & Manim Community (manim v0.19+) debugging specialist. The Manim script below failed during compilation or headless rendering with official Manim Community.

#### COMMON MANIM COMMUNITY v0.19+ PITFALLS TO CHECK:
- Using deprecated ManimGL syntax (e.g. ShowCreation instead of Create, CONFIG = {...} instead of __init__).
- Passing width/height to Axes instead of x_length and y_length.
- Trying to scale zero-width or empty groups with scale_to_fit_width().
- Invalid rate function names or syntax in .animate(rate_func=...).
- Calling self.wait(0) or negative wait time.
- Missing font or LaTeX errors: fallback to Text("...", font="Arial").
- Unbound variable or syntax error in helper functions.

#### INSTRUCTIONS:
1. Identify the root cause from the traceback in a 1-sentence comment at the top of the file.
2. Fix the bug while preserving the 9:16 safe zone constraints (x in [-3.2, 3.2], y in [-1.4, 4.6], header y=5.2) and the exact total scene duration (exact_duration_sec).
3. Output ONLY the corrected, full Python script inside a \`\`\`python ... \`\`\` block.`;

export async function debugManimCode(
  scene: AlignedScene,
  brokenCode: string,
  stderrTraceback: string,
  onStatus?: GeminiStatusCallback
): Promise<string> {
  const ai = getClient();
  return withRetry("gemini-4-hydrogen", `Agent3 Debugger S${scene.scene_id}`, async () => {
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: `Scene Specification:\n${JSON.stringify({
        scene_id: scene.scene_id,
        header_text: scene.header_text,
        visual_directive: scene.visual_directive,
        exact_duration_sec: scene.exact_duration_sec,
      }, null, 2)}\n\nBroken Python Script:\n\`\`\`python\n${brokenCode}\n\`\`\`\n\nStderr Traceback:\n\`\`\`\n${stderrTraceback}\n\`\`\``,
      config: {
        systemInstruction: DEBUGGER_SYSTEM_PROMPT,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      },
    });
    return extractPythonCode(response.text ?? "");
  }, onStatus);
}

// ---------------------------------------------------------------------------
// AGENT 4: Vision QA Layout Inspector + Layout Fixer (Gemini Multimodal)
// ---------------------------------------------------------------------------
const VISION_QA_SYSTEM_PROMPT = `### SYSTEM PROMPT: VISION QA LAYOUT INSPECTOR

You are an automated Visual Quality Assurance inspector for a 9:16 vertical animation pipeline. You are looking at 3 sequential frames extracted at 25%, 60%, and 95% of a rendered Manim scene.

Evaluate the frames against the following strict visual criteria:
1. **Text Collision / Overlap:** Does any text overlap with another piece of text, a line, an arrow, or a shape border in a way that hurts legibility?
2. **Out-of-Bounds / Clipping:** Are any letters, shapes, or graph labels cut off by the left or right edges of the frame?
3. **Forbidden Bottom Zone Intrusion:** The bottom 25% of the vertical frame (below y = -1.5, i.e., the bottom quarter of the image) must remain completely empty for subtitle burn-in. Are there any visual elements intruding into the bottom 25% of the image?
4. **Blank or Broken Visuals:** Are all frames completely empty/blank when a diagram should be visible?

Respond ONLY with valid JSON matching the schema. If status is "PASS", leave issues_detected as [] and code_fix_instructions as "".`;

export async function inspectVisionQA(
  framePaths: string[],
  scene: AlignedScene,
  onStatus?: GeminiStatusCallback
): Promise<{ status: "PASS" | "FAIL"; issues_detected: string[]; code_fix_instructions: string }> {
  const ai = getClient();
  const imageParts = framePaths.map((p) => ({
    inlineData: {
      mimeType: "image/png",
      data: fs.readFileSync(p).toString("base64"),
    },
  }));

  return withRetry("gemini-3.1-flash-lite", `Agent4 VisionQA S${scene.scene_id}`, async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: {
        parts: [
          ...imageParts,
          {
            text: `Inspect these 3 frames (at 25%, 60%, 95%) for Scene ${scene.scene_id}.\nHeader: "${scene.header_text}"\nExpected visual: "${scene.visual_directive}"`,
          },
        ],
      },
      config: {
        systemInstruction: VISION_QA_SYSTEM_PROMPT,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["PASS", "FAIL"] },
            issues_detected: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            code_fix_instructions: { type: Type.STRING },
          },
          required: ["status", "issues_detected", "code_fix_instructions"],
        },
      },
    });
    const parsed = JSON.parse((response.text ?? "{}").trim());
    return {
      status: parsed.status === "FAIL" ? "FAIL" : "PASS",
      issues_detected: Array.isArray(parsed.issues_detected) ? parsed.issues_detected : [],
      code_fix_instructions: String(parsed.code_fix_instructions || ""),
    };
  }, onStatus);
}

export async function fixManimLayout(
  scene: AlignedScene,
  currentCode: string,
  visionCritique: string,
  issues: string[],
  onStatus?: GeminiStatusCallback
): Promise<string> {
  const ai = getClient();
  return withRetry("gemini-4-hydrogen", `Agent4 LayoutFixer S${scene.scene_id}`, async () => {
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: `The rendered 9:16 Manim scene failed Visual QA.\n\nDetected Issues:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nFix Instructions:\n${visionCritique}\n\nScene Exact Duration: ${scene.exact_duration_sec}s\nSafe Zones: Header at y=5.2, Diagram strictly inside x in [-3.4, 3.4] and y in [-1.4, 4.5]. Bottom quarter (y < -1.5) MUST stay empty.\n\nCurrent Python Code:\n\`\`\`python\n${currentCode}\n\`\`\`\n\nOutput ONLY the updated full Python script inside a \`\`\`python ... \`\`\` block.`,
      config: {
        systemInstruction: MANIM_CODER_SYSTEM_PROMPT,
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      },
    });
    return extractPythonCode(response.text ?? "");
  }, onStatus);
}
