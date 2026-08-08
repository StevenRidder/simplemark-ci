# Architecture decisions

The public mirror includes the decisions that describe user-visible document behavior and safety. Internal collaboration, agent-participation, and release-planning records remain private to the canonical repository.

| ADR | Status | Decision |
|---|---|---|
| [0003](0003-rendered-block-frame.md) | Accepted | Rendered blocks share one composed document frame, so reading and editing stay in the same page. |
| [0008](0008-pasted-images-become-local-files.md) | Accepted | Rich-HTML image pastes become local files beside the note, with a portable Markdown fallback. |
