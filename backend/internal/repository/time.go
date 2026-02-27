package repository

import "time"

func parseTime(raw string) (time.Time, error) {
	if raw == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse(time.RFC3339Nano, raw)
	if err == nil {
		return t.UTC(), nil
	}
	t, err = time.Parse(time.RFC3339, raw)
	if err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, err
}
