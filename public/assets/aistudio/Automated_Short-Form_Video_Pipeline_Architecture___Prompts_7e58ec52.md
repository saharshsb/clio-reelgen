# Automated Short-Form Infotainment Video Pipeline: Architecture & System Design

## 1. System Overview & Core Philosophy

Building a fully automated short-form video generator using LLMs and programmatic animation engines (like Manim) fails when treated as a single-shot code generation task. Monolithic scripts suffer from audio-visual desynchronization, layout collisions on vertical (`9:16`) screens, and cascading syntax hallucinations.

To achieve near-100% reliability, this system uses an **Audio-First, Scene-Segmented, Self-Healing Architecture**:
1. **Deconstruct:** Break a 45–60 second video into 6–10 atomic micro-scenes (4–8 seconds each).
2. **Audio First:** Generate TTS audio *before* writing any visual code to establish immutable duration and word-timestamp constraints.
3. **Constrained Spatial Canvas:** Restrict Manim animations to a defined safe zone so dynamic captions and platform UI (TikTok/Reels/Shorts buttons) never obscure visuals.
4. **Execution & Visual QA Loops:** Validate every scene through a two-stage gate: a Python compiler check (`stderr` feedback loop) and a Vision-LLM layout inspection (frame extraction check).
5. **Isolated Per-Video Artifact Tracking & Single Entry Point:** Every pipeline run must be triggered via a single entry point (`python run_pipeline.py --topic "..."`) and automatically provision a dedicated, self-contained workspace folder per video containing every intermediate component (scripts, audio, Manim code, QA logs, scene renders, captions) alongside the final master video.

---

## 2. End-to-End Pipeline Architecture

```
[Single Entry Point: `python run_pipeline.py --topic "..."`]
              │
              ▼
┌────────────────────────────────────────────────────────┐
│ STAGE 0: Workspace Provisioner                         │
│ Creates isolated folder: `runs/<YYYYMMDD_HHMMSS_slug>/`│
└────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────┐
│ STAGE 1: Storyboard & Script Director Agent (LLM)      │
│ Outputs structured JSON array of 6-10 atomic scenes    │
└────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────┐
│ STAGE 2: Audio & Alignment Engine (TTS + WhisperX)     │
│ 1. Synthesizes narration per scene (.mp3 / .wav)       │
│ 2. Extracts exact scene duration & word timestamps     │
└────────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────┐
│ STAGE 3: Parallel Scene Generation & Self-Healing Loop │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 3A. Manim Code Generator Agent (LLM)             │  │
│  └────────────────────────┬─────────────────────────┘  │
│                           ▼                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 3B. Sandbox Low-Res Render (`manim -ql`)         │  │
│  └──────┬────────────────────────────────────┬──────┘  │
│         │ Exception (`stderr`)               │ Success │
│         ▼                                    ▼         │
│  ┌──────────────────────┐       ┌───────────────────┐  │
│  │ 3C. Debugger Agent   │       │ 3D. Vision QA     │  │
│  │ (Fixes Python crash) │       │ Agent (Checks PNG)│  │
│  └──────┬───────────────┘       └────┬─────────┬────┘  │
│         └────────────►◄──────────────┘         │ Pass  │
│                  Retry Loop                    ▼       │
│                                  ┌──────────────────┐  │
│                                  │ High-Res Render  │  │
│                                  │ (`1080x1920@60`) │  │
│                                  └──────────────────┘  │
└──────────────────────────────────────────┬─────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────┐
│ STAGE 4: Master Compositor (FFmpeg + PyCaps / ASS)     │
│ 1. Concatenates scene MP4s & audio tracks              │
│ 2. Burns in word-level dynamic subtitles in bottom zone│
│ 3. Mixes ducked background music (-22 dB) & SFX        │
│ 4. Saves `final_short.mp4` into the video's run folder │
└────────────────────────────────────────────────────────┘
```

---

## 2.1 Per-Video Directory Structure & Single Entry Point Specification

To ensure full auditability, reproducibility, and easy debugging or manual re-rendering of individual scenes, **every generated video must reside in its own isolated directory** under `runs/`, and **the entire end-to-end pipeline must be triggerable from a single entry point**.

