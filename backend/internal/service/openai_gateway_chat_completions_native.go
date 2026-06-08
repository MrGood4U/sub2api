package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/apicompat"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/Wei-Shaw/sub2api/internal/util/responseheaders"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func (s *OpenAIGatewayService) forwardNativeChatCompletions(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	body []byte,
	chatReq *apicompat.ChatCompletionsRequest,
	originalModel string,
	clientStream bool,
	includeUsage bool,
	startTime time.Time,
	defaultMappedModel string,
) (*OpenAIForwardResult, error) {
	mappedModel := account.GetMappedModel(originalModel)
	if mappedModel != "" && mappedModel != originalModel {
		chatReq.Model = mappedModel
		var err error
		body, err = json.Marshal(chatReq)
		if err != nil {
			return nil, fmt.Errorf("marshal native chat request: %w", err)
		}
	}

	token, _, err := s.GetAccessToken(ctx, account)
	if err != nil {
		return nil, fmt.Errorf("get access token: %w", err)
	}
	upstreamReq, err := s.buildNativeChatCompletionsUpstreamRequest(ctx, c, account, body, token)
	if err != nil {
		return nil, fmt.Errorf("build native chat request: %w", err)
	}

	proxyURL := ""
	if account.Proxy != nil {
		proxyURL = account.Proxy.URL()
	}
	resp, err := s.httpUpstream.Do(upstreamReq, proxyURL, account.ID, account.Concurrency)
	if err != nil {
		safeErr := sanitizeUpstreamErrorMessage(err.Error())
		setOpsUpstreamError(c, 0, safeErr, "")
		appendOpsUpstreamError(c, OpsUpstreamErrorEvent{
			Platform:           account.Platform,
			AccountID:          account.ID,
			AccountName:        account.Name,
			UpstreamStatusCode: 0,
			Kind:               "request_error",
			Message:            safeErr,
		})
		writeChatCompletionsError(c, http.StatusBadGateway, "upstream_error", "Upstream request failed")
		return nil, fmt.Errorf("upstream request failed: %s", safeErr)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		_ = resp.Body.Close()
		resp.Body = io.NopCloser(bytes.NewReader(respBody))

		upstreamMsg := strings.TrimSpace(extractUpstreamErrorMessage(respBody))
		upstreamMsg = sanitizeUpstreamErrorMessage(upstreamMsg)
		if s.shouldFailoverOpenAIUpstreamResponse(resp.StatusCode, upstreamMsg, respBody) {
			upstreamDetail := ""
			if s.cfg != nil && s.cfg.Gateway.LogUpstreamErrorBody {
				maxBytes := s.cfg.Gateway.LogUpstreamErrorBodyMaxBytes
				if maxBytes <= 0 {
					maxBytes = 2048
				}
				upstreamDetail = truncateString(string(respBody), maxBytes)
			}
			appendOpsUpstreamError(c, OpsUpstreamErrorEvent{
				Platform:           account.Platform,
				AccountID:          account.ID,
				AccountName:        account.Name,
				UpstreamStatusCode: resp.StatusCode,
				UpstreamRequestID:  resp.Header.Get("x-request-id"),
				Kind:               "failover",
				Message:            upstreamMsg,
				Detail:             upstreamDetail,
			})
			if s.rateLimitService != nil {
				s.rateLimitService.HandleUpstreamError(ctx, account, resp.StatusCode, resp.Header, respBody)
			}
			return nil, &UpstreamFailoverError{
				StatusCode:             resp.StatusCode,
				ResponseBody:           respBody,
				RetryableOnSameAccount: account.IsPoolMode() && (isPoolModeRetryableStatus(resp.StatusCode) || isOpenAITransientProcessingError(resp.StatusCode, upstreamMsg, respBody)),
			}
		}
		return s.handleChatCompletionsErrorResponse(resp, c, account)
	}

	var result *OpenAIForwardResult
	if clientStream {
		result, err = s.handleNativeChatStreamingResponse(resp, c, originalModel, mappedModel, includeUsage, startTime)
	} else {
		result, err = s.handleNativeChatJSONResponse(resp, c, originalModel, mappedModel, startTime)
	}
	if err != nil || result == nil {
		return result, err
	}

	if chatReq.ServiceTier != "" {
		st := chatReq.ServiceTier
		result.ServiceTier = &st
	}
	if chatReq.ReasoningEffort != "" {
		re := chatReq.ReasoningEffort
		result.ReasoningEffort = &re
	}
	return result, nil
}

