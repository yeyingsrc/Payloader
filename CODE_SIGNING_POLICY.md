# Payloader Code Signing Policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

This policy applies to the official Windows releases published from the public [3516634930/Payloader](https://github.com/3516634930/Payloader) repository. Until SignPath onboarding and repository secrets are complete, the release workflow rejects Windows artifacts that do not have a valid Authenticode signature.

## Project Roles

- Authors and committers: [3516634930](https://github.com/3516634930). This role maintains the source code and release workflows.
- Reviewers: [3516634930](https://github.com/3516634930). Contributions from people without commit access must be reviewed before merge.
- Approvers: [3516634930](https://github.com/3516634930). Every SignPath signing request requires manual approval before a signed artifact can be published.

All people assigned to these roles must enable multi-factor authentication for both GitHub and SignPath before the first signing request. Credentials and SignPath API tokens must be stored only as encrypted repository secrets and must never be committed to source control or included in build artifacts.

## Build and Signing Scope

- Signed artifacts must be reproducible products of the public repository and a GitHub-hosted Actions runner.
- The source commit, workflow run, application version, artifact name, SHA-256 digest, signer identity, and signing request must remain auditable.
- Product metadata must use the product name `Payloader` and the version from `package.json`.
- Only project-owned Windows installers and project-owned executable files may be signed with this project policy. Upstream binaries retain their upstream signatures and must not be presented as Payloader-authored binaries.
- Tag builds and manual release builds use the same checked-in workflow. No local, self-hosted, or untracked binary may be substituted into a signing request.
- A release cannot be published unless the Windows installers and the executable files in every Windows client shell pass `Get-AuthenticodeSignature` with status `Valid`.

## Approval and Publication

1. GitHub Actions builds the unsigned or provider-ready artifacts from the selected public commit.
2. The workflow submits the GitHub-hosted artifact to SignPath using repository-scoped credentials.
3. An Approver performs manual approval in SignPath after checking the commit, workflow, version, and artifact scope.
4. The workflow downloads the signed artifact and verifies Authenticode signatures and SHA-256 checksums.
5. Only the verified signed outputs are uploaded to the corresponding GitHub Release.

Changing signing providers, artifact configuration, signing policy, build runners, or release permissions requires a reviewed repository change before the next signing request.

## Verification

Users can verify an official Windows installer in PowerShell:

```powershell
$file = 'Payloader-Client-Setup-2.0.0-x64.exe'
Get-AuthenticodeSignature -LiteralPath $file | Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate
Get-FileHash -LiteralPath $file -Algorithm SHA256
```

The signature status must be `Valid`. Release checksums must match the downloaded file. A valid signature proves artifact integrity and publisher identity; Microsoft SmartScreen reputation is a separate signal and can still vary for a new file hash or signing certificate.

## Incident Response

If a signing credential, workflow, maintainer account, or published artifact is suspected to be compromised:

1. Stop release publication and disable the affected workflow or credential.
2. Revoke active SignPath credentials and signing approvals.
3. Preserve the workflow run, commit, hashes, and audit evidence.
4. Remove or mark affected Release assets and publish corrected hashes.
5. Notify SignPath Foundation and repository users through a GitHub security advisory or issue.

See the [Privacy policy](PRIVACY.md) for runtime data and network behavior.
