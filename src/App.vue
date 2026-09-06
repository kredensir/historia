<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'
import { guardarSesion, actualizarProgreso, actualizarUbicacion, finalizarSesion } from './supabase.js'
import bloque1 from './cap1_bloque1.json'
import bloque2 from './capitulo1_bloque2.json'
import bloque3 from './capitulo1_bloque3.json'

// Bloques en orden de la historia. Para agregar más (cap1_bloque3, cap2_bloque1...),
// importar el JSON y agregarlo a este array: la transición es automática e invisible.
const bloques = [bloque1, bloque2, bloque3]

// Mapa unificado de nodos + índice del bloque al que pertenece cada uno
const nodesMap = {}
const nodeBloque = {}
bloques.forEach((b, i) => {
  (b.nodes || []).forEach(n => { nodesMap[n.id] = n; nodeBloque[n.id] = i })
})

const AFFECTION_INICIAL = bloques[0]?.variables?.affection?.initial ?? 50

// DEBUG: verificar que los JSON cargan
console.log('📦 Bloques cargados:', bloques.length)
bloques.forEach((b, i) => console.log(`📦 Bloque ${i}:`, b.meta?.blockId, '| nodos:', b.nodes?.length))

const BOTS = ['Juan', 'Ángel', 'Boris', 'Leo']
const STORAGE_KEY = 'historia-chat-save'

// ===== ESTADOS =====
const pantalla = ref('aviso')
const botSeleccionado = ref('')
const nombreBotPersonalizado = ref('')
const nombreUsuario = ref('')
const sesionId = ref(null)
const cargando = ref(false)
const error = ref('')

const mensajes = ref([])
const nodoActual = ref('')
const mostrandoOpciones = ref(false)
const opcionesActuales = ref([])
const escribiendo = ref(false)
const affection = ref(AFFECTION_INICIAL)
const mostrandoMenu = ref(false)
const hayPartidaGuardada = ref(false)
const estadoMsg = ref({})
const introSaliendo = ref(false)
// Historial de elecciones del jugador (se persiste en Supabase)
const elecciones = ref([])
// Flags activadas por las elecciones (ej. occupation_medicina, confirmoSoltera)
const flags = ref([])
// Bloque actual (se actualiza solo al avanzar; no se reinicia entre bloques)
const bloqueActual = ref(bloques[0]?.meta?.blockId || 'bloque_desconocido')

// ===== HELPERS =====
function getNodo(id) { return nodesMap[id] || null }
function getBloqueDeNodo(id) {
  const i = nodeBloque[id]
  return i !== undefined ? bloques[i] : null
}
// Marcador de fin de bloque: id BLOCK_*/CHAPTER_* o system sin next.
// Un system CON next es una dirección invisible (ej. efecto de tipeo) y continúa.
function esFinDeBloque(nodo) {
  return !!nodo && (nodo.id.startsWith('BLOCK_') || nodo.id.startsWith('CHAPTER_') || (nodo.speaker === 'system' && !nodo.next))
}
// Sincroniza bloqueActual según el nodo en curso
function syncBloque(nodoId) {
  const b = getBloqueDeNodo(nodoId)
  if (b?.meta?.blockId) bloqueActual.value = b.meta.blockId
}
function getTextoPorAfectacion(nodo) {
  if (!nodo.text_by_affection) return nodo.text || ''
  const af = affection.value
  if (af >= 70) return nodo.text_by_affection.high || nodo.text || ''
  if (af >= 30) return nodo.text_by_affection.mid || nodo.text || ''
  return nodo.text_by_affection.low || nodo.text || ''
}
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
// Variables del JSON: {{playerName}} y {{botName}} (también {{player}}, {{bot}}, {usuario}, {bot})
// Se resuelven al mostrar, el texto guardado queda crudo.
function interpolar(texto) {
  if (!texto) return ''
  const jugador = escapeHtml(nombreUsuario.value.trim())
  const bot = escapeHtml(botSeleccionado.value)
  return texto
    .replace(/\{\{\s*playerName\s*\}\}/g, jugador)
    .replace(/\{\{\s*botName\s*\}\}/g, bot)
    .replace(/\{\{\s*player\s*\}\}/g, jugador)
    .replace(/\{\{\s*bot\s*\}\}/g, bot)
    .replace(/\{usuario\}/g, jugador)
    .replace(/\{bot\}/g, bot)
}
function formatearTexto(t) { if (!t) return ''; return linkificar(interpolar(t)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>') }
// Convierte URLs en enlaces clicables (nueva pestaña, sin salir del juego para YouTube embebido)
function linkificar(texto) {
  if (!texto) return ''
  return texto.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const limpia = url.replace(/[.,;:!?)]+$/, '')
    const cola = url.slice(limpia.length)
    return `<a href="${limpia}" target="_blank" rel="noopener">${limpia}</a>${cola}`
  })
}
// Resuelve la imagen: URL absoluta (http/data:) tal cual, relativa con prefijo img/
function resolverImg(src) {
  if (!src) return ''
  if (/^(https?:|data:|blob:)/i.test(src)) return src
  return 'img/' + src.replace(/^\/all+/, '')
}
function extraerYoutubeId(texto) {
  if (!texto) return null
  const m = texto.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ botSeleccionado: botSeleccionado.value, nombreUsuario: nombreUsuario.value, sesionId: sesionId.value, mensajes: mensajes.value, nodoActual: nodoActual.value, affection: affection.value, elecciones: elecciones.value, flags: flags.value, bloqueActual: bloqueActual.value, timestamp: Date.now() })); hayPartidaGuardada.value = true } catch (e) {}
}
function cargarCache() { try { const g = localStorage.getItem(STORAGE_KEY); if (g) { const s = JSON.parse(g); if (s.botSeleccionado && s.nombreUsuario && s.mensajes?.length) return s } } catch (e) {} return null }
function limpiarCache() { localStorage.removeItem(STORAGE_KEY); hayPartidaGuardada.value = false }
function verificarCache() { hayPartidaGuardada.value = !!cargarCache() }

