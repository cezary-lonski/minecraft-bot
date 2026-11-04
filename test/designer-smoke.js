const D=require('../gui/designer.js');
const md=require('minecraft-data')('1.21.11');
D.setBlocks(md.blocksArray.map(b=>b.name));
const all=new Set(md.blocksArray.map(b=>b.name));
for (const ex of D.EXAMPLES.concat(['dom','palac z kolumnami','stodoła','wieżowiec 20 pięter','arena','igloo','altana','studnia','biały dom z niebieskim dachem i zielonymi oknami','zamek z kwarcu z 6 wieżami'])) {
  const p=D.parse(ex,1); const r=D.generate(p.spec);
  const bad=[...new Set(r.cells.map(c=>c.block).filter(b=>b!=='air'&&!all.has(b)))];
  console.log(ex.padEnd(70).slice(0,70),'|',p.type,'|',r.cells.filter(c=>c.block!=='air').length,'bl',JSON.stringify(r.size),'ahead',r.ahead,bad.length?'BAD '+bad:'', r.warnings.join(' '));
  console.log('   ->',p.understood.join('; '))
}
