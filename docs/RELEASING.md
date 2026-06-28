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

Publishing uses **[npm trusted publishing](https://docs.npmjs.com/trusted-publishers)**
(OIDC from GitHub Actions). No long-lived `NPM_TOKEN` secret is required.

### One-time setup: npm trusted publisher

Requirements:

- npm CLI **≥ 11.5.1** (release workflow runs `npm install -g npm@latest` before publish)
- Node **≥ 22.14.0** (CI uses Node 22 on GitHub-hosted runners)
- **GitHub-hosted runners only** (self-hosted runners are not supported)
- Public GitHub repo: `ydderd/mockist` (must match `repository.url` in `package.json`)

#### Step 1 — First publish (one time only)

`mockist` is not on npm yet. Trusted publisher settings live on the **package**
page, so you need the package to exist once:

```bash
npm login          # maintainer account with 2FA
npm run build
npm publish --access public
```

Or publish once from npmjs.com after linking the package to this repo.

#### Step 2 — Configure trusted publisher on npmjs.com

1. Log in to [npmjs.com](https://www.npmjs.com/) as the package owner (`ydderd` or your org).
2. Open **Packages → mockist → Settings → Trusted publishing**.
3. Click **GitHub Actions** and set:

   | Field | Value |
   |-------|-------|
   | **Repository** | `ydderd/mockist` |
   | **Workflow filename** | `release.yml` |
   | **Environment** | *(leave empty unless you add a GitHub Environment)* |

   Use the filename only (`release.yml`), not `.github/workflows/release.yml`.
   Fields are **case-sensitive** and must match exactly.

4. Save. npm does **not** validate until the first OIDC publish — double-check spelling.

#### Step 3 — Harden publishing access (recommended after OIDC works)

On the same package **Settings → Publishing access**:

1. Choose **Require two-factor authentication and disallow tokens**
2. Save

Trusted publishing keeps working; long-lived automation tokens are blocked.
Revoke any old publish tokens you no longer need.

Optional maximum lockdown: configure the trusted publisher to allow only
`npm stage publish`, then approve releases manually on npmjs.com.

### Publish a version

1. Bump `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Commit, push to `main`, and tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. The release workflow runs on tag push `v*.*.*`:
   - Full test suite + tarball smoke test
   - `npm publish --access public` via OIDC (provenance attestation added automatically)
   - GitHub Release with generated notes

### Manual release (re-run an existing tag)

Use **Actions → Release → Run workflow** and pass the tag (e.g. `v0.1.0`).

**Important:** npm validates the **workflow filename of the workflow that triggered
the run**. For manual dispatch, that is still `release.yml` — keep the trusted
publisher pointed at `release.yml`.

### Troubleshooting OIDC publish

| Error | Fix |
|-------|-----|
| `ENEEDAUTH` on publish | Workflow filename mismatch; repo not `ydderd/mockist`; missing `id-token: write`; self-hosted runner |
| Publish from fork fails | Fork’s `package.json` `repository.url` must match the fork, not upstream |
| `npm` too old | Release job upgrades npm globally; ensure that step runs |
| Provenance missing | Repo must be **public**; trusted publishing must be used (not `NPM_TOKEN`) |

### Local preflight

```bash
npm run typecheck
npm test
npm run test:smoke-pack
npm pack --dry-run
```

Prefer the release workflow for publishes so provenance and GitHub Release stay in sync.
Local `npm publish` still works for maintainers with `npm login` until you disallow tokens.
