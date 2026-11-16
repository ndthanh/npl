"""Public-symbol (PDB) access for EmbeddedBrowserWebView.dll, with failures classified instead of raised raw.

Used by the manifest generator and the diagnostics report. Standard library + pefile only. Only Microsoft's public
symbol server is contacted, and only for a file name + build key taken from the dll itself.
"""
import pathlib
import shutil
import socket
import ssl
import struct
import urllib.error
import urllib.request
import uuid

SERVER = 'https://msdl.microsoft.com/download/symbols/'
PDB_MAGIC = b'Microsoft C/C++ MSF 7.00'
USER_AGENT = 'Microsoft-Symbol-Server/10.0.0.0'      # the symbol server answers this agent the same way it answers Visual Studio


def codeview(pe):
    """(pdb file name, build key) from the dll's RSDS debug record, or raise ValueError saying why not."""
    entries = getattr(pe, 'DIRECTORY_ENTRY_DEBUG', None)
    if not entries:
        raise ValueError('the dll has no debug directory')
    seen = []
    for entry in entries:
        if entry.struct.Type != 2:
            continue
        record = pe.get_data(entry.struct.AddressOfRawData, entry.struct.SizeOfData)
        if record.startswith(b'RSDS'):
            name = pathlib.PureWindowsPath(record[24:].rstrip(b'\0').decode(errors='replace')).name
            key = uuid.UUID(bytes_le=record[4:20]).hex.upper() + format(struct.unpack_from('<I', record, 20)[0], 'X')
            return name, key
        seen.append(record[:4])
    raise ValueError('no RSDS CodeView record in the debug directory' + (f' (found {seen})' if seen else ''))


def url_for(name, key):
    return f'{SERVER}{name}/{key}/{name}'


def classify(error):
    """(kind, one-line explanation) for an exception raised while talking to the symbol server."""
    if isinstance(error, urllib.error.HTTPError):
        if error.code == 404:
            return 'not-published', 'HTTP 404: the symbol server has no PDB for this exact build'
        if error.code in (401, 403, 407):
            return 'blocked', f'HTTP {error.code}: a proxy or firewall refused the request (proxy authentication or an allow-list)'
        return f'http-{error.code}', f'HTTP {error.code} {error.reason}'
    reason = getattr(error, 'reason', error)
    if isinstance(reason, socket.gaierror):
        return 'dns', f'cannot resolve msdl.microsoft.com ({reason})'
    if isinstance(reason, ssl.SSLError) or 'CERTIFICATE' in str(reason).upper():
        return 'tls', f'TLS/certificate problem, usually a corporate proxy that re-signs HTTPS ({reason})'
    if isinstance(reason, (socket.timeout, TimeoutError)) or 'timed out' in str(reason).lower():
        return 'timeout', 'no answer from msdl.microsoft.com within the time limit (offline, or traffic is being dropped)'
    if isinstance(reason, (ConnectionError, OSError)):
        return 'connection', f'connection failed ({reason})'
    return 'error', f'{type(error).__name__}: {error}'


def probe(name, key, timeout=20):
    """GET the first bytes of a PDB. Returns {url, ok, status, kind, detail, magicOk}. Never raises."""
    url = url_for(name, key)
    result = {'url': url, 'ok': False}
    try:
        request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            head = response.read(64)
            result.update(status=response.status, finalUrl=response.geturl(), magicOk=head.startswith(PDB_MAGIC),
                          contentLength=response.headers.get('Content-Length'))
            result['ok'] = result['magicOk']
            result['kind'] = 'ok' if result['ok'] else 'not-a-pdb'
            result['detail'] = 'reachable' if result['ok'] else f'HTTP {response.status} but the body is not a PDB (a proxy login/block page?)'
    except Exception as error:  # noqa: BLE001 - classified below, never raised
        kind, detail = classify(error)
        result.update(kind=kind, detail=detail, status=getattr(error, 'code', None))
    return result


def download(name, key, cache_dir, timeout=120, log=lambda message: None):
    """Return the cached/downloaded PDB path. Raises DownloadError(kind, detail)."""
    cache_dir = pathlib.Path(cache_dir) / key
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / name
    if target.is_file() and target.stat().st_size:
        with open(target, 'rb') as handle:
            if handle.read(len(PDB_MAGIC)) == PDB_MAGIC:
                log(f'using cached symbols {target}')
                return target
        log(f'cached file {target} is not a PDB; downloading again')
    url = url_for(name, key)
    log(f'downloading {url}')
    partial = target.with_suffix('.partial')
    try:
        request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(request, timeout=timeout) as response, partial.open('wb') as out:
            shutil.copyfileobj(response, out)
    except Exception as error:  # noqa: BLE001
        partial.unlink(missing_ok=True)
        kind, detail = classify(error)
        raise DownloadError(kind, detail, url) from error
    with open(partial, 'rb') as handle:
        magic_ok = handle.read(len(PDB_MAGIC)) == PDB_MAGIC
    if not magic_ok:
        partial.unlink(missing_ok=True)
        raise DownloadError('not-a-pdb', 'the server answered but the file is not a PDB (a proxy login/block page?)', url)
    partial.replace(target)
    return target


class DownloadError(RuntimeError):
    def __init__(self, kind, detail, url):
        super().__init__(f'{kind}: {detail} [{url}]')
        self.kind = kind
        self.detail = detail
        self.url = url
