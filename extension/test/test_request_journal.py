import json,pathlib,sys,tempfile,unittest
from unittest.mock import Mock,patch
from types import SimpleNamespace
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'bridge'))
from request_journal import RequestJournal,fingerprint,recover
from bridge import Bridge

RID='11111111-1111-1111-1111-111111111111'
CID='22222222-2222-2222-2222-222222222222'
OTHER='33333333-3333-3333-3333-333333333333'
ROUTE='/chat/conversation/'+CID
class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.file=pathlib.Path(self.temp.name)/'request.json'
        self.file.write_text(json.dumps(dict(requestId=RID,promptSha256=fingerprint('test'),phase='prepared')),encoding='utf-8')
        self.events=[];self.journal=RequestJournal(self.file,RID,'test',self.events.append)
    def tearDown(self):self.temp.cleanup()
    def state(self,**extra):return dict(route='/chat',generating=False,draft='',turns=[],editorPresent=True,**extra)
    def test_records_id_before_response_completion_and_send_intent_before_click(self):
        b=Bridge.__new__(Bridge);initial=self.state()
        generation={**initial,'route':ROUTE,'generating':True,'turns':[dict(id='turn-1',question='test',answer='',copyReady=False)]}
        b.state=Mock(side_effect=[initial,{**initial,'draft':'test'},generation,RuntimeError('simulated disconnect')]);b.fill_draft=Mock(return_value={'inserted':True})
        def send(_):
            self.assertEqual(json.loads(self.file.read_text())['phase'],'send_intent')
            return {'sent':True}
        b.evaluate=Mock(side_effect=send)
        with patch('bridge.time.sleep'),self.assertRaisesRegex(RuntimeError,'disconnect'):b.ask('test',journal=self.journal)
        saved=json.loads(self.file.read_text());self.assertEqual(saved['teamsId'],CID);self.assertEqual(saved['turnId'],'turn-1');self.assertEqual(saved['phase'],'submitted')
        b.evaluate.assert_called_once();self.assertTrue(any(e.get('teamsId')==CID for e in self.events))
    def test_recovery_restores_id_and_reads_matching_turn_not_last(self):
        self.journal.update(phase='submitted',teamsId=CID,beforeTurns=[])
        target=dict(id='wanted',question='test',answer='correct',copyReady=True)
        state={**self.state(),'route':ROUTE,'turns':[target,dict(id='later',question='different',answer='wrong',copyReady=True)]}
        h=SimpleNamespace(bridge=SimpleNamespace(state=Mock(return_value=state)),restore_chat=Mock())
        with patch('request_journal.time.sleep'):result=recover(h,self.journal)
        h.restore_chat.assert_called_once_with(CID);self.assertEqual(result['answer'],'correct');self.assertEqual(result['id'],'wanted')
    def test_manual_stop_releases_live_wait_and_recovery_without_importing_partial_answer(self):
        b=Bridge.__new__(Bridge);initial=self.state()
        stopped={**initial,'route':ROUTE,'turns':[dict(id='turn-1',question='test',answer='partial',copyReady=False,stopped=True)]}
        b.state=Mock(side_effect=[initial,{**initial,'draft':'test'},stopped])
        b.fill_draft=Mock(return_value={'inserted':True})
        b.evaluate=Mock(return_value={'sent':True})
        progress=Mock()
        reply=b.ask('test',journal=self.journal,progress=progress)
        self.assertEqual(reply['completion'],'stopped');self.assertEqual(reply['answer'],'')
        progress.assert_not_called()
        h=SimpleNamespace(bridge=SimpleNamespace(state=Mock(return_value=stopped)),restore_chat=Mock())
        reply=recover(h,self.journal,timeout=0)
        self.assertEqual(reply['completion'],'stopped');self.assertEqual(self.journal.value['phase'],'stopped')
    def test_wrong_conversation_and_ambiguous_turns_cannot_import(self):
        self.journal.update(phase='submitted',teamsId=CID,beforeTurns=[])
        t=dict(id='a',question='test',answer='x',copyReady=True)
        with self.assertRaisesRegex(RuntimeError,'Wrong Copilot'):self.journal.observe({**self.state(),'route':'/chat/conversation/'+OTHER,'turns':[t]})
        with self.assertRaisesRegex(RuntimeError,'Ambiguous'):self.journal.match({**self.state(),'route':ROUTE,'turns':[t,{**t,'id':'b'}]})
    def test_unrelated_route_without_matching_prompt_is_not_adopted(self):
        self.journal.update(phase='submitted',beforeTurns=[])
        self.journal.observe({**self.state(),'route':ROUTE,'turns':[dict(id='x',question='different')]})
        self.assertIsNone(self.journal.value.get('teamsId'))
    def test_preexisting_prompt_cannot_be_mistaken_for_new_turn_after_dom_remount(self):
        self.journal.update(phase='submitted',teamsId=CID,beforeTurns=[{'id':'old','hash':fingerprint('test')}])
        self.assertIsNone(self.journal.match({**self.state(),'route':ROUTE,'turns':[dict(id='new-dom-id',question='test')]}))
    def test_prepared_request_never_sends_or_switches_conversation(self):
        h=SimpleNamespace(restore_chat=Mock(),bridge=SimpleNamespace(state=Mock()))
        self.assertEqual(recover(h,self.journal)['completion'],'not_sent');h.restore_chat.assert_not_called();h.bridge.state.assert_not_called()
        self.journal.update(phase='send_intent')
        with self.assertRaisesRegex(RuntimeError,'recover it'):self.journal.before_send(self.state())
    def test_stopped_request_never_imports_a_partial_answer(self):
        self.journal.update(phase='stopped',route=ROUTE)
        h=SimpleNamespace(restore_chat=Mock(),bridge=SimpleNamespace(state=Mock()))
        value=recover(h,self.journal);self.assertEqual(value['completion'],'stopped');self.assertEqual(value['answer'],'');h.bridge.state.assert_not_called()
    def test_cancel_during_read_only_reconnect_stops_only_the_matching_turn(self):
        self.journal.update(phase='submitted',teamsId=CID,beforeTurns=[])
        state={**self.state(),'route':ROUTE,'generating':True,'turns':[dict(id='wanted',question='test',answer='partial',copyReady=False)]}
        h=SimpleNamespace(restore_chat=Mock(),bridge=SimpleNamespace(state=Mock(return_value=state),stop_generation=Mock(return_value={'stopped':True})))
        result=recover(h,self.journal,cancelled=lambda:True)
        self.assertEqual(result['completion'],'stopped');self.assertEqual(result['answer'],'');h.bridge.stop_generation.assert_called_once_with('test')
    def test_rpc_reconnects_after_send_without_calling_ask_twice(self):
        import rpc
        def interrupted(*args,**kwargs):kwargs['journal'].update(phase='submitted');raise RuntimeError('Copilot frame was replaced; reconnect before sending another prompt')
        bridge=SimpleNamespace(ask=Mock(side_effect=interrupted),state=self.state)
        reply={'id':'target','route':ROUTE,'answer':'Recovered','completion':'completed'}
        with patch('rpc.connect',return_value=bridge),patch('model_selector.select_model',return_value={'verified':True}),patch('connection.establish') as establish,patch('request_journal.recover',return_value=reply) as inspect,patch.object(rpc.harness,'downloads',return_value=[]):
            result=rpc.dispatch('ask',{'prompt':'test','requestId':RID,'journalFile':str(self.file)})
        self.assertEqual(result['answer'],'Recovered');bridge.ask.assert_called_once();establish.assert_called_once();inspect.assert_called_once()
    def test_hash_mismatch_rejected_and_existing_target_must_match_before_send(self):
        with self.assertRaisesRegex(ValueError,'match prompt'):RequestJournal(self.file,RID,'different')
        self.journal.update(teamsId=CID)
        with self.assertRaisesRegex(RuntimeError,'Wrong Copilot'):self.journal.before_send(self.state())
    def test_generating_or_missing_turn_returns_unconfirmed_without_answer(self):
        self.journal.update(phase='submitted',teamsId=CID,beforeTurns=[])
        h=SimpleNamespace(restore_chat=Mock(),bridge=SimpleNamespace(state=Mock(return_value={**self.state(),'route':ROUTE,'generating':True,'turns':[dict(question='test',answer='partial',copyReady=False)]})))
        result=recover(h,self.journal,timeout=0)
        self.assertEqual(result['completion'],'generating');self.assertEqual(result['answer'],'')
    def test_early_discovery_survives_new_journal_instance(self):
        self.journal.update(phase='submitted',beforeTurns=[])
        self.journal.observe({**self.state(),'route':ROUTE,'turns':[dict(id='target',question='test')]})
        loaded=RequestJournal(self.file,RID,'test');self.assertEqual(loaded.value['teamsId'],CID)
    def test_windows_replace_sharing_violation_retries_before_emitting_progress(self):
        import os
        replace=os.replace;calls=[]
        def transient(source,target):
            calls.append(1)
            if len(calls)<3:raise PermissionError('sharing violation')
            return replace(source,target)
        with patch('request_journal.os.replace',side_effect=transient),patch('request_journal.time.sleep'):
            self.journal.update(phase='send_intent')
        self.assertEqual(len(calls),3);self.assertEqual(json.loads(self.file.read_text())['phase'],'send_intent');self.assertEqual(self.events[-1]['phase'],'send_intent')

