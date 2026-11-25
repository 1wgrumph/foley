# Public-boundary negative fixtures

Synthetic inputs for `node tools/check-public.mjs --self-test fixtures/public-negative/`.
Each subdirectory is a small tree named after the forbidden class it must
trigger. Nothing here is a real credential, path, prompt or recording.
`tools/check-public.mjs --tree .` skips this directory, and `.gitleaks.toml`
allow-lists it by path.
