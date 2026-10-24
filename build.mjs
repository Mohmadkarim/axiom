// Builds dist/index.html (installable PWA, everything inlined) and dist/artifact.html (claude.ai page form).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
const src = (p) => readFileSync(new URL('./src/' + p, import.meta.url), 'utf8');
const ORDER = ['core', 'icons', 'store', 'subjects', 'geom', 'brushes', 'doc', 'render', 'guides', 'input', 'stamps', 'ui-tools', 'ui-color', 'ui-layers', 'ui-panels', 'study', 'ai', 'reader', 'textedit', 'notebook', 'ui-gallery', 'app'];
const js = ORDER.map((n) => `/* ---- ${n}.js ---- */\n` + src(`js/${n}.js`)).join('\n');
const css = src('css/app.css');
const body = src('body.html');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@500;600;700&display=swap">';
const build = Date.now().toString(36);
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Axiom</title>
<meta name="description" content="An infinite canvas for scientists and mathematicians">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Axiom">
<meta name="theme-color" content="#eef0f3">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" href="icon-192.png">
${fonts}
<style>${css}</style>
</head>
<body>
${body}
<script>window.AXIOM_BUILD = '${build}';
${js}</script>
</body>
</html>
`;
writeFileSync(new URL('./dist/index.html', import.meta.url), full);
const art = `<title>Axiom Canvas</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>${css}
html, body { height: 100%; }</style>
${body}
<script>window.AXIOM_NO_SW = true;
${js}</script>
`;
writeFileSync(new URL('./dist/artifact.html', import.meta.url), art);
writeFileSync(new URL('./dist/sw.js', import.meta.url), src('sw.js').replace('__BUILD__', build));
copyFileSync(new URL('./src/manifest.webmanifest', import.meta.url), new URL('./dist/manifest.webmanifest', import.meta.url));
mkdirSync(new URL('./dist/vendor/', import.meta.url), { recursive: true });
for (const f of ['pdf.min.js', 'pdf.worker.min.js', 'epub.min.js', 'jszip.min.js']) copyFileSync(new URL('./src/vendor/' + f, import.meta.url), new URL('./dist/vendor/' + f, import.meta.url));
for (const f of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
  const p = new URL('./src/' + f, import.meta.url);
  if (existsSync(p)) copyFileSync(p, new URL('./dist/' + f, import.meta.url));
}
console.log(`built ${build}: index.html ${(full.length / 1024).toFixed(0)} KB`);
