"use server";

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { UPDATER_CONFIG } from "@/shared/constants/config";

const execAsync = promisify(exec);

const getDataDir = () => path.join(os.homedir(), ".cline", "data");
const getGlobalStatePath = () => path.join(getDataDir(), "globalState.json");
const getSecretsPath = () => path.join(getDataDir(), "secrets.json");
// 0.5.164 — current Cline keeps providers in settings/providers.json. The CLI reads only
// that file; globalState.json is a one-shot migration source that never overwrites an entry.
const getProvidersPath = () => path.join(getDataDir(), "settings", "providers.json");
const CLINE_OPENAI_COMPATIBLE = "openai-compatible";

// 0.5.164 — Cline calls `${base}/chat/completions` and kRouter serves it only under /v1,
// so the base keeps /v1 (was stripped, every Cline request 404'd). Returns null if not a URL.
// 0.5.164 — http(s) only ("localhost:20128" parses as scheme "localhost:"), and /v1
// goes on the path, never after a query or fragment.
const toV1BaseUrl = (baseUrl) => {
  try {
    const url = new URL(String(baseUrl).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname.endsWith("/v1") ? pathname : `${pathname}/v1`}`;
  } catch {
    return null;
  }
};

const isKRouterUrl = (baseUrl = "") =>
  baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("krouter");

const checkInstalled = async () => {
  try {
    const isWindows = os.platform() === "win32";
    const command = isWindows ? "where cline" : "which cline";
    const env = isWindows
      ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
      : process.env;
    await execAsync(command, { windowsHide: true, env });
    return true;
  } catch {
    try {
      await fs.access(getGlobalStatePath());
      return true;
    } catch {
      return false;
    }
  }
};

const readJson = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

// 0.5.164 — Cline's ProviderSettingsManager treats an unparseable providers.json as
// empty; do the same so a damaged file never blocks Apply or Reset.
const readProvidersFile = async () => {
  try {
    return await readJson(getProvidersPath());
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

const hasKRouterConfig = (globalState) => {
  if (!globalState) return false;
  const isOpenAi =
    globalState.actModeApiProvider === "openai" || globalState.planModeApiProvider === "openai";
  return isOpenAi && isKRouterUrl(globalState.openAiBaseUrl || "");
};

// Same staging as Cline's ProviderSettingsManager: a reader that catches a partial
// providers.json treats it as empty, i.e. every provider logged out.
const writeProvidersFile = async (stored) => {
  const filePath = getProvidersPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, filePath);
};

// 0.5.164 — what `cline auth --provider openai-compatible` saves: other providers kept,
// this one made active. Cline drops the whole file if it fails its schema, so only
// a URL base and an ISO updatedAt go in.
const applyClineProviders = (stored, { baseUrl, apiKey, model }) => {
  const current = stored || {};
  const providers = current.providers || {};
  const previous = providers[CLINE_OPENAI_COMPATIBLE]?.settings || {};
  return {
    ...current,
    version: current.version ?? 1,
    modes: current.modes || {},
    providers: {
      ...providers,
      [CLINE_OPENAI_COMPATIBLE]: {
        settings: { ...previous, provider: CLINE_OPENAI_COMPATIBLE, apiKey, model, baseUrl },
        updatedAt: new Date().toISOString(),
        tokenSource: "manual",
      },
    },
    lastUsedProvider: CLINE_OPENAI_COMPATIBLE,
  };
};

// 0.5.164 — kRouter's own local bases plus the ones the card names (tunnel, Tailscale, the
// endpoint picked). Not "any localhost": a `cline auth` Ollama on :11434 is the user's.
const kRouterBases = (namedBaseUrls = []) => {
  const port = process.env.PORT || UPDATER_CONFIG.appPort;
  return new Set(
    [`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...namedBaseUrls].map(toV1BaseUrl).filter(Boolean),
  );
};

// Optional DELETE body { baseUrls: string[] }; an older card sends none. Returns null if malformed.
const readResetBaseUrls = async (request) => {
  const text = request ? await request.text() : "";
  if (!text.trim()) return [];
  try {
    const { baseUrls } = JSON.parse(text);
    return Array.isArray(baseUrls) && baseUrls.every((url) => typeof url === "string") ? baseUrls : null;
  } catch {
    return null;
  }
};

// 0.5.164 — Reset drops the entry only when its base is a kRouter endpoint and hands the
// CLI back to Cline's own provider when there is one.
const resetClineProviders = (stored, bases) => {
  const entryUrl = stored?.providers?.[CLINE_OPENAI_COMPATIBLE]?.settings?.baseUrl;
  if (!entryUrl || !bases.has(toV1BaseUrl(entryUrl))) return null;
  const { [CLINE_OPENAI_COMPATIBLE]: _removed, ...providers } = stored.providers;
  const { lastUsedProvider, ...rest } = stored;
  const nextLastUsed = lastUsedProvider && lastUsedProvider !== CLINE_OPENAI_COMPATIBLE
    ? lastUsedProvider
    : (providers.cline ? "cline" : Object.keys(providers)[0]);
  return { ...rest, providers, ...(nextLastUsed ? { lastUsedProvider: nextLastUsed } : {}) };
};

