package provider

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/payment"
	"github.com/shopspring/decimal"
)

// NOWPayments constants.
const (
	nowpaymentsDefaultAPIBase   = "https://api.nowpayments.io/v1"
	nowpaymentsSandboxAPIBase   = "https://api-sandbox.nowpayments.io/v1"
	nowpaymentsHTTPTimeout      = 20 * time.Second
	nowpaymentsMaxResponseSize  = 1 << 20
	nowpaymentsMaxErrorSummary  = 512
	nowpaymentsWebhookTolerance = 5 * time.Minute

	nowpaymentsDefaultPayCurrency  = "usdttrc20"
	nowpaymentsDefaultFiatCurrency = "USD"

	// Payment statuses from NOWPayments API.
	nowpaymentsStatusWaiting       = "waiting"
	nowpaymentsStatusConfirming    = "confirming"
	nowpaymentsStatusConfirmed     = "confirmed"
	nowpaymentsStatusSending       = "sending"
	nowpaymentsStatusPartiallyPaid = "partially_paid"
	nowpaymentsStatusFinished      = "finished"
	nowpaymentsStatusFailed        = "failed"
	nowpaymentsStatusExpired       = "expired"

	// IPN payment statuses.
	nowpaymentsIPNStatusFinished = "finished"
	nowpaymentsIPNStatusFailed   = "failed"
)

// knownNOWPaymentsCurrencies is the set of pay_currency values the admin UI
// presents as a dropdown. Other values can still be entered as custom input.
var knownNOWPaymentsCurrencies = []string{
	"usdttrc20", // USDT (TRC-20 / TRON)
	"usdterc20", // USDT (ERC-20 / Ethereum)
	"usdtbsc",   // USDT (BEP-20 / BSC)
	"usdc",      // USDC (Ethereum)
	"usdcmatic", // USDC (Polygon/MATIC)
}

// knownNOWPaymentsFiatCurrencies is the set of fiat currencies for price anchoring.
var knownNOWPaymentsFiatCurrencies = []string{
	"CNY", "USD", "EUR", "GBP", "JPY", "KRW", "HKD", "SGD", "AUD", "CAD", "NZD",
}

// NOWPayments implements payment.Provider for NOWPayments cryptocurrency gateway.
type NOWPayments struct {
	instanceID string
	config     map[string]string // apiKey, ipnSecret, apiBase, payCurrency, fiatCurrency, gasFee
	httpClient *http.Client
}

// NewNOWPayments creates a new NOWPayments provider instance.
// Required config keys: apiKey, ipnSecret
// Optional config keys: apiBase (default: https://api.nowpayments.io/v1),
// payCurrency (default: usdttrc20), fiatCurrency (default: USD)
func NewNOWPayments(instanceID string, config map[string]string) (*NOWPayments, error) {
	for _, k := range []string{"apiKey", "ipnSecret"} {
		if strings.TrimSpace(config[k]) == "" {
			return nil, fmt.Errorf("nowpayments config missing required key: %s", k)
		}
	}

	cfg := cloneStringMap(config)

	apiBase, err := normalizeNOWPaymentsAPIBase(cfg["apiBase"])
	if err != nil {
		return nil, err
	}
	cfg["apiBase"] = apiBase

	payCurrency := normalizeNOWPaymentsPayCurrency(cfg["payCurrency"])
	cfg["payCurrency"] = payCurrency

	fiatCurrency := normalizeNOWPaymentsFiatCurrency(cfg["fiatCurrency"])
	cfg["fiatCurrency"] = fiatCurrency

	return &NOWPayments{
		instanceID: instanceID,
		config:     cfg,
		httpClient: &http.Client{Timeout: nowpaymentsHTTPTimeout},
	}, nil
}

func normalizeNOWPaymentsAPIBase(raw string) (string, error) {
	base := strings.TrimSpace(raw)
	if base == "" {
		return nowpaymentsDefaultAPIBase, nil
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return "", fmt.Errorf("nowpayments apiBase must be an HTTPS URL")
	}
	host := strings.ToLower(parsed.Host)
	if host != "api.nowpayments.io" && host != "api-sandbox.nowpayments.io" {
		return "", fmt.Errorf("nowpayments apiBase must be api.nowpayments.io or api-sandbox.nowpayments.io")
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	parsed.RawPath = ""
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if parsed.Path == "" {
		return base, nil
	}
	return parsed.String(), nil
}

func normalizeNOWPaymentsPayCurrency(raw string) string {
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" {
		return nowpaymentsDefaultPayCurrency
	}
	return raw
}

