(() => {
  const p=__PAYLOAD__;
  const normalize=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
  const visible=e=>e.getClientRects().length&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!e.closest('[aria-hidden="true"]');
  const controls=Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"],[role="menuitem"],[role="menuitemradio"],[role="option"]')).filter(visible);
  const labels=e=>[e.innerText||e.textContent,e.getAttribute('aria-label'),e.getAttribute('title'),e.querySelector('.fai-CapabilityPickerMenuItem__primaryContentWrapper')?.textContent].map(normalize);
  const target=normalize(p.target);
  const exact=(e,text)=>labels(e).includes(text);
  const deepest=nodes=>nodes.filter(e=>!nodes.some(other=>other!==e&&e.contains(other)));
  const inMenu=e=>!!e.closest('[role="menu"],[role="listbox"]')||['menuitem','menuitemradio','option'].includes(e.getAttribute('role'));
  const triggers=deepest(controls.filter(e=>!inMenu(e)&&(e.hasAttribute('aria-haspopup')||e.getAttribute('role')==='combobox')&&labels(e).some(t=>/^(auto|quick response|think deeper|gpt[- ]?5\.)/.test(t))));
  const choices=deepest(controls.filter(e=>exact(e,target)));
  const selected=triggers.some(e=>exact(e,target))||choices.some(e=>e.getAttribute('aria-checked')==='true'||e.getAttribute('aria-selected')==='true');
  const targetOptions=choices.filter(e=>!triggers.includes(e)&&!e.hasAttribute('aria-haspopup'));
  const groups=deepest(controls.filter(e=>e.getAttribute('data-testid')==='gptSubMenuModelTrigger-OpenAI'||labels(e).some(t=>t==='gpt'||t==='gpt openai')));
  const result={selected,label:triggers.map(e=>e.innerText||e.textContent).join(' | '),triggerReady:triggers.length===1,targetVisible:targetOptions.length===1,gptVisible:groups.length===1,menuOpen:controls.some(inMenu)};
  if(p.operation==='inspect'||(selected&&!['open','close'].includes(p.operation)))return result;
  const candidates=p.operation==='open'||p.operation==='close'?triggers:p.operation==='gpt'?groups:p.operation==='choose'?targetOptions:[];
  if(candidates.length!==1)return {...result,error:'Model '+p.operation+' control missing or ambiguous',matches:candidates.length};
  const node=candidates[0];
  if(p.operation==='gpt'){
    node.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
    node.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
  }
  node.click();return {...result,clicked:true};
})()
