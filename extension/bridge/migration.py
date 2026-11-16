"""Reconcile immutable local snapshots, never the 50-row preview."""
import collections
import decimal
import json
import pathlib
import re


def compare(root, source, target, options=None):
    from database import safe_id
    options = options or {}
    root = pathlib.Path(root)
    def load(identifier):
        safe_id(identifier)
        meta = json.loads((root / (identifier + '.meta.json')).read_text(encoding='utf-8'))
        if meta.get('commandOnly'):
            raise ValueError('Cần SELECT trả dữ liệu ở cả hai phía, không chỉ USE.')
        with (root / (identifier + '.jsonl')).open(encoding='utf-8') as stream:
            rows = [json.loads(line) for line in stream]
        if len(rows) != meta['rowCount']:
            raise ValueError('Snapshot thiếu dữ liệu. Chạy đối chiếu lại.')
        names = [c['name'] for c in meta['columns']]
        if len(set(n.casefold() for n in names)) != len(names):
            raise ValueError('Tên cột trùng nhau. Đặt alias duy nhất trước khi đối chiếu.')
        return meta, names, rows
    sm, sn, sr = load(source)
    tm, tn, tr = load(target)
    mappings = []
    for line in str(options.get('mapping', '')).splitlines():
        if not line.strip():
            continue
        pair = [v.strip() for v in line.split('=')]
        if len(pair) != 2 or not all(pair):
            raise ValueError('Mapping mỗi dòng: cot_nguon=cot_dich.')
        mappings.append(pair)
    if not mappings:
        if set(n.casefold() for n in sn) != set(n.casefold() for n in tn):
            raise ValueError('Hai bên khác tên cột. Khai báo mapping hoặc đặt alias tương ứng.')
        mappings = [(n, next(t for t in tn if t.casefold() == n.casefold())) for n in sn]
    def index(names, value):
        matches = [i for i, n in enumerate(names) if n.casefold() == value.casefold()]
        if len(matches) != 1:
            raise ValueError('Không tìm thấy cột mapping/khóa: ' + value)
        return matches[0]
    si = [index(sn, a) for a, b in mappings]
    ti = [index(tn, b) for a, b in mappings]
    if len(set(si)) != len(si) or len(set(ti)) != len(ti):
        raise ValueError('Một cột chỉ được map một lần.')
    keys = [k.strip() for k in str(options.get('keys', '')).split(',') if k.strip()]
    mapped_names = [sn[i] for i in si]
    ki = [index(mapped_names, k) for k in keys]
    numeric = {index(mapped_names, k.strip()) for k in str(options.get('numeric', '')).split(',') if k.strip()}
    tolerance = decimal.Decimal(str(options.get('tolerance', '0') or '0'))
    if not tolerance.is_finite() or tolerance < 0:
        raise ValueError('Tolerance phải là số hữu hạn không âm.')
    if tolerance and not ki:
        raise ValueError('Tolerance cần khóa duy nhất để ghép dòng chính xác.')
    def norm(value, col):
        if value is None:
            return ('null', '')
        if col in numeric:
            try:
                number = decimal.Decimal(str(value))
                if not number.is_finite(): raise ValueError()
                return ('number', number)
            except (decimal.InvalidOperation, ValueError):
                raise ValueError('Giá trị không phải số trong cột numeric: ' + mapped_names[col])
        if isinstance(value, str):
            return ('str', value.strip() if options.get('trim') else value)
        return (type(value).__name__, str(value))
    def project(rows, cols):
        return [tuple(norm(row[c], i) for i, c in enumerate(cols)) for row in rows]
    left, right = project(sr, si), project(tr, ti)
    samples = []
    def display(row):
        return [None if kind == 'null' else str(value) for kind, value in row]
    def sample(kind, a=None, b=None, columns=None):
        if len(samples) < 100:
            samples.append({'kind': kind, 'source': display(a) if a is not None else None,
                            'target': display(b) if b is not None else None, 'columns': columns or []})
    missing = extra = changed = duplicate_source = duplicate_target = 0
    if ki:
        def groups(rows):
            result = collections.defaultdict(list)
            for row in rows: result[tuple(row[i] for i in ki)].append(row)
            return result
        lg, rg = groups(left), groups(right)
        duplicate_source = sum(len(rows) for rows in lg.values() if len(rows) > 1)
        duplicate_target = sum(len(rows) for rows in rg.values() if len(rows) > 1)
        for key in lg.keys() | rg.keys():
            a, b = lg.get(key, []), rg.get(key, [])
            if not b:
                missing += len(a)
                for row in a: sample('missing', row)
            elif not a:
                extra += len(b)
                for row in b: sample('extra', None, row)
            elif len(a) == len(b) == 1:
                differences = []
                for i, (x, y) in enumerate(zip(a[0], b[0])):
                    equal = x == y
                    if i in numeric and x[0] == y[0] == 'number':
                        with decimal.localcontext() as context:
                            context.prec = max(80, len(x[1].as_tuple().digits), len(y[1].as_tuple().digits), len(tolerance.as_tuple().digits)) + 10
                            equal = abs(x[1] - y[1]) <= tolerance
                    if not equal: differences.append(mapped_names[i])
                if differences:
                    changed += 1
                    sample('changed', a[0], b[0], differences)
    else:
        lc, rc = collections.Counter(left), collections.Counter(right)
        missing_rows, extra_rows = lc - rc, rc - lc
        missing, extra = sum(missing_rows.values()), sum(extra_rows.values())
        for row, count in missing_rows.items():
            for _ in range(min(count, 100)): sample('missing', row)
        for row, count in extra_rows.items():
            for _ in range(min(count, 100)): sample('extra', None, row)
    reasons = []
    if sm['truncated'] or tm['truncated']: reasons.append('Đã chạm fetch limit; chưa đối chiếu toàn bộ dữ liệu.')
    if duplicate_source or duplicate_target: reasons.append('Khóa không duy nhất; không thể ghép dòng an toàn.')
    if not options.get('sameCutoff'): reasons.append('Chưa xác nhận hai bên cùng mốc dữ liệu và tham số.')
    full_mapping = len(si) == len(sn) and len(ti) == len(tn)
    if not full_mapping: reasons.append('Mapping chỉ bao phủ một phần cột.')
    return {'status': 'inconclusive' if reasons else 'fail' if missing or extra or changed else 'pass',
            'reasons': reasons, 'missing': missing, 'extra': extra, 'changed': changed,
            'sourceRows': len(sr), 'targetRows': len(tr), 'sourceMs': sm['elapsedMs'], 'targetMs': tm['elapsedMs'],
            'duplicateSource': duplicate_source, 'duplicateTarget': duplicate_target,
            'columns': mapped_names, 'mapping': mappings, 'samples': samples, 'sampleLimit': 100,
            'mode': 'key' if ki else 'multiset', 'sourceId': source, 'targetId': target}


def schema(profile):
    from database import connect, OdbcFailure
    conn = connect(profile)
    try:
        cursor = conn.cursor()
        if profile['kind'] == 'sqlite':
            tables = cursor.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 201").fetchall()
            result = []
            for (name,) in tables[:200]:
                columns = conn.execute('PRAGMA table_info("' + name.replace('"', '""') + '")').fetchall()
                result.append({'name': name, 'columns': [{'name': c[1], 'type': c[2]} for c in columns]})
            return {'tables': result, 'truncated': len(tables) > 200}
        # Use bounded ODBC metadata for the DSN's default namespace.
        tables = []
        for row in cursor.tables(tableType='TABLE,VIEW'):
            tables.append({'catalog': row.table_cat, 'schema': row.table_schem, 'name': row.table_name})
            if len(tables) > 200: break
        return {'tables': tables[:200], 'truncated': len(tables) > 200,
                'note': 'ODBC metadata của namespace mặc định. Dùng SHOW TABLES trong Data để khám phá thêm.'}
    except Exception as error:
        if profile['kind'] == 'odbc': raise OdbcFailure(error, 'đọc metadata') from None
        raise
    finally:
        conn.close()
