CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('SALE','DATA')),
  item TEXT NOT NULL,
  qty NUMERIC,
  investment NUMERIC,
  price NUMERIC,
  total NUMERIC NOT NULL,
  profit NUMERIC,
  status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETURNED')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_item ON sales(item);
CREATE INDEX IF NOT EXISTS idx_sales_type ON sales(type);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_date_type ON sales(date, type);

ALTER TABLE sales
  ADD CONSTRAINT chk_qty_positive CHECK (qty IS NULL OR qty > 0),
  ADD CONSTRAINT chk_price_positive CHECK (price IS NULL OR price >= 0),
  ADD CONSTRAINT chk_investment_positive CHECK (investment IS NULL OR investment >= 0),
  ADD CONSTRAINT chk_total_positive CHECK (total >= 0),
  ADD CONSTRAINT chk_profit_valid CHECK (profit IS NULL OR profit >= 0);
