# Pre-alpha public launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a notarized macOS pre-alpha DMG on a product-named public repo, flip the website download, and run a Show HN launch week that drives stars.

**Architecture:** Private canonical repo (`6th-Element-Labs/simplemark`) builds/signs via the existing `release.yml` + `release-promote.yml` trust gate; public demand surfaces on the product GitHub repo + `website/`; launch copy lives in `docs/launch/` for paste-ready channels. No Windows/Linux, no 1.0 claims.

**Tech Stack:** Tauri 2 macOS DMG, GitHub Releases, Next.js website, `scripts/publish-public-mirror.sh`, `scripts/verify-release-trust.mjs`

## Global Constraints

- Honest **pre-alpha** labeling everywhere; never claim 1.0
- Public download only after **signed + notarized + stapled** macOS DMG (RELEASE-TRUST)
- Do **not** name Monoleaf or accuse copying in public posts
- Wedge line: judge agent Markdown as a living local document (not Typora/writer-editor)
- macOS first; arm64 required; Intel optional if cheap
- Canonical star/Release repo must not be named `*-public` if rename is available
- Superpowers launch docs may stay private; public mirror must keep working CTAs after `publish-public-mirror.sh`

---

### Task 1: Unblock Apple distribution signing

**Files:**
- Modify: GitHub Environment `release-signing` secrets on `6th-Element-Labs/simplemark` (ops, not committed)
- Reference: `docs/RELEASE-TRUST.md`, `.github/workflows/release.yml`, `.github/workflows/release-promote.yml`

**Interfaces:**
- Consumes: Apple Developer Program membership
- Produces: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (Developer ID Application), `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` in `release-signing`

- [ ] **Step 1: Confirm local identity is insufficient**

Run: `security find-identity -v -p codesigning`

Expected: only `Apple Development: …` is present today — that cannot notarize a public DMG. Need `Developer ID Application: …`.

- [ ] **Step 2: Create Developer ID Application certificate in Apple Developer portal**

Human: Certificates, Identifiers & Profiles → Developer ID Application → export `.p12` with a password.

- [ ] **Step 3: Create GitHub Environment `release-signing` and upload secrets**

```bash
# After human provides values (never commit secrets):
gh api -X PUT repos/6th-Element-Labs/simplemark/environments/release-signing
# Then set environment secrets via GitHub UI or gh secret set --env release-signing
```

Secrets (names from RELEASE-TRUST / RELEASE-CONTRACT):
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`

- [ ] **Step 4: Verify secrets are visible to the environment only**

Run: `gh api repos/6th-Element-Labs/simplemark/environments/release-signing`

Expected: environment exists; secrets not echoed in logs.

---

### Task 2: Cut notarized pre-alpha release

**Files:**
- Modify: `package.json` version, `src-tauri/tauri.conf.json` version, `src-tauri/Cargo.toml` version (must match tag)
- Use: `scripts/assert-release-version.mjs`, `.github/workflows/release.yml`, `.github/workflows/release-promote.yml`, `scripts/verify-release-trust.mjs`

**Interfaces:**
- Consumes: Task 1 secrets
- Produces: GitHub Release tag `v0.1.0-prealpha` (or next agreed), published after trust gate, with macOS arm64 DMG + SHA-256

- [ ] **Step 1: Align version strings for the pre-alpha tag**

Pick tag `v0.1.0-prealpha` only if `scripts/assert-release-version.mjs` accepts pre-release suffixes; otherwise use `v0.1.0` with README/release notes labeled pre-alpha. Read the assert script before choosing.

- [ ] **Step 2: Tag and push from private canonical repo**

```bash
git tag -a v0.1.0-prealpha -m "pre-alpha macOS launch"
git push origin v0.1.0-prealpha
```

Expected: `release.yml` builds draft Release with DMG assets.

- [ ] **Step 3: Run trust verification / promote**

Follow `release-promote.yml` + `scripts/verify-release-trust.mjs` so the draft becomes published only when notarized/stapled/smoke checks pass.

- [ ] **Step 4: Confirm public asset URL**

Run: `gh release view v0.1.0-prealpha -R <PRODUCT_REPO> --json url,assets`

Expected: downloadable `.dmg` URL recorded for website/README.

---

### Task 3: Product-named public GitHub surface

**Files:**
- Ops: rename or redirect `StevenRidder/simplemark-public` → product name
- Modify: `scripts/publish-public-mirror.sh` `PUBLIC_REPO` default if rename succeeds
- Modify: `README.md` (canonical + mirrored) download CTA

**Interfaces:**
- Consumes: Task 2 release URL (or Releases page)
- Produces: Canonical public repo URL used by website + launch posts

- [ ] **Step 1: Rename public mirror to product name**

```bash
gh repo rename simplemark -R StevenRidder/simplemark-public
```

If rename conflicts, create `StevenRidder/simplemark` and update mirror script `PUBLIC_REPO`.

- [ ] **Step 2: Set description, homepage, topics**

```bash
gh repo edit StevenRidder/simplemark \
  --description "SimpleMark — the calm place to read what your agents write. Always rendered. Always your file." \
  --homepage "https://<production-site>" \
  --add-topic markdown --add-topic tauri --add-topic mermaid --add-topic desktop --add-topic local-first --add-topic wysiwyg
