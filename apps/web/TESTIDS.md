# Test ids

Stable `data-testid` hooks for end-to-end tests. Prefer accessible names (roles and labels) where they exist; these ids cover elements without a unique accessible name. `<id>` marks a dynamic suffix (for example `case-action-<id>` is `case-action-hide`).

Generated from the source by `node scripts/gen-testids.mjs`; rerun it after adding or renaming an id.

## Shell and navigation

| Test id | Source |
|---|---|
| `avatar-menu` | `components/shell/avatar-menu.tsx` |
| `confirm-action` | `components/common/confirm-dialog.tsx` |
| `nav-admin` | `components/shell/avatar-menu.tsx` |
| `sign-out` | `components/shell/avatar-menu.tsx` |
| `theme-dark` | `components/shell/avatar-menu.tsx` |
| `theme-light` | `components/shell/avatar-menu.tsx` |
| `theme-system` | `components/shell/avatar-menu.tsx` |

## Sidebar

| Test id | Source |
|---|---|
| `account-menu` | `components/app/sidebar.tsx` |
| `new-interview` | `components/app/sidebar.tsx` |
| `sign-out` | `components/app/sidebar.tsx` |

## Interviews

| Test id | Source |
|---|---|
| `resume-input` | `components/interview/new-interview.tsx` |
| `start-interview` | `components/interview/interview-view.tsx` |

## Live room

| Test id | Source |
|---|---|
| `join-interview` | `components/room/room-view.tsx` |
| `next-question` | `components/room/room-view.tsx` |
| `transcript` | `components/room/transcript-panel.tsx` |

## Reports and sharing

| Test id | Source |
|---|---|
| `report-question-<id>-<id>` | `components/report/report-body.tsx` |
| `share-report` | `components/report/report-view.tsx` |

## Settings

| Test id | Source |
|---|---|
| `pref-language` | `components/settings/settings-view.tsx` |
| `pref-model` | `components/settings/settings-view.tsx` |
| `pref-proctoring` | `components/settings/settings-view.tsx` |
| `pref-theme` | `components/settings/settings-view.tsx` |
| `pref-voice` | `components/settings/settings-view.tsx` |
| `profile-name` | `components/settings/settings-view.tsx` |
| `profile-save` | `components/settings/settings-view.tsx` |
| `settings-appearance` | `components/settings/settings-view.tsx` |
| `settings-interviews` | `components/settings/settings-view.tsx` |
| `settings-profile` | `components/settings/settings-view.tsx` |
| `settings-shares` | `components/settings/settings-view.tsx` |
| `share-<id>` | `components/settings/settings-view.tsx` |
| `share-revoke-<id>` | `components/settings/settings-view.tsx` |
| `shares-list` | `components/settings/settings-view.tsx` |

## Sign up and sign in

| Test id | Source |
|---|---|
| `forgot-sent` | `components/auth/forgot-password.tsx` |
| `forgot-submit` | `components/auth/forgot-password.tsx` |
| `goodbye` | `components/auth/goodbye.tsx` |
| `login-submit` | `components/auth/login-form.tsx` |
| `recovery-code-input` | `components/auth/login-form.tsx` |
| `recovery-toggle` | `components/auth/login-form.tsx` |
| `reset-done` | `components/auth/reset-password.tsx` |
| `reset-submit` | `components/auth/reset-password.tsx` |
| `signup-check-email` | `components/auth/signup-form.tsx` |
| `signup-submit` | `components/auth/signup-form.tsx` |
| `totp-input` | `components/auth/login-form.tsx` |

## Account

| Test id | Source |
|---|---|
| `delete-account` | `components/account/privacy-section.tsx` |
| `delete-account-confirm` | `components/account/privacy-section.tsx` |
| `delete-account-dialog` | `components/account/privacy-section.tsx` |
| `delete-confirm-username` | `components/account/privacy-section.tsx` |
| `delete-password` | `components/account/privacy-section.tsx` |
| `delete-totp` | `components/account/privacy-section.tsx` |
| `export-data` | `components/account/privacy-section.tsx` |
| `password-save` | `components/account/security-section.tsx` |
| `recovery-codes` | `components/account/security-section.tsx` |
| `recovery-copy` | `components/account/security-section.tsx` |
| `recovery-done` | `components/account/security-section.tsx` |
| `recovery-download` | `components/account/security-section.tsx` |
| `recovery-saved` | `components/account/security-section.tsx` |
| `session-revoke` | `components/account/security-section.tsx` |
| `sessions-list` | `components/account/security-section.tsx` |
| `sessions-sign-out-all` | `components/account/security-section.tsx` |
| `totp-disable` | `components/account/security-section.tsx` |
| `totp-enable` | `components/account/security-section.tsx` |
| `totp-qr` | `components/account/security-section.tsx` |
| `totp-regenerate` | `components/account/security-section.tsx` |
| `totp-secret` | `components/account/security-section.tsx` |
| `totp-start` | `components/account/security-section.tsx` |

## Admin

