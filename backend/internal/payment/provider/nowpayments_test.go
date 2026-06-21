package provider

import (
	"testing"

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
