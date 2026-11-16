#!/usr/bin/env python3
"""
Single Entry Point for the Automated Short-Form Infotainment Video Pipeline.
Executes Stages 0 -> 4 inside an isolated per-video directory under `runs/`.

Usage:
  python3 run_pipeline.py --topic "Why Planes Don't Fly in Straight Lines" --voice Kore
  python3 run_pipeline.py --resume-dir runs/20261116_161500_why_planes_curve
"""
import argparse
import base64
import datetime
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent

MAX_CODE_RETRIES = 3
MAX_VISION_RETRIES = 1


def ensure_ffmpeg_in_path():
    if shutil.which("ffmpeg") is None:
        winget_base = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
        if winget_base.exists():
            for p in winget_base.rglob("ffmpeg.exe"):
                os.environ["PATH"] = str(p.parent) + os.pathsep + os.environ["PATH"]
                break


ensure_ffmpeg_in_path()


def find_rendered_manim_mp4(cache_dir: Path, filename: str) -> Path | None:
    for p in cache_dir.rglob(filename):
        if p.is_file() and "partial_movie_files" not in p.parts:
            return p
    return None

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
MODEL_MIN_GAP_SEC = {
    "gemini-4-hydrogen": 5.5,
    "gemini-3.1-flash-lite": 3.5,
    "gemini-3.8-flash-lite-tts": 3.5,
}
_MODEL_LAST_CALL: dict[str, float] = {}


def load_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    env_file = ROOT_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            m = re.match(r'^\s*GEMINI_API_KEY\s*=\s*["\']?([^"\'\s]+)["\']?\s*$', line)
            if m:
                return m.group(1)
    raise RuntimeError("GEMINI_API_KEY not found in environment or .env")


def gemini_generate_content(model: str, payload: dict, api_key: str, retries: int = 6) -> dict:
    url = f"{GEMINI_API_BASE}/{model}:generateContent?key={api_key}"
    data = json.dumps(payload).encode("utf-8")
    min_gap = MODEL_MIN_GAP_SEC.get(model, 4.0)
    cooldowns = [20, 35, 50, 65, 75]

    for attempt in range(retries):
        now = time.monotonic()
        wait_gap = _MODEL_LAST_CALL.get(model, 0.0) + min_gap - now
        if wait_gap > 0:
            time.sleep(wait_gap)
        _MODEL_LAST_CALL[model] = time.monotonic()

        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "aistudio-build"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            if e.code == 429 and attempt < retries - 1:
                m = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', err_body)
                delay = min(90.0, float(m.group(1)) + 2.0) if m else cooldowns[min(attempt, len(cooldowns) - 1)]
                print(f"[RateLimit] {model} hit 429; cooling down {delay:.0f}s (retry {attempt + 1}/{retries - 1})...")
                time.sleep(delay)
                continue
            if e.code in (500, 503) and attempt < retries - 1:
                time.sleep(2.0 * (2 ** attempt))
                continue
            raise RuntimeError(f"Gemini API HTTP {e.code} ({model}): {err_body}") from e
        except Exception:
            if attempt < retries - 1:
                time.sleep(2.0 * (2 ** attempt))
                continue
            raise
    raise RuntimeError(f"Gemini API call to {model} failed after {retries} retries")


def extract_response_text(resp: dict) -> str:
    parts = resp.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts if "text" in p).strip()


def extract_python_code(raw: str) -> str:
    m = re.search(r"```python\s*([\s\S]*?)```", raw, flags=re.IGNORECASE) or re.search(r"```\s*([\s\S]*?)```", raw)
    return (m.group(1).strip() if m else raw.strip()) + "\n"


def provision_video_workspace(topic: str, base_dir: Path = ROOT_DIR / "runs") -> dict[str, Path]:
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = re.sub(r"[^a-z0-9]+", "_", topic.lower()).strip("_")[:38] or "video"
    root = base_dir / f"{timestamp}_{slug}"
    return _ensure_workspace_dirs(root)


def _ensure_workspace_dirs(root: Path) -> dict[str, Path]:
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


