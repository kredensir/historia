import { createClient } from '@supabase/supabase-js'

// ============================================
// CONFIGURACIÓN SUPABASE
// ============================================
// 1. Ve a https://supabase.com/dashboard
// 2. Crea un proyecto nuevo
// 3. Ve a Settings > API
// 4. Copia "Project URL" y "anon public" key
// 5. Reemplaza los valores de abajo:

const SUPABASE_URL = 'https://TU_PROYECTO.supabase.co'
const SUPABASE_ANON_KEY = 'TU_ANON_KEY_AQUI'

// ============================================
// CLIENTE
// ============================================
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ============================================
// FUNCIONES DE BD
// ============================================

/**
 * Guarda una nueva sesión de juego
 * @param {Object} datos - { botNombre, usuarioNombre }
 * @returns {Promise<Object>} Sesión creada con ID
 */
export async function guardarSesion(datos) {
  const { data, error } = await supabase
    .from('sesiones_juego')
    .insert([
      {
        bot_nombre: datos.botNombre,
        usuario_nombre: datos.usuarioNombre,
        fecha_inicio: new Date().toISOString(),
        historia_actual: 'inicio',
        elecciones: []
      }
    ])
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Actualiza la sesión con una nueva elección
 * @param {string} sesionId - ID de la sesión
 * @param {Object} eleccion - { nodoActual, textoOpcion, timestamp }
 */
export async function actualizarEleccion(sesionId, eleccion) {
  // Obtener sesión actual para append al array
  const { data: sesion, error: errGet } = await supabase
    .from('sesiones_juego')
    .select('elecciones')
    .eq('id', sesionId)
    .single()

  if (errGet) throw errGet

  const nuevasElecciones = [...(sesion.elecciones || []), eleccion]

  const { data, error } = await supabase
    .from('sesiones_juego')
    .update({
      historia_actual: eleccion.nodoActual,
      elecciones: nuevasElecciones,
      fecha_actualizacion: new Date().toISOString()
    })
    .eq('id', sesionId)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Marca la sesión como finalizada
 */
export async function finalizarSesion(sesionId, finalId) {
  const { data, error } = await supabase
    .from('sesiones_juego')
    .update({
      finalizado: true,
      historia_actual: finalId,
      fecha_actualizacion: new Date().toISOString()
    })
    .eq('id', sesionId)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Obtiene historial de sesiones de un usuario
 */
export async function obtenerHistorial(usuarioNombre) {
  const { data, error } = await supabase
    .from('sesiones_juego')
    .select('*')
    .eq('usuario_nombre', usuarioNombre)
    .order('fecha_inicio', { ascending: false })

  if (error) throw error
  return data
}