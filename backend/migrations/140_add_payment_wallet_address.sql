-- 140_add_payment_wallet_address.sql
-- Add wallet_address column for NOWPayments crypto wallet address display
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS wallet_address TEXT;
