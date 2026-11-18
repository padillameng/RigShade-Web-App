(function(global){
'use strict';
const P=global.RigShadeProtocol;
const UI=global.RigShadeUI;
if(!P)throw new Error('ui-bank.js needs protocol.js');
if(!UI)throw new Error('ui-bank.js needs app.js');
const IR=9;
const USER_IR_INDEX=8;
const USER_SLOT_VALUE=P.CabinetNames.length-1;
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
return irFileName&&ascii(irFileName).trim()?ascii(irFileName):'IR 8 · user';
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
const parts=['from '+slotName(entry.slot),dateText(entry.createdAt)];
if(entry.ir.length>0)parts.push('cabinet '+(ascii(entry.irName).trim()||'carried'));
else if(entry.usesIr)parts.push('cabinet 8 · no sector');
return parts.join(' · ');
}
function many(count){
return count+' '+(count===1?'configuration':'configurations');
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
if(!cabinet)return{ok:false,reason:'cabinet.js is not loaded, so no file can be judged'};
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
reason:'Import refused, nothing was sent to the pedal: '+(error&&error.message?error.message:String(error)),
};
}
}
function uploadBody(gate){
return(
'The pedal has one writable cabinet slot, shared by A, B and C, and writing it erases what is '+
'there first. This file writes '+gate.bytes+' bytes: '+gate.samples.length+
' samples at the pedal\'s 48 kHz, with MIC DIST '+gate.distance+'%. The page reads the slot '+
'and keeps it before the erase, so RESTORE puts the cabinet that is there now back.'
);
}
let painted={key:null};
function mount(root,ctx){
const section=el('section','bank-screen');
section.setAttribute('data-bank-screen','1');
const head=el('div','panel-head');
head.appendChild(el('h3',null,'BANK'));
const where=el('span','state','kept in this browser · nothing leaves this machine');
where.setAttribute('data-bank-where','1');
head.appendChild(where);
section.appendChild(head);
const notice=el('p','notice');
notice.setAttribute('data-bank-notice','1');
section.appendChild(notice);
const actions=el('div','row');
actions.setAttribute('data-bank-actions','1');
const save=el('button','primary','SAVE A');
save.setAttribute('data-action','bank-save');
save.addEventListener('click',function(){
openName(ctx,section);
});
const exportAll=el('button',null,'EXPORT ALL');
exportAll.setAttribute('data-action','bank-export-all');
exportAll.addEventListener('click',function(){
exportWholeBank(ctx);
});
const importButton=el('button',null,'IMPORT');
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
?'the pedal plays this'
:!confirmed&&index===sounding
?'declared? press the badge'
:index===ctx.state.activePreset
?'editing'
:'';
line.appendChild(note);
card.appendChild(line);
card.appendChild(
el('span','notice',presetSummary(values===null?null:values[index],ctx.state.irFileName))
);
const foot=el('div','row');
const identify=el('button',null,index===ctx.state.activePreset?'EDITING':'EDIT '+slotName(index));
identify.setAttribute('data-preset-pick',slotName(index));
identify.addEventListener('click',function(){
ctx.setState({activePreset:index});
});
foot.appendChild(identify);
const load=el('button',null,'LOAD INTO');
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
el('p','notice error','This browser will not keep a bank for this page: '+found.error+'. Nothing was lost — nothing was stored.')
);
return;
}
const items=entries();
if(items.length===0){
list.appendChild(
el('p','notice','Nothing saved yet. SAVE keeps the configuration the pedal is holding now.')
);
return;
}
for(const entry of items){
const row=el('div','block');
row.setAttribute('data-entry',entry.id);
const head=el('div','block-head');
head.appendChild(el('span','block-title',ascii(entry.name).trim()||'(unnamed)'));
const note=el('span','block-note');
note.setAttribute('data-entry-note',entry.id);
note.textContent=entryNote(entry);
head.appendChild(note);
row.appendChild(head);
const buttons=el('div','row');
const load=el('button',null,'LOAD');
load.setAttribute('data-entry-load',entry.id);
load.addEventListener('click',function(){
openLoad(ctx,list.closest('[data-bank-screen]'),entry,null);
});
buttons.appendChild(load);
const exportOne=el('button',null,'EXPORT');
exportOne.setAttribute('data-entry-export',entry.id);
exportOne.addEventListener('click',function(){
exportEntry(ctx,entry);
});
buttons.appendChild(exportOne);
const cabinet=el('button',null,'CABINET');
cabinet.setAttribute('data-entry-cabinet',entry.id);
cabinet.title='download the 4096-byte cabinet this configuration carries';
cabinet.disabled=entry.ir.length===0;
cabinet.addEventListener('click',function(){
exportCabinet(ctx,entry);
});
buttons.appendChild(cabinet);
const remove=el('button','danger','DELETE');
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
head.appendChild(el('span','block-title','CABINET'));
const where=el('span','block-note','slot 8 · 0x00070000 · the only writable one');
head.appendChild(where);
panel.appendChild(head);
const line=el('p','notice');
line.setAttribute('data-cabinet-line','1');
line.textContent='the cabinet slot has not been read';
panel.appendChild(line);
const controls=el('div','row');
const read=el('button',null,'READ CABINET');
read.setAttribute('data-action','cabinet-read');
read.title='37 chunks of 113 bytes, 40 ms apart — the read the pedal was measured to tolerate';
read.addEventListener('click',function(){
readCabinet(ctx);
});
controls.appendChild(read);
const upload=el('button',null,'IMPORT WAV');
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
const restore=el('button',null,'RESTORE');
restore.setAttribute('data-action','cabinet-restore');
restore.hidden=true;
restore.title='puts back the sector that was read before the last cabinet write';
restore.addEventListener('click',function(){
openUpload(ctx,section,{mode:'restore'});
});
controls.appendChild(restore);
panel.appendChild(controls);
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
const result=await ctx.perform('reading the cabinet',function(){
return ctx.session.readCabinet();
});
if(result.ok){
ctx.setState({cabinetRead:true});
ctx.status('read the pedal\'s cabinet slot: '+result.value.description,result.value.present?'ok':'');
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
dialog.appendChild(el('p',null,'The name is what you will read in this list. The configuration stays on this machine.'));
const field=el('input');
field.type='text';
field.setAttribute('data-name-field','1');
field.maxLength=60;
dialog.appendChild(field);
const row=el('div','row');
const cancel=el('button',null,'CANCEL');
cancel.setAttribute('data-action','name-cancel');
cancel.addEventListener('click',function(){
closeDialog(dialog);
});
const confirm=el('button','primary','SAVE');
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
dialog.querySelector('[data-name-title]').textContent='Save preset '+slotName(ctx.state.activePreset);
const field=dialog.querySelector('[data-name-field]');
field.value='';
openDialog(dialog);
field.focus();
}
function buildLoadDialog(ctx,section){
const dialog=el('dialog');
dialog.setAttribute('data-dialog','bank-load');
dialog.appendChild(el('h3',null,'Load into'));
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
const cancel=el('button',null,'CANCEL');
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
?'Choose a configuration from the list above, then load it into '+slotName(slot)+'.'
:'"'+(ascii(entry.name).trim()||'(unnamed)')+'" is applied to the preset you choose. '+
'A load writes live memory only: SAVE is what makes it survive a power cycle.';
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
const cancel=el('button',null,'CANCEL');
cancel.setAttribute('data-action','upload-cancel');
cancel.addEventListener('click',function(){
closeDialog(dialog);
});
const confirm=el('button','primary','WRITE');
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
title.textContent='Put the previous cabinet back?';
body.textContent=
'The page kept the '+backup.length+' bytes that were in the slot before the last cabinet write. '+
'Writing them is the same erase-then-write, and the result is read back and compared.';
confirm.textContent='RESTORE';
}else{
const gate=pending!==null&&pending.gate!==undefined?pending.gate:null;
if(gate===null||!gate.ok)return;
title.textContent='Write this cabinet?';
body.textContent=uploadBody(gate);
confirm.textContent='WRITE';
}
openDialog(dialog);
}
async function commitCabinet(ctx,section){
if(ctx.session===null||pending===null)return;
if(pending.mode==='restore'){
const sector=pending.sector;
pending=null;
const result=await ctx.perform('restoring the cabinet',function(){
return ctx.session.restoreCabinet(sector);
});
if(result.ok){
ctx.setState({cabinetRead:true});
ctx.status('restored: '+result.value.description,'ok');
}
return;
}
const buffer=pending.buffer;
const name=pending.file!==null&&pending.file!==undefined?pending.file.name:'';
const distance=pending.gate.distance;
pending=null;
const result=await ctx.perform('importing the cabinet',function(){
return ctx.session.uploadCabinet(buffer,{distance:distance});
});
if(result.ok){
ctx.setState({cabinetRead:true,irFileName:name||ctx.state.irFileName});
ctx.status('wrote the cabinet and read it back: '+result.value.description,'ok');
showRefusal(ctx,section,null);
}
}
async function saveToBank(ctx,section,typedName){
const found=bankStore();
if(found.store===null){
ctx.status('the bank cannot be stored in this browser: '+found.error,'error');
return;
}
const values=ctx.session!==null?ctx.session.presets:null;
if(values===null){
ctx.status('read the presets first: SAVE stores the sixteen bytes the pedal answered','error');
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
'preset '+slotName(slot)+' selects cabinet 8 (your slot) and the page has not read it: '+
'press READ CABINET, then SAVE. Nothing was stored',
'error'
);
return;
}
ir=held.sector;
}
let entry;
try{
entry=global.RigShadeBank.createEntry({
name:ascii(typedName).trim()||'Configuration',
slot:slot,
createdAt:Date.now(),
settings:settings.slice(),
irIndex:usesUser?USER_IR_INDEX:0,
ir:ir,
irName:usesUser?ascii(ctx.state.irFileName):'',
});
found.store.add(entry);
}catch(error){
ctx.status('the configuration was not stored: '+(error&&error.message?error.message:String(error)),'error');
return;
}
ctx.status(
'stored "'+entry.name+'" from '+slotName(slot)+
(usesUser?', with the cabinet the page read from the slot':', settings only')+
' — the pedal was not written',
'ok'
);
painted={key:null};
ctx.setState({});
}
async function loadEntry(ctx,entry,slot){
if(ctx.session===null)return;
if(!ctx.ready()){
ctx.status('no pedal connected: a load writes thirteen live values and cannot be done offline','error');
return;
}
const state=ctx.state;
if(!state.soundingConfirmed){
ctx.status(
'Tap the bank badge and say which bank the pedal is playing, then load: nothing was sent',
'error'
);
return;
}
if(slot!==state.soundingPreset){
ctx.status(
'the pedal plays '+slotName(state.soundingPreset)+', so a load into '+slotName(slot)+
' would send thirteen live values it never plays. Tap the badge to declare '+
slotName(slot)+', or load into '+slotName(state.soundingPreset)+'. Nothing was sent',
'error'
);
return;
}
const result=await ctx.perform('loading "'+(ascii(entry.name).trim()||'(unnamed)')+'"',function(){
return ctx.session.applyEntry(entry,slot);
});
if(result.ok){
ctx.status(result.value.line+' The live window cannot be read back, so the cabinet half is what was verified.','ok');
ctx.setState({});
}
}
function exportWholeBank(ctx){
const items=entries();
if(items.length===0){
ctx.status('the bank is empty: there is nothing to export','error');
return;
}
let text;
try{
text=documentText(items);
}catch(error){
ctx.status('the bank could not be written: '+error.message,'error');
return;
}
global.RigShadeBankUI.deliverFile(global.RigShadeBank.BackupFileNames.FULL_BANK,text);
ctx.log('link','exported '+items.length+' configuration(s) as '+global.RigShadeBank.BackupFileNames.FULL_BANK);
ctx.status('exported '+many(items.length)+' as '+global.RigShadeBank.BackupFileNames.FULL_BANK,'ok');
}
function exportEntry(ctx,entry){
let text;
try{
text=documentText([entry]);
}catch(error){
ctx.status('"'+ascii(entry.name)+'" could not be written: '+error.message,'error');
return;
}
const name=entryFileName(entry);
global.RigShadeBankUI.deliverFile(name,text);
ctx.status('exported "'+(ascii(entry.name).trim()||'(unnamed)')+'" as '+name,'ok');
}
function exportCabinet(ctx,entry){
if(entry.ir.length===0){
ctx.status('"'+(ascii(entry.name).trim()||'(unnamed)')+'" carries no cabinet','error');
return;
}
const name=cabinetFileName(entry);
global.RigShadeBankUI.deliverFile(name,entry.ir,'application/octet-stream');
ctx.status('exported the cabinet of "'+(ascii(entry.name).trim()||'(unnamed)')+'" as '+name,'ok');
}
function deleteEntry(ctx,entry,row){
const found=bankStore();
if(found.store===null)return;
try{
found.store.remove(entry.id);
}catch(error){
ctx.status('the entry was not deleted: '+error.message,'error');
return;
}
row.remove();
painted={key:null};
ctx.status('deleted "'+(ascii(entry.name).trim()||'(unnamed)')+'" from this browser\'s bank','ok');
ctx.setState({});
}
async function importDocument(ctx,section,file){
const report=section.querySelector('[data-bank-report]');
const found=bankStore();
let text;
try{
text=await file.text();
}catch(error){
if(report)report.textContent='the file could not be read: '+error.message+'. Nothing was imported';
return;
}
let parsed;
try{
parsed=global.RigShadeBank.parseDocument(text);
}catch(error){
if(report){
report.textContent='the file was refused and nothing was imported: '+error.message;
report.className='notice error';
}
ctx.log('failed','import refused: '+error.message);
return;
}
if(found.store===null){
if(report){
report.textContent='the file was read but this browser will not keep a bank: '+found.error;
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
const line=
stored.length+' of '+parsed.accepted.length+' stored'+
(parsed.rejected.length===0
?', nothing rejected'
:'; rejected: '+
parsed.rejected
.slice(0,3)
.map(function(item){
return'#'+item.index+' '+(item.name===''?'(unnamed)':'"'+item.name+'"')+': '+item.reason;
})
.join('; ')+
(parsed.rejected.length>3?'; and '+(parsed.rejected.length-3)+' more':''));
if(report){
report.textContent=line;
report.className='notice'+(parsed.rejected.length===0?' ok':' error');
}
ctx.status('import: '+line,parsed.rejected.length===0?'ok':'error');
painted={key:null};
ctx.setState({});
}
function update(root,ctx){
const section=root.querySelector('[data-bank-screen]');
if(section===null)return;
const found=bankStore();
const values=ctx.session!==null?ctx.session.presets:null;
const locked=!ctx.ready()||ctx.state.busy;
const notice=section.querySelector('[data-bank-notice]');
notice.textContent=
found.store===null
?'This browser will not keep a bank for this page: '+found.error+'. Imports and exports still work.'
:'Stored in this browser\'s localStorage · nothing leaves this machine. '+
(values===null?'Read the pedal to save a configuration.':'');
const save=section.querySelector('[data-action="bank-save"]');
save.textContent='SAVE '+slotName(ctx.state.activePreset);
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
?'the slot answered, and holds no cabinet the page can send back'
:'the cabinet slot has not been read';
describe.textContent='';
}else{
line.textContent=held.description||'the slot holds a cabinet';
describe.textContent=
'the page holds this cabinet ('+(held.origin==='WRITTEN_TO_PEDAL'?'written and read back':'read from the slot')+
'), MIC DIST '+held.distance+'%'+(held.distance>=100?' — 100% silences the cabinet':'');
}
section.querySelector('[data-action="cabinet-read"]').disabled=locked||ctx.session===null;
section.querySelector('[data-action="cabinet-upload"]').disabled=locked||ctx.session===null;
const restore=section.querySelector('[data-action="cabinet-restore"]');
const backup=ctx.session!==null?ctx.session.slotBackup:null;
restore.hidden=backup===null;
restore.disabled=locked||backup===null;
}
UI.registerScreen({
id:'BANK',
label:'BANK',
mount:mount,
update:update,
unmount:function(){
pending=null;
loadedEntry=null;
},
});
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