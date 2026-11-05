#!/usr/bin/env python3
"""Шаг 1.11: чистка стеклянных остатков в server/src/public/m/css. Запуск: python3 clean.py <папка css>  (правит файлы на месте).
Токены тем и все плоские алиасы стекла живут в flat.css; здесь удаляются старые значения и правила, которые flat.css уже перекрывал."""
import re, sys, os
D = sys.argv[1]
rd = lambda n: open(os.path.join(D, n), encoding='utf-8').read()
def wr(n, s): open(os.path.join(D, n), 'w', encoding='utf-8').write(s)
def cut(s, a, b, keep_b=True, new=''):
    i = s.index(a); j = s.index(b, i)
    return s[:i] + new + (s[j:] if keep_b else s[j + len(b):])
def strip_backdrop(s):
    for m in list(re.finditer(r'([^{}]+)\{([^{}]*)\}', s)):
        sel, body = m.group(1), m.group(2)
        if '.edge.t' in sel: continue
        nb = re.sub(r'\s*(?:-webkit-)?backdrop-filter\s*:[^;}]*;?', '', body)
        if nb != body: s = s.replace(m.group(0), sel + '{' + nb + '}', 1)
    return s
def common(s):
    s = re.sub(r'linear-gradient\(\s*140deg\s*,\s*var\(--gl-out-a\)\s*,\s*var\(--gl-out-b\)\s*\)', 'var(--accent-fill)', s)
    s = re.sub(r'radial-gradient\(120% (?:90|80)% at 0% 0%,\s*var\(--gl-spec\),\s*transparent 55%\)\s*,\s*', '', s)
    s = re.sub(r'(?:inset 0 1px 0 (?:var\(--gl-hi\)|rgba\(255,255,255,\.\d+\)),?\s*)', '', s)
    s = re.sub(r'(?:inset 0 -1px 0 (?:var\(--gl-lo\)|rgba\(0,0,0,\.12\)),?\s*)', '', s)
    s = re.sub(r',\s*(?=[;}])', '', s)   # хвостовая запятая в box-shadow после удаления вставок
    s = s.replace('var(--gl-spring)', 'var(--gl-ease)')
    s = re.sub(r'box-shadow:\s*0 6px 1[68]px color-mix\(in srgb,var\(--gl-out-b\) 38%,transparent\)', 'box-shadow:none', s)
    return s

# ───── app.css ─────
s = rd('app.css')
s = re.sub(r'/\* ═+\n   МАКЕТ КЛИЕНТА.*?═+ \*/', '/* /m: мобильный клиент. Структура и размеры — здесь, оформление (токены тем, поверхности, кнопки, формы) — в flat.css (вариант B «Мягкий»).\n   Система форм: кнопки, поля, пункты 12 · карточки 16 · листы и панели 22 · чипы 8–10 · пузыри 18. Отступы 4/8, значки 16/18/20/22 (обводка 2), слои z: 10 контент · 20 полосы · 30 всплывающее · 40 окна · 50 тосты. */', s, count=1, flags=re.S)
s = cut(s, ':root{\n  --ff:', '*{box-sizing')                         # токены тем и стекла: перенесены в flat.css
s = cut(s, '/* ── Стекло: панель', '/* ── Кнопки:', new='.gi{position:relative}\n\n')
s = re.sub(r'html\.dark\.navy\{[^}]*\}\n', '', s)
s = cut(s, '/* ── Панель «Принципы»', '/* ═══════════════ МОБИЛЬНЫЙ КЛИЕНТ')
s = re.sub(r'(?m)^:root\{--sat:54px;--sat0:54px;--sab:34px;[^}]*\}', ':root{--sat:54px;--sat0:54px;--sab:34px}', s)
s = re.sub(r'(?m)^\.phone\.noamb \.amb\{[^}]*\}\n|^\.amb\{[^\n]*\n(?:  [^\n]*\n)*|^\.amb i[^\n]*\n|^\.page>\.amb[^\n]*\n', '', s)
s = re.sub(r'(?m)^\.edge\.b\{[^\n]*\n', '', s)
s = re.sub(r'(?m)^\.nav::before\{[^\n]*\n|^\.nav\.sc::before\{[^\n]*\n', '', s)
s = re.sub(r'(?m)^/\* Низ прозрачный[^\n]*\n\.edge\.b\{display:none\}\n', '', s)
s = re.sub(r'(?m)^\.edge\.b\{display:none\}\n', '', s)
s = re.sub(r'(?m)^\.tabbar \.thumb\{[^\n]*\n', '', s)
s = re.sub(r'(?m)^\.tabbar\{padding:4px;border-radius:28px\}\n', '', s)
s = strip_backdrop(s); s = common(s)
s = s.replace('--gl-card2', '--gl-card2')
wr('app.css', s)

