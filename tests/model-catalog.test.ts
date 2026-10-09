import { describe, expect, it } from "vitest";
import { listModelDetails } from "@/lib/ai/llm";
import { dossierCost, dossierCostAlone, formatTokens, formatUsd, geminiModelInfo, knownPrice } from "@/lib/ai/model-catalog";
import { cfgFor } from "./fixtures";

/**
 * Liste des modèles de Profil › Génération IA : jetons, prix, coût d'un dossier.
 * Réponses des fournisseurs simulées (structures relevées le 9 octobre 2026).
 */

function jsonFetch(pages: Record<string, unknown>) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    headers.push((init?.headers ?? {}) as Record<string, string>);
    const key = Object.keys(pages).find((k) => String(url).includes(k));
    return Response.json(key ? pages[key] : { error: "inconnu" }, { status: key ? 200 : 404 });
  }) as typeof fetch;
  return { fn, urls, headers };
}

describe("catalogue Gemini", () => {
  it("prix du tarif public, jetons de l'API, modèles qui ne rédigent pas", () => {
    const flash = geminiModelInfo({
      name: "models/gemini-3.8-flash",
      displayName: "Gemini 3.8 Flash",
      inputTokenLimit: 1048576,
      outputTokenLimit: 65536,
      supportedGenerationMethods: ["generateContent", "countTokens"],
    })!;
    expect(flash).toMatchObject({ id: "gemini-3.8-flash", priceIn: 0.75, priceOut: 3.75, freeTier: true, textCapable: true, inputTokens: 1048576 });
    const tts = geminiModelInfo({ name: "models/gemini-3.8-flash-tts", supportedGenerationMethods: ["generateContent"] })!;
    expect(tts.textCapable).toBe(false);
    const embed = geminiModelInfo({ name: "models/gemini-embedding-2", supportedGenerationMethods: ["embedContent"] })!;
    expect(embed.textCapable).toBe(false);
    expect(knownPrice("gemini", "gemini-3.5-flash-lite")).toEqual({ priceIn: 0.3, priceOut: 2.5, freeTier: true });
    expect(knownPrice("openai", "gemini-3.5-flash-lite")).toEqual({});
  });

  it("coût d'un dossier : rédaction + relecture, ou un seul modèle", () => {
    const writer = { priceIn: 0.75, priceOut: 3.75 };
    const reviewer = { priceIn: 0.3, priceOut: 2.5 };
    // 16k×0,75 + 7k×3,75 = 0,03825 ; 12k×0,30 + 6k×2,50 = 0,0186
    expect(dossierCost(writer, reviewer)).toBeCloseTo(0.05685, 5);
    expect(dossierCost(writer, undefined)).toBeCloseTo(0.03825 + (12_000 * 0.75 + 6_000 * 3.75) / 1e6, 5);
    expect(dossierCostAlone({})).toBeNull();
    expect(formatUsd(0.05685)).toBe("0,057 $");
    expect(formatUsd(0.004)).toBe("< 0,01 $");
    expect(formatTokens(1048576)).toBe("1 M");
    expect(formatTokens(65536)).toBe("65,5 k");
  });

  it("listModelDetails lit l'API native, toutes les pages, avec la clé en en-tête", async () => {
    const { fn, urls, headers } = jsonFetch({
      "pageToken=p2": { models: [{ name: "models/gemini-2.5-flash", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent"] }] },
      "/v1beta/models?pageSize": {
        models: [{ name: "models/gemini-3.8-flash", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent"] }],
        nextPageToken: "p2",
      },
    });
    const list = await listModelDetails(cfgFor("gemini"), { fetch: fn });
    expect(list.map((m) => m.id)).toEqual(["gemini-2.5-flash", "gemini-3.8-flash"]);
    expect(list[1]).toMatchObject({ priceIn: 0.75, outputTokens: 65536 });
    expect(urls[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
    expect(headers[0]["x-goog-api-key"]).toBe("test-key-123456");
  });
});

describe("autres fournisseurs", () => {
  it("OpenRouter : prix par jeton convertis par million, contexte, modèles gratuits", async () => {
    const { fn } = jsonFetch({
      "/models": {
        data: [
          { id: "openai/gpt-6-mini", name: "OpenAI: GPT-6 mini", context_length: 400000, pricing: { prompt: "0.00000025", completion: "0.000002" }, top_provider: { max_completion_tokens: 128000 } },
          { id: "meta/llama-free:free", context_length: 131072, pricing: { prompt: "0", completion: "0" } },
        ],
      },
    });
    const list = await listModelDetails(cfgFor("openrouter"), { fetch: fn });
    expect(list[1]).toMatchObject({ id: "openai/gpt-6-mini", label: "OpenAI: GPT-6 mini", priceIn: 0.25, priceOut: 2, inputTokens: 400000, outputTokens: 128000 });
    expect(list[0]).toMatchObject({ priceIn: 0, priceOut: 0, freeTier: true });
  });

  it("Groq : contexte et sortie maximum, sans prix", async () => {
    const { fn } = jsonFetch({ "/models": { data: [{ id: "llama-4-70b", context_window: 131072, max_completion_tokens: 32768 }] } });
    const [m] = await listModelDetails(cfgFor("groq"), { fetch: fn });
    expect(m).toMatchObject({ id: "llama-4-70b", inputTokens: 131072, outputTokens: 32768, textCapable: true });
    expect(m.priceIn).toBeUndefined();
  });
});
