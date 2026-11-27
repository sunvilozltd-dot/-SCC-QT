declare global {
  interface Window {
    __SUNVILOZ_INLINE_ASSETS__?: Record<string, string>;
  }
}

/**
 * Resolves brand image paths across all hosting modes:
 * - Google Apps Script HtmlService: uses data URIs injected into `window.__SUNVILOZ_INLINE_ASSETS__`
 * - GitHub Pages subpath (`/<repo>/`) or root (`/`): prefixes with `import.meta.env.BASE_URL`
 */
export function resolveBrandAsset(assetPath: string): string {
  if (typeof window !== 'undefined' && window.__SUNVILOZ_INLINE_ASSETS__) {
    const inlined = window.__SUNVILOZ_INLINE_ASSETS__[assetPath];
    if (inlined) return inlined;
  }
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  const normalizedPath = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  if (!base || base === '.') {
    return `.${normalizedPath}`;
  }
  return `${base}${normalizedPath}`;
}