func normalizeNOWPaymentsFiatCurrency(raw string) string {
	raw = strings.ToUpper(strings.TrimSpace(raw))
	if raw == "" {
		return nowpaymentsDefaultFiatCurrency
	}
	return raw
}

// --- Provider interface ---

func (n *NOWPayments) Name() string        { return "NOWPayments" }
func (n *NOWPayments) ProviderKey() string { return payment.TypeNowPayments }
func (n *NOWPayments) SupportedTypes() []payment.PaymentType {
	return []payment.PaymentType{payment.TypeNowPayments}
}

func (n *NOWPayments) MerchantIdentityMetadata() map[string]string {
	if n == nil {
		return nil
	}
	return map[string]string{
		"pay_currency":  n.payCurrency(),
		"fiat_currency": n.fiatCurrency(),
	}
}

func (n *NOWPayments) payCurrency() string {
	if n == nil {
		return nowpaymentsDefaultPayCurrency
	}
	return normalizeNOWPaymentsPayCurrency(n.config["payCurrency"])
}

func (n *NOWPayments) fiatCurrency() string {
	return nowpaymentsDefaultFiatCurrency
}

// availablePayCurrencies returns the set of pay_currency values configured
// for this instance. The admin config may contain a single value or a
// comma-separated list. Returns deduplicated, normalized values.
func (n *NOWPayments) availablePayCurrencies() []string {
	raw := strings.TrimSpace(n.config["payCurrency"])
	if raw == "" {
		return []string{nowpaymentsDefaultPayCurrency}
	}
	seen := make(map[string]bool)
	var out []string
	for _, token := range strings.Split(raw, ",") {
		cur := normalizeNOWPaymentsPayCurrency(token)
		if cur == "" || seen[cur] {
			continue
		}
		seen[cur] = true
		out = append(out, cur)
	}
	if len(out) == 0 {
		return []string{nowpaymentsDefaultPayCurrency}
	}
	return out
}

func (n *NOWPayments) availableFiatCurrencies() []string {
	raw := strings.TrimSpace(n.config["fiatCurrency"])
	if raw == "" {
		return []string{nowpaymentsDefaultFiatCurrency}
	}
	seen := make(map[string]bool)
	var out []string
	for _, token := range strings.Split(raw, ",") {
		cur := normalizeNOWPaymentsFiatCurrency(token)
		if cur == "" || seen[cur] {
			continue
		}
		seen[cur] = true
		out = append(out, cur)
	}
	if len(out) == 0 {
		return []string{nowpaymentsDefaultFiatCurrency}
	}
	return out
}

// resolvePayCurrency picks the pay_currency for CreatePayment:
// if the user selected a specific network, validate and use it;
// otherwise fall back to the first configured currency.
func (n *NOWPayments) resolvePayCurrency(userSelected string) string {
	available := n.availablePayCurrencies()
	userSelected = normalizeNOWPaymentsPayCurrency(userSelected)
	if userSelected != "" {
		for _, c := range available {
			if c == userSelected {
				return c
			}
		}
	}
	return available[0]
}

// --- CreatePayment ---

// nowpaymentsCreatePaymentRequest is the JSON body for POST /v1/payment.
type nowpaymentsCreatePaymentRequest struct {
	PriceAmount      decimal.Decimal `json:"price_amount"`
	PriceCurrency    string          `json:"price_currency"`
	PayCurrency      string          `json:"pay_currency"`
	OrderID          string          `json:"order_id"`
	OrderDescription string          `json:"order_description,omitempty"`
	IPNCallbackURL   string          `json:"ipn_callback_url,omitempty"`
	SuccessURL       string          `json:"success_url,omitempty"`
	CancelURL        string          `json:"cancel_url,omitempty"`
}

// nowpaymentsCreatePaymentResponse is the JSON response from POST /v1/payment.
type nowpaymentsCreatePaymentResponse struct {
	PaymentID     string          `json:"payment_id"`
	PaymentStatus string          `json:"payment_status"`
	PayAddress    string          `json:"pay_address"`
	PayAmount     decimal.Decimal `json:"pay_amount"`
	PayCurrency   string          `json:"pay_currency"`
	PriceAmount   decimal.Decimal `json:"price_amount"`
	PriceCurrency string          `json:"price_currency"`
	PayURL        string          `json:"pay_url"`
}