# ───── extra.css ─────
s = rd('extra.css')
s = re.sub(r'/\* ═+\n   /m — дополнения к макету.*?═+ \*/', '/* /m: рабочий клиент поверх базовой раскладки app.css — вложения, просмотр, поле ввода на contenteditable, плашки состояния, вход, объявления, GIF, код, превью ссылок.\n   Оформление (цвета, формы, поверхности) задаёт flat.css, здесь — структура и размеры. */', s, count=1, flags=re.S)
s = s.replace("--card: var(--gl); --sep: var(--gl-lo); --bg: var(--gl-base); --bg2: var(--gl-base);", "--card: var(--gl); --sep: var(--gl-lo); --bg: var(--gl-base); --bg2: var(--gl-base);")
s = re.sub(r'(?m)^\.chat \.nav::before \{[^\n]*\}\n', '', s)
a = s.index('/* Стекло не должно «мигать»')
b = s.index('/* панель папок липнет под бейджем раздела')
s = s[:a] + '/* Вкладки: прозрачности в анимации нет — предыдущий раздел прячется сразу, новый подъезжает сдвигом */\n.tabview { opacity: 1; visibility: hidden; transition: transform .45s var(--gl-ease), visibility 0s; }\n.tabview.on { visibility: visible; }\n\n' + s[b:]
s = re.sub(r'(?m)^\.login > \.amb \{[^\n]*\}\n', '', s)
s = re.sub(r'(?m)^\.tabbar \.thumb \{[^\n]*\}\n', '', s)
s = re.sub(r'/\* узор фона переписки:.*?\n\.chat \.amb::after \{[^\n]*\}', '/* узор фона переписки: картинка из настроек (общие с /chat и /m), под лентой */\n.page.chat::before { content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none; background: var(--pat-ink, transparent); -webkit-mask-image: var(--pat, none); mask-image: var(--pat, none); -webkit-mask-size: calc(var(--pat-size, 680px) * .55); mask-size: calc(var(--pat-size, 680px) * .55); opacity: var(--pat-a, 0); }', s, flags=re.S)
s = s.replace(".mrow { --tg-in: #fff; --tg-out: color-mix(in srgb, var(--gl-out-a) 46%, var(--gl-out-b)); }\nhtml.dark .mrow { --tg-in: var(--bubble-bg); }", ".mrow { --tg-in: var(--bubble-bg); --tg-out: var(--accent-fill); }")
s = s.replace("background: var(--gl-out-a); color: #fff; }", "background: var(--accent-fill); color: #fff; }")
s = re.sub(r'/\* страницы в движении:[^\n]*\n\.page\.mv[^\n]*\n', '', s)
s = strip_backdrop(s); s = common(s)
wr('extra.css', s)

