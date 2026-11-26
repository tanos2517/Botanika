param(
  [string]$WebhookUrl = 'https://botanika-ai.vercel.app/api/telegram'
)

$ErrorActionPreference = 'Stop'

function Read-HiddenText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$token = Read-HiddenText 'BotFather token (hidden input)'
$secret = Read-HiddenText 'TELEGRAM_WEBHOOK_SECRET from Vercel (hidden input)'

if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'The Telegram bot token is required.'
}
if ($secret -notmatch '^[A-Za-z0-9_-]{1,256}$') {
  throw 'The webhook secret must use 1-256 letters, numbers, underscores, or hyphens.'
}
if ($WebhookUrl -notmatch '^https://[^/]+/api/telegram$') {
  throw 'WebhookUrl must be an HTTPS URL ending in /api/telegram.'
}

$payload = @{
  url = $WebhookUrl
  secret_token = $secret
} | ConvertTo-Json -Compress
$uri = 'https://api.telegram.org/bot{0}/setWebhook' -f $token

try {
  $result = Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $payload
}
catch {
  throw 'Could not register the webhook. Check the hidden bot token, secret, and deployed URL.'
}

if (-not $result.ok) {
  throw 'Telegram rejected the webhook registration. Check the bot token and deployed URL.'
}

Write-Host "Webhook registered for $WebhookUrl"
