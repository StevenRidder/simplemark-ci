# FOUNDER ACTION: unblock notarized DMG (critical path)

Stars and Show HN wait on this. Local machine currently has only:

```text
Apple Development: Steven Ridder (CTQ54KM455)
```

That identity **cannot** ship a Gatekeeper-clean public DMG. You need **Developer ID Application**.

## Do this now (30–60 min if Apple account is ready)

1. Open [Apple Developer → Certificates](https://developer.apple.com/account/resources/certificates/list).
2. Create **Developer ID Application** (not Apple Development, not Mac App Distribution).
3. Install it in Keychain. Confirm:

```bash
security find-identity -v -p codesigning
# Expect a line: Developer ID Application: Steven Ridder (TEAMID)
```

4. Export the cert as `.p12` with a password.
5. Create GitHub Environment `release-signing` on `6th-Element-Labs/simplemark`.
6. Add environment secrets (names from `docs/RELEASE-TRUST.md`):

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | export password |
| `APPLE_SIGNING_IDENTITY` | exact `Developer ID Application: …` string |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | team id |

```bash
# base64 example (macOS):
base64 -i DeveloperID.p12 | pbcopy
```

7. Reply in chat: **“certs ready”**. Then the agent tags `v0.1.0` (versions already `0.1.0`), runs release + promote, flips the website Download button, mirrors, and you paste the Show HN body from `docs/launch/2026-08-10-prealpha-channel-kit.md`.

## Do not

- Publish an unsigned DMG as the public download
- Use ad-hoc signing for launch day
- Wait for Windows — macOS arm64 is enough for this sprint