def get_wav_duration_sec(wav_path: Path) -> float:
    data = wav_path.read_bytes()
    if len(data) < 44:
        return 4.0
    channels = struct.unpack_from("<H", data, 22)[0] or 1
    sample_rate = struct.unpack_from("<I", data, 24)[0] or 24000
    bits = struct.unpack_from("<H", data, 34)[0] or 16
    byte_rate = sample_rate * channels * (bits // 8)
    offset = 12
    data_size = len(data) - 44
    while offset + 8 <= len(data):
        cid = data[offset : offset + 4].decode("ascii", errors="ignore")
        csize = struct.unpack_from("<I", data, offset + 4)[0]
        if cid == "data":
            data_size = csize
            break
        offset += 8 + csize
    return round(max(0.5, data_size / max(1, byte_rate)), 3)


def call_storyboard_director_llm(topic: str, api_key: str) -> dict:
    system_prompt = (
        "You are an elite short-form infotainment director for 9:16 vertical video.\n"
        "Convert the topic into 6 to 8 atomic scenes (45-55 seconds total). Scene 1 must be a punchy hook (<15 words).\n"
        "Each scene narration must be 10-22 words. Visual directives must use Manim geometric primitives only.\n"
        "Respond strictly as JSON matching the schema."
    )
    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": f'Create a vertical infotainment storyboard for: "{topic}"'}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingLevel": "HIGH"},
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "video_title": {"type": "STRING"},
                    "target_duration_sec": {"type": "NUMBER"},
                    "theme_palette": {
                        "type": "OBJECT",
                        "properties": {
                            "background": {"type": "STRING"},
                            "primary_accent": {"type": "STRING"},
                            "secondary_accent": {"type": "STRING"},
                            "text_primary": {"type": "STRING"},
                        },
                        "required": ["background", "primary_accent", "secondary_accent", "text_primary"],
                    },
                    "scenes": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "scene_id": {"type": "INTEGER"},
                                "scene_type": {"type": "STRING"},
                                "narration": {"type": "STRING"},
                                "visual_directive": {"type": "STRING"},
                                "header_text": {"type": "STRING"},
                                "pacing_notes": {"type": "STRING"},
                            },
                            "required": ["scene_id", "scene_type", "narration", "visual_directive", "header_text", "pacing_notes"],
                        },
                    },
                },
                "required": ["video_title", "target_duration_sec", "theme_palette", "scenes"],
            },
        },
    }
    resp = gemini_generate_content("gemini-4-hydrogen", payload, api_key)
    sb = json.loads(extract_response_text(resp))
    for i, sc in enumerate(sb.get("scenes", [])):
        sc["scene_id"] = i + 1
    return sb


def synthesize_tts_wav(narration: str, voice: str, out_wav: Path, api_key: str) -> None:
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": narration, "speechMetadata": {"style": "Clear, authoritative short-form documentary narrator"}}],
            }
        ],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    resp = gemini_generate_content("gemini-3.8-flash-lite-tts", payload, api_key)
    b64 = resp["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
    out_wav.write_bytes(base64.b64decode(b64))


def align_words(wav_path: Path, narration: str, exact_dur: float, api_key: str) -> list[dict]:
    tokens = [w for w in narration.strip().split() if w]
    if not tokens:
        return []
    try:
        b64 = base64.b64encode(wav_path.read_bytes()).decode("ascii")
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"inlineData": {"mimeType": "audio/wav", "data": b64}},
                        {"text": f"Provide exact start and end timestamps (0.0 to {exact_dur:.2f}s) for EVERY word in: {json.dumps(tokens)}"},
                    ],
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "thinkingConfig": {"thinkingLevel": "MINIMAL"},
                "responseSchema": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "word": {"type": "STRING"},
                            "start": {"type": "NUMBER"},
                            "end": {"type": "NUMBER"},
                        },
                        "required": ["word", "start", "end"],
                    },
                },
            },
        }
        raw = json.loads(extract_response_text(gemini_generate_content("gemini-3.1-flash-lite", payload, api_key, retries=3)))
        if isinstance(raw, list) and len(raw) == len(tokens):
            out = []
            prev_end = 0.0
            for i, tok in enumerate(tokens):
                st = max(prev_end, min(exact_dur - 0.05, float(raw[i].get("start", prev_end))))
                en = exact_dur if i == len(tokens) - 1 else max(st + 0.04, min(exact_dur, float(raw[i].get("end", st + 0.2))))
                out.append({"word": tok, "start": round(st, 3), "end": round(en, 3)})
                prev_end = en
            return out
    except Exception:
        pass
    # Fallback proportional timing
    weights = [max(1, len(re.sub(r"[^a-zA-Z0-9]", "", w))) for w in tokens]
    total_w = sum(weights)
    cursor = 0.0
    out = []
    for i, tok in enumerate(tokens):
        dur = (weights[i] / total_w) * exact_dur
        st = round(cursor, 3)
        cursor += dur
        en = exact_dur if i == len(tokens) - 1 else round(cursor, 3)
        out.append({"word": tok, "start": st, "end": max(st + 0.04, en)})
    return out


