export const COMBO_REASONING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const VALID_REASONING = new Set(COMBO_REASONING_LEVELS);

export function isValidComboReasoning(value) {
  if (value === undefined || value === null || value === "") return true;
  return VALID_REASONING.has(String(value).trim().toLowerCase());
}

export function getComboEntryModel(entry) {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object") return "";
  if (typeof entry.model === "string" && entry.model.trim()) {
    const model = entry.model.trim();
    if (typeof entry.provider === "string" && entry.provider.trim() && !model.includes("/")) {
      return `${entry.provider.trim()}/${model}`;
    }
    return model;
  }
  if (typeof entry.id === "string" && entry.id.trim()) return entry.id.trim();
  if (typeof entry.name === "string" && entry.name.trim()) {
    if (typeof entry.provider === "string" && entry.provider.trim() && !entry.name.includes("/")) {
      return `${entry.provider.trim()}/${entry.name.trim()}`;
    }
    return entry.name.trim();
  }
  return "";
}

export function getComboEntryReasoning(entry) {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry.reasoning ?? entry.reasoning_effort;
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value || value === "auto") return null;
  return value;
}

export function normalizeComboEntry(entry) {
  if (typeof entry === "string") {
    const model = entry.trim();
    return model || null;
  }
  if (!entry || typeof entry !== "object") return null;
  const model = getComboEntryModel(entry);
  if (!model) return null;
  const reasoning = getComboEntryReasoning(entry);
  if (!reasoning) return model;
  if (!isValidComboReasoning(reasoning)) return null;
  return { model, reasoning };
}

export function normalizeComboEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(normalizeComboEntry).filter(Boolean);
}

export function hasValidComboEntries(entries) {
  return Array.isArray(entries) && entries.every((entry) => normalizeComboEntry(entry) !== null);
}

const THINKING_BUDGETS = {
  minimal: 2048,
  low: 4096,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
  max: 65536,
};

export function applyComboEntryReasoning(body, entry) {
  const reasoning = getComboEntryReasoning(entry);
  if (!reasoning) return body;
  const next = { ...(body || {}) };
  if (reasoning === "none") {
    delete next.reasoning_effort;
    if (next.reasoning && typeof next.reasoning === "object") {
      const nextReasoning = { ...next.reasoning };
      delete nextReasoning.effort;
      if (Object.keys(nextReasoning).length > 0) next.reasoning = nextReasoning;
      else delete next.reasoning;
    }
    delete next.thinking;
    if (next.output_config && typeof next.output_config === "object") {
      const outputConfig = { ...next.output_config };
      delete outputConfig.effort;
      if (Object.keys(outputConfig).length > 0) next.output_config = outputConfig;
      else delete next.output_config;
    }
    return next;
  }
  if (next.thinking && typeof next.thinking === "object") {
    next.thinking = { type: "enabled", budget_tokens: THINKING_BUDGETS[reasoning] || next.thinking.budget_tokens || 8192 };
  } else if (next.output_config && typeof next.output_config === "object") {
    next.output_config = { ...next.output_config, effort: reasoning };
  } else {
    next.reasoning_effort = reasoning;
    if (next.reasoning && typeof next.reasoning === "object") {
      next.reasoning = { ...next.reasoning, effort: reasoning };
    }
  }
  return next;
}