### Mandatory Per-Video Folder Layout
```text
runs/
└── 20261116_161500_why_planes_curve/         # 1 dedicated folder per video run
    ├── manifest.json                         # Run metadata, config, timestamps, & status
    ├── 01_script/
    │   ├── storyboard.json                   # Raw Stage 1 LLM output
    │   └── aligned_storyboard.json           # Stage 2 enriched payload with timestamps
    ├── 02_audio/
    │   ├── scene_01.wav                      # Individual TTS voiceover clips
    │   ├── scene_02.wav
    │   └── ...
    ├── 03_code/
    │   ├── scene_01.py                       # Final validated Manim script per scene
    │   ├── scene_01_attempt_1.py             # Historical attempts kept for tracking
    │   └── ...
    ├── 04_qa_frames/
    │   ├── scene_01_frame_25.png             # Extracted Vision QA inspection frames
    │   ├── scene_01_frame_60.png
    │   ├── scene_01_frame_95.png
    │   └── qa_report.json                    # Vision QA pass/fail verdicts & critiques
    ├── 05_renders/
    │   ├── raw_scene_01.mp4                  # Silent 1080x1920@60fps Manim output
    │   ├── muxed_scene_01.mp4                # Audio+Video synced individual scene clip
    │   ├── concat_list.txt                   # FFmpeg concatenation manifest
    │   └── combined_silent_subs.mp4          # Pre-subtitle stitched video
    ├── 06_subtitles/
    │   ├── full_transcript.txt               # Plain-text narration script
    │   ├── word_timestamps.json              # Merged global word-level timings
    │   └── captions.ass                      # Styled ASS karaoke subtitle file
    └── final_short.mp4                       # Final deliverable master video
```

### Single Entry Point Requirement
All stages (Stage 0 through Stage 4) must be orchestrated automatically from one unified entry point (`run_pipeline.py`), supporting both CLI execution and programmatic invocation:

```bash
# Single command to generate an entire video from scratch into its own tracked folder
python run_pipeline.py --topic "Why Planes Don't Fly in Straight Lines" --voice "en-US-AndrewNeural"
```

* **Idempotency & Resume Support:** Because all intermediate artifacts (`storyboard.json`, `scene_XX.wav`, `scene_XX.py`, `muxed_scene_XX.mp4`) are persisted in the video's dedicated folder, `run_pipeline.py` can also accept `--resume-dir runs/20261116_161500_why_planes_curve/` to skip completed stages if a run is interrupted or a single scene needs manual tweaking.

---

## 3. Spatial Coordinate System (`9:16` Vertical Canvas)

Standard Manim uses a `16:9` aspect ratio (`14.22` width $\times$ `8.0` height). For vertical short-form video (`1080x1920`), all scene scripts must inherit a shared base configuration:

* **Pixel Resolution:** $1080 \times 1920$ (`60 fps`)
* **Manim Frame Dimensions:** `config.frame_width = 8.0`, `config.frame_height = 14.22`
* **X-Axis Bounds:** $-4.0$ (left edge) to $+4.0$ (right edge)
* **Y-Axis Bounds:** $-7.11$ (bottom edge) to $+7.11$ (top edge)

### Mandatory Screen Zones
| Zone | Y-Axis Range | X-Axis Range | Purpose |
| :--- | :--- | :--- | :--- |
| **Top Margin (Dead Zone)** | $+6.0$ to $+7.11$ | $-4.0$ to $+4.0$ | Kept empty for mobile status bar & platform header UI. |
| **Header / Title Zone** | $+4.5$ to $+6.0$ | $-3.4$ to $+3.4$ | Scene title or persistent topic header. |
| **Primary Visual Safe Zone** | $-1.5$ to $+4.5$ | $-3.4$ to $+3.4$ | **All Manim diagrams, charts, and animations live here.** |
| **Caption & UI Safe Zone** | $-7.11$ to $-1.5$ | $-4.0$ to $+4.0$ | **Strictly off-limits to Manim objects.** Reserved for burned-in karaoke captions and TikTok/Reels overlays. |

---

## 4. Data Contracts (JSON Schemas)

