package errors

import "net/http"

type APIError struct {
	Status  int         `json:"-"`
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

func (e *APIError) Error() string {
	return e.Message
}

func New(status int, code, message string) *APIError {
	return &APIError{
		Status:  status,
		Code:    code,
		Message: message,
	}
}

func Internal(message string) *APIError {
	if message == "" {
		message = "internal server error"
	}
	return New(http.StatusInternalServerError, "internal_error", message)
}

func BadRequest(code, message string) *APIError {
	return New(http.StatusBadRequest, code, message)
}

func Unauthorized(message string) *APIError {
	if message == "" {
		message = "unauthorized"
	}
	return New(http.StatusUnauthorized, "unauthorized", message)
}

func Forbidden(message string) *APIError {
	if message == "" {
		message = "forbidden"
	}
	return New(http.StatusForbidden, "forbidden", message)
}

func NotFound(code, message string) *APIError {
	return New(http.StatusNotFound, code, message)
}

func Conflict(code, message string, details interface{}) *APIError {
	err := New(http.StatusConflict, code, message)
	err.Details = details
	return err
}
