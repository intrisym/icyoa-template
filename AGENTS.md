# Repository instructions

Create branches using `<type>/<description>` in lowercase, for example
`feat/image-url-validation`, `fix/editor-preview`, or `chore/update-checks`.
Do not include `codex` anywhere in branch names. Keep `main` and `master` as
permanent branch exceptions. This project naming convention is inspired by
Conventional Commits; that specification itself governs commit messages.

Preserve unrelated working-tree changes when switching or renaming branches.

CI image workflows perform read-only checks and may run automatically.
ImgChest uploads run locally using `IMGCHEST_API_TOKEN` from the environment.
Never store API tokens in tracked files or expose them in logs. Any future CI
workflow using authenticated external service APIs requires explicit
`intrisym` approval for each run; never run contributor code with those tokens.

When an image host causes reported CI loading failures, add it to
`warningDomains` in `imageUrlPolicy.js` and update the policy tests and README.
Keep warnings advisory; ORB, access restrictions and transient network errors
are inconclusive and do not establish that an image is permanently broken.
Localhost and production failures for the same URL are separate test results,
not separate images to upload.

Use the local image exporter (`npm run images:export`) for ImgChest migration.
Preview the selection first and scope it to the requested URLs, using host and
file filters or a report. Preserve its upload cache, deduplication, rate limits
and replacement verification. Apply matching URL replacements across versions
without changing gameplay data. Do not restore automatic authenticated CI
uploads. If `IMGCHEST_API_TOKEN` is unavailable, finish the warning-list changes
and provide the exact local migration command; do not request the token in chat
or claim that the image URLs have been migrated.
