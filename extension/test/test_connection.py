import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from connection import establish,retryable

class ConnectionTests(unittest.TestCase):
    def harness(self,failures=0,error='No accessible Copilot frame found'):
        class Fake:
            bridge=None
            calls=[]
            def connect(self,timeout):
                self.calls.append(timeout)
                if len(self.calls)<=failures:raise RuntimeError(error)
                self.bridge=True
                return dict(connected=True,editorPresent=True)
            def status(self):return dict(connected=True,editorPresent=True)
        return Fake()
    def test_retries_discovery_only_with_countdown_and_budget(self):
        h=self.harness(2);now=[0];events=[]
        def sleep(seconds):now[0]+=seconds
        result=establish(h,events.append,lambda:now[0],sleep)
        self.assertTrue(result['connected']);self.assertEqual(h.calls,[20,20,20])
        self.assertEqual(now[0],7)
        self.assertEqual([e['attempt'] for e in events if e['stage']=='finding'],[1,2,3])
        self.assertEqual([e['retryIn'] for e in events if e['stage']=='retrying'],[2,1,5,4,3,2,1])
        self.assertEqual(events[-1]['stage'],'connected')
    def test_healthy_connection_is_reused_without_switching_chat(self):
        h=self.harness();h.bridge=True
        self.assertTrue(establish(h)['connected']);self.assertEqual(h.calls,[])
    def test_exhaustion_and_permanent_failures_do_not_retry_forever(self):
        h=self.harness(10);events=[]
        with self.assertRaises(RuntimeError):establish(h,events.append,sleep=lambda seconds:None)
        self.assertEqual(len(h.calls),3);self.assertEqual(events[-1]['stage'],'failed')
        for error in ['WebView2 build changed','A native callback is still pending','Another Nopilot window controls Teams','More than one Copilot frame is open','Native RPC timeout','Access denied']:
            self.assertFalse(retryable(RuntimeError(error)))
            h=self.harness(10,error)
            with self.assertRaises(RuntimeError):establish(h,sleep=lambda seconds:None)
            self.assertEqual(len(h.calls),1)
    def test_total_budget_stops_before_another_attempt(self):
        now=[0];h=self.harness()
        def fail(timeout):h.calls.append(timeout);now[0]+=71;raise RuntimeError('No accessible Copilot frame found')
        h.connect=fail
        with self.assertRaises(RuntimeError):establish(h,clock=lambda:now[0],sleep=lambda seconds:None)
        self.assertEqual(len(h.calls),1)

if __name__=='__main__':unittest.main()
