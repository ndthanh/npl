"""Local-only dictation. Mic audio stays in RAM; no cloud requests or auto-send."""
import argparse
import json
import os
import pathlib
import sys
import threading
import time

def emit(kind,**values):print(json.dumps({'type':kind,**values},ensure_ascii=True),flush=True)

def main():
    sys.stdout.reconfigure(encoding='utf-8',line_buffering=True)
    parser=argparse.ArgumentParser()
    parser.add_argument('--model',required=True)
    parser.add_argument('--language',default='vi')
    parser.add_argument('--file')
    parser.add_argument('--device',type=int)
    parser.add_argument('--seconds',type=int,default=120)
    args=parser.parse_args()
    model_path=pathlib.Path(args.model)
    required=('model.bin','config.json','tokenizer.json','vocabulary.txt')
    if not model_path.is_dir() or any(not (model_path/name).is_file() for name in required):raise ValueError('Model local cần model.bin, config.json, tokenizer.json, vocabulary.txt. Không tự download model.')
    if not 1<=args.seconds<=120:raise ValueError('Recording limit is 1–120 seconds')
    # Avoid MKL packed-weight allocation failures seen on Windows CPUs.
    os.environ.setdefault('CT2_PACKED_GEMM','0')
    try:from faster_whisper import WhisperModel
    except ImportError:raise RuntimeError('Thiếu faster-whisper. Cài bridge/requirements-voice.txt bằng Python đã chọn.')
    stop=threading.Event();cancelled=threading.Event()
    def controls():
        for line in sys.stdin:
            if line.strip()=='cancel':cancelled.set();stop.set();return
            if line.strip()=='stop':stop.set()
        cancelled.set();stop.set()
    if not args.file:threading.Thread(target=controls,daemon=True).start()
    emit('state',status='loading',message='Đang nạp model local…')
    model=WhisperModel(str(model_path),device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True)
    if cancelled.is_set() or (stop.is_set() and not args.file):emit('state',status='cancelled');return
    if args.file:audio=args.file
    else:
        try:import sounddevice as sd
        except ImportError:raise RuntimeError('Thiếu sounddevice. Cài bridge/requirements-voice.txt.')
        import numpy as np
        chunks=[];samples=0;maximum=16000*args.seconds
        def receive(data,frames,clock,status):
            nonlocal samples
            if samples<maximum:
                raw=bytes(data);remaining=(maximum-samples)*2;chunks.append(raw[:remaining]);samples+=min(frames,maximum-samples)
            if samples>=maximum:stop.set()
        with sd.RawInputStream(samplerate=16000,channels=1,dtype='int16',device=args.device,callback=receive):
            emit('state',status='recording',message='Đang ghi âm · bấm mic lần nữa để nhận dạng')
            stop.wait(args.seconds)
        if cancelled.is_set():emit('state',status='cancelled');return
        if not chunks:emit('transcript',text='');return
        audio=np.frombuffer(b''.join(chunks),dtype=np.int16).astype(np.float32)/32768.0
    emit('state',status='transcribing',message='Đang nhận dạng trên máy…')
    segments,info=model.transcribe(audio,language=None if args.language=='auto' else args.language,beam_size=1,vad_filter=True,condition_on_previous_text=False)
    text=' '.join(part.text.strip() for part in segments).strip()
    emit('transcript',text=text,language=info.language)

if __name__=='__main__':
    try:main()
    except Exception as error:emit('error',message=str(error));sys.exit(1)
