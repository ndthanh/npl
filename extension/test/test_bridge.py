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
    def test_new_chat_waits_for_new_route_even_when_old_chat_looks_empty(self):
        from transport import Harness
        from unittest.mock import Mock
        old = dict(editorPresent=True, generating=False, draft='', turns=[],
                   route='/chat/conversation/11111111-1111-1111-1111-111111111111')
        fresh = {**old, 'route': '/chat'}
        harness = Harness()
        harness.bridge = SimpleNamespace(
            state=Mock(side_effect=[old, old, old, fresh, fresh]),
            evaluate=Mock(side_effect=[False, {'clicked': True}]),
        )
        with patch('transport.time.sleep'):
            self.assertTrue(harness.new_chat()['newChat'])
        self.assertEqual(harness.bridge.state.call_count, 5)
        self.assertEqual(harness.bridge.evaluate.call_count, 2)

    def test_wrong_conversation_is_rejected_before_model_selection_or_upload(self):
        from unittest.mock import Mock
        bridge = SimpleNamespace(state=lambda: {'route': '/chat/conversation/old'})
        journal = SimpleNamespace(check_target=Mock(side_effect=RuntimeError('Wrong Copilot conversation')))
        with patch('rpc.connect', return_value=bridge), patch('request_journal.RequestJournal', return_value=journal), \
             patch('model_selector.select_model') as model, patch.object(rpc.harness, 'upload') as upload:
            with self.assertRaisesRegex(RuntimeError, 'Wrong Copilot conversation'):
                rpc.dispatch('ask', {'prompt': 'test', 'uploads': ['fixture.txt'], 'journalFile': 'owned', 'requestId': 'test'})
            model.assert_not_called()
            upload.assert_not_called()

    def test_stopped_identity_binding_only_reads_the_verified_visible_turn_and_never_sends(self):
        from unittest.mock import Mock
        journal=SimpleNamespace(value={'phase':'stopped'},match=Mock(return_value={'question':'old'}),observe=Mock())
        state={'generating':False,'draft':'','route':'/chat/conversation/11111111-1111-1111-1111-111111111111'}
        bridge=SimpleNamespace(state=Mock(return_value=state))
        with patch('rpc.connect',return_value=bridge),patch('request_journal.RequestJournal',return_value=journal):
            result=rpc.dispatch('bind_stopped',{'requestId':'old','journalFile':'owned','prompt':'old','timeout':0})
            self.assertTrue(result['confirmed']);journal.observe.assert_called_once_with(state)
            state['route']='/chat';self.assertFalse(rpc.dispatch('bind_stopped',{'requestId':'old','journalFile':'owned','prompt':'old','timeout':0})['confirmed'])
            journal.match.return_value=None
            with self.assertRaisesRegex(RuntimeError,'nothing was sent'):rpc.dispatch('bind_stopped',{'requestId':'old','journalFile':'owned','prompt':'old'})
    def test_partial_answer_snapshots_precede_completion_and_support_markdown_rewrites(self):
        from bridge import Bridge
        from unittest.mock import Mock
        b=Bridge.__new__(Bridge);initial={'generating':False,'draft':'','turns':[]}
        def state(answer,markdown,ready=False):return {'generating':not ready,'draft':'','route':'/chat','turns':[{'id':'t','question':'test','answer':answer,'answerMarkdown':markdown,'copyReady':ready}]}
        final=state('complete','**complete**',True)
        b.state=Mock(side_effect=[initial,{**initial,'draft':'test'},state('one','one'),state('one','one'),state('rewritten','**rewritten**'),final,final,final,final,final]);b.fill_draft=Mock(return_value={'inserted':True});b.evaluate=Mock(return_value={'sent':True});events=[]
        with patch('bridge.time.sleep'):reply=b.ask('test',progress=events.append)
        self.assertEqual([event['text'] for event in events],['one','**rewritten**','**complete**'])
        self.assertTrue(events[0]['generating']);self.assertFalse(events[-1]['generating']);self.assertEqual(reply['answerMarkdown'],'**complete**')
    def test_service_failure_finishes_without_copy_button_or_retry(self):
        from bridge import Bridge
        from unittest.mock import Mock
        b=Bridge.__new__(Bridge)
        initial={'generating':False,'draft':'','turns':[]}
        failure={'generating':False,'draft':'','turns':[{'question':'test','answer':'','copyReady':False,'serviceError':{'retryAvailable':True}}]}
        b.state=Mock(side_effect=[initial,{**initial,'draft':'test'},failure]);b.fill_draft=Mock(return_value={'inserted':True});b.evaluate=Mock(return_value={'sent':True})
        with patch('bridge.time.sleep'):result=b.ask('test')
        self.assertEqual(result['completion'],'failed');self.assertEqual(b.evaluate.call_count,1)
    def test_cancel_stops_before_returning_and_never_returns_partial_code(self):
        from bridge import Bridge
        from unittest.mock import Mock
        b=Bridge.__new__(Bridge);initial={'generating':False,'draft':'','turns':[]}
        b.state=Mock(side_effect=[initial,{**initial,'draft':'test'},{'generating':True,'draft':'','turns':[{'question':'test','answer':'partial code','copyReady':False}]}]);b.fill_draft=Mock(return_value={'inserted':True});b.evaluate=Mock(return_value={'sent':True});b.stop_generation=Mock(return_value={'stopped':True})
        cancel=Mock(side_effect=[False,False,True])
        with patch('bridge.time.sleep'):result=b.ask('test',cancelled=cancel)
        self.assertEqual(result['completion'],'stopped');self.assertEqual(result['answer'],'');b.stop_generation.assert_called_once_with('test')
    def test_stop_must_settle_and_ambiguous_target_is_not_clicked(self):
        from bridge import Bridge
        from unittest.mock import Mock
        b=Bridge.__new__(Bridge);b.evaluate=Mock(return_value={'clicked':True});b.state=Mock(side_effect=[{'generating':False},{'generating':False}])
        with patch('bridge.time.sleep'):self.assertTrue(b.stop_generation('test')['stopped'])
        b.evaluate=Mock(return_value={'error':'ambiguous'})
        with self.assertRaisesRegex(RuntimeError,'unconfirmed'):b.stop_generation('test')
    def test_cancel_control_is_scoped_to_the_exact_rpc_request(self):
        import tempfile,os,json
        with tempfile.TemporaryDirectory() as folder:
            file=pathlib.Path(folder)/'control.json';file.write_text(json.dumps({'cancel':'old'}))
            with patch.dict(os.environ,{'NOPILOT_CONTROL_FILE':str(file)}):
                self.assertTrue(rpc.cancellation({'controlId':'old'}));self.assertFalse(rpc.cancellation({'controlId':'new'}));self.assertFalse(rpc.cancellation({}))
    def test_rediscovery_uses_the_manifest_selected_for_the_attached_runtime(self):
        from bridge import Bridge
        import frida
        b=Bridge.__new__(Bridge);b.manifest={'frameVtable':123};b.metadata={'pid':7,'moduleBase':'0x1000'};b.frame='old'
        b.evaluate=__import__('unittest.mock',fromlist=['Mock']).Mock(side_effect=[frida.core.RPCException('Frame is destroyed or inaccessible'),{'editorPresent':True}])
        b._select_frame=lambda candidates:setattr(b,'frame','new')
        with patch('bridge.discover_frames',return_value={'frames':['new']}) as discover,patch('bridge.json.loads',side_effect=AssertionError('must not reread default manifest')):
            self.assertTrue(b.state()['editorPresent'])
            discover.assert_called_once_with(7,0x1000+123)
    def test_model_is_verified_before_upload_and_failure_sends_nothing(self):
        calls=[]
        bridge=SimpleNamespace(state=lambda: {},ask=lambda *a,**k:(calls.append('ask') or {'answer':'ok'}))
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
