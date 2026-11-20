(function(){
'use strict';
if(new URLSearchParams(location.search).has('wire')){
document.querySelector('[data-shell="wire"]').hidden=false;
}
if(window.RigShadeToneLibrary&&window.RigShadeLibraryUI){
document.documentElement.setAttribute('data-tone-library',String(window.RigShadeToneLibrary.count));
}
const demo=window.RigShadeDemo;
const playingDemo=demo&&demo.isDemo();
const shell=window.RigShadeUI.boot({
root:document.querySelector('[data-shell="page"]'),
link:playingDemo?demo.createLink():undefined,
});
if(playingDemo){
shell.ctx.link.connect();
demo.startTour();
}else if(demo){
demo.mountEntry();
}
const tone3000=window.RigShadeTone3000;
if(tone3000&&tone3000 .isConfigured()&&tone3000 .isReturning(location.search)){
shell.ctx.go('BANK');
}
})();