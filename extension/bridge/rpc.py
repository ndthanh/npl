"""Sequential JSON-lines sidecar. stdout is protocol only; no shell or old web server."""
from __future__ import annotations
import base64
import contextlib
import ctypes
import datetime
import io
import json
import os
import pathlib
import re
import sys
import time
import traceback
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from transport import Harness

harness = Harness()
browser = None
pw = None
session_lock = None
progress_sink = lambda value:None

def acquire_lock():
    global session_lock
    if session_lock is not None:return
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateMutexW.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_wchar_p]
    kernel.CreateMutexW.restype=ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_uint]
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    handle=kernel.CreateMutexW(None,False,'Local\\Nopilot.TeamsBridge.v1')
    if not handle:raise ctypes.WinError(ctypes.get_last_error())
    if kernel.WaitForSingleObject(handle,0) not in (0,128):
        kernel.CloseHandle(handle)
        raise RuntimeError('Another Nopilot window controls Teams. Close/disconnect that window first; no request was sent.')
    session_lock=handle

def release_lock():
    global session_lock
    if session_lock is not None:
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.ReleaseMutex.argtypes=[ctypes.c_void_p]
        kernel.CloseHandle.argtypes=[ctypes.c_void_p]
        kernel.ReleaseMutex(session_lock);kernel.CloseHandle(session_lock);session_lock=None

def connect():
    if harness.bridge is None:
        acquire_lock()
        harness.connect()
    return harness.bridge

def route():
    return connect().evaluate('location.pathname')

def check_path(name):
    p = pathlib.PurePosixPath(name)
    if not name or '\\' in name or ':' in name or name.startswith('/') or any(v in ('', '.', '..') for v in name.split('/')):
        raise ValueError('Unsafe archive path')
    return p

def cancellation(p):
    control=os.environ.get('NOPILOT_CONTROL_FILE');identifier=p.get('controlId')
    if not control or not identifier:return False
    try:return json.loads(pathlib.Path(control).read_text(encoding='utf-8')).get('cancel')==identifier
    except (OSError,ValueError):return False

