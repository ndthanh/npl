import csv,json,pathlib,sys,tempfile,unittest,zipfile,subprocess
from unittest.mock import patch
from types import SimpleNamespace
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'bridge'))
import database as db

class DatabaseTests(unittest.TestCase):
 def test_test_connection_uses_the_selected_sql_dialect(self):
  for engine, sql in [('oracle', 'SELECT 1 FROM DUAL'), ('databricks', 'SELECT 1')]:
   calls = []
   cursor = SimpleNamespace(execute=calls.append, fetchone=lambda: [1])
   connection = SimpleNamespace(cursor=lambda: cursor, close=lambda: calls.append('closed'))
   with patch.object(db, 'connect', return_value=connection):
    result = db.dispatch({'method': 'test', 'params': {'profile': {'kind': 'odbc', 'engine': engine}}})
   self.assertEqual(result['provider'], engine)
   self.assertEqual(calls, [sql, 'closed'])
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='nopilot-db-');self.root=pathlib.Path(self.temp.name);self.demo=db.demo(self.root);self.profile={'kind':'sqlite','path':self.demo['path']}
 def tearDown(self):self.temp.cleanup()
 def test_real_sqlite_connection_query_pagination_and_null(self):
  conn=db.connect(self.profile)
  try:
   self.assertEqual(conn.execute('SELECT count(*) FROM sales').fetchone()[0],150)
   with self.assertRaises(Exception):conn.execute('DELETE FROM sales')
  finally:conn.close()
  result=db.query(self.root,self.profile,'SELECT order_id,customer,note,revenue FROM sales ORDER BY order_id')
  self.assertEqual(result['rowCount'],150);self.assertFalse(result['truncated']);self.assertEqual(len(result['rows']),50);self.assertEqual(result['rows'][0][1],'Nguyễn An');self.assertIsNone(result['rows'][0][2]);self.assertEqual(db.page(self.root,result['id'],100)['rows'][0][0],101)
 def test_csv_and_excel_exports_use_the_same_snapshot_without_querying_again(self):
  result=db.query(self.root,self.profile,'SELECT order_id,customer,revenue FROM sales ORDER BY order_id')
  csv_file=db.export(self.root,result['id'],'csv');xlsx=db.export(self.root,result['id'],'xlsx')
  with open(csv_file['path'],encoding='utf-8-sig',newline='') as f:rows=list(csv.reader(f))
  self.assertEqual(len(rows),151);self.assertEqual(rows[1][1],'Nguyễn An')
  from openpyxl import load_workbook
  book=load_workbook(xlsx['path'],read_only=True);values=list(book.active.values);book.close();self.assertEqual(len(values),151);self.assertEqual(values[1][1],'Nguyễn An');self.assertIsInstance(values[1][2],(float,int))
 def test_exports_treat_formula_strings_as_data(self):
  result=db.query(self.root,self.profile,"SELECT '=HYPERLINK(\"http://example.com\")' AS formula, NULL AS blank")
  export=db.export(self.root,result['id'],'csv')
  with open(export['path'],encoding='utf-8-sig',newline='') as f:rows=list(csv.reader(f))
  self.assertTrue(rows[1][0].startswith("'="))
  xlsx=db.export(self.root,result['id'],'xlsx')
  from openpyxl import load_workbook
  book=load_workbook(xlsx['path']);self.assertEqual(book.active['A2'].data_type,'s');book.close()
 def test_fetch_limit_is_explicit_and_metadata_marks_partial_results(self):
  result=db.query(self.root,self.profile,'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1500) SELECT x FROM n',1000)
  self.assertEqual(result['rowCount'],1000);self.assertTrue(result['truncated']);self.assertTrue(db.export(self.root,result['id'],'csv')['truncated'])
 def test_write_statements_and_multiple_queries_are_rejected(self):
  for sql in ['DELETE FROM sales','SELECT 1; DELETE FROM sales','CREATE TABLE x(y)','WITH x AS (DELETE FROM sales RETURNING *) SELECT * FROM x','SELECT 1 INTO new_table']:
   with self.assertRaises(ValueError,msg=sql):db.select_statement(sql)
  self.assertIn('SELECT',db.select_statement("SELECT 'DELETE FROM sales' AS text"))
 def test_result_ids_do_not_allow_arbitrary_file_reads(self):
  with self.assertRaises(ValueError):db.page(self.root,'../secret',0)
  with self.assertRaises(ValueError):db.export(self.root,'../secret','csv')
 def test_odbc_connection_uses_databricks_autocommit_and_connection_timeout(self):
  calls=[];connection=SimpleNamespace(close=lambda:calls.append('close'))
  module=SimpleNamespace(connect=lambda *a,**k:(calls.append((a,k)) or connection))
  with patch.dict(sys.modules,{'pyodbc':module}):conn=db.connect({'kind':'odbc','connectionString':'DSN={Example};'})
  self.assertNotIn('readonly',calls[0][1]);self.assertEqual(calls[0][1]['timeout'],15);self.assertTrue(calls[0][1]['autocommit']);self.assertEqual(conn.timeout,30)
 def test_bare_dsn_name_is_normalized(self):
  self.assertEqual(db.connection_string('ExampleWarehouse'),'DSN={ExampleWarehouse};')
  self.assertEqual(db.connection_string('DSN={ExampleWarehouse};'),'DSN={ExampleWarehouse};')
 def test_safe_odbc_diagnostics_keep_sqlstate_and_phase_but_never_driver_text(self):
  for state in ['IM002','IM014','28000','HYT00','HYC00','08001','42000','HY000']:
   error=RuntimeError(state,'secret-host PWD=do_not_echo_token SELECT sensitive_data')
   text=db.odbc_error(db.OdbcFailure(error,'mở kết nối'))
   self.assertIn(state,text);self.assertIn('mở kết nối',text)
   for secret in ['secret-host','do_not_echo_token','sensitive_data']:self.assertNotIn(secret,text)
 def test_unsupported_query_timeout_does_not_discard_connected_session(self):
  class Connection:
   @property
   def timeout(self):return 0
   @timeout.setter
   def timeout(self,value):raise RuntimeError('HYC00','Optional feature unsupported')
  connection=Connection()
  with patch.dict(sys.modules,{'pyodbc':SimpleNamespace(connect=lambda *a,**k:connection)}):self.assertIs(db.connect({'kind':'odbc','connectionString':'ExampleWarehouse'}),connection)
 def test_odbc_error_never_echoes_credentials(self):
  request={'method':'test','params':{'profile':{'kind':'odbc','connectionString':'DRIVER={NopilotNonexistentDriver};PWD=do_not_echo_token;'}}}
  run=subprocess.run([sys.executable,str(pathlib.Path(db.__file__))],input=json.dumps(request),capture_output=True,text=True)
  self.assertNotIn('do_not_echo_token',run.stdout+run.stderr);self.assertIn('ODBC operation failed',run.stdout)

if __name__=='__main__':unittest.main()
