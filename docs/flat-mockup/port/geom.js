// Замер геометрии каркаса живого /m (JS-выражение для shot-live.js, шаг с "log": true): прямоугольники якорей из PLAN.md 4.1.
(() => {
  const r = e => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; };
  const vis = s => [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').slice(-1)[0];
  const pg = [...document.querySelectorAll('#stack>.page')].filter(p => !p.hidden).slice(-1)[0];
  const tv = pg && (pg.querySelector('.tabview.on') || pg);
  const nav = tv && tv.querySelector('.nav') || (pg && pg.querySelector('.nav'));
  const cs = (e, p) => e ? getComputedStyle(e)[p] : null;
  return {
    nav: r(nav), navBtn: r(nav && nav.querySelector('.nb')), navR: r(nav && nav.querySelector('.nr')), navPadTop: cs(nav, 'paddingTop'),
    title: r(tv && tv.querySelector('.lt')), tabbar: r(document.querySelector('#tabbar')), tb: r(document.querySelector('#tabbar .tb')),
    tbIcon: r(document.querySelector('#tabbar .tb svg')), comp: r(pg && pg.querySelector('.comp')), cfield: r(pg && pg.querySelector('.cfield')),
    scrollPad: cs(tv && tv.querySelector('.scroll') || (pg && pg.querySelector('.scroll')), 'padding'),
    edgeT: r(pg && pg.querySelector('.edge.t')), vars: ['--sat0', '--sat', '--sab', '--co', '--ch'].map(v => v + '=' + getComputedStyle(document.getElementById('app')).getPropertyValue(v).trim()).join(' ')
  };
})()
