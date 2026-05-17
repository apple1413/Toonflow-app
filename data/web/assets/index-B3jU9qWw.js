import{d as h,z as y,v as n,b as l,I as g,g as r,dp as c,a0 as p}from"./index-QbFJIM0X.js";/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var m={align:{type:String,default:"center",validator:function(t){return t?["left","right","center"].includes(t):!0}},content:{type:[String,Function]},dashed:Boolean,default:{type:[String,Function]},layout:{type:String,default:"horizontal",validator:function(t){return t?["horizontal","vertical"].includes(t):!0}},size:{type:[String,Number]}};/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var z=h({name:"TDivider",props:m,setup:function(t){var e=y("divider"),v=g();return function(){var u=v("default","content"),o=r(function(){return t.layout!=="vertical"}),a=r(function(){return o.value&&!!u}),d=["".concat(e.value),["".concat(e.value,"--").concat(t.layout)],n(n(n({},"".concat(e.value,"--dashed"),!!t.dashed),"".concat(e.value,"--with-text"),!!a.value),"".concat(e.value,"--with-text-").concat(t.align),!!a.value)],s=r(function(){if(t.size){var f=o.value?"".concat(c(t.size)," 0"):"0 ".concat(c(t.size));return{margin:f}}return null});return l("div",{class:d,style:s.value},[a.value&&l("span",{class:"".concat(e.value,"__inner-text")},[u])])}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var C=p(z);export{C as D};
