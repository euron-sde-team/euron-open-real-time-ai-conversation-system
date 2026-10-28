-- Euron Open Conversation: initial schema.
--
-- Conventions
--   * Primary keys are ULIDs stored as text (sortable by creation time).
--   * Timestamps are timestamptz(3); the API runs with TZ=UTC. Millisecond precision is
--     exactly what a JS Date holds, so a keyset cursor built from a Date round-trips
--     without skipping or repeating rows.
--   * Lists page with keyset cursors, never OFFSET.
--   * One deployment serves one organisation or community: there is no tenant column.
--   * Provider API keys never live in this database. They come from the environment or
--     Secrets Manager (core/config.ts PROVIDER_KEYS), and no endpoint ever returns one.
--   * Resume files are never stored: the API reads them in memory and keeps only the
--     summary and the interview plan the model wrote from them (ADR 0005).
--   * Usage rows hold counts, seconds and model ids only, never transcript text.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Enums ──────────────────────────────────────────────────────────────────

-- USER: everyone. ADMIN: the control plane (users, models, quotas, settings, audit).
CREATE TYPE user_role AS ENUM ('USER', 'ADMIN');
CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED');
CREATE TYPE auth_token_type AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- OPENAI_COMPATIBLE covers Groq, OpenRouter, Together, Ollama, vLLM and anything else that
-- speaks the Chat Completions wire format (text models only).
CREATE TYPE provider_kind AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE', 'STUB');
-- TEXT models write interview plans and score answers. REALTIME models hold the live
-- voice conversation (OpenAI Realtime, Gemini Live, or the stub).
CREATE TYPE model_kind AS ENUM ('TEXT', 'REALTIME');

