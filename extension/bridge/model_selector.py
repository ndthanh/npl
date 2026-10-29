"""Pick an explicitly named visible Copilot model before uploads/send. No fallback."""
import json
import pathlib
import time

SCRIPT=pathlib.Path(__file__).with_suffix('.js').read_text(encoding='utf-8')
DEFAULT_MODEL='GPT-5.6 Sol Think deeper'

def select_model(bridge,target=DEFAULT_MODEL,timeout=15):
    if not target:return {'modelSelectionDisabled':True}
    def run(operation):
        result=bridge.evaluate(SCRIPT.replace('__PAYLOAD__',json.dumps({'operation':operation,'target':target})))
        if not isinstance(result,dict) or result.get('error'):raise RuntimeError(f'Đã tìm thấy ô chat Copilot, nhưng không chọn được model {target} ({operation}): {result}. Chưa upload/gửi prompt.')
        return result
    def wait(predicate,seconds):
        deadline=time.monotonic()+seconds
        while time.monotonic()<deadline:
            state=run('inspect')
            if predicate(state):return state
            time.sleep(.25)
        return state
    def done(state):
        if state.get('menuOpen'):run('close')
        return {'model':target,'verified':True}
    state=run('inspect')
    if not any(state.get(k) for k in ('selected','triggerReady','targetVisible','gptVisible')):
        state=wait(lambda s:any(s.get(k) for k in ('selected','triggerReady','targetVisible','gptVisible')),min(5,timeout))
    if state.get('selected'):return done(state)
    if not state.get('targetVisible') and not state.get('gptVisible'):run('open')
    state=wait(lambda s:s.get('targetVisible') or s.get('gptVisible'),min(3,timeout))
    if not state.get('targetVisible'):
        if not state.get('gptVisible'):raise RuntimeError(f'Không tìm thấy menu model {target}; chưa upload/gửi prompt.')
        run('gpt');state=wait(lambda s:s.get('targetVisible'),min(3,timeout))
    if not state.get('targetVisible'):raise RuntimeError(f'Model {target} không có trong menu; chưa upload/gửi prompt.')
    if state.get('selected'):return done(state)
    run('choose');state=wait(lambda s:s.get('selected'),1)
    # Teams truncates the trigger label; reopen the submenu to verify aria-checked.
    if not state.get('selected'):
        if not state.get('menuOpen'):run('open')
        state=wait(lambda s:s.get('targetVisible') or s.get('gptVisible'),2)
        if not state.get('targetVisible') and state.get('gptVisible'):run('gpt')
        state=wait(lambda s:s.get('selected'),max(1,timeout-9))
    if not state.get('selected'):raise RuntimeError(f'Đã chọn nhưng chưa xác minh được model {target}; chưa upload/gửi prompt. Kiểm tra Teams.')
    return done(state)
