import fs from "node:fs";
import path from "node:path";
import type { AlignedScene, GlobalWordTimestamp } from "../types.ts";

function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const cs = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(txt: string): string {
  return txt.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

/**
 * Generates `word_timestamps.json` (global timeline offsets) and `captions.ass`
 * positioned squarely inside the bottom safe zone (Alignment=2, MarginV=380 on 1080x1920).
 */
export function generateAssSubtitles(
  alignedScenes: AlignedScene[],
  outDir: string,
  accentHex: string = "#38BDF8"
): { assPath: string; wordTimestampsPath: string; globalWords: GlobalWordTimestamp[]; assContent: string } {
  fs.mkdirSync(outDir, { recursive: true });

  const globalWords: GlobalWordTimestamp[] = [];
  let offset = 0;

  for (const scene of alignedScenes) {
    const words = scene.word_timestamps || [];
    for (const w of words) {
      globalWords.push({
        scene_id: scene.scene_id,
        word: w.word,
        start: Number((offset + w.start).toFixed(3)),
        end: Number((offset + w.end).toFixed(3)),
      });
    }
    offset += scene.exact_duration_sec;
  }

  const wordTimestampsPath = path.join(outDir, "word_timestamps.json");
  fs.writeFileSync(wordTimestampsPath, JSON.stringify(globalWords, null, 2), "utf8");

  // Convert #RRGGBB to ASS &H00BBGGRR
  const cleanHex = accentHex.replace("#", "").padStart(6, "0");
  const r = cleanHex.slice(0, 2);
  const g = cleanHex.slice(2, 4);
  const b = cleanHex.slice(4, 6);
  const assAccent = `&H00${b}${g}${r}`.toUpperCase();

  // Group into crisp 3-4 word chunks for high-retention short-form readability
  const chunks: GlobalWordTimestamp[][] = [];
  let current: GlobalWordTimestamp[] = [];
  for (const gw of globalWords) {
    current.push(gw);
    const endsSentence = /[.!?]$/.test(gw.word);
    if (current.length >= 4 || (current.length >= 2 && endsSentence)) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }

  const header = `[Script Info]
Title: Automated Short-Form Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans,68,&H00FFFFFF,${assAccent},&H00090D14,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,80,80,380,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];
  for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
    const group = chunks[cIdx];
    const groupStart = group[0].start;
    const nextGroupStart = cIdx + 1 < chunks.length ? chunks[cIdx + 1][0].start : group[group.length - 1].end;
    const groupEnd = Math.max(group[group.length - 1].end, Math.min(nextGroupStart, group[group.length - 1].end + 0.15));

    // Render word-by-word highlight sweeps inside this chunk
    for (let wIdx = 0; wIdx < group.length; wIdx++) {
      const wStart = wIdx === 0 ? groupStart : group[wIdx].start;
      const wEnd = wIdx === group.length - 1 ? groupEnd : Math.max(wStart + 0.04, group[wIdx + 1].start);

      const lineTokens = group.map((w, idx) => {
        const escaped = escapeAssText(w.word.toUpperCase());
        if (idx === wIdx) {
          return `{\\c${assAccent}\\fscx108\\fscy108}${escaped}{\\c&H00FFFFFF&\\fscx100\\fscy100}`;
        }
        return escaped;
      });

      events.push(
        `Dialogue: 0,${formatAssTime(wStart)},${formatAssTime(wEnd)},Default,,0,0,0,,${lineTokens.join(" ")}`
      );
    }
  }

  const assContent = header + events.join("\n") + "\n";
  const assPath = path.join(outDir, "captions.ass");
  fs.writeFileSync(assPath, assContent, "utf8");

  return { assPath, wordTimestampsPath, globalWords, assContent };
}
