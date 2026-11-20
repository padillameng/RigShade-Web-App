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
function pickModel(items){
const list=Array.isArray(items)?items:[];
for(let index=0;index<list.length;index+=1){
const item=list[index]||{};
if(item.architecture_version)continue;
if(!/\.wav(?:[?#]|$)/i.test(String(item.model_url||'')))continue;
return item;
}
return null;
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
function unreachable(url,error){
return t('the page could not reach {host}: {reason}. Nothing was sent to the pedal.',{
host:hostOf(url)||String(url),
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
const items=Array.isArray(listed.value)
?listed.value
:(listed.value&&listed.value.models)||[];
const model=pickModel(items);
if(model===null){
return refusal(t('the tone you chose has no cabinet file (.wav), so there is nothing to offer. Nothing was sent to the pedal.'));
}
return download(s,model,tone.value);
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
return refusal(unreachable(TOKEN_URL,error));
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
return refusal(unreachable(url,error));
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
let response;
try{
response=await s.doFetch(url,{headers:{Authorization:'Bearer '+token.value}});
}catch(error){
return refusal(unreachable(url,error));
}
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
hostOf,
hostAllowed,
KEYS,
HOSTS,
AUTHORIZE_URL,
TOKEN_URL,
API_BASE,
};
})(typeof globalThis!=='undefined'?globalThis:this);