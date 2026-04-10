-- ================================================================
--  FLUJO DE EFECTIVO SEMANAL (EFE) — migración completa
--  Ejecutar en Supabase SQL Editor (prod y staging)
-- ================================================================

-- 1. Tablas nuevas
CREATE TABLE IF NOT EXISTS efe_items (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID          NOT NULL,
  tipo              TEXT          NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  categoria         TEXT,
  concepto          TEXT          NOT NULL DEFAULT '',
  proveedor_cliente TEXT,
  hotel             TEXT,
  destino           TEXT,
  monto             NUMERIC(15,2) NOT NULL DEFAULT 0,
  moneda            TEXT          NOT NULL DEFAULT 'MXN' CHECK (moneda IN ('MXN','USD','EUR')),
  fecha             DATE          NOT NULL,
  notas             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS efe_items_empresa_fecha ON efe_items (empresa_id, fecha);

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

-- 2. Columnas en tablas existentes (autorización EFE)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS en_efe    BOOLEAN DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS fecha_efe DATE;

ALTER TABLE ingresos ADD COLUMN IF NOT EXISTS en_efe    BOOLEAN DEFAULT FALSE;
ALTER TABLE ingresos ADD COLUMN IF NOT EXISTS fecha_efe DATE;

-- 3. RLS (igual que el resto del proyecto)
ALTER TABLE efe_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE efe_saldos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_efe_items"  ON efe_items  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_efe_saldos" ON efe_saldos FOR ALL USING (true) WITH CHECK (true);
