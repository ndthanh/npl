"""Local SQL/ODBC worker. Secrets arrive on stdin; no Teams or Frida dependency."""
from __future__ import annotations
import base64
import csv
import datetime
import decimal
import json
import math
import pathlib
import re
import sqlite3
import struct
import sys
import time
import uuid

def odbc_state(error):
    for arg in getattr(error,'args',()):
        if not isinstance(arg,str):continue
        if re.fullmatch(r'[A-Z0-9]{5}',arg):return arg
        match=re.search(r'\[([A-Z0-9]{5})\]',arg)
        if match:return match.group(1)
    return 'unknown'

class OdbcFailure(RuntimeError):
    def __init__(self,error,phase):
        self.original=error;self.phase=phase
        super().__init__('ODBC operation failed')

def odbc_error(error):
    phase=error.phase if isinstance(error,OdbcFailure) else 'ODBC'
    original=error.original if isinstance(error,OdbcFailure) else error
    state=odbc_state(original)
    # Classify locally; never return raw driver text, credentials, hosts or SQL.
    raw=str(original).lower()
    if state in ('IM002','IM003'):hint='Không tìm được DSN/driver trong Python hiện tại. Chọn DSN trong Nopilot Data và kiểm tra driver cùng kiến trúc Python.'
    elif state=='IM014':hint='DSN và Python khác kiến trúc 32/64-bit.'
    elif state=='28000' or re.search(r'authentication|unauthor|invalid.*token|expired|oauth|credential|\b401\b|\b403\b',raw):hint='Xác thực hoặc quyền truy cập bị từ chối. Kiểm tra cơ chế auth/token của DSN và quyền dùng warehouse.'
    elif state in ('HYT00','HYT01') or 'timed out' in raw or 'timeout expired' in raw:hint='Hết thời gian chờ. Kiểm tra mạng/VPN, warehouse đã chạy và cấu hình DSN.'
    elif state in ('HYC00','HY092','HY024','IM001') or 'not supported' in raw or 'optional feature' in raw:hint='Driver không hỗ trợ một thuộc tính/tính năng ODBC. Kiểm tra phiên bản driver của DSN.'
    elif 'httppath' in raw or 'http path' in raw or '404' in raw:hint='Kiểm tra HTTPPath và warehouse/cluster trong cấu hình DSN.'
    elif state.startswith('08') or re.search(r'certificate|ssl|tls|proxy|resolve|network|connection refused',raw):hint='Không kết nối được tới dịch vụ. Kiểm tra host/HTTPPath, SSL, proxy/VPN và warehouse; không tắt xác minh chứng chỉ.'
    elif state in ('42000','42501'):hint='Lỗi cú pháp hoặc quyền truy cập dữ liệu. Kiểm tra catalog/schema và quyền SELECT.'
    else:hint='Kiểm tra Test trong ODBC Administrator, cấu hình DSN, xác thực và trạng thái warehouse.'
    return f'ODBC operation failed · bước {phase} · SQLSTATE {state}. {hint} Chi tiết nhạy cảm đã được ẩn.'

def connection_string(value):
    value=str(value).strip()
    if value and '=' not in value and ';' not in value and not re.search(r'[\x00-\x1f]',value):
        return 'DSN={'+value.replace('}','}}')+'};'
    return value

def safe_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[a-f0-9]{32}',value):raise ValueError('Invalid result ID')
    return value

def cell(value):
    if isinstance(value,int) and not isinstance(value,bool) and abs(value)>=10**15:return str(value)
    if value is None or isinstance(value,(str,bool,int)):return value
    if isinstance(value,float):return value if math.isfinite(value) else str(value)
    if isinstance(value,(datetime.datetime,datetime.date,datetime.time)):return value.isoformat()
    if isinstance(value,(bytes,bytearray,memoryview)):return 'base64:'+base64.b64encode(value).decode()
    if isinstance(value,decimal.Decimal):return str(value)
    return str(value)

def select_statement(sql):
    try:import sqlparse
    except ImportError:raise RuntimeError('Thiếu sqlparse. Chạy /setup hoặc cài bridge/requirements-data.txt.')
    statements=[s for s in sqlparse.parse(sql) if str(s).strip()]
    if len(statements)!=1 or statements[0].get_type()!='SELECT':raise ValueError('Chỉ nhận một SELECT hoặc WITH … SELECT. Dùng tài khoản/DSN chỉ có quyền đọc.')
    from sqlparse import tokens as T
    for token in statements[0].flatten():
        if token.ttype in T.Keyword.DDL or (token.ttype in T.Keyword.DML and token.normalized!='SELECT') or (token.ttype in T.Keyword and token.normalized in {'INTO','EXEC','EXECUTE','CALL','COPY','ATTACH','DETACH','PRAGMA','VACUUM'}):raise ValueError('Query không phải SELECT chỉ đọc.')
    return str(statements[0])

