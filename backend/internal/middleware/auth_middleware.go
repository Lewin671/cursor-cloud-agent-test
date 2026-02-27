package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"

	apperrors "pomodoro/backend/internal/errors"
	"pomodoro/backend/internal/service"
)

const UserIDContextKey = "userID"

func Auth(authService *service.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			writeError(c, apperrors.Unauthorized("missing authorization header"))
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeError(c, apperrors.Unauthorized("invalid authorization format"))
			return
		}

		token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		if token == "" {
			writeError(c, apperrors.Unauthorized("invalid authorization format"))
			return
		}

		userID, apiErr := authService.ParseToken(token)
		if apiErr != nil {
			writeError(c, apiErr)
			return
		}

		c.Set(UserIDContextKey, userID)
		c.Next()
	}
}

func UserID(c *gin.Context) string {
	value, ok := c.Get(UserIDContextKey)
	if !ok {
		return ""
	}
	userID, ok := value.(string)
	if !ok {
		return ""
	}
	return userID
}

func writeError(c *gin.Context, apiErr *apperrors.APIError) {
	c.AbortWithStatusJSON(apiErr.Status, gin.H{
		"error": gin.H{
			"code":    apiErr.Code,
			"message": apiErr.Message,
			"details": apiErr.Details,
		},
	})
}
