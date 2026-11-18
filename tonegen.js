(function(global){
'use strict';
const P=global.RigShadeProtocol;
if(!P)throw new Error('tonegen.js needs protocol.js');
const INTENT=Object.freeze([
{key:'gain',label:'GAIN',low:'clean',high:'saturated',value:35},
{key:'brightness',label:'BRIGHTNESS',low:'dark',high:'bright',value:60},
{key:'tightness',label:'TIGHTNESS',low:'loose',high:'tight',value:60},
{key:'ambience',label:'AMBIENCE',low:'dry',high:'wet',value:25},
{key:'vintage',label:'VINTAGE',low:'modern',high:'vintage',value:50},
{key:'delayAmount',label:'DELAY',low:'none',high:'wash',value:20},
]);
const MODULATIONS=Object.freeze(['off','chorus','phaser']);
const AMP_PROFILES=Object.freeze([
{type:0,gain:8,brightness:58,tightness:66,vintage:34},
{type:1,gain:12,brightness:66,tightness:72,vintage:52},
{type:2,gain:38,brightness:55,tightness:54,vintage:44},
{type:3,gain:55,brightness:52,tightness:67,vintage:42},
{type:4,gain:82,brightness:68,tightness:92,vintage:18},
{type:5,gain:48,brightness:75,tightness:66,vintage:66},
{type:6,gain:91,brightness:66,tightness:53,vintage:28},
{type:7,gain:66,brightness:52,tightness:60,vintage:58},
{type:8,gain:84,brightness:56,tightness:78,vintage:24},
]);
const CAB_PROFILES=Object.freeze([
{ir:1,brightness:58,tightness:61,vintage:36},
{ir:2,brightness:67,tightness:70,vintage:62},
{ir:3,brightness:70,tightness:78,vintage:52},
{ir:4,brightness:58,tightness:85,vintage:28},
{ir:5,brightness:63,tightness:82,vintage:30},
{ir:6,brightness:60,tightness:96,vintage:12},
{ir:7,brightness:64,tightness:90,vintage:16},
]);
function distance(profile,target,keys){
return keys.reduce(function(sum,key){
const delta=Number(profile[key]===undefined?50:profile[key])-Number(target[key]);
return sum+delta*delta;
},0);
}
function chooseAmp(target){
const keys=['gain','brightness','tightness','vintage'];
return AMP_PROFILES.slice().sort(function(left,right){
return distance(left,target,keys)-distance(right,target,keys);
})[0];
}
function chooseCab(target){
const keys=['brightness','tightness','vintage'];
return CAB_PROFILES.slice().sort(function(left,right){
return distance(left,target,keys)-distance(right,target,keys);
})[0];
}
function scale(value,inMin,inMax,outMin,outMax){
const t=Math.max(0,Math.min(1,(value-inMin)/(inMax-inMin)));
return Math.round(outMin+t*(outMax-outMin));
}
function normalizeIntent(intent){
const source=intent||{};
const out={};
for(const descriptor of INTENT){
const raw=Number(source[descriptor.key]===undefined?descriptor.value:source[descriptor.key]);
out[descriptor.key]=Number.isFinite(raw)
?Math.max(0,Math.min(100,Math.round(raw)))
:descriptor.value;
}
const modulation=source.modulation===undefined?'off':String(source.modulation);
if(MODULATIONS.indexOf(modulation)<0){
throw new Error('modulation is off, chorus or phaser, got "'+modulation+'"');
}
out.modulation=modulation;
return out;
}
function valuesFromIntent(intent){
const t=normalizeIntent(intent);
const amp=chooseAmp(t);
const cab=chooseCab(t);
const MOD=t.modulation==='chorus'?2:t.modulation==='phaser'?10:7;
return{
intent:t,
amp:amp,
cab:cab,
values:{
TYPE:amp.type,
GAIN:scale(t.gain,0,100,0,7),
TONE:scale(t.brightness,0,100,3,15),
REVERB:scale(t.ambience,0,100,0,12),
FB:scale(t.delayAmount,0,100,0,32),
VOLUME:96,
TIME:t.delayAmount>0?scale(t.delayAmount,0,100,6,22):0,
MIX:scale(t.delayAmount,0,100,0,34),
MOD:MOD,
IR:cab.ir,
CAB_SW:1,
MOD_SW:MOD!==7||t.delayAmount>0?1:0,
AMP_SW:1,
},
};
}
function settingsOf(values){
const bytes=new Uint8Array(P.MemoryMap.PRESET_BYTES);
for(const param of P.Params.ALL){
const wanted=values[param.label];
bytes[param.code]=P.Params.clamp(param,wanted===undefined?0:wanted);
}
return bytes;
}
function hexOf(bytes){
return Array.prototype.map.call(bytes,function(byte){
return byte.toString(16).padStart(2,'0');
}).join('').toUpperCase();
}
const CAB_SW=10;
const MOD_SW=11;
function signalWarnings(settings){
const warnings=[];
if(settings[CAB_SW]===0&&(settings[3]>0||settings[9]>0)){
warnings.push('CAB_SW is off, so REVERB and IR are stored but not routed.');
}
const modFamily=P.ModNames.sectionFor(settings[8]);
if(settings[MOD_SW]===0&&(modFamily!==null||settings[4]>0||settings[6]>0||settings[7]>0)){
warnings.push('MOD_SW is off, so MOD and DELAY are stored but not routed.');
}
return warnings;
}
function suggestName(amp,cab){
return P.PreampNames[amp.type]+' · '+P.CabinetNames[cab.ir];
}
function generate(intent){
const built=valuesFromIntent(intent);
const settings=settingsOf(built.values);
return{
intent:built.intent,
amp:built.amp,
cab:built.cab,
values:built.values,
settings:settings,
hex:hexOf(settings),
name:suggestName(built.amp,built.cab),
rows:P.Params.ALL.map(function(param){
const value=settings[param.code];
return{code:param.code,label:param.label,value:value,text:P.describe(param.code,value)};
}),
warnings:signalWarnings(settings),
};
}
global.RigShadeToneGen={
INTENT,
MODULATIONS,
AMP_PROFILES,
CAB_PROFILES,
normalizeIntent,
valuesFromIntent,
settingsOf,
signalWarnings,
suggestName,
generate,
hexOf,
scale,
chooseAmp,
chooseCab,
};
})(typeof globalThis!=='undefined'?globalThis:this);