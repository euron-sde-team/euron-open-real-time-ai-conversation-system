output "secret_arn" {
  description = "ARN of the JSON secret holding JWT_SECRET and REFRESH_SECRET."
  value       = aws_secretsmanager_secret.app.arn
}

output "secret_refs" {
  description = "ECS container `secrets` entries (signing keys, TOTP key, PROVIDER_KEYS): [{ name, valueFrom }]."
  value       = local.refs
}

output "totp_secret_arn" {
  description = "ARN of the TOTP_ENCRYPTION_KEY secret."
  value       = aws_secretsmanager_secret.totp.arn
}

output "totp_secret_ref" {
  description = "ECS container `secrets` entry for TOTP_ENCRYPTION_KEY alone (one-off tasks that need it without the signing keys)."
  value       = local.totp_ref
}

output "provider_keys_secret_arn" {
  description = "ARN of the <prefix>/provider-keys secret (PROVIDER_KEYS)."
  value       = aws_secretsmanager_secret.provider_keys.arn
}

output "provider_keys_secret_name" {
  description = "Name of the <prefix>/provider-keys secret."
  value       = aws_secretsmanager_secret.provider_keys.name
}
