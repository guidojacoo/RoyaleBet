create table if not exists usuarios(
  id serial primary key,
  phone text unique,
  username text,
  tag_cr text,
  saldo_fichas integer default 0,
  creado timestamptz default now()
);

create table if not exists partidas(
  id serial primary key,
  creador integer references usuarios(id),
  rival integer references usuarios(id),
  fichas integer,
  pozo_fichas integer,
  premio_fichas integer,
  estado text, -- buscando_rival | en_juego | pendiente_api | pendiente_video | liquidada | cancelada
  creado timestamptz default now(),
  started_at timestamptz,
  ended_at timestamptz,
  ganador integer references usuarios(id),
  group_msg_id text
);

create table if not exists movimientos(
  id serial primary key,
  usuario integer references usuarios(id),
  tipo text,   -- carga | bloqueo | premio | devolucion | descuento | retiro_bloq | retiro_dev
  fichas integer,
  partida integer references partidas(id),
  ts timestamptz default now()
);

create index if not exists idx_partidas_estado on partidas(estado);

-- cargas manuales con comprobante (imagen)
create table if not exists cargas(
  id serial primary key,
  usuario int references usuarios(id),
  monto_pesos int,
  referencia text,
  estado text default 'pendiente', -- pendiente | aprobada | rechazada
  media_in_id text,      -- id de media entrante (del usuario)
  media_admin_id text,   -- id re-subido por la empresa para reenviar (opcional)
  ts timestamptz default now()
);

-- retiros manejados por admin
create table if not exists retiros(
  id serial primary key,
  usuario int references usuarios(id),
  monto_pesos int,
  cvu text,
  estado text default 'pendiente', -- pendiente | pagado | rechazado
  ts timestamptz default now()
);
