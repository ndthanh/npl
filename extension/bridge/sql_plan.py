"""Validate read/context SQL. Never execute arbitrary statement batches."""
import re

IDENT=r'(?:`(?:``|[^`])+`|"(?:""|[^"])+"|[A-Za-z_][\w$]*)'
USE=re.compile(r'^USE\s+(?:(CATALOG|SCHEMA|DATABASE)\s+)?('+IDENT+r'(?:\s*\.\s*'+IDENT+r')?)\s*;?$',re.I)
QUALIFIED=re.compile(r'^('+IDENT+r')\s*\.\s*('+IDENT+r')$')
SHOW=re.compile(r'^SHOW\s+(?:CATALOGS|DATABASES|SCHEMAS|TABLES|TABLE\s+EXTENDED|VIEWS|COLUMNS|(?:USER\s+|SYSTEM\s+|ALL\s+)?FUNCTIONS|PARTITIONS|TBLPROPERTIES|CREATE\s+TABLE|GRANTS)\b',re.I)

def use_statement(sql):
    import sqlparse
    clean=sqlparse.format(sql,strip_comments=True).strip()
    if re.fullmatch(r"USE\s+CATALOG\s+'(?:''|[^'])+'\s*;?",clean,re.I):return 'catalog',clean.rstrip(';').strip()
    match=USE.fullmatch(clean)
    if not match:raise ValueError('USE chỉ nhận catalog/schema identifier; không nhận biểu thức hoặc câu lệnh khác.')
    slot='catalog' if (match[1] or '').upper()=='CATALOG' else 'schema'
    if slot=='catalog' and '.' in re.sub(r'`(?:``|[^`])*`|"(?:""|[^"])*"','',match[2]):raise ValueError('USE CATALOG chỉ nhận một catalog.')
    return slot,clean.rstrip(';').strip()

def merge_session(previous,uses):
    slots={}
    for statement in [*(previous or []),*uses]:
        slot,sql=use_statement(statement)
        if slot=='catalog':slots.pop('schema',None)
        match=USE.fullmatch(sql)
        qualified=QUALIFIED.fullmatch(match[2]) if slot=='schema' and match else None
        if qualified:
            slots['catalog']='USE CATALOG '+qualified[1]
            slots['schema']='USE SCHEMA '+qualified[2]
        else:slots[slot]=sql
    return [slots[k] for k in ('catalog','schema') if k in slots]

def plan(sql,validate_select):
    try:import sqlparse
    except ImportError:raise RuntimeError('Thiếu sqlparse. Chạy /setup hoặc cài bridge/requirements-data.txt.')
    from sqlparse import tokens as T
    statements=[s for s in sqlparse.parse(sql) if sqlparse.format(str(s),strip_comments=True).strip().strip(';').strip()]
    if not statements:raise ValueError('SQL trống.')
    uses=[];query=None
    for statement in statements:
        text=str(statement);clean=sqlparse.format(text,strip_comments=True).strip()
        first=next((t.normalized.upper() for t in statement.flatten() if not t.is_whitespace and t.ttype not in T.Comment),'')
        if first=='USE':
            if query is not None:raise ValueError('Đặt USE trước SELECT/SHOW hoặc chạy USE riêng.')
            uses.append(use_statement(clean)[1]);continue
        if query is not None:raise ValueError('Chọn một SELECT/SHOW để chạy; có thể đặt USE trước nó.')
        if first=='SHOW':
            if not SHOW.match(clean):raise ValueError('SHOW hỗ trợ metadata catalog/schema/table/view/column/function/partition/properties/grants.')
            for token in statement.flatten():
                if token.is_keyword and (token.normalized in {'INSERT','UPDATE','DELETE','MERGE','DROP','ALTER','TRUNCATE','GRANT','REVOKE','EXEC','EXECUTE','CALL','COPY','SET'} or (token.normalized=='CREATE' and not re.match(r'^SHOW\s+CREATE\s+TABLE\b',clean,re.I))):raise ValueError('Không nhận câu lệnh ghi dữ liệu trong SHOW.')
            query=text
        else:query=validate_select(text)
    return uses,query
