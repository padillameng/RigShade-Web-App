(function(global){
'use strict';
const P=global.RigShadeProtocol;
const{MemoryMap,Params}=P;
class BankError extends Error{
constructor(message){
super(message);
this.name='BankError';
}
}
function shown(value){
if(typeof value==='string')return JSON.stringify(value);
if(value===null)return'null';
if(value===undefined)return'nothing';
if(typeof value==='number'||typeof value==='boolean')return String(value);
if(Array.isArray(value))return'an array';
return typeof value==='object'?'an object':String(value);
}
function asBytes(value,what){
const subject=what===undefined?'the byte array':what;
if(value instanceof Uint8Array)return value.slice();
if(Array.isArray(value)){
for(let i=0;i<value.length;i++){
const byte=value[i];
if(!Number.isInteger(byte)||byte<0||byte>0xFF){
throw new BankError(subject+' carries '+shown(byte)+', which is not a byte');
}
}
return Uint8Array.from(value);
}
throw new BankError(subject+' is not a byte array, it is '+shown(value));
}
function asText(value,what){
if(typeof value!=='string')throw new BankError(what+' is text, got '+shown(value));
return value;
}
const HEX='0123456789ABCDEF';
function digit(code){
if(code>=0x30&&code<=0x39)return code-0x30;
if(code>=0x61&&code<=0x66)return code-0x61+10;
if(code>=0x41&&code<=0x46)return code-0x41+10;
return-1;
}
const HexCodec={
encode(bytes){
const data=asBytes(bytes);
let out='';
for(const byte of data)out+=HEX[byte>>>4]+HEX[byte&0x0F];
return out;
},
decodeOrNull(text){
if(typeof text!=='string')return null;
const body=text.startsWith('0x')||text.startsWith('0X')?text.slice(2):text;
if(body.length%2!==0)return null;
const out=new Uint8Array(body.length/2);
for(let i=0;i<out.length;i++){
const hi=digit(body.charCodeAt(i*2));
const lo=digit(body.charCodeAt(i*2+1));
if(hi<0||lo<0)return null;
out[i]=(hi<<4)|lo;
}
return out;
},
};
const Cabinet={
SECTOR_BYTES:4096,
SAMPLES:512,
MARKER_USER:Uint8Array.of(0x00,0x00,0x00,0x00),
MARKER_FACTORY:Uint8Array.of(0x01,0x00,0x00,0x00),
isErased(bytes){
const data=asBytes(bytes,'the cabinet');
if(data.length===0)return false;
for(let i=0;i<data.length;i++)if(data[i]!==0xFF)return false;
return true;
},
sectorProblem(bytes){
const data=asBytes(bytes,'the cabinet');
if(data.length!==Cabinet.SECTOR_BYTES){
return'the cabinet sector is '+Cabinet.SECTOR_BYTES+' bytes, got '+data.length;
}
if(Cabinet.isErased(data))return null;
const marker=data.slice(0,4);
if(!P.bytesEqual(marker,Cabinet.MARKER_USER)&&!P.bytesEqual(marker,Cabinet.MARKER_FACTORY)){
return'the cabinet sector does not start with a known marker (00 00 00 00 or 01 00 00 00)';
}
const view=new DataView(data.buffer,data.byteOffset,data.length);
const distance=view.getFloat32(4,true);
if(!Number.isFinite(distance))return'the mic distance in the cabinet sector is not a finite number';
if(distance<0||distance>1){
return'the mic distance in the cabinet sector is '+distance+', outside 0..1';
}
for(let i=0;i<Cabinet.SAMPLES;i++){
if(!Number.isFinite(view.getFloat32(8+i*4,true))){
return'sample '+i+' of the cabinet sector is not a finite number';
}
}
return null;
},
};
const USER_IR_INDEX=8;
const NO_IR_INDEX=0;
function createEntry(options){
if(options===null||typeof options!=='object'){
throw new BankError('an entry needs its fields, got '+shown(options));
}
if(options.settings===undefined)throw new BankError('an entry needs its settings bytes');
const entry={
name:options.name===undefined?'':asText(options.name,'name'),
slot:options.slot===undefined?0:options.slot,
createdAt:options.createdAt===undefined?0:options.createdAt,
settings:asBytes(options.settings,'the settings'),
irIndex:options.irIndex===undefined?NO_IR_INDEX:options.irIndex,
ir:options.ir===undefined?new Uint8Array(0):asBytes(options.ir,'the cabinet'),
irName:options.irName===undefined?'':asText(options.irName,'irName'),
id:options.id===undefined?'':asText(options.id,'id'),
};
Object.defineProperty(entry,'usesIr',{
enumerable:false,
get:function(){
return entry.ir.length>0||entry.irIndex===USER_IR_INDEX;
},
});
return entry;
}
const SWITCHES=[Params.byCode(10),Params.byCode(11),Params.byCode(12)];
const IR_PARAM=Params.byCode(9);
function usesUserSlot(entry){
if(entry.irIndex===USER_IR_INDEX)return true;
const settings=entry.settings;
return settings.length>IR_PARAM.code&&Params.clamp(IR_PARAM,settings[IR_PARAM.code])===IR_PARAM.max;
}
function validate(entry){
const problems=[];
const settings=entry.settings;
if(settings.length!==MemoryMap.PRESET_BYTES){
problems.push('the settings are '+MemoryMap.PRESET_BYTES+' bytes, got '+settings.length);
}
if(entry.irIndex!==NO_IR_INDEX&&entry.irIndex!==USER_IR_INDEX){
problems.push('irIndex is '+NO_IR_INDEX+' or '+USER_IR_INDEX+', got '+shown(entry.irIndex));
}
for(const param of SWITCHES){
if(settings.length>param.code&&settings[param.code]>param.max){
problems.push(param.label+' is on or off, got '+settings[param.code]);
}
}
if(entry.ir.length===0){
if(usesUserSlot(entry)){
problems.push('the configuration selects the user cabinet slot but carries no cabinet');
}
}else{
const sectorIssue=Cabinet.sectorProblem(entry.ir);
if(sectorIssue!==null)problems.push('the cabinet is not usable: '+sectorIssue);
if(!usesUserSlot(entry)){
problems.push('the configuration carries a cabinet but does not select the user cabinet slot');
}
}
if(!Number.isInteger(entry.slot)||entry.slot<0||entry.slot>=MemoryMap.PRESET_COUNT){
problems.push(
'slot is A, B or C (0..'+(MemoryMap.PRESET_COUNT-1)+'), got '+shown(entry.slot)
);
}
if(!Number.isInteger(entry.createdAt)||entry.createdAt<0){
problems.push('createdAt is milliseconds since the epoch, got '+shown(entry.createdAt));
}
return{ok:problems.length===0,problems:problems};
}
const FORMAT='cubesuite-bank';
const VERSION=1;
const FIELDS=['name','slot','createdAt','settings','irIndex','ir','irName'];
function encodeDocument(entries){
if(!Array.isArray(entries)){
throw new BankError('a bank document is written from a list of entries, got '+shown(entries));
}
const items=entries.map(function(entry,index){
const report=validate(entry);
if(!report.ok){
throw new BankError('entry #'+index+' cannot be written: '+report.problems.join('; '));
}
return{
name:entry.name,
slot:entry.slot,
createdAt:entry.createdAt,
settings:HexCodec.encode(entry.settings),
irIndex:entry.irIndex,
ir:HexCodec.encode(entry.ir),
irName:entry.irName,
};
});
return JSON.stringify({format:FORMAT,version:VERSION,items:items});
}
function rejectionText(rejection){
const named=rejection.name===''?'(unnamed)':'"'+rejection.name+'"';
return'#'+rejection.index+' '+named+': '+rejection.reason;
}
function summarise(acceptedCount,rejected){
const loaded=acceptedCount+' '+(acceptedCount===1?'configuration':'configurations');
if(rejected.length===0)return'imported '+loaded+', nothing rejected';
const first=rejected.slice(0,3).map(rejectionText).join('; ');
const rest=rejected.length>3?'; and '+(rejected.length-3)+' more':'';
return'imported '+loaded+', rejected '+rejected.length+': '+first+rest;
}
function readItem(item){
if(item===null||typeof item!=='object'||Array.isArray(item)){
throw new BankError('the entry is not an object');
}
for(const field of FIELDS){
if(!Object.prototype.hasOwnProperty.call(item,field)){
throw new BankError('the entry has no '+field);
}
}
if(typeof item.settings!=='string')throw new BankError('the settings are not whole bytes of hex');
const settings=HexCodec.decodeOrNull(item.settings);
if(settings===null)throw new BankError('the settings are not whole bytes of hex');
if(typeof item.ir!=='string')throw new BankError('the cabinet is not whole bytes of hex');
const ir=HexCodec.decodeOrNull(item.ir);
if(ir===null)throw new BankError('the cabinet is not whole bytes of hex');
const entry=createEntry({
name:item.name,
slot:item.slot,
createdAt:item.createdAt,
settings:settings,
irIndex:item.irIndex,
ir:ir,
irName:item.irName,
});
const report=validate(entry);
if(!report.ok)throw new BankError(report.problems[0]);
return entry;
}
function parseDocument(text){
if(typeof text!=='string')throw new BankError('a bank document is text, got '+shown(text));
let root;
try{
root=JSON.parse(text);
}catch(error){
throw new BankError('the file is not valid JSON');
}
if(root===null||typeof root!=='object'||Array.isArray(root)){
throw new BankError('the file is not valid JSON');
}
if(!Object.prototype.hasOwnProperty.call(root,'format'))throw new BankError('the file has no format');
if(root.format!==FORMAT){
throw new BankError('unexpected format '+shown(root.format)+", expected '"+FORMAT+"'");
}
if(!Object.prototype.hasOwnProperty.call(root,'version'))throw new BankError('the file has no version');
if(root.version!==VERSION){
throw new BankError('unsupported version '+shown(root.version)+', expected '+VERSION);
}
if(!Array.isArray(root.items))throw new BankError('the file has no items');
const accepted=[];
const rejected=[];
root.items.forEach(function(item,index){
try{
accepted.push(readItem(item));
}catch(error){
if(error===null||error.name!=='BankError')throw error;
const named=item!==null&&typeof item==='object'&&typeof item.name==='string'?item.name:'';
rejected.push({index:index,name:named,reason:error.message});
}
});
return{accepted:accepted,rejected:rejected,summary:summarise(accepted.length,rejected)};
}
const FULL_BANK='cubesuite-bank.json';
const FALLBACK_NAME='preset.json';
const MAX_NAME=60;
function isAllowed(character){
return/[\p{L}\p{N}]/u.test(character)||character==='-'||character==='_'||character===' ';
}
const BackupFileNames={
FULL_BANK:FULL_BANK,
FALLBACK:FALLBACK_NAME,
forEntry(name){
const source=asText(name,'the name');
let sanitised='';
for(let i=0;i<source.length;i++){
const character=source[i];
sanitised+=isAllowed(character)?character:'_';
}
sanitised=sanitised.trim().slice(0,MAX_NAME).trim();
if(!/[\p{L}\p{N}]/u.test(sanitised))return FALLBACK_NAME;
return sanitised+'.json';
},
};
const INDEX_KEY='rigshade-bank:index.json';
const IR_PREFIX='rigshade-bank:ir/';
const INDEX_FORMAT='rigcanvas-bank';
function newId(){
if(!global.crypto||typeof global.crypto.getRandomValues!=='function'){
throw new BankError('this browser has no crypto.getRandomValues to mint an entry id');
}
const bytes=new Uint8Array(16);
global.crypto.getRandomValues(bytes);
bytes[6]=(bytes[6]&0x0f)|0x40;
bytes[8]=(bytes[8]&0x3f)|0x80;
const hex=HexCodec.encode(bytes).toLowerCase();
return(
hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+
hex.slice(16,20)+'-'+hex.slice(20)
);
}
function defaultStorage(){
try{
const found=global.localStorage;
if(found)return found;
}catch(error){
throw new BankError('this page cannot reach localStorage: '+(error&&error.message?error.message:error));
}
throw new BankError('this page has no localStorage to keep a bank in');
}
function createStore(storage){
const backing=storage===undefined?defaultStorage():storage;
if(
backing===null||typeof backing!=='object'||
typeof backing.getItem!=='function'||
typeof backing.setItem!=='function'||
typeof backing.removeItem!=='function'
){
throw new BankError('a bank store needs { getItem, setItem, removeItem }');
}
function write(key,text){
try{
backing.setItem(key,text);
}catch(error){
throw new BankError('the bank could not be written: '+(error&&error.message?error.message:error));
}
}
function readIr(id){
const text=backing.getItem(IR_PREFIX+id);
if(text===null||text===undefined)return new Uint8Array(0);
const decoded=HexCodec.decodeOrNull(text);
return decoded===null?new Uint8Array(0):decoded;
}
function writeIndex(entries){
write(
INDEX_KEY,
JSON.stringify({
format:INDEX_FORMAT,
version:1,
items:entries.map(function(entry){
return{
id:entry.id,
name:entry.name,
slot:entry.slot,
createdAt:entry.createdAt,
settings:HexCodec.encode(entry.settings),
irIndex:entry.irIndex,
irName:entry.irName,
};
}),
})
);
}
function list(){
const text=backing.getItem(INDEX_KEY);
if(text===null||text===undefined)return[];
let root;
try{
root=JSON.parse(text);
}catch(error){
return[];
}
if(root===null||typeof root!=='object'||!Array.isArray(root.items))return[];
const out=[];
for(const item of root.items){
if(item===null||typeof item!=='object')continue;
const settings=HexCodec.decodeOrNull(typeof item.settings==='string'?item.settings:'');
if(settings===null)continue;
const id=typeof item.id==='string'?item.id:'';
out.push(
createEntry({
name:item.name,
slot:item.slot,
createdAt:item.createdAt,
settings:settings,
irIndex:item.irIndex,
ir:id===''?new Uint8Array(0):readIr(id),
irName:item.irName,
id:id,
})
);
}
return out;
}
function add(entry){
const report=validate(entry);
if(!report.ok){
throw new BankError('the configuration was not stored: '+report.problems.join('; '));
}
const id=entry.id===''?newId():entry.id;
const stored=createEntry({
name:entry.name,
slot:entry.slot,
createdAt:entry.createdAt>0?entry.createdAt:Date.now(),
settings:entry.settings,
irIndex:entry.irIndex,
ir:entry.ir,
irName:entry.irName,
id:id,
});
if(stored.ir.length>0){
write(IR_PREFIX+id,HexCodec.encode(stored.ir));
}else{
backing.removeItem(IR_PREFIX+id);
}
writeIndex(list().filter((other)=>other.id!==id).concat([stored]));
return stored;
}
function remove(id){
const entries=list().filter((other)=>other.id!==id);
backing.removeItem(IR_PREFIX+id);
writeIndex(entries);
}
function get(id){
const found=list().filter((entry)=>entry.id===id);
return found.length===0?null:found[0];
}
return{list:list,add:add,remove:remove,get:get};
}
global.RigShadeBank={
BankError,
FORMAT,
VERSION,
USER_IR_INDEX,
NO_IR_INDEX,
HexCodec,
Cabinet,
createEntry,
validate,
encodeDocument,
parseDocument,
createStore,
BackupFileNames,
};
})(typeof globalThis!=='undefined'?globalThis:this);