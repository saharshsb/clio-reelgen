import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Film, Plus, Trash2 } from "lucide-react";
import { NewRunComposer } from "./components/NewRunComposer.tsx";
import { StageStepper } from "./components/StageStepper.tsx";
import { OverviewPlayer } from "./components/OverviewPlayer.tsx";
import { StoryboardAudioView } from "./components/StoryboardAudioView.tsx";
import { ScenesCodeQAView } from "./components/ScenesCodeQAView.tsx";
import { SubtitlesArtifactsView } from "./components/SubtitlesArtifactsView.tsx";
import type {
  PipelineProgressEvent,
  RenderProfile,
  RunDetails,
  RunManifest,
  VoiceName,
} from "./types.ts";

type ViewTab = "overview" | "storyboard" | "scenes" | "subtitles";

export default function App() {
  const [runs, setRuns] = useState<RunManifest[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>("overview");
  const [logs, setLogs] = useState<PipelineProgressEvent[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      if (!res.ok) return;
      const data = await res.json();
      setRuns(data.runs || []);
    } catch {
      // ignore transient poll errors
    }
  }, []);

  const fetchRunDetails = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
      if (!res.ok) return;
      const data: RunDetails = await res.json();
      setRunDetails(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHasApiKey(Boolean(d.hasApiKey)))
      .catch(() => {});
    fetchRuns();
  }, [fetchRuns]);

  // Connect SSE when a run is selected
  useEffect(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (!selectedRunId) {
      setRunDetails(null);
      setLogs([]);
      return;
    }

    fetchRunDetails(selectedRunId);
    setLogs([]);

    const es = new EventSource(`/api/runs/${encodeURIComponent(selectedRunId)}/events`);
    eventSourceRef.current = es;

    es.onmessage = (msg) => {
      try {
        const ev: PipelineProgressEvent = JSON.parse(msg.data);
        setLogs((prev) => [...prev.slice(-200), ev]);
        if (ev.manifest) {
          setRunDetails((prev) =>
            prev ? { ...prev, manifest: ev.manifest! } : prev
          );
          setRuns((prev) =>
            prev.map((r) => (r.run_id === ev.runId ? ev.manifest! : r))
          );
        }
        if (ev.type === "stage" || ev.type === "completed" || ev.type === "error") {
          fetchRunDetails(selectedRunId);
          fetchRuns();
        }
      } catch {
        // ignore malformed chunk
      }
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [selectedRunId, fetchRunDetails, fetchRuns]);

  const handleStartRun = async (opts: {
    topic: string;
    voice: VoiceName;
    renderProfile: RenderProfile;
    includeBgMusic: boolean;
    enableVisionQa: boolean;
  }) => {
    setIsStarting(true);
    setErrorBanner(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to start pipeline");
      }
      await fetchRuns();
      setSelectedRunId(data.runId);
      setActiveTab("overview");
    } catch (err: any) {
      setErrorBanner(err?.message || "Failed to launch pipeline");
    } finally {
      setIsStarting(false);
    }
  };

  const handleResumeRun = async () => {
    if (!selectedRunId) return;
    setErrorBanner(null);
    const res = await fetch(`/api/runs/${encodeURIComponent(selectedRunId)}/resume`, {
      method: "POST",
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErrorBanner(d.error || "Failed to resume run");
      return;
    }
    fetchRunDetails(selectedRunId);
    fetchRuns();
  };

  const handleRerunScene = async (
    sceneId: number,
    code?: string,
    directive?: string
  ) => {
    if (!selectedRunId) return;
    setErrorBanner(null);
    const res = await fetch(
      `/api/runs/${encodeURIComponent(selectedRunId)}/scenes/${sceneId}/rerun`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, directive }),
      }
    );
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErrorBanner(d.error || "Failed to re-render scene");
      return;
    }
    fetchRunDetails(selectedRunId);
  };

  const handleDeleteRun = async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      if (selectedRunId === runId) {
        setSelectedRunId(null);
      }
      fetchRuns();
    }
  };

  const isBusy = runDetails?.manifest.status === "IN_PROGRESS";
  const hasFinalMp4 = Boolean(
    runDetails?.manifest.final_video &&
      runDetails.artifacts.some((a) => a.relativePath === "final_short.mp4")
  );

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#090D14] text-slate-100">
      {/* Left Sidebar: Isolated Video Runs */}
      <aside className="w-full lg:w-[270px] shrink-0 bg-[#0D121B] border-b lg:border-b-0 lg:border-r border-slate-800/80 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSelectedRunId(null)}
            className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 hover:text-sky-300 transition-colors"
          >
            Kinema Studio
          </button>
          <button
            type="button"
            onClick={() => setSelectedRunId(null)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Run
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 max-h-60 lg:max-h-none">
          <div className="px-2 py-1 text-xs font-medium text-slate-500">
            Video Runs ({runs.length})
          </div>
          {runs.length === 0 ? (
            <div className="px-2.5 py-4 text-xs text-slate-500 leading-relaxed">
              No pipeline runs yet. Enter a topic to generate your first 9:16 video.
            </div>
          ) : (
            runs.map((r) => {
              const active = r.run_id === selectedRunId;
              return (
                <div
                  key={r.run_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedRunId(r.run_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setSelectedRunId(r.run_id);
                  }}
                  className={`group w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                    active
                      ? "bg-[#141C2A] border-slate-700 text-slate-100"
                      : "bg-transparent border-transparent hover:bg-slate-800/40 text-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-medium leading-snug line-clamp-2">
                      {r.video_title || r.topic}
                    </div>
                    {r.status !== "IN_PROGRESS" && (
                      <button
                        type="button"
                        aria-label={`Delete ${r.run_id}`}
                        onClick={(e) => handleDeleteRun(r.run_id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-opacity shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400 tabular-nums">
                    <span
                      className={
                        r.status === "COMPLETED"
                          ? "text-emerald-400"
                          : r.status === "FAILED"
                          ? "text-red-400"
                          : "text-sky-400"
                      }
                    >
                      {r.status === "COMPLETED"
                        ? "Completed"
                        : r.status === "FAILED"
                        ? "Failed"
                        : "Running"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{r.voice}</span>
                    {r.total_duration_sec ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{r.total_duration_sec.toFixed(1)}s</span>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (3-zone contract) */}
        <header className="px-6 py-3.5 border-b border-slate-800/80 bg-[#0B0F17] flex items-center justify-between gap-6">
          <div className="min-w-0 flex items-center gap-2 text-sm">
            <Film className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="font-medium text-slate-200 truncate">
              {runDetails
                ? runDetails.manifest.video_title || runDetails.manifest.topic
                : "New Pipeline Run"}
            </span>
          </div>

          {runDetails ? (
            <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400">
              {(
                [
                  ["overview", "Overview"],
                  ["storyboard", "Storyboard & Audio"],
                  ["scenes", "Scenes & QA"],
                  ["subtitles", "Subtitles & Files"],
                ] as [ViewTab, string][]
              ).map(([tabKey, label]) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setActiveTab(tabKey)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    activeTab === tabKey
                      ? "text-slate-100 border-sky-400"
                      : "border-transparent hover:text-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          ) : (
            <div className="hidden md:block text-xs text-slate-500 whitespace-nowrap">
              Gemini 4 Hydrogen · Gemini 3.8 TTS · Manim 9:16 · FFmpeg
            </div>
          )}

          <div className="shrink-0">
            {runDetails && hasFinalMp4 ? (
              <a
                href={`/api/runs/${runDetails.manifest.run_id}/files/final_short.mp4`}
                download={`${runDetails.manifest.run_id}_final_short.mp4`}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Export MP4
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setSelectedRunId(null)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-xs rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New Video
              </button>
            )}
          </div>
        </header>

        {/* Mobile sub-tabs when viewing a run */}
        {runDetails && (
          <div className="flex md:hidden items-center gap-2 px-4 py-2 border-b border-slate-800/80 overflow-x-auto bg-[#0D121B]">
            {(
              [
                ["overview", "Overview"],
                ["storyboard", "Storyboard & Audio"],
                ["scenes", "Scenes & QA"],
                ["subtitles", "Subtitles & Files"],
              ] as [ViewTab, string][]
            ).map(([tabKey, label]) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setActiveTab(tabKey)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                  activeTab === tabKey
                    ? "bg-slate-800 text-sky-300"
                    : "text-slate-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          {!hasApiKey && (
            <div className="mx-6 mt-5 px-4 py-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-xs text-amber-200">
              GEMINI_API_KEY is not detected in the server environment. Configure it in the Settings &gt; Secrets panel to run generation stages.
            </div>
          )}

          {errorBanner && (
            <div className="mx-6 mt-5 px-4 py-3 bg-red-950/40 border border-red-800/60 rounded-lg text-xs text-red-200">
              {errorBanner}
            </div>
          )}

          {!runDetails ? (
            <NewRunComposer onStartRun={handleStartRun} isStarting={isStarting} />
          ) : (
            <div className="max-w-7xl mx-auto p-6 space-y-6">
              <StageStepper manifest={runDetails.manifest} logs={logs} />

              {activeTab === "overview" && (
                <OverviewPlayer
                  details={runDetails}
                  logs={logs}
                  onResume={handleResumeRun}
                  isBusy={isBusy}
                />
              )}

              {activeTab === "storyboard" && (
                <StoryboardAudioView details={runDetails} />
              )}

              {activeTab === "scenes" && (
                <ScenesCodeQAView
                  details={runDetails}
                  onRerunScene={handleRerunScene}
                  isBusy={isBusy}
                />
              )}

              {activeTab === "subtitles" && (
                <SubtitlesArtifactsView details={runDetails} />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
