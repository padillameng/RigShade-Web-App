(function(){
'use strict';
if(new URLSearchParams(location.search).has('wire')){
document.querySelector('[data-shell="wire"]').hidden=false;
}
if(window.RigShadeToneLibrary&&window.RigShadeLibraryUI){
document.documentElement.setAttribute('data-tone-library',String(window.RigShadeToneLibrary.count));
}
window.RigShadeUI.boot({root:document.querySelector('[data-shell="page"]')});
})();