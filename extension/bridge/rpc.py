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
        return {**harness.connect(), 'route':route()}
    if method == 'status':
        return {**harness.status(), 'route':route()} if harness.bridge else {'connected':False}
    if method == 'new':
        connect()
        return harness.new_chat()
    if method == 'restore':
        connect()
        harness.restore_chat(p['conversationId'])
        return {'route':route()}
    if method == 'ask':
        bridge=connect()
        from model_selector import select_model,DEFAULT_MODEL
        model=select_model(bridge,p.get('model',DEFAULT_MODEL))
        for upload in p.get('uploads', []):
            harness.upload(upload)
        reply=bridge.ask(p['prompt'], timeout=p.get('timeout',300))
        return {**reply, 'route':route(), 'downloads':harness.downloads(),'model':model}
    if method == 'read':
        connect()
        return {**harness.read(),'route':route(),'downloads':harness.downloads()}
    if method == 'download':
        connect()
        return {'base64':base64.b64encode(harness.bridge.read_download(p['name'])).decode('ascii')}
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
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8',line_buffering=True)
    for line in sys.stdin:
        request={}
        try:
            request=json.loads(line)
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