def connect(profile):
    if profile.get('kind')=='sqlite':
        file=pathlib.Path(profile['path']).resolve(strict=True)
        conn=sqlite3.connect(file.as_uri()+'?mode=ro',uri=True,timeout=10)
        conn.execute('PRAGMA query_only=ON')
        return conn
    if profile.get('kind')=='odbc':
        try:import pyodbc
        except ImportError:raise RuntimeError('Thiếu pyodbc. Chạy /setup để cài database dependencies.')
        # Databricks uses autocommit; do not request transaction/access-mode attributes.
        # SELECT validation and database permissions remain the read-only boundary.
        try:conn=pyodbc.connect(connection_string(profile['connectionString']),autocommit=True,timeout=15)
        except Exception as error:raise OdbcFailure(error,'mở kết nối') from None
        try:conn.timeout=30
        except Exception as error:
            if odbc_state(error) not in ('HYC00','HY092','IM001'):
                conn.close();raise OdbcFailure(error,'thiết lập query timeout') from None
        return conn
    raise ValueError('Unsupported database provider')

def capabilities():
    try:
        import pyodbc
        sources=pyodbc.dataSources()
        return {'odbc':True,'pythonBits':struct.calcsize('P')*8,'drivers':pyodbc.drivers(),'dataSources':list(sources),'sourceDrivers':sources}
    except ImportError:return {'odbc':False,'pythonBits':struct.calcsize('P')*8,'drivers':[],'dataSources':[],'sourceDrivers':{}}

def demo(root):
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=True);file=root/'demo-sales.sqlite'
    conn=sqlite3.connect(file)
    try:
        conn.execute('CREATE TABLE IF NOT EXISTS sales (order_id INTEGER PRIMARY KEY, customer TEXT, region TEXT, product TEXT, quantity INTEGER, revenue REAL, order_date TEXT, note TEXT)')
        if not conn.execute('SELECT count(*) FROM sales').fetchone()[0]:
            names=['Nguyễn An','Trần Minh','Lê Thu','Phạm Linh','Đỗ Huy','Vũ Mai']
            rows=[]
            for i in range(1,151):rows.append((i,names[(i-1)%6],['Hà Nội','Đà Nẵng','TP. Hồ Chí Minh'][(i-1)%3],['Notebook','Keyboard','Monitor','Dock'][(i-1)%4],i%5+1,round((i%5+1)*(49.5+(i%4)*25),2),'2026-10-%02d'%(i%28+1),None if i%4 else 'Đơn hàng ưu tiên'))
            conn.executemany('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?)',rows);conn.commit()
    finally:conn.close()
    return {'path':str(file.resolve()),'rows':150}

def query(root,profile,sql,limit=1000,session=None):
    from sql_plan import plan,merge_session
    uses,statement=plan(sql,select_statement)
    context=merge_session([],session or [])
    updated=merge_session(context,uses)
    if not isinstance(limit,int) or limit not in (1000,10000,100000):raise ValueError('Chọn số dòng 1000, 10000 hoặc 100000.')
    root=pathlib.Path(root);root.mkdir(parents=True,exist_ok=True);identifier=uuid.uuid4().hex;start=time.monotonic();conn=connect(profile)
    data=root/(identifier+'.jsonl');columns=[];preview=[];count=0;truncated=False
    try:
        cursor=conn.cursor()
        if profile['kind']=='sqlite':conn.set_progress_handler(lambda:1 if time.monotonic()-start>30 else 0,1000)
        if profile['kind']=='sqlite' and (context or uses):raise ValueError('SQLite không hỗ trợ USE. Chọn kết nối ODBC cho catalog/schema.')
        for use in [*context,*uses]:cursor.execute(use)
        if statement is not None:cursor.execute(statement)
        if statement is not None and cursor.description is None:raise ValueError('Query không trả bảng dữ liệu.')
        columns=[{'name':str(c[0]),'type':getattr(c[1],'__name__',str(c[1] or ''))} for c in (cursor.description if statement is not None else [])]
        with data.open('x',encoding='utf-8') as out:
            while statement is not None and count<limit:
                batch=cursor.fetchmany(min(500,limit-count))
                if not batch:break
                for row in batch:
                    values=[cell(v) for v in row];out.write(json.dumps(values,ensure_ascii=False)+'\n');count+=1
                    if len(preview)<50:preview.append(values)
            truncated=bool(cursor.fetchmany(1)) if statement is not None else False
        result={'id':identifier,'columns':columns,'rowCount':count,'truncated':truncated,'limit':limit,'elapsedMs':round((time.monotonic()-start)*1000),'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rows':preview,'offset':0,'pageSize':50,'session':updated,'commandOnly':statement is None}
        (root/(identifier+'.meta.json')).write_text(json.dumps({k:v for k,v in result.items() if k!='rows'},ensure_ascii=False),encoding='utf-8')
        return result
    except Exception as error:
        data.unlink(missing_ok=True)
        if profile['kind']=='odbc':raise OdbcFailure(error,'thực thi/lấy kết quả') from None
        raise
    finally:conn.close()

