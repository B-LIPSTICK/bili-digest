$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$out = Join-Path $dist "bili-digest-v$version.zip"
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

$items = @(
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "options.html",
  "options.css",
  "options.js",
  "lib",
  "prompts",
  "icons",
  "fonts",
  "README.md",
  "LICENSE",
  "PRIVACY.md",
  "SECURITY.md"
) | ForEach-Object { Join-Path $root $_ }

Compress-Archive -Path $items -DestinationPath $out -Force
Write-Host "Packaged: $out"
