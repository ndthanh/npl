"""Frida-only bridge for an already running Windows Teams Copilot frame."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import pathlib
import ctypes
from ctypes import wintypes
import time
import uuid
import frida
from memory_scan import discover_frames

HERE = pathlib.Path(__file__).resolve().parent
CONTROLS_JS=(HERE/'copilot_controls.js').read_text(encoding='utf-8').strip().rstrip(';')

DRAFT_TEXT_JS = r'''((e)=>{
if(!e)return '';
const state=e.__lexicalEditor?.getEditorState?.().toJSON?.();
if(!state)return (e.innerText||'').replace(/[\u200B-\u200D\uFEFF]+$/g,'');
const walk=n=>n.type==='linebreak'?'\n':typeof n.text==='string'?n.text:(n.children||[]).map(walk).join('');
return (state.root?.children||[]).map(walk).join('\n').replace(/[\u200B-\u200D\uFEFF]+$/g,'');
})(document.querySelector('[contenteditable="true"][aria-label="Message Copilot"]'))'''

STATE_JS = r'''(() => {
const toMarkdown = __MARKDOWN_CONVERTER__;
const controls = __CONTROLS__;
const turns = Array.from(document.querySelectorAll('[data-testid="m365-chat-llm-web-ui-chat-message"]')).map(n => ({
  id:n.id,
  question:n.querySelector('[data-testid="chatQuestion"] [data-testid="chatOutput"]')?.innerText || '',
  answer:Array.from(n.querySelectorAll('[data-testid="markdown-reply"]')).map(e=>e.innerText).join('\n\n'),
  answerMarkdown:Array.from(n.querySelectorAll('[data-testid="markdown-reply"]')).map(e=>toMarkdown(e)).join('\n\n'),
  code:[...Array.from(n.querySelectorAll('pre code')).map(e=>e.textContent),
    ...Array.from(n.querySelectorAll('[aria-label="Code editor"]')).map(e=>Array.from(e.querySelectorAll('[data-line-index]')).sort((a,b)=>Number(a.dataset.lineIndex)-Number(b.dataset.lineIndex)).map(e=>e.textContent).join('\n'))],
  copyReady:!!n.querySelector('[data-testid="CopyButtonTestId"]'),
  serviceError:controls.failure(n),
  stopped:controls.stopped(n)
}));
return {title:document.title, origin:location.origin, route:location.pathname,
  editorPresent:!!document.querySelector('[contenteditable="true"][aria-label="Message Copilot"]'),
  draft:__DRAFT_TEXT__,
  attachments:controls.attachmentNames(),
  generating:controls.stopButtons().length>0,
  serviceError:controls.failure(Array.from(document.querySelectorAll('[role="alert"]')).find(e=>!e.closest('[data-testid="markdown-reply"],[data-testid="chatQuestion"]'))?.parentElement),
  turns};
})()'''.replace('__DRAFT_TEXT__',DRAFT_TEXT_JS).replace('__CONTROLS__',CONTROLS_JS).replace('__MARKDOWN_CONVERTER__',(HERE/'copilot_markdown.js').read_text(encoding='utf-8'))

def teams_pid():
    """Enumerate native Windows processes without launching any shell."""
    class ProcessEntry(ctypes.Structure):
        _fields_ = [('dwSize',wintypes.DWORD),('cntUsage',wintypes.DWORD),
          ('th32ProcessID',wintypes.DWORD),('th32DefaultHeapID',ctypes.c_size_t),
          ('th32ModuleID',wintypes.DWORD),('cntThreads',wintypes.DWORD),
          ('th32ParentProcessID',wintypes.DWORD),('pcPriClassBase',wintypes.LONG),
          ('dwFlags',wintypes.DWORD),('szExeFile',wintypes.WCHAR*260)]
    kernel = ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD,wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE,ctypes.POINTER(ProcessEntry)]
    kernel.Process32FirstW.restype = wintypes.BOOL
    kernel.Process32NextW.argtypes = [wintypes.HANDLE,ctypes.POINTER(ProcessEntry)]
    kernel.Process32NextW.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    snapshot = kernel.CreateToolhelp32Snapshot(2,0)
    if snapshot == ctypes.c_void_p(-1).value: raise ctypes.WinError(ctypes.get_last_error())
    found = []
    try:
        entry = ProcessEntry();entry.dwSize = ctypes.sizeof(entry)
        ok = kernel.Process32FirstW(snapshot,ctypes.byref(entry))
        if not ok:raise ctypes.WinError(ctypes.get_last_error())
        while ok:
            if entry.szExeFile.casefold()=='ms-teams.exe':
                found.append((entry.th32ProcessID,entry.th32ParentProcessID))
            ok = kernel.Process32NextW(snapshot,ctypes.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)
    ids = {pid for pid,parent in found}
    roots = [pid for pid,parent in found if parent not in ids]
    if len(roots)!=1:
        raise RuntimeError(f'Expected one Teams host, found {roots}; open Teams or pass --pid explicitly')
    return roots[0]

class Bridge:
    def __init__(self, pid=None, open_copilot=False, force_open=False, timeout=30):
        discovery_deadline=time.monotonic()+timeout
        self.session = frida.attach(pid or teams_pid())
        self.script = None
        try:
            from manifests import BuildUnsupported, find, sha256_file
            # Read module path before installing hooks; fail closed for another build.
            probe = self.session.create_script("rpc.exports.path=()=>Process.getModuleByName('EmbeddedBrowserWebView.dll').path")
            probe.load()
            module_path = probe.exports_sync.path()
            probe.unload()
            digest = sha256_file(module_path)
            manifest, trace = find(digest)
            if manifest is None:
                raise BuildUnsupported(module_path, digest, trace)
            self.manifest=manifest
            source = (HERE / 'agent.js').read_text().replace('__CONFIG__', json.dumps(manifest)).replace('__THREAD_SELECTOR__',(HERE/'ui_thread_selector.js').read_text(encoding='utf-8').strip().rstrip(';'))
            self.script = self.session.create_script(source)
            self.script.load()
            self.rpc = self.script.exports_sync
            self.metadata = self.rpc.metadata()
            self.metadata.update(runtimeVersion=manifest.get('runtimeVersion'),manifestSha256=manifest['moduleSha256'])
            candidates = discover_frames(self.metadata['pid'],int(self.metadata['moduleBase'],16)+manifest['frameVtable'])
            self.frame = None
            self._select_frame(candidates)
            if open_copilot and (not self.frame or force_open):
                self._open_copilot(manifest)
                deadline=discovery_deadline
                while time.monotonic()<deadline:
                    candidates=discover_frames(self.metadata['pid'],int(self.metadata['moduleBase'],16)+manifest['frameVtable'])
                    self._select_frame(candidates)
                    if self.frame:break
                    time.sleep(.5)
            if not self.frame:
                raise RuntimeError('No accessible Copilot frame found; open Copilot Chat in Teams')
            self.metadata.update(frame=self.frame, discoveredFrames=len(candidates['frames']), skippedScanBytes=candidates['skippedBytes'],discoveryMethod=candidates['method'],failedReadBytes=candidates['failedReadBytes'])
        except Exception:
            self.close()
            raise

    def _select_frame(self,candidates):
        selected=[]
        for address in candidates['frames']:
            try:
                state=self.rpc.evaluate(address,STATE_JS)
                if isinstance(state,dict) and state.get('editorPresent') and 'copilot' in state.get('origin','').lower():selected.append(address)
            except frida.core.RPCException as exc:
                if self.rpc.pending():raise RuntimeError('A native callback is still pending; leave Teams running and investigate') from exc
        if len(selected)>1:raise RuntimeError('More than one Copilot frame is open; close the extra frame')
        self.frame=selected[0] if selected else None

    def _open_copilot(self,manifest):
        if 'coreVtable' not in manifest or 'coreExecute' not in manifest:
            raise RuntimeError('Manifest has no Teams shell WebView offsets; refresh the build manifest')
        candidates=discover_frames(self.metadata['pid'],int(self.metadata['moduleBase'],16)+manifest['coreVtable'])
        matches=[]
        probe=r'''(() => {
const nodes=Array.from(document.querySelectorAll('button[aria-label="Copilot"],[role="button"][aria-label="Copilot"]')).filter(e=>e.getClientRects().length && e.getAttribute('aria-disabled')!=='true' && !e.disabled);
return {origin:location.origin,count:nodes.length};})()'''
        for address in candidates['frames']:
            value=self.rpc.evaluate(address,probe,'core')
            if isinstance(value,dict) and value.get('origin')=='https://teams.microsoft.com' and value.get('count'):
                matches.append((address,value['count']))
        if len(matches)!=1 or matches[0][1]!=1:
            raise RuntimeError(f'Cannot uniquely locate the Teams Copilot navigation button: {matches}')
        opened=self.rpc.evaluate(matches[0][0],r'''(() => {
const nodes=Array.from(document.querySelectorAll('button[aria-label="Copilot"],[role="button"][aria-label="Copilot"]')).filter(e=>e.getClientRects().length && e.getAttribute('aria-disabled')!=='true' && !e.disabled);
if(location.origin!=='https://teams.microsoft.com' || nodes.length!==1)return {opened:false};
nodes[0].click();return {opened:true,method:'Teams shell DOM click; no OS input'};})()''','core')
        if not opened or not opened.get('opened'):raise RuntimeError('Copilot navigation changed before click')
        self.metadata['navigation']=opened

    def evaluate(self, expression):
        return self.rpc.evaluate(self.frame, expression)

    def state(self):
        try:return self.evaluate(STATE_JS)
        except frida.core.RPCException as error:
            if not any(marker in str(error) for marker in ('WebView object has changed; rediscover','Frame is destroyed or inaccessible')):raise
            manifest=self.manifest
            # Teams may destroy the empty-chat WebView and create a conversation
            # WebView a moment later. Retry discovery/read only, never a send.
            deadline=time.monotonic()+12
            while time.monotonic()<deadline:
                candidates=discover_frames(self.metadata['pid'],int(self.metadata['moduleBase'],16)+manifest['frameVtable'])
                self._select_frame(candidates)
                if self.frame:
                    self.metadata['frame']=self.frame
                    return self.evaluate(STATE_JS)
                time.sleep(.5)
            raise RuntimeError('Copilot frame was replaced; reconnect before sending another prompt') from error

    def fill_draft(self, prompt, replace_expected=None):
        payload = {'prompt': prompt, 'expected': replace_expected or ''}
        return self.evaluate(r'''(() => {
const p=__PAYLOAD__;
const e=document.querySelector('[contenteditable="true"][aria-label="Message Copilot"]');
if(!e || (__DRAFT_TEXT__).trim()!==p.expected.trim())return {error:'Draft changed'};
const editor=e.__lexicalEditor;
if(!editor || typeof editor.parseEditorState!=='function')return {error:'Lexical API unavailable'};
const children=[];
p.prompt.split('\n').forEach((line,i)=>{
 if(i)children.push({type:'linebreak',version:1});
 if(line)children.push({detail:0,format:0,mode:'normal',style:'',text:line,type:'text',version:1});
});
const root={children:[{children,direction:null,format:'',indent:0,type:'paragraph',version:1}],direction:null,format:'',indent:0,type:'root',version:1};
editor.setEditorState(editor.parseEditorState(JSON.stringify({root})));
return {inserted:true,method:'Lexical.setEditorState'};
})()'''.replace('__PAYLOAD__', json.dumps(payload)).replace('__DRAFT_TEXT__',DRAFT_TEXT_JS))

    def attach_file(self, path, mime='text/plain'):
        path=pathlib.Path(path);key='__nopilot_upload_'+uuid.uuid4().hex
        payload={'name':path.name,'mime':mime,'key':key}
        ready=self.evaluate(r"""(() => {
const p=__PAYLOAD__,input=document.querySelector('input[type="file"]#upload-file-button');
if(!input||input.disabled)return {error:'Upload input unavailable'};
const attachments=Array.from(document.querySelectorAll('button[aria-label^="Remove attachment "]')).filter(e=>e.getClientRects().length);
if(attachments.length>=3)return {error:'Attachment limit reached (3 files)'};
if(attachments.some(e=>e.getAttribute('aria-label')==='Remove attachment '+p.name))return {error:'This filename is already attached'};
window[p.key]={parts:[],bytes:0};return {ready:true};})()""".replace('__PAYLOAD__',json.dumps(payload)))
        if not ready or not ready.get('ready'):return ready
        try:
            with path.open('rb') as source:
                while chunk:=source.read(192*1024):
                    result=self.evaluate(r"""(()=>{const p=__PAYLOAD__,s=window[p.key];if(!s)return {error:'Upload session lost'};const bytes=Uint8Array.from(atob(p.data),c=>c.charCodeAt(0));s.parts.push(bytes);s.bytes+=bytes.length;return {bytes:s.bytes};})()""".replace('__PAYLOAD__',json.dumps({'key':key,'data':base64.b64encode(chunk).decode('ascii')})))
                    if not result or result.get('error'):raise RuntimeError('Upload chunk failed: '+str(result))
            return self.evaluate(r"""(()=>{const p=__PAYLOAD__,s=window[p.key],input=document.querySelector('input[type="file"]#upload-file-button');if(!s||!input||input.disabled)return {error:'Upload input/session changed'};const transfer=new DataTransfer();transfer.items.add(new File(s.parts,p.name,{type:p.mime}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return {dispatched:true,name:p.name,bytes:s.bytes};})()""".replace('__PAYLOAD__',json.dumps(payload)))
        finally:
            self.evaluate('delete window['+json.dumps(key)+']')

    def read_download(self, name, timeout=120, turn_id=None, expected_route=None):
        key='__frida_download_'+uuid.uuid4().hex
        payload=json.dumps({'name':name,'key':key,'turnId':turn_id,'expectedRoute':expected_route})
        started=self.evaluate(r"""(() => {
const p=__PAYLOAD__;
if(p.expectedRoute && location.pathname!==p.expectedRoute)return {error:'Wrong conversation for download'};
const turn=p.turnId?document.getElementById(p.turnId):Array.from(document.querySelectorAll('[data-testid="m365-chat-llm-web-ui-chat-message"]')).at(-1);
const link=Array.from(turn?.querySelectorAll('a')||[]).find(e=>e.download===p.name);
if(!link)return {error:'Named download link missing from selected turn'};
if(!/^(blob:|data:|https:)/.test(link.href))return {error:'Unsupported download URL scheme'};
window[p.key]={status:'pending'};
(async()=>{try{const response=await fetch(link.href);if(!response.ok)throw new Error('Download HTTP '+response.status);const blob=await response.blob();window[p.key]={status:'done',data:new Uint8Array(await blob.arrayBuffer()),bytes:blob.size,mime:blob.type};}catch(error){window[p.key]={status:'error',error:String(error)};}})();
return {started:true};})()""".replace('__PAYLOAD__',payload))
        if not started or not started.get('started'):raise RuntimeError(f'Cannot read download: {started}')
        try:
            deadline=time.monotonic()+timeout
            while time.monotonic()<deadline:
                result=self.evaluate('(()=>{const s=window['+json.dumps(key)+'];return s?{status:s.status,bytes:s.bytes,error:s.error}:null;})()')
                if result and result.get('status')=='error':raise RuntimeError(result['error'])
                if result and result.get('status')=='done':
                    output=bytearray()
                    for offset in range(0,result['bytes'],192*1024):
                        encoded=self.evaluate(r"""(()=>{const p=__PAYLOAD__,s=window[p.key];if(!s||s.status!=='done')throw Error('Download session lost');const bytes=s.data.subarray(p.offset,p.offset+196608);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);})()""".replace('__PAYLOAD__',json.dumps({'key':key,'offset':offset})))
                        output.extend(base64.b64decode(encoded,validate=True))
                    if len(output)!=result['bytes']:raise RuntimeError('Download byte count mismatch')
                    return bytes(output)
                time.sleep(.5)
            raise TimeoutError('Download fetch timed out')
        finally:self.evaluate('delete window['+json.dumps(key)+']')

    def stop_generation(self,expected_prompt):
        result=self.evaluate('('+CONTROLS_JS+').stop('+json.dumps(expected_prompt)+')')
        if not result or result.get('error'):raise RuntimeError('Stop Copilot unconfirmed; no steer was sent: '+str(result))
        deadline=time.monotonic()+20;stable=0
        while time.monotonic()<deadline:
            state=self.state();stable=0 if state['generating'] else stable+1
            if stable>=2:return {'stopped':True,'clicked':result.get('clicked',False)}
            time.sleep(.3)
        raise TimeoutError('Stop Copilot unconfirmed; no steer was sent')

    def clear_attachments(self,route,expected):
        state=self.state()
        if (not isinstance(expected,list) or not 1<=len(expected)<=3 or
            state.get('route')!=route or state.get('attachments')!=expected or state['generating']):
            raise RuntimeError('Teams composer changed; inspect attachments again before continuing')
        for index in range(len(expected)):
            remaining=expected[index:]
            script='('+CONTROLS_JS+').removeAttachment('+json.dumps(route)+','+json.dumps(remaining)+')'
            if not self.evaluate(script):
                raise RuntimeError('Could not remove the confirmed Teams attachment')
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                state=self.state()
                if state.get('route')!=route or state['generating']:
                    raise RuntimeError('Teams composer changed while removing attachments')
                if state.get('attachments')==remaining[1:]:break
                time.sleep(.2)
            else:raise RuntimeError('Teams did not confirm attachment removal')
        return {'removed':len(expected)}

    def ask(self, prompt, timeout=180, resume_draft=False, cancelled=lambda:False, journal=None, progress=lambda value:None):
        if cancelled():return {'completion':'not_sent','answer':'','sent':False}
        state = self.state()
        if journal:journal.before_send(state)
        initial_error=state.get('serviceError')
        if state['generating']:
            raise RuntimeError('Copilot is already generating')
        matching_draft = resume_draft and state['draft'].strip() == prompt.strip()
        if state['draft'].strip() and not matching_draft:
            raise RuntimeError('Existing draft present; refusing to overwrite')
        canonical=lambda text: ''.join(text.split())
        if any(canonical(t['question']) == canonical(prompt) for t in state['turns']):
            raise RuntimeError('Identical prompt already exists; refusing an automatic duplicate')
        text = json.dumps(prompt)
        inserted = {'inserted': True} if matching_draft else self.fill_draft(prompt)
        if not inserted or not inserted.get('inserted'):
            raise RuntimeError(f'Could not fill editor: {inserted}')
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if self.state()['draft'].strip() == prompt.strip():
                break
            time.sleep(.3)
        else:
            raise RuntimeError('Editor did not settle; prompt has not been sent')
        if cancelled():return {'completion':'not_sent','answer':'','sent':False}
        if journal:journal.send_intent()
        sent = self.evaluate((r'''(() => {
if(location.pathname!==''' + json.dumps(state.get('route')) + ''')return {error:'Copilot conversation changed before Send'};
const e=document.querySelector('[contenteditable="true"][aria-label="Message Copilot"]');
const b=document.querySelector('button[aria-label="Send"]');
if((__DRAFT_TEXT__).trim()!==''' + text + '''.trim() || !b || b.disabled)return {error:'Draft changed or Send unavailable'};
b.click();return {sent:true};})()''').replace('__DRAFT_TEXT__',DRAFT_TEXT_JS))
        if not sent or not sent.get('sent'):
            raise RuntimeError(f'Could not send: {sent}')
        if journal:journal.submitted()
        # Once submitted, never auto-retry the prompt on a timeout.
        deadline = time.monotonic() + timeout
        previous = None
        preview_previous = None
        stable = 0
        while time.monotonic() < deadline:
            state = self.state()
            turn = journal.observe(state) if journal else next((t for t in reversed(state['turns']) if canonical(t['question']) == canonical(prompt)), None)
            if cancelled():
                stopped=self.stop_generation(prompt)
                return {'completion':'stopped','answer':'','sent':True,**stopped}
            if turn and turn.get('stopped') and not state['generating']:
                return {'completion':'stopped','answer':'','sent':True,'route':state.get('route'),'id':turn.get('id')}
            failure=(turn or {}).get('serviceError') or (state.get('serviceError') if state.get('serviceError')!=initial_error else None)
            if failure:return {'completion':'failed','answer':'','sent':True,'serviceError':failure}
            preview=(turn or {}).get('answerMarkdown') or (turn or {}).get('answer') or ''
            if preview and preview != preview_previous:
                preview_previous=preview
                progress({'kind':'answer_preview','requestId':journal.value['requestId'] if journal else None,
                    'turnId':turn.get('id'),'teamsId':(journal.value.get('teamsId') if journal else None),
                    'text':preview[:1024*1024],'generating':bool(state['generating'])})
            if turn and turn['answer'] and turn['copyReady'] and not state['generating']:
                stable = stable + 1 if turn['answer'] == previous else 0
                previous = turn['answer']
                # Preserve the original ~3s completion settling period while
                # sampling preview text more frequently.
                if stable >= 4:
                    return {**turn,'route':state.get('route')}
            else:
                stable = 0
            time.sleep(.75)
        raise TimeoutError('Prompt submitted, but response completion is unconfirmed. Inspect before retrying.')

    def close(self):
        if self.session is not None:
            try:
                if self.script is not None:
                    stable=0;deadline=time.monotonic()+2
                    while time.monotonic()<deadline:
                        pending=self.script.exports_sync.pending()
                        stable=stable+1 if not pending else 0
                        if stable>=3:break
                        time.sleep(.1)
                    if stable<3:
                        # COM can retain the callback after a frame is destroyed.
                        # Preserve its backing code inside Teams instead of
                        # unloading it when the extension host reloads.
                        self.script.eternalize()
            except frida.InvalidOperationError:
                pass  # The target or script has already gone away.
            try:self.session.detach()
            except frida.InvalidOperationError:pass
            self.session = None

    def __enter__(self): return self
    def __exit__(self, *_): self.close()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', type=int)
    parser.add_argument('--prompt-file', type=pathlib.Path)
    parser.add_argument('--eval-file', type=pathlib.Path)
    parser.add_argument('--upload-file', type=pathlib.Path)
    parser.add_argument('--download-name')
    parser.add_argument('--save-as', type=pathlib.Path)
    args = parser.parse_args()
    with Bridge(args.pid) as bridge:
        selected=sum(bool(v) for v in (args.prompt_file,args.eval_file,args.upload_file,args.download_name))
        if selected>1:parser.error('Choose only one operation per invocation')
        if args.download_name:
            if not args.save_as:parser.error('--download-name requires --save-as')
            if args.save_as.exists():raise FileExistsError(args.save_as)
            data=bridge.read_download(args.download_name)
            with args.save_as.open('xb') as target:target.write(data)
            result={'saved':str(args.save_as.resolve()),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        elif args.upload_file:
            result=bridge.attach_file(args.upload_file)
        elif args.prompt_file:
            result = bridge.ask(args.prompt_file.read_text(encoding='utf-8-sig'))
        elif args.eval_file:
            result = bridge.evaluate(args.eval_file.read_text(encoding='utf-8-sig'))
        else:
            state = bridge.state()
            result = {'metadata':bridge.metadata, 'title':state['title'], 'editorPresent':state['editorPresent'], 'turnCount':len(state['turns'])}
        print(json.dumps(result, ensure_ascii=True, indent=2))

if __name__ == '__main__': main()