# ───── дополнительно: папки, комментарии, cshape → composer.css, flat.css, JS и index.html ─────
M = os.path.dirname(os.path.abspath(D))
s = rd('app.css')
s = cut(s, '/* Папки в списке чатов:', '/* У полей ввода нет прямоугольной рамки', new='''/* Папки: плоские чипы в прокручиваемой ленте. Панель липнет под шапкой; у профиля группы (.fbar.pgf) не липкая; поля вокруг ленты оставлены под выступающие края */
.fbar{position:sticky;top:50px;z-index:6;margin:0 -16px 6px;display:flow-root}
.fbar .chips{position:relative;margin:-4px 0 -20px;padding:10px 16px 26px}

''')
s = s.replace('.amb i{animation:none!important}', '')
s = re.sub(r'/\* ═+ МОБИЛЬНЫЙ КЛИЕНТ \(/m\) — макет Liquid Glass ═+\n.*?строка 20 \*/', '/* ═══════════════ МОБИЛЬНЫЙ КЛИЕНТ (/m) ═══════════════\n   Навигация как в iOS: стек страниц, большие заголовки, докованные шапка и вкладки, шторки снизу. Размеры в немасштабированных пикселях телефона 393 px; цель нажатия ≥ 44. */', s, count=1, flags=re.S)
s = s.replace('/* верхняя панель: плавающие стеклянные элементы; на больших заголовках появляется при прокрутке */', '/* верхняя панель: докованная; на больших заголовках фон появляется при прокрутке */')
s = s.replace('/* вкладки: плавающая стеклянная капсула */', '/* вкладки: докованная нижняя панель */')
wr('app.css', s)
s = rd('extra.css')
s = s.replace('/* переключатель папок: стеклянный блок на всю ширину окна (как строка поиска), чипы прокручиваются внутри него */', '/* переключатель папок: блок на всю ширину окна, чипы прокручиваются внутри него */')
s = s.replace('/* прокручиваемая лента внутри стеклянного блока отступает на 4 px от его границы, поэтому чипы обрезаются не вплотную к границе, а с таким же отступом, как у выбранного */', '/* лента с прокруткой внутри блока */')
s = re.sub(r'(?m)^\.chips\.fo > \.fgrp\.glass::before, \.chips\.fo > \.fgrp\.glass::after \{[^\n]*\}\n\.chips\.fo > \.fgrp\.glass::before \{[^\n]*\}\n\.chips\.fo > \.fgrp\.glass::after \{[^\n]*\}\n', '', s)
s = re.sub(r'(?m)^/\* края ленты папок:[^\n]*\n', '/* края ленты папок: затухание текста (маска) там, где чипы уходят под край блока */\n', s)
s = re.sub(r'\*/\s*\n(\.fgrp \.thumb \{[^\n]*\})', '*/\n\\1', s)
wr('extra.css', s)
# cshape.css → composer.css (без стеклянных форм)
c = common(strip_backdrop(rd('cshape.css')))
c = re.sub(r'(?m)^\.comp\.cs > \.cs-gl, \.comp\.cs > \.cs-ed \{[^\n]*\}\n\.comp\.cs > \.cs-gl \{[^\n]*\}\n\.comp\.cs > \.cs-ed \{[^\n]*\}\n\.cs-gl \{[^\n]*\n\.cs-edp \{[^\n]*\}\n', '', c)
c = re.sub(r'^/\*.*?\*/\n', '/* Поле ввода: сетка из панелей .xtra (строка 1, на всю ширину) и ряда «+» / поле / отправка (строка 2). Докованную подложку рисует flat.css (.comp::before) */\n', c, count=1, flags=re.S)
c = c.replace('/* отступ снизу выставляет cshape.js по высоте содержимого */', '/* отступ снизу выставляет xtraFit (composer.js) */')
c = c.replace('.comp.cs > .cfield { grid-column: 2; grid-row: 2; z-index: 2; background: none; border: 0; box-shadow: none; overflow: visible; }', '.comp.cs > .cfield { grid-column: 2; grid-row: 2; z-index: 2; }')
c = c.replace('.comp.cs > .lkb { grid-column: 1 / -1; grid-row: 2; z-index: 2; background: none; border: 0; box-shadow: none; }', '.comp.cs > .lkb { grid-column: 1 / -1; grid-row: 2; z-index: 2; }')
open(os.path.join(D, 'composer.css'), 'w', encoding='utf-8').write(c)
os.remove(os.path.join(D, 'cshape.css'))

# flat.css
f = rd('flat.css')
f = f.replace("  --gl-blur:0px;--gl-k:1;--gl-in:", "  --gl-blur:0px;--gl-in:")
f = re.sub(r'/\* ═+\n   /m — дизайн B «Мягкий» \(без стекла\)\..*?═+ \*/', '/* ═══════════════════════════════════════════════════════════════════════════\n   /m — дизайн B «Мягкий»: единственное место оформления. Подключается ПОСЛЕ app.css, extra.css, composer.css и /shared/voice.css.\n   Здесь: токены тем, плоские поверхности, примитивы (кнопки, поля, сегмент, тумблер, чипы, бейджи, аватарки), каркас (шапки, нижняя панель, страницы, шторки),\n   переписка, поле ввода, меню, окна и звонки. Источник — docs/flat-mockup/mobile.html (src-mobile/flat-b-m.css) и PLAN.md, раздел 2. Шрифт — Inter (токен --ff не менять).\n   Геометрия /m (PLAN.md, 4.1) не меняется: переменные --sat0/--sat/--sab/--co/--ch/--kbh и якоря .nav, .scroll, .tabbar, .comp, .jump, .sheet, .pinbar, верхний краевой эффект .edge.t лежат в app.css.\n   ═══════════════════════════════════════════════════════════════════════════ */', f, count=1, flags=re.S)
f = f.replace('/* токены стекла: плоские значения (чтобы код, который на них ссылается, рисовал без стекла) */', '/* плоские алиасы прежних токенов: их читает общий код shared/* (окна ссылок, звонки, голосовые) */')
f = f.replace('/* ───── поверхности: плоские непрозрачные карточки вместо стекла ───── */', '/* ───── поверхности: плоские непрозрачные карточки ───── */')
f = f.replace('/* ───── то, что без этих правил осталось бы стеклянным (подробное оформление — шаги 1.3–1.10) ───── */', '/* ───── прочие плоские поверхности ───── */')
f = f.replace(";--gl-spotlight:transparent", "")
f = f.replace("--gl-base:var(--app-bg);--scrim:rgba(40,28,16,.32);--stage:var(--app-bg);\n  --amb-1:transparent;--amb-2:transparent;--amb-3:transparent;--amb-4:transparent;", "--gl-base:var(--app-bg);--scrim:rgba(40,28,16,.32);")
f = f.replace("/* ───── 1.0 токены ───── */\n:root{\n", """/* ───── 1.0 токены ───── */
:root{
  --ff:Inter,-apple-system,system-ui,sans-serif;
  --accent:#1fa88c;--accent-rgb:29,168,140;--danger:#d23a3a;
  --presence-online:#34c759;--presence-away:#ff9f0a;--read:#3ea6ff;
  --tag-1:41,50,96;--tag-2:37,131,37;--tag-3:131,78,37;--tag-4:34,119,114;--tag-5:131,37,78;
  --ic-s:16px;--ic-m:18px;--ic-l:22px;--z-bar:20;--z-pop:30;--z-modal:40;--z-toast:50;
  --gl-ease:cubic-bezier(.22,1,.36,1);
""",1)
f = f.replace("html.dark{\n  --app-bg:", """html.dark{
  --accent:#29d6b8;--accent-rgb:41,214,184;--danger:#ef6f6f;
  --tag-1:125,136,191;--tag-2:98,218,98;--tag-3:218,150,98;--tag-4:98,218,210;--tag-5:218,98,150;
  --app-bg:""",1)
