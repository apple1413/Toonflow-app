import{d as u,b as e,a1 as $,z as A,ae as D,J as P,g as o,H as z,aa as J,Z as R,ab as j,a0 as O}from"./index-QbFJIM0X.js";import{I as d}from"./index-D2S-f-AL.js";/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var U={action:{type:Function},description:{type:[String,Function]},image:{type:[String,Function]},imageStyle:{type:Object},size:{type:String,default:"medium",validator:function(i){return i?["small","medium","large"].includes(i):!0}},title:{type:[String,Function]},type:{type:String,default:"empty",validator:function(i){return i?["empty","success","fail","network-error","maintenance"].includes(i):!0}}};/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var X=u({name:"MaintenanceSvg",setup:function(){return function(){return e("svg",{width:"1em",height:"1em",viewBox:"0 0 48 48",fill:"none",xmlns:"http://www.w3.org/2000/svg"},[e("g",{id:"è·¯åµäºä»¶-traffic-events"},[e("g",{id:"Subtract"},[e("path",{d:"M29.5237 17L24 3.82812L18.4763 17H29.5237Z",fill:"var(--td-text-color-placeholder)"},null),e("path",{d:"M31.2011 21H16.7989L13.6699 28.4615H34.3301L31.2011 21Z",fill:"var(--td-text-color-placeholder)"},null),e("path",{d:"M36.0076 32.4615H11.9924L9.66997 37.9997H6V41.9997H42V37.9997H38.33L36.0076 32.4615Z",fill:"var(--td-text-color-placeholder)"},null)])])])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var q=u({name:"NetworkErrorSvg",setup:function(){return function(){return e("svg",{width:"1em",height:"1em",viewBox:"0 0 48 48",fill:"none",xmlns:"http://www.w3.org/2000/svg"},[e("g",{id:"æ ç½ç»-no-network"},[e("g",{id:"Union"},[e("path",{d:"M26 17V2H22V17H26Z",fill:"var(--td-text-color-placeholder)"},null),e("path",{d:"M26.0078 20H22V24.0078H26.0078V20Z",fill:"var(--td-text-color-placeholder)"},null),e("path",{d:"M2.75751 13.45C7.29713 9.80916 12.553 7.50276 18 6.53088V28H30V6.53052C35.4475 7.50216 40.7038 9.80854 45.2438 13.4497L46.8021 14.6995L24.0006 43.2016L1.19922 14.6998L2.75751 13.45Z",fill:"var(--td-text-color-placeholder)"},null)])])])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var G=u({name:"EmptySvg",setup:function(){return function(){return e("svg",{width:"1em",height:"1em",viewBox:"0 0 48 48",fill:"none",xmlns:"http://www.w3.org/2000/svg"},[e("g",{id:"æ ç»æ-no-result"},[e("g",{id:"Union"},[e("path",{d:"M22 0H26V8H22V0Z",fill:"var(--td-text-color-placeholder)"},null),e("path",{d:"M10.002 1.17157L7.17353 4L13.002 9.82843L15.8304 7L10.002 1.17157Z",fill:"var(--td-text-color-placeholder)"},null),e("path",{"fill-rule":"evenodd","clip-rule":"evenodd",d:"M2 27.4689L10.8394 12H37.1606L46 27.4689V44H2V27.4689ZM13.1606 16L7.44636 26H17.8025L18.1889 27.5015C18.8551 30.0898 21.207 32 24 32C26.793 32 29.1449 30.0898 29.8111 27.5015L30.1975 26H40.5536L34.8394 16H13.1606Z",fill:"var(--td-text-color-placeholder)"},null),e("path",{d:"M37.998 1.17157L32.1696 7L34.998 9.82843L40.8265 4L37.998 1.17157Z",fill:"var(--td-text-color-placeholder)"},null)])])])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var K=u({name:"FailSvg",setup:function(){return function(){return e("svg",{width:"1em",height:"1em",viewBox:"0 0 48 48",fill:"none",xmlns:"http://www.w3.org/2000/svg"},[e("path",{"fill-rule":"evenodd","clip-rule":"evenodd",d:"M24 6C14.0589 6 6 14.0589 6 24C6 33.9411 14.0589 42 24 42C33.9411 42 42 33.9411 42 24C42 14.0589 33.9411 6 24 6ZM2 24C2 11.8497 11.8497 2 24 2C36.1503 2 46 11.8497 46 24C46 36.1503 36.1503 46 24 46C11.8497 46 2 36.1503 2 24ZM26 13V28H22V13H26ZM22 31H26.0078V35.0078H22V31Z",fill:"#D54941"},null)])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var Q=u({name:"SuccessSvg",setup:function(){return function(){return e("svg",{width:"1em",height:"1em",viewBox:"0 0 48 48",fill:"none",xmlns:"http://www.w3.org/2000/svg"},[e("path",{"fill-rule":"evenodd","clip-rule":"evenodd",d:"M24 42C33.9411 42 42 33.9411 42 24C42 14.0589 33.9411 6 24 6C14.0589 6 6 14.0589 6 24C6 33.9411 14.0589 42 24 42ZM46 24C46 36.1503 36.1503 46 24 46C11.8497 46 2 36.1503 2 24C2 11.8497 11.8497 2 24 2C36.1503 2 46 11.8497 46 24ZM21 32.8284L12.1716 24L15 21.1716L21 27.1716L33 15.1716L35.8284 18L21 32.8284Z",fill:"#2BA471"},null)])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var W=u({name:"TEmpty",components:{TImage:d},props:U,setup:function(i,h){var l=h.slots,s=P(i),w=s.size,C=s.image,y=s.description,L=s.title,S=s.type,H=$("empty"),n=H.globalConfig,v=A("empty"),E=o(function(){return i.action||l.action}),M=D(),Z=M.SIZE,p=z(),B=o(function(){return{maintenance:{image:n.value.image.maintenance||X,title:n.value.titleText.maintenance},success:{image:n.value.image.success||Q,title:n.value.titleText.success},fail:{image:n.value.image.fail||K,title:n.value.titleText.fail},"network-error":{image:n.value.image.networkError||q,title:n.value.titleText.networkError},empty:{image:n.value.image.empty||G,title:n.value.titleText.empty}}}),_=o(function(){return[v.value,Z.value[w.value]]}),V=["".concat(v.value,"__title")],I=["".concat(v.value,"__image")],T=["".concat(v.value,"__description")],b=["".concat(v.value,"__action")],m=o(function(){var t;return(t=B.value[S.value])!==null&&t!==void 0?t:null}),g=o(function(){var t,a;return C.value||(l==null||(t=l.image)===null||t===void 0?void 0:t.call(l))||((a=m.value)===null||a===void 0?void 0:a.image)}),f=o(function(){var t,a;return L.value||(l==null||(t=l.title)===null||t===void 0?void 0:t.call(l))||((a=m.value)===null||a===void 0?void 0:a.title)}),x=o(function(){var t;return y.value||(l==null||(t=l.description)===null||t===void 0?void 0:t.call(l))}),k=function(){return f.value?e("div",{class:V},[f.value]):null},F=function(){return x.value?e("div",{class:T},[x.value]):null},N=function(){var a=g.value,c=null;return J(a)?c=e(d,{src:a},null):a&&Reflect.has(a,"setup")?c=R(a):j(a)&&(c=e(d,a,null)),c};return function(){return e("div",{class:_.value},[g.value?e("div",{class:I,style:i.imageStyle},[l!=null&&l.image?p("image"):N()]):null,k(),F(),E.value?e("div",{class:b},[p("action")]):null])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var te=O(W);export{te as E};
