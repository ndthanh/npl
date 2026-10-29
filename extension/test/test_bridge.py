import base64
import io
import pathlib
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import zipfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'bridge'))
import rpc

def archive(entries):
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as z:
        for name,value in entries:z.writestr(name,value)
    return base64.b64encode(buffer.getvalue()).decode()

class ArchiveTests(unittest.TestCase):
    def test_model_is_verified_before_upload_and_failure_sends_nothing(self):
        calls=[]
        bridge=SimpleNamespace(ask=lambda *a,**k:(calls.append('ask') or {'answer':'ok'}))
        with patch('rpc.connect',return_value=bridge),patch('rpc.route',return_value='/chat'),patch.object(rpc.harness,'downloads',return_value=[]),patch.object(rpc.harness,'upload',side_effect=lambda p:calls.append('upload')),patch('model_selector.select_model',side_effect=lambda *a,**k:(calls.append('model') or {'verified':True})):
            rpc.dispatch('ask',{'prompt':'test','uploads':['fixture.txt']})
        self.assertEqual(calls,['model','upload','ask'])
        calls.clear()
        with patch('rpc.connect',return_value=bridge),patch.object(rpc.harness,'upload',side_effect=lambda p:calls.append('upload')),patch('model_selector.select_model',side_effect=RuntimeError('unverified model')):
            with self.assertRaisesRegex(RuntimeError,'unverified'):rpc.dispatch('ask',{'prompt':'test','uploads':['fixture.txt']})
        self.assertEqual(calls,[])
    def test_project_zip_keeps_binary_and_wrapper_bytes(self):
        data=b'\x89PNG\x00\xff'
        result=rpc.dispatch('unpack_project',{'base64':archive([('project/logo.png',data),('project/main.py','print(1)')])})
        self.assertEqual(base64.b64decode(result['entries'][0]['base64']),data)
        packed=rpc.dispatch('pack_project',result)
        self.assertEqual(rpc.dispatch('unpack_project',packed),result)
    def test_project_zip_rejects_traversal_and_case_aliases(self):
        for entries in [[('../outside.txt','bad')],[('main.py','a'),('MAIN.py','b')]]:
            with self.assertRaises(ValueError):rpc.dispatch('unpack_project',{'base64':archive(entries)})
    def test_missing_truststore_does_not_block_url_validation_for_browser(self):
        import web_reader
        with patch('web_reader.bounded_addresses',return_value={'93.184.216.34'}):
            self.assertEqual(web_reader.public_url('https://example.com'),'https://example.com/')
        import builtins
        original=builtins.__import__
        def missing(name,*args,**kwargs):
            if name=='truststore':raise ModuleNotFoundError("No module named 'truststore'",name='truststore')
            return original(name,*args,**kwargs)
        import email.message,ssl
        headers=email.message.Message();headers['Content-Type']='text/plain; charset=utf-8'
        response=io.BytesIO(b'This is a sufficiently long readable page for the fallback TLS test.')
        response.headers=headers;response.geturl=lambda:'https://example.com/'
        with patch('builtins.__import__',side_effect=missing),patch('web_reader.bounded_addresses',return_value={'93.184.216.34'}),patch('web_reader.urllib.request.build_opener',return_value=SimpleNamespace(open=lambda *a,**k:response)) as opener:
            result=web_reader.fetch_markdown('https://example.com')
            self.assertIn('Python default',result['tlsTrust'])
            context=opener.call_args.args[1]._context
            self.assertTrue(context.check_hostname)
            self.assertEqual(context.verify_mode,ssl.CERT_REQUIRED)
    def test_pending_native_callback_is_retained_instead_of_unloaded(self):
        from bridge import Bridge
        actions=[]
        bridge=Bridge.__new__(Bridge)
        bridge.session=SimpleNamespace(detach=lambda:actions.append('detach'))
        bridge.script=SimpleNamespace(exports_sync=SimpleNamespace(pending=lambda:1),eternalize=lambda:actions.append('eternalize'))
        with patch('bridge.time.monotonic',side_effect=[0,0,3]),patch('bridge.time.sleep'):
            bridge.close()
        self.assertEqual(actions,['eternalize','detach'])
        self.assertIsNone(bridge.session)
    def test_snapshot_roundtrip_keeps_unicode_and_linebreaks(self):
        entries=[{'path':'src/main.py','content':'print("Xin chào")\n\n'}]
        packed=rpc.dispatch('pack',{'entries':entries})
        self.assertEqual(rpc.dispatch('unpack',packed)['entries'],entries)
    def test_zip_traversal_rejected_without_writing_files(self):
        for path in ['../main.py','a/../main.py','C:/main.py','/root.py']:
            with self.assertRaises(ValueError,msg=path):rpc.dispatch('unpack',{'base64':archive([(path,'x')])})
        # ZipFile.writestr normalizes backslashes on Windows; forge both headers.
        raw=base64.b64decode(archive([('a/b.py','x')])).replace(b'a/b.py',b'a\\b.py')
        with self.assertRaises(ValueError):rpc.dispatch('unpack',{'base64':base64.b64encode(raw).decode()})
    def test_zip_case_collision_rejected(self):
        with self.assertRaises(ValueError):rpc.dispatch('unpack',{'base64':archive([('main.py','a'),('MAIN.py','b')])})
    def test_project_larger_than_old_upload_limits_roundtrips(self):
        import os
        data=os.urandom(3*1024*1024)
        packed=rpc.dispatch('pack_project',{'entries':[{'path':'asset.bin','base64':base64.b64encode(data).decode()}]})
        self.assertGreater(len(base64.b64decode(packed['base64'])),1024*1024)
        entries=rpc.dispatch('unpack_project',packed)['entries']
        self.assertEqual(base64.b64decode(entries[0]['base64']),data)
    def test_binary_sources_do_not_get_silently_corrupted(self):
        with self.assertRaises(ValueError):rpc.dispatch('unpack',{'base64':archive([('image.png',b'\xff\x00')])})
    def test_unknown_rpc_cannot_evaluate_javascript_or_run_commands(self):
        for method in ['evaluate','exec','shell','approve']:
            with self.assertRaises(ValueError):rpc.dispatch(method,{})

if __name__=='__main__':unittest.main()