// nowpaymentsJSONError is a generic error shape from the NOWPayments API.
type nowpaymentsJSONError struct {
	Message string `json:"message"`
}

func (n *NOWPayments) CreatePayment(ctx context.Context, req payment.CreatePaymentRequest) (*payment.CreatePaymentResponse, error) {
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || amount.LessThanOrEqual(decimal.Zero) {
		return nil, fmt.Errorf("nowpayments create payment: invalid amount %s", req.Amount)
	}

	fiatCurrency := n.fiatCurrency()
	payCurrency := n.resolvePayCurrency(req.PayCurrency)

	notifyURL := req.NotifyURL
	if notifyURL == "" {
		notifyURL = n.config["notifyUrl"]
	}

	payload := nowpaymentsCreatePaymentRequest{
		PriceAmount:      amount,
		PriceCurrency:    fiatCurrency,
		PayCurrency:      payCurrency,
		OrderID:          req.OrderID,
		OrderDescription: req.Subject,
		IPNCallbackURL:   notifyURL,
		SuccessURL:       req.ReturnURL,
		CancelURL:        req.ReturnURL,
	}

	var resp nowpaymentsCreatePaymentResponse
	if err := n.doJSON(ctx, http.MethodPost, "/payment", payload, &resp); err != nil {
		return nil, fmt.Errorf("nowpayments create payment: %w", err)
	}

	if strings.TrimSpace(resp.PaymentID) == "" {
		return nil, fmt.Errorf("nowpayments create payment: missing payment_id in response")
	}

	payURL := strings.TrimSpace(resp.PayURL)
	walletAddress := strings.TrimSpace(resp.PayAddress)

	return &payment.CreatePaymentResponse{
		TradeNo:        resp.PaymentID,
		PayURL:         payURL,
		WalletAddress:  walletAddress,
		CryptoAmount:   resp.PayAmount.String(),
		CryptoCurrency: resp.PayCurrency,
	}, nil
}

// --- QueryOrder ---

// nowpaymentsQueryResponse is the JSON returned by GET /v1/payment/{id}.
type nowpaymentsQueryResponse struct {
	PaymentID     string          `json:"payment_id"`
	PaymentStatus string          `json:"payment_status"`
	PayAddress    string          `json:"pay_address"`
	PayAmount     decimal.Decimal `json:"pay_amount"`
	PayCurrency   string          `json:"pay_currency"`
	PriceAmount   decimal.Decimal `json:"price_amount"`
	PriceCurrency string          `json:"price_currency"`
}

func (n *NOWPayments) QueryOrder(ctx context.Context, tradeNo string) (*payment.QueryOrderResponse, error) {
	paymentID := strings.TrimSpace(tradeNo)
	if paymentID == "" {
		return nil, fmt.Errorf("nowpayments query order: missing payment_id")
	}

	var resp nowpaymentsQueryResponse
	if err := n.doJSON(ctx, http.MethodGet, "/payment/"+url.PathEscape(paymentID), nil, &resp); err != nil {
		return nil, fmt.Errorf("nowpayments query order: %w", err)
	}

	amount, _ := resp.PriceAmount.Float64()
	return &payment.QueryOrderResponse{
		TradeNo: resp.PaymentID,
		Status:  nowpaymentsProviderStatus(resp.PaymentStatus),
		Amount:  amount,
		Metadata: map[string]string{
			"pay_currency":   resp.PayCurrency,
			"price_currency": resp.PriceCurrency,
			"status":         resp.PaymentStatus,
		},
	}, nil
}

func nowpaymentsProviderStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case nowpaymentsStatusFinished:
		return payment.ProviderStatusPaid
	case nowpaymentsStatusFailed, nowpaymentsStatusExpired:
		return payment.ProviderStatusFailed
	default:
		return payment.ProviderStatusPending
	}
}

// --- VerifyNotification (IPN Webhook) ---