for old in (".gi::after{display:none}\n", ".gi:hover{background-color:transparent}\n", ".amb i{display:none}\n", ".phone>.amb,.page:not(.chat)>.amb{display:none}\n", ".nav::before{display:none}\n",
            ".tabbar .thumb{display:none}\n", ".fbar::before,.fbar.stuck::before{display:none}\n", ".chips.fo>.fgrp.glass::before,.chips.fo>.fgrp.glass::after{display:none}\n",
            ".comp.cs>.cs-gl,.comp.cs>.cs-ed{display:none}\n", ".mrow{--tg-in:var(--bubble-bg);--tg-out:var(--accent-fill)}\nhtml.dark .mrow{--tg-in:var(--bubble-bg)}\n"):
    f = f.replace(old, '')
f = f.replace("/* слой цветных пятен убран; в переписке остаётся только он сам (на нём лежит «Узор»: .chat .amb::after) */\n", "")
f = f.replace(".comp.cs>.cfield{background:var(--surf2);border-radius:12px;overflow:hidden}", ".comp.cs>.cfield{background:var(--surf2);border-radius:12px;overflow:hidden}")
# backdrop-filter: оставляем только там, где перекрываем CSS из shared/*
SHARED = ('.gl-bg', '.cl-', '#cl-', '.gl-pop')
for m in list(re.finditer(r'([^{}]+)\{([^{}]*)\}', f)):
    sel, body = m.group(1), m.group(2)
    if any(k in sel for k in SHARED): continue
    nb = re.sub(r'\s*(?:-webkit-)?backdrop-filter\s*:[^;}]*;?', '', body)
    if nb != body: f = f.replace(m.group(0), sel + '{' + nb + '}', 1)
f = f.replace('.tabbar,.tabbar.glass{left:0;right:0;bottom:0;transform:none;width:auto;border-radius:0;gap:0;padding:5px 8px calc(var(--sab) - 5px);', '.tabbar,.tabbar.glass{left:0;right:0;bottom:0;transform:none;width:auto;border-radius:0;gap:0;padding:5px 8px calc(var(--sab) - 5px);')
wr('flat.css', f)

# JS и index.html
J = lambda p: os.path.join(M, p)
def sub_file(path, pairs):
    t = open(J(path), encoding='utf-8').read()
    for a, b in pairs:
        assert a in t, (path, a[:60])
        t = t.replace(a, b)
    open(J(path), 'w', encoding='utf-8').write(t)
