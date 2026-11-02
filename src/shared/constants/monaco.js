// @monaco-editor/react does NOT use the monaco-editor package from node_modules — it is
// never imported. Its loader fetches Monaco from jsdelivr at a version hardcoded in
// @monaco-editor/loader, which ships 0.55.1 (verified in
// node_modules/@monaco-editor/loader/lib/cjs/config/index.js). That build bundles
// DOMPurify 3.2.7, so the DOMPurify advisories reported against monaco-editor describe
// code the browser really loads, and bumping the dependency alone would not change it.
//
// Pin the CDN copy instead. 0.57.0 bundles DOMPurify 3.4.15. Upstream 5883110b.
//
// Note for a future dependency bump: the installed monaco-editor version is independent
// of this pin precisely because nothing imports it. Raise this constant to change what
// users run; raising the package.json range alone does nothing.
export const MONACO_VERSION = "0.57.0";
export const MONACO_VS_PATH = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;
