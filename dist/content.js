var e=new Map;function t(e){let t=e.getBoundingClientRect();if(t.width<=0||t.height<=0)return!1;let n=window.getComputedStyle(e);if(n.display===`none`||n.visibility===`hidden`||n.opacity===`0`)return!1;let r=window.innerHeight||document.documentElement.clientHeight,i=window.innerWidth||document.documentElement.clientWidth;return t.bottom>=-50&&t.top<=r+50&&t.right>=-50&&t.left<=i+50}function n(e){let t=e.tagName.toLowerCase();if([`button`,`select`,`textarea`].includes(t)||t===`input`&&e.type!==`hidden`||t===`a`&&e.hasAttribute(`href`)||t===`summary`)return!0;let n=e.getAttribute(`role`);if(n&&[`button`,`link`,`checkbox`,`radio`,`combobox`,`menuitem`,`tab`,`switch`,`searchbox`,`textbox`].includes(n)||e.isContentEditable||e.hasAttribute(`onclick`))return!0;let r=e.getAttribute(`tabindex`);return r!==null&&parseInt(r,10)>=0||window.getComputedStyle(e).cursor===`pointer`}function r(e){return e.replace(/\s+/g,` `).trim().slice(0,100)}function i(e){let t=e.getAttribute(`aria-label`);if(t&&t.trim())return r(t);if(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement){if(e.placeholder)return r(e.placeholder);if(e.value)return r(e.value)}let n=e.getAttribute(`title`);if(n&&n.trim())return r(n);let i=e.querySelector(`img`);return i&&i.alt?r(i.alt):r(e.innerText||e.textContent||``)}function a(e){return e.id?`#${CSS.escape(e.id)}`:`${e.tagName.toLowerCase()}${Array.from(e.classList).filter(e=>!e.startsWith(`jev-`)).slice(0,2).map(e=>`.${CSS.escape(e)}`).join(``)}`}function o(){e.clear();let r=document.querySelectorAll(`button, a, input, select, textarea, [role], [onclick], [tabindex], [contenteditable], summary`),o=[];r.forEach(e=>{t(e)&&n(e)&&o.push(e)});let s=[];for(let e of o)o.find(t=>t!==e&&t.contains(e)&&[`button`,`a`].includes(t.tagName.toLowerCase()))||s.push(e);let c=1,l=[];for(let t of s){let n=`el_${c++}`;e.set(n,t);let r=t.getBoundingClientRect(),o=t.tagName.toLowerCase(),s=[`input`,`textarea`,`select`].includes(o)||t.isContentEditable;l.push({id:n,tag:o,role:t.getAttribute(`role`)||o,text:i(t),type:t.type,placeholder:t.placeholder,ariaLabel:t.getAttribute(`aria-label`)||void 0,value:t.value,href:t.href,name:t.getAttribute(`name`)||void 0,rect:{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,left:r.left,bottom:r.bottom,right:r.right},center:{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)},isClickable:!s,isInput:s,selector:a(t)})}return{url:window.location.href,title:document.title,viewport:{width:window.innerWidth,height:window.innerHeight,scrollX:window.scrollX,scrollY:window.scrollY},elements:l}}var s=`jev-overlay-container`,c=!0;function l(){let e=document.getElementById(s);return e||(e=document.createElement(`div`),e.id=s,e.style.cssText=`
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483647;
    `,document.body.appendChild(e)),e}function u(){let e=document.getElementById(s);e&&(e.innerHTML=``),document.querySelectorAll(`.jev-active-highlight`).forEach(e=>{e.classList.remove(`jev-active-highlight`)})}function d(e){if(u(),!c)return;let t=l(),n=window.scrollX,r=window.scrollY;e.forEach(e=>{let i=document.createElement(`div`);i.className=`jev-element-badge`,i.textContent=e.id.replace(`el_`,``),i.style.cssText=`
      position: absolute;
      left: ${e.rect.left+n}px;
      top: ${e.rect.top+r-14}px;
      background: #7c3aed;
      color: #ffffff;
      font-size: 11px;
      font-weight: bold;
      font-family: monospace, sans-serif;
      padding: 1px 4px;
      border-radius: 4px;
      border: 1px solid #c4b5fd;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      line-height: 1.1;
      pointer-events: none;
      user-select: none;
    `,t.appendChild(i)})}function f(t){document.querySelectorAll(`.jev-active-highlight`).forEach(e=>{e.style.outline=``,e.style.boxShadow=``});let n=e.get(t);n&&(n.scrollIntoView({behavior:`smooth`,block:`center`}),n.style.outline=`3px solid #10b981`,n.style.boxShadow=`0 0 10px rgba(16, 185, 129, 0.6)`)}function p(e){c=e;let t=document.getElementById(s);t&&(t.style.display=e?`block`:`none`)}chrome.runtime.onMessage.addListener((e,t,n)=>{switch(e.type){case`EXTRACT_DOM`:{let e=o();d(e.elements),n({success:!0,state:e});break}case`HIGHLIGHT_ELEMENT`:f(e.elementId),n({success:!0});break;case`CLEAR_HIGHLIGHTS`:u(),n({success:!0});break;case`TOGGLE_OVERLAY`:p(e.visible),n({success:!0})}return!0}),console.log(`[JevPilot] Content script loaded and listening.`);