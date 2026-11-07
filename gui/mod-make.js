// Tworzy projekty modu "Wiecej budowli" w osobnym procesie (wielki hogwart liczy sie ok. 30 s - okno programu nie zamarza).
// Uzycie: node mod-make.js <folder-projektow> <nazwy-blokow.json>; wynik (JSON) na wyjsciu.
const fs = require('fs')
const Designer = require('./designer.js')
const [dir, blocksFile, modId = 'budowle'] = process.argv.slice(2)
try { Designer.setBlocks(JSON.parse(fs.readFileSync(blocksFile, 'utf8'))) } catch {}
Promise.resolve(modId === 'harry' ? require('./harry-worlds.js').makeAll(Designer, dir) : require('./mod-buildings.js').makeAll(Designer, dir))
  .then(r => { process.stdout.write(JSON.stringify(r)); process.exit(0) })
  .catch(e => { process.stdout.write(JSON.stringify({ done: [], errors: [e.message] })); process.exit(0) })
