"""Read-only runtime diagnostics, independent from Frida/browser imports."""
import importlib
import importlib.metadata
import importlib.util
import json
import os
import pathlib
import sys

def diagnose():
    modules={'frida':'frida','beautifulsoup4':'bs4','markdownify':'markdownify','truststore':'truststore','playwright':'playwright.sync_api','pyodbc':'pyodbc','openpyxl':'openpyxl','sqlparse':'sqlparse','pefile':'pefile'}
    packages={}
    for package,module in modules.items():
        try:
            available=importlib.util.find_spec(module) is not None
            if available and package in ('frida', 'pefile'):
                importlib.import_module(module)
            packages[package]={'installed':available,'version':importlib.metadata.version(package) if available else None,'required':package!='truststore'}
        except (ImportError, OSError, RuntimeError, importlib.metadata.PackageNotFoundError):
            packages[package]={'installed':False,'version':None,'required':package!='truststore'}
    candidates=[pathlib.Path(os.environ.get(key,''))/suffix for key,suffix in [('PROGRAMFILES(X86)','Microsoft/Edge/Application/msedge.exe'),('PROGRAMFILES','Microsoft/Edge/Application/msedge.exe'),('LOCALAPPDATA','Microsoft/Edge/Application/msedge.exe')]]
    return {'python':sys.executable,'pythonVersion':sys.version.split()[0],'packages':packages,'edge':str(next((p for p in candidates if p.is_file()),'')),'requirements':str(pathlib.Path(__file__).with_name('requirements.txt'))}

if __name__=='__main__':print(json.dumps(diagnose(),ensure_ascii=True))
