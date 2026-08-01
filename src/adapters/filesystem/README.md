# `adapters/filesystem`

Local reads, content hashes, atomic writes, and external-change detection
behind the application `FilePort`.

Atomic writes only: temp file in the same directory, fsync, then rename. A
partially written note is never observable. Filled by APP-1 and APP-2.
