-- ═══════════════════════════════════════════════════════════════
-- Tabla: bromelia_operaciones
-- Almacena los datos del Excel Bromelia con deduplicación
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bromelia_operaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id TEXT NOT NULL DEFAULT 'empresa_2',
  
  -- Llave de deduplicación (evita duplicados al acumular)
  dedup_key TEXT NOT NULL,
  
  -- Campos clave indexados
  os TEXT,
  destino TEXT,
  servicio TEXT,
  cliente TEXT,
  proveedor TEXT,
  fecha DATE,
  mes INT,
  
  -- Financieros
  ingr_con_iva NUMERIC DEFAULT 0,
  ingr_sin_iva NUMERIC DEFAULT 0,
  egrs_con_iva NUMERIC DEFAULT 0,
  egrs_sin_iva NUMERIC DEFAULT 0,
  margen NUMERIC DEFAULT 0,
  margen_sin_iva NUMERIC DEFAULT 0,
  
  -- Estado
  estado_prov TEXT,
  estado_cli TEXT,
  factura_prov TEXT,
  factura_cli TEXT,
  facturado BOOLEAN DEFAULT FALSE,
  total_fact_mx NUMERIC DEFAULT 0,
  total_fact_usd NUMERIC DEFAULT 0,
  so TEXT,
  
  -- Datos crudos del Excel completos (JSONB)
  raw_data JSONB NOT NULL,
  
  -- Metadata
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  uploaded_by TEXT,
  
  -- Unique constraint para deduplicación
  CONSTRAINT bromelia_dedup UNIQUE (empresa_id, dedup_key)
);

-- Índices para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_bromelia_empresa ON bromelia_operaciones(empresa_id);
CREATE INDEX IF NOT EXISTS idx_bromelia_fecha ON bromelia_operaciones(fecha);
CREATE INDEX IF NOT EXISTS idx_bromelia_cliente ON bromelia_operaciones(cliente);
CREATE INDEX IF NOT EXISTS idx_bromelia_servicio ON bromelia_operaciones(servicio);
CREATE INDEX IF NOT EXISTS idx_bromelia_destino ON bromelia_operaciones(destino);

-- RLS (opcional, deshabilitado por defecto como las demás tablas)
-- ALTER TABLE bromelia_operaciones ENABLE ROW LEVEL SECURITY;
