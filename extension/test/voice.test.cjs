const {test}=require('node:test'),assert=require('node:assert/strict');
const {VoiceSession}=require('../dist/voice.js');
test('voice without local model requests setup and starts no worker',()=>{const states=[];const v=new VoiceSession(s=>states.push(s),()=>assert.fail('unexpected transcript'));v.start('missing-python','missing-script','','vi');assert.equal(v.active,false);assert.equal(states.at(-1).status,'needs-setup');});
test('voice worker lifecycle accepts stop and returns transcript locally',async()=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nopilot-voice-test-'));const script=path.join(dir,'worker.py');
 await fs.writeFile(script,`import json,sys\nprint(json.dumps({'type':'state','status':'recording'}),flush=True)\nfor line in sys.stdin:\n if line.strip()=='stop':\n  print(json.dumps({'type':'transcript','text':'dictated draft'}),flush=True)\n  break\n`);
 let resolveText;const text=new Promise(r=>resolveText=r);let resolveRecord;const ready=new Promise(r=>resolveRecord=r);const v=new VoiceSession(s=>{if(s.status==='recording')resolveRecord();},t=>resolveText(t));
 try{v.start(process.env.NOPILOT_TEST_PYTHON||'python',script,'local-model','vi');await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('worker timeout')),5000).unref())]);v.stop();assert.equal(await text,'dictated draft');}finally{v.dispose();await fs.rm(dir,{recursive:true,force:true});}
});
