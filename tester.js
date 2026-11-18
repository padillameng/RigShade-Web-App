(function(){
'use strict';
var form=document.querySelector('[data-shell="tester-form"]');
var pending=document.querySelector('[data-shell="tester-pending"]');
var status=document.querySelector('[data-shell="tester-status"]');
if(!form){
return;
}
var base=(form.getAttribute('data-issues-url')||'').trim();
if(!/^https:\/\/[^\s"'<>]+$/.test(base)){
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
function issueUrl(values){
var handle=String(values.handle||'').replace(/^@+/,'').trim();
var device=String(values.device||'').trim();
var android=String(values.android||'').trim();
var notes=String(values.notes||'').trim();
var title='[Beta tester] '+(handle||'request')+(device?' — '+device:'');
var body=[
'### Beta tester request',
'',
'- GitHub: '+(handle?'@'+handle:'(not given)'),
'- Phone: '+(device||'(not given)'),
'- Android: '+(android||'(not given)'),
'',
'### Anything else',
'',
notes||'(nothing added)',
'',
'---',
'_Written through the RigShade control page._'
].join('\n');
var query=new URLSearchParams();
query.set('title',title);
query.set('body',body);
return base+(base.indexOf('?')===-1?'?':'&')+query.toString();
}
form.addEventListener('submit',function(event){
event.preventDefault();
var address=issueUrl({
handle:field('handle'),
device:field('device'),
android:field('android'),
notes:field('notes')
});
if(status){
status.textContent='Opening GitHub…';
}
var opened=window.open(address,'_blank','noopener');
if(!opened){
location.assign(address);
}
});
window.RigShadeTester={issueUrl:issueUrl};
})();