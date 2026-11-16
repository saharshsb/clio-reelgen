import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ASSETS_DIR = path.resolve(process.cwd(), "assets");
const BG_MUSIC_PATH = path.join(ASSETS_DIR, "bg_music.wav");
const WHOOSH_PATH = path.join(ASSETS_DIR, "whoosh.wav");

/**
 * Generates clean, royalty-free ambient synth background music and a 0.15s transition whoosh
 * using deterministic WAV PCM synthesis + FFmpeg smoothing if not yet on disk.
 */
export function ensureAudioAssets(): { bgMusicPath: string; whooshPath: string } {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  if (!fs.existsSync(BG_MUSIC_PATH)) {
    const sampleRate = 24000;
    const durationSec = 16; // seamless loopable chord progression
    const numSamples = sampleRate * durationSec;
    const pcm = Buffer.alloc(numSamples * 2);

    // Warm ambient lo-fi / documentary pad (Cmin9 -> Abmaj7 -> Fmin9 -> Gsus4)
    const chords = [
      [130.81, 155.56, 196.0, 233.08, 293.66],
      [103.83, 155.56, 196.0, 246.94, 311.13],
      [87.31, 130.81, 174.61, 207.65, 261.63],
      [98.0, 146.83, 196.0, 261.63, 293.66],
    ];
    const chordDur = durationSec / chords.length;

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const chordIdx = Math.min(chords.length - 1, Math.floor(t / chordDur));
      const localT = t - chordIdx * chordDur;
      // Smooth envelope per chord + seamless loop boundary fade
      const chordEnv = Math.sin((Math.PI * localT) / chordDur) * 0.65 + 0.35;
      const loopFade = Math.min(1.0, t / 0.25, (durationSec - t) / 0.25);
      const pulse = 0.85 + 0.15 * Math.sin(2 * Math.PI * 1.5 * t);

      let sample = 0;
      const freqs = chords[chordIdx];
      for (let f = 0; f < freqs.length; f++) {
        const freq = freqs[f];
        sample += Math.sin(2 * Math.PI * freq * t + f * 0.7) * (1.0 / (f + 1.4));
      }
      const val = Math.max(-0.95, Math.min(0.95, sample * 0.22 * chordEnv * loopFade * pulse));
      pcm.writeInt16LE(Math.round(val * 32767), i * 2);
    }

    const rawPath = path.join(ASSETS_DIR, "bg_music_raw.wav");
    writeWavFile(rawPath, pcm, sampleRate, 1);

    // Apply gentle low-pass warmth via FFmpeg
    const ff = spawnSync("ffmpeg", [
      "-y", "-i", rawPath,
      "-af", "lowpass=f=950,aecho=0.8:0.7:60:0.25",
      BG_MUSIC_PATH,
    ], { encoding: "utf8" });
    if (ff.status === 0 && fs.existsSync(rawPath)) {
      fs.unlinkSync(rawPath);
    } else if (fs.existsSync(rawPath)) {
      fs.renameSync(rawPath, BG_MUSIC_PATH);
    }
  }

  if (!fs.existsSync(WHOOSH_PATH)) {
    const sampleRate = 24000;
    const durationSec = 0.16;
    const numSamples = Math.floor(sampleRate * durationSec);
    const pcm = Buffer.alloc(numSamples * 2);
    let seed = 1337;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 4294967296) * 2 - 1;
    };
    let lp = 0;
    for (let i = 0; i < numSamples; i++) {
      const u = i / numSamples;
      const env = Math.sin(Math.PI * u) ** 1.5;
      lp = lp * 0.78 + nextRand() * 0.22;
      const val = Math.max(-0.9, Math.min(0.9, lp * env * 0.35));
      pcm.writeInt16LE(Math.round(val * 32767), i * 2);
    }
    writeWavFile(WHOOSH_PATH, pcm, sampleRate, 1);
  }

  return { bgMusicPath: BG_MUSIC_PATH, whooshPath: WHOOSH_PATH };
}

function writeWavFile(filePath: string, pcmData: Buffer, sampleRate: number, channels: number) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcmData]));
}
