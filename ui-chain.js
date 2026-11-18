(function(global){
'use strict';
const P=global.RigShadeProtocol;
const UI=global.RigShadeUI;
if(!P)throw new Error('ui-chain.js needs protocol.js');
if(!UI)throw new Error('ui-chain.js needs app.js');
const TYPE=0;
const GAIN=1;
const TONE=2;
const REVERB=3;
const FB=4;
const VOLUME=5;
const TIME=6;
const MIX=7;
const MOD=8;
const IR=9;
const CAB_SW=10;
const MOD_SW=11;
const AMP_SW=12;
const STAGES=[
{name:'AMP',label:'AMP',params:[TYPE,GAIN,TONE],swap:AMP_SW,toggle:AMP_SW,block:'AMP'},
{name:'MOD',label:'MOD',params:[MOD],swap:MOD_SW,toggle:MOD,block:'MOD_DELAY'},
{name:'DELAY',label:'DELAY',params:[FB,TIME,MIX],swap:MOD_SW,toggle:TIME,block:'MOD_DELAY'},
{name:'REVERB',label:'REVERB',params:[REVERB],swap:CAB_SW,toggle:REVERB,block:'CAB_IR'},
{name:'IR',label:'IR',params:[IR],swap:CAB_SW,toggle:IR,block:'CAB_IR'},
];
const OUTPUT={name:'VOLUME',label:'VOLUME',params:[VOLUME],swap:null,toggle:null,block:'VOLUME'};
const BLOCKS=[
{id:'AMP',title:'AMP',swap:AMP_SW,params:[TONE,GAIN,TYPE]},
{id:'MOD_DELAY',title:'MOD / DELAY',swap:MOD_SW,params:[MIX,FB,TIME,MOD]},
{id:'CAB_IR',title:'CAB / IR',swap:CAB_SW,params:[IR,REVERB]},
{id:'VOLUME',title:'VOLUME',swap:null,params:[VOLUME]},
];
const USER_IR_UNKNOWN='IR 8 · user';
const USER_SLOT_VALUE=P.CabinetNames.length-1;
const param=function(code){
return P.Params.byCode(code);
};
function fractions(code,value){
const p=param(code);
return p.max===0?0:Math.min(Math.max(value/p.max,0),1);
}
function valueText(code,value,irFileName){
const p=param(code);
if(P.Params.isOff(p,value))return'OFF';
if(code===IR&&value===USER_SLOT_VALUE){
return irFileName&&String(irFileName).trim()?String(irFileName):USER_IR_UNKNOWN;
}
return P.describe(code,value);
}
function nextValue(code,current,remembered){
const p=param(code);
if(p.neutral===null)return current===0?1:0;
if(P.Params.isOff(p,current))return P.Params.clamp(p,remembered===undefined?p.wake||0:remembered);
return p.neutral[0];
}
function wakeTargets(swap){
const codes=[];
for(const stage of STAGES){
if(stage.swap!==swap||stage.name==='REVERB')continue;
for(const code of stage.params)if(!codes.includes(code))codes.push(code);
}
return codes.filter((code)=>param(code).neutral!==null);
}
function blockEmpty(values,swap){
if(swap===null||!values)return false;
if(values[swap]===0)return false;
const speaking=wakeTargets(swap);
return speaking.length>0&&speaking.every((code)=>P.Params.isOff(param(code),values[code]));
}
function blockOn(values,swap){
return swap===null||(values!==null&&values[swap]!==0);
}
function stageOn(values,stage){
if(!blockOn(values,stage.swap))return false;
const toggle=stage.toggle;
if(toggle===null)return true;
const p=param(toggle);
return p.neutral===null?values[toggle]!==0:!P.Params.isOff(p,values[toggle]);
}
function el(tag,className,text){
const element=document.createElement(tag);
if(className)element.className=className;
if(text!==undefined)element.textContent=text;
return element;
}
function slotName(index){
return UI.slotName(index);
}
function valuesOf(ctx){
const presets=ctx.session!==null?ctx.session.presets:null;
return presets===null?null:presets[ctx.state.activePreset];
}
function dial(code,value){
const p=param(code);
const node=el('div','dial');
node.setAttribute('data-code',String(code));
node.style.setProperty('--frac',String(fractions(code,value)));
node.appendChild(el('span','dial-body'));
node.appendChild(el('span','dial-pointer'));
if(p.neutral!==null)node.classList.toggle('off',P.Params.isOff(p,value));
return node;
}
const NOTHING_READ='No pedal values yet: press READ PRESETS, or CONNECT to read A, B and C.';
function mountChain(root,ctx){
const head=el('p','chain-order','IN → AMP → MOD → DELAY → REVERB → IR → OUT');
const board=el('div','board');
board.setAttribute('data-board','chain');
const terminalIn=el('div','terminal');
terminalIn.setAttribute('data-terminal','IN');
terminalIn.appendChild(el('span','socket'));
terminalIn.appendChild(el('span',null,'IN'));
board.appendChild(terminalIn);
for(const stage of STAGES){
board.appendChild(el('div','cable'));
board.appendChild(buildBox(ctx,root,stage));
}
board.appendChild(el('div','cable'));
board.appendChild(buildOutput(ctx));
board.appendChild(el('div','cable'));
const bar=el('div','bar');
bar.setAttribute('data-bar','chain');
const save=el('button','save','SAVE');
save.setAttribute('data-action','chain-save');
save.addEventListener('click',function(){
saveChain(ctx);
});
const reset=el('button','danger','RESET');
reset.setAttribute('data-action','chain-reset');
reset.addEventListener('click',function(){
openReset(ctx,root);
});
const undo=el('button',null,'UNDO');
undo.setAttribute('data-action','chain-undo');
undo.addEventListener('click',function(){
undoReset(ctx);
});
const stateLine=el('span','state');
stateLine.setAttribute('data-shell','chain-status');
bar.appendChild(save);
bar.appendChild(reset);
bar.appendChild(undo);
bar.appendChild(el('span','spacer'));
bar.appendChild(stateLine);
const confirm=el('dialog');
confirm.setAttribute('data-dialog','reset');
confirm.appendChild(el('h3',null,'Factory reset'));
confirm.appendChild(
el(
'p',
null,
'RESET writes the documented initial values into all three memories, not the presets the pedal '+
'shipped with. The block the pedal holds now is read and kept first, so UNDO can put it back.'
)
);
confirm.appendChild(
el(
'p',
null,
'The pedal\'s user cabinet slot is cleared as well: the cabinet imported into it (IR 8) is '+
'erased and the slot is left free for a new import. RESTORE puts that cabinet back.'
)
);
const confirmRow=el('div','row');
const cancel=el('button',null,'CANCEL');
cancel.setAttribute('data-action','reset-cancel');
cancel.addEventListener('click',function(){
closeDialog(confirm);
});
const go=el('button','danger','RESET');
go.setAttribute('data-action','reset-confirm');
go.addEventListener('click',function(){
closeDialog(confirm);
applyReset(ctx);
});
confirmRow.appendChild(cancel);
confirmRow.appendChild(go);
confirm.appendChild(confirmRow);
root.appendChild(head);
root.appendChild(board);
root.appendChild(bar);
root.appendChild(confirm);
root.appendChild(buildExactDialog());
updateChain(root,ctx);
}
function buildBox(ctx,sheet,stage){
const box=el('div','box');
box.setAttribute('data-stage',stage.name);
const headRow=el('div','box-head');
if(stage.toggle!==null){
const led=el('button','led');
led.setAttribute('data-led',stage.name);
led.title='switch '+stage.label;
led.addEventListener('click',function(event){
event.stopPropagation();
toggle(ctx,stage.toggle,stage.swap);
});
headRow.appendChild(led);
}
const name=el('span','box-name',stage.label);
if(stage.toggle!==null){
name.style.cursor='pointer';
name.addEventListener('click',function(event){
event.stopPropagation();
toggle(ctx,stage.toggle,stage.swap);
});
}
headRow.appendChild(name);
const edit=el('span','box-edit','EDIT');
edit.setAttribute('data-edit',stage.name);
edit.addEventListener('click',function(event){
event.stopPropagation();
openEditor(ctx,stage.block);
});
headRow.appendChild(edit);
box.appendChild(headRow);
const knobs=el('div','knobs');
for(const code of stage.params)knobs.appendChild(buildParamKnob(ctx,sheet,code));
box.appendChild(knobs);
const foot=el('div','box-foot');
const notice=el('span','box-notice');
notice.setAttribute('data-notice',stage.name);
foot.appendChild(notice);
if(stage.toggle!==null)foot.appendChild(el('span','footswitch'));
box.appendChild(foot);
box.addEventListener('click',function(){
openEditor(ctx,stage.block);
});
return box;
}
function buildOutput(ctx){
const out=el('div','terminal out');
out.setAttribute('data-terminal','OUT');
out.appendChild(el('span','name',OUTPUT.label));
const value=el('span','value','—');
value.setAttribute('data-knob',String(VOLUME));
out.appendChild(value);
const label=el('span','name','OUT');
out.appendChild(label);
out.addEventListener('click',function(){
openEditor(ctx,OUTPUT.block);
});
return out;
}
function updateChain(root,ctx){
const values=valuesOf(ctx);
const card=root.querySelector('[data-board="chain"]');
const locked=!ctx.state.connected||ctx.state.busy;
for(const stage of STAGES){
const box=card.querySelector('[data-stage="'+stage.name+'"]');
const on=values===null?false:stageOn(values,stage);
box.classList.toggle('off',!on);
const led=box.querySelector('[data-led="'+stage.name+'"]');
if(led!==null){
led.classList.toggle('on',on);
led.disabled=locked;
}
box.querySelector('[data-edit="'+stage.name+'"]').style.opacity=locked?'0.5':'1';
for(const code of stage.params){
const knob=box.querySelector('[data-knob="'+code+'"]');
const value=values===null?null:values[code];
paintKnob(knob,code,value,on,ctx.state.irFileName,locked);
}
const notice=box.querySelector('[data-notice="'+stage.name+'"]');
notice.textContent=
values===null
?''
:!blockOn(values,stage.swap)
?'block off'
:blockEmpty(values,stage.swap)
?'block empty'
:'';
}
const volume=card.querySelector('[data-knob="'+VOLUME+'"]');
volume.textContent=values===null?'—':valueText(VOLUME,values[VOLUME],ctx.state.irFileName);
const bar=root.querySelector('[data-bar="chain"]');
const save=bar.querySelector('[data-action="chain-save"]');
save.disabled=locked||ctx.session===null||!ctx.session.canSave;
const reset=bar.querySelector('[data-action="chain-reset"]');
reset.disabled=locked||ctx.session===null||!ctx.session.canSave;
const undo=bar.querySelector('[data-action="chain-undo"]');
const canUndo=ctx.session!==null&&ctx.session.presetBackup!==null;
undo.hidden=!canUndo;
undo.disabled=locked||!canUndo;
const line=bar.querySelector('[data-shell="chain-status"]');
line.textContent=values===null?(ctx.state.connected?'reading the pedal…':NOTHING_READ):statusText(ctx);
line.setAttribute('data-kind',ctx.state.statusKind||'none');
}
function statusText(ctx){
if(ctx.state.busy)return'Working…';
if(ctx.state.status)return ctx.state.status;
if(ctx.session!==null&&ctx.session.dirty)return'Unsaved changes';
return'Saved';
}
function paintKnob(knob,code,value,on,irFileName,locked){
const p=param(code);
const drawing=knob.querySelector('.dial');
const isOff=value!==null&&p.neutral!==null&&P.Params.isOff(p,value);
drawing.style.setProperty('--frac',String(value===null?0:fractions(code,value)));
drawing.classList.toggle('off',isOff||value===null);
drawing.classList.toggle('dim',!on);
const valueNode=knob.querySelector('.knob-value');
valueNode.textContent=value===null?'—':valueText(code,value,irFileName);
knob.classList.toggle('dim',!on||isOff||value===null);
knob.setAttribute('aria-disabled',String(!on||locked));
}
function openEditor(ctx,blockId){
if(!ctx.ready())return;
ctx.setState({block:blockId});
ctx.go('EDIT');
}
async function saveChain(ctx){
if(ctx.session===null)return;
const result=await ctx.perform('saving',function(){
return ctx.session.savePresets();
});
if(result.ok){
ctx.status('the three presets were written and read back identical','ok');
}else{
ctx.guidance(UI.guidanceTable.SAVE_NOT_CONFIRMED());
}
}
function openReset(ctx,root){
const dialog=root.querySelector('[data-dialog="reset"]');
openDialog(dialog);
}
async function applyReset(ctx){
if(ctx.session===null)return;
const result=await ctx.perform('factory reset',function(){
return ctx.session.resetPresets();
});
if(!result.ok)return;
const report=result.value;
ctx.status(report.line,report.slot.outcome==='NOT_CLEARED'?'error':'ok');
ctx.setState({irFileName:null,cabinetRead:report.slot.outcome!=='NOT_CLEARED'});
}
async function undoReset(ctx){
if(ctx.session===null)return;
const result=await ctx.perform('undo',function(){
return ctx.session.undoReset();
});
if(result.ok)ctx.status(result.value.line,'ok');
}
async function writeParam(ctx,code,value){
if(ctx.session===null)return false;
const target=ctx.liveTarget();
const p=param(code);
const wanted=P.Params.clamp(p,value);
const current=valuesOf(ctx);
if(current!==null&&current[code]===wanted)return true;
if(target===null){
ctx.status(heldNotice(ctx,'editing'),'error');
ctx.guidance(UI.guidanceTable.EDIT_HELD({edited:ctx.state.activePreset,sounding:ctx.state.soundingPreset}));
return false;
}
const result=await ctx.perform('writing '+p.label,function(){
return ctx.session.writeLiveParam(ctx.state.activePreset,code,wanted);
});
if(result.ok)ctx.status(p.label+' = '+wanted+' ('+valueText(code,wanted,ctx.state.irFileName)+') sent to live memory','ok');
return result.ok;
}
function heldNotice(ctx,verb){
return(
verb+' '+slotName(ctx.state.activePreset)+' while the pedal sounds '+
slotName(ctx.state.soundingPreset)+': nothing was sent live'
);
}
async function toggle(ctx,code,swap){
const values=valuesOf(ctx);
if(values===null)return;
const p=param(code);
const next=nextValue(code,values[code],memory.get(code));
const writes=[];
if(p.neutral===null&&swap!==null&&values[swap]===0&&next!==0){
writes.push([code,next]);
for(const woken of wakeTargets(swap)){
if(P.Params.isOff(param(woken),values[woken])){
const remembered=memory.get(woken);
writes.push([woken,P.Params.clamp(param(woken),remembered===undefined?param(woken).wake||0:remembered)]);
}
}
}else{
writes.push([code,next]);
}
for(const[written,value]of writes){
const ok=await writeParam(ctx,written,value);
if(!ok)return;
}
}
const memory=new Map();
function observe(values){
if(values===null)return;
for(const p of P.Params.ALL){
if(p.neutral!==null&&!P.Params.isOff(p,values[p.code]))memory.set(p.code,values[p.code]);
}
}
function mountEditor(root,ctx){
const sheet=el('div','editor');
sheet.setAttribute('data-editor','1');
const blocks=el('div','blocks');
blocks.setAttribute('data-editor-blocks','1');
for(const block of BLOCKS)blocks.appendChild(mountBlockPanel(ctx,sheet,block));
sheet.appendChild(blocks);
const bar=el('div','bar');
const save=el('button','save','SAVE');
save.setAttribute('data-action','save');
save.addEventListener('click',function(){
saveChain(ctx);
});
const reset=el('button','danger','RESET');
reset.setAttribute('data-action','editor-reset');
reset.addEventListener('click',function(){
openReset(ctx,root);
});
const undo=el('button',null,'UNDO');
undo.setAttribute('data-action','editor-undo');
undo.addEventListener('click',function(){
undoReset(ctx);
});
const dirty=el('span','state');
dirty.setAttribute('data-shell','save-state');
bar.appendChild(save);
bar.appendChild(reset);
bar.appendChild(undo);
bar.appendChild(el('span','spacer'));
bar.appendChild(dirty);
sheet.appendChild(bar);
const confirm=el('dialog');
confirm.setAttribute('data-dialog','reset');
confirm.appendChild(el('h3',null,'Factory reset'));
confirm.appendChild(
el('p',null,'RESET writes the documented initial values into all three memories. The block the pedal holds now is kept, so UNDO can put it back.')
);
confirm.appendChild(
el(
'p',
null,
'The pedal\'s user cabinet slot is cleared as well: the cabinet imported into it (IR 8) is erased '+
'and the slot is left free for a new import. RESTORE puts that cabinet back.'
)
);
const confirmRow=el('div','row');
const cancel=el('button',null,'CANCEL');
cancel.addEventListener('click',function(){
closeDialog(confirm);
});
const go=el('button','danger','RESET');
go.setAttribute('data-action','reset-confirm');
go.addEventListener('click',function(){
closeDialog(confirm);
applyReset(ctx);
});
confirmRow.appendChild(cancel);
confirmRow.appendChild(go);
confirm.appendChild(confirmRow);
sheet.appendChild(confirm);
sheet.appendChild(buildExactDialog());
root.appendChild(sheet);
const focused=sheet.querySelector('[data-block="'+ctx.state.block+'"]');
if(focused!==null&&typeof focused.scrollIntoView==='function'){
focused.scrollIntoView({block:'nearest',inline:'nearest'});
}
updateEditor(root,ctx);
}
function mountBlockPanel(ctx,sheet,block){
const panel=el('section','block');
panel.setAttribute('data-block-panel','1');
panel.setAttribute('data-block',block.id);
const head=el('div','block-head');
const led=el('button','led');
led.setAttribute('data-block-led','1');
led.addEventListener('click',function(){
if(block.swap!==null)toggle(ctx,block.swap,block.swap);
});
const title=el('span','block-title',block.title);
title.setAttribute('data-block-title','1');
const note=el('span','block-note');
note.setAttribute('data-block-note','1');
head.appendChild(led);
head.appendChild(title);
head.appendChild(note);
panel.appendChild(head);
const params=el('div','params');
params.setAttribute('data-block-params','1');
for(const code of block.params)params.appendChild(buildParamKnob(ctx,sheet,code));
panel.appendChild(params);
if(block.id==='CAB_IR'){
const mic=el('div','mic');
mic.setAttribute('data-mic-panel','1');
panel.appendChild(mic);
}
return panel;
}
function updateEditor(root,ctx){
const sheet=root.querySelector('[data-editor]');
const values=valuesOf(ctx);
observe(values);
const locked=!ctx.state.connected||ctx.state.busy;
for(const block of BLOCKS){
const panel=sheet.querySelector('[data-block="'+block.id+'"]');
const on=values===null?false:block.swap===null?true:values[block.swap]!==0;
const led=panel.querySelector('[data-block-led]');
led.classList.toggle('on',on);
led.disabled=locked;
led.hidden=block.swap===null;
panel.querySelector('[data-block-title]').style.color=on?'var(--mist)':'var(--secondary)';
panel.querySelector('[data-block-note]').textContent=!on&&block.swap!==null?'block off':'';
panel.classList.toggle('focus',block.id===ctx.state.block);
for(const code of block.params){
const knob=panel.querySelector('[data-knob="'+code+'"]');
const value=values===null?null:values[code];
const p=param(code);
const isOff=value!==null&&p.neutral!==null&&P.Params.isOff(p,value);
const drawing=knob.querySelector('.dial');
drawing.style.setProperty('--frac',String(value===null?0:fractions(code,value)));
drawing.classList.toggle('off',isOff||value===null);
drawing.classList.toggle('dim',!on);
knob.querySelector('.knob-label').style.color=on&&!isOff?'var(--mist)':'var(--secondary)';
knob.querySelector('.value-box').textContent=value===null?'—':valueText(code,value,ctx.state.irFileName);
knob.setAttribute('aria-disabled',String(!on||locked));
}
}
paintMic(sheet.querySelector('[data-block="CAB_IR"]'),ctx,values);
const save=sheet.querySelector('[data-action="save"]');
save.disabled=locked||ctx.session===null||!ctx.session.canSave;
sheet.querySelector('[data-action="editor-reset"]').disabled=locked||ctx.session===null||!ctx.session.canSave;
const undo=sheet.querySelector('[data-action="editor-undo"]');
const canUndo=ctx.session!==null&&ctx.session.presetBackup!==null;
undo.hidden=!canUndo;
undo.disabled=locked||!canUndo;
const saveState=sheet.querySelector('[data-shell="save-state"]');
saveState.textContent=
values===null?(ctx.state.connected?'reading the pedal…':'no pedal values'):ctx.session.dirty?'unsaved changes':'saved';
}
function buildParamKnob(ctx,sheet,code){
const p=param(code);
const knob=el('div','knob');
knob.setAttribute('data-knob',String(code));
const label=el('span','knob-label',p.label);
label.setAttribute('data-label',String(code));
if(p.neutral!==null){
label.title='tap to switch '+p.label+' off and back on';
label.addEventListener('click',function(){
if(knob.getAttribute('aria-disabled')==='true')return;
toggle(ctx,code,null);
});
}
knob.appendChild(label);
const drawing=dial(code,0);
knob.appendChild(drawing);
let start=0;
let from=0;
let dragged=false;
function showPending(wanted){
const valueNode=knob.querySelector('.knob-value');
drawing.style.setProperty('--frac',String(fractions(code,wanted)));
valueNode.textContent=valueText(code,wanted,ctx.state.irFileName);
knob.setAttribute('data-pending',String(wanted));
}
drawing.addEventListener('pointerdown',function(event){
if(knob.getAttribute('aria-disabled')==='true')return;
const values=valuesOf(ctx);
if(values===null)return;
start=values[code];
from=event.clientY;
dragged=true;
knob.removeAttribute('data-pending');
try{
drawing.setPointerCapture(event.pointerId);
}catch(error){
}
});
drawing.addEventListener('pointermove',function(event){
if(!dragged)return;
const delta=((from-event.clientY)/220)*param(code).max;
showPending(P.Params.clamp(param(code),Math.round(start+delta)));
});
drawing.addEventListener('pointerup',function(event){
if(!dragged)return;
dragged=false;
try{
drawing.releasePointerCapture(event.pointerId);
}catch(error){
}
const pending=knob.getAttribute('data-pending');
knob.removeAttribute('data-pending');
if(pending===null){
openExact(ctx,sheet,code);
return;
}
writeParam(ctx,code,Number(pending)).then(function(){
ctx.setState({});
});
});
drawing.addEventListener('pointercancel',function(){
dragged=false;
knob.removeAttribute('data-pending');
});
const box=el('span','value-box knob-value','—');
box.setAttribute('data-value',String(code));
box.title='type an exact value';
box.addEventListener('click',function(){
if(knob.getAttribute('aria-disabled')==='true')return;
openExact(ctx,sheet,code);
});
knob.appendChild(box);
for(const type of['click','pointerdown','pointermove','pointerup']){
knob.addEventListener(type,function(event){
event.stopPropagation();
});
}
return knob;
}
function buildExactDialog(){
const exact=el('dialog');
exact.setAttribute('data-dialog','exact');
exact.appendChild(el('h3','exact-title','value'));
const exactRange=el('input');
exactRange.type='range';
exactRange.setAttribute('data-exact-slider','1');
const exactField=el('input');
exactField.type='number';
exactField.setAttribute('data-exact-field','1');
const exactName=el('p','exact-name');
exactName.setAttribute('data-exact-name','1');
const exactRow=el('div','row');
const exactOk=el('button',null,'OK');
exactOk.setAttribute('data-exact-ok','1');
exactOk.addEventListener('click',function(){
closeDialog(exact);
});
exactRow.appendChild(exactOk);
exact.appendChild(exactRange);
exact.appendChild(exactField);
exact.appendChild(exactName);
exact.appendChild(exactRow);
return exact;
}
function openExact(ctx,sheet,code){
const p=param(code);
const values=valuesOf(ctx);
if(values===null)return;
const dialog=sheet.querySelector('[data-dialog="exact"]');
const range=dialog.querySelector('[data-exact-slider]');
const field=dialog.querySelector('[data-exact-field]');
const name=dialog.querySelector('[data-exact-name]');
dialog.querySelector('.exact-title').textContent=p.label;
range.min='0';
range.max=String(p.max);
range.step='1';
range.value=String(values[code]);
field.min='0';
field.max=String(p.max);
field.step='1';
field.value=String(values[code]);
name.textContent=valueText(code,values[code],ctx.state.irFileName);
field.setAttribute('data-code',String(code));
const commit=function(raw){
const wanted=P.Params.clamp(p,raw);
range.value=String(wanted);
field.value=String(wanted);
name.textContent=valueText(code,wanted,ctx.state.irFileName);
writeParam(ctx,code,wanted).then(function(){
ctx.setState({});
});
};
range.oninput=null;
range.onchange=function(){
commit(Number(range.value));
};
field.onchange=function(){
const digits=String(field.value).replace(/[^0-9]/g,'');
if(digits.length===0)return;
commit(Number(digits));
};
openDialog(dialog);
}
function paintMic(panel,ctx,values){
const mic=panel===null?null:panel.querySelector('[data-mic-panel]');
if(mic===null)return;
mic.textContent='';
const placement=placementOf(ctx,values);
const row=el('div','row');
const read=el('button',null,'READ CABINET');
read.setAttribute('data-action','read-cabinet');
read.disabled=!ctx.state.connected||ctx.state.busy;
read.addEventListener('click',async function(){
const result=await ctx.perform('reading the cabinet',function(){
return ctx.session.readCabinet();
});
ctx.setState({cabinetRead:result.ok});
if(result.ok)ctx.status('read the pedal\'s cabinet slot (0x00070000, 37 chunks of 113 bytes)','ok');
});
row.appendChild(read);
if(placement.slider){
const label=el('span','mic-label');
label.setAttribute('data-mic-label','1');
label.textContent='MIC DIST  '+slotName(ctx.state.activePreset)+'  '+placement.percent+'%';
const slider=el('input');
slider.type='range';
slider.min='0';
slider.max='100';
slider.value=String(placement.percent);
slider.setAttribute('data-mic-slider','1');
slider.disabled=!ctx.state.connected||ctx.state.busy;
slider.addEventListener('change',async function(){
const percent=Number(slider.value);
const result=await ctx.perform('moving MIC DIST',function(){
return ctx.session.moveDistance(percent);
});
if(result.ok){
ctx.status(result.value.line,result.value.silent?'error':'ok');
ctx.setState({});
}
});
mic.appendChild(label);
mic.appendChild(slider);
}else{
const line=el('span','mic-refusal',placement.inline);
line.setAttribute('data-mic-refusal','1');
const why=el('button',null,'WHY');
why.setAttribute('data-action','mic-why');
why.addEventListener('click',function(){
ctx.guidance(placement.popup());
});
mic.appendChild(line);
mic.appendChild(why);
}
mic.appendChild(row);
}
function placementOf(ctx,values){
const state=ctx.state;
const sounding=state.soundingPreset;
const held=ctx.session!==null?ctx.session.held:null;
const irValue=values===null?0:values[IR];
const soundingIr=ctx.session===null||ctx.session.presets===null?0:ctx.session.presets[sounding][IR];
if(!state.connected){
return{slider:false,inline:'no pedal connected',popup:UI.guidanceTable.PEDAL_NOT_CONNECTED};
}
if(state.activePreset!==sounding){
const imported=soundingIr===USER_SLOT_VALUE&&held!==null;
return{
slider:imported&&state.cabinetRead,
percent:held===null?0:held.distance,
inline:'the pedal sounds '+slotName(sounding),
popup:function(){
return UI.guidanceTable.MIC_DIST_OTHER_BANK({sounding:sounding,edited:state.activePreset});
},
};
}
if(soundingIr===0){
return{
slider:false,
inline:'bank '+slotName(sounding)+' has IR off',
popup:function(){
return UI.guidanceTable.MIC_DIST_IR_OFF({sounding:sounding});
},
};
}
if(soundingIr>=1&&soundingIr<=7){
return{
slider:false,
inline:'bank '+slotName(sounding)+' plays factory cabinet '+soundingIr,
popup:function(){
return UI.guidanceTable.MIC_DIST_FACTORY_CABINET({sounding:sounding,irValue:soundingIr});
},
};
}
if(!state.cabinetRead){
return{
slider:false,
inline:'cabinet not read',
popup:function(){
return UI.guidanceTable.CABINET_UNREAD();
},
};
}
if(held===null){
return{
slider:false,
inline:'no cabinet in the slot',
popup:function(){
return UI.guidanceTable.CABINET_EMPTY({sounding:sounding});
},
};
}
return{slider:true,percent:held.distance,inline:null,popup:null};
}
function openDialog(dialog){
if(typeof dialog.showModal==='function')dialog.showModal();
else dialog.setAttribute('open','');
}
function closeDialog(dialog){
if(typeof dialog.close==='function')dialog.close();
else dialog.removeAttribute('open');
}
UI.registerScreen({
id:'CHAIN',
label:'CHAIN',
mount:mountChain,
update:updateChain,
});
UI.registerScreen({
id:'EDIT',
label:'EDIT',
mount:mountEditor,
update:updateEditor,
});
global.RigShadeChainUI={
STAGES,
BLOCKS,
OUTPUT,
valueText,
nextValue,
wakeTargets,
blockEmpty,
};
})(typeof globalThis!=='undefined'?globalThis:this);