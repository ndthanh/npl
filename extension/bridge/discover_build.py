"""Locate the Teams WebView2 entry points without a PDB (pure static analysis; never starts, attaches to or calls Teams).

Microsoft publishes symbols for EmbeddedBrowserWebView.dll only for some builds (HTTP 404 otherwise), and the dll
carries no RTTI for the embedded_browser_webview_current classes, so the classes cannot be found by name. The code can:

  coreExecute  : the function that directly calls the function referencing the string "ExecuteScript" and is stored
                 in a vtable (slot 29 of the Teams-shell WebView object).
  frameExecute : the same, two calls up from the function referencing "ExecuteScriptInFrame" (slot 19 of the frame object).
  vtable start : stored pointer - slot * 8; every earlier slot must also point into executable code.

Validated against the PDB-derived manifest of 156.0.4314.58 (all four values identical). Anything other than exactly
one candidate raises DiscoveryError carrying a step-by-step trace; nothing is guessed.
At run time agent.js still refuses objects whose vptr or vtable slot differs from the manifest.
"""
import bisect
import hashlib
import json
import pathlib
import re
import struct
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
for _entry in (str(HERE.parent / 'vendor'), str(HERE)):
    if _entry not in sys.path:
        sys.path.insert(0, _entry)

METHOD = 'string-xref-vtable-slots'
CORE_SLOT = 29
FRAME_SLOT = 19
EXECUTABLE = 0x20000000
MAX_CANDIDATES_SHOWN = 8


class DiscoveryError(RuntimeError):
    """Discovery could not prove a single answer. `trace` lists what was examined."""

    def __init__(self, message, trace=None):
        super().__init__(message)
        self.trace = trace or []


def discover(path, log=lambda message: None):
    """Return a manifest dict (without runtimeVersion) for the x64 EmbeddedBrowserWebView.dll at `path`."""
    import pefile
    started = time.monotonic()
    trace = []

    def step(message):
        line = f'+{time.monotonic() - started:5.1f}s {message}'
        trace.append(line)
        log(line)

    path = pathlib.Path(path)
    data = path.read_bytes()
    step(f'read {path.name}: {len(data):,} bytes')
    pe = pefile.PE(data=data)
    if pe.FILE_HEADER.Machine != 0x8664:
        raise DiscoveryError(f'{path} is not an x64 image (machine 0x{pe.FILE_HEADER.Machine:04x}); only x64 Teams is supported', trace)
    base = pe.OPTIONAL_HEADER.ImageBase
    img = bytes(pe.get_memory_mapped_image())
    size = len(img)
    pdata = getattr(pe, 'DIRECTORY_ENTRY_EXCEPTION', None)
    if not pdata:
        raise DiscoveryError('the dll has no unwind table (.pdata), so function boundaries cannot be recovered', trace)
    funcs = sorted((f.struct.BeginAddress, f.struct.EndAddress) for f in pdata)
    starts = [f[0] for f in funcs]
    step(f'parsed PE: {len(pe.sections)} sections, {len(funcs):,} functions')

    def func_of(rva):
        i = bisect.bisect_right(starts, rva) - 1
        return funcs[i] if i >= 0 and funcs[i][0] <= rva < funcs[i][1] else None

    text = [(s.VirtualAddress, min(s.VirtualAddress + s.Misc_VirtualSize, size)) for s in pe.sections if s.Characteristics & EXECUTABLE]
    other = [(s.VirtualAddress, min(s.VirtualAddress + max(s.Misc_VirtualSize, s.SizeOfRawData), size)) for s in pe.sections if not s.Characteristics & EXECUTABLE]
    if not text:
        raise DiscoveryError('the dll has no executable section', trace)

    def in_text(rva):
        return any(a <= rva < b for a, b in text)

    def string_rvas(value):
        return [m.start() + 1 for m in re.finditer(re.escape(b'\0' + value + b'\0'), img)]

    def lea_functions(target):
        """Functions containing `lea reg, [rip+disp]` that points at `target`."""
        found = set()
        for a, b in text:
            for m in re.finditer(rb'[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]', img[a:b], re.S):
                p = a + m.start()
                if p + 7 + struct.unpack_from('<i', img, p + 3)[0] == target:
                    f = func_of(p)
                    if f:
                        found.add(f[0])
        return found

    callers = {}
    for a, b in text:
        for m in re.finditer(rb'[\xe8\xe9]', img[a:b]):
            p = a + m.start()
            if p + 5 > size:
                continue
            target = p + 5 + struct.unpack_from('<i', img, p + 1)[0]
            f = func_of(target)
            if f and f[0] == target:
                caller = func_of(p)
                if caller and caller[0] != target:
                    callers.setdefault(target, set()).add(caller[0])
    step(f'built call graph: {len(callers):,} called functions')

    def stored_in_tables(function_rva):
        needle = struct.pack('<Q', base + function_rva)
        hits = []
        for a, b in other:
            p = img.find(needle, a, b)
            while p >= 0:
                if p % 8 == 0:
                    hits.append(p)
                p = img.find(needle, p + 1, b)
        return hits

    def pick(label, string, hops, slot):
        rvas = string_rvas(string)
        anchors = set()
        for rva in rvas:
            anchors |= lea_functions(rva)
        step(f'{label}: string {string.decode()!r} found {len(rvas)}x, referenced by {len(anchors)} function(s)')
        if not anchors:
            raise DiscoveryError(f'{label}: the string {string.decode()!r} is {"not present" if not rvas else "never referenced by code"} in this build', trace)
        level, reach = anchors, set()
        for _ in range(hops):
            level = set().union(*(callers.get(f, set()) for f in level)) if level else set()
            reach |= level
        step(f'{label}: {len(reach)} function(s) within {hops} call(s) above the string')
        found = []
        for function_rva in sorted(reach):
            for pointer in stored_in_tables(function_rva):
                vtable = pointer - slot * 8
                if vtable < 0:
                    continue
                slots = struct.unpack_from('<%dQ' % (slot + 1), img, vtable)
                if all(in_text(s - base) for s in slots):
                    found.append((vtable, function_rva))
        step(f'{label}: vtable candidates (vtable RVA, function RVA): {found[:MAX_CANDIDATES_SHOWN]}')
        if len(found) != 1:
            raise DiscoveryError(f'{label}: expected exactly one vtable slot {slot} holding a caller of the "{string.decode()}" code, found {len(found)}. '
                                 f'This build is laid out differently from the ones this method was validated on; send the diagnostics report.', trace)
        return found[0]

    core_vtable, core_execute = pick('core', b'ExecuteScript', 1, CORE_SLOT)
    frame_vtable, frame_execute = pick('frame', b'ExecuteScriptInFrame', 2, FRAME_SLOT)
    if core_vtable == frame_vtable or core_execute == frame_execute:
        raise DiscoveryError('core and frame resolved to the same object; refusing', trace)
    step('ok')
    return {
        'coreExecute': core_execute,
        'frameVtable': frame_vtable,
        'frameExecute': frame_execute,
        'coreVtable': core_vtable,
        'moduleSha256': hashlib.sha256(data).hexdigest(),
        'architecture': 'x64',
        'discoveryMethod': METHOD,
        'confidence': 'structural',
        'symbols': False,
    }


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: discover_build.py <path to x64 EmbeddedBrowserWebView.dll>')
    try:
        print(json.dumps(discover(sys.argv[1], log=lambda m: print(m, file=sys.stderr)), indent=2))
    except DiscoveryError as error:
        print(f'DISCOVERY FAILED: {error}', file=sys.stderr)
        sys.exit(3)
