import pathlib,sys,tempfile,unittest
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'bridge'))
import database as db
from sql_plan import plan,merge_session

class SqlPlanTests(unittest.TestCase):
 def test_show_metadata_and_use_are_allowed_but_write_batches_never_run(self):
  for sql in ['SHOW CATALOGS','SHOW TABLES IN main.default','-- comment\nSHOW SCHEMAS','SHOW CREATE TABLE my_table']:
   uses,query=plan(sql,db.select_statement);self.assertEqual(uses,[]);self.assertIn('SHOW',query)
  self.assertEqual(plan('USE CATALOG main; USE SCHEMA analytics; SELECT 1',db.select_statement)[0],['USE CATALOG main','USE SCHEMA analytics'])
  for sql in ['USE main; DELETE FROM t','SHOW TABLES; DROP TABLE t','USE IDENTIFIER(x)','SHOW SECRETS','SELECT 1; SELECT 2','SELECT 1; USE other']:
   with self.assertRaises(ValueError,msg=sql):plan(sql,db.select_statement)
 def test_catalog_change_resets_schema_and_qualified_use_preserves_new_catalog(self):
  self.assertEqual(merge_session(['USE CATALOG old','USE SCHEMA old_schema'],['USE CATALOG new']),['USE CATALOG new'])
  self.assertEqual(merge_session(['USE CATALOG old'],['USE newcat.newschema']),['USE CATALOG newcat','USE SCHEMA newschema'])
  self.assertEqual(merge_session(['USE newcat.newschema'],['USE SCHEMA another']),['USE CATALOG newcat','USE SCHEMA another'])
  self.assertEqual(merge_session([], ["USE CATALOG 'hive_metastore'"]),["USE CATALOG 'hive_metastore'"])
 def test_odbc_context_is_reapplied_on_new_connections_and_use_has_no_export_table(self):
  executed=[]
  class Cursor:
   description=None
   def execute(self,sql):
    executed.append(sql);self.description=None if sql.upper().startswith('USE ') else [('value',str)];self.rows=[] if self.description is None else [('demo',)];return self
   def fetchmany(self,n):rows=self.rows[:n];self.rows=self.rows[n:];return rows
  class Connection:
   def cursor(self):return Cursor()
   def close(self):pass
  profile={'kind':'odbc','connectionString':'DSN={Fixture};'}
  with tempfile.TemporaryDirectory() as folder,patch.dict(sys.modules,{'pyodbc':SimpleNamespace(connect=lambda *a,**k:Connection())}):
   result=db.query(folder,profile,'USE CATALOG main; USE SCHEMA analytics; SHOW TABLES')
   self.assertEqual(result['rows'],[['demo']]);self.assertFalse(result['commandOnly'])
   executed.clear();db.query(folder,profile,'SELECT 1',session=result['session'])
   self.assertEqual(executed,['USE CATALOG main','USE SCHEMA analytics','SELECT 1'])
   changed=db.query(folder,profile,'USE CATALOG another',session=result['session'])
   self.assertTrue(changed['commandOnly']);self.assertEqual(changed['session'],['USE CATALOG another'])
   with self.assertRaisesRegex(ValueError,'không có bảng'):db.export(folder,changed['id'],'csv')

if __name__=='__main__':unittest.main()
