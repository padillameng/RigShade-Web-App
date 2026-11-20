(function(){
'use strict';
var I18N=window.RigShadeI18n||null;
function t(key,vars){
if(I18N!==null&&typeof I18N.t==='function'){
return I18N.t(key,vars);
}
var text=String(key);
if(!vars){
return text;
}
return text.replace(/\{(\w+)\}/g,function(match,name){
return Object.prototype.hasOwnProperty.call(vars,name)?String(vars[name]):match;
});
}
var form=document.querySelector('[data-shell="tester-form"]');
var pending=document.querySelector('[data-shell="tester-pending"]');
var status=document.querySelector('[data-shell="tester-status"]');
if(!form){
return;
}
var mailbox=(form.getAttribute('data-contact-email')||'').trim();
if(!/^[^\s@,;:"'<>]+@[^\s@,;:"'<>]+\.[^\s@,;:"'<>]+$/.test(mailbox)){
if(pending){
pending.hidden=false;
}
return;
}
form.hidden=false;
if(pending){
pending.hidden=true;
}
function field(name){
var input=form.elements[name];
return input&&typeof input.value==='string'?input.value.trim():'';
}
function mailtoUrl(values){
var email=String(values.email||'').trim();
var feedback=String(values.feedback||'').trim();
var subject=t('RigShade closed beta — access request');
var body=[
t('Closed beta request'),
'',
t('Email for the beta: {value}',{value:email||t('(not given)')}),
'',
t('Feedback about the webapp:'),
feedback||t('(not given)'),
'',
'--',
t('Sent from the RigShade WebApp.')
].join('\r\n');
return'mailto:'+mailbox+
'?subject='+encodeURIComponent(subject)+
'&body='+encodeURIComponent(body);
}
form.addEventListener('submit',function(event){
event.preventDefault();
var address=mailtoUrl({email:field('email'),feedback:field('feedback')});
if(status){
status.textContent=t('Opening your email app — the message goes to {mailbox}.',{mailbox:mailbox});
}
location.assign(address);
});
window.RigShadeTester={mailtoUrl:mailtoUrl,mailbox:mailbox};
})();