package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port          string
	DBPath        string
	JWTSecret     string
	TokenTTL      time.Duration
	CORSOrigins   []string
	MigrationsDir string
}

func Load() Config {
	return Config{
		Port:          getEnv("PORT", "8080"),
		DBPath:        getEnv("DB_PATH", "./data/pomodoro.db"),
		JWTSecret:     getEnv("JWT_SECRET", "change-this-secret"),
		TokenTTL:      time.Duration(getEnvInt("TOKEN_TTL_HOURS", 72)) * time.Hour,
		CORSOrigins:   getEnvList("CORS_ORIGINS", []string{"http://localhost:5173", "http://127.0.0.1:5173"}),
		MigrationsDir: getEnv("MIGRATIONS_DIR", "./migrations"),
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok && value != "" {
		return value
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getEnvList(key string, fallback []string) []string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parts := strings.Split(value, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			items = append(items, trimmed)
		}
	}
	if len(items) == 0 {
		return fallback
	}
	return items
}
