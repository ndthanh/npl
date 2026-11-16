"""Retry discovery only. Never retry a prompt, upload or navigation to a chat."""
import time

def retryable(error):
    text=str(error).lower()
    # A pending native callback must settle before another hook is installed.
    if any(marker in text for marker in ('pending', 'build changed', 'manifest', 'more than one', 'another nopilot', 'ambiguous', 'access denied', 'permission denied', 'no module named')):
        return False
    return any(marker in text for marker in ('no accessible copilot frame', 'found []', 'process not found', 'process terminated', 'process with pid', 'session is detached', 'frame is destroyed', 'frame was replaced', 'webview object has changed', 'cannot uniquely locate'))

def establish(harness, emit=lambda value:None, clock=time.monotonic, sleep=time.sleep):
    start=clock()
    def progress(stage,attempt,message,**extra):
        emit(dict(stage=stage,attempt=attempt,maxAttempts=3,elapsed=round(clock()-start,1),message=message,**extra))
    for attempt in range(1,4):
        progress('finding',attempt,'Đang tìm frame Copilot trong Teams…')
        try:
            # Reuse a healthy connection; opening a panel must not detach hooks
            # or switch the user's Teams conversation.
            if harness.bridge is not None:
                try:
                    state=harness.status()
                    if state.get('editorPresent'):
                        progress('connected',attempt,'Teams đã kết nối')
                        return state
                except Exception as error:
                    if not retryable(error):raise
            remaining=70-(clock()-start)
            if remaining<=0:raise TimeoutError('Copilot discovery timed out')
            state=harness.connect(timeout=min(20,remaining))
            if not state.get('editorPresent'):raise RuntimeError('No accessible Copilot frame found')
            progress('connected',attempt,'Teams đã kết nối')
            return state
        except Exception as error:
            if not retryable(error) or attempt==3 or clock()-start>=70:
                progress('failed',attempt,str(error))
                raise
            delay=min((2,5)[attempt-1],max(0,70-(clock()-start)))
            for seconds in range(int(delay),0,-1):
                progress('retrying',attempt,'Chưa tìm thấy Copilot; đang chờ thử lại…',retryIn=seconds)
                sleep(1)
