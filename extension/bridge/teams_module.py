import ctypes
from ctypes import wintypes

MODULE = 'embeddedbrowserwebview.dll'

def teams_processes():
    class Entry(ctypes.Structure):
        _fields_ = [('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD), ('th32ProcessID', wintypes.DWORD),
                    ('th32DefaultHeapID', ctypes.c_size_t), ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
                    ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', wintypes.LONG), ('dwFlags', wintypes.DWORD),
                    ('szExeFile', wintypes.WCHAR * 260)]
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    k.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    k.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    snap = k.CreateToolhelp32Snapshot(2, 0)
    if snap == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    found = []
    try:
        e = Entry()
        e.dwSize = ctypes.sizeof(e)
        ok = k.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            if e.szExeFile.casefold() == 'ms-teams.exe':
                found.append((e.th32ProcessID, e.th32ParentProcessID))
            ok = k.Process32NextW(snap, ctypes.byref(e))
    finally:
        k.CloseHandle(snap)
    ids = {p for p, _ in found}
    return [p for p, _ in found], [p for p, parent in found if parent not in ids]


def webview_module_path(pid):
    """Return (path|None, error|None) using psapi; read-only, no injection."""
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    ps = ctypes.WinDLL('psapi', use_last_error=True)
    k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k.OpenProcess.restype = wintypes.HANDLE
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    ps.EnumProcessModulesEx.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), wintypes.DWORD]
    ps.GetModuleFileNameExW.argtypes = [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_wchar_p, wintypes.DWORD]
    handle = k.OpenProcess(0x0400 | 0x0010, False, pid)  # QUERY_INFORMATION | VM_READ
    if not handle:
        return None, f'OpenProcess failed ({ctypes.get_last_error()})'
    try:
        mods = (ctypes.c_void_p * 4096)()
        needed = wintypes.DWORD()
        if not ps.EnumProcessModulesEx(handle, mods, ctypes.sizeof(mods), ctypes.byref(needed), 3):
            return None, f'EnumProcessModulesEx failed ({ctypes.get_last_error()})'
        buf = ctypes.create_unicode_buffer(1024)
        for i in range(min(needed.value // ctypes.sizeof(ctypes.c_void_p), len(mods))):
            if ps.GetModuleFileNameExW(handle, mods[i], buf, 1024) and buf.value.lower().endswith(MODULE):
                return buf.value, None
        return None, None
    finally:
        k.CloseHandle(handle)
