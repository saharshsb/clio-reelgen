import { Volume2 } from "lucide-react";
import type { RunDetails } from "../types.ts";

interface StoryboardAudioViewProps {
  details: RunDetails;
}

export function StoryboardAudioView({ details }: StoryboardAudioViewProps) {
  const { manifest, storyboard, alignedScenes } = details;

  if (!storyboard) {
    return (
      <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-8 text-center text-sm text-slate-400">
        Stage 1 storyboard has not been generated yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-100">{storyboard.video_title}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 tabular-nums">
            <span>{storyboard.scenes.length} atomic scenes</span>
            <span aria-hidden="true">·</span>
            <span>Target {storyboard.target_duration_sec}s</span>
            <span aria-hidden="true">·</span>
            <span>Actual audio {manifest.total_duration_sec ? `${manifest.total_duration_sec}s` : "pending"}</span>
            <span aria-hidden="true">·</span>
            <span>Voice: {manifest.voice}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          {Object.entries(storyboard.theme_palette).map(([k, hex]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span
                className="w-3.5 h-3.5 rounded-sm border border-slate-700 shrink-0"
                style={{ backgroundColor: hex }}
              />
              <span className="font-mono text-[11px] text-slate-300">{hex}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {storyboard.scenes.map((sc) => {
          const aligned = alignedScenes.find((a) => a.scene_id === sc.scene_id);
          const sPad = String(sc.scene_id).padStart(2, "0");
          const hasAudio = details.artifacts.some((a) => a.relativePath === `02_audio/scene_${sPad}.wav`);

          return (
            <div
              key={sc.scene_id}
              className="bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs text-slate-400 tabular-nums">
                    Scene {sPad} · {sc.scene_type}
                    {aligned ? ` · ${aligned.exact_duration_sec.toFixed(2)}s` : ""}
                  </div>
                  <h3 className="text-sm font-semibold text-slate-100">{sc.header_text}</h3>
                </div>

                {hasAudio && (
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-slate-400 shrink-0" />
                    <audio
                      controls
                      preload="none"
                      src={`/api/runs/${manifest.run_id}/files/02_audio/scene_${sPad}.wav`}
                      className="h-8 max-w-[260px]"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-800/70 text-xs">
                <div className="space-y-1">
                  <div className="font-medium text-slate-300">Narration Script</div>
                  <p className="text-slate-200 leading-relaxed bg-[#090D14] border border-slate-800/80 rounded-lg p-3">
                    "{sc.narration}"
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="font-medium text-slate-300">Visual Directive & Pacing</div>
                  <div className="text-slate-300 leading-relaxed bg-[#090D14] border border-slate-800/80 rounded-lg p-3 space-y-1.5">
                    <p>{sc.visual_directive}</p>
                    <p className="text-slate-400">Pacing: {sc.pacing_notes}</p>
                  </div>
                </div>
              </div>

              {aligned && aligned.word_timestamps.length > 0 && (
                <div className="pt-3 border-t border-slate-800/70 space-y-2">
                  <div className="text-xs font-medium text-slate-400">
                    Word-Level Alignment ({aligned.word_timestamps.length} words)
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 font-mono text-[11px]">
                    {aligned.word_timestamps.map((wt, idx) => (
                      <span key={idx} className="text-slate-300 tabular-nums">
                        <span className="text-sky-300">{wt.word}</span>{" "}
                        <span className="text-slate-500">
                          {wt.start.toFixed(2)}–{wt.end.toFixed(2)}s
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
