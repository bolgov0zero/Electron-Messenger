// Выбросы радиусов: кнопки и кликабельные элементы на текущем экране. Круглыми допустимы только аватарки, точки, счётчики-бейджи.
(() => {
  const seen = {}, out = [];
  const sel = 'button,[role=button],[role=switch],.btn,.ibtn,.chip,.cell,.tb,.abtn,.seg,.fld,.srch,.tile,.pcard,.sheet,.cmm,.cmr,.upm,.toast,.bub,.grp,.cl-mb .rnd,.cl-rb,.cl-b,input,textarea,.row,.annb,.annp-c,.pinbar,.jump,.cnbar';
  document.querySelectorAll(sel).forEach(e => {
    const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || getComputedStyle(e).visibility === 'hidden') return;
    const cs = getComputedStyle(e), rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(parseFloat);
    const mx = Math.max(...rad); const circle = mx >= Math.min(r.width, r.height) / 2 - .6 && Math.abs(r.width - r.height) < 2;
    const cap = mx >= Math.min(r.width, r.height) / 2 - .6 && Math.abs(r.width - r.height) >= 2;
    const cls = (e.className && e.className.baseVal === undefined ? e.className : '').toString().split(/\s+/).slice(0, 3).join('.');
    const key = e.tagName.toLowerCase() + '.' + cls + ' r=' + rad.join('/') + (circle ? ' КРУГ' : cap ? ' КАПСУЛА' : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
    if (seen[key]) return; seen[key] = 1;
    const ok = !circle && !cap && rad.every(x => [0, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24].includes(Math.round(x)));
    if (!ok) out.push(key);
  });
  return out;
})()
