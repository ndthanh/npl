"""Durable send evidence and exact-turn recovery. Never submits a prompt."""
import datetime,hashlib,json,os,pathlib,re,time,unicodedata

def fingerprint(text):
    return hashlib.sha256(unicodedata.normalize('NFC',text.replace('\r\n','\n').replace('\r','\n')).strip().encode('utf-8')).hexdigest()

def conversation_id(route):
    match=re.fullmatch(r'/chat/conversation/([a-fA-F0-9-]{36})',route or '')
    return match[1] if match else None

class RequestJournal:
    def __init__(self,file,request_id,prompt,emit=lambda value:None):
        if not re.fullmatch(r'[a-fA-F0-9-]{36}',request_id or ''):raise ValueError('Invalid request ID')
        self.file=pathlib.Path(file);self.prompt=prompt;self.emit=emit
        self.value=json.loads(self.file.read_text(encoding='utf-8'))
        if self.value.get('requestId')!=request_id or self.value.get('promptSha256')!=fingerprint(prompt):raise ValueError('Request journal does not match prompt')
    def update(self,**values):
        self.value.update(values,updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        self.file.parent.mkdir(parents=True,exist_ok=True)
        temp=self.file.with_suffix('.tmp')
        with temp.open('w',encoding='utf-8') as target:
            json.dump(self.value,target,ensure_ascii=False,indent=2);target.flush();os.fsync(target.fileno())
        for attempt in range(7):
            try:os.replace(temp,self.file);break
            except PermissionError:
                if attempt==6:raise
                time.sleep(.025*2**attempt)
        self.emit({'kind':'request',**{k:self.value.get(k) for k in ('requestId','phase','route','teamsId','turnId')}})
    def verify_route(self,state):
        expected=self.value.get('teamsId')
        actual=conversation_id(state.get('route'))
        if expected and actual!=expected:raise RuntimeError('Wrong Copilot conversation; no request was sent or imported')
        return actual
    def before_send(self,state):
        if self.value.get('phase')!='prepared':raise RuntimeError('Request has send evidence already; recover it instead of sending again')
        self.check_target(state)
        self.update(phase='preparing',beforeTurns=[{'id':t.get('id'),'hash':fingerprint(t.get('question',''))} for t in state['turns']])
    def check_target(self,state):
        self.verify_route(state)
        if not self.value.get('teamsId') and (state.get('route')!='/chat' or state.get('turns')):
            raise RuntimeError('Expected empty new-chat route; no prompt was sent')
    def send_intent(self):self.update(phase='send_intent')
    def submitted(self):self.update(phase='submitted')
    def observe(self,state):
        actual=self.verify_route(state)
        values={}
        turn=self.match(state,require_route=False)
        if actual and turn and not self.value.get('teamsId'):values.update(teamsId=actual,route=state['route'])
        if turn and turn.get('id') and turn.get('id')!=self.value.get('turnId'):values['turnId']=turn['id']
        if values:self.update(**values)
        return turn
    def match(self,state,require_route=True):
        actual=self.verify_route(state)
        if require_route and not actual:raise RuntimeError('Conversation ID is not available; open the original Copilot chat and inspect before retrying')
        before=self.value.get('beforeTurns',[])
        # DOM IDs are hints, not durable identity. Also exclude pre-existing text.
        old_ids={t['id'] for t in before if t.get('id')}
        old_hashes={t['hash'] for t in before}
        matches=[t for t in state['turns'] if fingerprint(t.get('question',''))==self.value['promptSha256'] and t.get('id') not in old_ids and fingerprint(t.get('question','')) not in old_hashes]
        if len(matches)>1:raise RuntimeError('Ambiguous matching turns; no response was imported')
        return matches[0] if matches else None
    def finish(self,reply):
        phase=reply.get('completion','completed')
        self.update(phase=phase,reply=reply)

def recover(harness,journal,timeout=30,cancelled=lambda:False):
    if journal.value.get('phase') in ('prepared','preparing','not_sent'):
        return {'completion':'not_sent','route':journal.value.get('route'),'answer':'','sent':False}
    if journal.value.get('phase')=='stopped':
        return {'completion':'stopped','route':journal.value.get('route'),'answer':'','sent':True}
    target=journal.value.get('teamsId')
    if target:harness.restore_chat(target)
    deadline=time.monotonic()+timeout;previous=None;stable=0;preview_previous=None
    while True:
        state=harness.bridge.state();turn=journal.observe(state)
        journal.match(state) # Require a confirmed conversation route before import.
        if cancelled():
            if not turn:return {'completion':'unconfirmed','route':state.get('route'),'answer':'','sent':True}
            stopped=harness.bridge.stop_generation(journal.prompt)
            reply={'completion':'stopped','route':state['route'],'answer':'','sent':True,**stopped};journal.finish(reply);return reply
        if turn:
            if turn.get('stopped') and not state['generating']:
                reply={'completion':'stopped','route':state['route'],'answer':'','sent':True,'id':turn.get('id')}
                journal.finish(reply);return reply
            if turn.get('serviceError'):
                reply={'completion':'failed','sent':True,'answer':'','serviceError':turn['serviceError'],'route':state['route']};journal.finish(reply);return reply
            answer=turn.get('answerMarkdown') or turn.get('answer')
            if answer and answer!=preview_previous:
                preview_previous=answer
                journal.emit({'kind':'answer_preview','requestId':journal.value['requestId'],'teamsId':journal.value.get('teamsId'),'turnId':turn.get('id'),'text':answer[:1024*1024],'generating':bool(state['generating'])})
            if answer and turn.get('copyReady') and not state['generating']:
                stable=stable+1 if answer==previous else 0;previous=answer
                if stable>=2:
                    reply={**turn,'completion':'completed','sent':True,'route':state['route']};journal.finish(reply);return reply
        if time.monotonic()>=deadline:
            return {'completion':'generating' if turn and state['generating'] else 'unconfirmed','route':state.get('route'),'answer':'','sent':bool(turn)}
        time.sleep(.5)