```

- [ ] **Step 3: Add README Download CTA above Run it**

Insert (exact shape):

```markdown
## Download (pre-alpha, macOS)

**[Download SimpleMark for macOS](https://github.com/StevenRidder/simplemark/releases/latest)** — notarized DMG. No account.

Pre-alpha: expect sharp edges. Always rendered. Always your file.

## Run from source
```

- [ ] **Step 4: Publish mirror so public repo matches**

```bash
scripts/publish-public-mirror.sh HEAD
```

Expected: public README shows Download CTA; scan passes.

---

### Task 4: Website download flip

**Files:**
- Modify: `website/app/page.tsx`
- Modify: `website/README.md` (remove “coming soon only” once evidence exists)
- Test: `website/tests/rendered-html.test.mjs` (or equivalent)

**Interfaces:**
- Consumes: public Releases latest URL from Task 2/3
- Produces: `#download` primary button enabled

- [ ] **Step 1: Wire constants**

```tsx
const githubUrl = "https://github.com/StevenRidder/simplemark";
const downloadUrl = `${githubUrl}/releases/latest`;
```

- [ ] **Step 2: Replace disabled download button**

Primary button: `Download for macOS` → `downloadUrl`. Keep honesty note: pre-alpha; Windows/Linux later. Update “What is not ready” so it no longer claims signed download is missing once the DMG is live.

- [ ] **Step 3: Build website**

```bash
cd website && npm test && npm run build
```

Expected: pass.

- [ ] **Step 4: Deploy production site and set GitHub homepage**

Use the existing website host; then `gh repo edit … --homepage <url>`.

---

### Task 5: Launch kit + demand drive

**Files:**
- Create: `docs/launch/2026-08-10-prealpha-channel-kit.md` (private; may be mirror-hidden via superpowers or launch path — prefer `docs/launch/` and add to HIDDEN_PATH only if needed; kit can stay private)
- Create: `docs/launch/seed-testers.md` checklist

**Interfaces:**
- Consumes: product repo URL, DMG URL, Tanoa GIF path
- Produces: paste-ready Show HN, Product Hunt, Reddit, X/LinkedIn posts + seed outreach list template

- [ ] **Step 1: Write channel kit with final URLs**

Include Show HN title: `Show HN: SimpleMark – read AI-written Markdown as a living local document`  
Body: wedge, GIF link, download link, pre-alpha honesty, Typora-class differentiation one-liner (no competitor names required beyond Typora if useful).

- [ ] **Step 2: Seed-tester checklist**

15–25 names/slots; ask them to install DMG + star before Day 0.

- [ ] **Step 3: Schedule / post Day 0 assets**

Founder posts Show HN (morning US). Agent prepares exact text; founder (or agent with browser+login) submits. Same-day: PH, Reddit niches, X/LinkedIn with GIF.

- [ ] **Step 4: Day 2–7 reply protocol**

One obvious fix from feedback; one follow-up demo post; scoreboard at Day 14 vs spec (≥50 floor / ≥200 hit).

---

### Task 6: Commit launch docs on private canonical

**Files:**
- Create: `docs/superpowers/plans/2026-08-10-prealpha-launch.md` (this file)
- Keep: `docs/superpowers/specs/2026-08-10-prealpha-launch-design.md`

- [ ] **Step 1: Commit spec + plan + launch kit on private repo**

```bash
git add docs/superpowers/specs/2026-08-10-prealpha-launch-design.md \
  docs/superpowers/plans/2026-08-10-prealpha-launch.md \
  docs/launch/
git commit -m "$(cat <<'EOF'
docs: pre-alpha public launch spec, plan, and channel kit

EOF
)"
```

---
