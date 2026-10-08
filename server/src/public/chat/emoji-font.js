// Проверка, что вшитый шрифт смайлов вообще рисуется, и выбор набора (см. emoji-font.css).
//
// Не всякий браузер умеет показывать шрифт в формате COLRv1 (Safari не умеет вовсе). Беда в том,
// что при неумении подмены на системный шрифт не происходит: браузер видит, что шрифт подошёл
// по коду символа, берёт его — и рисует блоки или не рисует ничего. Поэтому проверяем не по
// наличию шрифта, а по факту: рисуем смайл только этим семейством и смотрим, что вышло.
//
// Порядок такой:
//   1. COLRv1 — если браузер заявляет поддержку формата (font-tech) и смайл на холсте рисуется.
//      Один лишь «рисуется» тут не годится: Safari рисует из COLRv1 цветные блоки.
//   2. sbix — картинки в родном формате Apple (Safari на Mac и iPhone).
//   3. Ни тот, ни другой — возвращаем системные смайлы: они разные на разных системах,
//      но это несравнимо лучше пустоты.
(function () {
  async function paints(family) {
    try {
      await document.fonts.load('64px "' + family + '"', '\u{1F600}');
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.font = '48px "' + family + '"';
      ctx.textBaseline = 'top';
      ctx.fillText('\u{1F600}', 0, 0);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      let colored = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 20) continue;
        if (Math.abs(d[i] - d[i + 1]) > 25 || Math.abs(d[i + 1] - d[i + 2]) > 25) colored++;
      }
      // У рабочего набора цветных точек около 1800, у нерабочего ноль: порог с большим запасом
      return colored >= 40;
    } catch { return false; }
  }
  async function checkEmojiFont() {
    const root = document.documentElement;
    let colrDeclared = true;
    try { if (window.CSS && CSS.supports) colrDeclared = CSS.supports('font-tech(color-COLRv1)'); } catch {}
    if (colrDeclared && await paints('Noto Color Emoji')) { root.classList.add('emoji-colr'); return; }
    root.classList.add('emoji-sbix');
    if (await paints('Noto Emoji Sbix')) return;
    root.classList.remove('emoji-sbix');
    root.classList.add('no-emoji-font');
  }
  window.emojiFontReady = checkEmojiFont();
})();