### 4.1 Storyboard Output Schema (Stage 1 $\rightarrow$ Stage 2)
```json
{
  "video_title": "Why Planes Don't Fly in Straight Lines",
  "target_duration_sec": 48.0,
  "theme_palette": {
    "background": "#0F172A",
    "primary_accent": "#38BDF8",
    "secondary_accent": "#F43F5E",
    "text_primary": "#F8FAFC"
  },
  "scenes": [
    {
      "scene_id": 1,
      "scene_type": "manim_diagram",
      "narration": "If you look at a flight tracker from New York to Tokyo, the path curves sharply toward Alaska.",
      "visual_directive": "Draw a flat 2D Mercator map outline represented by a grid rectangle. Plot two dots labeled 'NYC' on the right and 'TYO' on the left. Animate a dashed red straight line between them, then draw a glowing cyan curved arc bowing upward toward the top of the grid.",
      "header_text": "THE CURVED FLIGHT PATH",
      "pacing_notes": "Fast hook; reveal the curved arc right on the word 'curves'."
    }
  ]
}
```

### 4.2 Enriched Audio-Aligned Scene Payload (Stage 2 $\rightarrow$ Stage 3)
After TTS synthesis and WhisperX forced alignment, each scene object is enriched with exact timing metadata and saved to `01_script/aligned_storyboard.json` before being sent to the Manim Code Generator LLM:

```json
{
  "scene_id": 1,
  "audio_file_path": "runs/20261116_161500_why_planes_curve/02_audio/scene_01.wav",
  "exact_duration_sec": 5.42,
  "word_timestamps": [
    {"word": "If", "start": 0.0, "end": 0.12},
    {"word": "you", "start": 0.12, "end": 0.24},
    {"word": "look", "start": 0.24, "end": 0.45},
    {"word": "curves", "start": 3.80, "end": 4.25},
    {"word": "Alaska.", "start": 4.85, "end": 5.42}
  ]
}
```

---

## 5. Intermediate LLM System Prompts

Below are the production prompts for each specialized agent in the pipeline.

---

### Agent 1: Storyboard & Script Director LLM
* **Recommended Model:** `claude-3-7-sonnet` or `gpt-4o` (with Structured Outputs enabled)
* **Role:** Transforms a raw topic or article into a tightly paced, visually concrete JSON storyboard.

```markdown
### SYSTEM PROMPT: STORYBOARD & SCRIPT DIRECTOR

You are an elite short-form infotainment director specializing in high-retention programmatic animations (similar to 3Blue1Brown, Vox, and Kurzgesagt adapted for 9:16 vertical video).

Your job is to convert the user's topic into a structured JSON storyboard consisting of 6 to 10 atomic scenes.

#### NARRATION RULES:
1. **Zero Fluff Hook:** Scene 1 must immediately state a counter-intuitive fact, visual paradox, or direct question in under 15 words. Never start with "Hey guys" or "Today we will learn".
2. **Atomic Pacing:** Each scene's `narration` must be 10 to 22 words long (approx. 4 to 7 seconds of speech).
3. **Conversational & Punchy:** Write for the ear, not the eye. Use active voice, short clauses, and concrete nouns.

#### VISUAL DIRECTIVE RULES (MANIM CONSTRAINTS):
1. **Concrete Geometric Primitives:** You are directing a Manim Community code generator. Do NOT ask for photorealistic 3D humans, complex SVG illustrations, or external video clips.
2. **Allowed Visual Building Blocks:**
   - Geometric shapes (`Circle`, `RoundedRectangle`, `Arrow`, `Line`, `DashedLine`, `Polygon`)
   - Data visualizations (`Axes`, `BarChart`, function graphs, number lines, dynamic `ValueTracker` counters)
   - Node-and-edge flowcharts, comparison tables, mathematical formulas, and vector field transformations.
3. **One Core Idea Per Scene:** Never crowd more than 4 distinct visual elements into a single scene.
4. **Explicit Synchronization:** In `visual_directive`, explicitly mention which spoken word triggers the primary animation change.

#### OUTPUT FORMAT:
Respond ONLY with valid JSON adhering strictly to the provided `StoryboardSchema`.
```

---

### Agent 2: Manim Scene Code Generator LLM
* **Recommended Model:** `gemini-4-hydrogen` or `claude-3-7-sonnet` (highest spatial & Manim Community v0.19+ syntax accuracy)
* **Role:** Writes a self-contained Python `Scene` class for a single micro-scene synchronized to exact TTS timestamps, using kinetic motion design principles.

