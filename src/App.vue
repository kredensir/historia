<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import { guardarSesion, actualizarProgreso, actualizarUbicacion, finalizarSesion } from './supabase.js'
import historiaData from './cap1_bloque1.json'

// Bloque actual (para etiquetar cada elección; futuros bloques usan su propio meta.blockId)
const BLOQUE_ACTUAL = historiaData.meta?.blockId || 'bloque_desconocido'

// DEBUG: verificar que el JSON carga
console.log('📦 Historia JSON cargada:', historiaData ? '✅ Sí' : '❌ No')
console.log('📦 Nodos:', historiaData.nodes?.length)
console.log('📦 Primer nodo:', historiaData.nodes?.[0]?.id, historiaData.nodes?.[0]?.speaker)

const BOTS = ['Juan', 'Ángel', 'Boris', 'Leo']
const STORAGE_KEY = 'historia-chat-save'

// ===== ESTADOS =====
const pantalla = ref('seleccion-bot')
const botSeleccionado = ref('')
const nombreUsuario = ref('')
const sesionId = ref(null)
const cargando = ref(false)
const error = ref('')

const mensajes = ref([])
const nodoActual = ref('')
const mostrandoOpciones = ref(false)
const opcionesActuales = ref([])
const escribiendo = ref(false)
const affection = ref(historiaData.variables?.affection?.initial ?? 50)
const mostrandoMenu = ref(false)
const hayPartidaGuardada = ref(false)
const estadoMsg = ref({})
// Historial de elecciones del jugador (se persiste en Supabase)
const elecciones = ref([])

// ===== HELPERS =====
function getNodo(id) { return historiaData.nodes?.find(n => n.id === id) || null }
function getTextoPorAfectacion(nodo) {
  if (!nodo.text_by_affection) return nodo.text || ''
  const af = affection.value
  if (af >= 70) return nodo.text_by_affection.high || nodo.text || ''
  if (af >= 30) return nodo.text_by_affection.mid || nodo.text || ''
  return nodo.text_by_affection.low || nodo.text || ''
}
function formatearTexto(t) { if (!t) return ''; return t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>') }
function formatearHora(d) { return new Date(d).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) }
function randomDelay(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function getEstadoMsg(id) { return estadoMsg.value[id] || 'sent' }
function setEstadoMsg(id, est) { estadoMsg.value = { ...estadoMsg.value, [id]: est } }

// Ubicación aproximada por IP (país/ciudad, sin permisos del navegador).
// Fire-and-forget: no bloquea ni interfiere con el juego.
function obtenerUbicacion() {
  if (!sesionId.value) return
  const id = sesionId.value
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  fetch('https://ipwho.is/', { signal: ctrl.signal })
    .then(r => r.json())
    .then(d => {
      if (d && d.success !== false && (d.country || d.city)) {
        return actualizarUbicacion(id, { pais: d.country || null, ciudad: d.city || null })
      }
    })
    .catch(e => console.warn('Ubicación no disponible:', e.message || e))
    .finally(() => clearTimeout(t))
}

// Persiste el progreso (nodo actual + historial completo de elecciones).
// Fire-and-forget: no bloquea la navegación del juego.
function persistirProgreso() {
  if (!sesionId.value) return
  actualizarProgreso(sesionId.value, { historiaActual: nodoActual.value, elecciones: elecciones.value })
    .catch(e => console.warn('No se pudo guardar progreso:', e.message))
}

// ===== LOCALSTORAGE =====
function guardarCache() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ botSeleccionado: botSeleccionado.value, nombreUsuario: nombreUsuario.value, sesionId: sesionId.value, mensajes: mensajes.value, nodoActual: nodoActual.value, affection: affection.value, elecciones: elecciones.value, timestamp: Date.now() })); hayPartidaGuardada.value = true } catch (e) {}
}
function cargarCache() { try { const g = localStorage.getItem(STORAGE_KEY); if (g) { const s = JSON.parse(g); if (s.botSeleccionado && s.nombreUsuario && s.mensajes?.length) return s } } catch (e) {} return null }
function limpiarCache() { localStorage.removeItem(STORAGE_KEY); hayPartidaGuardada.value = false }
function verificarCache() { hayPartidaGuardada.value = !!cargarCache() }

