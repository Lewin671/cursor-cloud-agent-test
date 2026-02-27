package router

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"pomodoro/backend/internal/handler"
	"pomodoro/backend/internal/middleware"
	"pomodoro/backend/internal/service"
)

func New(
	authService *service.AuthService,
	authHandler *handler.AuthHandler,
	pomodoroHandler *handler.PomodoroHandler,
	corsOrigins []string,
) *gin.Engine {
	engine := gin.New()
	engine.Use(gin.Logger(), gin.Recovery(), middleware.CORS(corsOrigins))

	engine.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := engine.Group("/api")
	auth := api.Group("/auth")
	auth.POST("/register", authHandler.Register)
	auth.POST("/login", authHandler.Login)

	pomodoro := api.Group("/pomodoro")
	pomodoro.Use(middleware.Auth(authService))
	pomodoro.GET("/state", pomodoroHandler.GetState)
	pomodoro.POST("/start", pomodoroHandler.Start)
	pomodoro.POST("/pause", pomodoroHandler.Pause)
	pomodoro.POST("/reset", pomodoroHandler.Reset)
	pomodoro.POST("/mode", pomodoroHandler.SwitchMode)
	pomodoro.PUT("/settings", pomodoroHandler.UpdateSettings)
	pomodoro.GET("/history", pomodoroHandler.GetHistory)

	return engine
}
