(function(global){
'use strict';
function t(text,vars){
const layer=global.RigShadeI18n;
if(layer&&typeof layer.t==='function')return layer.t(text,vars);
if(!vars)return text;
return String(text).replace(/\{(\w+)\}/g,function(match,name){
return Object.prototype.hasOwnProperty.call(vars,name)?String(vars[name]):match;
});
}
function message(error){
return error&&error.message?error.message:String(error);
}
function refusal(text){
return{ok:false,message:text};
}
const AUTHORIZE_URL='https://www.tone3000.com/api/v1/oauth/authorize';
const TOKEN_URL='https://www.tone3000.com/api/v1/oauth/token';
const API_BASE='https://www.tone3000.com/api/v1';
const HOSTS=['https://www.tone3000.com','https://assets.tone3000.com'];
const CLIENT_ID='t3k_pub_0FgMaWjmz2hdJc9IhICkI4uruPu3OVKg';
const KEYS={
verifier:'rigshade.tone3000.verifier',
state:'rigshade.tone3000.state',
redirect:'rigshade.tone3000.redirect',
tokens:'rigshade.tone3000.tokens',
};
const RENEW_BEFORE_MS=60000;
const CALLBACK_PARAMS=['code','state','tone_id','canceled','error','error_description'];
function isConfigured(id){
const value=id===undefined?CLIENT_ID:id;
return typeof value==='string'&&value.length>0&&value.charAt(0)!=='_';
}
function base64url(bytes){
let binary='';
for(let index=0;index<bytes.length;index+=1){
binary+=String.fromCharCode(bytes[index]);
}
return global.btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function randomToken(size,source){
const bytes=new Uint8Array(size);
source.getRandomValues(bytes);
return base64url(bytes);
}
function randomVerifier(source){
return randomToken(32,source===undefined?global.crypto:source);
}
async function challengeFor(verifier,source){
const bytes=new TextEncoder().encode(String(verifier));
const digest=await source.subtle.digest('SHA-256',bytes);
return base64url(new Uint8Array(digest));
}
function authorizeUrl(fields){
const params=new URLSearchParams();
params.set('client_id',fields.clientId);
params.set('redirect_uri',fields.redirectUri);
params.set('response_type','code');
params.set('code_challenge',fields.challenge);
params.set('code_challenge_method','S256');
params.set('state',fields.state);
params.set('prompt','select_tone');
params.set('format','ir');
params.set('gears','cab');
params.set('menubar','true');
return AUTHORIZE_URL+'?'+params.toString();
}
function hostOf(url){
const match=/^([a-z][a-z0-9+.-]*:)\/\/([^/?#]+)/i.exec(String(url===null||url===undefined?'':url));
if(match===null)return'';
return match[1].toLowerCase()+'//'+match[2].toLowerCase();
}
function hostAllowed(url){
return HOSTS.indexOf(hostOf(url))>=0;
}
const IR_HASH='ir-content-v1:';
const NAM_HASH='nam-content-v1:';
function isCabinet(row){
const hash=String(row.content_hash||'').toLowerCase();
if(hash.indexOf(IR_HASH)===0)return true;
if(hash.indexOf(NAM_HASH)===0)return false;
return row.architecture_version===null||row.architecture_version===undefined;
}
function pickModel(items){
const list=Array.isArray(items)?items:[];
for(let index=0;index<list.length;index+=1){
const item=list[index]||{};
if(!isCabinet(item))continue;
if(!String(item.model_url||''))continue;
return item;
}
return null;
}
function describeModels(items){
const list=Array.isArray(items)?items:[];
const shown=[];
for(let index=0;index<list.length&&shown.length<3;index+=1){
const item=list[index]||{};
const hash=String(item.content_hash||'').toLowerCase();
const kind=hash.indexOf(IR_HASH)===0?'IR':hash.indexOf(NAM_HASH)===0?'NAM capture':'no content hash';
const architecture=
item.architecture_version===null||item.architecture_version===undefined
?'none'
:String(item.architecture_version);
shown.push(
'#'+(index+1)+' '+(String(item.name||'').trim()||'unnamed')+': '+kind+', architecture '+architecture
);
}
return shown.join('; ');
}
function entriesOf(payload){
if(Array.isArray(payload))return payload;
if(payload&&Array.isArray(payload.data))return payload.data;
if(payload&&Array.isArray(payload.models))return payload.models;
return[];
}
function recordOf(payload){
if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
if(payload.data&&typeof payload.data==='object'&&!Array.isArray(payload.data))return payload.data;
return payload;
}
function fileNameFor(named,url){
const path=String(url===null||url===undefined?'':url).split('#')[0].split('?')[0];
const base=path.slice(path.lastIndexOf('/')+1);
let candidate=String(named===null||named===undefined?'':named).trim();
if(candidate===''){
try{
candidate=decodeURIComponent(base);
}catch(error){
candidate=base;
}
}
const clean=candidate.replace(/[\\/:*?"<>|]/g,' ').trim();
if(clean==='')return'cabinet.wav';
return/\.wav$/i.test(clean)?clean:clean+'.wav';
}
function readTokens(s){
const raw=s.store.get(KEYS.tokens);
if(!raw)return null;
try{
const held=JSON.parse(raw);
return held&&typeof held.access==='string'?held:null;
}catch(error){
return null;
}
}
const ZIP_LOCAL=0x04034b50;
const ZIP_CENTRAL=0x02014b50;
const ZIP_EOCD=0x06054b50;
const ZIP_EOCD_MIN=22;
const ZIP_COMMENT_MAX=65535;
const ZIP_MEMBER_LIMIT=64*1024*1024;
const RATE_HINT=[/(^|[^0-9])(48000|48k|48khz)([^0-9]|$)/i,/(^|[^0-9])(44100|44\.1|44k|44khz)([^0-9]|$)/i];
function asBytes(input){
if(input instanceof Uint8Array)return input;
if(input instanceof ArrayBuffer)return new Uint8Array(input);
if(input&&input.buffer instanceof ArrayBuffer){
return new Uint8Array(input.buffer,input.byteOffset||0,input.byteLength||0);
}
return new Uint8Array(0);
}
function isZip(input){
const bytes=asBytes(input);
if(bytes.length<ZIP_EOCD_MIN)return false;
if(bytes[0]!==0x50||bytes[1]!==0x4b)return false;
return(bytes[2]===3&&bytes[3]===4)||(bytes[2]===5&&bytes[3]===6);
}
function memberName(bytes,from,length){
const slice=bytes.subarray(from,from+length);
if(typeof global.TextDecoder==='function')return new global.TextDecoder().decode(slice);
let text='';
for(let index=0;index<slice.length;index+=1)text+=String.fromCharCode(slice[index]);
return text;
}
function directoryEnd(bytes,view){
const floor=Math.max(bytes.length-ZIP_EOCD_MIN-ZIP_COMMENT_MAX,0);
for(let at=bytes.length-ZIP_EOCD_MIN;at>=floor;at-=1){
if(view.getUint32(at,true)===ZIP_EOCD)return at;
}
return-1;
}
function zipMembers(input){
const bytes=asBytes(input);
if(!isZip(bytes))return[];
const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const end=directoryEnd(bytes,view);
if(end<0)throw new Error('no end-of-directory record');
const count=view.getUint16(end+10,true);
const start=view.getUint32(end+16,true);
if(count===0xffff||start===0xffffffff)throw new Error('this is a ZIP64 package');
const members=[];
let at=start;
for(let index=0;index<count;index+=1){
if(at+46>bytes.length)throw new Error('the directory is cut short');
if(view.getUint32(at,true)!==ZIP_CENTRAL)throw new Error('the directory is not where the package says');
const nameLength=view.getUint16(at+28,true);
const extraLength=view.getUint16(at+30,true);
const commentLength=view.getUint16(at+32,true);
members.push({
name:memberName(bytes,at+46,nameLength),
method:view.getUint16(at+10,true),
compressed:view.getUint32(at+20,true),
size:view.getUint32(at+24,true),
local:view.getUint32(at+42,true),
});
at+=46+nameLength+extraLength+commentLength;
}
return members;
}
function memberBytes(bytes,member){
if(member.size>ZIP_MEMBER_LIMIT){
throw new Error('"'+member.name+'" is '+member.size+' bytes, past the '+ZIP_MEMBER_LIMIT+'-byte limit');
}
const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
if(member.local+30>bytes.length||view.getUint32(member.local,true)!==ZIP_LOCAL){
throw new Error('"'+member.name+'" does not start where the package says');
}
const from=member.local+30+view.getUint16(member.local+26,true)+view.getUint16(member.local+28,true);
const to=from+member.compressed;
if(to>bytes.length)throw new Error('"'+member.name+'" runs past the end of the package');
return bytes.subarray(from,to);
}
function wavMembers(members){
const wavs=[];
for(let index=0;index<members.length;index+=1){
if(/\.wav$/i.test(String(members[index].name||'')))wavs.push(members[index]);
}
const ordered=[];
for(let hint=0;hint<RATE_HINT.length;hint+=1){
for(let index=0;index<wavs.length;index+=1){
if(ordered.indexOf(wavs[index])<0&&RATE_HINT[hint].test(wavs[index].name))ordered.push(wavs[index]);
}
}
for(let index=0;index<wavs.length;index+=1){
if(ordered.indexOf(wavs[index])<0)ordered.push(wavs[index]);
}
return ordered;
}
function pickWav(members){
const wavs=wavMembers(members);
return wavs.length===0?null:wavs[0];
}
function cabinetLabel(name){
const path=String(name===null||name===undefined?'':name).replace(/\\/g,'/');
const base=path.slice(path.lastIndexOf('/')+1).trim();
const bare=base.replace(/\.wav$/i,'').trim();
return bare||base||'cabinet';
}
function choiceLabels(members){
const base=[];
const seen={};
let repeated=false;
for(let index=0;index<members.length;index+=1){
const label=cabinetLabel(members[index].name);
if(seen[label])repeated=true;
seen[label]=true;
base.push(label);
}
if(!repeated)return base;
const whole=[];
for(let index=0;index<members.length;index+=1){
const name=String(members[index].name||'').trim();
whole.push(name||'cabinet.wav');
}
return whole;
}
function describeMembers(members){
if(!members.length)return t('the package came back empty');
const shown=[];
for(let index=0;index<members.length&&shown.length<3;index+=1){
shown.push('"'+(String(members[index].name||'').trim()||'unnamed')+'"');
}
return shown.join(', ');
}
async function inflate(member,bytes){
if(member.method===0)return memberBytes(bytes,member);
if(member.method!==8)throw new Error('compression method '+member.method+' is not one it can read');
const Stream=global.DecompressionStream;
if(typeof Stream!=='function'||typeof global.Response!=='function'||typeof global.Blob!=='function'){
throw new Error('this browser cannot unpack deflated members (no DecompressionStream)');
}
const stream=new global.Blob([memberBytes(bytes,member)]).stream().pipeThrough(new Stream('deflate-raw'));
const flat=await new global.Response(stream).arrayBuffer();
if(flat.byteLength!==member.size){
throw new Error('"'+member.name+'" unpacked to '+flat.byteLength+' bytes, not the '+member.size+' it declares');
}
return new Uint8Array(flat);
}
async function unpackMember(bytes,member){
let unpacked;
try{
unpacked=await inflate(member,bytes);
}catch(error){
return refusal(
t('Tone3000 sent a ZIP package that this page could not read ({reason}). Nothing was sent to the pedal.',{
reason:message(error),
})
);
}
if(!unpacked||!unpacked.byteLength){
return refusal(
t('Tone3000 sent a ZIP package that this page could not read ({reason}). Nothing was sent to the pedal.',{
reason:'"'+member.name+'" is empty',
})
);
}
const copy=new Uint8Array(unpacked.length);
copy.set(unpacked);
return{ok:true,buffer:copy.buffer};
}
async function extractCabinet(input){
const bytes=asBytes(input);
if(!isZip(bytes))return{ok:true,packed:false,buffer:bytes};
let members;
try{
members=zipMembers(bytes);
}catch(error){
return refusal(
t('Tone3000 sent a ZIP package that this page could not read ({reason}). Nothing was sent to the pedal.',{
reason:message(error),
})
);
}
const wavs=wavMembers(members);
if(wavs.length===0){
return refusal(
t('Tone3000 sent a ZIP package and it holds no .wav file ({detail}), so there is no cabinet to offer. Nothing was sent to the pedal.',{
detail:describeMembers(members),
})
);
}
if(wavs.length===1){
const only=await unpackMember(bytes,wavs[0]);
if(!only.ok)return only;
return{ok:true,packed:true,name:wavs[0].name,buffer:only.buffer};
}
const labels=choiceLabels(wavs);
const choices=[];
for(let index=0;index<wavs.length;index+=1){
choices.push({name:labels[index]});
}
return{
ok:true,
packed:true,
choices:choices,
read:async function(index){
const member=wavs[index];
if(!member){
return refusal(t('that cabinet is no longer in the package, so nothing was offered. Nothing was sent to the pedal.'));
}
const one=await unpackMember(bytes,member);
if(!one.ok)return one;
return{ok:true,name:member.name,buffer:one.buffer};
},
};
}
function defaultStore(){
let area=null;
try{
area=global.sessionStorage||null;
}catch(error){
area=null;
}
return{
get:function(key){
try{
return area===null?null:area.getItem(key);
}catch(error){
return null;
}
},
set:function(key,value){
try{
if(area!==null)area.setItem(key,value);
}catch(error){
}
},
remove:function(key){
try{
if(area!==null)area.removeItem(key);
}catch(error){
}
},
};
}
function cleanAddress(){
const place=global.location;
if(!place||!global.history||typeof global.history.replaceState!=='function')return;
const kept=new URLSearchParams(String(place.search||''));
for(let index=0;index<CALLBACK_PARAMS.length;index+=1)kept.delete(CALLBACK_PARAMS[index]);
const query=kept.toString();
try{
global.history.replaceState(
null,
'',
place.pathname+(query?'?'+query:'')+(place.hash||'')
);
}catch(error){
}
}
function pageRedirect(){
const place=global.location;
if(!place)return'';
return String(place.origin||'')+String(place.pathname||'');
}
function resolve(options){
const given=options||{};
return{
clientId:given.clientId===undefined?CLIENT_ID:given.clientId,
crypto:given.crypto===undefined?global.crypto||null:given.crypto,
doFetch:
given.fetch===undefined
?typeof global.fetch==='function'
?global.fetch.bind(global)
:null
:given.fetch,
store:given.store||defaultStore(),
search:given.search===undefined?(global.location?global.location.search:''):given.search,
now:given.now||function(){return Date.now();},
navigate:given.navigate||function(url){if(global.location)global.location.assign(url);},
redirectUri:given.redirectUri===undefined?pageRedirect():given.redirectUri,
clean:given.clean||cleanAddress,
};
}
let blockedByPolicy=null;
if(global.document&&typeof global.document.addEventListener==='function'){
try{
global.document.addEventListener('securitypolicyviolation',function(event){
if(!event||!event.blockedURI)return;
blockedByPolicy={
blocked:String(event.blockedURI),
rule:String(event.violatedDirective||event.effectiveDirective||''),
};
});
}catch(error){
}
}
function ownRuleNames(host){
const doc=global.document;
if(!doc||typeof doc.querySelector!=='function')return null;
let meta=null;
try{
meta=doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
}catch(error){
return null;
}
if(meta===null||meta===undefined||typeof meta.getAttribute!=='function')return null;
const content=String(meta.getAttribute('content')||'');
const found=/(?:^|;)\s*connect-src\s+([^;]*)/i.exec(content);
if(found===null)return null;
return found[1].split(/\s+/).indexOf(host)>=0;
}
function policyMessage(step){
const stopped=blockedByPolicy;
if(stopped===null)return null;
blockedByPolicy=null;
if(hostAllowed(stopped.blocked)){
const host=hostOf(stopped.blocked);
if(ownRuleNames(host)===true){
return t('the browser stopped the {step} request to {blocked} although this page\'s own rule names {host}: the answer sent the request on to another address, and the rule does not name that one, so the file never arrived. Saving the file with your browser — unzipping the package first if it comes as one — and then pressing IMPORT WAV still gets it to the pedal. Nothing was sent to the pedal.',{
blocked:stopped.blocked,
host:host,
step:t(step),
});
}
return t('the browser blocked the {step} request to {blocked}, but the page published today does allow {host}: this tab is running an older copy of the page, with the safety rule it had when it was opened. Open the page again and the download will go through. Nothing was sent to the pedal.',{
blocked:stopped.blocked,
host:host,
step:t(step),
});
}
return t('the browser blocked the {step} request to {blocked} under the page\'s own safety rule ({rule}), so it never left. Nothing was sent to the pedal.',{
blocked:stopped.blocked,
rule:stopped.rule||'Content-Security-Policy',
step:t(step),
});
}
function settle(){
return new Promise(function(resolve){
if(typeof global.setTimeout==='function')global.setTimeout(resolve,0);
else resolve();
});
}
async function policyRefusal(step){
await settle();
const named=policyMessage(step);
return named===null?null:refusal(named);
}
function unreachable(url,error,step){
const named=policyMessage(step);
if(named!==null)return named;
return t('the page could not reach {host} while asking for {step}: {reason}. Nothing was sent to the pedal.',{
host:hostOf(url)||String(url),
step:t(step),
reason:message(error),
});
}
function unreadable(step,error){
return t('the answer from Tone3000 for {step} could not be read ({reason}). Nothing was sent to the pedal.',{
step:t(step),
reason:message(error),
});
}
async function begin(options){
const s=resolve(options);
if(!isConfigured(s.clientId)){
return refusal(t('this copy of the page carries no Tone3000 key, so the cabinet browser stays off. Nothing was sent to the pedal.'));
}
if(s.crypto===null||!s.crypto.subtle||typeof s.crypto.getRandomValues!=='function'){
return refusal(t('this browser cannot build the sign-in proof Tone3000 asks for, so nothing was fetched. Nothing was sent to the pedal.'));
}
let challenge;
const verifier=randomToken(32,s.crypto);
const state=randomToken(16,s.crypto);
try{
challenge=await challengeFor(verifier,s.crypto);
}catch(error){
return refusal(t('this browser cannot build the sign-in proof Tone3000 asks for, so nothing was fetched. Nothing was sent to the pedal.'));
}
s.store.set(KEYS.verifier,verifier);
s.store.set(KEYS.state,state);
s.store.set(KEYS.redirect,s.redirectUri);
s.navigate(
authorizeUrl({
clientId:s.clientId,
redirectUri:s.redirectUri,
challenge:challenge,
state:state,
})
);
return{ok:true};
}
async function complete(options){
const s=resolve(options);
let outcome;
try{
outcome=await run(s);
}catch(error){
outcome=refusal(
t('the Tone3000 import stopped on an unexpected answer ({reason}). Nothing was sent to the pedal.',{
reason:message(error),
})
);
}
s.clean();
return outcome;
}
async function run(s){
const params=new URLSearchParams(String(s.search===null||s.search===undefined?'':s.search));
if(!isConfigured(s.clientId)){
return refusal(t('this copy of the page carries no Tone3000 key, so the cabinet browser stays off. Nothing was sent to the pedal.'));
}
if(params.get('canceled')==='true'){
return refusal(t('you cancelled the Tone3000 sign-in. Nothing was sent to the pedal.'));
}
const reported=params.get('error');
if(reported){
return refusal(
t('Tone3000 reported an error: {reason}. Nothing was sent to the pedal.',{
reason:params.get('error_description')||reported,
})
);
}
const code=params.get('code');
const toneId=params.get('tone_id');
if(!code||!toneId){
return refusal(t('Tone3000 came back without naming a cabinet, so nothing was fetched. Nothing was sent to the pedal.'));
}
const expected=s.store.get(KEYS.state);
if(!expected||params.get('state')!==expected){
return refusal(t('this answer does not belong to the sign-in this tab started, so it was refused. Nothing was sent to the pedal.'));
}
const verifier=s.store.get(KEYS.verifier);
if(!verifier){
return refusal(t('this tab has no Tone3000 sign-in to finish, so nothing was fetched. Nothing was sent to the pedal.'));
}
if(s.doFetch===null){
return refusal(t('this browser cannot make the request, so nothing was fetched. Nothing was sent to the pedal.'));
}
const redirectUri=s.store.get(KEYS.redirect)||s.redirectUri;
const granted=await tokenRequest(
s,
{
grant_type:'authorization_code',
code:code,
code_verifier:verifier,
redirect_uri:redirectUri,
client_id:s.clientId,
},
'sign-in'
);
if(!granted.ok)return granted;
const tone=await getJson(s,API_BASE+'/tones/'+encodeURIComponent(toneId),'the tone details');
if(!tone.ok)return tone;
const listed=await getJson(
s,
API_BASE+'/models?tone_id='+encodeURIComponent(toneId)+'&page_size=300',
'the cabinet list'
);
if(!listed.ok)return listed;
let items=entriesOf(listed.value);
if(items.length===0){
const plain=await getJson(s,API_BASE+'/models?tone_id='+encodeURIComponent(toneId),'the cabinet list');
if(plain.ok)items=entriesOf(plain.value);
}
const model=pickModel(items);
if(model===null){
return refusal(
t('the tone you chose has no cabinet file (.wav): Tone3000 listed {count} model(s) for it and none is an IR ({detail}). Nothing was sent to the pedal.',{
count:items.length,
detail:describeModels(items)||t('the list came back empty'),
})
);
}
return download(s,model,recordOf(tone.value));
}
async function tokenRequest(s,fields,step){
const body=new URLSearchParams();
const names=Object.keys(fields);
for(let index=0;index<names.length;index+=1)body.set(names[index],fields[names[index]]);
let response;
try{
response=await s.doFetch(TOKEN_URL,{
method:'POST',
headers:{
'Content-Type':'application/x-www-form-urlencoded',
Accept:'application/json',
},
body:body.toString(),
});
}catch(error){
return refusal(unreachable(TOKEN_URL,error,step));
}
if(!response||!response.ok){
return refusal(
t('Tone3000 refused the {step} request ({status}). Nothing was sent to the pedal.',{
step:t(step),
status:response?response.status:0,
})
);
}
let payload;
try{
payload=await response.json();
}catch(error){
return refusal(unreadable(step,error));
}
if(!payload||typeof payload.access_token!=='string'||payload.access_token===''){
return refusal(unreadable(step,{message:'no access_token'}));
}
const previous=readTokens(s);
const held={
access:payload.access_token,
refresh:
typeof payload.refresh_token==='string'&&payload.refresh_token!==''
?payload.refresh_token
:previous
?previous.refresh
:'',
expiresAt:s.now()+(Number(payload.expires_in)||0)*1000,
};
s.store.set(KEYS.tokens,JSON.stringify(held));
return{ok:true,value:held};
}
async function accessToken(s){
const held=readTokens(s);
if(held===null){
return refusal(t('this tab has no Tone3000 sign-in to finish, so nothing was fetched. Nothing was sent to the pedal.'));
}
if(Number(held.expiresAt||0)-s.now()>RENEW_BEFORE_MS)return{ok:true,value:held.access};
if(!held.refresh){
return refusal(t('this tab has no Tone3000 sign-in to finish, so nothing was fetched. Nothing was sent to the pedal.'));
}
const renewed=await tokenRequest(
s,
{
grant_type:'refresh_token',
refresh_token:held.refresh,
client_id:s.clientId,
redirect_uri:s.redirectUri,
},
'sign-in'
);
if(!renewed.ok)return renewed;
return{ok:true,value:renewed.value.access};
}
async function getJson(s,url,step){
const token=await accessToken(s);
if(!token.ok)return token;
let response;
try{
response=await s.doFetch(url,{
headers:{Authorization:'Bearer '+token.value,Accept:'application/json'},
});
}catch(error){
return refusal(unreachable(url,error,step));
}
if(!response||!response.ok){
return refusal(
t('Tone3000 refused the {step} request ({status}). Nothing was sent to the pedal.',{
step:t(step),
status:response?response.status:0,
})
);
}
let payload;
try{
payload=await response.json();
}catch(error){
return refusal(unreadable(step,error));
}
return{ok:true,value:payload};
}
async function fetchCabinet(s,url,token){
try{
return{ok:true,value:await s.doFetch(url,{headers:{Authorization:'Bearer '+token}})};
}catch(error){
const blocked=await policyRefusal('the cabinet file');
if(blocked!==null)return blocked;
}
try{
return{ok:true,value:await s.doFetch(url,{credentials:'omit'})};
}catch(error){
const blocked=await policyRefusal('the cabinet file');
if(blocked!==null)return blocked;
return refusal(
t('the page could not read the cabinet file from {host} ({reason}), with the sign-in token or without it. Nothing was sent to the pedal.',{
host:hostOf(url)||String(url),
reason:message(error),
})
);
}
}
async function download(s,model,tone){
const url=String(model.model_url||'');
if(!hostAllowed(url)){
return refusal(
t('the page may only make web requests to {allowed}, and the cabinet is on {host}: the download was refused by that policy. Nothing was sent to the pedal.',{
allowed:HOSTS.join(', '),
host:hostOf(url)||url,
})
);
}
const token=await accessToken(s);
if(!token.ok)return token;
const answered=await fetchCabinet(s,url,token.value);
if(!answered.ok)return answered;
const response=answered.value;
if(!response||!response.ok){
return refusal(
t('Tone3000 refused the {step} request ({status}). Nothing was sent to the pedal.',{
step:t('the cabinet file'),
status:response?response.status:0,
})
);
}
let buffer;
try{
buffer=await response.arrayBuffer();
}catch(error){
return refusal(unreadable('the cabinet file',error));
}
if(!buffer||!buffer.byteLength){
return refusal(t('the file Tone3000 sent is empty, so nothing was offered. Nothing was sent to the pedal.'));
}
const unpacked=await extractCabinet(buffer);
if(!unpacked.ok)return unpacked;
if(unpacked.choices){
const read=unpacked.read;
return{
ok:true,
choices:unpacked.choices,
read:async function(index){
const one=await read(index);
if(!one.ok)return one;
return{ok:true,name:fileNameFor(one.name,url),buffer:one.buffer};
},
};
}
if(unpacked.packed)return{ok:true,name:fileNameFor(unpacked.name,url),buffer:unpacked.buffer};
const named=String(model.name||'').trim()||String((tone&&tone.name)||'').trim();
return{ok:true,name:fileNameFor(named,url),buffer:buffer};
}
function isReturning(search){
const params=new URLSearchParams(String(search===null||search===undefined?'':search));
if(params.get('canceled')==='true')return true;
return params.has('code')||params.has('tone_id')||params.has('error');
}
function abort(options){
const s=resolve(options);
s.store.remove(KEYS.verifier);
s.store.remove(KEYS.state);
s.store.remove(KEYS.redirect);
s.store.remove(KEYS.tokens);
}
global.RigShadeTone3000={
isConfigured,
isReturning,
begin,
complete,
abort,
authorizeUrl,
challengeFor,
randomVerifier,
pickModel,
fileNameFor,
isZip,
extractCabinet,
zipMembers,
pickWav,
wavMembers,
cabinetLabel,
choiceLabels,
hostOf,
hostAllowed,
KEYS,
HOSTS,
AUTHORIZE_URL,
TOKEN_URL,
API_BASE,
};
})(typeof globalThis!=='undefined'?globalThis:this);