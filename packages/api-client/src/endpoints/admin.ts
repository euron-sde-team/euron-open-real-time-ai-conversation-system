/** The /admin control plane. Admins only. */
import type {
  AdminModel,
  AdminProvider,
  AdminSession,
  AdminShareRow,
  AdminStats,
  AdminUserDetail,
  AdminUserRow,
  AuditEntry,
  AdminInterviewRow,
  AppSettings,
  IntegrationStatus,
  ModelTestResult,
  Page,
  QuotaTier,
  UserRole,
  UserStatus,
} from "@open-conversation/types";
import { enc, type Helpers, type PageQuery } from "./helpers";

export type ModelInput = Omit<AdminModel, "id">;
export type ProviderInput = Omit<AdminProvider, "keyConfigured" | "modelCount">;
export type TierInput = { name: string; monthlyInterviews: number | null; monthlyVoiceMinutes: number | null; maxSessionMinutes: number; isDefault?: boolean };
type DeepPartial<T> = { [K in keyof T]?: T[K] extends Record<string, unknown> ? Partial<T[K]> : T[K] };

export function adminEndpoints(h: Helpers) {
  const { get, post, put, patch, del, pq } = h;
  const admin = {
    session: () => get<AdminSession>("/admin/me"),
    stats: (q: { from?: string; to?: string } = {}) => get<AdminStats>("/admin/stats", pq(q)),
    users: (q: PageQuery & { q?: string; status?: UserStatus; role?: UserRole; tierId?: string } = {}) => get<Page<AdminUserRow>>("/admin/users", pq(q)),
    user: (id: string) => get<AdminUserDetail>(`/admin/users/${enc(id)}`),
    setRole: (id: string, role: UserRole) => patch<AdminUserRow>(`/admin/users/${enc(id)}/role`, { role }),
    suspend: (id: string, days: number, reason?: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/suspend`, { days, reason }),
    unsuspend: (id: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/unsuspend`, {}),
    ban: (id: string, reason?: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/ban`, { reason }),
    unban: (id: string) => post<AdminUserRow>(`/admin/users/${enc(id)}/unban`, {}),
    erase: (id: string, reason: string) => post(`/admin/users/${enc(id)}/erase`, { reason }),
    setTier: (id: string, tierId: string | null) => put<AdminUserRow>(`/admin/users/${enc(id)}/tier`, { tierId }),
    /** Set the account's own limits, or pass null to remove them. */
    setQuota: (id: string, body: { monthlyInterviews: number | null; monthlyVoiceMinutes: number | null; note: string | null } | null) => (body ? put<AdminUserDetail>(`/admin/users/${enc(id)}/quota`, body) : del<AdminUserDetail>(`/admin/users/${enc(id)}/quota`)),
    tiers: () => get<QuotaTier[]>("/admin/tiers"),
    createTier: (body: TierInput) => post<QuotaTier[]>("/admin/tiers", body),
    updateTier: (id: string, body: TierInput) => put<QuotaTier[]>(`/admin/tiers/${enc(id)}`, body),
    deleteTier: (id: string) => del<QuotaTier[]>(`/admin/tiers/${enc(id)}`),
    providers: () => get<AdminProvider[]>("/admin/providers"),
    createProvider: (body: ProviderInput) => post<AdminProvider[]>("/admin/providers", body),
    updateProvider: (id: string, body: Omit<ProviderInput, "id">) => put<AdminProvider[]>(`/admin/providers/${enc(id)}`, body),
    deleteProvider: (id: string) => del<AdminProvider[]>(`/admin/providers/${enc(id)}`),
    models: () => get<AdminModel[]>("/admin/models"),
    createModel: (body: ModelInput) => post<AdminModel[]>("/admin/models", body),
    updateModel: (id: string, body: ModelInput) => put<AdminModel[]>(`/admin/models/${enc(id)}`, body),
    deleteModel: (id: string) => del<AdminModel[]>(`/admin/models/${enc(id)}`),
    testModel: (id: string) => post<ModelTestResult>(`/admin/models/${enc(id)}/test`),
    settings: () => get<AppSettings>("/admin/settings"),
    updateSettings: (body: DeepPartial<AppSettings>) => patch<AppSettings>("/admin/settings", body),
    interviews: (q: PageQuery & { q?: string; status?: string; userId?: string } = {}) => get<Page<AdminInterviewRow>>("/admin/interviews", pq(q)),
    integrations: () => get<IntegrationStatus>("/admin/integrations"),
    shares: (q: PageQuery & { includeRevoked?: boolean } = {}) => get<Page<AdminShareRow>>("/admin/shares", pq(q)),
    revokeShare: (id: string, reason: string) => post(`/admin/shares/${enc(id)}/revoke`, { reason }),
    audit: (q: PageQuery & { action?: string; actorId?: string; entityType?: string; entityId?: string } = {}) => get<Page<AuditEntry>>("/admin/audit", pq(q)),
  };
  return { admin };
}
