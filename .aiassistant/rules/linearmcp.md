---
apply: always
---

Use Linear MCP whenever the user mentions:
- a Linear issue key
- a Linear URL
- a bug/feature/task that likely exists in Linear
- project planning, sprint work, backlog items, or task status

Workflow:
1. Search or open the relevant Linear issue.
2. Extract the actual requirement, constraints, acceptance criteria, and latest discussion.
3. Use that context to guide code changes, architecture decisions, and implementation steps.
4. If the user wants updates in Linear, prepare the exact text first and only then apply changes if explicitly requested.

Rules:
- Linear is the system of record for task scope.
- Do not assume task details if they can be checked in Linear.
- Do not create or edit Linear issues silently.
- Do not broaden scope beyond the issue.
- If issue description conflicts with chat instructions, point out the conflict clearly.
- When finishing a task, provide a short completion summary that can be posted to Linear.

For coding tasks:
- Tie the implementation to the Linear issue key.
- Mention affected files/modules.
- Respect existing project architecture and conventions.
- Call out missing acceptance criteria or risky assumptions.