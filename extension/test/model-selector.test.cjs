const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(
  path.join(__dirname, "../bridge/model_selector.js"),
  "utf8",
);
const target = "GPT-5.6 Sol Think deeper";
test("Copilot model selector opens nested GPT menu, picks exact deeper option, and verifies trigger label", () => {
  const dom = new JSDOM(
      '<button id="model" aria-haspopup="menu">Auto</button>',
      { runScripts: "dangerously" },
    ),
    w = dom.window;
  w.HTMLElement.prototype.getClientRects = function () {
    return this.closest("[hidden]") ? [] : [{}];
  };
  const trigger = w.document.getElementById("model");
  trigger.onclick = () => {
    const menu = w.document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = '<button role="menuitem">GPT<span> OpenAI</span></button>';
    menu.firstChild.onclick = () => {
      menu.innerHTML =
        '<button role="menuitemradio">GPT-5.6 Sol Quick response</button><button role="menuitemradio">' +
        target +
        "</button>";
      menu.lastChild.onclick = () => {
        trigger.textContent = target;
        menu.remove();
      };
    };
    w.document.body.append(menu);
  };
  const run = (operation) =>
    w.eval(
      source.replace("__PAYLOAD__", JSON.stringify({ operation, target })),
    );
  try {
    assert.equal(run("inspect").selected, false);
    assert(run("open").clicked);
    assert(run("inspect").gptVisible);
    assert(run("gpt").clicked);
    assert(run("inspect").targetVisible);
    assert(run("choose").clicked);
    assert(run("inspect").selected);
  } finally {
    w.close();
  }
});
test("missing/ambiguous model controls cannot silently fall back to Auto", () => {
  const dom = new JSDOM(
    '<button aria-haspopup="menu">Auto</button><button aria-haspopup="menu">Auto</button>',
    { runScripts: "dangerously" },
  );
  dom.window.HTMLElement.prototype.getClientRects = () => [{}];
  try {
    const result = dom.window.eval(
      source.replace(
        "__PAYLOAD__",
        JSON.stringify({ operation: "open", target }),
      ),
    );
    assert(result.error);
    assert.equal(result.matches, 2);
    assert(!result.clicked);
  } finally {
    dom.window.close();
  }
});
test('background Copilot frame can select the model with zero layout rectangles and ancestor aria-hidden',()=>{
 const dom=new JSDOM('<main aria-hidden="true"><button id="model" aria-haspopup="menu">Auto</button><div role="menu"><button role="menuitemradio" id="target">GPT-5.6 Sol Think deeper</button></div></main>',{runScripts:'dangerously'}),w=dom.window;
 w.HTMLElement.prototype.getClientRects=()=>[];
 const trigger=w.document.getElementById('model'),option=w.document.getElementById('target');option.onclick=()=>{trigger.textContent=target;option.setAttribute('aria-checked','true');};
 try{const run=operation=>w.eval(source.replace('__PAYLOAD__',JSON.stringify({operation,target})));assert(run('inspect').triggerReady);assert(run('inspect').targetVisible);assert(run('choose').clicked);assert(run('inspect').selected);}finally{w.close();}
});
test('retained closed menu options are ignored while the background trigger remains selectable',()=>{
 const dom=new JSDOM('<button aria-haspopup="menu">Auto</button><div role="menu" hidden><button role="menuitemradio">GPT-5.6 Sol Think deeper</button></div>',{runScripts:'dangerously'});try{const s=dom.window.eval(source.replace('__PAYLOAD__',JSON.stringify({operation:'inspect',target})));assert(s.triggerReady);assert.equal(s.targetVisible,false);}finally{dom.window.close();}
});
