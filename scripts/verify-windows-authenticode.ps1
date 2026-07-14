[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$ArtifactDirectory = 'artifacts/client-shells'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-ValidAuthenticodeSignature {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
  )

  $signature = Get-AuthenticodeSignature -LiteralPath $LiteralPath
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Authenticode verification failed for '$LiteralPath': $($signature.Status) $($signature.StatusMessage)"
  }
  if ($null -eq $signature.SignerCertificate) {
    throw "Authenticode verification returned no signer certificate for '$LiteralPath'."
  }

  Write-Host "Valid Authenticode signature: $LiteralPath"
  Write-Host "  Publisher: $($signature.SignerCertificate.Subject)"
  Write-Host "  Thumbprint: $($signature.SignerCertificate.Thumbprint)"
}

$artifactRoot = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$installers = @(Get-ChildItem -LiteralPath $artifactRoot -File -Filter 'Payloader-Client-Setup-*.exe')
if ($installers.Count -eq 0) {
  throw "No Windows client installers were found in '$artifactRoot'."
}

foreach ($installer in $installers) {
  Assert-ValidAuthenticodeSignature -LiteralPath $installer.FullName
}

$archives = @(Get-ChildItem -LiteralPath $artifactRoot -File -Filter 'payloader-shell-windows-*.tar.gz')
if ($archives.Count -eq 0) {
  throw "No Windows client shell archives were found in '$artifactRoot'."
}

$tarCommand = Get-Command 'tar.exe' -ErrorAction Stop
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "payloader-authenticode-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null

try {
  foreach ($archive in $archives) {
    $extractDirectory = Join-Path $temporaryRoot $archive.BaseName.Replace('.', '-')
    New-Item -ItemType Directory -Path $extractDirectory | Out-Null
    & $tarCommand.Source -xzf $archive.FullName -C $extractDirectory
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to extract '$($archive.FullName)' with exit code $LASTEXITCODE."
    }

    $executables = @(Get-ChildItem -LiteralPath $extractDirectory -Recurse -File -Filter '*.exe')
    if ($executables.Count -eq 0) {
      throw "No Windows executables were found in '$($archive.FullName)'."
    }
    foreach ($executable in $executables) {
      Assert-ValidAuthenticodeSignature -LiteralPath $executable.FullName
    }
  }
} finally {
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Verified $($installers.Count) installer(s) and $($archives.Count) Windows shell archive(s)."
