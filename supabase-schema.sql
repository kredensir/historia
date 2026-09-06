-- Ejecuta esto en el SQL Editor de Supabase

CREATE TABLE sesiones_juego (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_nombre TEXT NOT NULL,
  usuario_nombre TEXT NOT NULL,
  fecha_inicio TIMESTAMPTZ DEFAULT NOW(),
  fecha_actualizacion TIMESTAMPTZ DEFAULT NOW(),
  historia_actual TEXT DEFAULT 'inicio',
  elecciones JSONB DEFAULT '[]'::jsonb,
  finalizado BOOLEAN DEFAULT FALSE
);

-- Índices para consultas frecuentes
CREATE INDEX idx_sesiones_usuario ON sesiones_juego(usuario_nombre);
CREATE INDEX idx_sesiones_fecha ON sesiones_juego(fecha_inicio DESC);

-- Función helper para agregar elecciones al array JSONB
CREATE OR REPLACE FUNCTION append_eleccion(elecciones JSONB, nueva JSONB)
RETURNS JSONB AS $$
BEGIN
  RETURN elecciones || nueva;
END;
$$ LANGUAGE plpgsql;

-- RLS (Row Level Security) - opcional, para producción
ALTER TABLE sesiones_juego ENABLE ROW LEVEL SECURITY;

-- Política: permitir insert/lectura a usuarios anónimos (ajusta según necesites)
CREATE POLICY "Permitir insert anónimo" ON sesiones_juego
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Permitir lectura propia" ON sesiones_juego
  FOR SELECT TO anon USING (true);

-- ============================================================
-- MIGRACIÓN (ejecutar si la tabla ya existe de antes)
-- ============================================================

-- Columnas para ubicación aproximada por IP
ALTER TABLE sesiones_juego ADD COLUMN IF NOT EXISTS ubicacion_pais TEXT;
ALTER TABLE sesiones_juego ADD COLUMN IF NOT EXISTS ubicacion_ciudad TEXT;

-- Política UPDATE: necesaria para guardar progreso, ubicación y finalizado
DROP POLICY IF EXISTS "Permitir update anónimo" ON sesiones_juego;
CREATE POLICY "Permitir update anónimo" ON sesiones_juego
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Calificación del capítulo (1-5 estrellas, NULL = sin calificar)
ALTER TABLE sesiones_juego ADD COLUMN IF NOT EXISTS calificacion SMALLINT
  CHECK (calificacion IS NULL OR (calificacion >= 1 AND calificacion <= 5));

-- Metadatos del entorno del jugador (navegador, SO, dispositivo, idioma, zona horaria...)
ALTER TABLE sesiones_juego ADD COLUMN IF NOT EXISTS meta_jugador JSONB DEFAULT '{}'::jsonb;
