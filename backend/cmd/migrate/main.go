package main

import (
	"log"

	"pomodoro/backend/internal/config"
	"pomodoro/backend/internal/db"
)

func main() {
	cfg := config.Load()
	database, err := db.OpenSQLite(cfg.DBPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()

	if err := db.RunMigrations(database, cfg.MigrationsDir); err != nil {
		log.Fatalf("run migrations: %v", err)
	}

	log.Println("migrations applied successfully")
}
