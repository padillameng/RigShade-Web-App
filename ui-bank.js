(function(global){
'use strict';
const P=global.RigShadeProtocol;
const UI=global.RigShadeUI;
if(!P)throw new Error('ui-bank.js needs protocol.js');
if(!UI)throw new Error('ui-bank.js needs app.js');
function t(text,vars){
const layer=global.RigShadeI18n;
if(layer&&typeof layer.t==='function')return layer.t(text,vars);
if(!vars)return text;
return String(text).replace(/\{(\w+)\}/g,function(match,name){
return Object.prototype.hasOwnProperty.call(vars,name)?String(vars[name]):match;
});
}
const IR=9;
const USER_IR_INDEX=8;
const USER_SLOT_VALUE=P.CabinetNames.length-1;
const tone3000Module=function(){
return global.RigShadeTone3000||null;
};
const param=function(code){
return P.Params.byCode(code);
};
function el(tag,className,text){
const element=document.createElement(tag);
if(className)element.className=className;
if(text!==undefined)element.textContent=text;
return element;
}
const slotName=UI.slotName;
function ascii(text){
return String(text===null||text===undefined?'':text);
}
function dateText(milliseconds){
try{
return new Date(milliseconds).toLocaleDateString();
}catch(error){
return String(milliseconds);
}
}
function valueText(code,value,irFileName){
const p=param(code);
if(P.Params.isOff(p,value))return'OFF';
if(code===IR&&value===USER_SLOT_VALUE){
return irFileName&&ascii(irFileName).trim()?ascii(irFileName):t('IR 8 · user');
}
return P.describe(code,value);
}
function presetSummary(values,irFileName){
if(values===null||values===undefined)return'—';
return[
P.describe(0,values[0]),
'GAIN '+values[1],
'VOLUME '+values[5],
valueText(IR,values[9],irFileName),
].join(' · ');
}
function entryNote(entry){
const parts=[t('from {slot}',{slot:slotName(entry.slot)}),dateText(entry.createdAt)];
if(entry.ir.length>0)parts.push(t('cabinet {name}',{name:ascii(entry.irName).trim()||t('carried')}));
else if(entry.usesIr)parts.push(t('cabinet 8 · no sector'));
return parts.join(' · ');
}
function many(count){
return count===1
?t('{count} configuration',{count:count})
:t('{count} configurations',{count:count});
}
let injectedStore=null;
let storeMemo=null;
function setStore(store){
injectedStore=store===undefined?null:store;
storeMemo=null;
}
function bankStore(){
if(injectedStore!==null)return{store:injectedStore,error:null};
if(storeMemo!==null)return storeMemo;
try{
storeMemo={store:global.RigShadeBank.createStore(),error:null};
}catch(error){
storeMemo={store:null,error:error&&error.message?error.message:String(error)};
}
return storeMemo;
}
function entries(){
const found=bankStore();
if(found.store===null)return[];
try{
return found.store.list();
}catch(error){
return[];
}
}
function deliverFile(name,text,kind){
const blob=new Blob([text],{type:kind||'application/json'});
const url=URL.createObjectURL(blob);
const link=document.createElement('a');
link.href=url;
link.download=name;
document.body.appendChild(link);
link.click();
link.remove();
global.setTimeout(function(){
URL.revokeObjectURL(url);
},1000);
}
function documentText(list){
return global.RigShadeBank.encodeDocument(list);
}
function entryFileName(entry){
return global.RigShadeBank.BackupFileNames.forEntry(entry.name);
}
function cabinetFileName(entry){
return entryFileName(entry).replace(/\.json$/,'')+'.bin';
}
function gateFile(buffer,distance){
const cabinet=global.RigShadeCabinet;
if(!cabinet)return{ok:false,reason:t('cabinet.js is not loaded, so no file can be judged')};
try{
const decoded=cabinet.decodeWav(buffer);
const samples=cabinet.toIrRate(decoded);
const problem=cabinet.samplesProblem(samples);
if(problem!==null)return{ok:false,reason:cabinet.refusalMessage(problem)};
const percent=
distance===undefined||distance===null?cabinet.distanceRange.default:cabinet.clampPercent(distance);
const sector=cabinet.buildSector({samples:samples,distance:percent});
const live=cabinet.buildLiveBlock({samples:samples,distance:percent});
const payload=cabinet.payloadProblem(sector,live);
if(payload!==null)return{ok:false,reason:cabinet.refusalMessage(payload)};
return{
ok:true,
sector:sector,
live:live,
samples:samples,
distance:percent,
sampleRate:decoded.sampleRate,
sourceRate:decoded.sampleRate,
bytes:sector.length,
};
}catch(error){
return{
ok:false,
reason:t('Import refused, nothing was sent to the pedal: {reason}',{
reason:error&&error.message?error.message:String(error),
}),
};
}
}
function uploadBody(gate){
return t(
'The pedal has one writable cabinet slot, shared by A, B and C, and writing it erases what is '+
'there first. This file writes {bytes} bytes: {samples} samples at the pedal\'s 48 kHz, with '+
'MIC DIST {distance}%. The page reads the slot and keeps it before the erase, so RESTORE puts '+
'the cabinet that is there now back.',
{bytes:gate.bytes,samples:gate.samples.length,distance:gate.distance}
);
}
let painted={key:null};
let mountedRoot=null;
let mountedCtx=null;
function mount(root,ctx){
const section=el('section','bank-screen');
section.setAttribute('data-bank-screen','1');
const head=el('div','panel-head');
const headTitle=el('h3',null,t('BANK'));
headTitle.setAttribute('data-bank-title','1');
head.appendChild(headTitle);
const where=el('span','state',t('kept in this browser · nothing leaves this machine'));
where.setAttribute('data-bank-where','1');
head.appendChild(where);
section.appendChild(head);
const notice=el('p','notice');
notice.setAttribute('data-bank-notice','1');
section.appendChild(notice);
const actions=el('div','row');
actions.setAttribute('data-bank-actions','1');
const save=el('button','primary',t('SAVE'));
save.setAttribute('data-action','bank-save');
save.addEventListener('click',function(){
openName(ctx,section);
});
const exportAll=el('button',null,t('EXPORT ALL'));
exportAll.setAttribute('data-action','bank-export-all');
exportAll.addEventListener('click',function(){
exportWholeBank(ctx);
});
const importButton=el('button',null,t('IMPORT'));
importButton.setAttribute('data-action','bank-import');
const importFile=el('input');
importFile.type='file';
importFile.accept='.json,application/json';
importFile.setAttribute('data-role','bank-import-file');
importFile.hidden=true;
importFile.addEventListener('change',function(){
const file=importFile.files&&importFile.files[0];
importFile.value='';
if(file)importDocument(ctx,section,file);
});
importButton.addEventListener('click',function(){
importFile.click();
});
actions.appendChild(save);
actions.appendChild(exportAll);
actions.appendChild(importButton);
actions.appendChild(importFile);
section.appendChild(actions);
const presets=el('div','row');
presets.setAttribute('data-bank-presets','1');
presets.style.alignItems='stretch';
section.appendChild(presets);
const report=el('p','notice');
report.setAttribute('data-bank-report','1');
section.appendChild(report);
const list=el('div');
list.setAttribute('data-bank-list','1');
list.style.display='grid';
list.style.gap='8px';
section.appendChild(list);
section.appendChild(buildCabinetPanel(ctx,section));
section.appendChild(buildNameDialog(ctx,section));
section.appendChild(buildLoadDialog(ctx,section));
section.appendChild(buildUploadDialog(ctx,section));
root.appendChild(section);
mountedRoot=root;
mountedCtx=ctx;
painted={key:null};
update(root,ctx);
}
function paintPresets(presets,ctx,section){
presets.textContent='';
const values=ctx.session!==null?ctx.session.presets:null;
const sounding=ctx.state.soundingPreset;
const confirmed=ctx.state.soundingConfirmed;
for(let index=0;index<P.MemoryMap.PRESET_COUNT;index++){
const card=el('div','block');
card.setAttribute('data-bank-preset',slotName(index));
card.style.flex='1 1 200px';
card.style.minWidth='180px';
const line=el('div','block-head');
line.appendChild(el('span','block-title',slotName(index)));
const note=el('span','block-note');
note.setAttribute('data-preset-note',slotName(index));
note.textContent=
confirmed&&index===sounding
?t('the pedal plays this')
:!confirmed&&index===sounding
?t('declared? press the badge')
:index===ctx.state.activePreset
?t('editing')
:'';
line.appendChild(note);
card.appendChild(line);
card.appendChild(
el('span','notice',presetSummary(values===null?null:values[index],ctx.state.irFileName))
);
const foot=el('div','row');
const identify=el('button',null,index===ctx.state.activePreset?t('EDITING'):t('EDIT {slot}',{slot:slotName(index)}));
identify.setAttribute('data-preset-pick',slotName(index));
identify.addEventListener('click',function(){
ctx.setState({activePreset:index});
});
foot.appendChild(identify);
const load=el('button',null,t('LOAD INTO'));
load.setAttribute('data-preset-load',slotName(index));
load.addEventListener('click',function(){
openLoad(ctx,section,null,index);
});
foot.appendChild(load);
card.appendChild(foot);
presets.appendChild(card);
}
}
function paintList(list,ctx){
const found=bankStore();
list.textContent='';
if(found.store===null){
list.appendChild(
el('p','notice error',t('This browser will not keep a bank for this page: {reason}. Nothing was lost — nothing was stored.',{reason:found.error}))
);
return;
}
const items=entries();
if(items.length===0){
list.appendChild(
el('p','notice',t('Nothing saved yet. SAVE keeps the configuration the pedal is holding now.'))
);
return;
}
for(const entry of items){
const row=el('div','block');
row.setAttribute('data-entry',entry.id);
const head=el('div','block-head');
head.appendChild(el('span','block-title',ascii(entry.name).trim()||t('(unnamed)')));
const note=el('span','block-note');
note.setAttribute('data-entry-note',entry.id);
note.textContent=entryNote(entry);
head.appendChild(note);
row.appendChild(head);
const buttons=el('div','row');
const load=el('button',null,t('LOAD'));
load.setAttribute('data-entry-load',entry.id);
load.addEventListener('click',function(){
openLoad(ctx,list.closest('[data-bank-screen]'),entry,null);
});
buttons.appendChild(load);
const exportOne=el('button',null,t('EXPORT'));
exportOne.setAttribute('data-entry-export',entry.id);
exportOne.addEventListener('click',function(){
exportEntry(ctx,entry);
});
buttons.appendChild(exportOne);
const cabinet=el('button',null,t('CABINET'));
cabinet.setAttribute('data-entry-cabinet',entry.id);
cabinet.title=t('download the 4096-byte cabinet this configuration carries');
cabinet.disabled=entry.ir.length===0;
cabinet.addEventListener('click',function(){
exportCabinet(ctx,entry);
});
buttons.appendChild(cabinet);
const remove=el('button','danger',t('DELETE'));
remove.setAttribute('data-entry-delete',entry.id);
remove.addEventListener('click',function(){
deleteEntry(ctx,entry,row);
});
buttons.appendChild(remove);
row.appendChild(buttons);
list.appendChild(row);
}
}
function buildCabinetPanel(ctx,section){
const panel=el('section','block');
panel.setAttribute('data-cabinet-panel','1');
const head=el('div','block-head');
const panelTitle=el('span','block-title',t('CABINET'));
panelTitle.setAttribute('data-cabinet-title','1');
head.appendChild(panelTitle);
const where=el('span','block-note',t('slot 8 · 0x00070000 · the only writable one'));
where.setAttribute('data-cabinet-note','1');
head.appendChild(where);
panel.appendChild(head);
const line=el('p','notice');
line.setAttribute('data-cabinet-line','1');
line.textContent=t('the cabinet slot has not been read');
panel.appendChild(line);
const controls=el('div','row');
const read=el('button',null,t('READ CABINET'));
read.setAttribute('data-action','cabinet-read');
read.title=t('37 chunks of 113 bytes, 40 ms apart — the read the pedal was measured to tolerate');
read.addEventListener('click',function(){
readCabinet(ctx);
});
controls.appendChild(read);
const upload=el('button',null,t('IMPORT WAV'));
upload.setAttribute('data-action','cabinet-upload');
const file=el('input');
file.type='file';
file.accept='.wav,audio/wav,audio/x-wav';
file.setAttribute('data-role','cabinet-file');
file.hidden=true;
file.addEventListener('change',function(){
const chosen=file.files&&file.files[0];
file.value='';
if(chosen)chooseCabinetFile(ctx,section,chosen);
});
upload.addEventListener('click',function(){
file.click();
});
controls.appendChild(upload);
controls.appendChild(file);
const catalogue=el('button','chip',t('Get a cabinet from Tone3000'));
catalogue.setAttribute('data-action','cabinet-tone3000');
catalogue.addEventListener('click',function(){
startTone3000(ctx,section);
});
controls.appendChild(catalogue);
const restore=el('button',null,t('RESTORE'));
restore.setAttribute('data-action','cabinet-restore');
restore.hidden=true;
restore.title=t('puts back the sector that was read before the last cabinet write');
restore.addEventListener('click',function(){
openUpload(ctx,section,{mode:'restore'});
});
controls.appendChild(restore);
panel.appendChild(controls);
const source=el('p','notice');
source.setAttribute('data-cabinet-source','1');
source.textContent=t(
'Tone3000: this box opens their catalogue; you sign in to a free Tone3000 account, pick a cabinet and come back to this page, which downloads it. The pedal\'s slot keeps a short cabinet, and the page says how much it will trim before anything is written.'
);
panel.appendChild(source);
const fetched=el('p','notice');
fetched.setAttribute('data-cabinet-fetched','1');
fetched.hidden=true;
panel.appendChild(fetched);
const pickBlock=el('div');
pickBlock.setAttribute('data-cabinet-picker-block','1');
pickBlock.hidden=true;
const pickNote=el('p','notice');
pickNote.setAttribute('data-cabinet-picker-note','1');
pickBlock.appendChild(pickNote);
const pickList=el('div','row');
pickList.setAttribute('data-cabinet-picker','1');
pickBlock.appendChild(pickList);
panel.appendChild(pickBlock);
const refusal=el('p','notice error');
refusal.setAttribute('data-cabinet-refusal','1');
refusal.hidden=true;
panel.appendChild(refusal);
const spread=el('p','notice');
spread.setAttribute('data-cabinet-held','1');
panel.appendChild(spread);
return panel;
}
async function readCabinet(ctx){
if(ctx.session===null)return;
const result=await ctx.perform(t('reading the cabinet'),function(){
return ctx.session.readCabinet();
});
if(result.ok){
ctx.setState({cabinetRead:true});
ctx.status(t('read the pedal\'s cabinet slot: {line}',{line:result.value.description}),result.value.present?'ok':'');
}
}
async function chooseCabinetFile(ctx,section,file){
const buffer=await file.arrayBuffer();
const held=ctx.session!==null?ctx.session.held:null;
const gate=gateFile(buffer,held===null?undefined:held.distance);
pending={mode:'upload',file:file,buffer:buffer,gate:gate};
if(!gate.ok){
showRefusal(ctx,section,gate.reason);
return;
}
showRefusal(ctx,section,null);
openUpload(ctx,section,{mode:'upload'});
}
function showRefusal(ctx,section,text){
const line=section.querySelector('[data-cabinet-refusal]');
line.textContent=text===null||text===undefined?'':text;
line.hidden=text===null||text===undefined;
if(text)ctx.log('failed',text);
}
let tone3000=null;
let tone3000Refusal=null;
async function startTone3000(ctx,section){
const module=tone3000Module();
if(module===null){
showRefusal(ctx,section,t('tone3000.js is not loaded, so the catalogue cannot be opened'));
return;
}
tone3000=null;
showRefusal(ctx,section,null);
const started=await module.begin();
if(!started.ok)showRefusal(ctx,section,started.message);
if(mountedRoot!==null&&mountedCtx!==null)update(mountedRoot,mountedCtx);
}
function paintTone3000(section,ctx){
paintTone3000Choices(section,ctx);
const line=section.querySelector('[data-cabinet-fetched]');
if(line===null)return;
if(tone3000===null||tone3000 .phase==='choose'){
line.hidden=true;
line.textContent='';
return;
}
if(tone3000 .phase==='fetching'){
line.hidden=false;
line.textContent=t('Tone3000: fetching the cabinet you chose…');
return;
}
if(tone3000 .phase==='opening'){
line.hidden=false;
line.textContent=t('Tone3000: opening the cabinet you chose…');
return;
}
if(ctx.session!==null){
line.hidden=true;
line.textContent='';
return;
}
line.hidden=false;
line.textContent=t(
'Tone3000 sent "{name}" ({bytes} bytes). Nothing has been sent to the pedal: connect it, and this box asks before writing.',
{name:tone3000 .name,bytes:tone3000 .buffer?tone3000 .buffer.byteLength:0}
);
}
let paintedChoices='';
function paintTone3000Choices(section,ctx){
const block=section.querySelector('[data-cabinet-picker-block]');
const note=section.querySelector('[data-cabinet-picker-note]');
const list=section.querySelector('[data-cabinet-picker]');
if(block===null||note===null||list===null)return;
if(tone3000===null||tone3000 .phase!=='choose'){
if(!block.hidden||paintedChoices!==''){
block.hidden=true;
list.textContent='';
paintedChoices='';
}
return;
}
block.hidden=false;
note.textContent=t('The package holds {count} cabinets. Choose the one to send to the pedal:',{
count:tone3000 .choices.length,
});
const key=tone3000 .choices
.map(function(choice){
return choice.name;
})
.join('|');
if(key===paintedChoices)return;
paintedChoices=key;
list.textContent='';
for(let index=0;index<tone3000 .choices.length;index+=1){
const button=el('button','chip',tone3000 .choices[index].name);
button.setAttribute('data-cabinet-choice',String(index));
button.addEventListener('click',function(){
pickTone3000Choice(ctx,section,index);
});
list.appendChild(button);
}
}
async function pickTone3000Choice(ctx,section,index){
const held=tone3000;
if(held===null||held.phase!=='choose')return;
tone3000={phase:'opening'};
if(mountedRoot!==null&&mountedCtx!==null)update(mountedRoot,mountedCtx);
let taken;
try{
taken=await held.read(index);
}catch(error){
taken={ok:false,message:error&&error.message?error.message:String(error)};
}
if(!taken||!taken.ok){
tone3000=null;
showRefusal(ctx,section,taken&&taken.message?taken.message:t(
'the package could not be opened, so no cabinet was offered. Nothing was sent to the pedal.'
));
if(mountedRoot!==null&&mountedCtx!==null)update(mountedRoot,mountedCtx);
return;
}
tone3000={phase:'ready',name:taken.name,buffer:taken.buffer};
if(mountedRoot!==null&&mountedCtx!==null)update(mountedRoot,mountedCtx);
}
function deliverTone3000(section,ctx){
if(tone3000===null||tone3000 .phase!=='ready')return;
if(ctx.session===null)return;
const held=tone3000;
tone3000=null;
chooseCabinetFile(ctx,section,{
name:held.name,
arrayBuffer:function(){
return Promise.resolve(held.buffer);
},
}).catch(function(error){
showRefusal(ctx,section,error&&error.message?error.message:String(error));
});
}
function openDialog(dialog){
if(typeof dialog.showModal==='function')dialog.showModal();
else dialog.setAttribute('open','');
}
function closeDialog(dialog){
if(typeof dialog.close==='function')dialog.close();
else dialog.removeAttribute('open');
}
function buildNameDialog(ctx,section){
const dialog=el('dialog');
dialog.setAttribute('data-dialog','bank-name');
const title=el('h3');
title.setAttribute('data-name-title','1');
dialog.appendChild(title);
const nameNote=el('p',null,t('The name is what you will read in this list. The configuration stays on this machine.'));
nameNote.setAttribute('data-name-note','1');
dialog.appendChild(nameNote);
const field=el('input');
field.type='text';
field.setAttribute('data-name-field','1');
field.maxLength=60;
dialog.appendChild(field);
const row=el('div','row');
const cancel=el('button',null,t('CANCEL'));
cancel.setAttribute('data-action','name-cancel');
cancel.addEventListener('click',function(){
closeDialog(dialog);
});
const confirm=el('button','primary',t('SAVE'));
confirm.setAttribute('data-action','name-confirm');
confirm.addEventListener('click',async function(){
const name=field.value;
closeDialog(dialog);
await saveToBank(ctx,section,name);
});
row.appendChild(cancel);
row.appendChild(confirm);
dialog.appendChild(row);
return dialog;
}
function openName(ctx,section){
const dialog=section.querySelector('[data-dialog="bank-name"]');
dialog.querySelector('[data-name-title]').textContent=t('Save preset {slot}',{slot:slotName(ctx.state.activePreset)});
const field=dialog.querySelector('[data-name-field]');
field.value='';
openDialog(dialog);
field.focus();
}
function buildLoadDialog(ctx,section){
const dialog=el('dialog');
dialog.setAttribute('data-dialog','bank-load');
const loadTitle=el('h3',null,t('Load into'));
loadTitle.setAttribute('data-load-title','1');
dialog.appendChild(loadTitle);
const body=el('p');
body.setAttribute('data-load-body','1');
dialog.appendChild(body);
const row=el('div','row');
row.setAttribute('data-load-buttons','1');
for(let index=0;index<P.MemoryMap.PRESET_COUNT;index++){
const chip=el('button',null,slotName(index));
chip.setAttribute('data-load-slot',slotName(index));
chip.addEventListener('click',async function(){
closeDialog(dialog);
if(loadedEntry!==null)await loadEntry(ctx,loadedEntry,index);
});
row.appendChild(chip);
}
dialog.appendChild(row);
const foot=el('div','row');
const cancel=el('button',null,t('CANCEL'));
cancel.setAttribute('data-action','load-cancel');
cancel.addEventListener('click',function(){
closeDialog(dialog);
});
foot.appendChild(cancel);
dialog.appendChild(foot);
return dialog;
}
let loadedEntry=null;
function openLoad(ctx,section,entry,slot){
const dialog=section.querySelector('[data-dialog="bank-load"]');
loadedEntry=entry;
dialog.querySelector('[data-load-body]').textContent=
entry===null
?t('Choose a configuration from the list above, then load it into {slot}.',{slot:slotName(slot)})
:t('"{name}" is applied to the preset you choose. A load writes live memory only: SAVE is what makes it survive a power cycle.',{
name:ascii(entry.name).trim()||t('(unnamed)'),
});
openDialog(dialog);
}
function buildUploadDialog(ctx,section){
const dialog=el('dialog');
dialog.setAttribute('data-dialog','cabinet-upload');
const title=el('h3');
title.setAttribute('data-upload-title','1');
dialog.appendChild(title);
const body=el('p');
body.setAttribute('data-upload-body','1');
dialog.appendChild(body);
const row=el('div','row');
const cancel=el('button',null,t('CANCEL'));
cancel.setAttribute('data-action','upload-cancel');
cancel.addEventListener('click',function(){
closeDialog(dialog);
});
const confirm=el('button','primary',t('WRITE'));
confirm.setAttribute('data-action','upload-confirm');
confirm.addEventListener('click',async function(){
closeDialog(dialog);
await commitCabinet(ctx,section);
});
row.appendChild(cancel);
row.appendChild(confirm);
dialog.appendChild(row);
return dialog;
}
let pending=null;
function openUpload(ctx,section,options){
const dialog=section.querySelector('[data-dialog="cabinet-upload"]');
const title=dialog.querySelector('[data-upload-title]');
const body=dialog.querySelector('[data-upload-body]');
const confirm=dialog.querySelector('[data-action="upload-confirm"]');
if(options.mode==='restore'){
const backup=ctx.session!==null?ctx.session.slotBackup:null;
if(backup===null)return;
pending={mode:'restore',sector:backup};
title.textContent=t('Put the previous cabinet back?');
body.textContent=t(
'The page kept the {bytes} bytes that were in the slot before the last cabinet write. Writing them is the same erase-then-write, and the result is read back and compared.',
{bytes:backup.length}
);
confirm.textContent=t('RESTORE');
}else{
const gate=pending!==null&&pending.gate!==undefined?pending.gate:null;
if(gate===null||!gate.ok)return;
title.textContent=t('Write this cabinet?');
body.textContent=uploadBody(gate);
confirm.textContent=t('WRITE');
}
openDialog(dialog);
}
async function commitCabinet(ctx,section){
if(ctx.session===null||pending===null)return;
if(pending.mode==='restore'){
const sector=pending.sector;
pending=null;
const result=await ctx.perform(t('restoring the cabinet'),function(){
return ctx.session.restoreCabinet(sector);
});
if(result.ok){
ctx.setState({cabinetRead:true});
ctx.status(t('restored: {line}',{line:result.value.description}),'ok');
}
return;
}
const buffer=pending.buffer;
const name=pending.file!==null&&pending.file!==undefined?pending.file.name:'';
const distance=pending.gate.distance;
pending=null;
const result=await ctx.perform(t('importing the cabinet'),function(){
return ctx.session.uploadCabinet(buffer,{distance:distance});
});
if(result.ok){
ctx.setState({cabinetRead:true,irFileName:name||ctx.state.irFileName});
ctx.status(t('wrote the cabinet and read it back: {line}',{line:result.value.description}),'ok');
showRefusal(ctx,section,null);
}
}
async function saveToBank(ctx,section,typedName){
const found=bankStore();
if(found.store===null){
ctx.status(t('the bank cannot be stored in this browser: {reason}',{reason:found.error}),'error');
return;
}
const values=ctx.session!==null?ctx.session.presets:null;
if(values===null){
ctx.status(t('read the presets first: SAVE stores the sixteen bytes the pedal answered'),'error');
return;
}
const slot=ctx.state.activePreset;
const settings=values[slot];
const usesUser=P.Params.clamp(param(IR),settings[IR])===USER_SLOT_VALUE;
const held=ctx.session!==null?ctx.session.held:null;
let ir=new Uint8Array(0);
if(usesUser){
if(held===null||held.sector===null){
ctx.status(
t('preset {slot} selects cabinet 8 (your slot) and the page has not read it: press READ CABINET, then SAVE. Nothing was stored',{
slot:slotName(slot),
}),
'error'
);
return;
}
ir=held.sector;
}
let entry;
try{
entry=global.RigShadeBank.createEntry({
name:ascii(typedName).trim()||t('Configuration'),
slot:slot,
createdAt:Date.now(),
settings:settings.slice(),
irIndex:usesUser?USER_IR_INDEX:0,
ir:ir,
irName:usesUser?ascii(ctx.state.irFileName):'',
});
found.store.add(entry);
}catch(error){
ctx.status(t('the configuration was not stored: {reason}',{reason:error&&error.message?error.message:String(error)}),'error');
return;
}
ctx.status(
usesUser
?t('stored "{name}" from {slot}, with the cabinet the page read from the slot — the pedal was not written',{
name:entry.name,
slot:slotName(slot),
})
:t('stored "{name}" from {slot}, settings only — the pedal was not written',{
name:entry.name,
slot:slotName(slot),
}),
'ok'
);
painted={key:null};
ctx.setState({});
}
async function loadEntry(ctx,entry,slot){
if(ctx.session===null)return;
if(!ctx.ready()){
ctx.status(t('no pedal connected: a load writes thirteen live values and cannot be done offline'),'error');
return;
}
const state=ctx.state;
if(!state.soundingConfirmed){
ctx.status(
t('Tap the bank badge and say which bank the pedal is playing, then load: nothing was sent'),
'error'
);
return;
}
if(slot!==state.soundingPreset){
ctx.status(
t('the pedal plays {playing}, so a load into {target} would send thirteen live values it never plays. Tap the badge to declare {target}, or load into {playing}. Nothing was sent',{
playing:slotName(state.soundingPreset),
target:slotName(slot),
}),
'error'
);
return;
}
const result=await ctx.perform(t('loading "{name}"',{name:ascii(entry.name).trim()||t('(unnamed)')}),function(){
return ctx.session.applyEntry(entry,slot);
});
if(result.ok){
ctx.status(
t('{line} The live window cannot be read back, so the cabinet half is what was verified.',{
line:result.value.line,
}),
'ok'
);
ctx.setState({});
}
}
function exportWholeBank(ctx){
const items=entries();
if(items.length===0){
ctx.status(t('the bank is empty: there is nothing to export'),'error');
return;
}
let text;
try{
text=documentText(items);
}catch(error){
ctx.status(t('the bank could not be written: {reason}',{reason:error.message}),'error');
return;
}
global.RigShadeBankUI.deliverFile(global.RigShadeBank.BackupFileNames.FULL_BANK,text);
ctx.log('link','exported '+items.length+' configuration(s) as '+global.RigShadeBank.BackupFileNames.FULL_BANK);
ctx.status(
t('exported {count} as {file}',{count:many(items.length),file:global.RigShadeBank.BackupFileNames.FULL_BANK}),
'ok'
);
}
function exportEntry(ctx,entry){
let text;
try{
text=documentText([entry]);
}catch(error){
ctx.status(t('"{name}" could not be written: {reason}',{name:ascii(entry.name),reason:error.message}),'error');
return;
}
const name=entryFileName(entry);
global.RigShadeBankUI.deliverFile(name,text);
ctx.status(t('exported "{name}" as {file}',{name:ascii(entry.name).trim()||t('(unnamed)'),file:name}),'ok');
}
function exportCabinet(ctx,entry){
if(entry.ir.length===0){
ctx.status(t('"{name}" carries no cabinet',{name:ascii(entry.name).trim()||t('(unnamed)')}),'error');
return;
}
const name=cabinetFileName(entry);
global.RigShadeBankUI.deliverFile(name,entry.ir,'application/octet-stream');
ctx.status(
t('exported the cabinet of "{name}" as {file}',{name:ascii(entry.name).trim()||t('(unnamed)'),file:name}),
'ok'
);
}
function deleteEntry(ctx,entry,row){
const found=bankStore();
if(found.store===null)return;
try{
found.store.remove(entry.id);
}catch(error){
ctx.status(t('the entry was not deleted: {reason}',{reason:error.message}),'error');
return;
}
row.remove();
painted={key:null};
ctx.status(t('deleted "{name}" from this browser\'s bank',{name:ascii(entry.name).trim()||t('(unnamed)')}),'ok');
ctx.setState({});
}
async function importDocument(ctx,section,file){
const report=section.querySelector('[data-bank-report]');
const found=bankStore();
let text;
try{
text=await file.text();
}catch(error){
if(report){
report.textContent=t('the file could not be read: {reason}. Nothing was imported',{reason:error.message});
}
return;
}
let parsed;
try{
parsed=global.RigShadeBank.parseDocument(text);
}catch(error){
if(report){
report.textContent=t('the file was refused and nothing was imported: {reason}',{reason:error.message});
report.className='notice error';
}
ctx.log('failed','import refused: '+error.message);
return;
}
if(found.store===null){
if(report){
report.textContent=t('the file was read but this browser will not keep a bank: {reason}',{reason:found.error});
report.className='notice error';
}
return;
}
const stored=[];
for(const entry of parsed.accepted){
try{
found.store.add(entry);
stored.push(entry.name);
}catch(error){
parsed.rejected.push({index:parsed.accepted.indexOf(entry),name:entry.name,reason:error.message});
}
}
const shown=parsed.rejected
.slice(0,3)
.map(function(item){
return'#'+item.index+' '+(item.name===''?t('(unnamed)'):'"'+item.name+'"')+': '+item.reason;
})
.join('; ');
const extra=parsed.rejected.length>3
?t('and {count} more',{count:parsed.rejected.length-3})
:'';
const rejected=extra?shown+'; '+extra:shown;
const line=
parsed.rejected.length===0
?t('{stored} of {total} stored, nothing rejected',{stored:stored.length,total:parsed.accepted.length})
:t('{stored} of {total} stored; rejected: {rejected}',{
stored:stored.length,
total:parsed.accepted.length,
rejected:rejected,
});
if(report){
report.textContent=line;
report.className='notice'+(parsed.rejected.length===0?' ok':' error');
}
ctx.status(t('import: {line}',{line:line}),parsed.rejected.length===0?'ok':'error');
painted={key:null};
ctx.setState({});
}
function update(root,ctx){
const section=root.querySelector('[data-bank-screen]');
if(section===null)return;
paintBankText(section);
const found=bankStore();
const values=ctx.session!==null?ctx.session.presets:null;
const locked=!ctx.ready()||ctx.state.busy;
const notice=section.querySelector('[data-bank-notice]');
notice.textContent=
found.store===null
?t('This browser will not keep a bank for this page: {reason}. Imports and exports still work.',{reason:found.error})
:t('Stored in this browser\'s localStorage · nothing leaves this machine. {tail}',{
tail:values===null?t('Read the pedal to save a configuration.'):'',
});
const save=section.querySelector('[data-action="bank-save"]');
save.textContent=t('SAVE {slot}',{slot:slotName(ctx.state.activePreset)});
save.disabled=locked||ctx.session===null||values===null;
const exportAll=section.querySelector('[data-action="bank-export-all"]');
exportAll.disabled=found.store===null||entries().length===0;
section.querySelector('[data-action="bank-import"]').disabled=found.store===null;
paintPresets(section.querySelector('[data-bank-presets]'),ctx,section);
const key=found.store===null?'none':entries().map(function(entry){
return entry.id+'|'+entry.name+'|'+entry.createdAt+'|'+entry.ir.length;
}).join(',');
if(painted.key!==key){
painted={key:key};
paintList(section.querySelector('[data-bank-list]'),ctx);
}
const held=ctx.session!==null?ctx.session.held:null;
const line=section.querySelector('[data-cabinet-line]');
const describe=section.querySelector('[data-cabinet-held]');
if(held===null){
line.textContent=ctx.state.cabinetRead
?t('the slot answered, and holds no cabinet the page can send back')
:t('the cabinet slot has not been read');
describe.textContent='';
}else{
line.textContent=held.description||t('the slot holds a cabinet');
describe.textContent=t('the page holds this cabinet ({origin}), MIC DIST {distance}%{silence}',{
origin:held.origin==='WRITTEN_TO_PEDAL'?t('written and read back'):t('read from the slot'),
distance:held.distance,
silence:held.distance>=100?' '+t('— 100% silences the cabinet'):'',
});
}
section.querySelector('[data-action="cabinet-read"]').disabled=locked||ctx.session===null;
section.querySelector('[data-action="cabinet-upload"]').disabled=locked||ctx.session===null;
const restore=section.querySelector('[data-action="cabinet-restore"]');
const backup=ctx.session!==null?ctx.session.slotBackup:null;
restore.hidden=backup===null;
restore.disabled=locked||backup===null;
if(tone3000Refusal!==null){
const text=tone3000Refusal;
tone3000Refusal=null;
showRefusal(ctx,section,text);
}
paintTone3000(section,ctx);
deliverTone3000(section,ctx);
}
function paintBankText(section){
const set=function(selector,text){
const node=section.querySelector(selector);
if(node!==null)node.textContent=text;
return node;
};
set('[data-bank-title]',t('BANK'));
set('[data-bank-where]',t('kept in this browser · nothing leaves this machine'));
set('[data-action="bank-export-all"]',t('EXPORT ALL'));
set('[data-action="bank-import"]',t('IMPORT'));
set('[data-cabinet-title]',t('CABINET'));
set('[data-cabinet-note]',t('slot 8 · 0x00070000 · the only writable one'));
set('[data-action="cabinet-upload"]',t('IMPORT WAV'));
set('[data-action="cabinet-tone3000"]',t('Get a cabinet from Tone3000'));
set('[data-cabinet-source]',t(
'Tone3000: this box opens their catalogue; you sign in to a free Tone3000 account, pick a cabinet and come back to this page, which downloads it. The pedal\'s slot keeps a short cabinet, and the page says how much it will trim before anything is written.'
));
set('[data-name-note]',t('The name is what you will read in this list. The configuration stays on this machine.'));
set('[data-action="name-cancel"]',t('CANCEL'));
set('[data-action="name-confirm"]',t('SAVE'));
set('[data-load-title]',t('Load into'));
set('[data-action="load-cancel"]',t('CANCEL'));
set('[data-action="upload-cancel"]',t('CANCEL'));
const read=set('[data-action="cabinet-read"]',t('READ CABINET'));
if(read!==null)read.title=t('37 chunks of 113 bytes, 40 ms apart — the read the pedal was measured to tolerate');
const restore=set('[data-action="cabinet-restore"]',t('RESTORE'));
if(restore!==null)restore.title=t('puts back the sector that was read before the last cabinet write');
}
UI.registerScreen({
id:'BANK',
label:'BANK',
mount:mount,
update:update,
unmount:function(){
pending=null;
loadedEntry=null;
mountedRoot=null;
mountedCtx=null;
},
});
document.addEventListener('rigshade:locale',function(){
painted={key:null};
if(mountedRoot!==null)update(mountedRoot,mountedCtx);
});
(function returning(){
const module=tone3000Module();
if(module===null||!module.isConfigured())return;
if(!module.isReturning(global.location?global.location.search:''))return;
const settle=function(result){
if(result.ok&&result.choices){
tone3000={phase:'choose',choices:result.choices,read:result.read};
}else if(result.ok){
tone3000={phase:'ready',name:result.name,buffer:result.buffer};
}else{
tone3000=null;
tone3000Refusal=result.message;
}
if(mountedRoot!==null&&mountedCtx!==null)update(mountedRoot,mountedCtx);
};
tone3000={phase:'fetching'};
module.complete().then(settle,function(error){
settle({ok:false,message:error&&error.message?error.message:String(error)});
});
})();
global.RigShadeBankUI={
presetSummary,
entryNote,
entryFileName,
cabinetFileName,
documentText,
gateFile,
uploadBody,
valueText,
setStore,
deliverFile,
loadEntry,
USER_IR_INDEX,
};
})(typeof globalThis!=='undefined'?globalThis:this);