-- Кляссер: схема D1. Повторяет server.js + счётчик неверных PIN + таблица для фото в режиме STORAGE="d1".
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pin_salt TEXT NOT NULL,                  -- hex, 16 случайных байт
  pin_hash TEXT NOT NULL,                  -- hex, PBKDF2-SHA256, 10 000 итераций
  pin_ver INTEGER NOT NULL DEFAULT 1,      -- меняется при смене PIN → старые входы на других устройствах слетают
  pin_fails INTEGER NOT NULL DEFAULT 0,    -- неверных PIN подряд
  locked_until INTEGER NOT NULL DEFAULT 0, -- мс с 1970; до этого момента вход закрыт
  state TEXT,                              -- JSON: лента, буфер, настройки, ручная разметка
  rev INTEGER NOT NULL DEFAULT 0,          -- версия state для защиты от одновременной правки
  created_at INTEGER NOT NULL
);

CREATE TABLE photos (
  acc TEXT NOT NULL,
  id TEXT NOT NULL,
  meta TEXT NOT NULL,                      -- JSON: размеры, обрезка, автопризнаки
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (acc, id)
);

-- только для STORAGE="d1": сами JPEG (kind = 'src' | 'thumb'), до ~1,9 МБ каждый
CREATE TABLE photo_files (
  acc TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (acc, id, kind)
);
