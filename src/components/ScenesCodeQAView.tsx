import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, RefreshCw } from "lucide-react";
import type { RunDetails } from "../types.ts";

interface ScenesCodeQAViewProps {
  details: RunDetails;
  onRerunScene: (sceneId: number, code?: string, directive?: string) => Promise<void>;
  isBusy: boolean;
}

export function ScenesCodeQAView({ details, onRerunScene, isBusy }: ScenesCodeQAViewProps) {
  const scenes = details.alignedScenes.length > 0 ? details.alignedScenes : details.storyboard?.scenes || [];
  const [selectedSceneId, setSelectedSceneId] = useState<number>(scenes[0]?.scene_id || 1);
  const [selectedAttempt, setSelectedAttempt] = useState<string>("final");
  const [editedCode, setEditedCode] = useState<string>("");
  const [editedDirective, setEditedDirective] = useState<string>("");

  useEffect(() => {
    if (scenes.length > 0 && !scenes.some((s) => s.scene_id === selectedSceneId)) {
      setSelectedSceneId(scenes[0].scene_id);
    }
  }, [scenes, selectedSceneId]);

  const codeEntry = details.sceneCode[selectedSceneId];
  const currentScene = scenes.find((s) => s.scene_id === selectedSceneId);
  const sPad = String(selectedSceneId).padStart(2, "0");

  useEffect(() => {
    setSelectedAttempt("final");
    setEditedCode(codeEntry?.finalCode || "");
    setEditedDirective(currentScene?.visual_directive || "");
  }, [selectedSceneId, codeEntry?.finalCode, currentScene?.visual_directive]);

  if (scenes.length === 0) {
    return (
      <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-8 text-center text-sm text-slate-400">
        No scenes available yet.
      </div>
    );
  }

  const qaForScene = details.qaReport.filter((q) => q.scene_id === selectedSceneId);
  const hasMuxedClip = details.artifacts.some((a) => a.relativePath === `05_renders/muxed_scene_${sPad}.mp4`);

  const displayedCode =
    selectedAttempt === "final"
      ? editedCode
      : codeEntry?.attempts.find((a) => a.name === selectedAttempt)?.code || "";

  return (
    <div className="space-y-6">
      {/* Scene Picker Bar */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[#111722] border border-slate-800/90 rounded-xl">
        {scenes.map((sc) => {
          const st = details.manifest.scene_statuses.find((s) => s.scene_id === sc.scene_id);
          const active = sc.scene_id === selectedSceneId;
          return (
            <button
              key={sc.scene_id}
              type="button"
              onClick={() => setSelectedSceneId(sc.scene_id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap tabular-nums ${
                active
                  ? "bg-sky-500 text-slate-950 font-semibold"
                  : "text-slate-300 hover:bg-slate-800/70"
              }`}
            >
              Scene {String(sc.scene_id).padStart(2, "0")}
              {st?.qa_status ? ` · ${st.qa_status}` : ""}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Python Manim Code Editor + Attempts */}
        <div className="lg:col-span-7 bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                03_code/scene_{sPad}.py
              </h3>
              <p className="text-xs text-slate-400">
                {currentScene?.header_text}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {codeEntry && codeEntry.attempts.length > 0 && (
                <select
                  value={selectedAttempt}
                  onChange={(e) => setSelectedAttempt(e.target.value)}
                  className="px-2.5 py-1.5 bg-[#090D14] border border-slate-800 rounded-md text-xs text-slate-200 font-mono"
                >
                  <option value="final">scene_{sPad}.py (Final)</option>
                  {codeEntry.attempts.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                disabled={isBusy || !editedCode.trim()}
                onClick={() => onRerunScene(selectedSceneId, editedCode, editedDirective)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-xs rounded-md transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Render Edited Code
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => onRerunScene(selectedSceneId, undefined, editedDirective)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#090D14] hover:bg-slate-800 border border-slate-700 disabled:opacity-50 text-slate-200 font-medium text-xs rounded-md transition-colors whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate via Gemini
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-400">Visual Directive</label>
            <textarea
              rows={2}
              value={editedDirective}
              onChange={(e) => setEditedDirective(e.target.value)}
              className="w-full px-3 py-2 bg-[#090D14] border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <textarea
            value={displayedCode}
            onChange={(e) => {
              if (selectedAttempt === "final") setEditedCode(e.target.value);
            }}
            readOnly={selectedAttempt !== "final"}
            spellCheck={false}
            rows={20}
            className="w-full p-3.5 bg-[#090D14] border border-slate-800 rounded-lg font-mono text-xs text-sky-100 leading-relaxed focus:outline-none focus:border-sky-500 resize-y"
          />
        </div>

        {/* Right: Vision QA Frames, Verdicts & Individual Scene Clip */}
        <div className="lg:col-span-5 space-y-6">
          {hasMuxedClip && (
            <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-100">
                  Muxed Scene Clip (muxed_scene_{sPad}.mp4)
                </h3>
              </div>
              <video
                key={`muxed-${sPad}-${details.manifest.updated_at}`}
                src={`/api/runs/${details.manifest.run_id}/files/05_renders/muxed_scene_${sPad}.mp4?t=${encodeURIComponent(details.manifest.updated_at)}`}
                controls
                playsInline
                className="w-full max-w-[230px] mx-auto aspect-[9/16] rounded-lg bg-black border border-slate-800"
              />
            </div>
          )}

          <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">
              Gemini Vision QA Inspections
            </h3>
            {qaForScene.length === 0 ? (
              <p className="text-xs text-slate-400">
                No Vision QA frames captured for this scene yet.
              </p>
            ) : (
              <div className="space-y-5">
                {qaForScene.map((qa) => (
                  <div key={qa.attempt} className="space-y-3 pt-3 first:pt-0 border-t first:border-t-0 border-slate-800/70">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-300">
                        Attempt {qa.attempt + 1} (25% / 60% / 95%)
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          qa.status === "PASS" ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {qa.status === "PASS" ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        {qa.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {qa.frames.map((frameName) => (
                        <a
                          key={frameName}
                          href={`/api/runs/${details.manifest.run_id}/files/04_qa_frames/${frameName}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block aspect-[9/16] bg-[#090D14] border border-slate-800 rounded-md overflow-hidden hover:border-sky-500 transition-colors"
                        >
                          <img
                            src={`/api/runs/${details.manifest.run_id}/files/04_qa_frames/${frameName}`}
                            alt={frameName}
                            className="w-full h-full object-cover"
                          />
                        </a>
                      ))}
                    </div>

                    {qa.issues_detected.length > 0 && (
                      <div className="bg-[#090D14] border border-amber-800/50 rounded-lg p-3 text-xs space-y-1.5">
                        <div className="font-medium text-amber-300">Critique & Layout Fix:</div>
                        <ul className="list-disc pl-4 text-slate-300 space-y-0.5">
                          {qa.issues_detected.map((iss, idx) => (
                            <li key={idx}>{iss}</li>
                          ))}
                        </ul>
                        {qa.code_fix_instructions && (
                          <p className="text-slate-400 font-mono text-[11px] pt-1">
                            Fix: {qa.code_fix_instructions}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
