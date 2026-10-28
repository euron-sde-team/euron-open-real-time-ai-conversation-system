import { isApiError } from "@open-conversation/api-client";

/** Human copy for the API's stable error codes. Unknown codes fall back to the server message. */
const COPY: Record<string, string> = {
  NETWORK_ERROR: "We could not reach the server. Check your connection and try again.",
  SERVER_ERROR: "Something went wrong on our side. Try again in a moment.",
  BAD_GATEWAY: "The service is restarting. Try again in a moment.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Try again in a moment.",
  GATEWAY_TIMEOUT: "The server took too long to answer. Try again.",
  RATE_LIMITED: "You are doing that too fast. Wait a moment and try again.",
  UNAUTHENTICATED: "Sign in to continue.",
  TOKEN_INVALID: "This link is invalid or has expired.",
  SESSION_EXPIRED: "Your session expired. Sign in again.",
  FORBIDDEN: "You do not have permission to do that.",
  FORBIDDEN_ADMIN: "Only administrators can do that.",
  NOT_FOUND: "We could not find that. It may have been removed.",
  VALIDATION_FAILED: "Some fields need attention.",
  INVALID_CREDENTIALS: "That email, username or password is not right.",
  INVALID_TOTP: "That code did not work. Check your authenticator app and try again.",
  ACCOUNT_BANNED: "This account has been banned.",
  ACCOUNT_DEACTIVATED: "This account has been deactivated.",
  ACCOUNT_RESTRICTED: "Your account is restricted: you can read your chats but not send.",
  EMAIL_NOT_VERIFIED: "Confirm your email address first. Check your inbox for the link.",
  EMAIL_TAKEN: "An account with that email already exists.",
  USERNAME_TAKEN: "That username is taken. Try another.",
  WEAK_PASSWORD: "Choose a stronger password: at least 10 characters, not a common one.",
  REGISTRATION_CLOSED: "Sign-ups are closed right now.",
  REGISTRATION_DOMAIN_NOT_ALLOWED: "Sign-up is open to approved email domains only. Use your work address.",
  USERNAME_RESERVED: "That username is reserved. Try another.",
  LAST_ADMIN: "You are the last administrator. Make someone else an admin first.",
  SELF_ACTION: "You cannot do that to your own account.",
  TARGET_PROTECTED: "Administrators cannot be suspended or banned. Remove their admin role first.",
  PAYLOAD_TOO_LARGE: "That is too large.",
  ACCOUNT_RESTRICTED_INTERVIEW: "Your account is restricted: you can read your interviews but not start new ones.",
  FILE_REQUIRED: "Choose a resume to upload.",
  FILE_TOO_LARGE: "That resume is larger than this server accepts.",
  FILE_TYPE: "Upload a PDF or a Word (.docx) file.",
  FILE_UNREADABLE: "This file could not be read. Try exporting it again as PDF.",
  RESUME_TOO_SHORT: "This resume has too little text to read (a scanned image?). Upload a text PDF or a .docx.",
  FEATURE_DISABLED: "This is turned off on this server.",
  NO_TEXT_MODEL: "No model is set up to plan interviews yet. Ask an administrator to add one.",
  NO_REALTIME_MODEL: "No voice model is set up yet. Ask an administrator to add one.",
  MODEL_UNAVAILABLE: "That voice model is not available.",
  QUOTA_EXCEEDED: "You have used this month's allowance. It resets on the 1st (UTC).",
  INTERVIEW_STARTED: "The plan is fixed once the interview starts.",
  INTERVIEW_COMPLETED: "This interview is finished.",
  INTERVIEW_NOT_IN_PROGRESS: "Start the interview first.",
  PLAN_NOT_READY: "The questions are still being prepared.",
  PLAN_INVALID: "The plan needs at least one round with one question.",
  REPLAN_UNAVAILABLE: "Resumes are not kept, so this plan cannot be regenerated. Upload the resume again.",
  QUESTION_NOT_FOUND: "That question no longer exists.",
  ANSWER_EMPTY: "Write some code first, or skip the question.",
  REALTIME_UNAVAILABLE: "The voice service could not start a session. Try again in a moment.",
  REALTIME_SESSION_INVALID: "The voice session expired. Start the question again.",
  PROCTORING_OFF: "Proctoring is off for this interview.",
  SHARE_LIMIT: "This interview has too many active links. Revoke one first.",
  SHARE_NOT_FOUND: "This link does not exist or was removed.",
};

export function errorCopy(code: string | undefined, fallback?: string): string {
  if (code && COPY[code]) return COPY[code];
  return fallback || "Something went wrong. Try again.";
}

/** The best human message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    // Validation messages from the server are already field-specific and readable.
    if (e.code === "VALIDATION_FAILED") {
      const first = Object.values(e.fieldErrors)[0];
      return first ? `${COPY.VALIDATION_FAILED} ${capitalise(first)}.` : COPY.VALIDATION_FAILED!;
    }
    return errorCopy(e.code, e.message);
  }
  if (e instanceof Error && e.name === "AbortError") return "Cancelled.";
  return errorCopy(undefined);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\.$/, "");

/** Errors not worth a toast: the page already shows them in place. */
export function isQuietError(e: unknown): boolean {
  if (isApiError(e)) return e.status === 404 || e.status === 401 || e.code === "VALIDATION_FAILED";
  return e instanceof Error && e.name === "AbortError";
}
