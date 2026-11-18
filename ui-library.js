(function(global){
'use strict';
const L=global.RigShadeToneLibrary;
const P=global.RigShadeProtocol;
const UI=global.RigShadeUI;
if(!L)throw new Error('ui-library.js needs tone-library.js');
if(!P)throw new Error('ui-library.js needs protocol.js');
if(!UI)throw new Error('ui-library.js needs app.js');
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
const FILTERS=[
{key:'decade',attribute:'data-library-decade',all:'every decade',facet:'decades'},
{key:'styleFamily',attribute:'data-library-style',all:'every style family',facet:'styleFamilies'},
{key:'genre',attribute:'data-library-genre',all:'every genre',facet:'genres'},
{key:'artist',attribute:'data-library-artist',all:'every artist',facet:'artists'},
{key:'collection',attribute:'data-library-collection',all:'every collection',facet:'collections'},
];
const query={text:'',decade:'',styleFamily:'',genre:'',artist:'',collection:''};
let selectedId=null;
let listKey=null;
let detailKey=null;
let host=null;
let hooks=null;
let screenCtx=null;
const MAX_ROWS=400;
function selectedEntry(){
return selectedId===null?null:L.byId(selectedId);
}
function picked(){
const entry=selectedEntry();
if(entry===null)return null;
return L.detail(entry);
}
function filterHeading(key){
if(key==='styleFamily')return t('STYLE');
if(key==='decade')return t('DECADE');
if(key==='genre')return t('GENRE');
if(key==='artist')return t('ARTIST');
return t('COLLECTION');
}
function buildFilters(section,ctx){
const facets=L.facets();
const box=el('div','library-filters');
box.setAttribute('data-library-filters','1');
const search=el('label','library-search');
search.appendChild(el('span','knob-label',t('SEARCH')));
const text=el('input');
text.type='search';
text.setAttribute('data-library-text','1');
text.placeholder=t('artist, song, archetype, tag');
text.addEventListener('input',function(){
query.text=text.value;
repaint(ctx);
});
search.appendChild(text);
box.appendChild(search);
for(const filter of FILTERS){
const label=el('label');
label.appendChild(el('span','knob-label',filterHeading(filter.key)));
const select=el('select');
select.setAttribute(filter.attribute,'1');
const any=el('option',null,t(filter.all));
any.value='';
select.appendChild(any);
for(const value of facets[filter.facet]){
const option=el('option',null,value);
option.value=value;
select.appendChild(option);
}
select.addEventListener('change',function(){
query[filter.key]=select.value;
repaint(ctx);
});
label.appendChild(select);
box.appendChild(label);
}
section.appendChild(box);
}
function buildRow(entry,ctx){
const row=el('button','library-item');
row.type='button';
row.setAttribute('data-library-id',entry.id);
const head=el('span','library-item-head');
head.appendChild(el('span','library-item-name',entry.artist+' — '+entry.song));
head.appendChild(el('span','library-item-decade',entry.decade));
row.appendChild(head);
row.appendChild(
el('span','library-item-meta',
t('{style} · {archetype} · approximation {quality}/5{confidence}',{
style:entry.styleFamily,
archetype:entry.archetype,
quality:entry.approximationQuality,
confidence:entry.researchConfidence==='High'?' '+t('· high confidence'):'',
}))
);
row.addEventListener('click',function(){
selectedId=entry.id;
detailKey=null;
if(hooks&&typeof hooks.onPick==='function')hooks.onPick();
repaint(ctx);
});
return row;
}
function line(text,className){
return el('p',className===undefined?'notice':className,text);
}
function fact(box,name,value){
if(!value)return;
const row=el('p','library-fact');
row.appendChild(el('span','knob-label',name));
row.appendChild(el('span',null,value));
box.appendChild(row);
}
function buildDetail(section,ctx){
const made=picked();
const box=section.querySelector('[data-library-detail]');
box.textContent='';
if(made===null){
box.appendChild(line(t('Choose a tone above: its values, its evidence and what the pedal cannot do are shown here.')));
return;
}
const entry=made.entry;
const head=el('div','panel-head');
head.appendChild(el('h3',null,entry.artist+' — '+entry.song));
head.appendChild(el('span','state',made.hex));
box.appendChild(head);
const facts=el('div','library-facts');
fact(facts,t('ARCHETYPE'),entry.archetype);
fact(facts,t('PART'),entry.part);
fact(facts,t('DECADE / GENRE'),entry.decade+' · '+entry.genre);
fact(facts,t('STYLE FAMILY'),entry.styleFamily+' · '+(entry.coverage||[]).join(', '));
fact(facts,t('GUITAR / PICKUP'),[entry.guitar,entry.pickup].filter(Boolean).join(' · '));
fact(facts,t('ORIGINAL RIG'),entry.originalRig);
fact(facts,t('EVIDENCE'),entry.evidence);
fact(facts,t('RESEARCH'),entry.researchConfidence+' · approximation '+entry.approximationQuality+'/5');
fact(facts,t('MISSING EFFECTS'),
(entry.missingEffects||[]).length===0?t('nothing the tone needs is missing'):entry.missingEffects.join(', '));
if(entry.notes)fact(facts,t('NOTES'),entry.notes);
box.appendChild(facts);
if(entry.source&&entry.source.url){
const source=el('p','library-fact');
source.appendChild(el('span','knob-label',t('SOURCE')));
const link=el('a',null,entry.source.label||entry.source.url);
link.href=entry.source.url;
link.rel='noreferrer noopener';
link.target='_blank';
source.appendChild(link);
box.appendChild(source);
if(entry.source.note)box.appendChild(line(entry.source.note));
}
const params=el('div','params');
params.setAttribute('data-library-params','1');
for(const row of made.rows){
const knob=el('div','knob');
knob.setAttribute('data-library-param',row.label);
knob.appendChild(el('span','knob-label',row.label));
knob.appendChild(el('span','value-box knob-value',row.text));
params.appendChild(knob);
}
box.appendChild(params);
box.appendChild(el('p','pair',
t('{hex} · 16 bytes, 13 in use · the patch the master package ships for this tone',{hex:made.hex})));
const problem=el('p','notice error');
problem.setAttribute('data-library-problem','1');
problem.hidden=made.problems.length===0;
problem.textContent=made.problems.length===0?'':
t('This tone cannot reach the pedal: {problems}',{problems:made.problems.join('; ')});
box.appendChild(problem);
const warning=el('p','notice');
warning.setAttribute('data-library-warning','1');
warning.hidden=made.warnings.length===0;
warning.textContent=made.warnings.join(' ');
box.appendChild(warning);
const actions=el('div','row');
const apply=global.RigShadeToneGenUI&&global.RigShadeToneGenUI.apply;
for(const action of[
{key:'load',label:t('LOAD INTO THE CHAIN'),className:'primary'},
{key:'store',label:t('STORE IN THE BANK'),className:''},
{key:'download',label:t('DOWNLOAD JSON'),className:''},
]){
const button=el('button',action.className,action.label);
button.type='button';
button.setAttribute('data-action','library-'+action.key);
button.addEventListener('click',function(){
if(typeof apply!=='function'){
ctx.status(t('the actions are not loaded: ui-tonegen.js is missing'),'error');
return;
}
apply(ctx,action.key,picked());
});
actions.appendChild(button);
}
box.appendChild(actions);
}
function repaint(ctx){
if(host!==null)update(host,ctx);
}
function mount(root,ctx,options){
host=root;
hooks=options||null;
screenCtx=ctx||null;
listKey=null;
detailKey=null;
selectedId=null;
const section=el('section','library-screen');
section.setAttribute('data-library-screen','1');
section.appendChild(line(t(
'The researched library from RigShade Master Package v1: {count} tones, from the {first} to the '+
'{last}. Every patch is an approximation built from the models this pedal has — not an official '+
'emulation of the amp or cabinet it is named after.',
{
count:L.count,
first:L.facets().decades[0],
last:L.facets().decades[L.facets().decades.length-1],
}
)));
buildFilters(section,ctx);
const count=el('p','notice');
count.setAttribute('data-library-count','1');
section.appendChild(count);
const list=el('div','library-list');
list.setAttribute('data-library-list','1');
section.appendChild(list);
const detail=el('div','library-detail');
detail.setAttribute('data-library-detail','1');
section.appendChild(detail);
root.appendChild(section);
update(root,ctx);
return section;
}
function update(root,ctx){
const section=root.querySelector('[data-library-screen]');
if(section===null)return;
const context=ctx===undefined||ctx===null?screenCtx:ctx;
if(context!==null&&context!==undefined)screenCtx=context;
const results=L.find(query);
const count=section.querySelector('[data-library-count]');
count.textContent=results.length===0
?t('no tone matches these filters · clear the search or a filter')
:t('{shown} of {total} tones{match}{cap}',{
shown:results.length,
total:L.count,
match:results.length===1?' '+t('· one match'):'',
cap:results.length>MAX_ROWS?' '+t('· showing the first {max}',{max:MAX_ROWS}):'',
});
const list=section.querySelector('[data-library-list]');
const key=JSON.stringify(query);
if(key!==listKey){
listKey=key;
list.textContent='';
for(const entry of results.slice(0,MAX_ROWS))list.appendChild(buildRow(entry,context));
const kept=selectedEntry();
if(kept===null){
selectedId=null;
detailKey=null;
}
}
const box=section.querySelector('[data-library-detail]');
const wanted=selectedId===null?'none':selectedId;
if(wanted!==detailKey){
detailKey=wanted;
buildDetail(section,context);
}
const made=picked();
for(const row of list.querySelectorAll('[data-library-id]')){
row.setAttribute('aria-pressed',row.getAttribute('data-library-id')===selectedId?'true':'false');
}
for(const action of['load','store','download']){
const button=box.querySelector('[data-action="library-'+action+'"]');
if(button===null)continue;
const busy=Boolean(context&&context.state&&context.state.busy);
const ready=context?context.ready():false;
button.disabled=busy||(action==='load'&&!ready)||(made!==null&&!made.loadable);
}
}
document.addEventListener('rigshade:locale',function(){
listKey=null;
detailKey=null;
if(host!==null)update(host,screenCtx);
});
global.RigShadeLibraryUI={
mount:mount,
update:update,
picked:picked,
select:function(id){selectedId=id;detailKey=null;},
query:query,
FILTERS:FILTERS,
};
})(typeof globalThis!=='undefined'?globalThis:this);