// ===== LOGICA =====
function continuarAviso() { pantalla.value = 'seleccion-bot' }
function seleccionarBot(bot) { botSeleccionado.value = bot; nombreBotPersonalizado.value = ''; pantalla.value = 'nombre-usuario' }
function elegirBotPersonalizado() {
  const nombre = nombreBotPersonalizado.value.trim().slice(0, 20)
  if (!nombre) return
  botSeleccionado.value = nombre
  pantalla.value = 'nombre-usuario'
}

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

  pantalla.value = 'intro'
  mostrandoMenu.value = false
  introSaliendo.value = false
  affection.value = AFFECTION_INICIAL
  elecciones.value = []
  flags.value = []
  bloqueActual.value = bloques[0]?.meta?.blockId || 'bloque_desconocido'
  guardarCache()

  // La intro se desvanece sola y da paso al chat
  setTimeout(() => { introSaliendo.value = true }, 2600)
  setTimeout(() => {
    introSaliendo.value = false
    pantalla.value = 'chat'
    cargarPrimerMensaje()
  }, 3400)
}

// Para "Empezar de nuevo" que no usa Supabase
function nuevaPartida() {
  limpiarCache()
  mensajes.value = []; estadoMsg.value = {}
  nodoActual.value = ''; affection.value = AFFECTION_INICIAL
  elecciones.value = []; flags.value = []
  bloqueActual.value = bloques[0]?.meta?.blockId || 'bloque_desconocido'
  mostrandoOpciones.value = false; opcionesActuales.value = []
  sesionId.value = null; pantalla.value = 'chat'; escribiendo.value = false
  cargarPrimerMensaje(); mostrandoMenu.value = false
}

function cargarPrimerMensaje() {
  const primerNodo = bloques[0]?.nodes?.[0]
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

  mensajes.value.push({ id: msgId, tipo: 'bot', texto, hora: new Date(), nodoId: nodo.id, image: nodo.image || null, youtubeId: extraerYoutubeId(texto) })

  setEstadoMsg(msgId, 'sent')
  setTimeout(() => setEstadoMsg(msgId, 'read'), 1000)

  scrollAbajo()
  guardarCache()

  if (nodo.speaker === 'bot' && nodo.next) {
    nodoActual.value = nodo.next
    procesarAuto(nodo.next)
  } else if (nodo.speaker === 'bot' && !nodo.next) {
    if (esFinDeBloque(nodo)) { alCerrarBloque(nodo) }
  }
}

