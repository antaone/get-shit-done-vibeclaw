# Adversarial security fixtures (#3596)

Reusable hostile payloads consumed by
`tests/security-prompt-injection.test.cjs`.

The fixtures here are pure data — they are loaded by the test as input
to the production code under test (hooks, validators, sanitizers, CLI).
They are not executed and contain no real secrets.

| File | Attack class | Consumed by |
|------|--------------|-------------|
| `context-instruction-override.md` | Fake instruction override + role manipulation | fvgsd/read-injection-scanner.js, fvgsd/prompt-guard.js |
| `plan-fake-system-tags.md` | `<system>`/`<assistant>` boundary mimicry | sanitizeForPrompt, fvgsd/prompt-guard.js |
| `roadmap-heredoc-breakout.md` | Heredoc-shaped payload inside a planning doc | fvgsd/read-injection-scanner.js |
| `plan-fake-frontmatter.md` | Frontmatter fields that try to override intent | fvgsd/read-injection-scanner.js |
| `context-malicious-markdown-link.md` | Markdown links with `javascript:` and embedded creds | fvgsd/read-injection-scanner.js |
| `context-invisible-unicode.md` | Zero-width chars hiding instructions | fvgsd/read-injection-scanner.js, sanitizeForPrompt |

The fake-token values used in CLI redaction probes
(`ghp_AAAA…`, `sk-AAAA…`) are constructed inline by the test, not stored
here, so an editor or grep that scans this directory does not surface
plausible-looking credentials.
