# AGENTS.md

## Cursor Cloud specific instructions

This is a minimal Node.js HTTP server (no external frameworks). It uses only Node.js built-in modules (`node:http`, `node:test`, `node:assert`).

### Available npm scripts

See `package.json` for the full list. Key commands:

- `npm run dev` — starts the server with `--watch` for hot reloading (port 3000 by default, override with `PORT` env var)
- `npm test` — runs tests using Node.js built-in test runner
- `npm run lint` — runs ESLint on `src/`

### Notes

- ESLint is the only dev dependency. Tests use `node:test` (built-in), so no test framework install is needed.
- The dev server uses Node.js `--watch` mode; changes to `src/` files trigger automatic restarts.
- There are no external services or databases required.
