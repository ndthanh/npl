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
    def test_zip_bomb_bounded_by_expanded_size(self):
        with self.assertRaises(ValueError):rpc.dispatch('unpack',{'base64':archive([('a.py','a'*(2*1024*1024+1))])})
    def test_binary_sources_do_not_get_silently_corrupted(self):
        with self.assertRaises(ValueError):rpc.dispatch('unpack',{'base64':archive([('image.png',b'\xff\x00')])})
    def test_unknown_rpc_cannot_evaluate_javascript_or_run_commands(self):
        for method in ['evaluate','exec','shell','approve']:
            with self.assertRaises(ValueError):rpc.dispatch(method,{})

if __name__=='__main__':unittest.main()
