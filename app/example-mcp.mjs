// Small, dependency-free MCP sample. It never accesses project files or the network.
import readline from 'node:readline';
const tools=[{name:'current_time',description:'Return the current UTC time.',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'word_count',description:'Count words in supplied text.',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}];
const input=readline.createInterface({input:process.stdin});
input.on('line',line=>{try{const m=JSON.parse(line);if(m.id===undefined)return;let result;
  if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'studio-helper',version:'1.0.0'}};
  else if(m.method==='ping')result={};
  else if(m.method==='tools/list')result={tools};
  else if(m.method==='tools/call'){
    if(!tools.some(t=>t.name===m.params.name))throw new Error('Unknown tool');
    const text=m.params.name==='current_time'?new Date().toISOString():String(String(m.params.arguments?.text||'').trim().split(/\s+/).filter(Boolean).length);
    result={content:[{type:'text',text}]};
  }else{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}})+'\n');return;}
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid request'}})+'\n');}});
