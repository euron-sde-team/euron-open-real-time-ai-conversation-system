/**
 * The model catalogue the runtime reads (one source of truth: the providers and models
 * tables, edited in /admin). A model is offered only when it is enabled, its provider is
 * enabled, and the provider is usable: it has a key in config, or it is a kind that needs
 * none (STUB, or an OPENAI_COMPATIBLE server such as a local Ollama).
 *
 * Keys are looked up from config on every resolution and are never part of a row, a DTO
 * or a log line.
 */
import type { ProviderKind, RealtimeModelOption, RealtimeProvider } from "@open-conversation/types";
import type { Selectable } from "kysely";
import { providerKey } from "../core/config";
import { db } from "../db/kysely";
import type { Models, Providers } from "../db/types";
import { adapterFor, defaultBaseUrl, type Endpoint, type LlmAdapter } from "../integrations/llm";

export type ModelRow = Selectable<Models>;
export type ProviderRow = Selectable<Providers>;

export interface ResolvedModel {
  model: ModelRow;
  provider: ProviderRow;
  kind: ProviderKind;
  endpoint: Endpoint;
  adapter: LlmAdapter;
}

const TTL_MS = 5_000;
let cache: { at: number; rows: { model: ModelRow; provider: ProviderRow }[] } | null = null;

export function clearModelCache(): void {
  cache = null;
}

/** Where to reach a provider and with which key, or null when it cannot be called. */
export function endpointFor(p: ProviderRow): Endpoint | null {
  const baseUrl = p.base_url?.trim() || defaultBaseUrl(p.kind);
  if (!baseUrl) return null;
  const key = providerKey(p.id);
  if (!key && p.kind !== "STUB" && p.kind !== "OPENAI_COMPATIBLE") return null;
  return { provider: p.id, baseUrl, apiKey: key };
}

/** Every enabled model of an enabled, usable provider, in display order. */
async function usableRows(): Promise<{ model: ModelRow; provider: ProviderRow }[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await db
    .selectFrom("models as m")
    .innerJoin("providers as p", "p.id", "m.provider_id")
    .selectAll("m")
    .select(["p.id as p_id", "p.kind as p_kind", "p.display_name as p_display_name", "p.base_url as p_base_url", "p.enabled as p_enabled", "p.created_at as p_created_at", "p.updated_at as p_updated_at"])
    .where("m.enabled", "=", true)
    .where("p.enabled", "=", true)
    .orderBy("m.sort_order")
    .orderBy("m.display_name")
    .execute();
  const out = rows
    .map((r) => {
      const provider: ProviderRow = { id: r.p_id, kind: r.p_kind, display_name: r.p_display_name, base_url: r.p_base_url, enabled: r.p_enabled, created_at: r.p_created_at, updated_at: r.p_updated_at };
      const { p_id: _a, p_kind: _b, p_display_name: _c, p_base_url: _d, p_enabled: _e, p_created_at: _f, p_updated_at: _g, ...model } = r;
      return { model: model as ModelRow, provider };
    })
    .filter((r) => endpointFor(r.provider) !== null);
  cache = { at: Date.now(), rows: out };
  return out;
}

/** The realtime transport a provider kind speaks, or null when it has none. */
export function realtimeProviderOf(kind: ProviderKind): RealtimeProvider | null {
  if (kind === "OPENAI") return "openai";
  if (kind === "GEMINI") return "gemini";
  if (kind === "STUB") return "stub";
  return null;
}

export function toRealtimeOption(m: ModelRow, p: ProviderRow): RealtimeModelOption {
  return {
    id: m.id,
    displayName: m.display_name,
    description: m.description,
    provider: realtimeProviderOf(p.kind) ?? "stub",
    voices: m.voices,
    isDefault: m.is_default,
  };
}

/** The realtime models a candidate may pick from. */
export async function realtimeOptions(): Promise<RealtimeModelOption[]> {
  const rows = await usableRows();
  return rows.filter((r) => r.model.kind === "REALTIME" && realtimeProviderOf(r.provider.kind)).map((r) => toRealtimeOption(r.model, r.provider));
}

function pickDefault<T extends { model: ModelRow }>(rows: T[]): T | null {
  return rows.find((r) => r.model.is_default) ?? rows[0] ?? null;
}

function resolved(r: { model: ModelRow; provider: ProviderRow }): ResolvedModel {
  return { model: r.model, provider: r.provider, kind: r.provider.kind, endpoint: endpointFor(r.provider)!, adapter: adapterFor(r.provider.kind) };
}

/**
 * The text model that plans and scores: the one asked for if it is usable, else the
 * deployment default, else the first usable one. Null when none is usable.
 */
export async function resolveTextModel(requested?: string | null): Promise<ResolvedModel | null> {
  const rows = (await usableRows()).filter((r) => r.model.kind === "TEXT");
  const r = (requested ? rows.find((x) => x.model.id === requested) : undefined) ?? pickDefault(rows);
  return r ? resolved(r) : null;
}

/** The realtime model for a live session: asked for, else the user's default, else the deployment default. */
export async function resolveRealtimeModel(requested: string | null | undefined, userDefault?: string | null): Promise<ResolvedModel | null> {
  const rows = (await usableRows()).filter((r) => r.model.kind === "REALTIME" && realtimeProviderOf(r.provider.kind));
  const pick = (id: string | null | undefined) => (id ? rows.find((r) => r.model.id === id) : undefined);
  const r = pick(requested) ?? pick(userDefault) ?? pickDefault(rows);
  return r ? resolved(r) : null;
}

/** A model by id whatever its state (admin test calls, presenters). */
export async function findModel(id: string): Promise<{ model: ModelRow; provider: ProviderRow } | null> {
  const row = await db.selectFrom("models as m").innerJoin("providers as p", "p.id", "m.provider_id").selectAll("m").select(["p.kind as p_kind"]).where("m.id", "=", id).executeTakeFirst();
  if (!row) return null;
  const provider = await db.selectFrom("providers").selectAll().where("id", "=", row.provider_id).executeTakeFirstOrThrow();
  const { p_kind: _k, ...model } = row;
  return { model: model as ModelRow, provider };
}
