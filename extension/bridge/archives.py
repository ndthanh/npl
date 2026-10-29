"""Validate project ZIPs in memory. Never extract untrusted paths directly."""
import base64
import io
import pathlib
import zipfile

def unpack_project(encoded):
    raw=base64.b64decode(encoded,validate=True)
    entries=[];seen=set();total=0
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for entry in archive.infolist():
            name=entry.orig_filename
            parts=name.rstrip('/').split('/')
            if not name or '\\' in name or ':' in name or name.startswith('/') or any(p in ('','.','..') for p in parts):raise ValueError('Unsafe archive path')
            if entry.filename!=name:raise ValueError('ZIP filename contains NUL')
            if ((entry.external_attr>>16)&0o170000)==0o120000:raise ValueError('Symlink ZIP entry')
            if entry.is_dir():continue
            key=name.casefold()
            if key in seen:raise ValueError('Duplicate ZIP path')
            seen.add(key);total+=entry.file_size
            if entry.flag_bits&1:raise ValueError('Encrypted ZIP not supported')
            data=archive.read(entry)
            entries.append({'path':name,'base64':base64.b64encode(data).decode('ascii')})
    if not entries:raise ValueError('Empty ZIP project')
    return {'entries':entries}
