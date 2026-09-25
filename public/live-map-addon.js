(()=>{'use strict';
const add=()=>{
  if(!document.querySelector('.shell')) return;
  const host=document.querySelector('.radar-actions');
  if(!host || host.querySelector('[data-live-map]')) return;
  const b=document.createElement('button');
  b.className='secondary';
  b.dataset.liveMap='1';
  b.type='button';
  b.textContent='◉ Live Map';
  b.onclick=()=>{location.href='/live-map/'};
  host.prepend(b);
};
new MutationObserver(add).observe(document.documentElement,{subtree:true,childList:true});
add();
})();