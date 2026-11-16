import { useState } from "react";
import { Check, Copy, Play, Terminal } from "lucide-react";
import type { RenderProfile, VoiceName } from "../types.ts";

interface NewRunComposerProps {
  onStartRun: (opts: {
    topic: string;
    voice: VoiceName;
    renderProfile: RenderProfile;
    includeBgMusic: boolean;
    enableVisionQa: boolean;
  }) => Promise<void>;
  isStarting: boolean;
}

const EXAMPLE_TOPICS = [
  "Why Planes Don't Fly in Straight Lines",
  "How Noise-Canceling Headphones Erase Sound With Sound",
  "Why Prime Numbers Rule Cicada Life Cycles",
];

const VOICES: { id: VoiceName; desc: string }[] = [
  { id: "Kore", desc: "Clear, authoritative narrator" },
  { id: "Puck", desc: "Bright, energetic explainer" },
  { id: "Charon", desc: "Deep, documentary baritone" },
  { id: "Fenrir", desc: "Crisp, fast-paced host" },
  { id: "Zephyr", desc: "Warm, conversational tone" },
];

export function NewRunComposer({ onStartRun, isStarting }: NewRunComposerProps) {
  const [topic, setTopic] = useState(EXAMPLE_TOPICS[0]);
  const [voice, setVoice] = useState<VoiceName>("Kore");
  const [renderProfile, setRenderProfile] = useState<RenderProfile>("fast");
  const [includeBgMusic, setIncludeBgMusic] = useState(true);
  const [enableVisionQa, setEnableVisionQa] = useState(true);
  const [copiedCli, setCopiedCli] = useState(false);

  const cliCommand = `python3 run_pipeline.py --topic "${topic.replace(/"/g, '\\"')}" --voice ${voice} --profile ${renderProfile}${includeBgMusic ? "" : " --no-music"}${enableVisionQa ? "" : " --skip-vision-qa"}`;

  const handleCopyCli = () => {
    navigator.clipboard?.writeText(cliCommand);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 1800);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isStarting) return;
    await onStartRun({
      topic: topic.trim(),
      voice,
      renderProfile,
      includeBgMusic,
      enableVisionQa,
    });
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-6 space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100 text-balance">
          Create Automated Short-Form Video
        </h1>
        <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
          Audio-first, scene-segmented pipeline powered by Gemini and Manim. Every run provisions an
          isolated workspace directory containing storyboards, WAV narrations, validated Python scenes,
          Vision QA frames, ASS captions, and the rendered vertical MP4.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-[#111722] border border-slate-800/90 rounded-xl p-6 space-y-6"
      >
        <div className="space-y-2.5">
          <label htmlFor="topic-input" className="block text-sm font-medium text-slate-200">
            Video Topic or Concept
          </label>
          <input
            id="topic-input"
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Enter an educational, scientific, or engineering topic..."
            className="w-full px-4 py-3 bg-[#090D14] border border-slate-800 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
            required
          />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-slate-500">Presets:</span>
            {EXAMPLE_TOPICS.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setTopic(ex)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  topic === ex
                    ? "bg-slate-800 border-slate-700 text-sky-300"
                    : "bg-[#090D14] border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                }`}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 pt-2 border-t border-slate-800/70">
          <div className="space-y-2">
            <label htmlFor="voice-select" className="block text-xs font-medium text-slate-300">
              Gemini TTS Voice
            </label>
            <select
              id="voice-select"
              value={voice}
              onChange={(e) => setVoice(e.target.value as VoiceName)}
              className="w-full px-3 py-2.5 bg-[#090D14] border border-slate-800 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-sky-500"
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} — {v.desc}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-300">Output Resolution</span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#090D14] border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setRenderProfile("fast")}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  renderProfile === "fast"
                    ? "bg-slate-800 text-sky-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                540×960 · 30fps
              </button>
              <button
                type="button"
                onClick={() => setRenderProfile("master")}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  renderProfile === "master"
                    ? "bg-slate-800 text-sky-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                1080×1920 · 60fps
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-300">Audio Mix</span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#090D14] border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setIncludeBgMusic(true)}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  includeBgMusic
                    ? "bg-slate-800 text-sky-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Synth -22dB
              </button>
              <button
                type="button"
                onClick={() => setIncludeBgMusic(false)}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  !includeBgMusic
                    ? "bg-slate-800 text-sky-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Voice Only
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-300">Vision QA Loop</span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#090D14] border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setEnableVisionQa(true)}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  enableVisionQa
                    ? "bg-slate-800 text-sky-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Enabled
              </button>
              <button
                type="button"
                onClick={() => setEnableVisionQa(false)}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  !enableVisionQa
                    ? "bg-slate-800 text-sky-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Save Quota
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-slate-800/70">
          <div className="text-xs text-slate-400 space-y-0.5">
            <div>Models: gemini-4-hydrogen (Storyboard &amp; Manim) · gemini-3.1-flash-lite (Align &amp; QA) · gemini-3.8-flash-lite-tts</div>
            <div>Pacing: Sequential scene execution with automatic rate-limit cooldowns</div>
          </div>
          <button
            type="submit"
            disabled={isStarting || !topic.trim()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-semibold text-sm rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4 fill-current" />
            {isStarting ? "Starting Pipeline..." : "Generate Video"}
          </button>
        </div>
      </form>

      <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
            <Terminal className="w-4 h-4 text-slate-400" />
            Single Entry Point CLI Equivalent
          </div>
          <button
            type="button"
            onClick={handleCopyCli}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-[#090D14] border border-slate-800 rounded-md transition-colors"
          >
            {copiedCli ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedCli ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="p-3 bg-[#090D14] border border-slate-800/80 rounded-lg text-xs font-mono text-sky-300 overflow-x-auto">
          {cliCommand}
        </pre>
      </div>
    </div>
  );
}
