---
apply: always
---

EchoVault MCP Memory Rules:

1. SESSION START (MANDATORY): Call memory_context() IMMEDIATELY at the start of EVERY session before any other work. Do not skip this step.

2. SEARCH: Use memory_search only for non-obvious code patterns.

3. YOU MUST SAVE BEFORE END: Call memory_save before task completion. Save only:
    - Decisions (architectural choices)
    - Non-trivial bugs (root cause + fix)
    - Patterns (reusable gotchas)

4. FORMAT (English only, ASCII only):
    - title: Max 60 chars
    - what: 1-2 sentences
    - why: Reasoning
    - impact: What changed
    - Omit project param - auto-detected from cwd

5. DO NOT SAVE:
    - Trivial changes
    - Info obvious from code
    - Duplicates
    - Work in progress

6. TOKEN OPTIMIZATION:
    - Batch independent tool calls
    - Use grep_search before code_search
    - Read only needed file portions (offset/limit)
    - Avoid re-reading files in context

7. PROJECT MAPPING (when auto-detect fails):
    - dm/SaasCredit (I:\Server\domains\sckz) -> project: sckz
    - Pass project parameter explicitly if auto-detect saves to wrong folder