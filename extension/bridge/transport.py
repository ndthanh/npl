"""Minimal chat transport extracted from the original CLI; no web/dev orchestrator."""
import datetime, hashlib, json, mimetypes, pathlib, re, time, uuid
from bridge import Bridge
DOWNLOADS_JS = '(() => {\nconst turn=Array.from(document.querySelectorAll(\'[data-testid="m365-chat-llm-web-ui-chat-message"]\')).at(-1);\nreturn Array.from(turn?.querySelectorAll(\'a[download]\')||[]).filter(e=>e.download).map(e=>({name:e.download,text:e.innerText,scheme:e.href.split(\':\')[0]}));\n})()'
class Harness:
    def __init__(self):
        self.pid = None
        self.bridge = None
        self.ensure_open = True
        self.local_session_id = uuid.uuid4().hex
    def record(self, *args, **kwargs):
        pass
    def connect(self,force_open=False,timeout=30):
            self.close()
            self.bridge=Bridge(self.pid,open_copilot=self.ensure_open,force_open=force_open,timeout=timeout)
            return self.status()

    def close(self):
            if self.bridge:
                self.bridge.close()
                self.bridge=None

    def status(self):
            state=self.bridge.state()
            return {'connected':True,**self.bridge.metadata,'title':state['title'],
                    'editorPresent':state['editorPresent'],'generating':state['generating'],
                    'hasDraft':bool(state['draft'].strip()),'attachments':state.get('attachments',[]),
                    'visibleTurns':len(state['turns'])}

    def read(self):
            turns=self.bridge.state()['turns']
            return turns[-1] if turns else {'answer':'','question':'','code':[]}

    def new_chat(self,timeout=30):
            state=self.bridge.state()
            if state['generating']:raise RuntimeError('Copilot is generating; wait before starting a new chat')
            if state['draft'].strip():raise RuntimeError('Existing draft present; refusing to discard it')
            pending=self.bridge.evaluate('!!document.querySelector(\'button[aria-label^="Remove attachment "]\')')
            if not pending and state['editorPresent'] and not state['turns'] and state['route']=='/chat':
                self.local_session_id=uuid.uuid4().hex
                return {'newChat':True,'editorPresent':True,'visibleTurns':0,'previousChatDeleted':False,'alreadyEmpty':True}
            click_script=r'''(() => {
    if(document.querySelector('button[aria-label^="Remove attachment "]'))return {error:'An unsent attachment is present'};
    const visible=e=>!e.disabled && e.getAttribute('aria-disabled')!=='true';
    let nodes=Array.from(document.querySelectorAll('button[data-testid="newChatButton"],button#new-chat-button')).filter(visible);
    if(!nodes.length)nodes=Array.from(document.querySelectorAll('button[aria-label="New chat"],[role="button"][aria-label="New chat"]')).filter(visible);
    if(nodes.length!==1)return {error:'New chat button is missing or ambiguous',matches:nodes.length};
    nodes[0].click();return {clicked:true};})()'''
            clicked=self.bridge.evaluate(click_script)
            if clicked and clicked.get('matches')==0:
                self.bridge.evaluate('document.querySelector(\'button[data-testid="expand-button"]\')?.click();true')
                deadline=time.monotonic()+timeout
                while time.monotonic()<deadline:
                    clicked=self.bridge.evaluate(click_script)
                    if clicked and (clicked.get('clicked') or clicked.get('matches')!=0):break
                    time.sleep(.5)
            if not clicked or not clicked.get('clicked'):raise RuntimeError(f'Cannot start a new chat: {clicked}')
            self.record('new-chat-clicked')
            deadline=time.monotonic()+timeout
            stable=0
            reconnected=False
            while time.monotonic()<deadline:
                try:state=self.bridge.state()
                except Exception:
                    if reconnected:raise
                    self.connect()  # Rediscover a replaced frame; never click New chat twice.
                    reconnected=True
                    continue
                ready=state['route']=='/chat' and state['editorPresent'] and not state['turns'] and not state['draft'].strip() and not state['generating']
                stable=stable+1 if ready else 0
                if stable>=2:
                    result={'newChat':True,'editorPresent':True,'visibleTurns':0,'previousChatDeleted':False}
                    self.record('new-chat-ready',**result)
                    self.local_session_id=uuid.uuid4().hex
                    return result
                time.sleep(.4)
            raise TimeoutError('New chat was clicked, but an empty ready composer is unconfirmed; inspect Teams before retrying')

    def downloads(self,turn_id=None):
            source=DOWNLOADS_JS
            if turn_id:
                source=source.replace("Array.from(document.querySelectorAll('[data-testid=\"m365-chat-llm-web-ui-chat-message\"]')).at(-1)","document.getElementById("+json.dumps(turn_id)+")")
            return self.bridge.evaluate(source)

    def restore_chat(self,conversation_id,timeout=30):
            if not re.fullmatch(r'[a-fA-F0-9-]{36}',conversation_id):raise ValueError('Invalid conversation ID')
            expected='/chat/conversation/'+conversation_id
            if self.bridge.evaluate('location.pathname')==expected:return
            state=self.bridge.state()
            pending=self.bridge.evaluate('!!document.querySelector(\'button[aria-label^="Remove attachment "]\')')
            if state['draft'].strip() or state['generating'] or pending:
                raise RuntimeError('Teams has an unsent draft, attachment or response; finish it before switching conversations')
            self.bridge.evaluate('document.querySelector(\'button[data-testid="expand-button"]\')?.click();true')
            deadline=time.monotonic()+timeout;clicked=False;stable=0
            while time.monotonic()<deadline:
                if not clicked:
                    clicked=self.bridge.evaluate('(()=>{const e=document.getElementById('+json.dumps(conversation_id)+');if(e?.tagName!=="BUTTON"||e.disabled)return false;e.click();return true;})()')
                if clicked:
                    route=self.bridge.evaluate('location.pathname')
                    state=self.bridge.state()
                    ready=route==expected and state['editorPresent'] and bool(state['turns'])
                    stable=stable+1 if ready else 0
                    if stable>=3:return
                time.sleep(.5)
            raise RuntimeError('Could not restore the selected chat through Copilot history; open it in Teams and reconnect. No prompt was sent')

    def upload(self,path,timeout=300):
            path=pathlib.Path(path)
            mime=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
            result=self.bridge.attach_file(path,mime=mime)
            if not result or not result.get('dispatched'):raise RuntimeError(f'Upload rejected: {result}')
            self.record('upload-dispatched',**result)
            ready={**result,**self.wait_upload(path.name,timeout)}
            self.record('upload-finished',**ready)
            return ready

    def wait_upload(self,name,timeout=300):
            deadline=time.monotonic()+timeout
            stable=0
            while time.monotonic()<deadline:
                ui=self.bridge.evaluate(r'''(() => {
    const name=__NAME__;
    const node=document.querySelector('#chat-input-wrapper')||document.querySelector('[data-testid="bizchat-input-section"]');
    const card=Array.from(document.querySelectorAll('div[aria-label]')).find(e=>e.getAttribute('aria-label')===name && e.querySelector('button[aria-label]')?.getAttribute('aria-label')==='Remove attachment '+name);
    const image=card?.querySelector('img');
    const imageReady=/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)&&!!card?.id&&!!image?.complete&&image.naturalWidth>0&&image.naturalHeight>0&&/^(data:image\/|blob:)/.test(image.currentSrc||image.src)&&!card.querySelector('button[aria-label]')?.disabled;
    return {text:node?.innerText||card?.innerText||'',cardPresent:!!card,cloudIdAssigned:!!card?.id.startsWith('SPO_'),imageReady,busy:!!(node||card)?.querySelector('[role="progressbar"],[aria-busy="true"]'),alerts:Array.from(document.querySelectorAll('[role="alert"]')).map(e=>e.innerText)};
    })()'''.replace('__NAME__',json.dumps(name)))
                text=ui['text']
                if name in text and ('upload failed' in text.lower() or 'upload error' in text.lower()):
                    raise RuntimeError('Teams reported an upload error')
                explicit='upload finished' in text.lower()
                image_ready=ui.get('imageReady',False)
                complete=not ui['busy'] and ((name in text and (explicit or (ui['cardPresent'] and ui['cloudIdAssigned']))) or image_ready)
                stable=stable+1 if complete else 0
                if stable>=(8 if image_ready else 3):
                    return {'composerReportsFinished':explicit,'completionSignal':'upload finished text' if explicit else 'decoded image attachment preview ready (heuristic)' if image_ready else 'cloud-backed attachment card ready','alerts':ui['alerts']}
                time.sleep(.75)
            raise TimeoutError('File was dispatched, but upload completion is unconfirmed; inspect Teams before retrying')

    def download(self,name,target):
            target=pathlib.Path(target)
            if target.exists():raise FileExistsError(f'Refusing to overwrite {target}')
            if not target.parent.exists():raise FileNotFoundError(f'Destination directory does not exist: {target.parent}')
            data=self.bridge.read_download(name)
            with target.open('xb') as out:out.write(data)
            result={'name':name,'saved':str(target.resolve()),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
            self.record('download',**result)
            return result