| Test id | Source |
|---|---|
| `admin-back-to-chat` | `components/admin/shell/admin-shell.tsx` |
| `admin-forbidden` | `components/admin/shell/forbidden.tsx` |
| `admin-menu` | `components/admin/shell/admin-shell.tsx` |
| `admin-nav` | `components/admin/shell/admin-shell.tsx` |
| `admin-nav-<id>` | `components/admin/shell/admin-shell.tsx` |
| `admin-product-name` | `components/admin/shell/admin-shell.tsx` |
| `admin-sidebar` | `components/admin/shell/admin-shell.tsx` |
| `admin-sidebar-toggle` | `components/admin/shell/admin-shell.tsx` |
| `audit-data` | `components/admin/pages/audit.tsx` |
| `audit-expand` | `components/admin/pages/audit.tsx` |
| `audit-list` | `components/admin/pages/audit.tsx` |
| `audit-more` | `components/admin/pages/audit.tsx` |
| `audit-row-<id>` | `components/admin/pages/audit.tsx` |
| `interviews-owner-filter` | `components/admin/pages/interviews.tsx` |
| `model-add` | `components/admin/pages/models.tsx` |
| `model-add-<id>` | `components/admin/pages/models.tsx` |
| `model-default` | `components/admin/pages/models.tsx` |
| `model-description` | `components/admin/pages/models.tsx` |
| `model-dialog` | `components/admin/pages/models.tsx` |
| `model-enabled` | `components/admin/pages/models.tsx` |
| `model-kind` | `components/admin/pages/models.tsx` |
| `model-max-output` | `components/admin/pages/models.tsx` |
| `model-name` | `components/admin/pages/models.tsx` |
| `model-price-in` | `components/admin/pages/models.tsx` |
| `model-price-minute` | `components/admin/pages/models.tsx` |
| `model-price-out` | `components/admin/pages/models.tsx` |
| `model-provider` | `components/admin/pages/models.tsx` |
| `model-ref` | `components/admin/pages/models.tsx` |
| `model-save` | `components/admin/pages/models.tsx` |
| `model-sort` | `components/admin/pages/models.tsx` |
| `model-test-dialog` | `components/admin/pages/models.tsx` |
| `model-test-result` | `components/admin/pages/models.tsx` |
| `model-voices` | `components/admin/pages/models.tsx` |
| `override-form` | `components/admin/pages/user-sheet.tsx` |
| `override-interviews` | `components/admin/pages/user-sheet.tsx` |
| `override-note` | `components/admin/pages/user-sheet.tsx` |
| `override-remove` | `components/admin/pages/user-sheet.tsx` |
| `override-save` | `components/admin/pages/user-sheet.tsx` |
| `override-voice-minutes` | `components/admin/pages/user-sheet.tsx` |
| `provider-add` | `components/admin/pages/models.tsx` |
| `provider-dialog` | `components/admin/pages/models.tsx` |
| `provider-enabled` | `components/admin/pages/models.tsx` |
| `provider-kind` | `components/admin/pages/models.tsx` |
| `provider-name` | `components/admin/pages/models.tsx` |
| `provider-save` | `components/admin/pages/models.tsx` |
| `provider-slug` | `components/admin/pages/models.tsx` |
| `provider-url` | `components/admin/pages/models.tsx` |
| `reason-confirm` | `components/admin/shell/reason-dialog.tsx` |
| `reason-days` | `components/admin/shell/reason-dialog.tsx` |
| `reason-input` | `components/admin/shell/reason-dialog.tsx` |
| `reason-typed` | `components/admin/shell/reason-dialog.tsx` |
| `settings-app-name` | `components/admin/pages/settings.tsx` |
| `settings-discard` | `components/admin/pages/settings.tsx` |
| `settings-domain-add` | `components/admin/pages/settings.tsx` |
| `settings-domain-input` | `components/admin/pages/settings.tsx` |
| `settings-domains` | `components/admin/pages/settings.tsx` |
| `settings-feature-<id>` | `components/admin/pages/settings.tsx` |
| `settings-form` | `components/admin/pages/settings.tsx` |
| `settings-interviewer-addendum` | `components/admin/pages/settings.tsx` |
| `settings-interviewer-name` | `components/admin/pages/settings.tsx` |
| `settings-keep-forever` | `components/admin/pages/settings.tsx` |
| `settings-min-version` | `components/admin/pages/settings.tsx` |
| `settings-registration` | `components/admin/pages/settings.tsx` |
| `settings-retention` | `components/admin/pages/settings.tsx` |
| `settings-save` | `components/admin/pages/settings.tsx` |
| `settings-save-bar` | `components/admin/pages/settings.tsx` |
| `settings-support-email` | `components/admin/pages/settings.tsx` |
| `settings-tagline` | `components/admin/pages/settings.tsx` |
| `share-revoke-<id>` | `components/admin/pages/shares.tsx` |
| `shares-include-revoked` | `components/admin/pages/shares.tsx` |
| `tier-add` | `components/admin/pages/quotas.tsx` |
| `tier-default` | `components/admin/pages/quotas.tsx` |
| `tier-dialog` | `components/admin/pages/quotas.tsx` |
| `tier-interviews` | `components/admin/pages/quotas.tsx` |
| `tier-max-session` | `components/admin/pages/quotas.tsx` |
| `tier-menu-<id>` | `components/admin/pages/quotas.tsx` |
| `tier-name` | `components/admin/pages/quotas.tsx` |
| `tier-save` | `components/admin/pages/quotas.tsx` |
| `tier-voice-minutes` | `components/admin/pages/quotas.tsx` |
| `user-ban` | `components/admin/pages/user-sheet.tsx` |
| `user-erase` | `components/admin/pages/user-sheet.tsx` |
| `user-interviews-link` | `components/admin/pages/user-sheet.tsx` |
| `user-make-admin` | `components/admin/pages/user-sheet.tsx` |
| `user-remove-admin` | `components/admin/pages/user-sheet.tsx` |
| `user-suspend` | `components/admin/pages/user-sheet.tsx` |
| `user-tier` | `components/admin/pages/user-sheet.tsx` |
| `user-unban` | `components/admin/pages/user-sheet.tsx` |
| `user-unsuspend` | `components/admin/pages/user-sheet.tsx` |
| `users-role` | `components/admin/pages/users.tsx` |
| `users-tier` | `components/admin/pages/users.tsx` |
