/**
 * One structured call to a text model: system + user prompt in, a schema-checked JSON
 * object out, usage booked against the user. Works with every adapter (OpenAI and Gemini
 * get native JSON mode; the others follow the prompt) and repairs the usual damage:
 * code fences around the object, prose before it, a truncated tail.
 */
import type { z } from "zod";
import { captureError } from "../../core/logger";
import type { ResolvedModel } from "../models.service";
import { recordUsage } from "../quota.service";

export class ModelOutputError extends Error {}

export interface JsonCall<S extends z.ZodTypeAny> {
  model: ResolvedModel;
  userId: string;
  system: string;
  user: string;
  schema: S;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export async function generateJson<S extends z.ZodTypeAny>(call: JsonCall<S>): Promise<z.infer<S>> {
  let lastError: unknown = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let calls = 0;
  try {
    // One retry: a model that broke the format once usually gets it right the second time.
    for (let attempt = 0; attempt < 2; attempt++) {
      calls++;
      let text = "";
      for await (const ev of call.model.adapter.stream(
        {
          model: call.model.model.model_ref,
          messages: [
            { role: "system", content: call.system },
            { role: "user", content: [{ type: "text", text: call.user }] },
          ],
          maxOutputTokens: Math.min(call.maxOutputTokens ?? 8192, call.model.model.max_output_tokens),
          temperature: call.temperature,
          json: true,
          signal: call.signal,
        },
        call.model.endpoint,
      )) {
        if (ev.type === "text") text += ev.text;
        else if (ev.type === "usage") {
          inputTokens += ev.inputTokens;
          outputTokens += ev.outputTokens;
        }
      }
      const parsed = call.schema.safeParse(parseJsonObject(text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error;
    }
    throw new ModelOutputError("The model did not return the expected format");
  } catch (err) {
    if (!(err instanceof ModelOutputError)) captureError(err, { where: "interview.ai", provider: call.model.endpoint.provider });
    throw err instanceof ModelOutputError ? err : new ModelOutputError(lastError ? "The model did not return the expected format" : "The model could not be reached");
  } finally {
    await recordUsage({ userId: call.userId, modelId: call.model.model.id, calls, inputTokens, outputTokens }).catch((e) => captureError(e, { where: "interview.ai.usage" }));
  }
}

/** The first JSON object in `text`, tolerating fences, leading prose and a cut-off tail. */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return null;
  const body = text.slice(start).replace(/```\s*$/, "");
  try {
    return JSON.parse(body);
  } catch {
    // Truncated or followed by prose: cut at the last closing brace and try again.
    const end = body.lastIndexOf("}");
    if (end === -1) return null;
    try {
      return JSON.parse(body.slice(0, end + 1));
    } catch {
      return null;
    }
  }
}