CREATE TYPE interview_source AS ENUM ('RESUME', 'JOB_DESCRIPTION');
-- PLANNING: the planner job is writing rounds. PLAN_FAILED: it gave up (reason kept).
-- READY: the candidate may review and start. IN_PROGRESS: at least one live session ran.
-- COMPLETED: finished or ended early by the candidate. Reports exist for both.
CREATE TYPE interview_status AS ENUM ('PLANNING', 'PLAN_FAILED', 'READY', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE answer_kind AS ENUM ('VOICE', 'CODE');
CREATE TYPE answer_status AS ENUM ('SCORING', 'SCORED', 'FAILED');
-- OPEN: a credential was minted and the session may be live. ENDED: closed by the
-- browser. EXPIRED: closed by the sweeper after the browser vanished.
CREATE TYPE live_status AS ENUM ('OPEN', 'ENDED', 'EXPIRED');
CREATE TYPE proctor_event_kind AS ENUM ('NO_FACE', 'MULTIPLE_FACES', 'FACE_BACK', 'TAB_HIDDEN', 'TAB_VISIBLE', 'CAMERA_OFF');

-- ─── Identity ───────────────────────────────────────────────────────────────

-- Quota tiers. Every user is on one (or the default); admins create as many as they like
-- ("Default", "Coaching cohort", "Staff") and may override one user's numbers on top.
-- NULL means unlimited. Months are calendar months in UTC.
CREATE TABLE quota_tiers (
  id                    text PRIMARY KEY,
  name                  text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60),
  monthly_interviews    integer CHECK (monthly_interviews >= 0),
  monthly_voice_minutes integer CHECK (monthly_voice_minutes >= 0),
  -- The longest one live session may run before the server stops minting for it.
  max_session_minutes   integer NOT NULL DEFAULT 15 CHECK (max_session_minutes BETWEEN 1 AND 120),
  is_default            boolean NOT NULL DEFAULT false,
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quota_tiers_one_default ON quota_tiers (is_default) WHERE is_default;

CREATE TABLE users (
  id                    text PRIMARY KEY,
  email                 citext NOT NULL UNIQUE,
  username              citext NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9][a-zA-Z0-9-]{1,38}[a-zA-Z0-9]$'),
  -- Cleaned at write time (domain/display-name.ts): never an email address or a phone number.
  display_name          text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash         text NOT NULL,
  role                  user_role NOT NULL DEFAULT 'USER',
  status                user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  email_verified_at     timestamptz(3),
  totp_secret           text,                    -- AES-256-GCM ciphertext (security/totp.ts), never the raw secret
  totp_enabled          boolean NOT NULL DEFAULT false,
  totp_last_step        bigint,                  -- last accepted TOTP time step: a code works once
  suspended_until       timestamptz(3),
  token_version         integer NOT NULL DEFAULT 0,
  quota_tier_id         text REFERENCES quota_tiers (id) ON DELETE SET NULL,
  -- Set when the user asks to delete the account; the purge job erases it after the
  -- grace period unless they sign in and cancel.
  deletion_requested_at timestamptz(3),
  last_seen_at          timestamptz(3),
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX users_name_trgm_idx ON users USING gin ((display_name || ' ' || username::text || ' ' || email::text) gin_trgm_ops);
CREATE INDEX users_admin_idx ON users (role) WHERE role <> 'USER';

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id    text NOT NULL,                  -- every rotation of one login shares a family
  token_hash   text NOT NULL UNIQUE,           -- sha256 of the refresh token
  user_agent   text,
  ip           inet,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  last_used_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at   timestamptz(3) NOT NULL,
  revoked_at   timestamptz(3),
  replaced_by  text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE auth_tokens (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       auth_token_type NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, type);

-- Single-use two-factor recovery codes, issued ten at a time when TOTP is turned on.
-- Only an HMAC of each code is stored (keyed from TOTP_ENCRYPTION_KEY).
CREATE TABLE totp_recovery_codes (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

-- How the interviewer sounds and listens for this user. Missing row = defaults
-- (services/preferences.service.ts).
CREATE TABLE user_preferences (
  user_id                text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- A realtime voice name ("alloy", "Kore", ...); the provider ignores names it lacks.
  voice                  text NOT NULL DEFAULT 'alloy' CHECK (length(voice) <= 40),
  -- ISO-639-1 for input transcription, or 'auto'.
  transcription_language text NOT NULL DEFAULT 'auto' CHECK (transcription_language ~ '^(auto|[a-z]{2})$'),
  -- Whether new interviews start with face and tab proctoring on.
  proctoring_default     boolean NOT NULL DEFAULT false,
  default_realtime_model_id text,              -- FK added after models exists
  updated_at             timestamptz(3) NOT NULL DEFAULT now()
);

-- ─── Providers and models ───────────────────────────────────────────────────

-- A provider is an endpoint. Its key is looked up by slug in PROVIDER_KEYS at call time.
CREATE TABLE providers (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),   -- the slug
  kind         provider_kind NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  base_url     text CHECK (length(base_url) <= 300),
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  updated_at   timestamptz(3) NOT NULL DEFAULT now()
);

-- The one model catalogue the runtime reads. Prices are optional and only feed the
-- admin's cost estimate; nothing is billed.
CREATE TABLE models (
  id                    text PRIMARY KEY,
  provider_id           text NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  kind                  model_kind NOT NULL DEFAULT 'TEXT',
  model_ref             text NOT NULL CHECK (length(model_ref) BETWEEN 1 AND 120),   -- the provider's model id
  display_name          text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  description           text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
  max_output_tokens     integer NOT NULL DEFAULT 8192 CHECK (max_output_tokens > 0),
  -- REALTIME only: the voices this model offers, the first being the default.
  voices                text[] NOT NULL DEFAULT '{}',
  input_usd_per_mtok    numeric(10, 4) CHECK (input_usd_per_mtok >= 0),
  output_usd_per_mtok   numeric(10, 4) CHECK (output_usd_per_mtok >= 0),
  usd_per_minute        numeric(10, 4) CHECK (usd_per_minute >= 0),
  enabled               boolean NOT NULL DEFAULT true,
  is_default            boolean NOT NULL DEFAULT false,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_ref, kind)
);
CREATE UNIQUE INDEX models_one_default_per_kind ON models (kind) WHERE is_default;

ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_model_fk FOREIGN KEY (default_realtime_model_id) REFERENCES models (id) ON DELETE SET NULL;

