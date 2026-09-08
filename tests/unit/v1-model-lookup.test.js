import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildModelsList: vi.fn(),
}));

vi.mock("../../src/app/api/v1/models/route.js", () => ({
  buildModelsList: mocks.buildModelsList,
}));

const { GET } = await import("../../src/app/api/v1/models/[...model]/route.js");

const chatModel = {
  id: "cc/claude-sonnet-5",
  object: "model",
  owned_by: "cc",
  context_length: 1_000_000,
};

function params(model) {
  return { params: Promise.resolve({ model }) };
}

describe("GET /v1/models/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retrieves a provider-prefixed model ID split across URL path segments", async () => {
    mocks.buildModelsList.mockResolvedValue([chatModel]);

    const response = await GET(new Request("https://router.test/v1/models/cc/claude-sonnet-5"), params(["cc", "claude-sonnet-5"]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(chatModel);
    expect(mocks.buildModelsList).toHaveBeenCalledWith(["llm"]);
  });

  it("also handles a decoded slash in a single catch-all segment", async () => {
    mocks.buildModelsList.mockResolvedValue([chatModel]);

    const response = await GET(new Request("https://router.test/v1/models/cc%2Fclaude-sonnet-5"), params(["cc/claude-sonnet-5"]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(chatModel);
  });

  it("keeps capability-list routes unchanged", async () => {
    const imageModel = { id: "image/gpt-image-1", object: "model", owned_by: "image" };
    mocks.buildModelsList.mockResolvedValue([imageModel]);

    const response = await GET(new Request("https://router.test/v1/models/image"), params(["image"]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ object: "list", data: [imageModel] });
    expect(mocks.buildModelsList).toHaveBeenCalledWith(["image"]);
  });

  it("returns an OpenAI-style model_not_found response for an unknown model", async () => {
    mocks.buildModelsList.mockResolvedValue([chatModel]);

    const response = await GET(new Request("https://router.test/v1/models/cc/missing-model"), params(["cc", "missing-model"]));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toMatchObject({
      type: "invalid_request_error",
      code: "model_not_found",
    });
  });
});

// Our fork's [kind] route carried a `video` slug upstream never had (0.5.111,
// Grok Imagine). Replacing that route with this catch-all must not drop it.
describe("kind slugs this fork added", () => {
  it("still resolves the video kind", async () => {
    mocks.buildModelsList.mockResolvedValue([{ id: "xai/grok-imagine-video" }]);
    const { GET } = await import("../../src/app/api/v1/models/[...model]/route.js");
    const res = await GET(new Request("http://localhost/v1/models/video"), {
      params: Promise.resolve({ model: ["video"] }),
    });
    expect(res.status).toBe(200);
    expect(mocks.buildModelsList).toHaveBeenCalledWith(["video"]);
    expect(await res.json()).toEqual({ object: "list", data: [{ id: "xai/grok-imagine-video" }] });
  });

  it("does not treat a two-segment path as a kind", async () => {
    mocks.buildModelsList.mockResolvedValue([{ id: "ag/gemini-3-flash-agent" }]);
    const { GET } = await import("../../src/app/api/v1/models/[...model]/route.js");
    const res = await GET(new Request("http://localhost/v1/models/ag/gemini-3-flash-agent"), {
      params: Promise.resolve({ model: ["ag", "gemini-3-flash-agent"] }),
    });
    // A provider-prefixed id contains a slash, which is why a catch-all is required.
    expect(mocks.buildModelsList).toHaveBeenCalledWith(["llm"]);
    expect((await res.json()).id).toBe("ag/gemini-3-flash-agent");
  });
});
