variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
}

variable "kms_key_arn" {
  description = "CMK that encrypts the secrets. Null uses the AWS-managed key."
  type        = string
  default     = null
}

variable "recovery_window_in_days" {
  description = "Days a deleted secret stays recoverable. 0 deletes immediately (local and throwaway environments)."
  type        = number
  default     = 30
}

# ─── Model providers ─────────────────────────────────────────────────────────

variable "provider_keys" {
  description = "Initial PROVIDER_KEYS: model provider API keys by slug, e.g. { openai = \"sk-...\", gemini = \"...\" }. Null writes \"set-me\" for every provider_slugs entry, to replace by hand, which keeps the keys out of Terraform state."
  type        = map(string)
  default     = null
  sensitive   = true
}

variable "provider_slugs" {
  description = "Slugs written as \"set-me\" placeholders when provider_keys is null, so the JSON shape to fill in is visible in the console."
  type        = list(string)
  default     = ["openai", "anthropic", "gemini", "openrouter", "groq"]
}
