import { Download, FileText } from "lucide-react";
import type { RunDetails } from "../types.ts";

interface SubtitlesArtifactsViewProps {
  details: RunDetails;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SubtitlesArtifactsView({ details }: SubtitlesArtifactsViewProps) {
  const { manifest, subtitles, artifacts } = details;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Subtitles & Transcript */}
      <div className="lg:col-span-6 space-y-6">
        <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Full Narration Transcript</h3>
            <span className="text-xs text-slate-400 font-mono">06_subtitles/full_transcript.txt</span>
          </div>
          <pre className="p-3.5 bg-[#090D14] border border-slate-800 rounded-lg text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
            {subtitles.transcript || "Transcript not generated yet."}
          </pre>
        </div>

        <div className="bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">ASS Karaoke Subtitle Script</h3>
            <span className="text-xs text-slate-400 font-mono">06_subtitles/captions.ass</span>
          </div>
          <pre className="max-h-80 overflow-y-auto p-3.5 bg-[#090D14] border border-slate-800 rounded-lg font-mono text-[11px] text-sky-200 whitespace-pre overflow-x-auto">
            {subtitles.assContent || "ASS subtitle file not generated yet."}
          </pre>
        </div>
      </div>

      {/* Right: Complete Artifact Manifest */}
      <div className="lg:col-span-6 bg-[#111722] border border-slate-800/90 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Isolated Run Artifacts</h3>
            <p className="text-xs text-slate-400 font-mono">runs/{manifest.run_id}/</p>
          </div>
          <span className="text-xs text-slate-400 tabular-nums">{artifacts.length} files</span>
        </div>

        <div className="max-h-[560px] overflow-y-auto border border-slate-800/80 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#090D14] text-slate-400 sticky top-0 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3 font-medium">Path</th>
                <th className="py-2.5 px-3 font-medium text-right">Size</th>
                <th className="py-2.5 px-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {artifacts.map((art) => (
                <tr key={art.relativePath} className="hover:bg-slate-800/30">
                  <td className="py-2 px-3 font-mono text-[11px] text-slate-200 flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">{art.relativePath}</span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                    {formatBytes(art.sizeBytes)}
                  </td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <a
                      href={`/api/runs/${manifest.run_id}/files/${art.relativePath}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 font-medium"
                    >
                      <Download className="w-3 h-3" />
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
