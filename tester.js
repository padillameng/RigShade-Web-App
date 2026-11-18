(function(){
'use strict';
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
var subject='RigShade beta tester request — '+(device||'Android');
var body=[
'Beta tester request',
'',
'Email for the promo code: '+(email||'(not given)'),
'Phone: '+(device||'(not given)'),
'Android: '+(android||'(not given)'),
'',
'Anything else:',
notes||'(nothing added)',
'',
'--',
'Sent from the RigShade control page.'
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
status.textContent='Opening your email app — the message goes to '+mailbox+'.';
}
location.assign(address);
});
window.RigShadeTester={mailtoUrl:mailtoUrl,mailbox:mailbox};
})();