def dispatch(method, p):
    global browser, pw
    if method == 'doctor':
        from doctor import diagnose
        return diagnose()
    if method == 'unpack_project':
        from archives import unpack_project
        return unpack_project(p['base64'])
    if method == 'connect':
        acquire_lock()
        from connection import establish
        try:return {**establish(harness,progress_sink), 'route':route()}
        except Exception:
            # No active owner is needed after failed discovery.
            if harness.bridge is None:release_lock()
            raise
    if method == 'status':
        return {**harness.status(), 'route':route()} if harness.bridge else {'connected':False}
    if method == 'clear_attachments':
        return connect().clear_attachments(p['route'],p['attachments'])
    if method == 'new':
        connect()
        return harness.new_chat()
    if method == 'restore':
        connect()
        harness.restore_chat(p['conversationId'])
        return {'route':route()}
    if method == 'bind_stopped':
        bridge=connect()
        from request_journal import RequestJournal,conversation_id
        journal=RequestJournal(p['journalFile'],p['requestId'],p['prompt'])
        if journal.value.get('phase')!='stopped':raise RuntimeError('Only a confirmed stopped turn can be rebound')
        deadline=time.monotonic()+min(max(p.get('timeout',8),0),8)
        while True:
            state=bridge.state()
            turn=journal.match(state,require_route=False)
            if not turn or state['generating'] or state['draft'].strip():raise RuntimeError('The stopped turn is not the visible idle conversation; nothing was sent')
            if conversation_id(state.get('route')):
                journal.observe(state)
                return {'confirmed':True,'route':state['route']}
            if time.monotonic()>=deadline:return {'confirmed':False}
            time.sleep(.5)
    if method == 'ask':
        bridge=connect()
        from request_journal import RequestJournal
        journal=RequestJournal(p['journalFile'],p['requestId'],p['prompt'],progress_sink) if p.get('journalFile') else None
        state=bridge.state()
        if journal:journal.check_target(state)
        if state.get('attachments'):
            result={'completion':'not_sent','answer':'','sent':False,'route':state.get('route')}
            if journal:journal.finish(result)
            return result
        from model_selector import select_model,DEFAULT_MODEL
        progress_sink({'kind':'copilot_phase','requestId':p.get('requestId'),'phase':'model'})
        model=select_model(bridge,p.get('model',DEFAULT_MODEL))
        for index,upload in enumerate(p.get('uploads', [])):
            if journal:journal.check_target(bridge.state())
            progress_sink({'kind':'copilot_phase','requestId':p.get('requestId'),'phase':'upload','index':index+1,'total':len(p.get('uploads',[]))})
            harness.upload(upload)
        progress_sink({'kind':'copilot_phase','requestId':p.get('requestId'),'phase':'waiting'})
        ask_started=time.monotonic()
        try:reply=bridge.ask(p['prompt'], timeout=p.get('timeout',300),cancelled=lambda:cancellation(p),journal=journal,progress=progress_sink)
        except Exception as error:
            from connection import establish,retryable
            if not journal or journal.value.get('phase') not in ('send_intent','submitted') or not retryable(error):raise
            # A new WebView can replace the empty-chat frame immediately after
            # Send. Reattach and READ the pending request; never call ask twice.
            progress_sink({'kind':'request_reconnect','message':'Teams đã thay frame sau Send; đang kết nối lại để đọc đúng lượt, không gửi lại.'})
            establish(harness,lambda value:None)
            from request_journal import recover
            remaining=max(0,p.get('timeout',300)-(time.monotonic()-ask_started))
            reply=recover(harness,journal,remaining,cancelled=lambda:cancellation(p))
            if reply.get('completion') in ('unconfirmed','generating'):raise RuntimeError('Frame reconnected, but submitted request is not confirmed; recover it before sending again')
        result={**reply, 'route':reply.get('route') or route(),
                'downloads':harness.downloads(reply.get('id')) if reply.get('completion','completed')=='completed' else [],
                'model':model}
        if journal:journal.verify_route({'route':result['route']})
        if journal:journal.finish(result)
        return result
    if method == 'recover':
        connect()
        from request_journal import RequestJournal,recover
        journal=RequestJournal(p['journalFile'],p['requestId'],p['prompt'],progress_sink)
        reply=recover(harness,journal,min(p.get('timeout',30),60))
        return {**reply,'downloads':harness.downloads(reply['id']) if reply.get('completion')=='completed' and reply.get('id') else []}
    if method == 'read':
        connect()
        return {**harness.read(),'route':route(),'downloads':harness.downloads()}
    if method == 'download':
        connect()
        return {'base64':base64.b64encode(harness.bridge.read_download(p['name'],turn_id=p.get('turnId'),expected_route=p.get('route'))).decode('ascii')}
    if method in ('pack','pack_project'):
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
            for entry in p['entries']:
                check_path(entry['path'])
                archive.writestr(entry['path'],base64.b64decode(entry['base64'],validate=True) if method=='pack_project' else entry['content'])
        return {'base64':base64.b64encode(out.getvalue()).decode('ascii')}
    if method == 'unpack':
        raw=base64.b64decode(p['base64'],validate=True)
        entries=[];total=0;seen=set()
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            for entry in archive.infolist():
                if entry.is_dir():continue
                check_path(entry.orig_filename)
                check_path(entry.filename)
                key=entry.filename.casefold()
                if key in seen or ((entry.external_attr>>16)&0o170000)==0o120000:raise ValueError('Duplicate or symlink ZIP entry')
                seen.add(key);total+=entry.file_size
                try:text=archive.read(entry).decode('utf-8-sig')
                except UnicodeDecodeError:raise ValueError('Only UTF-8 source ZIP entries are supported: '+entry.filename)
                entries.append({'path':entry.filename,'content':text})
        return {'entries':entries}
    if method == 'web.read':
        from web_reader import fetch_markdown
        return fetch_markdown(p['url'])
    if method.startswith('browser.'):
        from web_reader import public_url
        try:from playwright.sync_api import sync_playwright
        except ModuleNotFoundError as error:raise RuntimeError(f'Thiếu Playwright trong Python {sys.executable}. Chạy Nopilot: Repair Bridge Dependencies.') from error
        if browser is not None and not browser.is_connected():browser=None
        if browser is not None and not browser.contexts:
            browser.close();browser=None
        if browser is None:
            try:
                if pw is None:pw=sync_playwright().start()
                browser=pw.chromium.launch(channel='msedge',headless=os.environ.get('NOPILOT_BROWSER_HEADLESS')=='1',timeout=20000)
                context=browser.new_context(accept_downloads=False,service_workers='block')
            except Exception as error:
                if browser:
                    with contextlib.suppress(Exception):browser.close()
                browser=None
                raise RuntimeError(f'Không mở được Microsoft Edge qua Playwright ({sys.executable}): {error}. Kiểm tra Edge desktop và Nopilot: Check Runtime. Không cần playwright install khi dùng channel msedge.') from error
            # Guard every request, including redirects and subresources.
            def guard(request_route):
                try:public_url(request_route.request.url);request_route.continue_()
                except Exception:request_route.abort()
            context.route('**/*',guard)
            context.new_page()
        context=browser.contexts[0] if browser.contexts else browser.new_context(accept_downloads=False,service_workers='block')
        page=context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(15000)
        if method=='browser.open':page.goto(public_url(p['url']),wait_until='domcontentloaded',timeout=30000)
        elif method=='browser.click':page.get_by_role(p['role'],name=p['name'],exact=True).click()
        elif method=='browser.fill':
            locator=page.get_by_role(p['role'],name=p['name'],exact=True) if 'role' in p else page.get_by_label(p['label'],exact=True)
            locator.fill(p['value'])
        elif method=='browser.screenshot':
            return {'url':page.url,'base64':base64.b64encode(page.screenshot()).decode('ascii'),'mime':'image/png'}
        elif method!='browser.snapshot':raise ValueError('Unknown browser tool')
        text=page.locator('body').inner_text()
        accessibility=page.locator('body').aria_snapshot()
        links=page.locator('a[href]').evaluate_all('(nodes)=>nodes.slice(0,60).map(e=>({text:e.innerText,url:e.href}))')
        return {'url':page.url,'title':page.title(),'text':text[:30000],'accessibilitySnapshot':accessibility[:30000],'truncated':len(text)>30000 or len(accessibility)>30000,'links':links,'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    raise ValueError('Unknown method: '+method)

def main():
    global progress_sink
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8',line_buffering=True)
    for line in sys.stdin:
        request={}
        try:
            request=json.loads(line)
            protocol_output=sys.stdout
            progress_sink=lambda value:print(json.dumps({'id':request['id'],'type':'progress','value':value},ensure_ascii=True),file=protocol_output,flush=True)
            print('RPC start '+str(request.get('id'))+' '+str(request.get('method')),file=sys.stderr,flush=True)
            with contextlib.redirect_stdout(sys.stderr):
                result=dispatch(request['method'],request.get('params',{}))
            response={'id':request['id'],'result':result}
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            response={'id':request.get('id'),'error':str(error)}
        print(json.dumps(response,ensure_ascii=True),flush=True)
        print('RPC finished '+str(request.get('id')),file=sys.stderr,flush=True)
    if browser:
        with contextlib.suppress(Exception):browser.close()
    if pw:pw.stop()
    harness.close()
    release_lock()

if __name__=='__main__':main()