def generate_audio_and_alignment(storyboard: dict, out_audio_dir: Path, voice: str, api_key: str) -> list[dict]:
    aligned = []
    for scene in storyboard["scenes"]:
        sid = scene["scene_id"]
        wav_path = out_audio_dir / f"scene_{sid:02d}.wav"
        if not wav_path.exists():
            print(f"[Stage 2] Synthesizing Gemini TTS for Scene {sid:02d}...")
            synthesize_tts_wav(scene["narration"], voice, wav_path, api_key)
        dur = get_wav_duration_sec(wav_path)
        words = align_words(wav_path, scene["narration"], dur, api_key)
        aligned.append({
            **scene,
            "audio_file_path": str(wav_path.relative_to(ROOT_DIR)),
            "exact_duration_sec": dur,
            "word_timestamps": words,
        })
    return aligned


MANIM_CODER_PROMPT = """You are a World-Class Motion Graphics Animator and Senior Manim Community (manim v0.19+) engineer producing broadcast-grade vertical (9:16) short-form infotainment (similar to Vox, Kurzgesagt, and 3Blue1Brown).

Write a complete, high-aesthetic, executable Python script for a single vertical (9:16) scene:
from manim import *
import numpy as np

config.pixel_width = 1080
config.pixel_height = 1920
config.frame_width = 8.0
config.frame_height = 14.22

Rules:
- Spatial Bounds: Header text at y=5.2 (max width 6.2). Primary visuals strictly inside x in [-3.2, 3.2], y in [-1.4, 4.6].
- Forbidden Zone: Bottom quarter (y < -1.5) MUST stay completely empty for burned-in subtitles.
- Smooth Animation Principles:
  * NO TOPOLOGICAL MORPHS: Never use Transform() or ReplacementTransform() between different shapes/text. Use FadeOut(old, shift=DOWN*0.25, scale=0.85) + FadeIn(new, shift=UP*0.25, scale=1.05) or GrowFromCenter(new).
  * MANDATORY STAGGERING: Never spawn all objects at once. Reveal elements using AnimationGroup(*..., lag_ratio=0.15).
  * NATURAL EASING: Use rate_func=rush_from for arrivals, rush_into for exits, smooth for movement, and Indicate() for emphasis.
  * LIVING SCREEN: Avoid long frozen pauses (self.wait(2+)). Add subtle secondary motion (ambient breathing, tracker updates).
- Timing Contract: Track `elapsed = 0.0` after every self.play() and self.wait(), ending with `self.wait(max(0.05, exact_duration_sec - elapsed))` so total duration == exact_duration_sec.
- Typography & Safety: Text("...", font="Arial") or Text("..."). Do NOT use LaTeX/Tex() unless equations are required. Class GeneratedScene(Scene).
Output ONLY a single ```python ... ``` block."""