class RestoreTests(unittest.TestCase):
    def test_history_click_uses_exact_id_and_verifies_route_even_while_target_is_generating(self):
        from transport import Harness
        h=Harness();route=['/chat/conversation/'+OTHER];expressions=[]
        def evaluate(expression):
            expressions.append(expression)
            if expression=='location.pathname':return route[0]
            if 'getElementById' in expression:
                self.assertIn(json.dumps(CID),expression);self.assertIn('tagName',expression)
                route[0]=ROUTE;return True
            return False
        h.bridge=SimpleNamespace(evaluate=evaluate,state=lambda:dict(editorPresent=True,draft='',generating=route[0]==ROUTE,turns=[{'question':'loaded'}]))
        with patch('transport.time.sleep'):h.restore_chat(CID)
        self.assertEqual(route[0],ROUTE)
        self.assertEqual(sum('getElementById' in expression for expression in expressions),1)
    def test_wrong_foreground_draft_is_never_discarded_to_restore_another_chat(self):
        from transport import Harness
        h=Harness();h.bridge=SimpleNamespace(evaluate=Mock(return_value='/chat/conversation/'+OTHER),state=Mock(return_value=dict(draft='user draft',generating=False)))
        with self.assertRaisesRegex(RuntimeError,'unsent draft'):h.restore_chat(CID)
        self.assertFalse(any('.click()' in call.args[0] for call in h.bridge.evaluate.call_args_list))
    def test_navigation_to_wrong_route_never_claims_restore_success(self):
        from transport import Harness
        h=Harness()
        h.bridge=SimpleNamespace(evaluate=lambda expression:('/chat/conversation/'+OTHER if expression=='location.pathname' else True if 'getElementById' in expression else False),state=lambda:dict(editorPresent=True,draft='',generating=False,turns=[{}]))
        with patch('transport.time.monotonic',side_effect=[0,0,31]),patch('transport.time.sleep'),self.assertRaisesRegex(RuntimeError,'Could not restore'):h.restore_chat(CID)

if __name__=='__main__':unittest.main()
