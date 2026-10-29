-- Brand name changed from the placeholder to the real business name.
UPDATE settings SET value = jsonb_set(value, '{name}', '"Sydney Airport Transfers"') WHERE key = 'business' AND value->>'name' = 'SkyLine Transfers';
