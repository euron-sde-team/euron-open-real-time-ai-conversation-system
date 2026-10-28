/** Per-user preferences for the live room: the interviewer's voice, transcription language, proctoring default, default realtime model. */
import type { Preferences } from "@open-conversation/types";
import { type Actor, requireActive } from "../core/context";
import { badRequest } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { realtimeOptions } from "./models.service";

export async function preferencesOf(userId: string, exec: Executor = db): Promise<Preferences> {
  const row = await exec.selectFrom("user_preferences").selectAll().where("user_id", "=", userId).executeTakeFirst();
  return {
    voice: row?.voice ?? "alloy",
    transcriptionLanguage: row?.transcription_language ?? "auto",
    proctoringDefault: row?.proctoring_default ?? false,
    defaultRealtimeModelId: row?.default_realtime_model_id ?? null,
  };
}

export async function updatePreferences(actor: Actor, patch: Partial<Preferences>): Promise<Preferences> {
  requireActive(actor);
  if (patch.defaultRealtimeModelId) {
    const options = await realtimeOptions();
    if (!options.some((m) => m.id === patch.defaultRealtimeModelId)) throw badRequest("That model is not available", "MODEL_UNAVAILABLE");
  }
  const values = {
    ...(patch.voice !== undefined ? { voice: patch.voice } : {}),
    ...(patch.transcriptionLanguage !== undefined ? { transcription_language: patch.transcriptionLanguage } : {}),
    ...(patch.proctoringDefault !== undefined ? { proctoring_default: patch.proctoringDefault } : {}),
    ...(patch.defaultRealtimeModelId !== undefined ? { default_realtime_model_id: patch.defaultRealtimeModelId } : {}),
  };
  await db
    .insertInto("user_preferences")
    .values({ user_id: actor.id, ...values })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ ...values, updated_at: new Date() }))
    .execute();
  return preferencesOf(actor.id);
}