def page(root,identifier,offset):
    safe_id(identifier);root=pathlib.Path(root)
    if not isinstance(offset,int) or offset<0:raise ValueError('Invalid page offset')
    meta=json.loads((root/(identifier+'.meta.json')).read_text(encoding='utf-8'));rows=[]
    with (root/(identifier+'.jsonl')).open(encoding='utf-8') as data:
        for i,line in enumerate(data):
            if i<offset:continue
            if len(rows)>=50:break
            rows.append(json.loads(line))
    return {**meta,'offset':offset,'rows':rows}

def csv_cell(value):
    if isinstance(value,str) and value.lstrip().startswith(('=','+','-','@','\t','\r')):return "'"+value
    return value

def export(root,identifier,format):
    safe_id(identifier);root=pathlib.Path(root)
    if format not in ('csv','xlsx'):raise ValueError('CSV hoặc XLSX thôi.')
    meta=json.loads((root/(identifier+'.meta.json')).read_text(encoding='utf-8'));target=root/(identifier+'.'+format)
    if meta.get('commandOnly'):raise ValueError('USE đã đổi context; không có bảng để export.')
    def rows():
        with (root/(identifier+'.jsonl')).open(encoding='utf-8') as data:
            for line in data:yield json.loads(line)
    headers=[c['name'] for c in meta['columns']]
    if format=='csv':
        with target.open('w',encoding='utf-8-sig',newline='') as out:
            writer=csv.writer(out);writer.writerow([csv_cell(v) for v in headers])
            for row in rows():writer.writerow([csv_cell(v) for v in row])
    else:
        try:from openpyxl import Workbook
        except ImportError:raise RuntimeError('Thiếu openpyxl. Chạy /setup để cài export Excel.')
        from openpyxl.cell import WriteOnlyCell
        book=Workbook(write_only=True);sheet=book.create_sheet('Results')
        def append(values):
            cells=[]
            for value in values:
                if isinstance(value,str) and (len(value)>32767 or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]',value)):raise ValueError('Cell không phù hợp giới hạn Excel/XML; dùng export CSV để giữ đầy đủ dữ liệu.')
                c=WriteOnlyCell(sheet,value=value)
                if isinstance(value,str):c.data_type='s'
                cells.append(c)
            sheet.append(cells)
        append(headers)
        for row in rows():append(row)
        book.save(target)
    return {'path':str(target.resolve()),'rows':meta['rowCount'],'truncated':meta['truncated'],'bytes':target.stat().st_size}

def dispatch(request):
    method=request['method'];p=request.get('params',{});root=p.get('root')
    if method=='capabilities':return capabilities()
    if method=='demo':return demo(root)
    if method=='compare':
        from migration import compare
        return compare(root,p['source'],p['target'],p.get('options'))
    if method=='schema':
        from migration import schema
        return schema(p['profile'])
    if method=='test':
        conn=connect(p['profile'])
        sql='SELECT 1 FROM DUAL' if p['profile'].get('engine')=='oracle' else 'SELECT 1'
        try:
            cursor=conn.cursor();cursor.execute(sql);cursor.fetchone();return {'connected':True,'provider':p['profile'].get('engine') or p['profile']['kind']}
        except Exception as error:
            if p['profile']['kind']=='odbc':raise OdbcFailure(error,'chạy truy vấn kiểm tra') from None
            raise
        finally:conn.close()
    if method=='query':return query(root,p['profile'],p['sql'],p.get('limit',1000),p.get('session'))
    if method=='page':return page(root,p['id'],p['offset'])
    if method=='export':return export(root,p['id'],p['format'])
    raise ValueError('Unknown database operation')

if __name__=='__main__':
    request={}
    try:
        request=json.loads(sys.stdin.read());result=dispatch(request);print(json.dumps({'result':result},ensure_ascii=True))
    except Exception as error:
        # Never return driver errors/connection strings that may contain tokens.
        message=str(error) if request.get('params',{}).get('profile',{}).get('kind')!='odbc' or isinstance(error,ValueError) or (isinstance(error,RuntimeError) and str(error).startswith('Thiếu ')) else odbc_error(error)
        print(json.dumps({'error':message},ensure_ascii=True));sys.exit(1)
