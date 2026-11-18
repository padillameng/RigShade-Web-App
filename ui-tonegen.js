(function(global){
'use strict';
const G=global.RigShadeToneGen;
const UI=global.RigShadeUI;
const B=global.RigShadeBank;
const BANKUI=global.RigShadeBankUI;
if(!G)throw new Error('ui-tonegen.js needs tonegen.js');
if(!UI)throw new Error('ui-tonegen.js needs app.js');
if(!B)throw new Error('ui-tonegen.js needs bank.js');
if(!BANKUI)throw new Error('ui-tonegen.js needs ui-bank.js');
function t(text,vars){
const layer=global.RigShadeI18n;
if(layer&&typeof layer.t==='function')return layer.t(text,vars);
if(!vars)return text;
return String(text).replace(/\{(\w+)\}/g,function(match,name){
return Object.prototype.hasOwnProperty.call(vars,name)?String(vars[name]):match;
});
}
function el(tag,className,text){
const element=document.createElement(tag);
if(className)element.className=className;
if(text!==undefined)element.textContent=text;
return element;
}
function readIntent(root){
const intent={};
for(const descriptor of G.INTENT){
const input=root.querySelector('[data-intent="'+descriptor.key+'"]');
intent[descriptor.key]=input===null?descriptor.value:Number(input.value);
}
const picker=root.querySelector('[data-tonegen-modulation]');
intent.modulation=picker===null?'off':picker.value;
return intent;
}
let latest=null;
let host=null;
let mode='LIBRARY';
function mount(root,ctx){
host=root;
latest=null;
const section=el('section','tonegen-screen');
section.setAttribute('data-tonegen-screen','1');
const head=el('div','panel-head');
const headTitle=el('h3',null,t('TONES'));
headTitle.setAttribute('data-tonegen-title','1');
head.appendChild(headTitle);
const state=el('span','state');
state.setAttribute('data-tonegen-state','1');
state.textContent=t('a preset from a description · nothing is sent until you press LOAD');
head.appendChild(state);
section.appendChild(head);
const notice=el('p','notice',
t('Two ways to a preset: pick one of the researched tones of RigShade Master Package v1, or describe '+
'the sound and press GENERATE. Either way the sixteen bytes are shown before anything reaches '+
'the pedal.'));
notice.setAttribute('data-tonegen-notice','1');
section.appendChild(notice);
const tabs=el('div','row tonegen-tabs');
tabs.setAttribute('data-tonegen-tabs','1');
for(const name of['LIBRARY','GENERATE']){
const chip=el('button','chip',t(name));
chip.type='button';
chip.setAttribute('data-tonegen-mode',name);
chip.addEventListener('click',function(){
mode=name;
ctx.setState({});
});
tabs.appendChild(chip);
}
section.appendChild(tabs);
const paneGenerate=el('div','tonegen-pane');
paneGenerate.setAttribute('data-tonegen-pane','GENERATE');
const sliders=el('div','tonegen-intent');
sliders.setAttribute('data-tonegen-intent','1');
for(const descriptor of G.INTENT){
const row=el('label','tonegen-slider');
row.appendChild(el('span','knob-label',descriptor.label));
const input=el('input');
input.type='range';
input.min='0';
input.max='100';
input.step='1';
input.value=String(descriptor.value);
input.setAttribute('data-intent',descriptor.key);
const shown=el('span','tonegen-value',descriptor.value+'%');
input.addEventListener('input',function(){
shown.textContent=input.value+'%';
});
row.appendChild(input);
row.appendChild(shown);
row.appendChild(el('span','tonegen-ends',descriptor.low+' → '+descriptor.high));
sliders.appendChild(row);
}
const modRow=el('label','tonegen-slider');
const modLabel=el('span','knob-label',t('MODULATION'));
modLabel.setAttribute('data-tonegen-mod-label','1');
modRow.appendChild(modLabel);
const select=el('select');
select.setAttribute('data-tonegen-modulation','1');
for(const modulation of G.MODULATIONS){
const option=el('option',null,modulation);
option.value=modulation;
select.appendChild(option);
}
modRow.appendChild(select);
sliders.appendChild(modRow);
paneGenerate.appendChild(sliders);
const controls=el('div','row');
const nameLabel=el('label',null,t('Name'));
nameLabel.setAttribute('data-tonegen-name-label','1');
const name=el('input');
name.type='text';
name.placeholder=t('taken from the amp and cabinet');
name.setAttribute('data-tonegen-name','1');
nameLabel.appendChild(name);
controls.appendChild(nameLabel);
const generate=el('button','primary',t('GENERATE'));
generate.setAttribute('data-action','tonegen-generate');
generate.addEventListener('click',function(){
mode='GENERATE';
generateNow(root,ctx);
});
controls.appendChild(generate);
paneGenerate.appendChild(controls);
const result=el('div');
result.setAttribute('data-tonegen-result','1');
result.hidden=true;
result.style.display='none';
const pick=el('p','notice');
pick.setAttribute('data-tonegen-pick','1');
result.appendChild(pick);
const params=el('div','params');
params.setAttribute('data-tonegen-params','1');
result.appendChild(params);
const hexLine=el('p','pair');
hexLine.setAttribute('data-tonegen-hex','1');
result.appendChild(hexLine);
const warning=el('p','notice error');
warning.setAttribute('data-tonegen-warning','1');
warning.hidden=true;
result.appendChild(warning);
const actions=el('div','row');
const load=el('button','primary',t('LOAD INTO THE CHAIN'));
load.setAttribute('data-action','tonegen-load');
load.addEventListener('click',function(){
loadNow(ctx);
});
actions.appendChild(load);
const store=el('button',null,t('STORE IN THE BANK'));
store.setAttribute('data-action','tonegen-store');
store.addEventListener('click',function(){
storeNow(ctx);
});
actions.appendChild(store);
const download=el('button',null,t('DOWNLOAD JSON'));
download.setAttribute('data-action','tonegen-download');
download.addEventListener('click',function(){
downloadNow(ctx);
});
actions.appendChild(download);
result.appendChild(actions);
paneGenerate.appendChild(result);
section.appendChild(paneGenerate);
const paneLibrary=el('div','tonegen-pane');
paneLibrary.setAttribute('data-tonegen-pane','LIBRARY');
section.appendChild(paneLibrary);
const library=global.RigShadeLibraryUI;
if(library){
library.mount(paneLibrary,ctx,{
onPick:function(){
mode='LIBRARY';
ctx.setState({});
},
});
}else{
const missing=el('p','notice error',
t('the researched tone library is not loaded: ui-library.js and tone-library.js are missing'));
missing.setAttribute('data-tonegen-missing','1');
paneLibrary.appendChild(missing);
}
root.appendChild(section);
}
function generateNow(root,ctx){
let made;
try{
made=G.generate(readIntent(root));
}catch(error){
ctx.status(t('the preset could not be generated: {reason}',{
reason:error&&error.message?error.message:String(error),
}),'error');
return;
}
latest=made;
ctx.setState({});
ctx.log('link','generated '+made.name+': '+made.hex);
ctx.status(
t('generated {name} ({hex}) · nothing was sent to the pedal',{name:made.name,hex:made.hex}),
'ok'
);
}
function typedName(){
const input=host&&host.querySelector('[data-tonegen-name]');
return String((input?input.value:'')||'').trim();
}
function entryFor(made,ctx,slot){
if(made===null||made===undefined){
ctx.status(
t('press GENERATE first, or pick a tone from the library: there is no preset to work with'),
'error'
);
return null;
}
if(made.loadable===false){
ctx.status(t('this tone cannot be used: {problems}',{problems:made.problems.join('; ')}),'error');
return null;
}
const name=typedName()||made.name;
try{
const entry=B.createEntry({
name:name,
slot:slot,
createdAt:Date.now(),
settings:made.settings.slice(),
irIndex:B.NO_IR_INDEX,
ir:new Uint8Array(0),
irName:'',
});
const report=B.validate(entry);
if(!report.ok){
ctx.status(t('this preset cannot be used: {problems}',{problems:report.problems.join('; ')}),'error');
return null;
}
return entry;
}catch(error){
ctx.status(t('this preset cannot be used: {reason}',{
reason:error&&error.message?error.message:String(error),
}),'error');
return null;
}
}
async function act(ctx,operation,made){
const entry=entryFor(made,ctx,ctx.state.activePreset);
if(entry===null)return;
if(operation==='load'){
await BANKUI.loadEntry(ctx,entry,ctx.state.activePreset);
return;
}
if(operation==='store'){
let store;
try{
store=B.createStore();
}catch(error){
ctx.status(t('the bank cannot be stored in this browser: {reason}',{
reason:error&&error.message?error.message:String(error),
}),'error');
return;
}
try{
store.add(entry);
}catch(error){
ctx.status(t('the preset was not stored: {reason}',{
reason:error&&error.message?error.message:String(error),
}),'error');
return;
}
ctx.status(t('stored "{name}" in this browser\'s bank — the pedal was not written',{name:entry.name}),'ok');
ctx.setState({});
return;
}
let text;
try{
text=B.encodeDocument([entry]);
}catch(error){
ctx.status(t('the file could not be written: {reason}',{
reason:error&&error.message?error.message:String(error),
}),'error');
return;
}
const file=B.BackupFileNames.forEntry(entry.name);
BANKUI.deliverFile(file,text);
ctx.log('link','exported "'+entry.name+'" as '+file);
ctx.status(t('exported "{name}" as {file} — the pedal was not written',{name:entry.name,file:file}),'ok');
}
function loadNow(ctx){
return act(ctx,'load',latest);
}
function storeNow(ctx){
return act(ctx,'store',latest);
}
function downloadNow(ctx){
return act(ctx,'download',latest);
}
function update(root,ctx){
const section=root.querySelector('[data-tonegen-screen]');
if(section===null)return;
paintTonegenText(section);
for(const chip of section.querySelectorAll('[data-tonegen-mode]')){
chip.setAttribute('aria-pressed',chip.getAttribute('data-tonegen-mode')===mode?'true':'false');
}
const generatePane=section.querySelector('[data-tonegen-pane="GENERATE"]');
const libraryPane=section.querySelector('[data-tonegen-pane="LIBRARY"]');
if(generatePane!==null)generatePane.hidden=mode!=='GENERATE';
if(libraryPane!==null)libraryPane.hidden=mode!=='LIBRARY';
const library=global.RigShadeLibraryUI;
if(library)library.update(root,ctx);
if(mode!=='GENERATE')return;
const ready=ctx.ready();
const result=section.querySelector('[data-tonegen-result]');
const empty=latest===null;
const state=section.querySelector('[data-tonegen-state]');
state.textContent=empty
?t('a preset from a description · nothing is sent until you press LOAD')
:latest.name+' · '+latest.hex;
section.querySelector('[data-action="tonegen-generate"]').disabled=Boolean(ctx.state&&ctx.state.busy);
for(const action of['tonegen-store','tonegen-download']){
section.querySelector('[data-action="'+action+'"]').disabled=empty;
}
const load=section.querySelector('[data-action="tonegen-load"]');
load.disabled=empty||!ready||Boolean(ctx.state&&ctx.state.busy);
if(empty)return;
result.hidden=false;
result.style.display='';
section.querySelector('[data-tonegen-pick]').textContent=t(
'amp {amp} · cabinet {cabinet} · a factory cabinet, never the user slot',
{amp:latest.rows[0].text,cabinet:latest.rows[9].text}
);
const params=section.querySelector('[data-tonegen-params]');
const key=latest.hex;
if(params.getAttribute('data-for')!==key){
params.setAttribute('data-for',key);
params.textContent='';
for(const row of latest.rows){
const knob=el('div','knob');
knob.setAttribute('data-tonegen-param',row.label);
knob.appendChild(el('span','knob-label',row.label));
const box=el('span','value-box knob-value',row.text);
knob.appendChild(box);
params.appendChild(knob);
}
}
section.querySelector('[data-tonegen-hex]').textContent=t('{hex} · 16 bytes, 13 in use',{hex:latest.hex});
const warning=section.querySelector('[data-tonegen-warning]');
warning.hidden=latest.warnings.length===0;
warning.textContent=latest.warnings.join(' ');
}
function paintTonegenText(section){
const title=section.querySelector('[data-tonegen-title]');
if(title!==null)title.textContent=t('TONES');
const notice=section.querySelector('[data-tonegen-notice]');
if(notice!==null){
notice.textContent=t(
'Two ways to a preset: pick one of the researched tones of RigShade Master Package v1, or describe the sound and press GENERATE. Either way the sixteen bytes are shown before anything reaches the pedal.'
);
}
for(const chip of section.querySelectorAll('[data-tonegen-mode]')){
chip.textContent=t(chip.getAttribute('data-tonegen-mode'));
}
const modLabel=section.querySelector('[data-tonegen-mod-label]');
if(modLabel!==null)modLabel.textContent=t('MODULATION');
const nameLabel=section.querySelector('[data-tonegen-name-label]');
const first=nameLabel===null?null:nameLabel.firstChild;
if(first!==null&&first.nodeType===3)first.nodeValue=t('Name');
const name=section.querySelector('[data-tonegen-name]');
if(name!==null)name.placeholder=t('taken from the amp and cabinet');
const generate=section.querySelector('[data-action="tonegen-generate"]');
if(generate!==null)generate.textContent=t('GENERATE');
const load=section.querySelector('[data-action="tonegen-load"]');
if(load!==null)load.textContent=t('LOAD INTO THE CHAIN');
const store=section.querySelector('[data-action="tonegen-store"]');
if(store!==null)store.textContent=t('STORE IN THE BANK');
const download=section.querySelector('[data-action="tonegen-download"]');
if(download!==null)download.textContent=t('DOWNLOAD JSON');
const missing=section.querySelector('[data-tonegen-missing]');
if(missing!==null){
missing.textContent=t('the researched tone library is not loaded: ui-library.js and tone-library.js are missing');
}
}
UI.registerScreen({
id:'TONES',
label:'TONES',
mount:mount,
update:update,
unmount:function(){
host=null;
},
});
global.RigShadeToneGenUI={
readIntent,
last:function(){
return latest;
},
mode:function(){
return mode;
},
apply:act,
mount,
update,
};
})(typeof globalThis!=='undefined'?globalThis:this);