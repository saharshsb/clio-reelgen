import { AlertCircle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { PipelineProgressEvent, RunManifest, StageKey, StageState } from "../types.ts";

interface StageStepperProps {
  manifest: RunManifest;
  logs: PipelineProgressEvent[];
}

const STAGES: { key: StageKey; label: string; sub: string }[] = [
  { key: "stage_0", label: "0. Workspace", sub: "Isolated run dir" },
  { key: "stage_1", label: "1. Storyboard", sub: "Gemini Director" },
  { key: "stage_2", label: "2. Audio & Align", sub: "Gemini TTS + Words" },
  { key: "stage_3", label: "3. Manim & QA", sub: "Self-healing + Vision" },
  { key: "stage_4", label: "4. Compositor", sub: "FFmpeg + ASS burn" },
];

function StageIcon({ state }: { state: StageState }) {
  if (state === "completed") return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (state === "running") return <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />;
  if (state === "failed") return <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />;
  return <Circle className="w-4 h-4 text-slate-600 shrink-0" />;
}

export function StageStepper({ manifest, logs }: StageStepperProps) {
  const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
  const completedScenes = manifest.scene_statuses.filter((s) => s.status === "completed").length;
  const totalScenes = manifest.scene_statuses.length;

  return (
    <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-4 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {STAGES.map((st) => {
          const state = manifest.stages[st.key] || "pending";
          const isCurrent = manifest.current_stage === st.key && manifest.status === "IN_PROGRESS";
          return (
            <div
              key={st.key}
              className={`px-3 py-2.5 rounded-lg border transition-colors ${
                isCurrent
                  ? "bg-sky-500/10 border-sky-500/40"
                  : state === "failed"
                  ? "bg-red-500/10 border-red-500/40"
                  : "bg-[#090D14] border-slate-800/80"
              }`}
            >
              <div className="flex items-center gap-2">
                <StageIcon state={state} />
                <span className="text-xs font-semibold text-slate-200 whitespace-nowrap truncate">
                  {st.label}
                </span>
              </div>
              <div className="mt-1 pl-6 text-[11px] text-slate-400 truncate">
                {st.key === "stage_3" && totalScenes > 0
                  ? `${completedScenes}/${totalScenes} scenes ready`
                  : st.sub}
              </div>
            </div>
          );
        })}
      </div>

      {manifest.status === "IN_PROGRESS" && latestLog && (
        <div className="flex items-center justify-between gap-4 px-3 py-2 bg-[#090D14] border border-slate-800/80 rounded-lg text-xs">
          <div className="flex items-center gap-2 text-slate-300 truncate">
            <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
            <span className="truncate">{latestLog.message}</span>
          </div>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
            {new Date(latestLog.timestamp).toLocaleTimeString()}
          </span>
        </div>
      )}

      {manifest.status === "FAILED" && manifest.error && (
        <div className="flex items-start gap-2.5 px-3.5 py-2.5 bg-red-950/30 border border-red-800/60 rounded-lg text-xs text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <div className="font-medium text-red-300">Pipeline Halted at {manifest.current_stage}</div>
            <pre className="whitespace-pre-wrap font-mono text-[11px] text-red-200/90 break-words">
              {manifest.error}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
