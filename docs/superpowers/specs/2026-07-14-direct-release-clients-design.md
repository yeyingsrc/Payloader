# Direct Release Clients Design

## Goal

GitHub Release must provide native client packages that a user can download and run without first deploying the Payloader server or assembling an official shell.

## User-Facing Contract

- Windows releases provide NSIS `.exe` installers.
- Linux releases provide portable `.AppImage` files.
- macOS releases provide `.dmg` disk images.
- Native download names include the Payloader version and CPU architecture.
- Every native download has a matching SHA256 file.
- The release body identifies the recommended x64, ARM64, and macOS Universal downloads.

The native packages include the validated default public-data snapshot available at build time. They run offline and contain no administrator credentials, JWT secrets, server configuration, runtime database, private uploads, or build-host secrets.

## Build Architecture

Each target is packaged once with its real electron-builder target (`nsis`, `AppImage`, or `dmg`) instead of `--dir`.

That single packaging operation produces two outputs:

1. The native installer or disk image copied to the Release staging directory.
2. The unpacked application directory converted into the existing `.tar.gz` official-shell transport.

The official-shell manifest and archives remain unchanged so Linux deployments can continue downloading a shell and injecting deployment-specific public data in the admin backend.

## Release Layout

Primary user downloads:

- `Payloader-Client-Setup-2.0.0-x64.exe`
- `Payloader-Client-Setup-2.0.0-arm64.exe`
- `Payloader-Client-Setup-2.0.0-ia32.exe`
- `Payloader-Client-2.0.0-x64.AppImage`
- `Payloader-Client-2.0.0-arm64.AppImage`
- `Payloader-Client-2.0.0-armv7l.AppImage`
- `Payloader-Client-2.0.0-x64.dmg`
- `Payloader-Client-2.0.0-arm64.dmg`
- `Payloader-Client-2.0.0-universal.dmg`

Backend assets retain the existing lowercase `payloader-shell-*` archive names and manifests. The uppercase native package names sort before backend assets on the GitHub Release page.

## Version And Signing

- The packaged Electron application version must come from the root `package.json` (`2.0.0`), replacing the current internal `1.0.0` value.
- Unsigned packages remain runnable but may show Windows SmartScreen or macOS Gatekeeper warnings.
- Existing signing-secret integration remains the production path; no certificate or secret is embedded in source control.

## Validation

- Unit or contract tests verify native filename mapping, target extensions, and the absence of `--dir` in the official build path.
- The build fails if either the native package or unpacked shell directory is missing.
- SHA256 files are generated from the copied native packages.
- Existing native shell startup and performance smoke tests remain mandatory.
- GitHub Actions must build all native targets, merge all shell targets, publish the Release, and expose `.exe`, `.AppImage`, and `.dmg` assets.
- The full `npm run check` quality gate must pass.

## Failure And Rollback

No Release is published unless all platform build, shell smoke, merge, and native-package validation steps pass. Rollback restores the official build command to `--dir` and removes native packages from Release staging without changing the server-side shell contract.

## Non-Goals

- The client does not embed or connect to the administrator backend.
- This change does not add auto-update, auto-start, persistence, or server credentials.
- This change does not remove compatibility shell targets used by the backend.