```markdown
### SYSTEM PROMPT: MANIM 9:16 CINEMATIC MOTION ENGINEER

You are a World-Class Motion Graphics Animator and Senior Manim Community (manim v0.19+) engineer producing broadcast-grade vertical short-form infotainment (similar to Vox, Kurzgesagt, and 3Blue1Brown adapted for 9:16 vertical video).

Your job is to generate a complete, high-aesthetic, production-ready Python script for a single vertical (9:16) scene based on the provided JSON scene specification and word-level audio timestamps.

#### 1. CANVAS CONFIGURATION & STRICT 9:16 SPATIAL BOUNDARIES:
You MUST include these exact configuration settings at the top of the file:
```python
from manim import *
import numpy as np

config.pixel_width = 1080
config.pixel_height = 1920
config.frame_width = 8.0
config.frame_height = 14.22
```

- **X-Axis Range:** -4.0 (left edge) to +4.0 (right edge). Keep all content within `x in [-3.2, 3.2]`.
- **Y-Axis Range:** -7.11 (bottom edge) to +7.11 (top edge).
- **TOP DEAD ZONE:** y in [6.0, 7.11] (mobile status bar / UI). Keep empty.
- **HEADER ZONE:** y in [4.8, 5.8]. Position scene `header_text` at `y = 5.2`. Max width = 6.2 (always scale to fit).
- **PRIMARY VISUAL SAFE ZONE:** y in [-1.4, 4.6], x in [-3.2, 3.2]. All diagrams, icons, charts, and animations MUST stay strictly in this zone.
- **FORBIDDEN CAPTION ZONE (CRITICAL):** y < -1.5 (the bottom 25% of the screen). NEVER place any object, text, or arrow below y = -1.5. This area is strictly reserved for burned-in subtitles.

#### 2. KINETIC ANIMATION PRINCIPLES (SMOOTH & NATURAL MOTION):
1. **NO TOPOLOGICAL MORPHS:** Never use `Transform()` or `ReplacementTransform()` between completely different shapes (e.g. Circle to Square, or Text to Arrow). That causes awkward vertex warping. Instead, use choreographed exit and entry pairs:
   ```python
   self.play(
       FadeOut(old_mob, shift=DOWN * 0.25, scale=0.85),
       FadeIn(new_mob, shift=UP * 0.25, scale=1.05),
       run_time=0.6,
       rate_func=rush_from
   )
   ```
2. **MANDATORY STAGGERING (NO SYNCHRONIZED ROBOTIC POPS):**
   When revealing multiple elements (e.g. cards, labels, icons, indicators), NEVER spawn them all at the exact same instant. ALWAYS use `AnimationGroup` with `lag_ratio`:
   ```python
   self.play(
       AnimationGroup(
           FadeIn(box, shift=UP * 0.2),
           Write(title),
           FadeIn(icon, scale=0.5),
           lag_ratio=0.15,
           run_time=1.2
       )
   )
   ```
3. **INTENTIONAL EASINGS (RATE FUNCTIONS):**
   - **Entrances (Pops, slides, reveals):** Use `rate_func=rush_from` or `ease_out_cubic` for snappy arrivals that glide smoothly to a halt.
   - **Exits (Dismissing items):** Use `rate_func=rush_into` (accelerates out).
   - **Continuous transitions / motions:** Use `rate_func=smooth`.
   - **Emphasis & Callouts:** Use `Indicate(obj, color=YELLOW, scale_factor=1.15)` or `Circumscribe(obj)`.
4. **LIVING SCREEN (SECONDARY & AMBIENT MOTION):**
   - Avoid completely frozen screens where nothing moves for multiple seconds during long narration clauses.
   - During explanatory narration clauses, keep the visual alive with subtle secondary motion:
     - Ambient breathing: `self.play(diagram.animate.shift(UP * 0.08), run_time=wait_chunk, rate_func=there_and_back)`
     - Dynamic progress or values: `ValueTracker.animate.set_value(...)` with `always_redraw(DecimalNumber)`
     - Curved path travel: `MoveAlongPath` or tracing a dashed route with `Create()` or `ShowPassingFlash()`.
5. **AUDIO SYNCHRONIZATION BEATS:**
   - Use the provided `word_timestamps` to trigger key visual shifts right on the onset of their keyword.
   - Fast hook: Scene 1 MUST reveal its primary visual within the first 0.3 seconds.

#### 3. STRICT TIMING CONTRACT:
- You are provided `exact_duration_sec` and `word_timestamps`.
- The sum of all `run_time` and `self.wait()` calls in `construct(self)` MUST match `exact_duration_sec` within ±0.03 seconds.
- Maintain an accurate `elapsed = 0.0` accumulator. End every scene with:
  ```python
  remaining = max(0.05, exact_duration_sec - elapsed)
  self.wait(remaining)
  ```
- NEVER pass 0 or negative numbers to `self.wait()` or `run_time`.

#### 4. MANIM COMMUNITY v0.19+ CODE STABILITY:
- **Typography:** Use `Text("...", font="Arial")` or `Text("...")`. Use `weight=BOLD` for headers. Do NOT use `Tex()` or `MathTex()` unless strictly necessary for math equations.
- **VGroup Safety:** Always check `.width` and use `.scale_to_fit_width(min(mob.width, 6.0))` to prevent horizontal clipping.
- **Relative Positioning:** Anchor elements using `.next_to(target, DOWN, buff=0.25)` or `.shift()`.
- **Colors:** Use the provided `theme_palette` hex codes. Set `self.camera.background_color = theme_palette.background` at the beginning of `construct(self)`.
- **Class Naming:** Class name MUST be `GeneratedScene(Scene)`.

#### OUTPUT FORMAT:
Output ONLY a single Python code block (` ```python ... ``` `) containing the executable script.
```

