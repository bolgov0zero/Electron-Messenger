// Подготовка видео на устройстве отправителя: HEVC (iPhone) → H.264 аппаратным кодером
// через WebCodecs. Собирается в server/src/public/shared/video-prep.js (см. build.sh)
// и копируется в client/src/. Любая неудача возвращает исходный файл — тогда
// видео перекодирует сервер, как раньше.
import {
  Input, Output, Conversion, BlobSource, BufferTarget,
  MP4, QTFF, Mp4OutputFormat, QUALITY_MEDIUM,
} from 'mediabunny';

const MAX_SIDE = 1920;      // длинная сторона кадра после подготовки
const MAX_INPUT_MB = 500;   // больше сервер всё равно не примет

function supported() {
  return typeof VideoDecoder === 'function' && typeof VideoEncoder === 'function'
    && typeof EncodedVideoChunk === 'function' && typeof VideoFrame === 'function';
}

// Нужна ли подготовка: только mp4/mov с HEVC, который это устройство умеет декодировать
async function inspect(input) {
  const track = await input.getPrimaryVideoTrack();
  if (!track) return null;
  if (track.codec !== 'hevc') return null;
  if (!(await track.canDecode())) return null;
  return track;
}

async function prepare(file, opts = {}) {
  const { onProgress, signal } = opts;
  if (!supported() || file.size > MAX_INPUT_MB * 1024 * 1024) return file;
  let input = null, conversion = null, onAbort = null;
  try {
    input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF] });
    const track = await inspect(input);
    if (!track) return file;

    const w = track.displayWidth, h = track.displayHeight;
    // Режим кодера не задаём: «prefer-hardware» на части устройств падает с Encoding error,
    // а при «no-preference» браузер сам берёт аппаратный кодер, если он есть
    const video = { codec: 'avc', quality: QUALITY_MEDIUM };
    if (Math.max(w, h) > MAX_SIDE) { if (w >= h) video.width = MAX_SIDE; else video.height = MAX_SIDE; }

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    conversion = await Conversion.init({ input, output, video, audio: { codec: 'aac' } });
    // Не удалось сохранить звук или видео — не портим ролик, пусть решает сервер
    if (!conversion.isValid || conversion.discardedTracks.length) return file;

    if (signal) {
      if (signal.aborted) return file;
      onAbort = () => conversion.cancel();
      signal.addEventListener('abort', onAbort);
    }
    if (onProgress) conversion.onProgress = p => onProgress(Math.min(100, Math.round(p * 100)));
    await conversion.execute();

    const buf = output.target.buffer;
    if (!buf || !buf.byteLength) return file;
    const name = file.name.replace(/\.[^.]*$/, '') + '.mp4';
    return new File([buf], name, { type: 'video/mp4', lastModified: file.lastModified });
  } catch (e) {
    if (!(signal && signal.aborted)) console.warn('[VideoPrep] не вышло, отправляем как есть:', e && e.message ? e.message : e);
    return file;
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    try { input && input.dispose && input.dispose(); } catch {}
  }
}

window.VideoPrep = { prepare, supported };
