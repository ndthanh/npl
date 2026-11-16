import json
import pathlib
import sys
import tempfile
import unittest
import uuid
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'bridge'))
import database
from migration import compare, schema

class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()
    def snapshot(self, columns, rows, truncated=False):
        identifier = uuid.uuid4().hex
        (self.root / (identifier + '.jsonl')).write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')
        (self.root / (identifier + '.meta.json')).write_text(json.dumps({'columns':[{'name':c} for c in columns], 'rowCount':len(rows), 'truncated':truncated, 'elapsedMs':1}), encoding='utf-8')
        return identifier
    def check(self, a, b, **options): return compare(self.root, a, b, {'sameCutoff':True, **options})
    def test_real_query_all_rows_not_preview_and_schema(self):
        p = {'kind':'sqlite', 'path':database.demo(self.root)['path']}
        a = database.query(self.root, p, 'SELECT order_id, revenue FROM sales', 1000)
        b = database.query(self.root, p, 'SELECT order_id, revenue + CASE WHEN order_id=149 THEN 1 ELSE 0 END AS revenue FROM sales ORDER BY order_id DESC', 1000)
        self.assertEqual(len(a['rows']), 50)
        result = self.check(a['id'], b['id'], keys='order_id', numeric='revenue')
        self.assertEqual((result['status'],result['sourceRows'],result['changed']), ('fail',150,1))
        self.assertEqual(result['samples'][0]['source'][0], '149')
        self.assertEqual(schema(p)['tables'][0]['name'], 'sales')
    def test_order_independent_multiset_preserves_duplicates(self):
        a = self.snapshot(['a'], [[1],[1],[2]])
        b = self.snapshot(['a'], [[2],[1],[1]])
        self.assertEqual(self.check(a,b)['status'], 'pass')
        b = self.snapshot(['a'], [[1],[2],[2]])
        r = self.check(a,b)
        self.assertEqual((r['missing'], r['extra']), (1,1))
    def test_key_mapping_reorder_and_tolerance_exact_decimal(self):
        a = self.snapshot(['id','amount'], [[1,'12345678901234567890.01']])
        b = self.snapshot(['value','key'], [['12345678901234567890.02',1]])
        opts={'mapping':'id=key\namount=value','keys':'id','numeric':'amount','tolerance':'0.01'}
        self.assertEqual(self.check(a,b,**opts)['status'], 'pass')
        opts['tolerance']='0.009'
        self.assertEqual(self.check(a,b,**opts)['changed'], 1)
    def test_null_empty_types_and_trim_explicit(self):
        a = self.snapshot(['x'], [[None],[''],[1],['1'],[' a ']])
        b = self.snapshot(['x'], [[None],[''],[1],['1'],['a']])
        self.assertEqual(self.check(a,b)['status'],'fail')
        self.assertEqual(self.check(a,b,trim=True)['status'],'pass')
        b = self.snapshot(['x'], [[''],[''],[1],['1'],[' a ']])
        self.assertEqual(self.check(a,b)['missing'],1)
    def test_decimal38_is_not_rounded_by_python_default_context(self):
        a=self.snapshot(['id','amount'],[[1,'123456789012345678901234567890123456.01']])
        b=self.snapshot(['id','amount'],[[1,'123456789012345678901234567890123456.03']])
        self.assertEqual(self.check(a,b,keys='id',numeric='amount',tolerance='0.01')['status'],'fail')
        self.assertEqual(self.check(a,b,keys='id',numeric='amount',tolerance='0.02')['status'],'pass')
    def test_inconclusive_truncation_duplicate_keys_cutoff_partial_mapping(self):
        a = self.snapshot(['id','x'], [[1,2],[1,3]])
        b = self.snapshot(['id','x'], [[1,2],[1,3]],True)
        r=self.check(a,b,keys='id',sameCutoff=False)
        self.assertEqual(r['status'],'inconclusive')
        self.assertEqual(r['duplicateSource'],2)
        self.assertEqual(len(r['reasons']),3)
        self.assertEqual(self.check(a,a,mapping='id=id')['status'],'inconclusive')
    def test_missing_extra_changed_and_samples_bound(self):
        a=self.snapshot(['id','x'], [[i,0] for i in range(200)])
        b=self.snapshot(['id','x'], [[i,1] for i in range(1,201)])
        r=self.check(a,b,keys='id')
        self.assertEqual((r['missing'],r['extra'],r['changed']),(1,1,199))
        self.assertEqual(len(r['samples']),100)
    def test_invalid_mapping_key_number_and_identifier(self):
        a=self.snapshot(['id','x'],[[1,'bad']])
        for opts in [{'mapping':'id=missing'},{'mapping':'id=id\nid=x'},{'keys':'missing'}, {'numeric':'x'}, {'tolerance':'NaN'}, {'tolerance':'-1'}, {'tolerance':'1'}]:
            with self.assertRaises(ValueError): self.check(a,a,**opts)
        with self.assertRaises(ValueError): self.check('../outside',a)
        b=self.snapshot(['ID','id'],[[1,2]])
        with self.assertRaises(ValueError):self.check(b,b)
    def test_empty_results_and_null_keys(self):
        a=self.snapshot(['id'],[])
        self.assertEqual(self.check(a,a,keys='id')['status'],'pass')
        b=self.snapshot(['id'],[[None],[None]])
        self.assertEqual(self.check(b,b,keys='id')['status'],'inconclusive')

if __name__ == '__main__': unittest.main()