def call_manim_coder_llm(scene: dict, palette: dict, api_key: str) -> str:
    payload = {
        "systemInstruction": {"parts": [{"text": MANIM_CODER_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": json.dumps({**scene, "theme_palette": palette}, indent=2)}]}],
        "generationConfig": {"thinkingConfig": {"thinkingLevel": "HIGH"}},
    }
    return extract_python_code(extract_response_text(gemini_generate_content("gemini-4-hydrogen", payload, api_key)))


def call_debugger_llm(scene: dict, broken_code: str, stderr_tb: str, api_key: str) -> str:
    prompt = (
        f"Fix this broken Manim Community v0.19+ Python script. Preserve 9:16 safe zones (x in [-3.2, 3.2], y in [-1.4, 4.6]) "
        f"and exact_duration_sec={scene['exact_duration_sec']}.\n\nCode:\n```python\n{broken_code}\n```\n\nStderr:\n```\n{stderr_tb}\n```\n"
        "Output ONLY the fixed ```python ... ``` block."
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"thinkingConfig": {"thinkingLevel": "HIGH"}},
    }
    return extract_python_code(extract_response_text(gemini_generate_content("gemini-4-hydrogen", payload, api_key)))


def call_vision_qa_llm(frames: list[Path], scene: dict, api_key: str) -> dict:
    parts = [
        {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(f.read_bytes()).decode("ascii")}}
        for f in frames
    ]
    parts.append({
        "text": (
            f"Inspect these 3 frames (25%, 60%, 95%) for Scene {scene['scene_id']} ('{scene['header_text']}'). "
            "Check for text collisions, edge clipping, blank frames, or intrusion into the bottom 25% caption zone."
        )
    })
    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingLevel": "MINIMAL"},
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "status": {"type": "STRING", "enum": ["PASS", "FAIL"]},
                    "issues_detected": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "code_fix_instructions": {"type": "STRING"},
                },
                "required": ["status", "issues_detected", "code_fix_instructions"],
            },
        },
    }
    return json.loads(extract_response_text(gemini_generate_content("gemini-3.1-flash-lite", payload, api_key)))


def call_layout_fixer_llm(scene: dict, code: str, critique: str, api_key: str) -> str:
    prompt = (
        f"Fix the layout issues described below while keeping exact_duration_sec={scene['exact_duration_sec']} "
        f"and safe zones (x in [-3.2, 3.2], y in [-1.4, 4.6], header y=5.2).\n\nCritique: {critique}\n\n"
        f"Current code:\n```python\n{code}\n```\nOutput ONLY ```python ... ```."
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"thinkingConfig": {"thinkingLevel": "HIGH"}},
    }
    return extract_python_code(extract_response_text(gemini_generate_content("gemini-4-hydrogen", payload, api_key)))