func (s *OpenAIGatewayService) buildNativeChatCompletionsUpstreamRequest(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	body []byte,
	token string,
) (*http.Request, error) {
	baseURL := account.GetOpenAIBaseURL()
	if baseURL == "" {
		baseURL = openaiPlatformAPIURL
	}
	validatedURL, err := s.validateUpstreamBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	targetURL := buildOpenAIChatCompletionsURL(validatedURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	allowTimeoutHeaders := s.isOpenAIPassthroughTimeoutHeadersAllowed()
	if c != nil && c.Request != nil {
		for key, values := range c.Request.Header {
			lower := strings.ToLower(strings.TrimSpace(key))
			if !isOpenAIPassthroughAllowedRequestHeader(lower, allowTimeoutHeaders) {
				continue
			}
			for _, v := range values {
				req.Header.Add(key, v)
			}
		}
	}

	req.Header.Del("authorization")
	req.Header.Del("x-api-key")
	req.Header.Del("x-goog-api-key")
	req.Header.Set("authorization", "Bearer "+token)

	if customUA := account.GetOpenAIUserAgent(); customUA != "" {
		req.Header.Set("user-agent", customUA)
	}
	if req.Header.Get("accept") == "" {
		req.Header.Set("accept", "application/json")
	}
	if req.Header.Get("content-type") == "" {
		req.Header.Set("content-type", "application/json")
	}
	return req, nil
}

func (s *OpenAIGatewayService) handleNativeChatJSONResponse(
	resp *http.Response,
	c *gin.Context,
	originalModel string,
	mappedModel string,
	startTime time.Time,
) (*OpenAIForwardResult, error) {
	maxBytes := resolveUpstreamResponseReadLimit(s.cfg)
	body, err := readUpstreamResponseBodyLimited(resp.Body, maxBytes)
	if err != nil {
		if errors.Is(err, ErrUpstreamResponseBodyTooLarge) {
			setOpsUpstreamError(c, http.StatusBadGateway, "upstream response too large", "")
			writeChatCompletionsError(c, http.StatusBadGateway, "upstream_error", "Upstream response too large")
		}
		return nil, err
	}

	var chatResp apicompat.ChatCompletionsResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		return nil, fmt.Errorf("parse chat completions response: %w", err)
	}

	var usage OpenAIUsage
	if chatResp.Usage != nil {
		usage = usageFromChatCompletions(chatResp.Usage)
	}
	if originalModel != mappedModel {
		body = s.replaceModelInResponseBody(body, mappedModel, originalModel)
	}

	responseheaders.WriteFilteredHeaders(c.Writer.Header(), resp.Header, s.responseHeaderFilter)
	contentType := "application/json"
	if s.cfg != nil && !s.cfg.Security.ResponseHeaders.Enabled {
		if upstreamType := resp.Header.Get("Content-Type"); upstreamType != "" {
			contentType = upstreamType
		}
	}
	c.Data(resp.StatusCode, contentType, body)

	return &OpenAIForwardResult{
		RequestID:       resp.Header.Get("x-request-id"),
		Usage:           usage,
		Model:           originalModel,
		BillingModel:    mappedModel,
		Stream:          false,
		ResponseHeaders: resp.Header.Clone(),
		Duration:        time.Since(startTime),
	}, nil
}

func (s *OpenAIGatewayService) handleNativeChatStreamingResponse(
	resp *http.Response,
	c *gin.Context,
	originalModel string,
	mappedModel string,
	_ bool,
	startTime time.Time,
) (*OpenAIForwardResult, error) {
	requestID := resp.Header.Get("x-request-id")

	if s.responseHeaderFilter != nil {
		responseheaders.WriteFilteredHeaders(c.Writer.Header(), resp.Header, s.responseHeaderFilter)
	}
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)

	var (
		usage        OpenAIUsage
		firstTokenMs *int
		firstChunk   = true
	)
	resultWithUsage := func() *OpenAIForwardResult {
		return &OpenAIForwardResult{
			RequestID:       requestID,
			Usage:           usage,
			Model:           originalModel,
			BillingModel:    mappedModel,
			Stream:          true,
			ResponseHeaders: resp.Header.Clone(),
			Duration:        time.Since(startTime),
			FirstTokenMs:    firstTokenMs,
		}
	}

	scanner := bufio.NewScanner(resp.Body)
	maxLineSize := defaultMaxLineSize
	if s.cfg != nil && s.cfg.Gateway.MaxLineSize > 0 {
		maxLineSize = s.cfg.Gateway.MaxLineSize
	}
	scanner.Buffer(make([]byte, 0, 64*1024), maxLineSize)

	for scanner.Scan() {
		line := scanner.Text()
		if data, ok := extractOpenAISSEDataLine(line); ok {
			if data != "" && data != "[DONE]" && firstChunk {
				firstChunk = false
				ms := int(time.Since(startTime).Milliseconds())
				firstTokenMs = &ms
			}
			if data != "" && data != "[DONE]" {
				var chunk apicompat.ChatCompletionsChunk
				if err := json.Unmarshal([]byte(data), &chunk); err == nil && chunk.Usage != nil {
					usage = usageFromChatCompletions(chunk.Usage)
				}
				line = s.replaceModelInSSELine(line, mappedModel, originalModel)
			}
		}
		if _, err := fmt.Fprintln(c.Writer, line); err != nil {
			logger.L().Info("native chat_completions stream: client disconnected",
				zap.String("request_id", requestID),
			)
			return resultWithUsage(), nil
		}
		c.Writer.Flush()
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
		logger.L().Warn("native chat_completions stream: read error",
			zap.Error(err),
			zap.String("request_id", requestID),
		)
	}
	return resultWithUsage(), nil
}

func usageFromChatCompletions(usage *apicompat.ChatUsage) OpenAIUsage {
	if usage == nil {
		return OpenAIUsage{}
	}
	out := OpenAIUsage{
		InputTokens:  usage.PromptTokens,
		OutputTokens: usage.CompletionTokens,
	}
	if usage.PromptTokensDetails != nil {
		out.CacheReadInputTokens = usage.PromptTokensDetails.CachedTokens
	}
	return out
}
