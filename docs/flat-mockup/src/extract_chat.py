#!/usr/bin/env python3
"""Достаёт из CSS настоящего клиента правила переписки и токены, ограничивая их областью .chatreal.
Использование: extract_chat.py <выходной.css> <файл.css> [<файл.css> ...]  (в порядке подключения)"""
import re, sys

PREFIX = re.compile(r'[.#](irc-|msg-|bubble|reaction|ra-|messages|date-divider|typing-|ch-typing|fwd-|status-|ct-|lcard|lc-|md-|edited-tag|emoji-msg|emoji-only|emoji-svg|voice|vc-|vm-|vo-|sc-|code-|link-|lp-|spoiler|tag-|mention|reply-|role-|pill|av\b|av-|irc|scroll-bottom|unread-divider|typing|messages-wrap)')
SKIP_SEL = re.compile(r'(modal|sidebar|composer|chat-header|topbar|ctx-|settings|\.cs-|\.pf-|\.nc-|\.gm-|\.cm-|\.anx-|login|call|#tb-|lightbox|ep-|emoji-panel|up-menu)')


def strip_comments(s):
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S)


def blocks(s):
    """Верхний уровень: [(prelude, body)] с учётом вложенных скобок и строк."""
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


# токены, которые в макете задаёт сама страница (вариант B): чат берёт их по наследованию
EXCL = re.compile(r'--(accent|gl-|gl2?\b|gl-pop|r-|text\b|text2|muted|danger|app-bg|side-bg|card-bg|modal-bg|chat-bg|bubble-bg|header-bg|search-bg|composer-bg|menu-bg|presence-|shadow-pop|stage|scrim|ff\b)')
HTML_PRE = re.compile(r'^(html(?:\.[\w-]+|\[[^\]]+\])*)\s+(.+)$')


def scope(sel):
    if sel in (':root', 'html', 'body') or sel.startswith('*'):
        return None
    m = HTML_PRE.match(sel)
    if m:
        return f'{m.group(1)} .chatreal {m.group(2)}'
    if sel.startswith('html') or sel.startswith('body'):
        return None
    return '.chatreal ' + sel


def keep(sel):
    return bool(PREFIX.search(sel)) and not SKIP_SEL.search(sel)


TOKEN_SEL = {':root': '.chatreal', 'html.dark': 'html.dark .chatreal', 'html.dark.navy': 'html.dark.navy .chatreal', 'html.navy': 'html.navy .chatreal'}


def process(css, rules, tokens, kf):
    for pre, body in blocks(strip_comments(css)):
        if body is None:
            continue
        if pre.startswith('@media') or pre.startswith('@supports'):
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
            decls = [d.strip() for d in re.split(r';(?![^()]*\))', body) if d.strip().startswith('--') and not EXCL.match(d.strip())]
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
    css = '/* токены (из клиента, область чата) */\n' + tok + '\n/* правила переписки (из клиента, порядок сохранён) */\n' + text + '\n' + '\n'.join(all_kf[n] for n in used)
    open(dst, 'w', encoding='utf-8').write(css)
    print(len(all_rules), 'правил,', len(all_tokens), 'блоков токенов,', len(css), 'байт')


main()
