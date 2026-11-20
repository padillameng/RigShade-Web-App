(function(global){
'use strict';
const P=global.RigShadeProtocol;
if(!P)throw new Error('transport.js needs protocol.js to be loaded first');
const DEFAULT_TIMEOUT_MS=1500;
const BUSY_AFTER_LIVE_WRITE_MS=1400;
const PEDAL_NAME=/cube|baby|sinco|m-?vave/i;
const MAX_FRAME_BYTES=16384;
class TransportError extends Error{
constructor(message,reason){
super(message);
this.name='TransportError';
this.reason=reason||'error';
}
}
function sameBytes(left,right){
if(left.length!==right.length)return false;
for(let i=0;i<left.length;i++)if(left[i]!==right[i])return false;
return true;
}
function listPorts(map){
const out=[];
if(!map)return out;
const values=
typeof map.values==='function'
?map.values()
:Object.keys(map).map(function(key){
return map[key];
});
for(const port of values){
if(!port)continue;
out.push({id:String(port.id),name:String(port.name||port.id||''),port:port});
}
return out;
}
function portById(list,id){
if(id===null||id===undefined)return null;
for(const item of list)if(item.id===id)return item;
return null;
}
function nameScore(outputName,inputName){
const out=PEDAL_NAME.test(outputName||'');
const inner=PEDAL_NAME.test(inputName||'');
if(out&&inner)return 0;
if(out)return 1;
if(inner)return 2;
return 3;
}
function requestLabel(clear){
try{
const parsed=P.Envelope.parse(clear);
if(parsed.type===P.MessageType.REQUEST_NAME_VERSION){
return'the name request (REQUEST_NAME_VERSION)';
}
return'the '+P.typeLabel(parsed.type)+' request';
}catch(error){
return'the request';
}
}
function answerMayRepeatRequest(clear){
try{
const parsed=P.Envelope.parse(clear);
return parsed.type===P.MessageType.REQUEST_NAME_VERSION||parsed.type===P.MessageType.READ;
}catch(error){
return true;
}
}
function cloneState(value){
const copy={};
for(const key of Object.keys(value)){
const item=value[key];
copy[key]=Array.isArray(item)
?item.map(function(row){
return Object.assign({},row);
})
:item;
}
return copy;
}
function describeState(value){
return(
value.kind+
(value.reason?'/'+value.reason:'')+
(value.name?' "'+value.name+'"':'')+
': '+
value.message
);
}
function create(options){
const settings=Object.assign({},options||{});
const defaultWait=settings.timeoutMs||DEFAULT_TIMEOUT_MS;
const busyWindow=Object.prototype.hasOwnProperty.call(settings,'busyWindowMs')
?Math.max(0,Number(settings.busyWindowMs)||0)
:BUSY_AFTER_LIVE_WRITE_MS;
const logger=typeof settings.logger==='function'?settings.logger:function(){};
const requestAccess=Object.prototype.hasOwnProperty.call(settings,'requestAccess')
?settings.requestAccess
:typeof navigator!=='undefined'&&typeof navigator.requestMIDIAccess==='function'
?function(wanted){
return navigator.requestMIDIAccess(wanted);
}
:null;
let access=null;
let outputs=[];
let inputs=[];
let chosen={outputId:null,inputId:null};
let linked=null;
let bound=null;
let waiting=null;
let closed=false;
let chain=Promise.resolve();
let busyUntil=0;
let state={
kind:'NoPedal',
reason:'not-connected',
message:'nothing has asked the browser for MIDI access yet',
};
const watchers=[];
function emit(kind,text){
try{
logger(kind,text);
}catch(error){
}
}
function setState(next){
const changed=
next.kind!==state.kind||
next.reason!==state.reason||
next.name!==state.name||
next.message!==state.message;
state=next;
if(changed){
emit('state',describeState(state));
for(const watcher of watchers.slice()){
try{
watcher(cloneState(state));
}catch(error){
}
}
}
return cloneState(state);
}
function refreshPorts(){
outputs=access===null?[]:listPorts(access.outputs);
inputs=access===null?[]:listPorts(access.inputs);
}
function describePorts(){
return outputs.length+' output(s) and '+inputs.length+' input(s)';
}
function describeChosen(){
const output=portById(outputs,chosen.outputId);
const input=portById(inputs,chosen.inputId);
return(
(output===null?'(no output)':'"'+output.name+'"')+
' → '+
(input===null?'(no input)':'"'+input.name+'"')
);
}
function bindInput(id){
if(bound!==null){
bound.onmidimessage=null;
bound=null;
}
const input=portById(inputs,id);
if(input===null)return null;
bound=input.port;
bound.onmidimessage=onMessage;
assembler.reset();
return input;
}
function applyChosen(){
if(chosen.inputId===null){
if(bound!==null){
bound.onmidimessage=null;
bound=null;
}
assembler.reset();
return null;
}
return bindInput(chosen.inputId);
}
function chosenOutput(){
if(closed){
throw new TransportError('the link was disconnected: connect again before sending','disconnected');
}
if(chosen.outputId===null){
throw new TransportError('no MIDI output is chosen: pick the output the pedal is on','no-output');
}
const output=portById(outputs,chosen.outputId);
if(output===null){
throw new TransportError(
'the chosen output "'+chosen.outputId+'" is not in the port list any more: '+
'reconnect the pedal and connect again',
'port-vanished'
);
}
return output;
}
function chosenInput(){
if(closed){
throw new TransportError('the link was disconnected: connect again before sending','disconnected');
}
if(chosen.inputId===null){
throw new TransportError(
'no MIDI input is chosen: the pedal answers on an input port, and without one nothing can be read',
'output-without-input'
);
}
const input=portById(inputs,chosen.inputId);
if(input===null){
throw new TransportError(
'the chosen input "'+chosen.inputId+'" is not in the port list any more: '+
'reconnect the pedal and connect again',
'port-vanished'
);
}
return input;
}
function clonePorts(){
return{
outputs:outputs.map(function(output){
return{id:output.id,name:output.name};
}),
inputs:inputs.map(function(input){
return{id:input.id,name:input.name};
}),
chosen:{outputId:chosen.outputId,inputId:chosen.inputId},
};
}
function select(outputId,inputId){
const blank=function(value){
return value===undefined||value===null||value===''?null:String(value);
};
chosen={outputId:blank(outputId),inputId:blank(inputId)};
linked=null;
closed=false;
applyChosen();
emit('link','chosen by hand: output '+describeChosen());
if(state.kind==='Ready'){
return setState({
kind:'Connecting',
reason:'selection-changed',
message:'the pair was chosen by hand and has not been verified: connect() asks it its name',
});
}
return cloneState(state);
}
function watch(cb){
if(typeof cb!=='function')throw new TransportError('watch needs a function','bad-argument');
watchers.push(cb);
try{
cb(cloneState(state));
}catch(error){
}
return function unwatch(){
const at=watchers.indexOf(cb);
if(at>=0)watchers.splice(at,1);
};
}
function disconnect(reason){
if(waiting!==null){
waiting.fail(new TransportError('the link was disconnected while waiting for an answer','disconnected'));
}
if(bound!==null){
bound.onmidimessage=null;
bound=null;
}
assembler.reset();
closed=true;
linked=null;
chosen={outputId:null,inputId:null};
return setState({
kind:'NoPedal',
reason:reason||'disconnected',
message:'the link is closed. MIDI access is kept, so connecting again does not ask the browser again',
});
}
const assembler={
frame:null,
reset:function(){
this.frame=null;
},
feed:function(data){
if(!data||data.length===0)return;
for(let i=0;i<data.length;i++){
const byte=data[i]&0xFF;
if(byte===0xF0){
if(this.frame!==null){
emit('ignored','a new F0 before the last message ended: resynced on it');
}
this.frame=[0xF0];
continue;
}
if(byte>=0xF8)continue;
if(byte===0xF7){
if(this.frame===null){
emit('ignored','a stray F7 with no message open');
continue;
}
const message=Uint8Array.from(this.frame.concat([0xF7]));
this.frame=null;
deliver(message);
continue;
}
if(this.frame===null)continue;
if(byte&0x80){
emit('ignored','a status byte 0x'+byte.toString(16).toUpperCase()+' inside a message: dropped it');
this.frame=null;
continue;
}
this.frame.push(byte);
if(this.frame.length>MAX_FRAME_BYTES){
emit('ignored','a message longer than '+MAX_FRAME_BYTES+' bytes: dropped it');
this.frame=null;
}
}
},
};
function onMessage(event){
assembler.feed(event&&event.data);
}
const looseWrites=[];
function rememberLoose(wire){
looseWrites.push(wire.slice());
while(looseWrites.length>8)looseWrites.shift();
}
function isLooseWriteEcho(message){
for(const each of looseWrites)if(sameBytes(each,message))return true;
return false;
}
function deliver(message){
if(isLooseWriteEcho(message)){
emit(
'ignored',
'the port repeated a live write that did not wait for an answer; dropped it instead of handing it to the exchange in flight'
);
return;
}
if(waiting===null){
emit('unsolicited',P.toHex(message));
return;
}
if(waiting.dataExpected&&P.Acknowledgement.isWire(message)){
emit(
'ignored',
'the pedal acknowledged a request that asks for data: a status frame is not its answer, still waiting'
);
return;
}
if(waiting.echoIsSuspect&&!waiting.answeredFirst&&sameBytes(message,waiting.wire)){
waiting.echoes+=1;
emit('ignored','the request came back byte for byte; treated as an echo and still waiting');
return;
}
waiting.answeredFirst=true;
waiting.settle(message);
}
function whenUnbusy(label){
const remaining=busyUntil-Date.now();
if(remaining<=0)return Promise.resolve(0);
emit(
'busy',
'the pedal is still busy with the live write: waiting '+remaining+' ms before '+label+
' (measured on the pedal: it answers no read for about '+busyWindow+' ms after a live write)'
);
return new Promise(function(resolve){
global.setTimeout(function(){
resolve(remaining);
},remaining);
});
}
async function sendAndWait(output,input,clear,wait,label){
await whenUnbusy(label);
bindInput(input.id);
const wire=P.Commands.toWire(clear);
return new Promise(function(resolve,reject){
const timer=global.setTimeout(function(){
const echoes=waiting!==null?waiting.echoes:0;
waiting=null;
const error=new TransportError(
'the pedal did not answer '+
label+
' within '+
wait+
' ms on output "'+
output.name+
'" and input "'+
input.name+
'"'+
(echoes>0?', and its only '+echoes+' message(s) back were the request itself':''),
'timeout'
);
emit('failed',error.message);
reject(error);
},wait);
waiting={
wire:wire.slice(),
echoIsSuspect:answerMayRepeatRequest(clear),
dataExpected:!P.Acknowledgement.isAnswerTo(clear),
answeredFirst:false,
echoes:0,
fail:function(error){
global.clearTimeout(timer);
waiting=null;
emit('failed',error.message);
reject(error);
},
settle:function(message){
global.clearTimeout(timer);
waiting=null;
emit('received',P.toHex(message));
try{
resolve({clear:P.Commands.fromWire(message),wire:message.slice()});
}catch(error){
reject(new TransportError('the answer could not be read: '+error.message,'unreadable-answer'));
}
},
};
emit('sent',P.toHex(wire));
try{
output.port.send(Array.from(wire));
}catch(error){
waiting.fail(
new TransportError(
'the MIDI output refused the message: '+(error&&error.message?error.message:String(error)),
'send-failed'
)
);
}
});
}
function serial(task){
const run=chain.then(task);
chain=run.then(
function(){},
function(){}
);
return run;
}
function exchange(clear,timeoutMs){
return serial(function(){
const output=chosenOutput();
const input=chosenInput();
return sendAndWait(output,input,clear,timeoutMs||defaultWait,requestLabel(clear)).then(
function(result){
return result.clear;
}
);
});
}
function send(clear){
return serial(function(){
const output=chosenOutput();
const wire=P.Commands.toWire(clear);
emit('sent',P.toHex(wire));
try{
output.port.send(Array.from(wire));
}catch(error){
throw new TransportError(
'the MIDI output refused the message: '+(error&&error.message?error.message:String(error)),
'send-failed'
);
}
rememberLoose(wire);
busyUntil=Date.now()+busyWindow;
return wire;
});
}
function candidatePairs(){
const pairs=[];
for(const output of outputs){
for(const input of inputs){
pairs.push({output:output,input:input,score:nameScore(output.name,input.name)});
}
}
pairs.sort(function(left,right){
return left.score-right.score;
});
return pairs;
}
function probePair(pair,wait){
const output=pair.output;
const input=pair.input;
const row={
outputId:output.id,
outputName:output.name,
inputId:input.id,
inputName:input.name,
sent:P.Commands.toWire(P.Commands.requestNameVersion()),
answer:null,
name:null,
error:null,
};
return sendAndWait(output,input,P.Commands.requestNameVersion(),wait,'the name request (REQUEST_NAME_VERSION)').then(
function(result){
row.answer=result.wire;
try{
const parsed=P.Envelope.parse(result.clear);
if(parsed.type!==P.MessageType.REQUEST_NAME_VERSION){
row.error='it answered a '+P.typeLabel(parsed.type)+' block, not a name answer';
}else{
row.name=P.asciiTrim(parsed.body.slice(0,Math.min(16,parsed.body.length)));
}
}catch(error){
row.error='the answer is not a readable block: '+error.message;
}
return row;
},
function(error){
row.error=error.message;
return row;
}
);
}
async function probeAll(pairs,wait){
const rows=[];
for(const pair of pairs){
rows.push(await probePair(pair,wait));
}
applyChosen();
return rows;
}
function probe(wait){
return serial(function(){
if(outputs.length===0||inputs.length===0){
throw new TransportError(
'nothing to probe: '+describePorts()+' are visible. Plug the pedal in and connect first',
'no-ports'
);
}
return probeAll(candidatePairs(),wait||defaultWait);
});
}
function afterAccess(){
if(outputs.length===0){
linked=null;
return Promise.resolve(
setState({
kind:'NoPedal',
reason:'no-outputs',
message:
'MIDI access is granted, but no MIDI output is visible ('+
describePorts()+
'): plug the pedal in, turn it on, and check that no other program is holding the port',
})
);
}
if(inputs.length===0){
linked=null;
return Promise.resolve(
setState({
kind:'Failed',
reason:'output-without-input',
message:
describePorts()+
' are visible: there is an output to send on and no input to hear the answer on. The pedal '+
'answers on its input port, so the output alone cannot be talked to',
})
);
}
return verify();
}
function verify(){
const manual=chosen.outputId!==null||chosen.inputId!==null;
const pairs=candidatePairs();
setState({
kind:'Connecting',
message:manual
?'asking the pair you chose ('+describeChosen()+') for the pedal name'
:'MIDI access granted: '+
describePorts()+
', asking '+
pairs.length+
' candidate pair(s) for the pedal name',
});
if(manual){
const output=portById(outputs,chosen.outputId);
const input=portById(inputs,chosen.inputId);
if(output===null||input===null){
return Promise.resolve(
setState({
kind:'Failed',
reason:'port-vanished',
message:'the pair you chose is not in the port list any more ('+describeChosen()+'): pick it again',
})
);
}
return serial(function(){
return probeAll([{output:output,input:input}],defaultWait);
}).then(function(rows){
const row=rows[0];
if(row.name===null){
return setState({
kind:'Failed',
reason:row.answer===null?'chosen-pair-silent':'unexpected-answer',
message:
'the pair you chose ('+
row.outputName+
' → '+
row.inputName+
') gave no name answer: '+
(row.error||'the answer was empty'),
});
}
return ready(row,[row]);
});
}
return serial(function(){
return probeAll(pairs,defaultWait);
}).then(linkFromProbe);
}
function ready(row,answering){
closed=false;
linked={outputId:row.outputId,inputId:row.inputId};
chosen={outputId:row.outputId,inputId:row.inputId};
applyChosen();
return setState({
kind:'Ready',
name:row.name,
outputId:row.outputId,
outputName:row.outputName,
inputId:row.inputId,
inputName:row.inputName,
answered:answering.map(function(each){
return{
outputId:each.outputId,
outputName:each.outputName,
inputId:each.inputId,
inputName:each.inputName,
name:each.name,
};
}),
message:
'the pedal answered as "'+
row.name+
'" on output "'+
row.outputName+
'" and input "'+
row.inputName+
'"'+
(answering.length>1
?'; '+
answering.length+
' pairs answered, and the one whose ports are named like the pedal was chosen, otherwise the first in port order'
:''),
});
}
function linkFromProbe(rows){
const answering=rows.filter(function(row){
return row.name!==null;
});
if(answering.length===0){
const reasons=rows
.map(function(row){
return row.outputName+' → '+row.inputName+': '+(row.error||'no answer');
})
.join('; ');
const named=outputs
.concat(inputs)
.filter(function(port){
return PEDAL_NAME.test(port.name);
})
.map(function(port){
return'"'+port.name+'"';
});
return setState({
kind:'Failed',
reason:'no-pedal-answered',
message:
'no pair answered the name request ('+
rows.length+
' tried): '+
reasons+
(named.length>0
?'. The port(s) named '+
named.join(', ')+
' are visible, but nothing on them answered: the pedal is recognised and silent'
:'. No port is named like a Cube Baby either, so check the cable, that the pedal is on, '+
'and that no other program holds the port'),
});
}
let best=answering[0];
for(const row of answering){
if(nameScore(row.outputName,row.inputName)<nameScore(best.outputName,best.inputName)){
best=row;
}
}
return ready(best,answering);
}
function onStateChange(){
refreshPorts();
emit('link','a port came or went: now '+describePorts());
if(linked!==null&&(portById(outputs,linked.outputId)===null||portById(inputs,linked.inputId)===null)){
linked=null;
if(waiting!==null){
waiting.fail(new TransportError('the port went away while waiting for an answer','port-vanished'));
}
setState({
kind:'NoPedal',
reason:'port-vanished',
message:'the port the pedal was on has gone: plug it back in and connect again (MIDI access is kept)',
});
return;
}
for(const watcher of watchers.slice()){
try{
watcher(cloneState(state));
}catch(error){
}
}
}
let connecting=null;
function connect(){
if(connecting!==null)return connecting;
connecting=doConnect().then(
function(result){
connecting=null;
return result;
},
function(error){
connecting=null;
throw error;
}
);
return connecting;
}
function doConnect(){
if(typeof requestAccess!=='function'){
return Promise.resolve(
setState({
kind:'Failed',
reason:'no-midi-access',
message:
'this browser has no Web MIDI (navigator.requestMIDIAccess is missing): Chrome or Edge is what '+
'ships one. Web MIDI also needs a secure page, so use the published https page rather than '+
'opening the file from disk',
})
);
}
if(access===null&&state.kind==='Failed'&&state.reason==='permission-refused'){
emit('link','MIDI access was refused earlier; not asking the browser again');
return Promise.resolve(cloneState(state));
}
if(
linked!==null&&
portById(outputs,linked.outputId)!==null&&
portById(inputs,linked.inputId)!==null
){
return Promise.resolve(cloneState(state));
}
if(access===null){
setState({kind:'WaitingForPermission',message:'asking the browser for MIDI access, including SysEx'});
return Promise.resolve()
.then(function(){
return requestAccess({sysex:true});
})
.then(
function(granted){
access=granted;
access.onstatechange=onStateChange;
refreshPorts();
return afterAccess();
},
function(error){
access=null;
return setState({
kind:'Failed',
reason:'permission-refused',
message:
'the browser did not grant MIDI access: '+(error&&error.message?error.message:String(error)),
});
}
);
}
refreshPorts();
return afterAccess();
}
return{
connect:connect,
state:function(){
return cloneState(state);
},
ports:clonePorts,
select:select,
exchange:exchange,
send:send,
probe:probe,
watch:watch,
disconnect:disconnect,
};
}
global.RigShadeTransport={
create:create,
TransportError:TransportError,
DEFAULT_TIMEOUT_MS:DEFAULT_TIMEOUT_MS,
BUSY_AFTER_LIVE_WRITE_MS:BUSY_AFTER_LIVE_WRITE_MS,
};
})(typeof globalThis!=='undefined'?globalThis:this);