// nowpaymentsIPNPayload is the JSON body sent by NOWPayments IPN.
type nowpaymentsIPNPayload struct {
	PaymentID     json.Number     `json:"payment_id"`
	PaymentStatus string          `json:"payment_status"`
	PayAddress    string          `json:"pay_address"`
	PriceAmount   decimal.Decimal `json:"price_amount"`
	PriceCurrency string          `json:"price_currency"`
	PayAmount     decimal.Decimal `json:"pay_amount"`
	PayCurrency   string          `json:"pay_currency"`
	OrderID       string          `json:"order_id"`
}

func (n *NOWPayments) VerifyNotification(_ context.Context, rawBody string, headers map[string]string) (*payment.PaymentNotification, error) {
	if err := verifyNOWPaymentsIPNSignature(rawBody, headers, n.config["ipnSecret"], time.Now()); err != nil {
		return nil, err
	}

	var payload nowpaymentsIPNPayload
	if err := json.Unmarshal([]byte(rawBody), &payload); err != nil {
		return nil, fmt.Errorf("nowpayments parse ipn: %w", err)
	}

	status := strings.TrimSpace(strings.ToLower(payload.PaymentStatus))
	switch status {
	case nowpaymentsIPNStatusFinished, nowpaymentsIPNStatusFailed:
	default:
		// Only act on terminal states; intermediate states (confirming, sending)
		// are informational and should not trigger fulfillment.
		return nil, nil
	}

	if strings.TrimSpace(payload.PaymentID.String()) == "" {
		return nil, fmt.Errorf("nowpayments ipn missing payment_id")
	}

	notifStatus := payment.ProviderStatusFailed
	if status == nowpaymentsIPNStatusFinished {
		notifStatus = payment.NotificationStatusSuccess
	}

	amount, _ := payload.PriceAmount.Float64()
	return &payment.PaymentNotification{
		TradeNo: payload.PaymentID.String(),
		OrderID: payload.OrderID,
		Amount:  amount,
		Status:  notifStatus,
		RawData: rawBody,
		Metadata: map[string]string{
			"pay_currency":   payload.PayCurrency,
			"price_currency": payload.PriceCurrency,
		},
	}, nil
}

// verifyNOWPaymentsIPNSignature validates the x-nowpayments-sig header against
// the raw request body using HMAC-SHA512 with the configured ipnSecret.
func verifyNOWPaymentsIPNSignature(rawBody string, headers map[string]string, secret string, now time.Time) error {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return fmt.Errorf("nowpayments ipnSecret not configured")
	}

	signature := strings.TrimSpace(headers["x-nowpayments-sig"])
	if signature == "" {
		return fmt.Errorf("nowpayments ipn missing x-nowpayments-sig header")
	}

	mac := hmac.New(sha512.New, []byte(secret))
	_, _ = mac.Write([]byte(rawBody))
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return fmt.Errorf("nowpayments invalid ipn signature")
	}

	return nil
}

// --- Refund (via Payout API) ---

// nowpaymentsCreatePayoutRequest is the JSON body for POST /v1/payout.
type nowpaymentsCreatePayoutRequest struct {
	Address        string          `json:"address"`
	Currency       string          `json:"currency"`
	Amount         decimal.Decimal `json:"amount"`
	IPNCallbackURL string          `json:"ipn_callback_url,omitempty"`
}

// nowpaymentsPayoutResponse is the JSON returned by POST /v1/payout.
type nowpaymentsPayoutResponse struct {
	ID       string          `json:"id"`
	Status   string          `json:"status"`
	Address  string          `json:"address"`
	Currency string          `json:"currency"`
	Amount   decimal.Decimal `json:"amount"`
	BatchID  string          `json:"batch_id"`
}