// ===== LOGICA =====
function seleccionarBot(bot) { botSeleccionado.value = bot; pantalla.value = 'nombre-usuario' }

async function iniciarJuego() {
  if (!nombreUsuario.value.trim()) { error.value = 'Escribe tu nombre'; return }
  error.value = ''
  cargando.value = true

  // Supabase NO bloquea el inicio del juego
  if (!restaurando) {
    guardarSesion({ botNombre: botSeleccionado.value, usuarioNombre: nombreUsuario.value.trim() })
      .then(s => {
        sesionId.value = s.id
        // Ubicación aproximada por IP (fire-and-forget, sin pedir permisos)
        obtenerUbicacion()
      })
      .catch(e => console.warn('Supabase no disponible:', e.message))
      .finally(() => { cargando.value = false })
  }

  pantalla.value = 'chat'
  mostrandoMenu.value = false
  affection.value = historiaData.variables?.affection?.initial ?? 50
  cargarPrimerMensaje()
  guardarCache()
}

// Para "Empezar de nuevo" que no usa Supabase
function nuevaPartida() {
  limpiarCache()
  mensajes.value = []; estadoMsg.value = {}
  nodoActual.value = ''; affection.value = historiaData.variables?.affection?.initial ?? 50
  elecciones.value = []
  mostrandoOpciones.value = false; opcionesActuales.value = []
  sesionId.value = null; pantalla.value = 'chat'; escribiendo.value = false
  cargarPrimerMensaje(); mostrandoMenu.value = false
}

function cargarPrimerMensaje() {
  const primerNodo = historiaData.nodes?.[0]
  if (!primerNodo) { console.error('❌ No hay nodos'); return }
  console.log('✅ Primer nodo:', primerNodo.id, primerNodo.speaker)
  nodoActual.value = primerNodo.id

  // Mensaje de cifrado de WhatsApp
  mensajes.value.push({
    tipo: 'sistema',
    texto: '🔒 Los mensajes y llamadas de esta conversación están protegidos con cifrado de extremo a extremo. Toca para más información.',
    hora: new Date()
  })
  scrollAbajo()

  if (primerNodo.speaker === 'bot') {
    escribiendo.value = true
    setTimeout(() => {
      console.log('💬 Enviando primer mensaje')
      escribiendo.value = false
      enviarMensajeBot(primerNodo)
    }, randomDelay(1500, 3000))
  } else if (primerNodo.speaker === 'player_choice') {
    mostrarOpciones(primerNodo)
  }
}

function enviarMensajeBot(nodo) {
  const texto = getTextoPorAfectacion(nodo)
  const msgId = 'bot_' + Date.now() + '_' + Math.random().toString(36).slice(2)

  mensajes.value.push({ id: msgId, tipo: 'bot', texto, hora: new Date(), nodoId: nodo.id, image: nodo.image || null })

  setEstadoMsg(msgId, 'sent')
  setTimeout(() => setEstadoMsg(msgId, 'read'), 1000)

  scrollAbajo()
  guardarCache()

  if (nodo.speaker === 'bot' && nodo.next) {
    nodoActual.value = nodo.next
    procesarAuto(nodo.next)
  } else if (nodo.speaker === 'bot' && !nodo.next) {
    if (nodo.id === 'BLOCK_1_END') { alCerrarBloque(nodo.id) }
  }
}

// Cierre de bloque: muestra afectación, guarda progreso final y marca finalizado.
// Fire-and-forget: no interfiere con el juego.
function alCerrarBloque(nodoId) {
  mensajes.value.push({ tipo: 'sistema', texto: `📊 Afectación: ${affection.value}/100`, hora: new Date() })
  scrollAbajo()
  guardarCache()
  if (!sesionId.value) return
  persistirProgreso()
  finalizarSesion(sesionId.value, nodoId)
    .catch(e => console.warn('No se pudo marcar finalizado:', e.message))
}