sub_file('js/ui/kit.js', [("  amb: '<div class=\"amb\"><i></i><i></i><i></i><i></i></div><i class=\"edge t\"></i><i class=\"edge b\"></i>',", "  edge: '<i class=\"edge t\"></i>',   // краевой эффект под статус-баром iOS"), ("el.innerHTML = B.nav.amb + nav", "el.innerHTML = B.nav.edge + nav")])
sub_file('js/ui/chat.js', [("el.innerHTML = B.nav.amb +", "el.innerHTML = B.nav.edge +")])
sub_file('js/ui/login.js', [("el.innerHTML = B.nav.amb +", "el.innerHTML = B.nav.edge +")])
sub_file('js/main.js', [("shell.innerHTML = B.nav.amb +", "shell.innerHTML = B.nav.edge +"), ("<div class=\"tabbar glass\" id=\"tabbar\"><i class=\"thumb\"></i>' +", "<div class=\"tabbar glass\" id=\"tabbar\">' +")])
t = open(J('js/main.js'), encoding='utf-8').read()
t = re.sub(r"  function moveThumb\(\) \{[^\n]*\n", '', t)
t = t.replace("    moveThumb();\n", '').replace("; requestAnimationFrame(moveThumb); setTimeout(moveThumb, 300); }", "; }").replace("  addEventListener('resize', function () { moveThumb(); });\n", '')
open(J('js/main.js'), 'w', encoding='utf-8').write(t)
t = open(J('js/ui/composer.js'), encoding='utf-8').read()
t = t.replace("    CShape.attach(c);", "    xtraFit(c);")
t = t.replace("    // Дополнительные панели (.xtra) лежат над рядом на всю ширину и огибают кнопки; подложку рисует CShape по их высоте", "    // Дополнительные панели (.xtra) лежат над рядом на всю ширину; воздух под ними выставляет xtraFit по высоте содержимого")
t = t.replace("  function mount(el, chat) {", """  // Воздух под панелями .xtra (до 16 px) и сетка поля (класс cs): считается по высоте содержимого панелей
  function xtraFit(comp) {
    if (comp._cs) return;
    var xtra = comp.querySelector('.xtra'); comp.classList.add('cs');
    function fit() {
      if (!xtra) return;
      var ph = 0; for (var i = 0; i < xtra.children.length; i++) ph += xtra.children[i].offsetHeight;
      var pb = Math.round(16 * Math.max(0, Math.min(1, ph / 24)));
      if (xtra._pb !== pb) { xtra._pb = pb; xtra.style.paddingBottom = pb + 'px'; }
    }
    if (xtra) new ResizeObserver(fit).observe(xtra);
    comp._cs = { burst: fit }; fit();
  }
  function mount(el, chat) {""", 1)
open(J('js/ui/composer.js'), 'w', encoding='utf-8').write(t)
if os.path.exists(J('js/ui/cshape.js')): os.remove(J('js/ui/cshape.js'))
t = open(J('index.html'), encoding='utf-8').read()
t = t.replace('<div class="amb"><i></i><i></i><i></i><i></i></div>', '')
t = t.replace('<link rel="stylesheet" href="/m/css/cshape.css?v=1">', '<link rel="stylesheet" href="/m/css/composer.css?v=1">')
t = t.replace('<script src="/m/js/ui/cshape.js?v=1"></script>\n', '')
open(J('index.html'), 'w', encoding='utf-8').write(t)

# ───── остатки стекла в JS: комментарии, класс mv (размытие при движении), блик за пальцем ─────
t = open(J('js/ui/kit.js'), encoding='utf-8').read()
t = t.replace('// /m — каркас интерфейса по макету Liquid Glass: оболочка-«телефон» 393 px', '// /m — каркас интерфейса: оболочка-«телефон» 393 px')
t = t.replace('Разметка и классы — как в макете (mock.html).', 'Разметка и классы — как в макете (docs/flat-mockup/mobile.html).')
t = re.sub(r"// Пока страницы едут[^\n]*\n// странице пересчитывались[^\n]*\nfunction moving\(els\) \{[^\n]*\n", '', t)
t = t.replace('moving([el, prev.el]); ', '').replace(' moving([top.el, under]);', '').replace('moving([g.top, g.und]); ', '')
t = re.sub(r"// Блик за пальцем на интерактивном стекле; кнопка после нажатия мышью не остаётся в фокусе\ndocument\.addEventListener\('pointerdown', function \(e\) \{\n[^\n]*\n\}\);\n", '// Кнопка после нажатия мышью не остаётся в фокусе\n', t)
assert 'moving(' not in t and 'Блик' not in t
open(J('js/ui/kit.js'), 'w', encoding='utf-8').write(t)
for path, a, b in (('js/ui/chat.js', 'шапка со «стеклянной» капсулой собеседника', 'шапка с собеседником'), ('js/ui/composer.js', '«+», стеклянное поле со смайлами', '«+», поле со смайлами')):
    t = open(J(path), encoding='utf-8').read(); assert a in t; open(J(path), 'w', encoding='utf-8').write(t.replace(a, b))
