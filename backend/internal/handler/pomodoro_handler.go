package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"pomodoro/backend/internal/middleware"
	"pomodoro/backend/internal/service"
)

type PomodoroHandler struct {
	pomodoroService *service.PomodoroService
}

type versionRequest struct {
	BaseVersion int `json:"baseVersion"`
}

type switchModeRequest struct {
	BaseVersion int    `json:"baseVersion"`
	Mode        string `json:"mode"`
}

type updateSettingsRequest struct {
	BaseVersion               int `json:"baseVersion"`
	FocusDurationSeconds      int `json:"focusDurationSeconds"`
	ShortBreakDurationSeconds int `json:"shortBreakDurationSeconds"`
	LongBreakDurationSeconds  int `json:"longBreakDurationSeconds"`
}

func NewPomodoroHandler(pomodoroService *service.PomodoroService) *PomodoroHandler {
	return &PomodoroHandler{pomodoroService: pomodoroService}
}

func (h *PomodoroHandler) GetState(c *gin.Context) {
	userID := middleware.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": gin.H{"code": "unauthorized", "message": "unauthorized"},
		})
		return
	}

	state, apiErr := h.pomodoroService.GetState(c.Request.Context(), userID)
	if apiErr != nil {
		writeError(c, apiErr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"state": state})
}

func (h *PomodoroHandler) Start(c *gin.Context) {
	var req versionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "invalid_json", "message": "invalid request body"},
		})
		return
	}
	if req.BaseVersion <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "invalid_base_version", "message": "baseVersion is required"},
		})
		return
	}

	userID := middleware.UserID(c)
	state, apiErr := h.pomodoroService.Start(c.Request.Context(), userID, req.BaseVersion)
	if apiErr != nil {
		writeError(c, apiErr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"state": state})
}

func (h *PomodoroHandler) Pause(c *gin.Context) {
	var req versionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "invalid_json", "message": "invalid request body"},
		})
		return
	}
	if req.BaseVersion <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "invalid_base_version", "message": "baseVersion is required"},
		})
		return
	}

	userID := middleware.UserID(c)
	state, apiErr := h.pomodoroService.Pause(c.Request.Context(), userID, req.BaseVersion)
	if apiErr != nil {
		writeError(c, apiErr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"state": state})
}

func (h *PomodoroHandler) Reset(c *gin.Context) {
	var req versionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "invalid_json", "message": "invalid request body"},
		})
		return
	}
	if req.BaseVersion <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "invalid_base_version", "message": "baseVersion is required"},
		})
		return
	}

	userID := middleware.UserID(c)
	state, apiErr := h.pomodoroService.Reset(c.Request.Context(), userID, req.BaseVersion)
	if apiErr != nil {
		writeError(c, apiErr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"state": state})
}

func (h *PomodoroHandler) SwitchMode(c *gin.Context) {
	var req switchModeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "invalid_json", "message": "invalid request body"},
		})
		return
	}
	if req.BaseVersion <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "invalid_base_version", "message": "baseVersion is required"},
		})
		return
	}

	userID := middleware.UserID(c)
	state, apiErr := h.pomodoroService.SwitchMode(c.Request.Context(), userID, req.Mode, req.BaseVersion)
	if apiErr != nil {
		writeError(c, apiErr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"state": state})
}

func (h *PomodoroHandler) UpdateSettings(c *gin.Context) {
	var req updateSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "invalid_json", "message": "invalid request body"},
		})
		return
	}
	if req.BaseVersion <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{"code": "invalid_base_version", "message": "baseVersion is required"},
		})
		return
	}

	userID := middleware.UserID(c)
	state, apiErr := h.pomodoroService.UpdateSettings(c.Request.Context(), userID, service.UpdateSettingsInput{
		BaseVersion:               req.BaseVersion,
		FocusDurationSeconds:      req.FocusDurationSeconds,
		ShortBreakDurationSeconds: req.ShortBreakDurationSeconds,
		LongBreakDurationSeconds:  req.LongBreakDurationSeconds,
	})
	if apiErr != nil {
		writeError(c, apiErr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"state": state})
}

func (h *PomodoroHandler) GetHistory(c *gin.Context) {
	userID := middleware.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": gin.H{"code": "unauthorized", "message": "unauthorized"},
		})
		return
	}

	limit := 50
	rawLimit := c.Query("limit")
	if rawLimit != "" {
		if parsed, err := strconv.Atoi(rawLimit); err == nil {
			limit = parsed
		}
	}

	sessions, apiErr := h.pomodoroService.GetHistory(c.Request.Context(), userID, limit)
	if apiErr != nil {
		writeError(c, apiErr)
		return
	}
	c.JSON(http.StatusOK, gin.H{"sessions": sessions})
}