---

### Agent 3: Code Execution Debugger & Self-Healing LLM
* **Recommended Model:** `gemini-4-hydrogen` or `claude-3-7-sonnet`
* **Role:** Triggered only when `python -m manim -ql scene.py GeneratedScene` returns a non-zero exit code.

```markdown
### SYSTEM PROMPT: MANIM COMMUNITY EXECUTION DEBUGGER

You are an automated Python & Manim Community (manim v0.19+) debugging specialist. The Manim script below failed during compilation or headless rendering with official Manim Community.

#### COMMON MANIM COMMUNITY v0.19+ PITFALLS TO CHECK:
- Using deprecated ManimGL syntax (e.g. `ShowCreation` instead of `Create`, `CONFIG = {...}` instead of `__init__`).
- Passing `width`/`height` to `Axes` instead of `x_length` and `y_length`.
- Trying to scale zero-width or empty groups with `scale_to_fit_width()`.
- Invalid rate function names or syntax in `.animate(rate_func=...)`.
- Calling `self.wait(0)` or negative wait time.
- Missing font or LaTeX errors: fallback to `Text("...", font="Arial")`.
- Unbound variable or syntax error in helper functions.

#### INSTRUCTIONS:
1. Identify the root cause from the traceback in a 1-sentence comment at the top of the file.
2. Fix the bug while preserving the `9:16` safe zone constraints (`x in [-3.2, 3.2]`, `y in [-1.4, 4.6]`, `header y=5.2`) and the exact total scene duration (`exact_duration_sec`).
3. Output ONLY the corrected, full Python script inside a ` ```python ... ``` ` block.
```

---

### Agent 4: Vision-LLM Layout & Aesthetic QA Inspector
* **Recommended Model:** `gemini-2.5-flash` or `gpt-4o` (Multimodal Vision)
* **Role:** Inspects 3 extracted PNG frames (at $25\%$, $60\%$, and $95\%$ of scene duration) from the low-res preview render before approving high-res rendering.

```markdown
### SYSTEM PROMPT: VISION QA LAYOUT INSPECTOR

You are an automated Visual Quality Assurance inspector for a 9:16 vertical animation pipeline. You are looking at 3 sequential frames extracted from a rendered Manim scene.

Evaluate the frames against the following strict visual criteria:
1. **Text Collision / Overlap:** Does any text overlap with another piece of text, a line, an arrow, or a shape border in a way that hurts legibility?
2. **Out-of-Bounds / Clipping:** Are any letters, shapes, or graph labels cut off by the left (`x = -4.0`) or right (`x = 4.0`) edges of the frame?
3. **Forbidden Bottom Zone Intrusion:** The bottom 25% of the vertical frame (below `y = -1.5`) must remain completely empty for subtitle burn-in. Are there any visual elements intruding into the bottom quarter of the image?
4. **Blank or Broken Visuals:** Are the frames completely black/empty when a diagram should be visible?

#### OUTPUT FORMAT:
Respond ONLY with a valid JSON object matching this exact schema:
```json
{
  "status": "PASS" | "FAIL",
  "issues_detected": [
    "The label 'Tokyo (TYO)' on the left side is clipped off the left edge of the screen in Frame 2.",
    "The curved cyan arrow overlaps directly on top of the header text at the top."
  ],
  "code_fix_instructions": "Scale the map VGroup down by 0.8x using `map_group.scale(0.8)` and move the 'TYO' label above the dot (`next_to(tyo_dot, UP)`) instead of `LEFT`."
}
```
If `status` is `"PASS"`, leave `issues_detected` empty and `code_fix_instructions` as `""`.
```

