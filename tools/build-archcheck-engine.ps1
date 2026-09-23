param(
  [string]$ArchCheckSource = $env:ARCHCHECK_SOURCE,
  [string]$Python = $env:ARCHX_ENGINE_PYTHON
)

$ErrorActionPreference = "Stop"
$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

if (-not $ArchCheckSource) {
  # 引擎源码在同一个仓库里；不再回退到仓库外的副本，那会把别处的 profile 打进产物
  $candidates = @((Join-Path $repo "engine"))
  $ArchCheckSource = $candidates | Where-Object { Test-Path (Join-Path $_ "src\archcheck\__main__.py") } | Select-Object -First 1
}
if (-not $ArchCheckSource -or -not (Test-Path (Join-Path $ArchCheckSource "src\archcheck\__main__.py"))) {
  throw "ArchCheck source not found. Set ARCHCHECK_SOURCE to a directory containing src\archcheck\__main__.py."
}
$ArchCheckSource = [System.IO.Path]::GetFullPath($ArchCheckSource)

if (-not $IsWindows -and $env:OS -ne "Windows_NT") {
  throw "This script currently builds the win32-x64 engine only."
}
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
  throw "Only an x64 host can build the win32-x64 ArchCheck engine."
}

if (-not $Python) {
  $Python = (Get-Command python -ErrorAction Stop).Source
}
$venv = Join-Path $repo "work\archcheck-engine-venv"
$venvPython = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  & $Python -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the ArchCheck packaging environment." }
}
& $venvPython -m pip install --disable-pip-version-check --quiet "pyinstaller>=6,<7" "PyYAML>=6,<7"
if ($LASTEXITCODE -ne 0) { throw "Failed to install ArchCheck packaging dependencies." }

$work = Join-Path $repo "work\archcheck-engine-build"
$dist = Join-Path $repo "work\archcheck-engine-dist"
$target = Join-Path $repo "extension\engines\win32-x64"
$entry = Join-Path $ArchCheckSource "src\archcheck\__main__.py"
$templates = Join-Path $ArchCheckSource "src\archcheck\templates"
# Rules are data: without the profile yaml files inside the exe the engine recognises no RTOS at all
# (scheduling stays unknown, xTaskCreate never becomes a task). The 09-09 build shipped without them;
# every "scheduling model unknown" seen in the extension came from that. archcheck-engine-smoke.mjs guards it.
# (ASCII comment on purpose: Windows PowerShell 5.1 reads a BOM-less file as ANSI, and a multi-byte
# character at the end of a comment line can swallow the newline and the statement below it.)
$profiles = Join-Path $ArchCheckSource "src\archcheck\profiles"
New-Item -ItemType Directory -Force -Path $work, $dist, $target | Out-Null
if (-not (Test-Path $profiles)) { throw "ArchCheck profiles not found at $profiles" }
Write-Host "bundling templates=$templates profiles=$profiles"

& $venvPython -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name archcheck `
  --distpath $dist `
  --workpath $work `
  --specpath (Join-Path $repo "work") `
  --paths (Join-Path $ArchCheckSource "src") `
  --add-data "${templates};archcheck\templates" `
  --add-data "${profiles};archcheck\profiles" `
  $entry
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed to build ArchCheck." }

$executable = Join-Path $target "archcheck.exe"
Copy-Item -Force (Join-Path $dist "archcheck.exe") $executable

$licenses = Join-Path $target "licenses"
New-Item -ItemType Directory -Force -Path $licenses | Out-Null
$pythonRoot = Split-Path (Split-Path $Python -Parent) -Parent
$pythonLicense = @(
  (Join-Path (Split-Path $Python -Parent) "LICENSE.txt"),
  (Join-Path $pythonRoot "LICENSE.txt")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $pythonLicense) { throw "Python LICENSE.txt was not found; the embedded runtime cannot be published." }
Copy-Item -Force $pythonLicense (Join-Path $licenses "PYTHON_LICENSE.txt")

$sitePackages = Join-Path $venv "Lib\site-packages"
$yamlLicense = Get-ChildItem $sitePackages -Recurse -File -Filter LICENSE | Where-Object { $_.FullName -match "pyyaml-.*dist-info" } | Select-Object -First 1
$pyInstallerLicense = Get-ChildItem $sitePackages -Recurse -File -Filter "COPYING.txt" | Where-Object { $_.FullName -match "pyinstaller-.*dist-info" } | Select-Object -First 1
if (-not $yamlLicense -or -not $pyInstallerLicense) { throw "PyYAML or PyInstaller license was not found; the embedded runtime cannot be published." }
Copy-Item -Force $yamlLicense.FullName (Join-Path $licenses "PYYAML_LICENSE.txt")
Copy-Item -Force $pyInstallerLicense.FullName (Join-Path $licenses "PYINSTALLER_LICENSE.txt")

$projectFile = Get-Content -Raw (Join-Path $ArchCheckSource "pyproject.toml")
$engineVersion = [regex]::Match($projectFile, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
$sourceRevision = (& git -C $ArchCheckSource rev-parse --short HEAD 2>$null).Trim()
$sourceDirty = [bool]((& git -C $ArchCheckSource status --porcelain 2>$null) -join "")
$pythonVersion = (& $venvPython -c "import platform; print(platform.python_version())").Trim()
$pyInstallerVersion = (& $venvPython -m PyInstaller --version).Trim()
$stream = [System.IO.File]::OpenRead($executable)
try {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $hash = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
} finally {
  $stream.Dispose()
}
$manifest = [ordered]@{
  schemaVersion = 1
  engine = "archcheck"
  engineVersion = $engineVersion
  platform = "win32"
  arch = "x64"
  runtime = "embedded-python"
  pythonVersion = $pythonVersion
  pyInstallerVersion = $pyInstallerVersion
  sourceRevision = $sourceRevision
  sourceDirty = $sourceDirty
  executable = "archcheck.exe"
  sha256 = $hash
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Join-Path $target "engine-manifest.json"), "$manifestJson`n", [System.Text.UTF8Encoding]::new($false))

Write-Output "ArchCheck standalone created: $executable"
Write-Output "SHA-256: $hash"
