import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@open-conversation/ui";
import type { AdminInterviewRow, AppSettings, IntegrationStatus, Page, QuotaTier } from "@open-conversation/types";

// jsdom has no ResizeObserver; Radix switches measure themselves with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const admin = {
  tiers: vi.fn<() => Promise<QuotaTier[]>>(),
  settings: vi.fn<() => Promise<AppSettings>>(),
  updateSettings: vi.fn<(b: Partial<AppSettings>) => Promise<AppSettings>>(),
  integrations: vi.fn<() => Promise<IntegrationStatus>>(),
  interviews: vi.fn<(q: Record<string, unknown>) => Promise<Page<AdminInterviewRow>>>(),
};
const nav = { replace: vi.fn(), push: vi.fn() };
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/interviews", useSearchParams: () => search }));
vi.mock("@/lib/api", () => ({ api: () => ({ admin }) }));

import { AdminQuotas } from "@/components/admin/pages/quotas";
import { AdminSettings } from "@/components/admin/pages/settings";
import { AdminInterviews } from "@/components/admin/pages/interviews";

const settings: AppSettings = {
  appName: "Mock Interviews",
  tagline: "Practise out loud",
  registration: "OPEN",
  allowedEmailDomains: [],
  supportEmail: null,
  interviewerName: "Avani",
  interviewerAddendum: "",
  features: { resumeUpload: true, jobDescription: true, codeQuestions: true, proctoring: true, sharing: true, pdfExport: true },
  retentionDays: null,
  minSupportedVersion: null,
};

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
  search = new URLSearchParams();
  admin.integrations.mockResolvedValue({
    mail: { mode: "outbox" },
    realtime: { openai: { keyConfigured: true, models: 2 }, gemini: { keyConfigured: false, models: 0 }, stub: { keyConfigured: true, models: 1 } },
    textModels: 0,
  });
});

describe("quotas page", () => {
  it("lists tiers with Unlimited and the default marker", async () => {
    admin.tiers.mockResolvedValue([
      { id: "t1", name: "Default", monthlyInterviews: 10, monthlyVoiceMinutes: 300, maxSessionMinutes: 30, isDefault: true, userCount: 4 },
      { id: "t2", name: "Staff", monthlyInterviews: null, monthlyVoiceMinutes: null, maxSessionMinutes: 60, isDefault: false, userCount: 1 },
    ]);
    wrap(<AdminQuotas />);
    const staff = await screen.findByTestId("tier-row-Staff");
    expect(within(staff).getAllByText("Unlimited").length).toBe(2);
    const def = screen.getByTestId("tier-row-Default");
    expect(within(def).getByText("Default", { selector: "span.inline-flex" })).toBeInTheDocument();
    expect(within(def).getByText("30 min")).toBeInTheDocument();
  });
});

describe("settings page", () => {
  it("saves only what changed", async () => {
    admin.settings.mockResolvedValue(settings);
    admin.updateSettings.mockImplementation(async (b) => ({ ...settings, ...b, features: { ...settings.features, ...(b.features ?? {}) } }));
    const user = userEvent.setup();
    wrap(<AdminSettings />);
    const proctoring = await screen.findByTestId("settings-feature-proctoring");
    expect(screen.queryByTestId("settings-save-bar")).not.toBeInTheDocument();
    await user.click(proctoring);
    expect(await screen.findByText(/Unsaved changes in Features/)).toBeInTheDocument();
    await user.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(admin.updateSettings).toHaveBeenCalledWith({ features: { proctoring: false } }));
  });

  it("blocks invite-only sign-up without a domain", async () => {
    admin.settings.mockResolvedValue({ ...settings, registration: "INVITE_ONLY", allowedEmailDomains: ["example.com"] });
    const user = userEvent.setup();
    wrap(<AdminSettings />);
    const list = await screen.findByTestId("settings-domains");
    await user.click(within(list).getByRole("button", { name: "Remove example.com" }));
    expect(await screen.findByText("Invite-only sign-up needs at least one allowed domain.")).toBeInTheDocument();
    expect(screen.getByTestId("settings-save")).toBeDisabled();
  });

  it("shows integrations read-only", async () => {
    admin.settings.mockResolvedValue(settings);
    wrap(<AdminSettings />);
    expect(await screen.findByText("OpenAI Realtime")).toBeInTheDocument();
    expect(screen.getByText("Key configured · 2 enabled models")).toBeInTheDocument();
    expect(screen.getByText("No key · 0 enabled models")).toBeInTheDocument();
    expect(screen.getByText(/None enabled: plans and scores cannot run/)).toBeInTheDocument();
    expect(screen.getByText("Outbox: written to disk on the server, not sent")).toBeInTheDocument();
  });
});

describe("interviews page", () => {
  const row = (over: Partial<AdminInterviewRow>): AdminInterviewRow => ({
    id: "i1",
    title: "Backend engineer at Acme",
    source: "JOB_DESCRIPTION",
    status: "COMPLETED",
    owner: { id: "u1", username: "ada", displayName: "Ada Lovelace", role: "USER" },
    questionCount: 8,
    answeredCount: 6,
    overallScore: 74,
    voiceMinutes: 23,
    createdAt: "2026-10-20T10:00:00Z",
    ...over,
  });

  it("lists metadata and filters by status in the URL", async () => {
    admin.interviews.mockResolvedValue({ items: [row({}), row({ id: "i2", title: "Data analyst", status: "PLANNING", questionCount: 0, answeredCount: 0, overallScore: null, voiceMinutes: 0 })], nextCursor: null });
    const user = userEvent.setup();
    wrap(<AdminInterviews />);
    const first = await screen.findByTestId("interview-row-i1");
    expect(within(first).getByText("6 of 8")).toBeInTheDocument();
    expect(within(first).getByText("74")).toBeInTheDocument();
    expect(within(first).getByText("23 min")).toBeInTheDocument();
    const second = screen.getByTestId("interview-row-i2");
    expect(within(second).getByText("Not scored")).toBeInTheDocument();
    expect(within(second).getByText("No plan")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Completed" }));
    expect(nav.replace).toHaveBeenCalledWith("/admin/interviews?status=COMPLETED", { scroll: false });
  });

  it("passes the URL filters to the API", async () => {
    search = new URLSearchParams("status=IN_PROGRESS&user=u1&q=acme");
    admin.interviews.mockResolvedValue({ items: [row({ status: "IN_PROGRESS" })], nextCursor: null });
    wrap(<AdminInterviews />);
    expect(await screen.findByText("Showing interviews by Ada Lovelace.", { exact: false })).toBeInTheDocument();
    expect(admin.interviews).toHaveBeenCalledWith(expect.objectContaining({ status: "IN_PROGRESS", userId: "u1", q: "acme" }));
  });
});
