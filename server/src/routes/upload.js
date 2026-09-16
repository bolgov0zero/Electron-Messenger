const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const util = require('util');
const { execFile, execFileSync } = require('child_process');
const { authMiddleware } = require('../auth');
const db = require('../db');

const execFileP = util.promisify(execFile);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', '..', 'chat_db', 'chat.db');
const FILES_DIR = path.join(path.dirname(DB_PATH), 'files');

function getSetting(key, def) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? def;
}

function getUploadSettings() {
  return {
    image: {
      maxSizeMb: parseInt(getSetting('upload_image_max_size', '10')),
      extensions: getSetting('upload_image_extensions', 'jpeg,jpg,png,gif,webp')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    },
    video: {
      maxSizeMb: parseInt(getSetting('upload_video_max_size', '50')),
      extensions: getSetting('upload_video_extensions', 'mp4,mov,webm')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    },
    file: {
      maxSizeMb: parseInt(getSetting('upload_file_max_size', '50')),
      extensions: getSetting('upload_file_extensions', '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    },
  };
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FILES_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

// Permissive limit — real limits are validated after upload
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

function startCleanupJob() {
  const run = () => {
    const lifetimeDays = parseInt(getSetting('upload_file_lifetime', '0'));
    if (!lifetimeDays) return;
    const cutoffMs = Date.now() - lifetimeDays * 86_400_000;
    try {
      for (const filename of fs.readdirSync(FILES_DIR)) {
        const filePath = path.join(FILES_DIR, filename);
        try {
          if (fs.statSync(filePath).mtimeMs < cutoffMs) {
            fs.unlinkSync(filePath);
            console.log('[Cleanup] Удалён устаревший файл:', filename);
          }
        } catch {}
      }
    } catch (e) { console.warn('[Cleanup] Ошибка:', e.message); }
  };
  run();
  setInterval(run, 6 * 3_600_000);
}

// sharp опционален: без него всё работает, просто не будет миниатюр
let sharp = null;
try { sharp = require('sharp'); } catch { console.warn('[Upload] sharp не установлен — миниатюры отключены'); }

// ffmpeg тоже опционален и нужен только для кадра-превью видео. Проверяем один раз
// при старте — на серверах без ffmpeg видео всё равно отправляются, просто без превью
let _ffmpegOk = null;
function hasFfmpeg() {
  if (_ffmpegOk === null) {
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); _ffmpegOk = true; }
    catch { _ffmpegOk = false; console.warn('[Upload] ffmpeg не найден — превью для видео отключены'); }
  }
  return _ffmpegOk;
}

async function getVideoDuration(filePath) {
  try {
    const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrapper=1:nokey=1', filePath]);
    const n = parseFloat(stdout);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

async function getVideoCodec(filePath) {
  try {
    const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath]);
    return stdout.trim() || null;
  } catch { return null; }
}

// iPhone (запись экрана и часть видео с камеры) по умолчанию пишет в HEVC/H.265 —
// его не декодирует ни один Chromium/Electron ни на одной платформе (лицензионное
// ограничение самого движка, не баг конкретной машины): контролы и звук работают,
// а картинки нет — ровно то, что видно у получателя. ffmpeg HEVC декодирует
// нормально, поэтому перекодируем такое видео в H.264 один раз при загрузке —
// дальше оно воспроизводится везде, у всех клиентов.
async function transcodeToH264IfNeeded(filePath, filename) {
  const codec = await getVideoCodec(filePath);
  if (!codec || codec === 'h264') return null; // уже совместимо (или не смогли определить — не рискуем портить файл)
  const outName = filename.replace(/\.[^.]*$/, '') + '_h264.mp4';
  const outPath = path.join(FILES_DIR, outName);
  try {
    await execFileP('ffmpeg', [
      '-i', filePath, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-movflags', '+faststart', '-y', outPath,
    ]);
    fs.unlink(filePath, () => {});
    return outName;
  } catch (e) {
    console.warn('[Upload] video transcode failed:', e.message);
    try { fs.unlinkSync(outPath); } catch {}
    return null;
  }
}

router.get('/settings', authMiddleware, (req, res) => {
  res.json(getUploadSettings());
});

router.post('/', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не принят' });

  // multer/busboy декодируют имя файла из multipart-заголовка как latin1, а браузер
  // шлёт его в UTF-8 — без обратного разворота кириллица превращается в кракозябры
  req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

  const settings = getUploadSettings();
  const isImage = req.file.mimetype.startsWith('image/');
  const isVideo = req.file.mimetype.startsWith('video/');
  const cfg = isImage ? settings.image : isVideo ? settings.video : settings.file;
  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();

  if (req.file.size > cfg.maxSizeMb * 1024 * 1024) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: `Файл превышает лимит ${cfg.maxSizeMb} МБ` });
  }

  if (cfg.extensions.length > 0 && !cfg.extensions.includes(ext)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: `Расширение .${ext} не разрешено` });
  }

  if (isVideo && hasFfmpeg()) {
    const newName = await transcodeToH264IfNeeded(req.file.path, req.file.filename);
    if (newName) {
      req.file.filename = newName;
      req.file.path = path.join(FILES_DIR, newName);
      req.file.mimetype = 'video/mp4';
      try { req.file.size = fs.statSync(req.file.path).size; } catch {}
    }
  }

  let thumb = null;
  if (isImage && sharp && req.file.mimetype !== 'image/gif') {
    try {
      const thumbName = req.file.filename.replace(/\.[^.]*$/, '') + '_t.webp';
      await sharp(req.file.path).rotate().resize({ width: 320, withoutEnlargement: true })
        .webp({ quality: 78 }).toFile(path.join(FILES_DIR, thumbName));
      thumb = `/files/${thumbName}`;
    } catch (e) { console.warn('[Upload] thumbnail failed:', e.message); }
  }
  if (isVideo && hasFfmpeg()) {
    try {
      const duration = await getVideoDuration(req.file.path);
      const at = duration && duration < 10 ? duration / 2 : 10;
      const thumbName = req.file.filename.replace(/\.[^.]*$/, '') + '_t.jpg';
      await execFileP('ffmpeg', ['-ss', String(at), '-i', req.file.path, '-frames:v', '1', '-vf', 'scale=320:-1', '-y', path.join(FILES_DIR, thumbName)]);
      thumb = `/files/${thumbName}`;
    } catch (e) { console.warn('[Upload] video thumbnail failed:', e.message); }
  }

  res.json({
    url: `/files/${req.file.filename}`,
    thumb,
    name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
  });
});

module.exports = router;
module.exports.startCleanupJob = startCleanupJob;
