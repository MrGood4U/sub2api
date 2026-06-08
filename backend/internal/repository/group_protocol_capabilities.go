package repository

import (
	"context"
	"encoding/json"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/lib/pq"
)

func applyGroupProtocolCapabilities(ctx context.Context, sqlq sqlExecutor, groups []*service.Group) error {
	if len(groups) == 0 {
		return nil
	}

	groupIDs := make([]int64, 0, len(groups))
	groupByID := make(map[int64]*service.Group, len(groups))
	for _, group := range groups {
		if group == nil || group.ID <= 0 {
			continue
		}
		groupIDs = append(groupIDs, group.ID)
		groupByID[group.ID] = group
	}
	if len(groupIDs) == 0 {
		return nil
	}

	rows, err := sqlq.QueryContext(ctx, `
		SELECT ag.group_id, a.platform, a.type, a.credentials
		FROM account_groups ag
		JOIN accounts a ON a.id = ag.account_id
		WHERE ag.group_id = ANY($1) AND a.deleted_at IS NULL
	`, pq.Array(groupIDs))
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var (
			groupID     int64
			platform    string
			accountType string
			rawCreds    []byte
		)
		if err := rows.Scan(&groupID, &platform, &accountType, &rawCreds); err != nil {
			return err
		}

		group := groupByID[groupID]
		if group == nil {
			continue
		}

		var credentials map[string]any
		if len(rawCreds) > 0 {
			if err := json.Unmarshal(rawCreds, &credentials); err != nil {
				return err
			}
		}

		account := &service.Account{
			Platform:    platform,
			Type:        accountType,
			Credentials: credentials,
		}
		if account.IsOpenAI() {
			group.SupportsOpenAIChatCompletions = true
			if account.SupportsOpenAIResponsesAPI() {
				group.SupportsOpenAIResponses = true
			}
		}
		if account.IsAnthropic() {
			group.SupportsAnthropicMessages = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, group := range groups {
		if group == nil {
			continue
		}
		if group.Platform == service.PlatformOpenAI &&
			group.AllowMessagesDispatch &&
			group.SupportsOpenAIResponses {
			group.SupportsAnthropicMessages = true
		}
	}

	return nil
}
