import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@open-conversation/ui";
import type { AppMeta, Page, Preferences, RealtimeModelOption, ShareSummary, Usage } from "@open-conversation/types";

const me = {
  preferences: vi.fn<() => Promise<Preferences>>(),
  updatePreferences: vi.fn<(b: Partial<Preferences>) => Promise<Preferences>>(),
  realtimeModels: vi.fn<() => Promise<RealtimeModelOption[]>>(),
  usage: vi.fn<() => Promise<Usage>>(),
};
const shares = { list: vi.fn<() => Promise<Page<ShareSummary>>>(), revoke: vi.fn<(id: string) => Promise<void>>() };
const meta = { get: vi.fn<() => Promise<Partial<AppMeta>>>() };
vi.mock("@/lib/api", () => ({ api: () => ({ me, shares, meta }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/settings", useSearchParams: () => new URLSearchParams() }));

import { SettingsView } from "@/components/settings/settings-view";
import { effectiveModel, effectiveVoice, expiryLabel, languageOptions, modelPatch, viewsLabel } from "@/components/settings/settings-lib";

const models: RealtimeModelOption[] = [
  { id: "m1", displayName: "OpenAI Realtime", description: "", provider: "openai", voices: ["alloy", "verse"], isDefault: true },
  { id: "m2", displayName: "Gemini Live", description: "", provider: "gemini", voices: ["Puck", "Kore"], isDefault: false },
];
const prefs: Preferences = { voice: "verse", transcriptionLanguage: "auto", proctoringDefault: false, defaultRealtimeModelId: null };

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  me.preferences.mockResolvedValue(prefs);
  me.updatePreferences.mockImplementation(async (b) => ({ ...prefs, ...b }));
  me.realtimeModels.mockResolvedValue(models);
  me.usage.mockResolvedValue({ month: "2026-10", interviews: { used: 3, limit: 10 }, voiceMinutes: { used: 42, limit: null }, maxSessionMinutes: 30, resetsAt: "2026-11-01T00:00:00Z" });
  meta.get.mockResolvedValue({ interviewerName: "Avani", features: { resumeUpload: true, jobDescription: true, codeQuestions: true, proctoring: true, sharing: true, pdfExport: true } });
  shares.list.mockResolvedValue({
    items: [
      { id: "s1", interviewId: "i1", interviewTitle: "Backend at Acme", url: "https://x/s/s1", includeTranscript: true, viewCount: 1, expiresAt: null, createdAt: "2026-10-01T00:00:00Z" },
      { id: "s2", interviewId: "i2", interviewTitle: "Data analyst", url: "https://x/s/s2", includeTranscript: false, viewCount: 12, expiresAt: "2020-01-01T00:00:00Z", createdAt: "2019-12-01T00:00:00Z" },
    ],
    nextCursor: null,
  });
  shares.revoke.mockResolvedValue(undefined);
});

describe("settings helpers", () => {
  it("picks the model and voice the room will use", () => {
    expect(effectiveModel(models, { defaultRealtimeModelId: null })?.id).toBe("m1");
    expect(effectiveModel(models, { defaultRealtimeModelId: "m2" })?.id).toBe("m2");
    expect(effectiveModel(models, { defaultRealtimeModelId: "gone" })?.id).toBe("m1");
    expect(effectiveModel([], { defaultRealtimeModelId: null })).toBeNull();
    expect(effectiveVoice(models[0]!, "verse")).toBe("verse");
    expect(effectiveVoice(models[1]!, "verse")).toBe("Puck");
  });
  it("moves the voice along when the new model does not offer it", () => {
    expect(modelPatch(models, "m2", "verse")).toEqual({ defaultRealtimeModelId: "m2", voice: "Puck" });
    expect(modelPatch(models, null, "alloy")).toEqual({ defaultRealtimeModelId: null });
  });
  it("keeps an unlisted saved language selectable", () => {
    expect(languageOptions("en").some((l) => l.code === "sw")).toBe(false);
    expect(languageOptions("sw").at(-1)).toEqual({ code: "sw", name: "SW" });
  });
  it("labels expiry and views", () => {
    const now = Date.parse("2026-10-28T00:00:00Z");
    expect(expiryLabel({ expiresAt: null }, now)).toBe("No expiry");
    expect(expiryLabel({ expiresAt: "2026-10-01T00:00:00Z" }, now)).toBe("Expired");
    expect(expiryLabel({ expiresAt: "2026-11-04T12:00:00Z" }, now, "en-US")).toBe("Expires Nov 4, 2026");
    expect(viewsLabel(1)).toBe("1 view");
    expect(viewsLabel(1200, "en-US")).toBe("1,200 views");
  });
});

describe("settings page", () => {
  it("offers the chosen model's voices and saves a model change with a voice it offers", async () => {
    const user = userEvent.setup();
    wrap(<SettingsView />);
    const voice = await screen.findByTestId("pref-voice");
    expect(within(voice).getAllByRole("option").map((o) => o.textContent)).toEqual(["Alloy", "Verse"]);
    expect(voice).toHaveValue("verse");
    await user.selectOptions(screen.getByTestId("pref-model"), "m2");
    await waitFor(() => expect(me.updatePreferences).toHaveBeenCalledWith({ defaultRealtimeModelId: "m2", voice: "Puck" }));
    expect(await screen.findByText("Kore")).toBeInTheDocument();
    expect(screen.getByText("3 of 10 interviews")).toBeInTheDocument();
    expect(screen.getByText("42 voice minutes")).toBeInTheDocument();
  });

  it("saves the language and the proctoring default", async () => {
    const user = userEvent.setup();
    wrap(<SettingsView />);
    await user.selectOptions(await screen.findByTestId("pref-language"), "hi");
    await waitFor(() => expect(me.updatePreferences).toHaveBeenCalledWith({ transcriptionLanguage: "hi" }));
    await user.click(screen.getByTestId("pref-proctoring"));
    await waitFor(() => expect(me.updatePreferences).toHaveBeenCalledWith({ proctoringDefault: true }));
  });

  it("lists shared links as one line of facts and revokes after confirming", async () => {
    const user = userEvent.setup();
    wrap(<SettingsView />);
    await user.click(screen.getByRole("tab", { name: "Shared links" }));
    const first = await screen.findByTestId("share-s1");
    expect(within(first).getByText("Transcript included · 1 view · No expiry")).toBeInTheDocument();
    expect(within(screen.getByTestId("share-s2")).getByText("Scores only, no transcript · 12 views · Expired")).toBeInTheDocument();
    await user.click(within(first).getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText(/The link to "Backend at Acme" stops working/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revoke link" }));
    await waitFor(() => expect(shares.revoke).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.queryByTestId("share-s1")).not.toBeInTheDocument());
  });
});
