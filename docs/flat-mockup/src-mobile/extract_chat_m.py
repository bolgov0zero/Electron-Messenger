#!/usr/bin/env python3
"""Достаёт из CSS мобильного клиента (/m) правила переписки и токены, ограничивая их областью .chatreal.
Использование: extract_chat_m.py <выходной.css> <файл.css> [<файл.css> ...]  (в порядке подключения: app.css, extra.css, cshape.css, voice.css)"""
import re, sys

# классы переписки: правило берётся, если в селекторе есть хотя бы один из них
KEEP = set('''mrow bub mg msgs day-group day big swi who-n unrd sys quote txt react att-img vwrap vplay vph agrid agt file bacts bbtn
sk cpad lcard lc-im lc-b lc-t lc-d cblk cbh cbf cblk-cp spl spl-host spl-cv spl-e gif-msg gif-v gif-badge gp-kl failnote mn fwd fwq
dv er meta conly bcomp media gifm dl fail hl vm vm-in vm-out vm-sm vb wv mt du ud spd act playing p1 p2 n3 n4 n5 n6 n7 ct'''.split())
# классы, при которых правило относится не к переписке
SKIP = set('''scroll comp cin cfield cbar fpb lkb lpv lpt lth ce em ep-body ep-gif ep-row ep-sheet ep-tab cml cmb cmr cmm lbx lb lbz lbt lbd lbs lbc lbi lbh lbm lbv lbp lbb lbplay lbvc
page nav nb nr nt who pinbar jump row rt chip grp mini cell ci tile mgrid sheet fgrp fbar fin xtra axs ax axl axp axf axh rnote login chat tabbar tb tabview
vbar vtm vbt vs vp gp gp-search gp-chips gp-scroll gp-cols gp-item gp-note gp-retry gif-off gif-off-i vr-btn vr-row vr-field vr-side vr-bar vr-trash vr-hint vr-fx vr-rec vr-hold vr-will vr-lockd vr-off ready
fcard fci fcn fcm fcp fcs mfi mseg st cb-st
annb annp nbanner updc how hint pgav pgcam toast dot dot2 type
'''.split())
# html/класс-обёртки, которые убираем из начала селектора (в макете их роль играет .chatreal)
DROP_HEAD = re.compile(r'^(?:\.phone|\.chat|\.page(?:\.[\w-]+)*)\s+')


def strip_comments(s):
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S)


def blocks(s):
    out, i, n = [], 0, len(s)
    while i < n:
        j = i
        while j < n and s[j] not in '{;':
            j += 1
        if j >= n:
            break
        if s[j] == ';':
            out.append((s[i:j].strip(), None)); i = j + 1; continue
        depth, k = 1, j + 1
        while k < n and depth:
            c = s[k]
            if c in '"\'':
                q = c; k += 1
                while k < n and s[k] != q:
                    k += 2 if s[k] == '\\' else 1
            elif c == '{': depth += 1
            elif c == '}': depth -= 1
            k += 1
        out.append((s[i:j].strip(), s[j + 1:k - 1])); i = k
    return out


def split_sel(p):
    parts, depth, cur = [], 0, ''
    for c in p:
        if c in '([': depth += 1
        elif c in ')]': depth -= 1
        if c == ',' and depth == 0:
            parts.append(cur.strip()); cur = ''
        else:
            cur += c
    if cur.strip(): parts.append(cur.strip())
    return parts


HTML_PRE = re.compile(r'^(html(?:\.[\w-]+|\[[^\]]+\])*)\s+(.+)$')


def classes(sel):
    return set(re.findall(r'\.([A-Za-z][\w-]*)', re.sub(r'\([^)]*\)', '', sel)))


def keep(sel):
    cl = classes(sel)
    if not (cl & KEEP):
        return False
    # правило остаётся, если в нём нет «чужих» классов (кроме обёрток, которые убираются)
    sel2 = DROP_HEAD.sub('', sel)
    return not (classes(sel2) & SKIP)


def scope(sel):
    if sel in (':root', 'html', 'body') or sel.startswith('*'):
        return None
    m = HTML_PRE.match(sel)
    pre, rest = (m.group(1) + ' ', m.group(2)) if m else ('', sel)
    if rest.startswith('.cmc '):          # копия сообщения в меню по долгому нажатию: сама .cmc получает .chatreal
        return f'{pre}.cmc.chatreal ' + rest[5:]
    rest = DROP_HEAD.sub('', rest)
    return f'{pre}.chatreal ' + rest


TOKEN_SEL = {':root': '.chatreal', 'html.dark': 'html.dark .chatreal', 'html.dark.navy': 'html.dark.navy .chatreal', 'html.navy': 'html.navy .chatreal'}


def process(css, rules, tokens, kf):
    for pre, body in blocks(strip_comments(css)):
        if body is None:
            continue
        if pre.startswith('@media') or pre.startswith('@supports'):
            if 'prefers-reduced-motion' in pre or 'display-mode' in pre or 'max-width' in pre:
                continue
            sub_rules, sub_tokens, sub_kf = [], [], {}
            process(body, sub_rules, sub_tokens, sub_kf)
            if sub_rules:
                rules.append(f'{pre}{{\n' + '\n'.join(sub_rules) + '\n}')
            continue
        if pre.startswith('@keyframes'):
            kf[pre.split()[1]] = f'{pre}{{{body}}}'
            continue
        if pre.startswith('@'):
            continue
        sels = split_sel(pre)
        if len(sels) == 1 and sels[0] in TOKEN_SEL:
            decls = [d.strip() for d in re.split(r';(?![^()]*\))', body) if d.strip().startswith('--') and not d.strip().startswith('--accent')
                     and not d.strip().startswith('--sat') and not d.strip().startswith('--sab') and not d.strip().startswith('--stage')]
            if decls:
                tokens.append((TOKEN_SEL[sels[0]], decls))
            continue
        out = [scope(s) for s in sels if keep(s)]
        out = [o for o in out if o]
        if out:
            rules.append(', '.join(out) + '{' + body.strip() + '}')


def main():
    dst, files = sys.argv[1], sys.argv[2:]
    all_rules, all_tokens, all_kf = [], [], {}
    for f in files:
        process(open(f, encoding='utf-8').read(), all_rules, all_tokens, all_kf)
    text = '\n'.join(all_rules)
    used = [n for n in all_kf if re.search(r'animation[^;{}]*\b' + re.escape(n) + r'\b', text)]
    tok = '\n'.join(f'{sel}{{{";".join(d)}}}' for sel, d in all_tokens)
    css = '/* токены (из клиента /m, область чата) */\n' + tok + '\n/* правила переписки (из клиента /m, порядок сохранён) */\n' + text + '\n' + '\n'.join(all_kf[n] for n in used)
    open(dst, 'w', encoding='utf-8').write(css)
    print(len(all_rules), 'правил,', len(all_tokens), 'блоков токенов,', len(css), 'байт')


main()
