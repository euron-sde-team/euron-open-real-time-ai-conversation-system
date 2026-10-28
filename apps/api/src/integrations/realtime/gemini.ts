/**
 * Gemini Live. The server creates a one-use ephemeral token (v1alpha auth_tokens) whose
 * `liveConnectConstraints` carry the model, the instructions, the tool, the voice and
 * transcription; with the constraints set, the Live API ignores any different config the
 * browser sends, so the instructions cannot be changed client side. The token expires
 * when the session's time is over.
 */
import { GoogleGenAI, Modality, type FunctionDeclaration } from "@google/genai";
import { RealtimeMintError, type RealtimeAdapter } from "./types";

export const geminiLive: RealtimeAdapter = {
  provider: "gemini",
  async mint(req, apiKey, baseUrl) {
    if (!apiKey) throw new RealtimeMintError("No key is configured for this provider");
    const now = Date.now();
    const connectBy = new Date(now + req.connectTtlSeconds * 1000);
    const endBy = new Date(now + (req.connectTtlSeconds + req.maxSeconds) * 1000);
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha", baseUrl: baseUrl.replace(/\/v1alpha\/?$/, "") } });
    try {
      const token = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime: endBy.toISOString(),
          newSessionExpireTime: connectBy.toISOString(),
          liveConnectConstraints: {
            model: req.model,
            config: {
              responseModalities: [Modality.AUDIO],
              systemInstruction: req.instructions,
              tools: [{ functionDeclarations: [{ name: req.tool.name, description: req.tool.description } as FunctionDeclaration] }],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice } }, ...(req.transcriptionLanguage !== "auto" ? { languageCode: req.transcriptionLanguage } : {}) },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          },
          lockAdditionalFields: [],
        },
      });
      if (!token.name) throw new RealtimeMintError("The voice provider returned no credential");
      return { credential: token.name, expiresAt: connectBy, connectUrl: null };
    } catch (err) {
      if (err instanceof RealtimeMintError) throw err;
      const status = (err as { status?: number }).status ?? null;
      throw new RealtimeMintError(`The voice provider refused the session${status ? ` (HTTP ${status})` : ""}`, status);
    }
  },
};
