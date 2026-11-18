(function(global){
'use strict';
const P=global.RigShadeProtocol;
if(!P){
throw new Error('cabinet.js needs protocol.js: it reuses the MemoryMap constants instead of copying them');
}
const{MemoryMap}=P;
class CabinetError extends Error{
constructor(message){
super(message);
this.name='CabinetError';
}
}
const SAMPLE_RATE=48000;
const SAMPLES=512;
const SECTOR_BYTES=4096;
const SECTOR_MARKER_OFFSET=0;
const SECTOR_FLOAT_OFFSET=4;
const SECTOR_SAMPLE_OFFSET=8;
const SECTOR_CAPACITY=(SECTOR_BYTES-SECTOR_SAMPLE_OFFSET)/4;
const LIVE_BYTES=2052;
const LIVE_FLOAT_OFFSET=0;
const LIVE_SAMPLE_OFFSET=4;
const MARKER_FACTORY=Uint8Array.of(0x01,0x00,0x00,0x00);
const MARKER_USER=Uint8Array.of(0x00,0x00,0x00,0x00);
const USER_SLOT_INDEX=MemoryMap.IR_USER_SLOT_INDEX;
const USER_SLOT_ADDRESS=MemoryMap.IR_USER_SLOT_ADDRESS;
const READ_CHUNK=113;
const READ_PAUSE_MS=40;
function asBytes(value,what){
if(value instanceof Uint8Array)return value;
if(value instanceof ArrayBuffer)return new Uint8Array(value);
if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
throw new CabinetError(what+' must be an ArrayBuffer or a typed array');
}
function asSamples(value){
if(value instanceof Float32Array)return value;
if(Array.isArray(value)){
const out=new Float32Array(value.length);
for(let i=0;i<value.length;i++){
if(typeof value[i]!=='number'){
throw new CabinetError('sample '+i+' is a '+typeof value[i]+', not a number');
}
out[i]=value[i];
}
return out;
}
if(ArrayBuffer.isView(value))return Float32Array.from(value);
throw new CabinetError('the samples must be a Float32Array or an array of numbers');
}
function view(bytes){
return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
}
function floatAt(bytes,offset){
return view(bytes).getFloat32(offset,true);
}
function putFloat(bytes,offset,value){
view(bytes).setFloat32(offset,value,true);
}
const distanceRange=Object.freeze({
min:0,
max:100,
default:50,
silentAt:100,
soundingAt:99,
});
const SILENT_LINE='100% silences the cabinet; 99% still sounded';
function clampPercent(value){
const number=Number(value);
if(!Number.isFinite(number))throw new CabinetError('"'+value+'" is not a mic distance');
return Math.min(Math.max(Math.round(number),distanceRange.min),distanceRange.max);
}
function silentAt(percent){
return clampPercent(percent)>=distanceRange.silentAt?SILENT_LINE:null;
}
function distanceFloat(percent){
return clampPercent(percent)/100;
}
function distancePercent(stored){
if(!Number.isFinite(stored)||stored<0||stored>1)return null;
return Math.min(Math.max(Math.round(stored*100),distanceRange.min),distanceRange.max);
}
function writtenSamples(samples){
const source=asSamples(samples);
return source.length<=SAMPLES?source:source.slice(0,SAMPLES);
}
function containerSamplesProblem(samples){
if(samples.length===0)return'the cabinet has no samples';
if(samples.length>SAMPLES)return'the cabinet has '+samples.length+' samples, at most '+SAMPLES+' fit';
for(let i=0;i<samples.length;i++){
if(!Number.isFinite(samples[i]))return'sample '+i+' of the cabinet is not a finite number';
}
return null;
}
function samplesProblem(samples){
const source=asSamples(samples);
if(source.length===0)return'the file carries no audio samples';
return containerSamplesProblem(writtenSamples(source));
}
function payloadProblem(sector,live){
const sectorBytes=asBytes(sector,'the sector');
const liveBytes=asBytes(live,'the live block');
if(sectorBytes.length!==SECTOR_BYTES){
return'the cabinet sector is '+SECTOR_BYTES+' bytes, got '+sectorBytes.length;
}
if(!isErased(sectorBytes)){
if(markerOf(sectorBytes)===null){
return(
'the cabinet sector does not start with a known marker (00 00 00 00 or 01 00 00 00), it starts with '+
P.toHex(sectorBytes.slice(0,4))
);
}
const stored=floatAt(sectorBytes,SECTOR_FLOAT_OFFSET);
const distanceIssue=distanceProblem('the cabinet sector',stored);
if(distanceIssue!==null)return distanceIssue;
const badSectorSample=firstNonFiniteSample(sectorBytes,SECTOR_SAMPLE_OFFSET);
if(badSectorSample!==null)return'sample '+badSectorSample+' of the cabinet sector is not a finite number';
}
if(liveBytes.length!==LIVE_BYTES){
return'the live cabinet block is '+LIVE_BYTES+' bytes, got '+liveBytes.length;
}
const liveIssue=distanceProblem('the live cabinet block',floatAt(liveBytes,LIVE_FLOAT_OFFSET));
if(liveIssue!==null)return liveIssue;
const badLiveSample=firstNonFiniteSample(liveBytes,LIVE_SAMPLE_OFFSET);
if(badLiveSample!==null)return'sample '+badLiveSample+' of the live cabinet block is not a finite number';
return null;
}
function refusalMessage(reason){
return'Import refused, nothing was sent to the pedal: '+reason;
}
function distanceProblem(what,stored){
if(!Number.isFinite(stored))return'the mic distance in '+what+' is not a finite number';
if(stored<0||stored>1)return'the mic distance in '+what+' is '+stored+', outside 0..1';
return null;
}
function firstNonFiniteSample(bytes,offset){
const data=view(bytes);
for(let i=0;i<SAMPLES;i++){
if(!Number.isFinite(data.getFloat32(offset+i*4,true)))return i;
}
return null;
}
function isErased(bytes){
if(bytes.length===0)return false;
for(let i=0;i<bytes.length;i++)if(bytes[i]!==0xFF)return false;
return true;
}
function markerOf(bytes){
if(bytes.length<4)return null;
const marker=bytes.slice(0,4);
if(P.bytesEqual(marker,MARKER_FACTORY))return MARKER_FACTORY;
if(P.bytesEqual(marker,MARKER_USER))return MARKER_USER;
return null;
}
function approveCabinet(options){
if(!options||typeof options!=='object'){
throw new CabinetError('a cabinet needs { samples, distance }');
}
const percent=clampPercent(options.distance);
const samples=asSamples(options.samples);
const problem=samplesProblem(samples);
if(problem!==null)throw new CabinetError(refusalMessage(problem));
return{percent:percent,float:percent/100,samples:writtenSamples(samples)};
}
function buildSector(input){
const cabinet=approveCabinet(input);
const out=new Uint8Array(SECTOR_BYTES);
out.set(MARKER_USER,SECTOR_MARKER_OFFSET);
putFloat(out,SECTOR_FLOAT_OFFSET,cabinet.float);
const count=Math.min(cabinet.samples.length,SAMPLES,SECTOR_CAPACITY);
for(let i=0;i<count;i++)putFloat(out,SECTOR_SAMPLE_OFFSET+i*4,cabinet.samples[i]);
return out;
}
function buildLiveBlock(input){
const cabinet=approveCabinet(input);
const out=new Uint8Array(LIVE_BYTES);
putFloat(out,LIVE_FLOAT_OFFSET,cabinet.float);
const count=Math.min(cabinet.samples.length,SAMPLES);
for(let i=0;i<count;i++)putFloat(out,LIVE_SAMPLE_OFFSET+i*4,cabinet.samples[i]);
return out;
}
function parseSector(bytes){
const raw=asBytes(bytes,'a sector');
if(raw.length!==SECTOR_BYTES)return null;
const samples=new Float32Array(SAMPLES);
if(isErased(raw)){
return{
present:false,
erased:true,
isFactory:false,
isUser:false,
marker:null,
distance:null,
distanceFloat:NaN,
samples:samples,
length:SECTOR_BYTES,
};
}
const marker=markerOf(raw);
if(marker===null)return null;
const data=view(raw);
const stored=data.getFloat32(SECTOR_FLOAT_OFFSET,true);
for(let i=0;i<SAMPLES;i++){
const value=data.getFloat32(SECTOR_SAMPLE_OFFSET+i*4,true);
samples[i]=Number.isFinite(value)?value:0;
}
return{
present:true,
erased:false,
isFactory:P.bytesEqual(marker,MARKER_FACTORY),
isUser:P.bytesEqual(marker,MARKER_USER),
marker:P.toHex(marker),
distance:distancePercent(stored),
distanceFloat:stored,
samples:samples,
length:SECTOR_BYTES,
};
}
function describeSector(bytes){
const raw=asBytes(bytes,'a sector');
if(raw.length!==SECTOR_BYTES){
return'not a cabinet sector: a sector is '+SECTOR_BYTES+' bytes, these are '+raw.length;
}
const info=parseSector(raw);
if(info===null){
return(
'not a cabinet sector: it starts with '+P.toHex(raw.slice(0,4))+
', which is neither the factory marker 01 00 00 00 nor the user marker 00 00 00 00'
);
}
if(info.erased)return'empty slot: every byte is 0xFF, so no cabinet was ever written here';
const parts=[(info.isFactory?'factory cabinet':'user cabinet')+' ('+info.marker+')'];
if(info.distance===null){
parts.push('mic distance '+info.distanceFloat+' is outside 0..1');
}else{
parts.push('mic distance '+info.distance+'% ('+info.distanceFloat+')');
}
let peak=0;
let first=-1;
for(let i=0;i<info.samples.length;i++){
const magnitude=Math.abs(info.samples[i]);
if(magnitude>peak)peak=magnitude;
if(first<0&&info.samples[i]!==0)first=i;
}
parts.push('peak '+peak.toFixed(6));
parts.push(
first<0
?'silent: every sample is zero'
:'first non-zero sample '+first+' ('+((first*1000)/SAMPLE_RATE).toFixed(3)+' ms)'
);
return parts.join(', ');
}
function readPlan(address){
const target=address===undefined?USER_SLOT_ADDRESS:address;
if(typeof target!=='number'||!Number.isFinite(target)){
throw new CabinetError('readPlan needs an address, got "'+target+'"');
}
const unsigned=target>>>0;
if(unsigned!==USER_SLOT_ADDRESS){
throw new CabinetError(
'refusing to plan a read at 0x'+
unsigned.toString(16).toUpperCase().padStart(8,'0')+
': only the user cabinet slot 0x'+
USER_SLOT_ADDRESS.toString(16).toUpperCase().padStart(8,'0')+
' is read, the factory slots are named from the manual instead'
);
}
const chunks=[];
for(let done=0,index=0;done<SECTOR_BYTES;index++){
const size=Math.min(READ_CHUNK,SECTOR_BYTES-done);
chunks.push({index:index,memory:MemoryMap.ROM,address:(unsigned+done)>>>0,size:size});
done+=size;
}
return chunks;
}
const WAV_CHUNK_HEADER=8;
const WAV_MIN_BYTES=44;
function ascii(bytes,offset){
let text='';
for(let i=0;i<4;i++)text+=String.fromCharCode(bytes[offset+i]);
return text;
}
function decodeWav(input){
const bytes=asBytes(input,'a WAV file');
if(bytes.length<WAV_MIN_BYTES){
throw new CabinetError('file is '+bytes.length+' bytes, a WAV needs at least '+WAV_MIN_BYTES);
}
if(ascii(bytes,0)!=='RIFF')throw new CabinetError('missing RIFF header');
if(ascii(bytes,8)!=='WAVE')throw new CabinetError('not a WAVE file');
const data=view(bytes);
let format=-1;
let channels=0;
let sampleRate=0;
let bits=0;
let dataStart=-1;
let dataSize=0;
let pos=12;
while(pos+WAV_CHUNK_HEADER<=bytes.length){
const id=ascii(bytes,pos);
const size=data.getUint32(pos+4,true);
const payload=pos+WAV_CHUNK_HEADER;
if(payload+size>bytes.length){
throw new CabinetError("chunk '"+id+"' claims "+size+' bytes past the end of the file');
}
if(id==='fmt '){
if(size<16)throw new CabinetError('fmt chunk is only '+size+' bytes');
format=data.getUint16(payload,true);
channels=data.getUint16(payload+2,true);
sampleRate=data.getUint32(payload+4,true);
bits=data.getUint16(payload+14,true);
}else if(id==='data'){
dataStart=payload;
dataSize=size;
}
pos=payload+size+(size&1);
}
if(format<0)throw new CabinetError('missing fmt chunk');
if(dataStart<0)throw new CabinetError('missing data chunk');
if(channels<1)throw new CabinetError('fmt declares '+channels+' channels');
if(sampleRate<1)throw new CabinetError('fmt declares a rate of '+sampleRate);
let bytesPerSample;
if(format===1&&bits===16)bytesPerSample=2;
else if(format===1&&bits===24)bytesPerSample=3;
else if(format===1&&bits===32)bytesPerSample=4;
else if(format===3&&bits===32)bytesPerSample=4;
else throw new CabinetError('unsupported format '+format+' with '+bits+' bits per sample');
const frameBytes=bytesPerSample*channels;
const frames=Math.floor(dataSize/frameBytes);
const mono=new Float32Array(frames);
for(let frame=0;frame<frames;frame++){
let sum=0;
for(let channel=0;channel<channels;channel++){
sum+=readWavSample(data,dataStart+frame*frameBytes+channel*bytesPerSample,format,bits);
}
mono[frame]=Math.min(Math.max(sum/channels,-1),1);
}
return{samples:mono,sampleRate:sampleRate,channels:channels,bitsPerSample:bits};
}
function readWavSample(data,offset,format,bits){
if(format===3)return data.getFloat32(offset,true);
if(bits===16)return data.getInt16(offset,true)/32768;
if(bits===24){
const raw=data.getUint8(offset)|(data.getUint8(offset+1)<<8)|(data.getUint8(offset+2)<<16);
const signed=raw&0x800000?raw-0x1000000:raw;
return signed/8388608;
}
return data.getInt32(offset,true)/2147483648;
}
function resample(samples,fromRate,toRate){
const source=asSamples(samples);
if(!(fromRate>0))throw new CabinetError('invalid source rate '+fromRate);
if(!(toRate>0))throw new CabinetError('invalid target rate '+toRate);
if(source.length===0||fromRate===toRate)return source;
const outLength=Math.max(Math.round((source.length*toRate)/fromRate),1);
const out=new Float32Array(outLength);
for(let i=0;i<outLength;i++){
const t=(i*fromRate)/toRate;
const i0=Math.floor(t);
const frac=t-i0;
const a=source[Math.min(Math.max(i0,0),source.length-1)];
const b=source[Math.min(Math.max(i0+1,0),source.length-1)];
out[i]=a+(b-a)*frac;
}
return out;
}
function toIrRate(decoded){
if(!decoded||typeof decoded!=='object')throw new CabinetError('toIrRate needs a decoded file');
return resample(decoded.samples,decoded.sampleRate,SAMPLE_RATE);
}
global.RigShadeCabinet={
CabinetError,
SAMPLE_RATE,
SAMPLES,
SECTOR_BYTES,
LIVE_BYTES,
SECTOR_CAPACITY,
SECTOR_MARKER_OFFSET,
SECTOR_FLOAT_OFFSET,
SECTOR_SAMPLE_OFFSET,
LIVE_FLOAT_OFFSET,
LIVE_SAMPLE_OFFSET,
MARKER_FACTORY,
MARKER_USER,
USER_SLOT_INDEX,
USER_SLOT_ADDRESS,
READ_CHUNK,
READ_PAUSE_MS,
distanceRange,
SILENT_LINE,
silentAt,
clampPercent,
distanceFloat,
distancePercent,
writtenSamples,
samplesProblem,
payloadProblem,
refusalMessage,
isErased,
buildSector,
buildLiveBlock,
parseSector,
describeSector,
readPlan,
decodeWav,
resample,
toIrRate,
};
})(typeof globalThis!=='undefined'?globalThis:this);