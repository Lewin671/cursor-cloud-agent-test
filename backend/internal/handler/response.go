package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	apperrors "pomodoro/backend/internal/errors"
)

func writeError(c *gin.Context, apiErr *apperrors.APIError) {
	if apiErr == nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"code":    "internal_error",
				"message": "internal server error",
			},
		})
		return
	}

	errorBody := gin.H{
		"code":    apiErr.Code,
		"message": apiErr.Message,
	}
	if apiErr.Details != nil {
		errorBody["details"] = apiErr.Details
	}

	c.JSON(apiErr.Status, gin.H{
		"error": errorBody,
	})
}
