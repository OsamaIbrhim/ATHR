# Bold POS release process

The release pipeline publishes two immutable assets to a GitHub Release:

- `Bold-POS-Setup-<version>.exe`
- `pos-update.json`

The backend reads the stable `releases/latest` manifest URL, validates it, caches the last valid response, and exposes the existing endpoint:

```text
GET /api/v1/pos-updates/latest
```

The installed POS continues to verify the installer SHA-256 before it can run the file.

## One-time setup

1. Merge and deploy the release-setup patch.
2. In GitHub, confirm **Settings → Actions → General → Workflow permissions** allows read and write access for `GITHUB_TOKEN`.
3. Run **Actions → POS Release → Run workflow** from `master` for the current version.
4. After the release succeeds, add this Railway variable once:

```text
POS_UPDATE_MANIFEST_URL=https://github.com/OsamaIbrhim/bold_system/releases/latest/download/pos-update.json
```

Recommended optional values:

```text
POS_UPDATE_ENABLED=true
POS_UPDATE_MANIFEST_CACHE_MS=300000
POS_UPDATE_MANIFEST_STALE_MS=86400000
POS_UPDATE_MANIFEST_TIMEOUT_MS=5000
```

After Railway redeploys, verify:

```bash
curl --fail --silent --show-error \
  "https://boldsystem-production.up.railway.app/api/v1/pos-updates/latest"
```

Remove the old per-release Railway variables after the remote manifest works:

```text
POS_UPDATE_VERSION
POS_UPDATE_URL
POS_UPDATE_SHA256
POS_UPDATE_NOTES
POS_UPDATE_MANDATORY
POS_UPDATE_PUBLISHED_AT
```

They remain supported only as an outage fallback.

## Publishing each future version

1. Bump both POS package files locally:

```bash
cd pos-electron
npm version patch --no-git-tag-version
cd ..
```

2. Commit, merge, and wait for `master` checks/deployment.
3. Open **Actions → POS Release**.
4. Select `master`, enter the exact package version and release notes, then run it.
5. Confirm the GitHub Release contains the EXE and `pos-update.json`.
6. Confirm the backend endpoint reports the new version.

No Railway variable changes are needed for later releases.

## Safety and rollback

- A release version and tag cannot be overwritten. Fixes require a higher version.
- The workflow verifies `package.json`, `package-lock.json`, installer filename, direct HTTPS URL, and SHA-256 before publishing.
- The backend rejects non-HTTPS, oversized, malformed, or invalid manifests.
- During a temporary GitHub outage, the backend serves the last valid manifest for the configured stale window.
- To stop offering updates immediately, set `POS_UPDATE_ENABLED=false` on Railway and redeploy.
- Installed clients never downgrade. A rollback must be shipped as a new higher POS version containing the reverted code.

## Optional Windows code signing

When a Windows signing certificate is available, add these GitHub Actions secrets:

```text
POS_WINDOWS_CSC_LINK
POS_WINDOWS_CSC_KEY_PASSWORD
```

Electron Builder uses them automatically. Without those secrets, the release remains checksum-verified but Windows may show an unsigned-publisher warning.
