package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func OpenSQLite(path string) (*sql.DB, error) {
	dir := filepath.Dir(path)
	if dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("create db dir: %w", err)
		}
	}

	dsn := fmt.Sprintf("%s?_foreign_keys=on&_busy_timeout=8000", path)
	database, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)
	database.SetConnMaxLifetime(0)
	database.SetConnMaxIdleTime(30 * time.Second)

	if err := database.Ping(); err != nil {
		_ = database.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	return database, nil
}

func RunMigrations(database *sql.DB, migrationsDir string) error {
	if _, err := database.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		files = append(files, entry.Name())
	}
	sort.Strings(files)

	for _, name := range files {
		applied, err := isMigrationApplied(database, name)
		if err != nil {
			return err
		}
		if applied {
			continue
		}

		path := filepath.Join(migrationsDir, name)
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}

		tx, err := database.Begin()
		if err != nil {
			return fmt.Errorf("begin migration tx %s: %w", name, err)
		}

		if _, err := tx.Exec(string(content)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("execute migration %s: %w", name, err)
		}

		if _, err := tx.Exec(
			`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`,
			name,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %s: %w", name, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}

	return nil
}

func isMigrationApplied(database *sql.DB, name string) (bool, error) {
	var count int
	if err := database.QueryRow(
		`SELECT COUNT(1) FROM schema_migrations WHERE name = ?`,
		name,
	).Scan(&count); err != nil {
		return false, fmt.Errorf("check migration %s: %w", name, err)
	}
	return count > 0, nil
}
