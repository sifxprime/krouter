// OpenAI TTS — model format: "tts-model/voice", a bare speech model id, or a bare voice
import { Buffer } from "node:buffer";

const DEFAULT_MODEL = "gpt-4o-mini-tts";
const DEFAULT_VOICE = "alloy";
// 0.5.164 — a bare "tts-1" was sent as the voice; speech model ids (tts-1, tts-1-hd, gpt-4o-mini-tts + snapshots, future gpt-*-tts) are models
const SPEECH_MODEL_RE = /^(tts-\d[\w.-]*|gpt-[\w.-]*-tts(-[\w.-]+)?)$/i;
// 0.5.164 — the regex backtracks quadratically and `model` is raw request input; real ids are under 40 chars
const MAX_SPEECH_MODEL_ID_LENGTH = 64;

function isSpeechModelId(model) {
  return model.length <= MAX_SPEECH_MODEL_ID_LENGTH && SPEECH_MODEL_RE.test(model);
}

// 0.5.164 — OpenAI-style body voice: a voice name or a custom voice object { id }
function requestVoice(voice) {
  if (typeof voice === "string") return voice.trim() || null;
  if (typeof voice?.id === "string" && voice.id.trim()) return { id: voice.id.trim() };
  return null;
}

// Voice named in the model string wins (documented rule); body voice fills in when it names none
function parseModelVoice(model, bodyVoice) {
  const fallbackVoice = requestVoice(bodyVoice) || DEFAULT_VOICE;
  if (!model) return { ttsModel: DEFAULT_MODEL, voice: fallbackVoice };
  if (model.includes("/")) {
    const parts = model.split("/");
    if (parts.length === 2) return { ttsModel: parts[0], voice: parts[1] };
    return { ttsModel: DEFAULT_MODEL, voice: fallbackVoice };
  }
  if (isSpeechModelId(model)) return { ttsModel: model, voice: fallbackVoice };
  return { ttsModel: DEFAULT_MODEL, voice: model };
}

// 0.5.164 — the connection's base URL lives in providerSpecificData.baseUrl (as the chat
// executors read it); getProviderCredentials never sets credentials.baseUrl, so every
// request went to api.openai.com. Accepts SDK form (".../v1") or a bare host.
function speechUrl(credentials) {
  const stored = credentials.providerSpecificData?.baseUrl;
  const raw = (typeof stored === "string" && stored.trim()) || credentials.baseUrl || "https://api.openai.com";
  const base = raw.trim().replace(/\/+$/, "");
  // A bare origin gets /v1; anything with a path is SDK form (ends where /audio/speech goes),
  // as the chat executors treat it, so gateway paths like /v1/<acct>/<gw>/openai work.
  let hasPath = false;
  try { hasPath = new URL(base).pathname.replace(/\/+$/, "") !== ""; } catch { /* not a URL: let fetch report it */ }
  return hasPath ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
}

export default {
  async synthesize(text, model, credentials, _responseFormat, options = {}) {
    if (!credentials?.apiKey) throw new Error("No OpenAI API key configured");

    const { ttsModel, voice } = parseModelVoice(model, options.voice);

    const res = await fetch(speechUrl(credentials), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${credentials.apiKey}` },
      body: JSON.stringify({ model: ttsModel, voice, input: text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI TTS failed: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return { base64: Buffer.from(buf).toString("base64"), format: "mp3" };
  },
};
