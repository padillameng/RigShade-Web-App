(function(global){
'use strict';
const P=global.RigShadeProtocol;
if(!P)throw new Error('session.js needs protocol.js');
const{Commands,Envelope,MemoryMap,MessageType,Params,Presets,ProtocolError}=P;
function needCabinet(){
const cabinet=global.RigShadeCabinet;
if(!cabinet)throw new SessionError('this operation needs cabinet.js, which the page has not loaded');
return cabinet;
}
function needBank(){
const bank=global.RigShadeBank;
if(!bank)throw new SessionError('this operation needs bank.js, which the page has not loaded');
return bank;
}
class SessionError extends Error{
constructor(message){
super(message);
this.name='SessionError';
}
}
const Timing=Object.freeze({
STEP_SETTLE_MS:80,
FLASH_SETTLE_MS:250,
CHUNK_DELAY_MS:40,
PARAMETER_DELAY_MS:15,
IR_WRITE_CHUNK:128,
ROM_READ_CHUNK:113,
CABINET_SETTLE_MS:350,
LIVE_VERIFY_BYTES:68,
});
const SECTOR_BYTES=4096;
const LIVE_BYTES=2052;
const LiveIr=Object.freeze({
MEMORY:MemoryMap.LIVE_IR,
FLAG_ADDRESS:0x00000764,
DATA_ADDRESS:0x00000768,
DATA_END:0x00000768+LIVE_BYTES,
});
const UserSlot=Object.freeze({
MEMORY:MemoryMap.ROM,
ADDRESS:MemoryMap.IR_USER_SLOT_ADDRESS,
END:MemoryMap.IR_USER_SLOT_ADDRESS+SECTOR_BYTES,
});
const Messages={
eraseRequest(memory,address){
const body=new Uint8Array(5);
body[0]=memory&0xFF;
Envelope.writeLe32(body,1,address);
return Envelope.build(MessageType.ERASE,body);
},
registerWriteRequest(memory,address,value){
const body=new Uint8Array(9);
body[0]=memory&0xFF;
Envelope.writeLe32(body,1,address);
Envelope.writeLe32(body,5,value);
return Envelope.build(MessageType.REGISTER_WRITE,body);
},
};
function hex32(address){
return'0x'+(address>>>0).toString(16).toUpperCase().padStart(8,'0');
}
function hex2(value){
return'0x'+(value&0xFF).toString(16).toUpperCase().padStart(2,'0');
}
function inside(address,size,start,end){
return size>0&&address>=start&&address+size<=end;
}
const ALLOWED=
'this page sends the name request, the settings reads and writes, one-byte live parameter '+
'writes, reads and chunked writes of the user cabinet slot '+
hex32(UserSlot.ADDRESS)+
' with its erase, and the live cabinet window at '+
hex32(LiveIr.DATA_ADDRESS)+
' with its flag register at '+
hex32(LiveIr.FLAG_ADDRESS);
function assertSendable(clear){
const parsed=Envelope.parse(clear);
switch(parsed.type){
case MessageType.REQUEST_NAME_VERSION:
if(parsed.body.length!==0)throw new SessionError('the name request carries no body');
return parsed;
case MessageType.READ:{
if(parsed.body.length!==MemoryMap.READ_BODY_PREFIX){
throw new SessionError('a read request is 8 body bytes, got '+parsed.body.length);
}
const memory=parsed.body[0];
const address=Envelope.readLe32(parsed.body,1);
const size=Envelope.readLe24(parsed.body,5);
if(memory===MemoryMap.SETTINGS)return parsed;
if(memory===UserSlot.MEMORY){
if(!inside(address,size,UserSlot.ADDRESS,UserSlot.END)){
throw new SessionError(
'refusing a read of '+size+' byte(s) at '+hex32(address)+' in the ROM: only the user cabinet '+
'slot '+hex32(UserSlot.ADDRESS)+'..'+hex32(UserSlot.END-1)+' is read, the seven factory '+
'slots are named from the manual instead'
);
}
return parsed;
}
if(memory===LiveIr.MEMORY){
if(address!==LiveIr.DATA_ADDRESS||size!==Timing.LIVE_VERIFY_BYTES){
throw new SessionError(
'refusing a read of '+size+' byte(s) at '+hex32(address)+' in the live IR memory '+
hex2(memory)+': the only read the page makes there is the '+Timing.LIVE_VERIFY_BYTES+
'-byte check at '+hex32(LiveIr.DATA_ADDRESS)
);
}
return parsed;
}
throw new SessionError(
'refusing a read in memory selector '+hex2(memory)+' at '+hex32(address)+': '+ALLOWED
);
}
case MessageType.WRITE:{
if(parsed.body.length<MemoryMap.READ_BODY_PREFIX){
throw new SessionError('a write request is at least 8 body bytes, got '+parsed.body.length);
}
const memory=parsed.body[0];
const address=Envelope.readLe32(parsed.body,1);
const size=Envelope.readLe24(parsed.body,5);
if(parsed.body.length!==MemoryMap.READ_BODY_PREFIX+size){
throw new SessionError(
'a write declares '+size+' byte(s) and carries '+(parsed.body.length-MemoryMap.READ_BODY_PREFIX)
);
}
const data=parsed.body.slice(MemoryMap.READ_BODY_PREFIX);
if(memory===MemoryMap.SETTINGS){
const wholeBlock=address===0&&size===MemoryMap.PRESET_BLOCK_BYTES;
const oneLiveValue=size===1&&MemoryMap.isLiveAddress(address);
if(!wholeBlock&&!oneLiveValue){
throw new SessionError(
'refusing a write of '+size+' byte(s) at '+hex32(address)+' in the settings memory: '+ALLOWED
);
}
return parsed;
}
if(memory===UserSlot.MEMORY){
if(!inside(address,size,UserSlot.ADDRESS,UserSlot.END)||size>Timing.IR_WRITE_CHUNK){
throw new SessionError(
'refusing a write of '+size+' byte(s) at '+hex32(address)+' in the ROM: only the user cabinet '+
'slot '+hex32(UserSlot.ADDRESS)+'..'+hex32(UserSlot.END-1)+', in chunks of at most '+
Timing.IR_WRITE_CHUNK+' bytes, is ever written'
);
}
return parsed;
}
if(memory===LiveIr.MEMORY){
const flag=address===LiveIr.FLAG_ADDRESS&&size===1&&(data[0]===0x00||data[0]===0x01);
const block=inside(address,size,LiveIr.DATA_ADDRESS,LiveIr.DATA_END)&&size<=Timing.IR_WRITE_CHUNK;
if(!flag&&!block){
throw new SessionError(
'refusing a write of '+size+' byte(s) at '+hex32(address)+' in the live IR memory '+
hex2(memory)+': the page writes the one-byte stage flag at '+hex32(LiveIr.FLAG_ADDRESS)+
' and the cabinet block at '+hex32(LiveIr.DATA_ADDRESS)+', in chunks of at most '+
Timing.IR_WRITE_CHUNK+' bytes'
);
}
return parsed;
}
throw new SessionError(
'refusing a write of '+size+' byte(s) at '+hex32(address)+' in memory selector '+
hex2(memory)+': '+ALLOWED
);
}
case MessageType.ERASE:{
if(parsed.body.length!==5){
throw new SessionError('an erase request is 5 body bytes, got '+parsed.body.length);
}
const memory=parsed.body[0];
const address=Envelope.readLe32(parsed.body,1);
if(memory!==UserSlot.MEMORY||address!==UserSlot.ADDRESS){
throw new SessionError(
'refusing an erase in memory selector '+hex2(memory)+' at '+hex32(address)+': only the user '+
'cabinet slot '+hex32(UserSlot.ADDRESS)+' is ever erased, and the factory slots 0..6 never are'
);
}
return parsed;
}
case MessageType.REGISTER_WRITE:{
if(parsed.body.length!==9){
throw new SessionError('a register write is 9 body bytes, got '+parsed.body.length);
}
const memory=parsed.body[0];
const address=Envelope.readLe32(parsed.body,1);
const known=memory===LiveIr.MEMORY&&(address===LiveIr.FLAG_ADDRESS||address===LiveIr.DATA_ADDRESS);
if(!known){
throw new SessionError(
'refusing a register write in memory selector '+hex2(memory)+' at '+hex32(address)+': the page '+
'writes registers only in the live IR memory '+hex2(LiveIr.MEMORY)+', at '+
hex32(LiveIr.FLAG_ADDRESS)+' or '+hex32(LiveIr.DATA_ADDRESS)
);
}
return parsed;
}
default:
throw new SessionError(
'refusing a '+P.typeLabel(parsed.type)+' request at '+hex32(Envelope.readLe32(parsed.body,1))+': '+ALLOWED
);
}
}
const RESET_VALUES=[
0,
4,
8,
0,
0,
127,
0,
0,
7,
1,
0,
1,
1,
];
function resetPreset(){
const out=new Uint8Array(MemoryMap.PRESET_BYTES);
for(let code=0;code<RESET_VALUES.length;code++)out[code]=RESET_VALUES[code];
return out;
}
function resetBlock(){
const out=new Uint8Array(MemoryMap.PRESET_BLOCK_BYTES);
for(let i=0;i<MemoryMap.PRESET_COUNT;i++)out.set(resetPreset(),i*MemoryMap.PRESET_BYTES);
return out;
}
const SILENT_AT=100;
const Audibility={
SILENT_AT,
problem(preset,cabinetDistancePercent){
if(preset.length<MemoryMap.PRESET_BYTES)throw new SessionError('a preset is 16 bytes');
if(preset[12]===0)return'the amp block is off';
if(preset[5]===0)return'the output level is at its floor';
if(
cabinetDistancePercent!==undefined&&
cabinetDistancePercent!==null&&
preset[10]!==0&&
Math.round(Number(cabinetDistancePercent))>=SILENT_AT
){
return'its cabinet holds the distance measured silent ('+needCabinet().SILENT_LINE+')';
}
return null;
},
};
function audibilityLine(slot,problem){
return(
'The block the pedal read back cannot be heard'+
(slot===null?'':' on '+['A','B','C'][slot])+
': '+problem
);
}
function muteReport(block){
const found=[];
for(let slot=0;slot<MemoryMap.PRESET_COUNT;slot++){
const preset=block.slice(slot*MemoryMap.PRESET_BYTES,(slot+1)*MemoryMap.PRESET_BYTES);
const problem=Audibility.problem(preset);
if(problem!==null)found.push({slot:slot,problem:problem,line:audibilityLine(slot,problem)});
}
return found;
}
function isErased(sector){
if(sector.length===0)return false;
for(let i=0;i<sector.length;i++)if(sector[i]!==0xFF)return false;
return true;
}
const SlotClean={
decide(previous,problem){
if(problem!==null&&problem!==undefined){
return{
outcome:'NOT_CLEARED',
reason:String(problem),
line:
'The user cabinet slot was not cleared ('+problem+'): it may still hold a cabinet. '+
'Press RESET again, or RESTORE if the cabinet that is in it matters',
};
}
if(previous===null||previous===undefined){
return{
outcome:'NOT_CLEARED',
reason:'the clean did not report what the slot held',
line:
'The user cabinet slot was not cleared: the clean did not report what the slot held. '+
'Press RESET again, or RESTORE if the cabinet that is in it matters',
};
}
if(isErased(previous)){
return{
outcome:'ALREADY_FREE',
reason:null,
line:
'The user cabinet slot was already empty, so nothing was erased and the slot is free for '+
'a new import',
};
}
return{
outcome:'CLEARED',
reason:null,
line:
'The user cabinet slot was cleared, so it is free for a new import; RESTORE puts the '+
'cabinet that was in it back',
};
},
};
const NOTHING_TO_UNDO='There is nothing to undo: this session has not reset the pedal';
function createSession(transport,options){
const settings=Object.assign(
{
timeoutMs:4000,
pause:function(ms){
return new Promise(function(resolve){
setTimeout(resolve,ms);
});
},
onStep:null,
},
options||{}
);
let localCopy=null;
let identity=null;
let heldCabinet=null;
let slotBackup=null;
let presetBackup=null;
let dirty=false;
let cabinetDepth=0;
function step(name){
if(typeof settings.onStep==='function')settings.onStep(name);
}
function pause(ms){
return settings.pause(ms);
}
async function cabinetWork(block){
cabinetDepth++;
try{
return await block();
}finally{
cabinetDepth--;
}
}
async function exchange(clear){
assertSendable(clear);
const answer=await transport.exchange(clear,settings.timeoutMs);
Envelope.parse(answer);
return answer;
}
async function sendLive(clear){
assertSendable(clear);
if(typeof transport.send==='function'){
await transport.send(clear);
return;
}
Envelope.parse(await transport.exchange(clear,settings.timeoutMs));
}
async function readWindow(memory,address,size,chunkSize,delayMs){
const out=new Uint8Array(size);
let done=0;
while(done<size){
const n=Math.min(chunkSize||size,size-done);
const data=Envelope.readData(
await exchange(Commands.readRequest(memory,address+done,n)),
n
);
out.set(data.subarray(0,n),done);
done+=n;
if(done<size&&delayMs>0)await pause(delayMs);
}
return out;
}
async function writeWindow(memory,address,data,chunkSize,delayMs){
let done=0;
while(done<data.length){
const n=Math.min(chunkSize,data.length-done);
await exchange(Commands.writeRequest(memory,address+done,data.slice(done,done+n)));
done+=n;
if(done<data.length&&delayMs>0)await pause(delayMs);
}
}
function snapshot(){
return localCopy===null?null:localCopy.map((preset)=>preset.slice());
}
function cabinetView(){
if(heldCabinet===null)return null;
return{
samples:heldCabinet.samples.slice(),
distance:heldCabinet.distance,
origin:heldCabinet.origin,
vouched:heldCabinet.vouched,
sector:heldCabinet.sector===null?null:heldCabinet.sector.slice(),
description:heldCabinet.description,
pending:typeof heldCabinet.pending==='number'?heldCabinet.pending:null,
};
}
async function requestName(){
const answer=await exchange(Commands.requestNameVersion());
const parsed=Envelope.parse(answer);
if(parsed.type!==MessageType.REQUEST_NAME_VERSION){
throw new SessionError('expected a name answer, got '+P.typeLabel(parsed.type));
}
const head=parsed.body.slice(0,Math.min(16,parsed.body.length));
identity={
name:P.asciiTrim(head),
tail:parsed.body.slice(19),
};
return identity;
}
async function readPresets(){
const answer=await exchange(Commands.readPresetsRequest());
const data=Envelope.readData(answer,MemoryMap.PRESET_BLOCK_BYTES);
localCopy=Presets.fromReadData(data);
dirty=false;
return snapshot();
}
async function writeLiveParam(presetIndex,code,value){
if(localCopy===null){
throw new SessionError(
'read the three presets first: the live window answers reads with zeros, so this page keeps '+
'its own copy of the values and has nothing to update before a read'
);
}
if(cabinetDepth>0){
throw new SessionError(
'a cabinet operation is in progress: a live value sent during one would land in the middle of it, '+
'so this page refuses it instead of queueing it. Try again when the cabinet work has finished'
);
}
const param=Params.byCode(code);
const clamped=Params.clamp(param,value);
await sendLive(Commands.liveParamRequest(presetIndex,param.code,clamped));
localCopy[presetIndex][param.code]=clamped;
dirty=true;
return clamped;
}
async function writeBlockAndVerify(block){
await exchange(Commands.savePresetsRequest(block));
const readBack=Envelope.readData(
await exchange(Commands.readPresetsRequest()),
MemoryMap.PRESET_BLOCK_BYTES
).slice(0,MemoryMap.PRESET_BLOCK_BYTES);
if(!P.bytesEqual(readBack,block))return null;
return readBack;
}
async function savePresets(){
if(localCopy===null){
throw new SessionError('the presets must be read from the pedal before saving');
}
const block=Presets.toBlock(localCopy);
const answer=await writeBlockAndVerify(block);
if(answer===null){
throw new SessionError(
'the presets did not read back as they were written; the pedal is holding other bytes. '+
'Read them again before saving, and check them before you rely on them'
);
}
localCopy=Presets.fromBlock(answer);
dirty=false;
const presets=snapshot();
presets.cabinet=null;
presets.cabinetError=null;
try{
presets.cabinet=await storePendingDistance();
}catch(error){
presets.cabinetError=error instanceof SessionError?error.message:String((error&&error.message)||error);
}
return presets;
}
async function readUserSector(){
const cabinet=needCabinet();
const plan=cabinet.readPlan();
const out=new Uint8Array(cabinet.SECTOR_BYTES);
for(const chunk of plan){
const data=Envelope.readData(
await exchange(Commands.readRequest(chunk.memory,chunk.address,chunk.size)),
chunk.size
);
out.set(data.subarray(0,chunk.size),chunk.address-cabinet.USER_SLOT_ADDRESS);
if(chunk.index<plan.length-1)await pause(cabinet.READ_PAUSE_MS);
}
return out;
}
function holdFromRead(sector,info){
const cabinet=needCabinet();
if(info===null||info.erased||!info.present)return null;
if(info.distance===null)return null;
let silent=true;
for(let i=0;i<info.samples.length;i++)if(info.samples[i]!==0)silent=false;
if(silent)return null;
return{
samples:info.samples.slice(),
distance:info.distance,
origin:'READ_FROM_PEDAL',
vouched:true,
sector:sector.slice(),
description:cabinet.describeSector(sector),
};
}
function holdFromWrite(sector,percent,samples){
return{
samples:samples.slice(),
distance:percent,
origin:'WRITTEN_TO_PEDAL',
vouched:true,
sector:sector===null?null:sector.slice(),
description:sector===null?null:needCabinet().describeSector(sector),
};
}
async function readCabinet(){
const cabinet=needCabinet();
return cabinetWork(async function(){
step('reading');
const sector=await readUserSector();
const info=cabinet.parseSector(sector);
if(info===null){
throw new SessionError(
'the pedal answered with a block that is not a cabinet sector: '+cabinet.describeSector(sector)
);
}
heldCabinet=holdFromRead(sector,info);
return{
sector:sector,
present:info.present,
erased:info.erased,
isFactory:info.isFactory,
isUser:info.isUser,
marker:info.marker,
distance:info.distance,
samples:info.samples.slice(),
description:cabinet.describeSector(sector),
held:cabinetView(),
};
});
}
async function applyLiveBlock(liveBlock){
if(liveBlock.length!==LIVE_BYTES){
throw new SessionError('the live cabinet block is '+LIVE_BYTES+' bytes, got '+liveBlock.length);
}
await exchange(Commands.writeRequest(LiveIr.MEMORY,LiveIr.FLAG_ADDRESS,Uint8Array.of(0x00)));
await pause(Timing.STEP_SETTLE_MS);
await exchange(Messages.registerWriteRequest(LiveIr.MEMORY,LiveIr.FLAG_ADDRESS,1));
await pause(Timing.STEP_SETTLE_MS);
await writeWindow(LiveIr.MEMORY,LiveIr.DATA_ADDRESS,liveBlock,Timing.IR_WRITE_CHUNK,Timing.CHUNK_DELAY_MS);
await exchange(Messages.registerWriteRequest(LiveIr.MEMORY,LiveIr.DATA_ADDRESS,liveBlock.length));
await pause(Timing.STEP_SETTLE_MS);
await exchange(Commands.writeRequest(LiveIr.MEMORY,LiveIr.FLAG_ADDRESS,Uint8Array.of(0x01)));
await pause(Timing.STEP_SETTLE_MS);
await exchange(Messages.registerWriteRequest(LiveIr.MEMORY,LiveIr.FLAG_ADDRESS,1));
await pause(Timing.STEP_SETTLE_MS);
const readBack=await readWindow(
LiveIr.MEMORY,
LiveIr.DATA_ADDRESS,
Timing.LIVE_VERIFY_BYTES,
Timing.LIVE_VERIFY_BYTES,
0
);
if(!P.bytesEqual(readBack,liveBlock.slice(0,Timing.LIVE_VERIFY_BYTES))){
throw new SessionError('the cabinet did not read back as it was written to live memory');
}
}
function sectorRefusal(sector){
return needBank().Cabinet.sectorProblem(sector);
}
async function eraseWriteVerify(sector,readBackup){
if(!(sector instanceof Uint8Array)||sector.length!==SECTOR_BYTES){
const length=sector instanceof Uint8Array?sector.length:typeof sector;
throw new SessionError(
'refusing the cabinet write, nothing was sent to the pedal: a sector is '+SECTOR_BYTES+' bytes, got '+length
);
}
const refusal=sectorRefusal(sector);
if(refusal!==null){
throw new SessionError('refusing the cabinet write, nothing was sent to the pedal: '+refusal);
}
let backup=null;
if(readBackup){
step('backing up');
backup=await readUserSector();
slotBackup=backup.slice();
}
try{
step('erasing');
await exchange(Messages.eraseRequest(UserSlot.MEMORY,UserSlot.ADDRESS));
await pause(Timing.FLASH_SETTLE_MS);
step('writing');
await writeWindow(UserSlot.MEMORY,UserSlot.ADDRESS,sector,Timing.IR_WRITE_CHUNK,Timing.CHUNK_DELAY_MS);
await pause(Timing.FLASH_SETTLE_MS);
step('verifying');
const readBack=await readUserSector();
if(!P.bytesEqual(readBack,sector)){
heldCabinet=null;
throw new SessionError(
readBackup
?'the cabinet slot did not read back as it was written; use RESTORE to put the previous cabinet back'
:'the restored cabinet did not read back as it was written'
);
}
return backup;
}catch(error){
heldCabinet=null;
throw error;
}
}
async function uploadCabinet(file,options){
const cabinet=needCabinet();
const decoded=cabinet.decodeWav(file);
const samples=cabinet.toIrRate(decoded);
const gate=cabinet.samplesProblem(samples);
if(gate!==null)throw new SessionError(cabinet.refusalMessage(gate));
const requested=options&&options.distance!==undefined?options.distance:undefined;
const percent=cabinet.clampPercent(
requested===undefined
?heldCabinet===null
?cabinet.distanceRange.default
:heldCabinet.distance
:requested
);
const sector=cabinet.buildSector({samples:samples,distance:percent});
const live=cabinet.buildLiveBlock({samples:samples,distance:percent});
const payload=cabinet.payloadProblem(sector,live);
if(payload!==null)throw new SessionError(cabinet.refusalMessage(payload));
return cabinetWork(async function(){
const backup=await eraseWriteVerify(sector,true);
heldCabinet=holdFromWrite(sector,percent,samples);
return{
sector:sector,
live:live,
distance:percent,
previous:backup,
description:cabinet.describeSector(sector),
silent:cabinet.silentAt(percent),
held:cabinetView(),
};
});
}
async function restoreCabinet(sector){
const cabinet=needCabinet();
const bytes=sector instanceof Uint8Array?sector.slice():new Uint8Array(sector);
return cabinetWork(async function(){
await eraseWriteVerify(bytes,false);
const info=cabinet.parseSector(bytes);
heldCabinet=holdFromRead(bytes,info);
slotBackup=null;
return{
sector:bytes,
description:cabinet.describeSector(bytes),
held:cabinetView(),
};
});
}
async function moveDistance(value){
const cabinet=needCabinet();
if(heldCabinet===null){
throw new SessionError(
'the page holds no cabinet to rebuild: read the cabinet slot, or import one, before moving the mic distance'
);
}
const percent=cabinet.clampPercent(value);
const samples=heldCabinet.samples.slice();
const live=cabinet.buildLiveBlock({samples:samples,distance:percent});
return cabinetWork(async function(){
step('cabinet');
await applyLiveBlock(live);
const stored=heldCabinet.distance;
const pending=stored===percent?null:percent;
heldCabinet={
samples:samples,
distance:percent,
origin:heldCabinet.origin,
vouched:heldCabinet.vouched,
sector:heldCabinet.sector===null?null:heldCabinet.sector.slice(),
description:heldCabinet.description,
pending:pending,
};
return{
outcome:'live',
percent:percent,
reason:pending===null?'SLOT_HOLDS_THIS':'NOT_STORED_YET',
line:
pending===null
?'The pedal\'s stored cabinet already holds '+percent+'%, so nothing needed writing'
:'MIC DIST is '+percent+'% and the pedal is playing it. SAVE writes it into the cabinet '+
'slot so a bank change keeps it; until then the slot holds '+
(stored===undefined||stored===null?'a distance the page has not read':stored+'%'),
previous:null,
silent:cabinet.silentAt(percent),
held:cabinetView(),
};
});
}
async function storePendingDistance(){
const cabinet=needCabinet();
if(heldCabinet===null)return null;
const percent=heldCabinet.pending;
if(!Number.isFinite(percent))return null;
const samples=heldCabinet.samples.slice();
const sector=cabinet.buildSector({samples:samples,distance:percent});
const live=cabinet.buildLiveBlock({samples:samples,distance:percent});
const payload=cabinet.payloadProblem(sector,live);
if(payload!==null)throw new SessionError(cabinet.refusalMessage(payload));
return cabinetWork(async function(){
step('cabinet');
const previous=await eraseWriteVerify(sector,true);
heldCabinet=holdFromWrite(sector,percent,samples);
return{
percent:percent,
previous:previous,
silent:cabinet.silentAt(percent),
held:cabinetView(),
};
});
}
async function cleanUserSlot(){
return cabinetWork(async function(){
let previous=null;
try{
step('reading');
previous=await readUserSector();
slotBackup=previous.slice();
if(isErased(previous)){
step('already free');
heldCabinet=null;
return SlotClean.decide(previous,null);
}
step('erasing');
await exchange(Messages.eraseRequest(UserSlot.MEMORY,UserSlot.ADDRESS));
await pause(Timing.FLASH_SETTLE_MS);
step('verifying');
const readBack=await readUserSector();
if(!isErased(readBack)){
throw new SessionError(
'the cabinet slot did not read back erased; it still holds bytes the erase did not clear — '+
'use RESTORE to put the cabinet that was there back'
);
}
heldCabinet=null;
return SlotClean.decide(previous,null);
}catch(error){
heldCabinet=null;
if(previous!==null)slotBackup=previous.slice();
return SlotClean.decide(null,error&&error.message?error.message:String(error));
}
});
}
async function resetPresets(options){
if(localCopy===null){
throw new SessionError(
'Factory reset needs the presets read from the pedal first. It writes all three memories at '+
'once, so resetting from an unread block would erase the two the page is not carrying. '+
'Read them, then try again'
);
}
const block=
options&&options.block!==undefined?(options.block instanceof Uint8Array?options.block.slice():new Uint8Array(options.block)):resetBlock();
if(block.length!==MemoryMap.PRESET_BLOCK_BYTES){
throw new SessionError(
'the reset block is '+MemoryMap.PRESET_BLOCK_BYTES+' bytes, got '+block.length
);
}
return cabinetWork(async function(){
step('reading');
const previous=Envelope.readData(
await exchange(Commands.readPresetsRequest()),
MemoryMap.PRESET_BLOCK_BYTES
).slice(0,MemoryMap.PRESET_BLOCK_BYTES);
presetBackup=previous.slice();
step('writing');
const readBack=await writeBlockAndVerify(block);
if(readBack===null){
throw new SessionError(
'Factory reset failed: the presets did not read back as they were written. The pedal is not known '+
'to hold the initial values — try again, or press UNDO to put back the block it held before'
);
}
localCopy=Presets.fromBlock(readBack);
dirty=false;
const slot=await cleanUserSlot();
const mute=muteReport(readBack);
return{
block:readBack,
previous:previous,
slot:slot,
mute:mute,
line:
'Factory reset: the documented initial values are written to A, B and C (not the presets the pedal '+
'shipped with). UNDO puts the block the pedal held before back, until the page is closed. '+
slot.line+
(mute.length===0?'':'. '+mute.map((entry)=>entry.line).join('. ')),
};
});
}
async function undoReset(){
if(presetBackup===null)return{undone:false,line:NOTHING_TO_UNDO};
if(localCopy===null){
throw new SessionError(
'UNDO needs the presets read from the pedal first — writing the kept block back is a save, and a '+
'save replaces all three memories at once'
);
}
const kept=presetBackup.slice();
return cabinetWork(async function(){
step('writing');
const readBack=await writeBlockAndVerify(kept);
if(readBack===null){
throw new SessionError(
'UNDO failed: the block did not read back as it was written. The pedal is not known to hold either '+
'block — press UNDO again before you rely on what is in it'
);
}
localCopy=Presets.fromBlock(readBack);
presetBackup=null;
dirty=false;
const mute=muteReport(readBack);
return{
undone:true,
block:readBack,
mute:mute,
line:
'UNDO: the block the pedal held before the reset is written back to A, B and C. Nothing else is '+
'kept: a further UNDO would write this same block again'+
(mute.length===0?'':'. '+mute.map((entry)=>entry.line).join('. ')),
};
});
}
async function applyEntry(entry,slot){
const bank=needBank();
const cabinet=needCabinet();
const report=bank.validate(entry);
if(!report.ok){
throw new SessionError(
'the entry cannot be loaded, nothing was sent to the pedal: '+report.problems.join('; ')
);
}
if(!Number.isInteger(slot)||slot<0||slot>=MemoryMap.PRESET_COUNT){
throw new SessionError('slot is A, B or C (0..2), got '+slot);
}
const settingsBytes=entry.settings.slice();
const carriesCabinet=entry.ir.length>0;
const load=async function(){
step('loading');
for(const param of Params.ALL.slice().sort((a,b)=>a.code-b.code)){
const value=Params.clamp(param,settingsBytes[param.code]);
await sendLive(Commands.liveParamRequest(slot,param.code,value));
await pause(Timing.PARAMETER_DELAY_MS);
}
let live=null;
if(carriesCabinet){
live=entry.ir.slice(cabinet.SECTOR_FLOAT_OFFSET,cabinet.SECTOR_FLOAT_OFFSET+LIVE_BYTES);
step('cabinet');
await applyLiveBlock(live);
const info=cabinet.parseSector(entry.ir);
heldCabinet={
samples:info===null?new Float32Array(cabinet.SAMPLES):info.samples.slice(),
distance:cabinet.distancePercent(liveFloat(entry.ir,cabinet)),
origin:'WRITTEN_TO_PEDAL',
vouched:true,
sector:entry.ir.slice(),
description:cabinet.describeSector(entry.ir),
};
}
return live;
};
const live=carriesCabinet?await cabinetWork(load):await load();
if(localCopy!==null){
localCopy[slot]=settingsBytes.slice();
dirty=true;
}
return{
slot:slot,
name:entry.name,
settings:settingsBytes,
live:live,
carriesCabinet:carriesCabinet,
line:
'Loaded "'+entry.name+'" into '+['A','B','C'][slot]+'. Press SAVE to keep it.',
};
}
function liveFloat(sector,cabinet){
const view=new DataView(sector.buffer,sector.byteOffset,sector.byteLength);
return view.getFloat32(cabinet.SECTOR_FLOAT_OFFSET,true);
}
return{
requestName,
readPresets,
writeLiveParam,
savePresets,
readCabinet,
uploadCabinet,
restoreCabinet,
moveDistance,
resetPresets,
undoReset,
applyEntry,
get canSave(){
return localCopy!==null;
},
get presets(){
return snapshot();
},
get identity(){
return identity;
},
get dirty(){
return dirty;
},
get held(){
return cabinetView();
},
get slotBackup(){
return slotBackup===null?null:slotBackup.slice();
},
get presetBackup(){
return presetBackup===null?null:presetBackup.slice();
},
get cabinetBusy(){
return cabinetDepth>0;
},
};
}
global.RigShadeSession={
createSession,
assertSendable,
SessionError,
ProtocolError,
Audibility,
SlotClean,
resetBlock,
resetPreset,
Timing,
LiveIr,
UserSlot,
NOTHING_TO_UNDO,
};
})(typeof globalThis!=='undefined'?globalThis:this);