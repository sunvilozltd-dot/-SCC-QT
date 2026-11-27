import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST_GAS = path.join(ROOT, 'dist-gas');
const OUTPUT_HTML = path.join(ROOT, 'gas', 'Index.html');

function assertNoNativeAndroidArtifacts() {
  const forbiddenPaths = [
    path.join(ROOT, 'android'),
    path.join(ROOT, 'local.properties'),
    path.join(ROOT, '.github', 'workflows', 'build-android-apk.yml'),
    path.join(ROOT, 'public', 'downloads'),
  ];
  for (const p of forbiddenPaths) {
    if (fs.existsSync(p)) {
      throw new Error(`Forbidden native Android artifact still exists: ${path.relative(ROOT, p)}`);
    }
  }
}

function escapeInlineScript(js: string): string {
  // Prevent any literal closing script tag or HTML comment opener inside bundled JS from breaking HTML parsing
  return js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function main() {
  assertNoNativeAndroidArtifacts();

  console.log('[build:gas] Compiling self-contained React UI for Google Apps Script HtmlService...');
  execSync('npx vite build', {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      GAS_SINGLE_FILE: 'true',
    },
  });

  const builtIndexPath = path.join(DIST_GAS, 'index.html');
  if (!fs.existsSync(builtIndexPath)) {
    throw new Error('dist-gas/index.html was not generated.');
  }

  let html = fs.readFileSync(builtIndexPath, 'utf8');

  // Remove relative icon links that cannot resolve on script.google.com iframe origin
  html = html.replace(
    /<link[^>]+href=["']\.?\/(?:pwa-|apple-touch-icon|manifest)[^"']*["'][^>]*>\s*/gi,
    ''
  );

  // Inline favicon from public/pwa-192x192.png if available
  const faviconPath = path.join(ROOT, 'public', 'pwa-192x192.png');
  if (fs.existsSync(faviconPath)) {
    const faviconB64 = fs.readFileSync(faviconPath).toString('base64');
    html = html.replace(
      '</head>',
      `  <link rel="icon" type="image/png" href="data:image/png;base64,${faviconB64}" />\n  </head>`
    );
  }

  // Inline SUNVILOZ company logos and official quotation letterhead pad for Apps Script HtmlService
  const brandAssetSpecs: Array<{ key: string; file: string; mime: string }> = [
    { key: '/assets/sunviloz/logo.png', file: 'public/assets/sunviloz/logo.png', mime: 'image/png' },
    {
      key: '/assets/sunviloz/official-logo.png',
      file: 'public/assets/sunviloz/official-logo.png',
      mime: 'image/png',
    },
    {
      key: '/assets/sunviloz/official-quotation-pad.jpg',
      file: 'public/assets/sunviloz/official-quotation-pad.jpg',
      mime: 'image/jpeg',
    },
  ];
  const inlineAssets: Record<string, string> = {};
  for (const spec of brandAssetSpecs) {
    const fullPath = path.join(ROOT, spec.file);
    if (fs.existsSync(fullPath)) {
      const b64 = fs.readFileSync(fullPath).toString('base64');
      inlineAssets[spec.key] = `data:${spec.mime};base64,${b64}`;
    }
  }
  const inlineAssetsScript = `<script>window.__SUNVILOZ_INLINE_ASSETS__=${JSON.stringify(inlineAssets)};</script>`;
  html = html.replace('</head>', `  ${inlineAssetsScript}\n  </head>`);

  // Inline all stylesheet <link rel="stylesheet" href="..."> tags
  html = html.replace(
    /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
    (match, href: string) => {
      if (/^https?:\/\//i.test(href)) return match;
      const cssPath = path.resolve(DIST_GAS, href.replace(/^\.?\//, ''));
      if (!fs.existsSync(cssPath)) {
        throw new Error(`Referenced stylesheet missing in dist-gas: ${href}`);
      }
      const css = fs.readFileSync(cssPath, 'utf8');
      return `<style>${css}</style>`;
    }
  );

  // Inline all module <script ... src="..."></script> tags
  html = html.replace(
    /<script\b([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi,
    (match, before: string, src: string, after: string) => {
      if (/^https?:\/\//i.test(src)) return match;
      const jsPath = path.resolve(DIST_GAS, src.replace(/^\.?\//, ''));
      if (!fs.existsSync(jsPath)) {
        throw new Error(`Referenced script missing in dist-gas: ${src}`);
      }
      const js = escapeInlineScript(fs.readFileSync(jsPath, 'utf8'));
      const isModule = /\btype=["']module["']/i.test(before + after);
      return isModule ? `<script type="module">${js}</script>` : `<script>${js}</script>`;
    }
  );

  // Remove any leftover modulepreload links pointing to local chunks
  html = html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*\/?>\s*/gi, '');

  fs.mkdirSync(path.dirname(OUTPUT_HTML), { recursive: true });
  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');

  // Clean up temporary dist-gas folder
  fs.rmSync(DIST_GAS, { recursive: true, force: true });

  const stats = fs.statSync(OUTPUT_HTML);
  const sizeKb = (stats.size / 1024).toFixed(1);
  console.log(`[build:gas] Wrote self-contained ${path.relative(ROOT, OUTPUT_HTML)} (${sizeKb} KB).`);
}

main();
