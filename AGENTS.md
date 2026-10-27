# Project preferences

For terminal work use Git Bash and `bash dev.sh`; run `bash dev.sh doctor` when tools are missing. Before locating feature code, choosing checks, or troubleshooting Windows paths, read [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).

All design and UI changes must be implemented by **Claude Opus 5.5 with High reasoning**, as explicitly requested by the user. Delegate frontend appearance, layout, and interaction changes to that model through the available orchestration tools. Backend, protocol research, tests, builds, and application lifecycle work may be handled by the primary agent. Do not silently substitute a different model if Opus is unavailable.

The app is standalone: do not add bridges, importers, file readers or comparisons for third-party companion apps, and do not reference them in code, UI copy or tests. Import and export only this app's own native recording and log formats.

Use Lucide (`lucide-react`) for general UI icons. Use verified original AION 2 artwork for class, skill, pet portrait and pet type icons, as explicitly requested by the user. Pet type emblems must use the game's original symbols, never Lucide substitutes. Never invent substitute artwork; keep a written label when an original icon is unavailable.

# Shipping

Before committing, pushing, creating a pull request, merging or publishing a release, read and follow `.agents/LOCAL_POLICY.md` if it exists and the shared policy returned by `git config --path --get publication.policyFile` if configured. Keep local policy files untracked. If Git's `alias.publication-check` is configured, run `git publication-check <commit|push|pr|merge|release>` for the matching action immediately before the operation, including in worktrees without the local policy file. Proceed only on exit code zero; a failed check leaves the operation pending.

When an explicit publication request is blocked solely by work hours, automatically schedule its remaining authorized steps using [Deferred publication](docs/DEFERRED_PUBLICATION.md), without asking again. Follow that procedure when scheduling, resuming, updating or cancelling pending publication. Requests to explain or configure this workflow create no publication job.

"Ship it" means commit, push the branch and open a pull request against `master`; it never means merging. Merge only when the user explicitly says "ship and merge" (or otherwise asks for the merge in their own words).

For publishing a new GitHub release from this computer or resuming a local publication, use the project [local-release skill](.agents/skills/local-release/SKILL.md). It builds and validates locally before publishing; ordinary Dev builds continue to use `bash dev.sh build` or `bash dev.sh dev`.

# Design system

Every window is styled with Tailwind CSS v4, the tokens in `frontend/src/styles/theme.css` and the primitives in `frontend/src/components/ui`; [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) is the reference for direction, tokens, primitives and patterns. There is one colour scheme for every window, the in-game look (gold accent, warm ink, Instrument Sans only); in-game windows differ from the workspace only in translucency (`data-surface="glass"`), never in colour. `npm run check` runs the design-system guardrail (`scripts/check-design-system.mjs`): no colour literals outside `theme.css` (allowlist with reasons in the script), no arbitrary or inline colours, no native `<button>` outside `components/ui`, and no stylesheet outside `frontend/src/styles`. Fix the code rather than widening the allowlist.

# Conventional Commits

Every repository commit must follow Conventional Commits, including initial, merge, squash, revert, release, and automatically generated commits. This is a mandatory project rule for every contributor and agent.

Use `<type>[optional scope][!]: <description>`. Supported types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`. Use a lowercase type and, when present, a short lowercase scope. Write a concise imperative description without a trailing period. Use `!` and a `BREAKING CHANGE:` footer to explain breaking changes.

Examples:

- `feat(pets): add persistent farming goals`
- `fix(group): preserve live roster readiness`
- `docs(agents): require conventional commits`
- `chore(merge): merge group room updates (#18)`
- `chore(release): v0.7.2`

Keep commits focused on one coherent change. Do not use unprefixed subjects, `WIP`, `wip:`, or Git's default `Merge ...` and `Revert ...` subjects. Supply an explicit Conventional Commit message for merges and reverts; ensure squash commit messages and PR titles also follow this format.

Name working branches `<type>/<kebab-case-description>` using the supported commit types above, for example `feat/pet-farming-goals`, `fix/group-readiness`, or `docs/readme-conventional-commits`. Use lowercase words separated by hyphens for the description. Before starting work, check the current working branch and rename it if it does not follow this convention; the default branch (`master`) is exempt.

Before committing, inspect the staged changes and choose the type and scope that describe the actual change. Before pushing or merging, validate every new commit subject against this policy and correct any nonconforming messages while preserving the changes. Do not publish nonconforming commits. Keep relevant bodies, issue references, release metadata, and breaking-change footers when correcting messages.
