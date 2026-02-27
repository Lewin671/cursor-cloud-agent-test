package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"pomodoro/backend/internal/model"
)

type UserRepository struct {
	db *sql.DB
}

func NewUserRepository(db *sql.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) Create(ctx context.Context, user *model.User) error {
	_, err := r.db.ExecContext(
		ctx,
		`INSERT INTO users (id, email, password_hash, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`,
		user.ID,
		user.Email,
		user.PasswordHash,
		user.CreatedAt.UTC().Format(time.RFC3339Nano),
		user.UpdatedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	row := r.db.QueryRowContext(
		ctx,
		`SELECT id, email, password_hash, created_at, updated_at
		 FROM users
		 WHERE email = ?`,
		email,
	)

	var user model.User
	var createdAt string
	var updatedAt string
	if err := row.Scan(&user.ID, &user.Email, &user.PasswordHash, &createdAt, &updatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get user by email: %w", err)
	}

	parsedCreatedAt, err := parseTime(createdAt)
	if err != nil {
		return nil, fmt.Errorf("parse user created_at: %w", err)
	}
	parsedUpdatedAt, err := parseTime(updatedAt)
	if err != nil {
		return nil, fmt.Errorf("parse user updated_at: %w", err)
	}
	user.CreatedAt = parsedCreatedAt
	user.UpdatedAt = parsedUpdatedAt

	return &user, nil
}

func (r *UserRepository) GetByID(ctx context.Context, id string) (*model.User, error) {
	row := r.db.QueryRowContext(
		ctx,
		`SELECT id, email, password_hash, created_at, updated_at
		 FROM users
		 WHERE id = ?`,
		id,
	)

	var user model.User
	var createdAt string
	var updatedAt string
	if err := row.Scan(&user.ID, &user.Email, &user.PasswordHash, &createdAt, &updatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get user by id: %w", err)
	}

	parsedCreatedAt, err := parseTime(createdAt)
	if err != nil {
		return nil, fmt.Errorf("parse user created_at: %w", err)
	}
	parsedUpdatedAt, err := parseTime(updatedAt)
	if err != nil {
		return nil, fmt.Errorf("parse user updated_at: %w", err)
	}
	user.CreatedAt = parsedCreatedAt
	user.UpdatedAt = parsedUpdatedAt

	return &user, nil
}
