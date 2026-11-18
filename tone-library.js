(function(global){
'use strict';
const P=global.RigShadeProtocol;
const B=global.RigShadeBank;
const TONE=global.RigShadeToneGen;
const DATA=global.RigShadeToneLibraryData;
if(!P)throw new Error('tone-library.js needs protocol.js');
if(!B)throw new Error('tone-library.js needs bank.js');
if(!TONE)throw new Error('tone-library.js needs tonegen.js: the switch warning is its rule, not a copy');
if(!DATA||!Array.isArray(DATA.entries)){
throw new Error('tone-library.js needs tone-library-data.js (run embed-tone-library.py)');
}
class ToneLibraryError extends Error{
constructor(message){
super(message);
this.name='ToneLibraryError';
}
}
const ENTRIES=DATA.entries;
function decode(entry){
const hex=entry&&entry.rigShade?entry.rigShade.settings:undefined;
const bytes=B.HexCodec.decodeOrNull(hex);
if(bytes===null||bytes.length!==P.MemoryMap.PRESET_BYTES)return null;
return bytes;
}
function settingsOf(entry){
const bytes=decode(entry);
if(bytes===null){
throw new ToneLibraryError(
'entry '+(entry&&entry.id?entry.id:'(no id)')+' has no sixteen-byte settings block'
);
}
return bytes;
}
function problemsOf(entry){
const problems=[];
const bytes=decode(entry);
if(bytes===null){
return['the settings are not sixteen bytes of hex, so there is no preset to load'];
}
if(bytes[13]!==0||bytes[14]!==0||bytes[15]!==0){
problems.push('bytes 13..15 are reserved and travel zero, got '+bytes[13]+' '+bytes[14]+' '+bytes[15]);
}
for(const param of P.Params.ALL){
if(bytes[param.code]>param.max){
problems.push(param.label+' is 0..'+param.max+', got '+bytes[param.code]);
}
}
const ir=bytes[P.Params.byCode(9).code];
if(ir===P.Params.byCode(9).max){
problems.push('the IR byte selects the user cabinet slot, and the library carries no cabinet for it');
}
let entryObject=null;
try{
entryObject=toEntry(entry);
}catch(error){
problems.push(error&&error.message?error.message:String(error));
}
if(entryObject!==null){
for(const problem of B.validate(entryObject).problems){
if(problems.indexOf(problem)<0)problems.push(problem);
}
}
return problems;
}
function warningsOf(entry){
const bytes=decode(entry);
if(bytes===null)return[];
const warnings=TONE.signalWarnings(bytes).slice();
const claim=entry.rigShade.values||{};
for(const param of P.Params.ALL){
if(claim[param.label]!==undefined&&claim[param.label]!==bytes[param.code]){
warnings.push(
'the entry says '+param.label+' '+claim[param.label]+', its bytes carry '+bytes[param.code]+
' (the bytes are what the pedal would get)'
);
}
}
return warnings;
}
function nameOf(entry){
return(entry.artist+' - '+entry.archetype).slice(0,60);
}
function toEntry(entry,options){
const settings=options||{};
return B.createEntry({
name:settings.name===undefined?nameOf(entry):settings.name,
slot:settings.slot===undefined?0:settings.slot,
createdAt:settings.createdAt===undefined?0:settings.createdAt,
settings:settingsOf(entry),
irIndex:B.NO_IR_INDEX,
ir:new Uint8Array(0),
irName:'',
});
}
function detail(entry){
const bytes=decode(entry);
const problems=problemsOf(entry);
return{
entry:entry,
id:entry.id,
name:nameOf(entry),
settings:bytes,
hex:bytes===null?entry.rigShade.settings:B.HexCodec.encode(bytes),
rows:bytes===null?[]:P.Params.ALL.map(function(param){
const value=bytes[param.code];
return{code:param.code,label:param.label,value:value,text:P.describe(param.code,value)};
}),
problems:problems,
warnings:warningsOf(entry),
loadable:problems.length===0,
};
}
function label(entry){
const blob=[
entry.artist,entry.song,entry.genre,entry.styleFamily,entry.archetype,entry.part,
entry.guitar,entry.pickup,entry.decade,
].concat(entry.tags||[]).concat(entry.coverage||[]);
return blob.join(' ').toLowerCase();
}
function matchesText(entry,text){
const words=String(text||'').toLowerCase().split(/\s+/).filter(function(word){return word.length>0;});
if(words.length===0)return true;
const haystack=label(entry);
return words.every(function(word){return haystack.indexOf(word)>=0;});
}
function same(entry,key,wanted){
if(wanted===undefined||wanted===null||wanted===''||wanted==='all')return true;
if(key==='collection')return(entry.coverage||[]).indexOf(wanted)>=0;
return String(entry[key])===String(wanted);
}
function find(query){
const q=query||{};
return ENTRIES.filter(function(entry){
return(
matchesText(entry,q.text)&&
same(entry,'decade',q.decade)&&
same(entry,'styleFamily',q.styleFamily)&&
same(entry,'genre',q.genre)&&
same(entry,'artist',q.artist)&&
same(entry,'collection',q.collection)&&
same(entry,'researchConfidence',q.confidence)
);
});
}
function unique(values){
return Object.keys(values).sort();
}
function facets(){
const decades={};
const styleFamilies={};
const genres={};
const artists={};
const collections={};
const confidences={};
for(const entry of ENTRIES){
decades[entry.decade]=true;
styleFamilies[entry.styleFamily]=true;
genres[entry.genre]=true;
artists[entry.artist]=true;
confidences[entry.researchConfidence]=true;
for(const collection of entry.coverage||[])collections[collection]=true;
}
return{
decades:unique(decades).sort(function(left,right){return parseInt(left,10)-parseInt(right,10);}),
styleFamilies:unique(styleFamilies),
genres:unique(genres),
artists:unique(artists),
collections:unique(collections),
confidences:unique(confidences),
};
}
function byId(id){
return ENTRIES.filter(function(entry){return entry.id===id;})[0]||null;
}
global.RigShadeToneLibrary={
DATA:DATA,
ENTRIES:ENTRIES,
count:ENTRIES.length,
scope:DATA.scope||'',
generated:DATA.generated||'',
methodology:DATA.methodology||{},
parameterContract:DATA.parameterContract||{},
decode:decode,
settingsOf:settingsOf,
problemsOf:problemsOf,
warningsOf:warningsOf,
nameOf:nameOf,
toEntry:toEntry,
detail:detail,
find:find,
facets:facets,
byId:byId,
};
})(typeof globalThis!=='undefined'?globalThis:this);