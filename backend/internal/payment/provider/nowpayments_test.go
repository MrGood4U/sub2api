package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/payment"
	"github.com/stretchr/testify/require"
)

func TestNOWPaymentsAvailableCurrenciesAndResolution(t *testing.T) {
	t.Parallel()

	prov, err := NewNOWPayments("test", map[string]string{
		"apiKey":       "dummy-key",
		"ipnSecret":    "dummy-secret",
		"fiatCurrency": "USD,EUR,JPY",
		"payCurrency":  "usdttrc20,usdterc20,usdtbsc",
	})
	require.NoError(t, err)

	require.Equal(t, []string{"USD", "EUR", "JPY"}, prov.availableFiatCurrencies())
	require.Equal(t, []string{"usdttrc20", "usdterc20", "usdtbsc"}, prov.availablePayCurrencies())
	require.Equal(t, "usdterc20", prov.resolvePayCurrency("USDTerc20"))
	require.Equal(t, "usdttrc20", prov.resolvePayCurrency("btc"))
}

func TestNOWPaymentsQueryOrderAcceptsNumericPaymentID(t *testing.T) {
	t.Parallel()

	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/payment/5746123873", r.URL.Path)
		require.Equal(t, "dummy-key", r.Header.Get("x-api-key"))
		_, _ = w.Write([]byte(`{
			"payment_id":5746123873,
			"payment_status":"finished",
			"pay_address":"TYKJ5KQiEeoaMpHuLwzGVUPQz22h3gFssb",
			"price_amount":100,
			"price_currency":"usd",
			"pay_amount":99.895183,
			"pay_currency":"usdttrc20"
		}`))
	}))
	defer server.Close()

	prov, err := NewNOWPayments("test", map[string]string{
		"apiKey":    "dummy-key",
		"ipnSecret": "dummy-secret",
	})
	require.NoError(t, err)
	prov.config["apiBase"] = server.URL
	prov.httpClient = server.Client()

	resp, err := prov.QueryOrder(context.Background(), "5746123873")
	require.NoError(t, err)
	require.Equal(t, "5746123873", resp.TradeNo)
	require.Equal(t, payment.ProviderStatusPaid, resp.Status)
	require.Equal(t, 100.0, resp.Amount)
	require.Equal(t, "usdttrc20", resp.Metadata["pay_currency"])
	require.Equal(t, "usd", resp.Metadata["price_currency"])
}
