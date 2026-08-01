# `adapters/renderers`

Renderers that own a rectangle of the page. Mermaid first.

Every renderer saves a portable Markdown fallback, runs sanitised, and fails
visibly with the parser message rather than showing a blank rectangle.
Filled by EDITOR-1.
