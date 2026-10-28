# Application secrets in Secrets Manager. ECS injects them into the API and worker
# containers as environment variables; the values never appear in a task definition
# or a log.
#
#   <prefix>/app            JWT_SECRET, REFRESH_SECRET: generated here, 64 characters
#                           each. Distinct on purpose (the API refuses to boot if they
#                           are equal), so access tokens and refresh tokens can be
#                           rotated independently.
#   <prefix>/totp           TOTP_ENCRYPTION_KEY: 32 random bytes, base64. Encrypts the
#                           TOTP secrets at rest. Rotating it invalidates every enrolled
#                           authenticator, so it is not rotated with the signing keys.
#   <prefix>/provider-keys  PROVIDER_KEYS: the model provider API keys as one JSON
#                           object keyed by provider slug, e.g.
#                           {"openai":"sk-...","gemini":"...","anthropic":"sk-ant-..."}.
#                           Always created: the whole secret string is injected as
#                           PROVIDER_KEYS. Without var.provider_keys every listed slug
#                           holds "set-me", which the API treats as not configured.
#
# Every third-party value can be passed as a sensitive variable (it then lands in
# Terraform state), or left null and replaced by hand afterwards
# (aws secretsmanager put-secret-value with the full JSON object). Terraform never
# overwrites a value afterwards: secret_string is ignore_changes.
#
# REDIS_URL lives in the cache module's own secret, next to the auth token it embeds.
resource "random_password" "app" {
  for_each = toset(["JWT_SECRET", "REFRESH_SECRET"])
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV2_AWS_57:These are HMAC signing keys; rotation is an operator procedure (put a new version, roll the services), not a Lambda.
  name                    = "${var.name_prefix}/app"
  description             = "API signing secrets (access and refresh tokens)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({ for k, v in random_password.app : k => v.result })

  # Rotation happens out of band (put a new version by hand or by pipeline). Without
  # this, the next `terraform apply` would quietly roll every secret back.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "random_bytes" "totp" {
  length = 32
}

resource "aws_secretsmanager_secret" "totp" {
  #checkov:skip=CKV2_AWS_57:A data-encryption key for stored TOTP secrets; rotating it needs a re-encryption, not a Lambda.
  name                    = "${var.name_prefix}/totp"
  description             = "Key that encrypts stored TOTP secrets (TOTP_ENCRYPTION_KEY)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "totp" {
  secret_id     = aws_secretsmanager_secret.totp.id
  secret_string = jsonencode({ TOTP_ENCRYPTION_KEY = random_bytes.totp.base64 })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "provider_keys" {
  #checkov:skip=CKV2_AWS_57:Third-party model provider keys; they are rotated at each provider, then put here by hand.
  name                    = "${var.name_prefix}/provider-keys"
  description             = "Model provider API keys by provider slug, one JSON object (PROVIDER_KEYS)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "provider_keys" {
  secret_id = aws_secretsmanager_secret.provider_keys.id
  # The secret string IS the PROVIDER_KEYS value (injected whole, no JSON key).
  secret_string = var.provider_keys != null ? jsonencode(var.provider_keys) : jsonencode({ for slug in var.provider_slugs : slug => "set-me" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

locals {
  totp_ref = { name = "TOTP_ENCRYPTION_KEY", valueFrom = "${aws_secretsmanager_secret.totp.arn}:TOTP_ENCRYPTION_KEY::" }
  refs = concat(
    [for k in sort(keys(random_password.app)) : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }],
    [local.totp_ref],
    # The whole secret string, not one JSON key of it: PROVIDER_KEYS is itself JSON.
    [{ name = "PROVIDER_KEYS", valueFrom = aws_secretsmanager_secret.provider_keys.arn }],
  )
}
