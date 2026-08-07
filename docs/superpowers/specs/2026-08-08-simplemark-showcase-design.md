# SimpleMark flagship showcase — design

**Two extraordinary Markdown documents, one cinematic proof: Project Tanoa shows what SimpleMark
can render under pressure; the SimpleMark 1.0 launch plan shows why that power is useful every day.**

- **Status:** Accepted design; implementation plans written
- **Date:** 2026-08-08
- **Task:** `APP-29`
- **Product authority:** [`PRODUCT.md`](../../PRODUCT.md)
- **Renderer authority:** current composition in [`browser.ts`](../../../src/app/browser.ts) and
  [`tauri.ts`](../../../src/app/tauri.ts), checked against [`RENDERERS.md`](../../RENDERERS.md)
- **Supersedes nothing.** The current demo remains intact until this showcase is implemented and
  verified from the running app.
- **Implementation:** [`Project Tanoa showcase`](../plans/2026-08-08-project-tanoa-showcase.md),
  then [`SimpleMark 1.0 launch document`](../plans/2026-08-08-simplemark-1-0-launch-plan.md)

---

## 1. Outcome

Create a public-quality showcase set with two portable Markdown documents:

1. **Project Tanoa** — a fictional 2032 field report owned by the Fulaga Community Energy
   Committee. It is the cinematic flagship and the subject of a 17-second animated GIF.
2. **SimpleMark 1.0 launch plan** — an aspirational but candid founder-and-launch-team brief. It is
   the practical proof that the same document experience serves ordinary AI product work.

The packaging is **flagship + proof**: only Project Tanoa receives motion initially. The launch
plan is equally polished, but remains a still document until evidence says a second film is useful.

The result must strengthen the current install reason from [`ADR-0005`](../../decisions/0005-rendered-document-before-agent-participation.md):
open an agent-written Markdown file, see a document worth keeping open, watch it change, and reveal
source only for the exact correction required. This is not a renderer catalogue, an agent cockpit,
or a custom webpage masquerading as a Markdown note.

---

## 2. Shared showcase language

Both documents use ordinary portable Markdown and the real SimpleMark renderer set. They receive
no document-specific CSS, private HTML shell, or fabricated product chrome. Their beauty must come
from the content and the product people actually receive.

The shared visual language is **Lagoon Editorial**:

- warm paper and deep-ocean ink;
- generous measure, hierarchy, and whitespace;
- lagoon teal for healthy systems and accepted evidence;
- restrained coral for warnings and unresolved risk;
- diagrams and data that sit quietly in the reading flow;
- operational detail available without turning the page into a dashboard.

The personalities diverge deliberately:

| Document | Personality | What it proves |
|---|---|---|
| Project Tanoa | Atmospheric, human, place-driven, unfolding under pressure | Technical AI output can become a beautiful living field report |
| SimpleMark 1.0 | Precise, candid, strategic, operational | The same canvas can carry serious product and launch work |

Every technical block has a portable fallback. Opening either file in a plain-text editor still
produces understandable Markdown; opening it in SimpleMark produces the exceptional version.

---

## 3. Capability truth

The showcase uses only capabilities wired into the current browser and Tauri compositions. At
design time those are:

| Content | Stored form | Showcase use |
|---|---|---|
| Markdown document | ordinary `.md` | prose, headings, lists, links, footnotes, checklists, tables, callouts |
| Mermaid | `mermaid` fence | community-readable microgrid flow |
| Sanitised SVG | raw `<svg>` | sourced Fulaga and storm-track map treatment |
| Graphviz/DOT | `dot` fence | controller fault-isolation graph |
| KaTeX | `$$…$$` | battery autonomy and reserve calculations |
| Vega-Lite | `vega-lite` fence | generation, load, and reserve forecast |
| Highlighted code | ordinary language fence | configuration and release examples |
| ANSI card | `ansi` fence | commissioning terminal evidence |
| JSON tree | `json` fence | controller configuration and contextual source correction |
| Other text cards | `diff`, `tree`, `stacktrace` fences | used only where the launch plan has real evidence for them |