func (n *NOWPayments) Refund(ctx context.Context, req payment.RefundRequest) (*payment.RefundResponse, error) {
	// For NOWPayments, refunds are processed as payouts to the customer's
	// wallet. The refund reason should contain the customer's return address
	// when known, or the payout will be sent back to the original pay_address.
	// Gas / network fees are paid by the merchant's NOWPayments balance.
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || amount.LessThanOrEqual(decimal.Zero) {
		return nil, fmt.Errorf("nowpayments refund: invalid amount %s", req.Amount)
	}

	paymentID := strings.TrimSpace(req.TradeNo)
	if paymentID == "" {
		return nil, fmt.Errorf("nowpayments refund: missing payment_id")
	}

	// Look up the original payment to get the pay_address and currency.
	var queryResp nowpaymentsQueryResponse
	if err := n.doJSON(ctx, http.MethodGet, "/payment/"+url.PathEscape(paymentID), nil, &queryResp); err != nil {
		return nil, fmt.Errorf("nowpayments refund lookup payment: %w", err)
	}

	// Build the refund address from the original pay_address (the merchant
	// sends crypto back to where it came from). If the admin provides a
	// different address in the reason field, that override is not yet
	// supported — we always return to the original deposit address.
	returnAddress := strings.TrimSpace(queryResp.PayAddress)
	if returnAddress == "" {
		return nil, fmt.Errorf("nowpayments refund: original payment has no pay_address")
	}

	payload := nowpaymentsCreatePayoutRequest{
		Address:  returnAddress,
		Currency: strings.TrimSpace(queryResp.PayCurrency),
		Amount:   amount,
	}

	var payoutResp nowpaymentsPayoutResponse
	if err := n.doJSON(ctx, http.MethodPost, "/payout", payload, &payoutResp); err != nil {
		return nil, fmt.Errorf("nowpayments refund payout: %w", err)
	}

	if strings.TrimSpace(payoutResp.ID) == "" {
		return nil, fmt.Errorf("nowpayments refund payout: missing payout id in response")
	}

	status := payment.ProviderStatusPending
	if strings.EqualFold(strings.TrimSpace(payoutResp.Status), "finished") {
		status = payment.ProviderStatusSuccess
	}

	return &payment.RefundResponse{
		RefundID: payoutResp.ID,
		Status:   status,
	}, nil
}

// --- CancelPayment ---

func (n *NOWPayments) CancelPayment(ctx context.Context, tradeNo string) error {
	// NOWPayments does not have an explicit cancel API for payments.
	// Expired / failed payments are automatically handled.
	// We simply acknowledge this as a no-op for the interface contract.
	_ = ctx
	_ = tradeNo
	return nil
}

// --- HTTP helpers ---

func (n *NOWPayments) doJSON(ctx context.Context, method, path string, payload any, out any) error {
	var bodyReader io.Reader
	if payload != nil {
		body, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("nowpayments marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, n.apiBase()+path, bodyReader)
	if err != nil {
		return fmt.Errorf("nowpayments create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", n.config["apiKey"])

	rawBody, status, err := n.do(req)
	if err != nil {
		return err
	}
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return fmt.Errorf("nowpayments HTTP %d: %s", status, summarizeNOWPaymentsResponse(rawBody))
	}
	if out == nil || len(bytes.TrimSpace(rawBody)) == 0 {
		return nil
	}
	if err := json.Unmarshal(rawBody, out); err != nil {
		return fmt.Errorf("nowpayments parse response: %w", err)
	}
	return nil
}

func (n *NOWPayments) do(req *http.Request) ([]byte, int, error) {
	client := n.httpClient
	if client == nil {
		client = &http.Client{Timeout: nowpaymentsHTTPTimeout}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("nowpayments request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, nowpaymentsMaxResponseSize))
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("nowpayments read response: %w", err)
	}
	return body, resp.StatusCode, nil
}

func (n *NOWPayments) apiBase() string {
	if n == nil {
		return nowpaymentsDefaultAPIBase
	}
	base := strings.TrimSpace(n.config["apiBase"])
	if base == "" {
		return nowpaymentsDefaultAPIBase
	}
	return base
}

func summarizeNOWPaymentsResponse(body []byte) string {
	// Try to extract a structured error message first.
	var errResp nowpaymentsJSONError
	if json.Unmarshal(body, &errResp) == nil && strings.TrimSpace(errResp.Message) != "" {
		return errResp.Message
	}
	summary := strings.Join(strings.Fields(string(body)), " ")
	if summary == "" {
		return "<empty>"
	}
	if len(summary) > nowpaymentsMaxErrorSummary {
		return summary[:nowpaymentsMaxErrorSummary] + "..."
	}
	return summary
}

// --- Compile-time interface checks ---

var (
	_ payment.Provider                 = (*NOWPayments)(nil)
	_ payment.CancelableProvider       = (*NOWPayments)(nil)
	_ payment.MerchantIdentityProvider = (*NOWPayments)(nil)
)
