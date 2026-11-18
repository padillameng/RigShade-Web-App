(function(global){
'use strict';
class ProtocolError extends Error{
constructor(message){
super(message);
this.name='ProtocolError';
}
}
const MessageType=Object.freeze({
ACKNOWLEDGE:0x00,
REQUEST_NAME_VERSION:0x11,
ERASE:0x21,
WRITE:0x22,
READ:0x23,
REGISTER_WRITE:0x24,
});
const TYPE_NAMES=new Map([
[MessageType.ACKNOWLEDGE,'ACKNOWLEDGE'],
[MessageType.REQUEST_NAME_VERSION,'REQUEST_NAME_VERSION'],
[MessageType.ERASE,'ERASE'],
[MessageType.WRITE,'WRITE'],
[MessageType.READ,'READ'],
[MessageType.REGISTER_WRITE,'REGISTER_WRITE'],
]);
function typeLabel(code){
const name=TYPE_NAMES.get(code);
return name===undefined?'unknown 0x'+hex2(code):name;
}
function hex2(value){
return(value&0xFF).toString(16).toUpperCase().padStart(2,'0');
}
function toHex(bytes){
const parts=[];
for(const byte of bytes)parts.push(hex2(byte));
return parts.join(' ');
}
function fromHex(text){
const digits=String(text).trim().split(/[^0-9a-fA-F]+/).filter((part)=>part.length>0);
const out=new Uint8Array(digits.length);
digits.forEach((part,i)=>{
if(part.length>2)throw new ProtocolError('"'+part+'" is not a byte');
out[i]=parseInt(part,16);
});
return out;
}
const MemoryMap=Object.freeze({
ROM:0x00,
LIVE_IR:0x04,
SETTINGS:0x05,
PRESET_BYTES:16,
PRESET_COUNT:3,
PRESET_BLOCK_BYTES:48,
PRESET_BLOCK_OFFSET:14,
LIVE_BASE:0x80000000,
READ_BODY_PREFIX:8,
IR_ROM_MEMORY:0x00,
IR_SLOT_BASE:0x00069000,
IR_SLOT_STRIDE:0x1000,
IR_SLOT_COUNT:8,
IR_USER_SLOT_INDEX:7,
IR_USER_SLOT_ADDRESS:0x00070000,
liveAddress(presetIndex,code){
return(MemoryMap.LIVE_BASE|((presetIndex<<4)|code))>>>0;
},
isLiveAddress(address){
const unsigned=address>>>0;
if(unsigned>>>24!==0x80)return false;
for(let preset=0;preset<MemoryMap.PRESET_COUNT;preset++){
for(const param of Params.ALL){
if(unsigned===MemoryMap.liveAddress(preset,param.code))return true;
}
}
return false;
},
});
const SevenBit={
packedLength(clearBytes){
return Math.floor((clearBytes*8+6)/7);
},
clearLength(packedBytes){
return Math.floor((packedBytes*7)/8);
},
pack(clear){
const out=new Uint8Array(SevenBit.packedLength(clear.length));
let pos=0;
for(const byte of clear){
for(let i=0;i<8;i++){
if((byte>>i)&1){
const index=Math.floor(pos/7);
out[index]|=1<<(pos%7);
}
pos++;
}
}
return out;
},
unpack(packed){
const out=new Uint8Array(SevenBit.clearLength(packed.length));
let pos=0;
for(let i=0;i<out.length;i++){
let value=0;
for(let j=0;j<8;j++){
const bit=(packed[Math.floor(pos/7)]>>(pos%7))&1;
value|=bit<<j;
pos++;
}
out[i]=value;
}
return out;
},
};
const Envelope={
HEADER0:0x00,
HEADER1:0x59,
FIXED_BYTES:6,
CHECKSUM_BYTES:1,
checksum(body){
let sum=0;
for(const byte of body)sum+=byte;
return~sum&0xFF;
},
build(type,body){
const out=new Uint8Array(Envelope.FIXED_BYTES+body.length+Envelope.CHECKSUM_BYTES);
out[0]=Envelope.HEADER0;
out[1]=Envelope.HEADER1;
out[2]=type;
Envelope.writeLe24(out,3,body.length);
out.set(body,Envelope.FIXED_BYTES);
out[Envelope.FIXED_BYTES+body.length]=Envelope.checksum(body);
return out;
},
parse(clear){
if(clear.length<Envelope.FIXED_BYTES+Envelope.CHECKSUM_BYTES){
throw new ProtocolError('block too short: '+clear.length+' bytes');
}
if(clear[0]!==Envelope.HEADER0||clear[1]!==Envelope.HEADER1){
throw new ProtocolError('bad header');
}
if(!TYPE_NAMES.has(clear[2])){
throw new ProtocolError('unknown message type 0x'+hex2(clear[2]));
}
const declared=Envelope.readLe24(clear,3);
if(Envelope.FIXED_BYTES+declared+Envelope.CHECKSUM_BYTES!==clear.length){
throw new ProtocolError('declared body '+declared+' does not match block '+clear.length);
}
const body=clear.slice(Envelope.FIXED_BYTES,Envelope.FIXED_BYTES+declared);
const expected=Envelope.checksum(body);
const found=clear[clear.length-1];
if(found!==expected){
throw new ProtocolError(
'checksum 0x'+hex2(found)+' does not close the body sum (expected 0x'+hex2(expected)+')'
);
}
return{type:clear[2],body:body};
},
readData(clear,requestedSize){
const parsed=Envelope.parse(clear);
if(parsed.type!==MessageType.READ){
throw new ProtocolError('expected READ, got '+typeLabel(parsed.type));
}
if(parsed.body.length<MemoryMap.READ_BODY_PREFIX){
throw new ProtocolError('read body too short: '+parsed.body.length);
}
const reported=Envelope.readLe24(parsed.body,5);
if(reported<requestedSize){
throw new ProtocolError(
'reported '+reported+' bytes is less than the '+requestedSize+' requested'
);
}
return parsed.body.slice(MemoryMap.READ_BODY_PREFIX);
},
writeLe24(out,offset,value){
out[offset]=value&0xFF;
out[offset+1]=(value>>8)&0xFF;
out[offset+2]=(value>>16)&0xFF;
},
readLe24(src,offset){
return src[offset]|(src[offset+1]<<8)|(src[offset+2]<<16);
},
writeLe32(out,offset,value){
const unsigned=value>>>0;
out[offset]=unsigned&0xFF;
out[offset+1]=(unsigned>>>8)&0xFF;
out[offset+2]=(unsigned>>>16)&0xFF;
out[offset+3]=(unsigned>>>24)&0xFF;
},
readLe32(src,offset){
return(src[offset]|(src[offset+1]<<8)|(src[offset+2]<<16)|(src[offset+3]<<24))>>>0;
},
};
const ParamTable=[
{code:0,max:8,label:'TYPE',neutral:null,wake:null},
{code:1,max:7,label:'GAIN',neutral:null,wake:null},
{code:2,max:15,label:'TONE',neutral:null,wake:null},
{code:3,max:15,label:'REVERB',neutral:[0],wake:6},
{code:4,max:127,label:'FB',neutral:[0],wake:5},
{code:5,max:127,label:'VOLUME',neutral:null,wake:null},
{code:6,max:31,label:'TIME',neutral:[0],wake:5},
{code:7,max:118,label:'MIX',neutral:[0],wake:7},
{code:8,max:15,label:'MOD',neutral:[7,8],wake:0},
{code:9,max:8,label:'IR',neutral:[0],wake:1},
{code:10,max:1,label:'CAB_SW',neutral:null,wake:null},
{code:11,max:1,label:'MOD_SW',neutral:null,wake:null},
{code:12,max:1,label:'AMP_SW',neutral:null,wake:null},
];
const ParamByCode=new Map(ParamTable.map((param)=>[param.code,param]));
const Params={
ALL:ParamTable,
byCode(code){
const param=ParamByCode.get(code);
if(param===undefined)throw new ProtocolError('no parameter with code '+code);
return param;
},
hasOffState(param){
return param.neutral!==null;
},
isOff(param,value){
return param.neutral!==null&&param.neutral.indexOf(value)>=0;
},
clamp(param,value){
const number=Math.round(Number(value));
if(!Number.isFinite(number))throw new ProtocolError('"'+value+'" is not a number');
return Math.min(Math.max(number,0),param.max);
},
};
const PreampNames=[
'Power-Zone Clean',
'US Gold 100 Clean',
'Two Stone Coral OD',
'Doctor3 B',
'Cali JP A',
'Day Tripper OD',
'Shittcow Dist',
'Wo Stone Coral OD',
'Mr Smith Dist',
];
const ModNames=Object.freeze({
CHORUS:'CHORUS',
PHASER:'PHASER',
sectionFor(value){
if(value>=0&&value<=6)return ModNames.CHORUS;
if(value>=9&&value<=15)return ModNames.PHASER;
return null;
},
});
const CabinetNames=[
'IR off',
'Line 6 Vetta',
'Marshall 1960AV',
'Marshall 1960A T75 LA610',
'VHT Deliverance',
'Soldano',
'Peavey 5150 + Mesa Oversized',
'JSX KT77 + Mesa Stiletto',
'Diezel V30 SM57',
];
function describe(code,value){
const param=Params.byCode(code);
if(param.code===0)return PreampNames[value]||param.label+' '+value;
if(param.code===9)return CabinetNames[value]||param.label+' '+value;
if(param.code===8){
const section=ModNames.sectionFor(value);
return section===null?'off':section;
}
if(param.code===10||param.code===11||param.code===12)return value===1?'ON':'OFF';
if(Params.isOff(param,value))return'off';
return String(value);
}
const Commands={
requestNameVersion(){
return Envelope.build(MessageType.REQUEST_NAME_VERSION,new Uint8Array(0));
},
readRequest(memory,address,size){
if(!(size>=0))throw new ProtocolError('size must not be negative');
const body=new Uint8Array(MemoryMap.READ_BODY_PREFIX);
body[0]=memory&0xFF;
Envelope.writeLe32(body,1,address);
Envelope.writeLe24(body,5,size);
return Envelope.build(MessageType.READ,body);
},
writeRequest(memory,address,data){
const body=new Uint8Array(MemoryMap.READ_BODY_PREFIX+data.length);
body[0]=memory&0xFF;
Envelope.writeLe32(body,1,address);
Envelope.writeLe24(body,5,data.length);
body.set(data,MemoryMap.READ_BODY_PREFIX);
return Envelope.build(MessageType.WRITE,body);
},
readPresetsRequest(){
return Commands.readRequest(MemoryMap.SETTINGS,0,MemoryMap.PRESET_BLOCK_BYTES);
},
savePresetsRequest(block){
if(block.length!==MemoryMap.PRESET_BLOCK_BYTES){
throw new ProtocolError('the preset block is '+MemoryMap.PRESET_BLOCK_BYTES+' bytes, got '+block.length);
}
return Commands.writeRequest(MemoryMap.SETTINGS,0,block);
},
liveParamRequest(presetIndex,code,value){
if(!(presetIndex>=0&&presetIndex<MemoryMap.PRESET_COUNT)){
throw new ProtocolError('preset '+presetIndex+' does not exist');
}
const param=Params.byCode(code);
const clamped=Params.clamp(param,value);
return Commands.writeRequest(
MemoryMap.SETTINGS,
MemoryMap.liveAddress(presetIndex,param.code),
Uint8Array.of(clamped)
);
},
toWire(clear){
const packed=SevenBit.pack(clear);
const out=new Uint8Array(packed.length+2);
out[0]=0xF0;
out.set(packed,1);
out[out.length-1]=0xF7;
return out;
},
fromWire(message){
if(message.length<2||message[0]!==0xF0||message[message.length-1]!==0xF7){
throw new ProtocolError('not a SysEx message');
}
return SevenBit.unpack(message.slice(1,message.length-1));
},
};
const Presets={
fromBlock(block){
if(block.length!==MemoryMap.PRESET_BLOCK_BYTES){
throw new ProtocolError('the preset block is '+MemoryMap.PRESET_BLOCK_BYTES+' bytes, got '+block.length);
}
const out=[];
for(let i=0;i<MemoryMap.PRESET_COUNT;i++){
out.push(block.slice(i*MemoryMap.PRESET_BYTES,(i+1)*MemoryMap.PRESET_BYTES));
}
return out;
},
toBlock(presets){
if(presets.length!==MemoryMap.PRESET_COUNT){
throw new ProtocolError('expected '+MemoryMap.PRESET_COUNT+' presets, got '+presets.length);
}
const out=new Uint8Array(MemoryMap.PRESET_BLOCK_BYTES);
presets.forEach((preset,i)=>{
if(preset.length!==MemoryMap.PRESET_BYTES){
throw new ProtocolError('a preset is '+MemoryMap.PRESET_BYTES+' bytes, got '+preset.length);
}
out.set(preset,i*MemoryMap.PRESET_BYTES);
});
return out;
},
fromReadData(data){
if(data.length<MemoryMap.PRESET_BLOCK_BYTES){
throw new ProtocolError(
'expected at least '+MemoryMap.PRESET_BLOCK_BYTES+' data bytes, got '+data.length
);
}
return Presets.fromBlock(data.slice(0,MemoryMap.PRESET_BLOCK_BYTES));
},
};
const Acknowledgement={
CLEAR:fromHex('00 59 00 01 00 00 00 FF'),
isClear(clear){
const parsed=Envelope.parse(clear);
return parsed.type===MessageType.ACKNOWLEDGE&&parsed.body.length===1;
},
isWire(message){
try{
return Acknowledgement.isClear(Commands.fromWire(message));
}catch(error){
return false;
}
},
isAnswerTo(request){
const type=Envelope.parse(request).type;
return(
type===MessageType.WRITE||type===MessageType.ERASE||type===MessageType.REGISTER_WRITE
);
},
};
function bytesEqual(left,right){
if(left.length!==right.length)return false;
for(let i=0;i<left.length;i++)if(left[i]!==right[i])return false;
return true;
}
function asciiTrim(bytes){
let text='';
for(const byte of bytes)text+=String.fromCharCode(byte);
return text.replace(/[\u0000-\u001F]+/g,' ').trim();
}
global.RigShadeProtocol={
ProtocolError,
MessageType,
typeLabel,
toHex,
fromHex,
MemoryMap,
SevenBit,
Envelope,
Commands,
Params,
PreampNames,
ModNames,
CabinetNames,
describe,
Presets,
Acknowledgement,
bytesEqual,
asciiTrim,
};
})(typeof globalThis!=='undefined'?globalThis:this);