[`RENDERERS.md`](../../RENDERERS.md) describes Markmap, but no Markmap renderer is present in the
current composition. It is excluded from both documents and every public claim. If it ships before
implementation, adding it requires a new current-code check and a natural document use; the design
does not assume that outcome.

The full document may contain more renderers than the film shows. The film uses only the blocks
needed to understand one decision at GitHub viewing size.

---

## 4. Project Tanoa

### 4.1 Premise

**Working title:**

> # Holding the island through the storm
> *Fulaga Community Energy Committee · Project Tanoa · Commissioning Watch*

Project Tanoa is a clearly labelled fictional design scenario set on Fulaga in the Lau Group in
2032. During the final 72-hour commissioning window, an approaching cyclone shifts west. The
community must enter island mode earlier than planned, but a new forecast shows that usable battery
autonomy falls 1.8 hours short of the community reserve requirement.

The decision is not “fix a diagram.” The committee must understand the shortfall, find its cause,
choose a load plan, correct one stale controller threshold, and prove the earlier transition before
field crews shelter.

The accepted decision is:

- keep the clinic, communications, and water circuits on the priority profile;
- defer the scenario's explicitly flexible loads;
- restore the community-approved battery reserve floor from `0.35` to `0.42`; and
- enter island mode only after the commissioning check passes.

The circuit names, loads, storm, telemetry, equipment, committee decisions, and outcomes are all
fictional. They do not describe present conditions or claim an actual Fulaga project.

### 4.2 Why “Tanoa”

`Tanoa` is the wooden bowl used to prepare and share yaqona. The name is used deliberately as a
metaphor for a shared vessel serving the whole community, not as decorative Pacific language. It
must be explained once in the document and validated by a Fijian-language or Fulaga community
reviewer before public publication.

Official Fiji material commonly uses **Fulaga**. Some references identify **Vulaga** as the local
name. The public artifact keeps `Fulaga` until a community reviewer provides a preferred form; it
does not make a linguistic claim from secondary research alone.

Research anchors for implementation:

- [Fiji Parliament report identifying Fulaga's three villages](https://www.parliament.gov.fj/wp-content/uploads/2020/09/Review-Report-on-the-Petition-for-Government-to-Provide-Reliable-Safe-and-Affordable-Shipping-Services-for-the-Lau-Group.pdf)
- [UNDP account of solar mini-grids, storage, meters, and remote monitoring in Fiji's maritime communities](https://www.undp.org/pacific/stories/illuminating-maritime-islands-fiji-fiji-rural-electrification-fund-fref-rollout)
- [Fiji Government use of “tanoa of yaqona” as a shared meeting symbol](https://www.fiji.gov.fj/Media-Centre/Speeches/English/PRIME-MINISTER-HON-VOREQE-BAINIMARAMA-S-SPEEC-%2821%29)

These sources ground the premise; they do not license invented claims about the community.

### 4.3 Document structure

The report reads chronologically. Each technical block answers a question the committee has at
that moment.

| Story beat | Question | Content and renderer |
|---|---|---|
| Opening | What changed, where, and how long do we have? | Sourced SVG geography/storm map, human summary, 14-minute field-isolation clock |
| T−72 baseline | What did the community agree to protect? | priority-circuit callout, checklist, system summary |
| T−48 topology | How should energy move in normal and storm modes? | Mermaid microgrid flow |
| T−24 forecast | Will generation and storage cover the critical window? | Vega-Lite forecast, GFM telemetry table |
| T−18 calculation | How large is the reserve gap? | KaTeX autonomy calculation with units and assumptions |
| Diagnosis | Why did the test miss the approved floor? | ANSI terminal capture and Graphviz fault-isolation graph |
| Decision | Which operating plan keeps the community floor? | three-option decision table with accepted and rejected reasoning |
| Correction | What exact value is stale? | rendered JSON tree; contextual source change from `0.35` to `0.42` |
| Transition | Did the decision work? | watched external update, completed checklist, stable final metrics, success callout |
| Appendix | Can an engineer audit the claim? | fictional data dictionary, configuration, calculation assumptions, source notes |

Long-form prose and the visual rhythm between these blocks matter as much as the renderers. The
reader must be able to follow the story without interpreting JSON or terminal output; the engineer
must be able to inspect the evidence without leaving the note.

### 4.4 Data consistency

One deterministic fixture owns every fictional number. The document, Vega-Lite values, KaTeX
calculation, terminal capture, JSON configuration, tables, and final status are derived from that
fixture or checked against it.

The scenario's load and storage model must prove these relationships:

- the initial `0.35` controller value is below the agreed `0.42` floor;
- the initial forecast produces `11.2 h` usable autonomy against `13.0 h` required;
- the accepted plan closes that `1.8 h` gap without dropping any priority circuit;
- the final reserve is above `42%` and the final frequency is stable at the displayed precision;
- the final watched update cannot contradict the chart, table, or terminal evidence shown earlier.

Numbers may change during implementation if the final model requires it, but all representations
must change together. Plausibility and internal consistency are requirements; apparent precision
without a coherent model is not.

### 4.5 Geography and imagery

The final map must use published, license-compatible geography with recorded attribution. No one
may hand-draw an outline and present it as Fulaga. If suitable source geometry cannot be licensed or
verified, the block becomes an explicitly labelled regional schematic rather than a false map.

No real person's name, photograph, quotation, committee membership, energy condition, or emergency
experience is invented. Visual atmosphere may use lagoon colour and the report's own data; it does
not borrow protected motifs or treat a culturally significant object as ornament.

---

## 5. The 17-second Project Tanoa film

### 5.1 Format

- one continuous recording from the real latest SimpleMark native macOS shell, because the final
  beat depends on the real watched-file path; the browser build may be used for preflight only;
- final output `1000 × 625`, optimised for GitHub and the product website;
- 17 seconds including readable opening and closing holds;
- 6 encoded frames per second, with unchanged frames coalesced during optimisation;
- target size at or below `5 MB`;
- deterministic input and timing;
- no simulated renderer output, fake app chrome, hidden cuts, or post-produced interaction;
- motion respects the document: one short scroll sequence, one source sheet, one watched update.

The previous demo remains untouched. The showcase receives a dedicated recorder and output name.

### 5.2 Storyboard

| Time | Visible action | Product proof |
|---|---|---|
| `0.0–2.0 s` | Open on the headline, sourced SVG storm map, and 14-minute decision window | beauty, place, immediate stakes |
| `2.0–4.5 s` | Paste one agent-authored field update containing the warning, Vega-Lite spec, KaTeX formula, ANSI capture, and JSON configuration | technical paste remains ordinary portable source |
| `4.5–7.0 s` | The page renders the forecast and autonomy calculation; the 1.8-hour gap becomes legible | Vega-Lite and KaTeX serve the decision |
| `7.0–9.5 s` | A short scroll reveals the terminal warning and Graphviz fault path to `reserve_floor=0.35` | less familiar renderers expose the cause |
| `9.5–13.0 s` | The committee decision table is visible; open the JSON source sheet and change `0.35` to `0.42` | contextual editing changes one exact block |
| `13.0–17.0 s` | Close source; a watched external update reports island mode stable with all priority circuits holding | the green ending is proven by live evidence |

Mermaid remains in the full report's topology section but does not consume a dedicated film beat.
The film foregrounds capabilities the current demo did not already make familiar.

### 5.3 Recording behavior

The recorder drives the actual UI and waits on product evidence rather than arbitrary delays:

- the starting note has loaded and the expected headline is visible;
- the clipboard paste has produced the expected block types;
- the Vega-Lite SVG, KaTeX markup, ANSI card, Graphviz output, and JSON tree are visible;
- the JSON source sheet contains the old value before editing and the new value afterward;
- the source sheet has closed and the rendered JSON reflects the correction;
- the external update has entered through the native `watch_note` path;
- the final success text and metrics match the fixture.

If the native recording cannot prove the real watched-file path, the film does not pass. It may not
substitute a DOM mutation that merely looks live.

---

## 6. SimpleMark 1.0 launch plan

### 6.1 Audience and posture

This is an internal founder-and-launch-team document with public-quality polish. It is candid about
readiness, ownership, risk, and evidence. It is explicitly an aspirational 1.0 plan, not a claim
that every section describes today's product.

**Working title:**

> # SimpleMark 1.0
> *Launch plan for the beautiful living document for AI work*

The visual personality shares warm paper and deep ink with Project Tanoa, but uses a sharper studio
editorial system: graphite structure, green for proven evidence, and amber for unresolved launch
risk. There are no lagoon motifs.

### 6.2 Document structure

1. **The launch decision** — intended user, product promise, release recommendation, and what 1.0
   must prove.
2. **Current truth vs. 1.0** — shipped evidence, incomplete work, and aspirational capabilities in
   separate columns.
3. **The defining experience** — open an agent-written file, read it beautifully, watch it update,
   and correct one block.
4. **Category and positioning** — what SimpleMark is, what it refuses to become, and the wedge
   created by source fidelity plus exceptional technical rendering.
5. **Product and release architecture** — a DOT graph from external writer through file,
   `DocumentSession`, renderer, correction, and atomic save.
6. **Launch readiness** — platform, fidelity, performance, trust, accessibility, packaging,
   website, support, and distribution gates.
7. **Success measures** — technical thresholds and labelled future adoption targets; no invented
   present measurements.
8. **Risks and decisions** — red/amber/green register with owner, exit evidence, and decision date.
9. **Six-week launch sequence** — portable headings, weekly checklists, owners, and dependencies.
10. **Release proof** — highlighted commands, terminal output, tree/diff evidence where real, build
    provenance, and final go/no-go checklist.
11. **Launch language** — headline, short description, announcement, and language to avoid.

Markmap is not part of this structure. The weekly sequence remains ordinary Markdown until that
renderer is actually wired and proven.

### 6.3 Truth boundary

Every statement is marked by kind:

- **Current evidence** links to a test, artifact, merged change, or current product behavior.
- **1.0 gate** states a condition that must be true before launch.
- **Target** is a future measurable outcome, never presented as current performance.
- **Decision** records an accepted product or launch choice.

The launch plan may be bold; it may not quietly turn a roadmap into shipped truth. Anything whose
status cannot be confirmed during implementation stays out or is named as a gate.

---

## 7. Proposed repository layout

Implementation should converge on this layout unless existing conventions prove a simpler home:

```text
docs/
  showcase/
    project-tanoa.md
    simplemark-1.0-launch-plan.md
    assets/
      fulaga-map.svg
    data/
      project-tanoa-scenario.json
  assets/
    project-tanoa-showcase.gif
scripts/
  record-tanoa-showcase.mjs
```

`project-tanoa-scenario.json` is implementation and recording source data, not runtime application
state. It keeps the fictional evidence coherent and makes the film reproducible.

The map filename is illustrative. Its final format and attribution must follow the selected source
license. If attribution cannot live inside the SVG, it lives adjacent to the map and in the report.

---

## 8. Failure behavior

The showcase follows the product rule that failures remain visible and local.

| Failure | Required outcome |
|---|---|
| Geography is unavailable, unsuitable, or unlicensed | use an explicitly labelled schematic or omit the map; never invent one |
| A renderer rejects its source | fix the source or remove the block; do not capture a blank or substitute a fake image |
| The desired block is not wired in current code | remove the claim; open separate product work only with explicit scope |
| Native watched update cannot be proven | stop the recording work and repair or rescope explicitly; do not mutate the DOM directly |
| GIF text is unreadable at final size | reduce visible material or change framing; do not enlarge the file while keeping an illegible composition |
| File exceeds the agreed publication budget | optimise palette, frame rate, and unchanged frames without changing the story |
| Scenario values disagree | fail generation/verification and repair the single fixture or the derived content |
| Cultural or linguistic review is unavailable | publish as an internal design artifact only; do not imply community endorsement |

The recorder exits non-zero when any expected block or final state is absent. A GIF file existing is
not evidence that the intended product behavior occurred.

---

## 9. Verification

### 9.1 Document verification

- open each exact `.md` file in the current browser build and inspect the complete page;
- open Project Tanoa in the native shell when proving watched-file behavior;
- assert every expected rendered block is present and no renderer error card is visible;
- edit and save one contextual block, reopen, and confirm the rendered result persists;
- save without editing and prove byte identity where the document fixture expects preservation;
- inspect both files in a plain-text editor and a generic Markdown preview;
- verify all relative links, local data references, source attribution, and licences;
- search for unsupported present-tense product claims and unlabeled fictional data;
- have a Fijian-language or Fulaga community reviewer validate the public name and place language.

### 9.2 Film verification

- record from one real native app session with the current chrome and no fabricated frames;
- fail on missing selectors, renderer errors, stale configuration, or absent final update;
- inspect representative frames at the beginning, each transition, and the final hold;
- verify `1000 × 625`, 17-second duration within encoding tolerance, 6 encoded frames per second,
  loop behavior, and size at or below `5 MB`;
- inspect at rendered GitHub width, not only at source resolution;
- keep the existing demo and recorder unchanged unless a later approved plan explicitly replaces
  them.

### 9.3 Repository verification

The implementation plan chooses the smallest commands proportional to the files changed. At
minimum it includes:

- `git diff --check`;
- Markdown-link verification for moved or added document paths;
- syntax validation for the recording script;
- focused Playwright coverage for every interaction the recorder depends on; and
- `bash scripts/simplemark_ci.sh` if implementation changes any product or test surface.

Source inspection alone never becomes a claim that the running document or film works.

---

## 10. Acceptance criteria

The showcase is complete only when:

1. both Markdown documents exist at stable repository paths and remain useful in plain text;
2. Project Tanoa is unmistakably fictional, internally consistent, source-attributed, and free of
   invented claims about real Fulaga people or present conditions;
3. the Tanoa document naturally renders SVG, Mermaid, Vega-Lite, KaTeX, ANSI, Graphviz, JSON, and
   ordinary Markdown without a renderer-catalogue feel;
4. the SimpleMark 1.0 plan distinguishes current evidence, future gates, targets, and decisions;
5. the GIF is a readable 17-second continuous capture of the real latest UI at `1000 × 625`;
6. the film shows the problem, evidence, accepted decision, contextual JSON correction, and a real
   watched update that proves the ending;
7. the recorder is deterministic, reproducible, and fails loudly when an expected behavior is
   absent;
8. every capability visible in the document or film is present in current code and verified in the
   running app;
9. the existing demo remains recoverable and unchanged unless replacement is explicitly approved;
10. appropriate repository checks pass and their exact results are recorded.

---

## 11. Explicitly out of scope

- adding or repairing product renderers merely to satisfy the showcase;
- Markmap until it is wired and proven independently;
- a second launch-plan GIF;
- a marketing website redesign;
- fabricated endorsements, community members, current energy conditions, or real cyclone events;
- collaboration, agent cockpit, chat, provider, session, or activity UI in the default document
  surface;
- replacing the current public demo before the new artifact passes its own acceptance criteria.

These may become later tasks. None is required to prove this design.