// Fin de bloque: si hay un bloque siguiente, la historia continúa de forma
// invisible (mismo affection y flags, el bot "sigue escribiendo").
// Solo al final del último bloque se muestra el cierre y se marca finalizado.
function alCerrarBloque(nodo) {
  const idx = nodeBloque[nodo.id] ?? 0
  const siguiente = bloques[idx + 1]
  syncBloque(nodo.id)
  guardarCache()
  persistirProgreso()

  if (siguiente && siguiente.nodes?.length) {
    // Entrada dirigida: el marcador de fin puede mapear la última elección
    // al nodo de entrada del bloque siguiente.
    // Ej. en el JSON: "entry_by_choice": { "a": "c3_001a", "b": "c3_001b" }
    // Sin mapeo (o sin coincidencia) se entra por el primer nodo del bloque.
    const ultima = elecciones.value[elecciones.value.length - 1]
    const entradaId = (nodo.entry_by_choice && ultima && nodo.entry_by_choice[ultima.choice_id]) || siguiente.nodes[0].id
    const entrada = getNodo(entradaId) || siguiente.nodes[0]
    console.log('➡️ Transición invisible a:', siguiente.meta?.blockId, '| entrada:', entrada.id)
    setTimeout(() => {
      escribiendo.value = true
      setTimeout(() => { escribiendo.value = false; procesarAuto(entrada.id) }, randomDelay(1200, 2500))
    }, randomDelay(800, 1800))
    return
  }

  // Fin real de la historia
  mensajes.value.push({ tipo: 'sistema', texto: `📊 Afectación: ${affection.value}/100`, hora: new Date() })
  scrollAbajo()
  guardarCache()
  if (!sesionId.value) return
  finalizarSesion(sesionId.value, nodo.id)
    .catch(e => console.warn('No se pudo marcar finalizado:', e.message))
}

function procesarAuto(nodoId) {
  const nodo = getNodo(nodoId)
  if (!nodo) { console.warn('⚠️ Nodo no encontrado:', nodoId); return }
  nodoActual.value = nodo.id
  syncBloque(nodo.id)

  if (esFinDeBloque(nodo)) { alCerrarBloque(nodo); return }

  if (nodo.speaker === 'system' && nodo.next) {
    // Dirección invisible: el bot "tipea, borra y vuelve a tipear" y la historia continúa
    setTimeout(() => { escribiendo.value = true; setTimeout(() => { escribiendo.value = false; procesarAuto(nodo.next) }, randomDelay(1500, 3000)) }, randomDelay(500, 1200))
    return
  }

  if (nodo.speaker === 'bot') {
    setTimeout(() => { escribiendo.value = true; setTimeout(() => { escribiendo.value = false; enviarMensajeBot(nodo) }, randomDelay(800, 2000)) }, randomDelay(500, 1500))
  } else if (nodo.speaker === 'player_choice') {
    setTimeout(() => mostrarOpciones(nodo), randomDelay(800, 2000))
  }
}

