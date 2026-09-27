import { createHash } from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
// Parse COPY text, never execute archive SQL. Row order is irrelevant; duplicates count.
export function fingerprintCopy(sql){
 const tables={};let active=null,rows=[],columns='';
 for(const line of sql.split(/\r?\n/)){
  if(active){
   if(line==='\\.'){
    tables[active]={rows:rows.length,hash:hash(columns+'\n'+rows.sort().join('\n'))};
    active=null;rows=[];
   }else rows.push(hash(line));
  }else if(line.startsWith('COPY ')){
   const m=line.match(/^COPY ((?:public|private|supabase_migrations)\.[a-z_][a-z_0-9]*) \((.*)\) FROM stdin;$/);
   if(!m||tables[m[1]])throw Error('UNSUPPORTED_COPY');
   active=m[1];columns=m[2];
  }
 }
 if(active||!Object.keys(tables).length)throw Error('INCOMPLETE_COPY');
 return tables;
}
export function compareContent(before,after){
 return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().flatMap(table=>{
  const b=before[table],a=after[table];
  if(b&&a&&b.hash===a.hash&&b.rows===a.rows)return [];
  return [{table,before:b?.rows??null,after:a?.rows??null,state:!b?'added':!a?'removed':'changed'}];
 });
}
