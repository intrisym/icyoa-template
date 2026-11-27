# Repository instructions

Create branches using `<type>/<description>` in lowercase, for example
`feat/image-url-validation`, `fix/editor-preview`, or `chore/update-checks`.
Do not include `codex` anywhere in branch names. Keep `main` and `master` as
permanent branch exceptions. This project naming convention is inspired by
Conventional Commits; that specification itself governs commit messages.

Preserve unrelated working-tree changes when switching or renaming branches.

Workflows using authenticated external service APIs must require explicit
`intrisym` approval for each run through the `image-rehosting` environment and
the fail-closed approval check in `scripts/rehost-images.js`. Keep API tokens
in that environment's secrets. Never run contributor code with those tokens.
Ordinary read-only image loading checks may continue automatically.