function mostrarOpciones(nodo) {
  if (esFinDeBloque(nodo)) { alCerrarBloque(nodo); return }
  nodoActual.value = nodo.id
  syncBloque(nodo.id)
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
    bloque: bloqueActual.value,
    nodo: nodoActual.value,
    choice_id: choice.id || null,
    texto: choice.text,
    flag: choice.flag || null,
    affection_delta: delta,
    affection_total: affection.value,
    ts: new Date().toISOString()
  })
  // Flags para futuras ramificaciones (ej. bloque 3)
  if (choice.flag && !flags.value.includes(choice.flag)) flags.value.push(choice.flag)
  persistirProgreso()

  guardarCache()
  console.log('👤 Elige:', choice.text, 'afectación:', affection.value)

  // Bot "lee" y responde
  setTimeout(() => {
    const sig = getNodo(choice.next)
    if (!sig) return
    if (esFinDeBloque(sig)) { nodoActual.value = sig.id; syncBloque(sig.id); alCerrarBloque(sig); return }
    nodoActual.value = sig.id
    syncBloque(sig.id)
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
  limpiarCache(); pantalla.value = 'aviso'; botSeleccionado.value = ''
  nombreBotPersonalizado.value = ''
  nombreUsuario.value = ''; sesionId.value = null; mensajes.value = []; estadoMsg.value = {}
  nodoActual.value = ''; affection.value = AFFECTION_INICIAL
  elecciones.value = []; flags.value = []
  bloqueActual.value = bloques[0]?.meta?.blockId || 'bloque_desconocido'
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
  // Compat: partidas guardadas antes del reproductor no traen youtubeId
  mensajes.value.forEach(m => { if (m.tipo === 'bot' && !m.youtubeId) m.youtubeId = extraerYoutubeId(m.texto) })
  nodoActual.value = estado.nodoActual
  affection.value = estado.affection ?? AFFECTION_INICIAL
  elecciones.value = estado.elecciones || []
  flags.value = estado.flags || []
  bloqueActual.value = estado.bloqueActual || bloques[0]?.meta?.blockId || 'bloque_desconocido'
  pantalla.value = 'chat'
  hayPartidaGuardada.value = true
  mostrandoMenu.value = false
  escribiendo.value = false
  mostrandoOpciones.value = false
  opcionesActuales.value = []
  // Restaurar las opciones del nodo donde se quedó la partida
  const nodo = getNodo(nodoActual.value)
  syncBloque(nodoActual.value)
  if (esFinDeBloque(nodo)) {
    // La partida quedó justo en un fin de bloque: continuar al siguiente
    alCerrarBloque(nodo)
  } else if (nodo?.speaker === 'player_choice' && nodo.choices?.length) {
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
  console.log('🎮 App montada. Bloques:', bloques.length)
  document.addEventListener('click', (e) => { if (mostrandoMenu.value && !e.target.closest('.menu-wrapper')) cerrarMenu() })
})
</script>

<template>
  <div class="app">
    <!-- PANTALLA 0: AVISO DE PRUEBA -->
    <div v-if="pantalla === 'aviso'" class="pantalla sel">
      <div class="tarjeta">
        <div class="icono">⚠️</div>
        <h1>Antes de empezar</h1>
        <p class="subtitulo">Este juego es solo una versión de prueba. Puede contener errores, la historia está en desarrollo y puede no estar disponible en cualquier momento.</p>
        <div class="form">
          <button @click="continuarAviso()" class="btn-jugar">Entendido, continuar</button>
        </div>
      </div>
    </div>

    <!-- PANTALLA 1 -->
    <div v-if="pantalla === 'seleccion-bot'" class="pantalla sel">
      <div class="tarjeta">
        <div class="icono">💬</div>
        <h1>Alguien quiere hablar contigo</h1>
        <p class="subtitulo">Un amigo del pasado consiguió tu número después de años sin verse. Elige quién te está escribiendo...</p>
        <div class="bots-grid">
          <button v-for="bot in BOTS" :key="bot" @click="seleccionarBot(bot)" class="bot-btn" :class="{ sel: botSeleccionado === bot }">
            <span class="avatar">{{ bot[0] }}</span>
            <span>{{ bot }}</span>
          </button>
        </div>
        <div class="bot-custom">
          <p class="bot-custom-label">¿Otro nombre en tu pasado?</p>
          <div class="bot-custom-row">
            <input v-model="nombreBotPersonalizado" type="text" placeholder="Escribe su nombre..." maxlength="20" autocomplete="off" @keydown.enter="elegirBotPersonalizado()" />
            <button @click="elegirBotPersonalizado()" class="btn-custom-ok" :disabled="!nombreBotPersonalizado.trim()">→</button>
          </div>
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
        <h1>¿Quién eres?</h1>
        <p class="subtitulo">{{ botSeleccionado }} está por escribirte después de tanto tiempo. Escribe tu nombre para que sepa que eres tú.</p>
        <div class="form">
          <input v-model="nombreUsuario" type="text" placeholder="Tu nombre..." @keydown.enter="iniciarJuego()" />
          <p v-if="error" class="err">{{ error }}</p>
          <button @click="iniciarJuego()" class="btn-jugar" :disabled="cargando">{{ cargando ? 'Iniciando...' : '🎮 Jugar' }}</button>
        </div>
      </div>
    </div>

    <!-- INTRO CAPÍTULO -->
    <div v-else-if="pantalla === 'intro'" class="pantalla intro" :class="{ saliendo: introSaliendo }">
      <div class="intro-inner">
        <p class="intro-cap">Capítulo 1</p>
        <h1 class="intro-titulo">El reencuentro</h1>
        <div class="intro-linea"></div>
        <p class="intro-sub">Un amigo del pasado te envía un mensaje...</p>
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
            <iframe
              v-if="msg.youtubeId"
              :src="'https://www.youtube-nocookie.com/embed/' + msg.youtubeId"
              class="msg-video"
              title="Video de YouTube"
              frameborder="0"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen
              @load="scrollAbajo"
            ></iframe>
            <img v-if="msg.image" :src="resolverImg(msg.image)" class="msg-img" @load="scrollAbajo" onerror="this.style.display='none'" />
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

/* Nombre personalizado */
.bot-custom { margin-top: 14px; text-align: left; }
.bot-custom-label { font-size: 13px; color: #888; margin-bottom: 8px; }
.bot-custom-row { display: flex; gap: 8px; }
.bot-custom-row input { flex: 1; min-width: 0; padding: 12px 14px; font-size: 15px; color: #f0f0f0; background: #1e1e1e; border: 2px solid #2a2a2a; border-radius: 12px; outline: none; transition: border-color .2s; }
.bot-custom-row input::placeholder { color: #555; }
.bot-custom-row input:focus { border-color: #007aff; }
.btn-custom-ok { flex-shrink: 0; width: 48px; border: none; border-radius: 12px; background: linear-gradient(135deg, #007aff, #5856d6); color: #fff; font-size: 20px; cursor: pointer; transition: transform .1s, opacity .2s; }
.btn-custom-ok:active:not(:disabled) { transform: scale(0.95); }
.btn-custom-ok:disabled { opacity: .4; cursor: not-allowed; }

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
.chat { flex-direction: column; justify-content: flex-start; max-width: 100%; padding: 0; background-color: #070707; background-image: url(https://m.gettywallpapers.com/es/wp-content/uploads/2023/06/Fondos-de-Pantalla-Para-Whatsapp.png); background-size: cover; background-position: center; background-repeat: repeat; height: 100dvh; min-height: 100dvh; overflow: hidden; }
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
.chat-box { flex: 1; min-height: 0; width: 100%; max-width: 480px; padding: 16px 12px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; background: transparent; }

.msg { display: flex; max-width: 85%; animation: aparecer .3s ease; }
@keyframes aparecer { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.msg.bot { align-self: flex-start; }
.msg.usuario { align-self: flex-end; }
.msg.sistema { align-self: center; max-width: 90%; }

.burbuja { padding: 8px 12px; border-radius: 18px; position: relative; font-size: 15px; line-height: 1.45; word-wrap: break-word; overflow-wrap: break-word; }
.msg.bot .burbuja { background: #1e1e1e; color: #e5e5e5; border-bottom-left-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
.msg.usuario .burbuja { background: #046638; color: #fff; border-bottom-right-radius: 4px; }
.msg.sistema .burbuja { background: #0f0f0f; color: #888; font-size: 12px; text-align: center; padding: 6px 16px; }

/* Imagen */
.msg-img { width: 100%; border-radius: 10px; margin-top: 6px; object-fit: cover; }

/* Video embebido (16:9 responsive dentro de la burbuja) */
.msg-video { width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 10px; margin-top: 6px; display: block; background: #000; }

/* Enlaces dentro de las burbujas */
.burbuja a { color: inherit; text-decoration: underline; word-break: break-all; }
.msg.bot .burbuja a { color: #5eb2ff; }

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
.opciones { width: 100%; max-width: 480px; padding: 4px 12px calc(12px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 8px; background: linear-gradient(0deg, #013447, transparent); }
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

/* Intro capítulo */
.intro { background: #000; padding: 24px; animation: introEntrar 1.2s ease both; transition: opacity 0.8s ease; }
.intro.saliendo { opacity: 0; }
.intro-inner { text-align: center; max-width: 420px; animation: introSubir 1.4s ease both; }
.intro-cap { font-size: 13px; letter-spacing: 6px; text-transform: uppercase; color: #888; margin-bottom: 14px; }
.intro-titulo { font-size: 44px; font-weight: 700; color: #f5f5f5; margin-bottom: 18px; line-height: 1.1; }
.intro-linea { width: 56px; height: 2px; background: #007aff; margin: 0 auto 18px; border-radius: 1px; }
.intro-sub { font-size: 16px; color: #aaa; font-style: italic; line-height: 1.6; }
@keyframes introEntrar { from { opacity: 0; } to { opacity: 1; } }
@keyframes introSubir { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

/* Responsive */
@media (max-width: 480px) {
  .tarjeta { border-radius: 0; min-height: 30vh; padding: 28px 16px 40px; }
  .header { border-radius: 0; }
  .chat-box { padding-bottom: 24px; }
  .dropdown { right: -4px; }
}
</style>