function procesarAuto(nodoId) {
  const nodo = getNodo(nodoId)
  if (!nodo) { console.warn('⚠️ Nodo no encontrado:', nodoId); return }
  nodoActual.value = nodo.id

  if (nodo.id === 'BLOCK_1_END') { alCerrarBloque(nodo.id); return }

  if (nodo.speaker === 'bot') {
    setTimeout(() => { escribiendo.value = true; setTimeout(() => { escribiendo.value = false; enviarMensajeBot(nodo) }, randomDelay(800, 2000)) }, randomDelay(500, 1500))
  } else if (nodo.speaker === 'player_choice') {
    setTimeout(() => mostrarOpciones(nodo), randomDelay(800, 2000))
  }
}

function mostrarOpciones(nodo) {
  if (nodo.id === 'BLOCK_1_END') { alCerrarBloque(nodo.id); return }
  nodoActual.value = nodo.id
  opcionesActuales.value = nodo.choices || []
  mostrandoOpciones.value = true
  guardarCache()
}

function elegirOpcion(choice) {
  const msgId = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2)

  mensajes.value.push({ id: msgId, tipo: 'usuario', texto: choice.text, hora: new Date(), nodoId: nodoActual.value })

  setEstadoMsg(msgId, 'sent')
  setTimeout(() => setEstadoMsg(msgId, 'delivered'), 500)
  setTimeout(() => setEstadoMsg(msgId, 'read'), 1500)

  mostrandoOpciones.value = false

  const delta = choice.effect?.affection ?? 0
  if (choice.effect?.affection !== undefined) {
    affection.value = Math.max(0, Math.min(100, affection.value + choice.effect.affection))
  }

  // Registrar elección (reconstruye la historia completa del jugador)
  elecciones.value.push({
    bloque: BLOQUE_ACTUAL,
    nodo: nodoActual.value,
    choice_id: choice.id || null,
    texto: choice.text,
    affection_delta: delta,
    affection_total: affection.value,
    ts: new Date().toISOString()
  })
  persistirProgreso()

  guardarCache()
  console.log('👤 Elige:', choice.text, 'afectación:', affection.value)

  // Bot "lee" y responde
  setTimeout(() => {
    const sig = getNodo(choice.next)
    if (!sig) return
    if (sig.id === 'BLOCK_1_END') { nodoActual.value = sig.id; alCerrarBloque(sig.id); return }
    nodoActual.value = sig.id
    if (sig.speaker === 'bot') {
      setTimeout(() => { escribiendo.value = true; setTimeout(() => { escribiendo.value = false; enviarMensajeBot(sig) }, randomDelay(800, 2000)) }, randomDelay(1000, 2500))
    } else if (sig.speaker === 'player_choice') {
      setTimeout(() => mostrarOpciones(sig), randomDelay(1000, 2500))
    }
    guardarCache()
  }, randomDelay(1500, 3000))
}

// ===== MENÚ =====
function toggleMenu() { mostrandoMenu.value = !mostrandoMenu.value }
function cerrarMenu() { mostrandoMenu.value = false }
function reiniciarTodo() {
  limpiarCache(); pantalla.value = 'seleccion-bot'; botSeleccionado.value = ''
  nombreUsuario.value = ''; sesionId.value = null; mensajes.value = []; estadoMsg.value = {}
  nodoActual.value = ''; affection.value = historiaData.variables?.affection?.initial ?? 50
  elecciones.value = []
  mostrandoOpciones.value = false; opcionesActuales.value = []
  error.value = ''; mostrandoMenu.value = false; escribiendo.value = false
}
function restaurarPartida() {
  const estado = cargarCache()
  if (!estado) return
  botSeleccionado.value = estado.botSeleccionado
  nombreUsuario.value = estado.nombreUsuario
  sesionId.value = estado.sesionId
  mensajes.value = estado.mensajes
  nodoActual.value = estado.nodoActual
  affection.value = estado.affection ?? 50
  elecciones.value = estado.elecciones || []
  pantalla.value = 'chat'
  hayPartidaGuardada.value = true
  mostrandoMenu.value = false
  escribiendo.value = false
  mostrandoOpciones.value = false
  opcionesActuales.value = []
  // Restaurar las opciones del nodo donde se quedó la partida
  const nodo = getNodo(nodoActual.value)
  if (nodo?.speaker === 'player_choice' && nodo.choices?.length) {
    opcionesActuales.value = nodo.choices
    mostrandoOpciones.value = true
  } else if (nodo?.speaker === 'bot' && nodo.next) {
    // Se guardó a mitad de una secuencia del bot: retomar desde ahí
    procesarAuto(nodoActual.value)
  }
  nextTick(() => scrollAbajo())
}

