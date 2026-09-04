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