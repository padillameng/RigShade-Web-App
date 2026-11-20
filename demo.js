(function(global){
'use strict';
const P=global.RigShadeProtocol;
if(!P)throw new Error('demo.js needs protocol.js to be loaded first');
const PEDAL_NAME='Cube Baby (simulated)';
const SETTINGS_BYTES=0x1000;
const FLASH_BYTES=0x71000;
const SECTOR_BYTES=4096;
function t(text,vars){
const layer=global.RigShadeI18n;
if(layer&&typeof layer.t==='function')return layer.t(text,vars);
if(!vars)return text;
return String(text).replace(/\{(\w+)\}/g,function(match,name){
return Object.prototype.hasOwnProperty.call(vars,name)?String(vars[name]):match;
});
}
function createPedal(){
const settings=new Uint8Array(SETTINGS_BYTES);
const flash=new Uint8Array(FLASH_BYTES);
const live=new Map();
const presets=[
[3,5,7,2,40,90,12,60,5,2,1,1,1],
[6,7,10,4,60,100,16,50,3,3,1,1,1],
[1,3,5,0,20,80,8,40,0,0,1,0,0],
];
presets.forEach(function(values,index){
for(let code=0;code<values.length;code++){
settings[index*P.MemoryMap.PRESET_BYTES+code]=values[code];
}
});
function windowOf(memory,address,size){
const out=new Uint8Array(size);
if(memory===P.MemoryMap.SETTINGS){
if(address>=P.MemoryMap.LIVE_BASE)return out;
out.set(settings.subarray(address,Math.min(address+size,settings.length)),0);
return out;
}
if(memory===P.MemoryMap.ROM||memory===P.MemoryMap.LIVE_IR){
out.set(flash.subarray(address,Math.min(address+size,flash.length)),0);
}
return out;
}
function store(memory,address,data){
if(memory===P.MemoryMap.SETTINGS){
if(address>=P.MemoryMap.LIVE_BASE){
live.set(address,data[0]);
return;
}
settings.set(data,address);
return;
}
if(memory===P.MemoryMap.ROM||memory===P.MemoryMap.LIVE_IR)flash.set(data,address);
}
function answer(clear){
const parsed=P.Envelope.parse(clear);
if(parsed.type===P.MessageType.REQUEST_NAME_VERSION){
const body=new Uint8Array(18);
for(let i=0;i<PEDAL_NAME.length&&i<16;i++)body[i]=PEDAL_NAME.charCodeAt(i)&0xFF;
return P.Envelope.build(P.MessageType.REQUEST_NAME_VERSION,body);
}
const memory=parsed.body[0];
const address=P.Envelope.readLe32(parsed.body,1);
if(parsed.type===P.MessageType.READ){
const size=P.Envelope.readLe24(parsed.body,5);
const data=windowOf(memory,address,size);
const body=new Uint8Array(P.MemoryMap.READ_BODY_PREFIX+size);
body[0]=memory;
P.Envelope.writeLe32(body,1,address);
P.Envelope.writeLe24(body,5,size);
body.set(data,P.MemoryMap.READ_BODY_PREFIX);
return P.Envelope.build(P.MessageType.READ,body);
}
if(parsed.type===P.MessageType.WRITE){
const size=P.Envelope.readLe24(parsed.body,5);
store(
memory,
address,
parsed.body.slice(P.MemoryMap.READ_BODY_PREFIX,P.MemoryMap.READ_BODY_PREFIX+size)
);
return P.Acknowledgement.CLEAR.slice();
}
if(parsed.type===P.MessageType.ERASE){
if(memory===P.MemoryMap.SETTINGS)settings.fill(0xFF,address,Math.min(address+SECTOR_BYTES,settings.length));
else flash.fill(0xFF,address,Math.min(address+SECTOR_BYTES,flash.length));
return P.Envelope.build(P.MessageType.ERASE,new Uint8Array(0));
}
return P.Envelope.build(parsed.type,new Uint8Array(0));
}
return{
answer:answer,
send:function(clear){
const parsed=P.Envelope.parse(clear);
if(parsed.type!==P.MessageType.WRITE){
return Promise.reject(new Error('the demo sent a '+P.typeLabel(parsed.type)+' without waiting for an answer'));
}
const memory=parsed.body[0];
const address=P.Envelope.readLe32(parsed.body,1);
const size=P.Envelope.readLe24(parsed.body,5);
store(memory,address,parsed.body.slice(P.MemoryMap.READ_BODY_PREFIX,P.MemoryMap.READ_BODY_PREFIX+size));
return Promise.resolve();
},
};
}
function createLink(){
const pedal=createPedal();
const watchers=[];
let chosen={outputId:'demo-out',inputId:'demo-in'};
let state={
kind:'NoPedal',
reason:'demo-idle',
message:'the demo pedal connects when the page asks it to',
};
let closed=false;
let chain=Promise.resolve();
function clone(){
return Object.assign({},state);
}
function setState(next){
state=next;
for(const watcher of watchers.slice()){
try{
watcher(clone());
}catch(error){
}
}
return clone();
}
function ready(){
return{
kind:'Ready',
reason:'',
name:PEDAL_NAME,
message:'a stand-in pedal in this browser: nothing is written to a real device',
outputId:chosen.outputId,
inputId:chosen.inputId,
outputName:PEDAL_NAME,
inputName:PEDAL_NAME,
};
}
function serial(task){
const run=chain.then(task);
chain=run.then(
function(){},
function(){}
);
return run;
}
return{
connect:function(){
closed=false;
return Promise.resolve(setState(ready()));
},
state:clone,
ports:function(){
return{
outputs:[{id:'demo-out',name:PEDAL_NAME}],
inputs:[{id:'demo-in',name:PEDAL_NAME}],
chosen:Object.assign({},chosen),
};
},
select:function(outputId,inputId){
chosen={
outputId:outputId===undefined||outputId===null||outputId===''?null:String(outputId),
inputId:inputId===undefined||inputId===null||inputId===''?null:String(inputId),
};
closed=false;
return clone();
},
exchange:function(clear){
return serial(function(){
if(closed)throw new Error('the demo link was disconnected: connect again before sending');
return Promise.resolve(pedal.answer(clear));
});
},
send:function(clear){
return serial(function(){
if(closed)throw new Error('the demo link was disconnected: connect again before sending');
return pedal.send(clear);
});
},
probe:function(){
return Promise.resolve([
{outputName:PEDAL_NAME,inputName:PEDAL_NAME,name:PEDAL_NAME,error:null},
]);
},
watch:function(cb){
if(typeof cb!=='function')throw new Error('watch needs a function');
watchers.push(cb);
try{
cb(clone());
}catch(error){
}
return function unwatch(){
const at=watchers.indexOf(cb);
if(at>=0)watchers.splice(at,1);
};
},
disconnect:function(reason){
closed=true;
return setState({
kind:'NoPedal',
reason:reason||'demo-disconnected',
message:'the demo link is closed: press CONNECT to open it again',
});
},
};
}
const STEPS=[
{
key:'connect',
screen:'CHAIN',
label:'Connect',
target:'[data-shell="connect"]',
title:'This is a simulated pedal.',
body:'The page is talking to a stand-in pedal inside this browser: nothing is written to a real device, and the cable is not needed.',
},
{
key:'banks',
screen:'CHAIN',
label:'A / B / C',
target:'[data-shell="preset-row"]',
title:'The pedal plays one bank at a time.',
body:'A, B and C are the pedal\'s three presets. The badge beside them says which one is sounding: tap it and pick that bank, the way you would tell a friend which one is on.',
},
{
key:'live',
screen:'CHAIN',
label:'Live',
target:'[data-board="chain"]',
title:'You hear every change as you make it.',
body:'Let go of a control and the new value goes to the pedal at once, so you hear it while the note is still ringing. The bank that is sounding changes now; the other two take it when you press SAVE.',
},
{
key:'chain',
screen:'CHAIN',
label:'CHAIN',
target:'[data-board="chain"]',
title:'CHAIN is the board of the pedal.',
body:'Four boxes: AMP, MOD / DELAY, CAB / IR and VOLUME. Tap one to open it; SAVE, RESET and UNDO below act on the preset you are editing.',
},
{
key:'edit',
screen:'EDIT',
label:'EDIT',
target:'[data-shell="screen"]',
title:'EDIT opens the values of one block.',
body:'The same preset, as the numbers of the block you picked, one line each, with its own SAVE. CHAIN is the board and EDIT is the bench: two views of one preset.',
},
{
key:'tones',
screen:'TONES',
label:'TONES',
target:'[data-shell="screen"]',
title:'TONES starts you from a sound.',
body:'LIBRARY holds the 92 researched tones and GENERATE builds one from a description. LOAD INTO THE CHAIN puts the values into the preset you chose, and nothing reaches the pedal until you SAVE.',
},
{
key:'bank',
screen:'BANK',
label:'BANK',
target:'[data-bank-actions]',
title:'BANK keeps your own tones and shares them.',
body:'SAVE asks for a name and keeps the preset the pedal is holding, in this browser; the cards say which of A, B and C you are editing. EXPORT writes one saved tone to a file, EXPORT ALL the whole bank, IMPORT reads one back, and LOAD puts it into A, B or C.',
},
{
key:'cabinet',
screen:'BANK',
label:'CABINET',
target:'[data-cabinet-panel]',
title:'CABINET holds the cabinet you choose.',
body:'READ CABINET shows what the pedal carries, IMPORT WAV takes a .wav from your computer, and Get a cabinet from Tone3000 brings one from the catalogue. RESTORE puts the factory one back, and nothing is written until you press WRITE.',
},
{
key:'done',
screen:'CHAIN',
label:'Done',
target:'[data-shell="screen"]',
title:'That is the whole page.',
body:'The rest of the demo is yours to press. To use your real pedal, leave the demo and connect the cable.',
},
];
const STYLE=[
'.demo-entry { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 12px 0 0; }',
'.demo-entry span { color: var(--secondary); }',
'.demo-topics { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0 0; }',
'.demo-topics span { color: var(--secondary); }',
'.demo-topics a { color: var(--secondary); border: 1px solid var(--hairline); border-radius: 999px; padding: 4px 10px; text-decoration: none; }',
'.demo-tour { position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 40; max-width: 640px; margin: 0 auto;',
'  background: var(--panel); border: 1px solid var(--hairline); border-radius: 12px; padding: 14px 16px;',
'  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45); }',
'.demo-tour h3 { margin: 4px 0 6px; }',
'.demo-tour p { margin: 0 0 10px; color: var(--secondary); }',
'.demo-kicker { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mint); margin: 0; }',
'.demo-tour .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }',
'.demo-chips { margin: 0 0 10px; gap: 6px; }',
'.demo-chips button { padding: 4px 10px; font-size: 12px; }',
'.demo-chips button[aria-pressed="true"] { color: var(--mint); border-color: var(--mint); }',
'.demo-tour a { color: var(--secondary); }',
'[data-demo-spot] { outline: 2px solid var(--mint); outline-offset: 4px; border-radius: 10px; }',
].join('\n');
function injectStyle(){
if(document.querySelector('style[data-demo-style]')!==null)return;
const style=document.createElement('style');
style.setAttribute('data-demo-style','1');
style.textContent=STYLE;
document.head.appendChild(style);
}
let tour=null;
let step=0;
let spot=null;
let options={};
let chips=[];
let atScreen=null;
function show(screen){
const go=options.go;
if(typeof go!=='function'||!screen||screen===atScreen)return;
atScreen=screen;
try{
go(screen);
}catch(error){
}
}
function clearSpot(){
if(spot!==null&&spot.removeAttribute)spot.removeAttribute('data-demo-spot');
spot=null;
}
function placeSpot(selector){
clearSpot();
const target=selector===null?null:document.querySelector(selector);
if(target===null)return;
target.setAttribute('data-demo-spot','1');
spot=target;
if(typeof target.scrollIntoView==='function'){
try{
target.scrollIntoView({block:'center',behavior:'smooth'});
}catch(error){
target.scrollIntoView();
}
}
}
function paint(){
if(tour===null)return;
const each=STEPS[step];
tour.querySelector('[data-demo="kicker"]').textContent=
t('Demo')+' · '+t('{step} of {total}',{step:step+1,total:STEPS.length});
tour.querySelector('[data-demo="title"]').textContent=t(each.title);
tour.querySelector('[data-demo="body"]').textContent=t(each.body);
tour.querySelector('[data-demo="back"]').textContent=t('Back');
tour.querySelector('[data-demo="back"]').disabled=step===0;
tour.querySelector('[data-demo="next"]').textContent=step===STEPS.length-1?t('Done'):t('Next');
tour.querySelector('[data-demo="leave"]').textContent=t('Leave the demo');
for(let index=0;index<chips.length;index++){
chips[index].textContent=t(STEPS[index].label);
chips[index].setAttribute('aria-pressed',index===step?'true':'false');
}
show(each.screen);
placeSpot(each.target);
}
function close(){
clearSpot();
if(tour===null)return;
tour.hidden=true;
}
function open(){
if(tour===null)return;
tour.hidden=false;
paint();
}
function startTour(settings){
options=settings||{};
const wanted=options.topic;
const found=STEPS.findIndex(function(each){
return each.key===wanted;
});
const opening=found<0?0:found;
injectStyle();
if(tour!==null){
step=opening;
open();
return tour;
}
tour=document.createElement('section');
tour.className='demo-tour';
tour.setAttribute('role','dialog');
tour.setAttribute('aria-live','polite');
const kicker=document.createElement('p');
kicker.className='demo-kicker';
kicker.setAttribute('data-demo','kicker');
const title=document.createElement('h3');
title.setAttribute('data-demo','title');
const body=document.createElement('p');
body.setAttribute('data-demo','body');
const chooser=document.createElement('div');
chooser.className='row demo-chips';
chooser.setAttribute('data-demo','topics');
chooser.setAttribute('role','group');
chips=STEPS.map(function(each,index){
const chip=document.createElement('button');
chip.setAttribute('type','button');
chip.setAttribute('data-demo-topic',each.key);
chip.setAttribute('aria-pressed','false');
chip.addEventListener('click',function(){
step=index;
paint();
});
chooser.appendChild(chip);
return chip;
});
const row=document.createElement('div');
row.className='row';
const back=document.createElement('button');
back.setAttribute('type','button');
back.setAttribute('data-demo','back');
back.addEventListener('click',function(){
if(step>0)step--;
paint();
});
const next=document.createElement('button');
next.setAttribute('type','button');
next.className='primary';
next.setAttribute('data-demo','next');
next.addEventListener('click',function(){
if(step<STEPS.length-1){
step++;
paint();
}else{
close();
}
});
const leave=document.createElement('a');
leave.setAttribute('data-demo','leave');
leave.setAttribute('href','?');
row.appendChild(back);
row.appendChild(next);
row.appendChild(leave);
tour.appendChild(kicker);
tour.appendChild(title);
tour.appendChild(body);
tour.appendChild(chooser);
tour.appendChild(row);
document.body.appendChild(tour);
document.addEventListener('keydown',function(event){
if(event.key==='Escape'&&tour!==null&&!tour.hidden)close();
});
document.addEventListener('rigshade:locale',function(){
if(tour!==null&&!tour.hidden)paint();
});
step=opening;
open();
return tour;
}
function mountEntry(){
const guide=document.querySelector('[data-shell="guide"]');
if(guide===null||guide.querySelector('[data-demo="entry"]')!==null)return;
injectStyle();
const line=document.createElement('p');
line.className='demo-entry';
line.setAttribute('data-demo','entry');
const link=document.createElement('a');
link.className='primary';
link.setAttribute('href','?demo');
const copy=document.createElement('span');
line.appendChild(link);
line.appendChild(copy);
guide.appendChild(line);
const topics=document.createElement('p');
topics.className='demo-topics';
topics.setAttribute('data-demo','entry-topics');
const heading=document.createElement('span');
topics.appendChild(heading);
const links=STEPS.map(function(each){
const jump=document.createElement('a');
jump.setAttribute('href','?demo&topic='+encodeURIComponent(each.key));
topics.appendChild(jump);
return jump;
});
guide.appendChild(topics);
const paintEntry=function(){
link.textContent=t('Try the demo — no pedal needed');
copy.textContent=t('It opens this same page with a simulated pedal, so every button can be pressed without hardware.');
heading.textContent=t('See one part again:');
for(let index=0;index<links.length;index++)links[index].textContent=t(STEPS[index].label);
};
paintEntry();
document.addEventListener('rigshade:locale',paintEntry);
}
global.RigShadeDemo={
isDemo:function(){
try{
return new URLSearchParams(global.location.search).has('demo');
}catch(error){
return false;
}
},
createLink:createLink,
startTour:startTour,
mountEntry:mountEntry,
};
})(typeof globalThis!=='undefined'?globalThis:this);