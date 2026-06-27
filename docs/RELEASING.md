# Releasing mockist

## CI (every PR and push to `main`)

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

1. `npm ci`
2. `npm run typecheck`
3. `npm run build`
4. `npm test` (189+ tests; PR comment on failure via trajectory diff script)
5. `npm run test:smoke-pack` — packs the repo, installs the `.tgz` in a temp
   project, and verifies `dist/` exports resolve the way npm consumers see them

## CD (npm + GitHub Release)

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)

### One-time setup

1. Create an npm access token with **publish** scope for the `mockist` package
   (Automation token recommended for CI).
2. Add it as a GitHub repository secret: **`NPM_TOKEN`**.

### Publish a version

1. Bump `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, push, and tag:

   ```bash
   git tag v0.1.0
   git push origin main --tags
   ```

3. The release workflow runs on tag push `v*.*.*`:
   - Full test suite + tarball smoke test
   - `npm publish --provenance --access public`
   - GitHub Release with generated notes

### Manual release (re-run an existing tag)

Use **Actions → Release → Run workflow** and pass the tag (e.g. `v0.1.0`).
Useful if publish failed after tests passed.

### Local preflight

```bash
npm run typecheck
npm test
npm run test:smoke-pack
npm pack --dry-run
```

Do **not** publish locally unless you intend to consume a one-off tarball; prefer
the release workflow so provenance and GitHub Release stay in sync.
