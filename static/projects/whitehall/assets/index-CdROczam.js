import"./styles-B780_5H4.js";import{s as Z,v as hl,k as zi,t as cn,p as It,T as qn,i as Cc,a as Lc,U as Ft,_ as Pc,b as fl,c as Os,d as Ur,C as Ei,R as Ot,e as pl,L as Zs,F as jr,f as Dc,D as Uc,g as Gi,h as Ic,j as Kr,l as ki,m as ml,n as Mt,o as Mi,q as Nc,r as Fc,u as Oc,M as Bc,B as Ir,w as zc,x as Js,y as gl,z as wa,A as Gc,E as kc,G as Hc,H as Vc,I as Ra,J as _l,K as Ca,N as vl,O as xl,P as Qn,Q as Zr,S as Wc,V as Ml,W as Sl,X as Xc,Y as $c,Z as qc,$ as Yc,a0 as jc,a1 as Kc,a2 as Zc,a3 as Jr,a4 as Qr,a5 as Jc,a6 as yl,a7 as El,a8 as Qc,a9 as ea,aa as ta,ab as eu,ac as bl,ad as tu,ae as nu,af as iu,ag as su,ah as na,ai as ru,aj as au,ak as ia,al as Tl,am as ou,an as lu,ao as cu,ap as Al,aq as ws,ar as wl,as as uu,at as du,au as hu,av as fu,aw as pu,ax as Rl,ay as mu,az as Cl,aA as gu,aB as _u}from"./projects-BvEPImvL.js";/**
 * @license
 * Copyright 2010-2023 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const sa="160",ti={ROTATE:0,DOLLY:1,PAN:2},Ln={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},vu=0,La=1,xu=2,Ll=1,Pl=2,_n=3,Fn=0,Bt=1,vn=2,Sn=0,Si=1,Pa=2,Da=3,Ua=4,Mu=5,Xn=100,Su=101,yu=102,Ia=103,Na=104,Eu=200,bu=201,Tu=202,Au=203,Nr=204,Fr=205,wu=206,Ru=207,Cu=208,Lu=209,Pu=210,Du=211,Uu=212,Iu=213,Nu=214,Fu=0,Ou=1,Bu=2,Ls=3,zu=4,Gu=5,ku=6,Hu=7,Dl=0,Vu=1,Wu=2,In=0,Xu=1,$u=2,qu=3,Ul=4,Yu=5,ju=6,Il=300,bi=301,Ti=302,Or=303,Br=304,Bs=306,zr=1e3,nn=1001,Gr=1002,Dt=1003,Fa=1004,Qs=1005,Xt=1006,Ku=1007,Wi=1008,Nn=1009,Zu=1010,Ju=1011,ra=1012,Nl=1013,Dn=1014,Un=1015,Ai=1016,Fl=1017,Ol=1018,Yn=1020,Qu=1021,sn=1023,ed=1024,td=1025,jn=1026,wi=1027,nd=1028,Bl=1029,id=1030,zl=1031,Gl=1033,er=33776,tr=33777,nr=33778,ir=33779,Oa=35840,Ba=35841,za=35842,Ga=35843,kl=36196,ka=37492,Ha=37496,Va=37808,Wa=37809,Xa=37810,$a=37811,qa=37812,Ya=37813,ja=37814,Ka=37815,Za=37816,Ja=37817,Qa=37818,eo=37819,to=37820,no=37821,sr=36492,io=36494,so=36495,sd=36283,ro=36284,ao=36285,oo=36286,Hl=3e3,Kn=3001,rd=3200,ad=3201,Vl=0,od=1,qt="",St="srgb",yn="srgb-linear",aa="display-p3",zs="display-p3-linear",Ps="linear",rt="srgb",Ds="rec709",Us="p3",ni=7680,lo=519,ld=512,cd=513,ud=514,Wl=515,dd=516,hd=517,fd=518,pd=519,co=35044,uo="300 es",kr=1035,xn=2e3,Is=2001;class ei{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;const n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;const s=this._listeners[e];if(s!==void 0){const r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){if(this._listeners===void 0)return;const n=this._listeners[e.type];if(n!==void 0){e.target=this;const s=n.slice(0);for(let r=0,o=s.length;r<o;r++)s[r].call(this,e);e.target=null}}}const Tt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Rs=Math.PI/180,Hr=180/Math.PI;function $i(){const i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Tt[i&255]+Tt[i>>8&255]+Tt[i>>16&255]+Tt[i>>24&255]+"-"+Tt[e&255]+Tt[e>>8&255]+"-"+Tt[e>>16&15|64]+Tt[e>>24&255]+"-"+Tt[t&63|128]+Tt[t>>8&255]+"-"+Tt[t>>16&255]+Tt[t>>24&255]+Tt[n&255]+Tt[n>>8&255]+Tt[n>>16&255]+Tt[n>>24&255]).toLowerCase()}function Ut(i,e,t){return Math.max(e,Math.min(t,i))}function md(i,e){return(i%e+e)%e}function rr(i,e,t){return(1-t)*i+t*e}function ho(i){return(i&i-1)===0&&i!==0}function Vr(i){return Math.pow(2,Math.floor(Math.log(i)/Math.LN2))}function Ui(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function Nt(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}const gd={DEG2RAD:Rs};class Ae{constructor(e=0,t=0){Ae.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Ut(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){const n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,o=this.y-e.y;return this.x=r*n-o*s+e.x,this.y=r*s+o*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Xe{constructor(e,t,n,s,r,o,a,l,c){Xe.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c)}set(e,t,n,s,r,o,a,l,c){const u=this.elements;return u[0]=e,u[1]=s,u[2]=a,u[3]=t,u[4]=r,u[5]=l,u[6]=n,u[7]=o,u[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[3],l=n[6],c=n[1],u=n[4],f=n[7],p=n[2],m=n[5],g=n[8],_=s[0],h=s[3],d=s[6],x=s[1],v=s[4],T=s[7],D=s[2],A=s[5],w=s[8];return r[0]=o*_+a*x+l*D,r[3]=o*h+a*v+l*A,r[6]=o*d+a*T+l*w,r[1]=c*_+u*x+f*D,r[4]=c*h+u*v+f*A,r[7]=c*d+u*T+f*w,r[2]=p*_+m*x+g*D,r[5]=p*h+m*v+g*A,r[8]=p*d+m*T+g*w,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],u=e[8];return t*o*u-t*a*c-n*r*u+n*a*l+s*r*c-s*o*l}invert(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],u=e[8],f=u*o-a*c,p=a*l-u*r,m=c*r-o*l,g=t*f+n*p+s*m;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const _=1/g;return e[0]=f*_,e[1]=(s*c-u*n)*_,e[2]=(a*n-s*o)*_,e[3]=p*_,e[4]=(u*t-s*l)*_,e[5]=(s*r-a*t)*_,e[6]=m*_,e[7]=(n*l-c*t)*_,e[8]=(o*t-n*r)*_,this}transpose(){let e;const t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,o,a){const l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*o+c*a)+o+e,-s*c,s*l,-s*(-c*o+l*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(ar.makeScale(e,t)),this}rotate(e){return this.premultiply(ar.makeRotation(-e)),this}translate(e,t){return this.premultiply(ar.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){const t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const ar=new Xe;function Xl(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function Ns(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function _d(){const i=Ns("canvas");return i.style.display="block",i}const fo={};function Hi(i){i in fo||(fo[i]=!0,console.warn(i))}const po=new Xe().set(.8224621,.177538,0,.0331941,.9668058,0,.0170827,.0723974,.9105199),mo=new Xe().set(1.2249401,-.2249404,0,-.0420569,1.0420571,0,-.0196376,-.0786361,1.0982735),is={[yn]:{transfer:Ps,primaries:Ds,toReference:i=>i,fromReference:i=>i},[St]:{transfer:rt,primaries:Ds,toReference:i=>i.convertSRGBToLinear(),fromReference:i=>i.convertLinearToSRGB()},[zs]:{transfer:Ps,primaries:Us,toReference:i=>i.applyMatrix3(mo),fromReference:i=>i.applyMatrix3(po)},[aa]:{transfer:rt,primaries:Us,toReference:i=>i.convertSRGBToLinear().applyMatrix3(mo),fromReference:i=>i.applyMatrix3(po).convertLinearToSRGB()}},vd=new Set([yn,zs]),nt={enabled:!0,_workingColorSpace:yn,get workingColorSpace(){return this._workingColorSpace},set workingColorSpace(i){if(!vd.has(i))throw new Error(`Unsupported working color space, "${i}".`);this._workingColorSpace=i},convert:function(i,e,t){if(this.enabled===!1||e===t||!e||!t)return i;const n=is[e].toReference,s=is[t].fromReference;return s(n(i))},fromWorkingColorSpace:function(i,e){return this.convert(i,this._workingColorSpace,e)},toWorkingColorSpace:function(i,e){return this.convert(i,e,this._workingColorSpace)},getPrimaries:function(i){return is[i].primaries},getTransfer:function(i){return i===qt?Ps:is[i].transfer}};function yi(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function or(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}let ii;class $l{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{ii===void 0&&(ii=Ns("canvas")),ii.width=e.width,ii.height=e.height;const n=ii.getContext("2d");e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=ii}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const t=Ns("canvas");t.width=e.width,t.height=e.height;const n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);const s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let o=0;o<r.length;o++)r[o]=yi(r[o]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){const t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(yi(t[n]/255)*255):t[n]=yi(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let xd=0;class ql{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:xd++}),this.uuid=$i(),this.data=e,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let o=0,a=s.length;o<a;o++)s[o].isDataTexture?r.push(lr(s[o].image)):r.push(lr(s[o]))}else r=lr(s);n.url=r}return t||(e.images[this.uuid]=n),n}}function lr(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?$l.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let Md=0;class Ht extends ei{constructor(e=Ht.DEFAULT_IMAGE,t=Ht.DEFAULT_MAPPING,n=nn,s=nn,r=Xt,o=Wi,a=sn,l=Nn,c=Ht.DEFAULT_ANISOTROPY,u=qt){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Md++}),this.uuid=$i(),this.name="",this.source=new ql(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Ae(0,0),this.repeat=new Ae(1,1),this.center=new Ae(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Xe,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,typeof u=="string"?this.colorSpace=u:(Hi("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace=u===Kn?St:qt),this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.needsPMREMUpdate=!1}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Il)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case zr:e.x=e.x-Math.floor(e.x);break;case nn:e.x=e.x<0?0:1;break;case Gr:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case zr:e.y=e.y-Math.floor(e.y);break;case nn:e.y=e.y<0?0:1;break;case Gr:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}get encoding(){return Hi("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace===St?Kn:Hl}set encoding(e){Hi("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace=e===Kn?St:qt}}Ht.DEFAULT_IMAGE=null;Ht.DEFAULT_MAPPING=Il;Ht.DEFAULT_ANISOTROPY=1;class xt{constructor(e=0,t=0,n=0,s=1){xt.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const t=this.x,n=this.y,s=this.z,r=this.w,o=e.elements;return this.x=o[0]*t+o[4]*n+o[8]*s+o[12]*r,this.y=o[1]*t+o[5]*n+o[9]*s+o[13]*r,this.z=o[2]*t+o[6]*n+o[10]*s+o[14]*r,this.w=o[3]*t+o[7]*n+o[11]*s+o[15]*r,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r;const l=e.elements,c=l[0],u=l[4],f=l[8],p=l[1],m=l[5],g=l[9],_=l[2],h=l[6],d=l[10];if(Math.abs(u-p)<.01&&Math.abs(f-_)<.01&&Math.abs(g-h)<.01){if(Math.abs(u+p)<.1&&Math.abs(f+_)<.1&&Math.abs(g+h)<.1&&Math.abs(c+m+d-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;const v=(c+1)/2,T=(m+1)/2,D=(d+1)/2,A=(u+p)/4,w=(f+_)/4,I=(g+h)/4;return v>T&&v>D?v<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(v),s=A/n,r=w/n):T>D?T<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(T),n=A/s,r=I/s):D<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(D),n=w/r,s=I/r),this.set(n,s,r,t),this}let x=Math.sqrt((h-g)*(h-g)+(f-_)*(f-_)+(p-u)*(p-u));return Math.abs(x)<.001&&(x=1),this.x=(h-g)/x,this.y=(f-_)/x,this.z=(p-u)/x,this.w=Math.acos((c+m+d-1)/2),this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this.w=Math.max(e.w,Math.min(t.w,this.w)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this.w=Math.max(e,Math.min(t,this.w)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class Sd extends ei{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new xt(0,0,e,t),this.scissorTest=!1,this.viewport=new xt(0,0,e,t);const s={width:e,height:t,depth:1};n.encoding!==void 0&&(Hi("THREE.WebGLRenderTarget: option.encoding has been replaced by option.colorSpace."),n.colorSpace=n.encoding===Kn?St:qt),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Xt,depthBuffer:!0,stencilBuffer:!1,depthTexture:null,samples:0},n),this.texture=new Ht(s,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.flipY=!1,this.texture.generateMipmaps=n.generateMipmaps,this.texture.internalFormat=n.internalFormat,this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}setSize(e,t,n=1){(this.width!==e||this.height!==t||this.depth!==n)&&(this.width=e,this.height=t,this.depth=n,this.texture.image.width=e,this.texture.image.height=t,this.texture.image.depth=n,this.dispose()),this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.texture=e.texture.clone(),this.texture.isRenderTargetTexture=!0;const t=Object.assign({},e.texture.image);return this.texture.source=new ql(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class On extends Sd{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}}class Yl extends Ht{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Dt,this.minFilter=Dt,this.wrapR=nn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class yd extends Ht{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Dt,this.minFilter=Dt,this.wrapR=nn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Jn{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,o,a){let l=n[s+0],c=n[s+1],u=n[s+2],f=n[s+3];const p=r[o+0],m=r[o+1],g=r[o+2],_=r[o+3];if(a===0){e[t+0]=l,e[t+1]=c,e[t+2]=u,e[t+3]=f;return}if(a===1){e[t+0]=p,e[t+1]=m,e[t+2]=g,e[t+3]=_;return}if(f!==_||l!==p||c!==m||u!==g){let h=1-a;const d=l*p+c*m+u*g+f*_,x=d>=0?1:-1,v=1-d*d;if(v>Number.EPSILON){const D=Math.sqrt(v),A=Math.atan2(D,d*x);h=Math.sin(h*A)/D,a=Math.sin(a*A)/D}const T=a*x;if(l=l*h+p*T,c=c*h+m*T,u=u*h+g*T,f=f*h+_*T,h===1-a){const D=1/Math.sqrt(l*l+c*c+u*u+f*f);l*=D,c*=D,u*=D,f*=D}}e[t]=l,e[t+1]=c,e[t+2]=u,e[t+3]=f}static multiplyQuaternionsFlat(e,t,n,s,r,o){const a=n[s],l=n[s+1],c=n[s+2],u=n[s+3],f=r[o],p=r[o+1],m=r[o+2],g=r[o+3];return e[t]=a*g+u*f+l*m-c*p,e[t+1]=l*g+u*p+c*f-a*m,e[t+2]=c*g+u*m+a*p-l*f,e[t+3]=u*g-a*f-l*p-c*m,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){const n=e._x,s=e._y,r=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(n/2),u=a(s/2),f=a(r/2),p=l(n/2),m=l(s/2),g=l(r/2);switch(o){case"XYZ":this._x=p*u*f+c*m*g,this._y=c*m*f-p*u*g,this._z=c*u*g+p*m*f,this._w=c*u*f-p*m*g;break;case"YXZ":this._x=p*u*f+c*m*g,this._y=c*m*f-p*u*g,this._z=c*u*g-p*m*f,this._w=c*u*f+p*m*g;break;case"ZXY":this._x=p*u*f-c*m*g,this._y=c*m*f+p*u*g,this._z=c*u*g+p*m*f,this._w=c*u*f-p*m*g;break;case"ZYX":this._x=p*u*f-c*m*g,this._y=c*m*f+p*u*g,this._z=c*u*g-p*m*f,this._w=c*u*f+p*m*g;break;case"YZX":this._x=p*u*f+c*m*g,this._y=c*m*f+p*u*g,this._z=c*u*g-p*m*f,this._w=c*u*f-p*m*g;break;case"XZY":this._x=p*u*f-c*m*g,this._y=c*m*f-p*u*g,this._z=c*u*g+p*m*f,this._w=c*u*f+p*m*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){const n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){const t=e.elements,n=t[0],s=t[4],r=t[8],o=t[1],a=t[5],l=t[9],c=t[2],u=t[6],f=t[10],p=n+a+f;if(p>0){const m=.5/Math.sqrt(p+1);this._w=.25/m,this._x=(u-l)*m,this._y=(r-c)*m,this._z=(o-s)*m}else if(n>a&&n>f){const m=2*Math.sqrt(1+n-a-f);this._w=(u-l)/m,this._x=.25*m,this._y=(s+o)/m,this._z=(r+c)/m}else if(a>f){const m=2*Math.sqrt(1+a-n-f);this._w=(r-c)/m,this._x=(s+o)/m,this._y=.25*m,this._z=(l+u)/m}else{const m=2*Math.sqrt(1+f-n-a);this._w=(o-s)/m,this._x=(r+c)/m,this._y=(l+u)/m,this._z=.25*m}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ut(this.dot(e),-1,1)))}rotateTowards(e,t){const n=this.angleTo(e);if(n===0)return this;const s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){const n=e._x,s=e._y,r=e._z,o=e._w,a=t._x,l=t._y,c=t._z,u=t._w;return this._x=n*u+o*a+s*c-r*l,this._y=s*u+o*l+r*a-n*c,this._z=r*u+o*c+n*l-s*a,this._w=o*u-n*a-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);const n=this._x,s=this._y,r=this._z,o=this._w;let a=o*e._w+n*e._x+s*e._y+r*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=n,this._y=s,this._z=r,this;const l=1-a*a;if(l<=Number.EPSILON){const m=1-t;return this._w=m*o+t*this._w,this._x=m*n+t*this._x,this._y=m*s+t*this._y,this._z=m*r+t*this._z,this.normalize(),this}const c=Math.sqrt(l),u=Math.atan2(c,a),f=Math.sin((1-t)*u)/c,p=Math.sin(t*u)/c;return this._w=o*f+this._w*p,this._x=n*f+this._x*p,this._y=s*f+this._y*p,this._z=r*f+this._z*p,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){const e=Math.random(),t=Math.sqrt(1-e),n=Math.sqrt(e),s=2*Math.PI*Math.random(),r=2*Math.PI*Math.random();return this.set(t*Math.cos(s),n*Math.sin(r),n*Math.cos(r),t*Math.sin(s))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class N{constructor(e=0,t=0,n=0){N.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(go.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(go.setFromAxisAngle(e,t))}applyMatrix3(e){const t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const t=this.x,n=this.y,s=this.z,r=e.elements,o=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*o,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*o,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*o,this}applyQuaternion(e){const t=this.x,n=this.y,s=this.z,r=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*s-a*n),u=2*(a*t-r*s),f=2*(r*n-o*t);return this.x=t+l*c+o*f-a*u,this.y=n+l*u+a*c-r*f,this.z=s+l*f+r*u-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){const n=e.x,s=e.y,r=e.z,o=t.x,a=t.y,l=t.z;return this.x=s*l-r*a,this.y=r*o-n*l,this.z=n*a-s*o,this}projectOnVector(e){const t=e.lengthSq();if(t===0)return this.set(0,0,0);const n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return cr.copy(this).projectOnVector(e),this.sub(cr)}reflect(e){return this.sub(cr.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Ut(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){const s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){const t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=(Math.random()-.5)*2,t=Math.random()*Math.PI*2,n=Math.sqrt(1-e**2);return this.x=n*Math.cos(t),this.y=n*Math.sin(t),this.z=e,this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const cr=new N,go=new Jn;class qi{constructor(e=new N(1/0,1/0,1/0),t=new N(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(Zt.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(Zt.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){const n=Zt.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);const n=e.geometry;if(n!==void 0){const r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,Zt):Zt.fromBufferAttribute(r,o),Zt.applyMatrix4(e.matrixWorld),this.expandByPoint(Zt);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),ss.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),ss.copy(n.boundingBox)),ss.applyMatrix4(e.matrixWorld),this.union(ss)}const s=e.children;for(let r=0,o=s.length;r<o;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return!(e.x<this.min.x||e.x>this.max.x||e.y<this.min.y||e.y>this.max.y||e.z<this.min.z||e.z>this.max.z)}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return!(e.max.x<this.min.x||e.min.x>this.max.x||e.max.y<this.min.y||e.min.y>this.max.y||e.max.z<this.min.z||e.min.z>this.max.z)}intersectsSphere(e){return this.clampPoint(e.center,Zt),Zt.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Ii),rs.subVectors(this.max,Ii),si.subVectors(e.a,Ii),ri.subVectors(e.b,Ii),ai.subVectors(e.c,Ii),Tn.subVectors(ri,si),An.subVectors(ai,ri),Gn.subVectors(si,ai);let t=[0,-Tn.z,Tn.y,0,-An.z,An.y,0,-Gn.z,Gn.y,Tn.z,0,-Tn.x,An.z,0,-An.x,Gn.z,0,-Gn.x,-Tn.y,Tn.x,0,-An.y,An.x,0,-Gn.y,Gn.x,0];return!ur(t,si,ri,ai,rs)||(t=[1,0,0,0,1,0,0,0,1],!ur(t,si,ri,ai,rs))?!1:(as.crossVectors(Tn,An),t=[as.x,as.y,as.z],ur(t,si,ri,ai,rs))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,Zt).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(Zt).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(hn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),hn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),hn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),hn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),hn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),hn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),hn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),hn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(hn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}}const hn=[new N,new N,new N,new N,new N,new N,new N,new N],Zt=new N,ss=new qi,si=new N,ri=new N,ai=new N,Tn=new N,An=new N,Gn=new N,Ii=new N,rs=new N,as=new N,kn=new N;function ur(i,e,t,n,s){for(let r=0,o=i.length-3;r<=o;r+=3){kn.fromArray(i,r);const a=s.x*Math.abs(kn.x)+s.y*Math.abs(kn.y)+s.z*Math.abs(kn.z),l=e.dot(kn),c=t.dot(kn),u=n.dot(kn);if(Math.max(-Math.max(l,c,u),Math.min(l,c,u))>a)return!1}return!0}const Ed=new qi,Ni=new N,dr=new N;class oa{constructor(e=new N,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){const n=this.center;t!==void 0?n.copy(t):Ed.setFromPoints(e).getCenter(n);let s=0;for(let r=0,o=e.length;r<o;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){const n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Ni.subVectors(e,this.center);const t=Ni.lengthSq();if(t>this.radius*this.radius){const n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(Ni,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(dr.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Ni.copy(e.center).add(dr)),this.expandByPoint(Ni.copy(e.center).sub(dr))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}}const fn=new N,hr=new N,os=new N,wn=new N,fr=new N,ls=new N,pr=new N;class la{constructor(e=new N,t=new N(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,fn)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);const n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const t=fn.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(fn.copy(this.origin).addScaledVector(this.direction,t),fn.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){hr.copy(e).add(t).multiplyScalar(.5),os.copy(t).sub(e).normalize(),wn.copy(this.origin).sub(hr);const r=e.distanceTo(t)*.5,o=-this.direction.dot(os),a=wn.dot(this.direction),l=-wn.dot(os),c=wn.lengthSq(),u=Math.abs(1-o*o);let f,p,m,g;if(u>0)if(f=o*l-a,p=o*a-l,g=r*u,f>=0)if(p>=-g)if(p<=g){const _=1/u;f*=_,p*=_,m=f*(f+o*p+2*a)+p*(o*f+p+2*l)+c}else p=r,f=Math.max(0,-(o*p+a)),m=-f*f+p*(p+2*l)+c;else p=-r,f=Math.max(0,-(o*p+a)),m=-f*f+p*(p+2*l)+c;else p<=-g?(f=Math.max(0,-(-o*r+a)),p=f>0?-r:Math.min(Math.max(-r,-l),r),m=-f*f+p*(p+2*l)+c):p<=g?(f=0,p=Math.min(Math.max(-r,-l),r),m=p*(p+2*l)+c):(f=Math.max(0,-(o*r+a)),p=f>0?r:Math.min(Math.max(-r,-l),r),m=-f*f+p*(p+2*l)+c);else p=o>0?-r:r,f=Math.max(0,-(o*p+a)),m=-f*f+p*(p+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,f),s&&s.copy(hr).addScaledVector(os,p),m}intersectSphere(e,t){fn.subVectors(e.center,this.origin);const n=fn.dot(this.direction),s=fn.dot(fn)-n*n,r=e.radius*e.radius;if(s>r)return null;const o=Math.sqrt(r-s),a=n-o,l=n+o;return l<0?null:a<0?this.at(l,t):this.at(a,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){const n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){const t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,o,a,l;const c=1/this.direction.x,u=1/this.direction.y,f=1/this.direction.z,p=this.origin;return c>=0?(n=(e.min.x-p.x)*c,s=(e.max.x-p.x)*c):(n=(e.max.x-p.x)*c,s=(e.min.x-p.x)*c),u>=0?(r=(e.min.y-p.y)*u,o=(e.max.y-p.y)*u):(r=(e.max.y-p.y)*u,o=(e.min.y-p.y)*u),n>o||r>s||((r>n||isNaN(n))&&(n=r),(o<s||isNaN(s))&&(s=o),f>=0?(a=(e.min.z-p.z)*f,l=(e.max.z-p.z)*f):(a=(e.max.z-p.z)*f,l=(e.min.z-p.z)*f),n>l||a>s)||((a>n||n!==n)&&(n=a),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,fn)!==null}intersectTriangle(e,t,n,s,r){fr.subVectors(t,e),ls.subVectors(n,e),pr.crossVectors(fr,ls);let o=this.direction.dot(pr),a;if(o>0){if(s)return null;a=1}else if(o<0)a=-1,o=-o;else return null;wn.subVectors(this.origin,e);const l=a*this.direction.dot(ls.crossVectors(wn,ls));if(l<0)return null;const c=a*this.direction.dot(fr.cross(wn));if(c<0||l+c>o)return null;const u=-a*wn.dot(pr);return u<0?null:this.at(u/o,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class ht{constructor(e,t,n,s,r,o,a,l,c,u,f,p,m,g,_,h){ht.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c,u,f,p,m,g,_,h)}set(e,t,n,s,r,o,a,l,c,u,f,p,m,g,_,h){const d=this.elements;return d[0]=e,d[4]=t,d[8]=n,d[12]=s,d[1]=r,d[5]=o,d[9]=a,d[13]=l,d[2]=c,d[6]=u,d[10]=f,d[14]=p,d[3]=m,d[7]=g,d[11]=_,d[15]=h,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new ht().fromArray(this.elements)}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){const t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){const t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){const t=this.elements,n=e.elements,s=1/oi.setFromMatrixColumn(e,0).length(),r=1/oi.setFromMatrixColumn(e,1).length(),o=1/oi.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*o,t[9]=n[9]*o,t[10]=n[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){const t=this.elements,n=e.x,s=e.y,r=e.z,o=Math.cos(n),a=Math.sin(n),l=Math.cos(s),c=Math.sin(s),u=Math.cos(r),f=Math.sin(r);if(e.order==="XYZ"){const p=o*u,m=o*f,g=a*u,_=a*f;t[0]=l*u,t[4]=-l*f,t[8]=c,t[1]=m+g*c,t[5]=p-_*c,t[9]=-a*l,t[2]=_-p*c,t[6]=g+m*c,t[10]=o*l}else if(e.order==="YXZ"){const p=l*u,m=l*f,g=c*u,_=c*f;t[0]=p+_*a,t[4]=g*a-m,t[8]=o*c,t[1]=o*f,t[5]=o*u,t[9]=-a,t[2]=m*a-g,t[6]=_+p*a,t[10]=o*l}else if(e.order==="ZXY"){const p=l*u,m=l*f,g=c*u,_=c*f;t[0]=p-_*a,t[4]=-o*f,t[8]=g+m*a,t[1]=m+g*a,t[5]=o*u,t[9]=_-p*a,t[2]=-o*c,t[6]=a,t[10]=o*l}else if(e.order==="ZYX"){const p=o*u,m=o*f,g=a*u,_=a*f;t[0]=l*u,t[4]=g*c-m,t[8]=p*c+_,t[1]=l*f,t[5]=_*c+p,t[9]=m*c-g,t[2]=-c,t[6]=a*l,t[10]=o*l}else if(e.order==="YZX"){const p=o*l,m=o*c,g=a*l,_=a*c;t[0]=l*u,t[4]=_-p*f,t[8]=g*f+m,t[1]=f,t[5]=o*u,t[9]=-a*u,t[2]=-c*u,t[6]=m*f+g,t[10]=p-_*f}else if(e.order==="XZY"){const p=o*l,m=o*c,g=a*l,_=a*c;t[0]=l*u,t[4]=-f,t[8]=c*u,t[1]=p*f+_,t[5]=o*u,t[9]=m*f-g,t[2]=g*f-m,t[6]=a*u,t[10]=_*f+p}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(bd,e,Td)}lookAt(e,t,n){const s=this.elements;return Gt.subVectors(e,t),Gt.lengthSq()===0&&(Gt.z=1),Gt.normalize(),Rn.crossVectors(n,Gt),Rn.lengthSq()===0&&(Math.abs(n.z)===1?Gt.x+=1e-4:Gt.z+=1e-4,Gt.normalize(),Rn.crossVectors(n,Gt)),Rn.normalize(),cs.crossVectors(Gt,Rn),s[0]=Rn.x,s[4]=cs.x,s[8]=Gt.x,s[1]=Rn.y,s[5]=cs.y,s[9]=Gt.y,s[2]=Rn.z,s[6]=cs.z,s[10]=Gt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[4],l=n[8],c=n[12],u=n[1],f=n[5],p=n[9],m=n[13],g=n[2],_=n[6],h=n[10],d=n[14],x=n[3],v=n[7],T=n[11],D=n[15],A=s[0],w=s[4],I=s[8],M=s[12],y=s[1],U=s[5],B=s[9],Y=s[13],L=s[2],O=s[6],W=s[10],j=s[14],q=s[3],$=s[7],Q=s[11],re=s[15];return r[0]=o*A+a*y+l*L+c*q,r[4]=o*w+a*U+l*O+c*$,r[8]=o*I+a*B+l*W+c*Q,r[12]=o*M+a*Y+l*j+c*re,r[1]=u*A+f*y+p*L+m*q,r[5]=u*w+f*U+p*O+m*$,r[9]=u*I+f*B+p*W+m*Q,r[13]=u*M+f*Y+p*j+m*re,r[2]=g*A+_*y+h*L+d*q,r[6]=g*w+_*U+h*O+d*$,r[10]=g*I+_*B+h*W+d*Q,r[14]=g*M+_*Y+h*j+d*re,r[3]=x*A+v*y+T*L+D*q,r[7]=x*w+v*U+T*O+D*$,r[11]=x*I+v*B+T*W+D*Q,r[15]=x*M+v*Y+T*j+D*re,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],o=e[1],a=e[5],l=e[9],c=e[13],u=e[2],f=e[6],p=e[10],m=e[14],g=e[3],_=e[7],h=e[11],d=e[15];return g*(+r*l*f-s*c*f-r*a*p+n*c*p+s*a*m-n*l*m)+_*(+t*l*m-t*c*p+r*o*p-s*o*m+s*c*u-r*l*u)+h*(+t*c*f-t*a*m-r*o*f+n*o*m+r*a*u-n*c*u)+d*(-s*a*u-t*l*f+t*a*p+s*o*f-n*o*p+n*l*u)}transpose(){const e=this.elements;let t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){const s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],u=e[8],f=e[9],p=e[10],m=e[11],g=e[12],_=e[13],h=e[14],d=e[15],x=f*h*c-_*p*c+_*l*m-a*h*m-f*l*d+a*p*d,v=g*p*c-u*h*c-g*l*m+o*h*m+u*l*d-o*p*d,T=u*_*c-g*f*c+g*a*m-o*_*m-u*a*d+o*f*d,D=g*f*l-u*_*l-g*a*p+o*_*p+u*a*h-o*f*h,A=t*x+n*v+s*T+r*D;if(A===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const w=1/A;return e[0]=x*w,e[1]=(_*p*r-f*h*r-_*s*m+n*h*m+f*s*d-n*p*d)*w,e[2]=(a*h*r-_*l*r+_*s*c-n*h*c-a*s*d+n*l*d)*w,e[3]=(f*l*r-a*p*r-f*s*c+n*p*c+a*s*m-n*l*m)*w,e[4]=v*w,e[5]=(u*h*r-g*p*r+g*s*m-t*h*m-u*s*d+t*p*d)*w,e[6]=(g*l*r-o*h*r-g*s*c+t*h*c+o*s*d-t*l*d)*w,e[7]=(o*p*r-u*l*r+u*s*c-t*p*c-o*s*m+t*l*m)*w,e[8]=T*w,e[9]=(g*f*r-u*_*r-g*n*m+t*_*m+u*n*d-t*f*d)*w,e[10]=(o*_*r-g*a*r+g*n*c-t*_*c-o*n*d+t*a*d)*w,e[11]=(u*a*r-o*f*r-u*n*c+t*f*c+o*n*m-t*a*m)*w,e[12]=D*w,e[13]=(u*_*s-g*f*s+g*n*p-t*_*p-u*n*h+t*f*h)*w,e[14]=(g*a*s-o*_*s-g*n*l+t*_*l+o*n*h-t*a*h)*w,e[15]=(o*f*s-u*a*s+u*n*l-t*f*l-o*n*p+t*a*p)*w,this}scale(e){const t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){const e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){const t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){const n=Math.cos(t),s=Math.sin(t),r=1-n,o=e.x,a=e.y,l=e.z,c=r*o,u=r*a;return this.set(c*o+n,c*a-s*l,c*l+s*a,0,c*a+s*l,u*a+n,u*l-s*o,0,c*l-s*a,u*l+s*o,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,o){return this.set(1,n,r,0,e,1,o,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){const s=this.elements,r=t._x,o=t._y,a=t._z,l=t._w,c=r+r,u=o+o,f=a+a,p=r*c,m=r*u,g=r*f,_=o*u,h=o*f,d=a*f,x=l*c,v=l*u,T=l*f,D=n.x,A=n.y,w=n.z;return s[0]=(1-(_+d))*D,s[1]=(m+T)*D,s[2]=(g-v)*D,s[3]=0,s[4]=(m-T)*A,s[5]=(1-(p+d))*A,s[6]=(h+x)*A,s[7]=0,s[8]=(g+v)*w,s[9]=(h-x)*w,s[10]=(1-(p+_))*w,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){const s=this.elements;let r=oi.set(s[0],s[1],s[2]).length();const o=oi.set(s[4],s[5],s[6]).length(),a=oi.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],Jt.copy(this);const c=1/r,u=1/o,f=1/a;return Jt.elements[0]*=c,Jt.elements[1]*=c,Jt.elements[2]*=c,Jt.elements[4]*=u,Jt.elements[5]*=u,Jt.elements[6]*=u,Jt.elements[8]*=f,Jt.elements[9]*=f,Jt.elements[10]*=f,t.setFromRotationMatrix(Jt),n.x=r,n.y=o,n.z=a,this}makePerspective(e,t,n,s,r,o,a=xn){const l=this.elements,c=2*r/(t-e),u=2*r/(n-s),f=(t+e)/(t-e),p=(n+s)/(n-s);let m,g;if(a===xn)m=-(o+r)/(o-r),g=-2*o*r/(o-r);else if(a===Is)m=-o/(o-r),g=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return l[0]=c,l[4]=0,l[8]=f,l[12]=0,l[1]=0,l[5]=u,l[9]=p,l[13]=0,l[2]=0,l[6]=0,l[10]=m,l[14]=g,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,s,r,o,a=xn){const l=this.elements,c=1/(t-e),u=1/(n-s),f=1/(o-r),p=(t+e)*c,m=(n+s)*u;let g,_;if(a===xn)g=(o+r)*f,_=-2*f;else if(a===Is)g=r*f,_=-1*f;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-p,l[1]=0,l[5]=2*u,l[9]=0,l[13]=-m,l[2]=0,l[6]=0,l[10]=_,l[14]=-g,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){const t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}}const oi=new N,Jt=new ht,bd=new N(0,0,0),Td=new N(1,1,1),Rn=new N,cs=new N,Gt=new N,_o=new ht,vo=new Jn;class Gs{constructor(e=0,t=0,n=0,s=Gs.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){const s=e.elements,r=s[0],o=s[4],a=s[8],l=s[1],c=s[5],u=s[9],f=s[2],p=s[6],m=s[10];switch(t){case"XYZ":this._y=Math.asin(Ut(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-u,m),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(p,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Ut(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(a,m),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-f,r),this._z=0);break;case"ZXY":this._x=Math.asin(Ut(p,-1,1)),Math.abs(p)<.9999999?(this._y=Math.atan2(-f,m),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Ut(f,-1,1)),Math.abs(f)<.9999999?(this._x=Math.atan2(p,m),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Ut(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-u,c),this._y=Math.atan2(-f,r)):(this._x=0,this._y=Math.atan2(a,m));break;case"XZY":this._z=Math.asin(-Ut(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(p,c),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-u,m),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return _o.makeRotationFromQuaternion(e),this.setFromRotationMatrix(_o,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return vo.setFromEuler(this),this.setFromQuaternion(vo,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Gs.DEFAULT_ORDER="XYZ";class ca{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let Ad=0;const xo=new N,li=new Jn,pn=new ht,us=new N,Fi=new N,wd=new N,Rd=new Jn,Mo=new N(1,0,0),So=new N(0,1,0),yo=new N(0,0,1),Cd={type:"added"},Ld={type:"removed"};class Et extends ei{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Ad++}),this.uuid=$i(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Et.DEFAULT_UP.clone();const e=new N,t=new Gs,n=new Jn,s=new N(1,1,1);function r(){n.setFromEuler(t,!1)}function o(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new ht},normalMatrix:{value:new Xe}}),this.matrix=new ht,this.matrixWorld=new ht,this.matrixAutoUpdate=Et.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Et.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new ca,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return li.setFromAxisAngle(e,t),this.quaternion.multiply(li),this}rotateOnWorldAxis(e,t){return li.setFromAxisAngle(e,t),this.quaternion.premultiply(li),this}rotateX(e){return this.rotateOnAxis(Mo,e)}rotateY(e){return this.rotateOnAxis(So,e)}rotateZ(e){return this.rotateOnAxis(yo,e)}translateOnAxis(e,t){return xo.copy(e).applyQuaternion(this.quaternion),this.position.add(xo.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Mo,e)}translateY(e){return this.translateOnAxis(So,e)}translateZ(e){return this.translateOnAxis(yo,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(pn.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?us.copy(e):us.set(e,t,n);const s=this.parent;this.updateWorldMatrix(!0,!1),Fi.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?pn.lookAt(Fi,us,this.up):pn.lookAt(us,Fi,this.up),this.quaternion.setFromRotationMatrix(pn),s&&(pn.extractRotation(s.matrixWorld),li.setFromRotationMatrix(pn),this.quaternion.premultiply(li.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.parent!==null&&e.parent.remove(e),e.parent=this,this.children.push(e),e.dispatchEvent(Cd)):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(Ld)),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),pn.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),pn.multiply(e.parent.matrixWorld)),e.applyMatrix4(pn),this.add(e),e.updateWorldMatrix(!1,!0),this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){const o=this.children[n].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);const s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Fi,e,wd),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Fi,Rd,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){const t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix),this.matrixWorldNeedsUpdate=!1,e=!0);const t=this.children;for(let n=0,s=t.length;n<s;n++){const r=t[n];(r.matrixWorldAutoUpdate===!0||e===!0)&&r.updateMatrixWorld(e)}}updateWorldMatrix(e,t){const n=this.parent;if(e===!0&&n!==null&&n.matrixWorldAutoUpdate===!0&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix),t===!0){const s=this.children;for(let r=0,o=s.length;r<o;r++){const a=s[r];a.matrixWorldAutoUpdate===!0&&a.updateWorldMatrix(!1,!0)}}}toJSON(e){const t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.visibility=this._visibility,s.active=this._active,s.bounds=this._bounds.map(a=>({boxInitialized:a.boxInitialized,boxMin:a.box.min.toArray(),boxMax:a.box.max.toArray(),sphereInitialized:a.sphereInitialized,sphereRadius:a.sphere.radius,sphereCenter:a.sphere.center.toArray()})),s.maxGeometryCount=this._maxGeometryCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.geometryCount=this._geometryCount,s.matricesTexture=this._matricesTexture.toJSON(e),this.boundingSphere!==null&&(s.boundingSphere={center:s.boundingSphere.center.toArray(),radius:s.boundingSphere.radius}),this.boundingBox!==null&&(s.boundingBox={min:s.boundingBox.min.toArray(),max:s.boundingBox.max.toArray()}));function r(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);const a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){const l=a.shapes;if(Array.isArray(l))for(let c=0,u=l.length;c<u;c++){const f=l[c];r(e.shapes,f)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(r(e.materials,this.material[l]));s.material=a}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let a=0;a<this.children.length;a++)s.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let a=0;a<this.animations.length;a++){const l=this.animations[a];s.animations.push(r(e.animations,l))}}if(t){const a=o(e.geometries),l=o(e.materials),c=o(e.textures),u=o(e.images),f=o(e.shapes),p=o(e.skeletons),m=o(e.animations),g=o(e.nodes);a.length>0&&(n.geometries=a),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),u.length>0&&(n.images=u),f.length>0&&(n.shapes=f),p.length>0&&(n.skeletons=p),m.length>0&&(n.animations=m),g.length>0&&(n.nodes=g)}return n.object=s,n;function o(a){const l=[];for(const c in a){const u=a[c];delete u.metadata,l.push(u)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){const s=e.children[n];this.add(s.clone())}return this}}Et.DEFAULT_UP=new N(0,1,0);Et.DEFAULT_MATRIX_AUTO_UPDATE=!0;Et.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Qt=new N,mn=new N,mr=new N,gn=new N,ci=new N,ui=new N,Eo=new N,gr=new N,_r=new N,vr=new N;let ds=!1;class en{constructor(e=new N,t=new N,n=new N){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),Qt.subVectors(e,t),s.cross(Qt);const r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){Qt.subVectors(s,t),mn.subVectors(n,t),mr.subVectors(e,t);const o=Qt.dot(Qt),a=Qt.dot(mn),l=Qt.dot(mr),c=mn.dot(mn),u=mn.dot(mr),f=o*c-a*a;if(f===0)return r.set(0,0,0),null;const p=1/f,m=(c*l-a*u)*p,g=(o*u-a*l)*p;return r.set(1-m-g,g,m)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,gn)===null?!1:gn.x>=0&&gn.y>=0&&gn.x+gn.y<=1}static getUV(e,t,n,s,r,o,a,l){return ds===!1&&(console.warn("THREE.Triangle.getUV() has been renamed to THREE.Triangle.getInterpolation()."),ds=!0),this.getInterpolation(e,t,n,s,r,o,a,l)}static getInterpolation(e,t,n,s,r,o,a,l){return this.getBarycoord(e,t,n,s,gn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,gn.x),l.addScaledVector(o,gn.y),l.addScaledVector(a,gn.z),l)}static isFrontFacing(e,t,n,s){return Qt.subVectors(n,t),mn.subVectors(e,t),Qt.cross(mn).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Qt.subVectors(this.c,this.b),mn.subVectors(this.a,this.b),Qt.cross(mn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return en.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return en.getBarycoord(e,this.a,this.b,this.c,t)}getUV(e,t,n,s,r){return ds===!1&&(console.warn("THREE.Triangle.getUV() has been renamed to THREE.Triangle.getInterpolation()."),ds=!0),en.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}getInterpolation(e,t,n,s,r){return en.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return en.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return en.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){const n=this.a,s=this.b,r=this.c;let o,a;ci.subVectors(s,n),ui.subVectors(r,n),gr.subVectors(e,n);const l=ci.dot(gr),c=ui.dot(gr);if(l<=0&&c<=0)return t.copy(n);_r.subVectors(e,s);const u=ci.dot(_r),f=ui.dot(_r);if(u>=0&&f<=u)return t.copy(s);const p=l*f-u*c;if(p<=0&&l>=0&&u<=0)return o=l/(l-u),t.copy(n).addScaledVector(ci,o);vr.subVectors(e,r);const m=ci.dot(vr),g=ui.dot(vr);if(g>=0&&m<=g)return t.copy(r);const _=m*c-l*g;if(_<=0&&c>=0&&g<=0)return a=c/(c-g),t.copy(n).addScaledVector(ui,a);const h=u*g-m*f;if(h<=0&&f-u>=0&&m-g>=0)return Eo.subVectors(r,s),a=(f-u)/(f-u+(m-g)),t.copy(s).addScaledVector(Eo,a);const d=1/(h+_+p);return o=_*d,a=p*d,t.copy(n).addScaledVector(ci,o).addScaledVector(ui,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const jl={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Cn={h:0,s:0,l:0},hs={h:0,s:0,l:0};function xr(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}class $e{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){const s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=St){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,nt.toWorkingColorSpace(this,t),this}setRGB(e,t,n,s=nt.workingColorSpace){return this.r=e,this.g=t,this.b=n,nt.toWorkingColorSpace(this,s),this}setHSL(e,t,n,s=nt.workingColorSpace){if(e=md(e,1),t=Ut(t,0,1),n=Ut(n,0,1),t===0)this.r=this.g=this.b=n;else{const r=n<=.5?n*(1+t):n+t-n*t,o=2*n-r;this.r=xr(o,r,e+1/3),this.g=xr(o,r,e),this.b=xr(o,r,e-1/3)}return nt.toWorkingColorSpace(this,s),this}setStyle(e,t=St){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r;const o=s[1],a=s[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){const r=s[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=St){const n=jl[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=yi(e.r),this.g=yi(e.g),this.b=yi(e.b),this}copyLinearToSRGB(e){return this.r=or(e.r),this.g=or(e.g),this.b=or(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=St){return nt.fromWorkingColorSpace(At.copy(this),e),Math.round(Ut(At.r*255,0,255))*65536+Math.round(Ut(At.g*255,0,255))*256+Math.round(Ut(At.b*255,0,255))}getHexString(e=St){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=nt.workingColorSpace){nt.fromWorkingColorSpace(At.copy(this),t);const n=At.r,s=At.g,r=At.b,o=Math.max(n,s,r),a=Math.min(n,s,r);let l,c;const u=(a+o)/2;if(a===o)l=0,c=0;else{const f=o-a;switch(c=u<=.5?f/(o+a):f/(2-o-a),o){case n:l=(s-r)/f+(s<r?6:0);break;case s:l=(r-n)/f+2;break;case r:l=(n-s)/f+4;break}l/=6}return e.h=l,e.s=c,e.l=u,e}getRGB(e,t=nt.workingColorSpace){return nt.fromWorkingColorSpace(At.copy(this),t),e.r=At.r,e.g=At.g,e.b=At.b,e}getStyle(e=St){nt.fromWorkingColorSpace(At.copy(this),e);const t=At.r,n=At.g,s=At.b;return e!==St?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(Cn),this.setHSL(Cn.h+e,Cn.s+t,Cn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Cn),e.getHSL(hs);const n=rr(Cn.h,hs.h,t),s=rr(Cn.s,hs.s,t),r=rr(Cn.l,hs.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const At=new $e;$e.NAMES=jl;let Pd=0;class Yi extends ei{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Pd++}),this.uuid=$i(),this.name="",this.type="Material",this.blending=Si,this.side=Fn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Nr,this.blendDst=Fr,this.blendEquation=Xn,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new $e(0,0,0),this.blendAlpha=0,this.depthFunc=Ls,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=lo,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=ni,this.stencilZFail=ni,this.stencilZPass=ni,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBuild(){}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}const s=this[t];if(s===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});const n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Si&&(n.blending=this.blending),this.side!==Fn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Nr&&(n.blendSrc=this.blendSrc),this.blendDst!==Fr&&(n.blendDst=this.blendDst),this.blendEquation!==Xn&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Ls&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==lo&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==ni&&(n.stencilFail=this.stencilFail),this.stencilZFail!==ni&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==ni&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){const o=[];for(const a in r){const l=r[a];delete l.metadata,o.push(l)}return o}if(t){const r=s(e.textures),o=s(e.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const t=e.clippingPlanes;let n=null;if(t!==null){const s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}}class ks extends Yi{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new $e(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.combine=Dl,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const dt=new N,fs=new Ae;class un{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=co,this._updateRange={offset:0,count:-1},this.updateRanges=[],this.gpuType=Un,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}get updateRange(){return console.warn("THREE.BufferAttribute: updateRange() is deprecated and will be removed in r169. Use addUpdateRange() instead."),this._updateRange}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)fs.fromBufferAttribute(this,t),fs.applyMatrix3(e),this.setXY(t,fs.x,fs.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)dt.fromBufferAttribute(this,t),dt.applyMatrix3(e),this.setXYZ(t,dt.x,dt.y,dt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)dt.fromBufferAttribute(this,t),dt.applyMatrix4(e),this.setXYZ(t,dt.x,dt.y,dt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)dt.fromBufferAttribute(this,t),dt.applyNormalMatrix(e),this.setXYZ(t,dt.x,dt.y,dt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)dt.fromBufferAttribute(this,t),dt.transformDirection(e),this.setXYZ(t,dt.x,dt.y,dt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Ui(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Nt(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Ui(t,this.array)),t}setX(e,t){return this.normalized&&(t=Nt(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Ui(t,this.array)),t}setY(e,t){return this.normalized&&(t=Nt(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Ui(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Nt(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Ui(t,this.array)),t}setW(e,t){return this.normalized&&(t=Nt(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=Nt(t,this.array),n=Nt(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=Nt(t,this.array),n=Nt(n,this.array),s=Nt(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=Nt(t,this.array),n=Nt(n,this.array),s=Nt(s,this.array),r=Nt(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==co&&(e.usage=this.usage),e}}class Kl extends un{constructor(e,t,n){super(new Uint16Array(e),t,n)}}class Zl extends un{constructor(e,t,n){super(new Uint32Array(e),t,n)}}class ut extends un{constructor(e,t,n){super(new Float32Array(e),t,n)}}let Dd=0;const Wt=new ht,Mr=new Et,di=new N,kt=new qi,Oi=new qi,vt=new N;class Kt extends ei{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Dd++}),this.uuid=$i(),this.name="",this.type="BufferGeometry",this.index=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Xl(e)?Zl:Kl)(e,1):this.index=e,this}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){const t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const r=new Xe().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}const s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Wt.makeRotationFromQuaternion(e),this.applyMatrix4(Wt),this}rotateX(e){return Wt.makeRotationX(e),this.applyMatrix4(Wt),this}rotateY(e){return Wt.makeRotationY(e),this.applyMatrix4(Wt),this}rotateZ(e){return Wt.makeRotationZ(e),this.applyMatrix4(Wt),this}translate(e,t,n){return Wt.makeTranslation(e,t,n),this.applyMatrix4(Wt),this}scale(e,t,n){return Wt.makeScale(e,t,n),this.applyMatrix4(Wt),this}lookAt(e){return Mr.lookAt(e),Mr.updateMatrix(),this.applyMatrix4(Mr.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(di).negate(),this.translate(di.x,di.y,di.z),this}setFromPoints(e){const t=[];for(let n=0,s=e.length;n<s;n++){const r=e[n];t.push(r.x,r.y,r.z||0)}return this.setAttribute("position",new ut(t,3)),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new qi);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error('THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box. Alternatively set "mesh.frustumCulled" to "false".',this),this.boundingBox.set(new N(-1/0,-1/0,-1/0),new N(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){const r=t[n];kt.setFromBufferAttribute(r),this.morphTargetsRelative?(vt.addVectors(this.boundingBox.min,kt.min),this.boundingBox.expandByPoint(vt),vt.addVectors(this.boundingBox.max,kt.max),this.boundingBox.expandByPoint(vt)):(this.boundingBox.expandByPoint(kt.min),this.boundingBox.expandByPoint(kt.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new oa);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error('THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere. Alternatively set "mesh.frustumCulled" to "false".',this),this.boundingSphere.set(new N,1/0);return}if(e){const n=this.boundingSphere.center;if(kt.setFromBufferAttribute(e),t)for(let r=0,o=t.length;r<o;r++){const a=t[r];Oi.setFromBufferAttribute(a),this.morphTargetsRelative?(vt.addVectors(kt.min,Oi.min),kt.expandByPoint(vt),vt.addVectors(kt.max,Oi.max),kt.expandByPoint(vt)):(kt.expandByPoint(Oi.min),kt.expandByPoint(Oi.max))}kt.getCenter(n);let s=0;for(let r=0,o=e.count;r<o;r++)vt.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(vt));if(t)for(let r=0,o=t.length;r<o;r++){const a=t[r],l=this.morphTargetsRelative;for(let c=0,u=a.count;c<u;c++)vt.fromBufferAttribute(a,c),l&&(di.fromBufferAttribute(e,c),vt.add(di)),s=Math.max(s,n.distanceToSquared(vt))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=e.array,s=t.position.array,r=t.normal.array,o=t.uv.array,a=s.length/3;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new un(new Float32Array(4*a),4));const l=this.getAttribute("tangent").array,c=[],u=[];for(let y=0;y<a;y++)c[y]=new N,u[y]=new N;const f=new N,p=new N,m=new N,g=new Ae,_=new Ae,h=new Ae,d=new N,x=new N;function v(y,U,B){f.fromArray(s,y*3),p.fromArray(s,U*3),m.fromArray(s,B*3),g.fromArray(o,y*2),_.fromArray(o,U*2),h.fromArray(o,B*2),p.sub(f),m.sub(f),_.sub(g),h.sub(g);const Y=1/(_.x*h.y-h.x*_.y);isFinite(Y)&&(d.copy(p).multiplyScalar(h.y).addScaledVector(m,-_.y).multiplyScalar(Y),x.copy(m).multiplyScalar(_.x).addScaledVector(p,-h.x).multiplyScalar(Y),c[y].add(d),c[U].add(d),c[B].add(d),u[y].add(x),u[U].add(x),u[B].add(x))}let T=this.groups;T.length===0&&(T=[{start:0,count:n.length}]);for(let y=0,U=T.length;y<U;++y){const B=T[y],Y=B.start,L=B.count;for(let O=Y,W=Y+L;O<W;O+=3)v(n[O+0],n[O+1],n[O+2])}const D=new N,A=new N,w=new N,I=new N;function M(y){w.fromArray(r,y*3),I.copy(w);const U=c[y];D.copy(U),D.sub(w.multiplyScalar(w.dot(U))).normalize(),A.crossVectors(I,U);const Y=A.dot(u[y])<0?-1:1;l[y*4]=D.x,l[y*4+1]=D.y,l[y*4+2]=D.z,l[y*4+3]=Y}for(let y=0,U=T.length;y<U;++y){const B=T[y],Y=B.start,L=B.count;for(let O=Y,W=Y+L;O<W;O+=3)M(n[O+0]),M(n[O+1]),M(n[O+2])}}computeVertexNormals(){const e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new un(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let p=0,m=n.count;p<m;p++)n.setXYZ(p,0,0,0);const s=new N,r=new N,o=new N,a=new N,l=new N,c=new N,u=new N,f=new N;if(e)for(let p=0,m=e.count;p<m;p+=3){const g=e.getX(p+0),_=e.getX(p+1),h=e.getX(p+2);s.fromBufferAttribute(t,g),r.fromBufferAttribute(t,_),o.fromBufferAttribute(t,h),u.subVectors(o,r),f.subVectors(s,r),u.cross(f),a.fromBufferAttribute(n,g),l.fromBufferAttribute(n,_),c.fromBufferAttribute(n,h),a.add(u),l.add(u),c.add(u),n.setXYZ(g,a.x,a.y,a.z),n.setXYZ(_,l.x,l.y,l.z),n.setXYZ(h,c.x,c.y,c.z)}else for(let p=0,m=t.count;p<m;p+=3)s.fromBufferAttribute(t,p+0),r.fromBufferAttribute(t,p+1),o.fromBufferAttribute(t,p+2),u.subVectors(o,r),f.subVectors(s,r),u.cross(f),n.setXYZ(p+0,u.x,u.y,u.z),n.setXYZ(p+1,u.x,u.y,u.z),n.setXYZ(p+2,u.x,u.y,u.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)vt.fromBufferAttribute(e,t),vt.normalize(),e.setXYZ(t,vt.x,vt.y,vt.z)}toNonIndexed(){function e(a,l){const c=a.array,u=a.itemSize,f=a.normalized,p=new c.constructor(l.length*u);let m=0,g=0;for(let _=0,h=l.length;_<h;_++){a.isInterleavedBufferAttribute?m=l[_]*a.data.stride+a.offset:m=l[_]*u;for(let d=0;d<u;d++)p[g++]=c[m++]}return new un(p,u,f)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const t=new Kt,n=this.index.array,s=this.attributes;for(const a in s){const l=s[a],c=e(l,n);t.setAttribute(a,c)}const r=this.morphAttributes;for(const a in r){const l=[],c=r[a];for(let u=0,f=c.length;u<f;u++){const p=c[u],m=e(p,n);l.push(m)}t.morphAttributes[a]=l}t.morphTargetsRelative=this.morphTargetsRelative;const o=this.groups;for(let a=0,l=o.length;a<l;a++){const c=o[a];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){const e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};const t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});const n=this.attributes;for(const l in n){const c=n[l];e.data.attributes[l]=c.toJSON(e.data)}const s={};let r=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],u=[];for(let f=0,p=c.length;f<p;f++){const m=c[f];u.push(m.toJSON(e.data))}u.length>0&&(s[l]=u,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);const o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));const a=this.boundingSphere;return a!==null&&(e.data.boundingSphere={center:a.center.toArray(),radius:a.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const t={};this.name=e.name;const n=e.index;n!==null&&this.setIndex(n.clone(t));const s=e.attributes;for(const c in s){const u=s[c];this.setAttribute(c,u.clone(t))}const r=e.morphAttributes;for(const c in r){const u=[],f=r[c];for(let p=0,m=f.length;p<m;p++)u.push(f[p].clone(t));this.morphAttributes[c]=u}this.morphTargetsRelative=e.morphTargetsRelative;const o=e.groups;for(let c=0,u=o.length;c<u;c++){const f=o[c];this.addGroup(f.start,f.count,f.materialIndex)}const a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());const l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const bo=new ht,Hn=new la,ps=new oa,To=new N,hi=new N,fi=new N,pi=new N,Sr=new N,ms=new N,gs=new Ae,_s=new Ae,vs=new Ae,Ao=new N,wo=new N,Ro=new N,xs=new N,Ms=new N;class ge extends Et{constructor(e=new Kt,t=new ks){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){const a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(e,t){const n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;t.fromBufferAttribute(s,e);const a=this.morphTargetInfluences;if(r&&a){ms.set(0,0,0);for(let l=0,c=r.length;l<c;l++){const u=a[l],f=r[l];u!==0&&(Sr.fromBufferAttribute(f,e),o?ms.addScaledVector(Sr,u):ms.addScaledVector(Sr.sub(t),u))}t.add(ms)}return t}raycast(e,t){const n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),ps.copy(n.boundingSphere),ps.applyMatrix4(r),Hn.copy(e.ray).recast(e.near),!(ps.containsPoint(Hn.origin)===!1&&(Hn.intersectSphere(ps,To)===null||Hn.origin.distanceToSquared(To)>(e.far-e.near)**2))&&(bo.copy(r).invert(),Hn.copy(e.ray).applyMatrix4(bo),!(n.boundingBox!==null&&Hn.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Hn)))}_computeIntersections(e,t,n){let s;const r=this.geometry,o=this.material,a=r.index,l=r.attributes.position,c=r.attributes.uv,u=r.attributes.uv1,f=r.attributes.normal,p=r.groups,m=r.drawRange;if(a!==null)if(Array.isArray(o))for(let g=0,_=p.length;g<_;g++){const h=p[g],d=o[h.materialIndex],x=Math.max(h.start,m.start),v=Math.min(a.count,Math.min(h.start+h.count,m.start+m.count));for(let T=x,D=v;T<D;T+=3){const A=a.getX(T),w=a.getX(T+1),I=a.getX(T+2);s=Ss(this,d,e,n,c,u,f,A,w,I),s&&(s.faceIndex=Math.floor(T/3),s.face.materialIndex=h.materialIndex,t.push(s))}}else{const g=Math.max(0,m.start),_=Math.min(a.count,m.start+m.count);for(let h=g,d=_;h<d;h+=3){const x=a.getX(h),v=a.getX(h+1),T=a.getX(h+2);s=Ss(this,o,e,n,c,u,f,x,v,T),s&&(s.faceIndex=Math.floor(h/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(o))for(let g=0,_=p.length;g<_;g++){const h=p[g],d=o[h.materialIndex],x=Math.max(h.start,m.start),v=Math.min(l.count,Math.min(h.start+h.count,m.start+m.count));for(let T=x,D=v;T<D;T+=3){const A=T,w=T+1,I=T+2;s=Ss(this,d,e,n,c,u,f,A,w,I),s&&(s.faceIndex=Math.floor(T/3),s.face.materialIndex=h.materialIndex,t.push(s))}}else{const g=Math.max(0,m.start),_=Math.min(l.count,m.start+m.count);for(let h=g,d=_;h<d;h+=3){const x=h,v=h+1,T=h+2;s=Ss(this,o,e,n,c,u,f,x,v,T),s&&(s.faceIndex=Math.floor(h/3),t.push(s))}}}}function Ud(i,e,t,n,s,r,o,a){let l;if(e.side===Bt?l=n.intersectTriangle(o,r,s,!0,a):l=n.intersectTriangle(s,r,o,e.side===Fn,a),l===null)return null;Ms.copy(a),Ms.applyMatrix4(i.matrixWorld);const c=t.ray.origin.distanceTo(Ms);return c<t.near||c>t.far?null:{distance:c,point:Ms.clone(),object:i}}function Ss(i,e,t,n,s,r,o,a,l,c){i.getVertexPosition(a,hi),i.getVertexPosition(l,fi),i.getVertexPosition(c,pi);const u=Ud(i,e,t,n,hi,fi,pi,xs);if(u){s&&(gs.fromBufferAttribute(s,a),_s.fromBufferAttribute(s,l),vs.fromBufferAttribute(s,c),u.uv=en.getInterpolation(xs,hi,fi,pi,gs,_s,vs,new Ae)),r&&(gs.fromBufferAttribute(r,a),_s.fromBufferAttribute(r,l),vs.fromBufferAttribute(r,c),u.uv1=en.getInterpolation(xs,hi,fi,pi,gs,_s,vs,new Ae),u.uv2=u.uv1),o&&(Ao.fromBufferAttribute(o,a),wo.fromBufferAttribute(o,l),Ro.fromBufferAttribute(o,c),u.normal=en.getInterpolation(xs,hi,fi,pi,Ao,wo,Ro,new N),u.normal.dot(n.direction)>0&&u.normal.multiplyScalar(-1));const f={a,b:l,c,normal:new N,materialIndex:0};en.getNormal(hi,fi,pi,f.normal),u.face=f}return u}class Ke extends Kt{constructor(e=1,t=1,n=1,s=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:o};const a=this;s=Math.floor(s),r=Math.floor(r),o=Math.floor(o);const l=[],c=[],u=[],f=[];let p=0,m=0;g("z","y","x",-1,-1,n,t,e,o,r,0),g("z","y","x",1,-1,n,t,-e,o,r,1),g("x","z","y",1,1,e,n,t,s,o,2),g("x","z","y",1,-1,e,n,-t,s,o,3),g("x","y","z",1,-1,e,t,n,s,r,4),g("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new ut(c,3)),this.setAttribute("normal",new ut(u,3)),this.setAttribute("uv",new ut(f,2));function g(_,h,d,x,v,T,D,A,w,I,M){const y=T/w,U=D/I,B=T/2,Y=D/2,L=A/2,O=w+1,W=I+1;let j=0,q=0;const $=new N;for(let Q=0;Q<W;Q++){const re=Q*U-Y;for(let pe=0;pe<O;pe++){const X=pe*y-B;$[_]=X*x,$[h]=re*v,$[d]=L,c.push($.x,$.y,$.z),$[_]=0,$[h]=0,$[d]=A>0?1:-1,u.push($.x,$.y,$.z),f.push(pe/w),f.push(1-Q/I),j+=1}}for(let Q=0;Q<I;Q++)for(let re=0;re<w;re++){const pe=p+re+O*Q,X=p+re+O*(Q+1),ee=p+(re+1)+O*(Q+1),fe=p+(re+1)+O*Q;l.push(pe,X,fe),l.push(X,ee,fe),q+=6}a.addGroup(m,q,M),m+=q,p+=j}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Ke(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function Ri(i){const e={};for(const t in i){e[t]={};for(const n in i[t]){const s=i[t][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone():Array.isArray(s)?e[t][n]=s.slice():e[t][n]=s}}return e}function Pt(i){const e={};for(let t=0;t<i.length;t++){const n=Ri(i[t]);for(const s in n)e[s]=n[s]}return e}function Id(i){const e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function Jl(i){return i.getRenderTarget()===null?i.outputColorSpace:nt.workingColorSpace}const Ql={clone:Ri,merge:Pt};var Nd=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Fd=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class En extends Yi{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Nd,this.fragmentShader=Fd,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={derivatives:!1,fragDepth:!1,drawBuffers:!1,shaderTextureLOD:!1,clipCullDistance:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Ri(e.uniforms),this.uniformsGroups=Id(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(const s in this.uniforms){const o=this.uniforms[s].value;o&&o.isTexture?t.uniforms[s]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[s]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[s]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[s]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[s]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[s]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[s]={type:"m4",value:o.toArray()}:t.uniforms[s]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;const n={};for(const s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}}class ec extends Et{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new ht,this.projectionMatrix=new ht,this.projectionMatrixInverse=new ht,this.coordinateSystem=xn}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}class tn extends ec{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const t=.5*this.getFilmHeight()/e;this.fov=Hr*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(Rs*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Hr*2*Math.atan(Math.tan(Rs*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}setViewOffset(e,t,n,s,r,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let t=e*Math.tan(Rs*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s;const o=this.view;if(this.view!==null&&this.view.enabled){const l=o.fullWidth,c=o.fullHeight;r+=o.offsetX*s/l,t-=o.offsetY*n/c,s*=o.width/l,n*=o.height/c}const a=this.filmOffset;a!==0&&(r+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}}const mi=-90,gi=1;class Od extends Et{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const s=new tn(mi,gi,e,t);s.layers=this.layers,this.add(s);const r=new tn(mi,gi,e,t);r.layers=this.layers,this.add(r);const o=new tn(mi,gi,e,t);o.layers=this.layers,this.add(o);const a=new tn(mi,gi,e,t);a.layers=this.layers,this.add(a);const l=new tn(mi,gi,e,t);l.layers=this.layers,this.add(l);const c=new tn(mi,gi,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const e=this.coordinateSystem,t=this.children.concat(),[n,s,r,o,a,l]=t;for(const c of t)this.remove(c);if(e===xn)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Is)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[r,o,a,l,c,u]=this.children,f=e.getRenderTarget(),p=e.getActiveCubeFace(),m=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;const _=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,s),e.render(t,r),e.setRenderTarget(n,1,s),e.render(t,o),e.setRenderTarget(n,2,s),e.render(t,a),e.setRenderTarget(n,3,s),e.render(t,l),e.setRenderTarget(n,4,s),e.render(t,c),n.texture.generateMipmaps=_,e.setRenderTarget(n,5,s),e.render(t,u),e.setRenderTarget(f,p,m),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}}class tc extends Ht{constructor(e,t,n,s,r,o,a,l,c,u){e=e!==void 0?e:[],t=t!==void 0?t:bi,super(e,t,n,s,r,o,a,l,c,u),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class Bd extends On{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];t.encoding!==void 0&&(Hi("THREE.WebGLCubeRenderTarget: option.encoding has been replaced by option.colorSpace."),t.colorSpace=t.encoding===Kn?St:qt),this.texture=new tc(s,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:Xt}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},s=new Ke(5,5,5),r=new En({name:"CubemapFromEquirect",uniforms:Ri(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Bt,blending:Sn});r.uniforms.tEquirect.value=t;const o=new ge(s,r),a=t.minFilter;return t.minFilter===Wi&&(t.minFilter=Xt),new Od(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t,n,s){const r=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,n,s);e.setRenderTarget(r)}}const yr=new N,zd=new N,Gd=new Xe;class Pn{constructor(e=new N(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){const s=yr.subVectors(n,t).cross(zd.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){const n=e.delta(yr),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;const r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){const t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){const n=t||Gd.getNormalMatrix(e),s=this.coplanarPoint(yr).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Vn=new oa,ys=new N;class ua{constructor(e=new Pn,t=new Pn,n=new Pn,s=new Pn,r=new Pn,o=new Pn){this.planes=[e,t,n,s,r,o]}set(e,t,n,s,r,o){const a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(n),a[3].copy(s),a[4].copy(r),a[5].copy(o),this}copy(e){const t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=xn){const n=this.planes,s=e.elements,r=s[0],o=s[1],a=s[2],l=s[3],c=s[4],u=s[5],f=s[6],p=s[7],m=s[8],g=s[9],_=s[10],h=s[11],d=s[12],x=s[13],v=s[14],T=s[15];if(n[0].setComponents(l-r,p-c,h-m,T-d).normalize(),n[1].setComponents(l+r,p+c,h+m,T+d).normalize(),n[2].setComponents(l+o,p+u,h+g,T+x).normalize(),n[3].setComponents(l-o,p-u,h-g,T-x).normalize(),n[4].setComponents(l-a,p-f,h-_,T-v).normalize(),t===xn)n[5].setComponents(l+a,p+f,h+_,T+v).normalize();else if(t===Is)n[5].setComponents(a,f,_,v).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Vn.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Vn.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Vn)}intersectsSprite(e){return Vn.center.set(0,0,0),Vn.radius=.7071067811865476,Vn.applyMatrix4(e.matrixWorld),this.intersectsSphere(Vn)}intersectsSphere(e){const t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){const t=this.planes;for(let n=0;n<6;n++){const s=t[n];if(ys.x=s.normal.x>0?e.max.x:e.min.x,ys.y=s.normal.y>0?e.max.y:e.min.y,ys.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(ys)<0)return!1}return!0}containsPoint(e){const t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}function nc(){let i=null,e=!1,t=null,n=null;function s(r,o){t(r,o),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function kd(i,e){const t=e.isWebGL2,n=new WeakMap;function s(c,u){const f=c.array,p=c.usage,m=f.byteLength,g=i.createBuffer();i.bindBuffer(u,g),i.bufferData(u,f,p),c.onUploadCallback();let _;if(f instanceof Float32Array)_=i.FLOAT;else if(f instanceof Uint16Array)if(c.isFloat16BufferAttribute)if(t)_=i.HALF_FLOAT;else throw new Error("THREE.WebGLAttributes: Usage of Float16BufferAttribute requires WebGL2.");else _=i.UNSIGNED_SHORT;else if(f instanceof Int16Array)_=i.SHORT;else if(f instanceof Uint32Array)_=i.UNSIGNED_INT;else if(f instanceof Int32Array)_=i.INT;else if(f instanceof Int8Array)_=i.BYTE;else if(f instanceof Uint8Array)_=i.UNSIGNED_BYTE;else if(f instanceof Uint8ClampedArray)_=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+f);return{buffer:g,type:_,bytesPerElement:f.BYTES_PER_ELEMENT,version:c.version,size:m}}function r(c,u,f){const p=u.array,m=u._updateRange,g=u.updateRanges;if(i.bindBuffer(f,c),m.count===-1&&g.length===0&&i.bufferSubData(f,0,p),g.length!==0){for(let _=0,h=g.length;_<h;_++){const d=g[_];t?i.bufferSubData(f,d.start*p.BYTES_PER_ELEMENT,p,d.start,d.count):i.bufferSubData(f,d.start*p.BYTES_PER_ELEMENT,p.subarray(d.start,d.start+d.count))}u.clearUpdateRanges()}m.count!==-1&&(t?i.bufferSubData(f,m.offset*p.BYTES_PER_ELEMENT,p,m.offset,m.count):i.bufferSubData(f,m.offset*p.BYTES_PER_ELEMENT,p.subarray(m.offset,m.offset+m.count)),m.count=-1),u.onUploadCallback()}function o(c){return c.isInterleavedBufferAttribute&&(c=c.data),n.get(c)}function a(c){c.isInterleavedBufferAttribute&&(c=c.data);const u=n.get(c);u&&(i.deleteBuffer(u.buffer),n.delete(c))}function l(c,u){if(c.isGLBufferAttribute){const p=n.get(c);(!p||p.version<c.version)&&n.set(c,{buffer:c.buffer,type:c.type,bytesPerElement:c.elementSize,version:c.version});return}c.isInterleavedBufferAttribute&&(c=c.data);const f=n.get(c);if(f===void 0)n.set(c,s(c,u));else if(f.version<c.version){if(f.size!==c.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");r(f.buffer,c,u),f.version=c.version}}return{get:o,remove:a,update:l}}class ji extends Kt{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};const r=e/2,o=t/2,a=Math.floor(n),l=Math.floor(s),c=a+1,u=l+1,f=e/a,p=t/l,m=[],g=[],_=[],h=[];for(let d=0;d<u;d++){const x=d*p-o;for(let v=0;v<c;v++){const T=v*f-r;g.push(T,-x,0),_.push(0,0,1),h.push(v/a),h.push(1-d/l)}}for(let d=0;d<l;d++)for(let x=0;x<a;x++){const v=x+c*d,T=x+c*(d+1),D=x+1+c*(d+1),A=x+1+c*d;m.push(v,T,A),m.push(T,D,A)}this.setIndex(m),this.setAttribute("position",new ut(g,3)),this.setAttribute("normal",new ut(_,3)),this.setAttribute("uv",new ut(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new ji(e.width,e.height,e.widthSegments,e.heightSegments)}}var Hd=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Vd=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Wd=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Xd=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,$d=`#ifdef USE_ALPHATEST
	if ( diffuseColor.a < alphaTest ) discard;
#endif`,qd=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Yd=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,jd=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Kd=`#ifdef USE_BATCHING
	attribute float batchId;
	uniform highp sampler2D batchingTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Zd=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( batchId );
#endif`,Jd=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Qd=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,eh=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,th=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,nh=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,ih=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#pragma unroll_loop_start
	for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
		plane = clippingPlanes[ i ];
		if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
	}
	#pragma unroll_loop_end
	#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
		bool clipped = true;
		#pragma unroll_loop_start
		for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
		}
		#pragma unroll_loop_end
		if ( clipped ) discard;
	#endif
#endif`,sh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,rh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,ah=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,oh=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,lh=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,ch=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	varying vec3 vColor;
#endif`,uh=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif`,dh=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
float luminance( const in vec3 rgb ) {
	const vec3 weights = vec3( 0.2126729, 0.7151522, 0.0721750 );
	return dot( weights, rgb );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,hh=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,fh=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,ph=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,mh=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,gh=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,_h=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,vh="gl_FragColor = linearToOutputTexel( gl_FragColor );",xh=`
const mat3 LINEAR_SRGB_TO_LINEAR_DISPLAY_P3 = mat3(
	vec3( 0.8224621, 0.177538, 0.0 ),
	vec3( 0.0331941, 0.9668058, 0.0 ),
	vec3( 0.0170827, 0.0723974, 0.9105199 )
);
const mat3 LINEAR_DISPLAY_P3_TO_LINEAR_SRGB = mat3(
	vec3( 1.2249401, - 0.2249404, 0.0 ),
	vec3( - 0.0420569, 1.0420571, 0.0 ),
	vec3( - 0.0196376, - 0.0786361, 1.0982735 )
);
vec4 LinearSRGBToLinearDisplayP3( in vec4 value ) {
	return vec4( value.rgb * LINEAR_SRGB_TO_LINEAR_DISPLAY_P3, value.a );
}
vec4 LinearDisplayP3ToLinearSRGB( in vec4 value ) {
	return vec4( value.rgb * LINEAR_DISPLAY_P3_TO_LINEAR_SRGB, value.a );
}
vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
vec4 LinearToLinear( in vec4 value ) {
	return value;
}
vec4 LinearTosRGB( in vec4 value ) {
	return sRGBTransferOETF( value );
}`,Mh=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Sh=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,yh=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Eh=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,bh=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,Th=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Ah=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,wh=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Rh=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Ch=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Lh=`#ifdef USE_LIGHTMAP
	vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
	vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
	reflectedLight.indirectDiffuse += lightMapIrradiance;
#endif`,Ph=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Dh=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Uh=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Ih=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	#if defined ( LEGACY_LIGHTS )
		if ( cutoffDistance > 0.0 && decayExponent > 0.0 ) {
			return pow( saturate( - lightDistance / cutoffDistance + 1.0 ), decayExponent );
		}
		return 1.0;
	#else
		float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
		if ( cutoffDistance > 0.0 ) {
			distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
		}
		return distanceFalloff;
	#endif
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,Nh=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Fh=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Oh=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Bh=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,zh=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Gh=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,kh=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,Hh=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Vh=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Wh=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Xh=`#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	gl_FragDepthEXT = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,$h=`#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,qh=`#ifdef USE_LOGDEPTHBUF
	#ifdef USE_LOGDEPTHBUF_EXT
		varying float vFragDepth;
		varying float vIsPerspective;
	#else
		uniform float logDepthBufFC;
	#endif
#endif`,Yh=`#ifdef USE_LOGDEPTHBUF
	#ifdef USE_LOGDEPTHBUF_EXT
		vFragDepth = 1.0 + gl_Position.w;
		vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
	#else
		if ( isPerspectiveMatrix( projectionMatrix ) ) {
			gl_Position.z = log2( max( EPSILON, gl_Position.w + 1.0 ) ) * logDepthBufFC - 1.0;
			gl_Position.z *= gl_Position.w;
		}
	#endif
#endif`,jh=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Kh=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Zh=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,Jh=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Qh=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,ef=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,tf=`#if defined( USE_MORPHCOLORS ) && defined( MORPHTARGETS_TEXTURE )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,nf=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
			if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
		}
	#else
		objectNormal += morphNormal0 * morphTargetInfluences[ 0 ];
		objectNormal += morphNormal1 * morphTargetInfluences[ 1 ];
		objectNormal += morphNormal2 * morphTargetInfluences[ 2 ];
		objectNormal += morphNormal3 * morphTargetInfluences[ 3 ];
	#endif
#endif`,sf=`#ifdef USE_MORPHTARGETS
	uniform float morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
		uniform sampler2DArray morphTargetsTexture;
		uniform ivec2 morphTargetsTextureSize;
		vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
			int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
			int y = texelIndex / morphTargetsTextureSize.x;
			int x = texelIndex - y * morphTargetsTextureSize.x;
			ivec3 morphUV = ivec3( x, y, morphTargetIndex );
			return texelFetch( morphTargetsTexture, morphUV, 0 );
		}
	#else
		#ifndef USE_MORPHNORMALS
			uniform float morphTargetInfluences[ 8 ];
		#else
			uniform float morphTargetInfluences[ 4 ];
		#endif
	#endif
#endif`,rf=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	#ifdef MORPHTARGETS_TEXTURE
		for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
			if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
		}
	#else
		transformed += morphTarget0 * morphTargetInfluences[ 0 ];
		transformed += morphTarget1 * morphTargetInfluences[ 1 ];
		transformed += morphTarget2 * morphTargetInfluences[ 2 ];
		transformed += morphTarget3 * morphTargetInfluences[ 3 ];
		#ifndef USE_MORPHNORMALS
			transformed += morphTarget4 * morphTargetInfluences[ 4 ];
			transformed += morphTarget5 * morphTargetInfluences[ 5 ];
			transformed += morphTarget6 * morphTargetInfluences[ 6 ];
			transformed += morphTarget7 * morphTargetInfluences[ 7 ];
		#endif
	#endif
#endif`,af=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,of=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,lf=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,cf=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,uf=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,df=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,hf=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,ff=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,pf=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,mf=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,gf=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,_f=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;
const vec3 PackFactors = vec3( 256. * 256. * 256., 256. * 256., 256. );
const vec4 UnpackFactors = UnpackDownscale / vec4( PackFactors, 1. );
const float ShiftRight8 = 1. / 256.;
vec4 packDepthToRGBA( const in float v ) {
	vec4 r = vec4( fract( v * PackFactors ), v );
	r.yzw -= r.xyz * ShiftRight8;	return r * PackUpscale;
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors );
}
vec2 packDepthToRG( in highp float v ) {
	return packDepthToRGBA( v ).yx;
}
float unpackRGToDepth( const in highp vec2 v ) {
	return unpackRGBAToDepth( vec4( v.xy, 0.0, 0.0 ) );
}
vec4 pack2HalfToRGBA( vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,vf=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,xf=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Mf=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Sf=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,yf=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Ef=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,bf=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return shadow;
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
		vec3 lightToPosition = shadowCoord.xyz;
		float dp = ( length( lightToPosition ) - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );		dp += shadowBias;
		vec3 bd3D = normalize( lightToPosition );
		#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
			vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
			return (
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
				texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
			) * ( 1.0 / 9.0 );
		#else
			return texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
		#endif
	}
#endif`,Tf=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,Af=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,wf=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Rf=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Cf=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Lf=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Pf=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Df=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Uf=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,If=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Nf=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 OptimizedCineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color *= toneMappingExposure;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	return color;
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,Ff=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Of=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
		vec3 refractedRayExit = position + transmissionRay;
		vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
		vec2 refractionCoords = ndcPos.xy / ndcPos.w;
		refractionCoords += 1.0;
		refractionCoords /= 2.0;
		vec4 transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
		vec3 transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,Bf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,zf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Gf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,kf=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const Hf=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Vf=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Wf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Xf=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,$f=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,qf=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Yf=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,jf=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( 1.0 );
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#endif
}`,Kf=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Zf=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( 1.0 );
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,Jf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Qf=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,ep=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,tp=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,np=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,ip=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,sp=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,rp=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,ap=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,op=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,lp=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,cp=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), opacity );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,up=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,dp=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,hp=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,fp=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,pp=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,mp=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec4 diffuseColor = vec4( diffuse, opacity );
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,gp=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,_p=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,vp=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,xp=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Mp=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec2 scale;
	scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
	scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Sp=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Ge={alphahash_fragment:Hd,alphahash_pars_fragment:Vd,alphamap_fragment:Wd,alphamap_pars_fragment:Xd,alphatest_fragment:$d,alphatest_pars_fragment:qd,aomap_fragment:Yd,aomap_pars_fragment:jd,batching_pars_vertex:Kd,batching_vertex:Zd,begin_vertex:Jd,beginnormal_vertex:Qd,bsdfs:eh,iridescence_fragment:th,bumpmap_pars_fragment:nh,clipping_planes_fragment:ih,clipping_planes_pars_fragment:sh,clipping_planes_pars_vertex:rh,clipping_planes_vertex:ah,color_fragment:oh,color_pars_fragment:lh,color_pars_vertex:ch,color_vertex:uh,common:dh,cube_uv_reflection_fragment:hh,defaultnormal_vertex:fh,displacementmap_pars_vertex:ph,displacementmap_vertex:mh,emissivemap_fragment:gh,emissivemap_pars_fragment:_h,colorspace_fragment:vh,colorspace_pars_fragment:xh,envmap_fragment:Mh,envmap_common_pars_fragment:Sh,envmap_pars_fragment:yh,envmap_pars_vertex:Eh,envmap_physical_pars_fragment:Nh,envmap_vertex:bh,fog_vertex:Th,fog_pars_vertex:Ah,fog_fragment:wh,fog_pars_fragment:Rh,gradientmap_pars_fragment:Ch,lightmap_fragment:Lh,lightmap_pars_fragment:Ph,lights_lambert_fragment:Dh,lights_lambert_pars_fragment:Uh,lights_pars_begin:Ih,lights_toon_fragment:Fh,lights_toon_pars_fragment:Oh,lights_phong_fragment:Bh,lights_phong_pars_fragment:zh,lights_physical_fragment:Gh,lights_physical_pars_fragment:kh,lights_fragment_begin:Hh,lights_fragment_maps:Vh,lights_fragment_end:Wh,logdepthbuf_fragment:Xh,logdepthbuf_pars_fragment:$h,logdepthbuf_pars_vertex:qh,logdepthbuf_vertex:Yh,map_fragment:jh,map_pars_fragment:Kh,map_particle_fragment:Zh,map_particle_pars_fragment:Jh,metalnessmap_fragment:Qh,metalnessmap_pars_fragment:ef,morphcolor_vertex:tf,morphnormal_vertex:nf,morphtarget_pars_vertex:sf,morphtarget_vertex:rf,normal_fragment_begin:af,normal_fragment_maps:of,normal_pars_fragment:lf,normal_pars_vertex:cf,normal_vertex:uf,normalmap_pars_fragment:df,clearcoat_normal_fragment_begin:hf,clearcoat_normal_fragment_maps:ff,clearcoat_pars_fragment:pf,iridescence_pars_fragment:mf,opaque_fragment:gf,packing:_f,premultiplied_alpha_fragment:vf,project_vertex:xf,dithering_fragment:Mf,dithering_pars_fragment:Sf,roughnessmap_fragment:yf,roughnessmap_pars_fragment:Ef,shadowmap_pars_fragment:bf,shadowmap_pars_vertex:Tf,shadowmap_vertex:Af,shadowmask_pars_fragment:wf,skinbase_vertex:Rf,skinning_pars_vertex:Cf,skinning_vertex:Lf,skinnormal_vertex:Pf,specularmap_fragment:Df,specularmap_pars_fragment:Uf,tonemapping_fragment:If,tonemapping_pars_fragment:Nf,transmission_fragment:Ff,transmission_pars_fragment:Of,uv_pars_fragment:Bf,uv_pars_vertex:zf,uv_vertex:Gf,worldpos_vertex:kf,background_vert:Hf,background_frag:Vf,backgroundCube_vert:Wf,backgroundCube_frag:Xf,cube_vert:$f,cube_frag:qf,depth_vert:Yf,depth_frag:jf,distanceRGBA_vert:Kf,distanceRGBA_frag:Zf,equirect_vert:Jf,equirect_frag:Qf,linedashed_vert:ep,linedashed_frag:tp,meshbasic_vert:np,meshbasic_frag:ip,meshlambert_vert:sp,meshlambert_frag:rp,meshmatcap_vert:ap,meshmatcap_frag:op,meshnormal_vert:lp,meshnormal_frag:cp,meshphong_vert:up,meshphong_frag:dp,meshphysical_vert:hp,meshphysical_frag:fp,meshtoon_vert:pp,meshtoon_frag:mp,points_vert:gp,points_frag:_p,shadow_vert:vp,shadow_frag:xp,sprite_vert:Mp,sprite_frag:Sp},de={common:{diffuse:{value:new $e(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Xe},alphaMap:{value:null},alphaMapTransform:{value:new Xe},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Xe}},envmap:{envMap:{value:null},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Xe}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Xe}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Xe},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Xe},normalScale:{value:new Ae(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Xe},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Xe}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Xe}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Xe}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new $e(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new $e(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Xe},alphaTest:{value:0},uvTransform:{value:new Xe}},sprite:{diffuse:{value:new $e(16777215)},opacity:{value:1},center:{value:new Ae(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Xe},alphaMap:{value:null},alphaMapTransform:{value:new Xe},alphaTest:{value:0}}},ln={basic:{uniforms:Pt([de.common,de.specularmap,de.envmap,de.aomap,de.lightmap,de.fog]),vertexShader:Ge.meshbasic_vert,fragmentShader:Ge.meshbasic_frag},lambert:{uniforms:Pt([de.common,de.specularmap,de.envmap,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.fog,de.lights,{emissive:{value:new $e(0)}}]),vertexShader:Ge.meshlambert_vert,fragmentShader:Ge.meshlambert_frag},phong:{uniforms:Pt([de.common,de.specularmap,de.envmap,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.fog,de.lights,{emissive:{value:new $e(0)},specular:{value:new $e(1118481)},shininess:{value:30}}]),vertexShader:Ge.meshphong_vert,fragmentShader:Ge.meshphong_frag},standard:{uniforms:Pt([de.common,de.envmap,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.roughnessmap,de.metalnessmap,de.fog,de.lights,{emissive:{value:new $e(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ge.meshphysical_vert,fragmentShader:Ge.meshphysical_frag},toon:{uniforms:Pt([de.common,de.aomap,de.lightmap,de.emissivemap,de.bumpmap,de.normalmap,de.displacementmap,de.gradientmap,de.fog,de.lights,{emissive:{value:new $e(0)}}]),vertexShader:Ge.meshtoon_vert,fragmentShader:Ge.meshtoon_frag},matcap:{uniforms:Pt([de.common,de.bumpmap,de.normalmap,de.displacementmap,de.fog,{matcap:{value:null}}]),vertexShader:Ge.meshmatcap_vert,fragmentShader:Ge.meshmatcap_frag},points:{uniforms:Pt([de.points,de.fog]),vertexShader:Ge.points_vert,fragmentShader:Ge.points_frag},dashed:{uniforms:Pt([de.common,de.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ge.linedashed_vert,fragmentShader:Ge.linedashed_frag},depth:{uniforms:Pt([de.common,de.displacementmap]),vertexShader:Ge.depth_vert,fragmentShader:Ge.depth_frag},normal:{uniforms:Pt([de.common,de.bumpmap,de.normalmap,de.displacementmap,{opacity:{value:1}}]),vertexShader:Ge.meshnormal_vert,fragmentShader:Ge.meshnormal_frag},sprite:{uniforms:Pt([de.sprite,de.fog]),vertexShader:Ge.sprite_vert,fragmentShader:Ge.sprite_frag},background:{uniforms:{uvTransform:{value:new Xe},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ge.background_vert,fragmentShader:Ge.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1}},vertexShader:Ge.backgroundCube_vert,fragmentShader:Ge.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ge.cube_vert,fragmentShader:Ge.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ge.equirect_vert,fragmentShader:Ge.equirect_frag},distanceRGBA:{uniforms:Pt([de.common,de.displacementmap,{referencePosition:{value:new N},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ge.distanceRGBA_vert,fragmentShader:Ge.distanceRGBA_frag},shadow:{uniforms:Pt([de.lights,de.fog,{color:{value:new $e(0)},opacity:{value:1}}]),vertexShader:Ge.shadow_vert,fragmentShader:Ge.shadow_frag}};ln.physical={uniforms:Pt([ln.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Xe},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Xe},clearcoatNormalScale:{value:new Ae(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Xe},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Xe},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Xe},sheen:{value:0},sheenColor:{value:new $e(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Xe},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Xe},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Xe},transmissionSamplerSize:{value:new Ae},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Xe},attenuationDistance:{value:0},attenuationColor:{value:new $e(0)},specularColor:{value:new $e(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Xe},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Xe},anisotropyVector:{value:new Ae},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Xe}}]),vertexShader:Ge.meshphysical_vert,fragmentShader:Ge.meshphysical_frag};const Es={r:0,b:0,g:0};function yp(i,e,t,n,s,r,o){const a=new $e(0);let l=r===!0?0:1,c,u,f=null,p=0,m=null;function g(h,d){let x=!1,v=d.isScene===!0?d.background:null;v&&v.isTexture&&(v=(d.backgroundBlurriness>0?t:e).get(v)),v===null?_(a,l):v&&v.isColor&&(_(v,1),x=!0);const T=i.xr.getEnvironmentBlendMode();T==="additive"?n.buffers.color.setClear(0,0,0,1,o):T==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||x)&&i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil),v&&(v.isCubeTexture||v.mapping===Bs)?(u===void 0&&(u=new ge(new Ke(1,1,1),new En({name:"BackgroundCubeMaterial",uniforms:Ri(ln.backgroundCube.uniforms),vertexShader:ln.backgroundCube.vertexShader,fragmentShader:ln.backgroundCube.fragmentShader,side:Bt,depthTest:!1,depthWrite:!1,fog:!1})),u.geometry.deleteAttribute("normal"),u.geometry.deleteAttribute("uv"),u.onBeforeRender=function(D,A,w){this.matrixWorld.copyPosition(w.matrixWorld)},Object.defineProperty(u.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(u)),u.material.uniforms.envMap.value=v,u.material.uniforms.flipEnvMap.value=v.isCubeTexture&&v.isRenderTargetTexture===!1?-1:1,u.material.uniforms.backgroundBlurriness.value=d.backgroundBlurriness,u.material.uniforms.backgroundIntensity.value=d.backgroundIntensity,u.material.toneMapped=nt.getTransfer(v.colorSpace)!==rt,(f!==v||p!==v.version||m!==i.toneMapping)&&(u.material.needsUpdate=!0,f=v,p=v.version,m=i.toneMapping),u.layers.enableAll(),h.unshift(u,u.geometry,u.material,0,0,null)):v&&v.isTexture&&(c===void 0&&(c=new ge(new ji(2,2),new En({name:"BackgroundMaterial",uniforms:Ri(ln.background.uniforms),vertexShader:ln.background.vertexShader,fragmentShader:ln.background.fragmentShader,side:Fn,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(c)),c.material.uniforms.t2D.value=v,c.material.uniforms.backgroundIntensity.value=d.backgroundIntensity,c.material.toneMapped=nt.getTransfer(v.colorSpace)!==rt,v.matrixAutoUpdate===!0&&v.updateMatrix(),c.material.uniforms.uvTransform.value.copy(v.matrix),(f!==v||p!==v.version||m!==i.toneMapping)&&(c.material.needsUpdate=!0,f=v,p=v.version,m=i.toneMapping),c.layers.enableAll(),h.unshift(c,c.geometry,c.material,0,0,null))}function _(h,d){h.getRGB(Es,Jl(i)),n.buffers.color.setClear(Es.r,Es.g,Es.b,d,o)}return{getClearColor:function(){return a},setClearColor:function(h,d=1){a.set(h),l=d,_(a,l)},getClearAlpha:function(){return l},setClearAlpha:function(h){l=h,_(a,l)},render:g}}function Ep(i,e,t,n){const s=i.getParameter(i.MAX_VERTEX_ATTRIBS),r=n.isWebGL2?null:e.get("OES_vertex_array_object"),o=n.isWebGL2||r!==null,a={},l=h(null);let c=l,u=!1;function f(L,O,W,j,q){let $=!1;if(o){const Q=_(j,W,O);c!==Q&&(c=Q,m(c.object)),$=d(L,j,W,q),$&&x(L,j,W,q)}else{const Q=O.wireframe===!0;(c.geometry!==j.id||c.program!==W.id||c.wireframe!==Q)&&(c.geometry=j.id,c.program=W.id,c.wireframe=Q,$=!0)}q!==null&&t.update(q,i.ELEMENT_ARRAY_BUFFER),($||u)&&(u=!1,I(L,O,W,j),q!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,t.get(q).buffer))}function p(){return n.isWebGL2?i.createVertexArray():r.createVertexArrayOES()}function m(L){return n.isWebGL2?i.bindVertexArray(L):r.bindVertexArrayOES(L)}function g(L){return n.isWebGL2?i.deleteVertexArray(L):r.deleteVertexArrayOES(L)}function _(L,O,W){const j=W.wireframe===!0;let q=a[L.id];q===void 0&&(q={},a[L.id]=q);let $=q[O.id];$===void 0&&($={},q[O.id]=$);let Q=$[j];return Q===void 0&&(Q=h(p()),$[j]=Q),Q}function h(L){const O=[],W=[],j=[];for(let q=0;q<s;q++)O[q]=0,W[q]=0,j[q]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:O,enabledAttributes:W,attributeDivisors:j,object:L,attributes:{},index:null}}function d(L,O,W,j){const q=c.attributes,$=O.attributes;let Q=0;const re=W.getAttributes();for(const pe in re)if(re[pe].location>=0){const ee=q[pe];let fe=$[pe];if(fe===void 0&&(pe==="instanceMatrix"&&L.instanceMatrix&&(fe=L.instanceMatrix),pe==="instanceColor"&&L.instanceColor&&(fe=L.instanceColor)),ee===void 0||ee.attribute!==fe||fe&&ee.data!==fe.data)return!0;Q++}return c.attributesNum!==Q||c.index!==j}function x(L,O,W,j){const q={},$=O.attributes;let Q=0;const re=W.getAttributes();for(const pe in re)if(re[pe].location>=0){let ee=$[pe];ee===void 0&&(pe==="instanceMatrix"&&L.instanceMatrix&&(ee=L.instanceMatrix),pe==="instanceColor"&&L.instanceColor&&(ee=L.instanceColor));const fe={};fe.attribute=ee,ee&&ee.data&&(fe.data=ee.data),q[pe]=fe,Q++}c.attributes=q,c.attributesNum=Q,c.index=j}function v(){const L=c.newAttributes;for(let O=0,W=L.length;O<W;O++)L[O]=0}function T(L){D(L,0)}function D(L,O){const W=c.newAttributes,j=c.enabledAttributes,q=c.attributeDivisors;W[L]=1,j[L]===0&&(i.enableVertexAttribArray(L),j[L]=1),q[L]!==O&&((n.isWebGL2?i:e.get("ANGLE_instanced_arrays"))[n.isWebGL2?"vertexAttribDivisor":"vertexAttribDivisorANGLE"](L,O),q[L]=O)}function A(){const L=c.newAttributes,O=c.enabledAttributes;for(let W=0,j=O.length;W<j;W++)O[W]!==L[W]&&(i.disableVertexAttribArray(W),O[W]=0)}function w(L,O,W,j,q,$,Q){Q===!0?i.vertexAttribIPointer(L,O,W,q,$):i.vertexAttribPointer(L,O,W,j,q,$)}function I(L,O,W,j){if(n.isWebGL2===!1&&(L.isInstancedMesh||j.isInstancedBufferGeometry)&&e.get("ANGLE_instanced_arrays")===null)return;v();const q=j.attributes,$=W.getAttributes(),Q=O.defaultAttributeValues;for(const re in $){const pe=$[re];if(pe.location>=0){let X=q[re];if(X===void 0&&(re==="instanceMatrix"&&L.instanceMatrix&&(X=L.instanceMatrix),re==="instanceColor"&&L.instanceColor&&(X=L.instanceColor)),X!==void 0){const ee=X.normalized,fe=X.itemSize,ye=t.get(X);if(ye===void 0)continue;const Me=ye.buffer,Ie=ye.type,Ne=ye.bytesPerElement,Re=n.isWebGL2===!0&&(Ie===i.INT||Ie===i.UNSIGNED_INT||X.gpuType===Nl);if(X.isInterleavedBufferAttribute){const qe=X.data,z=qe.stride,mt=X.offset;if(qe.isInstancedInterleavedBuffer){for(let Te=0;Te<pe.locationSize;Te++)D(pe.location+Te,qe.meshPerAttribute);L.isInstancedMesh!==!0&&j._maxInstanceCount===void 0&&(j._maxInstanceCount=qe.meshPerAttribute*qe.count)}else for(let Te=0;Te<pe.locationSize;Te++)T(pe.location+Te);i.bindBuffer(i.ARRAY_BUFFER,Me);for(let Te=0;Te<pe.locationSize;Te++)w(pe.location+Te,fe/pe.locationSize,Ie,ee,z*Ne,(mt+fe/pe.locationSize*Te)*Ne,Re)}else{if(X.isInstancedBufferAttribute){for(let qe=0;qe<pe.locationSize;qe++)D(pe.location+qe,X.meshPerAttribute);L.isInstancedMesh!==!0&&j._maxInstanceCount===void 0&&(j._maxInstanceCount=X.meshPerAttribute*X.count)}else for(let qe=0;qe<pe.locationSize;qe++)T(pe.location+qe);i.bindBuffer(i.ARRAY_BUFFER,Me);for(let qe=0;qe<pe.locationSize;qe++)w(pe.location+qe,fe/pe.locationSize,Ie,ee,fe*Ne,fe/pe.locationSize*qe*Ne,Re)}}else if(Q!==void 0){const ee=Q[re];if(ee!==void 0)switch(ee.length){case 2:i.vertexAttrib2fv(pe.location,ee);break;case 3:i.vertexAttrib3fv(pe.location,ee);break;case 4:i.vertexAttrib4fv(pe.location,ee);break;default:i.vertexAttrib1fv(pe.location,ee)}}}}A()}function M(){B();for(const L in a){const O=a[L];for(const W in O){const j=O[W];for(const q in j)g(j[q].object),delete j[q];delete O[W]}delete a[L]}}function y(L){if(a[L.id]===void 0)return;const O=a[L.id];for(const W in O){const j=O[W];for(const q in j)g(j[q].object),delete j[q];delete O[W]}delete a[L.id]}function U(L){for(const O in a){const W=a[O];if(W[L.id]===void 0)continue;const j=W[L.id];for(const q in j)g(j[q].object),delete j[q];delete W[L.id]}}function B(){Y(),u=!0,c!==l&&(c=l,m(c.object))}function Y(){l.geometry=null,l.program=null,l.wireframe=!1}return{setup:f,reset:B,resetDefaultState:Y,dispose:M,releaseStatesOfGeometry:y,releaseStatesOfProgram:U,initAttributes:v,enableAttribute:T,disableUnusedAttributes:A}}function bp(i,e,t,n){const s=n.isWebGL2;let r;function o(u){r=u}function a(u,f){i.drawArrays(r,u,f),t.update(f,r,1)}function l(u,f,p){if(p===0)return;let m,g;if(s)m=i,g="drawArraysInstanced";else if(m=e.get("ANGLE_instanced_arrays"),g="drawArraysInstancedANGLE",m===null){console.error("THREE.WebGLBufferRenderer: using THREE.InstancedBufferGeometry but hardware does not support extension ANGLE_instanced_arrays.");return}m[g](r,u,f,p),t.update(f,r,p)}function c(u,f,p){if(p===0)return;const m=e.get("WEBGL_multi_draw");if(m===null)for(let g=0;g<p;g++)this.render(u[g],f[g]);else{m.multiDrawArraysWEBGL(r,u,0,f,0,p);let g=0;for(let _=0;_<p;_++)g+=f[_];t.update(g,r,1)}}this.setMode=o,this.render=a,this.renderInstances=l,this.renderMultiDraw=c}function Tp(i,e,t){let n;function s(){if(n!==void 0)return n;if(e.has("EXT_texture_filter_anisotropic")===!0){const w=e.get("EXT_texture_filter_anisotropic");n=i.getParameter(w.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else n=0;return n}function r(w){if(w==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";w="mediump"}return w==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}const o=typeof WebGL2RenderingContext<"u"&&i.constructor.name==="WebGL2RenderingContext";let a=t.precision!==void 0?t.precision:"highp";const l=r(a);l!==a&&(console.warn("THREE.WebGLRenderer:",a,"not supported, using",l,"instead."),a=l);const c=o||e.has("WEBGL_draw_buffers"),u=t.logarithmicDepthBuffer===!0,f=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),p=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),m=i.getParameter(i.MAX_TEXTURE_SIZE),g=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),_=i.getParameter(i.MAX_VERTEX_ATTRIBS),h=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),d=i.getParameter(i.MAX_VARYING_VECTORS),x=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),v=p>0,T=o||e.has("OES_texture_float"),D=v&&T,A=o?i.getParameter(i.MAX_SAMPLES):0;return{isWebGL2:o,drawBuffers:c,getMaxAnisotropy:s,getMaxPrecision:r,precision:a,logarithmicDepthBuffer:u,maxTextures:f,maxVertexTextures:p,maxTextureSize:m,maxCubemapSize:g,maxAttributes:_,maxVertexUniforms:h,maxVaryings:d,maxFragmentUniforms:x,vertexTextures:v,floatFragmentTextures:T,floatVertexTextures:D,maxSamples:A}}function Ap(i){const e=this;let t=null,n=0,s=!1,r=!1;const o=new Pn,a=new Xe,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(f,p){const m=f.length!==0||p||n!==0||s;return s=p,n=f.length,m},this.beginShadows=function(){r=!0,u(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(f,p){t=u(f,p,0)},this.setState=function(f,p,m){const g=f.clippingPlanes,_=f.clipIntersection,h=f.clipShadows,d=i.get(f);if(!s||g===null||g.length===0||r&&!h)r?u(null):c();else{const x=r?0:n,v=x*4;let T=d.clippingState||null;l.value=T,T=u(g,p,v,m);for(let D=0;D!==v;++D)T[D]=t[D];d.clippingState=T,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=x}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function u(f,p,m,g){const _=f!==null?f.length:0;let h=null;if(_!==0){if(h=l.value,g!==!0||h===null){const d=m+_*4,x=p.matrixWorldInverse;a.getNormalMatrix(x),(h===null||h.length<d)&&(h=new Float32Array(d));for(let v=0,T=m;v!==_;++v,T+=4)o.copy(f[v]).applyMatrix4(x,a),o.normal.toArray(h,T),h[T+3]=o.constant}l.value=h,l.needsUpdate=!0}return e.numPlanes=_,e.numIntersection=0,h}}function wp(i){let e=new WeakMap;function t(o,a){return a===Or?o.mapping=bi:a===Br&&(o.mapping=Ti),o}function n(o){if(o&&o.isTexture){const a=o.mapping;if(a===Or||a===Br)if(e.has(o)){const l=e.get(o).texture;return t(l,o.mapping)}else{const l=o.image;if(l&&l.height>0){const c=new Bd(l.height/2);return c.fromEquirectangularTexture(i,o),e.set(o,c),o.addEventListener("dispose",s),t(c.texture,o.mapping)}else return null}}return o}function s(o){const a=o.target;a.removeEventListener("dispose",s);const l=e.get(a);l!==void 0&&(e.delete(a),l.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}class Hs extends ec{constructor(e=-1,t=1,n=1,s=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2;let r=n-e,o=n+e,a=s+t,l=s-t;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,u=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,o=r+c*this.view.width,a-=u*this.view.offsetY,l=a-u*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}}const vi=4,Co=[.125,.215,.35,.446,.526,.582],$n=20,Er=new Hs,Lo=new $e;let br=null,Tr=0,Ar=0;const Wn=(1+Math.sqrt(5))/2,_i=1/Wn,Po=[new N(1,1,1),new N(-1,1,1),new N(1,1,-1),new N(-1,1,-1),new N(0,Wn,_i),new N(0,Wn,-_i),new N(_i,0,Wn),new N(-_i,0,Wn),new N(Wn,_i,0),new N(-Wn,_i,0)];class Do{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,s=100){br=this._renderer.getRenderTarget(),Tr=this._renderer.getActiveCubeFace(),Ar=this._renderer.getActiveMipmapLevel(),this._setSize(256);const r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(e,n,s,r),t>0&&this._blur(r,0,0,t),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=No(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Io(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(br,Tr,Ar),e.scissorTest=!1,bs(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===bi||e.mapping===Ti?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),br=this._renderer.getRenderTarget(),Tr=this._renderer.getActiveCubeFace(),Ar=this._renderer.getActiveMipmapLevel();const n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Xt,minFilter:Xt,generateMipmaps:!1,type:Ai,format:sn,colorSpace:yn,depthBuffer:!1},s=Uo(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Uo(e,t,n);const{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=Rp(r)),this._blurMaterial=Cp(r,e,t)}return s}_compileMaterial(e){const t=new ge(this._lodPlanes[0],e);this._renderer.compile(t,Er)}_sceneToCubeUV(e,t,n,s){const a=new tn(90,1,t,n),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],u=this._renderer,f=u.autoClear,p=u.toneMapping;u.getClearColor(Lo),u.toneMapping=In,u.autoClear=!1;const m=new ks({name:"PMREM.Background",side:Bt,depthWrite:!1,depthTest:!1}),g=new ge(new Ke,m);let _=!1;const h=e.background;h?h.isColor&&(m.color.copy(h),e.background=null,_=!0):(m.color.copy(Lo),_=!0);for(let d=0;d<6;d++){const x=d%3;x===0?(a.up.set(0,l[d],0),a.lookAt(c[d],0,0)):x===1?(a.up.set(0,0,l[d]),a.lookAt(0,c[d],0)):(a.up.set(0,l[d],0),a.lookAt(0,0,c[d]));const v=this._cubeSize;bs(s,x*v,d>2?v:0,v,v),u.setRenderTarget(s),_&&u.render(g,a),u.render(e,a)}g.geometry.dispose(),g.material.dispose(),u.toneMapping=p,u.autoClear=f,e.background=h}_textureToCubeUV(e,t){const n=this._renderer,s=e.mapping===bi||e.mapping===Ti;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=No()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Io());const r=s?this._cubemapMaterial:this._equirectMaterial,o=new ge(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=e;const l=this._cubeSize;bs(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(o,Er)}_applyPMREM(e){const t=this._renderer,n=t.autoClear;t.autoClear=!1;for(let s=1;s<this._lodPlanes.length;s++){const r=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),o=Po[(s-1)%Po.length];this._blur(e,s-1,s,r,o)}t.autoClear=n}_blur(e,t,n,s,r){const o=this._pingPongRenderTarget;this._halfBlur(e,o,t,n,s,"latitudinal",r),this._halfBlur(o,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,o,a){const l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const u=3,f=new ge(this._lodPlanes[s],c),p=c.uniforms,m=this._sizeLods[n]-1,g=isFinite(r)?Math.PI/(2*m):2*Math.PI/(2*$n-1),_=r/g,h=isFinite(r)?1+Math.floor(u*_):$n;h>$n&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${h} samples when the maximum is set to ${$n}`);const d=[];let x=0;for(let w=0;w<$n;++w){const I=w/_,M=Math.exp(-I*I/2);d.push(M),w===0?x+=M:w<h&&(x+=2*M)}for(let w=0;w<d.length;w++)d[w]=d[w]/x;p.envMap.value=e.texture,p.samples.value=h,p.weights.value=d,p.latitudinal.value=o==="latitudinal",a&&(p.poleAxis.value=a);const{_lodMax:v}=this;p.dTheta.value=g,p.mipInt.value=v-n;const T=this._sizeLods[s],D=3*T*(s>v-vi?s-v+vi:0),A=4*(this._cubeSize-T);bs(t,D,A,3*T,2*T),l.setRenderTarget(t),l.render(f,Er)}}function Rp(i){const e=[],t=[],n=[];let s=i;const r=i-vi+1+Co.length;for(let o=0;o<r;o++){const a=Math.pow(2,s);t.push(a);let l=1/a;o>i-vi?l=Co[o-i+vi-1]:o===0&&(l=0),n.push(l);const c=1/(a-2),u=-c,f=1+c,p=[u,u,f,u,f,f,u,u,f,f,u,f],m=6,g=6,_=3,h=2,d=1,x=new Float32Array(_*g*m),v=new Float32Array(h*g*m),T=new Float32Array(d*g*m);for(let A=0;A<m;A++){const w=A%3*2/3-1,I=A>2?0:-1,M=[w,I,0,w+2/3,I,0,w+2/3,I+1,0,w,I,0,w+2/3,I+1,0,w,I+1,0];x.set(M,_*g*A),v.set(p,h*g*A);const y=[A,A,A,A,A,A];T.set(y,d*g*A)}const D=new Kt;D.setAttribute("position",new un(x,_)),D.setAttribute("uv",new un(v,h)),D.setAttribute("faceIndex",new un(T,d)),e.push(D),s>vi&&s--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function Uo(i,e,t){const n=new On(i,e,t);return n.texture.mapping=Bs,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function bs(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function Cp(i,e,t){const n=new Float32Array($n),s=new N(0,1,0);return new En({name:"SphericalGaussianBlur",defines:{n:$n,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:da(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Sn,depthTest:!1,depthWrite:!1})}function Io(){return new En({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:da(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Sn,depthTest:!1,depthWrite:!1})}function No(){return new En({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:da(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Sn,depthTest:!1,depthWrite:!1})}function da(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Lp(i){let e=new WeakMap,t=null;function n(a){if(a&&a.isTexture){const l=a.mapping,c=l===Or||l===Br,u=l===bi||l===Ti;if(c||u)if(a.isRenderTargetTexture&&a.needsPMREMUpdate===!0){a.needsPMREMUpdate=!1;let f=e.get(a);return t===null&&(t=new Do(i)),f=c?t.fromEquirectangular(a,f):t.fromCubemap(a,f),e.set(a,f),f.texture}else{if(e.has(a))return e.get(a).texture;{const f=a.image;if(c&&f&&f.height>0||u&&f&&s(f)){t===null&&(t=new Do(i));const p=c?t.fromEquirectangular(a):t.fromCubemap(a);return e.set(a,p),a.addEventListener("dispose",r),p.texture}else return null}}}return a}function s(a){let l=0;const c=6;for(let u=0;u<c;u++)a[u]!==void 0&&l++;return l===c}function r(a){const l=a.target;l.removeEventListener("dispose",r);const c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:o}}function Pp(i){const e={};function t(n){if(e[n]!==void 0)return e[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(n){n.isWebGL2?(t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance")):(t("WEBGL_depth_texture"),t("OES_texture_float"),t("OES_texture_half_float"),t("OES_texture_half_float_linear"),t("OES_standard_derivatives"),t("OES_element_index_uint"),t("OES_vertex_array_object"),t("ANGLE_instanced_arrays")),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture")},get:function(n){const s=t(n);return s===null&&console.warn("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function Dp(i,e,t,n){const s={},r=new WeakMap;function o(f){const p=f.target;p.index!==null&&e.remove(p.index);for(const g in p.attributes)e.remove(p.attributes[g]);for(const g in p.morphAttributes){const _=p.morphAttributes[g];for(let h=0,d=_.length;h<d;h++)e.remove(_[h])}p.removeEventListener("dispose",o),delete s[p.id];const m=r.get(p);m&&(e.remove(m),r.delete(p)),n.releaseStatesOfGeometry(p),p.isInstancedBufferGeometry===!0&&delete p._maxInstanceCount,t.memory.geometries--}function a(f,p){return s[p.id]===!0||(p.addEventListener("dispose",o),s[p.id]=!0,t.memory.geometries++),p}function l(f){const p=f.attributes;for(const g in p)e.update(p[g],i.ARRAY_BUFFER);const m=f.morphAttributes;for(const g in m){const _=m[g];for(let h=0,d=_.length;h<d;h++)e.update(_[h],i.ARRAY_BUFFER)}}function c(f){const p=[],m=f.index,g=f.attributes.position;let _=0;if(m!==null){const x=m.array;_=m.version;for(let v=0,T=x.length;v<T;v+=3){const D=x[v+0],A=x[v+1],w=x[v+2];p.push(D,A,A,w,w,D)}}else if(g!==void 0){const x=g.array;_=g.version;for(let v=0,T=x.length/3-1;v<T;v+=3){const D=v+0,A=v+1,w=v+2;p.push(D,A,A,w,w,D)}}else return;const h=new(Xl(p)?Zl:Kl)(p,1);h.version=_;const d=r.get(f);d&&e.remove(d),r.set(f,h)}function u(f){const p=r.get(f);if(p){const m=f.index;m!==null&&p.version<m.version&&c(f)}else c(f);return r.get(f)}return{get:a,update:l,getWireframeAttribute:u}}function Up(i,e,t,n){const s=n.isWebGL2;let r;function o(m){r=m}let a,l;function c(m){a=m.type,l=m.bytesPerElement}function u(m,g){i.drawElements(r,g,a,m*l),t.update(g,r,1)}function f(m,g,_){if(_===0)return;let h,d;if(s)h=i,d="drawElementsInstanced";else if(h=e.get("ANGLE_instanced_arrays"),d="drawElementsInstancedANGLE",h===null){console.error("THREE.WebGLIndexedBufferRenderer: using THREE.InstancedBufferGeometry but hardware does not support extension ANGLE_instanced_arrays.");return}h[d](r,g,a,m*l,_),t.update(g,r,_)}function p(m,g,_){if(_===0)return;const h=e.get("WEBGL_multi_draw");if(h===null)for(let d=0;d<_;d++)this.render(m[d]/l,g[d]);else{h.multiDrawElementsWEBGL(r,g,0,a,m,0,_);let d=0;for(let x=0;x<_;x++)d+=g[x];t.update(d,r,1)}}this.setMode=o,this.setIndex=c,this.render=u,this.renderInstances=f,this.renderMultiDraw=p}function Ip(i){const e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(t.calls++,o){case i.TRIANGLES:t.triangles+=a*(r/3);break;case i.LINES:t.lines+=a*(r/2);break;case i.LINE_STRIP:t.lines+=a*(r-1);break;case i.LINE_LOOP:t.lines+=a*r;break;case i.POINTS:t.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function Np(i,e){return i[0]-e[0]}function Fp(i,e){return Math.abs(e[1])-Math.abs(i[1])}function Op(i,e,t){const n={},s=new Float32Array(8),r=new WeakMap,o=new xt,a=[];for(let c=0;c<8;c++)a[c]=[c,0];function l(c,u,f){const p=c.morphTargetInfluences;if(e.isWebGL2===!0){const m=u.morphAttributes.position||u.morphAttributes.normal||u.morphAttributes.color,g=m!==void 0?m.length:0;let _=r.get(u);if(_===void 0||_.count!==g){let L=function(){B.dispose(),r.delete(u),u.removeEventListener("dispose",L)};_!==void 0&&_.texture.dispose();const x=u.morphAttributes.position!==void 0,v=u.morphAttributes.normal!==void 0,T=u.morphAttributes.color!==void 0,D=u.morphAttributes.position||[],A=u.morphAttributes.normal||[],w=u.morphAttributes.color||[];let I=0;x===!0&&(I=1),v===!0&&(I=2),T===!0&&(I=3);let M=u.attributes.position.count*I,y=1;M>e.maxTextureSize&&(y=Math.ceil(M/e.maxTextureSize),M=e.maxTextureSize);const U=new Float32Array(M*y*4*g),B=new Yl(U,M,y,g);B.type=Un,B.needsUpdate=!0;const Y=I*4;for(let O=0;O<g;O++){const W=D[O],j=A[O],q=w[O],$=M*y*4*O;for(let Q=0;Q<W.count;Q++){const re=Q*Y;x===!0&&(o.fromBufferAttribute(W,Q),U[$+re+0]=o.x,U[$+re+1]=o.y,U[$+re+2]=o.z,U[$+re+3]=0),v===!0&&(o.fromBufferAttribute(j,Q),U[$+re+4]=o.x,U[$+re+5]=o.y,U[$+re+6]=o.z,U[$+re+7]=0),T===!0&&(o.fromBufferAttribute(q,Q),U[$+re+8]=o.x,U[$+re+9]=o.y,U[$+re+10]=o.z,U[$+re+11]=q.itemSize===4?o.w:1)}}_={count:g,texture:B,size:new Ae(M,y)},r.set(u,_),u.addEventListener("dispose",L)}let h=0;for(let x=0;x<p.length;x++)h+=p[x];const d=u.morphTargetsRelative?1:1-h;f.getUniforms().setValue(i,"morphTargetBaseInfluence",d),f.getUniforms().setValue(i,"morphTargetInfluences",p),f.getUniforms().setValue(i,"morphTargetsTexture",_.texture,t),f.getUniforms().setValue(i,"morphTargetsTextureSize",_.size)}else{const m=p===void 0?0:p.length;let g=n[u.id];if(g===void 0||g.length!==m){g=[];for(let v=0;v<m;v++)g[v]=[v,0];n[u.id]=g}for(let v=0;v<m;v++){const T=g[v];T[0]=v,T[1]=p[v]}g.sort(Fp);for(let v=0;v<8;v++)v<m&&g[v][1]?(a[v][0]=g[v][0],a[v][1]=g[v][1]):(a[v][0]=Number.MAX_SAFE_INTEGER,a[v][1]=0);a.sort(Np);const _=u.morphAttributes.position,h=u.morphAttributes.normal;let d=0;for(let v=0;v<8;v++){const T=a[v],D=T[0],A=T[1];D!==Number.MAX_SAFE_INTEGER&&A?(_&&u.getAttribute("morphTarget"+v)!==_[D]&&u.setAttribute("morphTarget"+v,_[D]),h&&u.getAttribute("morphNormal"+v)!==h[D]&&u.setAttribute("morphNormal"+v,h[D]),s[v]=A,d+=A):(_&&u.hasAttribute("morphTarget"+v)===!0&&u.deleteAttribute("morphTarget"+v),h&&u.hasAttribute("morphNormal"+v)===!0&&u.deleteAttribute("morphNormal"+v),s[v]=0)}const x=u.morphTargetsRelative?1:1-d;f.getUniforms().setValue(i,"morphTargetBaseInfluence",x),f.getUniforms().setValue(i,"morphTargetInfluences",s)}}return{update:l}}function Bp(i,e,t,n){let s=new WeakMap;function r(l){const c=n.render.frame,u=l.geometry,f=e.get(l,u);if(s.get(f)!==c&&(e.update(f),s.set(f,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",a)===!1&&l.addEventListener("dispose",a),s.get(l)!==c&&(t.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,i.ARRAY_BUFFER),s.set(l,c))),l.isSkinnedMesh){const p=l.skeleton;s.get(p)!==c&&(p.update(),s.set(p,c))}return f}function o(){s=new WeakMap}function a(l){const c=l.target;c.removeEventListener("dispose",a),t.remove(c.instanceMatrix),c.instanceColor!==null&&t.remove(c.instanceColor)}return{update:r,dispose:o}}class ic extends Ht{constructor(e,t,n,s,r,o,a,l,c,u){if(u=u!==void 0?u:jn,u!==jn&&u!==wi)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&u===jn&&(n=Dn),n===void 0&&u===wi&&(n=Yn),super(null,s,r,o,a,l,u,n,c),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=a!==void 0?a:Dt,this.minFilter=l!==void 0?l:Dt,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){const t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}}const sc=new Ht,rc=new ic(1,1);rc.compareFunction=Wl;const ac=new Yl,oc=new yd,lc=new tc,Fo=[],Oo=[],Bo=new Float32Array(16),zo=new Float32Array(9),Go=new Float32Array(4);function Li(i,e,t){const n=i[0];if(n<=0||n>0)return i;const s=e*t;let r=Fo[s];if(r===void 0&&(r=new Float32Array(s),Fo[s]=r),e!==0){n.toArray(r,0);for(let o=1,a=0;o!==e;++o)a+=t,i[o].toArray(r,a)}return r}function ft(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function pt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function Vs(i,e){let t=Oo[e];t===void 0&&(t=new Int32Array(e),Oo[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function zp(i,e){const t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function Gp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ft(t,e))return;i.uniform2fv(this.addr,e),pt(t,e)}}function kp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(ft(t,e))return;i.uniform3fv(this.addr,e),pt(t,e)}}function Hp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ft(t,e))return;i.uniform4fv(this.addr,e),pt(t,e)}}function Vp(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(ft(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),pt(t,e)}else{if(ft(t,n))return;Go.set(n),i.uniformMatrix2fv(this.addr,!1,Go),pt(t,n)}}function Wp(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(ft(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),pt(t,e)}else{if(ft(t,n))return;zo.set(n),i.uniformMatrix3fv(this.addr,!1,zo),pt(t,n)}}function Xp(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(ft(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),pt(t,e)}else{if(ft(t,n))return;Bo.set(n),i.uniformMatrix4fv(this.addr,!1,Bo),pt(t,n)}}function $p(i,e){const t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function qp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ft(t,e))return;i.uniform2iv(this.addr,e),pt(t,e)}}function Yp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(ft(t,e))return;i.uniform3iv(this.addr,e),pt(t,e)}}function jp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ft(t,e))return;i.uniform4iv(this.addr,e),pt(t,e)}}function Kp(i,e){const t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function Zp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ft(t,e))return;i.uniform2uiv(this.addr,e),pt(t,e)}}function Jp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(ft(t,e))return;i.uniform3uiv(this.addr,e),pt(t,e)}}function Qp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ft(t,e))return;i.uniform4uiv(this.addr,e),pt(t,e)}}function em(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);const r=this.type===i.SAMPLER_2D_SHADOW?rc:sc;t.setTexture2D(e||r,s)}function tm(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||oc,s)}function nm(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||lc,s)}function im(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||ac,s)}function sm(i){switch(i){case 5126:return zp;case 35664:return Gp;case 35665:return kp;case 35666:return Hp;case 35674:return Vp;case 35675:return Wp;case 35676:return Xp;case 5124:case 35670:return $p;case 35667:case 35671:return qp;case 35668:case 35672:return Yp;case 35669:case 35673:return jp;case 5125:return Kp;case 36294:return Zp;case 36295:return Jp;case 36296:return Qp;case 35678:case 36198:case 36298:case 36306:case 35682:return em;case 35679:case 36299:case 36307:return tm;case 35680:case 36300:case 36308:case 36293:return nm;case 36289:case 36303:case 36311:case 36292:return im}}function rm(i,e){i.uniform1fv(this.addr,e)}function am(i,e){const t=Li(e,this.size,2);i.uniform2fv(this.addr,t)}function om(i,e){const t=Li(e,this.size,3);i.uniform3fv(this.addr,t)}function lm(i,e){const t=Li(e,this.size,4);i.uniform4fv(this.addr,t)}function cm(i,e){const t=Li(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function um(i,e){const t=Li(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function dm(i,e){const t=Li(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function hm(i,e){i.uniform1iv(this.addr,e)}function fm(i,e){i.uniform2iv(this.addr,e)}function pm(i,e){i.uniform3iv(this.addr,e)}function mm(i,e){i.uniform4iv(this.addr,e)}function gm(i,e){i.uniform1uiv(this.addr,e)}function _m(i,e){i.uniform2uiv(this.addr,e)}function vm(i,e){i.uniform3uiv(this.addr,e)}function xm(i,e){i.uniform4uiv(this.addr,e)}function Mm(i,e,t){const n=this.cache,s=e.length,r=Vs(t,s);ft(n,r)||(i.uniform1iv(this.addr,r),pt(n,r));for(let o=0;o!==s;++o)t.setTexture2D(e[o]||sc,r[o])}function Sm(i,e,t){const n=this.cache,s=e.length,r=Vs(t,s);ft(n,r)||(i.uniform1iv(this.addr,r),pt(n,r));for(let o=0;o!==s;++o)t.setTexture3D(e[o]||oc,r[o])}function ym(i,e,t){const n=this.cache,s=e.length,r=Vs(t,s);ft(n,r)||(i.uniform1iv(this.addr,r),pt(n,r));for(let o=0;o!==s;++o)t.setTextureCube(e[o]||lc,r[o])}function Em(i,e,t){const n=this.cache,s=e.length,r=Vs(t,s);ft(n,r)||(i.uniform1iv(this.addr,r),pt(n,r));for(let o=0;o!==s;++o)t.setTexture2DArray(e[o]||ac,r[o])}function bm(i){switch(i){case 5126:return rm;case 35664:return am;case 35665:return om;case 35666:return lm;case 35674:return cm;case 35675:return um;case 35676:return dm;case 5124:case 35670:return hm;case 35667:case 35671:return fm;case 35668:case 35672:return pm;case 35669:case 35673:return mm;case 5125:return gm;case 36294:return _m;case 36295:return vm;case 36296:return xm;case 35678:case 36198:case 36298:case 36306:case 35682:return Mm;case 35679:case 36299:case 36307:return Sm;case 35680:case 36300:case 36308:case 36293:return ym;case 36289:case 36303:case 36311:case 36292:return Em}}class Tm{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=sm(t.type)}}class Am{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=bm(t.type)}}class wm{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){const s=this.seq;for(let r=0,o=s.length;r!==o;++r){const a=s[r];a.setValue(e,t[a.id],n)}}}const wr=/(\w+)(\])?(\[|\.)?/g;function ko(i,e){i.seq.push(e),i.map[e.id]=e}function Rm(i,e,t){const n=i.name,s=n.length;for(wr.lastIndex=0;;){const r=wr.exec(n),o=wr.lastIndex;let a=r[1];const l=r[2]==="]",c=r[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===s){ko(t,c===void 0?new Tm(a,i,e):new Am(a,i,e));break}else{let f=t.map[a];f===void 0&&(f=new wm(a),ko(t,f)),t=f}}}class Cs{constructor(e,t){this.seq=[],this.map={};const n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){const r=e.getActiveUniform(t,s),o=e.getUniformLocation(t,r.name);Rm(r,o,this)}}setValue(e,t,n,s){const r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){const s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,o=t.length;r!==o;++r){const a=t[r],l=n[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,s)}}static seqWithValue(e,t){const n=[];for(let s=0,r=e.length;s!==r;++s){const o=e[s];o.id in t&&n.push(o)}return n}}function Ho(i,e,t){const n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}const Cm=37297;let Lm=0;function Pm(i,e){const t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let o=s;o<r;o++){const a=o+1;n.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return n.join(`
`)}function Dm(i){const e=nt.getPrimaries(nt.workingColorSpace),t=nt.getPrimaries(i);let n;switch(e===t?n="":e===Us&&t===Ds?n="LinearDisplayP3ToLinearSRGB":e===Ds&&t===Us&&(n="LinearSRGBToLinearDisplayP3"),i){case yn:case zs:return[n,"LinearTransferOETF"];case St:case aa:return[n,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space:",i),[n,"LinearTransferOETF"]}}function Vo(i,e,t){const n=i.getShaderParameter(e,i.COMPILE_STATUS),s=i.getShaderInfoLog(e).trim();if(n&&s==="")return"";const r=/ERROR: 0:(\d+)/.exec(s);if(r){const o=parseInt(r[1]);return t.toUpperCase()+`

`+s+`

`+Pm(i.getShaderSource(e),o)}else return s}function Um(i,e){const t=Dm(e);return`vec4 ${i}( vec4 value ) { return ${t[0]}( ${t[1]}( value ) ); }`}function Im(i,e){let t;switch(e){case Xu:t="Linear";break;case $u:t="Reinhard";break;case qu:t="OptimizedCineon";break;case Ul:t="ACESFilmic";break;case ju:t="AgX";break;case Yu:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}function Nm(i){return[i.extensionDerivatives||i.envMapCubeUVHeight||i.bumpMap||i.normalMapTangentSpace||i.clearcoatNormalMap||i.flatShading||i.shaderID==="physical"?"#extension GL_OES_standard_derivatives : enable":"",(i.extensionFragDepth||i.logarithmicDepthBuffer)&&i.rendererExtensionFragDepth?"#extension GL_EXT_frag_depth : enable":"",i.extensionDrawBuffers&&i.rendererExtensionDrawBuffers?"#extension GL_EXT_draw_buffers : require":"",(i.extensionShaderTextureLOD||i.envMap||i.transmission)&&i.rendererExtensionShaderTextureLod?"#extension GL_EXT_shader_texture_lod : enable":""].filter(xi).join(`
`)}function Fm(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":""].filter(xi).join(`
`)}function Om(i){const e=[];for(const t in i){const n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function Bm(i,e){const t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){const r=i.getActiveAttrib(e,s),o=r.name;let a=1;r.type===i.FLOAT_MAT2&&(a=2),r.type===i.FLOAT_MAT3&&(a=3),r.type===i.FLOAT_MAT4&&(a=4),t[o]={type:r.type,location:i.getAttribLocation(e,o),locationSize:a}}return t}function xi(i){return i!==""}function Wo(i,e){const t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function Xo(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const zm=/^[ \t]*#include +<([\w\d./]+)>/gm;function Wr(i){return i.replace(zm,km)}const Gm=new Map([["encodings_fragment","colorspace_fragment"],["encodings_pars_fragment","colorspace_pars_fragment"],["output_fragment","opaque_fragment"]]);function km(i,e){let t=Ge[e];if(t===void 0){const n=Gm.get(e);if(n!==void 0)t=Ge[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return Wr(t)}const Hm=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function $o(i){return i.replace(Hm,Vm)}function Vm(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function qo(i){let e="precision "+i.precision+` float;
precision `+i.precision+" int;";return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function Wm(i){let e="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===Ll?e="SHADOWMAP_TYPE_PCF":i.shadowMapType===Pl?e="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===_n&&(e="SHADOWMAP_TYPE_VSM"),e}function Xm(i){let e="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case bi:case Ti:e="ENVMAP_TYPE_CUBE";break;case Bs:e="ENVMAP_TYPE_CUBE_UV";break}return e}function $m(i){let e="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case Ti:e="ENVMAP_MODE_REFRACTION";break}return e}function qm(i){let e="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case Dl:e="ENVMAP_BLENDING_MULTIPLY";break;case Vu:e="ENVMAP_BLENDING_MIX";break;case Wu:e="ENVMAP_BLENDING_ADD";break}return e}function Ym(i){const e=i.envMapCubeUVHeight;if(e===null)return null;const t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:n,maxMip:t}}function jm(i,e,t,n){const s=i.getContext(),r=t.defines;let o=t.vertexShader,a=t.fragmentShader;const l=Wm(t),c=Xm(t),u=$m(t),f=qm(t),p=Ym(t),m=t.isWebGL2?"":Nm(t),g=Fm(t),_=Om(r),h=s.createProgram();let d,x,v=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(d=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_].filter(xi).join(`
`),d.length>0&&(d+=`
`),x=[m,"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_].filter(xi).join(`
`),x.length>0&&(x+=`
`)):(d=[qo(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+u:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors&&t.isWebGL2?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_TEXTURE":"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.useLegacyLights?"#define LEGACY_LIGHTS":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.logarithmicDepthBuffer&&t.rendererExtensionFragDepth?"#define USE_LOGDEPTHBUF_EXT":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#if ( defined( USE_MORPHTARGETS ) && ! defined( MORPHTARGETS_TEXTURE ) )","	attribute vec3 morphTarget0;","	attribute vec3 morphTarget1;","	attribute vec3 morphTarget2;","	attribute vec3 morphTarget3;","	#ifdef USE_MORPHNORMALS","		attribute vec3 morphNormal0;","		attribute vec3 morphNormal1;","		attribute vec3 morphNormal2;","		attribute vec3 morphNormal3;","	#else","		attribute vec3 morphTarget4;","		attribute vec3 morphTarget5;","		attribute vec3 morphTarget6;","		attribute vec3 morphTarget7;","	#endif","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(xi).join(`
`),x=[m,qo(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+u:"",t.envMap?"#define "+f:"",p?"#define CUBEUV_TEXEL_WIDTH "+p.texelWidth:"",p?"#define CUBEUV_TEXEL_HEIGHT "+p.texelHeight:"",p?"#define CUBEUV_MAX_MIP "+p.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.useLegacyLights?"#define LEGACY_LIGHTS":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.logarithmicDepthBuffer&&t.rendererExtensionFragDepth?"#define USE_LOGDEPTHBUF_EXT":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==In?"#define TONE_MAPPING":"",t.toneMapping!==In?Ge.tonemapping_pars_fragment:"",t.toneMapping!==In?Im("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",Ge.colorspace_pars_fragment,Um("linearToOutputTexel",t.outputColorSpace),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(xi).join(`
`)),o=Wr(o),o=Wo(o,t),o=Xo(o,t),a=Wr(a),a=Wo(a,t),a=Xo(a,t),o=$o(o),a=$o(a),t.isWebGL2&&t.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,d=[g,"precision mediump sampler2DArray;","#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+d,x=["precision mediump sampler2DArray;","#define varying in",t.glslVersion===uo?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===uo?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+x);const T=v+d+o,D=v+x+a,A=Ho(s,s.VERTEX_SHADER,T),w=Ho(s,s.FRAGMENT_SHADER,D);s.attachShader(h,A),s.attachShader(h,w),t.index0AttributeName!==void 0?s.bindAttribLocation(h,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(h,0,"position"),s.linkProgram(h);function I(B){if(i.debug.checkShaderErrors){const Y=s.getProgramInfoLog(h).trim(),L=s.getShaderInfoLog(A).trim(),O=s.getShaderInfoLog(w).trim();let W=!0,j=!0;if(s.getProgramParameter(h,s.LINK_STATUS)===!1)if(W=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,h,A,w);else{const q=Vo(s,A,"vertex"),$=Vo(s,w,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(h,s.VALIDATE_STATUS)+`

Program Info Log: `+Y+`
`+q+`
`+$)}else Y!==""?console.warn("THREE.WebGLProgram: Program Info Log:",Y):(L===""||O==="")&&(j=!1);j&&(B.diagnostics={runnable:W,programLog:Y,vertexShader:{log:L,prefix:d},fragmentShader:{log:O,prefix:x}})}s.deleteShader(A),s.deleteShader(w),M=new Cs(s,h),y=Bm(s,h)}let M;this.getUniforms=function(){return M===void 0&&I(this),M};let y;this.getAttributes=function(){return y===void 0&&I(this),y};let U=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return U===!1&&(U=s.getProgramParameter(h,Cm)),U},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(h),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=Lm++,this.cacheKey=e,this.usedTimes=1,this.program=h,this.vertexShader=A,this.fragmentShader=w,this}let Km=0;class Zm{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(e);return o.has(s)===!1&&(o.add(s),s.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(e){const t=this.materialCache.get(e);for(const n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const t=this.materialCache;let n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){const t=this.shaderCache;let n=t.get(e);return n===void 0&&(n=new Jm(e),t.set(e,n)),n}}class Jm{constructor(e){this.id=Km++,this.code=e,this.usedTimes=0}}function Qm(i,e,t,n,s,r,o){const a=new ca,l=new Zm,c=[],u=s.isWebGL2,f=s.logarithmicDepthBuffer,p=s.vertexTextures;let m=s.precision;const g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(M){return M===0?"uv":`uv${M}`}function h(M,y,U,B,Y){const L=B.fog,O=Y.geometry,W=M.isMeshStandardMaterial?B.environment:null,j=(M.isMeshStandardMaterial?t:e).get(M.envMap||W),q=j&&j.mapping===Bs?j.image.height:null,$=g[M.type];M.precision!==null&&(m=s.getMaxPrecision(M.precision),m!==M.precision&&console.warn("THREE.WebGLProgram.getParameters:",M.precision,"not supported, using",m,"instead."));const Q=O.morphAttributes.position||O.morphAttributes.normal||O.morphAttributes.color,re=Q!==void 0?Q.length:0;let pe=0;O.morphAttributes.position!==void 0&&(pe=1),O.morphAttributes.normal!==void 0&&(pe=2),O.morphAttributes.color!==void 0&&(pe=3);let X,ee,fe,ye;if($){const Ct=ln[$];X=Ct.vertexShader,ee=Ct.fragmentShader}else X=M.vertexShader,ee=M.fragmentShader,l.update(M),fe=l.getVertexShaderID(M),ye=l.getFragmentShaderID(M);const Me=i.getRenderTarget(),Ie=Y.isInstancedMesh===!0,Ne=Y.isBatchedMesh===!0,Re=!!M.map,qe=!!M.matcap,z=!!j,mt=!!M.aoMap,Te=!!M.lightMap,De=!!M.bumpMap,ve=!!M.normalMap,st=!!M.displacementMap,Fe=!!M.emissiveMap,b=!!M.metalnessMap,S=!!M.roughnessMap,G=M.anisotropy>0,se=M.clearcoat>0,ne=M.iridescence>0,ie=M.sheen>0,xe=M.transmission>0,he=G&&!!M.anisotropyMap,_e=se&&!!M.clearcoatMap,Ce=se&&!!M.clearcoatNormalMap,Be=se&&!!M.clearcoatRoughnessMap,te=ne&&!!M.iridescenceMap,Ye=ne&&!!M.iridescenceThicknessMap,C=ie&&!!M.sheenColorMap,J=ie&&!!M.sheenRoughnessMap,ue=!!M.specularMap,ae=!!M.specularColorMap,Se=!!M.specularIntensityMap,Ve=xe&&!!M.transmissionMap,je=xe&&!!M.thicknessMap,ke=!!M.gradientMap,ce=!!M.alphaMap,P=M.alphaTest>0,oe=!!M.alphaHash,le=!!M.extensions,we=!!O.attributes.uv1,Ee=!!O.attributes.uv2,Ze=!!O.attributes.uv3;let Qe=In;return M.toneMapped&&(Me===null||Me.isXRRenderTarget===!0)&&(Qe=i.toneMapping),{isWebGL2:u,shaderID:$,shaderType:M.type,shaderName:M.name,vertexShader:X,fragmentShader:ee,defines:M.defines,customVertexShaderID:fe,customFragmentShaderID:ye,isRawShaderMaterial:M.isRawShaderMaterial===!0,glslVersion:M.glslVersion,precision:m,batching:Ne,instancing:Ie,instancingColor:Ie&&Y.instanceColor!==null,supportsVertexTextures:p,outputColorSpace:Me===null?i.outputColorSpace:Me.isXRRenderTarget===!0?Me.texture.colorSpace:yn,map:Re,matcap:qe,envMap:z,envMapMode:z&&j.mapping,envMapCubeUVHeight:q,aoMap:mt,lightMap:Te,bumpMap:De,normalMap:ve,displacementMap:p&&st,emissiveMap:Fe,normalMapObjectSpace:ve&&M.normalMapType===od,normalMapTangentSpace:ve&&M.normalMapType===Vl,metalnessMap:b,roughnessMap:S,anisotropy:G,anisotropyMap:he,clearcoat:se,clearcoatMap:_e,clearcoatNormalMap:Ce,clearcoatRoughnessMap:Be,iridescence:ne,iridescenceMap:te,iridescenceThicknessMap:Ye,sheen:ie,sheenColorMap:C,sheenRoughnessMap:J,specularMap:ue,specularColorMap:ae,specularIntensityMap:Se,transmission:xe,transmissionMap:Ve,thicknessMap:je,gradientMap:ke,opaque:M.transparent===!1&&M.blending===Si,alphaMap:ce,alphaTest:P,alphaHash:oe,combine:M.combine,mapUv:Re&&_(M.map.channel),aoMapUv:mt&&_(M.aoMap.channel),lightMapUv:Te&&_(M.lightMap.channel),bumpMapUv:De&&_(M.bumpMap.channel),normalMapUv:ve&&_(M.normalMap.channel),displacementMapUv:st&&_(M.displacementMap.channel),emissiveMapUv:Fe&&_(M.emissiveMap.channel),metalnessMapUv:b&&_(M.metalnessMap.channel),roughnessMapUv:S&&_(M.roughnessMap.channel),anisotropyMapUv:he&&_(M.anisotropyMap.channel),clearcoatMapUv:_e&&_(M.clearcoatMap.channel),clearcoatNormalMapUv:Ce&&_(M.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Be&&_(M.clearcoatRoughnessMap.channel),iridescenceMapUv:te&&_(M.iridescenceMap.channel),iridescenceThicknessMapUv:Ye&&_(M.iridescenceThicknessMap.channel),sheenColorMapUv:C&&_(M.sheenColorMap.channel),sheenRoughnessMapUv:J&&_(M.sheenRoughnessMap.channel),specularMapUv:ue&&_(M.specularMap.channel),specularColorMapUv:ae&&_(M.specularColorMap.channel),specularIntensityMapUv:Se&&_(M.specularIntensityMap.channel),transmissionMapUv:Ve&&_(M.transmissionMap.channel),thicknessMapUv:je&&_(M.thicknessMap.channel),alphaMapUv:ce&&_(M.alphaMap.channel),vertexTangents:!!O.attributes.tangent&&(ve||G),vertexColors:M.vertexColors,vertexAlphas:M.vertexColors===!0&&!!O.attributes.color&&O.attributes.color.itemSize===4,vertexUv1s:we,vertexUv2s:Ee,vertexUv3s:Ze,pointsUvs:Y.isPoints===!0&&!!O.attributes.uv&&(Re||ce),fog:!!L,useFog:M.fog===!0,fogExp2:L&&L.isFogExp2,flatShading:M.flatShading===!0,sizeAttenuation:M.sizeAttenuation===!0,logarithmicDepthBuffer:f,skinning:Y.isSkinnedMesh===!0,morphTargets:O.morphAttributes.position!==void 0,morphNormals:O.morphAttributes.normal!==void 0,morphColors:O.morphAttributes.color!==void 0,morphTargetsCount:re,morphTextureStride:pe,numDirLights:y.directional.length,numPointLights:y.point.length,numSpotLights:y.spot.length,numSpotLightMaps:y.spotLightMap.length,numRectAreaLights:y.rectArea.length,numHemiLights:y.hemi.length,numDirLightShadows:y.directionalShadowMap.length,numPointLightShadows:y.pointShadowMap.length,numSpotLightShadows:y.spotShadowMap.length,numSpotLightShadowsWithMaps:y.numSpotLightShadowsWithMaps,numLightProbes:y.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:M.dithering,shadowMapEnabled:i.shadowMap.enabled&&U.length>0,shadowMapType:i.shadowMap.type,toneMapping:Qe,useLegacyLights:i._useLegacyLights,decodeVideoTexture:Re&&M.map.isVideoTexture===!0&&nt.getTransfer(M.map.colorSpace)===rt,premultipliedAlpha:M.premultipliedAlpha,doubleSided:M.side===vn,flipSided:M.side===Bt,useDepthPacking:M.depthPacking>=0,depthPacking:M.depthPacking||0,index0AttributeName:M.index0AttributeName,extensionDerivatives:le&&M.extensions.derivatives===!0,extensionFragDepth:le&&M.extensions.fragDepth===!0,extensionDrawBuffers:le&&M.extensions.drawBuffers===!0,extensionShaderTextureLOD:le&&M.extensions.shaderTextureLOD===!0,extensionClipCullDistance:le&&M.extensions.clipCullDistance&&n.has("WEBGL_clip_cull_distance"),rendererExtensionFragDepth:u||n.has("EXT_frag_depth"),rendererExtensionDrawBuffers:u||n.has("WEBGL_draw_buffers"),rendererExtensionShaderTextureLod:u||n.has("EXT_shader_texture_lod"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:M.customProgramCacheKey()}}function d(M){const y=[];if(M.shaderID?y.push(M.shaderID):(y.push(M.customVertexShaderID),y.push(M.customFragmentShaderID)),M.defines!==void 0)for(const U in M.defines)y.push(U),y.push(M.defines[U]);return M.isRawShaderMaterial===!1&&(x(y,M),v(y,M),y.push(i.outputColorSpace)),y.push(M.customProgramCacheKey),y.join()}function x(M,y){M.push(y.precision),M.push(y.outputColorSpace),M.push(y.envMapMode),M.push(y.envMapCubeUVHeight),M.push(y.mapUv),M.push(y.alphaMapUv),M.push(y.lightMapUv),M.push(y.aoMapUv),M.push(y.bumpMapUv),M.push(y.normalMapUv),M.push(y.displacementMapUv),M.push(y.emissiveMapUv),M.push(y.metalnessMapUv),M.push(y.roughnessMapUv),M.push(y.anisotropyMapUv),M.push(y.clearcoatMapUv),M.push(y.clearcoatNormalMapUv),M.push(y.clearcoatRoughnessMapUv),M.push(y.iridescenceMapUv),M.push(y.iridescenceThicknessMapUv),M.push(y.sheenColorMapUv),M.push(y.sheenRoughnessMapUv),M.push(y.specularMapUv),M.push(y.specularColorMapUv),M.push(y.specularIntensityMapUv),M.push(y.transmissionMapUv),M.push(y.thicknessMapUv),M.push(y.combine),M.push(y.fogExp2),M.push(y.sizeAttenuation),M.push(y.morphTargetsCount),M.push(y.morphAttributeCount),M.push(y.numDirLights),M.push(y.numPointLights),M.push(y.numSpotLights),M.push(y.numSpotLightMaps),M.push(y.numHemiLights),M.push(y.numRectAreaLights),M.push(y.numDirLightShadows),M.push(y.numPointLightShadows),M.push(y.numSpotLightShadows),M.push(y.numSpotLightShadowsWithMaps),M.push(y.numLightProbes),M.push(y.shadowMapType),M.push(y.toneMapping),M.push(y.numClippingPlanes),M.push(y.numClipIntersection),M.push(y.depthPacking)}function v(M,y){a.disableAll(),y.isWebGL2&&a.enable(0),y.supportsVertexTextures&&a.enable(1),y.instancing&&a.enable(2),y.instancingColor&&a.enable(3),y.matcap&&a.enable(4),y.envMap&&a.enable(5),y.normalMapObjectSpace&&a.enable(6),y.normalMapTangentSpace&&a.enable(7),y.clearcoat&&a.enable(8),y.iridescence&&a.enable(9),y.alphaTest&&a.enable(10),y.vertexColors&&a.enable(11),y.vertexAlphas&&a.enable(12),y.vertexUv1s&&a.enable(13),y.vertexUv2s&&a.enable(14),y.vertexUv3s&&a.enable(15),y.vertexTangents&&a.enable(16),y.anisotropy&&a.enable(17),y.alphaHash&&a.enable(18),y.batching&&a.enable(19),M.push(a.mask),a.disableAll(),y.fog&&a.enable(0),y.useFog&&a.enable(1),y.flatShading&&a.enable(2),y.logarithmicDepthBuffer&&a.enable(3),y.skinning&&a.enable(4),y.morphTargets&&a.enable(5),y.morphNormals&&a.enable(6),y.morphColors&&a.enable(7),y.premultipliedAlpha&&a.enable(8),y.shadowMapEnabled&&a.enable(9),y.useLegacyLights&&a.enable(10),y.doubleSided&&a.enable(11),y.flipSided&&a.enable(12),y.useDepthPacking&&a.enable(13),y.dithering&&a.enable(14),y.transmission&&a.enable(15),y.sheen&&a.enable(16),y.opaque&&a.enable(17),y.pointsUvs&&a.enable(18),y.decodeVideoTexture&&a.enable(19),M.push(a.mask)}function T(M){const y=g[M.type];let U;if(y){const B=ln[y];U=Ql.clone(B.uniforms)}else U=M.uniforms;return U}function D(M,y){let U;for(let B=0,Y=c.length;B<Y;B++){const L=c[B];if(L.cacheKey===y){U=L,++U.usedTimes;break}}return U===void 0&&(U=new jm(i,y,M,r),c.push(U)),U}function A(M){if(--M.usedTimes===0){const y=c.indexOf(M);c[y]=c[c.length-1],c.pop(),M.destroy()}}function w(M){l.remove(M)}function I(){l.dispose()}return{getParameters:h,getProgramCacheKey:d,getUniforms:T,acquireProgram:D,releaseProgram:A,releaseShaderCache:w,programs:c,dispose:I}}function eg(){let i=new WeakMap;function e(r){let o=i.get(r);return o===void 0&&(o={},i.set(r,o)),o}function t(r){i.delete(r)}function n(r,o,a){i.get(r)[o]=a}function s(){i=new WeakMap}return{get:e,remove:t,update:n,dispose:s}}function tg(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.z!==e.z?i.z-e.z:i.id-e.id}function Yo(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function jo(){const i=[];let e=0;const t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function o(f,p,m,g,_,h){let d=i[e];return d===void 0?(d={id:f.id,object:f,geometry:p,material:m,groupOrder:g,renderOrder:f.renderOrder,z:_,group:h},i[e]=d):(d.id=f.id,d.object=f,d.geometry=p,d.material=m,d.groupOrder=g,d.renderOrder=f.renderOrder,d.z=_,d.group=h),e++,d}function a(f,p,m,g,_,h){const d=o(f,p,m,g,_,h);m.transmission>0?n.push(d):m.transparent===!0?s.push(d):t.push(d)}function l(f,p,m,g,_,h){const d=o(f,p,m,g,_,h);m.transmission>0?n.unshift(d):m.transparent===!0?s.unshift(d):t.unshift(d)}function c(f,p){t.length>1&&t.sort(f||tg),n.length>1&&n.sort(p||Yo),s.length>1&&s.sort(p||Yo)}function u(){for(let f=e,p=i.length;f<p;f++){const m=i[f];if(m.id===null)break;m.id=null,m.object=null,m.geometry=null,m.material=null,m.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:a,unshift:l,finish:u,sort:c}}function ng(){let i=new WeakMap;function e(n,s){const r=i.get(n);let o;return r===void 0?(o=new jo,i.set(n,[o])):s>=r.length?(o=new jo,r.push(o)):o=r[s],o}function t(){i=new WeakMap}return{get:e,dispose:t}}function ig(){const i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new N,color:new $e};break;case"SpotLight":t={position:new N,direction:new N,color:new $e,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new N,color:new $e,distance:0,decay:0};break;case"HemisphereLight":t={direction:new N,skyColor:new $e,groundColor:new $e};break;case"RectAreaLight":t={color:new $e,position:new N,halfWidth:new N,halfHeight:new N};break}return i[e.id]=t,t}}}function sg(){const i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ae};break;case"SpotLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ae};break;case"PointLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ae,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}let rg=0;function ag(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function og(i,e){const t=new ig,n=sg(),s={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let u=0;u<9;u++)s.probe.push(new N);const r=new N,o=new ht,a=new ht;function l(u,f){let p=0,m=0,g=0;for(let B=0;B<9;B++)s.probe[B].set(0,0,0);let _=0,h=0,d=0,x=0,v=0,T=0,D=0,A=0,w=0,I=0,M=0;u.sort(ag);const y=f===!0?Math.PI:1;for(let B=0,Y=u.length;B<Y;B++){const L=u[B],O=L.color,W=L.intensity,j=L.distance,q=L.shadow&&L.shadow.map?L.shadow.map.texture:null;if(L.isAmbientLight)p+=O.r*W*y,m+=O.g*W*y,g+=O.b*W*y;else if(L.isLightProbe){for(let $=0;$<9;$++)s.probe[$].addScaledVector(L.sh.coefficients[$],W);M++}else if(L.isDirectionalLight){const $=t.get(L);if($.color.copy(L.color).multiplyScalar(L.intensity*y),L.castShadow){const Q=L.shadow,re=n.get(L);re.shadowBias=Q.bias,re.shadowNormalBias=Q.normalBias,re.shadowRadius=Q.radius,re.shadowMapSize=Q.mapSize,s.directionalShadow[_]=re,s.directionalShadowMap[_]=q,s.directionalShadowMatrix[_]=L.shadow.matrix,T++}s.directional[_]=$,_++}else if(L.isSpotLight){const $=t.get(L);$.position.setFromMatrixPosition(L.matrixWorld),$.color.copy(O).multiplyScalar(W*y),$.distance=j,$.coneCos=Math.cos(L.angle),$.penumbraCos=Math.cos(L.angle*(1-L.penumbra)),$.decay=L.decay,s.spot[d]=$;const Q=L.shadow;if(L.map&&(s.spotLightMap[w]=L.map,w++,Q.updateMatrices(L),L.castShadow&&I++),s.spotLightMatrix[d]=Q.matrix,L.castShadow){const re=n.get(L);re.shadowBias=Q.bias,re.shadowNormalBias=Q.normalBias,re.shadowRadius=Q.radius,re.shadowMapSize=Q.mapSize,s.spotShadow[d]=re,s.spotShadowMap[d]=q,A++}d++}else if(L.isRectAreaLight){const $=t.get(L);$.color.copy(O).multiplyScalar(W),$.halfWidth.set(L.width*.5,0,0),$.halfHeight.set(0,L.height*.5,0),s.rectArea[x]=$,x++}else if(L.isPointLight){const $=t.get(L);if($.color.copy(L.color).multiplyScalar(L.intensity*y),$.distance=L.distance,$.decay=L.decay,L.castShadow){const Q=L.shadow,re=n.get(L);re.shadowBias=Q.bias,re.shadowNormalBias=Q.normalBias,re.shadowRadius=Q.radius,re.shadowMapSize=Q.mapSize,re.shadowCameraNear=Q.camera.near,re.shadowCameraFar=Q.camera.far,s.pointShadow[h]=re,s.pointShadowMap[h]=q,s.pointShadowMatrix[h]=L.shadow.matrix,D++}s.point[h]=$,h++}else if(L.isHemisphereLight){const $=t.get(L);$.skyColor.copy(L.color).multiplyScalar(W*y),$.groundColor.copy(L.groundColor).multiplyScalar(W*y),s.hemi[v]=$,v++}}x>0&&(e.isWebGL2?i.has("OES_texture_float_linear")===!0?(s.rectAreaLTC1=de.LTC_FLOAT_1,s.rectAreaLTC2=de.LTC_FLOAT_2):(s.rectAreaLTC1=de.LTC_HALF_1,s.rectAreaLTC2=de.LTC_HALF_2):i.has("OES_texture_float_linear")===!0?(s.rectAreaLTC1=de.LTC_FLOAT_1,s.rectAreaLTC2=de.LTC_FLOAT_2):i.has("OES_texture_half_float_linear")===!0?(s.rectAreaLTC1=de.LTC_HALF_1,s.rectAreaLTC2=de.LTC_HALF_2):console.error("THREE.WebGLRenderer: Unable to use RectAreaLight. Missing WebGL extensions.")),s.ambient[0]=p,s.ambient[1]=m,s.ambient[2]=g;const U=s.hash;(U.directionalLength!==_||U.pointLength!==h||U.spotLength!==d||U.rectAreaLength!==x||U.hemiLength!==v||U.numDirectionalShadows!==T||U.numPointShadows!==D||U.numSpotShadows!==A||U.numSpotMaps!==w||U.numLightProbes!==M)&&(s.directional.length=_,s.spot.length=d,s.rectArea.length=x,s.point.length=h,s.hemi.length=v,s.directionalShadow.length=T,s.directionalShadowMap.length=T,s.pointShadow.length=D,s.pointShadowMap.length=D,s.spotShadow.length=A,s.spotShadowMap.length=A,s.directionalShadowMatrix.length=T,s.pointShadowMatrix.length=D,s.spotLightMatrix.length=A+w-I,s.spotLightMap.length=w,s.numSpotLightShadowsWithMaps=I,s.numLightProbes=M,U.directionalLength=_,U.pointLength=h,U.spotLength=d,U.rectAreaLength=x,U.hemiLength=v,U.numDirectionalShadows=T,U.numPointShadows=D,U.numSpotShadows=A,U.numSpotMaps=w,U.numLightProbes=M,s.version=rg++)}function c(u,f){let p=0,m=0,g=0,_=0,h=0;const d=f.matrixWorldInverse;for(let x=0,v=u.length;x<v;x++){const T=u[x];if(T.isDirectionalLight){const D=s.directional[p];D.direction.setFromMatrixPosition(T.matrixWorld),r.setFromMatrixPosition(T.target.matrixWorld),D.direction.sub(r),D.direction.transformDirection(d),p++}else if(T.isSpotLight){const D=s.spot[g];D.position.setFromMatrixPosition(T.matrixWorld),D.position.applyMatrix4(d),D.direction.setFromMatrixPosition(T.matrixWorld),r.setFromMatrixPosition(T.target.matrixWorld),D.direction.sub(r),D.direction.transformDirection(d),g++}else if(T.isRectAreaLight){const D=s.rectArea[_];D.position.setFromMatrixPosition(T.matrixWorld),D.position.applyMatrix4(d),a.identity(),o.copy(T.matrixWorld),o.premultiply(d),a.extractRotation(o),D.halfWidth.set(T.width*.5,0,0),D.halfHeight.set(0,T.height*.5,0),D.halfWidth.applyMatrix4(a),D.halfHeight.applyMatrix4(a),_++}else if(T.isPointLight){const D=s.point[m];D.position.setFromMatrixPosition(T.matrixWorld),D.position.applyMatrix4(d),m++}else if(T.isHemisphereLight){const D=s.hemi[h];D.direction.setFromMatrixPosition(T.matrixWorld),D.direction.transformDirection(d),h++}}}return{setup:l,setupView:c,state:s}}function Ko(i,e){const t=new og(i,e),n=[],s=[];function r(){n.length=0,s.length=0}function o(f){n.push(f)}function a(f){s.push(f)}function l(f){t.setup(n,f)}function c(f){t.setupView(n,f)}return{init:r,state:{lightsArray:n,shadowsArray:s,lights:t},setupLights:l,setupLightsView:c,pushLight:o,pushShadow:a}}function lg(i,e){let t=new WeakMap;function n(r,o=0){const a=t.get(r);let l;return a===void 0?(l=new Ko(i,e),t.set(r,[l])):o>=a.length?(l=new Ko(i,e),a.push(l)):l=a[o],l}function s(){t=new WeakMap}return{get:n,dispose:s}}class cg extends Yi{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=rd,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class ug extends Yi{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}const dg=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,hg=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function fg(i,e,t){let n=new ua;const s=new Ae,r=new Ae,o=new xt,a=new cg({depthPacking:ad}),l=new ug,c={},u=t.maxTextureSize,f={[Fn]:Bt,[Bt]:Fn,[vn]:vn},p=new En({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ae},radius:{value:4}},vertexShader:dg,fragmentShader:hg}),m=p.clone();m.defines.HORIZONTAL_PASS=1;const g=new Kt;g.setAttribute("position",new un(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const _=new ge(g,p),h=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Ll;let d=this.type;this.render=function(A,w,I){if(h.enabled===!1||h.autoUpdate===!1&&h.needsUpdate===!1||A.length===0)return;const M=i.getRenderTarget(),y=i.getActiveCubeFace(),U=i.getActiveMipmapLevel(),B=i.state;B.setBlending(Sn),B.buffers.color.setClear(1,1,1,1),B.buffers.depth.setTest(!0),B.setScissorTest(!1);const Y=d!==_n&&this.type===_n,L=d===_n&&this.type!==_n;for(let O=0,W=A.length;O<W;O++){const j=A[O],q=j.shadow;if(q===void 0){console.warn("THREE.WebGLShadowMap:",j,"has no shadow.");continue}if(q.autoUpdate===!1&&q.needsUpdate===!1)continue;s.copy(q.mapSize);const $=q.getFrameExtents();if(s.multiply($),r.copy(q.mapSize),(s.x>u||s.y>u)&&(s.x>u&&(r.x=Math.floor(u/$.x),s.x=r.x*$.x,q.mapSize.x=r.x),s.y>u&&(r.y=Math.floor(u/$.y),s.y=r.y*$.y,q.mapSize.y=r.y)),q.map===null||Y===!0||L===!0){const re=this.type!==_n?{minFilter:Dt,magFilter:Dt}:{};q.map!==null&&q.map.dispose(),q.map=new On(s.x,s.y,re),q.map.texture.name=j.name+".shadowMap",q.camera.updateProjectionMatrix()}i.setRenderTarget(q.map),i.clear();const Q=q.getViewportCount();for(let re=0;re<Q;re++){const pe=q.getViewport(re);o.set(r.x*pe.x,r.y*pe.y,r.x*pe.z,r.y*pe.w),B.viewport(o),q.updateMatrices(j,re),n=q.getFrustum(),T(w,I,q.camera,j,this.type)}q.isPointLightShadow!==!0&&this.type===_n&&x(q,I),q.needsUpdate=!1}d=this.type,h.needsUpdate=!1,i.setRenderTarget(M,y,U)};function x(A,w){const I=e.update(_);p.defines.VSM_SAMPLES!==A.blurSamples&&(p.defines.VSM_SAMPLES=A.blurSamples,m.defines.VSM_SAMPLES=A.blurSamples,p.needsUpdate=!0,m.needsUpdate=!0),A.mapPass===null&&(A.mapPass=new On(s.x,s.y)),p.uniforms.shadow_pass.value=A.map.texture,p.uniforms.resolution.value=A.mapSize,p.uniforms.radius.value=A.radius,i.setRenderTarget(A.mapPass),i.clear(),i.renderBufferDirect(w,null,I,p,_,null),m.uniforms.shadow_pass.value=A.mapPass.texture,m.uniforms.resolution.value=A.mapSize,m.uniforms.radius.value=A.radius,i.setRenderTarget(A.map),i.clear(),i.renderBufferDirect(w,null,I,m,_,null)}function v(A,w,I,M){let y=null;const U=I.isPointLight===!0?A.customDistanceMaterial:A.customDepthMaterial;if(U!==void 0)y=U;else if(y=I.isPointLight===!0?l:a,i.localClippingEnabled&&w.clipShadows===!0&&Array.isArray(w.clippingPlanes)&&w.clippingPlanes.length!==0||w.displacementMap&&w.displacementScale!==0||w.alphaMap&&w.alphaTest>0||w.map&&w.alphaTest>0){const B=y.uuid,Y=w.uuid;let L=c[B];L===void 0&&(L={},c[B]=L);let O=L[Y];O===void 0&&(O=y.clone(),L[Y]=O,w.addEventListener("dispose",D)),y=O}if(y.visible=w.visible,y.wireframe=w.wireframe,M===_n?y.side=w.shadowSide!==null?w.shadowSide:w.side:y.side=w.shadowSide!==null?w.shadowSide:f[w.side],y.alphaMap=w.alphaMap,y.alphaTest=w.alphaTest,y.map=w.map,y.clipShadows=w.clipShadows,y.clippingPlanes=w.clippingPlanes,y.clipIntersection=w.clipIntersection,y.displacementMap=w.displacementMap,y.displacementScale=w.displacementScale,y.displacementBias=w.displacementBias,y.wireframeLinewidth=w.wireframeLinewidth,y.linewidth=w.linewidth,I.isPointLight===!0&&y.isMeshDistanceMaterial===!0){const B=i.properties.get(y);B.light=I}return y}function T(A,w,I,M,y){if(A.visible===!1)return;if(A.layers.test(w.layers)&&(A.isMesh||A.isLine||A.isPoints)&&(A.castShadow||A.receiveShadow&&y===_n)&&(!A.frustumCulled||n.intersectsObject(A))){A.modelViewMatrix.multiplyMatrices(I.matrixWorldInverse,A.matrixWorld);const Y=e.update(A),L=A.material;if(Array.isArray(L)){const O=Y.groups;for(let W=0,j=O.length;W<j;W++){const q=O[W],$=L[q.materialIndex];if($&&$.visible){const Q=v(A,$,M,y);A.onBeforeShadow(i,A,w,I,Y,Q,q),i.renderBufferDirect(I,null,Y,Q,A,q),A.onAfterShadow(i,A,w,I,Y,Q,q)}}}else if(L.visible){const O=v(A,L,M,y);A.onBeforeShadow(i,A,w,I,Y,O,null),i.renderBufferDirect(I,null,Y,O,A,null),A.onAfterShadow(i,A,w,I,Y,O,null)}}const B=A.children;for(let Y=0,L=B.length;Y<L;Y++)T(B[Y],w,I,M,y)}function D(A){A.target.removeEventListener("dispose",D);for(const I in c){const M=c[I],y=A.target.uuid;y in M&&(M[y].dispose(),delete M[y])}}}function pg(i,e,t){const n=t.isWebGL2;function s(){let P=!1;const oe=new xt;let le=null;const we=new xt(0,0,0,0);return{setMask:function(Ee){le!==Ee&&!P&&(i.colorMask(Ee,Ee,Ee,Ee),le=Ee)},setLocked:function(Ee){P=Ee},setClear:function(Ee,Ze,Qe,gt,Ct){Ct===!0&&(Ee*=gt,Ze*=gt,Qe*=gt),oe.set(Ee,Ze,Qe,gt),we.equals(oe)===!1&&(i.clearColor(Ee,Ze,Qe,gt),we.copy(oe))},reset:function(){P=!1,le=null,we.set(-1,0,0,0)}}}function r(){let P=!1,oe=null,le=null,we=null;return{setTest:function(Ee){Ee?Ne(i.DEPTH_TEST):Re(i.DEPTH_TEST)},setMask:function(Ee){oe!==Ee&&!P&&(i.depthMask(Ee),oe=Ee)},setFunc:function(Ee){if(le!==Ee){switch(Ee){case Fu:i.depthFunc(i.NEVER);break;case Ou:i.depthFunc(i.ALWAYS);break;case Bu:i.depthFunc(i.LESS);break;case Ls:i.depthFunc(i.LEQUAL);break;case zu:i.depthFunc(i.EQUAL);break;case Gu:i.depthFunc(i.GEQUAL);break;case ku:i.depthFunc(i.GREATER);break;case Hu:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}le=Ee}},setLocked:function(Ee){P=Ee},setClear:function(Ee){we!==Ee&&(i.clearDepth(Ee),we=Ee)},reset:function(){P=!1,oe=null,le=null,we=null}}}function o(){let P=!1,oe=null,le=null,we=null,Ee=null,Ze=null,Qe=null,gt=null,Ct=null;return{setTest:function(it){P||(it?Ne(i.STENCIL_TEST):Re(i.STENCIL_TEST))},setMask:function(it){oe!==it&&!P&&(i.stencilMask(it),oe=it)},setFunc:function(it,Lt,on){(le!==it||we!==Lt||Ee!==on)&&(i.stencilFunc(it,Lt,on),le=it,we=Lt,Ee=on)},setOp:function(it,Lt,on){(Ze!==it||Qe!==Lt||gt!==on)&&(i.stencilOp(it,Lt,on),Ze=it,Qe=Lt,gt=on)},setLocked:function(it){P=it},setClear:function(it){Ct!==it&&(i.clearStencil(it),Ct=it)},reset:function(){P=!1,oe=null,le=null,we=null,Ee=null,Ze=null,Qe=null,gt=null,Ct=null}}}const a=new s,l=new r,c=new o,u=new WeakMap,f=new WeakMap;let p={},m={},g=new WeakMap,_=[],h=null,d=!1,x=null,v=null,T=null,D=null,A=null,w=null,I=null,M=new $e(0,0,0),y=0,U=!1,B=null,Y=null,L=null,O=null,W=null;const j=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let q=!1,$=0;const Q=i.getParameter(i.VERSION);Q.indexOf("WebGL")!==-1?($=parseFloat(/^WebGL (\d)/.exec(Q)[1]),q=$>=1):Q.indexOf("OpenGL ES")!==-1&&($=parseFloat(/^OpenGL ES (\d)/.exec(Q)[1]),q=$>=2);let re=null,pe={};const X=i.getParameter(i.SCISSOR_BOX),ee=i.getParameter(i.VIEWPORT),fe=new xt().fromArray(X),ye=new xt().fromArray(ee);function Me(P,oe,le,we){const Ee=new Uint8Array(4),Ze=i.createTexture();i.bindTexture(P,Ze),i.texParameteri(P,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(P,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Qe=0;Qe<le;Qe++)n&&(P===i.TEXTURE_3D||P===i.TEXTURE_2D_ARRAY)?i.texImage3D(oe,0,i.RGBA,1,1,we,0,i.RGBA,i.UNSIGNED_BYTE,Ee):i.texImage2D(oe+Qe,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,Ee);return Ze}const Ie={};Ie[i.TEXTURE_2D]=Me(i.TEXTURE_2D,i.TEXTURE_2D,1),Ie[i.TEXTURE_CUBE_MAP]=Me(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),n&&(Ie[i.TEXTURE_2D_ARRAY]=Me(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),Ie[i.TEXTURE_3D]=Me(i.TEXTURE_3D,i.TEXTURE_3D,1,1)),a.setClear(0,0,0,1),l.setClear(1),c.setClear(0),Ne(i.DEPTH_TEST),l.setFunc(Ls),Fe(!1),b(La),Ne(i.CULL_FACE),ve(Sn);function Ne(P){p[P]!==!0&&(i.enable(P),p[P]=!0)}function Re(P){p[P]!==!1&&(i.disable(P),p[P]=!1)}function qe(P,oe){return m[P]!==oe?(i.bindFramebuffer(P,oe),m[P]=oe,n&&(P===i.DRAW_FRAMEBUFFER&&(m[i.FRAMEBUFFER]=oe),P===i.FRAMEBUFFER&&(m[i.DRAW_FRAMEBUFFER]=oe)),!0):!1}function z(P,oe){let le=_,we=!1;if(P)if(le=g.get(oe),le===void 0&&(le=[],g.set(oe,le)),P.isWebGLMultipleRenderTargets){const Ee=P.texture;if(le.length!==Ee.length||le[0]!==i.COLOR_ATTACHMENT0){for(let Ze=0,Qe=Ee.length;Ze<Qe;Ze++)le[Ze]=i.COLOR_ATTACHMENT0+Ze;le.length=Ee.length,we=!0}}else le[0]!==i.COLOR_ATTACHMENT0&&(le[0]=i.COLOR_ATTACHMENT0,we=!0);else le[0]!==i.BACK&&(le[0]=i.BACK,we=!0);we&&(t.isWebGL2?i.drawBuffers(le):e.get("WEBGL_draw_buffers").drawBuffersWEBGL(le))}function mt(P){return h!==P?(i.useProgram(P),h=P,!0):!1}const Te={[Xn]:i.FUNC_ADD,[Su]:i.FUNC_SUBTRACT,[yu]:i.FUNC_REVERSE_SUBTRACT};if(n)Te[Ia]=i.MIN,Te[Na]=i.MAX;else{const P=e.get("EXT_blend_minmax");P!==null&&(Te[Ia]=P.MIN_EXT,Te[Na]=P.MAX_EXT)}const De={[Eu]:i.ZERO,[bu]:i.ONE,[Tu]:i.SRC_COLOR,[Nr]:i.SRC_ALPHA,[Pu]:i.SRC_ALPHA_SATURATE,[Cu]:i.DST_COLOR,[wu]:i.DST_ALPHA,[Au]:i.ONE_MINUS_SRC_COLOR,[Fr]:i.ONE_MINUS_SRC_ALPHA,[Lu]:i.ONE_MINUS_DST_COLOR,[Ru]:i.ONE_MINUS_DST_ALPHA,[Du]:i.CONSTANT_COLOR,[Uu]:i.ONE_MINUS_CONSTANT_COLOR,[Iu]:i.CONSTANT_ALPHA,[Nu]:i.ONE_MINUS_CONSTANT_ALPHA};function ve(P,oe,le,we,Ee,Ze,Qe,gt,Ct,it){if(P===Sn){d===!0&&(Re(i.BLEND),d=!1);return}if(d===!1&&(Ne(i.BLEND),d=!0),P!==Mu){if(P!==x||it!==U){if((v!==Xn||A!==Xn)&&(i.blendEquation(i.FUNC_ADD),v=Xn,A=Xn),it)switch(P){case Si:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Pa:i.blendFunc(i.ONE,i.ONE);break;case Da:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case Ua:i.blendFuncSeparate(i.ZERO,i.SRC_COLOR,i.ZERO,i.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",P);break}else switch(P){case Si:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case Pa:i.blendFunc(i.SRC_ALPHA,i.ONE);break;case Da:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case Ua:i.blendFunc(i.ZERO,i.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",P);break}T=null,D=null,w=null,I=null,M.set(0,0,0),y=0,x=P,U=it}return}Ee=Ee||oe,Ze=Ze||le,Qe=Qe||we,(oe!==v||Ee!==A)&&(i.blendEquationSeparate(Te[oe],Te[Ee]),v=oe,A=Ee),(le!==T||we!==D||Ze!==w||Qe!==I)&&(i.blendFuncSeparate(De[le],De[we],De[Ze],De[Qe]),T=le,D=we,w=Ze,I=Qe),(gt.equals(M)===!1||Ct!==y)&&(i.blendColor(gt.r,gt.g,gt.b,Ct),M.copy(gt),y=Ct),x=P,U=!1}function st(P,oe){P.side===vn?Re(i.CULL_FACE):Ne(i.CULL_FACE);let le=P.side===Bt;oe&&(le=!le),Fe(le),P.blending===Si&&P.transparent===!1?ve(Sn):ve(P.blending,P.blendEquation,P.blendSrc,P.blendDst,P.blendEquationAlpha,P.blendSrcAlpha,P.blendDstAlpha,P.blendColor,P.blendAlpha,P.premultipliedAlpha),l.setFunc(P.depthFunc),l.setTest(P.depthTest),l.setMask(P.depthWrite),a.setMask(P.colorWrite);const we=P.stencilWrite;c.setTest(we),we&&(c.setMask(P.stencilWriteMask),c.setFunc(P.stencilFunc,P.stencilRef,P.stencilFuncMask),c.setOp(P.stencilFail,P.stencilZFail,P.stencilZPass)),G(P.polygonOffset,P.polygonOffsetFactor,P.polygonOffsetUnits),P.alphaToCoverage===!0?Ne(i.SAMPLE_ALPHA_TO_COVERAGE):Re(i.SAMPLE_ALPHA_TO_COVERAGE)}function Fe(P){B!==P&&(P?i.frontFace(i.CW):i.frontFace(i.CCW),B=P)}function b(P){P!==vu?(Ne(i.CULL_FACE),P!==Y&&(P===La?i.cullFace(i.BACK):P===xu?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Re(i.CULL_FACE),Y=P}function S(P){P!==L&&(q&&i.lineWidth(P),L=P)}function G(P,oe,le){P?(Ne(i.POLYGON_OFFSET_FILL),(O!==oe||W!==le)&&(i.polygonOffset(oe,le),O=oe,W=le)):Re(i.POLYGON_OFFSET_FILL)}function se(P){P?Ne(i.SCISSOR_TEST):Re(i.SCISSOR_TEST)}function ne(P){P===void 0&&(P=i.TEXTURE0+j-1),re!==P&&(i.activeTexture(P),re=P)}function ie(P,oe,le){le===void 0&&(re===null?le=i.TEXTURE0+j-1:le=re);let we=pe[le];we===void 0&&(we={type:void 0,texture:void 0},pe[le]=we),(we.type!==P||we.texture!==oe)&&(re!==le&&(i.activeTexture(le),re=le),i.bindTexture(P,oe||Ie[P]),we.type=P,we.texture=oe)}function xe(){const P=pe[re];P!==void 0&&P.type!==void 0&&(i.bindTexture(P.type,null),P.type=void 0,P.texture=void 0)}function he(){try{i.compressedTexImage2D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function _e(){try{i.compressedTexImage3D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function Ce(){try{i.texSubImage2D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function Be(){try{i.texSubImage3D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function te(){try{i.compressedTexSubImage2D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function Ye(){try{i.compressedTexSubImage3D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function C(){try{i.texStorage2D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function J(){try{i.texStorage3D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function ue(){try{i.texImage2D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function ae(){try{i.texImage3D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function Se(P){fe.equals(P)===!1&&(i.scissor(P.x,P.y,P.z,P.w),fe.copy(P))}function Ve(P){ye.equals(P)===!1&&(i.viewport(P.x,P.y,P.z,P.w),ye.copy(P))}function je(P,oe){let le=f.get(oe);le===void 0&&(le=new WeakMap,f.set(oe,le));let we=le.get(P);we===void 0&&(we=i.getUniformBlockIndex(oe,P.name),le.set(P,we))}function ke(P,oe){const we=f.get(oe).get(P);u.get(oe)!==we&&(i.uniformBlockBinding(oe,we,P.__bindingPointIndex),u.set(oe,we))}function ce(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),n===!0&&(i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null)),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),p={},re=null,pe={},m={},g=new WeakMap,_=[],h=null,d=!1,x=null,v=null,T=null,D=null,A=null,w=null,I=null,M=new $e(0,0,0),y=0,U=!1,B=null,Y=null,L=null,O=null,W=null,fe.set(0,0,i.canvas.width,i.canvas.height),ye.set(0,0,i.canvas.width,i.canvas.height),a.reset(),l.reset(),c.reset()}return{buffers:{color:a,depth:l,stencil:c},enable:Ne,disable:Re,bindFramebuffer:qe,drawBuffers:z,useProgram:mt,setBlending:ve,setMaterial:st,setFlipSided:Fe,setCullFace:b,setLineWidth:S,setPolygonOffset:G,setScissorTest:se,activeTexture:ne,bindTexture:ie,unbindTexture:xe,compressedTexImage2D:he,compressedTexImage3D:_e,texImage2D:ue,texImage3D:ae,updateUBOMapping:je,uniformBlockBinding:ke,texStorage2D:C,texStorage3D:J,texSubImage2D:Ce,texSubImage3D:Be,compressedTexSubImage2D:te,compressedTexSubImage3D:Ye,scissor:Se,viewport:Ve,reset:ce}}function mg(i,e,t,n,s,r,o){const a=s.isWebGL2,l=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,c=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),u=new WeakMap;let f;const p=new WeakMap;let m=!1;try{m=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(b,S){return m?new OffscreenCanvas(b,S):Ns("canvas")}function _(b,S,G,se){let ne=1;if((b.width>se||b.height>se)&&(ne=se/Math.max(b.width,b.height)),ne<1||S===!0)if(typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&b instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&b instanceof ImageBitmap){const ie=S?Vr:Math.floor,xe=ie(ne*b.width),he=ie(ne*b.height);f===void 0&&(f=g(xe,he));const _e=G?g(xe,he):f;return _e.width=xe,_e.height=he,_e.getContext("2d").drawImage(b,0,0,xe,he),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+b.width+"x"+b.height+") to ("+xe+"x"+he+")."),_e}else return"data"in b&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+b.width+"x"+b.height+")."),b;return b}function h(b){return ho(b.width)&&ho(b.height)}function d(b){return a?!1:b.wrapS!==nn||b.wrapT!==nn||b.minFilter!==Dt&&b.minFilter!==Xt}function x(b,S){return b.generateMipmaps&&S&&b.minFilter!==Dt&&b.minFilter!==Xt}function v(b){i.generateMipmap(b)}function T(b,S,G,se,ne=!1){if(a===!1)return S;if(b!==null){if(i[b]!==void 0)return i[b];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+b+"'")}let ie=S;if(S===i.RED&&(G===i.FLOAT&&(ie=i.R32F),G===i.HALF_FLOAT&&(ie=i.R16F),G===i.UNSIGNED_BYTE&&(ie=i.R8)),S===i.RED_INTEGER&&(G===i.UNSIGNED_BYTE&&(ie=i.R8UI),G===i.UNSIGNED_SHORT&&(ie=i.R16UI),G===i.UNSIGNED_INT&&(ie=i.R32UI),G===i.BYTE&&(ie=i.R8I),G===i.SHORT&&(ie=i.R16I),G===i.INT&&(ie=i.R32I)),S===i.RG&&(G===i.FLOAT&&(ie=i.RG32F),G===i.HALF_FLOAT&&(ie=i.RG16F),G===i.UNSIGNED_BYTE&&(ie=i.RG8)),S===i.RGBA){const xe=ne?Ps:nt.getTransfer(se);G===i.FLOAT&&(ie=i.RGBA32F),G===i.HALF_FLOAT&&(ie=i.RGBA16F),G===i.UNSIGNED_BYTE&&(ie=xe===rt?i.SRGB8_ALPHA8:i.RGBA8),G===i.UNSIGNED_SHORT_4_4_4_4&&(ie=i.RGBA4),G===i.UNSIGNED_SHORT_5_5_5_1&&(ie=i.RGB5_A1)}return(ie===i.R16F||ie===i.R32F||ie===i.RG16F||ie===i.RG32F||ie===i.RGBA16F||ie===i.RGBA32F)&&e.get("EXT_color_buffer_float"),ie}function D(b,S,G){return x(b,G)===!0||b.isFramebufferTexture&&b.minFilter!==Dt&&b.minFilter!==Xt?Math.log2(Math.max(S.width,S.height))+1:b.mipmaps!==void 0&&b.mipmaps.length>0?b.mipmaps.length:b.isCompressedTexture&&Array.isArray(b.image)?S.mipmaps.length:1}function A(b){return b===Dt||b===Fa||b===Qs?i.NEAREST:i.LINEAR}function w(b){const S=b.target;S.removeEventListener("dispose",w),M(S),S.isVideoTexture&&u.delete(S)}function I(b){const S=b.target;S.removeEventListener("dispose",I),U(S)}function M(b){const S=n.get(b);if(S.__webglInit===void 0)return;const G=b.source,se=p.get(G);if(se){const ne=se[S.__cacheKey];ne.usedTimes--,ne.usedTimes===0&&y(b),Object.keys(se).length===0&&p.delete(G)}n.remove(b)}function y(b){const S=n.get(b);i.deleteTexture(S.__webglTexture);const G=b.source,se=p.get(G);delete se[S.__cacheKey],o.memory.textures--}function U(b){const S=b.texture,G=n.get(b),se=n.get(S);if(se.__webglTexture!==void 0&&(i.deleteTexture(se.__webglTexture),o.memory.textures--),b.depthTexture&&b.depthTexture.dispose(),b.isWebGLCubeRenderTarget)for(let ne=0;ne<6;ne++){if(Array.isArray(G.__webglFramebuffer[ne]))for(let ie=0;ie<G.__webglFramebuffer[ne].length;ie++)i.deleteFramebuffer(G.__webglFramebuffer[ne][ie]);else i.deleteFramebuffer(G.__webglFramebuffer[ne]);G.__webglDepthbuffer&&i.deleteRenderbuffer(G.__webglDepthbuffer[ne])}else{if(Array.isArray(G.__webglFramebuffer))for(let ne=0;ne<G.__webglFramebuffer.length;ne++)i.deleteFramebuffer(G.__webglFramebuffer[ne]);else i.deleteFramebuffer(G.__webglFramebuffer);if(G.__webglDepthbuffer&&i.deleteRenderbuffer(G.__webglDepthbuffer),G.__webglMultisampledFramebuffer&&i.deleteFramebuffer(G.__webglMultisampledFramebuffer),G.__webglColorRenderbuffer)for(let ne=0;ne<G.__webglColorRenderbuffer.length;ne++)G.__webglColorRenderbuffer[ne]&&i.deleteRenderbuffer(G.__webglColorRenderbuffer[ne]);G.__webglDepthRenderbuffer&&i.deleteRenderbuffer(G.__webglDepthRenderbuffer)}if(b.isWebGLMultipleRenderTargets)for(let ne=0,ie=S.length;ne<ie;ne++){const xe=n.get(S[ne]);xe.__webglTexture&&(i.deleteTexture(xe.__webglTexture),o.memory.textures--),n.remove(S[ne])}n.remove(S),n.remove(b)}let B=0;function Y(){B=0}function L(){const b=B;return b>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+b+" texture units while this GPU supports only "+s.maxTextures),B+=1,b}function O(b){const S=[];return S.push(b.wrapS),S.push(b.wrapT),S.push(b.wrapR||0),S.push(b.magFilter),S.push(b.minFilter),S.push(b.anisotropy),S.push(b.internalFormat),S.push(b.format),S.push(b.type),S.push(b.generateMipmaps),S.push(b.premultiplyAlpha),S.push(b.flipY),S.push(b.unpackAlignment),S.push(b.colorSpace),S.join()}function W(b,S){const G=n.get(b);if(b.isVideoTexture&&st(b),b.isRenderTargetTexture===!1&&b.version>0&&G.__version!==b.version){const se=b.image;if(se===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(se.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{fe(G,b,S);return}}t.bindTexture(i.TEXTURE_2D,G.__webglTexture,i.TEXTURE0+S)}function j(b,S){const G=n.get(b);if(b.version>0&&G.__version!==b.version){fe(G,b,S);return}t.bindTexture(i.TEXTURE_2D_ARRAY,G.__webglTexture,i.TEXTURE0+S)}function q(b,S){const G=n.get(b);if(b.version>0&&G.__version!==b.version){fe(G,b,S);return}t.bindTexture(i.TEXTURE_3D,G.__webglTexture,i.TEXTURE0+S)}function $(b,S){const G=n.get(b);if(b.version>0&&G.__version!==b.version){ye(G,b,S);return}t.bindTexture(i.TEXTURE_CUBE_MAP,G.__webglTexture,i.TEXTURE0+S)}const Q={[zr]:i.REPEAT,[nn]:i.CLAMP_TO_EDGE,[Gr]:i.MIRRORED_REPEAT},re={[Dt]:i.NEAREST,[Fa]:i.NEAREST_MIPMAP_NEAREST,[Qs]:i.NEAREST_MIPMAP_LINEAR,[Xt]:i.LINEAR,[Ku]:i.LINEAR_MIPMAP_NEAREST,[Wi]:i.LINEAR_MIPMAP_LINEAR},pe={[ld]:i.NEVER,[pd]:i.ALWAYS,[cd]:i.LESS,[Wl]:i.LEQUAL,[ud]:i.EQUAL,[fd]:i.GEQUAL,[dd]:i.GREATER,[hd]:i.NOTEQUAL};function X(b,S,G){if(G?(i.texParameteri(b,i.TEXTURE_WRAP_S,Q[S.wrapS]),i.texParameteri(b,i.TEXTURE_WRAP_T,Q[S.wrapT]),(b===i.TEXTURE_3D||b===i.TEXTURE_2D_ARRAY)&&i.texParameteri(b,i.TEXTURE_WRAP_R,Q[S.wrapR]),i.texParameteri(b,i.TEXTURE_MAG_FILTER,re[S.magFilter]),i.texParameteri(b,i.TEXTURE_MIN_FILTER,re[S.minFilter])):(i.texParameteri(b,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(b,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),(b===i.TEXTURE_3D||b===i.TEXTURE_2D_ARRAY)&&i.texParameteri(b,i.TEXTURE_WRAP_R,i.CLAMP_TO_EDGE),(S.wrapS!==nn||S.wrapT!==nn)&&console.warn("THREE.WebGLRenderer: Texture is not power of two. Texture.wrapS and Texture.wrapT should be set to THREE.ClampToEdgeWrapping."),i.texParameteri(b,i.TEXTURE_MAG_FILTER,A(S.magFilter)),i.texParameteri(b,i.TEXTURE_MIN_FILTER,A(S.minFilter)),S.minFilter!==Dt&&S.minFilter!==Xt&&console.warn("THREE.WebGLRenderer: Texture is not power of two. Texture.minFilter should be set to THREE.NearestFilter or THREE.LinearFilter.")),S.compareFunction&&(i.texParameteri(b,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(b,i.TEXTURE_COMPARE_FUNC,pe[S.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){const se=e.get("EXT_texture_filter_anisotropic");if(S.magFilter===Dt||S.minFilter!==Qs&&S.minFilter!==Wi||S.type===Un&&e.has("OES_texture_float_linear")===!1||a===!1&&S.type===Ai&&e.has("OES_texture_half_float_linear")===!1)return;(S.anisotropy>1||n.get(S).__currentAnisotropy)&&(i.texParameterf(b,se.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(S.anisotropy,s.getMaxAnisotropy())),n.get(S).__currentAnisotropy=S.anisotropy)}}function ee(b,S){let G=!1;b.__webglInit===void 0&&(b.__webglInit=!0,S.addEventListener("dispose",w));const se=S.source;let ne=p.get(se);ne===void 0&&(ne={},p.set(se,ne));const ie=O(S);if(ie!==b.__cacheKey){ne[ie]===void 0&&(ne[ie]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,G=!0),ne[ie].usedTimes++;const xe=ne[b.__cacheKey];xe!==void 0&&(ne[b.__cacheKey].usedTimes--,xe.usedTimes===0&&y(S)),b.__cacheKey=ie,b.__webglTexture=ne[ie].texture}return G}function fe(b,S,G){let se=i.TEXTURE_2D;(S.isDataArrayTexture||S.isCompressedArrayTexture)&&(se=i.TEXTURE_2D_ARRAY),S.isData3DTexture&&(se=i.TEXTURE_3D);const ne=ee(b,S),ie=S.source;t.bindTexture(se,b.__webglTexture,i.TEXTURE0+G);const xe=n.get(ie);if(ie.version!==xe.__version||ne===!0){t.activeTexture(i.TEXTURE0+G);const he=nt.getPrimaries(nt.workingColorSpace),_e=S.colorSpace===qt?null:nt.getPrimaries(S.colorSpace),Ce=S.colorSpace===qt||he===_e?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,S.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,S.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,S.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Ce);const Be=d(S)&&h(S.image)===!1;let te=_(S.image,Be,!1,s.maxTextureSize);te=Fe(S,te);const Ye=h(te)||a,C=r.convert(S.format,S.colorSpace);let J=r.convert(S.type),ue=T(S.internalFormat,C,J,S.colorSpace,S.isVideoTexture);X(se,S,Ye);let ae;const Se=S.mipmaps,Ve=a&&S.isVideoTexture!==!0&&ue!==kl,je=xe.__version===void 0||ne===!0,ke=D(S,te,Ye);if(S.isDepthTexture)ue=i.DEPTH_COMPONENT,a?S.type===Un?ue=i.DEPTH_COMPONENT32F:S.type===Dn?ue=i.DEPTH_COMPONENT24:S.type===Yn?ue=i.DEPTH24_STENCIL8:ue=i.DEPTH_COMPONENT16:S.type===Un&&console.error("WebGLRenderer: Floating point depth texture requires WebGL2."),S.format===jn&&ue===i.DEPTH_COMPONENT&&S.type!==ra&&S.type!==Dn&&(console.warn("THREE.WebGLRenderer: Use UnsignedShortType or UnsignedIntType for DepthFormat DepthTexture."),S.type=Dn,J=r.convert(S.type)),S.format===wi&&ue===i.DEPTH_COMPONENT&&(ue=i.DEPTH_STENCIL,S.type!==Yn&&(console.warn("THREE.WebGLRenderer: Use UnsignedInt248Type for DepthStencilFormat DepthTexture."),S.type=Yn,J=r.convert(S.type))),je&&(Ve?t.texStorage2D(i.TEXTURE_2D,1,ue,te.width,te.height):t.texImage2D(i.TEXTURE_2D,0,ue,te.width,te.height,0,C,J,null));else if(S.isDataTexture)if(Se.length>0&&Ye){Ve&&je&&t.texStorage2D(i.TEXTURE_2D,ke,ue,Se[0].width,Se[0].height);for(let ce=0,P=Se.length;ce<P;ce++)ae=Se[ce],Ve?t.texSubImage2D(i.TEXTURE_2D,ce,0,0,ae.width,ae.height,C,J,ae.data):t.texImage2D(i.TEXTURE_2D,ce,ue,ae.width,ae.height,0,C,J,ae.data);S.generateMipmaps=!1}else Ve?(je&&t.texStorage2D(i.TEXTURE_2D,ke,ue,te.width,te.height),t.texSubImage2D(i.TEXTURE_2D,0,0,0,te.width,te.height,C,J,te.data)):t.texImage2D(i.TEXTURE_2D,0,ue,te.width,te.height,0,C,J,te.data);else if(S.isCompressedTexture)if(S.isCompressedArrayTexture){Ve&&je&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ke,ue,Se[0].width,Se[0].height,te.depth);for(let ce=0,P=Se.length;ce<P;ce++)ae=Se[ce],S.format!==sn?C!==null?Ve?t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,ce,0,0,0,ae.width,ae.height,te.depth,C,ae.data,0,0):t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,ce,ue,ae.width,ae.height,te.depth,0,ae.data,0,0):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Ve?t.texSubImage3D(i.TEXTURE_2D_ARRAY,ce,0,0,0,ae.width,ae.height,te.depth,C,J,ae.data):t.texImage3D(i.TEXTURE_2D_ARRAY,ce,ue,ae.width,ae.height,te.depth,0,C,J,ae.data)}else{Ve&&je&&t.texStorage2D(i.TEXTURE_2D,ke,ue,Se[0].width,Se[0].height);for(let ce=0,P=Se.length;ce<P;ce++)ae=Se[ce],S.format!==sn?C!==null?Ve?t.compressedTexSubImage2D(i.TEXTURE_2D,ce,0,0,ae.width,ae.height,C,ae.data):t.compressedTexImage2D(i.TEXTURE_2D,ce,ue,ae.width,ae.height,0,ae.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Ve?t.texSubImage2D(i.TEXTURE_2D,ce,0,0,ae.width,ae.height,C,J,ae.data):t.texImage2D(i.TEXTURE_2D,ce,ue,ae.width,ae.height,0,C,J,ae.data)}else if(S.isDataArrayTexture)Ve?(je&&t.texStorage3D(i.TEXTURE_2D_ARRAY,ke,ue,te.width,te.height,te.depth),t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,te.width,te.height,te.depth,C,J,te.data)):t.texImage3D(i.TEXTURE_2D_ARRAY,0,ue,te.width,te.height,te.depth,0,C,J,te.data);else if(S.isData3DTexture)Ve?(je&&t.texStorage3D(i.TEXTURE_3D,ke,ue,te.width,te.height,te.depth),t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,te.width,te.height,te.depth,C,J,te.data)):t.texImage3D(i.TEXTURE_3D,0,ue,te.width,te.height,te.depth,0,C,J,te.data);else if(S.isFramebufferTexture){if(je)if(Ve)t.texStorage2D(i.TEXTURE_2D,ke,ue,te.width,te.height);else{let ce=te.width,P=te.height;for(let oe=0;oe<ke;oe++)t.texImage2D(i.TEXTURE_2D,oe,ue,ce,P,0,C,J,null),ce>>=1,P>>=1}}else if(Se.length>0&&Ye){Ve&&je&&t.texStorage2D(i.TEXTURE_2D,ke,ue,Se[0].width,Se[0].height);for(let ce=0,P=Se.length;ce<P;ce++)ae=Se[ce],Ve?t.texSubImage2D(i.TEXTURE_2D,ce,0,0,C,J,ae):t.texImage2D(i.TEXTURE_2D,ce,ue,C,J,ae);S.generateMipmaps=!1}else Ve?(je&&t.texStorage2D(i.TEXTURE_2D,ke,ue,te.width,te.height),t.texSubImage2D(i.TEXTURE_2D,0,0,0,C,J,te)):t.texImage2D(i.TEXTURE_2D,0,ue,C,J,te);x(S,Ye)&&v(se),xe.__version=ie.version,S.onUpdate&&S.onUpdate(S)}b.__version=S.version}function ye(b,S,G){if(S.image.length!==6)return;const se=ee(b,S),ne=S.source;t.bindTexture(i.TEXTURE_CUBE_MAP,b.__webglTexture,i.TEXTURE0+G);const ie=n.get(ne);if(ne.version!==ie.__version||se===!0){t.activeTexture(i.TEXTURE0+G);const xe=nt.getPrimaries(nt.workingColorSpace),he=S.colorSpace===qt?null:nt.getPrimaries(S.colorSpace),_e=S.colorSpace===qt||xe===he?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,S.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,S.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,S.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,_e);const Ce=S.isCompressedTexture||S.image[0].isCompressedTexture,Be=S.image[0]&&S.image[0].isDataTexture,te=[];for(let ce=0;ce<6;ce++)!Ce&&!Be?te[ce]=_(S.image[ce],!1,!0,s.maxCubemapSize):te[ce]=Be?S.image[ce].image:S.image[ce],te[ce]=Fe(S,te[ce]);const Ye=te[0],C=h(Ye)||a,J=r.convert(S.format,S.colorSpace),ue=r.convert(S.type),ae=T(S.internalFormat,J,ue,S.colorSpace),Se=a&&S.isVideoTexture!==!0,Ve=ie.__version===void 0||se===!0;let je=D(S,Ye,C);X(i.TEXTURE_CUBE_MAP,S,C);let ke;if(Ce){Se&&Ve&&t.texStorage2D(i.TEXTURE_CUBE_MAP,je,ae,Ye.width,Ye.height);for(let ce=0;ce<6;ce++){ke=te[ce].mipmaps;for(let P=0;P<ke.length;P++){const oe=ke[P];S.format!==sn?J!==null?Se?t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P,0,0,oe.width,oe.height,J,oe.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P,ae,oe.width,oe.height,0,oe.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Se?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P,0,0,oe.width,oe.height,J,ue,oe.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P,ae,oe.width,oe.height,0,J,ue,oe.data)}}}else{ke=S.mipmaps,Se&&Ve&&(ke.length>0&&je++,t.texStorage2D(i.TEXTURE_CUBE_MAP,je,ae,te[0].width,te[0].height));for(let ce=0;ce<6;ce++)if(Be){Se?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,0,0,0,te[ce].width,te[ce].height,J,ue,te[ce].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,0,ae,te[ce].width,te[ce].height,0,J,ue,te[ce].data);for(let P=0;P<ke.length;P++){const le=ke[P].image[ce].image;Se?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P+1,0,0,le.width,le.height,J,ue,le.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P+1,ae,le.width,le.height,0,J,ue,le.data)}}else{Se?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,0,0,0,J,ue,te[ce]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,0,ae,J,ue,te[ce]);for(let P=0;P<ke.length;P++){const oe=ke[P];Se?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P+1,0,0,J,ue,oe.image[ce]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P+1,ae,J,ue,oe.image[ce])}}}x(S,C)&&v(i.TEXTURE_CUBE_MAP),ie.__version=ne.version,S.onUpdate&&S.onUpdate(S)}b.__version=S.version}function Me(b,S,G,se,ne,ie){const xe=r.convert(G.format,G.colorSpace),he=r.convert(G.type),_e=T(G.internalFormat,xe,he,G.colorSpace);if(!n.get(S).__hasExternalTextures){const Be=Math.max(1,S.width>>ie),te=Math.max(1,S.height>>ie);ne===i.TEXTURE_3D||ne===i.TEXTURE_2D_ARRAY?t.texImage3D(ne,ie,_e,Be,te,S.depth,0,xe,he,null):t.texImage2D(ne,ie,_e,Be,te,0,xe,he,null)}t.bindFramebuffer(i.FRAMEBUFFER,b),ve(S)?l.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,se,ne,n.get(G).__webglTexture,0,De(S)):(ne===i.TEXTURE_2D||ne>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&ne<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,se,ne,n.get(G).__webglTexture,ie),t.bindFramebuffer(i.FRAMEBUFFER,null)}function Ie(b,S,G){if(i.bindRenderbuffer(i.RENDERBUFFER,b),S.depthBuffer&&!S.stencilBuffer){let se=a===!0?i.DEPTH_COMPONENT24:i.DEPTH_COMPONENT16;if(G||ve(S)){const ne=S.depthTexture;ne&&ne.isDepthTexture&&(ne.type===Un?se=i.DEPTH_COMPONENT32F:ne.type===Dn&&(se=i.DEPTH_COMPONENT24));const ie=De(S);ve(S)?l.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,ie,se,S.width,S.height):i.renderbufferStorageMultisample(i.RENDERBUFFER,ie,se,S.width,S.height)}else i.renderbufferStorage(i.RENDERBUFFER,se,S.width,S.height);i.framebufferRenderbuffer(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.RENDERBUFFER,b)}else if(S.depthBuffer&&S.stencilBuffer){const se=De(S);G&&ve(S)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,se,i.DEPTH24_STENCIL8,S.width,S.height):ve(S)?l.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,se,i.DEPTH24_STENCIL8,S.width,S.height):i.renderbufferStorage(i.RENDERBUFFER,i.DEPTH_STENCIL,S.width,S.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.RENDERBUFFER,b)}else{const se=S.isWebGLMultipleRenderTargets===!0?S.texture:[S.texture];for(let ne=0;ne<se.length;ne++){const ie=se[ne],xe=r.convert(ie.format,ie.colorSpace),he=r.convert(ie.type),_e=T(ie.internalFormat,xe,he,ie.colorSpace),Ce=De(S);G&&ve(S)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,Ce,_e,S.width,S.height):ve(S)?l.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Ce,_e,S.width,S.height):i.renderbufferStorage(i.RENDERBUFFER,_e,S.width,S.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Ne(b,S){if(S&&S.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(i.FRAMEBUFFER,b),!(S.depthTexture&&S.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");(!n.get(S.depthTexture).__webglTexture||S.depthTexture.image.width!==S.width||S.depthTexture.image.height!==S.height)&&(S.depthTexture.image.width=S.width,S.depthTexture.image.height=S.height,S.depthTexture.needsUpdate=!0),W(S.depthTexture,0);const se=n.get(S.depthTexture).__webglTexture,ne=De(S);if(S.depthTexture.format===jn)ve(S)?l.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,se,0,ne):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,se,0);else if(S.depthTexture.format===wi)ve(S)?l.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,se,0,ne):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,se,0);else throw new Error("Unknown depthTexture format")}function Re(b){const S=n.get(b),G=b.isWebGLCubeRenderTarget===!0;if(b.depthTexture&&!S.__autoAllocateDepthBuffer){if(G)throw new Error("target.depthTexture not supported in Cube render targets");Ne(S.__webglFramebuffer,b)}else if(G){S.__webglDepthbuffer=[];for(let se=0;se<6;se++)t.bindFramebuffer(i.FRAMEBUFFER,S.__webglFramebuffer[se]),S.__webglDepthbuffer[se]=i.createRenderbuffer(),Ie(S.__webglDepthbuffer[se],b,!1)}else t.bindFramebuffer(i.FRAMEBUFFER,S.__webglFramebuffer),S.__webglDepthbuffer=i.createRenderbuffer(),Ie(S.__webglDepthbuffer,b,!1);t.bindFramebuffer(i.FRAMEBUFFER,null)}function qe(b,S,G){const se=n.get(b);S!==void 0&&Me(se.__webglFramebuffer,b,b.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),G!==void 0&&Re(b)}function z(b){const S=b.texture,G=n.get(b),se=n.get(S);b.addEventListener("dispose",I),b.isWebGLMultipleRenderTargets!==!0&&(se.__webglTexture===void 0&&(se.__webglTexture=i.createTexture()),se.__version=S.version,o.memory.textures++);const ne=b.isWebGLCubeRenderTarget===!0,ie=b.isWebGLMultipleRenderTargets===!0,xe=h(b)||a;if(ne){G.__webglFramebuffer=[];for(let he=0;he<6;he++)if(a&&S.mipmaps&&S.mipmaps.length>0){G.__webglFramebuffer[he]=[];for(let _e=0;_e<S.mipmaps.length;_e++)G.__webglFramebuffer[he][_e]=i.createFramebuffer()}else G.__webglFramebuffer[he]=i.createFramebuffer()}else{if(a&&S.mipmaps&&S.mipmaps.length>0){G.__webglFramebuffer=[];for(let he=0;he<S.mipmaps.length;he++)G.__webglFramebuffer[he]=i.createFramebuffer()}else G.__webglFramebuffer=i.createFramebuffer();if(ie)if(s.drawBuffers){const he=b.texture;for(let _e=0,Ce=he.length;_e<Ce;_e++){const Be=n.get(he[_e]);Be.__webglTexture===void 0&&(Be.__webglTexture=i.createTexture(),o.memory.textures++)}}else console.warn("THREE.WebGLRenderer: WebGLMultipleRenderTargets can only be used with WebGL2 or WEBGL_draw_buffers extension.");if(a&&b.samples>0&&ve(b)===!1){const he=ie?S:[S];G.__webglMultisampledFramebuffer=i.createFramebuffer(),G.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,G.__webglMultisampledFramebuffer);for(let _e=0;_e<he.length;_e++){const Ce=he[_e];G.__webglColorRenderbuffer[_e]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,G.__webglColorRenderbuffer[_e]);const Be=r.convert(Ce.format,Ce.colorSpace),te=r.convert(Ce.type),Ye=T(Ce.internalFormat,Be,te,Ce.colorSpace,b.isXRRenderTarget===!0),C=De(b);i.renderbufferStorageMultisample(i.RENDERBUFFER,C,Ye,b.width,b.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+_e,i.RENDERBUFFER,G.__webglColorRenderbuffer[_e])}i.bindRenderbuffer(i.RENDERBUFFER,null),b.depthBuffer&&(G.__webglDepthRenderbuffer=i.createRenderbuffer(),Ie(G.__webglDepthRenderbuffer,b,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(ne){t.bindTexture(i.TEXTURE_CUBE_MAP,se.__webglTexture),X(i.TEXTURE_CUBE_MAP,S,xe);for(let he=0;he<6;he++)if(a&&S.mipmaps&&S.mipmaps.length>0)for(let _e=0;_e<S.mipmaps.length;_e++)Me(G.__webglFramebuffer[he][_e],b,S,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+he,_e);else Me(G.__webglFramebuffer[he],b,S,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+he,0);x(S,xe)&&v(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(ie){const he=b.texture;for(let _e=0,Ce=he.length;_e<Ce;_e++){const Be=he[_e],te=n.get(Be);t.bindTexture(i.TEXTURE_2D,te.__webglTexture),X(i.TEXTURE_2D,Be,xe),Me(G.__webglFramebuffer,b,Be,i.COLOR_ATTACHMENT0+_e,i.TEXTURE_2D,0),x(Be,xe)&&v(i.TEXTURE_2D)}t.unbindTexture()}else{let he=i.TEXTURE_2D;if((b.isWebGL3DRenderTarget||b.isWebGLArrayRenderTarget)&&(a?he=b.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY:console.error("THREE.WebGLTextures: THREE.Data3DTexture and THREE.DataArrayTexture only supported with WebGL2.")),t.bindTexture(he,se.__webglTexture),X(he,S,xe),a&&S.mipmaps&&S.mipmaps.length>0)for(let _e=0;_e<S.mipmaps.length;_e++)Me(G.__webglFramebuffer[_e],b,S,i.COLOR_ATTACHMENT0,he,_e);else Me(G.__webglFramebuffer,b,S,i.COLOR_ATTACHMENT0,he,0);x(S,xe)&&v(he),t.unbindTexture()}b.depthBuffer&&Re(b)}function mt(b){const S=h(b)||a,G=b.isWebGLMultipleRenderTargets===!0?b.texture:[b.texture];for(let se=0,ne=G.length;se<ne;se++){const ie=G[se];if(x(ie,S)){const xe=b.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:i.TEXTURE_2D,he=n.get(ie).__webglTexture;t.bindTexture(xe,he),v(xe),t.unbindTexture()}}}function Te(b){if(a&&b.samples>0&&ve(b)===!1){const S=b.isWebGLMultipleRenderTargets?b.texture:[b.texture],G=b.width,se=b.height;let ne=i.COLOR_BUFFER_BIT;const ie=[],xe=b.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,he=n.get(b),_e=b.isWebGLMultipleRenderTargets===!0;if(_e)for(let Ce=0;Ce<S.length;Ce++)t.bindFramebuffer(i.FRAMEBUFFER,he.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ce,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,he.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ce,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,he.__webglMultisampledFramebuffer),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,he.__webglFramebuffer);for(let Ce=0;Ce<S.length;Ce++){ie.push(i.COLOR_ATTACHMENT0+Ce),b.depthBuffer&&ie.push(xe);const Be=he.__ignoreDepthValues!==void 0?he.__ignoreDepthValues:!1;if(Be===!1&&(b.depthBuffer&&(ne|=i.DEPTH_BUFFER_BIT),b.stencilBuffer&&(ne|=i.STENCIL_BUFFER_BIT)),_e&&i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,he.__webglColorRenderbuffer[Ce]),Be===!0&&(i.invalidateFramebuffer(i.READ_FRAMEBUFFER,[xe]),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[xe])),_e){const te=n.get(S[Ce]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,te,0)}i.blitFramebuffer(0,0,G,se,0,0,G,se,ne,i.NEAREST),c&&i.invalidateFramebuffer(i.READ_FRAMEBUFFER,ie)}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),_e)for(let Ce=0;Ce<S.length;Ce++){t.bindFramebuffer(i.FRAMEBUFFER,he.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ce,i.RENDERBUFFER,he.__webglColorRenderbuffer[Ce]);const Be=n.get(S[Ce]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,he.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ce,i.TEXTURE_2D,Be,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,he.__webglMultisampledFramebuffer)}}function De(b){return Math.min(s.maxSamples,b.samples)}function ve(b){const S=n.get(b);return a&&b.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&S.__useRenderToTexture!==!1}function st(b){const S=o.render.frame;u.get(b)!==S&&(u.set(b,S),b.update())}function Fe(b,S){const G=b.colorSpace,se=b.format,ne=b.type;return b.isCompressedTexture===!0||b.isVideoTexture===!0||b.format===kr||G!==yn&&G!==qt&&(nt.getTransfer(G)===rt?a===!1?e.has("EXT_sRGB")===!0&&se===sn?(b.format=kr,b.minFilter=Xt,b.generateMipmaps=!1):S=$l.sRGBToLinear(S):(se!==sn||ne!==Nn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",G)),S}this.allocateTextureUnit=L,this.resetTextureUnits=Y,this.setTexture2D=W,this.setTexture2DArray=j,this.setTexture3D=q,this.setTextureCube=$,this.rebindTextures=qe,this.setupRenderTarget=z,this.updateRenderTargetMipmap=mt,this.updateMultisampleRenderTarget=Te,this.setupDepthRenderbuffer=Re,this.setupFrameBufferTexture=Me,this.useMultisampledRTT=ve}function gg(i,e,t){const n=t.isWebGL2;function s(r,o=qt){let a;const l=nt.getTransfer(o);if(r===Nn)return i.UNSIGNED_BYTE;if(r===Fl)return i.UNSIGNED_SHORT_4_4_4_4;if(r===Ol)return i.UNSIGNED_SHORT_5_5_5_1;if(r===Zu)return i.BYTE;if(r===Ju)return i.SHORT;if(r===ra)return i.UNSIGNED_SHORT;if(r===Nl)return i.INT;if(r===Dn)return i.UNSIGNED_INT;if(r===Un)return i.FLOAT;if(r===Ai)return n?i.HALF_FLOAT:(a=e.get("OES_texture_half_float"),a!==null?a.HALF_FLOAT_OES:null);if(r===Qu)return i.ALPHA;if(r===sn)return i.RGBA;if(r===ed)return i.LUMINANCE;if(r===td)return i.LUMINANCE_ALPHA;if(r===jn)return i.DEPTH_COMPONENT;if(r===wi)return i.DEPTH_STENCIL;if(r===kr)return a=e.get("EXT_sRGB"),a!==null?a.SRGB_ALPHA_EXT:null;if(r===nd)return i.RED;if(r===Bl)return i.RED_INTEGER;if(r===id)return i.RG;if(r===zl)return i.RG_INTEGER;if(r===Gl)return i.RGBA_INTEGER;if(r===er||r===tr||r===nr||r===ir)if(l===rt)if(a=e.get("WEBGL_compressed_texture_s3tc_srgb"),a!==null){if(r===er)return a.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(r===tr)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(r===nr)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(r===ir)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(a=e.get("WEBGL_compressed_texture_s3tc"),a!==null){if(r===er)return a.COMPRESSED_RGB_S3TC_DXT1_EXT;if(r===tr)return a.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(r===nr)return a.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(r===ir)return a.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(r===Oa||r===Ba||r===za||r===Ga)if(a=e.get("WEBGL_compressed_texture_pvrtc"),a!==null){if(r===Oa)return a.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(r===Ba)return a.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(r===za)return a.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(r===Ga)return a.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(r===kl)return a=e.get("WEBGL_compressed_texture_etc1"),a!==null?a.COMPRESSED_RGB_ETC1_WEBGL:null;if(r===ka||r===Ha)if(a=e.get("WEBGL_compressed_texture_etc"),a!==null){if(r===ka)return l===rt?a.COMPRESSED_SRGB8_ETC2:a.COMPRESSED_RGB8_ETC2;if(r===Ha)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:a.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(r===Va||r===Wa||r===Xa||r===$a||r===qa||r===Ya||r===ja||r===Ka||r===Za||r===Ja||r===Qa||r===eo||r===to||r===no)if(a=e.get("WEBGL_compressed_texture_astc"),a!==null){if(r===Va)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:a.COMPRESSED_RGBA_ASTC_4x4_KHR;if(r===Wa)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:a.COMPRESSED_RGBA_ASTC_5x4_KHR;if(r===Xa)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:a.COMPRESSED_RGBA_ASTC_5x5_KHR;if(r===$a)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:a.COMPRESSED_RGBA_ASTC_6x5_KHR;if(r===qa)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:a.COMPRESSED_RGBA_ASTC_6x6_KHR;if(r===Ya)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:a.COMPRESSED_RGBA_ASTC_8x5_KHR;if(r===ja)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:a.COMPRESSED_RGBA_ASTC_8x6_KHR;if(r===Ka)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:a.COMPRESSED_RGBA_ASTC_8x8_KHR;if(r===Za)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:a.COMPRESSED_RGBA_ASTC_10x5_KHR;if(r===Ja)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:a.COMPRESSED_RGBA_ASTC_10x6_KHR;if(r===Qa)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:a.COMPRESSED_RGBA_ASTC_10x8_KHR;if(r===eo)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:a.COMPRESSED_RGBA_ASTC_10x10_KHR;if(r===to)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:a.COMPRESSED_RGBA_ASTC_12x10_KHR;if(r===no)return l===rt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:a.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(r===sr||r===io||r===so)if(a=e.get("EXT_texture_compression_bptc"),a!==null){if(r===sr)return l===rt?a.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:a.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(r===io)return a.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(r===so)return a.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(r===sd||r===ro||r===ao||r===oo)if(a=e.get("EXT_texture_compression_rgtc"),a!==null){if(r===sr)return a.COMPRESSED_RED_RGTC1_EXT;if(r===ro)return a.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(r===ao)return a.COMPRESSED_RED_GREEN_RGTC2_EXT;if(r===oo)return a.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return r===Yn?n?i.UNSIGNED_INT_24_8:(a=e.get("WEBGL_depth_texture"),a!==null?a.UNSIGNED_INT_24_8_WEBGL:null):i[r]!==void 0?i[r]:null}return{convert:s}}class _g extends tn{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}}class yt extends Et{constructor(){super(),this.isGroup=!0,this.type="Group"}}const vg={type:"move"};class Rr{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new yt,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new yt,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new N,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new N),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new yt,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new N,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new N),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const t=this._hand;if(t)for(const n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,o=null;const a=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(const _ of e.hand.values()){const h=t.getJointPose(_,n),d=this._getHandJoint(c,_);h!==null&&(d.matrix.fromArray(h.transform.matrix),d.matrix.decompose(d.position,d.rotation,d.scale),d.matrixWorldNeedsUpdate=!0,d.jointRadius=h.radius),d.visible=h!==null}const u=c.joints["index-finger-tip"],f=c.joints["thumb-tip"],p=u.position.distanceTo(f.position),m=.02,g=.005;c.inputState.pinching&&p>m+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&p<=m-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));a!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(a.matrix.fromArray(s.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,s.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(s.linearVelocity)):a.hasLinearVelocity=!1,s.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(s.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(vg)))}return a!==null&&(a.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){const n=new yt;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}}class xg extends ei{constructor(e,t){super();const n=this;let s=null,r=1,o=null,a="local-floor",l=1,c=null,u=null,f=null,p=null,m=null,g=null;const _=t.getContextAttributes();let h=null,d=null;const x=[],v=[],T=new Ae;let D=null;const A=new tn;A.layers.enable(1),A.viewport=new xt;const w=new tn;w.layers.enable(2),w.viewport=new xt;const I=[A,w],M=new _g;M.layers.enable(1),M.layers.enable(2);let y=null,U=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(X){let ee=x[X];return ee===void 0&&(ee=new Rr,x[X]=ee),ee.getTargetRaySpace()},this.getControllerGrip=function(X){let ee=x[X];return ee===void 0&&(ee=new Rr,x[X]=ee),ee.getGripSpace()},this.getHand=function(X){let ee=x[X];return ee===void 0&&(ee=new Rr,x[X]=ee),ee.getHandSpace()};function B(X){const ee=v.indexOf(X.inputSource);if(ee===-1)return;const fe=x[ee];fe!==void 0&&(fe.update(X.inputSource,X.frame,c||o),fe.dispatchEvent({type:X.type,data:X.inputSource}))}function Y(){s.removeEventListener("select",B),s.removeEventListener("selectstart",B),s.removeEventListener("selectend",B),s.removeEventListener("squeeze",B),s.removeEventListener("squeezestart",B),s.removeEventListener("squeezeend",B),s.removeEventListener("end",Y),s.removeEventListener("inputsourceschange",L);for(let X=0;X<x.length;X++){const ee=v[X];ee!==null&&(v[X]=null,x[X].disconnect(ee))}y=null,U=null,e.setRenderTarget(h),m=null,p=null,f=null,s=null,d=null,pe.stop(),n.isPresenting=!1,e.setPixelRatio(D),e.setSize(T.width,T.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(X){r=X,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(X){a=X,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(X){c=X},this.getBaseLayer=function(){return p!==null?p:m},this.getBinding=function(){return f},this.getFrame=function(){return g},this.getSession=function(){return s},this.setSession=async function(X){if(s=X,s!==null){if(h=e.getRenderTarget(),s.addEventListener("select",B),s.addEventListener("selectstart",B),s.addEventListener("selectend",B),s.addEventListener("squeeze",B),s.addEventListener("squeezestart",B),s.addEventListener("squeezeend",B),s.addEventListener("end",Y),s.addEventListener("inputsourceschange",L),_.xrCompatible!==!0&&await t.makeXRCompatible(),D=e.getPixelRatio(),e.getSize(T),s.renderState.layers===void 0||e.capabilities.isWebGL2===!1){const ee={antialias:s.renderState.layers===void 0?_.antialias:!0,alpha:!0,depth:_.depth,stencil:_.stencil,framebufferScaleFactor:r};m=new XRWebGLLayer(s,t,ee),s.updateRenderState({baseLayer:m}),e.setPixelRatio(1),e.setSize(m.framebufferWidth,m.framebufferHeight,!1),d=new On(m.framebufferWidth,m.framebufferHeight,{format:sn,type:Nn,colorSpace:e.outputColorSpace,stencilBuffer:_.stencil})}else{let ee=null,fe=null,ye=null;_.depth&&(ye=_.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,ee=_.stencil?wi:jn,fe=_.stencil?Yn:Dn);const Me={colorFormat:t.RGBA8,depthFormat:ye,scaleFactor:r};f=new XRWebGLBinding(s,t),p=f.createProjectionLayer(Me),s.updateRenderState({layers:[p]}),e.setPixelRatio(1),e.setSize(p.textureWidth,p.textureHeight,!1),d=new On(p.textureWidth,p.textureHeight,{format:sn,type:Nn,depthTexture:new ic(p.textureWidth,p.textureHeight,fe,void 0,void 0,void 0,void 0,void 0,void 0,ee),stencilBuffer:_.stencil,colorSpace:e.outputColorSpace,samples:_.antialias?4:0});const Ie=e.properties.get(d);Ie.__ignoreDepthValues=p.ignoreDepthValues}d.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await s.requestReferenceSpace(a),pe.setContext(s),pe.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode};function L(X){for(let ee=0;ee<X.removed.length;ee++){const fe=X.removed[ee],ye=v.indexOf(fe);ye>=0&&(v[ye]=null,x[ye].disconnect(fe))}for(let ee=0;ee<X.added.length;ee++){const fe=X.added[ee];let ye=v.indexOf(fe);if(ye===-1){for(let Ie=0;Ie<x.length;Ie++)if(Ie>=v.length){v.push(fe),ye=Ie;break}else if(v[Ie]===null){v[Ie]=fe,ye=Ie;break}if(ye===-1)break}const Me=x[ye];Me&&Me.connect(fe)}}const O=new N,W=new N;function j(X,ee,fe){O.setFromMatrixPosition(ee.matrixWorld),W.setFromMatrixPosition(fe.matrixWorld);const ye=O.distanceTo(W),Me=ee.projectionMatrix.elements,Ie=fe.projectionMatrix.elements,Ne=Me[14]/(Me[10]-1),Re=Me[14]/(Me[10]+1),qe=(Me[9]+1)/Me[5],z=(Me[9]-1)/Me[5],mt=(Me[8]-1)/Me[0],Te=(Ie[8]+1)/Ie[0],De=Ne*mt,ve=Ne*Te,st=ye/(-mt+Te),Fe=st*-mt;ee.matrixWorld.decompose(X.position,X.quaternion,X.scale),X.translateX(Fe),X.translateZ(st),X.matrixWorld.compose(X.position,X.quaternion,X.scale),X.matrixWorldInverse.copy(X.matrixWorld).invert();const b=Ne+st,S=Re+st,G=De-Fe,se=ve+(ye-Fe),ne=qe*Re/S*b,ie=z*Re/S*b;X.projectionMatrix.makePerspective(G,se,ne,ie,b,S),X.projectionMatrixInverse.copy(X.projectionMatrix).invert()}function q(X,ee){ee===null?X.matrixWorld.copy(X.matrix):X.matrixWorld.multiplyMatrices(ee.matrixWorld,X.matrix),X.matrixWorldInverse.copy(X.matrixWorld).invert()}this.updateCamera=function(X){if(s===null)return;M.near=w.near=A.near=X.near,M.far=w.far=A.far=X.far,(y!==M.near||U!==M.far)&&(s.updateRenderState({depthNear:M.near,depthFar:M.far}),y=M.near,U=M.far);const ee=X.parent,fe=M.cameras;q(M,ee);for(let ye=0;ye<fe.length;ye++)q(fe[ye],ee);fe.length===2?j(M,A,w):M.projectionMatrix.copy(A.projectionMatrix),$(X,M,ee)};function $(X,ee,fe){fe===null?X.matrix.copy(ee.matrixWorld):(X.matrix.copy(fe.matrixWorld),X.matrix.invert(),X.matrix.multiply(ee.matrixWorld)),X.matrix.decompose(X.position,X.quaternion,X.scale),X.updateMatrixWorld(!0),X.projectionMatrix.copy(ee.projectionMatrix),X.projectionMatrixInverse.copy(ee.projectionMatrixInverse),X.isPerspectiveCamera&&(X.fov=Hr*2*Math.atan(1/X.projectionMatrix.elements[5]),X.zoom=1)}this.getCamera=function(){return M},this.getFoveation=function(){if(!(p===null&&m===null))return l},this.setFoveation=function(X){l=X,p!==null&&(p.fixedFoveation=X),m!==null&&m.fixedFoveation!==void 0&&(m.fixedFoveation=X)};let Q=null;function re(X,ee){if(u=ee.getViewerPose(c||o),g=ee,u!==null){const fe=u.views;m!==null&&(e.setRenderTargetFramebuffer(d,m.framebuffer),e.setRenderTarget(d));let ye=!1;fe.length!==M.cameras.length&&(M.cameras.length=0,ye=!0);for(let Me=0;Me<fe.length;Me++){const Ie=fe[Me];let Ne=null;if(m!==null)Ne=m.getViewport(Ie);else{const qe=f.getViewSubImage(p,Ie);Ne=qe.viewport,Me===0&&(e.setRenderTargetTextures(d,qe.colorTexture,p.ignoreDepthValues?void 0:qe.depthStencilTexture),e.setRenderTarget(d))}let Re=I[Me];Re===void 0&&(Re=new tn,Re.layers.enable(Me),Re.viewport=new xt,I[Me]=Re),Re.matrix.fromArray(Ie.transform.matrix),Re.matrix.decompose(Re.position,Re.quaternion,Re.scale),Re.projectionMatrix.fromArray(Ie.projectionMatrix),Re.projectionMatrixInverse.copy(Re.projectionMatrix).invert(),Re.viewport.set(Ne.x,Ne.y,Ne.width,Ne.height),Me===0&&(M.matrix.copy(Re.matrix),M.matrix.decompose(M.position,M.quaternion,M.scale)),ye===!0&&M.cameras.push(Re)}}for(let fe=0;fe<x.length;fe++){const ye=v[fe],Me=x[fe];ye!==null&&Me!==void 0&&Me.update(ye,ee,c||o)}Q&&Q(X,ee),ee.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ee}),g=null}const pe=new nc;pe.setAnimationLoop(re),this.setAnimationLoop=function(X){Q=X},this.dispose=function(){}}}function Mg(i,e){function t(h,d){h.matrixAutoUpdate===!0&&h.updateMatrix(),d.value.copy(h.matrix)}function n(h,d){d.color.getRGB(h.fogColor.value,Jl(i)),d.isFog?(h.fogNear.value=d.near,h.fogFar.value=d.far):d.isFogExp2&&(h.fogDensity.value=d.density)}function s(h,d,x,v,T){d.isMeshBasicMaterial||d.isMeshLambertMaterial?r(h,d):d.isMeshToonMaterial?(r(h,d),f(h,d)):d.isMeshPhongMaterial?(r(h,d),u(h,d)):d.isMeshStandardMaterial?(r(h,d),p(h,d),d.isMeshPhysicalMaterial&&m(h,d,T)):d.isMeshMatcapMaterial?(r(h,d),g(h,d)):d.isMeshDepthMaterial?r(h,d):d.isMeshDistanceMaterial?(r(h,d),_(h,d)):d.isMeshNormalMaterial?r(h,d):d.isLineBasicMaterial?(o(h,d),d.isLineDashedMaterial&&a(h,d)):d.isPointsMaterial?l(h,d,x,v):d.isSpriteMaterial?c(h,d):d.isShadowMaterial?(h.color.value.copy(d.color),h.opacity.value=d.opacity):d.isShaderMaterial&&(d.uniformsNeedUpdate=!1)}function r(h,d){h.opacity.value=d.opacity,d.color&&h.diffuse.value.copy(d.color),d.emissive&&h.emissive.value.copy(d.emissive).multiplyScalar(d.emissiveIntensity),d.map&&(h.map.value=d.map,t(d.map,h.mapTransform)),d.alphaMap&&(h.alphaMap.value=d.alphaMap,t(d.alphaMap,h.alphaMapTransform)),d.bumpMap&&(h.bumpMap.value=d.bumpMap,t(d.bumpMap,h.bumpMapTransform),h.bumpScale.value=d.bumpScale,d.side===Bt&&(h.bumpScale.value*=-1)),d.normalMap&&(h.normalMap.value=d.normalMap,t(d.normalMap,h.normalMapTransform),h.normalScale.value.copy(d.normalScale),d.side===Bt&&h.normalScale.value.negate()),d.displacementMap&&(h.displacementMap.value=d.displacementMap,t(d.displacementMap,h.displacementMapTransform),h.displacementScale.value=d.displacementScale,h.displacementBias.value=d.displacementBias),d.emissiveMap&&(h.emissiveMap.value=d.emissiveMap,t(d.emissiveMap,h.emissiveMapTransform)),d.specularMap&&(h.specularMap.value=d.specularMap,t(d.specularMap,h.specularMapTransform)),d.alphaTest>0&&(h.alphaTest.value=d.alphaTest);const x=e.get(d).envMap;if(x&&(h.envMap.value=x,h.flipEnvMap.value=x.isCubeTexture&&x.isRenderTargetTexture===!1?-1:1,h.reflectivity.value=d.reflectivity,h.ior.value=d.ior,h.refractionRatio.value=d.refractionRatio),d.lightMap){h.lightMap.value=d.lightMap;const v=i._useLegacyLights===!0?Math.PI:1;h.lightMapIntensity.value=d.lightMapIntensity*v,t(d.lightMap,h.lightMapTransform)}d.aoMap&&(h.aoMap.value=d.aoMap,h.aoMapIntensity.value=d.aoMapIntensity,t(d.aoMap,h.aoMapTransform))}function o(h,d){h.diffuse.value.copy(d.color),h.opacity.value=d.opacity,d.map&&(h.map.value=d.map,t(d.map,h.mapTransform))}function a(h,d){h.dashSize.value=d.dashSize,h.totalSize.value=d.dashSize+d.gapSize,h.scale.value=d.scale}function l(h,d,x,v){h.diffuse.value.copy(d.color),h.opacity.value=d.opacity,h.size.value=d.size*x,h.scale.value=v*.5,d.map&&(h.map.value=d.map,t(d.map,h.uvTransform)),d.alphaMap&&(h.alphaMap.value=d.alphaMap,t(d.alphaMap,h.alphaMapTransform)),d.alphaTest>0&&(h.alphaTest.value=d.alphaTest)}function c(h,d){h.diffuse.value.copy(d.color),h.opacity.value=d.opacity,h.rotation.value=d.rotation,d.map&&(h.map.value=d.map,t(d.map,h.mapTransform)),d.alphaMap&&(h.alphaMap.value=d.alphaMap,t(d.alphaMap,h.alphaMapTransform)),d.alphaTest>0&&(h.alphaTest.value=d.alphaTest)}function u(h,d){h.specular.value.copy(d.specular),h.shininess.value=Math.max(d.shininess,1e-4)}function f(h,d){d.gradientMap&&(h.gradientMap.value=d.gradientMap)}function p(h,d){h.metalness.value=d.metalness,d.metalnessMap&&(h.metalnessMap.value=d.metalnessMap,t(d.metalnessMap,h.metalnessMapTransform)),h.roughness.value=d.roughness,d.roughnessMap&&(h.roughnessMap.value=d.roughnessMap,t(d.roughnessMap,h.roughnessMapTransform)),e.get(d).envMap&&(h.envMapIntensity.value=d.envMapIntensity)}function m(h,d,x){h.ior.value=d.ior,d.sheen>0&&(h.sheenColor.value.copy(d.sheenColor).multiplyScalar(d.sheen),h.sheenRoughness.value=d.sheenRoughness,d.sheenColorMap&&(h.sheenColorMap.value=d.sheenColorMap,t(d.sheenColorMap,h.sheenColorMapTransform)),d.sheenRoughnessMap&&(h.sheenRoughnessMap.value=d.sheenRoughnessMap,t(d.sheenRoughnessMap,h.sheenRoughnessMapTransform))),d.clearcoat>0&&(h.clearcoat.value=d.clearcoat,h.clearcoatRoughness.value=d.clearcoatRoughness,d.clearcoatMap&&(h.clearcoatMap.value=d.clearcoatMap,t(d.clearcoatMap,h.clearcoatMapTransform)),d.clearcoatRoughnessMap&&(h.clearcoatRoughnessMap.value=d.clearcoatRoughnessMap,t(d.clearcoatRoughnessMap,h.clearcoatRoughnessMapTransform)),d.clearcoatNormalMap&&(h.clearcoatNormalMap.value=d.clearcoatNormalMap,t(d.clearcoatNormalMap,h.clearcoatNormalMapTransform),h.clearcoatNormalScale.value.copy(d.clearcoatNormalScale),d.side===Bt&&h.clearcoatNormalScale.value.negate())),d.iridescence>0&&(h.iridescence.value=d.iridescence,h.iridescenceIOR.value=d.iridescenceIOR,h.iridescenceThicknessMinimum.value=d.iridescenceThicknessRange[0],h.iridescenceThicknessMaximum.value=d.iridescenceThicknessRange[1],d.iridescenceMap&&(h.iridescenceMap.value=d.iridescenceMap,t(d.iridescenceMap,h.iridescenceMapTransform)),d.iridescenceThicknessMap&&(h.iridescenceThicknessMap.value=d.iridescenceThicknessMap,t(d.iridescenceThicknessMap,h.iridescenceThicknessMapTransform))),d.transmission>0&&(h.transmission.value=d.transmission,h.transmissionSamplerMap.value=x.texture,h.transmissionSamplerSize.value.set(x.width,x.height),d.transmissionMap&&(h.transmissionMap.value=d.transmissionMap,t(d.transmissionMap,h.transmissionMapTransform)),h.thickness.value=d.thickness,d.thicknessMap&&(h.thicknessMap.value=d.thicknessMap,t(d.thicknessMap,h.thicknessMapTransform)),h.attenuationDistance.value=d.attenuationDistance,h.attenuationColor.value.copy(d.attenuationColor)),d.anisotropy>0&&(h.anisotropyVector.value.set(d.anisotropy*Math.cos(d.anisotropyRotation),d.anisotropy*Math.sin(d.anisotropyRotation)),d.anisotropyMap&&(h.anisotropyMap.value=d.anisotropyMap,t(d.anisotropyMap,h.anisotropyMapTransform))),h.specularIntensity.value=d.specularIntensity,h.specularColor.value.copy(d.specularColor),d.specularColorMap&&(h.specularColorMap.value=d.specularColorMap,t(d.specularColorMap,h.specularColorMapTransform)),d.specularIntensityMap&&(h.specularIntensityMap.value=d.specularIntensityMap,t(d.specularIntensityMap,h.specularIntensityMapTransform))}function g(h,d){d.matcap&&(h.matcap.value=d.matcap)}function _(h,d){const x=e.get(d).light;h.referencePosition.value.setFromMatrixPosition(x.matrixWorld),h.nearDistance.value=x.shadow.camera.near,h.farDistance.value=x.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function Sg(i,e,t,n){let s={},r={},o=[];const a=t.isWebGL2?i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS):0;function l(x,v){const T=v.program;n.uniformBlockBinding(x,T)}function c(x,v){let T=s[x.id];T===void 0&&(g(x),T=u(x),s[x.id]=T,x.addEventListener("dispose",h));const D=v.program;n.updateUBOMapping(x,D);const A=e.render.frame;r[x.id]!==A&&(p(x),r[x.id]=A)}function u(x){const v=f();x.__bindingPointIndex=v;const T=i.createBuffer(),D=x.__size,A=x.usage;return i.bindBuffer(i.UNIFORM_BUFFER,T),i.bufferData(i.UNIFORM_BUFFER,D,A),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,v,T),T}function f(){for(let x=0;x<a;x++)if(o.indexOf(x)===-1)return o.push(x),x;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function p(x){const v=s[x.id],T=x.uniforms,D=x.__cache;i.bindBuffer(i.UNIFORM_BUFFER,v);for(let A=0,w=T.length;A<w;A++){const I=Array.isArray(T[A])?T[A]:[T[A]];for(let M=0,y=I.length;M<y;M++){const U=I[M];if(m(U,A,M,D)===!0){const B=U.__offset,Y=Array.isArray(U.value)?U.value:[U.value];let L=0;for(let O=0;O<Y.length;O++){const W=Y[O],j=_(W);typeof W=="number"||typeof W=="boolean"?(U.__data[0]=W,i.bufferSubData(i.UNIFORM_BUFFER,B+L,U.__data)):W.isMatrix3?(U.__data[0]=W.elements[0],U.__data[1]=W.elements[1],U.__data[2]=W.elements[2],U.__data[3]=0,U.__data[4]=W.elements[3],U.__data[5]=W.elements[4],U.__data[6]=W.elements[5],U.__data[7]=0,U.__data[8]=W.elements[6],U.__data[9]=W.elements[7],U.__data[10]=W.elements[8],U.__data[11]=0):(W.toArray(U.__data,L),L+=j.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,B,U.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function m(x,v,T,D){const A=x.value,w=v+"_"+T;if(D[w]===void 0)return typeof A=="number"||typeof A=="boolean"?D[w]=A:D[w]=A.clone(),!0;{const I=D[w];if(typeof A=="number"||typeof A=="boolean"){if(I!==A)return D[w]=A,!0}else if(I.equals(A)===!1)return I.copy(A),!0}return!1}function g(x){const v=x.uniforms;let T=0;const D=16;for(let w=0,I=v.length;w<I;w++){const M=Array.isArray(v[w])?v[w]:[v[w]];for(let y=0,U=M.length;y<U;y++){const B=M[y],Y=Array.isArray(B.value)?B.value:[B.value];for(let L=0,O=Y.length;L<O;L++){const W=Y[L],j=_(W),q=T%D;q!==0&&D-q<j.boundary&&(T+=D-q),B.__data=new Float32Array(j.storage/Float32Array.BYTES_PER_ELEMENT),B.__offset=T,T+=j.storage}}}const A=T%D;return A>0&&(T+=D-A),x.__size=T,x.__cache={},this}function _(x){const v={boundary:0,storage:0};return typeof x=="number"||typeof x=="boolean"?(v.boundary=4,v.storage=4):x.isVector2?(v.boundary=8,v.storage=8):x.isVector3||x.isColor?(v.boundary=16,v.storage=12):x.isVector4?(v.boundary=16,v.storage=16):x.isMatrix3?(v.boundary=48,v.storage=48):x.isMatrix4?(v.boundary=64,v.storage=64):x.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",x),v}function h(x){const v=x.target;v.removeEventListener("dispose",h);const T=o.indexOf(v.__bindingPointIndex);o.splice(T,1),i.deleteBuffer(s[v.id]),delete s[v.id],delete r[v.id]}function d(){for(const x in s)i.deleteBuffer(s[x]);o=[],s={},r={}}return{bind:l,update:c,dispose:d}}class cc{constructor(e={}){const{canvas:t=_d(),context:n=null,depth:s=!0,stencil:r=!0,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:u="default",failIfMajorPerformanceCaveat:f=!1}=e;this.isWebGLRenderer=!0;let p;n!==null?p=n.getContextAttributes().alpha:p=o;const m=new Uint32Array(4),g=new Int32Array(4);let _=null,h=null;const d=[],x=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=St,this._useLegacyLights=!1,this.toneMapping=In,this.toneMappingExposure=1;const v=this;let T=!1,D=0,A=0,w=null,I=-1,M=null;const y=new xt,U=new xt;let B=null;const Y=new $e(0);let L=0,O=t.width,W=t.height,j=1,q=null,$=null;const Q=new xt(0,0,O,W),re=new xt(0,0,O,W);let pe=!1;const X=new ua;let ee=!1,fe=!1,ye=null;const Me=new ht,Ie=new Ae,Ne=new N,Re={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};function qe(){return w===null?j:1}let z=n;function mt(E,F){for(let H=0;H<E.length;H++){const V=E[H],k=t.getContext(V,F);if(k!==null)return k}return null}try{const E={alpha:!0,depth:s,stencil:r,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:u,failIfMajorPerformanceCaveat:f};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${sa}`),t.addEventListener("webglcontextlost",ce,!1),t.addEventListener("webglcontextrestored",P,!1),t.addEventListener("webglcontextcreationerror",oe,!1),z===null){const F=["webgl2","webgl","experimental-webgl"];if(v.isWebGL1Renderer===!0&&F.shift(),z=mt(F,E),z===null)throw mt(F)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}typeof WebGLRenderingContext<"u"&&z instanceof WebGLRenderingContext&&console.warn("THREE.WebGLRenderer: WebGL 1 support was deprecated in r153 and will be removed in r163."),z.getShaderPrecisionFormat===void 0&&(z.getShaderPrecisionFormat=function(){return{rangeMin:1,rangeMax:1,precision:1}})}catch(E){throw console.error("THREE.WebGLRenderer: "+E.message),E}let Te,De,ve,st,Fe,b,S,G,se,ne,ie,xe,he,_e,Ce,Be,te,Ye,C,J,ue,ae,Se,Ve;function je(){Te=new Pp(z),De=new Tp(z,Te,e),Te.init(De),ae=new gg(z,Te,De),ve=new pg(z,Te,De),st=new Ip(z),Fe=new eg,b=new mg(z,Te,ve,Fe,De,ae,st),S=new wp(v),G=new Lp(v),se=new kd(z,De),Se=new Ep(z,Te,se,De),ne=new Dp(z,se,st,Se),ie=new Bp(z,ne,se,st),C=new Op(z,De,b),Be=new Ap(Fe),xe=new Qm(v,S,G,Te,De,Se,Be),he=new Mg(v,Fe),_e=new ng,Ce=new lg(Te,De),Ye=new yp(v,S,G,ve,ie,p,l),te=new fg(v,ie,De),Ve=new Sg(z,st,De,ve),J=new bp(z,Te,st,De),ue=new Up(z,Te,st,De),st.programs=xe.programs,v.capabilities=De,v.extensions=Te,v.properties=Fe,v.renderLists=_e,v.shadowMap=te,v.state=ve,v.info=st}je();const ke=new xg(v,z);this.xr=ke,this.getContext=function(){return z},this.getContextAttributes=function(){return z.getContextAttributes()},this.forceContextLoss=function(){const E=Te.get("WEBGL_lose_context");E&&E.loseContext()},this.forceContextRestore=function(){const E=Te.get("WEBGL_lose_context");E&&E.restoreContext()},this.getPixelRatio=function(){return j},this.setPixelRatio=function(E){E!==void 0&&(j=E,this.setSize(O,W,!1))},this.getSize=function(E){return E.set(O,W)},this.setSize=function(E,F,H=!0){if(ke.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}O=E,W=F,t.width=Math.floor(E*j),t.height=Math.floor(F*j),H===!0&&(t.style.width=E+"px",t.style.height=F+"px"),this.setViewport(0,0,E,F)},this.getDrawingBufferSize=function(E){return E.set(O*j,W*j).floor()},this.setDrawingBufferSize=function(E,F,H){O=E,W=F,j=H,t.width=Math.floor(E*H),t.height=Math.floor(F*H),this.setViewport(0,0,E,F)},this.getCurrentViewport=function(E){return E.copy(y)},this.getViewport=function(E){return E.copy(Q)},this.setViewport=function(E,F,H,V){E.isVector4?Q.set(E.x,E.y,E.z,E.w):Q.set(E,F,H,V),ve.viewport(y.copy(Q).multiplyScalar(j).floor())},this.getScissor=function(E){return E.copy(re)},this.setScissor=function(E,F,H,V){E.isVector4?re.set(E.x,E.y,E.z,E.w):re.set(E,F,H,V),ve.scissor(U.copy(re).multiplyScalar(j).floor())},this.getScissorTest=function(){return pe},this.setScissorTest=function(E){ve.setScissorTest(pe=E)},this.setOpaqueSort=function(E){q=E},this.setTransparentSort=function(E){$=E},this.getClearColor=function(E){return E.copy(Ye.getClearColor())},this.setClearColor=function(){Ye.setClearColor.apply(Ye,arguments)},this.getClearAlpha=function(){return Ye.getClearAlpha()},this.setClearAlpha=function(){Ye.setClearAlpha.apply(Ye,arguments)},this.clear=function(E=!0,F=!0,H=!0){let V=0;if(E){let k=!1;if(w!==null){const me=w.texture.format;k=me===Gl||me===zl||me===Bl}if(k){const me=w.texture.type,be=me===Nn||me===Dn||me===ra||me===Yn||me===Fl||me===Ol,Le=Ye.getClearColor(),Ue=Ye.getClearAlpha(),He=Le.r,Oe=Le.g,ze=Le.b;be?(m[0]=He,m[1]=Oe,m[2]=ze,m[3]=Ue,z.clearBufferuiv(z.COLOR,0,m)):(g[0]=He,g[1]=Oe,g[2]=ze,g[3]=Ue,z.clearBufferiv(z.COLOR,0,g))}else V|=z.COLOR_BUFFER_BIT}F&&(V|=z.DEPTH_BUFFER_BIT),H&&(V|=z.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),z.clear(V)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",ce,!1),t.removeEventListener("webglcontextrestored",P,!1),t.removeEventListener("webglcontextcreationerror",oe,!1),_e.dispose(),Ce.dispose(),Fe.dispose(),S.dispose(),G.dispose(),ie.dispose(),Se.dispose(),Ve.dispose(),xe.dispose(),ke.dispose(),ke.removeEventListener("sessionstart",Ct),ke.removeEventListener("sessionend",it),ye&&(ye.dispose(),ye=null),Lt.stop()};function ce(E){E.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),T=!0}function P(){console.log("THREE.WebGLRenderer: Context Restored."),T=!1;const E=st.autoReset,F=te.enabled,H=te.autoUpdate,V=te.needsUpdate,k=te.type;je(),st.autoReset=E,te.enabled=F,te.autoUpdate=H,te.needsUpdate=V,te.type=k}function oe(E){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",E.statusMessage)}function le(E){const F=E.target;F.removeEventListener("dispose",le),we(F)}function we(E){Ee(E),Fe.remove(E)}function Ee(E){const F=Fe.get(E).programs;F!==void 0&&(F.forEach(function(H){xe.releaseProgram(H)}),E.isShaderMaterial&&xe.releaseShaderCache(E))}this.renderBufferDirect=function(E,F,H,V,k,me){F===null&&(F=Re);const be=k.isMesh&&k.matrixWorld.determinant()<0,Le=Tc(E,F,H,V,k);ve.setMaterial(V,be);let Ue=H.index,He=1;if(V.wireframe===!0){if(Ue=ne.getWireframeAttribute(H),Ue===void 0)return;He=2}const Oe=H.drawRange,ze=H.attributes.position;let ct=Oe.start*He,zt=(Oe.start+Oe.count)*He;me!==null&&(ct=Math.max(ct,me.start*He),zt=Math.min(zt,(me.start+me.count)*He)),Ue!==null?(ct=Math.max(ct,0),zt=Math.min(zt,Ue.count)):ze!=null&&(ct=Math.max(ct,0),zt=Math.min(zt,ze.count));const _t=zt-ct;if(_t<0||_t===1/0)return;Se.setup(k,V,Le,H,Ue);let dn,ot=J;if(Ue!==null&&(dn=se.get(Ue),ot=ue,ot.setIndex(dn)),k.isMesh)V.wireframe===!0?(ve.setLineWidth(V.wireframeLinewidth*qe()),ot.setMode(z.LINES)):ot.setMode(z.TRIANGLES);else if(k.isLine){let We=V.linewidth;We===void 0&&(We=1),ve.setLineWidth(We*qe()),k.isLineSegments?ot.setMode(z.LINES):k.isLineLoop?ot.setMode(z.LINE_LOOP):ot.setMode(z.LINE_STRIP)}else k.isPoints?ot.setMode(z.POINTS):k.isSprite&&ot.setMode(z.TRIANGLES);if(k.isBatchedMesh)ot.renderMultiDraw(k._multiDrawStarts,k._multiDrawCounts,k._multiDrawCount);else if(k.isInstancedMesh)ot.renderInstances(ct,_t,k.count);else if(H.isInstancedBufferGeometry){const We=H._maxInstanceCount!==void 0?H._maxInstanceCount:1/0,qs=Math.min(H.instanceCount,We);ot.renderInstances(ct,_t,qs)}else ot.render(ct,_t)};function Ze(E,F,H){E.transparent===!0&&E.side===vn&&E.forceSinglePass===!1?(E.side=Bt,E.needsUpdate=!0,ns(E,F,H),E.side=Fn,E.needsUpdate=!0,ns(E,F,H),E.side=vn):ns(E,F,H)}this.compile=function(E,F,H=null){H===null&&(H=E),h=Ce.get(H),h.init(),x.push(h),H.traverseVisible(function(k){k.isLight&&k.layers.test(F.layers)&&(h.pushLight(k),k.castShadow&&h.pushShadow(k))}),E!==H&&E.traverseVisible(function(k){k.isLight&&k.layers.test(F.layers)&&(h.pushLight(k),k.castShadow&&h.pushShadow(k))}),h.setupLights(v._useLegacyLights);const V=new Set;return E.traverse(function(k){const me=k.material;if(me)if(Array.isArray(me))for(let be=0;be<me.length;be++){const Le=me[be];Ze(Le,H,k),V.add(Le)}else Ze(me,H,k),V.add(me)}),x.pop(),h=null,V},this.compileAsync=function(E,F,H=null){const V=this.compile(E,F,H);return new Promise(k=>{function me(){if(V.forEach(function(be){Fe.get(be).currentProgram.isReady()&&V.delete(be)}),V.size===0){k(E);return}setTimeout(me,10)}Te.get("KHR_parallel_shader_compile")!==null?me():setTimeout(me,10)})};let Qe=null;function gt(E){Qe&&Qe(E)}function Ct(){Lt.stop()}function it(){Lt.start()}const Lt=new nc;Lt.setAnimationLoop(gt),typeof self<"u"&&Lt.setContext(self),this.setAnimationLoop=function(E){Qe=E,ke.setAnimationLoop(E),E===null?Lt.stop():Lt.start()},ke.addEventListener("sessionstart",Ct),ke.addEventListener("sessionend",it),this.render=function(E,F){if(F!==void 0&&F.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(T===!0)return;E.matrixWorldAutoUpdate===!0&&E.updateMatrixWorld(),F.parent===null&&F.matrixWorldAutoUpdate===!0&&F.updateMatrixWorld(),ke.enabled===!0&&ke.isPresenting===!0&&(ke.cameraAutoUpdate===!0&&ke.updateCamera(F),F=ke.getCamera()),E.isScene===!0&&E.onBeforeRender(v,E,F,w),h=Ce.get(E,x.length),h.init(),x.push(h),Me.multiplyMatrices(F.projectionMatrix,F.matrixWorldInverse),X.setFromProjectionMatrix(Me),fe=this.localClippingEnabled,ee=Be.init(this.clippingPlanes,fe),_=_e.get(E,d.length),_.init(),d.push(_),on(E,F,0,v.sortObjects),_.finish(),v.sortObjects===!0&&_.sort(q,$),this.info.render.frame++,ee===!0&&Be.beginShadows();const H=h.state.shadowsArray;if(te.render(H,E,F),ee===!0&&Be.endShadows(),this.info.autoReset===!0&&this.info.reset(),Ye.render(_,E),h.setupLights(v._useLegacyLights),F.isArrayCamera){const V=F.cameras;for(let k=0,me=V.length;k<me;k++){const be=V[k];Sa(_,E,be,be.viewport)}}else Sa(_,E,F);w!==null&&(b.updateMultisampleRenderTarget(w),b.updateRenderTargetMipmap(w)),E.isScene===!0&&E.onAfterRender(v,E,F),Se.resetDefaultState(),I=-1,M=null,x.pop(),x.length>0?h=x[x.length-1]:h=null,d.pop(),d.length>0?_=d[d.length-1]:_=null};function on(E,F,H,V){if(E.visible===!1)return;if(E.layers.test(F.layers)){if(E.isGroup)H=E.renderOrder;else if(E.isLOD)E.autoUpdate===!0&&E.update(F);else if(E.isLight)h.pushLight(E),E.castShadow&&h.pushShadow(E);else if(E.isSprite){if(!E.frustumCulled||X.intersectsSprite(E)){V&&Ne.setFromMatrixPosition(E.matrixWorld).applyMatrix4(Me);const be=ie.update(E),Le=E.material;Le.visible&&_.push(E,be,Le,H,Ne.z,null)}}else if((E.isMesh||E.isLine||E.isPoints)&&(!E.frustumCulled||X.intersectsObject(E))){const be=ie.update(E),Le=E.material;if(V&&(E.boundingSphere!==void 0?(E.boundingSphere===null&&E.computeBoundingSphere(),Ne.copy(E.boundingSphere.center)):(be.boundingSphere===null&&be.computeBoundingSphere(),Ne.copy(be.boundingSphere.center)),Ne.applyMatrix4(E.matrixWorld).applyMatrix4(Me)),Array.isArray(Le)){const Ue=be.groups;for(let He=0,Oe=Ue.length;He<Oe;He++){const ze=Ue[He],ct=Le[ze.materialIndex];ct&&ct.visible&&_.push(E,be,ct,H,Ne.z,ze)}}else Le.visible&&_.push(E,be,Le,H,Ne.z,null)}}const me=E.children;for(let be=0,Le=me.length;be<Le;be++)on(me[be],F,H,V)}function Sa(E,F,H,V){const k=E.opaque,me=E.transmissive,be=E.transparent;h.setupLightsView(H),ee===!0&&Be.setGlobalState(v.clippingPlanes,H),me.length>0&&bc(k,me,F,H),V&&ve.viewport(y.copy(V)),k.length>0&&ts(k,F,H),me.length>0&&ts(me,F,H),be.length>0&&ts(be,F,H),ve.buffers.depth.setTest(!0),ve.buffers.depth.setMask(!0),ve.buffers.color.setMask(!0),ve.setPolygonOffset(!1)}function bc(E,F,H,V){if((H.isScene===!0?H.overrideMaterial:null)!==null)return;const me=De.isWebGL2;ye===null&&(ye=new On(1,1,{generateMipmaps:!0,type:Te.has("EXT_color_buffer_half_float")?Ai:Nn,minFilter:Wi,samples:me?4:0})),v.getDrawingBufferSize(Ie),me?ye.setSize(Ie.x,Ie.y):ye.setSize(Vr(Ie.x),Vr(Ie.y));const be=v.getRenderTarget();v.setRenderTarget(ye),v.getClearColor(Y),L=v.getClearAlpha(),L<1&&v.setClearColor(16777215,.5),v.clear();const Le=v.toneMapping;v.toneMapping=In,ts(E,H,V),b.updateMultisampleRenderTarget(ye),b.updateRenderTargetMipmap(ye);let Ue=!1;for(let He=0,Oe=F.length;He<Oe;He++){const ze=F[He],ct=ze.object,zt=ze.geometry,_t=ze.material,dn=ze.group;if(_t.side===vn&&ct.layers.test(V.layers)){const ot=_t.side;_t.side=Bt,_t.needsUpdate=!0,ya(ct,H,V,zt,_t,dn),_t.side=ot,_t.needsUpdate=!0,Ue=!0}}Ue===!0&&(b.updateMultisampleRenderTarget(ye),b.updateRenderTargetMipmap(ye)),v.setRenderTarget(be),v.setClearColor(Y,L),v.toneMapping=Le}function ts(E,F,H){const V=F.isScene===!0?F.overrideMaterial:null;for(let k=0,me=E.length;k<me;k++){const be=E[k],Le=be.object,Ue=be.geometry,He=V===null?be.material:V,Oe=be.group;Le.layers.test(H.layers)&&ya(Le,F,H,Ue,He,Oe)}}function ya(E,F,H,V,k,me){E.onBeforeRender(v,F,H,V,k,me),E.modelViewMatrix.multiplyMatrices(H.matrixWorldInverse,E.matrixWorld),E.normalMatrix.getNormalMatrix(E.modelViewMatrix),k.onBeforeRender(v,F,H,V,E,me),k.transparent===!0&&k.side===vn&&k.forceSinglePass===!1?(k.side=Bt,k.needsUpdate=!0,v.renderBufferDirect(H,F,V,k,E,me),k.side=Fn,k.needsUpdate=!0,v.renderBufferDirect(H,F,V,k,E,me),k.side=vn):v.renderBufferDirect(H,F,V,k,E,me),E.onAfterRender(v,F,H,V,k,me)}function ns(E,F,H){F.isScene!==!0&&(F=Re);const V=Fe.get(E),k=h.state.lights,me=h.state.shadowsArray,be=k.state.version,Le=xe.getParameters(E,k.state,me,F,H),Ue=xe.getProgramCacheKey(Le);let He=V.programs;V.environment=E.isMeshStandardMaterial?F.environment:null,V.fog=F.fog,V.envMap=(E.isMeshStandardMaterial?G:S).get(E.envMap||V.environment),He===void 0&&(E.addEventListener("dispose",le),He=new Map,V.programs=He);let Oe=He.get(Ue);if(Oe!==void 0){if(V.currentProgram===Oe&&V.lightsStateVersion===be)return ba(E,Le),Oe}else Le.uniforms=xe.getUniforms(E),E.onBuild(H,Le,v),E.onBeforeCompile(Le,v),Oe=xe.acquireProgram(Le,Ue),He.set(Ue,Oe),V.uniforms=Le.uniforms;const ze=V.uniforms;return(!E.isShaderMaterial&&!E.isRawShaderMaterial||E.clipping===!0)&&(ze.clippingPlanes=Be.uniform),ba(E,Le),V.needsLights=wc(E),V.lightsStateVersion=be,V.needsLights&&(ze.ambientLightColor.value=k.state.ambient,ze.lightProbe.value=k.state.probe,ze.directionalLights.value=k.state.directional,ze.directionalLightShadows.value=k.state.directionalShadow,ze.spotLights.value=k.state.spot,ze.spotLightShadows.value=k.state.spotShadow,ze.rectAreaLights.value=k.state.rectArea,ze.ltc_1.value=k.state.rectAreaLTC1,ze.ltc_2.value=k.state.rectAreaLTC2,ze.pointLights.value=k.state.point,ze.pointLightShadows.value=k.state.pointShadow,ze.hemisphereLights.value=k.state.hemi,ze.directionalShadowMap.value=k.state.directionalShadowMap,ze.directionalShadowMatrix.value=k.state.directionalShadowMatrix,ze.spotShadowMap.value=k.state.spotShadowMap,ze.spotLightMatrix.value=k.state.spotLightMatrix,ze.spotLightMap.value=k.state.spotLightMap,ze.pointShadowMap.value=k.state.pointShadowMap,ze.pointShadowMatrix.value=k.state.pointShadowMatrix),V.currentProgram=Oe,V.uniformsList=null,Oe}function Ea(E){if(E.uniformsList===null){const F=E.currentProgram.getUniforms();E.uniformsList=Cs.seqWithValue(F.seq,E.uniforms)}return E.uniformsList}function ba(E,F){const H=Fe.get(E);H.outputColorSpace=F.outputColorSpace,H.batching=F.batching,H.instancing=F.instancing,H.instancingColor=F.instancingColor,H.skinning=F.skinning,H.morphTargets=F.morphTargets,H.morphNormals=F.morphNormals,H.morphColors=F.morphColors,H.morphTargetsCount=F.morphTargetsCount,H.numClippingPlanes=F.numClippingPlanes,H.numIntersection=F.numClipIntersection,H.vertexAlphas=F.vertexAlphas,H.vertexTangents=F.vertexTangents,H.toneMapping=F.toneMapping}function Tc(E,F,H,V,k){F.isScene!==!0&&(F=Re),b.resetTextureUnits();const me=F.fog,be=V.isMeshStandardMaterial?F.environment:null,Le=w===null?v.outputColorSpace:w.isXRRenderTarget===!0?w.texture.colorSpace:yn,Ue=(V.isMeshStandardMaterial?G:S).get(V.envMap||be),He=V.vertexColors===!0&&!!H.attributes.color&&H.attributes.color.itemSize===4,Oe=!!H.attributes.tangent&&(!!V.normalMap||V.anisotropy>0),ze=!!H.morphAttributes.position,ct=!!H.morphAttributes.normal,zt=!!H.morphAttributes.color;let _t=In;V.toneMapped&&(w===null||w.isXRRenderTarget===!0)&&(_t=v.toneMapping);const dn=H.morphAttributes.position||H.morphAttributes.normal||H.morphAttributes.color,ot=dn!==void 0?dn.length:0,We=Fe.get(V),qs=h.state.lights;if(ee===!0&&(fe===!0||E!==M)){const Vt=E===M&&V.id===I;Be.setState(V,E,Vt)}let lt=!1;V.version===We.__version?(We.needsLights&&We.lightsStateVersion!==qs.state.version||We.outputColorSpace!==Le||k.isBatchedMesh&&We.batching===!1||!k.isBatchedMesh&&We.batching===!0||k.isInstancedMesh&&We.instancing===!1||!k.isInstancedMesh&&We.instancing===!0||k.isSkinnedMesh&&We.skinning===!1||!k.isSkinnedMesh&&We.skinning===!0||k.isInstancedMesh&&We.instancingColor===!0&&k.instanceColor===null||k.isInstancedMesh&&We.instancingColor===!1&&k.instanceColor!==null||We.envMap!==Ue||V.fog===!0&&We.fog!==me||We.numClippingPlanes!==void 0&&(We.numClippingPlanes!==Be.numPlanes||We.numIntersection!==Be.numIntersection)||We.vertexAlphas!==He||We.vertexTangents!==Oe||We.morphTargets!==ze||We.morphNormals!==ct||We.morphColors!==zt||We.toneMapping!==_t||De.isWebGL2===!0&&We.morphTargetsCount!==ot)&&(lt=!0):(lt=!0,We.__version=V.version);let Bn=We.currentProgram;lt===!0&&(Bn=ns(V,F,k));let Ta=!1,Di=!1,Ys=!1;const bt=Bn.getUniforms(),zn=We.uniforms;if(ve.useProgram(Bn.program)&&(Ta=!0,Di=!0,Ys=!0),V.id!==I&&(I=V.id,Di=!0),Ta||M!==E){bt.setValue(z,"projectionMatrix",E.projectionMatrix),bt.setValue(z,"viewMatrix",E.matrixWorldInverse);const Vt=bt.map.cameraPosition;Vt!==void 0&&Vt.setValue(z,Ne.setFromMatrixPosition(E.matrixWorld)),De.logarithmicDepthBuffer&&bt.setValue(z,"logDepthBufFC",2/(Math.log(E.far+1)/Math.LN2)),(V.isMeshPhongMaterial||V.isMeshToonMaterial||V.isMeshLambertMaterial||V.isMeshBasicMaterial||V.isMeshStandardMaterial||V.isShaderMaterial)&&bt.setValue(z,"isOrthographic",E.isOrthographicCamera===!0),M!==E&&(M=E,Di=!0,Ys=!0)}if(k.isSkinnedMesh){bt.setOptional(z,k,"bindMatrix"),bt.setOptional(z,k,"bindMatrixInverse");const Vt=k.skeleton;Vt&&(De.floatVertexTextures?(Vt.boneTexture===null&&Vt.computeBoneTexture(),bt.setValue(z,"boneTexture",Vt.boneTexture,b)):console.warn("THREE.WebGLRenderer: SkinnedMesh can only be used with WebGL 2. With WebGL 1 OES_texture_float and vertex textures support is required."))}k.isBatchedMesh&&(bt.setOptional(z,k,"batchingTexture"),bt.setValue(z,"batchingTexture",k._matricesTexture,b));const js=H.morphAttributes;if((js.position!==void 0||js.normal!==void 0||js.color!==void 0&&De.isWebGL2===!0)&&C.update(k,H,Bn),(Di||We.receiveShadow!==k.receiveShadow)&&(We.receiveShadow=k.receiveShadow,bt.setValue(z,"receiveShadow",k.receiveShadow)),V.isMeshGouraudMaterial&&V.envMap!==null&&(zn.envMap.value=Ue,zn.flipEnvMap.value=Ue.isCubeTexture&&Ue.isRenderTargetTexture===!1?-1:1),Di&&(bt.setValue(z,"toneMappingExposure",v.toneMappingExposure),We.needsLights&&Ac(zn,Ys),me&&V.fog===!0&&he.refreshFogUniforms(zn,me),he.refreshMaterialUniforms(zn,V,j,W,ye),Cs.upload(z,Ea(We),zn,b)),V.isShaderMaterial&&V.uniformsNeedUpdate===!0&&(Cs.upload(z,Ea(We),zn,b),V.uniformsNeedUpdate=!1),V.isSpriteMaterial&&bt.setValue(z,"center",k.center),bt.setValue(z,"modelViewMatrix",k.modelViewMatrix),bt.setValue(z,"normalMatrix",k.normalMatrix),bt.setValue(z,"modelMatrix",k.matrixWorld),V.isShaderMaterial||V.isRawShaderMaterial){const Vt=V.uniformsGroups;for(let Ks=0,Rc=Vt.length;Ks<Rc;Ks++)if(De.isWebGL2){const Aa=Vt[Ks];Ve.update(Aa,Bn),Ve.bind(Aa,Bn)}else console.warn("THREE.WebGLRenderer: Uniform Buffer Objects can only be used with WebGL 2.")}return Bn}function Ac(E,F){E.ambientLightColor.needsUpdate=F,E.lightProbe.needsUpdate=F,E.directionalLights.needsUpdate=F,E.directionalLightShadows.needsUpdate=F,E.pointLights.needsUpdate=F,E.pointLightShadows.needsUpdate=F,E.spotLights.needsUpdate=F,E.spotLightShadows.needsUpdate=F,E.rectAreaLights.needsUpdate=F,E.hemisphereLights.needsUpdate=F}function wc(E){return E.isMeshLambertMaterial||E.isMeshToonMaterial||E.isMeshPhongMaterial||E.isMeshStandardMaterial||E.isShadowMaterial||E.isShaderMaterial&&E.lights===!0}this.getActiveCubeFace=function(){return D},this.getActiveMipmapLevel=function(){return A},this.getRenderTarget=function(){return w},this.setRenderTargetTextures=function(E,F,H){Fe.get(E.texture).__webglTexture=F,Fe.get(E.depthTexture).__webglTexture=H;const V=Fe.get(E);V.__hasExternalTextures=!0,V.__hasExternalTextures&&(V.__autoAllocateDepthBuffer=H===void 0,V.__autoAllocateDepthBuffer||Te.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),V.__useRenderToTexture=!1))},this.setRenderTargetFramebuffer=function(E,F){const H=Fe.get(E);H.__webglFramebuffer=F,H.__useDefaultFramebuffer=F===void 0},this.setRenderTarget=function(E,F=0,H=0){w=E,D=F,A=H;let V=!0,k=null,me=!1,be=!1;if(E){const Ue=Fe.get(E);Ue.__useDefaultFramebuffer!==void 0?(ve.bindFramebuffer(z.FRAMEBUFFER,null),V=!1):Ue.__webglFramebuffer===void 0?b.setupRenderTarget(E):Ue.__hasExternalTextures&&b.rebindTextures(E,Fe.get(E.texture).__webglTexture,Fe.get(E.depthTexture).__webglTexture);const He=E.texture;(He.isData3DTexture||He.isDataArrayTexture||He.isCompressedArrayTexture)&&(be=!0);const Oe=Fe.get(E).__webglFramebuffer;E.isWebGLCubeRenderTarget?(Array.isArray(Oe[F])?k=Oe[F][H]:k=Oe[F],me=!0):De.isWebGL2&&E.samples>0&&b.useMultisampledRTT(E)===!1?k=Fe.get(E).__webglMultisampledFramebuffer:Array.isArray(Oe)?k=Oe[H]:k=Oe,y.copy(E.viewport),U.copy(E.scissor),B=E.scissorTest}else y.copy(Q).multiplyScalar(j).floor(),U.copy(re).multiplyScalar(j).floor(),B=pe;if(ve.bindFramebuffer(z.FRAMEBUFFER,k)&&De.drawBuffers&&V&&ve.drawBuffers(E,k),ve.viewport(y),ve.scissor(U),ve.setScissorTest(B),me){const Ue=Fe.get(E.texture);z.framebufferTexture2D(z.FRAMEBUFFER,z.COLOR_ATTACHMENT0,z.TEXTURE_CUBE_MAP_POSITIVE_X+F,Ue.__webglTexture,H)}else if(be){const Ue=Fe.get(E.texture),He=F||0;z.framebufferTextureLayer(z.FRAMEBUFFER,z.COLOR_ATTACHMENT0,Ue.__webglTexture,H||0,He)}I=-1},this.readRenderTargetPixels=function(E,F,H,V,k,me,be){if(!(E&&E.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Le=Fe.get(E).__webglFramebuffer;if(E.isWebGLCubeRenderTarget&&be!==void 0&&(Le=Le[be]),Le){ve.bindFramebuffer(z.FRAMEBUFFER,Le);try{const Ue=E.texture,He=Ue.format,Oe=Ue.type;if(He!==sn&&ae.convert(He)!==z.getParameter(z.IMPLEMENTATION_COLOR_READ_FORMAT)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}const ze=Oe===Ai&&(Te.has("EXT_color_buffer_half_float")||De.isWebGL2&&Te.has("EXT_color_buffer_float"));if(Oe!==Nn&&ae.convert(Oe)!==z.getParameter(z.IMPLEMENTATION_COLOR_READ_TYPE)&&!(Oe===Un&&(De.isWebGL2||Te.has("OES_texture_float")||Te.has("WEBGL_color_buffer_float")))&&!ze){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}F>=0&&F<=E.width-V&&H>=0&&H<=E.height-k&&z.readPixels(F,H,V,k,ae.convert(He),ae.convert(Oe),me)}finally{const Ue=w!==null?Fe.get(w).__webglFramebuffer:null;ve.bindFramebuffer(z.FRAMEBUFFER,Ue)}}},this.copyFramebufferToTexture=function(E,F,H=0){const V=Math.pow(2,-H),k=Math.floor(F.image.width*V),me=Math.floor(F.image.height*V);b.setTexture2D(F,0),z.copyTexSubImage2D(z.TEXTURE_2D,H,0,0,E.x,E.y,k,me),ve.unbindTexture()},this.copyTextureToTexture=function(E,F,H,V=0){const k=F.image.width,me=F.image.height,be=ae.convert(H.format),Le=ae.convert(H.type);b.setTexture2D(H,0),z.pixelStorei(z.UNPACK_FLIP_Y_WEBGL,H.flipY),z.pixelStorei(z.UNPACK_PREMULTIPLY_ALPHA_WEBGL,H.premultiplyAlpha),z.pixelStorei(z.UNPACK_ALIGNMENT,H.unpackAlignment),F.isDataTexture?z.texSubImage2D(z.TEXTURE_2D,V,E.x,E.y,k,me,be,Le,F.image.data):F.isCompressedTexture?z.compressedTexSubImage2D(z.TEXTURE_2D,V,E.x,E.y,F.mipmaps[0].width,F.mipmaps[0].height,be,F.mipmaps[0].data):z.texSubImage2D(z.TEXTURE_2D,V,E.x,E.y,be,Le,F.image),V===0&&H.generateMipmaps&&z.generateMipmap(z.TEXTURE_2D),ve.unbindTexture()},this.copyTextureToTexture3D=function(E,F,H,V,k=0){if(v.isWebGL1Renderer){console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: can only be used with WebGL2.");return}const me=E.max.x-E.min.x+1,be=E.max.y-E.min.y+1,Le=E.max.z-E.min.z+1,Ue=ae.convert(V.format),He=ae.convert(V.type);let Oe;if(V.isData3DTexture)b.setTexture3D(V,0),Oe=z.TEXTURE_3D;else if(V.isDataArrayTexture||V.isCompressedArrayTexture)b.setTexture2DArray(V,0),Oe=z.TEXTURE_2D_ARRAY;else{console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: only supports THREE.DataTexture3D and THREE.DataTexture2DArray.");return}z.pixelStorei(z.UNPACK_FLIP_Y_WEBGL,V.flipY),z.pixelStorei(z.UNPACK_PREMULTIPLY_ALPHA_WEBGL,V.premultiplyAlpha),z.pixelStorei(z.UNPACK_ALIGNMENT,V.unpackAlignment);const ze=z.getParameter(z.UNPACK_ROW_LENGTH),ct=z.getParameter(z.UNPACK_IMAGE_HEIGHT),zt=z.getParameter(z.UNPACK_SKIP_PIXELS),_t=z.getParameter(z.UNPACK_SKIP_ROWS),dn=z.getParameter(z.UNPACK_SKIP_IMAGES),ot=H.isCompressedTexture?H.mipmaps[k]:H.image;z.pixelStorei(z.UNPACK_ROW_LENGTH,ot.width),z.pixelStorei(z.UNPACK_IMAGE_HEIGHT,ot.height),z.pixelStorei(z.UNPACK_SKIP_PIXELS,E.min.x),z.pixelStorei(z.UNPACK_SKIP_ROWS,E.min.y),z.pixelStorei(z.UNPACK_SKIP_IMAGES,E.min.z),H.isDataTexture||H.isData3DTexture?z.texSubImage3D(Oe,k,F.x,F.y,F.z,me,be,Le,Ue,He,ot.data):H.isCompressedArrayTexture?(console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: untested support for compressed srcTexture."),z.compressedTexSubImage3D(Oe,k,F.x,F.y,F.z,me,be,Le,Ue,ot.data)):z.texSubImage3D(Oe,k,F.x,F.y,F.z,me,be,Le,Ue,He,ot),z.pixelStorei(z.UNPACK_ROW_LENGTH,ze),z.pixelStorei(z.UNPACK_IMAGE_HEIGHT,ct),z.pixelStorei(z.UNPACK_SKIP_PIXELS,zt),z.pixelStorei(z.UNPACK_SKIP_ROWS,_t),z.pixelStorei(z.UNPACK_SKIP_IMAGES,dn),k===0&&V.generateMipmaps&&z.generateMipmap(Oe),ve.unbindTexture()},this.initTexture=function(E){E.isCubeTexture?b.setTextureCube(E,0):E.isData3DTexture?b.setTexture3D(E,0):E.isDataArrayTexture||E.isCompressedArrayTexture?b.setTexture2DArray(E,0):b.setTexture2D(E,0),ve.unbindTexture()},this.resetState=function(){D=0,A=0,w=null,ve.reset(),Se.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return xn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const t=this.getContext();t.drawingBufferColorSpace=e===aa?"display-p3":"srgb",t.unpackColorSpace=nt.workingColorSpace===zs?"display-p3":"srgb"}get outputEncoding(){return console.warn("THREE.WebGLRenderer: Property .outputEncoding has been removed. Use .outputColorSpace instead."),this.outputColorSpace===St?Kn:Hl}set outputEncoding(e){console.warn("THREE.WebGLRenderer: Property .outputEncoding has been removed. Use .outputColorSpace instead."),this.outputColorSpace=e===Kn?St:yn}get useLegacyLights(){return console.warn("THREE.WebGLRenderer: The property .useLegacyLights has been deprecated. Migrate your lighting according to the following guide: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733."),this._useLegacyLights}set useLegacyLights(e){console.warn("THREE.WebGLRenderer: The property .useLegacyLights has been deprecated. Migrate your lighting according to the following guide: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733."),this._useLegacyLights=e}}class yg extends cc{}yg.prototype.isWebGL1Renderer=!0;class Eg extends Et{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t}}class rn extends Kt{constructor(e=1,t=1,n=1,s=32,r=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:s,heightSegments:r,openEnded:o,thetaStart:a,thetaLength:l};const c=this;s=Math.floor(s),r=Math.floor(r);const u=[],f=[],p=[],m=[];let g=0;const _=[],h=n/2;let d=0;x(),o===!1&&(e>0&&v(!0),t>0&&v(!1)),this.setIndex(u),this.setAttribute("position",new ut(f,3)),this.setAttribute("normal",new ut(p,3)),this.setAttribute("uv",new ut(m,2));function x(){const T=new N,D=new N;let A=0;const w=(t-e)/n;for(let I=0;I<=r;I++){const M=[],y=I/r,U=y*(t-e)+e;for(let B=0;B<=s;B++){const Y=B/s,L=Y*l+a,O=Math.sin(L),W=Math.cos(L);D.x=U*O,D.y=-y*n+h,D.z=U*W,f.push(D.x,D.y,D.z),T.set(O,w,W).normalize(),p.push(T.x,T.y,T.z),m.push(Y,1-y),M.push(g++)}_.push(M)}for(let I=0;I<s;I++)for(let M=0;M<r;M++){const y=_[M][I],U=_[M+1][I],B=_[M+1][I+1],Y=_[M][I+1];u.push(y,U,Y),u.push(U,B,Y),A+=6}c.addGroup(d,A,0),d+=A}function v(T){const D=g,A=new Ae,w=new N;let I=0;const M=T===!0?e:t,y=T===!0?1:-1;for(let B=1;B<=s;B++)f.push(0,h*y,0),p.push(0,y,0),m.push(.5,.5),g++;const U=g;for(let B=0;B<=s;B++){const L=B/s*l+a,O=Math.cos(L),W=Math.sin(L);w.x=M*W,w.y=h*y,w.z=M*O,f.push(w.x,w.y,w.z),p.push(0,y,0),A.x=O*.5+.5,A.y=W*.5*y+.5,m.push(A.x,A.y),g++}for(let B=0;B<s;B++){const Y=D+B,L=U+B;T===!0?u.push(L,L+1,Y):u.push(L+1,L,Y),I+=3}c.addGroup(d,I,T===!0?1:2),d+=I}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new rn(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class an extends rn{constructor(e=1,t=1,n=32,s=1,r=!1,o=0,a=Math.PI*2){super(0,e,t,n,s,r,o,a),this.type="ConeGeometry",this.parameters={radius:e,height:t,radialSegments:n,heightSegments:s,openEnded:r,thetaStart:o,thetaLength:a}}static fromJSON(e){return new an(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class Ws extends Kt{constructor(e=[],t=[],n=1,s=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:s};const r=[],o=[];a(s),c(n),u(),this.setAttribute("position",new ut(r,3)),this.setAttribute("normal",new ut(r.slice(),3)),this.setAttribute("uv",new ut(o,2)),s===0?this.computeVertexNormals():this.normalizeNormals();function a(x){const v=new N,T=new N,D=new N;for(let A=0;A<t.length;A+=3)m(t[A+0],v),m(t[A+1],T),m(t[A+2],D),l(v,T,D,x)}function l(x,v,T,D){const A=D+1,w=[];for(let I=0;I<=A;I++){w[I]=[];const M=x.clone().lerp(T,I/A),y=v.clone().lerp(T,I/A),U=A-I;for(let B=0;B<=U;B++)B===0&&I===A?w[I][B]=M:w[I][B]=M.clone().lerp(y,B/U)}for(let I=0;I<A;I++)for(let M=0;M<2*(A-I)-1;M++){const y=Math.floor(M/2);M%2===0?(p(w[I][y+1]),p(w[I+1][y]),p(w[I][y])):(p(w[I][y+1]),p(w[I+1][y+1]),p(w[I+1][y]))}}function c(x){const v=new N;for(let T=0;T<r.length;T+=3)v.x=r[T+0],v.y=r[T+1],v.z=r[T+2],v.normalize().multiplyScalar(x),r[T+0]=v.x,r[T+1]=v.y,r[T+2]=v.z}function u(){const x=new N;for(let v=0;v<r.length;v+=3){x.x=r[v+0],x.y=r[v+1],x.z=r[v+2];const T=h(x)/2/Math.PI+.5,D=d(x)/Math.PI+.5;o.push(T,1-D)}g(),f()}function f(){for(let x=0;x<o.length;x+=6){const v=o[x+0],T=o[x+2],D=o[x+4],A=Math.max(v,T,D),w=Math.min(v,T,D);A>.9&&w<.1&&(v<.2&&(o[x+0]+=1),T<.2&&(o[x+2]+=1),D<.2&&(o[x+4]+=1))}}function p(x){r.push(x.x,x.y,x.z)}function m(x,v){const T=x*3;v.x=e[T+0],v.y=e[T+1],v.z=e[T+2]}function g(){const x=new N,v=new N,T=new N,D=new N,A=new Ae,w=new Ae,I=new Ae;for(let M=0,y=0;M<r.length;M+=9,y+=6){x.set(r[M+0],r[M+1],r[M+2]),v.set(r[M+3],r[M+4],r[M+5]),T.set(r[M+6],r[M+7],r[M+8]),A.set(o[y+0],o[y+1]),w.set(o[y+2],o[y+3]),I.set(o[y+4],o[y+5]),D.copy(x).add(v).add(T).divideScalar(3);const U=h(D);_(A,y+0,x,U),_(w,y+2,v,U),_(I,y+4,T,U)}}function _(x,v,T,D){D<0&&x.x===1&&(o[v]=x.x-1),T.x===0&&T.z===0&&(o[v]=D/2/Math.PI+.5)}function h(x){return Math.atan2(x.z,-x.x)}function d(x){return Math.atan2(-x.y,Math.sqrt(x.x*x.x+x.z*x.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Ws(e.vertices,e.indices,e.radius,e.details)}}class ha extends Ws{constructor(e=1,t=0){const n=(1+Math.sqrt(5))/2,s=1/n,r=[-1,-1,-1,-1,-1,1,-1,1,-1,-1,1,1,1,-1,-1,1,-1,1,1,1,-1,1,1,1,0,-s,-n,0,-s,n,0,s,-n,0,s,n,-s,-n,0,-s,n,0,s,-n,0,s,n,0,-n,0,-s,n,0,-s,-n,0,s,n,0,s],o=[3,11,7,3,7,15,3,15,13,7,19,17,7,17,6,7,6,15,17,4,8,17,8,10,17,10,6,8,0,16,8,16,2,8,2,10,0,12,1,0,1,18,0,18,16,6,10,2,6,2,13,6,13,15,2,16,18,2,18,3,2,3,13,18,1,9,18,9,11,18,11,3,4,14,12,4,12,0,4,0,8,11,9,5,11,5,19,11,19,7,19,5,14,19,14,4,19,4,17,1,12,14,1,14,5,1,5,9];super(r,o,e,t),this.type="DodecahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new ha(e.radius,e.detail)}}class fa extends Ws{constructor(e=1,t=0){const n=(1+Math.sqrt(5))/2,s=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(s,r,e,t),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new fa(e.radius,e.detail)}}class Ki extends Kt{constructor(e=1,t=32,n=16,s=0,r=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:s,phiLength:r,thetaStart:o,thetaLength:a},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));const l=Math.min(o+a,Math.PI);let c=0;const u=[],f=new N,p=new N,m=[],g=[],_=[],h=[];for(let d=0;d<=n;d++){const x=[],v=d/n;let T=0;d===0&&o===0?T=.5/t:d===n&&l===Math.PI&&(T=-.5/t);for(let D=0;D<=t;D++){const A=D/t;f.x=-e*Math.cos(s+A*r)*Math.sin(o+v*a),f.y=e*Math.cos(o+v*a),f.z=e*Math.sin(s+A*r)*Math.sin(o+v*a),g.push(f.x,f.y,f.z),p.copy(f).normalize(),_.push(p.x,p.y,p.z),h.push(A+T,1-v),x.push(c++)}u.push(x)}for(let d=0;d<n;d++)for(let x=0;x<t;x++){const v=u[d][x+1],T=u[d][x],D=u[d+1][x],A=u[d+1][x+1];(d!==0||o>0)&&m.push(v,T,A),(d!==n-1||l<Math.PI)&&m.push(T,D,A)}this.setIndex(m),this.setAttribute("position",new ut(g,3)),this.setAttribute("normal",new ut(_,3)),this.setAttribute("uv",new ut(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Ki(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}}class Zi extends Kt{constructor(e=1,t=.4,n=12,s=48,r=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:t,radialSegments:n,tubularSegments:s,arc:r},n=Math.floor(n),s=Math.floor(s);const o=[],a=[],l=[],c=[],u=new N,f=new N,p=new N;for(let m=0;m<=n;m++)for(let g=0;g<=s;g++){const _=g/s*r,h=m/n*Math.PI*2;f.x=(e+t*Math.cos(h))*Math.cos(_),f.y=(e+t*Math.cos(h))*Math.sin(_),f.z=t*Math.sin(h),a.push(f.x,f.y,f.z),u.x=e*Math.cos(_),u.y=e*Math.sin(_),p.subVectors(f,u).normalize(),l.push(p.x,p.y,p.z),c.push(g/s),c.push(m/n)}for(let m=1;m<=n;m++)for(let g=1;g<=s;g++){const _=(s+1)*m+g-1,h=(s+1)*(m-1)+g-1,d=(s+1)*(m-1)+g,x=(s+1)*m+g;o.push(_,h,x),o.push(h,d,x)}this.setIndex(o),this.setAttribute("position",new ut(a,3)),this.setAttribute("normal",new ut(l,3)),this.setAttribute("uv",new ut(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Zi(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}}class bg extends Yi{constructor(e){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.type="MeshStandardMaterial",this.color=new $e(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new $e(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Vl,this.normalScale=new Ae(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class pa extends Et{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new $e(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),t}}class Tg extends pa{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Et.DEFAULT_UP),this.updateMatrix(),this.groundColor=new $e(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}}const Cr=new ht,Zo=new N,Jo=new N;class Ag{constructor(e){this.camera=e,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ae(512,512),this.map=null,this.mapPass=null,this.matrix=new ht,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ua,this._frameExtents=new Ae(1,1),this._viewportCount=1,this._viewports=[new xt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const t=this.camera,n=this.matrix;Zo.setFromMatrixPosition(e.matrixWorld),t.position.copy(Zo),Jo.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Jo),t.updateMatrixWorld(),Cr.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Cr),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Cr)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.bias=e.bias,this.radius=e.radius,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}class wg extends Ag{constructor(){super(new Hs(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class Qo extends pa{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Et.DEFAULT_UP),this.updateMatrix(),this.target=new Et,this.shadow=new wg}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}class Rg extends pa{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}}class Cg{constructor(e=!0){this.autoStart=e,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=el(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let e=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){const t=el();e=(t-this.oldTime)/1e3,this.oldTime=t,this.elapsedTime+=e}return e}}function el(){return(typeof performance>"u"?Date:performance).now()}class Lg{constructor(e,t,n=0,s=1/0){this.ray=new la(e,t),this.near=n,this.far=s,this.camera=null,this.layers=new ca,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):console.error("THREE.Raycaster: Unsupported camera type: "+t.type)}intersectObject(e,t=!0,n=[]){return Xr(e,this,n,t),n.sort(tl),n}intersectObjects(e,t=!0,n=[]){for(let s=0,r=e.length;s<r;s++)Xr(e[s],this,n,t);return n.sort(tl),n}}function tl(i,e){return i.distance-e.distance}function Xr(i,e,t,n){if(i.layers.test(e.layers)&&i.raycast(e,t),n===!0){const s=i.children;for(let r=0,o=s.length;r<o;r++)Xr(s[r],e,t,!0)}}class nl{constructor(e=1,t=0,n=0){return this.radius=e,this.phi=t,this.theta=n,this}set(e,t,n){return this.radius=e,this.phi=t,this.theta=n,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){return this.phi=Math.max(1e-6,Math.min(Math.PI-1e-6,this.phi)),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,t,n){return this.radius=Math.sqrt(e*e+t*t+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,n),this.phi=Math.acos(Ut(t/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:sa}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=sa);const R={renderer:null,scene:null,camera:null,controls:null,composer:null,passH:null,passV:null,sun:null,staticGroup:null,dynGroup:null,fxGroup:null,highlightGroup:null,terrGroup:null,waterMeshes:[],decoMeshes:[],tilePickMeshes:[],hovered:null,bobUnits:[],_fillGeo:null,_edgeGeoX:null,_edgeGeoZ:null,_tileGeo:null,_deco:null,_unitTpl:{},_cityTpl:{},_fillMat:{},_edgeMat:{},raycaster:new Lg,pointer:new Ae,panKeys:new Set,panV:null,panRamp:0,lastPanT:0,lastT:0,onClick:null},wt=1,Zn=.9,il=.015,sl={type:"change"},Lr={type:"start"},rl={type:"end"},Ts=new la,al=new Pn,Pg=Math.cos(70*gd.DEG2RAD);class Dg extends ei{constructor(e,t){super(),this.object=e,this.domElement=t,this.domElement.style.touchAction="none",this.enabled=!0,this.target=new N,this.cursor=new N,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:ti.ROTATE,MIDDLE:ti.DOLLY,RIGHT:ti.PAN},this.touches={ONE:Ln.ROTATE,TWO:Ln.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this.getPolarAngle=function(){return a.phi},this.getAzimuthalAngle=function(){return a.theta},this.getDistance=function(){return this.object.position.distanceTo(this.target)},this.listenToKeyEvents=function(C){C.addEventListener("keydown",ie),this._domElementKeyEvents=C},this.stopListenToKeyEvents=function(){this._domElementKeyEvents.removeEventListener("keydown",ie),this._domElementKeyEvents=null},this.saveState=function(){n.target0.copy(n.target),n.position0.copy(n.object.position),n.zoom0=n.object.zoom},this.reset=function(){n.target.copy(n.target0),n.object.position.copy(n.position0),n.object.zoom=n.zoom0,n.object.updateProjectionMatrix(),n.dispatchEvent(sl),n.update(),r=s.NONE},this.update=function(){const C=new N,J=new Jn().setFromUnitVectors(e.up,new N(0,1,0)),ue=J.clone().invert(),ae=new N,Se=new Jn,Ve=new N,je=2*Math.PI;return function(ce=null){const P=n.object.position;C.copy(P).sub(n.target),C.applyQuaternion(J),a.setFromVector3(C),n.autoRotate&&r===s.NONE&&U(M(ce)),n.enableDamping?(a.theta+=l.theta*n.dampingFactor,a.phi+=l.phi*n.dampingFactor):(a.theta+=l.theta,a.phi+=l.phi);let oe=n.minAzimuthAngle,le=n.maxAzimuthAngle;isFinite(oe)&&isFinite(le)&&(oe<-Math.PI?oe+=je:oe>Math.PI&&(oe-=je),le<-Math.PI?le+=je:le>Math.PI&&(le-=je),oe<=le?a.theta=Math.max(oe,Math.min(le,a.theta)):a.theta=a.theta>(oe+le)/2?Math.max(oe,a.theta):Math.min(le,a.theta)),a.phi=Math.max(n.minPolarAngle,Math.min(n.maxPolarAngle,a.phi)),a.makeSafe(),n.enableDamping===!0?n.target.addScaledVector(u,n.dampingFactor):n.target.add(u),n.target.sub(n.cursor),n.target.clampLength(n.minTargetRadius,n.maxTargetRadius),n.target.add(n.cursor),n.zoomToCursor&&A||n.object.isOrthographicCamera?a.radius=$(a.radius):a.radius=$(a.radius*c),C.setFromSpherical(a),C.applyQuaternion(ue),P.copy(n.target).add(C),n.object.lookAt(n.target),n.enableDamping===!0?(l.theta*=1-n.dampingFactor,l.phi*=1-n.dampingFactor,u.multiplyScalar(1-n.dampingFactor)):(l.set(0,0,0),u.set(0,0,0));let we=!1;if(n.zoomToCursor&&A){let Ee=null;if(n.object.isPerspectiveCamera){const Ze=C.length();Ee=$(Ze*c);const Qe=Ze-Ee;n.object.position.addScaledVector(T,Qe),n.object.updateMatrixWorld()}else if(n.object.isOrthographicCamera){const Ze=new N(D.x,D.y,0);Ze.unproject(n.object),n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/c)),n.object.updateProjectionMatrix(),we=!0;const Qe=new N(D.x,D.y,0);Qe.unproject(n.object),n.object.position.sub(Qe).add(Ze),n.object.updateMatrixWorld(),Ee=C.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),n.zoomToCursor=!1;Ee!==null&&(this.screenSpacePanning?n.target.set(0,0,-1).transformDirection(n.object.matrix).multiplyScalar(Ee).add(n.object.position):(Ts.origin.copy(n.object.position),Ts.direction.set(0,0,-1).transformDirection(n.object.matrix),Math.abs(n.object.up.dot(Ts.direction))<Pg?e.lookAt(n.target):(al.setFromNormalAndCoplanarPoint(n.object.up,n.target),Ts.intersectPlane(al,n.target))))}else n.object.isOrthographicCamera&&(n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/c)),n.object.updateProjectionMatrix(),we=!0);return c=1,A=!1,we||ae.distanceToSquared(n.object.position)>o||8*(1-Se.dot(n.object.quaternion))>o||Ve.distanceToSquared(n.target)>0?(n.dispatchEvent(sl),ae.copy(n.object.position),Se.copy(n.object.quaternion),Ve.copy(n.target),!0):!1}}(),this.dispose=function(){n.domElement.removeEventListener("contextmenu",_e),n.domElement.removeEventListener("pointerdown",Fe),n.domElement.removeEventListener("pointercancel",S),n.domElement.removeEventListener("wheel",ne),n.domElement.removeEventListener("pointermove",b),n.domElement.removeEventListener("pointerup",S),n._domElementKeyEvents!==null&&(n._domElementKeyEvents.removeEventListener("keydown",ie),n._domElementKeyEvents=null)};const n=this,s={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6};let r=s.NONE;const o=1e-6,a=new nl,l=new nl;let c=1;const u=new N,f=new Ae,p=new Ae,m=new Ae,g=new Ae,_=new Ae,h=new Ae,d=new Ae,x=new Ae,v=new Ae,T=new N,D=new Ae;let A=!1;const w=[],I={};function M(C){return C!==null?2*Math.PI/60*n.autoRotateSpeed*C:2*Math.PI/60/60*n.autoRotateSpeed}function y(C){const J=Math.abs(C)/(100*(window.devicePixelRatio|0));return Math.pow(.95,n.zoomSpeed*J)}function U(C){l.theta-=C}function B(C){l.phi-=C}const Y=function(){const C=new N;return function(ue,ae){C.setFromMatrixColumn(ae,0),C.multiplyScalar(-ue),u.add(C)}}(),L=function(){const C=new N;return function(ue,ae){n.screenSpacePanning===!0?C.setFromMatrixColumn(ae,1):(C.setFromMatrixColumn(ae,0),C.crossVectors(n.object.up,C)),C.multiplyScalar(ue),u.add(C)}}(),O=function(){const C=new N;return function(ue,ae){const Se=n.domElement;if(n.object.isPerspectiveCamera){const Ve=n.object.position;C.copy(Ve).sub(n.target);let je=C.length();je*=Math.tan(n.object.fov/2*Math.PI/180),Y(2*ue*je/Se.clientHeight,n.object.matrix),L(2*ae*je/Se.clientHeight,n.object.matrix)}else n.object.isOrthographicCamera?(Y(ue*(n.object.right-n.object.left)/n.object.zoom/Se.clientWidth,n.object.matrix),L(ae*(n.object.top-n.object.bottom)/n.object.zoom/Se.clientHeight,n.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),n.enablePan=!1)}}();function W(C){n.object.isPerspectiveCamera||n.object.isOrthographicCamera?c/=C:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),n.enableZoom=!1)}function j(C){n.object.isPerspectiveCamera||n.object.isOrthographicCamera?c*=C:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),n.enableZoom=!1)}function q(C,J){if(!n.zoomToCursor)return;A=!0;const ue=n.domElement.getBoundingClientRect(),ae=C-ue.left,Se=J-ue.top,Ve=ue.width,je=ue.height;D.x=ae/Ve*2-1,D.y=-(Se/je)*2+1,T.set(D.x,D.y,1).unproject(n.object).sub(n.object.position).normalize()}function $(C){return Math.max(n.minDistance,Math.min(n.maxDistance,C))}function Q(C){f.set(C.clientX,C.clientY)}function re(C){q(C.clientX,C.clientX),d.set(C.clientX,C.clientY)}function pe(C){g.set(C.clientX,C.clientY)}function X(C){p.set(C.clientX,C.clientY),m.subVectors(p,f).multiplyScalar(n.rotateSpeed);const J=n.domElement;U(2*Math.PI*m.x/J.clientHeight),B(2*Math.PI*m.y/J.clientHeight),f.copy(p),n.update()}function ee(C){x.set(C.clientX,C.clientY),v.subVectors(x,d),v.y>0?W(y(v.y)):v.y<0&&j(y(v.y)),d.copy(x),n.update()}function fe(C){_.set(C.clientX,C.clientY),h.subVectors(_,g).multiplyScalar(n.panSpeed),O(h.x,h.y),g.copy(_),n.update()}function ye(C){q(C.clientX,C.clientY),C.deltaY<0?j(y(C.deltaY)):C.deltaY>0&&W(y(C.deltaY)),n.update()}function Me(C){let J=!1;switch(C.code){case n.keys.UP:C.ctrlKey||C.metaKey||C.shiftKey?B(2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):O(0,n.keyPanSpeed),J=!0;break;case n.keys.BOTTOM:C.ctrlKey||C.metaKey||C.shiftKey?B(-2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):O(0,-n.keyPanSpeed),J=!0;break;case n.keys.LEFT:C.ctrlKey||C.metaKey||C.shiftKey?U(2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):O(n.keyPanSpeed,0),J=!0;break;case n.keys.RIGHT:C.ctrlKey||C.metaKey||C.shiftKey?U(-2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):O(-n.keyPanSpeed,0),J=!0;break}J&&(C.preventDefault(),n.update())}function Ie(C){if(w.length===1)f.set(C.pageX,C.pageY);else{const J=Ye(C),ue=.5*(C.pageX+J.x),ae=.5*(C.pageY+J.y);f.set(ue,ae)}}function Ne(C){if(w.length===1)g.set(C.pageX,C.pageY);else{const J=Ye(C),ue=.5*(C.pageX+J.x),ae=.5*(C.pageY+J.y);g.set(ue,ae)}}function Re(C){const J=Ye(C),ue=C.pageX-J.x,ae=C.pageY-J.y,Se=Math.sqrt(ue*ue+ae*ae);d.set(0,Se)}function qe(C){n.enableZoom&&Re(C),n.enablePan&&Ne(C)}function z(C){n.enableZoom&&Re(C),n.enableRotate&&Ie(C)}function mt(C){if(w.length==1)p.set(C.pageX,C.pageY);else{const ue=Ye(C),ae=.5*(C.pageX+ue.x),Se=.5*(C.pageY+ue.y);p.set(ae,Se)}m.subVectors(p,f).multiplyScalar(n.rotateSpeed);const J=n.domElement;U(2*Math.PI*m.x/J.clientHeight),B(2*Math.PI*m.y/J.clientHeight),f.copy(p)}function Te(C){if(w.length===1)_.set(C.pageX,C.pageY);else{const J=Ye(C),ue=.5*(C.pageX+J.x),ae=.5*(C.pageY+J.y);_.set(ue,ae)}h.subVectors(_,g).multiplyScalar(n.panSpeed),O(h.x,h.y),g.copy(_)}function De(C){const J=Ye(C),ue=C.pageX-J.x,ae=C.pageY-J.y,Se=Math.sqrt(ue*ue+ae*ae);x.set(0,Se),v.set(0,Math.pow(x.y/d.y,n.zoomSpeed)),W(v.y),d.copy(x);const Ve=(C.pageX+J.x)*.5,je=(C.pageY+J.y)*.5;q(Ve,je)}function ve(C){n.enableZoom&&De(C),n.enablePan&&Te(C)}function st(C){n.enableZoom&&De(C),n.enableRotate&&mt(C)}function Fe(C){n.enabled!==!1&&(w.length===0&&(n.domElement.setPointerCapture(C.pointerId),n.domElement.addEventListener("pointermove",b),n.domElement.addEventListener("pointerup",S)),Ce(C),C.pointerType==="touch"?xe(C):G(C))}function b(C){n.enabled!==!1&&(C.pointerType==="touch"?he(C):se(C))}function S(C){Be(C),w.length===0&&(n.domElement.releasePointerCapture(C.pointerId),n.domElement.removeEventListener("pointermove",b),n.domElement.removeEventListener("pointerup",S)),n.dispatchEvent(rl),r=s.NONE}function G(C){let J;switch(C.button){case 0:J=n.mouseButtons.LEFT;break;case 1:J=n.mouseButtons.MIDDLE;break;case 2:J=n.mouseButtons.RIGHT;break;default:J=-1}switch(J){case ti.DOLLY:if(n.enableZoom===!1)return;re(C),r=s.DOLLY;break;case ti.ROTATE:if(C.ctrlKey||C.metaKey||C.shiftKey){if(n.enablePan===!1)return;pe(C),r=s.PAN}else{if(n.enableRotate===!1)return;Q(C),r=s.ROTATE}break;case ti.PAN:if(C.ctrlKey||C.metaKey||C.shiftKey){if(n.enableRotate===!1)return;Q(C),r=s.ROTATE}else{if(n.enablePan===!1)return;pe(C),r=s.PAN}break;default:r=s.NONE}r!==s.NONE&&n.dispatchEvent(Lr)}function se(C){switch(r){case s.ROTATE:if(n.enableRotate===!1)return;X(C);break;case s.DOLLY:if(n.enableZoom===!1)return;ee(C);break;case s.PAN:if(n.enablePan===!1)return;fe(C);break}}function ne(C){n.enabled===!1||n.enableZoom===!1||r!==s.NONE||(C.preventDefault(),n.dispatchEvent(Lr),ye(C),n.dispatchEvent(rl))}function ie(C){n.enabled===!1||n.enablePan===!1||Me(C)}function xe(C){switch(te(C),w.length){case 1:switch(n.touches.ONE){case Ln.ROTATE:if(n.enableRotate===!1)return;Ie(C),r=s.TOUCH_ROTATE;break;case Ln.PAN:if(n.enablePan===!1)return;Ne(C),r=s.TOUCH_PAN;break;default:r=s.NONE}break;case 2:switch(n.touches.TWO){case Ln.DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;qe(C),r=s.TOUCH_DOLLY_PAN;break;case Ln.DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;z(C),r=s.TOUCH_DOLLY_ROTATE;break;default:r=s.NONE}break;default:r=s.NONE}r!==s.NONE&&n.dispatchEvent(Lr)}function he(C){switch(te(C),r){case s.TOUCH_ROTATE:if(n.enableRotate===!1)return;mt(C),n.update();break;case s.TOUCH_PAN:if(n.enablePan===!1)return;Te(C),n.update();break;case s.TOUCH_DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;ve(C),n.update();break;case s.TOUCH_DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;st(C),n.update();break;default:r=s.NONE}}function _e(C){n.enabled!==!1&&C.preventDefault()}function Ce(C){w.push(C.pointerId)}function Be(C){delete I[C.pointerId];for(let J=0;J<w.length;J++)if(w[J]==C.pointerId){w.splice(J,1);return}}function te(C){let J=I[C.pointerId];J===void 0&&(J=new Ae,I[C.pointerId]=J),J.set(C.pageX,C.pageY)}function Ye(C){const J=C.pointerId===w[0]?w[1]:w[0];return I[J]}n.domElement.addEventListener("contextmenu",_e),n.domElement.addEventListener("pointerdown",Fe),n.domElement.addEventListener("pointercancel",S),n.domElement.addEventListener("wheel",ne,{passive:!1}),this.update()}}const Ug={name:"CopyShader",uniforms:{tDiffuse:{value:null},opacity:{value:1}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;


		}`};class Xs{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error("THREE.Pass: .render() must be implemented in derived pass.")}dispose(){}}const Ig=new Hs(-1,1,1,-1,0,1);class Ng extends Kt{constructor(){super(),this.setAttribute("position",new ut([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new ut([0,2,0,0,2,0],2))}}const Fg=new Ng;class Og{constructor(e){this._mesh=new ge(Fg,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,Ig)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}}class $r extends Xs{constructor(e,t){super(),this.textureID=t!==void 0?t:"tDiffuse",e instanceof En?(this.uniforms=e.uniforms,this.material=e):e&&(this.uniforms=Ql.clone(e.uniforms),this.material=new En({name:e.name!==void 0?e.name:"unspecified",defines:Object.assign({},e.defines),uniforms:this.uniforms,vertexShader:e.vertexShader,fragmentShader:e.fragmentShader})),this.fsQuad=new Og(this.material)}render(e,t,n){this.uniforms[this.textureID]&&(this.uniforms[this.textureID].value=n.texture),this.fsQuad.material=this.material,this.renderToScreen?(e.setRenderTarget(null),this.fsQuad.render(e)):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this.fsQuad.render(e))}dispose(){this.material.dispose(),this.fsQuad.dispose()}}class ol extends Xs{constructor(e,t){super(),this.scene=e,this.camera=t,this.clear=!0,this.needsSwap=!1,this.inverse=!1}render(e,t,n){const s=e.getContext(),r=e.state;r.buffers.color.setMask(!1),r.buffers.depth.setMask(!1),r.buffers.color.setLocked(!0),r.buffers.depth.setLocked(!0);let o,a;this.inverse?(o=0,a=1):(o=1,a=0),r.buffers.stencil.setTest(!0),r.buffers.stencil.setOp(s.REPLACE,s.REPLACE,s.REPLACE),r.buffers.stencil.setFunc(s.ALWAYS,o,4294967295),r.buffers.stencil.setClear(a),r.buffers.stencil.setLocked(!0),e.setRenderTarget(n),this.clear&&e.clear(),e.render(this.scene,this.camera),e.setRenderTarget(t),this.clear&&e.clear(),e.render(this.scene,this.camera),r.buffers.color.setLocked(!1),r.buffers.depth.setLocked(!1),r.buffers.color.setMask(!0),r.buffers.depth.setMask(!0),r.buffers.stencil.setLocked(!1),r.buffers.stencil.setFunc(s.EQUAL,1,4294967295),r.buffers.stencil.setOp(s.KEEP,s.KEEP,s.KEEP),r.buffers.stencil.setLocked(!0)}}class Bg extends Xs{constructor(){super(),this.needsSwap=!1}render(e){e.state.buffers.stencil.setLocked(!1),e.state.buffers.stencil.setTest(!1)}}class zg{constructor(e,t){if(this.renderer=e,this._pixelRatio=e.getPixelRatio(),t===void 0){const n=e.getSize(new Ae);this._width=n.width,this._height=n.height,t=new On(this._width*this._pixelRatio,this._height*this._pixelRatio,{type:Ai}),t.texture.name="EffectComposer.rt1"}else this._width=t.width,this._height=t.height;this.renderTarget1=t,this.renderTarget2=t.clone(),this.renderTarget2.texture.name="EffectComposer.rt2",this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2,this.renderToScreen=!0,this.passes=[],this.copyPass=new $r(Ug),this.copyPass.material.blending=Sn,this.clock=new Cg}swapBuffers(){const e=this.readBuffer;this.readBuffer=this.writeBuffer,this.writeBuffer=e}addPass(e){this.passes.push(e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}insertPass(e,t){this.passes.splice(t,0,e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}removePass(e){const t=this.passes.indexOf(e);t!==-1&&this.passes.splice(t,1)}isLastEnabledPass(e){for(let t=e+1;t<this.passes.length;t++)if(this.passes[t].enabled)return!1;return!0}render(e){e===void 0&&(e=this.clock.getDelta());const t=this.renderer.getRenderTarget();let n=!1;for(let s=0,r=this.passes.length;s<r;s++){const o=this.passes[s];if(o.enabled!==!1){if(o.renderToScreen=this.renderToScreen&&this.isLastEnabledPass(s),o.render(this.renderer,this.writeBuffer,this.readBuffer,e,n),o.needsSwap){if(n){const a=this.renderer.getContext(),l=this.renderer.state.buffers.stencil;l.setFunc(a.NOTEQUAL,1,4294967295),this.copyPass.render(this.renderer,this.writeBuffer,this.readBuffer,e),l.setFunc(a.EQUAL,1,4294967295)}this.swapBuffers()}ol!==void 0&&(o instanceof ol?n=!0:o instanceof Bg&&(n=!1))}}this.renderer.setRenderTarget(t)}reset(e){if(e===void 0){const t=this.renderer.getSize(new Ae);this._pixelRatio=this.renderer.getPixelRatio(),this._width=t.width,this._height=t.height,e=this.renderTarget1.clone(),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.renderTarget1=e,this.renderTarget2=e.clone(),this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2}setSize(e,t){this._width=e,this._height=t;const n=this._width*this._pixelRatio,s=this._height*this._pixelRatio;this.renderTarget1.setSize(n,s),this.renderTarget2.setSize(n,s);for(let r=0;r<this.passes.length;r++)this.passes[r].setSize(n,s)}setPixelRatio(e){this._pixelRatio=e,this.setSize(this._width,this._height)}dispose(){this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.copyPass.dispose()}}class Gg extends Xs{constructor(e,t,n=null,s=null,r=null){super(),this.scene=e,this.camera=t,this.overrideMaterial=n,this.clearColor=s,this.clearAlpha=r,this.clear=!0,this.clearDepth=!1,this.needsSwap=!1,this._oldClearColor=new $e}render(e,t,n){const s=e.autoClear;e.autoClear=!1;let r,o;this.overrideMaterial!==null&&(o=this.scene.overrideMaterial,this.scene.overrideMaterial=this.overrideMaterial),this.clearColor!==null&&(e.getClearColor(this._oldClearColor),e.setClearColor(this.clearColor)),this.clearAlpha!==null&&(r=e.getClearAlpha(),e.setClearAlpha(this.clearAlpha)),this.clearDepth==!0&&e.clearDepth(),e.setRenderTarget(this.renderToScreen?null:n),this.clear===!0&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),e.render(this.scene,this.camera),this.clearColor!==null&&e.setClearColor(this._oldClearColor),this.clearAlpha!==null&&e.setClearAlpha(r),this.overrideMaterial!==null&&(this.scene.overrideMaterial=o),e.autoClear=s}}function kg(i){const e=It(i.owner),t=e?e.color:16777215,n=i.type+"|"+t;let s=R._unitTpl[n];return s||(s=Hg(i.type,t),R._unitTpl[n]=s),s.clone(!0)}function Hg(i,e){const t=new yt,n=Pe(e,{r:.5,m:.12}),s=Pe(e,{e,ei:.2}),r=Pe(2761240,{r:.7}),o=Pe(9080985,{r:.4,m:.7}),a=Pe(15121288,{r:.7}),l=Pe(16734794,{e:16726570,ei:.9}),c=Pe(15261903,{r:.85}),u=Pe(15985888,{r:.9}),f=Pe(11569724,{r:.4,m:.7}),p=Pe(9055010,{r:.55}),m=Pe(2238259,{r:.5}),g=new ge(new rn(.34,.38,.1,16),Pe(1709069,{r:.8}));g.position.y=.05,g.receiveShadow=!0,t.add(g);const _=new ge(new Zi(.33,.04,8,20),s);_.rotation.x=Math.PI/2,_.position.y=.06,t.add(_);const h=(A,w,I,M,y,U,B)=>(A.castShadow=!0,w!==void 0&&(A.position.x=w,A.position.y=I,A.position.z=M),y!==void 0&&(A.rotation.x=y,A.rotation.y=U||0,A.rotation.z=B||0),t.add(A),A),d=(A,w,I,M)=>new ge(new Ke(A,w,I),M||n),x=(A,w,I,M,y)=>new ge(new rn(A,w,I,y||10),M||n),v=(A,w,I,M)=>new ge(new an(A,w,8),I||n),T=(A,w)=>new ge(new Ki(A,10,10),w||n),D=A=>{h(x(.13,.16,.32,A||n),0,.3,0),h(T(.12,a),0,.55,0)};if(i==="founder")h(d(.34,.18,.32,c),0,.16,0),h(d(.22,.15,.22,u),.05,.33,-.03),h(d(.15,.13,.15,s),-.1,.3,.1),h(x(.015,.015,.3,r,5),-.18,.32,-.13),h(d(.015,.1,.13,s),-.155,.5,-.07);else if(i==="rambler")D(n),h(d(.15,.19,.025,u),.18,.34,.05,0,0,.18),h(d(.04,.13,.008,r),.18,.36,.06,0,0,.18),h(d(.12,.14,.06,r),-.15,.26,0),h(v(.085,.1,s),0,.74,0);else if(i==="guard")D(n),h(d(.13,.11,.07,r),.21,.18,0),h(x(.012,.012,.08,f,6),.21,.27,0),h(d(.05,.13,.012,s),0,.4,.12);else if(i==="armed")D(n),h(d(.17,.12,.11,p),.14,.33,.12),h(d(.17,.025,.11,f),.14,.4,.12),h(d(.05,.14,.012,s),0,.41,.12);else if(i==="pike")h(d(.24,.46,.16,n),0,.35,-.05),h(T(.12,a),0,.64,-.05),h(d(.3,.05,.2,c),0,.32,.18),h(d(.05,.28,.05,r),0,.16,.18),h(x(.055,.055,.06,p,10),.12,.46,.16),h(x(.015,.015,.12,r,5),.12,.55,.16);else if(i==="pony")h(x(.018,.018,.42,o,8),.06,.2,0,0,0,2),h(x(.07,.07,.03,r,12),.27,.09,0,0,0,Math.PI/2),h(x(.07,.07,.03,r,12),-.16,.09,0,0,0,Math.PI/2),h(d(.13,.22,.12,n),-.02,.36,0,.24,0,0),h(T(.1,a),.06,.52,0),h(d(.1,.13,.05,s),-.15,.34,0);else if(i==="gun")h(d(.22,.15,.17,p),0,.3,0),h(d(.22,.03,.17,f),0,.385,0),h(x(.04,.05,.5,f,10),.12,.34,0,0,0,-.5),h(d(.36,.04,.04,r),-.2,.12,0),h(x(.16,.16,.04,r,12),0,.16,.16,Math.PI/2,0,0),h(x(.16,.16,.04,r,12),0,.16,-.16,Math.PI/2,0,0);else if(i==="ironclad")h(d(.34,.4,.26,m),0,.3,0),h(T(.13,a),0,.56,0),h(x(.16,.16,.04,r,16),0,.62,0),h(x(.11,.11,.13,r,16),0,.69,0),h(x(.015,.015,.5,r,6),.22,.32,0),h(v(.09,.16,m),.22,.6,0),h(d(.06,.18,.02,s),0,.42,.135),g.scale.set(1.25,1,1.25);else if(i==="skylark")h(x(.015,.015,.5,r,5),0,.34,0),h(d(.46,.02,.13,u),0,.66,0,0,0,.04),h(d(.14,.02,.34,u),0,.66,0,.22,0,0),h(v(.04,.14,s),.24,.66,0,0,0,-Math.PI/2),h(T(.03,l),-.2,.67,0);else if(i==="nightmail")h(x(.11,.15,.34,m),0,.27,0),h(T(.11,Pe(1447967)),0,.5,0),h(d(.05,.09,.012,l),.14,.34,.08),h(d(.14,.1,.015,u),-.14,.32,.05,0,0,.2),h(T(.045,l),0,.13,.16);else if(i==="colossus")h(d(.5,.16,.5,c),0,.16,0),h(d(.38,.5,.32,m),0,.46,0),h(T(.16,a),0,.78,0),h(x(.21,.21,.05,r,18),0,.85,0),h(x(.15,.15,.16,r,18),0,.93,0),h(d(.26,.2,.16,p),0,.34,.24),h(d(.26,.03,.16,f),0,.45,.24),h(d(.09,.22,.02,s),0,.62,.17),h(v(.05,.14,f),0,1.04,0),g.scale.set(1.85,1,1.85);else if(i==="monitor"){const A=Pe(2897216,{m:.4,r:.4});h(d(.6,.12,.26,A),0,.16,0),h(d(.4,.1,.2,c),0,.27,0),h(x(.018,.018,.12,c,6),.06,.4,.07),h(x(.018,.018,.12,c,6),.16,.4,.07),h(d(.2,.025,.12,c),.11,.47,.07),h(x(.015,.015,.22,r,5),-.2,.42,0),h(d(.012,.12,.16,s),-.2,.5,.08)}else if(i==="lighter"){const A=Pe(7031340,{r:.85});h(d(.62,.14,.3,A),0,.16,0),h(d(.5,.04,.22,Pe(4862752)),0,.24,0),h(d(.16,.16,.16,c),-.12,.32,0),h(d(.13,.12,.13,u),.1,.3,.04),h(x(.09,.12,.2,n),.04,.32,-.07),h(T(.075,a),.04,.46,-.07),h(x(.015,.015,.3,r,5),-.27,.4,0),h(d(.012,.12,.16,s),-.27,.48,.08)}else h(d(.3,.4,.3,n),0,.3,0);return t}function Vg(i){const e=It(i.owner),t=e?e.color:10066329,n=t+"|"+i.level+"|"+(i.walls?1:0)+"|"+(i.isCapital?1:0);let s=R._cityTpl[n];return s||(s=Wg(i,t),R._cityTpl[n]=s),s.clone(!0)}function Wg(i,e){const t=new yt,n=Ur(i.level,1,Ei),s=Pe(15261903,{r:.85}),r=Pe(13484970,{r:.9}),o=Pe(e,{r:.5}),a=Pe(2760728),l=Pe(11569724,{r:.4,m:.7}),c=Pe(9416904,{r:.25,m:.5,e:2767434,ei:.16}),u=Pe(e,{e,ei:.5}),f=.44+n*.02,p=new ge(new rn(f,f+.04,.1,20),s);p.position.y=.05,p.receiveShadow=!0,t.add(p);const m=(U,B,Y)=>{const L=new ge(new rn(.028,.032,Y,8),s);L.position.set(U,Y/2+.1,B),L.castShadow=!0,t.add(L);const O=new ge(new Ke(.07,.03,.07),s);O.position.set(U,Y+.1,B),t.add(O)},g=.3+n*.03,_=n<=3?.26+n*.05:n<=6?.4+n*.07:.55+n*.05,h=new ge(new Ke(g,_,g*.72),s);h.position.y=_/2+.1,h.castShadow=!0,t.add(h);const d=new ge(new Ke(g*.94,_*.5,.012),a);d.position.set(0,_*.56+.1,g*.36+.006),t.add(d);const x=new ge(new Ke(g+.06,.05,g*.72+.06),s);x.position.y=_+.125,t.add(x);const v=new ge(new Ke(g+.08,.022,g*.72+.08),o);v.position.y=_+.16,t.add(v);const T=n<=3?4:n<=6?5:6,D=_*.78,A=g*.36+.06;for(let U=0;U<T;U++){const B=(-(T-1)/2+U)*(g*.9/(T-1||1));m(B,A,D)}if(n>=7){const U=new ge(new rn(g*.32,g*.34,.13,16),s);U.position.y=_+.1+.12,U.castShadow=!0,t.add(U);const B=new ge(new Ki(g*.34,18,12,0,Math.PI*2,0,Math.PI/2),n>=9?c:s);B.position.y=_+.1+.18,B.castShadow=!0,t.add(B);const Y=new ge(new an(.045,.12,8),l);Y.position.y=_+.1+.18+g*.34+.02,t.add(Y)}else{const U=new ge(new an(g*.5,.15,4),o);U.position.y=_+.1+.1,U.rotation.y=Math.PI/4,U.castShadow=!0,t.add(U)}const w=n<=2?0:n<=5?2:4;for(let U=0;U<w;U++){const B=U%2===0?1:-1,Y=Math.floor(U/2),L=.2+Y*.12+U*53%4*.04,O=B*(g*.62+Y*.14),W=Y?-.12:.08,j=new ge(new Ke(.16,L,.16),n>=8&&Y>=1?c:s);j.position.set(O,L/2+.1,W),j.castShadow=!0,t.add(j);const q=new ge(new Ke(.18,.02,.18),o);q.position.set(O,L+.1,W),t.add(q)}const I=Math.min(2+n*2,20),M=n<=3?1:n<=6?2:3;let y=0;for(let U=0;U<M&&y<I;U++){const B=Math.ceil(I/M),Y=.32+U*.17+f*.2;for(let L=0;L<B&&y<I;L++,y++){const O=L/B*6.28+U*.8+L*.5,W=Math.cos(O)*Y,j=Math.sin(O)*Y,q=.12+L*97%4*.05+U*.04,$=new ge(new Ke(.13,q,.13),s);$.position.set(W,q/2+.1,j),$.castShadow=!0,t.add($);const Q=new ge(new Ke(.14,.02,.14),n>=7&&L%2?o:r);Q.position.set(W,q+.1,j),t.add(Q)}}if(i.walls){const U=new ge(new Zi(f-.02,.03,6,22),r);U.rotation.x=Math.PI/2,U.position.y=.12,t.add(U)}if(i.isCapital){const U=_+.6,B=new ge(new Ke(.13,U,.13),s);B.position.set(f*.52,U/2+.1,-f*.4),B.castShadow=!0,t.add(B);const Y=new ge(new rn(.05,.05,.02,12),l);Y.rotation.x=Math.PI/2,Y.position.set(f*.52,U-.04,-f*.4+.066),t.add(Y);const L=new ge(new an(.11,.18,4),o);L.position.set(f*.52,U+.19,-f*.4),L.rotation.y=Math.PI/4,t.add(L);const O=new ge(new rn(.012,.012,.4,6),a);O.position.set(0,_+.1+.42,0),t.add(O);const W=new ge(new Ke(.015,.14,.24),u);W.position.set(0,_+.1+.52,.12),t.add(W)}return t}function Xg(i,e){const t=Z.G;if(!R.terrGroup)return;R.terrGroup.clear(),R._fillGeo||(R._fillGeo=new ji(wt*.98,wt*.98),R._edgeGeoX=new Ke(.07,.08,wt*.96),R._edgeGeoZ=new Ke(wt*.96,.08,.07));const n=(r,o)=>!e||i.explored.has(zi(r,o)),s=t._ownedTiles||[];for(const r of s){const o=r.x,a=r.z;if(!r.owner||!n(o,a))continue;const l=It(r.owner);if(!l)continue;const c=l.color,u=qn[r.terrain].h*Zn;for(const[f,p]of[[1,0],[-1,0],[0,1],[0,-1]]){const m=o+f,g=a+p,_=fl(m,g)?cn(m,g):null;if(!_||_.owner!==r.owner){const h=new ge(f?R._edgeGeoX:R._edgeGeoZ,Kg(c));h.position.set(et(o)+f*.49*wt,u+.07,tt(a)+p*.49*wt),R.terrGroup.add(h)}}}}function Rt(){const i=Z.G;R.dynGroup.clear(),R.bobUnits=[];const e=i.mode==="campaign"?hl():null,t=!!e;for(const n of R.tilePickMeshes){const{tx:s,tz:r,base:o}=n.userData,a=!t||e.explored.has(zi(s,r)),l=cn(s,r),c=new $e(o);if(!a)c.multiplyScalar(.16),c.offsetHSL(0,-.45,-.02);else if(l.owner){const u=It(l.owner);u&&c.lerp(new $e(u.color),.25)}n.material.color.copy(c),n.userData.visible=a}for(const n of R.decoMeshes)n.o.visible=!t||e.explored.has(zi(n.tx,n.tz));Xg(e,t);for(const n of i.cities){if(t&&!e.explored.has(zi(n.x,n.z)))continue;const s=Vg(n),r=qn[cn(n.x,n.z).terrain].h*Zn;s.position.set(et(n.x),r,tt(n.z)),s.userData={kind:"city",ref:n},R.dynGroup.add(s)}for(const n of i.units){if(n.hp<=0||t&&n.owner!==e.id&&(!Cc(e,n.x,n.z)||Lc(n,e.id)))continue;const s=kg(n),r=qn[cn(n.x,n.z).terrain].h*Zn,o=Ft[n.type].domain==="air",a=r+il+(o?.8:0);if(s.userData={kind:"unit",ref:n},s.userData.baseY=a,s.position.set(et(n.x),a,tt(n.z)),n._animFrom){const l=Pc()-(n._animStart||0),c=n._animDur||300;if(l<c&&fl(n._animFrom.x,n._animFrom.z)){const u=qn[cn(n._animFrom.x,n._animFrom.z).terrain].h*Zn+il+(o?.8:0);s.userData.anim={fx:et(n._animFrom.x),fz:tt(n._animFrom.z),tx:et(n.x),tz:tt(n.z),fy:u,ty:a,start:n._animStart||0,dur:c,unit:n},s.position.x=s.userData.anim.fx,s.position.z=s.userData.anim.fz,s.position.y=u}else n._animFrom=null}R.dynGroup.add(s),R.bobUnits.push(s)}Mn(),R.renderer&&(R.renderer.shadowMap.needsUpdate=!0)}function Mn(){const i=Z.G;if(R.highlightGroup.clear(),!i.sel)return;const e=i.sel;if(i.reach)for(const t of i.reach.set){const[n,s]=t.split(",").map(Number);As(n,s,4830975,.5)}if(i.atks)for(const t of i.atks)As(t.x,t.z,16733508,.7);Ft[e.type].role==="settle"&&Os(e,e.x,e.z)&&As(e.x,e.z,7331962,.7),As(e.x,e.z,16769658,.85)}function As(i,e,t,n,s){const r=qn[cn(i,e).terrain].h*Zn,o=new ge(new ji(wt*.92,wt*.92),new ks({color:t,transparent:!0,opacity:n,depthWrite:!1}));o.rotation.x=-Math.PI/2,o.position.set(et(i),r+.03,tt(e)),R.highlightGroup.add(o)}function $g(){R.raycaster.setFromCamera(R.pointer,R.camera);const i=R.raycaster.intersectObjects(R.tilePickMeshes,!1),e=R.dynGroup?R.raycaster.intersectObjects(R.dynGroup.children,!0):[];if(e.length){let t=e[0].object;for(;t&&!(t.userData&&t.userData.ref);)t=t.parent;if(t&&t.userData&&t.userData.ref&&(!i.length||e[0].distance<=i[0].distance+3)){const n=t.userData.ref;return{tx:n.x,tz:n.z,pickedDyn:t.userData.kind}}}return i.length?i[0].object.userData:null}function qg(){const i=Z.N;Z.FR=Math.max(11,i*.62);const e=Math.max(20,i*1.15);R.camera.position.set(e,e*1.2,e),R.camera.lookAt(0,0,0);const t=innerWidth/innerHeight;if(R.camera.left=-Z.FR*t,R.camera.right=Z.FR*t,R.camera.top=Z.FR,R.camera.bottom=-Z.FR,R.camera.zoom=1,R.camera.updateProjectionMatrix(),R.sun){const n=Math.max(20,i*.85),s=R.sun.shadow.camera;s.left=-n,s.right=n,s.top=n,s.bottom=-n,s.far=i*5,s.updateProjectionMatrix&&s.updateProjectionMatrix()}R.scene&&R.scene.fog&&(R.scene.fog.near=i*1.15,R.scene.fog.far=i*2.6),R.controls&&R.controls.target.set(0,0,0),R.renderer&&(R.renderer.shadowMap.needsUpdate=!0)}function uc(){const i=Z.G,e=Z.N;R.controls.target.set(0,0,0);const t=hl();if(t){const n=i.cities.find(s=>s.owner===t.id&&s.isCapital)||i.cities.find(s=>s.owner===t.id);n&&R.controls.target.set(et(n.x),0,tt(n.z))}R.camera.zoom=e<=12?1.15:1,R.camera.updateProjectionMatrix()}function Yg(i){const e=R.panKeys.size>0;if(!e&&(!R.panV||R.panV.lengthSq()<1e-6))return R.panRamp=0,R.lastPanT=i,!1;if(!R.controls||!R.camera)return!1;let t=(i-R.lastPanT)/1e3;R.lastPanT=i,(!(t>0)||t>.12)&&(t=.016),R.panV||(R.panV=new N);const n=new N(0,0,-1).applyQuaternion(R.camera.quaternion);n.y=0,n.lengthSq()<1e-6&&n.set(0,0,-1),n.normalize();const s=new N(1,0,0).applyQuaternion(R.camera.quaternion);s.y=0,s.normalize();const r=new N;R.panKeys.has("up")&&r.add(n),R.panKeys.has("down")&&r.addScaledVector(n,-1),R.panKeys.has("right")&&r.add(s),R.panKeys.has("left")&&r.addScaledVector(s,-1);let o;if(e&&r.lengthSq()>0){r.normalize(),R.panRamp=Math.min(1,R.panRamp+t/1.3);const l=Z.FR*.16,c=Z.FR*1.25;o=r.multiplyScalar(l+(c-l)*R.panRamp*R.panRamp)}else R.panRamp=0,o=new N;const a=1-Math.exp(-t*(o.lengthSq()>0?6.5:9));return R.panV.x+=(o.x-R.panV.x)*a,R.panV.z+=(o.z-R.panV.z)*a,R.panV.lengthSq()<2e-4&&!e?(R.panV.set(0,0,0),!1):(R.camera.position.x+=R.panV.x*t,R.camera.position.z+=R.panV.z*t,R.controls.target.x+=R.panV.x*t,R.controls.target.z+=R.panV.z*t,!0)}function jg(i){R.pointer.x=i.clientX/innerWidth*2-1,R.pointer.y=-(i.clientY/innerHeight)*2+1}function dc(i){requestAnimationFrame(dc);const e=Z.G,t=Yg(i);R.controls.update();const n=i<(e&&e._animUntil||0);if(!(!t&&!n&&i-R.lastT<33)){R.lastT=i;for(const s of R.bobUnits){const r=s.userData.anim;if(r){let o=(i-r.start)/r.dur;o>=1&&(o=1,s.userData.anim=null,r.unit&&r.unit._animFrom&&(r.unit._animFrom=null));const a=1-Math.pow(1-o,3);s.position.x=r.fx+(r.tx-r.fx)*a,s.position.z=r.fz+(r.tz-r.fz)*a,s.position.y=r.fy+(r.ty-r.fy)*a}else s.position.y=s.userData.baseY}R.composer.render()}}function Kg(i){return R._edgeMat[i]||(R._edgeMat[i]=new ks({color:i,transparent:!0,opacity:.85,depthWrite:!1}))}function Pe(i,e={}){return new bg({color:i,roughness:e.r??.9,metalness:e.m??0,flatShading:!0,transparent:e.t||!1,opacity:e.o??1,emissive:e.e??0,emissiveIntensity:e.ei??0})}function hc(){const i=document.getElementById("stage");R.renderer=new cc({antialias:!0,powerPreference:"high-performance"}),R.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)),R.renderer.setSize(innerWidth,innerHeight),R.renderer.shadowMap.enabled=!0,R.renderer.shadowMap.type=Pl,R.renderer.shadowMap.autoUpdate=!1,R.renderer.toneMapping=Ul,R.renderer.toneMappingExposure=1.05,i.appendChild(R.renderer.domElement),R.scene=new Eg,R.scene.background=new $e(1912640),R.scene.fog=null;const e=innerWidth/innerHeight;R.camera=new Hs(-Z.FR*e,Z.FR*e,Z.FR,-Z.FR,.1,1200),R.camera.position.set(34,40,34),R.camera.lookAt(0,0,0),R.controls=new Dg(R.camera,R.renderer.domElement),R.controls.enableDamping=!0,R.controls.dampingFactor=.08,R.controls.minZoom=.55,R.controls.maxZoom=6,R.controls.maxPolarAngle=Math.PI*.46,R.controls.minPolarAngle=Math.PI*.12,R.controls.target.set(0,0,0),R.sun=new Qo(16773334,1.5),R.sun.position.set(26,46,16),R.sun.castShadow=!0,R.sun.shadow.mapSize.set(2048,2048);const t=26,n=R.sun.shadow.camera;n.left=-t,n.right=t,n.top=t,n.bottom=-t,n.near=1,n.far=140,R.sun.shadow.bias=-6e-4,R.sun.shadow.normalBias=.02,R.scene.add(R.sun),R.scene.add(new Rg(16777215,.45)),R.scene.add(new Tg(14675711,6969924,.9));const s=new Qo(13624063,.55);s.position.set(-24,30,-22),R.scene.add(s),R.staticGroup=new yt,R.scene.add(R.staticGroup),R.dynGroup=new yt,R.scene.add(R.dynGroup),R.fxGroup=new yt,R.scene.add(R.fxGroup),R.terrGroup=new yt,R.scene.add(R.terrGroup),R.highlightGroup=new yt,R.scene.add(R.highlightGroup),R.composer=new zg(R.renderer),R.composer.addPass(new Gg(R.scene,R.camera)),R.passH=new $r(ll),R.passH.uniforms.uDir.value.set(1,0),R.passV=new $r(ll),R.passV.uniforms.uDir.value.set(0,1),R.passV.uniforms.uSat.value=1.22,R.passV.renderToScreen=!0,R.composer.addPass(R.passH),R.composer.addPass(R.passV),cl(),R.renderer.domElement.addEventListener("pointermove",jg),R.renderer.domElement.addEventListener("click",r=>{R.onClick&&R.onClick(r)}),addEventListener("resize",cl),pc(),dc()}const ll={uniforms:{tDiffuse:{value:null},uDir:{value:new Ae(1,0)},uTexel:{value:new Ae(1/1280,1/720)},uFocus:{value:.54},uBand:{value:.16},uStrength:{value:7},uSat:{value:1}},vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",fragmentShader:`
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uTexel;
    uniform float uFocus; uniform float uBand; uniform float uStrength; uniform float uSat;
    void main(){
      float d=abs(vUv.y-uFocus);
      float b=clamp((d-uBand)/(1.0-uBand),0.0,1.0);
      b=pow(b,1.4)*uStrength;
      vec2 o=uDir*uTexel*b;
      vec4 c=texture2D(tDiffuse,vUv)*0.227027;
      c+=texture2D(tDiffuse,vUv+o*1.3846)*0.3162162;
      c+=texture2D(tDiffuse,vUv-o*1.3846)*0.3162162;
      c+=texture2D(tDiffuse,vUv+o*3.2308)*0.0702702;
      c+=texture2D(tDiffuse,vUv-o*3.2308)*0.0702702;
      vec3 col=c.rgb; float l=dot(col,vec3(0.299,0.587,0.114));
      col=mix(vec3(l),col,uSat);
      col=clamp((col-0.5)*1.04+0.5,0.0,1.0); // gentle contrast
      gl_FragColor=vec4(col,c.a);
    }`};function cl(){const i=innerWidth/innerHeight;R.camera.left=-Z.FR*i,R.camera.right=Z.FR*i,R.camera.top=Z.FR,R.camera.bottom=-Z.FR,R.camera.updateProjectionMatrix(),R.renderer.setSize(innerWidth,innerHeight),R.composer.setSize(innerWidth,innerHeight),R.passH.uniforms.uTexel.value.set(1/innerWidth,1/innerHeight),R.passV.uniforms.uTexel.value.set(1/innerWidth,1/innerHeight),pc(),Pi()&&Z.G&&Z.G.started&&Ji()}const et=i=>(i-(Z.N-1)/2)*wt,tt=i=>(i-(Z.N-1)/2)*wt,Zg={london:{field:14406852,lightforest:11124614,denseforest:9151338,hill:13617077,water:8297124,ocean:6193548},manchester:{field:8949123,lightforest:7178074,denseforest:5270845,hill:8619388,water:5207686,ocean:3758696},darlington:{field:5620277,lightforest:4433196,denseforest:3308576,hill:8170056,water:4168844,ocean:2915696},homeworker:{field:13422428,lightforest:11126088,denseforest:7641644,hill:13022046,water:8829071,ocean:6525807}};function Jg(i,e){const t=Zg[i.biome];return t&&t[i.terrain]!=null?t[i.terrain]:e.color}function fc(i,e){const t=new $e(Jg(i,e));return t.offsetHSL(0,0,((i.x*7+i.z*13)%7-3)/95),t.getHex()}function Pi(){try{return matchMedia("(max-width: 820px)").matches||matchMedia("(pointer:coarse)").matches&&innerWidth<1100}catch{return!1}}function pc(){if(!R.controls||!R.renderer)return;const i=Pi();if(R.controls.enableRotate=!i,R.controls.touches&&(R.controls.touches.ONE=i?Ln.PAN:Ln.ROTATE),R.controls.maxZoom=i?16:6,R.controls.minZoom=i?.4:.55,R.renderer.setPixelRatio(Math.min(devicePixelRatio,i?1:1.5)),R.passH&&R.passV){const e=i?.42:.16,t=i?2.6:7;R.passH.uniforms.uBand.value=e,R.passV.uniforms.uBand.value=e,R.passH.uniforms.uStrength.value=t,R.passV.uniforms.uStrength.value=t}}function Ji(i=.16){const e=Z.G;if(!e||!R.camera||!R.controls)return;const t=e.mode==="campaign"?e.players.find(g=>!g.isAI):null;let n=1e9,s=-1e9,r=1e9,o=-1e9,a=!1;const l=(g,_)=>{const h=et(g),d=tt(_);h<n&&(n=h),h>s&&(s=h),d<r&&(r=d),d>o&&(o=d),a=!0};if(t&&t.explored&&t.explored.size)for(const g of t.explored){const _=g.indexOf(",");l(+g.slice(0,_),+g.slice(_+1))}else l(0,0),l(Z.N-1,Z.N-1);if(!a)return;n-=wt,s+=wt,r-=wt,o+=wt;const c=(n+s)/2,u=(r+o)/2,f=Math.max(20,Z.N*1.05);R.controls.target.set(c,0,u),R.camera.position.set(c+f,f*1.15,u+f),R.camera.lookAt(c,0,u),R.camera.zoom=1,R.camera.updateMatrixWorld(!0),R.camera.updateProjectionMatrix();let p=1e-4;for(const g of[n,s])for(const _ of[r,o]){const h=new N(g,0,_).project(R.camera);p=Math.max(p,Math.abs(h.x),Math.abs(h.y))}let m=(1-i)/p;m=Math.max(R.controls.minZoom,Math.min(R.controls.maxZoom,m)),R.camera.zoom=m,R.camera.updateProjectionMatrix(),R.controls.update()}function Qg(){return R._deco||(R._deco={tree:new an(.22,.55,6),treeBig:new an(.32,.9,7),trunk:new rn(.06,.08,.18,5),rock:new ha(.22,0),peak:new an(.46,.9,5),snow:new an(.2,.3,5),gem:new fa(.16,0),farm:new Ke(.62,.05,.62),mine:new Ke(.2,.18,.2),mill:new Ke(.22,.26,.22),wheel:new Zi(.12,.03,6,12),port:new Ke(.4,.06,.16),reed:new an(.04,.22,4),treeMat:Pe(4160058),treeMat2:Pe(3106352),trunkMat:Pe(7031338),rockMat:Pe(10129280),snowMat:Pe(15921909,{r:.6}),farmMat:Pe(14201418,{r:.85}),mineMat:Pe(3551274,{r:.7}),millMat:Pe(11567184,{r:.85}),steelMat:Pe(9080985,{r:.4,m:.6}),reedMat:Pe(8367706,{r:.9}),kiosk:new Ke(.2,.18,.2),awning:new Ke(.28,.05,.28),bench:new Ke(.2,.05,.08),ballTree:new Ki(.17,8,8),terrace:new Ke(.22,.22,.16),terraceRoof:new Ke(.24,.05,.18),hedge:new Ke(.26,.1,.1),desk:new Ke(.18,.08,.11),screen:new Ke(.11,.09,.02),campus:new Ke(.2,.36,.2),stoneMat2:Pe(14208954,{r:.9}),awningMat:Pe(12867338,{r:.7}),benchMat:Pe(9071173,{r:.85}),parkTreeMat:Pe(6989903,{r:.85}),brickTerr:Pe(10115642,{r:.9}),terraceRoofMat:Pe(4866102,{r:.8}),hedgeMat:Pe(5214018,{r:.9}),deskMat:Pe(9071173,{r:.85}),screenMat:Pe(2241348,{e:2767434,ei:.3}),campusMat:Pe(9416904,{r:.3,m:.5,e:2767434,ei:.15})}),R._deco}function e_(i,e){const t=Z.N;if(t<=46)return!1;const n=t>=80?3:2;return(i*7+e*13)%n!==0}function mc(i,e,t,n){const s=Qg(),r=l=>{l.userData.deco=!0,R.staticGroup.add(l),R.decoMeshes.push({o:l,tx:i,tz:e})},o=e_(i,e);if(!o){if(t.terrain==="lightforest"){const l=new yt,c=new ge(s.tree,s.treeMat);c.position.y=.5,c.castShadow=!0;const u=new ge(s.trunk,s.trunkMat);u.position.y=.16,u.castShadow=!0,l.add(u,c),l.position.set(et(i),n,tt(e)),l.rotation.y=(i*7+e*13)%62/10,r(l)}else if(t.terrain==="denseforest"){const l=new yt,c=new ge(s.treeBig,s.treeMat2);c.position.y=.68,c.castShadow=!0;const u=new ge(s.trunk,s.trunkMat);u.position.y=.18,u.castShadow=!0;const f=new ge(s.tree,s.treeMat);f.position.set(.2,.46,.18),f.castShadow=!0,l.add(u,c,f),l.position.set(et(i),n,tt(e)),l.rotation.y=(i*7+e*13)%62/10,r(l)}else if(t.terrain==="hill"){const l=new ge(s.rock,s.rockMat);l.position.set(et(i)+.16,n+.16,tt(e)-.12),l.castShadow=!0,r(l)}else if(t.terrain==="mountain"){const l=new ge(s.peak,s.rockMat);l.position.set(et(i),n+.42,tt(e)),l.castShadow=!0,r(l);const c=new ge(s.snow,s.snowMat);c.position.set(et(i),n+.78,tt(e)),r(c)}else if(t.terrain==="river"){const l=new ge(s.reed,s.reedMat);l.position.set(et(i)+.24,n+.1,tt(e)+.2),l.castShadow=!0,r(l)}}if(!o&&(t.terrain==="field"||t.terrain==="lightforest")){const l=(i*5+e*11)%4;if(t.biome==="london"){if(t.terrain==="lightforest"){const c=new yt,u=new ge(s.trunk,s.trunkMat);u.position.y=.16,u.castShadow=!0;const f=new ge(s.ballTree,s.parkTreeMat);f.position.y=.42,f.castShadow=!0,c.add(u,f),c.position.set(et(i),n,tt(e)),r(c)}else if(l===0){const c=new yt,u=new ge(s.kiosk,s.stoneMat2);u.position.y=.17,u.castShadow=!0;const f=new ge(s.awning,s.awningMat);f.position.y=.3,c.add(u,f),c.position.set(et(i)+.12,n,tt(e)+.12),r(c)}else if(l===2){const c=new ge(s.bench,s.benchMat);c.position.set(et(i)-.16,n+.07,tt(e)+.18),c.castShadow=!0,r(c)}}else if(t.biome==="manchester"){if(l===0){const c=new yt,u=new ge(s.terrace,s.brickTerr);u.position.y=.19,u.castShadow=!0;const f=new ge(s.terraceRoof,s.terraceRoofMat);f.position.y=.32,c.add(u,f),c.position.set(et(i),n,tt(e)),r(c)}}else if(t.biome==="homeworker"){if(l===0){const c=new ge(s.hedge,s.hedgeMat);c.position.set(et(i),n+.07,tt(e)-.16),c.castShadow=!0,r(c)}else if(l===2){const c=new yt,u=new ge(s.desk,s.deskMat);u.position.y=.1,u.castShadow=!0;const f=new ge(s.screen,s.screenMat);f.position.set(0,.17,-.04),c.add(u,f),c.position.set(et(i)+.14,n,tt(e)+.14),r(c)}}else if(t.biome==="darlington"&&l===0&&t.terrain==="field"){const c=new ge(s.campus,s.campusMat);c.position.set(et(i),n+.18,tt(e)),c.castShadow=!0,r(c)}}if(t.resource){const l=Ot[t.resource],c=new ge(s.gem,Pe(l.color,{e:l.color,ei:.25,m:.2,r:.4}));c.position.set(et(i)+.28,n+.2,tt(e)+.28),c.castShadow=!0,c.userData.res=!0,r(c)}const a=t.improved;if(a==="farm"){const l=new ge(s.farm,s.farmMat);l.position.set(et(i),n+.02,tt(e)),r(l)}else if(a==="mine"){const l=new ge(s.mine,s.mineMat);l.position.set(et(i)-.18,n+.09,tt(e)-.18),l.castShadow=!0,r(l)}else if(a==="lumber"){const l=new ge(s.mill,s.millMat);l.position.set(et(i)-.16,n+.13,tt(e)-.16),l.castShadow=!0,r(l)}else if(a==="watermill"){const l=new ge(s.mill,s.millMat);l.position.set(et(i),n+.13,tt(e)),l.castShadow=!0,r(l);const c=new ge(s.wheel,s.steelMat);c.rotation.y=Math.PI/2,c.position.set(et(i)+.16,n+.12,tt(e)),r(c)}else if(a==="port"){const l=new ge(s.port,s.millMat);l.position.set(et(i),n+.04,tt(e)),l.castShadow=!0,r(l)}}function t_(){R.staticGroup.clear(),R.tilePickMeshes=[],R.waterMeshes=[],R.decoMeshes=[];const i=Z.N;R._tileGeo||(R._tileGeo=new Ke(wt*.99,1,wt*.99));for(let t=0;t<i;t++)for(let n=0;n<i;n++){const s=cn(n,t),r=qn[s.terrain],o=r.h*Zn,a=fc(s,r),l=new ge(R._tileGeo,Pe(a));l.scale.y=o,l.position.set(et(n),o/2,tt(t)),l.receiveShadow=!0,l.castShadow=!1,l.userData={tx:n,tz:t,base:a},R.staticGroup.add(l),R.tilePickMeshes.push(l),r.pass==="water"&&R.waterMeshes.push(l),mc(n,t,s,o)}const e=new ge(new Ke(i*2.2,.4,i*2.2),Pe(2447986,{r:.5}));e.position.y=-.2,e.receiveShadow=!0,R.staticGroup.add(e)}function ma(i,e){const t=cn(i,e),n=qn[t.terrain],s=n.h*Zn,r=R.tilePickMeshes.find(o=>o.userData.tx===i&&o.userData.tz===e);if(r){const o=fc(t,n);r.scale.y=s,r.position.y=s/2,r.userData.base=o,r.material.color.set(o)}for(let o=R.decoMeshes.length-1;o>=0;o--){const a=R.decoMeshes[o];a.tx===i&&a.tz===e&&(R.staticGroup.remove(a.o),R.decoMeshes.splice(o,1))}mc(i,e,t,s),Rt()}function n_(){R.renderer||hc(),pl({refreshTile:(i,e)=>ma(i,e)})}function i_(i){R.onClick=i}const $t=i=>document.getElementById(i),ul={domain:"score"};function ga(){const i=Z.G,e=Z.knowledge;if(!e)return;$t("brainGames").textContent=`${e.games} games`;let t='<div class="label" style="margin-bottom:8px">What the AI has learned</div>';const n=Object.entries(e.lessons).filter(([l])=>Zs[l]).sort((l,c)=>c[1].weight-l[1].weight);for(const[l,c]of n){const u=Math.round((c.weight||0)*100),f=Zs[l].type==="pattern";t+=`<div class="lesson"><div class="lt"><b>${f?"★ ":"⚠ "}${Zs[l].label}</b><span>${u}%</span></div>
      <div class="meter"><i style="width:${u}%;background:${f?"linear-gradient(90deg,#5a9e4e,#9bd07f)":"linear-gradient(90deg,var(--rust),var(--amber2))"}"></i></div></div>`}t+='<div class="label" style="margin:12px 0 8px">Department strategies <span style="color:var(--faint)">(genome · W/L)</span></div>';const s=e.factions,r=i&&i.started?i.players.map(l=>l.id):Object.keys(s),o=new Set;for(const l of r){if(o.has(l))continue;o.add(l);const c=s[l],u=jr.find(m=>m.id===l);if(!c||!u)continue;const f=c.genome||Dc(),p="#"+u.color.toString(16).padStart(6,"0");t+=`<div class="gen-row"><span class="gc" style="background:${p}"></span><span class="gn" title="${u.name}">${u.name}</span>
      <div class="bars">`;for(const m of["aggression","expansion","economy","defense","tech","risk"]){const g=Math.round((f[m]||0)*100);t+=`<div class="barseg" title="${m} ${g}%"><i style="width:${g}%;background:${p}"></i></div>`}t+=`</div><span class="gw">${c.wins||0}/${c.losses||0}</span></div>`}const a=i&&i.started?i.players[i.cur]:null;a&&a.isAI&&a.lastThought&&(t+=`<div class="label" style="margin:12px 0 6px">Now thinking — ${a.name}</div><div class="desc">${a.lastThought}</div>`),$t("brainBody").innerHTML=t}function s_(){const i=Z.G;if(i.mode!=="auto")return;i._obsTurn!==i.turn&&(i._obsTurn=i.turn,_a(),gc());const e=(i.pivots||[]).length;e!==i._pivN&&(i._pivN=e,_c())}function _a(){const i=Z.G;if(i.mode!=="auto")return;$t("scoreTurn").textContent=`turn ${i.turn}`;const e=ul.domain;$t("domainRow").innerHTML=Object.entries(Uc).map(([l,c])=>`<div class="chip ${l===e?"on":""}" data-dom="${l}" style="padding:5px 9px;font-size:10px">${c.label}</div>`).join(""),$t("domainRow").querySelectorAll(".chip").forEach(l=>l.onclick=()=>{ul.domain=l.dataset.dom,_a()});const t=i.scoreHist,n=252,s=128,r=4;if(t.length<2)$t("scoreChart").innerHTML=`<div class="legend" style="height:${s}px;display:grid;place-items:center">gathering data…</div>`;else{let l=1;for(const _ of t)for(const h of i.players){const d=_.v[h.id]?.[e]||0;d>l&&(l=d)}const c=t[0].turn,u=t[t.length-1].turn||c+1,f=Math.max(1,u-c),p=_=>r+(_-c)/f*(n-2*r),m=_=>s-r-_/l*(s-2*r);let g=`<svg viewBox="0 0 ${n} ${s}" width="100%" style="display:block;background:var(--bg-base,#16110b);border:1px solid var(--line);border-radius:7px">`;for(let _=0;_<=2;_++){const h=r+_*(s-2*r)/2;g+=`<line x1="${r}" y1="${h}" x2="${n-r}" y2="${h}" stroke="#3a3025" stroke-width="0.5"/>`}for(const _ of i.leadHist||[]){if(_.turn<c||_.turn>u)continue;const h=p(_.turn);g+=`<line x1="${h.toFixed(1)}" y1="${r}" x2="${h.toFixed(1)}" y2="${s-r}" stroke="var(--amber)" stroke-width="0.6" stroke-dasharray="2 3" stroke-opacity="0.5"/>`}for(const _ of i.players){const h="#"+_.color.toString(16).padStart(6,"0"),d=_.id===i._leader,x=t.map(v=>`${p(v.turn).toFixed(1)},${m(v.v[_.id]?.[e]||0).toFixed(1)}`).join(" ");g+=`<polyline points="${x}" fill="none" stroke="${h}" stroke-width="${_.alive?d?2.6:1.7:1}" stroke-opacity="${_.alive?1:.3}" stroke-linejoin="round"/>`}if(i._leader){const _=i.players.find(h=>h.id===i._leader);if(_&&_.alive){const h=p(u),d=m(t[t.length-1].v[_.id]?.[e]||0),x="#"+_.color.toString(16).padStart(6,"0");g+=`<circle cx="${h.toFixed(1)}" cy="${d.toFixed(1)}" r="3.4" fill="${x}" stroke="#16110b" stroke-width="1"/><text x="${(h-3).toFixed(1)}" y="${(d-5).toFixed(1)}" font-size="9" text-anchor="end">👑</text>`}}g+=`<text x="${r}" y="11" fill="var(--muted)" font-size="9" font-family="monospace">${l}</text></svg>`,$t("scoreChart").innerHTML=g}const o=t.length?t[t.length-1].v:{},a=i.players.map(l=>({p:l,val:o[l.id]?.[e]||0})).sort((l,c)=>c.val-l.val);$t("scoreLegend").innerHTML=a.map(({p:l,val:c})=>{const u="#"+l.color.toString(16).padStart(6,"0");return`<div style="display:flex;align-items:center;gap:7px;font-size:10.5px;font-family:'JetBrains Mono';margin-bottom:3px;opacity:${l.alive?1:.45}">
      <span style="width:9px;height:9px;border-radius:2px;background:${u};flex:none"></span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.name}${l.alive?"":" ✝"}</span>
      <b style="color:var(--ink)">${c}</b></div>`}).join("")}const r_=["aggression","expansion","economy","defense","tech","risk"];function gc(){const i=Z.G,e=Z.knowledge;if(i.mode!=="auto")return;const t=$t("tickerBody");if(!t)return;$t("tickerTurn").textContent=`turn ${i.turn}`;const n=i.players.map(o=>({p:o,sc:Gi(o)})).sort((o,a)=>a.p.alive-o.p.alive||a.sc-o.sc),s={};n.forEach((o,a)=>{o.p.alive&&(s[o.p.id]=a+1)});let r="";n.forEach((o,a)=>{const l=o.p,c="#"+l.color.toString(16).padStart(6,"0"),u=e.factions[l.id]&&e.factions[l.id].archetype||Ic(l.id),f=l.genome||{},p=i.cities.filter(x=>x.owner===l.id).length,m=i.units.filter(x=>x.owner===l.id&&x.hp>0).length,g=i._prevRank[l.id],_=s[l.id];let h='<span class="lb-trend flat">·</span>';l.alive&&g&&(_<g?h='<span class="lb-trend up">▲</span>':_>g&&(h='<span class="lb-trend dn">▼</span>'));const d=l.alive&&a===0;r+=`<div class="lbrow ${d?"lead":""} ${l.alive?"":"dead"}">
      <div class="lb-rank">${l.alive?a+1:"✝"}</div>
      <div class="lb-dot" style="background:${c}"></div>
      <div class="lb-main">
        <div style="display:flex;align-items:center;gap:5px"><span class="lbname">${d?"👑 ":""}${l.name}</span></div>
        <div class="lb-arch">${u}</div>
        <div class="lb-gen">${r_.map(x=>`<div title="${x} ${Math.round((f[x]||0)*100)}%"><i style="width:${Math.round((f[x]||0)*100)}%;background:${c}"></i></div>`).join("")}</div>
        <div class="lb-stats"><span>🏙 ${p}</span><span>⚔ ${m}</span></div>
      </div>
      ${h}
      <div class="lb-score">${o.sc}</div>
    </div>`}),t.innerHTML=r,i.turn!==i._rankTurn&&(i._rankTurn=i.turn,i._prevRank=s)}function _c(){const i=Z.G;if(i.mode!=="auto")return;const e=$t("pivotBody");if(!e)return;$t("pivotTurn").textContent=`${(i.pivots||[]).length} beats`;const t=(i.pivots||[]).slice(-24).reverse();if(!t.length){e.innerHTML='<div class="legend" style="padding:6px">The chronicle awaits its first turning point…</div>';return}e.innerHTML=t.map(n=>`<div class="pivot ${n.kind}"><span class="pv-ico">${n.ico}</span><div><div class="pv-txt">${n.text}</div><div class="pv-turn">turn ${n.turn}</div></div></div>`).join("")}const K=i=>document.getElementById(i);function Ci(i){document.body.classList.toggle("sheet-open",!!i),i&&document.body.classList.remove("reforms-open")}function dl(){document.body.classList.toggle("mobile",Pi())}function Qi(i,e){const t=Z.G;if(t&&t._headless)return;const n=K("logbody");if(!n)return;const s=document.createElement("div");for(s.className="logline",s.innerHTML=`<span class="tag ${i}">${i}</span>${e}`,n.prepend(s);n.children.length>60;)n.removeChild(n.lastChild)}function $s(){const i=Z.G,e=i.mode==="campaign"?i.players.find(u=>!u.isAI):Mt(),t=Mt();K("hudWho").textContent=t.name+(t.isAI?" (AI)":""),K("hudDot").style.background="#"+t.color.toString(16).padStart(6,"0"),K("hudTurn").innerHTML=`${i.turn}${i.endless?"":"<small>/"+Ir.turnCap+"</small>"}`;const n=e||t,s=n.foodUpkeep!=null?n.foodUpkeep:zc(n),r=(n.foodIncome||0)-s;K("hudFood").innerHTML=`${Math.round(n.food||0)}<small> 👥 <span style="color:${r<0?"#e87a5a":r>0?"#9bd07f":"var(--faint)"}">${r>=0?"+":""}${r}</span> <span style="color:var(--faint)">(${n.foodIncome||0}−${s}👥)</span>${n.starving?" ⚠":""}</small>`;const o=Js(n,"woodCap"),a=Js(n,"stoneCap"),l=Js(n,"prodCap"),c=(u,f)=>u>=f*.85?`<span style="color:#e8b35a">/${f}</span>`:`<span style="color:var(--faint)">/${f}</span>`;if(K("hudWood").innerHTML=`${n.wood||0}<small> 🤝${c(n.wood||0,o)} +${n.woodIncome||0}</small>`,K("hudStone").innerHTML=`${n.stone||0}<small> 📋${c(n.stone||0,a)} +${n.stoneIncome||0}</small>`,K("hudProd").innerHTML=`${n.prod}<small> 💷${c(n.prod||0,l)} +${n.prodIncome||0}</small>`,K("hudSci").innerHTML=`${n.science}<small> 📜 +${n.sciIncome||0}</small>`,K("hudCities").textContent=i.cities.filter(u=>u.owner===n.id).length,K("hudScore").textContent=Gi(n),document.body.classList.contains("mobile")){const u=(p,m)=>{const g=K(p);g&&(g.textContent=m)};u("mTax",Math.round(n.prod||0)),u("mStaff",Math.round(n.food||0)),u("mPol",Math.round(n.science||0)),u("mTurn",i.turn);const f=K("mWhoDot");f&&(f.style.background="#"+t.color.toString(16).padStart(6,"0"))}}function vc(){const i=Z.G,e=i.mode==="campaign"?i.players.find(s=>!s.isAI):Mt();if(!e){K("techBody").innerHTML="";return}const t=e;let n="";for(const[s,r]of Object.entries(Gc)){const o=t.techs.has(s),a=!o&&r.prereq&&!t.techs.has(r.prereq),l=kc(t,s),c=!o&&!a&&t.science>=l&&!t.isAI&&i.mode==="campaign";n+=`<div class="tech ${o?"owned":""} ${a?"locked":""}" ${c?`data-tech="${s}"`:""}>
      <div class="ico">${o?"✓":a?"🔒":"📜"}</div>
      <div><div class="tn">${r.name}</div><div class="nt">${r.note}</div></div>
      ${o?"":`<div class="tc">${l}📜</div>`}</div>`}K("techBody").innerHTML=n,K("techHint").textContent=e.isAI||i.mode==="auto"?"observing":"click to research",!e.isAI&&i.mode==="campaign"&&K("techBody").querySelectorAll("[data-tech]").forEach(s=>s.onclick=()=>{Hc(t,s.dataset.tech)&&at()})}function at(){$s(),vc(),ga(),Z.G.sel?va():Z.G.selCity&&es(),Z.G.mode==="auto"&&s_()}function a_(){const i=Z.G;if(!i.started||i.gameOver)return;const e=$g();if(!e)return;const{tx:t,tz:n}=e,s=Mt();if(!(i.mode==="campaign"&&!s.isAI)){Yr(t,n);return}const o=Qn(t,n),a=Cl(t,n);if(i.sel){const l=i.sel;if(i.atks&&i.atks.some(c=>c.x===t&&c.z===n)){const c=i.atks.find(u=>u.x===t&&u.z===n);gu(l,c),o_();return}if(i.reach&&i.reach.set.has(zi(t,n))&&l.movesLeft>0){_u(l,t,n),Yt(l),at(),Rt(),bn();return}l===o&&Os(l,l.x,l.z)}if(a&&a.owner===s.id&&e.pickedDyn!=="unit"){qr(a);return}if(e.pickedDyn==="unit"&&o){Yt(o);return}if(o&&o.owner===s.id){Yt(o);return}if(a){qr(a);return}Yr(t,n)}function Yt(i){const e=Z.G;e.sel=i,e.selCity=null;const t=Mt();i.owner===t.id&&!i.hasMovedFlag?(e.reach=i.movesLeft>0?ru(i):{set:new Set,dist:{}},e.atks=au(i)):(e.reach=null,e.atks=null),Mn(),va(),Ci(!0)}function qr(i){const e=Z.G;e.sel=null,e.selCity=i,e.reach=null,e.atks=null,Mn(),va(),Ci(!0)}function Yr(i,e){const t=Z.G,n=Qn(i,e),s=Cl(i,e);if(n){Yt(n);return}if(s){qr(s);return}const r=Mt();t.sel=null,t.selCity=null,t.reach=null,t.atks=null,Mn();const o=cn(i,e),a={pennine:"The uplands",dale:"The heartland",weald:"The shires",coast:"Coast & estuary"}[o.region]||"",l=o.resource&&Ot[o.resource].strategic,c=o.cityId!=null?t.cities.find(m=>m.id===o.cityId):null,u=c&&c.owner===r.id&&!r.isAI&&t.mode==="campaign",f=c?`In <b>${c.name}</b>'s land`:o.owner?`Territory of ${It(o.owner)?.name||"—"}`:"Unclaimed land.";let p=`<div class="sel-empty"><b style="color:var(--ink)">${o.terrain[0].toUpperCase()+o.terrain.slice(1)}</b>${a?` · <span style="color:var(--muted)">${a}</span>`:""}${o.resource?`<br>${Ot[o.resource].glyph} <b style="color:var(--amber2)">${Ot[o.resource].label}</b>${l?' <span style="color:var(--teal)">⚙ strategic</span>':""}`:""}<br>${f}</div>`;if(o.improved)p+=`<div class="legend" style="margin-top:6px">${ws[o.improved].glyph} <b>${ws[o.improved].label}</b> already built here.</div>`;else if(u){const m=Al(r,c,o);if(m&&m.ok){const g=ws[m.id];p+=`<div class="label" style="margin-top:10px">Upgrade this tile</div>
        <button class="btn primary" data-imptile="${i},${e},${m.id}" style="margin-top:5px">${g.glyph} Build ${g.label} <span class="cost">${g.cost.prod}💷 ${wl()}🤝</span></button>
        <div class="legend" style="margin-top:4px">${g.note} Each improvement unlocks one departmental level for <b>${c.name}</b>.</div>`}else m&&m.reason&&(p+=`<div class="legend" style="margin-top:8px">🔒 ${m.reason}</div>`)}K("selBody").innerHTML=p,K("selTitle").textContent=c?c.name:"Tile",K("selSub").textContent=`${i},${e}`,K("selBody").querySelectorAll("[data-imptile]").forEach(m=>m.onclick=()=>{const g=m.dataset.imptile.split(",");xa(c,+g[0],+g[1],g[2]),Yr(i,e)}),Ci(!0)}function o_(){const i=Z.G;i.sel&&i.sel.hp>0?Yt(i.sel):(i.sel=null,i.reach=null,i.atks=null),at(),Rt(),Rl(),bn()}const xc=()=>document.body.classList.contains("mobile");function l_(i){const e=Z.G,t=Mt(),n=Ft[i.type],s=It(i.owner),r=i.owner===t.id&&!t.isAI&&e.mode==="campaign";K("selTitle").textContent=n.name,K("selSub").textContent=r?"":s.name;let o=`<div class="m-head"><span class="m-emoji" style="color:#${s.color.toString(16).padStart(6,"0")}">${n.glyph}</span><span class="m-hp"><i style="width:${Math.round(i.hp/i.maxHp*100)}%"></i></span></div>`;if(r){const a=[];if(n.role==="settle"&&Os(i,i.x,i.z)&&a.push('<button class="btn primary" data-act="found">⌂ Establish department here</button>'),n.role==="scout"&&i.movesLeft>0&&a.push('<button class="btn" data-act="scout">✦ Survey ahead</button>'),n.role==="scout"&&a.push(`<button class="btn ${i.autoExplore?"primary":""}" data-act="auto">⤳ Auto-survey${i.autoExplore?" ✓":""}</button>`),n.domain==="land"&&i.movesLeft>0)for(const l of _l(t,i.x,i.z))a.push(`<button class="btn" data-embark="${l.id}">⛵ Board convoy</button>`);if(n.role==="transport"){const l=i.cargo||[];if(l.length){const c=vl(i.x,i.z).filter(([u,f])=>xl(u,f)&&!Qn(u,f));if(c.length)for(let u=0;u<l.length;u++){const[f,p]=c[0];a.push(`<button class="btn" data-disembark="${u},${f},${p}">⌂ Land ${Ft[l[u].type].glyph}</button>`)}}}e.atks&&e.atks.length&&a.push(`<div class="m-hint">⚔ Tap a red tile to strike (${e.atks.length})</div>`),i.movesLeft>0&&a.push('<div class="m-hint">→ Tap a blue tile to move</div>'),(i.movesLeft>0||!i.hasAttacked)&&a.push('<button class="btn" data-act="skip">✓ Done</button>'),o+=`<div class="m-acts">${a.join("")}</div>`}K("selBody").innerHTML=o,r&&(K("selBody").querySelectorAll("[data-act]").forEach(a=>a.onclick=()=>{const l=a.dataset.act;l==="found"?Sc(i):l==="scout"?Fs(i):l==="auto"?(i.autoExplore=!i.autoExplore,i.autoExplore&&(jt("Auto-survey on."),Fs(i)),Yt(i),at()):l==="skip"&&(i.movesLeft=0,i.hasAttacked=!0,Yt(i),at())}),K("selBody").querySelectorAll("[data-embark]").forEach(a=>a.onclick=()=>{const l=e.units.find(c=>c.id==a.dataset.embark);l&&Ml(i,l)&&(e.sel=null,jt("Boarded the convoy."),at(),Rt(),bn())}),K("selBody").querySelectorAll("[data-disembark]").forEach(a=>a.onclick=()=>{const l=a.dataset.disembark.split(",").map(Number);Sl(i,l[0],l[1],l[2])&&(jt("Role landed."),Yt(i),at(),Rt(),bn())}))}function c_(i){const e=Z.G,t=Mt(),n=It(i.owner),s=i.owner===t.id&&!t.isAI&&e.mode==="campaign";if(K("selTitle").textContent=i.name,K("selSub").textContent=`Lv ${i.level}/${Ei}`,!s){K("selBody").innerHTML=`<div class="sel-empty">${n.name}'s department · Lv ${i.level}/${Ei}</div>`;return}const r=!!Qn(i.x,i.z),o=Qr(t)>=Jr(t),a=yl(i);let l="";for(const[p,m]of Object.entries(Ft)){if(m.role==="super"||m.tech&&!t.techs.has(m.tech)||m.port&&!a||r||o||!ea(t,p)||m.domain==="sea"&&!ta(i))continue;const g=El(p,t);l+=`<button class="btn" data-build="${p}"><span>${m.glyph} ${m.name}</span><span class="cost">${g.prod}💷${g.wood?` ${g.wood}🤝`:""}${g.stone?` ${g.stone}📋`:""}</span></button>`}let c="";for(const p of bl(i,t))p.disabled||(c+=`<button class="btn" data-imp="${p.x},${p.z},${p.id}"><span>${p.glyph} ${p.label}</span><span class="cost">${p.cost}💷 ${p.wood}🤝</span></button>`);let u="";for(const[p,m]of Object.entries(ia))(t.projects||[]).includes(p)||!Tl(t,i,p).ok||(u+=`<button class="btn primary" data-commission="${p}"><span>${m.glyph} ${m.name}</span><span class="cost">${m.cost.prod}💷</span></button>`);let f="";l&&(f+=`<div class="m-label">Recruit a role</div><div class="m-acts">${l}</div>`),c&&(f+=`<div class="m-label">Build — unlocks a level</div><div class="m-acts">${c}</div>`),u&&(f+=`<div class="m-label">Special project</div><div class="m-acts">${u}</div>`),!l&&!c&&!u&&(f=`<div class="sel-empty">No actions right now${o?" — role cap reached":r?" — a role blocks the department":""}. Departments grow on their own.</div>`),K("selBody").innerHTML=f,K("selBody").querySelectorAll("[data-build]").forEach(p=>p.onclick=()=>yc(i,p.dataset.build)),K("selBody").querySelectorAll("[data-imp]").forEach(p=>p.onclick=()=>{const m=p.dataset.imp.split(",");xa(i,+m[0],+m[1],m[2])}),K("selBody").querySelectorAll("[data-commission]").forEach(p=>p.onclick=()=>Mc(i,p.dataset.commission))}function va(){const i=Z.G,e=Mt(),t=K("selBody"),n=K("selTitle"),s=K("selSub");if(xc()&&i.sel){l_(i.sel);return}if(i.sel){const r=i.sel,o=Ft[r.type],a=It(r.owner),l=r.owner===e.id&&!e.isAI&&i.mode==="campaign";n.textContent="Role",s.textContent=`#${r.id}`;let c=`<div class="unit-head"><div class="unit-emoji" style="color:#${a.color.toString(16).padStart(6,"0")}">${o.glyph}</div>
      <div><div class="unit-name">${o.name}</div><div class="unit-faction">${a.name}</div></div></div>
      <div class="hpbar"><i style="width:${Math.round(r.hp/r.maxHp*100)}%"></i></div>
      <div class="stat-grid">
        <div class="mini"><div class="k">HP</div><div class="vv">${r.hp}</div></div>
        <div class="mini"><div class="k">ATK</div><div class="vv">${o.atk}</div></div>
        <div class="mini"><div class="k">DEF</div><div class="vv">${o.def}</div></div>
        <div class="mini"><div class="k">MOV</div><div class="vv">${Vc(r)}</div></div>
      </div>
      <div class="desc">${o.desc}</div>`;if(Ra[r.type]&&(c+=`<div class="legend" style="margin-top:4px">⚔ Strong vs <b style="color:var(--amber2)">${Ra[r.type].label}</b></div>`),c+=`<div class="legend" style="margin-top:2px">${r.fortified?'<b style="color:var(--teal)">🛡 Fortified</b> — dug in (+def). ':"Not fortified — end the turn without moving to dig in. "}</div>`,o.needs){const u=It(r.owner);c+=`<div class="legend" style="margin-top:4px">⚙ Strategic: ${o.needs.map(f=>{const p=Ec(u,f);return`<span style="color:${p?"var(--teal)":"#f0998e"}">${Ot[f].glyph} ${Ot[f].label}${p?"":" ✗"}</span>`}).join(" · ")}</div>`}if(l){if(c+='<div class="label" style="margin-top:10px">Orders</div>',c+='<div style="display:flex;flex-direction:column;gap:6px;margin-top:5px;">',o.role==="settle"&&(Os(r,r.x,r.z)?c+='<button class="btn primary" data-act="found">⌂ Stand up a department here</button>':c+=`<div class="legend">⌂ Move to open land at least <b>${v_()}</b> tiles from any department, then establish.</div>`),o.role==="scout"&&(r.movesLeft>0&&(c+='<button class="btn" data-act="scout">✦ Survey ahead (reveal the fog)</button>'),c+=`<button class="btn ${r.autoExplore?"primary":""}" data-act="auto">⤳ Auto-survey${r.autoExplore?" — ON":""}</button>`),o.domain==="land"&&r.movesLeft>0){const u=_l(e,r.x,r.z);for(const f of u)c+=`<button class="btn" data-embark="${f.id}">⛵ Board the Secondment Convoy (${(f.cargo||[]).length}/${Ca(f)})</button>`}if(o.role==="transport"){const u=r.cargo||[];if(c+=`<div class="legend" style="margin-top:4px">Cargo <b>${u.length}/${Ca(r)}</b>${u.length?": "+u.map(f=>Ft[f.type].glyph+" "+Ft[f.type].name).join(", "):" — empty"}</div>`,u.length){const f=vl(r.x,r.z).filter(([p,m])=>xl(p,m)&&!Qn(p,m));if(f.length)for(let p=0;p<u.length;p++){const[m,g]=f[0];c+=`<button class="btn" data-disembark="${p},${m},${g}">⌂ Land ${Ft[u[p].type].glyph} ${Ft[u[p].type].name} (${Zr(m-r.x,g-r.z)})</button>`}else c+='<div class="legend">Move beside open land to disembark.</div>'}}if(i.atks&&i.atks.length){c+=`<div class="legend">⚔ <b>${i.atks.length}</b> target(s) in range — click a <span style="color:#ff5544">red</span> tile to strike.</div>`;for(const u of i.atks){const f=Wc(r,u),p=f.factors,m=Ft[u.type],g=[];p.counter>0&&g.push(`<span style="color:#9bd07f">counter +${Math.round(p.counter*100)}%</span>`),Math.abs(p.elev-1)>.001&&g.push(`<span style="color:${p.elev<1?"#f0998e":"#9bd07f"}">${p.elev<1?"uphill":"downhill"} ${p.elev<1?"−":"+"}${Math.round(Math.abs(p.elev-1)*100)}%</span>`),f.flankers>0&&g.push(`<span style="color:#9bd07f">flank +${Math.round(Math.min(Ir.flankCap,f.flankers*Ir.flankPerUnit)*100)}% (${f.flankers})</span>`),f.defBon>1.001&&g.push(`<span style="color:#f0998e">terrain/def ×${f.defBon.toFixed(2)}${u.fortified?" 🛡":""}</span>`),c+=`<div class="legend" style="margin-top:3px;border-left:2px solid var(--line2);padding-left:6px">
            ⚔ vs ${m.glyph} <b>${m.name}</b> (${u.hp}hp): deal <b style="color:#ff7a5a">${f.atkDmg}</b>${f.kills?' <b style="color:#9bd07f">— KILL</b>':f.defDmg>0?`, take <b style="color:#f0998e">${f.defDmg}</b> back`:", no retaliation"}${g.length?`<br><span style="font-size:9px">${g.join(" · ")}</span>`:""}</div>`}}r.movesLeft>0&&(c+='<div class="legend">→ Click a <span style="color:#49b6ff">blue</span> tile to march there.</div>'),r.movesLeft>0||!r.hasAttacked?c+='<button class="btn" data-act="skip">✓ Done for this turn</button>':c+='<div class="legend">This unit has spent its turn.</div>',c+="</div>"}t.innerHTML=c,l&&(t.querySelectorAll("[data-act]").forEach(u=>u.onclick=()=>{const f=u.dataset.act;f==="found"?Sc(r):f==="scout"?Fs(r):f==="auto"?(r.autoExplore=!r.autoExplore,r.autoExplore&&(jt("Auto-survey on — this analyst roams the fog at the start of each turn."),Fs(r)),Yt(r),at()):f==="skip"&&(r.movesLeft=0,r.hasAttacked=!0,Yt(r),at())}),t.querySelectorAll("[data-embark]").forEach(u=>u.onclick=()=>{const f=i.units.find(p=>p.id==u.dataset.embark);f&&Ml(r,f)&&(i.sel=null,jt("Boarded the convoy."),at(),Rt(),bn())}),t.querySelectorAll("[data-disembark]").forEach(u=>u.onclick=()=>{const f=u.dataset.disembark.split(",").map(Number);Sl(r,f[0],f[1],f[2])&&(jt("Role landed."),Yt(r),at(),Rt(),bn())}))}else i.selCity&&es()}function es(){const i=Z.G,e=i.selCity,t=Mt(),n=It(e.owner);if(xc()){c_(e);return}const s=K("selBody"),r=K("selTitle"),o=K("selSub"),a=e.owner===t.id&&!t.isAI&&i.mode==="campaign";r.textContent="Department",o.textContent=e.isCapital?"lead department":"";const l=Xc(e),c=$c(e),u=qc(e),f=Yc(e),p=e.level>=c,m=jc(e),g=Kc(e),_=p?1:Math.min(Ur((t.food||0)/u,0,1),Ur((t.prod||0)/Math.max(1,f),0,1));let h=`<div class="unit-head"><div class="unit-emoji" style="color:#${n.color.toString(16).padStart(6,"0")}">${e.isCapital?"★":"⌂"}</div>
    <div><div class="unit-name">${e.name}</div><div class="unit-faction">${n.name} · Lv ${e.level}/${Ei} · border ${Zc(e)}${e.unrest>0?` · <span style="color:#e87a5a">⚑ unrest ${e.unrest}t</span>`:""}</div></div></div>
    ${e.unrest>0?`<div class="legend" style="margin-top:4px;color:#e87a5a">Newly captured — in unrest for <b>${e.unrest}</b> more turn(s): yields nothing & cannot grow until order is restored.</div>`:""}
    <div class="hpbar" style="background:#2a2412"><i style="width:${Math.round(_*100)}%;background:linear-gradient(90deg,var(--amber),var(--amber2))"></i></div>
    <div class="legend" style="margin-top:4px">${e.level<c?`Ready to grow — next level costs <b>${u}</b> 👥 + <b>${f}</b> 💷 (you have ${t.food||0} 👥, ${t.prod||0} 💷)`:e.level>=Math.min(Ei,g)?"At the limit of its land":`Build <b>infrastructure</b> nearby to unlock level ${e.level+1}`} ${e.walls?"· walled":""}</div>
    <div class="legend" style="margin-top:2px">Improvements: <b>${m}</b> built → caps growth at Lv <b>${c}</b></div>
    <div class="stat-grid" style="margin-top:8px;grid-template-columns:repeat(5,1fr)">
      <div class="mini"><div class="k">👥</div><div class="vv">+${l.food}</div></div>
      <div class="mini"><div class="k">🤝</div><div class="vv">+${l.wood}</div></div>
      <div class="mini"><div class="k">📋</div><div class="vv">+${l.stone}</div></div>
      <div class="mini"><div class="k">💷</div><div class="vv">+${l.prod}</div></div>
      <div class="mini"><div class="k">📜</div><div class="vv">+${l.sci}</div></div>
    </div>
    <div class="desc">Each <b>improvement</b> built in this department's land unlocks one more level (sub-office → flagship department at Lv 10). Recruitment Drives→Staff, Estates Offices→MP Favours, Overseas Posts/Shared Service Centres→Staff &amp; Taxes, Procurement Hubs→Red Tape.</div>`;if(a){const d=Jr(t),x=Qr(t),v=Jc.filter(I=>Ec(t,I));h+=`<div class="legend" style="margin-top:8px">Strategic resources: ${v.length?v.map(I=>`<span style="color:var(--teal)">${Ot[I].glyph} ${Ot[I].label}</span>`).join(" · "):'<span style="color:var(--faint)">none controlled — expand to a source of Capital / Headcount to unlock the senior roster</span>'}</div>`,h+=`<div style="margin-top:8px"><div class="label" style="margin-bottom:6px">Build <span style="color:var(--faint)">(💷 ${t.prod} · 🤝 ${t.wood} · 📋 ${t.stone}) · units ${x}/${d}</span></div><div class="buildlist">`;const T=!!Qn(e.x,e.z),D=x>=d,A=yl(e);for(const[I,M]of Object.entries(Ft)){if(M.role==="super"||M.tech&&!t.techs.has(M.tech)||M.port&&!A)continue;const y=El(I,t),U=Qc(t,I),B=T||D||!ea(t,I)||M.domain==="sea"&&!ta(e),Y=M.needs?`<span class="cost" style="color:${U.length?"#f0998e":"var(--teal)"};margin-left:4px">${M.needs.map(L=>Ot[L].glyph).join("")}${U.length?" needs "+U.map(L=>Ot[L].label).join("+"):""}</span>`:"";h+=`<button class="btn" data-build="${I}" ${B?"disabled":""} title="${M.needs?"Requires "+M.needs.map(L=>Ot[L].label).join(" + ")+(U.length?" — you control none of: "+U.map(L=>Ot[L].label).join(", "):" (controlled)"):""}">
        <span>${M.glyph} ${M.name}${Y}</span><span class="cost">${y.prod}💷${y.wood?` ${y.wood}🤝`:""}${y.stone?` ${y.stone}📋`:""}${y.food?` ${y.food}👥`:""}</span></button>`}h+="</div>",A?h+='<div class="legend" style="margin-top:6px">⚓ This department has an <b>Overseas Post</b> — it can build vessels, launched onto adjacent open water.</div>':eu(e)&&t.techs.has("harbours")&&(h+='<div class="legend" style="margin-top:6px">⚓ Build an <b>Overseas Post</b> on adjacent water below to make this a shipyard.</div>'),D&&(h+=`<div class="legend" style="margin-top:6px">Headcount cap reached (${x}/${d}) — grow departments to support more.</div>`),T&&(h+='<div class="legend" style="margin-top:6px">A role blocks the department — move it to build.</div>'),h+='<div class="label" style="margin:12px 0 6px">Build infrastructure <span style="color:var(--faint)">(each unlocks a level)</span></div><div class="buildlist">';let w=!1;for(const I of bl(e,t)){w=!0;const M=I.disabled;h+=`<button class="btn" data-imp="${I.x},${I.z},${I.id}" ${M?"disabled":""} title="${I.note}${I.reason?" — "+I.reason:""}">
        <span>${I.glyph} ${I.label} <span style="color:var(--faint)">· ${Zr(I.x-e.x,I.z-e.z)} ${I.terrain}</span></span><span class="cost">${I.reason?"🔒 "+I.reason:I.cost+"💷 "+I.wood+"🤝"}</span></button>`}w||(h+='<div class="legend">No improvable land in reach — enact more reforms (Workforce Planning, Estates &amp; Facilities, International Relations, Shared Services, Procurement &amp; Commercial) or grow to claim tiles.</div>'),h+="</div>",h+="</div>",h+=u_(e,t)}s.innerHTML=h,a&&(s.querySelectorAll("[data-build]").forEach(d=>d.onclick=()=>{yc(e,d.dataset.build)}),s.querySelectorAll("[data-imp]").forEach(d=>d.onclick=()=>{const x=d.dataset.imp.split(",");xa(e,+x[0],+x[1],x[2])}),s.querySelectorAll("[data-commission]").forEach(d=>d.onclick=()=>{Mc(e,d.dataset.commission)}))}function u_(i,e){const t=ou(e),n=e.projects||[];let s=`<div class="label" style="margin:12px 0 6px">Special Projects <span style="color:var(--faint)">(commissioned by a Lv ${Ei} department)</span></div><div class="buildlist">`;for(const[r,o]of Object.entries(ia)){const a=n.includes(r),l=a?{ok:!1,reason:"commissioned"}:Tl(e,i,r),c=Object.entries(o.requires).map(([p,m])=>`<span style="color:${(t[p]||0)>=m?"var(--teal)":"var(--faint)"}">${Ot[p].glyph} ${Ot[p].label} ${Math.min(t[p]||0,m)}/${m}</span>`).join(" · "),u=a||!l.ok,f=a?'<span class="cost" style="color:var(--teal)">✓ commissioned</span>':`<span class="cost">${o.cost.prod}💷</span>`;s+=`<button class="btn" data-commission="${r}" ${u?"disabled":""} title="${o.desc}${!a&&!l.ok?" — "+l.reason:""}">
      <span>${o.glyph} ${o.name} <span style="color:var(--faint)">· ${o.bonusTxt}</span></span>${f}</button>
      <div class="legend" style="margin:-2px 0 2px 2px">${a?"Active — "+o.bonusTxt:c}</div>`}return s+="</div>",s}function Mc(i,e){const t=It(i.owner);if(uu(t,i,e)){const n=ia[e];jt(`Commissioned the ${n.name} — ${n.bonusTxt}.`),na(),at(),Rt(),es()}}function Fs(i){const e=It(i.owner);gl(e,i),Yt(i),at(),Rt(),Pi()&&Ji()}function Sc(i){const e=Z.G,t=It(i.owner);iu(t,i.x,i.z,!1),su(i),e.sel=null,Qi("city",`${t.name} stood up a department.`),na(),at(),Rt()}function yc(i,e){const t=It(i.owner),n=Ft[e].domain==="sea";if(!ea(t,e))return;if(Qr(t)>=Jr(t)){jt("Unit cap reached — grow your cities to support more.");return}let s=i.x,r=i.z;if(n){const o=ta(i);if(!o){jt("No open water beside the port to launch.");return}[s,r]=o}else if(Qn(i.x,i.z))return;lu(t,e),cu(t,e,s,r),Qi("city",`${i.name} built a ${Ft[e].name}.`),at(),Rt(),es()}function xa(i,e,t,n){const s=Z.G,r=It(i.owner),o=cn(e,t),a=Al(r,i,o);if(!a.ok||a.id!==n)return;const l=ws[n];r.prod-=l.cost.prod,r.wood=(r.wood||0)-wl(),o.improved=n,Qi("city",`${i.name} built a ${l.label} (${Zr(e-i.x,t-i.z)}).`),na(),ma(e,t),at(),s.sel===null&&s.selCity&&es()}function Ma(i){const e=Z.G;if(!(i.isAI||e.gameOver))for(const t of e.units){if(t.owner!==i.id||t.hp<=0||!t.autoExplore)continue;let n=0;for(;t.movesLeft>0&&n++<12;){const s=t.x,r=t.z;if(gl(i,t),t.x===s&&t.z===r)break}}}function bn(){const i=Z.G;if(Z.autoEndTimer&&(clearTimeout(Z.autoEndTimer),Z.autoEndTimer=null),i.gameOver)return;const e=Mt();e.isAI||i.mode!=="campaign"||i.selCity||wa(e)||(Z.autoEndTimer=setTimeout(()=>{if(i.gameOver)return;const t=Mt();t.isAI||wa(t)||i.selCity||(jt("Turn passed — all roles rested."),K("endturn").disabled||Mi())},900))}function Vi(){K("selTitle").textContent="Selection",K("selSub").textContent="",K("selBody").innerHTML='<div class="sel-empty">Your turn. Select a <b>role</b> to move &amp; contest, or a <b>department</b> to recruit roles (departments grow themselves from the surrounding land). Then <b>End Turn</b>.</div>',Ci(!1)}function d_(){Z.G.mode==="auto"&&Mi()}function h_(){Z.G,R.renderer&&(t_(),qg(),Rt(),at(),uc(),Pi()&&Ji())}function f_(){const i=Z.G;$s();const e=Mt();e.isAI?p_(e):(i.sel=null,i.selCity=null,i.reach=null,i.atks=null,Mn(),Vi(),K("endturn").disabled=!1,Pi()&&Ji(),Ma(e),at(),Rt(),bn())}function p_(i){const e=Z.G;if(pu(i),Rl(),Rt(),at(),e.gameOver||e.mode==="auto"&&!Z.autoplay&&Z.speed==="step")return;const t=e.mode==="auto"?mu[Z.speed]||450:320;Z.autoTimer=setTimeout(()=>{Mi()},t)}function m_(i,e){const t=Z.G,s={domination:"Takeover",science:"Royal Commission",economy:"Machinery of Government",score:"score"}[e]||e;i&&du("win","👑",`<b>${i.name}</b> win by ${s} on turn ${t.turn}.`),Z.autoTimer&&clearTimeout(Z.autoTimer),t.mode==="auto"&&(t._obsTurn=-1,t._pivN=-1,_a(),gc(),_c()),hu(i,e),ga();const r=[...t.players].sort((l,c)=>Gi(c)-Gi(l));K("endTitle").innerHTML=i?`${i.name} <span style="color:var(--amber)">prevails</span>`:"Stalemate";const o={domination:"Victory by Takeover — every rival lead department has been brought to heel.",science:"Victory by Royal Commission — the Reform Programme is complete with a deep research treasury.",economy:"Victory by the Machinery of Government — combined departmental levels beyond rival reach.",score:`Victory by score after ${fu} turns.`};K("endSub").textContent=o[e]||o.score;let a="";r.forEach((l,c)=>{a+=`<div class="rrow ${c===0?"win":""}"><div class="rk">${c+1}</div>
    <span class="dot" style="background:#${l.color.toString(16).padStart(6,"0")};width:12px;height:12px"></span>
    <div class="rn">${l.name}${l.isAI?"":" (you)"}</div><div class="rs">${Gi(l)} pts · ${t.cities.filter(u=>u.owner===l.id).length} departments</div></div>`}),K("endRank").innerHTML=a,K("endLearn").textContent=`AI memory updated — ${Z.knowledge.games} games played.`,Qi("sys",i?`${i.name} wins by ${s}.`:"The game ends in stalemate."),t.mode==="auto"&&t.marathon?(K("endModal").classList.add("hidden"),setTimeout(()=>{Kr({seed:t.seed+1>>>0,mode:"auto",count:t.players.length,marathon:!0,mapSize:t.mapSize,endless:t.endless}),at(),ki()},1400)):K("endModal").classList.remove("hidden")}function g_(){const i=K("endturn");i&&(i.disabled=!0)}function jt(i){const e=K("toast");e&&(e.textContent=i,e.classList.add("show"),setTimeout(()=>e.classList.remove("show"),1600))}const Je={count:4,mode:"campaign",faction:"kelly",seed:1825,marathon:!1,mapSize:"medium",endless:!1};function Bi(){const i=K("countRow");i.innerHTML="";for(let t=2;t<=9;t++){const n=document.createElement("div");n.className="chip"+(t===Je.count?" on":""),n.textContent=t,n.onclick=()=>{Je.count=t,Xi()},i.appendChild(n)}const e=K("facGrid");e.innerHTML="",jr.forEach(t=>{const n=document.createElement("div");n.className="fac"+(t.id===Je.faction?" on":""),n.innerHTML=`<span class="fc" style="background:#${t.color.toString(16).padStart(6,"0")}"></span>
      <div><div class="fn">${t.name}</div><div class="fm">${t.motto}</div></div><span class="fb">${t.bonusTxt}</span>`,n.onclick=()=>{Je.faction=t.id,Xi()},e.appendChild(n)}),Oc(),K("memNote").textContent=`AI memory: ${Z.knowledge.games} games, ${Object.values(Z.knowledge.lessons).filter(t=>t.weight>.05).length} active lessons.`}function Xi(){K("countRow").querySelectorAll(".chip").forEach(e=>e.classList.toggle("on",+e.textContent===Je.count)),K("mapRow").querySelectorAll(".chip").forEach(e=>e.classList.toggle("on",e.dataset.map===Je.mapSize)),K("modeRow").querySelectorAll(".chip").forEach(e=>e.classList.toggle("on",e.dataset.mode===Je.mode)),K("facGrid").querySelectorAll(".fac").forEach((e,t)=>e.classList.toggle("on",jr[t].id===Je.faction)),K("facField").style.opacity=Je.mode==="auto"?.4:1,K("facHintTxt").textContent=Je.mode==="auto"?"— not needed in autonomous mode":"";const i=Bc[Je.mapSize]||32;K("playersHint").textContent=`· ${i}×${i} board (${Je.mapSize})`}function __(){K("setup").classList.add("hidden"),["hud","leftcol","rightcol","log","controls"].forEach(i=>K(i).classList.remove("hidden")),R.renderer||hc(),Kr({seed:Je.seed,mode:Je.mode,count:Je.count,faction:Je.faction,marathon:Je.marathon,mapSize:Je.mapSize,endless:Je.endless}),Z.G,K("speedSeg").querySelectorAll("button").forEach(i=>i.classList.toggle("on",i.dataset.sp===Z.speed)),K("endturn").style.display=Je.mode==="auto"?"none":"",K("btnAuto").style.display=Je.mode==="auto"?"none":"",Z.autoplay=Je.mode==="auto",Pr("ticker",Je.mode==="auto"),Pr("scorePanel",Je.mode==="auto"),Pr("pivots",Je.mode==="auto"),at(),Je.mode==="auto"?ki():(ml(Mt()),$s(),K("endturn").disabled=!1,Vi(),Ma(Mt()),at(),Rt(),bn())}function Pr(i,e){const t=K(i);t&&t.classList.toggle("hidden",!e)}function Ec(i,e){return tu(i,e)}function v_(){return nu()}function x_(){i_(a_),K("startBtn").onclick=__,K("rematchBtn").onclick=()=>{const e=Z.G;K("endModal").classList.add("hidden"),Kr({seed:e.seed+1>>>0,mode:e.mode,count:e.players.length,faction:Je.faction,marathon:e.marathon,mapSize:e.mapSize,endless:e.endless}),at(),Z.G.mode==="auto"?ki():(ml(Mt()),$s(),K("endturn").disabled=!1,Vi(),Ma(Mt()),at(),Rt(),bn())},K("menuBtn2").onclick=()=>{K("endModal").classList.add("hidden"),K("setup").classList.remove("hidden"),Bi()},K("btnMenu").onclick=()=>{Z.autoTimer&&clearTimeout(Z.autoTimer),K("setup").classList.remove("hidden"),Bi()},K("endturn").onclick=()=>{const e=Z.G;e.sel&&(e.sel=null,Mn()),Mi()},K("btnHome").onclick=uc,K("btnAuto").onclick=()=>{Z.autoplay=!Z.autoplay,K("btnAuto").textContent=Z.autoplay?"⏸":"▶",Z.autoplay?Mt().isAI&&ki():Z.autoTimer&&clearTimeout(Z.autoTimer)},K("speedSeg").querySelectorAll("button").forEach(e=>e.onclick=()=>{const t=Z.G;Z.speed=e.dataset.sp,K("speedSeg").querySelectorAll("button").forEach(n=>n.classList.toggle("on",n===e)),Z.speed!=="step"&&t.mode==="auto"&&!t.gameOver&&(Z.autoTimer&&clearTimeout(Z.autoTimer),ki())}),K("techHead").onclick=()=>{const e=K("techBody").classList.toggle("hidden");K("techChevron").textContent=e?"▸":"▾"},document.querySelectorAll(".panel-h.collapsible").forEach(e=>{e.onclick=()=>{const t=e.nextElementSibling;if(!t)return;const n=t.classList.toggle("hidden"),s=e.querySelector(".chev");s&&(s.textContent=n?"▸":"▾")}}),K("mapRow").querySelectorAll(".chip").forEach(e=>e.onclick=()=>{Je.mapSize=e.dataset.map,Xi()}),K("modeRow").querySelectorAll(".chip").forEach(e=>e.onclick=()=>{Je.mode=e.dataset.mode,Xi()}),K("marathonChk").onchange=e=>{Je.marathon=e.target.checked},K("endlessChk").onchange=e=>{Je.endless=e.target.checked},K("seedInput").oninput=e=>{Je.seed=parseInt(e.target.value)||1825},K("wipeBtn").onclick=()=>{Z.knowledge=Nc(),Fc(),Bi(),ga(),jt("AI memory wiped.")},K("btnHelp").onclick=Dr,dl(),addEventListener("resize",dl),K("mEnd").onclick=()=>{const e=Z.G;e&&e.sel&&(e.sel=null,Mn()),Ci(!1),e&&e.mode!=="auto"&&!K("endturn").disabled&&Mi()},K("mFit").onclick=()=>Ji(),K("mMenu").onclick=()=>{Z.autoTimer&&clearTimeout(Z.autoTimer),K("setup").classList.remove("hidden"),Bi()},K("mReforms").onclick=()=>{const e=!document.body.classList.contains("reforms-open");document.body.classList.toggle("reforms-open",e),e&&(Ci(!1),vc()),K("mReforms").dataset.on=e?"1":"0"},K("sheetX").onclick=()=>{const e=Z.G;e&&(e.sel=null,e.selCity=null,e.reach=null,e.atks=null,Mn()),Vi()},K("helpClose").onclick=M_,K("helpBtn2").onclick=Dr;const i={KeyW:"up",ArrowUp:"up",KeyS:"down",ArrowDown:"down",KeyA:"left",ArrowLeft:"left",KeyD:"right",ArrowRight:"right"};addEventListener("keydown",e=>{const t=Z.G,n=e.target&&e.target.tagName||"";if(!(n==="INPUT"||n==="TEXTAREA")){if(i[e.code]){e.preventDefault(),R.panKeys.add(i[e.code]);return}e.code==="Space"&&(e.preventDefault(),t&&t.mode==="auto"?d_():K("endturn").disabled||Mi()),e.key==="Escape"&&t&&(t.sel=null,t.selCity=null,t.reach=null,t.atks=null,Mn(),t.started&&Vi()),(e.key==="?"||e.shiftKey&&e.code==="Slash")&&Dr()}}),addEventListener("keyup",e=>{i[e.code]&&R.panKeys.delete(i[e.code])}),addEventListener("blur",()=>R.panKeys.clear())}function Dr(){K("help").classList.remove("hidden")}function M_(){K("help").classList.add("hidden");try{localStorage.setItem("brassrails.seenHelp","1")}catch{}}pl({afterSetup:h_,afterAdvance:f_,onEndGame:m_,log:(i,e)=>Qi(i,e),refreshTile:(i,e)=>ma(i,e),toast:i=>jt(i),endTurnUi:g_});n_();x_();Bi();Xi();try{localStorage.getItem("brassrails.seenHelp")||document.getElementById("help").classList.remove("hidden")}catch{}
