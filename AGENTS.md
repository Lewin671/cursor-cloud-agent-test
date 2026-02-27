# AGENTS.md

## Cursor Cloud specific instructions

A full-stack Pomodoro Timer app with real-time cross-device sync via WebSocket.

### Architecture

- **Backend**: Express.js (REST API + static file serving) + `ws` (WebSocket for real-time sync) + `better-sqlite3` (SQLite for persistence)
- **Frontend**: Vanilla HTML/CSS/JS SPA served from `public/`
- **Auth**: JWT-based (bcryptjs for password hashing, jsonwebtoken for tokens)
- **Data sync**: WebSocket broadcasts timer state changes to all connected devices of the same user

### Available npm scripts

See `package.json`. Key commands:

- `npm run dev` — starts the server with `--watch` on port 3000 (override with `PORT` env var)
- `npm test` — 19 API tests using Node.js built-in test runner
- `npm run lint` — ESLint on `src/` and `public/`
- `npm start` — production start

### Notes

- SQLite database is created at `data/pomodoro.db` on first run (auto-created directory). Tests use in-memory SQLite.
- Timer state is stored server-side; all connected clients compute remaining time from the server's `started_at` timestamp.
- The `--watch` dev mode auto-restarts on `src/` changes but does NOT live-reload the browser.
- No external services or databases are required — everything runs locally with SQLite.
