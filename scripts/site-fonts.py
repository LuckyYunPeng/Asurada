#!/usr/bin/env python3
"""把官网用到的 Google Fonts 下载到 site/assets/fonts/，生成同源的 fonts.css。

中文字体按 site/index.html 里实际出现的字做子集，改了官网中文文案后要重新运行：
    python3 scripts/site-fonts.py
"""
import hashlib
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
OUT = SITE / 'assets' / 'fonts'
# 用桌面 Chrome 的 UA，Google 才返回 woff2
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
LATIN = 'family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,500;0,8..60,650;0,8..60,700;1,8..60,500'


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30) as res:
        return res.read()


def main():
    html = (SITE / 'index.html').read_text(encoding='utf-8')
    cjk = ''.join(sorted({c for c in html if ord(c) > 0x2E7F}))
    latin_css = fetch(f'https://fonts.googleapis.com/css2?{LATIN}&display=swap').decode()
    sc_css = fetch('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;600&display=swap&text='
                   + urllib.parse.quote(cjk)).decode()
    # 官网只有中英文，拉丁字体只保留 latin 子集
    blocks = re.findall(r'/\* latin \*/\s*(@font-face \{.*?\})', latin_css, re.S)
    blocks += re.findall(r'@font-face \{.*?\}', sc_css, re.S)
    assert blocks, 'Google Fonts 没有返回 @font-face'

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.woff2'):
        old.unlink()
    files = {}
    for url in {u for b in blocks for u in re.findall(r'url\((\S+?)\)', b)}:
        data = fetch(url)
        assert data[:4] == b'wOF2', f'不是 woff2：{url}'
        name = hashlib.sha1(data).hexdigest()[:12] + '.woff2'
        (OUT / name).write_bytes(data)
        files[url] = name
    css = '\n'.join(re.sub(r'url\((\S+?)\)', lambda m: f'url(./{files[m.group(1)]})', b) for b in blocks)
    (OUT / 'fonts.css').write_text(f'/* 由 scripts/site-fonts.py 生成，不要手改 */\n{css}\n', encoding='utf-8')
    # 文件名带哈希，同步改写 index.html 里的预加载，让字体和 CSS 并行下载，减少回退字体闪一下
    links = ['<link rel="stylesheet" href="./assets/fonts/fonts.css">'] + [
        f'<link rel="preload" href="./assets/fonts/{n}" as="font" type="font/woff2" crossorigin>' for n in sorted(files.values())]
    html, count = re.subn(r'(<!-- fonts:start -->\n).*?(<!-- fonts:end -->)',
                          lambda m: m.group(1) + '\n'.join(links) + '\n' + m.group(2), html, flags=re.S)
    assert count == 1, 'index.html 里找不到 <!-- fonts:start --> / <!-- fonts:end -->'
    (SITE / 'index.html').write_text(html, encoding='utf-8')
    print(f'{len(blocks)} 个 @font-face，{len(files)} 个字体文件，中文子集 {len(cjk)} 字')


if __name__ == '__main__':
    main()
