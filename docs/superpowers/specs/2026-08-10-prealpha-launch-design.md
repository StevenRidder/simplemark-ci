# SimpleMark pre-alpha public launch

**Date:** 2026-08-10  
**Status:** Approved design  
**Decision:** Option A — launch as soon as a notarized macOS DMG exists (honest pre-alpha), do not wait for full 1.0 gates.  
**Approach:** Notarized pre-alpha sprint (3–7 days), then Show HN / Product Hunt week.

Related product authority: [PRODUCT.md](../../PRODUCT.md), [showcase/simplemark-1.0-launch-plan.md](../../showcase/simplemark-1.0-launch-plan.md), [RELEASE-TRUST.md](../../RELEASE-TRUST.md). This spec does **not** replace the 1.0 plan; it defines the earlier competitive public launch.

---

## 1. Problem

Monoleaf shipped a public site and Windows installers and collected ~49 stars in days. SimpleMark already has a stronger category story and a public mirror ([StevenRidder/simplemark-public](https://github.com/StevenRidder/simplemark-public), 5 stars), but strangers cannot install without a toolchain, the repo name reads like a dump, and there has been no coordinated launch. Stars follow download + attention, not private excellence.

## 2. Goal (14-day window after DMG is live)

Own the public category:

> **The calm place to read what agents write.** Always rendered. Always your file.

### Success bar

| Tier | Target | Meaning |
| --- | --- | --- |
| Floor | ≥50 GitHub stars on the public product repo | Soft landing; still a real launch |
| Hit | ≥200 stars | Show HN / channel post worked |
| Stretch | ≥500 stars in 30 days | Repeat posts + word of mouth |
| Out of scope | 10k stars | Multi-hit / year-plus outcome — not this sprint |

Secondary: working Download on the product site, at least one notarized macOS DMG on GitHub Releases, and inbound traffic well above the current ~21 unique repo views / 2 weeks.

## 3. Competitive posture

- **Do not** name Monoleaf, accuse copying, or run “we were first” threads in public.
- Launch as category inventor: agent-output document reader, not “another Markdown editor.”
- Differentiation line for humans and posts:

  | Lane | Job |
  | --- | --- |
  | Typora / Monoleaf-class | Help you **write** Markdown like a document |
  | SimpleMark | Help you **judge** agent Markdown as a living local document |

- Private provenance (repo timestamps, public mirror history) is kept for the founder; the launch itself stays product-forward.
- Do not compete on CriticMarkup, Windows word-processor features, or feature parity. Compete on installable macOS + Tanoa demo + agent-reader wedge.

## 4. Public face

1. **Star magnet repo** — Prefer a product-named public surface (org `simplemark` or rename away from `*-public`). `StevenRidder/simplemark-public` may remain a mirror, but launch links, Releases, and star asks point at the product-named repo.
2. **Homepage** — Existing `website/` becomes the download home; `#download` links to the published GitHub Release asset (not “coming soon”).
3. **GitHub metadata** — Description rewritten to the agent-reader wedge; topics set (`markdown`, `tauri`, `mermaid`, `desktop`, `local-first`, etc.); homepage URL set.
4. **README CTA** — **Download for macOS** above clone / `npm run dev`. Hero remains the Project Tanoa GIF.

## 5. Ship checklist (blocker order)

| # | Work | Exit evidence | Owner |
| --- | --- | --- | --- |
| 1 | Signed + notarized macOS DMG | RELEASE-TRUST-style receipt; arm64 minimum; Intel if cheap in the same sprint | Release |
| 2 | GitHub Release `v0.x.0-prealpha` on the public product repo | Published release (not draft-only forever) with installer + SHA-256 | Release |
| 3 | Website download section live | Production URL opens DMG / Release page; honesty note still says pre-alpha | Founder |
| 4 | Pre-alpha honesty | Known-issues blurb: fidelity, file watch, what’s not promised | Founder |
| 5 | Seed stars | 15–25 people who actually tried the DMG star the product repo before the big post | Founder |
| 6 | Launch week | Show HN (Tanoa GIF) → same-day Product Hunt + niche Reddit + X/LinkedIn | Founder |

Unsigned or ad-hoc DMGs may exist as private test artifacts only. They are **not** the public download (see RELEASE-TRUST).

## 6. Copy spine

- **Show HN title shape:** `Show HN: SimpleMark – read AI-written Markdown as a living local document`
- **One sentence:** Always rendered. Always your file.
- **Demo:** 22s Project Tanoa Storm Atlas GIF — not a feature matrix.
- **Status label everywhere:** Pre-alpha. macOS first. No account.

## 7. Explicit non-goals (this launch)

- Windows / Linux installers
- Auto-updater
- Calling the build 1.0
- Collaboration, chat, agent cockpit chrome
- Public “copied us” narrative
- Waiting for every gate in the 1.0 launch plan

1.0 work continues in parallel on its own evidence track; this sprint only borrows the notarized-DMG requirement from RELEASE-TRUST.

## 8. Launch week sequence

```text
Day −2..0  Notarized DMG + Release + site download + README CTA
Day −1     Seed testers install and star
Day 0      Show HN (morning US) + X/LinkedIn with GIF
Day 0–1    Product Hunt + r/LocalLLaMA, r/ClaudeAI, r/Markdown (demo-first)
Day 2–7    Reply hard; ship one obvious fix from feedback; one follow-up demo post
Day 14     Scorecard vs success bar; decide next spike (Intel DMG, Windows, or product)
```

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Notarization blocked / secrets missing | This is the critical path; no public “download” until stapled DMG exists |
| Gatekeeper / clean-machine failure | Run verify-release-trust before publishing |
| HN compares to Typora | Lead comments with agent-reader vs writer-editor distinction |
| Pre-alpha bugs in flagship path | Dogfood Tanoa + open/save/watch on a clean Mac before Day 0 |
| Star repo split across mirrors | One canonical product repo for Releases and star asks |

## 10. Relationship to existing docs

- Does not weaken PRODUCT.md boundaries.
- Does not mark APP-6 / 1.0 distribution complete beyond the single notarized macOS pre-alpha artifact.
- Updates implied by this spec (website download copy, README CTA, public repo metadata) are implementation follow-through after the plan is written.
