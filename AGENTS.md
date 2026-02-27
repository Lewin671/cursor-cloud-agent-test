# AGENTS.md

## Cursor Cloud specific instructions

This repository is a full-stack Pomodoro app with frontend/backed separation:

- Frontend: React + TypeScript (Vite) under `frontend/`
- Backend: Go + Gin + SQLite under `backend/`

### Key commands

- `npm run dev` (repo root): starts backend + frontend together
- `npm run dev:frontend`: start frontend only
- `npm run dev:backend`: start backend only
- `npm run migrate`: apply backend DB migrations

### Backend testing/lint

- `cd backend && go test ./...`

### Frontend testing/lint

- `cd frontend && npm run build`
- `cd frontend && npm run lint`

### Notes

- Backend applies SQL migrations on startup from `backend/migrations/`.
- No external services are required; SQLite file is local (`backend/data/pomodoro.db` by default).
