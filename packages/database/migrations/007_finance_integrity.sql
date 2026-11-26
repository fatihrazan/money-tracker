CREATE TABLE transaction_requests (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload jsonb NOT NULL,
  result jsonb,
  PRIMARY KEY (user_id, request_id)
);

CREATE TABLE category_budgets (
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  effective_month date NOT NULL CHECK (extract(day FROM effective_month) = 1),
  budget bigint CHECK (budget > 0 AND budget <= 9000000000000),
  PRIMARY KEY (category_id, effective_month)
);
INSERT INTO category_budgets SELECT id, DATE '1900-01-01', budget FROM categories WHERE budget IS NOT NULL;
ALTER TABLE categories DROP COLUMN budget;
CREATE FUNCTION budget_at(category uuid, day date) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT budget FROM category_budgets WHERE category_id = category AND effective_month <= day
  ORDER BY effective_month DESC LIMIT 1
$$;
