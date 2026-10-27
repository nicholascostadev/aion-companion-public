/**
 * Local alert tones synthesized with Web Audio: no files, no network. Only for a browser
 * preview; in the desktop app the native alert engine plays every alert sound.
 */

export const SOUNDS = ['chime', 'bell', 'ping', 'beep', 'pulse', 'alarm'] as const;
export type SoundName = (typeof SOUNDS)[number];

interface Note {
  freq: number;
  at: number;
  length: number;
  type: OscillatorType;
}

const patterns: Record<SoundName, Note[]> = {
  chime: [
    { freq: 880, at: 0, length: 0.5, type: 'sine' },
    { freq: 1318.5, at: 0.14, length: 0.7, type: 'sine' },
  ],
  bell: [
    { freq: 660, at: 0, length: 1.2, type: 'triangle' },
    { freq: 1320, at: 0, length: 0.8, type: 'sine' },
  ],
  ping: [{ freq: 1568, at: 0, length: 0.35, type: 'sine' }],
  beep: [
    { freq: 1000, at: 0, length: 0.12, type: 'square' },
    { freq: 1000, at: 0.2, length: 0.12, type: 'square' },
  ],
  pulse: [0, 0.18, 0.36].map((at) => ({ freq: 520, at, length: 0.11, type: 'sine' as const })),
  alarm: [0, 0.25, 0.5, 0.75].map((at, i) => ({
    freq: i % 2 ? 740 : 988,
    at,
    length: 0.2,
    type: 'sawtooth' as const,
  })),
};

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  context ??= new window.AudioContext();
  return context;
}

export const soundLabel = (name: string) =>
  SOUNDS.includes(name as SoundName) ? name[0]!.toUpperCase() + name.slice(1) : name;

/**
 * Plays a tone at 0..1 volume. Resolves false when audio is unavailable or the
 * webview still requires a user gesture before sound may start.
 */
export async function playSound(name: string, volume: number): Promise<boolean> {
  const ctx = audio();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    return false;
  }
  if (ctx.state !== 'running') return false;
  const notes = patterns[name as SoundName] ?? patterns.chime;
  const level = Math.max(0, Math.min(1, volume)) * 0.35;
  const start = ctx.currentTime + 0.02;
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type;
    osc.frequency.value = note.freq;
    gain.gain.setValueAtTime(0, start + note.at);
    gain.gain.linearRampToValueAtTime(level, start + note.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + note.at);
    osc.stop(start + note.at + note.length + 0.05);
  }
  return true;
}
