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
var device=String(values.device||'').trim();
var android=String(values.android||'').trim();
var notes=String(values.notes||'').trim();
var subject=t('RigShade beta tester request — {device}',{device:device||'Android'});
var body=[
t('Beta tester request'),
'',
t('Email for the promo code: {value}',{value:email||t('(not given)')}),
t('Phone: {value}',{value:device||t('(not given)')}),
t('Android: {value}',{value:android||t('(not given)')}),
'',
t('Anything else:'),
notes||t('(nothing added)'),
'',
'--',
t('Sent from the RigShade control page.')
].join('\r\n');
return'mailto:'+mailbox+
'?subject='+encodeURIComponent(subject)+
'&body='+encodeURIComponent(body);
}
form.addEventListener('submit',function(event){
event.preventDefault();
var address=mailtoUrl({
email:field('email'),
device:field('device'),
android:field('android'),
notes:field('notes')
});
if(status){
status.textContent=t('Opening your email app — the message goes to {mailbox}.',{mailbox:mailbox});
}
location.assign(address);
});
window.RigShadeTester={mailtoUrl:mailtoUrl,mailbox:mailbox};
})();