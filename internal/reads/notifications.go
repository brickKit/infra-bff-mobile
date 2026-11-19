package reads

import (
	"context"
	"strconv"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
	"github.com/brickKit/infra-bff-mobile/v3/internal/model"
)

// MyNotifications is my messages and the unread count (infra/notification GET /api/notification/messages).
func (r *Reads) MyNotifications(ctx context.Context, unread *bool, cursor *string, limit *int) (*model.NotificationPage, error) {
	only := ""
	if unread != nil {
		only = strconv.FormatBool(*unread)
	}
	var out struct {
		Messages []struct {
			ID        string         `json:"id"`
			Sender    string         `json:"sender"`
			Category  string         `json:"category"`
			Title     string         `json:"title"`
			Link      string         `json:"link"`
			Template  *string        `json:"template"`
			Params    map[string]any `json:"params"`
			CreatedAt string         `json:"created_at"`
			ReadAt    *string        `json:"read_at"`
			Withdrawn bool           `json:"withdrawn"`
		} `json:"messages"`
		Unread     int    `json:"unread"`
		NextCursor string `json:"next_cursor"`
	}
	if err := r.b.Get(ctx, core.Notification, "/api/notification/messages", page(cursor, limit, "unread", only), &out); err != nil {
		return nil, err
	}
	p := &model.NotificationPage{Items: make([]model.Notification, 0, len(out.Messages)), Unread: out.Unread,
		NextCursor: out.NextCursor}
	for _, m := range out.Messages {
		p.Items = append(p.Items, model.Notification{ID: m.ID, Sender: m.Sender, Category: m.Category, Title: m.Title,
			Link: m.Link, Template: m.Template, Params: m.Params, CreatedAt: m.CreatedAt, ReadAt: m.ReadAt,
			Withdrawn: m.Withdrawn})
	}
	return p, nil
}
