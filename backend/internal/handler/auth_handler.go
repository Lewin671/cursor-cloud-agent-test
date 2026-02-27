package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"pomodoro/backend/internal/service"
)

type AuthHandler struct {
	authService *service.AuthService
}

type authRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func NewAuthHandler(authService *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req authRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "invalid_json",
				"message": "invalid request body",
			},
		})
		return
	}

	result, apiErr := h.authService.Register(c.Request.Context(), req.Email, req.Password)
	if apiErr != nil {
		writeError(c, apiErr)
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req authRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    "invalid_json",
				"message": "invalid request body",
			},
		})
		return
	}

	result, apiErr := h.authService.Login(c.Request.Context(), req.Email, req.Password)
	if apiErr != nil {
		writeError(c, apiErr)
		return
	}

	c.JSON(http.StatusOK, result)
}
