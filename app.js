(function(global){
'use strict';
const P=global.RigShadeProtocol;
if(!P)throw new Error('app.js needs protocol.js to be loaded first');
const S=global.RigShadeSession;
if(!S)throw new Error('app.js needs session.js to be loaded first');
const TIMEOUT_MS=1500;
const LOG_LINES=400;
const TITLE_MAX=34;
const BODY_MAX=130;
function slotName(index){
return index>=0&&index<P.MemoryMap.PRESET_COUNT?String.fromCharCode(65+index):'?';
}
const GUIDANCE={
PEDAL_NOT_CONNECTED:function(){
return{
id:'PEDAL_NOT_CONNECTED',
title:'Pedal not connected',
body:'Plug the pedal in over USB, press CONNECT, then try again.',
};
},
READ_THE_PEDAL_FIRST:function(){
return{
id:'READ_THE_PEDAL_FIRST',
title:'Read the pedal first',
body:'Press READ PRESETS so the page holds A, B and C, then try again.',
};
},
SAVE_NOT_CONFIRMED:function(){
return{
id:'SAVE_NOT_CONFIRMED',
title:'Save not confirmed',
body:'The pedal did not read back the values. Press SAVE again; if a cabinet was involved, press RESTORE.',
};
},
EDIT_HELD:function(facts){
const edited=slotName(facts.edited);
const sounding=slotName(facts.sounding);
return{
id:'EDIT_HELD',
title:'Edit held for bank '+edited,
body:
'The pedal is playing '+sounding+', so nothing was sent. Tap the bank badge and pick '+edited+'.',
};
},
MIC_DIST_OTHER_BANK:function(facts){
return{
id:'MIC_DIST_OTHER_BANK',
title:'MIC DIST is for the sounding bank',
body:
'The pedal is playing '+slotName(facts.sounding)+'. Tap the bank badge and pick '+
slotName(facts.edited)+', then move MIC DIST.',
};
},
MIC_DIST_FACTORY_CABINET:function(facts){
return{
id:'MIC_DIST_FACTORY_CABINET',
title:'MIC DIST needs your cabinet',
body:
'Bank '+slotName(facts.sounding)+' plays factory cabinet '+facts.irValue+
'. MIC DIST only moves your imported cabinet — press IMPORT IR first.',
};
},
MIC_DIST_IR_OFF:function(facts){
return{
id:'MIC_DIST_IR_OFF',
title:'Bank '+slotName(facts.sounding)+' has no cabinet',
body:'Turn IR on for bank '+slotName(facts.sounding)+', or import a cabinet, then move MIC DIST.',
};
},
CABINET_UNREAD:function(){
return{
id:'CABINET_UNREAD',
title:'Cabinet not read',
body:'The page could not read the pedal\'s cabinet. Press READ CABINET, then try again.',
};
},
CABINET_EMPTY:function(facts){
return{
id:'CABINET_EMPTY',
title:'No cabinet to move',
body:
'Bank '+slotName(facts.sounding)+
' selects cabinet 8 and the pedal\'s slot is empty. Press IMPORT IR to put a cabinet there.',
};
},
};
function assertPopup(popup){
if(!popup||typeof popup.title!=='string'||typeof popup.body!=='string'){
throw new Error('a popup needs a title and a body');
}
if(popup.title.length===0||popup.body.length===0)throw new Error('a popup needs a title and a body');
if(popup.title.length>TITLE_MAX){
throw new Error('a popup title is at most '+TITLE_MAX+' characters, got '+popup.title.length);
}
if(popup.body.length>BODY_MAX){
throw new Error('a popup body is at most '+BODY_MAX+' characters, got '+popup.body.length);
}
return popup;
}
function targets(screen,editing){
if(editing)return['CHAIN','TONES','BANK'];
if(screen==='CHAIN')return['TONES','TUNER','BANK'];
if(screen==='TONES')return['CHAIN','TUNER','BANK','EDIT'];
if(screen==='TUNER')return['CHAIN','TONES','BANK','EDIT'];
return['CHAIN','TONES','TUNER','EDIT'];
}
const screens=new Map();
function registerScreen(spec){
if(!spec||typeof spec.id!=='string'||spec.id.length===0){
throw new Error('registerScreen needs { id }');
}
if(typeof spec.mount!=='function')throw new Error('screen '+spec.id+' needs mount(root, ctx)');
const entry={id:spec.id,label:spec.label||spec.id,mount:spec.mount};
if(typeof spec.update==='function')entry.update=spec.update;
if(typeof spec.unmount==='function')entry.unmount=spec.unmount;
screens.set(entry.id,entry);
if(shell!==null)shell.renderNav();
return entry;
}
let shell=null;
function boot(options){
const settings=options||{};
const root=
typeof settings.root==='string'?document.querySelector(settings.root):settings.root||null;
if(root===null)throw new Error('boot needs the shell\'s root element');
if(shell!==null)return shell;
shell=createShell(root,settings);
shell.start();
return shell;
}
function createShell(root,settings){
const byId=function(id){
const element=root.querySelector('[data-shell="'+id+'"]');
if(element===null)throw new Error('the shell markup has no data-shell="'+id+'"');
return element;
};
const transport=global.RigShadeTransport;
const link=
settings.link!==undefined
?settings.link
:transport
?transport.create({logger:log,timeoutMs:TIMEOUT_MS})
:null;
const session=
settings.session!==undefined
?settings.session
:link!==null
?S.createSession(link,{timeoutMs:TIMEOUT_MS})
:null;
const state={
screen:'CHAIN',
editing:false,
block:'AMP',
activePreset:0,
soundingPreset:0,
soundingConfirmed:false,
linkKind:link!==null?link.state().kind:'NoPedal',
linkReason:link!==null?link.state().reason||'':'no-transport',
pedalRead:'IDLE',
busy:false,
status:'',
statusKind:'',
irFileName:null,
cabinetRead:false,
connected:false,
};
let history=[];
let mounted=null;
let mountedKey=null;
let autoReadFor=null;
let popup=null;
const popupsShown=new Set();
function log(kind,text){
const pane=byId('log');
const line=document.createElement('div');
line.className=kind;
line.textContent=(kind==='sent'?'>> ':kind==='received'?'<< ':'·· ')+text;
pane.appendChild(line);
while(pane.childElementCount>LOG_LINES)pane.removeChild(pane.firstElementChild);
pane.scrollTop=pane.scrollHeight;
}
function paintStatus(){
const band=byId('status-band');
band.textContent=state.status;
band.className='notice'+(state.statusKind?' '+state.statusKind:'');
band.setAttribute('data-kind',state.statusKind||'none');
}
function status(text,kind){
state.status=text;
state.statusKind=kind||'';
paintStatus();
}
function guidance(candidate){
const popupText=assertPopup(candidate);
if(popup!==null){
log('link','a popup is already open: "'+popupText.title+'" was not raised');
return false;
}
if(popupsShown.has(popupText.id))return false;
popupsShown.add(popupText.id);
popup=popupText;
const dialog=byId('guidance');
byId('guidance-title').textContent=popupText.title;
byId('guidance-body').textContent=popupText.body;
if(typeof dialog.showModal==='function')dialog.showModal();
else dialog.setAttribute('open','');
log('link','popup: '+popupText.title);
return true;
}
function dismissGuidance(){
popup=null;
const dialog=byId('guidance');
if(typeof dialog.close==='function')dialog.close();
else dialog.removeAttribute('open');
}
function paintLink(){
const current=link!==null?link.state():null;
if(current!==null){
state.linkKind=current.kind;
state.linkReason=current.reason||'';
state.connected=current.kind==='Ready';
}else{
state.linkKind='NoPedal';
state.linkReason='no-transport';
state.connected=false;
}
const label=byId('link-state');
const ready=state.linkKind==='Ready';
label.textContent=ready
?'Ready · '+(current.name||'(no name)')
:state.linkKind+(state.linkReason?' · '+state.linkReason:'');
label.setAttribute('data-kind',state.linkKind);
byId('pedal-name').textContent=ready?'"'+(current.name||'(empty name)')+'"':'—';
byId('link-notice').textContent=
current!==null
?current.message
:'transport.js is not loaded: the page is showing what it would do, and cannot talk to a pedal.';
paintPorts();
}
let paintedPorts='';
function paintPorts(){
const ports=link!==null?link.ports():{outputs:[],inputs:[],chosen:{}};
const key=ports.outputs.map((p)=>p.id).join('|')+'::'+ports.inputs.map((p)=>p.id).join('|');
if(key===paintedPorts){
byId('out-port').value=ports.chosen.outputId||'';
byId('in-port').value=ports.chosen.inputId||'';
return;
}
paintedPorts=key;
fillPortSelect(byId('out-port'),ports.outputs,'no output',ports.chosen.outputId);
fillPortSelect(byId('in-port'),ports.inputs,'no input',ports.chosen.inputId);
}
function fillPortSelect(select,ports,fallback,chosen){
select.textContent='';
const none=document.createElement('option');
none.value='';
none.textContent=fallback;
select.appendChild(none);
for(const port of ports){
const option=document.createElement('option');
option.value=port.id;
option.textContent=port.name||port.id;
select.appendChild(option);
}
if(chosen)select.value=chosen;
}
function renderNav(){
const row=byId('nav-row');
row.textContent='';
const back=document.createElement('button');
back.className='chip';
back.id='nav-back';
back.textContent='BACK';
back.disabled=history.length===0||!state.connected;
back.addEventListener('click',function(){
goBack();
});
row.appendChild(back);
for(const destination of targets(state.screen,state.editing)){
const chip=document.createElement('button');
chip.className='chip nav';
chip.id='nav-'+destination;
chip.textContent=destination;
const module=screens.get(destination);
const current=(destination==='EDIT')===state.editing&&state.screen==='CHAIN';
chip.setAttribute('aria-pressed',String(current));
chip.disabled=!state.connected||module===undefined;
if(module===undefined){
chip.title='ui-'+destination.toLowerCase()+'.js is not loaded on this page';
}
chip.addEventListener('click',function(){
go(destination);
});
row.appendChild(chip);
}
}
function renderPresetRow(){
const row=byId('preset-row');
row.textContent='';
for(let index=0;index<P.MemoryMap.PRESET_COUNT;index++){
const chip=document.createElement('button');
chip.className='chip preset';
chip.id='preset-'+slotName(index);
chip.textContent=slotName(index);
chip.setAttribute('aria-pressed',String(index===state.activePreset));
chip.disabled=!state.connected;
chip.addEventListener('click',function(){
state.activePreset=index;
render();
});
row.appendChild(chip);
}
const mode=editMode();
const badge=document.createElement('button');
badge.className='chip badge';
badge.id='bank-badge';
badge.textContent=mode.badge;
badge.title=mode.detail||'which bank the pedal is playing';
badge.disabled=!state.connected;
badge.addEventListener('click',function(){
openBankPicker();
});
row.appendChild(badge);
const detail=document.createElement('span');
detail.className='state';
detail.id='bank-badge-detail';
detail.textContent=mode.detail;
row.appendChild(detail);
}
function editMode(){
if(!state.connected){
return{badge:'no pedal',detail:'Plug the pedal in to edit live.',live:false,needsDeclaration:false};
}
const live=state.activePreset===state.soundingPreset;
const bank=state.soundingConfirmed?slotName(state.soundingPreset):'bank?';
const detail=!state.soundingConfirmed
?'Tap to say which bank the pedal is playing.'
:live
?''
:'The pedal plays '+slotName(state.soundingPreset)+', so SAVE writes '+
slotName(state.activePreset)+' to it.';
return{
badge:bank+' · '+(live?'live':'on SAVE'),
detail:detail,
live:live,
needsDeclaration:!state.soundingConfirmed,
};
}
function openBankPicker(){
const dialog=byId('pick-bank');
const list=byId('pick-bank-buttons');
list.textContent='';
for(let index=0;index<P.MemoryMap.PRESET_COUNT;index++){
const chip=document.createElement('button');
chip.className='chip preset';
chip.id='pick-bank-'+slotName(index);
chip.textContent=slotName(index);
chip.setAttribute('aria-pressed',String(index===state.soundingPreset&&state.soundingConfirmed));
chip.addEventListener('click',function(){
state.soundingPreset=index;
state.soundingConfirmed=true;
closeDialog(dialog);
render();
});
list.appendChild(chip);
}
openDialog(dialog);
}
function openDialog(dialog){
if(typeof dialog.showModal==='function')dialog.showModal();
else dialog.setAttribute('open','');
}
function closeDialog(dialog){
if(typeof dialog.close==='function')dialog.close();
else dialog.removeAttribute('open');
}
function editLockReason(){
if(!state.connected)return'no pedal connected';
if(state.pedalRead==='READING')return'reading A, B and C from the pedal';
if(state.pedalRead==='FAILED')return'the presets could not be read';
if(session!==null&&session.cabinetBusy)return'the pedal is loading its cabinet';
if(state.busy)return'another action is still finishing';
return null;
}
function paintLock(){
const line=byId('edit-lock');
const reason=editLockReason();
line.textContent=reason===null?'':'Live edits are paused — '+reason;
line.hidden=reason===null;
}
function where(){
return{screen:state.screen,editing:state.editing,block:state.block};
}
function go(destination){
const from=where();
if(destination==='EDIT'){
state.screen='CHAIN';
state.editing=true;
}else{
state.screen=destination;
state.editing=false;
}
state.block=from.block;
if(samePlace(from,where()))return;
history.push(from);
render();
}
function goBack(){
const previous=history.pop();
if(previous===undefined)return;
state.screen=previous.screen;
state.editing=previous.editing;
state.block=previous.block;
render();
}
function samePlace(left,right){
return left.screen===right.screen&&left.editing===right.editing&&left.block===right.block;
}
function screenId(){
return state.editing?'EDIT':state.screen;
}
function paintScreen(){
const host=byId('screen');
const wanted=screenId();
const key=wanted;
const module=screens.get(wanted);
if(mountedKey!==key){
if(mounted!==null&&typeof mounted.unmount==='function'){
try{
mounted.unmount();
}catch(error){
log('failed','unmount of '+mountedKey+': '+error.message);
}
}
mounted=null;
mountedKey=null;
host.textContent='';
if(module!==undefined){
module.mount(host,ctx);
mounted=module;
mountedKey=key;
}else{
const notice=document.createElement('p');
notice.className='notice';
notice.id='screen-missing';
notice.textContent=
'This screen is not on this page: '+wanted.toLowerCase()+' is a module of its own '+
'(ui-'+wanted.toLowerCase()+'.js), which this build does not ship.';
host.appendChild(notice);
}
}
if(mounted!==null&&typeof mounted.update==='function'){
try{
mounted.update(host,ctx);
}catch(error){
log('failed','update of '+mountedKey+': '+error.message);
}
}
host.setAttribute('data-locked',state.connected?'0':'1');
host.classList.toggle('locked',!state.connected);
}
function render(){
paintLink();
renderNav();
renderPresetRow();
paintLock();
paintScreen();
paintStatus();
}
async function perform(label,action){
if(state.busy)return{ok:false,error:new Error('another action is still finishing')};
state.busy=true;
render();
try{
const value=await action();
return{ok:true,value:value};
}catch(error){
status(label+': '+(error&&error.message?error.message:String(error)),'error');
return{ok:false,error:error};
}finally{
state.busy=false;
render();
}
}
const ctx={
link:link,
session:session,
cabinet:global.RigShadeCabinet||null,
bank:global.RigShadeBank||null,
tuner:global.RigShadeTuner||null,
get state(){
return state;
},
setState:function(patch){
Object.assign(state,patch||{});
render();
},
status:status,
guidance:guidance,
log:log,
go:go,
back:goBack,
ready:function(){
return state.connected;
},
liveTarget:function(){
return state.activePreset===state.soundingPreset?state.activePreset:null;
},
perform:perform,
};
async function autoRead(current){
if(current.kind!=='Ready')return;
const mark=current.outputId+'>'+current.inputId+'#'+(current.name||'');
if(autoReadFor===mark)return;
autoReadFor=mark;
if(session===null)return;
state.pedalRead='READING';
render();
const result=await perform('reading the presets',function(){
return session.readPresets();
});
state.pedalRead=result.ok?'READY':'FAILED';
if(result.ok)status('read the three presets: memory 0x05, address 0, 48 bytes','ok');
else guidance(GUIDANCE.READ_THE_PEDAL_FIRST());
render();
}
function wireLink(){
if(link===null)return;
link.watch(function(current){
state.linkKind=current.kind;
state.linkReason=current.reason||'';
render();
if(current.kind==='Ready')autoRead(current);
});
}
function start(){
byId('connect').addEventListener('click',async function(){
if(link===null){
status('transport.js is not loaded: there is no Web MIDI link on this page','error');
return;
}
status('asking the browser for MIDI access, including SysEx…','');
const current=await link.connect();
render();
if(current.kind==='Ready'){
status('the pedal answered as "'+current.name+'" on '+current.outputName+' → '+current.inputName,'ok');
}else{
status(current.kind+(current.reason?' ('+current.reason+')':'')+': '+current.message,'error');
}
});
byId('diagnose').addEventListener('click',async function(){
const pane=byId('link-diagnosis');
pane.textContent='';
if(link===null){
status('transport.js is not loaded: there is nothing to probe','error');
return;
}
let rows;
try{
rows=await link.probe();
}catch(error){
status('diagnose: '+error.message,'error');
return;
}
for(const row of rows){
const line=document.createElement('div');
line.className='pair';
line.setAttribute('data-ok',row.name===null?'0':'1');
line.textContent=
(row.name===null?'SILENT  ':'ANSWER  ')+
row.outputName+' → '+row.inputName+': '+
(row.name===null?row.error||'no answer':'"'+row.name+'"');
pane.appendChild(line);
log(row.name===null?'failed':'link',line.textContent);
}
const answering=rows.filter((row)=>row.name!==null).length;
status(
'diagnose: '+rows.length+' pair(s) asked, '+answering+' answered with a name',
answering===0?'error':'ok'
);
});
byId('read-presets').addEventListener('click',async function(){
if(session===null)return;
const result=await perform('reading the presets',function(){
return session.readPresets();
});
state.pedalRead=result.ok?'READY':'FAILED';
if(result.ok)status('read the three presets: memory 0x05, address 0, 48 bytes','ok');
render();
});
byId('out-port').addEventListener('change',onPortChange);
byId('in-port').addEventListener('change',onPortChange);
byId('clear-log').addEventListener('click',function(){
byId('log').textContent='';
});
byId('guidance-ok').addEventListener('click',function(){
dismissGuidance();
});
byId('guidance').addEventListener('cancel',function(event){
event.preventDefault();
dismissGuidance();
});
byId('pick-bank-cancel').addEventListener('click',function(){
closeDialog(byId('pick-bank'));
});
wireLink();
render();
}
function onPortChange(){
if(link===null)return;
link.select(byId('out-port').value,byId('in-port').value);
status('the pair was chosen by hand and has not been verified: press CONNECT to ask it its name','');
render();
}
return{start:start,render:render,renderNav:renderNav,ctx:ctx,state:state};
}
global.RigShadeUI={
registerScreen:registerScreen,
boot:boot,
targets:targets,
guidanceTable:GUIDANCE,
assertPopup:assertPopup,
slotName:slotName,
TITLE_MAX:TITLE_MAX,
BODY_MAX:BODY_MAX,
};
})(typeof globalThis!=='undefined'?globalThis:this);