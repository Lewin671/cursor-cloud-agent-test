package router_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"pomodoro/backend/internal/db"
	"pomodoro/backend/internal/handler"
	"pomodoro/backend/internal/repository"
	"pomodoro/backend/internal/router"
	"pomodoro/backend/internal/service"
)

type authResponse struct {
	Token string `json:"token"`
	User  struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	} `json:"user"`
}

type stateEnvelope struct {
	State struct {
		Version int `json:"version"`
	} `json:"state"`
}

type historyEnvelope struct {
	Sessions []struct {
		Status string `json:"status"`
	} `json:"sessions"`
}

type apiErrorEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Details struct {
			State struct {
				Version int `json:"version"`
			} `json:"state"`
		} `json:"details"`
	} `json:"error"`
}

func TestPomodoroSyncAndConflict(t *testing.T) {
	engine := setupTestEngine(t)

	user1 := registerUser(t, engine, "user1@example.com", "123456")
	user2 := registerUser(t, engine, "user2@example.com", "123456")

	state1 := getState(t, engine, user1.Token)
	if state1.State.Version != 1 {
		t.Fatalf("expected initial version 1, got %d", state1.State.Version)
	}

	// Start timer with current version.
	startBody := map[string]int{"baseVersion": state1.State.Version}
	status, _ := requestJSON(t, engine, http.MethodPost, "/api/pomodoro/start", user1.Token, startBody)
	if status != http.StatusOK {
		t.Fatalf("expected 200 on start, got %d", status)
	}

	// Pause with stale version from another device should conflict.
	conflictBody := map[string]int{"baseVersion": state1.State.Version}
	status, rawConflict := requestJSON(t, engine, http.MethodPost, "/api/pomodoro/pause", user1.Token, conflictBody)
	if status != http.StatusConflict {
		t.Fatalf("expected 409 for stale version, got %d", status)
	}

	var conflictResp apiErrorEnvelope
	if err := json.Unmarshal(rawConflict, &conflictResp); err != nil {
		t.Fatalf("unmarshal conflict response: %v", err)
	}
	if conflictResp.Error.Code != "state_conflict" {
		t.Fatalf("expected state_conflict, got %s", conflictResp.Error.Code)
	}

	// Reset with latest version from conflict details.
	latestVersion := conflictResp.Error.Details.State.Version
	status, _ = requestJSON(t, engine, http.MethodPost, "/api/pomodoro/reset", user1.Token, map[string]int{
		"baseVersion": latestVersion,
	})
	if status != http.StatusOK {
		t.Fatalf("expected 200 on reset, got %d", status)
	}

	// User isolation: user2 should still have no history.
	status, user2HistoryRaw := requestJSON(t, engine, http.MethodGet, "/api/pomodoro/history?limit=10", user2.Token, nil)
	if status != http.StatusOK {
		t.Fatalf("expected 200 for user2 history, got %d", status)
	}

	var user2History historyEnvelope
	if err := json.Unmarshal(user2HistoryRaw, &user2History); err != nil {
		t.Fatalf("unmarshal user2 history: %v", err)
	}
	if len(user2History.Sessions) != 0 {
		t.Fatalf("expected no sessions for user2, got %d", len(user2History.Sessions))
	}

	// User1 should have at least one cancelled session after reset.
	status, user1HistoryRaw := requestJSON(t, engine, http.MethodGet, "/api/pomodoro/history?limit=10", user1.Token, nil)
	if status != http.StatusOK {
		t.Fatalf("expected 200 for user1 history, got %d", status)
	}

	var user1History historyEnvelope
	if err := json.Unmarshal(user1HistoryRaw, &user1History); err != nil {
		t.Fatalf("unmarshal user1 history: %v", err)
	}
	if len(user1History.Sessions) == 0 {
		t.Fatal("expected at least one session for user1")
	}
	if user1History.Sessions[0].Status != "cancelled" {
		t.Fatalf("expected latest session cancelled, got %s", user1History.Sessions[0].Status)
	}
}

func TestCORSPreflight(t *testing.T) {
	engine := setupTestEngine(t)
	req := httptest.NewRequest(http.MethodOptions, "/api/auth/login", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", "POST")
	recorder := httptest.NewRecorder()

	engine.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for preflight, got %d", recorder.Code)
	}
	if recorder.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("unexpected allow-origin header: %s", recorder.Header().Get("Access-Control-Allow-Origin"))
	}
}

func setupTestEngine(t *testing.T) http.Handler {
	t.Helper()

	database, err := db.OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})

	_, currentFile, _, _ := runtime.Caller(0)
	migrationsDir := filepath.Join(filepath.Dir(currentFile), "..", "..", "migrations")
	if err := db.RunMigrations(database, migrationsDir); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	userRepo := repository.NewUserRepository(database)
	pomodoroRepo := repository.NewPomodoroRepository(database)
	authService := service.NewAuthService(userRepo, pomodoroRepo, "test-secret", 24*time.Hour)
	pomodoroService := service.NewPomodoroService(pomodoroRepo)

	authHandler := handler.NewAuthHandler(authService)
	pomodoroHandler := handler.NewPomodoroHandler(pomodoroService)

	return router.New(authService, authHandler, pomodoroHandler, []string{"http://localhost:5173"})
}

func registerUser(t *testing.T, server http.Handler, email, password string) authResponse {
	t.Helper()
	status, body := requestJSON(t, server, http.MethodPost, "/api/auth/register", "", map[string]string{
		"email":    email,
		"password": password,
	})
	if status != http.StatusCreated {
		t.Fatalf("register %s failed with status %d: %s", email, status, string(body))
	}
	var resp authResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("unmarshal register response: %v", err)
	}
	if resp.Token == "" {
		t.Fatalf("empty token for user %s", email)
	}
	return resp
}

func getState(t *testing.T, server http.Handler, token string) stateEnvelope {
	t.Helper()
	status, body := requestJSON(t, server, http.MethodGet, "/api/pomodoro/state", token, nil)
	if status != http.StatusOK {
		t.Fatalf("get state failed with status %d: %s", status, string(body))
	}
	var stateResp stateEnvelope
	if err := json.Unmarshal(body, &stateResp); err != nil {
		t.Fatalf("unmarshal state response: %v", err)
	}
	return stateResp
}

func requestJSON(
	t *testing.T,
	server http.Handler,
	method, path, token string,
	body interface{},
) (int, []byte) {
	t.Helper()

	var payload []byte
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		payload = raw
	}

	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, req)
	return recorder.Code, recorder.Body.Bytes()
}
