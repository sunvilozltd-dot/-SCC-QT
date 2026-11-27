declare global {
  interface Window {
    __SUNVILOZ_INLINE_ASSETS__?: Record<string, string>;
  }
}

/**
 * Resolves brand image paths so they work both on the local/web server
 * (`/assets/sunviloz/...`) and inside Google Apps Script `HtmlService`
 * (where `build-gas-html.ts` embeds data URIs in `window.__SUNVILOZ_INLINE_ASSETS__`).
 */
export function resolveBrandAsset(assetPath: string): string {
  if (typeof window !== 'undefined' && window.__SUNVILOZ_INLINE_ASSETS__) {
    const inlined = window.__SUNVILOZ_INLINE_ASSETS__[assetPath];
    if (inlined) return inlined;
  }
  return assetPath;
}
