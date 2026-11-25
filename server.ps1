param(
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$prefix = "http://127.0.0.1:$Port/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)

function Read-EnvFile {
  $envFile = Join-Path $root '.env'
  if (-not (Test-Path $envFile)) { return }
  foreach ($line in Get-Content $envFile) {
    $line = $line.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    $name, $value = $line -split '=', 2
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim().Trim('"').Trim("'"), 'Process')
  }
}

function Send-Json {
  param(
    [System.Net.HttpListenerContext]$Context,
    [int]$Status,
    [object]$Body
  )
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10 -Compress))
  $Context.Response.StatusCode = $Status
  $Context.Response.ContentType = 'application/json; charset=utf-8'
  $Context.Response.ContentLength64 = $bytes.Length
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Get-RequestJson {
  param([System.Net.HttpListenerRequest]$Request)
  $reader = [System.IO.StreamReader]::new($Request.InputStream, $Request.ContentEncoding)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Get-LanguageName {
  param([string]$Code)
  $languages = @{
    ru = 'Russian'; en = 'English'; uz = 'Uzbek'; az = 'Azerbaijani'; de = 'German'
    fr = 'French'; es = 'Spanish'; pt = 'Portuguese'; ar = 'Arabic'; tr = 'Turkish'
    uk = 'Ukrainian'; kk = 'Kazakh'; ky = 'Kyrgyz'; tg = 'Tajik'; fa = 'Persian'
    hi = 'Hindi'; bn = 'Bengali'; zh = 'Chinese'; ja = 'Japanese'; ko = 'Korean'
    it = 'Italian'; nl = 'Dutch'; pl = 'Polish'; cs = 'Czech'; sk = 'Slovak'
    sv = 'Swedish'; no = 'Norwegian'; da = 'Danish'; fi = 'Finnish'; el = 'Greek'
    he = 'Hebrew'; id = 'Indonesian'; ms = 'Malay'; th = 'Thai'; vi = 'Vietnamese'; ro = 'Romanian'
  }
  if ($languages.ContainsKey($Code)) { return $languages[$Code] }
  return 'Russian'
}

function Invoke-OpenRouter {
  param(
    [string]$Key,
    [object[]]$Messages,
    [int]$MaxTokens
  )
  $model = [Environment]::GetEnvironmentVariable('OPENROUTER_MODEL', 'Process')
  if (-not $model) { $model = 'nvidia/nemotron-3.5-super-vl:free' }
  $body = @{
    model = $model
    messages = $Messages
    max_tokens = [Math]::Max(100, [Math]::Min(3000, $MaxTokens))
  } | ConvertTo-Json -Depth 30
  $result = Invoke-RestMethod `
    -Method Post `
    -Uri 'https://openrouter.ai/api/v1/chat/completions' `
    -Headers @{ Authorization = "Bearer $Key"; 'HTTP-Referer' = "http://localhost:$Port/"; 'X-Title' = 'Botanika AI Pro' } `
    -ContentType 'application/json' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
    -TimeoutSec 60
  if (-not $result.choices -or -not $result.choices[0].message.content) {
    throw 'The AI provider returned an empty response'
  }
  return [string]$result.choices[0].message.content
}

function Get-PlantImages {
  param([string]$Query)
  try {
    $search = [Uri]::EscapeDataString("$Query plant")
    $uri = "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=$search&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url&iiurlwidth=700&format=json"
    $result = Invoke-RestMethod -Method Get -Uri $uri -Headers @{ 'User-Agent' = 'BotanikaAI/1.0 (plant encyclopedia)' } -TimeoutSec 15
    $images = @()
    if ($result.query.pages) {
      foreach ($page in $result.query.pages.PSObject.Properties.Value) {
        if ($page.imageinfo -and $page.imageinfo[0].thumburl) {
          $images += @{
            title = [string]$page.title
            url = [string]$page.imageinfo[0].thumburl
            page_url = [string]$page.imageinfo[0].descriptionurl
          }
        }
      }
    }
    return $images
  } catch {
    return
  }
}

function Get-WikipediaArticle {
  param(
    [string]$Query,
    [string]$Language
  )
  try {
    $search = [Uri]::EscapeDataString($Query)
    $uri = "https://$Language.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=$search&gsrlimit=1&prop=extracts%7Cinfo%7Cpageimages&exintro=1&explaintext=1&inprop=url&pithumbsize=700&format=json"
    $result = Invoke-RestMethod -Method Get -Uri $uri -Headers @{ 'User-Agent' = 'BotanikaAI/1.0 (plant encyclopedia)' } -TimeoutSec 15
    if (-not $result.query.pages) { return $null }
    $page = $result.query.pages.PSObject.Properties.Value | Select-Object -First 1
    if (-not $page) { return $null }
    return @{
      title = [string]$page.title
      url = [string]$page.fullurl
      extract = [string]$page.extract
      image = [string]$page.thumbnail.source
    }
  } catch {
    return $null
  }
}

Read-EnvFile
$listener.Start()
Write-Host "Botanika AI: http://localhost:$Port/"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    if ($request.HttpMethod -eq 'POST' -and $request.Url.AbsolutePath -in @('/api/chat', '/api/encyclopedia')) {
      $key = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'Process')
      if (-not $key) {
        Send-Json $context 503 @{ error = 'OPENROUTER_API_KEY is missing from .env or server environment variables' }
        continue
      }

      try {
        $payload = Get-RequestJson $request | ConvertFrom-Json
        if ($request.Url.AbsolutePath -eq '/api/chat') {
          if (-not $payload.messages -or $payload.messages.Count -gt 20) {
            Send-Json $context 400 @{ error = 'Request must contain 1 to 20 messages' }
            continue
          }
          $raw = $payload | ConvertTo-Json -Depth 30 -Compress
          if ([System.Text.Encoding]::UTF8.GetByteCount($raw) -gt 3500000) {
            Send-Json $context 413 @{ error = 'Request is too large. Reduce the number or size of photos.' }
            continue
          }
          $text = Invoke-OpenRouter $key @($payload.messages) ([int]$payload.max_tokens)
          Send-Json $context 200 @{ text = $text }
          continue
        }

        $query = ([string]$payload.query).Trim()
        if (-not $query -or $query.Length -gt 120) {
          Send-Json $context 400 @{ error = 'Enter a plant name or query of up to 120 characters.' }
          continue
        }
        $language = Get-LanguageName ([string]$payload.lang)
        $system = @"
You are a careful plant encyclopedia. Answer in $language. Return only a valid JSON object with exactly these fields:
{"title":"","scientific_name":"","summary":"","care":{"watering":"","light":"","soil":"","temperature":""},"uses":"","toxicity":"","interesting_facts":[""],"disclaimer":""}
Give practical general care, distinguish traditional uses from proven medical benefits, never claim a plant cures disease, and state uncertainty when identification is ambiguous. Warn about human or pet toxicity when known. Keep summary useful and concise.
"@
        $messages = @(
          @{ role = 'system'; content = $system },
          @{ role = 'user'; content = "Plant search: $query" }
        )
        $answer = Invoke-OpenRouter $key $messages 1200
        $answer = $answer.Trim() -replace '^```(?:json)?\s*', '' -replace '\s*```$', ''
        $first = $answer.IndexOf('{')
        $last = $answer.LastIndexOf('}')
        if ($first -lt 0 -or $last -le $first) { throw 'The AI response was not valid JSON' }
        $record = $answer.Substring($first, $last - $first + 1) | ConvertFrom-Json
        $search = [Uri]::EscapeDataString($query)
        $wikiLang = [string]$payload.lang
        if ($wikiLang -notmatch '^(ru|en|uz|az|de|fr|es|pt|ar|tr|uk|kk|ky|tg|fa|hi|bn|zh|ja|ko|it|nl|pl|cs|sk|sv|no|da|fi|el|he|id|ms|th|vi|ro)$') { $wikiLang = 'ru' }
        $reference = Get-WikipediaArticle $query $wikiLang
        $imageResults = @(Get-PlantImages $query)
        if ($reference -and $reference.image) {
          $imageResults = @(@{ title = $reference.title; url = $reference.image; page_url = $reference.url }) + $imageResults
        }
        $sources = @(
          @{ title = $(if ($reference) { $reference.title } else { 'Wikipedia search' }); url = $(if ($reference -and $reference.url) { $reference.url } else { "https://$wikiLang.wikipedia.org/w/index.php?search=$search" }) },
          @{ title = 'Wikimedia Commons'; url = "https://commons.wikimedia.org/w/index.php?search=$search" }
        )
        $record | Add-Member -NotePropertyName images -NotePropertyValue $imageResults -Force
        $record | Add-Member -NotePropertyName sources -NotePropertyValue $sources -Force
        $record | Add-Member -NotePropertyName reference -NotePropertyValue $reference -Force
        Send-Json $context 200 $record
      } catch {
        Send-Json $context 502 @{ error = 'The plant search service failed. Check the server API key, provider limits, and internet connection.' }
      }
      continue
    }

    if ($request.HttpMethod -ne 'GET' -and $request.HttpMethod -ne 'HEAD') {
      $response.StatusCode = 405
      $response.Close()
      continue
    }

    $relative = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
    if (-not $relative) { $relative = 'Botanika-AI (1).html' }
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
    $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
    if (-not $candidate.StartsWith("$rootFull\", [StringComparison]::OrdinalIgnoreCase)) {
      $response.StatusCode = 403
      $response.Close()
      continue
    }
    if (-not (Test-Path $candidate -PathType Leaf)) {
      $response.StatusCode = 404
      $response.Close()
      continue
    }

    $extension = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
    $mime = switch ($extension) {
      '.html' { 'text/html; charset=utf-8' }
      '.js' { 'application/javascript; charset=utf-8' }
      '.css' { 'text/css; charset=utf-8' }
      '.json' { 'application/json; charset=utf-8' }
      '.webmanifest' { 'application/manifest+json; charset=utf-8' }
      '.png' { 'image/png' }
      '.jpg' { 'image/jpeg' }
      '.jpeg' { 'image/jpeg' }
      '.gif' { 'image/gif' }
      '.svg' { 'image/svg+xml' }
      default { 'application/octet-stream' }
    }
    $bytes = [System.IO.File]::ReadAllBytes($candidate)
    $response.StatusCode = 200
    $response.ContentType = $mime
    $response.ContentLength64 = $bytes.Length
    if ($request.HttpMethod -eq 'GET') { $response.OutputStream.Write($bytes, 0, $bytes.Length) }
    $response.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
