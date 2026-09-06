const fs = require('fs')
const j = JSON.parse(fs.readFileSync('src/cap1_bloque1.json', 'utf8'))
const m = {}
j.nodes.forEach(n => { m[n.id] = n })

function camino(id, depth, set) {
  if (!id || set.has(id) || depth > 45) return []
  set.add(id)
  const n = m[id]
  if (!n) return ['  '.repeat(depth) + id + ' (FALTA!)']
  const txt = (n.text || n.prompt || n.note || '').slice(0, 75).replace(/\n/g, ' ')
  let out = ['  '.repeat(depth) + id + ' [' + n.speaker + '] ' + txt]
  if (n.next) out = out.concat(camino(n.next, depth + 1, set))
  ;(n.choices || []).forEach(c => {
    out.push('  '.repeat(depth + 1) + '>> ' + (c.id || '?') + ': ' + (c.text || '').slice(0, 55))
    out = out.concat(camino(c.next, depth + 2, set))
  })
  return out
}

const inicio = process.argv[2] || 'c1_018'
console.log(camino(inicio, 0, new Set()).join('\n'))