// ===== UTILIDADES =====
const chatContainer = ref(null)
function scrollAbajo() {
  // Esperar a que Vue renderice la burbuja nueva antes de medir scrollHeight
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = chatContainer.value
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
  })
}
watch(mensajes, () => { scrollAbajo() }, { deep: true })
watch(escribiendo, () => { scrollAbajo() })
watch(mostrandoOpciones, () => { scrollAbajo() })

// ===== INIT =====
let restaurando = false
onMounted(() => {
  verificarCache()
  console.log('🎮 App montada. Nodos:', historiaData.nodes?.length)
  document.addEventListener('click', (e) => { if (mostrandoMenu.value && !e.target.closest('.menu-wrapper')) cerrarMenu() })
})
</script>

<template>
  <div class="app">
    <!-- PANTALLA 1 -->
    <div v-if="pantalla === 'seleccion-bot'" class="pantalla sel">
      <div class="tarjeta">
        <div class="icono">🤖</div>
        <h1>Elige a tu compañero</h1>
        <p class="subtitulo">Selecciona el nombre del bot</p>
        <div class="bots-grid">
          <button v-for="bot in BOTS" :key="bot" @click="seleccionarBot(bot)" class="bot-btn" :class="{ sel: botSeleccionado === bot }">
            <span class="avatar">{{ bot[0] }}</span>
            <span>{{ bot }}</span>
          </button>
        </div>
        <div v-if="hayPartidaGuardada" class="restaurar">
          <button @click="restaurarPartida" class="btn-restaurar">💾 Continuar partida</button>
        </div>
      </div>
    </div>

    <!-- PANTALLA 2 -->
    <div v-else-if="pantalla === 'nombre-usuario'" class="pantalla sel">
      <div class="tarjeta">
        <div class="icono">✨</div>
        <h1>¿Cómo te llamas?</h1>
        <p class="subtitulo">{{ botSeleccionado }} está listo</p>
        <div class="form">
          <input v-model="nombreUsuario" type="text" placeholder="Tu nombre..." @keydown.enter="iniciarJuego()" />
          <p v-if="error" class="err">{{ error }}</p>
          <button @click="iniciarJuego()" class="btn-jugar" :disabled="cargando">{{ cargando ? 'Iniciando...' : '🎮 Jugar' }}</button>
        </div>
      </div>
    </div>

    <!-- PANTALLA CHAT -->
    <div v-else-if="pantalla === 'chat'" class="pantalla chat">
      <header class="header">
        <div class="h-info">
          <div class="avatar-s">{{ botSeleccionado[0] }}</div>
          <div><h2>{{ botSeleccionado }}</h2><span class="online">en línea</span></div>
        </div>
        <div class="menu-wrapper">
          <button class="btn-menu" @click="toggleMenu">⋯</button>
          <div v-if="mostrandoMenu" class="dropdown" @click.stop>
            <button class="d-item" @click="nuevaPartida">🔄 Empezar de nuevo</button>
            <button class="d-item d-danger" @click="reiniciarTodo">🗑️ Reiniciar todo</button>
            <button class="d-item" @click="cerrarMenu">✕ Cerrar</button>
          </div>
        </div>
      </header>

      <!-- Afectación -->
      <div class="barra-af">
        <div class="af-label"><span>💜 Afectación</span><span>{{ affection }}/100</span></div>
        <div class="af-track"><div class="af-fill" :style="{ width: affection + '%', backgroundColor: affection >= 70 ? '#34c759' : affection >= 30 ? '#007aff' : '#ff3b30' }"></div></div>
      </div>

      <!-- Mensajes -->
      <div class="chat-box" ref="chatContainer">
        <div v-for="(msg, i) in mensajes" :key="msg.id || i" :class="['msg', msg.tipo]">
          <div class="burbuja">
            <p v-html="formatearTexto(msg.texto)"></p>
            <img v-if="msg.image" :src="'img/' + msg.image" class="msg-img" @load="scrollAbajo" onerror="this.style.display='none'" />
            <div v-if="msg.tipo === 'usuario'" class="estado">
              <span v-if="getEstadoMsg(msg.id) === 'sent'" class="ck">✓</span>
              <span v-if="getEstadoMsg(msg.id) === 'delivered'" class="ck">✓✓</span>
              <span v-if="getEstadoMsg(msg.id) === 'read'" class="ck ck-leido">✓✓</span>
            </div>
            <span class="hora">{{ formatearHora(msg.hora) }}</span>
          </div>
        </div>
        <div v-if="escribiendo" class="msg bot">
          <div class="burbuja"><div class="pts"><span></span><span></span><span></span></div></div>
        </div>
      </div>

      <!-- Opciones -->
      <div v-if="mostrandoOpciones" class="opciones">
        <button v-for="(op, i) in opcionesActuales" :key="i" @click="elegirOpcion(op)" class="op-btn">{{ op.text }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ===== DARK WHATSAPP ===== */
* { box-sizing: border-box; margin: 0; padding: 0; }
.app { min-height: 100vh; background: #070707; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', sans-serif; color: #e5e5e5; }
.pantalla { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }

/* Tarjeta */
.tarjeta { width: 100%; max-width: 380px; background: #161616; border-radius: 20px; padding: 40px 24px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); text-align: center; border: 1px solid #222; }
.icono { font-size: 48px; margin-bottom: 16px; }
h1 { margin: 0 0 8px; font-size: 26px; font-weight: 600; color: #f0f0f0; }
.subtitulo { margin: 0 0 28px; font-size: 15px; color: #888; line-height: 1.5; }

/* Bots */
.bots-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.bot-btn { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 18px; border: 2px solid #2a2a2a; border-radius: 14px; background: #1e1e1e; cursor: pointer; transition: all .2s; }
.bot-btn:hover { border-color: #007aff; transform: translateY(-2px); }
.bot-btn.sel { border-color: #007aff; background: #0d2040; box-shadow: 0 0 0 3px rgba(0,122,255,0.2); }
.avatar { width: 52px; height: 52px; border-radius: 12px; background: linear-gradient(135deg, #007aff, #5856d6); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; }
.bot-btn span:last-child { font-size: 15px; font-weight: 500; color: #e0e0e0; }

/* Restaurar */
.restaurar { margin-top: 20px; padding-top: 20px; border-top: 1px solid #2a2a2a; }
.btn-restaurar { width: 100%; padding: 14px; background: rgba(0,122,255,0.1); border: 1px solid #007aff; border-radius: 12px; color: #007aff; font-size: 15px; font-weight: 500; cursor: pointer; transition: all .2s; }
.btn-restaurar:hover { background: rgba(0,122,255,0.2); }

/* Form */
.form { display: flex; flex-direction: column; gap: 14px; }
.form input { width: 100%; padding: 14px 16px; font-size: 17px; color: #f0f0f0; background: #1e1e1e; border: 2px solid #333; border-radius: 12px; outline: none; transition: border-color .2s; }
.form input::placeholder { color: #555; }
.form input:focus { border-color: #007aff; }
.err { font-size: 13px; color: #ff3b30; margin-top: 4px; }

.btn-jugar { width: 100%; padding: 16px; font-size: 17px; font-weight: 600; color: #fff; background: linear-gradient(135deg, #007aff, #5856d6); border: none; border-radius: 12px; cursor: pointer; transition: transform .1s; }
.btn-jugar:active:not(:disabled) { transform: scale(0.98); }
.btn-jugar:disabled { opacity: .5; cursor: not-allowed; }

/* Chat */
.chat { flex-direction: column; justify-content: flex-start; max-width: 100%; padding: 0; background: #070707; height: 100dvh; min-height: 100dvh; overflow: hidden; }
.header { width: 100%; max-width: 480px; padding: 12px 16px; background: #111; border-bottom: 1px solid #1a1a1a; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 10; }
.h-info { display: flex; align-items: center; gap: 10px; }
.avatar-s { width: 36px; height: 36px; border-radius: 18px; background: linear-gradient(135deg, #007aff, #5856d6); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
.header h2 { margin: 0; font-size: 17px; font-weight: 600; color: #f0f0f0; }
.online { font-size: 13px; color: #34c759; }

/* Barra afectación */
.barra-af { width: 100%; max-width: 480px; padding: 8px 16px; background: #111; border-bottom: 1px solid #1a1a1a; }
.af-label { display: flex; justify-content: space-between; font-size: 12px; font-weight: 500; color: #999; margin-bottom: 5px; }
.af-track { width: 100%; height: 4px; background: #222; border-radius: 2px; overflow: hidden; }
.af-fill { height: 100%; border-radius: 2px; transition: width .5s, background-color .5s; background-color: #222; }

/* Mensajes */
.chat-box { flex: 1; min-height: 0; width: 100%; max-width: 480px; padding: 16px 12px 100px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; background: #070707; }

.msg { display: flex; max-width: 85%; animation: aparecer .3s ease; }
@keyframes aparecer { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.msg.bot { align-self: flex-start; }
.msg.usuario { align-self: flex-end; }
.msg.sistema { align-self: center; max-width: 90%; }

.burbuja { padding: 8px 12px; border-radius: 18px; position: relative; font-size: 15px; line-height: 1.45; word-wrap: break-word; overflow-wrap: break-word; }
.msg.bot .burbuja { background: #1e1e1e; color: #e5e5e5; border-bottom-left-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
.msg.usuario .burbuja { background: #046638; color: #fff; border-bottom-right-radius: 4px; }
.msg.sistema .burbuja { background: transparent; color: #888; font-size: 12px; text-align: center; padding: 6px 16px; }

/* Imagen */
.msg-img { width: 100%; max-width: 180px; border-radius: 10px; margin-top: 6px; object-fit: cover; }

/* Estado WhatsApp ✓✓ */
.estado { display: flex; align-items: center; gap: 2px; margin-top: 2px; float: right; }
.ck { font-size: 11px; color: rgba(255,255,255,0.4); }
.ck-leido { color: #60b5ff; }

.hora { display: block; font-size: 11px; margin-top: 3px; opacity: 0.6; text-align: right; }
.msg.bot .hora { color: #666; }
.msg.usuario .hora { color: rgba(255,255,255,0.6); }

/* Escribiendo */
.msg.escribiendo .burbuja { padding: 10px 14px; }
.pts { display: flex; gap: 3px; }
.pts span { width: 7px; height: 7px; border-radius: 50%; background: #666; animation: rebote 1.4s infinite ease-in-out both; }
.pts span:nth-child(1) { animation-delay: -0.32s; }
.pts span:nth-child(2) { animation-delay: -0.16s; }
@keyframes rebote { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }

/* Opciones */
.opciones { width: 100%; max-width: 480px; padding: 10px 12px 24px; display: flex; flex-direction: column; gap: 8px; background: linear-gradient(to top, #070707, transparent); position: sticky; bottom: 0; }
.op-btn { text-align: left; padding: 14px 16px; background: #1e1e1e; border: 1px solid #2a2a2a; border-radius: 14px; font-size: 15px; color: #e0e0e0; cursor: pointer; transition: all .2s; }
.op-btn:hover { border-color: #007aff; background: #152035; }
.op-btn:active { transform: scale(0.98); }

/* Dropdown */
.menu-wrapper { position: relative; }
.btn-menu { width: 36px; height: 36px; border-radius: 18px; border: none; background: #222; font-size: 20px; color: #f0f0f0; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.btn-menu:active { background: #2a2a2a; }
.dropdown { position: absolute; top: calc(100% + 8px); right: 0; min-width: 170px; background: #1e1e1e; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.5); border: 1px solid #2a2a2a; overflow: hidden; z-index: 100; }
.d-item { width: 100%; display: block; padding: 12px 16px; border: none; background: transparent; font-size: 15px; color: #e0e0e0; text-align: left; cursor: pointer; transition: background .15s; }
.d-item:hover { background: #2a2a2a; }
.d-danger { color: #ff3b30; }
.d-danger:hover { background: #3a1515; }

/* Responsive */
@media (max-width: 480px) {
  .tarjeta { border-radius: 0; min-height: 100vh; padding: 28px 16px 40px; }
  .header { border-radius: 0; }
  .chat-box { padding-bottom: 120px; }
  .dropdown { right: -4px; }
}
</style>