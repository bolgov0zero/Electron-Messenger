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
    const name = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    // Кладём путь в req ещё до того, как multer допишет файл — если клиент
    // отменит загрузку (крестик) или порвётся соединение прямо во время
    // передачи, req.file появиться не успеет, а req.on('close') ниже
    // сможет подчистить файл только по этому пути.
    req._uploadPath = path.join(FILES_DIR, name);
    cb(null, name);
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

// Размеры кадра — чтобы клиент сразу зарезервировал место под картинку/видео
// (aspect-ratio) и не дёргал ленту, когда вложение наконец догрузится
async function getVideoSize(filePath) {
  try {
    const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', filePath]);
    const [w, h] = stdout.trim().split('x').map(Number);
    return w > 0 && h > 0 ? { width: w, height: h } : null;
  } catch { return null; }
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
// req — тот же объект запроса, что и в обработчике: используем его как общее
// хранилище (req._ffmpegChild), чтобы req.on('close') ниже мог убить процесс,
// если клиент отменил загрузку (крестик) прямо во время транскода.
async function transcodeToH264IfNeeded(filePath, filename, req) {
  const codec = await getVideoCodec(filePath);
  if (!codec || codec === 'h264') return null; // уже совместимо (или не смогли определить — не рискуем портить файл)
  const outName = filename.replace(/\.[^.]*$/, '') + '_h264.mp4';
  const outPath = path.join(FILES_DIR, outName);
  try {
    await new Promise((resolve, reject) => {
      req._ffmpegChild = execFile('ffmpeg', [
        '-i', filePath, '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-movflags', '+faststart', '-y', outPath,
      ], err => (err ? reject(err) : resolve()));
    });
    req._ffmpegChild = null;
    fs.unlink(filePath, () => {});
    return outName;
  } catch (e) {
    req._ffmpegChild = null;
    console.warn('[Upload] video transcode failed:', e.message);
    try { fs.unlinkSync(outPath); } catch {}
    return null;
  }
}

router.get('/settings', authMiddleware, (req, res) => {
  res.json(getUploadSettings());
});

// Удаление уже загруженного, но ещё не отправленного вложения — крестик на
// плашке над композером жмут и после того, как файл полностью обработался
// (см. req.on('close')/res.on('close') выше — та отмена ловит только сам
// процесс загрузки/обработки, а не «передумал» уже после его завершения).
router.delete('/', authMiddleware, (req, res) => {
  const resolveSafe = (url) => {
    if (typeof url !== 'string' || !url) return null;
    // path.basename режет любые «..» и разделители — путь гарантированно
    // остаётся внутри FILES_DIR, куда бы ни указывал исходный url
    const name = path.basename(url);
    if (!name) return null;
    return { name, filePath: path.join(FILES_DIR, name) };
  };
  const targets = [resolveSafe(req.body.url), resolveSafe(req.body.thumb)].filter(Boolean);
  if (!targets.length) return res.status(400).json({ error: 'Некорректный путь' });
  // Файл, уже прикреплённый к отправленному сообщению, не трогаем — иначе
  // любой авторизованный пользователь мог бы стереть чужое вложение, просто
  // угадав его URL
  for (const t of targets) {
    const used = db.prepare("SELECT 1 FROM messages WHERE attachment LIKE '%' || ? || '%' LIMIT 1").get(t.name);
    if (used) return res.status(409).json({ error: 'Файл уже используется в сообщении' });
  }
  for (const t of targets) fs.unlink(t.filePath, () => {});
  res.json({ ok: true });
});

router.post('/',
  authMiddleware,
  // Регистрируем ДО multer — иначе не поймать отмену клиента (крестик) во
  // время самой загрузки файла, только во время последующей обработки.
  // req._uploadPath (см. storage.filename выше) известен уже на этом этапе,
  // req.file — только после того, как multer успешно всё дописал.
  (req, res, next) => {
    req._aborted = false;
    // Обрыв на середине multer сам бросает 'error' на request-стриме ("Request
    // aborted") — без слушателя это шумная трасса в логе на каждую отмену.
    // Реальную очистку делает 'close' ниже, этот — просто заглушка.
    req.on('error', () => {});
    // ВАЖНО: слушать нужно 'close' у res, а не у req — 'close' на req срабатывает,
    // как только тело запроса дочитано (т.е. сразу после того, как multer принял
    // файл), даже если клиент никуда не отключался и просто ждёт ответа. 'close' на
    // res, наоборот, срабатывает либо после нормального завершения ответа (тогда
    // res.writableEnded уже true — это не отмена), либо при реальном обрыве
    // соединения до того, как ответ был отправлен.
    res.on('close', () => {
      if (res.writableEnded) return;
      req._aborted = true;
      if (req._ffmpegChild) { try { req._ffmpegChild.kill('SIGKILL'); } catch {} }
      const p = req.file?.path || req._uploadPath;
      if (p) fs.unlink(p, () => {});
      for (const p2 of req._extraCleanupPaths || []) fs.unlink(p2, () => {});
    });
    next();
  },
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не принят' });
    if (req._aborted) return; // отменили прямо на стыке загрузки/обработки — close уже подчистил файл

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

    req._extraCleanupPaths = [];

    if (isVideo && hasFfmpeg()) {
      const newName = await transcodeToH264IfNeeded(req.file.path, req.file.filename, req);
      if (req._aborted) return; // close уже прибил ffmpeg и подчистил файлы
      if (newName) {
        req.file.filename = newName;
        req.file.path = path.join(FILES_DIR, newName);
        req.file.mimetype = 'video/mp4';
        try { req.file.size = fs.statSync(req.file.path).size; } catch {}
      }
    }

    let thumb = null;
    let width = null, height = null;
    if (isImage && sharp && req.file.mimetype !== 'image/gif') {
      try {
        const thumbName = req.file.filename.replace(/\.[^.]*$/, '') + '_t.webp';
        const thumbPath = path.join(FILES_DIR, thumbName);
        req._extraCleanupPaths.push(thumbPath);
        await sharp(req.file.path).rotate().resize({ width: 320, withoutEnlargement: true })
          .webp({ quality: 78 }).toFile(thumbPath);
        thumb = `/files/${thumbName}`;
      } catch (e) { console.warn('[Upload] thumbnail failed:', e.message); }
    }
    if (isImage && sharp) {
      // EXIF-ориентация 5-8 — кадр повёрнут на 90°, ширина и высота меняются местами
      // относительно того, что метаданные файла говорят «сырым» числом
      try {
        const meta = await sharp(req.file.path).metadata();
        if (meta.width && meta.height) {
          const swapped = meta.orientation >= 5 && meta.orientation <= 8;
          width = swapped ? meta.height : meta.width;
          height = swapped ? meta.width : meta.height;
        }
      } catch (e) { console.warn('[Upload] image size failed:', e.message); }
    }
    if (isVideo && hasFfmpeg()) {
      try {
        const duration = await getVideoDuration(req.file.path);
        const at = duration && duration < 10 ? duration / 2 : 10;
        const thumbName = req.file.filename.replace(/\.[^.]*$/, '') + '_t.jpg';
        const thumbPath = path.join(FILES_DIR, thumbName);
        req._extraCleanupPaths.push(thumbPath);
        await execFileP('ffmpeg', ['-ss', String(at), '-i', req.file.path, '-frames:v', '1', '-vf', 'scale=320:-1', '-y', thumbPath]);
        thumb = `/files/${thumbName}`;
      } catch (e) { console.warn('[Upload] video thumbnail failed:', e.message); }
      const size = await getVideoSize(req.file.path);
      if (size) ({ width, height } = size);
    }
    if (req._aborted) return;

    res.json({
      url: `/files/${req.file.filename}`,
      thumb,
      name: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
      width, height,
    });
  }
);

module.exports = router;
module.exports.startCleanupJob = startCleanupJob;
