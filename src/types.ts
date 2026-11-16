export type VoiceName = "Kore" | "Puck" | "Charon" | "Fenrir" | "Zephyr";

export type RenderProfile = "master" | "fast";

export interface ThemePalette {
  background: string;
  primary_accent: string;
  secondary_accent: string;
  text_primary: string;
}

export interface StoryboardScene {
  scene_id: number;
  scene_type: string;
  narration: string;
  visual_directive: string;
  header_text: string;
  pacing_notes: string;
}

export interface Storyboard {
  video_title: string;
  target_duration_sec: number;
  theme_palette: ThemePalette;
  scenes: StoryboardScene[];
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface AlignedScene extends StoryboardScene {
  audio_file_path: string;
  exact_duration_sec: number;
  word_timestamps: WordTimestamp[];
}

export interface GlobalWordTimestamp extends WordTimestamp {
  scene_id: number;
}

export interface QAVerdict {
  scene_id: number;
  attempt: number;
  status: "PASS" | "FAIL";
  issues_detected: string[];
  code_fix_instructions: string;
  frames: string[];
}

export type StageKey = "stage_0" | "stage_1" | "stage_2" | "stage_3" | "stage_4";
export type StageState = "pending" | "running" | "completed" | "failed";

export interface SceneRunStatus {
  scene_id: number;
  header_text: string;
  status: "pending" | "generating_code" | "compiling" | "debugging" | "vision_qa" | "rendering_final" | "muxing" | "completed" | "failed";
  code_attempts: number;
  vision_attempts: number;
  last_error?: string;
  qa_status?: "PASS" | "FAIL";
  exact_duration_sec?: number;
}

export interface RunManifest {
  run_id: string;
  topic: string;
  video_title?: string;
  voice: VoiceName;
  render_profile: RenderProfile;
  include_bg_music: boolean;
  enable_vision_qa?: boolean;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  current_stage: StageKey;
  stages: Record<StageKey, StageState>;
  created_at: string;
  updated_at: string;
  error?: string;
  final_video?: string;
  total_duration_sec?: number;
  scene_statuses: SceneRunStatus[];
}

export interface ArtifactFile {
  relativePath: string;
  name: string;
  sizeBytes: number;
  category: "manifest" | "script" | "audio" | "code" | "qa" | "render" | "subtitle" | "master";
}

export interface RunDetails {
  manifest: RunManifest;
  storyboard: Storyboard | null;
  alignedScenes: AlignedScene[];
  qaReport: QAVerdict[];
  sceneCode: Record<number, { finalCode: string; attempts: { name: string; code: string }[] }>;
  subtitles: {
    transcript: string;
    wordTimestamps: GlobalWordTimestamp[];
    assContent: string;
  };
  artifacts: ArtifactFile[];
}

export interface PipelineProgressEvent {
  type: "stage" | "scene" | "log" | "completed" | "error";
  runId: string;
  stage?: StageKey;
  state?: StageState;
  sceneId?: number;
  message: string;
  timestamp: string;
  manifest?: RunManifest;
}
