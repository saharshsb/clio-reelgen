import { useState } from "react";
import { Download, Eye, EyeOff, Film, FolderOpen, RotateCcw } from "lucide-react";
import type { PipelineProgressEvent, RunDetails } from "../types.ts";

interface OverviewPlayerProps {
  details: RunDetails;
  logs: PipelineProgressEvent[];
  onResume: () => void;
  isBusy: boolean;
}

export function OverviewPlayer({ details, logs, onResume, isBusy }: OverviewPlayerProps) {
  const [showSafeZones, setShowSafeZones] = useState(false);
  const { manifest, storyboard, alignedScenes, qaReport } = details;
  const hasMasterVideo = Boolean(
    manifest.final_video && details.artifacts.some((a) => a.relativePath === "final_short.mp4")
  );
  const videoSrc = hasMasterVideo
    ? `/api/runs/${manifest.run_id}/files/final_short.mp4?t=${encodeURIComponent(manifest.updated_at)}`
    : "";

  const qaPassedCount = manifest.scene_statuses.filter((s) => s.qa_status === "PASS").length;
  const totalRetries = manifest.scene_statuses.reduce((acc, s) => acc + Math.max(0, s.code_attempts - 1), 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: 9:16 Master Video Viewport */}
      <div className="lg:col-span-5 bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Master 9:16 Render</h2>
            <p className="text-xs text-slate-400 tabular-nums">
              {manifest.render_profile === "master" ? "1080×1920 · 60fps" : "540×960 · 30fps"} ·{" "}
              {manifest.total_duration_sec ? `${manifest.total_duration_sec.toFixed(2)}s` : "Pending"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSafeZones((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                showSafeZones
                  ? "bg-sky-500/15 border-sky-500/50 text-sky-300"
                  : "bg-[#090D14] border-slate-800 text-slate-300 hover:border-slate-700"
              }`}
            >
              {showSafeZones ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              Safe Zones
            </button>
            {hasMasterVideo && (
              <a
                href={`/api/runs/${manifest.run_id}/files/final_short.mp4`}
                download={`${manifest.run_id}_final_short.mp4`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                MP4
              </a>
            )}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[330px] aspect-[9/16] bg-[#090D14] border border-slate-800 rounded-xl overflow-hidden flex items-center justify-center">
          {hasMasterVideo ? (
            <video
              key={videoSrc}
              src={videoSrc}
              controls
              playsInline
              className="w-full h-full object-contain bg-black"
            />
          ) : (
            <div className="px-6 text-center space-y-3">
              <Film className="w-9 h-9 text-slate-600 mx-auto" />
              <div className="text-sm font-medium text-slate-300">
                {manifest.status === "IN_PROGRESS"
                  ? "Rendering in progress..."
                  : manifest.status === "FAILED"
                  ? "Run interrupted before master composite"
                  : "No master video yet"}
              </div>
              {manifest.status === "FAILED" && (
                <button
                  type="button"
                  onClick={onResume}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Resume Pipeline
                </button>
              )}
            </div>
          )}

          {showSafeZones && (
            <div className="pointer-events-none absolute inset-0 flex flex-col text-[10px] font-mono">
              {/* Top Margin: y in [6.0, 7.11] => ~7.8% */}
              <div className="h-[7.8%] border-b border-dashed border-amber-400/60 bg-amber-500/10 flex items-center justify-center text-amber-300">
                TOP DEAD ZONE (y: +6.0 to +7.11)
              </div>
              {/* Header Zone: y in [4.5, 6.0] => ~10.5% */}
              <div className="h-[10.5%] border-b border-dashed border-emerald-400/60 bg-emerald-500/10 flex items-center justify-center text-emerald-300">
                HEADER ZONE (y: +4.5 to +6.0)
              </div>
              {/* Primary Visual Safe Zone: y in [-1.5, 4.5] => ~42.2% */}
              <div className="h-[42.2%] mx-[7.5%] border-x border-b border-dashed border-sky-400/70 bg-sky-500/5 flex items-center justify-center text-sky-300 text-center px-2">
                PRIMARY VISUAL SAFE ZONE (x: ±3.4, y: -1.5 to +4.5)
              </div>
              {/* Caption Safe Zone: y in [-7.11, -1.5] => ~39.5% */}
              <div className="flex-1 bg-rose-500/10 flex items-center justify-center text-rose-300 text-center px-2">
                FORBIDDEN TO MANIM · CAPTION & UI ZONE (y: -7.11 to -1.5)
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Pipeline Summary, Scene Matrix & Event Log */}
      <div className="lg:col-span-7 space-y-6">
        <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-100">
              {storyboard?.video_title || manifest.topic}
            </h2>
            <span className="text-xs font-mono text-slate-400">runs/{manifest.run_id}/</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-slate-800/70">
            <div>
              <div className="text-xs text-slate-400">Scenes</div>
              <div className="text-lg font-semibold text-slate-100 tabular-nums">
                {alignedScenes.length || storyboard?.scenes.length || 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Exact Audio Duration</div>
              <div className="text-lg font-semibold text-slate-100 tabular-nums">
                {manifest.total_duration_sec ? `${manifest.total_duration_sec.toFixed(2)}s` : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Vision QA Passed</div>
              <div className="text-lg font-semibold text-slate-100 tabular-nums">
                {qaPassedCount}/{manifest.scene_statuses.length || 0}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Compiler Self-Fixes</div>
              <div className="text-lg font-semibold text-slate-100 tabular-nums">{totalRetries}</div>
            </div>
          </div>

          {manifest.scene_statuses.length > 0 && (
            <div className="pt-3 border-t border-slate-800/70 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800/80">
                    <th className="py-2 pr-3 font-medium">Scene</th>
                    <th className="py-2 pr-3 font-medium">Header</th>
                    <th className="py-2 pr-3 font-medium text-right">Duration</th>
                    <th className="py-2 pr-3 font-medium text-right">Code Tries</th>
                    <th className="py-2 font-medium text-right">QA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {manifest.scene_statuses.map((sc) => (
                    <tr key={sc.scene_id} className="hover:bg-slate-800/30">
                      <td className="py-2 pr-3 font-mono text-slate-300 tabular-nums">
                        {String(sc.scene_id).padStart(2, "0")}
                      </td>
                      <td className="py-2 pr-3 text-slate-200 truncate max-w-[200px]">
                        {sc.header_text}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-slate-300 tabular-nums">
                        {sc.exact_duration_sec ? `${sc.exact_duration_sec.toFixed(2)}s` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-slate-300 tabular-nums">
                        {sc.code_attempts}
                      </td>
                      <td className="py-2 text-right font-medium">
                        {sc.qa_status === "PASS" ? (
                          <span className="text-emerald-400">PASS</span>
                        ) : sc.qa_status === "FAIL" ? (
                          <span className="text-amber-400">REVISED</span>
                        ) : (
                          <span className="text-slate-400">{sc.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Live Pipeline Log Stream */}
        <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Execution Log</h3>
            <span className="text-xs text-slate-400 tabular-nums">
              {qaReport.length} QA inspections · {details.artifacts.length} artifacts saved
            </span>
          </div>
          {logs.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
              <FolderOpen className="w-4 h-4 text-slate-500" />
              All run artifacts loaded from disk in <code className="text-slate-300">runs/{manifest.run_id}/</code>
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
              {logs.map((lg, idx) => (
                <div key={idx} className="flex items-start gap-2.5 text-slate-300">
                  <span className="text-slate-500 tabular-nums shrink-0">
                    {new Date(lg.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={lg.type === "error" ? "text-red-400" : lg.type === "completed" ? "text-emerald-400" : "text-slate-300"}>
                    {lg.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
