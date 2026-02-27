package main

import (
	"log"

	"pomodoro/backend/internal/config"
	"pomodoro/backend/internal/db"
	"pomodoro/backend/internal/handler"
	"pomodoro/backend/internal/repository"
	"pomodoro/backend/internal/router"
	"pomodoro/backend/internal/service"
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

	userRepo := repository.NewUserRepository(database)
	pomodoroRepo := repository.NewPomodoroRepository(database)

	authService := service.NewAuthService(userRepo, pomodoroRepo, cfg.JWTSecret, cfg.TokenTTL)
	pomodoroService := service.NewPomodoroService(pomodoroRepo)

	authHandler := handler.NewAuthHandler(authService)
	pomodoroHandler := handler.NewPomodoroHandler(pomodoroService)

	engine := router.New(authService, authHandler, pomodoroHandler, cfg.CORSOrigins)
	log.Printf("backend listening on :%s", cfg.Port)
	if err := engine.Run(":" + cfg.Port); err != nil {
		log.Fatalf("run server: %v", err)
	}
}
