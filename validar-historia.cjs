// Validador de historia: referencias rotas, huérfanos e inalcanzables.
// Uso: node validar-historia.js
const b1 = require('./src/cap1_bloque1.json')
const b2 = require('./src/capitulo1_bloque2.json')
const b3 = require('./src/capitulo1_bloque3.json')

const bloques = [b1, b2, b3]
const nodesMap = {}
const duplicados = []
bloques.forEach((b, i) => {
  (b.nodes || []).forEach(n => {
    if (nodesMap[n.id]) duplicados.push(`${n.id} (bloques ${nodesMap[n.id].bi} y ${i})`)
    nodesMap[n.id] = { ...n, bi: i }
  })
})

const esFin = (n) => n.id.startsWith('BLOCK_') || n.id.startsWith('CHAPTER_') || (n.speaker === 'system' && !n.next)
let errores = 0
const err = (msg) => { errores++; console.log('❌ ' + msg) }
const ok = (msg) => console.log('✅ ' + msg)

// 1. Referencias: next + choices[].next + entry_by_choice deben existir
Object.values(nodesMap).forEach(n => {
  const refs = []
  if (n.next) refs.push(['next', n.next])
  ;(n.choices || []).forEach(c => { if (c.next) refs.push([`choice ${c.id}`, c.next]) })
  if (n.entry_by_choice) Object.entries(n.entry_by_choice).forEach(([k, v]) => refs.push([`entry_by_choice.${k}`, v]))
  refs.forEach(([origen, id]) => {
    if (!nodesMap[id]) err(`${n.id} → ${origen} apunta a inexistente "${id}"`)
  })
  // player_choice sin choices
  if (n.speaker === 'player_choice' && !(n.choices || []).length) err(`${n.id} es player_choice sin choices`)
  // bot sin next ni fin
  if (n.speaker === 'bot' && !n.next && !esFin(n)) err(`${n.id} es bot sin next (callejón sin salida)`)
})

// 2. Alcanzabilidad desde el inicio, simulando transiciones entre bloques
const visitados = new Set()
function visitar(id) {
  if (!id || visitados.has(id) || !nodesMap[id]) return
  const n = nodesMap[id]
  visitados.add(id)
  if (esFin(n)) {
    // Transición al siguiente bloque: todas las entradas posibles
    const sig = bloques[n.bi + 1]
    if (sig && sig.nodes?.length) {
      const entradas = new Set([sig.nodes[0].id])
      Object.values(n.entry_by_choice || {}).forEach(e => entradas.add(e))
      entradas.forEach(visitar)
    }
    return
  }
  if (n.next) visitar(n.next)
  ;(n.choices || []).forEach(c => visitar(c.next))
}
visitar(bloques[0].nodes[0].id)

const total = Object.keys(nodesMap).length
console.log(`\n📊 Nodos totales: ${total} | Alcanzables: ${visitados.size} | Inalcanzables: ${total - visitados.size}`)
Object.values(nodesMap).forEach(n => {
  if (!visitados.has(n.id)) err(`inalcanzable: ${n.id} (${n.speaker}) "${(n.text || n.prompt || n.note || '').slice(0, 60)}"`)
})

// 3. Nodos sin entrantes (huérfanos), salvo el inicial
const entrantes = {}
Object.values(nodesMap).forEach(n => {
  const destinos = []
  if (n.next) destinos.push(n.next)
  ;(n.choices || []).forEach(c => { if (c.next) destinos.push(c.next) })
  if (n.entry_by_choice) destinos.push(...Object.values(n.entry_by_choice))
  destinos.forEach(d => { entrantes[d] = (entrantes[d] || 0) + 1 })
})
// Las entradas de bloque también cuentan como "entrantes" vía transición
bloques.forEach((b, i) => {
  if (i === 0) return
  entrantes[b.nodes[0].id] = (entrantes[b.nodes[0].id] || 0) + 1
})
Object.values(nodesMap).forEach(n => {
  if (!entrantes[n.id] && n.id !== bloques[0].nodes[0].id) err(`huérfano (nadie apunta a él): ${n.id}`)
})

if (duplicados.length) duplicados.forEach(d => err('ID duplicado: ' + d))
else ok('sin IDs duplicados entre bloques')

console.log(errores === 0 ? '\n🎉 Historia íntegra, sin errores.' : `\n⚠️ ${errores} problema(s) encontrado(s).`)
process.exit(errores === 0 ? 0 : 1)