export async function GET() {
  try {
    const installed = await checkInstalled();
    if (!installed) {
      return NextResponse.json({ installed: false, settings: null, message: "Cline CLI is not installed" });
    }
    const globalState = await readJson(getGlobalStatePath());
    return NextResponse.json({
      installed: true,
      settings: {
        actModeApiProvider: globalState?.actModeApiProvider,
        planModeApiProvider: globalState?.planModeApiProvider,
        openAiBaseUrl: globalState?.openAiBaseUrl,
        openAiModelId: globalState?.actModeOpenAiModelId ?? globalState?.openAiModelId,
      },
      hasKRouter: hasKRouterConfig(globalState),
      globalStatePath: getGlobalStatePath(),
    });
  } catch (error) {
    console.log("Error checking cline settings:", error);
    return NextResponse.json({ error: "Failed to check cline settings" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { baseUrl, apiKey, model } = await request.json();
    const isText = (value) => typeof value === "string" && value.trim() !== "";
    if (![baseUrl, apiKey, model].every(isText)) {
      return NextResponse.json({ error: "baseUrl, apiKey and model are required" }, { status: 400 });
    }
    const v1BaseUrl = toV1BaseUrl(baseUrl);
    if (!v1BaseUrl) {
      return NextResponse.json({ error: "baseUrl must be a valid URL" }, { status: 400 });
    }

    // Read everything first so a corrupt file fails the request before anything is written.
    const globalState = (await readJson(getGlobalStatePath())) || {};
    const secrets = (await readJson(getSecretsPath())) || {};
    const providers = await readProvidersFile();

    await fs.mkdir(getDataDir(), { recursive: true });

    // 0.5.164 — the VS Code extension takes the model from act/planModeOpenAiModelId
    // (Act mode had none); openAiModelId is no longer a Cline key, kept for GET.
    const nextGlobalState = {
      ...globalState,
      actModeApiProvider: "openai",
      planModeApiProvider: "openai",
      openAiBaseUrl: v1BaseUrl,
      openAiModelId: model,
      actModeOpenAiModelId: model,
      planModeOpenAiModelId: model,
    };
    await fs.writeFile(getGlobalStatePath(), JSON.stringify(nextGlobalState, null, 2));
    // 0.5.164 — holds the API key: owner-only, as Cline writes its own credential files.
    await fs.writeFile(getSecretsPath(), JSON.stringify({ ...secrets, openAiApiKey: apiKey }, null, 2), { mode: 0o600 });
    await fs.chmod(getSecretsPath(), 0o600).catch(() => {}); // mode only applies on create; no-op on Windows
    await writeProvidersFile(applyClineProviders(providers, { baseUrl: v1BaseUrl, apiKey, model }));

    return NextResponse.json({ success: true, message: "Cline settings applied successfully!", globalStatePath: getGlobalStatePath() });
  } catch (error) {
    console.log("Error updating cline settings:", error);
    return NextResponse.json({ error: "Failed to update cline settings" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const namedBaseUrls = await readResetBaseUrls(request);
    if (!namedBaseUrls) {
      return NextResponse.json({ error: "baseUrls must be a list of URLs" }, { status: 400 });
    }
    const globalState = await readJson(getGlobalStatePath());
    const resetProviders = resetClineProviders(await readProvidersFile(), kRouterBases(namedBaseUrls));
    if (resetProviders) await writeProvidersFile(resetProviders);
    if (!globalState) {
      return NextResponse.json({ success: true, message: resetProviders ? "kRouter settings removed from Cline" : "No settings file to reset" });
    }

    if (globalState.actModeApiProvider === "openai") {
      delete globalState.openAiBaseUrl;
      delete globalState.openAiModelId;
      delete globalState.actModeOpenAiModelId;
      delete globalState.planModeOpenAiModelId;
      globalState.actModeApiProvider = "cline";
      globalState.planModeApiProvider = "cline";
    }
    await fs.writeFile(getGlobalStatePath(), JSON.stringify(globalState, null, 2));

    const secrets = (await readJson(getSecretsPath())) || {};
    delete secrets.openAiApiKey;
    await fs.writeFile(getSecretsPath(), JSON.stringify(secrets, null, 2));

    return NextResponse.json({ success: true, message: "kRouter settings removed from Cline" });
  } catch (error) {
    console.log("Error resetting cline settings:", error);
    return NextResponse.json({ error: "Failed to reset cline settings" }, { status: 500 });
  }
}
