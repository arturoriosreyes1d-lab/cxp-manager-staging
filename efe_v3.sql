-- ================================================================
--  EFE v3 — Plantilla fija + Valores por celda + Tipo de cambio
--  Ejecutar en Supabase SQL Editor (prod y staging)
--  ACUMULATIVO: incluye todo lo del script anterior
-- ================================================================

-- 1. Tablas base (si no existen)
CREATE TABLE IF NOT EXISTS efe_items (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID          NOT NULL,
  tipo              TEXT          NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  categoria         TEXT, concepto TEXT NOT NULL DEFAULT '',
  proveedor_cliente TEXT, hotel TEXT, destino TEXT,
  monto             NUMERIC(15,2) NOT NULL DEFAULT 0,
  moneda            TEXT          NOT NULL DEFAULT 'MXN',
  fecha             DATE          NOT NULL,
  notas             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS efe_saldos (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID          NOT NULL,
  semana      DATE          NOT NULL,
  saldo_mxn   NUMERIC(15,2) NOT NULL DEFAULT 0,
  saldo_usd   NUMERIC(15,2) NOT NULL DEFAULT 0,
  saldo_eur   NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, semana)
);

-- 2. Columnas en tablas existentes
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS en_efe    BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fecha_efe DATE;
ALTER TABLE ingresos ADD COLUMN IF NOT EXISTS en_efe    BOOLEAN DEFAULT FALSE;
ALTER TABLE ingresos ADD COLUMN IF NOT EXISTS fecha_efe DATE;

-- 3. Tipo de cambio en saldos
ALTER TABLE efe_saldos ADD COLUMN IF NOT EXISTS tc_usd NUMERIC(10,4) DEFAULT 17.0000;
ALTER TABLE efe_saldos ADD COLUMN IF NOT EXISTS tc_eur NUMERIC(10,4) DEFAULT 20.5000;

-- 4. Plantilla fija del EFE (catálogo de filas)
CREATE TABLE IF NOT EXISTS efe_plantilla (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID        NOT NULL,
  tipo        TEXT        NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  categoria   TEXT        NOT NULL DEFAULT '',
  segmento    TEXT        NOT NULL DEFAULT '',
  nombre      TEXT        NOT NULL,
  moneda      TEXT        NOT NULL DEFAULT 'MXN' CHECK (moneda IN ('MXN','USD','EUR')),
  orden       INT         NOT NULL DEFAULT 0,
  activo      BOOLEAN     NOT NULL DEFAULT TRUE,
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS efe_plantilla_empresa ON efe_plantilla (empresa_id, tipo, orden);

-- 5. Valores por celda (plantilla_id × fecha)
CREATE TABLE IF NOT EXISTS efe_valores (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID          NOT NULL,
  plantilla_id UUID          NOT NULL REFERENCES efe_plantilla(id) ON DELETE CASCADE,
  fecha        DATE          NOT NULL,
  monto        NUMERIC(15,2) NOT NULL DEFAULT 0,
  notas        TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (plantilla_id, fecha)
);
CREATE INDEX IF NOT EXISTS efe_valores_plantilla_fecha ON efe_valores (plantilla_id, fecha);

-- 6. RLS
ALTER TABLE efe_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE efe_saldos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE efe_plantilla   ENABLE ROW LEVEL SECURITY;
ALTER TABLE efe_valores     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_efe_items"      ON efe_items;
DROP POLICY IF EXISTS "allow_all_efe_saldos"     ON efe_saldos;
DROP POLICY IF EXISTS "allow_all_efe_plantilla"  ON efe_plantilla;
DROP POLICY IF EXISTS "allow_all_efe_valores"    ON efe_valores;

CREATE POLICY "allow_all_efe_items"      ON efe_items      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_efe_saldos"     ON efe_saldos     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_efe_plantilla"  ON efe_plantilla  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_efe_valores"    ON efe_valores    FOR ALL USING (true) WITH CHECK (true);
