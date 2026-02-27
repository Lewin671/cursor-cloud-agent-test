package service

import (
	"context"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	apperrors "pomodoro/backend/internal/errors"
	"pomodoro/backend/internal/model"
	"pomodoro/backend/internal/repository"
)

type AuthService struct {
	userRepo     *repository.UserRepository
	pomodoroRepo *repository.PomodoroRepository
	jwtSecret    []byte
	tokenTTL     time.Duration
}

func NewAuthService(
	userRepo *repository.UserRepository,
	pomodoroRepo *repository.PomodoroRepository,
	jwtSecret string,
	tokenTTL time.Duration,
) *AuthService {
	return &AuthService{
		userRepo:     userRepo,
		pomodoroRepo: pomodoroRepo,
		jwtSecret:    []byte(jwtSecret),
		tokenTTL:     tokenTTL,
	}
}

type AuthResult struct {
	Token string     `json:"token"`
	User  model.User `json:"user"`
}

func (s *AuthService) Register(ctx context.Context, email, password string) (*AuthResult, *apperrors.APIError) {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if normalizedEmail == "" {
		return nil, apperrors.BadRequest("invalid_email", "email is required")
	}
	if len(password) < 6 {
		return nil, apperrors.BadRequest("invalid_password", "password must be at least 6 characters")
	}

	_, err := s.userRepo.GetByEmail(ctx, normalizedEmail)
	if err == nil {
		return nil, apperrors.Conflict("email_exists", "email already registered", nil)
	}
	if err != nil && err != repository.ErrNotFound {
		return nil, apperrors.Internal("failed to query user")
	}

	passwordHashBytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, apperrors.Internal("failed to secure password")
	}

	now := time.Now().UTC()
	user := model.User{
		ID:           uuid.NewString(),
		Email:        normalizedEmail,
		PasswordHash: string(passwordHashBytes),
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if err := s.userRepo.Create(ctx, &user); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return nil, apperrors.Conflict("email_exists", "email already registered", nil)
		}
		return nil, apperrors.Internal("failed to create user")
	}

	if err := s.pomodoroRepo.CreateInitialState(ctx, user.ID); err != nil {
		return nil, apperrors.Internal("failed to initialize user state")
	}

	token, apiErr := s.issueToken(user)
	if apiErr != nil {
		return nil, apiErr
	}

	user.PasswordHash = ""
	return &AuthResult{
		Token: token,
		User:  user,
	}, nil
}

func (s *AuthService) Login(ctx context.Context, email, password string) (*AuthResult, *apperrors.APIError) {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if normalizedEmail == "" || password == "" {
		return nil, apperrors.BadRequest("invalid_credentials", "email and password are required")
	}

	user, err := s.userRepo.GetByEmail(ctx, normalizedEmail)
	if err == repository.ErrNotFound {
		return nil, apperrors.Unauthorized("invalid email or password")
	}
	if err != nil {
		return nil, apperrors.Internal("failed to query user")
	}

	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return nil, apperrors.Unauthorized("invalid email or password")
	}

	token, apiErr := s.issueToken(*user)
	if apiErr != nil {
		return nil, apiErr
	}

	user.PasswordHash = ""
	return &AuthResult{
		Token: token,
		User:  *user,
	}, nil
}

func (s *AuthService) ParseToken(tokenString string) (string, *apperrors.APIError) {
	token, err := jwt.ParseWithClaims(tokenString, &jwt.RegisteredClaims{}, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, jwt.ErrSignatureInvalid
		}
		return s.jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return "", apperrors.Unauthorized("invalid token")
	}

	claims, ok := token.Claims.(*jwt.RegisteredClaims)
	if !ok {
		return "", apperrors.Unauthorized("invalid token")
	}

	if claims.Subject == "" {
		return "", apperrors.Unauthorized("invalid token subject")
	}

	return claims.Subject, nil
}

func (s *AuthService) issueToken(user model.User) (string, *apperrors.APIError) {
	now := time.Now().UTC()
	claims := jwt.RegisteredClaims{
		Subject:   user.ID,
		ID:        uuid.NewString(),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(s.tokenTTL)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.jwtSecret)
	if err != nil {
		return "", apperrors.Internal("failed to sign token")
	}
	return signed, nil
}
