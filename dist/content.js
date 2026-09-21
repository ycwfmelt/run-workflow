var e=new Map;function t(e,t){let n=e.getBoundingClientRect();if(n.width<=0||n.height<=0)return!1;let r=window.getComputedStyle(e);if(r.display===`none`||r.visibility===`hidden`||r.opacity===`0`)return!1;let i=n.top+t.y,a=n.bottom+t.y,o=n.left+t.x,s=n.right+t.x,c=window.innerHeight||document.documentElement.clientHeight,l=window.innerWidth||document.documentElement.clientWidth;return a>=-50&&i<=c+50&&s>=-50&&o<=l+50}function n(e){return[`ul`,`ol`,`table`,`tbody`,`thead`,`tfoot`,`tr`,`form`,`section`,`article`,`nav`,`body`,`html`].includes(e)}function r(e){let t=e.tagName.toLowerCase();if(n(t))return!1;if([`button`,`select`,`textarea`].includes(t)||t===`input`&&e.type!==`hidden`||t===`a`&&e.hasAttribute(`href`)||t===`summary`)return!0;let r=e.getAttribute(`role`);if(r&&[`button`,`link`,`checkbox`,`radio`,`combobox`,`menuitem`,`tab`,`switch`,`searchbox`,`textbox`,`option`,`treeitem`].includes(r))return!0;let i=typeof e.className==`string`?e.className:``;if(i.includes(`ant-menu-item`)||i.includes(`el-menu-item`)||i.includes(`ant-select-selector`)||i.includes(`el-select__wrapper`)||i.includes(`ant-dropdown-trigger`)||i.includes(`el-dropdown-link`)||i.includes(`ant-btn`)||i.includes(`el-button`)||e.isContentEditable||e.hasAttribute(`onclick`))return!0;let a=e.getAttribute(`tabindex`);return a!==null&&parseInt(a,10)>=0||window.getComputedStyle(e).cursor===`pointer`}function i(e){return e.replace(/\s+/g,` `).replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g,`$1$2`).replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g,`$1$2`).trim().slice(0,100)}function a(e){let t=``,n=e.getAttribute(`aria-label`),r=e.getAttribute(`data-tooltip`)||e.getAttribute(`data-title`)||e.getAttribute(`data-original-title`);if(n&&n.trim())t=i(n);else if(r&&r.trim())t=i(r);else if(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement)t=i(e.value||e.placeholder||``);else{let n=e.getAttribute(`title`);if(n&&n.trim())t=i(n);else{let n=e.querySelector(`img`);if(n&&n.alt)t=i(n.alt);else{let n=e.querySelector(`svg`),r=n?.querySelector(`title`)?.textContent,a=n?.getAttribute(`aria-label`);t=r&&r.trim()?i(r):a&&a.trim()?i(a):i(e.innerText||e.textContent||``)}}}if(!t){let n=(e.className&&typeof e.className==`string`?e.className:``)+` `+(e.querySelector(`[class]`)?.className||``);/restart|reload|refresh|redo|sync/i.test(n)?t=`重启/刷新`:/delete|remove|trash|destroy/i.test(n)?t=`删除`:/edit|modify|update/i.test(n)?t=`编辑`:/more|ellipsis|dots|action/i.test(n)?t=`更多操作`:/search/i.test(n)&&(t=`搜索`)}let a=e.closest(`tr, [role='row'], .ant-table-row, .el-table__row, [class*='table-row'], [class*='TableRow'], [class*='data-row']`);if(a){let n=Array.from(a.querySelectorAll(`td, th, [role='cell'], [role='gridcell'], .ant-table-cell, .el-table__cell, [class*='cell']`)).filter(t=>!t.contains(e)).map(e=>i(e.textContent||``)).filter(e=>e&&e.length>0&&e.length<50);if(n.length>0){let e=n.slice(0,6).join(` | `);return t?`${t} (行数据: ${e})`:`(行数据: ${e})`}}let o=e.closest(`.ant-form-item, .el-form-item, .form-group, .form-item`);if(o){let n=o.querySelector(`label, .ant-form-item-label, .el-form-item__label`);if(n&&!n.contains(e)){let e=i(n.textContent||``);if(e)return t?`[${e}] ${t}`:`[${e}]`}}let s=e.closest(`.ant-modal, .ant-modal-confirm, .el-dialog, .el-message-box, [role='dialog'], .modal`);if(s){let n=s.querySelector(`.ant-modal-confirm-title, .ant-modal-title, .el-dialog__title, .el-message-box__title, .modal-title, [class*='title'], h1, h2, h3, h4`),r=n?i(n.textContent||``):``;if(!r){let e=s.querySelector(`.ant-modal-confirm-content, .el-message-box__message, .ant-modal-body, .modal-body`);e&&(r=i(e.textContent||``))}if(r&&(!n||!n.contains(e)))return t?`${t} (弹窗提示: ${r})`:`(弹窗提示: ${r})`}return t}function o(e){return e.id?`#${CSS.escape(e.id)}`:`${e.tagName.toLowerCase()}${Array.from(e.classList).filter(e=>!e.startsWith(`jev-`)).slice(0,2).map(e=>`.${CSS.escape(e)}`).join(``)}`}function s(e,n,i,a,o=0){if(o>12)return;let c=[];e instanceof Document?c.push(...Array.from(e.children)):e instanceof ShadowRoot?(a.shadowRootCount++,c.push(...Array.from(e.children))):e instanceof HTMLElement&&c.push(...Array.from(e.children));for(let l of c)if(l instanceof HTMLElement){if(t(l,n)&&r(l)&&i.push({el:l,offset:n,inIframe:n.x!==0||n.y!==0,inShadow:o>0&&e instanceof ShadowRoot}),l.shadowRoot&&s(l.shadowRoot,n,i,a,o+1),l instanceof HTMLIFrameElement){let e=l.getBoundingClientRect(),t=l.src||l.getAttribute(`src`)||`about:blank`;try{let r=l.contentDocument||l.contentWindow?.document;r&&(a.iframes.push({src:t,isSameOrigin:!0,rect:{x:Math.round(e.x+n.x),y:Math.round(e.y+n.y),width:Math.round(e.width),height:Math.round(e.height),top:Math.round(e.top+n.y),left:Math.round(e.left+n.x),bottom:Math.round(e.bottom+n.y),right:Math.round(e.right+n.x)}}),s(r,{x:n.x+e.left,y:n.y+e.top},i,a,o+1))}catch{a.iframes.push({src:t,isSameOrigin:!1,rect:{x:Math.round(e.x+n.x),y:Math.round(e.y+n.y),width:Math.round(e.width),height:Math.round(e.height),top:Math.round(e.top+n.y),left:Math.round(e.left+n.x),bottom:Math.round(e.bottom+n.y),right:Math.round(e.right+n.x)}})}}else s(l,n,i,a,o)}}function c(){e.clear();let n=[],r={iframes:[],shadowRootCount:0};s(document,{x:0,y:0},n,r,0);function c(e){let t=e.tagName.toLowerCase();if([`button`,`a`,`input`,`select`,`textarea`].includes(t))return!0;let n=e.getAttribute(`role`);if(n&&[`button`,`link`,`menuitem`,`tab`,`option`,`checkbox`,`radio`,`switch`,`combobox`].includes(n))return!0;let r=typeof e.className==`string`?e.className:``;return!!(r.includes(`ant-menu-item`)||r.includes(`el-menu-item`)||r.includes(`ant-select-selector`)||r.includes(`el-select__wrapper`)||r.includes(`ant-btn`)||r.includes(`el-button`))}let l=[];for(let e of n){let t=e.el;n.find(e=>e.el!==t&&e.el.contains(t)&&c(e.el))||(c(t)||!n.some(e=>e.el!==t&&t.contains(e.el)))&&l.push(e)}let u,d=document.querySelector(`.ant-modal-confirm, .ant-modal-content, .el-dialog__wrapper, .el-message-box__wrapper, [role='dialog'], dialog[open]`);if(d&&t(d,{x:0,y:0})){let e=d.querySelector(`.ant-modal-confirm-title, .ant-modal-title, .el-dialog__title, .el-message-box__title, [class*='title'], h1, h2, h3, h4`),t=e?i(e.textContent||``):``;if(!t){let e=d.querySelector(`.ant-modal-confirm-content, .el-message-box__message, .ant-modal-body, .modal-body`);e&&(t=i(e.textContent||``))}u={isOpen:!0,title:t||`确认弹窗`},l.sort((e,t)=>{let n=d.contains(e.el),r=d.contains(t.el);return n&&!r?-1:!n&&r?1:0})}let f=1,p=[];for(let{el:t,offset:n}of l){let r=`el_${f++}`;e.set(r,t);let i=t.getBoundingClientRect(),s=t.tagName.toLowerCase(),c=t.type?.toLowerCase()||``,l=s===`input`&&![`button`,`submit`,`reset`,`checkbox`,`radio`,`image`,`file`].includes(c)||s===`textarea`||t.isContentEditable,u={x:Math.round(i.x+n.x),y:Math.round(i.y+n.y),width:Math.round(i.width),height:Math.round(i.height),top:Math.round(i.top+n.y),left:Math.round(i.left+n.x),bottom:Math.round(i.bottom+n.y),right:Math.round(i.right+n.x)};p.push({id:r,tag:s,role:t.getAttribute(`role`)||s,text:a(t),type:t.type,placeholder:t.placeholder,ariaLabel:t.getAttribute(`aria-label`)||void 0,value:t.value,href:t.href,name:t.getAttribute(`name`)||void 0,rect:u,center:{x:Math.round(u.left+u.width/2),y:Math.round(u.top+u.height/2)},isClickable:!l,isInput:l,selector:o(t)})}let m={url:window.location.href,title:document.title,isTopFrame:window===window.top,iframes:r.iframes,shadowRootCount:r.shadowRootCount,interactiveElementsCount:p.length,sampleElements:p.slice(0,35).map(e=>({id:e.id,tag:e.tag,text:e.text||e.placeholder||``,selector:e.selector})),timestamp:Date.now()};return{url:window.location.href,title:document.title,viewport:{width:window.innerWidth,height:window.innerHeight,scrollX:window.scrollX,scrollY:window.scrollY},elements:p,activeModal:u,diagnostics:m}}var l=class e{static instance=null;container=null;shadow=null;cursorEl=null;badgeEl=null;hideTimer=null;isVisible=!1;currentX=0;currentY=0;constructor(){window===window.top&&this.initDOM()}static getInstance(){return e.instance||=new e,e.instance}initDOM(){if(this.container||window!==window.top)return;this.container=document.createElement(`div`),this.container.id=`ang-virtual-cursor-host`,this.container.style.cssText=`
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
      overflow: visible !important;
    `,this.shadow=this.container.attachShadow({mode:`open`});let e=document.createElement(`style`);e.textContent=`
      :host {
        pointer-events: none !important;
      }
      .cursor-wrapper {
        position: fixed;
        left: 0;
        top: 0;
        will-change: transform;
        pointer-events: none;
        transition: opacity 0.25s ease;
        opacity: 0;
        z-index: 2147483647;
      }
      .cursor-wrapper.visible {
        opacity: 1;
      }
      .cursor-body {
        position: relative;
        display: flex;
        align-items: center;
        gap: 6px;
        filter: drop-shadow(0 2px 8px rgba(99, 102, 241, 0.45));
        transition: transform 0.08s ease;
      }
      .cursor-body.clicking {
        transform: scale(0.85);
      }
      .cursor-svg {
        width: 22px;
        height: 22px;
        transform: translate(-1px, -1px);
      }
      .cursor-badge {
        background: rgba(15, 23, 42, 0.85);
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid rgba(139, 92, 246, 0.5);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        gap: 4px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        letter-spacing: 0.3px;
        user-select: none;
      }
      .cursor-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #38bdf8;
        box-shadow: 0 0 6px #38bdf8;
      }
      .click-ripple {
        position: fixed;
        width: 12px;
        height: 12px;
        margin-left: -6px;
        margin-top: -6px;
        border-radius: 50%;
        border: 2px solid #38bdf8;
        background: rgba(56, 189, 248, 0.25);
        pointer-events: none;
        animation: ang-ripple 0.42s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
      }
      @keyframes ang-ripple {
        0% {
          transform: scale(1);
          opacity: 1;
        }
        100% {
          transform: scale(4.5);
          opacity: 0;
        }
      }
    `;let t=document.createElement(`div`);t.className=`cursor-wrapper`,this.cursorEl=t,t.innerHTML=`
      <div class="cursor-body" id="ang-cursor-body">
        <svg class="cursor-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ang-cursor-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#8b5cf6" />
              <stop offset="100%" stop-color="#3b82f6" />
            </linearGradient>
          </defs>
          <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.54.35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z" 
                fill="url(#ang-cursor-grad)" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
        <div class="cursor-badge">
          <span class="cursor-dot"></span>
          <span>Ang</span>
        </div>
      </div>
    `,this.shadow.appendChild(e),this.shadow.appendChild(t);let n=()=>{let e=document.body||document.documentElement;e&&!e.contains(this.container)&&e.appendChild(this.container)};document.readyState===`loading`?document.addEventListener(`DOMContentLoaded`,n):n()}update(e,t,n){if(window!==window.top||((!this.container||!this.cursorEl)&&this.initDOM(),!this.cursorEl))return;this.currentX=e,this.currentY=t,this.cursorEl.style.transform=`translate3d(${e}px, ${t}px, 0)`,this.isVisible||(this.isVisible=!0,this.cursorEl.classList.add(`visible`)),clearTimeout(this.hideTimer),this.hideTimer=setTimeout(()=>{this.hide()},4e3);let r=this.shadow?.getElementById(`ang-cursor-body`);n===`down`?(r?.classList.add(`clicking`),this.createRipple(e,t)):n===`up`?r?.classList.remove(`clicking`):n===`click`&&(r?.classList.add(`clicking`),this.createRipple(e,t),setTimeout(()=>{r?.classList.remove(`clicking`)},120))}createRipple(e,t){if(!this.shadow)return;let n=document.createElement(`div`);n.className=`click-ripple`,n.style.left=`${e}px`,n.style.top=`${t}px`,this.shadow.appendChild(n),setTimeout(()=>{n.remove()},450)}hide(){this.cursorEl&&(this.isVisible=!1,this.cursorEl.classList.remove(`visible`),(this.shadow?.getElementById(`ang-cursor-body`))?.classList.remove(`clicking`))}};window===window.top&&l.getInstance();function u(t){d();let n=e.get(t);n&&(n.scrollIntoView({behavior:`smooth`,block:`center`}),n.style.outline=`3px solid #10b981`,n.style.boxShadow=`0 0 10px rgba(16, 185, 129, 0.6)`,n.classList.add(`ang-highlight`))}function d(){document.querySelectorAll(`.ang-highlight`).forEach(e=>{e.style.outline=``,e.style.boxShadow=``,e.classList.remove(`ang-highlight`)})}chrome.runtime.onMessage.addListener((e,t,n)=>{switch(e.type){case`EXTRACT_DOM`:n({success:!0,state:c()});break;case`DIAGNOSE_PAGE`:n({success:!0,diagnostics:c().diagnostics});break;case`HIGHLIGHT_ELEMENT`:u(e.elementId),n({success:!0});break;case`CLEAR_HIGHLIGHTS`:d(),n({success:!0});break;case`VIRTUAL_MOUSE_UPDATE`:window===window.top&&l.getInstance().update(e.x,e.y,e.action),n({success:!0});break;case`VIRTUAL_MOUSE_HIDE`:window===window.top&&l.getInstance().hide(),n({success:!0})}return!0}),console.log(`[Ang] Content script loaded and listening.`);