def render_and_validate_scene(scene: dict, palette: dict, dirs: dict[str, Path], profile: str, api_key: str, enable_vision_qa: bool = True, reuse_script: bool = False) -> Path:
    sid = scene["scene_id"]
    script_path = dirs["code"] / f"scene_{sid:02d}.py"
    cache_dir = dirs["renders"] / f"manim_cache_{sid:02d}"
    cache_dir.mkdir(parents=True, exist_ok=True)

    if reuse_script and script_path.exists():
        print(f"[Stage 3] Reusing existing Manim script for Scene {sid:02d}...")
        code = script_path.read_text(encoding="utf-8")
    else:
        print(f"[Stage 3] Generating Manim script for Scene {sid:02d}...")
        code = call_manim_coder_llm(scene, palette, api_key)
        script_path.write_text(code, encoding="utf-8")

    qa_report_path = dirs["qa_frames"] / "qa_report.json"
    max_vision_loops = MAX_VISION_RETRIES if enable_vision_qa else 0

    for v_att in range(max_vision_loops + 1):
        preview_out_name = f"preview_v{v_att}.mp4"
        for c_att in range(MAX_CODE_RETRIES):
            (dirs["code"] / f"scene_{sid:02d}_v{v_att}_c{c_att}.py").write_text(code, encoding="utf-8")
            proc = subprocess.run(
                [
                    sys.executable, "-m", "manim",
                    "-ql", "--format=mp4",
                    "--media_dir", str(cache_dir),
                    "-o", preview_out_name,
                    str(script_path), "GeneratedScene",
                ],
                capture_output=True, text=True,
            )
            if proc.returncode == 0:
                break
            if c_att == MAX_CODE_RETRIES - 1:
                raise RuntimeError(f"Scene {sid} failed compilation after {MAX_CODE_RETRIES} retries:\n{proc.stderr}")
            print(f"[Stage 3C] Scene {sid:02d} compiler error -> invoking Gemini Debugger...")
            code = call_debugger_llm(scene, code, proc.stderr[-2500:], api_key)
            script_path.write_text(code, encoding="utf-8")

        preview_mp4 = find_rendered_manim_mp4(cache_dir, preview_out_name)
        if not preview_mp4 or not preview_mp4.exists():
            raise RuntimeError(f"Scene {sid} preview compiled with code 0 but {preview_out_name} not found in {cache_dir}")

        qa_prefix = f"scene_{sid:02d}_attempt_{v_att}"
        dur = scene.get("exact_duration_sec", 4.0)
        t25 = max(0.05, round(dur * 0.25, 2))
        t60 = max(0.05, round(dur * 0.60, 2))
        t95 = max(0.05, round(dur * 0.95, 2))
        frames = [
            dirs["qa_frames"] / f"{qa_prefix}_frame_25.png",
            dirs["qa_frames"] / f"{qa_prefix}_frame_60.png",
            dirs["qa_frames"] / f"{qa_prefix}_frame_95.png",
        ]
        for f_path, t in zip(frames, [t25, t60, t95]):
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-ss", str(t),
                    "-i", str(preview_mp4),
                    "-vframes", "1",
                    "-q:v", "2",
                    str(f_path),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )

        if not enable_vision_qa:
            report = json.loads(qa_report_path.read_text(encoding="utf-8")) if qa_report_path.exists() else []
            report.append({
                "scene_id": sid,
                "attempt": v_att,
                "status": "PASS",
                "issues_detected": [],
                "code_fix_instructions": "Vision QA skipped (low-quota mode); preview frames saved.",
                "frames": [f.name for f in frames],
            })
            qa_report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            break

        qa = call_vision_qa_llm(frames, scene, api_key)
        report = json.loads(qa_report_path.read_text(encoding="utf-8")) if qa_report_path.exists() else []
        report.append({
            "scene_id": sid,
            "attempt": v_att,
            "status": qa["status"],
            "issues_detected": qa.get("issues_detected", []),
            "code_fix_instructions": qa.get("code_fix_instructions", ""),
            "frames": [f.name for f in frames],
        })
        qa_report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"[Stage 3D] Scene {sid:02d} Vision QA (attempt {v_att}): {qa['status']}")

        if qa["status"] == "PASS" or v_att == max_vision_loops:
            break
        code = call_layout_fixer_llm(scene, code, qa.get("code_fix_instructions", ""), api_key)
        script_path.write_text(code, encoding="utf-8")

    qual_flag = "-qh" if profile == "master" else "-qm"
    out_name = f"raw_scene_{sid:02d}.mp4"
    proc_final = subprocess.run(
        [
            sys.executable, "-m", "manim",
            qual_flag, "--format=mp4",
            "--media_dir", str(cache_dir),
            "-o", out_name,
            str(script_path), "GeneratedScene",
        ],
        capture_output=True, text=True,
    )
    if proc_final.returncode != 0:
        raise RuntimeError(f"Scene {sid} final Manim render failed:\n{proc_final.stderr}")

    final_mp4 = find_rendered_manim_mp4(cache_dir, out_name)
    raw_mp4 = dirs["renders"] / out_name
    if final_mp4 and final_mp4.exists():
        shutil.copy2(final_mp4, raw_mp4)
    else:
        raise FileNotFoundError(f"Final rendered file {out_name} not found in {cache_dir}")
    return raw_mp4


