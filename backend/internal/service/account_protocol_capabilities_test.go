package service

import "testing"

func TestSupportsOpenAIResponsesAPI(t *testing.T) {
	tests := []struct {
		name    string
		account *Account
		want    bool
	}{
		{
			name: "openai oauth supports responses",
			account: &Account{
				Platform: PlatformOpenAI,
				Type:     AccountTypeOAuth,
			},
			want: true,
		},
		{
			name: "openai api key official host supports responses",
			account: &Account{
				Platform: PlatformOpenAI,
				Type:     AccountTypeAPIKey,
				Credentials: map[string]any{
					"base_url": "https://api.openai.com/v1",
				},
			},
			want: true,
		},
		{
			name: "deepseek openai compatible host does not support responses",
			account: &Account{
				Platform: PlatformDeepSeek,
				Type:     AccountTypeAPIKey,
				Credentials: map[string]any{
					"base_url": "https://api.deepseek.com",
				},
			},
			want: false,
		},
		{
			name: "deepseek anthropic host is not openai responses capable",
			account: &Account{
				Platform: PlatformDeepSeek,
				Type:     AccountTypeAPIKey,
				Credentials: map[string]any{
					"base_url": "https://api.deepseek.com/anthropic",
				},
			},
			want: false,
		},
		{
			name: "glm openai compatible host does not support responses",
			account: &Account{
				Platform: PlatformGLM,
				Type:     AccountTypeAPIKey,
				Credentials: map[string]any{
					"base_url": "https://open.bigmodel.cn/api/paas/v4",
				},
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.account.SupportsOpenAIResponsesAPI(); got != tt.want {
				t.Fatalf("SupportsOpenAIResponsesAPI() = %v, want %v", got, tt.want)
			}
		})
	}
}
