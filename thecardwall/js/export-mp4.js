// 1:1 MP4 export: the slab makes exactly one full turn on black, rendered
// frame by frame (frame 180 would equal frame 0, so the clip loops
// seamlessly) and encoded on the device with WebCodecs H.264 + mp4-muxer,
// following the MOX client exporter contract (1080x1080, 30 fps, 6 s, 8 Mbps).
// Browsers without an H.264 encoder (e.g. open-source Chromium builds) get
// the same frames as VP9 or AV1 in MP4; MediaRecorder is the last resort.

import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer/mp4-muxer-5.2.2.mjs';

export const EXPORT_SPEC = Object.freeze({ size: 1080, fps: 30, frames: 180, bitrate: 8_000_000 });

export class ExportError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function appleWebKitVersion(ua = navigator.userAgent) {
  const ios = /(?:CPU (?:iPhone )?OS|iPad; CPU OS) (\d+)[_.](\d+)(?:[_.](\d+))?/i.exec(ua);
  if (ios) return [Number(ios[1]), Number(ios[2]), Number(ios[3] ?? 0)];
  const safari = /Version\/(\d+)\.(\d+)(?:\.(\d+))?.*Safari\//i.exec(ua);
  if (safari && !/(?:Chrome|Chromium|CriOS|Edg|OPR)\//i.test(ua)) {
    return [Number(safari[1]), Number(safari[2]), Number(safari[3] ?? 0)];
  }
  return null;
}

function atLeast(version, minimum) {
  for (let i = 0; i < Math.max(version.length, minimum.length); i++) {
    const a = version[i] ?? 0, b = minimum[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

// Codec ladder: H.264 first (plays everywhere, incl. iOS Photos and X).
const CODECS = [
  { muxer: 'avc', codecs: ['avc1.640028', 'avc1.4d4028', 'avc1.420028'], avc: true },
  { muxer: 'vp9', codecs: ['vp09.00.40.08', 'vp09.00.41.08'] },
  { muxer: 'av1', codecs: ['av01.0.08M.08', 'av01.0.09M.08'] },
];

let probe;
/** Resolve a supported encoder setup ({config, muxer}), or null. */
export function probeEncoder() {
  probe ??= (async () => {
    if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') return null;
    const apple = appleWebKitVersion();
    if (apple && !atLeast(apple, [17, 4, 0])) return null;
    const common = {
      width: EXPORT_SPEC.size,
      height: EXPORT_SPEC.size,
      framerate: EXPORT_SPEC.fps,
      bitrate: EXPORT_SPEC.bitrate,
      latencyMode: 'quality',
    };
    for (const family of CODECS) {
      // Hardware first (fast, cool); software encoders where there is none.
      for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
        for (const codec of family.codecs) {
          const base = { ...common, codec, hardwareAcceleration };
          const variants = family.avc ? [{ ...base, avc: { format: 'avc' } }, base] : [base];
          for (const config of variants) {
            try {
              const result = await VideoEncoder.isConfigSupported(config);
              if (result?.supported) return { config: result.config ?? config, muxer: family.muxer };
            } catch {
              // try the next configuration
            }
          }
        }
      }
    }
    return null;
  })();
  return probe;
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

function throwIfAborted(signal) {
  if (signal?.aborted) throw new ExportError('aborted', 'Export cancelled');
}

async function waitForCapacity(encoder, signal) {
  while (encoder.encodeQueueSize > 6) {
    throwIfAborted(signal);
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
}

/**
 * Render and encode the turntable loop.
 * @param {import('./scene.js').SlabScene} scene
 * @param {{onProgress?:(p:number)=>void, signal?:AbortSignal}} options
 * @returns {Promise<Blob>} video/mp4
 */
export async function exportTurntable(scene, { onProgress = () => {}, signal } = {}) {
  const setup = await probeEncoder();
  if (!setup) return recordFallback(scene, { onProgress, signal });
  const { config } = setup;
  const { size, fps, frames } = EXPORT_SPEC;
  const output = document.createElement('canvas');
  output.width = size;
  output.height = size;
  const context = output.getContext('2d', { alpha: false });
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: setup.muxer, width: size, height: size, frameRate: fps },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'strict',
  });
  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    },
  });
  encoder.configure(config);
  const session = scene.createExportSession(size);
  try {
    onProgress(0);
    for (let i = 0; i < frames; i++) {
      throwIfAborted(signal);
      if (encoderError) throw encoderError;
      await waitForCapacity(encoder, signal);
      context.drawImage(session.render(i / frames), 0, 0, size, size);
      const frame = new VideoFrame(output, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps),
      });
      try {
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      } finally {
        frame.close();
      }
      onProgress(((i + 1) / frames) * 0.94);
      if (i % 3 === 2) await nextTask(); // keep the progress UI painting
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    onProgress(1);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    try { encoder.close(); } catch { /* already closed */ }
    session.dispose();
  }
}

/**
 * Real-time MediaRecorder fallback for browsers without WebCodecs (Safari
 * before 17.4 records H.264 MP4 this way). Frames are drawn on animation
 * frames, paced at 30 fps, and pushed explicitly with requestFrame().
 */
async function recordFallback(scene, { onProgress, signal }) {
  if (typeof MediaRecorder !== 'function') throw new ExportError('unsupported', 'Video export is not supported in this browser');
  const mimeType = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new ExportError('unsupported', 'Video export is not supported in this browser');
  const { size, fps, frames } = EXPORT_SPEC;
  const output = document.createElement('canvas');
  output.width = size;
  output.height = size;
  // Kept in the document (invisible) so every browser composites its frames.
  output.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.append(output);
  const context = output.getContext('2d', { alpha: false });
  const session = scene.createExportSession(size);
  const stream = output.captureStream(0);
  const [track] = stream.getVideoTracks();
  const push = () => (track.requestFrame ? track.requestFrame() : stream.requestFrame?.());
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: EXPORT_SPEC.bitrate });
  const chunks = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  const animationFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    context.drawImage(session.render(0), 0, 0, size, size);
    recorder.start();
    push();
    const started = performance.now();
    let drawn = 0;
    while (drawn < frames) {
      throwIfAborted(signal);
      await animationFrame();
      const due = Math.min(frames, Math.floor(((performance.now() - started) * fps) / 1000) + 1);
      if (due <= drawn) continue;
      drawn = due; // when rendering is slow, skip ahead to keep real time
      context.drawImage(session.render((drawn - 1) / frames), 0, 0, size, size);
      push();
      onProgress((drawn / frames) * 0.96);
    }
    await animationFrame();
    await new Promise((resolve) => setTimeout(resolve, 1000 / fps));
    recorder.stop();
    await stopped;
    onProgress(1);
    return new Blob(chunks, { type: mimeType.split(';')[0] });
  } finally {
    if (recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    output.remove();
    session.dispose();
  }
}