-- ─── Interviews ─────────────────────────────────────────────────────────────

-- One mock interview. `plan` is the round list the planner wrote (and the candidate may
-- have edited before starting): [{ name, focus, description, questions: [{ text, code,
-- language }] }]. It is frozen once the first live session opens.
CREATE TABLE interviews (
  id                text PRIMARY KEY,
  user_id           text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source            interview_source NOT NULL,
  status            interview_status NOT NULL DEFAULT 'PLANNING',
  title             text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  company           text CHECK (length(company) <= 120),
  role              text CHECK (length(role) <= 120),
  domain            text CHECK (length(domain) <= 120),
  -- A short summary of the candidate (from the resume) or of the job (from the JD).
  -- Given to the interviewer as context; never the full resume.
  summary           text CHECK (length(summary) <= 2000),
  -- The job description as typed, so the plan can be regenerated. NULL for resumes.
  job_description   text CHECK (length(job_description) <= 12000),
  plan              jsonb,
  plan_error        text CHECK (length(plan_error) <= 300),
  proctoring        boolean NOT NULL DEFAULT false,
  text_model_id     text REFERENCES models (id) ON DELETE SET NULL,
  realtime_model_id text REFERENCES models (id) ON DELETE SET NULL,
  -- Where the candidate is: the next question to ask.
  current_round     integer NOT NULL DEFAULT 0 CHECK (current_round >= 0),
  current_question  integer NOT NULL DEFAULT 0 CHECK (current_question >= 0),
  started_at        timestamptz(3),
  completed_at      timestamptz(3),
  created_at        timestamptz(3) NOT NULL DEFAULT now(),
  updated_at        timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX interviews_user_idx ON interviews (user_id, created_at DESC, id DESC);
CREATE INDEX interviews_recent_idx ON interviews (created_at DESC, id DESC);
-- The monthly interview count reads this.
CREATE INDEX interviews_user_month_idx ON interviews (user_id, created_at);

-- The candidate's answer to one question, and its score. One row per question: answering
-- again replaces the transcript and scores it again.
CREATE TABLE answers (
  id                   text PRIMARY KEY,
  interview_id         text NOT NULL REFERENCES interviews (id) ON DELETE CASCADE,
  round_index          integer NOT NULL CHECK (round_index >= 0),
  question_index       integer NOT NULL CHECK (question_index >= 0),
  kind                 answer_kind NOT NULL,
  -- [{ role: "interviewer" | "candidate", text }], as transcribed in the browser.
  transcript           jsonb NOT NULL DEFAULT '[]',
  code                 text CHECK (length(code) <= 40000),
  language             text CHECK (length(language) <= 40),
  status               answer_status NOT NULL DEFAULT 'SCORING',
  -- 1 to 100, written only by the scoring job. A client never sets these.
  domain_rating        integer CHECK (domain_rating BETWEEN 1 AND 100),
  communication_rating integer CHECK (communication_rating BETWEEN 1 AND 100),
  -- { strengths: [], weaknesses: [], suggestions: [], analysis, correctedSnippet? }
  feedback             jsonb,
  scored_at            timestamptz(3),
  created_at           timestamptz(3) NOT NULL DEFAULT now(),
  updated_at           timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (interview_id, round_index, question_index)
);

-- One realtime connection. The server mints a short-lived, locked credential per
-- question and records it here; minutes are booked when the browser ends the session
-- or the sweeper expires it.
CREATE TABLE live_sessions (
  id             text PRIMARY KEY,
  interview_id   text NOT NULL REFERENCES interviews (id) ON DELETE CASCADE,
  user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  model_id       text REFERENCES models (id) ON DELETE SET NULL,
  provider_kind  provider_kind NOT NULL,
  round_index    integer NOT NULL,
  question_index integer NOT NULL,
  status         live_status NOT NULL DEFAULT 'OPEN',
  -- The SDP relay accepts only credentials it has seen minted (hash, never the value).
  credential_hash text,
  -- OpenAI WebRTC: the call id from the relayed SDP answer, so the server can hang up.
  provider_call_id text,
  max_seconds    integer NOT NULL CHECK (max_seconds > 0),
  seconds        integer NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  created_at     timestamptz(3) NOT NULL DEFAULT now(),
  expires_at     timestamptz(3) NOT NULL,
  ended_at       timestamptz(3)
);
-- At most one open live session per user, enforced by the database.
CREATE UNIQUE INDEX live_sessions_one_open ON live_sessions (user_id) WHERE status = 'OPEN';
CREATE INDEX live_sessions_interview_idx ON live_sessions (interview_id, created_at);
CREATE INDEX live_sessions_user_month_idx ON live_sessions (user_id, created_at);
CREATE INDEX live_sessions_credential_idx ON live_sessions (credential_hash) WHERE status = 'OPEN';

-- What the browser's proctoring saw. Video never leaves the device; only these events do.
CREATE TABLE proctor_events (
  id             text PRIMARY KEY,
  interview_id   text NOT NULL REFERENCES interviews (id) ON DELETE CASCADE,
  kind           proctor_event_kind NOT NULL,
  round_index    integer,
  question_index integer,
  occurred_at    timestamptz(3) NOT NULL,
  created_at     timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX proctor_events_interview_idx ON proctor_events (interview_id, occurred_at);

-- A read-only link to one interview's report. The id is the public token (ULID + random
-- suffix). The transcript is shown only when the owner chose to include it.
CREATE TABLE shares (
  id                 text PRIMARY KEY,
  user_id            text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  interview_id       text NOT NULL REFERENCES interviews (id) ON DELETE CASCADE,
  include_transcript boolean NOT NULL DEFAULT false,
  view_count         integer NOT NULL DEFAULT 0,
  revoked_at         timestamptz(3),
  revoked_by         text REFERENCES users (id) ON DELETE SET NULL,
  expires_at         timestamptz(3),
  created_at         timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX shares_user_idx ON shares (user_id, created_at DESC, id DESC);
CREATE INDEX shares_interview_idx ON shares (interview_id);
CREATE INDEX shares_recent_idx ON shares (created_at DESC, id DESC);

-- ─── Quotas and usage ───────────────────────────────────────────────────────

-- One user's numbers on top of their tier. NULL columns fall back to the tier.
CREATE TABLE user_quota_overrides (
  user_id               text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  monthly_interviews    integer CHECK (monthly_interviews >= 0),
  monthly_voice_minutes integer CHECK (monthly_voice_minutes >= 0),
  note                  text CHECK (length(note) <= 300),
  updated_by            text REFERENCES users (id) ON DELETE SET NULL,
  updated_at            timestamptz(3) NOT NULL DEFAULT now()
);

-- Daily totals per user and model, in the UTC day. Counts only (ADR 0006).
CREATE TABLE usage_daily (
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day           date NOT NULL,
  model_id      text NOT NULL REFERENCES models (id) ON DELETE CASCADE,
  calls         integer NOT NULL DEFAULT 0,
  -- Interviews created (booked against the text model that planned them). Kept here, not
  -- counted from interviews, so deleting an interview does not give the quota back.
  interviews    integer NOT NULL DEFAULT 0,
  input_tokens  bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  voice_seconds bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, model_id)
);
CREATE INDEX usage_daily_day_idx ON usage_daily (day);

-- ─── Operations ─────────────────────────────────────────────────────────────

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by text REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          text PRIMARY KEY,
  actor_id    text REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  ip          inet,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_recent_idx ON audit_log (created_at DESC, id DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);

-- ─── Seed rows ──────────────────────────────────────────────────────────────

-- The default tier: enough to practise every week, small enough to protect a key.
INSERT INTO quota_tiers (id, name, monthly_interviews, monthly_voice_minutes, max_session_minutes, is_default)
VALUES ('01JDK4V7Q80000000000000000', 'Default', 8, 120, 15, true);
