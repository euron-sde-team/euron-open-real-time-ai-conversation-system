/**
 * A starter model catalogue: the providers most people use, with a few current models
 * each, so a new install only needs keys. Model ids change often: edit them in
 * /admin/models (the "Test" button checks one in a second). A provider without a key is
 * simply not offered (services/models.service.ts), so nothing here is visible until its
 * key is set. The stub provider is added outside production only.
 *
 * TEXT models write the interview plan and score answers; REALTIME models hold the live
 * voice interview. Prices are left empty: fill them in /admin/models to see an estimated
 * cost on the overview.
 */
import { config } from "../core/config";
import { newId } from "../core/ids";
import type { Executor } from "../db/kysely";

interface StarterModel {
  ref: string;
  name: string;
  description: string;
  kind: "TEXT" | "REALTIME";
  voices?: string[];
  maxOut?: number;
  isDefault?: boolean;
}

type ProviderKind = "OPENAI" | "ANTHROPIC" | "GEMINI" | "OPENAI_COMPATIBLE" | "STUB";

const OPENAI_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
const GEMINI_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];

const PROVIDERS: { id: string; kind: ProviderKind; name: string; baseUrl: string | null; models: StarterModel[] }[] = [
  {
    id: "openai",
    kind: "OPENAI",
    name: "OpenAI",
    baseUrl: null,
    models: [
      { ref: "gpt-realtime", name: "GPT Realtime", description: "Natural, low-latency voice over WebRTC.", kind: "REALTIME", voices: OPENAI_VOICES },
      { ref: "gpt-realtime-mini", name: "GPT Realtime mini", description: "Cheaper realtime voice.", kind: "REALTIME", voices: OPENAI_VOICES },
      { ref: "gpt-5.4-mini", name: "GPT-5.4 mini", description: "Plans interviews and scores answers.", kind: "TEXT", maxOut: 16000 },
    ],
  },
  {
    id: "gemini",
    kind: "GEMINI",
    name: "Google Gemini",
    baseUrl: null,
    models: [
      { ref: "gemini-2.5-flash-native-audio-preview-09-2025", name: "Gemini Live", description: "Native audio conversation over the Live API.", kind: "REALTIME", voices: GEMINI_VOICES },
      { ref: "gemini-3.5-flash", name: "Gemini 3.5 Flash", description: "Plans interviews and scores answers.", kind: "TEXT", maxOut: 16000 },
    ],
  },
  {
    id: "anthropic",
    kind: "ANTHROPIC",
    name: "Anthropic",
    baseUrl: null,
    models: [{ ref: "claude-haiku-5-5", name: "Claude Haiku 5.5", description: "Plans interviews and scores answers.", kind: "TEXT", maxOut: 8000 }],
  },
];

const STUB = {
  id: "stub",
  kind: "STUB" as const,
  name: "Local stub",
  baseUrl: null,
  models: [
    { ref: "stub-text", name: "Stub planner", description: "Deterministic local plans and scores.", kind: "TEXT" as const, maxOut: 8192, isDefault: true },
    { ref: "stub-voice", name: "Stub voice", description: "Speaks with the browser's own voice; you type or dictate.", kind: "REALTIME" as const, voices: ["default"], isDefault: true },
  ],
};

/** Insert the starter catalogue where it is missing. Returns the stub model ids when the stub was added. */
export async function ensureStarterCatalog(exec: Executor, opts: { includeStub?: boolean } = {}): Promise<{ text: string; voice: string } | null> {
  const list = opts.includeStub && config.NODE_ENV !== "production" ? [STUB, ...PROVIDERS] : PROVIDERS;
  let order = 0;
  const ids: Record<string, string> = {};
  for (const p of list) {
    await exec.insertInto("providers").values({ id: p.id, kind: p.kind, display_name: p.name, base_url: p.baseUrl, enabled: true }).onConflict((oc) => oc.column("id").doNothing()).execute();
    for (const m of p.models as StarterModel[]) {
      const existing = await exec.selectFrom("models").select("id").where("provider_id", "=", p.id).where("model_ref", "=", m.ref).where("kind", "=", m.kind).executeTakeFirst();
      const id = existing?.id ?? newId();
      if (!existing) {
        const hasDefault = await exec.selectFrom("models").select("id").where("kind", "=", m.kind).where("is_default", "=", true).executeTakeFirst();
        await exec
          .insertInto("models")
          .values({
            id,
            provider_id: p.id,
            kind: m.kind,
            model_ref: m.ref,
            display_name: m.name,
            description: m.description,
            max_output_tokens: m.maxOut ?? 8192,
            voices: m.voices ?? [],
            enabled: true,
            is_default: !!m.isDefault && !hasDefault,
            sort_order: order++,
          })
          .execute();
      }
      ids[`${p.id}:${m.ref}`] = id;
    }
  }
  return ids["stub:stub-text"] ? { text: ids["stub:stub-text"]!, voice: ids["stub:stub-voice"]! } : null;
}