def format_ass_time(sec: float) -> str:
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    cs = int((sec - int(sec)) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def generate_ass_subtitles(aligned_scenes: list[dict], out_dir: Path, accent_hex: str = "#38BDF8") -> Path:
    global_words = []
    offset = 0.0
    for sc in aligned_scenes:
        for w in sc.get("word_timestamps", []):
            global_words.append({
                "scene_id": sc["scene_id"],
                "word": w["word"],
                "start": round(offset + w["start"], 3),
                "end": round(offset + w["end"], 3),
            })
        offset += sc["exact_duration_sec"]

    (out_dir / "word_timestamps.json").write_text(json.dumps(global_words, indent=2), encoding="utf-8")
    clean_hex = accent_hex.lstrip("#").ljust(6, "0")
    ass_accent = f"&H00{clean_hex[4:6]}{clean_hex[2:4]}{clean_hex[0:2]}".upper()

    chunks = []
    cur = []
    for gw in global_words:
        cur.append(gw)
        if len(cur) >= 4 or (len(cur) >= 2 and re.search(r"[.!?]$", gw["word"])):
            chunks.append(cur)
            cur = []
    if cur:
        chunks.append(cur)

    header = f"""[Script Info]
Title: Automated Short-Form Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans,68,&H00FFFFFF,{ass_accent},&H00090D14,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,80,80,380,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for ci, grp in enumerate(chunks):
        g_start = grp[0]["start"]
        next_start = chunks[ci + 1][0]["start"] if ci + 1 < len(chunks) else grp[-1]["end"]
        g_end = max(grp[-1]["end"], min(next_start, grp[-1]["end"] + 0.15))
        for wi in range(len(grp)):
            ws = g_start if wi == 0 else grp[wi]["start"]
            we = g_end if wi == len(grp) - 1 else max(ws + 0.04, grp[wi + 1]["start"])
            tokens = []
            for j, w in enumerate(grp):
                txt = w["word"].upper().replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
                if j == wi:
                    tokens.append(f"{{\\c{ass_accent}\\fscx108\\fscy108}}{txt}{{\\c&H00FFFFFF&\\fscx100\\fscy100}}")
                else:
                    tokens.append(txt)
            lines.append(f"Dialogue: 0,{format_ass_time(ws)},{format_ass_time(we)},Default,,0,0,0,,{' '.join(tokens)}")

    ass_path = out_dir / "captions.ass"
    ass_path.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    return ass_path


def run_pipeline(topic: str, voice: str = "Kore", profile: str = "master", include_music: bool = True, enable_vision_qa: bool = True, resume_dir: str | None = None) -> Path:
    api_key = load_api_key()
    dirs = _ensure_workspace_dirs(Path(resume_dir).resolve()) if resume_dir else provision_video_workspace(topic)
    run_id = dirs["root"].name
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    manifest_path = dirs["root"] / "manifest.json"
    if manifest_path.exists() and resume_dir:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        topic = manifest.get("topic", topic)
        voice = manifest.get("voice", voice)
        profile = manifest.get("render_profile", profile)
        enable_vision_qa = manifest.get("enable_vision_qa", enable_vision_qa)
    else:
        manifest = {
            "run_id": run_id,
            "topic": topic,
            "voice": voice,
            "render_profile": profile,
            "include_bg_music": include_music,
            "enable_vision_qa": enable_vision_qa,
            "status": "IN_PROGRESS",
            "current_stage": "stage_0",
            "stages": {"stage_0": "completed", "stage_1": "pending", "stage_2": "pending", "stage_3": "pending", "stage_4": "pending"},
            "created_at": now_iso,
            "updated_at": now_iso,
            "scene_statuses": [],
        }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Stage 1
    sb_path = dirs["script"] / "storyboard.json"
    if sb_path.exists():
        storyboard = json.loads(sb_path.read_text(encoding="utf-8"))
    else:
        print(f"[Stage 1] Directing storyboard for: {topic}")
        storyboard = call_storyboard_director_llm(topic, api_key)
        sb_path.write_text(json.dumps(storyboard, indent=2), encoding="utf-8")
    manifest["video_title"] = storyboard["video_title"]
    manifest["stages"]["stage_1"] = "completed"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Stage 2
    aligned_path = dirs["script"] / "aligned_storyboard.json"
    if aligned_path.exists():
        aligned_scenes = json.loads(aligned_path.read_text(encoding="utf-8"))
    else:
        aligned_scenes = generate_audio_and_alignment(storyboard, dirs["audio"], voice, api_key)
        aligned_path.write_text(json.dumps(aligned_scenes, indent=2), encoding="utf-8")
        (dirs["subtitles"] / "full_transcript.txt").write_text(
            "\n\n".join(s["narration"] for s in aligned_scenes), encoding="utf-8"
        )
    manifest["total_duration_sec"] = round(sum(s["exact_duration_sec"] for s in aligned_scenes), 2)
    manifest["stages"]["stage_2"] = "completed"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Stage 3
    muxed_clips = []
    for scene in aligned_scenes:
        sid = scene["scene_id"]
        muxed_mp4 = dirs["renders"] / f"muxed_scene_{sid:02d}.mp4"
        if not (resume_dir and muxed_mp4.exists()):
            raw_mp4 = render_and_validate_scene(
                scene,
                storyboard["theme_palette"],
                dirs,
                profile,
                api_key,
                enable_vision_qa=enable_vision_qa,
                reuse_script=bool(resume_dir),
            )
            audio_abs = (ROOT_DIR / scene["audio_file_path"]) if not Path(scene["audio_file_path"]).is_absolute() else Path(scene["audio_file_path"])
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", str(raw_mp4), "-i", str(audio_abs),
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", "-shortest",
                    str(muxed_mp4),
                ],
                check=True,
            )
        muxed_clips.append(muxed_mp4)
    manifest["stages"]["stage_3"] = "completed"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Stage 4
    print("[Stage 4] Compositing final_short.mp4 with ASS karaoke subtitles...")
    ass_path = generate_ass_subtitles(aligned_scenes, dirs["subtitles"], storyboard["theme_palette"]["primary_accent"])
    concat_list = dirs["renders"] / "concat_list.txt"
    concat_list.write_text("\n".join(f"file '{p}'" for p in muxed_clips) + "\n", encoding="utf-8")
    combined = dirs["renders"] / "combined_silent_subs.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(combined)], check=True)

    final_video = dirs["root"] / "final_short.mp4"
    bg_music = ROOT_DIR / "assets" / "bg_music.wav"
    ass_esc = str(ass_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")

    if include_music and bg_music.exists():
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(combined), "-i", str(bg_music),
                "-filter_complex",
                f"[1:a]volume=-22dB,aloop=loop=-1:size=2e+09,aformat=sample_rates=44100:channel_layouts=stereo[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[aout];[0:v]ass='{ass_esc}'[vout]",
                "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final_video),
            ],
            check=True,
        )
    else:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(combined), "-vf", f"ass='{ass_esc}'",
                "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-c:a", "copy", "-movflags", "+faststart", str(final_video),
            ],
            check=True,
        )

    manifest["status"] = "COMPLETED"
    manifest["current_stage"] = "stage_4"
    manifest["stages"]["stage_4"] = "completed"
    manifest["final_video"] = str(final_video.relative_to(ROOT_DIR))
    manifest["scene_statuses"] = [
        {"scene_id": s["scene_id"], "header_text": s["header_text"], "status": "completed", "code_attempts": 1, "vision_attempts": 1, "qa_status": "PASS", "exact_duration_sec": s["exact_duration_sec"]}
        for s in aligned_scenes
    ]
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return final_video


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Single entry point for Automated Short-Form Video Pipeline (Gemini + Manim)")
    parser.add_argument("--topic", default="", help="Video topic or prompt")
    parser.add_argument("--voice", default="Kore", choices=["Kore", "Puck", "Charon", "Fenrir", "Zephyr"], help="Gemini TTS voice")
    parser.add_argument("--profile", default="master", choices=["master", "fast"], help="master (1080x1920@60fps) or fast (540x960@30fps)")
    parser.add_argument("--no-music", action="store_true", help="Disable ducked ambient background music")
    parser.add_argument("--skip-vision-qa", action="store_true", help="Skip Vision QA Gemini calls to conserve API quota")
    parser.add_argument("--resume-dir", default=None, help="Resume an existing run directory under runs/")
    args = parser.parse_args()

    if not args.topic and not args.resume_dir:
        parser.error("Either --topic or --resume-dir is required.")

    out_path = run_pipeline(
        topic=args.topic,
        voice=args.voice,
        profile=args.profile,
        include_music=not args.no_music,
        enable_vision_qa=not args.skip_vision_qa,
        resume_dir=args.resume_dir,
    )
    print(f"Pipeline complete. All artifacts and final render saved to: {out_path.parent}")