---

## 6. Reference Single-Entry-Point Orchestrator Blueprint

Below is the core Python orchestration pattern for `run_pipeline.py`, demonstrating how a single entry point provisions the per-video tracking directory, persists every intermediate component, and coordinates Stages 1 through 4:

```python
import argparse
import datetime
import json
import re
import shutil
import subprocess
from pathlib import Path

MAX_CODE_RETRIES = 3
MAX_VISION_RETRIES = 2


def provision_video_workspace(topic: str, base_dir: Path = Path("runs")) -> dict[str, Path]:
    """Creates a dedicated, structured folder for a single video generation run."""
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = re.sub(r"[^a-z0-9]+", "_", topic.lower()).strip("_")[:40]
    root = base_dir / f"{timestamp}_{slug}"

    dirs = {
        "root": root,
        "script": root / "01_script",
        "audio": root / "02_audio",
        "code": root / "03_code",
        "qa_frames": root / "04_qa_frames",
        "renders": root / "05_renders",
        "subtitles": root / "06_subtitles",
    }
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    return dirs


def render_and_validate_scene(scene_payload: dict, dirs: dict[str, Path]) -> Path:
    """
    Generates Manim code for a single scene, saves all intermediate attempts & QA frames
    into the video's tracking folder, and outputs a final 1080x1920@60fps MP4.
    """
    scene_id = scene_payload["scene_id"]
    script_path = dirs["code"] / f"scene_{scene_id:02d}.py"
    media_dir = dirs["renders"] / f"manim_cache_{scene_id:02d}"

    # 1. Initial Code Generation (Agent 2)
    code = call_manim_coder_llm(scene_payload)
    script_path.write_text(code)

    for vision_attempt in range(MAX_VISION_RETRIES + 1):
        # 2. Execution & Compiler Self-Healing Loop (Agent 3)
        for code_attempt in range(MAX_CODE_RETRIES):
            (dirs["code"] / f"scene_{scene_id:02d}_v{vision_attempt}_c{code_attempt}.py").write_text(code)
            cmd = [
                "manim", "-ql", "--fps", "15",
                "-r", "540,960",
                "--media_dir", str(media_dir),
                str(script_path), "GeneratedScene"
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)

            if proc.returncode == 0:
                break

            code = call_debugger_llm(
                scene_payload=scene_payload,
                broken_code=code,
                stderr_traceback=proc.stderr
            )
            script_path.write_text(code)
        else:
            raise RuntimeError(f"Scene {scene_id} failed compilation after {MAX_CODE_RETRIES} retries.")

        # 3. Extract 3 preview frames into `04_qa_frames/` & run Vision QA (Agent 4)
        preview_mp4 = next(media_dir.rglob("GeneratedScene.mp4"))
        frames = extract_qa_frames(
            preview_mp4,
            out_dir=dirs["qa_frames"],
            prefix=f"scene_{scene_id:02d}_attempt_{vision_attempt}",
            timestamps=[0.25, 0.60, 0.95]
        )

        qa_result = call_vision_qa_llm(frames, scene_payload)
        if qa_result["status"] == "PASS":
            break

        code = call_layout_fixer_llm(
            scene_payload=scene_payload,
            current_code=code,
            vision_critique=qa_result["code_fix_instructions"]
        )
        script_path.write_text(code)

    # 4. Final High-Resolution Render (1080x1920 @ 60fps)
    final_media_dir = dirs["renders"] / f"manim_final_{scene_id:02d}"
    final_cmd = [
        "manim", "-qh", "--fps", "60",
        "-r", "1080,1920",
        "--media_dir", str(final_media_dir),
        str(script_path), "GeneratedScene"
    ]
    subprocess.run(final_cmd, check=True)

    rendered_mp4 = next(final_media_dir.rglob("GeneratedScene.mp4"))
    target_raw_mp4 = dirs["renders"] / f"raw_scene_{scene_id:02d}.mp4"
    shutil.copy2(rendered_mp4, target_raw_mp4)
    return target_raw_mp4


def run_pipeline(topic: str, voice: str = "en-US-AndrewNeural") -> Path:
    """Single entry point executing Stages 0 -> 4 inside one isolated video folder."""
    dirs = provision_video_workspace(topic)
    manifest = {"topic": topic, "voice": voice, "status": "IN_PROGRESS", "scenes": []}
    (dirs["root"] / "manifest.json").write_text(json.dumps(manifest, indent=2))

    # Stage 1: Generate & persist storyboard JSON
    storyboard = call_storyboard_director_llm(topic)
    (dirs["script"] / "storyboard.json").write_text(json.dumps(storyboard, indent=2))

    # Stage 2: Generate per-scene TTS WAVs & word timestamps
    aligned_scenes = generate_audio_and_alignment(storyboard, out_audio_dir=dirs["audio"], voice=voice)
    (dirs["script"] / "aligned_storyboard.json").write_text(json.dumps(aligned_scenes, indent=2))
    (dirs["subtitles"] / "full_transcript.txt").write_text(
        "\n\n".join(s["narration"] for s in aligned_scenes)
    )

    # Stage 3: Render & validate every scene into `05_renders/`
    muxed_clips = []
    for scene_payload in aligned_scenes:
        raw_mp4 = render_and_validate_scene(scene_payload, dirs)
        muxed_mp4 = mux_scene_audio_video(
            video_path=raw_mp4,
            audio_path=Path(scene_payload["audio_file_path"]),
            out_path=dirs["renders"] / f"muxed_scene_{scene_payload['scene_id']:02d}.mp4"
        )
        muxed_clips.append(muxed_mp4)

    # Stage 4: Build `.ass` subtitles, concatenate scenes, mix music, & save `final_short.mp4`
    ass_path = generate_ass_subtitles(aligned_scenes, out_dir=dirs["subtitles"])
    final_video = dirs["root"] / "final_short.mp4"
    composite_master_video(muxed_clips, ass_path, dirs["renders"], final_video)

    manifest["status"] = "COMPLETED"
    manifest["final_video"] = str(final_video)
    (dirs["root"] / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return final_video


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Single entry point for Automated Short-Form Video Pipeline")
    parser.add_argument("--topic", required=True, help="Video topic or prompt")
    parser.add_argument("--voice", default="en-US-AndrewNeural", help="TTS voice identifier")
    args = parser.parse_args()

    output_path = run_pipeline(topic=args.topic, voice=args.voice)
    print(f"Pipeline complete. All artifacts and final render saved to: {output_path.parent}")
```

