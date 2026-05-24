# Task runner for the Rapira project. Install just: https://github.com/casey/just

# Default — list available recipes
default:
    @just --list --unsorted

# ── tests & checks ─────────────────────────────────────────────────────────

# Run the test suite
test:
    bun test

# Watch mode: re-run tests on file change
test-watch:
    bun test --watch

# Static typecheck (no emit)
typecheck:
    bun run typecheck

# Everything CI would do — tests then typecheck
ci: test typecheck

# ── web playground ─────────────────────────────────────────────────────────

# Production build of the web playground into docs/ (GitHub Pages-ready)
build:
    bun run build

# Bundle the CLI to dist/rapira.js (for npm publish / npx rapira)
cli-build:
    bun run cli:build

# Dry-run an `npm publish` so you can preview what would ship to the registry
pack:
    npm pack --dry-run

# ── npm publish ────────────────────────────────────────────────────────────

# Bump patch version and publish (matches the asm8 convention).
# prepublishOnly re-runs cli:build + bun test as a safety net.
publish: test
    npm version patch --no-git-tag-version
    npm publish

publish-minor: test
    npm version minor --no-git-tag-version
    npm publish

publish-major: test
    npm version major --no-git-tag-version
    npm publish

# Dev mode: build + watch + serve on http://localhost:10000
serve: dev
dev:
    bun run dev

# Wipe the docs/ output
clean:
    rm -rf docs/

# ── CLI ────────────────────────────────────────────────────────────────────

# Run a .rap file through the Rapira CLI
#   just run examples/factorial.rap
#   just run examples/turtle_star.rap --svg /tmp/star.svg
run *ARGS:
    bun run cli/index.ts {{ARGS}}

# Start the Rapira REPL
repl:
    bun run cli/index.ts

# Render a turtle example as SVG and print where it landed
turtle EXAMPLE OUT="/tmp/rapira.svg":
    bun run cli/index.ts examples/{{EXAMPLE}}.rap --svg {{OUT}}
    @echo "→ {{OUT}}"

# ── deps ───────────────────────────────────────────────────────────────────

# Reinstall dependencies from scratch
install:
    rm -rf node_modules
    bun install
