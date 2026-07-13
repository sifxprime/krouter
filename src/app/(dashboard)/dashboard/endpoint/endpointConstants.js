// 0.5.97 — Shared constants between EndpointPageClient and TokenSaverClient.
// Extracted so both pages can consume the same source of truth.

export const WENYAN_LOCALES = ["zh-CN", "zh-TW"];

export const CAVEMAN_LEVELS = [
  { id: "lite", label: "Lite", desc: "Drop filler, keep grammar" },
  { id: "full", label: "Full", desc: "Drop articles, fragments OK" },
  { id: "ultra", label: "Ultra", desc: "Telegraphic, max compression" },
  { id: "wenyan-lite", label: "文 Lite", desc: "Classical Chinese, light compression", wenyan: true },
  { id: "wenyan", label: "文 Full", desc: "Maximum 文言文, 80-90% reduction", wenyan: true },
  { id: "wenyan-ultra", label: "文 Ultra", desc: "Extreme classical compression", wenyan: true },
];

export const PONYTAIL_LEVELS = [
  { id: "lite", label: "Lite", desc: "Minimal code, brief explanations" },
  { id: "full", label: "Full", desc: "Code-only output, no prose" },
  { id: "ultra", label: "Ultra", desc: "Raw code, zero commentary" },
];
