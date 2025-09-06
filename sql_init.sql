CREATE TABLE IF NOT EXISTS usuarios(
  jid text PRIMARY KEY,
  username text,
  clash_tag text,
  saldo int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mesas(
  id bigserial PRIMARY KEY,
  creador text NOT NULL,
  oponente text,
  fichas int NOT NULL,
  estado text NOT NULL DEFAULT 'abierta', -- abierta, en_juego, finalizada, cancelada
  premio int NOT NULL,
  rake int NOT NULL DEFAULT 10,
  creador_tag text,
  oponente_tag text,
  started_at timestamptz,
  ended_at timestamptz,
  ganador text,
  duracion_seg int,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS depositos(
  id bigserial PRIMARY KEY,
  jid text NOT NULL,
  monto int NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  media_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retiros(
  id bigserial PRIMARY KEY,
  jid text NOT NULL,
  monto int NOT NULL,
  cvu text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  created_at timestamptz DEFAULT now()
);