---

## 7. Post-Processing & Subtitle Compositing (Stage 4)

All Stage 4 artifacts are written directly inside the active video's `05_renders/`, `06_subtitles/`, and root folders:

1. **Audio-Video Muxing per Scene:** Merge `02_audio/scene_01.wav` with `05_renders/raw_scene_01.mp4` into `05_renders/muxed_scene_01.mp4` using `ffmpeg -i raw_scene_01.mp4 -i scene_01.wav -c:v copy -c:a aac muxed_scene_01.mp4`. Doing this *per scene* guarantees zero cumulative audio drift across the full video.
2. **Scene Concatenation:** Write `05_renders/concat_list.txt` and run the FFmpeg `concat` demuxer (`ffmpeg -f concat -safe 0 -i 05_renders/concat_list.txt -c copy 05_renders/combined_silent_subs.mp4`) or `xfade` filter with a `0.15s` whoosh SFX transition between scenes.
3. **Dynamic Word-Level Subtitles (`.ass`):** Save `06_subtitles/word_timestamps.json` and convert it into `06_subtitles/captions.ass` positioned at `Alignment=2` (bottom center, `MarginV=380`), which lands squarely inside the `y in [-5.0, -2.0]` caption safe zone.
4. **Final Master Render:** Burn in subtitles, mix background audio, and write `final_short.mp4` at the root of the video's run folder:
   ```bash
   ffmpeg -i 05_renders/combined_silent_subs.mp4 -i assets/bg_music.mp3 \
     -filter_complex "[1:a]volume=-22dB,aloop=loop=-1:size=2e+09[bg];[0:a][bg]amix=inputs=2:duration=first[aout];[0:v]ass=06_subtitles/captions.ass[vout]" \
     -map "[vout]" -map "[aout]" -c:v libx264 -crf 18 -preset fast final_short.mp4
   ```