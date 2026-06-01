import"./styles-tDWIcE7g.js";import{s as se,v as Qo,k as Ui,t as rn,p as Xt,T as Vn,i as sc,a as rc,U as Kt,_ as ac,b as el,c as Gr,d as br,C as Ar,R as Mi,e as tl,L as Vs,F as Hr,f as oc,D as lc,g as Ii,h as cc,j as kr,l as Ni,m as nl,n as Lt,o as Oi,q as uc,r as hc,u as dc,M as fc,B as wr,w as pc,x as Ws,y as il,z as fa,A as mc,E as gc,G as _c,H as vc,I as pa,J as xc,K as ma,N as Mc,O as Sc,P as Gi,Q as Vr,S as Ec,V as yc,W as Tc,X as bc,Y as Ac,Z as wc,$ as Rc,a0 as Cc,a1 as Lc,a2 as Pc,a3 as sl,a4 as rl,a5 as Dc,a6 as Uc,a7 as Ic,a8 as Nc,a9 as al,aa as ol,ab as Fc,ac as Oc,ad as Bc,ae as zc,af as Gc,ag as Hc,ah as ll,ai as kc,aj as Vc,ak as Wc,al as Xc,am as $c,an as qc,ao as Yc,ap as jc,aq as Kc,ar as Zc,as as Jc,at as cl,au as Qc,av as ul,aw as eu,ax as tu}from"./map-DXD1bq_-.js";/**
 * @license
 * Copyright 2010-2023 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const Wr="160",Jn={ROTATE:0,DOLLY:1,PAN:2},Qn={ROTATE:0,PAN:1,DOLLY_PAN:2,DOLLY_ROTATE:3},nu=0,ga=1,iu=2,hl=1,dl=2,fn=3,Dn=0,Dt=1,pn=2,gn=0,vi=1,_a=2,va=3,xa=4,su=5,Hn=100,ru=101,au=102,Ma=103,Sa=104,ou=200,lu=201,cu=202,uu=203,Rr=204,Cr=205,hu=206,du=207,fu=208,pu=209,mu=210,gu=211,_u=212,vu=213,xu=214,Mu=0,Su=1,Eu=2,Es=3,yu=4,Tu=5,bu=6,Au=7,fl=0,wu=1,Ru=2,Rn=0,Cu=1,Lu=2,Pu=3,pl=4,Du=5,Uu=6,ml=300,Si=301,Ei=302,Lr=303,Pr=304,Cs=306,Dr=1e3,Qt=1001,Ur=1002,Rt=1003,Ea=1004,Xs=1005,Ht=1006,Iu=1007,Bi=1008,Cn=1009,Nu=1010,Fu=1011,Xr=1012,gl=1013,An=1014,wn=1015,yi=1016,_l=1017,vl=1018,Wn=1020,Ou=1021,en=1023,Bu=1024,zu=1025,Xn=1026,Ti=1027,Gu=1028,xl=1029,Hu=1030,Ml=1031,Sl=1033,$s=33776,qs=33777,Ys=33778,js=33779,ya=35840,Ta=35841,ba=35842,Aa=35843,El=36196,wa=37492,Ra=37496,Ca=37808,La=37809,Pa=37810,Da=37811,Ua=37812,Ia=37813,Na=37814,Fa=37815,Oa=37816,Ba=37817,za=37818,Ga=37819,Ha=37820,ka=37821,Ks=36492,Va=36494,Wa=36495,ku=36283,Xa=36284,$a=36285,qa=36286,yl=3e3,$n=3001,Vu=3200,Wu=3201,Tl=0,Xu=1,Wt="",Mt="srgb",vn="srgb-linear",$r="display-p3",Ls="display-p3-linear",ys="linear",nt="srgb",Ts="rec709",bs="p3",ei=7680,Ya=519,$u=512,qu=513,Yu=514,bl=515,ju=516,Ku=517,Zu=518,Ju=519,ja=35044,Ka="300 es",Ir=1035,mn=2e3,As=2001;class Zn{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;const n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;const s=this._listeners[e];if(s!==void 0){const r=s.indexOf(t);r!==-1&&s.splice(r,1)}}dispatchEvent(e){if(this._listeners===void 0)return;const n=this._listeners[e.type];if(n!==void 0){e.target=this;const s=n.slice(0);for(let r=0,o=s.length;r<o;r++)s[r].call(this,e);e.target=null}}}const yt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],xs=Math.PI/180,Nr=180/Math.PI;function Hi(){const i=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(yt[i&255]+yt[i>>8&255]+yt[i>>16&255]+yt[i>>24&255]+"-"+yt[e&255]+yt[e>>8&255]+"-"+yt[e>>16&15|64]+yt[e>>24&255]+"-"+yt[t&63|128]+yt[t>>8&255]+"-"+yt[t>>16&255]+yt[t>>24&255]+yt[n&255]+yt[n>>8&255]+yt[n>>16&255]+yt[n>>24&255]).toLowerCase()}function Ct(i,e,t){return Math.max(e,Math.min(t,i))}function Qu(i,e){return(i%e+e)%e}function Zs(i,e,t){return(1-t)*i+t*e}function Za(i){return(i&i-1)===0&&i!==0}function Fr(i){return Math.pow(2,Math.floor(Math.log(i)/Math.LN2))}function Ri(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return i/4294967295;case Uint16Array:return i/65535;case Uint8Array:return i/255;case Int32Array:return Math.max(i/2147483647,-1);case Int16Array:return Math.max(i/32767,-1);case Int8Array:return Math.max(i/127,-1);default:throw new Error("Invalid component type.")}}function Pt(i,e){switch(e.constructor){case Float32Array:return i;case Uint32Array:return Math.round(i*4294967295);case Uint16Array:return Math.round(i*65535);case Uint8Array:return Math.round(i*255);case Int32Array:return Math.round(i*2147483647);case Int16Array:return Math.round(i*32767);case Int8Array:return Math.round(i*127);default:throw new Error("Invalid component type.")}}const eh={DEG2RAD:xs};class Ae{constructor(e=0,t=0){Ae.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const t=this.x,n=this.y,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6],this.y=s[1]*t+s[4]*n+s[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Ct(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){const n=Math.cos(t),s=Math.sin(t),r=this.x-e.x,o=this.y-e.y;return this.x=r*n-o*s+e.x,this.y=r*s+o*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Xe{constructor(e,t,n,s,r,o,a,l,c){Xe.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c)}set(e,t,n,s,r,o,a,l,c){const h=this.elements;return h[0]=e,h[1]=s,h[2]=a,h[3]=t,h[4]=r,h[5]=l,h[6]=n,h[7]=o,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[3],l=n[6],c=n[1],h=n[4],d=n[7],p=n[2],f=n[5],g=n[8],_=s[0],m=s[3],u=s[6],M=s[1],v=s[4],b=s[7],C=s[2],w=s[5],A=s[8];return r[0]=o*_+a*M+l*C,r[3]=o*m+a*v+l*w,r[6]=o*u+a*b+l*A,r[1]=c*_+h*M+d*C,r[4]=c*m+h*v+d*w,r[7]=c*u+h*b+d*A,r[2]=p*_+f*M+g*C,r[5]=p*m+f*v+g*w,r[8]=p*u+f*b+g*A,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],h=e[8];return t*o*h-t*a*c-n*r*h+n*a*l+s*r*c-s*o*l}invert(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],h=e[8],d=h*o-a*c,p=a*l-h*r,f=c*r-o*l,g=t*d+n*p+s*f;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const _=1/g;return e[0]=d*_,e[1]=(s*c-h*n)*_,e[2]=(a*n-s*o)*_,e[3]=p*_,e[4]=(h*t-s*l)*_,e[5]=(s*r-a*t)*_,e[6]=f*_,e[7]=(n*l-c*t)*_,e[8]=(o*t-n*r)*_,this}transpose(){let e;const t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,s,r,o,a){const l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*o+c*a)+o+e,-s*c,s*l,-s*(-c*o+l*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(Js.makeScale(e,t)),this}rotate(e){return this.premultiply(Js.makeRotation(-e)),this}translate(e,t){return this.premultiply(Js.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){const t=this.elements,n=e.elements;for(let s=0;s<9;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const Js=new Xe;function Al(i){for(let e=i.length-1;e>=0;--e)if(i[e]>=65535)return!0;return!1}function ws(i){return document.createElementNS("http://www.w3.org/1999/xhtml",i)}function th(){const i=ws("canvas");return i.style.display="block",i}const Ja={};function Fi(i){i in Ja||(Ja[i]=!0,console.warn(i))}const Qa=new Xe().set(.8224621,.177538,0,.0331941,.9668058,0,.0170827,.0723974,.9105199),eo=new Xe().set(1.2249401,-.2249404,0,-.0420569,1.0420571,0,-.0196376,-.0786361,1.0982735),ji={[vn]:{transfer:ys,primaries:Ts,toReference:i=>i,fromReference:i=>i},[Mt]:{transfer:nt,primaries:Ts,toReference:i=>i.convertSRGBToLinear(),fromReference:i=>i.convertLinearToSRGB()},[Ls]:{transfer:ys,primaries:bs,toReference:i=>i.applyMatrix3(eo),fromReference:i=>i.applyMatrix3(Qa)},[$r]:{transfer:nt,primaries:bs,toReference:i=>i.convertSRGBToLinear().applyMatrix3(eo),fromReference:i=>i.applyMatrix3(Qa).convertLinearToSRGB()}},nh=new Set([vn,Ls]),Qe={enabled:!0,_workingColorSpace:vn,get workingColorSpace(){return this._workingColorSpace},set workingColorSpace(i){if(!nh.has(i))throw new Error(`Unsupported working color space, "${i}".`);this._workingColorSpace=i},convert:function(i,e,t){if(this.enabled===!1||e===t||!e||!t)return i;const n=ji[e].toReference,s=ji[t].fromReference;return s(n(i))},fromWorkingColorSpace:function(i,e){return this.convert(i,this._workingColorSpace,e)},toWorkingColorSpace:function(i,e){return this.convert(i,e,this._workingColorSpace)},getPrimaries:function(i){return ji[i].primaries},getTransfer:function(i){return i===Wt?ys:ji[i].transfer}};function xi(i){return i<.04045?i*.0773993808:Math.pow(i*.9478672986+.0521327014,2.4)}function Qs(i){return i<.0031308?i*12.92:1.055*Math.pow(i,.41666)-.055}let ti;class wl{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{ti===void 0&&(ti=ws("canvas")),ti.width=e.width,ti.height=e.height;const n=ti.getContext("2d");e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=ti}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const t=ws("canvas");t.width=e.width,t.height=e.height;const n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);const s=n.getImageData(0,0,e.width,e.height),r=s.data;for(let o=0;o<r.length;o++)r[o]=xi(r[o]/255)*255;return n.putImageData(s,0,0),t}else if(e.data){const t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(xi(t[n]/255)*255):t[n]=xi(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let ih=0;class Rl{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:ih++}),this.uuid=Hi(),this.data=e,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const n={uuid:this.uuid,url:""},s=this.data;if(s!==null){let r;if(Array.isArray(s)){r=[];for(let o=0,a=s.length;o<a;o++)s[o].isDataTexture?r.push(er(s[o].image)):r.push(er(s[o]))}else r=er(s);n.url=r}return t||(e.images[this.uuid]=n),n}}function er(i){return typeof HTMLImageElement<"u"&&i instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&i instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&i instanceof ImageBitmap?wl.getDataURL(i):i.data?{data:Array.from(i.data),width:i.width,height:i.height,type:i.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let sh=0;class Ot extends Zn{constructor(e=Ot.DEFAULT_IMAGE,t=Ot.DEFAULT_MAPPING,n=Qt,s=Qt,r=Ht,o=Bi,a=en,l=Cn,c=Ot.DEFAULT_ANISOTROPY,h=Wt){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:sh++}),this.uuid=Hi(),this.name="",this.source=new Rl(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=s,this.magFilter=r,this.minFilter=o,this.anisotropy=c,this.format=a,this.internalFormat=null,this.type=l,this.offset=new Ae(0,0),this.repeat=new Ae(1,1),this.center=new Ae(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Xe,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,typeof h=="string"?this.colorSpace=h:(Fi("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace=h===$n?Mt:Wt),this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.needsPMREMUpdate=!1}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==ml)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case Dr:e.x=e.x-Math.floor(e.x);break;case Qt:e.x=e.x<0?0:1;break;case Ur:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case Dr:e.y=e.y-Math.floor(e.y);break;case Qt:e.y=e.y<0?0:1;break;case Ur:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}get encoding(){return Fi("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace===Mt?$n:yl}set encoding(e){Fi("THREE.Texture: Property .encoding has been replaced by .colorSpace."),this.colorSpace=e===$n?Mt:Wt}}Ot.DEFAULT_IMAGE=null;Ot.DEFAULT_MAPPING=ml;Ot.DEFAULT_ANISOTROPY=1;class xt{constructor(e=0,t=0,n=0,s=1){xt.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=s}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,s){return this.x=e,this.y=t,this.z=n,this.w=s,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const t=this.x,n=this.y,s=this.z,r=this.w,o=e.elements;return this.x=o[0]*t+o[4]*n+o[8]*s+o[12]*r,this.y=o[1]*t+o[5]*n+o[9]*s+o[13]*r,this.z=o[2]*t+o[6]*n+o[10]*s+o[14]*r,this.w=o[3]*t+o[7]*n+o[11]*s+o[15]*r,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,s,r;const l=e.elements,c=l[0],h=l[4],d=l[8],p=l[1],f=l[5],g=l[9],_=l[2],m=l[6],u=l[10];if(Math.abs(h-p)<.01&&Math.abs(d-_)<.01&&Math.abs(g-m)<.01){if(Math.abs(h+p)<.1&&Math.abs(d+_)<.1&&Math.abs(g+m)<.1&&Math.abs(c+f+u-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;const v=(c+1)/2,b=(f+1)/2,C=(u+1)/2,w=(h+p)/4,A=(d+_)/4,U=(g+m)/4;return v>b&&v>C?v<.01?(n=0,s=.707106781,r=.707106781):(n=Math.sqrt(v),s=w/n,r=A/n):b>C?b<.01?(n=.707106781,s=0,r=.707106781):(s=Math.sqrt(b),n=w/s,r=U/s):C<.01?(n=.707106781,s=.707106781,r=0):(r=Math.sqrt(C),n=A/r,s=U/r),this.set(n,s,r,t),this}let M=Math.sqrt((m-g)*(m-g)+(d-_)*(d-_)+(p-h)*(p-h));return Math.abs(M)<.001&&(M=1),this.x=(m-g)/M,this.y=(d-_)/M,this.z=(p-h)/M,this.w=Math.acos((c+f+u-1)/2),this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this.w=Math.max(e.w,Math.min(t.w,this.w)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this.w=Math.max(e,Math.min(t,this.w)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class rh extends Zn{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new xt(0,0,e,t),this.scissorTest=!1,this.viewport=new xt(0,0,e,t);const s={width:e,height:t,depth:1};n.encoding!==void 0&&(Fi("THREE.WebGLRenderTarget: option.encoding has been replaced by option.colorSpace."),n.colorSpace=n.encoding===$n?Mt:Wt),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Ht,depthBuffer:!0,stencilBuffer:!1,depthTexture:null,samples:0},n),this.texture=new Ot(s,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.flipY=!1,this.texture.generateMipmaps=n.generateMipmaps,this.texture.internalFormat=n.internalFormat,this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}setSize(e,t,n=1){(this.width!==e||this.height!==t||this.depth!==n)&&(this.width=e,this.height=t,this.depth=n,this.texture.image.width=e,this.texture.image.height=t,this.texture.image.depth=n,this.dispose()),this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.texture=e.texture.clone(),this.texture.isRenderTargetTexture=!0;const t=Object.assign({},e.texture.image);return this.texture.source=new Rl(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class Un extends rh{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}}class Cl extends Ot{constructor(e=null,t=1,n=1,s=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Rt,this.minFilter=Rt,this.wrapR=Qt,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class ah extends Ot{constructor(e=null,t=1,n=1,s=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:s},this.magFilter=Rt,this.minFilter=Rt,this.wrapR=Qt,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Yn{constructor(e=0,t=0,n=0,s=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=s}static slerpFlat(e,t,n,s,r,o,a){let l=n[s+0],c=n[s+1],h=n[s+2],d=n[s+3];const p=r[o+0],f=r[o+1],g=r[o+2],_=r[o+3];if(a===0){e[t+0]=l,e[t+1]=c,e[t+2]=h,e[t+3]=d;return}if(a===1){e[t+0]=p,e[t+1]=f,e[t+2]=g,e[t+3]=_;return}if(d!==_||l!==p||c!==f||h!==g){let m=1-a;const u=l*p+c*f+h*g+d*_,M=u>=0?1:-1,v=1-u*u;if(v>Number.EPSILON){const C=Math.sqrt(v),w=Math.atan2(C,u*M);m=Math.sin(m*w)/C,a=Math.sin(a*w)/C}const b=a*M;if(l=l*m+p*b,c=c*m+f*b,h=h*m+g*b,d=d*m+_*b,m===1-a){const C=1/Math.sqrt(l*l+c*c+h*h+d*d);l*=C,c*=C,h*=C,d*=C}}e[t]=l,e[t+1]=c,e[t+2]=h,e[t+3]=d}static multiplyQuaternionsFlat(e,t,n,s,r,o){const a=n[s],l=n[s+1],c=n[s+2],h=n[s+3],d=r[o],p=r[o+1],f=r[o+2],g=r[o+3];return e[t]=a*g+h*d+l*f-c*p,e[t+1]=l*g+h*p+c*d-a*f,e[t+2]=c*g+h*f+a*p-l*d,e[t+3]=h*g-a*d-l*p-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,s){return this._x=e,this._y=t,this._z=n,this._w=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){const n=e._x,s=e._y,r=e._z,o=e._order,a=Math.cos,l=Math.sin,c=a(n/2),h=a(s/2),d=a(r/2),p=l(n/2),f=l(s/2),g=l(r/2);switch(o){case"XYZ":this._x=p*h*d+c*f*g,this._y=c*f*d-p*h*g,this._z=c*h*g+p*f*d,this._w=c*h*d-p*f*g;break;case"YXZ":this._x=p*h*d+c*f*g,this._y=c*f*d-p*h*g,this._z=c*h*g-p*f*d,this._w=c*h*d+p*f*g;break;case"ZXY":this._x=p*h*d-c*f*g,this._y=c*f*d+p*h*g,this._z=c*h*g+p*f*d,this._w=c*h*d-p*f*g;break;case"ZYX":this._x=p*h*d-c*f*g,this._y=c*f*d+p*h*g,this._z=c*h*g-p*f*d,this._w=c*h*d+p*f*g;break;case"YZX":this._x=p*h*d+c*f*g,this._y=c*f*d+p*h*g,this._z=c*h*g-p*f*d,this._w=c*h*d-p*f*g;break;case"XZY":this._x=p*h*d-c*f*g,this._y=c*f*d-p*h*g,this._z=c*h*g+p*f*d,this._w=c*h*d+p*f*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){const n=t/2,s=Math.sin(n);return this._x=e.x*s,this._y=e.y*s,this._z=e.z*s,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){const t=e.elements,n=t[0],s=t[4],r=t[8],o=t[1],a=t[5],l=t[9],c=t[2],h=t[6],d=t[10],p=n+a+d;if(p>0){const f=.5/Math.sqrt(p+1);this._w=.25/f,this._x=(h-l)*f,this._y=(r-c)*f,this._z=(o-s)*f}else if(n>a&&n>d){const f=2*Math.sqrt(1+n-a-d);this._w=(h-l)/f,this._x=.25*f,this._y=(s+o)/f,this._z=(r+c)/f}else if(a>d){const f=2*Math.sqrt(1+a-n-d);this._w=(r-c)/f,this._x=(s+o)/f,this._y=.25*f,this._z=(l+h)/f}else{const f=2*Math.sqrt(1+d-n-a);this._w=(o-s)/f,this._x=(r+c)/f,this._y=(l+h)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ct(this.dot(e),-1,1)))}rotateTowards(e,t){const n=this.angleTo(e);if(n===0)return this;const s=Math.min(1,t/n);return this.slerp(e,s),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){const n=e._x,s=e._y,r=e._z,o=e._w,a=t._x,l=t._y,c=t._z,h=t._w;return this._x=n*h+o*a+s*c-r*l,this._y=s*h+o*l+r*a-n*c,this._z=r*h+o*c+n*l-s*a,this._w=o*h-n*a-s*l-r*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);const n=this._x,s=this._y,r=this._z,o=this._w;let a=o*e._w+n*e._x+s*e._y+r*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=n,this._y=s,this._z=r,this;const l=1-a*a;if(l<=Number.EPSILON){const f=1-t;return this._w=f*o+t*this._w,this._x=f*n+t*this._x,this._y=f*s+t*this._y,this._z=f*r+t*this._z,this.normalize(),this}const c=Math.sqrt(l),h=Math.atan2(c,a),d=Math.sin((1-t)*h)/c,p=Math.sin(t*h)/c;return this._w=o*d+this._w*p,this._x=n*d+this._x*p,this._y=s*d+this._y*p,this._z=r*d+this._z*p,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){const e=Math.random(),t=Math.sqrt(1-e),n=Math.sqrt(e),s=2*Math.PI*Math.random(),r=2*Math.PI*Math.random();return this.set(t*Math.cos(s),n*Math.sin(r),n*Math.cos(r),t*Math.sin(s))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class I{constructor(e=0,t=0,n=0){I.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(to.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(to.setFromAxisAngle(e,t))}applyMatrix3(e){const t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*s,this.y=r[1]*t+r[4]*n+r[7]*s,this.z=r[2]*t+r[5]*n+r[8]*s,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const t=this.x,n=this.y,s=this.z,r=e.elements,o=1/(r[3]*t+r[7]*n+r[11]*s+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*s+r[12])*o,this.y=(r[1]*t+r[5]*n+r[9]*s+r[13])*o,this.z=(r[2]*t+r[6]*n+r[10]*s+r[14])*o,this}applyQuaternion(e){const t=this.x,n=this.y,s=this.z,r=e.x,o=e.y,a=e.z,l=e.w,c=2*(o*s-a*n),h=2*(a*t-r*s),d=2*(r*n-o*t);return this.x=t+l*c+o*d-a*h,this.y=n+l*h+a*c-r*d,this.z=s+l*d+r*h-o*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const t=this.x,n=this.y,s=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*s,this.y=r[1]*t+r[5]*n+r[9]*s,this.z=r[2]*t+r[6]*n+r[10]*s,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Math.max(e.x,Math.min(t.x,this.x)),this.y=Math.max(e.y,Math.min(t.y,this.y)),this.z=Math.max(e.z,Math.min(t.z,this.z)),this}clampScalar(e,t){return this.x=Math.max(e,Math.min(t,this.x)),this.y=Math.max(e,Math.min(t,this.y)),this.z=Math.max(e,Math.min(t,this.z)),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(e,Math.min(t,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){const n=e.x,s=e.y,r=e.z,o=t.x,a=t.y,l=t.z;return this.x=s*l-r*a,this.y=r*o-n*l,this.z=n*a-s*o,this}projectOnVector(e){const t=e.lengthSq();if(t===0)return this.set(0,0,0);const n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return tr.copy(this).projectOnVector(e),this.sub(tr)}reflect(e){return this.sub(tr.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Ct(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y,s=this.z-e.z;return t*t+n*n+s*s}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){const s=Math.sin(t)*e;return this.x=s*Math.sin(n),this.y=Math.cos(t)*e,this.z=s*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){const t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),s=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=s,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=(Math.random()-.5)*2,t=Math.random()*Math.PI*2,n=Math.sqrt(1-e**2);return this.x=n*Math.cos(t),this.y=n*Math.sin(t),this.z=e,this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const tr=new I,to=new Yn;class ki{constructor(e=new I(1/0,1/0,1/0),t=new I(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(qt.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(qt.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){const n=qt.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);const n=e.geometry;if(n!==void 0){const r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,qt):qt.fromBufferAttribute(r,o),qt.applyMatrix4(e.matrixWorld),this.expandByPoint(qt);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Ki.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),Ki.copy(n.boundingBox)),Ki.applyMatrix4(e.matrixWorld),this.union(Ki)}const s=e.children;for(let r=0,o=s.length;r<o;r++)this.expandByObject(s[r],t);return this}containsPoint(e){return!(e.x<this.min.x||e.x>this.max.x||e.y<this.min.y||e.y>this.max.y||e.z<this.min.z||e.z>this.max.z)}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return!(e.max.x<this.min.x||e.min.x>this.max.x||e.max.y<this.min.y||e.min.y>this.max.y||e.max.z<this.min.z||e.min.z>this.max.z)}intersectsSphere(e){return this.clampPoint(e.center,qt),qt.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(Ci),Zi.subVectors(this.max,Ci),ni.subVectors(e.a,Ci),ii.subVectors(e.b,Ci),si.subVectors(e.c,Ci),Mn.subVectors(ii,ni),Sn.subVectors(si,ii),Fn.subVectors(ni,si);let t=[0,-Mn.z,Mn.y,0,-Sn.z,Sn.y,0,-Fn.z,Fn.y,Mn.z,0,-Mn.x,Sn.z,0,-Sn.x,Fn.z,0,-Fn.x,-Mn.y,Mn.x,0,-Sn.y,Sn.x,0,-Fn.y,Fn.x,0];return!nr(t,ni,ii,si,Zi)||(t=[1,0,0,0,1,0,0,0,1],!nr(t,ni,ii,si,Zi))?!1:(Ji.crossVectors(Mn,Sn),t=[Ji.x,Ji.y,Ji.z],nr(t,ni,ii,si,Zi))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,qt).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(qt).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(ln[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),ln[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),ln[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),ln[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),ln[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),ln[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),ln[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),ln[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(ln),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}}const ln=[new I,new I,new I,new I,new I,new I,new I,new I],qt=new I,Ki=new ki,ni=new I,ii=new I,si=new I,Mn=new I,Sn=new I,Fn=new I,Ci=new I,Zi=new I,Ji=new I,On=new I;function nr(i,e,t,n,s){for(let r=0,o=i.length-3;r<=o;r+=3){On.fromArray(i,r);const a=s.x*Math.abs(On.x)+s.y*Math.abs(On.y)+s.z*Math.abs(On.z),l=e.dot(On),c=t.dot(On),h=n.dot(On);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>a)return!1}return!0}const oh=new ki,Li=new I,ir=new I;class qr{constructor(e=new I,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){const n=this.center;t!==void 0?n.copy(t):oh.setFromPoints(e).getCenter(n);let s=0;for(let r=0,o=e.length;r<o;r++)s=Math.max(s,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(s),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){const n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;Li.subVectors(e,this.center);const t=Li.lengthSq();if(t>this.radius*this.radius){const n=Math.sqrt(t),s=(n-this.radius)*.5;this.center.addScaledVector(Li,s/n),this.radius+=s}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(ir.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(Li.copy(e.center).add(ir)),this.expandByPoint(Li.copy(e.center).sub(ir))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}}const cn=new I,sr=new I,Qi=new I,En=new I,rr=new I,es=new I,ar=new I;class Yr{constructor(e=new I,t=new I(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,cn)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);const n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const t=cn.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(cn.copy(this.origin).addScaledVector(this.direction,t),cn.distanceToSquared(e))}distanceSqToSegment(e,t,n,s){sr.copy(e).add(t).multiplyScalar(.5),Qi.copy(t).sub(e).normalize(),En.copy(this.origin).sub(sr);const r=e.distanceTo(t)*.5,o=-this.direction.dot(Qi),a=En.dot(this.direction),l=-En.dot(Qi),c=En.lengthSq(),h=Math.abs(1-o*o);let d,p,f,g;if(h>0)if(d=o*l-a,p=o*a-l,g=r*h,d>=0)if(p>=-g)if(p<=g){const _=1/h;d*=_,p*=_,f=d*(d+o*p+2*a)+p*(o*d+p+2*l)+c}else p=r,d=Math.max(0,-(o*p+a)),f=-d*d+p*(p+2*l)+c;else p=-r,d=Math.max(0,-(o*p+a)),f=-d*d+p*(p+2*l)+c;else p<=-g?(d=Math.max(0,-(-o*r+a)),p=d>0?-r:Math.min(Math.max(-r,-l),r),f=-d*d+p*(p+2*l)+c):p<=g?(d=0,p=Math.min(Math.max(-r,-l),r),f=p*(p+2*l)+c):(d=Math.max(0,-(o*r+a)),p=d>0?r:Math.min(Math.max(-r,-l),r),f=-d*d+p*(p+2*l)+c);else p=o>0?-r:r,d=Math.max(0,-(o*p+a)),f=-d*d+p*(p+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,d),s&&s.copy(sr).addScaledVector(Qi,p),f}intersectSphere(e,t){cn.subVectors(e.center,this.origin);const n=cn.dot(this.direction),s=cn.dot(cn)-n*n,r=e.radius*e.radius;if(s>r)return null;const o=Math.sqrt(r-s),a=n-o,l=n+o;return l<0?null:a<0?this.at(l,t):this.at(a,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){const n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){const t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,s,r,o,a,l;const c=1/this.direction.x,h=1/this.direction.y,d=1/this.direction.z,p=this.origin;return c>=0?(n=(e.min.x-p.x)*c,s=(e.max.x-p.x)*c):(n=(e.max.x-p.x)*c,s=(e.min.x-p.x)*c),h>=0?(r=(e.min.y-p.y)*h,o=(e.max.y-p.y)*h):(r=(e.max.y-p.y)*h,o=(e.min.y-p.y)*h),n>o||r>s||((r>n||isNaN(n))&&(n=r),(o<s||isNaN(s))&&(s=o),d>=0?(a=(e.min.z-p.z)*d,l=(e.max.z-p.z)*d):(a=(e.max.z-p.z)*d,l=(e.min.z-p.z)*d),n>l||a>s)||((a>n||n!==n)&&(n=a),(l<s||s!==s)&&(s=l),s<0)?null:this.at(n>=0?n:s,t)}intersectsBox(e){return this.intersectBox(e,cn)!==null}intersectTriangle(e,t,n,s,r){rr.subVectors(t,e),es.subVectors(n,e),ar.crossVectors(rr,es);let o=this.direction.dot(ar),a;if(o>0){if(s)return null;a=1}else if(o<0)a=-1,o=-o;else return null;En.subVectors(this.origin,e);const l=a*this.direction.dot(es.crossVectors(En,es));if(l<0)return null;const c=a*this.direction.dot(rr.cross(En));if(c<0||l+c>o)return null;const h=-a*En.dot(ar);return h<0?null:this.at(h/o,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class dt{constructor(e,t,n,s,r,o,a,l,c,h,d,p,f,g,_,m){dt.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,s,r,o,a,l,c,h,d,p,f,g,_,m)}set(e,t,n,s,r,o,a,l,c,h,d,p,f,g,_,m){const u=this.elements;return u[0]=e,u[4]=t,u[8]=n,u[12]=s,u[1]=r,u[5]=o,u[9]=a,u[13]=l,u[2]=c,u[6]=h,u[10]=d,u[14]=p,u[3]=f,u[7]=g,u[11]=_,u[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new dt().fromArray(this.elements)}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){const t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){const t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){const t=this.elements,n=e.elements,s=1/ri.setFromMatrixColumn(e,0).length(),r=1/ri.setFromMatrixColumn(e,1).length(),o=1/ri.setFromMatrixColumn(e,2).length();return t[0]=n[0]*s,t[1]=n[1]*s,t[2]=n[2]*s,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*o,t[9]=n[9]*o,t[10]=n[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){const t=this.elements,n=e.x,s=e.y,r=e.z,o=Math.cos(n),a=Math.sin(n),l=Math.cos(s),c=Math.sin(s),h=Math.cos(r),d=Math.sin(r);if(e.order==="XYZ"){const p=o*h,f=o*d,g=a*h,_=a*d;t[0]=l*h,t[4]=-l*d,t[8]=c,t[1]=f+g*c,t[5]=p-_*c,t[9]=-a*l,t[2]=_-p*c,t[6]=g+f*c,t[10]=o*l}else if(e.order==="YXZ"){const p=l*h,f=l*d,g=c*h,_=c*d;t[0]=p+_*a,t[4]=g*a-f,t[8]=o*c,t[1]=o*d,t[5]=o*h,t[9]=-a,t[2]=f*a-g,t[6]=_+p*a,t[10]=o*l}else if(e.order==="ZXY"){const p=l*h,f=l*d,g=c*h,_=c*d;t[0]=p-_*a,t[4]=-o*d,t[8]=g+f*a,t[1]=f+g*a,t[5]=o*h,t[9]=_-p*a,t[2]=-o*c,t[6]=a,t[10]=o*l}else if(e.order==="ZYX"){const p=o*h,f=o*d,g=a*h,_=a*d;t[0]=l*h,t[4]=g*c-f,t[8]=p*c+_,t[1]=l*d,t[5]=_*c+p,t[9]=f*c-g,t[2]=-c,t[6]=a*l,t[10]=o*l}else if(e.order==="YZX"){const p=o*l,f=o*c,g=a*l,_=a*c;t[0]=l*h,t[4]=_-p*d,t[8]=g*d+f,t[1]=d,t[5]=o*h,t[9]=-a*h,t[2]=-c*h,t[6]=f*d+g,t[10]=p-_*d}else if(e.order==="XZY"){const p=o*l,f=o*c,g=a*l,_=a*c;t[0]=l*h,t[4]=-d,t[8]=c*h,t[1]=p*d+_,t[5]=o*h,t[9]=f*d-g,t[2]=g*d-f,t[6]=a*h,t[10]=_*d+p}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(lh,e,ch)}lookAt(e,t,n){const s=this.elements;return It.subVectors(e,t),It.lengthSq()===0&&(It.z=1),It.normalize(),yn.crossVectors(n,It),yn.lengthSq()===0&&(Math.abs(n.z)===1?It.x+=1e-4:It.z+=1e-4,It.normalize(),yn.crossVectors(n,It)),yn.normalize(),ts.crossVectors(It,yn),s[0]=yn.x,s[4]=ts.x,s[8]=It.x,s[1]=yn.y,s[5]=ts.y,s[9]=It.y,s[2]=yn.z,s[6]=ts.z,s[10]=It.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,s=t.elements,r=this.elements,o=n[0],a=n[4],l=n[8],c=n[12],h=n[1],d=n[5],p=n[9],f=n[13],g=n[2],_=n[6],m=n[10],u=n[14],M=n[3],v=n[7],b=n[11],C=n[15],w=s[0],A=s[4],U=s[8],x=s[12],E=s[1],F=s[5],V=s[9],ne=s[13],D=s[2],O=s[6],X=s[10],Y=s[14],q=s[3],$=s[7],Q=s[11],ie=s[15];return r[0]=o*w+a*E+l*D+c*q,r[4]=o*A+a*F+l*O+c*$,r[8]=o*U+a*V+l*X+c*Q,r[12]=o*x+a*ne+l*Y+c*ie,r[1]=h*w+d*E+p*D+f*q,r[5]=h*A+d*F+p*O+f*$,r[9]=h*U+d*V+p*X+f*Q,r[13]=h*x+d*ne+p*Y+f*ie,r[2]=g*w+_*E+m*D+u*q,r[6]=g*A+_*F+m*O+u*$,r[10]=g*U+_*V+m*X+u*Q,r[14]=g*x+_*ne+m*Y+u*ie,r[3]=M*w+v*E+b*D+C*q,r[7]=M*A+v*F+b*O+C*$,r[11]=M*U+v*V+b*X+C*Q,r[15]=M*x+v*ne+b*Y+C*ie,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[4],s=e[8],r=e[12],o=e[1],a=e[5],l=e[9],c=e[13],h=e[2],d=e[6],p=e[10],f=e[14],g=e[3],_=e[7],m=e[11],u=e[15];return g*(+r*l*d-s*c*d-r*a*p+n*c*p+s*a*f-n*l*f)+_*(+t*l*f-t*c*p+r*o*p-s*o*f+s*c*h-r*l*h)+m*(+t*c*d-t*a*f-r*o*d+n*o*f+r*a*h-n*c*h)+u*(-s*a*h-t*l*d+t*a*p+s*o*d-n*o*p+n*l*h)}transpose(){const e=this.elements;let t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){const s=this.elements;return e.isVector3?(s[12]=e.x,s[13]=e.y,s[14]=e.z):(s[12]=e,s[13]=t,s[14]=n),this}invert(){const e=this.elements,t=e[0],n=e[1],s=e[2],r=e[3],o=e[4],a=e[5],l=e[6],c=e[7],h=e[8],d=e[9],p=e[10],f=e[11],g=e[12],_=e[13],m=e[14],u=e[15],M=d*m*c-_*p*c+_*l*f-a*m*f-d*l*u+a*p*u,v=g*p*c-h*m*c-g*l*f+o*m*f+h*l*u-o*p*u,b=h*_*c-g*d*c+g*a*f-o*_*f-h*a*u+o*d*u,C=g*d*l-h*_*l-g*a*p+o*_*p+h*a*m-o*d*m,w=t*M+n*v+s*b+r*C;if(w===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const A=1/w;return e[0]=M*A,e[1]=(_*p*r-d*m*r-_*s*f+n*m*f+d*s*u-n*p*u)*A,e[2]=(a*m*r-_*l*r+_*s*c-n*m*c-a*s*u+n*l*u)*A,e[3]=(d*l*r-a*p*r-d*s*c+n*p*c+a*s*f-n*l*f)*A,e[4]=v*A,e[5]=(h*m*r-g*p*r+g*s*f-t*m*f-h*s*u+t*p*u)*A,e[6]=(g*l*r-o*m*r-g*s*c+t*m*c+o*s*u-t*l*u)*A,e[7]=(o*p*r-h*l*r+h*s*c-t*p*c-o*s*f+t*l*f)*A,e[8]=b*A,e[9]=(g*d*r-h*_*r-g*n*f+t*_*f+h*n*u-t*d*u)*A,e[10]=(o*_*r-g*a*r+g*n*c-t*_*c-o*n*u+t*a*u)*A,e[11]=(h*a*r-o*d*r-h*n*c+t*d*c+o*n*f-t*a*f)*A,e[12]=C*A,e[13]=(h*_*s-g*d*s+g*n*p-t*_*p-h*n*m+t*d*m)*A,e[14]=(g*a*s-o*_*s-g*n*l+t*_*l+o*n*m-t*a*m)*A,e[15]=(o*d*s-h*a*s+h*n*l-t*d*l-o*n*p+t*a*p)*A,this}scale(e){const t=this.elements,n=e.x,s=e.y,r=e.z;return t[0]*=n,t[4]*=s,t[8]*=r,t[1]*=n,t[5]*=s,t[9]*=r,t[2]*=n,t[6]*=s,t[10]*=r,t[3]*=n,t[7]*=s,t[11]*=r,this}getMaxScaleOnAxis(){const e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],s=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,s))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){const t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){const n=Math.cos(t),s=Math.sin(t),r=1-n,o=e.x,a=e.y,l=e.z,c=r*o,h=r*a;return this.set(c*o+n,c*a-s*l,c*l+s*a,0,c*a+s*l,h*a+n,h*l-s*o,0,c*l-s*a,h*l+s*o,r*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,s,r,o){return this.set(1,n,r,0,e,1,o,0,t,s,1,0,0,0,0,1),this}compose(e,t,n){const s=this.elements,r=t._x,o=t._y,a=t._z,l=t._w,c=r+r,h=o+o,d=a+a,p=r*c,f=r*h,g=r*d,_=o*h,m=o*d,u=a*d,M=l*c,v=l*h,b=l*d,C=n.x,w=n.y,A=n.z;return s[0]=(1-(_+u))*C,s[1]=(f+b)*C,s[2]=(g-v)*C,s[3]=0,s[4]=(f-b)*w,s[5]=(1-(p+u))*w,s[6]=(m+M)*w,s[7]=0,s[8]=(g+v)*A,s[9]=(m-M)*A,s[10]=(1-(p+_))*A,s[11]=0,s[12]=e.x,s[13]=e.y,s[14]=e.z,s[15]=1,this}decompose(e,t,n){const s=this.elements;let r=ri.set(s[0],s[1],s[2]).length();const o=ri.set(s[4],s[5],s[6]).length(),a=ri.set(s[8],s[9],s[10]).length();this.determinant()<0&&(r=-r),e.x=s[12],e.y=s[13],e.z=s[14],Yt.copy(this);const c=1/r,h=1/o,d=1/a;return Yt.elements[0]*=c,Yt.elements[1]*=c,Yt.elements[2]*=c,Yt.elements[4]*=h,Yt.elements[5]*=h,Yt.elements[6]*=h,Yt.elements[8]*=d,Yt.elements[9]*=d,Yt.elements[10]*=d,t.setFromRotationMatrix(Yt),n.x=r,n.y=o,n.z=a,this}makePerspective(e,t,n,s,r,o,a=mn){const l=this.elements,c=2*r/(t-e),h=2*r/(n-s),d=(t+e)/(t-e),p=(n+s)/(n-s);let f,g;if(a===mn)f=-(o+r)/(o-r),g=-2*o*r/(o-r);else if(a===As)f=-o/(o-r),g=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return l[0]=c,l[4]=0,l[8]=d,l[12]=0,l[1]=0,l[5]=h,l[9]=p,l[13]=0,l[2]=0,l[6]=0,l[10]=f,l[14]=g,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,s,r,o,a=mn){const l=this.elements,c=1/(t-e),h=1/(n-s),d=1/(o-r),p=(t+e)*c,f=(n+s)*h;let g,_;if(a===mn)g=(o+r)*d,_=-2*d;else if(a===As)g=r*d,_=-1*d;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-p,l[1]=0,l[5]=2*h,l[9]=0,l[13]=-f,l[2]=0,l[6]=0,l[10]=_,l[14]=-g,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){const t=this.elements,n=e.elements;for(let s=0;s<16;s++)if(t[s]!==n[s])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}}const ri=new I,Yt=new dt,lh=new I(0,0,0),ch=new I(1,1,1),yn=new I,ts=new I,It=new I,no=new dt,io=new Yn;class Ps{constructor(e=0,t=0,n=0,s=Ps.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=s}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,s=this._order){return this._x=e,this._y=t,this._z=n,this._order=s,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){const s=e.elements,r=s[0],o=s[4],a=s[8],l=s[1],c=s[5],h=s[9],d=s[2],p=s[6],f=s[10];switch(t){case"XYZ":this._y=Math.asin(Ct(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-h,f),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(p,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Ct(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(a,f),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-d,r),this._z=0);break;case"ZXY":this._x=Math.asin(Ct(p,-1,1)),Math.abs(p)<.9999999?(this._y=Math.atan2(-d,f),this._z=Math.atan2(-o,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Ct(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(p,f),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-o,c));break;case"YZX":this._z=Math.asin(Ct(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-d,r)):(this._x=0,this._y=Math.atan2(a,f));break;case"XZY":this._z=Math.asin(-Ct(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(p,c),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-h,f),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return no.makeRotationFromQuaternion(e),this.setFromRotationMatrix(no,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return io.setFromEuler(this),this.setFromQuaternion(io,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Ps.DEFAULT_ORDER="XYZ";class jr{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let uh=0;const so=new I,ai=new Yn,un=new dt,ns=new I,Pi=new I,hh=new I,dh=new Yn,ro=new I(1,0,0),ao=new I(0,1,0),oo=new I(0,0,1),fh={type:"added"},ph={type:"removed"};class St extends Zn{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:uh++}),this.uuid=Hi(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=St.DEFAULT_UP.clone();const e=new I,t=new Ps,n=new Yn,s=new I(1,1,1);function r(){n.setFromEuler(t,!1)}function o(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:s},modelViewMatrix:{value:new dt},normalMatrix:{value:new Xe}}),this.matrix=new dt,this.matrixWorld=new dt,this.matrixAutoUpdate=St.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=St.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new jr,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return ai.setFromAxisAngle(e,t),this.quaternion.multiply(ai),this}rotateOnWorldAxis(e,t){return ai.setFromAxisAngle(e,t),this.quaternion.premultiply(ai),this}rotateX(e){return this.rotateOnAxis(ro,e)}rotateY(e){return this.rotateOnAxis(ao,e)}rotateZ(e){return this.rotateOnAxis(oo,e)}translateOnAxis(e,t){return so.copy(e).applyQuaternion(this.quaternion),this.position.add(so.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(ro,e)}translateY(e){return this.translateOnAxis(ao,e)}translateZ(e){return this.translateOnAxis(oo,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(un.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?ns.copy(e):ns.set(e,t,n);const s=this.parent;this.updateWorldMatrix(!0,!1),Pi.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?un.lookAt(Pi,ns,this.up):un.lookAt(ns,Pi,this.up),this.quaternion.setFromRotationMatrix(un),s&&(un.extractRotation(s.matrixWorld),ai.setFromRotationMatrix(un),this.quaternion.premultiply(ai.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.parent!==null&&e.parent.remove(e),e.parent=this,this.children.push(e),e.dispatchEvent(fh)):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(ph)),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),un.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),un.multiply(e.parent.matrixWorld)),e.applyMatrix4(un),this.add(e),e.updateWorldMatrix(!1,!0),this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,s=this.children.length;n<s;n++){const o=this.children[n].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);const s=this.children;for(let r=0,o=s.length;r<o;r++)s[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Pi,e,hh),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Pi,dh,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const t=this.children;for(let n=0,s=t.length;n<s;n++)t[n].traverseVisible(e)}traverseAncestors(e){const t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix),this.matrixWorldNeedsUpdate=!1,e=!0);const t=this.children;for(let n=0,s=t.length;n<s;n++){const r=t[n];(r.matrixWorldAutoUpdate===!0||e===!0)&&r.updateMatrixWorld(e)}}updateWorldMatrix(e,t){const n=this.parent;if(e===!0&&n!==null&&n.matrixWorldAutoUpdate===!0&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix),t===!0){const s=this.children;for(let r=0,o=s.length;r<o;r++){const a=s[r];a.matrixWorldAutoUpdate===!0&&a.updateWorldMatrix(!1,!0)}}}toJSON(e){const t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const s={};s.uuid=this.uuid,s.type=this.type,this.name!==""&&(s.name=this.name),this.castShadow===!0&&(s.castShadow=!0),this.receiveShadow===!0&&(s.receiveShadow=!0),this.visible===!1&&(s.visible=!1),this.frustumCulled===!1&&(s.frustumCulled=!1),this.renderOrder!==0&&(s.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(s.userData=this.userData),s.layers=this.layers.mask,s.matrix=this.matrix.toArray(),s.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(s.matrixAutoUpdate=!1),this.isInstancedMesh&&(s.type="InstancedMesh",s.count=this.count,s.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(s.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(s.type="BatchedMesh",s.perObjectFrustumCulled=this.perObjectFrustumCulled,s.sortObjects=this.sortObjects,s.drawRanges=this._drawRanges,s.reservedRanges=this._reservedRanges,s.visibility=this._visibility,s.active=this._active,s.bounds=this._bounds.map(a=>({boxInitialized:a.boxInitialized,boxMin:a.box.min.toArray(),boxMax:a.box.max.toArray(),sphereInitialized:a.sphereInitialized,sphereRadius:a.sphere.radius,sphereCenter:a.sphere.center.toArray()})),s.maxGeometryCount=this._maxGeometryCount,s.maxVertexCount=this._maxVertexCount,s.maxIndexCount=this._maxIndexCount,s.geometryInitialized=this._geometryInitialized,s.geometryCount=this._geometryCount,s.matricesTexture=this._matricesTexture.toJSON(e),this.boundingSphere!==null&&(s.boundingSphere={center:s.boundingSphere.center.toArray(),radius:s.boundingSphere.radius}),this.boundingBox!==null&&(s.boundingBox={min:s.boundingBox.min.toArray(),max:s.boundingBox.max.toArray()}));function r(a,l){return a[l.uuid]===void 0&&(a[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?s.background=this.background.toJSON():this.background.isTexture&&(s.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(s.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){s.geometry=r(e.geometries,this.geometry);const a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){const l=a.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){const d=l[c];r(e.shapes,d)}else r(e.shapes,l)}}if(this.isSkinnedMesh&&(s.bindMode=this.bindMode,s.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),s.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const a=[];for(let l=0,c=this.material.length;l<c;l++)a.push(r(e.materials,this.material[l]));s.material=a}else s.material=r(e.materials,this.material);if(this.children.length>0){s.children=[];for(let a=0;a<this.children.length;a++)s.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){s.animations=[];for(let a=0;a<this.animations.length;a++){const l=this.animations[a];s.animations.push(r(e.animations,l))}}if(t){const a=o(e.geometries),l=o(e.materials),c=o(e.textures),h=o(e.images),d=o(e.shapes),p=o(e.skeletons),f=o(e.animations),g=o(e.nodes);a.length>0&&(n.geometries=a),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),d.length>0&&(n.shapes=d),p.length>0&&(n.skeletons=p),f.length>0&&(n.animations=f),g.length>0&&(n.nodes=g)}return n.object=s,n;function o(a){const l=[];for(const c in a){const h=a[c];delete h.metadata,l.push(h)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){const s=e.children[n];this.add(s.clone())}return this}}St.DEFAULT_UP=new I(0,1,0);St.DEFAULT_MATRIX_AUTO_UPDATE=!0;St.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const jt=new I,hn=new I,or=new I,dn=new I,oi=new I,li=new I,lo=new I,lr=new I,cr=new I,ur=new I;let is=!1;class Zt{constructor(e=new I,t=new I,n=new I){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,s){s.subVectors(n,t),jt.subVectors(e,t),s.cross(jt);const r=s.lengthSq();return r>0?s.multiplyScalar(1/Math.sqrt(r)):s.set(0,0,0)}static getBarycoord(e,t,n,s,r){jt.subVectors(s,t),hn.subVectors(n,t),or.subVectors(e,t);const o=jt.dot(jt),a=jt.dot(hn),l=jt.dot(or),c=hn.dot(hn),h=hn.dot(or),d=o*c-a*a;if(d===0)return r.set(0,0,0),null;const p=1/d,f=(c*l-a*h)*p,g=(o*h-a*l)*p;return r.set(1-f-g,g,f)}static containsPoint(e,t,n,s){return this.getBarycoord(e,t,n,s,dn)===null?!1:dn.x>=0&&dn.y>=0&&dn.x+dn.y<=1}static getUV(e,t,n,s,r,o,a,l){return is===!1&&(console.warn("THREE.Triangle.getUV() has been renamed to THREE.Triangle.getInterpolation()."),is=!0),this.getInterpolation(e,t,n,s,r,o,a,l)}static getInterpolation(e,t,n,s,r,o,a,l){return this.getBarycoord(e,t,n,s,dn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,dn.x),l.addScaledVector(o,dn.y),l.addScaledVector(a,dn.z),l)}static isFrontFacing(e,t,n,s){return jt.subVectors(n,t),hn.subVectors(e,t),jt.cross(hn).dot(s)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,s){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[s]),this}setFromAttributeAndIndices(e,t,n,s){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,s),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return jt.subVectors(this.c,this.b),hn.subVectors(this.a,this.b),jt.cross(hn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return Zt.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return Zt.getBarycoord(e,this.a,this.b,this.c,t)}getUV(e,t,n,s,r){return is===!1&&(console.warn("THREE.Triangle.getUV() has been renamed to THREE.Triangle.getInterpolation()."),is=!0),Zt.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}getInterpolation(e,t,n,s,r){return Zt.getInterpolation(e,this.a,this.b,this.c,t,n,s,r)}containsPoint(e){return Zt.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return Zt.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){const n=this.a,s=this.b,r=this.c;let o,a;oi.subVectors(s,n),li.subVectors(r,n),lr.subVectors(e,n);const l=oi.dot(lr),c=li.dot(lr);if(l<=0&&c<=0)return t.copy(n);cr.subVectors(e,s);const h=oi.dot(cr),d=li.dot(cr);if(h>=0&&d<=h)return t.copy(s);const p=l*d-h*c;if(p<=0&&l>=0&&h<=0)return o=l/(l-h),t.copy(n).addScaledVector(oi,o);ur.subVectors(e,r);const f=oi.dot(ur),g=li.dot(ur);if(g>=0&&f<=g)return t.copy(r);const _=f*c-l*g;if(_<=0&&c>=0&&g<=0)return a=c/(c-g),t.copy(n).addScaledVector(li,a);const m=h*g-f*d;if(m<=0&&d-h>=0&&f-g>=0)return lo.subVectors(r,s),a=(d-h)/(d-h+(f-g)),t.copy(s).addScaledVector(lo,a);const u=1/(m+_+p);return o=_*u,a=p*u,t.copy(n).addScaledVector(oi,o).addScaledVector(li,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const Ll={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Tn={h:0,s:0,l:0},ss={h:0,s:0,l:0};function hr(i,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?i+(e-i)*6*t:t<1/2?e:t<2/3?i+(e-i)*6*(2/3-t):i}class $e{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){const s=e;s&&s.isColor?this.copy(s):typeof s=="number"?this.setHex(s):typeof s=="string"&&this.setStyle(s)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Mt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Qe.toWorkingColorSpace(this,t),this}setRGB(e,t,n,s=Qe.workingColorSpace){return this.r=e,this.g=t,this.b=n,Qe.toWorkingColorSpace(this,s),this}setHSL(e,t,n,s=Qe.workingColorSpace){if(e=Qu(e,1),t=Ct(t,0,1),n=Ct(n,0,1),t===0)this.r=this.g=this.b=n;else{const r=n<=.5?n*(1+t):n+t-n*t,o=2*n-r;this.r=hr(o,r,e+1/3),this.g=hr(o,r,e),this.b=hr(o,r,e-1/3)}return Qe.toWorkingColorSpace(this,s),this}setStyle(e,t=Mt){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let s;if(s=/^(\w+)\(([^\)]*)\)/.exec(e)){let r;const o=s[1],a=s[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(s=/^\#([A-Fa-f\d]+)$/.exec(e)){const r=s[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Mt){const n=Ll[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=xi(e.r),this.g=xi(e.g),this.b=xi(e.b),this}copyLinearToSRGB(e){return this.r=Qs(e.r),this.g=Qs(e.g),this.b=Qs(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Mt){return Qe.fromWorkingColorSpace(Tt.copy(this),e),Math.round(Ct(Tt.r*255,0,255))*65536+Math.round(Ct(Tt.g*255,0,255))*256+Math.round(Ct(Tt.b*255,0,255))}getHexString(e=Mt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Qe.workingColorSpace){Qe.fromWorkingColorSpace(Tt.copy(this),t);const n=Tt.r,s=Tt.g,r=Tt.b,o=Math.max(n,s,r),a=Math.min(n,s,r);let l,c;const h=(a+o)/2;if(a===o)l=0,c=0;else{const d=o-a;switch(c=h<=.5?d/(o+a):d/(2-o-a),o){case n:l=(s-r)/d+(s<r?6:0);break;case s:l=(r-n)/d+2;break;case r:l=(n-s)/d+4;break}l/=6}return e.h=l,e.s=c,e.l=h,e}getRGB(e,t=Qe.workingColorSpace){return Qe.fromWorkingColorSpace(Tt.copy(this),t),e.r=Tt.r,e.g=Tt.g,e.b=Tt.b,e}getStyle(e=Mt){Qe.fromWorkingColorSpace(Tt.copy(this),e);const t=Tt.r,n=Tt.g,s=Tt.b;return e!==Mt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${s.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(s*255)})`}offsetHSL(e,t,n){return this.getHSL(Tn),this.setHSL(Tn.h+e,Tn.s+t,Tn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Tn),e.getHSL(ss);const n=Zs(Tn.h,ss.h,t),s=Zs(Tn.s,ss.s,t),r=Zs(Tn.l,ss.l,t);return this.setHSL(n,s,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const t=this.r,n=this.g,s=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*s,this.g=r[1]*t+r[4]*n+r[7]*s,this.b=r[2]*t+r[5]*n+r[8]*s,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const Tt=new $e;$e.NAMES=Ll;let mh=0;class Vi extends Zn{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:mh++}),this.uuid=Hi(),this.name="",this.type="Material",this.blending=vi,this.side=Dn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Rr,this.blendDst=Cr,this.blendEquation=Hn,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new $e(0,0,0),this.blendAlpha=0,this.depthFunc=Es,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Ya,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=ei,this.stencilZFail=ei,this.stencilZPass=ei,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBuild(){}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}const s=this[t];if(s===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}s&&s.isColor?s.set(n):s&&s.isVector3&&n&&n.isVector3?s.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});const n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==vi&&(n.blending=this.blending),this.side!==Dn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Rr&&(n.blendSrc=this.blendSrc),this.blendDst!==Cr&&(n.blendDst=this.blendDst),this.blendEquation!==Hn&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Es&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Ya&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==ei&&(n.stencilFail=this.stencilFail),this.stencilZFail!==ei&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==ei&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function s(r){const o=[];for(const a in r){const l=r[a];delete l.metadata,o.push(l)}return o}if(t){const r=s(e.textures),o=s(e.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const t=e.clippingPlanes;let n=null;if(t!==null){const s=t.length;n=new Array(s);for(let r=0;r!==s;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}}class Ds extends Vi{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new $e(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.combine=fl,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const ut=new I,rs=new Ae;class an{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=ja,this._updateRange={offset:0,count:-1},this.updateRanges=[],this.gpuType=wn,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}get updateRange(){return console.warn("THREE.BufferAttribute: updateRange() is deprecated and will be removed in r169. Use addUpdateRange() instead."),this._updateRange}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let s=0,r=this.itemSize;s<r;s++)this.array[e+s]=t.array[n+s];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)rs.fromBufferAttribute(this,t),rs.applyMatrix3(e),this.setXY(t,rs.x,rs.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)ut.fromBufferAttribute(this,t),ut.applyMatrix3(e),this.setXYZ(t,ut.x,ut.y,ut.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)ut.fromBufferAttribute(this,t),ut.applyMatrix4(e),this.setXYZ(t,ut.x,ut.y,ut.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)ut.fromBufferAttribute(this,t),ut.applyNormalMatrix(e),this.setXYZ(t,ut.x,ut.y,ut.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)ut.fromBufferAttribute(this,t),ut.transformDirection(e),this.setXYZ(t,ut.x,ut.y,ut.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=Ri(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Pt(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=Ri(t,this.array)),t}setX(e,t){return this.normalized&&(t=Pt(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=Ri(t,this.array)),t}setY(e,t){return this.normalized&&(t=Pt(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=Ri(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Pt(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=Ri(t,this.array)),t}setW(e,t){return this.normalized&&(t=Pt(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=Pt(t,this.array),n=Pt(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,s){return e*=this.itemSize,this.normalized&&(t=Pt(t,this.array),n=Pt(n,this.array),s=Pt(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this}setXYZW(e,t,n,s,r){return e*=this.itemSize,this.normalized&&(t=Pt(t,this.array),n=Pt(n,this.array),s=Pt(s,this.array),r=Pt(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=s,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==ja&&(e.usage=this.usage),e}}class Pl extends an{constructor(e,t,n){super(new Uint16Array(e),t,n)}}class Dl extends an{constructor(e,t,n){super(new Uint32Array(e),t,n)}}class ct extends an{constructor(e,t,n){super(new Float32Array(e),t,n)}}let gh=0;const Gt=new dt,dr=new St,ci=new I,Nt=new ki,Di=new ki,vt=new I;class $t extends Zn{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:gh++}),this.uuid=Hi(),this.name="",this.type="BufferGeometry",this.index=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Al(e)?Dl:Pl)(e,1):this.index=e,this}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){const t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const r=new Xe().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}const s=this.attributes.tangent;return s!==void 0&&(s.transformDirection(e),s.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Gt.makeRotationFromQuaternion(e),this.applyMatrix4(Gt),this}rotateX(e){return Gt.makeRotationX(e),this.applyMatrix4(Gt),this}rotateY(e){return Gt.makeRotationY(e),this.applyMatrix4(Gt),this}rotateZ(e){return Gt.makeRotationZ(e),this.applyMatrix4(Gt),this}translate(e,t,n){return Gt.makeTranslation(e,t,n),this.applyMatrix4(Gt),this}scale(e,t,n){return Gt.makeScale(e,t,n),this.applyMatrix4(Gt),this}lookAt(e){return dr.lookAt(e),dr.updateMatrix(),this.applyMatrix4(dr.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(ci).negate(),this.translate(ci.x,ci.y,ci.z),this}setFromPoints(e){const t=[];for(let n=0,s=e.length;n<s;n++){const r=e[n];t.push(r.x,r.y,r.z||0)}return this.setAttribute("position",new ct(t,3)),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new ki);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error('THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box. Alternatively set "mesh.frustumCulled" to "false".',this),this.boundingBox.set(new I(-1/0,-1/0,-1/0),new I(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,s=t.length;n<s;n++){const r=t[n];Nt.setFromBufferAttribute(r),this.morphTargetsRelative?(vt.addVectors(this.boundingBox.min,Nt.min),this.boundingBox.expandByPoint(vt),vt.addVectors(this.boundingBox.max,Nt.max),this.boundingBox.expandByPoint(vt)):(this.boundingBox.expandByPoint(Nt.min),this.boundingBox.expandByPoint(Nt.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new qr);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error('THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere. Alternatively set "mesh.frustumCulled" to "false".',this),this.boundingSphere.set(new I,1/0);return}if(e){const n=this.boundingSphere.center;if(Nt.setFromBufferAttribute(e),t)for(let r=0,o=t.length;r<o;r++){const a=t[r];Di.setFromBufferAttribute(a),this.morphTargetsRelative?(vt.addVectors(Nt.min,Di.min),Nt.expandByPoint(vt),vt.addVectors(Nt.max,Di.max),Nt.expandByPoint(vt)):(Nt.expandByPoint(Di.min),Nt.expandByPoint(Di.max))}Nt.getCenter(n);let s=0;for(let r=0,o=e.count;r<o;r++)vt.fromBufferAttribute(e,r),s=Math.max(s,n.distanceToSquared(vt));if(t)for(let r=0,o=t.length;r<o;r++){const a=t[r],l=this.morphTargetsRelative;for(let c=0,h=a.count;c<h;c++)vt.fromBufferAttribute(a,c),l&&(ci.fromBufferAttribute(e,c),vt.add(ci)),s=Math.max(s,n.distanceToSquared(vt))}this.boundingSphere.radius=Math.sqrt(s),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=e.array,s=t.position.array,r=t.normal.array,o=t.uv.array,a=s.length/3;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new an(new Float32Array(4*a),4));const l=this.getAttribute("tangent").array,c=[],h=[];for(let E=0;E<a;E++)c[E]=new I,h[E]=new I;const d=new I,p=new I,f=new I,g=new Ae,_=new Ae,m=new Ae,u=new I,M=new I;function v(E,F,V){d.fromArray(s,E*3),p.fromArray(s,F*3),f.fromArray(s,V*3),g.fromArray(o,E*2),_.fromArray(o,F*2),m.fromArray(o,V*2),p.sub(d),f.sub(d),_.sub(g),m.sub(g);const ne=1/(_.x*m.y-m.x*_.y);isFinite(ne)&&(u.copy(p).multiplyScalar(m.y).addScaledVector(f,-_.y).multiplyScalar(ne),M.copy(f).multiplyScalar(_.x).addScaledVector(p,-m.x).multiplyScalar(ne),c[E].add(u),c[F].add(u),c[V].add(u),h[E].add(M),h[F].add(M),h[V].add(M))}let b=this.groups;b.length===0&&(b=[{start:0,count:n.length}]);for(let E=0,F=b.length;E<F;++E){const V=b[E],ne=V.start,D=V.count;for(let O=ne,X=ne+D;O<X;O+=3)v(n[O+0],n[O+1],n[O+2])}const C=new I,w=new I,A=new I,U=new I;function x(E){A.fromArray(r,E*3),U.copy(A);const F=c[E];C.copy(F),C.sub(A.multiplyScalar(A.dot(F))).normalize(),w.crossVectors(U,F);const ne=w.dot(h[E])<0?-1:1;l[E*4]=C.x,l[E*4+1]=C.y,l[E*4+2]=C.z,l[E*4+3]=ne}for(let E=0,F=b.length;E<F;++E){const V=b[E],ne=V.start,D=V.count;for(let O=ne,X=ne+D;O<X;O+=3)x(n[O+0]),x(n[O+1]),x(n[O+2])}}computeVertexNormals(){const e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new an(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let p=0,f=n.count;p<f;p++)n.setXYZ(p,0,0,0);const s=new I,r=new I,o=new I,a=new I,l=new I,c=new I,h=new I,d=new I;if(e)for(let p=0,f=e.count;p<f;p+=3){const g=e.getX(p+0),_=e.getX(p+1),m=e.getX(p+2);s.fromBufferAttribute(t,g),r.fromBufferAttribute(t,_),o.fromBufferAttribute(t,m),h.subVectors(o,r),d.subVectors(s,r),h.cross(d),a.fromBufferAttribute(n,g),l.fromBufferAttribute(n,_),c.fromBufferAttribute(n,m),a.add(h),l.add(h),c.add(h),n.setXYZ(g,a.x,a.y,a.z),n.setXYZ(_,l.x,l.y,l.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let p=0,f=t.count;p<f;p+=3)s.fromBufferAttribute(t,p+0),r.fromBufferAttribute(t,p+1),o.fromBufferAttribute(t,p+2),h.subVectors(o,r),d.subVectors(s,r),h.cross(d),n.setXYZ(p+0,h.x,h.y,h.z),n.setXYZ(p+1,h.x,h.y,h.z),n.setXYZ(p+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)vt.fromBufferAttribute(e,t),vt.normalize(),e.setXYZ(t,vt.x,vt.y,vt.z)}toNonIndexed(){function e(a,l){const c=a.array,h=a.itemSize,d=a.normalized,p=new c.constructor(l.length*h);let f=0,g=0;for(let _=0,m=l.length;_<m;_++){a.isInterleavedBufferAttribute?f=l[_]*a.data.stride+a.offset:f=l[_]*h;for(let u=0;u<h;u++)p[g++]=c[f++]}return new an(p,h,d)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const t=new $t,n=this.index.array,s=this.attributes;for(const a in s){const l=s[a],c=e(l,n);t.setAttribute(a,c)}const r=this.morphAttributes;for(const a in r){const l=[],c=r[a];for(let h=0,d=c.length;h<d;h++){const p=c[h],f=e(p,n);l.push(f)}t.morphAttributes[a]=l}t.morphTargetsRelative=this.morphTargetsRelative;const o=this.groups;for(let a=0,l=o.length;a<l;a++){const c=o[a];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){const e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};const t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});const n=this.attributes;for(const l in n){const c=n[l];e.data.attributes[l]=c.toJSON(e.data)}const s={};let r=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],h=[];for(let d=0,p=c.length;d<p;d++){const f=c[d];h.push(f.toJSON(e.data))}h.length>0&&(s[l]=h,r=!0)}r&&(e.data.morphAttributes=s,e.data.morphTargetsRelative=this.morphTargetsRelative);const o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));const a=this.boundingSphere;return a!==null&&(e.data.boundingSphere={center:a.center.toArray(),radius:a.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const t={};this.name=e.name;const n=e.index;n!==null&&this.setIndex(n.clone(t));const s=e.attributes;for(const c in s){const h=s[c];this.setAttribute(c,h.clone(t))}const r=e.morphAttributes;for(const c in r){const h=[],d=r[c];for(let p=0,f=d.length;p<f;p++)h.push(d[p].clone(t));this.morphAttributes[c]=h}this.morphTargetsRelative=e.morphTargetsRelative;const o=e.groups;for(let c=0,h=o.length;c<h;c++){const d=o[c];this.addGroup(d.start,d.count,d.materialIndex)}const a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());const l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const co=new dt,Bn=new Yr,as=new qr,uo=new I,ui=new I,hi=new I,di=new I,fr=new I,os=new I,ls=new Ae,cs=new Ae,us=new Ae,ho=new I,fo=new I,po=new I,hs=new I,ds=new I;class be extends St{constructor(e=new $t,t=new Ds){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const s=t[n[0]];if(s!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=s.length;r<o;r++){const a=s[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(e,t){const n=this.geometry,s=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;t.fromBufferAttribute(s,e);const a=this.morphTargetInfluences;if(r&&a){os.set(0,0,0);for(let l=0,c=r.length;l<c;l++){const h=a[l],d=r[l];h!==0&&(fr.fromBufferAttribute(d,e),o?os.addScaledVector(fr,h):os.addScaledVector(fr.sub(t),h))}t.add(os)}return t}raycast(e,t){const n=this.geometry,s=this.material,r=this.matrixWorld;s!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),as.copy(n.boundingSphere),as.applyMatrix4(r),Bn.copy(e.ray).recast(e.near),!(as.containsPoint(Bn.origin)===!1&&(Bn.intersectSphere(as,uo)===null||Bn.origin.distanceToSquared(uo)>(e.far-e.near)**2))&&(co.copy(r).invert(),Bn.copy(e.ray).applyMatrix4(co),!(n.boundingBox!==null&&Bn.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Bn)))}_computeIntersections(e,t,n){let s;const r=this.geometry,o=this.material,a=r.index,l=r.attributes.position,c=r.attributes.uv,h=r.attributes.uv1,d=r.attributes.normal,p=r.groups,f=r.drawRange;if(a!==null)if(Array.isArray(o))for(let g=0,_=p.length;g<_;g++){const m=p[g],u=o[m.materialIndex],M=Math.max(m.start,f.start),v=Math.min(a.count,Math.min(m.start+m.count,f.start+f.count));for(let b=M,C=v;b<C;b+=3){const w=a.getX(b),A=a.getX(b+1),U=a.getX(b+2);s=fs(this,u,e,n,c,h,d,w,A,U),s&&(s.faceIndex=Math.floor(b/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{const g=Math.max(0,f.start),_=Math.min(a.count,f.start+f.count);for(let m=g,u=_;m<u;m+=3){const M=a.getX(m),v=a.getX(m+1),b=a.getX(m+2);s=fs(this,o,e,n,c,h,d,M,v,b),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}else if(l!==void 0)if(Array.isArray(o))for(let g=0,_=p.length;g<_;g++){const m=p[g],u=o[m.materialIndex],M=Math.max(m.start,f.start),v=Math.min(l.count,Math.min(m.start+m.count,f.start+f.count));for(let b=M,C=v;b<C;b+=3){const w=b,A=b+1,U=b+2;s=fs(this,u,e,n,c,h,d,w,A,U),s&&(s.faceIndex=Math.floor(b/3),s.face.materialIndex=m.materialIndex,t.push(s))}}else{const g=Math.max(0,f.start),_=Math.min(l.count,f.start+f.count);for(let m=g,u=_;m<u;m+=3){const M=m,v=m+1,b=m+2;s=fs(this,o,e,n,c,h,d,M,v,b),s&&(s.faceIndex=Math.floor(m/3),t.push(s))}}}}function _h(i,e,t,n,s,r,o,a){let l;if(e.side===Dt?l=n.intersectTriangle(o,r,s,!0,a):l=n.intersectTriangle(s,r,o,e.side===Dn,a),l===null)return null;ds.copy(a),ds.applyMatrix4(i.matrixWorld);const c=t.ray.origin.distanceTo(ds);return c<t.near||c>t.far?null:{distance:c,point:ds.clone(),object:i}}function fs(i,e,t,n,s,r,o,a,l,c){i.getVertexPosition(a,ui),i.getVertexPosition(l,hi),i.getVertexPosition(c,di);const h=_h(i,e,t,n,ui,hi,di,hs);if(h){s&&(ls.fromBufferAttribute(s,a),cs.fromBufferAttribute(s,l),us.fromBufferAttribute(s,c),h.uv=Zt.getInterpolation(hs,ui,hi,di,ls,cs,us,new Ae)),r&&(ls.fromBufferAttribute(r,a),cs.fromBufferAttribute(r,l),us.fromBufferAttribute(r,c),h.uv1=Zt.getInterpolation(hs,ui,hi,di,ls,cs,us,new Ae),h.uv2=h.uv1),o&&(ho.fromBufferAttribute(o,a),fo.fromBufferAttribute(o,l),po.fromBufferAttribute(o,c),h.normal=Zt.getInterpolation(hs,ui,hi,di,ho,fo,po,new I),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));const d={a,b:l,c,normal:new I,materialIndex:0};Zt.getNormal(ui,hi,di,d.normal),h.face=d}return h}class it extends $t{constructor(e=1,t=1,n=1,s=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:s,heightSegments:r,depthSegments:o};const a=this;s=Math.floor(s),r=Math.floor(r),o=Math.floor(o);const l=[],c=[],h=[],d=[];let p=0,f=0;g("z","y","x",-1,-1,n,t,e,o,r,0),g("z","y","x",1,-1,n,t,-e,o,r,1),g("x","z","y",1,1,e,n,t,s,o,2),g("x","z","y",1,-1,e,n,-t,s,o,3),g("x","y","z",1,-1,e,t,n,s,r,4),g("x","y","z",-1,-1,e,t,-n,s,r,5),this.setIndex(l),this.setAttribute("position",new ct(c,3)),this.setAttribute("normal",new ct(h,3)),this.setAttribute("uv",new ct(d,2));function g(_,m,u,M,v,b,C,w,A,U,x){const E=b/A,F=C/U,V=b/2,ne=C/2,D=w/2,O=A+1,X=U+1;let Y=0,q=0;const $=new I;for(let Q=0;Q<X;Q++){const ie=Q*F-ne;for(let pe=0;pe<O;pe++){const W=pe*E-V;$[_]=W*M,$[m]=ie*v,$[u]=D,c.push($.x,$.y,$.z),$[_]=0,$[m]=0,$[u]=w>0?1:-1,h.push($.x,$.y,$.z),d.push(pe/A),d.push(1-Q/U),Y+=1}}for(let Q=0;Q<U;Q++)for(let ie=0;ie<A;ie++){const pe=p+ie+O*Q,W=p+ie+O*(Q+1),K=p+(ie+1)+O*(Q+1),fe=p+(ie+1)+O*Q;l.push(pe,W,fe),l.push(W,K,fe),q+=6}a.addGroup(f,q,x),f+=q,p+=Y}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new it(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function bi(i){const e={};for(const t in i){e[t]={};for(const n in i[t]){const s=i[t][n];s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)?s.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=s.clone():Array.isArray(s)?e[t][n]=s.slice():e[t][n]=s}}return e}function wt(i){const e={};for(let t=0;t<i.length;t++){const n=bi(i[t]);for(const s in n)e[s]=n[s]}return e}function vh(i){const e=[];for(let t=0;t<i.length;t++)e.push(i[t].clone());return e}function Ul(i){return i.getRenderTarget()===null?i.outputColorSpace:Qe.workingColorSpace}const Il={clone:bi,merge:wt};var xh=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Mh=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class xn extends Vi{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=xh,this.fragmentShader=Mh,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={derivatives:!1,fragDepth:!1,drawBuffers:!1,shaderTextureLOD:!1,clipCullDistance:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=bi(e.uniforms),this.uniformsGroups=vh(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(const s in this.uniforms){const o=this.uniforms[s].value;o&&o.isTexture?t.uniforms[s]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[s]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[s]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[s]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[s]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[s]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[s]={type:"m4",value:o.toArray()}:t.uniforms[s]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;const n={};for(const s in this.extensions)this.extensions[s]===!0&&(n[s]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}}class Nl extends St{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new dt,this.projectionMatrix=new dt,this.projectionMatrixInverse=new dt,this.coordinateSystem=mn}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}class Jt extends Nl{constructor(e=50,t=1,n=.1,s=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=s,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const t=.5*this.getFilmHeight()/e;this.fov=Nr*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(xs*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Nr*2*Math.atan(Math.tan(xs*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}setViewOffset(e,t,n,s,r,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let t=e*Math.tan(xs*.5*this.fov)/this.zoom,n=2*t,s=this.aspect*n,r=-.5*s;const o=this.view;if(this.view!==null&&this.view.enabled){const l=o.fullWidth,c=o.fullHeight;r+=o.offsetX*s/l,t-=o.offsetY*n/c,s*=o.width/l,n*=o.height/c}const a=this.filmOffset;a!==0&&(r+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+s,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}}const fi=-90,pi=1;class Sh extends St{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const s=new Jt(fi,pi,e,t);s.layers=this.layers,this.add(s);const r=new Jt(fi,pi,e,t);r.layers=this.layers,this.add(r);const o=new Jt(fi,pi,e,t);o.layers=this.layers,this.add(o);const a=new Jt(fi,pi,e,t);a.layers=this.layers,this.add(a);const l=new Jt(fi,pi,e,t);l.layers=this.layers,this.add(l);const c=new Jt(fi,pi,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const e=this.coordinateSystem,t=this.children.concat(),[n,s,r,o,a,l]=t;for(const c of t)this.remove(c);if(e===mn)n.up.set(0,1,0),n.lookAt(1,0,0),s.up.set(0,1,0),s.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===As)n.up.set(0,-1,0),n.lookAt(-1,0,0),s.up.set(0,-1,0),s.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:s}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[r,o,a,l,c,h]=this.children,d=e.getRenderTarget(),p=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),g=e.xr.enabled;e.xr.enabled=!1;const _=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,s),e.render(t,r),e.setRenderTarget(n,1,s),e.render(t,o),e.setRenderTarget(n,2,s),e.render(t,a),e.setRenderTarget(n,3,s),e.render(t,l),e.setRenderTarget(n,4,s),e.render(t,c),n.texture.generateMipmaps=_,e.setRenderTarget(n,5,s),e.render(t,h),e.setRenderTarget(d,p,f),e.xr.enabled=g,n.texture.needsPMREMUpdate=!0}}class Fl extends Ot{constructor(e,t,n,s,r,o,a,l,c,h){e=e!==void 0?e:[],t=t!==void 0?t:Si,super(e,t,n,s,r,o,a,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class Eh extends Un{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const n={width:e,height:e,depth:1},s=[n,n,n,n,n,n];t.encoding!==void 0&&(Fi("THREE.WebGLCubeRenderTarget: option.encoding has been replaced by option.colorSpace."),t.colorSpace=t.encoding===$n?Mt:Wt),this.texture=new Fl(s,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:Ht}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},s=new it(5,5,5),r=new xn({name:"CubemapFromEquirect",uniforms:bi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Dt,blending:gn});r.uniforms.tEquirect.value=t;const o=new be(s,r),a=t.minFilter;return t.minFilter===Bi&&(t.minFilter=Ht),new Sh(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t,n,s){const r=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,n,s);e.setRenderTarget(r)}}const pr=new I,yh=new I,Th=new Xe;class bn{constructor(e=new I(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,s){return this.normal.set(e,t,n),this.constant=s,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){const s=pr.subVectors(n,t).cross(yh.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(s,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){const n=e.delta(pr),s=this.normal.dot(n);if(s===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;const r=-(e.start.dot(this.normal)+this.constant)/s;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){const t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){const n=t||Th.getNormalMatrix(e),s=this.coplanarPoint(pr).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-s.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const zn=new qr,ps=new I;class Kr{constructor(e=new bn,t=new bn,n=new bn,s=new bn,r=new bn,o=new bn){this.planes=[e,t,n,s,r,o]}set(e,t,n,s,r,o){const a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(n),a[3].copy(s),a[4].copy(r),a[5].copy(o),this}copy(e){const t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=mn){const n=this.planes,s=e.elements,r=s[0],o=s[1],a=s[2],l=s[3],c=s[4],h=s[5],d=s[6],p=s[7],f=s[8],g=s[9],_=s[10],m=s[11],u=s[12],M=s[13],v=s[14],b=s[15];if(n[0].setComponents(l-r,p-c,m-f,b-u).normalize(),n[1].setComponents(l+r,p+c,m+f,b+u).normalize(),n[2].setComponents(l+o,p+h,m+g,b+M).normalize(),n[3].setComponents(l-o,p-h,m-g,b-M).normalize(),n[4].setComponents(l-a,p-d,m-_,b-v).normalize(),t===mn)n[5].setComponents(l+a,p+d,m+_,b+v).normalize();else if(t===As)n[5].setComponents(a,d,_,v).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),zn.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),zn.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(zn)}intersectsSprite(e){return zn.center.set(0,0,0),zn.radius=.7071067811865476,zn.applyMatrix4(e.matrixWorld),this.intersectsSphere(zn)}intersectsSphere(e){const t=this.planes,n=e.center,s=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<s)return!1;return!0}intersectsBox(e){const t=this.planes;for(let n=0;n<6;n++){const s=t[n];if(ps.x=s.normal.x>0?e.max.x:e.min.x,ps.y=s.normal.y>0?e.max.y:e.min.y,ps.z=s.normal.z>0?e.max.z:e.min.z,s.distanceToPoint(ps)<0)return!1}return!0}containsPoint(e){const t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}function Ol(){let i=null,e=!1,t=null,n=null;function s(r,o){t(r,o),n=i.requestAnimationFrame(s)}return{start:function(){e!==!0&&t!==null&&(n=i.requestAnimationFrame(s),e=!0)},stop:function(){i.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){i=r}}}function bh(i,e){const t=e.isWebGL2,n=new WeakMap;function s(c,h){const d=c.array,p=c.usage,f=d.byteLength,g=i.createBuffer();i.bindBuffer(h,g),i.bufferData(h,d,p),c.onUploadCallback();let _;if(d instanceof Float32Array)_=i.FLOAT;else if(d instanceof Uint16Array)if(c.isFloat16BufferAttribute)if(t)_=i.HALF_FLOAT;else throw new Error("THREE.WebGLAttributes: Usage of Float16BufferAttribute requires WebGL2.");else _=i.UNSIGNED_SHORT;else if(d instanceof Int16Array)_=i.SHORT;else if(d instanceof Uint32Array)_=i.UNSIGNED_INT;else if(d instanceof Int32Array)_=i.INT;else if(d instanceof Int8Array)_=i.BYTE;else if(d instanceof Uint8Array)_=i.UNSIGNED_BYTE;else if(d instanceof Uint8ClampedArray)_=i.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+d);return{buffer:g,type:_,bytesPerElement:d.BYTES_PER_ELEMENT,version:c.version,size:f}}function r(c,h,d){const p=h.array,f=h._updateRange,g=h.updateRanges;if(i.bindBuffer(d,c),f.count===-1&&g.length===0&&i.bufferSubData(d,0,p),g.length!==0){for(let _=0,m=g.length;_<m;_++){const u=g[_];t?i.bufferSubData(d,u.start*p.BYTES_PER_ELEMENT,p,u.start,u.count):i.bufferSubData(d,u.start*p.BYTES_PER_ELEMENT,p.subarray(u.start,u.start+u.count))}h.clearUpdateRanges()}f.count!==-1&&(t?i.bufferSubData(d,f.offset*p.BYTES_PER_ELEMENT,p,f.offset,f.count):i.bufferSubData(d,f.offset*p.BYTES_PER_ELEMENT,p.subarray(f.offset,f.offset+f.count)),f.count=-1),h.onUploadCallback()}function o(c){return c.isInterleavedBufferAttribute&&(c=c.data),n.get(c)}function a(c){c.isInterleavedBufferAttribute&&(c=c.data);const h=n.get(c);h&&(i.deleteBuffer(h.buffer),n.delete(c))}function l(c,h){if(c.isGLBufferAttribute){const p=n.get(c);(!p||p.version<c.version)&&n.set(c,{buffer:c.buffer,type:c.type,bytesPerElement:c.elementSize,version:c.version});return}c.isInterleavedBufferAttribute&&(c=c.data);const d=n.get(c);if(d===void 0)n.set(c,s(c,h));else if(d.version<c.version){if(d.size!==c.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");r(d.buffer,c,h),d.version=c.version}}return{get:o,remove:a,update:l}}class Wi extends $t{constructor(e=1,t=1,n=1,s=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:s};const r=e/2,o=t/2,a=Math.floor(n),l=Math.floor(s),c=a+1,h=l+1,d=e/a,p=t/l,f=[],g=[],_=[],m=[];for(let u=0;u<h;u++){const M=u*p-o;for(let v=0;v<c;v++){const b=v*d-r;g.push(b,-M,0),_.push(0,0,1),m.push(v/a),m.push(1-u/l)}}for(let u=0;u<l;u++)for(let M=0;M<a;M++){const v=M+c*u,b=M+c*(u+1),C=M+1+c*(u+1),w=M+1+c*u;f.push(v,b,w),f.push(b,C,w)}this.setIndex(f),this.setAttribute("position",new ct(g,3)),this.setAttribute("normal",new ct(_,3)),this.setAttribute("uv",new ct(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Wi(e.width,e.height,e.widthSegments,e.heightSegments)}}var Ah=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,wh=`#ifdef USE_ALPHAHASH
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
#endif`,Rh=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Ch=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Lh=`#ifdef USE_ALPHATEST
	if ( diffuseColor.a < alphaTest ) discard;
#endif`,Ph=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Dh=`#ifdef USE_AOMAP
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
#endif`,Uh=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Ih=`#ifdef USE_BATCHING
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
#endif`,Nh=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( batchId );
#endif`,Fh=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Oh=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Bh=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,zh=`#ifdef USE_IRIDESCENCE
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
#endif`,Gh=`#ifdef USE_BUMPMAP
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
#endif`,Hh=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,kh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,Vh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Wh=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Xh=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,$h=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,qh=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	varying vec3 vColor;
#endif`,Yh=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif`,jh=`#define PI 3.141592653589793
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
} // validated`,Kh=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,Zh=`vec3 transformedNormal = objectNormal;
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
#endif`,Jh=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Qh=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,ed=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,td=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,nd="gl_FragColor = linearToOutputTexel( gl_FragColor );",id=`
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
}`,sd=`#ifdef USE_ENVMAP
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
#endif`,rd=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,ad=`#ifdef USE_ENVMAP
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
#endif`,od=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,ld=`#ifdef USE_ENVMAP
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
#endif`,cd=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,ud=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,hd=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,dd=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,fd=`#ifdef USE_GRADIENTMAP
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
}`,pd=`#ifdef USE_LIGHTMAP
	vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
	vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
	reflectedLight.indirectDiffuse += lightMapIrradiance;
#endif`,md=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,gd=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,_d=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,vd=`uniform bool receiveShadow;
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
#endif`,xd=`#ifdef USE_ENVMAP
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
#endif`,Md=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Sd=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Ed=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,yd=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Td=`PhysicalMaterial material;
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
#endif`,bd=`struct PhysicalMaterial {
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
}`,Ad=`
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
#endif`,wd=`#if defined( RE_IndirectDiffuse )
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
#endif`,Rd=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Cd=`#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	gl_FragDepthEXT = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Ld=`#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Pd=`#ifdef USE_LOGDEPTHBUF
	#ifdef USE_LOGDEPTHBUF_EXT
		varying float vFragDepth;
		varying float vIsPerspective;
	#else
		uniform float logDepthBufFC;
	#endif
#endif`,Dd=`#ifdef USE_LOGDEPTHBUF
	#ifdef USE_LOGDEPTHBUF_EXT
		vFragDepth = 1.0 + gl_Position.w;
		vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
	#else
		if ( isPerspectiveMatrix( projectionMatrix ) ) {
			gl_Position.z = log2( max( EPSILON, gl_Position.w + 1.0 ) ) * logDepthBufFC - 1.0;
			gl_Position.z *= gl_Position.w;
		}
	#endif
#endif`,Ud=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,Id=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Nd=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,Fd=`#if defined( USE_POINTS_UV )
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
#endif`,Od=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Bd=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,zd=`#if defined( USE_MORPHCOLORS ) && defined( MORPHTARGETS_TEXTURE )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Gd=`#ifdef USE_MORPHNORMALS
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
#endif`,Hd=`#ifdef USE_MORPHTARGETS
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
#endif`,kd=`#ifdef USE_MORPHTARGETS
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
#endif`,Vd=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,Wd=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,Xd=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,$d=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,qd=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,Yd=`#ifdef USE_NORMALMAP
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
#endif`,jd=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,Kd=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,Zd=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Jd=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,Qd=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,ef=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,tf=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,nf=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,sf=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,rf=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,af=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,of=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,lf=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,cf=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,uf=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,hf=`float getShadowMask() {
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
}`,df=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,ff=`#ifdef USE_SKINNING
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
#endif`,pf=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,mf=`#ifdef USE_SKINNING
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
#endif`,gf=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,_f=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,vf=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,xf=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,Mf=`#ifdef USE_TRANSMISSION
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
#endif`,Sf=`#ifdef USE_TRANSMISSION
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
#endif`,Ef=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,yf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Tf=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,bf=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const Af=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,wf=`uniform sampler2D t2D;
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
}`,Rf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Cf=`#ifdef ENVMAP_TYPE_CUBE
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
}`,Lf=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Pf=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Df=`#include <common>
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
}`,Uf=`#if DEPTH_PACKING == 3200
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
}`,If=`#define DISTANCE
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
}`,Nf=`#define DISTANCE
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
}`,Ff=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Of=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Bf=`uniform float scale;
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
}`,zf=`uniform vec3 diffuse;
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
}`,Gf=`#include <common>
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
}`,Hf=`uniform vec3 diffuse;
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
}`,kf=`#define LAMBERT
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
}`,Vf=`#define LAMBERT
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
}`,Wf=`#define MATCAP
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
}`,Xf=`#define MATCAP
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
}`,$f=`#define NORMAL
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
}`,qf=`#define NORMAL
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
}`,Yf=`#define PHONG
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
}`,jf=`#define PHONG
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
}`,Kf=`#define STANDARD
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
}`,Zf=`#define STANDARD
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
}`,Jf=`#define TOON
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
}`,Qf=`#define TOON
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
}`,ep=`uniform float size;
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
}`,tp=`uniform vec3 diffuse;
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
}`,np=`#include <common>
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
}`,ip=`uniform vec3 color;
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
}`,sp=`uniform float rotation;
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
}`,rp=`uniform vec3 diffuse;
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
}`,ze={alphahash_fragment:Ah,alphahash_pars_fragment:wh,alphamap_fragment:Rh,alphamap_pars_fragment:Ch,alphatest_fragment:Lh,alphatest_pars_fragment:Ph,aomap_fragment:Dh,aomap_pars_fragment:Uh,batching_pars_vertex:Ih,batching_vertex:Nh,begin_vertex:Fh,beginnormal_vertex:Oh,bsdfs:Bh,iridescence_fragment:zh,bumpmap_pars_fragment:Gh,clipping_planes_fragment:Hh,clipping_planes_pars_fragment:kh,clipping_planes_pars_vertex:Vh,clipping_planes_vertex:Wh,color_fragment:Xh,color_pars_fragment:$h,color_pars_vertex:qh,color_vertex:Yh,common:jh,cube_uv_reflection_fragment:Kh,defaultnormal_vertex:Zh,displacementmap_pars_vertex:Jh,displacementmap_vertex:Qh,emissivemap_fragment:ed,emissivemap_pars_fragment:td,colorspace_fragment:nd,colorspace_pars_fragment:id,envmap_fragment:sd,envmap_common_pars_fragment:rd,envmap_pars_fragment:ad,envmap_pars_vertex:od,envmap_physical_pars_fragment:xd,envmap_vertex:ld,fog_vertex:cd,fog_pars_vertex:ud,fog_fragment:hd,fog_pars_fragment:dd,gradientmap_pars_fragment:fd,lightmap_fragment:pd,lightmap_pars_fragment:md,lights_lambert_fragment:gd,lights_lambert_pars_fragment:_d,lights_pars_begin:vd,lights_toon_fragment:Md,lights_toon_pars_fragment:Sd,lights_phong_fragment:Ed,lights_phong_pars_fragment:yd,lights_physical_fragment:Td,lights_physical_pars_fragment:bd,lights_fragment_begin:Ad,lights_fragment_maps:wd,lights_fragment_end:Rd,logdepthbuf_fragment:Cd,logdepthbuf_pars_fragment:Ld,logdepthbuf_pars_vertex:Pd,logdepthbuf_vertex:Dd,map_fragment:Ud,map_pars_fragment:Id,map_particle_fragment:Nd,map_particle_pars_fragment:Fd,metalnessmap_fragment:Od,metalnessmap_pars_fragment:Bd,morphcolor_vertex:zd,morphnormal_vertex:Gd,morphtarget_pars_vertex:Hd,morphtarget_vertex:kd,normal_fragment_begin:Vd,normal_fragment_maps:Wd,normal_pars_fragment:Xd,normal_pars_vertex:$d,normal_vertex:qd,normalmap_pars_fragment:Yd,clearcoat_normal_fragment_begin:jd,clearcoat_normal_fragment_maps:Kd,clearcoat_pars_fragment:Zd,iridescence_pars_fragment:Jd,opaque_fragment:Qd,packing:ef,premultiplied_alpha_fragment:tf,project_vertex:nf,dithering_fragment:sf,dithering_pars_fragment:rf,roughnessmap_fragment:af,roughnessmap_pars_fragment:of,shadowmap_pars_fragment:lf,shadowmap_pars_vertex:cf,shadowmap_vertex:uf,shadowmask_pars_fragment:hf,skinbase_vertex:df,skinning_pars_vertex:ff,skinning_vertex:pf,skinnormal_vertex:mf,specularmap_fragment:gf,specularmap_pars_fragment:_f,tonemapping_fragment:vf,tonemapping_pars_fragment:xf,transmission_fragment:Mf,transmission_pars_fragment:Sf,uv_pars_fragment:Ef,uv_pars_vertex:yf,uv_vertex:Tf,worldpos_vertex:bf,background_vert:Af,background_frag:wf,backgroundCube_vert:Rf,backgroundCube_frag:Cf,cube_vert:Lf,cube_frag:Pf,depth_vert:Df,depth_frag:Uf,distanceRGBA_vert:If,distanceRGBA_frag:Nf,equirect_vert:Ff,equirect_frag:Of,linedashed_vert:Bf,linedashed_frag:zf,meshbasic_vert:Gf,meshbasic_frag:Hf,meshlambert_vert:kf,meshlambert_frag:Vf,meshmatcap_vert:Wf,meshmatcap_frag:Xf,meshnormal_vert:$f,meshnormal_frag:qf,meshphong_vert:Yf,meshphong_frag:jf,meshphysical_vert:Kf,meshphysical_frag:Zf,meshtoon_vert:Jf,meshtoon_frag:Qf,points_vert:ep,points_frag:tp,shadow_vert:np,shadow_frag:ip,sprite_vert:sp,sprite_frag:rp},he={common:{diffuse:{value:new $e(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Xe},alphaMap:{value:null},alphaMapTransform:{value:new Xe},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Xe}},envmap:{envMap:{value:null},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Xe}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Xe}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Xe},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Xe},normalScale:{value:new Ae(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Xe},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Xe}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Xe}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Xe}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new $e(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new $e(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Xe},alphaTest:{value:0},uvTransform:{value:new Xe}},sprite:{diffuse:{value:new $e(16777215)},opacity:{value:1},center:{value:new Ae(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Xe},alphaMap:{value:null},alphaMapTransform:{value:new Xe},alphaTest:{value:0}}},sn={basic:{uniforms:wt([he.common,he.specularmap,he.envmap,he.aomap,he.lightmap,he.fog]),vertexShader:ze.meshbasic_vert,fragmentShader:ze.meshbasic_frag},lambert:{uniforms:wt([he.common,he.specularmap,he.envmap,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.fog,he.lights,{emissive:{value:new $e(0)}}]),vertexShader:ze.meshlambert_vert,fragmentShader:ze.meshlambert_frag},phong:{uniforms:wt([he.common,he.specularmap,he.envmap,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.fog,he.lights,{emissive:{value:new $e(0)},specular:{value:new $e(1118481)},shininess:{value:30}}]),vertexShader:ze.meshphong_vert,fragmentShader:ze.meshphong_frag},standard:{uniforms:wt([he.common,he.envmap,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.roughnessmap,he.metalnessmap,he.fog,he.lights,{emissive:{value:new $e(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:ze.meshphysical_vert,fragmentShader:ze.meshphysical_frag},toon:{uniforms:wt([he.common,he.aomap,he.lightmap,he.emissivemap,he.bumpmap,he.normalmap,he.displacementmap,he.gradientmap,he.fog,he.lights,{emissive:{value:new $e(0)}}]),vertexShader:ze.meshtoon_vert,fragmentShader:ze.meshtoon_frag},matcap:{uniforms:wt([he.common,he.bumpmap,he.normalmap,he.displacementmap,he.fog,{matcap:{value:null}}]),vertexShader:ze.meshmatcap_vert,fragmentShader:ze.meshmatcap_frag},points:{uniforms:wt([he.points,he.fog]),vertexShader:ze.points_vert,fragmentShader:ze.points_frag},dashed:{uniforms:wt([he.common,he.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:ze.linedashed_vert,fragmentShader:ze.linedashed_frag},depth:{uniforms:wt([he.common,he.displacementmap]),vertexShader:ze.depth_vert,fragmentShader:ze.depth_frag},normal:{uniforms:wt([he.common,he.bumpmap,he.normalmap,he.displacementmap,{opacity:{value:1}}]),vertexShader:ze.meshnormal_vert,fragmentShader:ze.meshnormal_frag},sprite:{uniforms:wt([he.sprite,he.fog]),vertexShader:ze.sprite_vert,fragmentShader:ze.sprite_frag},background:{uniforms:{uvTransform:{value:new Xe},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:ze.background_vert,fragmentShader:ze.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1}},vertexShader:ze.backgroundCube_vert,fragmentShader:ze.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:ze.cube_vert,fragmentShader:ze.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:ze.equirect_vert,fragmentShader:ze.equirect_frag},distanceRGBA:{uniforms:wt([he.common,he.displacementmap,{referencePosition:{value:new I},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:ze.distanceRGBA_vert,fragmentShader:ze.distanceRGBA_frag},shadow:{uniforms:wt([he.lights,he.fog,{color:{value:new $e(0)},opacity:{value:1}}]),vertexShader:ze.shadow_vert,fragmentShader:ze.shadow_frag}};sn.physical={uniforms:wt([sn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Xe},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Xe},clearcoatNormalScale:{value:new Ae(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Xe},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Xe},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Xe},sheen:{value:0},sheenColor:{value:new $e(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Xe},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Xe},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Xe},transmissionSamplerSize:{value:new Ae},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Xe},attenuationDistance:{value:0},attenuationColor:{value:new $e(0)},specularColor:{value:new $e(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Xe},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Xe},anisotropyVector:{value:new Ae},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Xe}}]),vertexShader:ze.meshphysical_vert,fragmentShader:ze.meshphysical_frag};const ms={r:0,b:0,g:0};function ap(i,e,t,n,s,r,o){const a=new $e(0);let l=r===!0?0:1,c,h,d=null,p=0,f=null;function g(m,u){let M=!1,v=u.isScene===!0?u.background:null;v&&v.isTexture&&(v=(u.backgroundBlurriness>0?t:e).get(v)),v===null?_(a,l):v&&v.isColor&&(_(v,1),M=!0);const b=i.xr.getEnvironmentBlendMode();b==="additive"?n.buffers.color.setClear(0,0,0,1,o):b==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(i.autoClear||M)&&i.clear(i.autoClearColor,i.autoClearDepth,i.autoClearStencil),v&&(v.isCubeTexture||v.mapping===Cs)?(h===void 0&&(h=new be(new it(1,1,1),new xn({name:"BackgroundCubeMaterial",uniforms:bi(sn.backgroundCube.uniforms),vertexShader:sn.backgroundCube.vertexShader,fragmentShader:sn.backgroundCube.fragmentShader,side:Dt,depthTest:!1,depthWrite:!1,fog:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(C,w,A){this.matrixWorld.copyPosition(A.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),s.update(h)),h.material.uniforms.envMap.value=v,h.material.uniforms.flipEnvMap.value=v.isCubeTexture&&v.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=u.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=u.backgroundIntensity,h.material.toneMapped=Qe.getTransfer(v.colorSpace)!==nt,(d!==v||p!==v.version||f!==i.toneMapping)&&(h.material.needsUpdate=!0,d=v,p=v.version,f=i.toneMapping),h.layers.enableAll(),m.unshift(h,h.geometry,h.material,0,0,null)):v&&v.isTexture&&(c===void 0&&(c=new be(new Wi(2,2),new xn({name:"BackgroundMaterial",uniforms:bi(sn.background.uniforms),vertexShader:sn.background.vertexShader,fragmentShader:sn.background.fragmentShader,side:Dn,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),s.update(c)),c.material.uniforms.t2D.value=v,c.material.uniforms.backgroundIntensity.value=u.backgroundIntensity,c.material.toneMapped=Qe.getTransfer(v.colorSpace)!==nt,v.matrixAutoUpdate===!0&&v.updateMatrix(),c.material.uniforms.uvTransform.value.copy(v.matrix),(d!==v||p!==v.version||f!==i.toneMapping)&&(c.material.needsUpdate=!0,d=v,p=v.version,f=i.toneMapping),c.layers.enableAll(),m.unshift(c,c.geometry,c.material,0,0,null))}function _(m,u){m.getRGB(ms,Ul(i)),n.buffers.color.setClear(ms.r,ms.g,ms.b,u,o)}return{getClearColor:function(){return a},setClearColor:function(m,u=1){a.set(m),l=u,_(a,l)},getClearAlpha:function(){return l},setClearAlpha:function(m){l=m,_(a,l)},render:g}}function op(i,e,t,n){const s=i.getParameter(i.MAX_VERTEX_ATTRIBS),r=n.isWebGL2?null:e.get("OES_vertex_array_object"),o=n.isWebGL2||r!==null,a={},l=m(null);let c=l,h=!1;function d(D,O,X,Y,q){let $=!1;if(o){const Q=_(Y,X,O);c!==Q&&(c=Q,f(c.object)),$=u(D,Y,X,q),$&&M(D,Y,X,q)}else{const Q=O.wireframe===!0;(c.geometry!==Y.id||c.program!==X.id||c.wireframe!==Q)&&(c.geometry=Y.id,c.program=X.id,c.wireframe=Q,$=!0)}q!==null&&t.update(q,i.ELEMENT_ARRAY_BUFFER),($||h)&&(h=!1,U(D,O,X,Y),q!==null&&i.bindBuffer(i.ELEMENT_ARRAY_BUFFER,t.get(q).buffer))}function p(){return n.isWebGL2?i.createVertexArray():r.createVertexArrayOES()}function f(D){return n.isWebGL2?i.bindVertexArray(D):r.bindVertexArrayOES(D)}function g(D){return n.isWebGL2?i.deleteVertexArray(D):r.deleteVertexArrayOES(D)}function _(D,O,X){const Y=X.wireframe===!0;let q=a[D.id];q===void 0&&(q={},a[D.id]=q);let $=q[O.id];$===void 0&&($={},q[O.id]=$);let Q=$[Y];return Q===void 0&&(Q=m(p()),$[Y]=Q),Q}function m(D){const O=[],X=[],Y=[];for(let q=0;q<s;q++)O[q]=0,X[q]=0,Y[q]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:O,enabledAttributes:X,attributeDivisors:Y,object:D,attributes:{},index:null}}function u(D,O,X,Y){const q=c.attributes,$=O.attributes;let Q=0;const ie=X.getAttributes();for(const pe in ie)if(ie[pe].location>=0){const K=q[pe];let fe=$[pe];if(fe===void 0&&(pe==="instanceMatrix"&&D.instanceMatrix&&(fe=D.instanceMatrix),pe==="instanceColor"&&D.instanceColor&&(fe=D.instanceColor)),K===void 0||K.attribute!==fe||fe&&K.data!==fe.data)return!0;Q++}return c.attributesNum!==Q||c.index!==Y}function M(D,O,X,Y){const q={},$=O.attributes;let Q=0;const ie=X.getAttributes();for(const pe in ie)if(ie[pe].location>=0){let K=$[pe];K===void 0&&(pe==="instanceMatrix"&&D.instanceMatrix&&(K=D.instanceMatrix),pe==="instanceColor"&&D.instanceColor&&(K=D.instanceColor));const fe={};fe.attribute=K,K&&K.data&&(fe.data=K.data),q[pe]=fe,Q++}c.attributes=q,c.attributesNum=Q,c.index=Y}function v(){const D=c.newAttributes;for(let O=0,X=D.length;O<X;O++)D[O]=0}function b(D){C(D,0)}function C(D,O){const X=c.newAttributes,Y=c.enabledAttributes,q=c.attributeDivisors;X[D]=1,Y[D]===0&&(i.enableVertexAttribArray(D),Y[D]=1),q[D]!==O&&((n.isWebGL2?i:e.get("ANGLE_instanced_arrays"))[n.isWebGL2?"vertexAttribDivisor":"vertexAttribDivisorANGLE"](D,O),q[D]=O)}function w(){const D=c.newAttributes,O=c.enabledAttributes;for(let X=0,Y=O.length;X<Y;X++)O[X]!==D[X]&&(i.disableVertexAttribArray(X),O[X]=0)}function A(D,O,X,Y,q,$,Q){Q===!0?i.vertexAttribIPointer(D,O,X,q,$):i.vertexAttribPointer(D,O,X,Y,q,$)}function U(D,O,X,Y){if(n.isWebGL2===!1&&(D.isInstancedMesh||Y.isInstancedBufferGeometry)&&e.get("ANGLE_instanced_arrays")===null)return;v();const q=Y.attributes,$=X.getAttributes(),Q=O.defaultAttributeValues;for(const ie in $){const pe=$[ie];if(pe.location>=0){let W=q[ie];if(W===void 0&&(ie==="instanceMatrix"&&D.instanceMatrix&&(W=D.instanceMatrix),ie==="instanceColor"&&D.instanceColor&&(W=D.instanceColor)),W!==void 0){const K=W.normalized,fe=W.itemSize,Se=t.get(W);if(Se===void 0)continue;const xe=Se.buffer,Ue=Se.type,Ie=Se.bytesPerElement,Re=n.isWebGL2===!0&&(Ue===i.INT||Ue===i.UNSIGNED_INT||W.gpuType===gl);if(W.isInterleavedBufferAttribute){const qe=W.data,B=qe.stride,mt=W.offset;if(qe.isInstancedInterleavedBuffer){for(let Te=0;Te<pe.locationSize;Te++)C(pe.location+Te,qe.meshPerAttribute);D.isInstancedMesh!==!0&&Y._maxInstanceCount===void 0&&(Y._maxInstanceCount=qe.meshPerAttribute*qe.count)}else for(let Te=0;Te<pe.locationSize;Te++)b(pe.location+Te);i.bindBuffer(i.ARRAY_BUFFER,xe);for(let Te=0;Te<pe.locationSize;Te++)A(pe.location+Te,fe/pe.locationSize,Ue,K,B*Ie,(mt+fe/pe.locationSize*Te)*Ie,Re)}else{if(W.isInstancedBufferAttribute){for(let qe=0;qe<pe.locationSize;qe++)C(pe.location+qe,W.meshPerAttribute);D.isInstancedMesh!==!0&&Y._maxInstanceCount===void 0&&(Y._maxInstanceCount=W.meshPerAttribute*W.count)}else for(let qe=0;qe<pe.locationSize;qe++)b(pe.location+qe);i.bindBuffer(i.ARRAY_BUFFER,xe);for(let qe=0;qe<pe.locationSize;qe++)A(pe.location+qe,fe/pe.locationSize,Ue,K,fe*Ie,fe/pe.locationSize*qe*Ie,Re)}}else if(Q!==void 0){const K=Q[ie];if(K!==void 0)switch(K.length){case 2:i.vertexAttrib2fv(pe.location,K);break;case 3:i.vertexAttrib3fv(pe.location,K);break;case 4:i.vertexAttrib4fv(pe.location,K);break;default:i.vertexAttrib1fv(pe.location,K)}}}}w()}function x(){V();for(const D in a){const O=a[D];for(const X in O){const Y=O[X];for(const q in Y)g(Y[q].object),delete Y[q];delete O[X]}delete a[D]}}function E(D){if(a[D.id]===void 0)return;const O=a[D.id];for(const X in O){const Y=O[X];for(const q in Y)g(Y[q].object),delete Y[q];delete O[X]}delete a[D.id]}function F(D){for(const O in a){const X=a[O];if(X[D.id]===void 0)continue;const Y=X[D.id];for(const q in Y)g(Y[q].object),delete Y[q];delete X[D.id]}}function V(){ne(),h=!0,c!==l&&(c=l,f(c.object))}function ne(){l.geometry=null,l.program=null,l.wireframe=!1}return{setup:d,reset:V,resetDefaultState:ne,dispose:x,releaseStatesOfGeometry:E,releaseStatesOfProgram:F,initAttributes:v,enableAttribute:b,disableUnusedAttributes:w}}function lp(i,e,t,n){const s=n.isWebGL2;let r;function o(h){r=h}function a(h,d){i.drawArrays(r,h,d),t.update(d,r,1)}function l(h,d,p){if(p===0)return;let f,g;if(s)f=i,g="drawArraysInstanced";else if(f=e.get("ANGLE_instanced_arrays"),g="drawArraysInstancedANGLE",f===null){console.error("THREE.WebGLBufferRenderer: using THREE.InstancedBufferGeometry but hardware does not support extension ANGLE_instanced_arrays.");return}f[g](r,h,d,p),t.update(d,r,p)}function c(h,d,p){if(p===0)return;const f=e.get("WEBGL_multi_draw");if(f===null)for(let g=0;g<p;g++)this.render(h[g],d[g]);else{f.multiDrawArraysWEBGL(r,h,0,d,0,p);let g=0;for(let _=0;_<p;_++)g+=d[_];t.update(g,r,1)}}this.setMode=o,this.render=a,this.renderInstances=l,this.renderMultiDraw=c}function cp(i,e,t){let n;function s(){if(n!==void 0)return n;if(e.has("EXT_texture_filter_anisotropic")===!0){const A=e.get("EXT_texture_filter_anisotropic");n=i.getParameter(A.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else n=0;return n}function r(A){if(A==="highp"){if(i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.HIGH_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.HIGH_FLOAT).precision>0)return"highp";A="mediump"}return A==="mediump"&&i.getShaderPrecisionFormat(i.VERTEX_SHADER,i.MEDIUM_FLOAT).precision>0&&i.getShaderPrecisionFormat(i.FRAGMENT_SHADER,i.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}const o=typeof WebGL2RenderingContext<"u"&&i.constructor.name==="WebGL2RenderingContext";let a=t.precision!==void 0?t.precision:"highp";const l=r(a);l!==a&&(console.warn("THREE.WebGLRenderer:",a,"not supported, using",l,"instead."),a=l);const c=o||e.has("WEBGL_draw_buffers"),h=t.logarithmicDepthBuffer===!0,d=i.getParameter(i.MAX_TEXTURE_IMAGE_UNITS),p=i.getParameter(i.MAX_VERTEX_TEXTURE_IMAGE_UNITS),f=i.getParameter(i.MAX_TEXTURE_SIZE),g=i.getParameter(i.MAX_CUBE_MAP_TEXTURE_SIZE),_=i.getParameter(i.MAX_VERTEX_ATTRIBS),m=i.getParameter(i.MAX_VERTEX_UNIFORM_VECTORS),u=i.getParameter(i.MAX_VARYING_VECTORS),M=i.getParameter(i.MAX_FRAGMENT_UNIFORM_VECTORS),v=p>0,b=o||e.has("OES_texture_float"),C=v&&b,w=o?i.getParameter(i.MAX_SAMPLES):0;return{isWebGL2:o,drawBuffers:c,getMaxAnisotropy:s,getMaxPrecision:r,precision:a,logarithmicDepthBuffer:h,maxTextures:d,maxVertexTextures:p,maxTextureSize:f,maxCubemapSize:g,maxAttributes:_,maxVertexUniforms:m,maxVaryings:u,maxFragmentUniforms:M,vertexTextures:v,floatFragmentTextures:b,floatVertexTextures:C,maxSamples:w}}function up(i){const e=this;let t=null,n=0,s=!1,r=!1;const o=new bn,a=new Xe,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,p){const f=d.length!==0||p||n!==0||s;return s=p,n=d.length,f},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(d,p){t=h(d,p,0)},this.setState=function(d,p,f){const g=d.clippingPlanes,_=d.clipIntersection,m=d.clipShadows,u=i.get(d);if(!s||g===null||g.length===0||r&&!m)r?h(null):c();else{const M=r?0:n,v=M*4;let b=u.clippingState||null;l.value=b,b=h(g,p,v,f);for(let C=0;C!==v;++C)b[C]=t[C];u.clippingState=b,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=M}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(d,p,f,g){const _=d!==null?d.length:0;let m=null;if(_!==0){if(m=l.value,g!==!0||m===null){const u=f+_*4,M=p.matrixWorldInverse;a.getNormalMatrix(M),(m===null||m.length<u)&&(m=new Float32Array(u));for(let v=0,b=f;v!==_;++v,b+=4)o.copy(d[v]).applyMatrix4(M,a),o.normal.toArray(m,b),m[b+3]=o.constant}l.value=m,l.needsUpdate=!0}return e.numPlanes=_,e.numIntersection=0,m}}function hp(i){let e=new WeakMap;function t(o,a){return a===Lr?o.mapping=Si:a===Pr&&(o.mapping=Ei),o}function n(o){if(o&&o.isTexture){const a=o.mapping;if(a===Lr||a===Pr)if(e.has(o)){const l=e.get(o).texture;return t(l,o.mapping)}else{const l=o.image;if(l&&l.height>0){const c=new Eh(l.height/2);return c.fromEquirectangularTexture(i,o),e.set(o,c),o.addEventListener("dispose",s),t(c.texture,o.mapping)}else return null}}return o}function s(o){const a=o.target;a.removeEventListener("dispose",s);const l=e.get(a);l!==void 0&&(e.delete(a),l.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}class Us extends Nl{constructor(e=-1,t=1,n=1,s=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=s,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,s,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=s,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,s=(this.top+this.bottom)/2;let r=n-e,o=n+e,a=s+t,l=s-t;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,o=r+c*this.view.width,a-=h*this.view.offsetY,l=a-h*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}}const gi=4,mo=[.125,.215,.35,.446,.526,.582],kn=20,mr=new Us,go=new $e;let gr=null,_r=0,vr=0;const Gn=(1+Math.sqrt(5))/2,mi=1/Gn,_o=[new I(1,1,1),new I(-1,1,1),new I(1,1,-1),new I(-1,1,-1),new I(0,Gn,mi),new I(0,Gn,-mi),new I(mi,0,Gn),new I(-mi,0,Gn),new I(Gn,mi,0),new I(-Gn,mi,0)];class vo{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,s=100){gr=this._renderer.getRenderTarget(),_r=this._renderer.getActiveCubeFace(),vr=this._renderer.getActiveMipmapLevel(),this._setSize(256);const r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(e,n,s,r),t>0&&this._blur(r,0,0,t),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=So(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Mo(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(gr,_r,vr),e.scissorTest=!1,gs(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===Si||e.mapping===Ei?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),gr=this._renderer.getRenderTarget(),_r=this._renderer.getActiveCubeFace(),vr=this._renderer.getActiveMipmapLevel();const n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Ht,minFilter:Ht,generateMipmaps:!1,type:yi,format:en,colorSpace:vn,depthBuffer:!1},s=xo(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=xo(e,t,n);const{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=dp(r)),this._blurMaterial=fp(r,e,t)}return s}_compileMaterial(e){const t=new be(this._lodPlanes[0],e);this._renderer.compile(t,mr)}_sceneToCubeUV(e,t,n,s){const a=new Jt(90,1,t,n),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],h=this._renderer,d=h.autoClear,p=h.toneMapping;h.getClearColor(go),h.toneMapping=Rn,h.autoClear=!1;const f=new Ds({name:"PMREM.Background",side:Dt,depthWrite:!1,depthTest:!1}),g=new be(new it,f);let _=!1;const m=e.background;m?m.isColor&&(f.color.copy(m),e.background=null,_=!0):(f.color.copy(go),_=!0);for(let u=0;u<6;u++){const M=u%3;M===0?(a.up.set(0,l[u],0),a.lookAt(c[u],0,0)):M===1?(a.up.set(0,0,l[u]),a.lookAt(0,c[u],0)):(a.up.set(0,l[u],0),a.lookAt(0,0,c[u]));const v=this._cubeSize;gs(s,M*v,u>2?v:0,v,v),h.setRenderTarget(s),_&&h.render(g,a),h.render(e,a)}g.geometry.dispose(),g.material.dispose(),h.toneMapping=p,h.autoClear=d,e.background=m}_textureToCubeUV(e,t){const n=this._renderer,s=e.mapping===Si||e.mapping===Ei;s?(this._cubemapMaterial===null&&(this._cubemapMaterial=So()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Mo());const r=s?this._cubemapMaterial:this._equirectMaterial,o=new be(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=e;const l=this._cubeSize;gs(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(o,mr)}_applyPMREM(e){const t=this._renderer,n=t.autoClear;t.autoClear=!1;for(let s=1;s<this._lodPlanes.length;s++){const r=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),o=_o[(s-1)%_o.length];this._blur(e,s-1,s,r,o)}t.autoClear=n}_blur(e,t,n,s,r){const o=this._pingPongRenderTarget;this._halfBlur(e,o,t,n,s,"latitudinal",r),this._halfBlur(o,e,n,n,s,"longitudinal",r)}_halfBlur(e,t,n,s,r,o,a){const l=this._renderer,c=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const h=3,d=new be(this._lodPlanes[s],c),p=c.uniforms,f=this._sizeLods[n]-1,g=isFinite(r)?Math.PI/(2*f):2*Math.PI/(2*kn-1),_=r/g,m=isFinite(r)?1+Math.floor(h*_):kn;m>kn&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${kn}`);const u=[];let M=0;for(let A=0;A<kn;++A){const U=A/_,x=Math.exp(-U*U/2);u.push(x),A===0?M+=x:A<m&&(M+=2*x)}for(let A=0;A<u.length;A++)u[A]=u[A]/M;p.envMap.value=e.texture,p.samples.value=m,p.weights.value=u,p.latitudinal.value=o==="latitudinal",a&&(p.poleAxis.value=a);const{_lodMax:v}=this;p.dTheta.value=g,p.mipInt.value=v-n;const b=this._sizeLods[s],C=3*b*(s>v-gi?s-v+gi:0),w=4*(this._cubeSize-b);gs(t,C,w,3*b,2*b),l.setRenderTarget(t),l.render(d,mr)}}function dp(i){const e=[],t=[],n=[];let s=i;const r=i-gi+1+mo.length;for(let o=0;o<r;o++){const a=Math.pow(2,s);t.push(a);let l=1/a;o>i-gi?l=mo[o-i+gi-1]:o===0&&(l=0),n.push(l);const c=1/(a-2),h=-c,d=1+c,p=[h,h,d,h,d,d,h,h,d,d,h,d],f=6,g=6,_=3,m=2,u=1,M=new Float32Array(_*g*f),v=new Float32Array(m*g*f),b=new Float32Array(u*g*f);for(let w=0;w<f;w++){const A=w%3*2/3-1,U=w>2?0:-1,x=[A,U,0,A+2/3,U,0,A+2/3,U+1,0,A,U,0,A+2/3,U+1,0,A,U+1,0];M.set(x,_*g*w),v.set(p,m*g*w);const E=[w,w,w,w,w,w];b.set(E,u*g*w)}const C=new $t;C.setAttribute("position",new an(M,_)),C.setAttribute("uv",new an(v,m)),C.setAttribute("faceIndex",new an(b,u)),e.push(C),s>gi&&s--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function xo(i,e,t){const n=new Un(i,e,t);return n.texture.mapping=Cs,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function gs(i,e,t,n,s){i.viewport.set(e,t,n,s),i.scissor.set(e,t,n,s)}function fp(i,e,t){const n=new Float32Array(kn),s=new I(0,1,0);return new xn({name:"SphericalGaussianBlur",defines:{n:kn,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${i}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:s}},vertexShader:Zr(),fragmentShader:`

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
		`,blending:gn,depthTest:!1,depthWrite:!1})}function Mo(){return new xn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Zr(),fragmentShader:`

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
		`,blending:gn,depthTest:!1,depthWrite:!1})}function So(){return new xn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Zr(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:gn,depthTest:!1,depthWrite:!1})}function Zr(){return`

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
	`}function pp(i){let e=new WeakMap,t=null;function n(a){if(a&&a.isTexture){const l=a.mapping,c=l===Lr||l===Pr,h=l===Si||l===Ei;if(c||h)if(a.isRenderTargetTexture&&a.needsPMREMUpdate===!0){a.needsPMREMUpdate=!1;let d=e.get(a);return t===null&&(t=new vo(i)),d=c?t.fromEquirectangular(a,d):t.fromCubemap(a,d),e.set(a,d),d.texture}else{if(e.has(a))return e.get(a).texture;{const d=a.image;if(c&&d&&d.height>0||h&&d&&s(d)){t===null&&(t=new vo(i));const p=c?t.fromEquirectangular(a):t.fromCubemap(a);return e.set(a,p),a.addEventListener("dispose",r),p.texture}else return null}}}return a}function s(a){let l=0;const c=6;for(let h=0;h<c;h++)a[h]!==void 0&&l++;return l===c}function r(a){const l=a.target;l.removeEventListener("dispose",r);const c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:o}}function mp(i){const e={};function t(n){if(e[n]!==void 0)return e[n];let s;switch(n){case"WEBGL_depth_texture":s=i.getExtension("WEBGL_depth_texture")||i.getExtension("MOZ_WEBGL_depth_texture")||i.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":s=i.getExtension("EXT_texture_filter_anisotropic")||i.getExtension("MOZ_EXT_texture_filter_anisotropic")||i.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":s=i.getExtension("WEBGL_compressed_texture_s3tc")||i.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":s=i.getExtension("WEBGL_compressed_texture_pvrtc")||i.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:s=i.getExtension(n)}return e[n]=s,s}return{has:function(n){return t(n)!==null},init:function(n){n.isWebGL2?(t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance")):(t("WEBGL_depth_texture"),t("OES_texture_float"),t("OES_texture_half_float"),t("OES_texture_half_float_linear"),t("OES_standard_derivatives"),t("OES_element_index_uint"),t("OES_vertex_array_object"),t("ANGLE_instanced_arrays")),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture")},get:function(n){const s=t(n);return s===null&&console.warn("THREE.WebGLRenderer: "+n+" extension not supported."),s}}}function gp(i,e,t,n){const s={},r=new WeakMap;function o(d){const p=d.target;p.index!==null&&e.remove(p.index);for(const g in p.attributes)e.remove(p.attributes[g]);for(const g in p.morphAttributes){const _=p.morphAttributes[g];for(let m=0,u=_.length;m<u;m++)e.remove(_[m])}p.removeEventListener("dispose",o),delete s[p.id];const f=r.get(p);f&&(e.remove(f),r.delete(p)),n.releaseStatesOfGeometry(p),p.isInstancedBufferGeometry===!0&&delete p._maxInstanceCount,t.memory.geometries--}function a(d,p){return s[p.id]===!0||(p.addEventListener("dispose",o),s[p.id]=!0,t.memory.geometries++),p}function l(d){const p=d.attributes;for(const g in p)e.update(p[g],i.ARRAY_BUFFER);const f=d.morphAttributes;for(const g in f){const _=f[g];for(let m=0,u=_.length;m<u;m++)e.update(_[m],i.ARRAY_BUFFER)}}function c(d){const p=[],f=d.index,g=d.attributes.position;let _=0;if(f!==null){const M=f.array;_=f.version;for(let v=0,b=M.length;v<b;v+=3){const C=M[v+0],w=M[v+1],A=M[v+2];p.push(C,w,w,A,A,C)}}else if(g!==void 0){const M=g.array;_=g.version;for(let v=0,b=M.length/3-1;v<b;v+=3){const C=v+0,w=v+1,A=v+2;p.push(C,w,w,A,A,C)}}else return;const m=new(Al(p)?Dl:Pl)(p,1);m.version=_;const u=r.get(d);u&&e.remove(u),r.set(d,m)}function h(d){const p=r.get(d);if(p){const f=d.index;f!==null&&p.version<f.version&&c(d)}else c(d);return r.get(d)}return{get:a,update:l,getWireframeAttribute:h}}function _p(i,e,t,n){const s=n.isWebGL2;let r;function o(f){r=f}let a,l;function c(f){a=f.type,l=f.bytesPerElement}function h(f,g){i.drawElements(r,g,a,f*l),t.update(g,r,1)}function d(f,g,_){if(_===0)return;let m,u;if(s)m=i,u="drawElementsInstanced";else if(m=e.get("ANGLE_instanced_arrays"),u="drawElementsInstancedANGLE",m===null){console.error("THREE.WebGLIndexedBufferRenderer: using THREE.InstancedBufferGeometry but hardware does not support extension ANGLE_instanced_arrays.");return}m[u](r,g,a,f*l,_),t.update(g,r,_)}function p(f,g,_){if(_===0)return;const m=e.get("WEBGL_multi_draw");if(m===null)for(let u=0;u<_;u++)this.render(f[u]/l,g[u]);else{m.multiDrawElementsWEBGL(r,g,0,a,f,0,_);let u=0;for(let M=0;M<_;M++)u+=g[M];t.update(u,r,1)}}this.setMode=o,this.setIndex=c,this.render=h,this.renderInstances=d,this.renderMultiDraw=p}function vp(i){const e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(t.calls++,o){case i.TRIANGLES:t.triangles+=a*(r/3);break;case i.LINES:t.lines+=a*(r/2);break;case i.LINE_STRIP:t.lines+=a*(r-1);break;case i.LINE_LOOP:t.lines+=a*r;break;case i.POINTS:t.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function s(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:s,update:n}}function xp(i,e){return i[0]-e[0]}function Mp(i,e){return Math.abs(e[1])-Math.abs(i[1])}function Sp(i,e,t){const n={},s=new Float32Array(8),r=new WeakMap,o=new xt,a=[];for(let c=0;c<8;c++)a[c]=[c,0];function l(c,h,d){const p=c.morphTargetInfluences;if(e.isWebGL2===!0){const f=h.morphAttributes.position||h.morphAttributes.normal||h.morphAttributes.color,g=f!==void 0?f.length:0;let _=r.get(h);if(_===void 0||_.count!==g){let D=function(){V.dispose(),r.delete(h),h.removeEventListener("dispose",D)};_!==void 0&&_.texture.dispose();const M=h.morphAttributes.position!==void 0,v=h.morphAttributes.normal!==void 0,b=h.morphAttributes.color!==void 0,C=h.morphAttributes.position||[],w=h.morphAttributes.normal||[],A=h.morphAttributes.color||[];let U=0;M===!0&&(U=1),v===!0&&(U=2),b===!0&&(U=3);let x=h.attributes.position.count*U,E=1;x>e.maxTextureSize&&(E=Math.ceil(x/e.maxTextureSize),x=e.maxTextureSize);const F=new Float32Array(x*E*4*g),V=new Cl(F,x,E,g);V.type=wn,V.needsUpdate=!0;const ne=U*4;for(let O=0;O<g;O++){const X=C[O],Y=w[O],q=A[O],$=x*E*4*O;for(let Q=0;Q<X.count;Q++){const ie=Q*ne;M===!0&&(o.fromBufferAttribute(X,Q),F[$+ie+0]=o.x,F[$+ie+1]=o.y,F[$+ie+2]=o.z,F[$+ie+3]=0),v===!0&&(o.fromBufferAttribute(Y,Q),F[$+ie+4]=o.x,F[$+ie+5]=o.y,F[$+ie+6]=o.z,F[$+ie+7]=0),b===!0&&(o.fromBufferAttribute(q,Q),F[$+ie+8]=o.x,F[$+ie+9]=o.y,F[$+ie+10]=o.z,F[$+ie+11]=q.itemSize===4?o.w:1)}}_={count:g,texture:V,size:new Ae(x,E)},r.set(h,_),h.addEventListener("dispose",D)}let m=0;for(let M=0;M<p.length;M++)m+=p[M];const u=h.morphTargetsRelative?1:1-m;d.getUniforms().setValue(i,"morphTargetBaseInfluence",u),d.getUniforms().setValue(i,"morphTargetInfluences",p),d.getUniforms().setValue(i,"morphTargetsTexture",_.texture,t),d.getUniforms().setValue(i,"morphTargetsTextureSize",_.size)}else{const f=p===void 0?0:p.length;let g=n[h.id];if(g===void 0||g.length!==f){g=[];for(let v=0;v<f;v++)g[v]=[v,0];n[h.id]=g}for(let v=0;v<f;v++){const b=g[v];b[0]=v,b[1]=p[v]}g.sort(Mp);for(let v=0;v<8;v++)v<f&&g[v][1]?(a[v][0]=g[v][0],a[v][1]=g[v][1]):(a[v][0]=Number.MAX_SAFE_INTEGER,a[v][1]=0);a.sort(xp);const _=h.morphAttributes.position,m=h.morphAttributes.normal;let u=0;for(let v=0;v<8;v++){const b=a[v],C=b[0],w=b[1];C!==Number.MAX_SAFE_INTEGER&&w?(_&&h.getAttribute("morphTarget"+v)!==_[C]&&h.setAttribute("morphTarget"+v,_[C]),m&&h.getAttribute("morphNormal"+v)!==m[C]&&h.setAttribute("morphNormal"+v,m[C]),s[v]=w,u+=w):(_&&h.hasAttribute("morphTarget"+v)===!0&&h.deleteAttribute("morphTarget"+v),m&&h.hasAttribute("morphNormal"+v)===!0&&h.deleteAttribute("morphNormal"+v),s[v]=0)}const M=h.morphTargetsRelative?1:1-u;d.getUniforms().setValue(i,"morphTargetBaseInfluence",M),d.getUniforms().setValue(i,"morphTargetInfluences",s)}}return{update:l}}function Ep(i,e,t,n){let s=new WeakMap;function r(l){const c=n.render.frame,h=l.geometry,d=e.get(l,h);if(s.get(d)!==c&&(e.update(d),s.set(d,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",a)===!1&&l.addEventListener("dispose",a),s.get(l)!==c&&(t.update(l.instanceMatrix,i.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,i.ARRAY_BUFFER),s.set(l,c))),l.isSkinnedMesh){const p=l.skeleton;s.get(p)!==c&&(p.update(),s.set(p,c))}return d}function o(){s=new WeakMap}function a(l){const c=l.target;c.removeEventListener("dispose",a),t.remove(c.instanceMatrix),c.instanceColor!==null&&t.remove(c.instanceColor)}return{update:r,dispose:o}}class Bl extends Ot{constructor(e,t,n,s,r,o,a,l,c,h){if(h=h!==void 0?h:Xn,h!==Xn&&h!==Ti)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&h===Xn&&(n=An),n===void 0&&h===Ti&&(n=Wn),super(null,s,r,o,a,l,h,n,c),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=a!==void 0?a:Rt,this.minFilter=l!==void 0?l:Rt,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){const t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}}const zl=new Ot,Gl=new Bl(1,1);Gl.compareFunction=bl;const Hl=new Cl,kl=new ah,Vl=new Fl,Eo=[],yo=[],To=new Float32Array(16),bo=new Float32Array(9),Ao=new Float32Array(4);function Ai(i,e,t){const n=i[0];if(n<=0||n>0)return i;const s=e*t;let r=Eo[s];if(r===void 0&&(r=new Float32Array(s),Eo[s]=r),e!==0){n.toArray(r,0);for(let o=1,a=0;o!==e;++o)a+=t,i[o].toArray(r,a)}return r}function ft(i,e){if(i.length!==e.length)return!1;for(let t=0,n=i.length;t<n;t++)if(i[t]!==e[t])return!1;return!0}function pt(i,e){for(let t=0,n=e.length;t<n;t++)i[t]=e[t]}function Is(i,e){let t=yo[e];t===void 0&&(t=new Int32Array(e),yo[e]=t);for(let n=0;n!==e;++n)t[n]=i.allocateTextureUnit();return t}function yp(i,e){const t=this.cache;t[0]!==e&&(i.uniform1f(this.addr,e),t[0]=e)}function Tp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ft(t,e))return;i.uniform2fv(this.addr,e),pt(t,e)}}function bp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(i.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(ft(t,e))return;i.uniform3fv(this.addr,e),pt(t,e)}}function Ap(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ft(t,e))return;i.uniform4fv(this.addr,e),pt(t,e)}}function wp(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(ft(t,e))return;i.uniformMatrix2fv(this.addr,!1,e),pt(t,e)}else{if(ft(t,n))return;Ao.set(n),i.uniformMatrix2fv(this.addr,!1,Ao),pt(t,n)}}function Rp(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(ft(t,e))return;i.uniformMatrix3fv(this.addr,!1,e),pt(t,e)}else{if(ft(t,n))return;bo.set(n),i.uniformMatrix3fv(this.addr,!1,bo),pt(t,n)}}function Cp(i,e){const t=this.cache,n=e.elements;if(n===void 0){if(ft(t,e))return;i.uniformMatrix4fv(this.addr,!1,e),pt(t,e)}else{if(ft(t,n))return;To.set(n),i.uniformMatrix4fv(this.addr,!1,To),pt(t,n)}}function Lp(i,e){const t=this.cache;t[0]!==e&&(i.uniform1i(this.addr,e),t[0]=e)}function Pp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ft(t,e))return;i.uniform2iv(this.addr,e),pt(t,e)}}function Dp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(ft(t,e))return;i.uniform3iv(this.addr,e),pt(t,e)}}function Up(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ft(t,e))return;i.uniform4iv(this.addr,e),pt(t,e)}}function Ip(i,e){const t=this.cache;t[0]!==e&&(i.uniform1ui(this.addr,e),t[0]=e)}function Np(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(i.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(ft(t,e))return;i.uniform2uiv(this.addr,e),pt(t,e)}}function Fp(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(i.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(ft(t,e))return;i.uniform3uiv(this.addr,e),pt(t,e)}}function Op(i,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(i.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(ft(t,e))return;i.uniform4uiv(this.addr,e),pt(t,e)}}function Bp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s);const r=this.type===i.SAMPLER_2D_SHADOW?Gl:zl;t.setTexture2D(e||r,s)}function zp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture3D(e||kl,s)}function Gp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTextureCube(e||Vl,s)}function Hp(i,e,t){const n=this.cache,s=t.allocateTextureUnit();n[0]!==s&&(i.uniform1i(this.addr,s),n[0]=s),t.setTexture2DArray(e||Hl,s)}function kp(i){switch(i){case 5126:return yp;case 35664:return Tp;case 35665:return bp;case 35666:return Ap;case 35674:return wp;case 35675:return Rp;case 35676:return Cp;case 5124:case 35670:return Lp;case 35667:case 35671:return Pp;case 35668:case 35672:return Dp;case 35669:case 35673:return Up;case 5125:return Ip;case 36294:return Np;case 36295:return Fp;case 36296:return Op;case 35678:case 36198:case 36298:case 36306:case 35682:return Bp;case 35679:case 36299:case 36307:return zp;case 35680:case 36300:case 36308:case 36293:return Gp;case 36289:case 36303:case 36311:case 36292:return Hp}}function Vp(i,e){i.uniform1fv(this.addr,e)}function Wp(i,e){const t=Ai(e,this.size,2);i.uniform2fv(this.addr,t)}function Xp(i,e){const t=Ai(e,this.size,3);i.uniform3fv(this.addr,t)}function $p(i,e){const t=Ai(e,this.size,4);i.uniform4fv(this.addr,t)}function qp(i,e){const t=Ai(e,this.size,4);i.uniformMatrix2fv(this.addr,!1,t)}function Yp(i,e){const t=Ai(e,this.size,9);i.uniformMatrix3fv(this.addr,!1,t)}function jp(i,e){const t=Ai(e,this.size,16);i.uniformMatrix4fv(this.addr,!1,t)}function Kp(i,e){i.uniform1iv(this.addr,e)}function Zp(i,e){i.uniform2iv(this.addr,e)}function Jp(i,e){i.uniform3iv(this.addr,e)}function Qp(i,e){i.uniform4iv(this.addr,e)}function em(i,e){i.uniform1uiv(this.addr,e)}function tm(i,e){i.uniform2uiv(this.addr,e)}function nm(i,e){i.uniform3uiv(this.addr,e)}function im(i,e){i.uniform4uiv(this.addr,e)}function sm(i,e,t){const n=this.cache,s=e.length,r=Is(t,s);ft(n,r)||(i.uniform1iv(this.addr,r),pt(n,r));for(let o=0;o!==s;++o)t.setTexture2D(e[o]||zl,r[o])}function rm(i,e,t){const n=this.cache,s=e.length,r=Is(t,s);ft(n,r)||(i.uniform1iv(this.addr,r),pt(n,r));for(let o=0;o!==s;++o)t.setTexture3D(e[o]||kl,r[o])}function am(i,e,t){const n=this.cache,s=e.length,r=Is(t,s);ft(n,r)||(i.uniform1iv(this.addr,r),pt(n,r));for(let o=0;o!==s;++o)t.setTextureCube(e[o]||Vl,r[o])}function om(i,e,t){const n=this.cache,s=e.length,r=Is(t,s);ft(n,r)||(i.uniform1iv(this.addr,r),pt(n,r));for(let o=0;o!==s;++o)t.setTexture2DArray(e[o]||Hl,r[o])}function lm(i){switch(i){case 5126:return Vp;case 35664:return Wp;case 35665:return Xp;case 35666:return $p;case 35674:return qp;case 35675:return Yp;case 35676:return jp;case 5124:case 35670:return Kp;case 35667:case 35671:return Zp;case 35668:case 35672:return Jp;case 35669:case 35673:return Qp;case 5125:return em;case 36294:return tm;case 36295:return nm;case 36296:return im;case 35678:case 36198:case 36298:case 36306:case 35682:return sm;case 35679:case 36299:case 36307:return rm;case 35680:case 36300:case 36308:case 36293:return am;case 36289:case 36303:case 36311:case 36292:return om}}class cm{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=kp(t.type)}}class um{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=lm(t.type)}}class hm{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){const s=this.seq;for(let r=0,o=s.length;r!==o;++r){const a=s[r];a.setValue(e,t[a.id],n)}}}const xr=/(\w+)(\])?(\[|\.)?/g;function wo(i,e){i.seq.push(e),i.map[e.id]=e}function dm(i,e,t){const n=i.name,s=n.length;for(xr.lastIndex=0;;){const r=xr.exec(n),o=xr.lastIndex;let a=r[1];const l=r[2]==="]",c=r[3];if(l&&(a=a|0),c===void 0||c==="["&&o+2===s){wo(t,c===void 0?new cm(a,i,e):new um(a,i,e));break}else{let d=t.map[a];d===void 0&&(d=new hm(a),wo(t,d)),t=d}}}class Ms{constructor(e,t){this.seq=[],this.map={};const n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let s=0;s<n;++s){const r=e.getActiveUniform(t,s),o=e.getUniformLocation(t,r.name);dm(r,o,this)}}setValue(e,t,n,s){const r=this.map[t];r!==void 0&&r.setValue(e,n,s)}setOptional(e,t,n){const s=t[n];s!==void 0&&this.setValue(e,n,s)}static upload(e,t,n,s){for(let r=0,o=t.length;r!==o;++r){const a=t[r],l=n[a.id];l.needsUpdate!==!1&&a.setValue(e,l.value,s)}}static seqWithValue(e,t){const n=[];for(let s=0,r=e.length;s!==r;++s){const o=e[s];o.id in t&&n.push(o)}return n}}function Ro(i,e,t){const n=i.createShader(e);return i.shaderSource(n,t),i.compileShader(n),n}const fm=37297;let pm=0;function mm(i,e){const t=i.split(`
`),n=[],s=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let o=s;o<r;o++){const a=o+1;n.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return n.join(`
`)}function gm(i){const e=Qe.getPrimaries(Qe.workingColorSpace),t=Qe.getPrimaries(i);let n;switch(e===t?n="":e===bs&&t===Ts?n="LinearDisplayP3ToLinearSRGB":e===Ts&&t===bs&&(n="LinearSRGBToLinearDisplayP3"),i){case vn:case Ls:return[n,"LinearTransferOETF"];case Mt:case $r:return[n,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space:",i),[n,"LinearTransferOETF"]}}function Co(i,e,t){const n=i.getShaderParameter(e,i.COMPILE_STATUS),s=i.getShaderInfoLog(e).trim();if(n&&s==="")return"";const r=/ERROR: 0:(\d+)/.exec(s);if(r){const o=parseInt(r[1]);return t.toUpperCase()+`

`+s+`

`+mm(i.getShaderSource(e),o)}else return s}function _m(i,e){const t=gm(e);return`vec4 ${i}( vec4 value ) { return ${t[0]}( ${t[1]}( value ) ); }`}function vm(i,e){let t;switch(e){case Cu:t="Linear";break;case Lu:t="Reinhard";break;case Pu:t="OptimizedCineon";break;case pl:t="ACESFilmic";break;case Uu:t="AgX";break;case Du:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+i+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}function xm(i){return[i.extensionDerivatives||i.envMapCubeUVHeight||i.bumpMap||i.normalMapTangentSpace||i.clearcoatNormalMap||i.flatShading||i.shaderID==="physical"?"#extension GL_OES_standard_derivatives : enable":"",(i.extensionFragDepth||i.logarithmicDepthBuffer)&&i.rendererExtensionFragDepth?"#extension GL_EXT_frag_depth : enable":"",i.extensionDrawBuffers&&i.rendererExtensionDrawBuffers?"#extension GL_EXT_draw_buffers : require":"",(i.extensionShaderTextureLOD||i.envMap||i.transmission)&&i.rendererExtensionShaderTextureLod?"#extension GL_EXT_shader_texture_lod : enable":""].filter(_i).join(`
`)}function Mm(i){return[i.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":""].filter(_i).join(`
`)}function Sm(i){const e=[];for(const t in i){const n=i[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function Em(i,e){const t={},n=i.getProgramParameter(e,i.ACTIVE_ATTRIBUTES);for(let s=0;s<n;s++){const r=i.getActiveAttrib(e,s),o=r.name;let a=1;r.type===i.FLOAT_MAT2&&(a=2),r.type===i.FLOAT_MAT3&&(a=3),r.type===i.FLOAT_MAT4&&(a=4),t[o]={type:r.type,location:i.getAttribLocation(e,o),locationSize:a}}return t}function _i(i){return i!==""}function Lo(i,e){const t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return i.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function Po(i,e){return i.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const ym=/^[ \t]*#include +<([\w\d./]+)>/gm;function Or(i){return i.replace(ym,bm)}const Tm=new Map([["encodings_fragment","colorspace_fragment"],["encodings_pars_fragment","colorspace_pars_fragment"],["output_fragment","opaque_fragment"]]);function bm(i,e){let t=ze[e];if(t===void 0){const n=Tm.get(e);if(n!==void 0)t=ze[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return Or(t)}const Am=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Do(i){return i.replace(Am,wm)}function wm(i,e,t,n){let s="";for(let r=parseInt(e);r<parseInt(t);r++)s+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return s}function Uo(i){let e="precision "+i.precision+` float;
precision `+i.precision+" int;";return i.precision==="highp"?e+=`
#define HIGH_PRECISION`:i.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:i.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function Rm(i){let e="SHADOWMAP_TYPE_BASIC";return i.shadowMapType===hl?e="SHADOWMAP_TYPE_PCF":i.shadowMapType===dl?e="SHADOWMAP_TYPE_PCF_SOFT":i.shadowMapType===fn&&(e="SHADOWMAP_TYPE_VSM"),e}function Cm(i){let e="ENVMAP_TYPE_CUBE";if(i.envMap)switch(i.envMapMode){case Si:case Ei:e="ENVMAP_TYPE_CUBE";break;case Cs:e="ENVMAP_TYPE_CUBE_UV";break}return e}function Lm(i){let e="ENVMAP_MODE_REFLECTION";if(i.envMap)switch(i.envMapMode){case Ei:e="ENVMAP_MODE_REFRACTION";break}return e}function Pm(i){let e="ENVMAP_BLENDING_NONE";if(i.envMap)switch(i.combine){case fl:e="ENVMAP_BLENDING_MULTIPLY";break;case wu:e="ENVMAP_BLENDING_MIX";break;case Ru:e="ENVMAP_BLENDING_ADD";break}return e}function Dm(i){const e=i.envMapCubeUVHeight;if(e===null)return null;const t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:n,maxMip:t}}function Um(i,e,t,n){const s=i.getContext(),r=t.defines;let o=t.vertexShader,a=t.fragmentShader;const l=Rm(t),c=Cm(t),h=Lm(t),d=Pm(t),p=Dm(t),f=t.isWebGL2?"":xm(t),g=Mm(t),_=Sm(r),m=s.createProgram();let u,M,v=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(u=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_].filter(_i).join(`
`),u.length>0&&(u+=`
`),M=[f,"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_].filter(_i).join(`
`),M.length>0&&(M+=`
`)):(u=[Uo(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors&&t.isWebGL2?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_TEXTURE":"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0&&t.isWebGL2?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.useLegacyLights?"#define LEGACY_LIGHTS":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.logarithmicDepthBuffer&&t.rendererExtensionFragDepth?"#define USE_LOGDEPTHBUF_EXT":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#if ( defined( USE_MORPHTARGETS ) && ! defined( MORPHTARGETS_TEXTURE ) )","	attribute vec3 morphTarget0;","	attribute vec3 morphTarget1;","	attribute vec3 morphTarget2;","	attribute vec3 morphTarget3;","	#ifdef USE_MORPHNORMALS","		attribute vec3 morphNormal0;","		attribute vec3 morphNormal1;","		attribute vec3 morphNormal2;","		attribute vec3 morphNormal3;","	#else","		attribute vec3 morphTarget4;","		attribute vec3 morphTarget5;","		attribute vec3 morphTarget6;","		attribute vec3 morphTarget7;","	#endif","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(_i).join(`
`),M=[f,Uo(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,_,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+h:"",t.envMap?"#define "+d:"",p?"#define CUBEUV_TEXEL_WIDTH "+p.texelWidth:"",p?"#define CUBEUV_TEXEL_HEIGHT "+p.texelHeight:"",p?"#define CUBEUV_MAX_MIP "+p.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.useLegacyLights?"#define LEGACY_LIGHTS":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.logarithmicDepthBuffer&&t.rendererExtensionFragDepth?"#define USE_LOGDEPTHBUF_EXT":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Rn?"#define TONE_MAPPING":"",t.toneMapping!==Rn?ze.tonemapping_pars_fragment:"",t.toneMapping!==Rn?vm("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",ze.colorspace_pars_fragment,_m("linearToOutputTexel",t.outputColorSpace),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(_i).join(`
`)),o=Or(o),o=Lo(o,t),o=Po(o,t),a=Or(a),a=Lo(a,t),a=Po(a,t),o=Do(o),a=Do(a),t.isWebGL2&&t.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,u=[g,"precision mediump sampler2DArray;","#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+u,M=["precision mediump sampler2DArray;","#define varying in",t.glslVersion===Ka?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===Ka?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+M);const b=v+u+o,C=v+M+a,w=Ro(s,s.VERTEX_SHADER,b),A=Ro(s,s.FRAGMENT_SHADER,C);s.attachShader(m,w),s.attachShader(m,A),t.index0AttributeName!==void 0?s.bindAttribLocation(m,0,t.index0AttributeName):t.morphTargets===!0&&s.bindAttribLocation(m,0,"position"),s.linkProgram(m);function U(V){if(i.debug.checkShaderErrors){const ne=s.getProgramInfoLog(m).trim(),D=s.getShaderInfoLog(w).trim(),O=s.getShaderInfoLog(A).trim();let X=!0,Y=!0;if(s.getProgramParameter(m,s.LINK_STATUS)===!1)if(X=!1,typeof i.debug.onShaderError=="function")i.debug.onShaderError(s,m,w,A);else{const q=Co(s,w,"vertex"),$=Co(s,A,"fragment");console.error("THREE.WebGLProgram: Shader Error "+s.getError()+" - VALIDATE_STATUS "+s.getProgramParameter(m,s.VALIDATE_STATUS)+`

Program Info Log: `+ne+`
`+q+`
`+$)}else ne!==""?console.warn("THREE.WebGLProgram: Program Info Log:",ne):(D===""||O==="")&&(Y=!1);Y&&(V.diagnostics={runnable:X,programLog:ne,vertexShader:{log:D,prefix:u},fragmentShader:{log:O,prefix:M}})}s.deleteShader(w),s.deleteShader(A),x=new Ms(s,m),E=Em(s,m)}let x;this.getUniforms=function(){return x===void 0&&U(this),x};let E;this.getAttributes=function(){return E===void 0&&U(this),E};let F=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return F===!1&&(F=s.getProgramParameter(m,fm)),F},this.destroy=function(){n.releaseStatesOfProgram(this),s.deleteProgram(m),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=pm++,this.cacheKey=e,this.usedTimes=1,this.program=m,this.vertexShader=w,this.fragmentShader=A,this}let Im=0;class Nm{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const t=e.vertexShader,n=e.fragmentShader,s=this._getShaderStage(t),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(e);return o.has(s)===!1&&(o.add(s),s.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(e){const t=this.materialCache.get(e);for(const n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const t=this.materialCache;let n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){const t=this.shaderCache;let n=t.get(e);return n===void 0&&(n=new Fm(e),t.set(e,n)),n}}class Fm{constructor(e){this.id=Im++,this.code=e,this.usedTimes=0}}function Om(i,e,t,n,s,r,o){const a=new jr,l=new Nm,c=[],h=s.isWebGL2,d=s.logarithmicDepthBuffer,p=s.vertexTextures;let f=s.precision;const g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(x){return x===0?"uv":`uv${x}`}function m(x,E,F,V,ne){const D=V.fog,O=ne.geometry,X=x.isMeshStandardMaterial?V.environment:null,Y=(x.isMeshStandardMaterial?t:e).get(x.envMap||X),q=Y&&Y.mapping===Cs?Y.image.height:null,$=g[x.type];x.precision!==null&&(f=s.getMaxPrecision(x.precision),f!==x.precision&&console.warn("THREE.WebGLProgram.getParameters:",x.precision,"not supported, using",f,"instead."));const Q=O.morphAttributes.position||O.morphAttributes.normal||O.morphAttributes.color,ie=Q!==void 0?Q.length:0;let pe=0;O.morphAttributes.position!==void 0&&(pe=1),O.morphAttributes.normal!==void 0&&(pe=2),O.morphAttributes.color!==void 0&&(pe=3);let W,K,fe,Se;if($){const bt=sn[$];W=bt.vertexShader,K=bt.fragmentShader}else W=x.vertexShader,K=x.fragmentShader,l.update(x),fe=l.getVertexShaderID(x),Se=l.getFragmentShaderID(x);const xe=i.getRenderTarget(),Ue=ne.isInstancedMesh===!0,Ie=ne.isBatchedMesh===!0,Re=!!x.map,qe=!!x.matcap,B=!!Y,mt=!!x.aoMap,Te=!!x.lightMap,Pe=!!x.bumpMap,_e=!!x.normalMap,tt=!!x.displacementMap,Ne=!!x.emissiveMap,T=!!x.metalnessMap,S=!!x.roughnessMap,z=x.anisotropy>0,te=x.clearcoat>0,J=x.iridescence>0,ee=x.sheen>0,ve=x.transmission>0,de=z&&!!x.anisotropyMap,ge=te&&!!x.clearcoatMap,Ce=te&&!!x.clearcoatNormalMap,Oe=te&&!!x.clearcoatRoughnessMap,Z=J&&!!x.iridescenceMap,Ye=J&&!!x.iridescenceThicknessMap,R=ee&&!!x.sheenColorMap,j=ee&&!!x.sheenRoughnessMap,ue=!!x.specularMap,re=!!x.specularColorMap,Me=!!x.specularIntensityMap,ke=ve&&!!x.transmissionMap,je=ve&&!!x.thicknessMap,Ge=!!x.gradientMap,ce=!!x.alphaMap,P=x.alphaTest>0,oe=!!x.alphaHash,le=!!x.extensions,we=!!O.attributes.uv1,Ee=!!O.attributes.uv2,Ke=!!O.attributes.uv3;let Je=Rn;return x.toneMapped&&(xe===null||xe.isXRRenderTarget===!0)&&(Je=i.toneMapping),{isWebGL2:h,shaderID:$,shaderType:x.type,shaderName:x.name,vertexShader:W,fragmentShader:K,defines:x.defines,customVertexShaderID:fe,customFragmentShaderID:Se,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:f,batching:Ie,instancing:Ue,instancingColor:Ue&&ne.instanceColor!==null,supportsVertexTextures:p,outputColorSpace:xe===null?i.outputColorSpace:xe.isXRRenderTarget===!0?xe.texture.colorSpace:vn,map:Re,matcap:qe,envMap:B,envMapMode:B&&Y.mapping,envMapCubeUVHeight:q,aoMap:mt,lightMap:Te,bumpMap:Pe,normalMap:_e,displacementMap:p&&tt,emissiveMap:Ne,normalMapObjectSpace:_e&&x.normalMapType===Xu,normalMapTangentSpace:_e&&x.normalMapType===Tl,metalnessMap:T,roughnessMap:S,anisotropy:z,anisotropyMap:de,clearcoat:te,clearcoatMap:ge,clearcoatNormalMap:Ce,clearcoatRoughnessMap:Oe,iridescence:J,iridescenceMap:Z,iridescenceThicknessMap:Ye,sheen:ee,sheenColorMap:R,sheenRoughnessMap:j,specularMap:ue,specularColorMap:re,specularIntensityMap:Me,transmission:ve,transmissionMap:ke,thicknessMap:je,gradientMap:Ge,opaque:x.transparent===!1&&x.blending===vi,alphaMap:ce,alphaTest:P,alphaHash:oe,combine:x.combine,mapUv:Re&&_(x.map.channel),aoMapUv:mt&&_(x.aoMap.channel),lightMapUv:Te&&_(x.lightMap.channel),bumpMapUv:Pe&&_(x.bumpMap.channel),normalMapUv:_e&&_(x.normalMap.channel),displacementMapUv:tt&&_(x.displacementMap.channel),emissiveMapUv:Ne&&_(x.emissiveMap.channel),metalnessMapUv:T&&_(x.metalnessMap.channel),roughnessMapUv:S&&_(x.roughnessMap.channel),anisotropyMapUv:de&&_(x.anisotropyMap.channel),clearcoatMapUv:ge&&_(x.clearcoatMap.channel),clearcoatNormalMapUv:Ce&&_(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Oe&&_(x.clearcoatRoughnessMap.channel),iridescenceMapUv:Z&&_(x.iridescenceMap.channel),iridescenceThicknessMapUv:Ye&&_(x.iridescenceThicknessMap.channel),sheenColorMapUv:R&&_(x.sheenColorMap.channel),sheenRoughnessMapUv:j&&_(x.sheenRoughnessMap.channel),specularMapUv:ue&&_(x.specularMap.channel),specularColorMapUv:re&&_(x.specularColorMap.channel),specularIntensityMapUv:Me&&_(x.specularIntensityMap.channel),transmissionMapUv:ke&&_(x.transmissionMap.channel),thicknessMapUv:je&&_(x.thicknessMap.channel),alphaMapUv:ce&&_(x.alphaMap.channel),vertexTangents:!!O.attributes.tangent&&(_e||z),vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!O.attributes.color&&O.attributes.color.itemSize===4,vertexUv1s:we,vertexUv2s:Ee,vertexUv3s:Ke,pointsUvs:ne.isPoints===!0&&!!O.attributes.uv&&(Re||ce),fog:!!D,useFog:x.fog===!0,fogExp2:D&&D.isFogExp2,flatShading:x.flatShading===!0,sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:d,skinning:ne.isSkinnedMesh===!0,morphTargets:O.morphAttributes.position!==void 0,morphNormals:O.morphAttributes.normal!==void 0,morphColors:O.morphAttributes.color!==void 0,morphTargetsCount:ie,morphTextureStride:pe,numDirLights:E.directional.length,numPointLights:E.point.length,numSpotLights:E.spot.length,numSpotLightMaps:E.spotLightMap.length,numRectAreaLights:E.rectArea.length,numHemiLights:E.hemi.length,numDirLightShadows:E.directionalShadowMap.length,numPointLightShadows:E.pointShadowMap.length,numSpotLightShadows:E.spotShadowMap.length,numSpotLightShadowsWithMaps:E.numSpotLightShadowsWithMaps,numLightProbes:E.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:x.dithering,shadowMapEnabled:i.shadowMap.enabled&&F.length>0,shadowMapType:i.shadowMap.type,toneMapping:Je,useLegacyLights:i._useLegacyLights,decodeVideoTexture:Re&&x.map.isVideoTexture===!0&&Qe.getTransfer(x.map.colorSpace)===nt,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===pn,flipSided:x.side===Dt,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionDerivatives:le&&x.extensions.derivatives===!0,extensionFragDepth:le&&x.extensions.fragDepth===!0,extensionDrawBuffers:le&&x.extensions.drawBuffers===!0,extensionShaderTextureLOD:le&&x.extensions.shaderTextureLOD===!0,extensionClipCullDistance:le&&x.extensions.clipCullDistance&&n.has("WEBGL_clip_cull_distance"),rendererExtensionFragDepth:h||n.has("EXT_frag_depth"),rendererExtensionDrawBuffers:h||n.has("WEBGL_draw_buffers"),rendererExtensionShaderTextureLod:h||n.has("EXT_shader_texture_lod"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()}}function u(x){const E=[];if(x.shaderID?E.push(x.shaderID):(E.push(x.customVertexShaderID),E.push(x.customFragmentShaderID)),x.defines!==void 0)for(const F in x.defines)E.push(F),E.push(x.defines[F]);return x.isRawShaderMaterial===!1&&(M(E,x),v(E,x),E.push(i.outputColorSpace)),E.push(x.customProgramCacheKey),E.join()}function M(x,E){x.push(E.precision),x.push(E.outputColorSpace),x.push(E.envMapMode),x.push(E.envMapCubeUVHeight),x.push(E.mapUv),x.push(E.alphaMapUv),x.push(E.lightMapUv),x.push(E.aoMapUv),x.push(E.bumpMapUv),x.push(E.normalMapUv),x.push(E.displacementMapUv),x.push(E.emissiveMapUv),x.push(E.metalnessMapUv),x.push(E.roughnessMapUv),x.push(E.anisotropyMapUv),x.push(E.clearcoatMapUv),x.push(E.clearcoatNormalMapUv),x.push(E.clearcoatRoughnessMapUv),x.push(E.iridescenceMapUv),x.push(E.iridescenceThicknessMapUv),x.push(E.sheenColorMapUv),x.push(E.sheenRoughnessMapUv),x.push(E.specularMapUv),x.push(E.specularColorMapUv),x.push(E.specularIntensityMapUv),x.push(E.transmissionMapUv),x.push(E.thicknessMapUv),x.push(E.combine),x.push(E.fogExp2),x.push(E.sizeAttenuation),x.push(E.morphTargetsCount),x.push(E.morphAttributeCount),x.push(E.numDirLights),x.push(E.numPointLights),x.push(E.numSpotLights),x.push(E.numSpotLightMaps),x.push(E.numHemiLights),x.push(E.numRectAreaLights),x.push(E.numDirLightShadows),x.push(E.numPointLightShadows),x.push(E.numSpotLightShadows),x.push(E.numSpotLightShadowsWithMaps),x.push(E.numLightProbes),x.push(E.shadowMapType),x.push(E.toneMapping),x.push(E.numClippingPlanes),x.push(E.numClipIntersection),x.push(E.depthPacking)}function v(x,E){a.disableAll(),E.isWebGL2&&a.enable(0),E.supportsVertexTextures&&a.enable(1),E.instancing&&a.enable(2),E.instancingColor&&a.enable(3),E.matcap&&a.enable(4),E.envMap&&a.enable(5),E.normalMapObjectSpace&&a.enable(6),E.normalMapTangentSpace&&a.enable(7),E.clearcoat&&a.enable(8),E.iridescence&&a.enable(9),E.alphaTest&&a.enable(10),E.vertexColors&&a.enable(11),E.vertexAlphas&&a.enable(12),E.vertexUv1s&&a.enable(13),E.vertexUv2s&&a.enable(14),E.vertexUv3s&&a.enable(15),E.vertexTangents&&a.enable(16),E.anisotropy&&a.enable(17),E.alphaHash&&a.enable(18),E.batching&&a.enable(19),x.push(a.mask),a.disableAll(),E.fog&&a.enable(0),E.useFog&&a.enable(1),E.flatShading&&a.enable(2),E.logarithmicDepthBuffer&&a.enable(3),E.skinning&&a.enable(4),E.morphTargets&&a.enable(5),E.morphNormals&&a.enable(6),E.morphColors&&a.enable(7),E.premultipliedAlpha&&a.enable(8),E.shadowMapEnabled&&a.enable(9),E.useLegacyLights&&a.enable(10),E.doubleSided&&a.enable(11),E.flipSided&&a.enable(12),E.useDepthPacking&&a.enable(13),E.dithering&&a.enable(14),E.transmission&&a.enable(15),E.sheen&&a.enable(16),E.opaque&&a.enable(17),E.pointsUvs&&a.enable(18),E.decodeVideoTexture&&a.enable(19),x.push(a.mask)}function b(x){const E=g[x.type];let F;if(E){const V=sn[E];F=Il.clone(V.uniforms)}else F=x.uniforms;return F}function C(x,E){let F;for(let V=0,ne=c.length;V<ne;V++){const D=c[V];if(D.cacheKey===E){F=D,++F.usedTimes;break}}return F===void 0&&(F=new Um(i,E,x,r),c.push(F)),F}function w(x){if(--x.usedTimes===0){const E=c.indexOf(x);c[E]=c[c.length-1],c.pop(),x.destroy()}}function A(x){l.remove(x)}function U(){l.dispose()}return{getParameters:m,getProgramCacheKey:u,getUniforms:b,acquireProgram:C,releaseProgram:w,releaseShaderCache:A,programs:c,dispose:U}}function Bm(){let i=new WeakMap;function e(r){let o=i.get(r);return o===void 0&&(o={},i.set(r,o)),o}function t(r){i.delete(r)}function n(r,o,a){i.get(r)[o]=a}function s(){i=new WeakMap}return{get:e,remove:t,update:n,dispose:s}}function zm(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.material.id!==e.material.id?i.material.id-e.material.id:i.z!==e.z?i.z-e.z:i.id-e.id}function Io(i,e){return i.groupOrder!==e.groupOrder?i.groupOrder-e.groupOrder:i.renderOrder!==e.renderOrder?i.renderOrder-e.renderOrder:i.z!==e.z?e.z-i.z:i.id-e.id}function No(){const i=[];let e=0;const t=[],n=[],s=[];function r(){e=0,t.length=0,n.length=0,s.length=0}function o(d,p,f,g,_,m){let u=i[e];return u===void 0?(u={id:d.id,object:d,geometry:p,material:f,groupOrder:g,renderOrder:d.renderOrder,z:_,group:m},i[e]=u):(u.id=d.id,u.object=d,u.geometry=p,u.material=f,u.groupOrder=g,u.renderOrder=d.renderOrder,u.z=_,u.group=m),e++,u}function a(d,p,f,g,_,m){const u=o(d,p,f,g,_,m);f.transmission>0?n.push(u):f.transparent===!0?s.push(u):t.push(u)}function l(d,p,f,g,_,m){const u=o(d,p,f,g,_,m);f.transmission>0?n.unshift(u):f.transparent===!0?s.unshift(u):t.unshift(u)}function c(d,p){t.length>1&&t.sort(d||zm),n.length>1&&n.sort(p||Io),s.length>1&&s.sort(p||Io)}function h(){for(let d=e,p=i.length;d<p;d++){const f=i[d];if(f.id===null)break;f.id=null,f.object=null,f.geometry=null,f.material=null,f.group=null}}return{opaque:t,transmissive:n,transparent:s,init:r,push:a,unshift:l,finish:h,sort:c}}function Gm(){let i=new WeakMap;function e(n,s){const r=i.get(n);let o;return r===void 0?(o=new No,i.set(n,[o])):s>=r.length?(o=new No,r.push(o)):o=r[s],o}function t(){i=new WeakMap}return{get:e,dispose:t}}function Hm(){const i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new I,color:new $e};break;case"SpotLight":t={position:new I,direction:new I,color:new $e,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new I,color:new $e,distance:0,decay:0};break;case"HemisphereLight":t={direction:new I,skyColor:new $e,groundColor:new $e};break;case"RectAreaLight":t={color:new $e,position:new I,halfWidth:new I,halfHeight:new I};break}return i[e.id]=t,t}}}function km(){const i={};return{get:function(e){if(i[e.id]!==void 0)return i[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ae};break;case"SpotLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ae};break;case"PointLight":t={shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ae,shadowCameraNear:1,shadowCameraFar:1e3};break}return i[e.id]=t,t}}}let Vm=0;function Wm(i,e){return(e.castShadow?2:0)-(i.castShadow?2:0)+(e.map?1:0)-(i.map?1:0)}function Xm(i,e){const t=new Hm,n=km(),s={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let h=0;h<9;h++)s.probe.push(new I);const r=new I,o=new dt,a=new dt;function l(h,d){let p=0,f=0,g=0;for(let V=0;V<9;V++)s.probe[V].set(0,0,0);let _=0,m=0,u=0,M=0,v=0,b=0,C=0,w=0,A=0,U=0,x=0;h.sort(Wm);const E=d===!0?Math.PI:1;for(let V=0,ne=h.length;V<ne;V++){const D=h[V],O=D.color,X=D.intensity,Y=D.distance,q=D.shadow&&D.shadow.map?D.shadow.map.texture:null;if(D.isAmbientLight)p+=O.r*X*E,f+=O.g*X*E,g+=O.b*X*E;else if(D.isLightProbe){for(let $=0;$<9;$++)s.probe[$].addScaledVector(D.sh.coefficients[$],X);x++}else if(D.isDirectionalLight){const $=t.get(D);if($.color.copy(D.color).multiplyScalar(D.intensity*E),D.castShadow){const Q=D.shadow,ie=n.get(D);ie.shadowBias=Q.bias,ie.shadowNormalBias=Q.normalBias,ie.shadowRadius=Q.radius,ie.shadowMapSize=Q.mapSize,s.directionalShadow[_]=ie,s.directionalShadowMap[_]=q,s.directionalShadowMatrix[_]=D.shadow.matrix,b++}s.directional[_]=$,_++}else if(D.isSpotLight){const $=t.get(D);$.position.setFromMatrixPosition(D.matrixWorld),$.color.copy(O).multiplyScalar(X*E),$.distance=Y,$.coneCos=Math.cos(D.angle),$.penumbraCos=Math.cos(D.angle*(1-D.penumbra)),$.decay=D.decay,s.spot[u]=$;const Q=D.shadow;if(D.map&&(s.spotLightMap[A]=D.map,A++,Q.updateMatrices(D),D.castShadow&&U++),s.spotLightMatrix[u]=Q.matrix,D.castShadow){const ie=n.get(D);ie.shadowBias=Q.bias,ie.shadowNormalBias=Q.normalBias,ie.shadowRadius=Q.radius,ie.shadowMapSize=Q.mapSize,s.spotShadow[u]=ie,s.spotShadowMap[u]=q,w++}u++}else if(D.isRectAreaLight){const $=t.get(D);$.color.copy(O).multiplyScalar(X),$.halfWidth.set(D.width*.5,0,0),$.halfHeight.set(0,D.height*.5,0),s.rectArea[M]=$,M++}else if(D.isPointLight){const $=t.get(D);if($.color.copy(D.color).multiplyScalar(D.intensity*E),$.distance=D.distance,$.decay=D.decay,D.castShadow){const Q=D.shadow,ie=n.get(D);ie.shadowBias=Q.bias,ie.shadowNormalBias=Q.normalBias,ie.shadowRadius=Q.radius,ie.shadowMapSize=Q.mapSize,ie.shadowCameraNear=Q.camera.near,ie.shadowCameraFar=Q.camera.far,s.pointShadow[m]=ie,s.pointShadowMap[m]=q,s.pointShadowMatrix[m]=D.shadow.matrix,C++}s.point[m]=$,m++}else if(D.isHemisphereLight){const $=t.get(D);$.skyColor.copy(D.color).multiplyScalar(X*E),$.groundColor.copy(D.groundColor).multiplyScalar(X*E),s.hemi[v]=$,v++}}M>0&&(e.isWebGL2?i.has("OES_texture_float_linear")===!0?(s.rectAreaLTC1=he.LTC_FLOAT_1,s.rectAreaLTC2=he.LTC_FLOAT_2):(s.rectAreaLTC1=he.LTC_HALF_1,s.rectAreaLTC2=he.LTC_HALF_2):i.has("OES_texture_float_linear")===!0?(s.rectAreaLTC1=he.LTC_FLOAT_1,s.rectAreaLTC2=he.LTC_FLOAT_2):i.has("OES_texture_half_float_linear")===!0?(s.rectAreaLTC1=he.LTC_HALF_1,s.rectAreaLTC2=he.LTC_HALF_2):console.error("THREE.WebGLRenderer: Unable to use RectAreaLight. Missing WebGL extensions.")),s.ambient[0]=p,s.ambient[1]=f,s.ambient[2]=g;const F=s.hash;(F.directionalLength!==_||F.pointLength!==m||F.spotLength!==u||F.rectAreaLength!==M||F.hemiLength!==v||F.numDirectionalShadows!==b||F.numPointShadows!==C||F.numSpotShadows!==w||F.numSpotMaps!==A||F.numLightProbes!==x)&&(s.directional.length=_,s.spot.length=u,s.rectArea.length=M,s.point.length=m,s.hemi.length=v,s.directionalShadow.length=b,s.directionalShadowMap.length=b,s.pointShadow.length=C,s.pointShadowMap.length=C,s.spotShadow.length=w,s.spotShadowMap.length=w,s.directionalShadowMatrix.length=b,s.pointShadowMatrix.length=C,s.spotLightMatrix.length=w+A-U,s.spotLightMap.length=A,s.numSpotLightShadowsWithMaps=U,s.numLightProbes=x,F.directionalLength=_,F.pointLength=m,F.spotLength=u,F.rectAreaLength=M,F.hemiLength=v,F.numDirectionalShadows=b,F.numPointShadows=C,F.numSpotShadows=w,F.numSpotMaps=A,F.numLightProbes=x,s.version=Vm++)}function c(h,d){let p=0,f=0,g=0,_=0,m=0;const u=d.matrixWorldInverse;for(let M=0,v=h.length;M<v;M++){const b=h[M];if(b.isDirectionalLight){const C=s.directional[p];C.direction.setFromMatrixPosition(b.matrixWorld),r.setFromMatrixPosition(b.target.matrixWorld),C.direction.sub(r),C.direction.transformDirection(u),p++}else if(b.isSpotLight){const C=s.spot[g];C.position.setFromMatrixPosition(b.matrixWorld),C.position.applyMatrix4(u),C.direction.setFromMatrixPosition(b.matrixWorld),r.setFromMatrixPosition(b.target.matrixWorld),C.direction.sub(r),C.direction.transformDirection(u),g++}else if(b.isRectAreaLight){const C=s.rectArea[_];C.position.setFromMatrixPosition(b.matrixWorld),C.position.applyMatrix4(u),a.identity(),o.copy(b.matrixWorld),o.premultiply(u),a.extractRotation(o),C.halfWidth.set(b.width*.5,0,0),C.halfHeight.set(0,b.height*.5,0),C.halfWidth.applyMatrix4(a),C.halfHeight.applyMatrix4(a),_++}else if(b.isPointLight){const C=s.point[f];C.position.setFromMatrixPosition(b.matrixWorld),C.position.applyMatrix4(u),f++}else if(b.isHemisphereLight){const C=s.hemi[m];C.direction.setFromMatrixPosition(b.matrixWorld),C.direction.transformDirection(u),m++}}}return{setup:l,setupView:c,state:s}}function Fo(i,e){const t=new Xm(i,e),n=[],s=[];function r(){n.length=0,s.length=0}function o(d){n.push(d)}function a(d){s.push(d)}function l(d){t.setup(n,d)}function c(d){t.setupView(n,d)}return{init:r,state:{lightsArray:n,shadowsArray:s,lights:t},setupLights:l,setupLightsView:c,pushLight:o,pushShadow:a}}function $m(i,e){let t=new WeakMap;function n(r,o=0){const a=t.get(r);let l;return a===void 0?(l=new Fo(i,e),t.set(r,[l])):o>=a.length?(l=new Fo(i,e),a.push(l)):l=a[o],l}function s(){t=new WeakMap}return{get:n,dispose:s}}class qm extends Vi{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Vu,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class Ym extends Vi{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}const jm=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Km=`uniform sampler2D shadow_pass;
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
}`;function Zm(i,e,t){let n=new Kr;const s=new Ae,r=new Ae,o=new xt,a=new qm({depthPacking:Wu}),l=new Ym,c={},h=t.maxTextureSize,d={[Dn]:Dt,[Dt]:Dn,[pn]:pn},p=new xn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ae},radius:{value:4}},vertexShader:jm,fragmentShader:Km}),f=p.clone();f.defines.HORIZONTAL_PASS=1;const g=new $t;g.setAttribute("position",new an(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const _=new be(g,p),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=hl;let u=this.type;this.render=function(w,A,U){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||w.length===0)return;const x=i.getRenderTarget(),E=i.getActiveCubeFace(),F=i.getActiveMipmapLevel(),V=i.state;V.setBlending(gn),V.buffers.color.setClear(1,1,1,1),V.buffers.depth.setTest(!0),V.setScissorTest(!1);const ne=u!==fn&&this.type===fn,D=u===fn&&this.type!==fn;for(let O=0,X=w.length;O<X;O++){const Y=w[O],q=Y.shadow;if(q===void 0){console.warn("THREE.WebGLShadowMap:",Y,"has no shadow.");continue}if(q.autoUpdate===!1&&q.needsUpdate===!1)continue;s.copy(q.mapSize);const $=q.getFrameExtents();if(s.multiply($),r.copy(q.mapSize),(s.x>h||s.y>h)&&(s.x>h&&(r.x=Math.floor(h/$.x),s.x=r.x*$.x,q.mapSize.x=r.x),s.y>h&&(r.y=Math.floor(h/$.y),s.y=r.y*$.y,q.mapSize.y=r.y)),q.map===null||ne===!0||D===!0){const ie=this.type!==fn?{minFilter:Rt,magFilter:Rt}:{};q.map!==null&&q.map.dispose(),q.map=new Un(s.x,s.y,ie),q.map.texture.name=Y.name+".shadowMap",q.camera.updateProjectionMatrix()}i.setRenderTarget(q.map),i.clear();const Q=q.getViewportCount();for(let ie=0;ie<Q;ie++){const pe=q.getViewport(ie);o.set(r.x*pe.x,r.y*pe.y,r.x*pe.z,r.y*pe.w),V.viewport(o),q.updateMatrices(Y,ie),n=q.getFrustum(),b(A,U,q.camera,Y,this.type)}q.isPointLightShadow!==!0&&this.type===fn&&M(q,U),q.needsUpdate=!1}u=this.type,m.needsUpdate=!1,i.setRenderTarget(x,E,F)};function M(w,A){const U=e.update(_);p.defines.VSM_SAMPLES!==w.blurSamples&&(p.defines.VSM_SAMPLES=w.blurSamples,f.defines.VSM_SAMPLES=w.blurSamples,p.needsUpdate=!0,f.needsUpdate=!0),w.mapPass===null&&(w.mapPass=new Un(s.x,s.y)),p.uniforms.shadow_pass.value=w.map.texture,p.uniforms.resolution.value=w.mapSize,p.uniforms.radius.value=w.radius,i.setRenderTarget(w.mapPass),i.clear(),i.renderBufferDirect(A,null,U,p,_,null),f.uniforms.shadow_pass.value=w.mapPass.texture,f.uniforms.resolution.value=w.mapSize,f.uniforms.radius.value=w.radius,i.setRenderTarget(w.map),i.clear(),i.renderBufferDirect(A,null,U,f,_,null)}function v(w,A,U,x){let E=null;const F=U.isPointLight===!0?w.customDistanceMaterial:w.customDepthMaterial;if(F!==void 0)E=F;else if(E=U.isPointLight===!0?l:a,i.localClippingEnabled&&A.clipShadows===!0&&Array.isArray(A.clippingPlanes)&&A.clippingPlanes.length!==0||A.displacementMap&&A.displacementScale!==0||A.alphaMap&&A.alphaTest>0||A.map&&A.alphaTest>0){const V=E.uuid,ne=A.uuid;let D=c[V];D===void 0&&(D={},c[V]=D);let O=D[ne];O===void 0&&(O=E.clone(),D[ne]=O,A.addEventListener("dispose",C)),E=O}if(E.visible=A.visible,E.wireframe=A.wireframe,x===fn?E.side=A.shadowSide!==null?A.shadowSide:A.side:E.side=A.shadowSide!==null?A.shadowSide:d[A.side],E.alphaMap=A.alphaMap,E.alphaTest=A.alphaTest,E.map=A.map,E.clipShadows=A.clipShadows,E.clippingPlanes=A.clippingPlanes,E.clipIntersection=A.clipIntersection,E.displacementMap=A.displacementMap,E.displacementScale=A.displacementScale,E.displacementBias=A.displacementBias,E.wireframeLinewidth=A.wireframeLinewidth,E.linewidth=A.linewidth,U.isPointLight===!0&&E.isMeshDistanceMaterial===!0){const V=i.properties.get(E);V.light=U}return E}function b(w,A,U,x,E){if(w.visible===!1)return;if(w.layers.test(A.layers)&&(w.isMesh||w.isLine||w.isPoints)&&(w.castShadow||w.receiveShadow&&E===fn)&&(!w.frustumCulled||n.intersectsObject(w))){w.modelViewMatrix.multiplyMatrices(U.matrixWorldInverse,w.matrixWorld);const ne=e.update(w),D=w.material;if(Array.isArray(D)){const O=ne.groups;for(let X=0,Y=O.length;X<Y;X++){const q=O[X],$=D[q.materialIndex];if($&&$.visible){const Q=v(w,$,x,E);w.onBeforeShadow(i,w,A,U,ne,Q,q),i.renderBufferDirect(U,null,ne,Q,w,q),w.onAfterShadow(i,w,A,U,ne,Q,q)}}}else if(D.visible){const O=v(w,D,x,E);w.onBeforeShadow(i,w,A,U,ne,O,null),i.renderBufferDirect(U,null,ne,O,w,null),w.onAfterShadow(i,w,A,U,ne,O,null)}}const V=w.children;for(let ne=0,D=V.length;ne<D;ne++)b(V[ne],A,U,x,E)}function C(w){w.target.removeEventListener("dispose",C);for(const U in c){const x=c[U],E=w.target.uuid;E in x&&(x[E].dispose(),delete x[E])}}}function Jm(i,e,t){const n=t.isWebGL2;function s(){let P=!1;const oe=new xt;let le=null;const we=new xt(0,0,0,0);return{setMask:function(Ee){le!==Ee&&!P&&(i.colorMask(Ee,Ee,Ee,Ee),le=Ee)},setLocked:function(Ee){P=Ee},setClear:function(Ee,Ke,Je,gt,bt){bt===!0&&(Ee*=gt,Ke*=gt,Je*=gt),oe.set(Ee,Ke,Je,gt),we.equals(oe)===!1&&(i.clearColor(Ee,Ke,Je,gt),we.copy(oe))},reset:function(){P=!1,le=null,we.set(-1,0,0,0)}}}function r(){let P=!1,oe=null,le=null,we=null;return{setTest:function(Ee){Ee?Ie(i.DEPTH_TEST):Re(i.DEPTH_TEST)},setMask:function(Ee){oe!==Ee&&!P&&(i.depthMask(Ee),oe=Ee)},setFunc:function(Ee){if(le!==Ee){switch(Ee){case Mu:i.depthFunc(i.NEVER);break;case Su:i.depthFunc(i.ALWAYS);break;case Eu:i.depthFunc(i.LESS);break;case Es:i.depthFunc(i.LEQUAL);break;case yu:i.depthFunc(i.EQUAL);break;case Tu:i.depthFunc(i.GEQUAL);break;case bu:i.depthFunc(i.GREATER);break;case Au:i.depthFunc(i.NOTEQUAL);break;default:i.depthFunc(i.LEQUAL)}le=Ee}},setLocked:function(Ee){P=Ee},setClear:function(Ee){we!==Ee&&(i.clearDepth(Ee),we=Ee)},reset:function(){P=!1,oe=null,le=null,we=null}}}function o(){let P=!1,oe=null,le=null,we=null,Ee=null,Ke=null,Je=null,gt=null,bt=null;return{setTest:function(et){P||(et?Ie(i.STENCIL_TEST):Re(i.STENCIL_TEST))},setMask:function(et){oe!==et&&!P&&(i.stencilMask(et),oe=et)},setFunc:function(et,At,nn){(le!==et||we!==At||Ee!==nn)&&(i.stencilFunc(et,At,nn),le=et,we=At,Ee=nn)},setOp:function(et,At,nn){(Ke!==et||Je!==At||gt!==nn)&&(i.stencilOp(et,At,nn),Ke=et,Je=At,gt=nn)},setLocked:function(et){P=et},setClear:function(et){bt!==et&&(i.clearStencil(et),bt=et)},reset:function(){P=!1,oe=null,le=null,we=null,Ee=null,Ke=null,Je=null,gt=null,bt=null}}}const a=new s,l=new r,c=new o,h=new WeakMap,d=new WeakMap;let p={},f={},g=new WeakMap,_=[],m=null,u=!1,M=null,v=null,b=null,C=null,w=null,A=null,U=null,x=new $e(0,0,0),E=0,F=!1,V=null,ne=null,D=null,O=null,X=null;const Y=i.getParameter(i.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let q=!1,$=0;const Q=i.getParameter(i.VERSION);Q.indexOf("WebGL")!==-1?($=parseFloat(/^WebGL (\d)/.exec(Q)[1]),q=$>=1):Q.indexOf("OpenGL ES")!==-1&&($=parseFloat(/^OpenGL ES (\d)/.exec(Q)[1]),q=$>=2);let ie=null,pe={};const W=i.getParameter(i.SCISSOR_BOX),K=i.getParameter(i.VIEWPORT),fe=new xt().fromArray(W),Se=new xt().fromArray(K);function xe(P,oe,le,we){const Ee=new Uint8Array(4),Ke=i.createTexture();i.bindTexture(P,Ke),i.texParameteri(P,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(P,i.TEXTURE_MAG_FILTER,i.NEAREST);for(let Je=0;Je<le;Je++)n&&(P===i.TEXTURE_3D||P===i.TEXTURE_2D_ARRAY)?i.texImage3D(oe,0,i.RGBA,1,1,we,0,i.RGBA,i.UNSIGNED_BYTE,Ee):i.texImage2D(oe+Je,0,i.RGBA,1,1,0,i.RGBA,i.UNSIGNED_BYTE,Ee);return Ke}const Ue={};Ue[i.TEXTURE_2D]=xe(i.TEXTURE_2D,i.TEXTURE_2D,1),Ue[i.TEXTURE_CUBE_MAP]=xe(i.TEXTURE_CUBE_MAP,i.TEXTURE_CUBE_MAP_POSITIVE_X,6),n&&(Ue[i.TEXTURE_2D_ARRAY]=xe(i.TEXTURE_2D_ARRAY,i.TEXTURE_2D_ARRAY,1,1),Ue[i.TEXTURE_3D]=xe(i.TEXTURE_3D,i.TEXTURE_3D,1,1)),a.setClear(0,0,0,1),l.setClear(1),c.setClear(0),Ie(i.DEPTH_TEST),l.setFunc(Es),Ne(!1),T(ga),Ie(i.CULL_FACE),_e(gn);function Ie(P){p[P]!==!0&&(i.enable(P),p[P]=!0)}function Re(P){p[P]!==!1&&(i.disable(P),p[P]=!1)}function qe(P,oe){return f[P]!==oe?(i.bindFramebuffer(P,oe),f[P]=oe,n&&(P===i.DRAW_FRAMEBUFFER&&(f[i.FRAMEBUFFER]=oe),P===i.FRAMEBUFFER&&(f[i.DRAW_FRAMEBUFFER]=oe)),!0):!1}function B(P,oe){let le=_,we=!1;if(P)if(le=g.get(oe),le===void 0&&(le=[],g.set(oe,le)),P.isWebGLMultipleRenderTargets){const Ee=P.texture;if(le.length!==Ee.length||le[0]!==i.COLOR_ATTACHMENT0){for(let Ke=0,Je=Ee.length;Ke<Je;Ke++)le[Ke]=i.COLOR_ATTACHMENT0+Ke;le.length=Ee.length,we=!0}}else le[0]!==i.COLOR_ATTACHMENT0&&(le[0]=i.COLOR_ATTACHMENT0,we=!0);else le[0]!==i.BACK&&(le[0]=i.BACK,we=!0);we&&(t.isWebGL2?i.drawBuffers(le):e.get("WEBGL_draw_buffers").drawBuffersWEBGL(le))}function mt(P){return m!==P?(i.useProgram(P),m=P,!0):!1}const Te={[Hn]:i.FUNC_ADD,[ru]:i.FUNC_SUBTRACT,[au]:i.FUNC_REVERSE_SUBTRACT};if(n)Te[Ma]=i.MIN,Te[Sa]=i.MAX;else{const P=e.get("EXT_blend_minmax");P!==null&&(Te[Ma]=P.MIN_EXT,Te[Sa]=P.MAX_EXT)}const Pe={[ou]:i.ZERO,[lu]:i.ONE,[cu]:i.SRC_COLOR,[Rr]:i.SRC_ALPHA,[mu]:i.SRC_ALPHA_SATURATE,[fu]:i.DST_COLOR,[hu]:i.DST_ALPHA,[uu]:i.ONE_MINUS_SRC_COLOR,[Cr]:i.ONE_MINUS_SRC_ALPHA,[pu]:i.ONE_MINUS_DST_COLOR,[du]:i.ONE_MINUS_DST_ALPHA,[gu]:i.CONSTANT_COLOR,[_u]:i.ONE_MINUS_CONSTANT_COLOR,[vu]:i.CONSTANT_ALPHA,[xu]:i.ONE_MINUS_CONSTANT_ALPHA};function _e(P,oe,le,we,Ee,Ke,Je,gt,bt,et){if(P===gn){u===!0&&(Re(i.BLEND),u=!1);return}if(u===!1&&(Ie(i.BLEND),u=!0),P!==su){if(P!==M||et!==F){if((v!==Hn||w!==Hn)&&(i.blendEquation(i.FUNC_ADD),v=Hn,w=Hn),et)switch(P){case vi:i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case _a:i.blendFunc(i.ONE,i.ONE);break;case va:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case xa:i.blendFuncSeparate(i.ZERO,i.SRC_COLOR,i.ZERO,i.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",P);break}else switch(P){case vi:i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);break;case _a:i.blendFunc(i.SRC_ALPHA,i.ONE);break;case va:i.blendFuncSeparate(i.ZERO,i.ONE_MINUS_SRC_COLOR,i.ZERO,i.ONE);break;case xa:i.blendFunc(i.ZERO,i.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",P);break}b=null,C=null,A=null,U=null,x.set(0,0,0),E=0,M=P,F=et}return}Ee=Ee||oe,Ke=Ke||le,Je=Je||we,(oe!==v||Ee!==w)&&(i.blendEquationSeparate(Te[oe],Te[Ee]),v=oe,w=Ee),(le!==b||we!==C||Ke!==A||Je!==U)&&(i.blendFuncSeparate(Pe[le],Pe[we],Pe[Ke],Pe[Je]),b=le,C=we,A=Ke,U=Je),(gt.equals(x)===!1||bt!==E)&&(i.blendColor(gt.r,gt.g,gt.b,bt),x.copy(gt),E=bt),M=P,F=!1}function tt(P,oe){P.side===pn?Re(i.CULL_FACE):Ie(i.CULL_FACE);let le=P.side===Dt;oe&&(le=!le),Ne(le),P.blending===vi&&P.transparent===!1?_e(gn):_e(P.blending,P.blendEquation,P.blendSrc,P.blendDst,P.blendEquationAlpha,P.blendSrcAlpha,P.blendDstAlpha,P.blendColor,P.blendAlpha,P.premultipliedAlpha),l.setFunc(P.depthFunc),l.setTest(P.depthTest),l.setMask(P.depthWrite),a.setMask(P.colorWrite);const we=P.stencilWrite;c.setTest(we),we&&(c.setMask(P.stencilWriteMask),c.setFunc(P.stencilFunc,P.stencilRef,P.stencilFuncMask),c.setOp(P.stencilFail,P.stencilZFail,P.stencilZPass)),z(P.polygonOffset,P.polygonOffsetFactor,P.polygonOffsetUnits),P.alphaToCoverage===!0?Ie(i.SAMPLE_ALPHA_TO_COVERAGE):Re(i.SAMPLE_ALPHA_TO_COVERAGE)}function Ne(P){V!==P&&(P?i.frontFace(i.CW):i.frontFace(i.CCW),V=P)}function T(P){P!==nu?(Ie(i.CULL_FACE),P!==ne&&(P===ga?i.cullFace(i.BACK):P===iu?i.cullFace(i.FRONT):i.cullFace(i.FRONT_AND_BACK))):Re(i.CULL_FACE),ne=P}function S(P){P!==D&&(q&&i.lineWidth(P),D=P)}function z(P,oe,le){P?(Ie(i.POLYGON_OFFSET_FILL),(O!==oe||X!==le)&&(i.polygonOffset(oe,le),O=oe,X=le)):Re(i.POLYGON_OFFSET_FILL)}function te(P){P?Ie(i.SCISSOR_TEST):Re(i.SCISSOR_TEST)}function J(P){P===void 0&&(P=i.TEXTURE0+Y-1),ie!==P&&(i.activeTexture(P),ie=P)}function ee(P,oe,le){le===void 0&&(ie===null?le=i.TEXTURE0+Y-1:le=ie);let we=pe[le];we===void 0&&(we={type:void 0,texture:void 0},pe[le]=we),(we.type!==P||we.texture!==oe)&&(ie!==le&&(i.activeTexture(le),ie=le),i.bindTexture(P,oe||Ue[P]),we.type=P,we.texture=oe)}function ve(){const P=pe[ie];P!==void 0&&P.type!==void 0&&(i.bindTexture(P.type,null),P.type=void 0,P.texture=void 0)}function de(){try{i.compressedTexImage2D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function ge(){try{i.compressedTexImage3D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function Ce(){try{i.texSubImage2D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function Oe(){try{i.texSubImage3D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function Z(){try{i.compressedTexSubImage2D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function Ye(){try{i.compressedTexSubImage3D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function R(){try{i.texStorage2D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function j(){try{i.texStorage3D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function ue(){try{i.texImage2D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function re(){try{i.texImage3D.apply(i,arguments)}catch(P){console.error("THREE.WebGLState:",P)}}function Me(P){fe.equals(P)===!1&&(i.scissor(P.x,P.y,P.z,P.w),fe.copy(P))}function ke(P){Se.equals(P)===!1&&(i.viewport(P.x,P.y,P.z,P.w),Se.copy(P))}function je(P,oe){let le=d.get(oe);le===void 0&&(le=new WeakMap,d.set(oe,le));let we=le.get(P);we===void 0&&(we=i.getUniformBlockIndex(oe,P.name),le.set(P,we))}function Ge(P,oe){const we=d.get(oe).get(P);h.get(oe)!==we&&(i.uniformBlockBinding(oe,we,P.__bindingPointIndex),h.set(oe,we))}function ce(){i.disable(i.BLEND),i.disable(i.CULL_FACE),i.disable(i.DEPTH_TEST),i.disable(i.POLYGON_OFFSET_FILL),i.disable(i.SCISSOR_TEST),i.disable(i.STENCIL_TEST),i.disable(i.SAMPLE_ALPHA_TO_COVERAGE),i.blendEquation(i.FUNC_ADD),i.blendFunc(i.ONE,i.ZERO),i.blendFuncSeparate(i.ONE,i.ZERO,i.ONE,i.ZERO),i.blendColor(0,0,0,0),i.colorMask(!0,!0,!0,!0),i.clearColor(0,0,0,0),i.depthMask(!0),i.depthFunc(i.LESS),i.clearDepth(1),i.stencilMask(4294967295),i.stencilFunc(i.ALWAYS,0,4294967295),i.stencilOp(i.KEEP,i.KEEP,i.KEEP),i.clearStencil(0),i.cullFace(i.BACK),i.frontFace(i.CCW),i.polygonOffset(0,0),i.activeTexture(i.TEXTURE0),i.bindFramebuffer(i.FRAMEBUFFER,null),n===!0&&(i.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),i.bindFramebuffer(i.READ_FRAMEBUFFER,null)),i.useProgram(null),i.lineWidth(1),i.scissor(0,0,i.canvas.width,i.canvas.height),i.viewport(0,0,i.canvas.width,i.canvas.height),p={},ie=null,pe={},f={},g=new WeakMap,_=[],m=null,u=!1,M=null,v=null,b=null,C=null,w=null,A=null,U=null,x=new $e(0,0,0),E=0,F=!1,V=null,ne=null,D=null,O=null,X=null,fe.set(0,0,i.canvas.width,i.canvas.height),Se.set(0,0,i.canvas.width,i.canvas.height),a.reset(),l.reset(),c.reset()}return{buffers:{color:a,depth:l,stencil:c},enable:Ie,disable:Re,bindFramebuffer:qe,drawBuffers:B,useProgram:mt,setBlending:_e,setMaterial:tt,setFlipSided:Ne,setCullFace:T,setLineWidth:S,setPolygonOffset:z,setScissorTest:te,activeTexture:J,bindTexture:ee,unbindTexture:ve,compressedTexImage2D:de,compressedTexImage3D:ge,texImage2D:ue,texImage3D:re,updateUBOMapping:je,uniformBlockBinding:Ge,texStorage2D:R,texStorage3D:j,texSubImage2D:Ce,texSubImage3D:Oe,compressedTexSubImage2D:Z,compressedTexSubImage3D:Ye,scissor:Me,viewport:ke,reset:ce}}function Qm(i,e,t,n,s,r,o){const a=s.isWebGL2,l=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,c=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),h=new WeakMap;let d;const p=new WeakMap;let f=!1;try{f=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(T,S){return f?new OffscreenCanvas(T,S):ws("canvas")}function _(T,S,z,te){let J=1;if((T.width>te||T.height>te)&&(J=te/Math.max(T.width,T.height)),J<1||S===!0)if(typeof HTMLImageElement<"u"&&T instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&T instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&T instanceof ImageBitmap){const ee=S?Fr:Math.floor,ve=ee(J*T.width),de=ee(J*T.height);d===void 0&&(d=g(ve,de));const ge=z?g(ve,de):d;return ge.width=ve,ge.height=de,ge.getContext("2d").drawImage(T,0,0,ve,de),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+T.width+"x"+T.height+") to ("+ve+"x"+de+")."),ge}else return"data"in T&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+T.width+"x"+T.height+")."),T;return T}function m(T){return Za(T.width)&&Za(T.height)}function u(T){return a?!1:T.wrapS!==Qt||T.wrapT!==Qt||T.minFilter!==Rt&&T.minFilter!==Ht}function M(T,S){return T.generateMipmaps&&S&&T.minFilter!==Rt&&T.minFilter!==Ht}function v(T){i.generateMipmap(T)}function b(T,S,z,te,J=!1){if(a===!1)return S;if(T!==null){if(i[T]!==void 0)return i[T];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+T+"'")}let ee=S;if(S===i.RED&&(z===i.FLOAT&&(ee=i.R32F),z===i.HALF_FLOAT&&(ee=i.R16F),z===i.UNSIGNED_BYTE&&(ee=i.R8)),S===i.RED_INTEGER&&(z===i.UNSIGNED_BYTE&&(ee=i.R8UI),z===i.UNSIGNED_SHORT&&(ee=i.R16UI),z===i.UNSIGNED_INT&&(ee=i.R32UI),z===i.BYTE&&(ee=i.R8I),z===i.SHORT&&(ee=i.R16I),z===i.INT&&(ee=i.R32I)),S===i.RG&&(z===i.FLOAT&&(ee=i.RG32F),z===i.HALF_FLOAT&&(ee=i.RG16F),z===i.UNSIGNED_BYTE&&(ee=i.RG8)),S===i.RGBA){const ve=J?ys:Qe.getTransfer(te);z===i.FLOAT&&(ee=i.RGBA32F),z===i.HALF_FLOAT&&(ee=i.RGBA16F),z===i.UNSIGNED_BYTE&&(ee=ve===nt?i.SRGB8_ALPHA8:i.RGBA8),z===i.UNSIGNED_SHORT_4_4_4_4&&(ee=i.RGBA4),z===i.UNSIGNED_SHORT_5_5_5_1&&(ee=i.RGB5_A1)}return(ee===i.R16F||ee===i.R32F||ee===i.RG16F||ee===i.RG32F||ee===i.RGBA16F||ee===i.RGBA32F)&&e.get("EXT_color_buffer_float"),ee}function C(T,S,z){return M(T,z)===!0||T.isFramebufferTexture&&T.minFilter!==Rt&&T.minFilter!==Ht?Math.log2(Math.max(S.width,S.height))+1:T.mipmaps!==void 0&&T.mipmaps.length>0?T.mipmaps.length:T.isCompressedTexture&&Array.isArray(T.image)?S.mipmaps.length:1}function w(T){return T===Rt||T===Ea||T===Xs?i.NEAREST:i.LINEAR}function A(T){const S=T.target;S.removeEventListener("dispose",A),x(S),S.isVideoTexture&&h.delete(S)}function U(T){const S=T.target;S.removeEventListener("dispose",U),F(S)}function x(T){const S=n.get(T);if(S.__webglInit===void 0)return;const z=T.source,te=p.get(z);if(te){const J=te[S.__cacheKey];J.usedTimes--,J.usedTimes===0&&E(T),Object.keys(te).length===0&&p.delete(z)}n.remove(T)}function E(T){const S=n.get(T);i.deleteTexture(S.__webglTexture);const z=T.source,te=p.get(z);delete te[S.__cacheKey],o.memory.textures--}function F(T){const S=T.texture,z=n.get(T),te=n.get(S);if(te.__webglTexture!==void 0&&(i.deleteTexture(te.__webglTexture),o.memory.textures--),T.depthTexture&&T.depthTexture.dispose(),T.isWebGLCubeRenderTarget)for(let J=0;J<6;J++){if(Array.isArray(z.__webglFramebuffer[J]))for(let ee=0;ee<z.__webglFramebuffer[J].length;ee++)i.deleteFramebuffer(z.__webglFramebuffer[J][ee]);else i.deleteFramebuffer(z.__webglFramebuffer[J]);z.__webglDepthbuffer&&i.deleteRenderbuffer(z.__webglDepthbuffer[J])}else{if(Array.isArray(z.__webglFramebuffer))for(let J=0;J<z.__webglFramebuffer.length;J++)i.deleteFramebuffer(z.__webglFramebuffer[J]);else i.deleteFramebuffer(z.__webglFramebuffer);if(z.__webglDepthbuffer&&i.deleteRenderbuffer(z.__webglDepthbuffer),z.__webglMultisampledFramebuffer&&i.deleteFramebuffer(z.__webglMultisampledFramebuffer),z.__webglColorRenderbuffer)for(let J=0;J<z.__webglColorRenderbuffer.length;J++)z.__webglColorRenderbuffer[J]&&i.deleteRenderbuffer(z.__webglColorRenderbuffer[J]);z.__webglDepthRenderbuffer&&i.deleteRenderbuffer(z.__webglDepthRenderbuffer)}if(T.isWebGLMultipleRenderTargets)for(let J=0,ee=S.length;J<ee;J++){const ve=n.get(S[J]);ve.__webglTexture&&(i.deleteTexture(ve.__webglTexture),o.memory.textures--),n.remove(S[J])}n.remove(S),n.remove(T)}let V=0;function ne(){V=0}function D(){const T=V;return T>=s.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+T+" texture units while this GPU supports only "+s.maxTextures),V+=1,T}function O(T){const S=[];return S.push(T.wrapS),S.push(T.wrapT),S.push(T.wrapR||0),S.push(T.magFilter),S.push(T.minFilter),S.push(T.anisotropy),S.push(T.internalFormat),S.push(T.format),S.push(T.type),S.push(T.generateMipmaps),S.push(T.premultiplyAlpha),S.push(T.flipY),S.push(T.unpackAlignment),S.push(T.colorSpace),S.join()}function X(T,S){const z=n.get(T);if(T.isVideoTexture&&tt(T),T.isRenderTargetTexture===!1&&T.version>0&&z.__version!==T.version){const te=T.image;if(te===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(te.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{fe(z,T,S);return}}t.bindTexture(i.TEXTURE_2D,z.__webglTexture,i.TEXTURE0+S)}function Y(T,S){const z=n.get(T);if(T.version>0&&z.__version!==T.version){fe(z,T,S);return}t.bindTexture(i.TEXTURE_2D_ARRAY,z.__webglTexture,i.TEXTURE0+S)}function q(T,S){const z=n.get(T);if(T.version>0&&z.__version!==T.version){fe(z,T,S);return}t.bindTexture(i.TEXTURE_3D,z.__webglTexture,i.TEXTURE0+S)}function $(T,S){const z=n.get(T);if(T.version>0&&z.__version!==T.version){Se(z,T,S);return}t.bindTexture(i.TEXTURE_CUBE_MAP,z.__webglTexture,i.TEXTURE0+S)}const Q={[Dr]:i.REPEAT,[Qt]:i.CLAMP_TO_EDGE,[Ur]:i.MIRRORED_REPEAT},ie={[Rt]:i.NEAREST,[Ea]:i.NEAREST_MIPMAP_NEAREST,[Xs]:i.NEAREST_MIPMAP_LINEAR,[Ht]:i.LINEAR,[Iu]:i.LINEAR_MIPMAP_NEAREST,[Bi]:i.LINEAR_MIPMAP_LINEAR},pe={[$u]:i.NEVER,[Ju]:i.ALWAYS,[qu]:i.LESS,[bl]:i.LEQUAL,[Yu]:i.EQUAL,[Zu]:i.GEQUAL,[ju]:i.GREATER,[Ku]:i.NOTEQUAL};function W(T,S,z){if(z?(i.texParameteri(T,i.TEXTURE_WRAP_S,Q[S.wrapS]),i.texParameteri(T,i.TEXTURE_WRAP_T,Q[S.wrapT]),(T===i.TEXTURE_3D||T===i.TEXTURE_2D_ARRAY)&&i.texParameteri(T,i.TEXTURE_WRAP_R,Q[S.wrapR]),i.texParameteri(T,i.TEXTURE_MAG_FILTER,ie[S.magFilter]),i.texParameteri(T,i.TEXTURE_MIN_FILTER,ie[S.minFilter])):(i.texParameteri(T,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(T,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),(T===i.TEXTURE_3D||T===i.TEXTURE_2D_ARRAY)&&i.texParameteri(T,i.TEXTURE_WRAP_R,i.CLAMP_TO_EDGE),(S.wrapS!==Qt||S.wrapT!==Qt)&&console.warn("THREE.WebGLRenderer: Texture is not power of two. Texture.wrapS and Texture.wrapT should be set to THREE.ClampToEdgeWrapping."),i.texParameteri(T,i.TEXTURE_MAG_FILTER,w(S.magFilter)),i.texParameteri(T,i.TEXTURE_MIN_FILTER,w(S.minFilter)),S.minFilter!==Rt&&S.minFilter!==Ht&&console.warn("THREE.WebGLRenderer: Texture is not power of two. Texture.minFilter should be set to THREE.NearestFilter or THREE.LinearFilter.")),S.compareFunction&&(i.texParameteri(T,i.TEXTURE_COMPARE_MODE,i.COMPARE_REF_TO_TEXTURE),i.texParameteri(T,i.TEXTURE_COMPARE_FUNC,pe[S.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){const te=e.get("EXT_texture_filter_anisotropic");if(S.magFilter===Rt||S.minFilter!==Xs&&S.minFilter!==Bi||S.type===wn&&e.has("OES_texture_float_linear")===!1||a===!1&&S.type===yi&&e.has("OES_texture_half_float_linear")===!1)return;(S.anisotropy>1||n.get(S).__currentAnisotropy)&&(i.texParameterf(T,te.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(S.anisotropy,s.getMaxAnisotropy())),n.get(S).__currentAnisotropy=S.anisotropy)}}function K(T,S){let z=!1;T.__webglInit===void 0&&(T.__webglInit=!0,S.addEventListener("dispose",A));const te=S.source;let J=p.get(te);J===void 0&&(J={},p.set(te,J));const ee=O(S);if(ee!==T.__cacheKey){J[ee]===void 0&&(J[ee]={texture:i.createTexture(),usedTimes:0},o.memory.textures++,z=!0),J[ee].usedTimes++;const ve=J[T.__cacheKey];ve!==void 0&&(J[T.__cacheKey].usedTimes--,ve.usedTimes===0&&E(S)),T.__cacheKey=ee,T.__webglTexture=J[ee].texture}return z}function fe(T,S,z){let te=i.TEXTURE_2D;(S.isDataArrayTexture||S.isCompressedArrayTexture)&&(te=i.TEXTURE_2D_ARRAY),S.isData3DTexture&&(te=i.TEXTURE_3D);const J=K(T,S),ee=S.source;t.bindTexture(te,T.__webglTexture,i.TEXTURE0+z);const ve=n.get(ee);if(ee.version!==ve.__version||J===!0){t.activeTexture(i.TEXTURE0+z);const de=Qe.getPrimaries(Qe.workingColorSpace),ge=S.colorSpace===Wt?null:Qe.getPrimaries(S.colorSpace),Ce=S.colorSpace===Wt||de===ge?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,S.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,S.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,S.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,Ce);const Oe=u(S)&&m(S.image)===!1;let Z=_(S.image,Oe,!1,s.maxTextureSize);Z=Ne(S,Z);const Ye=m(Z)||a,R=r.convert(S.format,S.colorSpace);let j=r.convert(S.type),ue=b(S.internalFormat,R,j,S.colorSpace,S.isVideoTexture);W(te,S,Ye);let re;const Me=S.mipmaps,ke=a&&S.isVideoTexture!==!0&&ue!==El,je=ve.__version===void 0||J===!0,Ge=C(S,Z,Ye);if(S.isDepthTexture)ue=i.DEPTH_COMPONENT,a?S.type===wn?ue=i.DEPTH_COMPONENT32F:S.type===An?ue=i.DEPTH_COMPONENT24:S.type===Wn?ue=i.DEPTH24_STENCIL8:ue=i.DEPTH_COMPONENT16:S.type===wn&&console.error("WebGLRenderer: Floating point depth texture requires WebGL2."),S.format===Xn&&ue===i.DEPTH_COMPONENT&&S.type!==Xr&&S.type!==An&&(console.warn("THREE.WebGLRenderer: Use UnsignedShortType or UnsignedIntType for DepthFormat DepthTexture."),S.type=An,j=r.convert(S.type)),S.format===Ti&&ue===i.DEPTH_COMPONENT&&(ue=i.DEPTH_STENCIL,S.type!==Wn&&(console.warn("THREE.WebGLRenderer: Use UnsignedInt248Type for DepthStencilFormat DepthTexture."),S.type=Wn,j=r.convert(S.type))),je&&(ke?t.texStorage2D(i.TEXTURE_2D,1,ue,Z.width,Z.height):t.texImage2D(i.TEXTURE_2D,0,ue,Z.width,Z.height,0,R,j,null));else if(S.isDataTexture)if(Me.length>0&&Ye){ke&&je&&t.texStorage2D(i.TEXTURE_2D,Ge,ue,Me[0].width,Me[0].height);for(let ce=0,P=Me.length;ce<P;ce++)re=Me[ce],ke?t.texSubImage2D(i.TEXTURE_2D,ce,0,0,re.width,re.height,R,j,re.data):t.texImage2D(i.TEXTURE_2D,ce,ue,re.width,re.height,0,R,j,re.data);S.generateMipmaps=!1}else ke?(je&&t.texStorage2D(i.TEXTURE_2D,Ge,ue,Z.width,Z.height),t.texSubImage2D(i.TEXTURE_2D,0,0,0,Z.width,Z.height,R,j,Z.data)):t.texImage2D(i.TEXTURE_2D,0,ue,Z.width,Z.height,0,R,j,Z.data);else if(S.isCompressedTexture)if(S.isCompressedArrayTexture){ke&&je&&t.texStorage3D(i.TEXTURE_2D_ARRAY,Ge,ue,Me[0].width,Me[0].height,Z.depth);for(let ce=0,P=Me.length;ce<P;ce++)re=Me[ce],S.format!==en?R!==null?ke?t.compressedTexSubImage3D(i.TEXTURE_2D_ARRAY,ce,0,0,0,re.width,re.height,Z.depth,R,re.data,0,0):t.compressedTexImage3D(i.TEXTURE_2D_ARRAY,ce,ue,re.width,re.height,Z.depth,0,re.data,0,0):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):ke?t.texSubImage3D(i.TEXTURE_2D_ARRAY,ce,0,0,0,re.width,re.height,Z.depth,R,j,re.data):t.texImage3D(i.TEXTURE_2D_ARRAY,ce,ue,re.width,re.height,Z.depth,0,R,j,re.data)}else{ke&&je&&t.texStorage2D(i.TEXTURE_2D,Ge,ue,Me[0].width,Me[0].height);for(let ce=0,P=Me.length;ce<P;ce++)re=Me[ce],S.format!==en?R!==null?ke?t.compressedTexSubImage2D(i.TEXTURE_2D,ce,0,0,re.width,re.height,R,re.data):t.compressedTexImage2D(i.TEXTURE_2D,ce,ue,re.width,re.height,0,re.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):ke?t.texSubImage2D(i.TEXTURE_2D,ce,0,0,re.width,re.height,R,j,re.data):t.texImage2D(i.TEXTURE_2D,ce,ue,re.width,re.height,0,R,j,re.data)}else if(S.isDataArrayTexture)ke?(je&&t.texStorage3D(i.TEXTURE_2D_ARRAY,Ge,ue,Z.width,Z.height,Z.depth),t.texSubImage3D(i.TEXTURE_2D_ARRAY,0,0,0,0,Z.width,Z.height,Z.depth,R,j,Z.data)):t.texImage3D(i.TEXTURE_2D_ARRAY,0,ue,Z.width,Z.height,Z.depth,0,R,j,Z.data);else if(S.isData3DTexture)ke?(je&&t.texStorage3D(i.TEXTURE_3D,Ge,ue,Z.width,Z.height,Z.depth),t.texSubImage3D(i.TEXTURE_3D,0,0,0,0,Z.width,Z.height,Z.depth,R,j,Z.data)):t.texImage3D(i.TEXTURE_3D,0,ue,Z.width,Z.height,Z.depth,0,R,j,Z.data);else if(S.isFramebufferTexture){if(je)if(ke)t.texStorage2D(i.TEXTURE_2D,Ge,ue,Z.width,Z.height);else{let ce=Z.width,P=Z.height;for(let oe=0;oe<Ge;oe++)t.texImage2D(i.TEXTURE_2D,oe,ue,ce,P,0,R,j,null),ce>>=1,P>>=1}}else if(Me.length>0&&Ye){ke&&je&&t.texStorage2D(i.TEXTURE_2D,Ge,ue,Me[0].width,Me[0].height);for(let ce=0,P=Me.length;ce<P;ce++)re=Me[ce],ke?t.texSubImage2D(i.TEXTURE_2D,ce,0,0,R,j,re):t.texImage2D(i.TEXTURE_2D,ce,ue,R,j,re);S.generateMipmaps=!1}else ke?(je&&t.texStorage2D(i.TEXTURE_2D,Ge,ue,Z.width,Z.height),t.texSubImage2D(i.TEXTURE_2D,0,0,0,R,j,Z)):t.texImage2D(i.TEXTURE_2D,0,ue,R,j,Z);M(S,Ye)&&v(te),ve.__version=ee.version,S.onUpdate&&S.onUpdate(S)}T.__version=S.version}function Se(T,S,z){if(S.image.length!==6)return;const te=K(T,S),J=S.source;t.bindTexture(i.TEXTURE_CUBE_MAP,T.__webglTexture,i.TEXTURE0+z);const ee=n.get(J);if(J.version!==ee.__version||te===!0){t.activeTexture(i.TEXTURE0+z);const ve=Qe.getPrimaries(Qe.workingColorSpace),de=S.colorSpace===Wt?null:Qe.getPrimaries(S.colorSpace),ge=S.colorSpace===Wt||ve===de?i.NONE:i.BROWSER_DEFAULT_WEBGL;i.pixelStorei(i.UNPACK_FLIP_Y_WEBGL,S.flipY),i.pixelStorei(i.UNPACK_PREMULTIPLY_ALPHA_WEBGL,S.premultiplyAlpha),i.pixelStorei(i.UNPACK_ALIGNMENT,S.unpackAlignment),i.pixelStorei(i.UNPACK_COLORSPACE_CONVERSION_WEBGL,ge);const Ce=S.isCompressedTexture||S.image[0].isCompressedTexture,Oe=S.image[0]&&S.image[0].isDataTexture,Z=[];for(let ce=0;ce<6;ce++)!Ce&&!Oe?Z[ce]=_(S.image[ce],!1,!0,s.maxCubemapSize):Z[ce]=Oe?S.image[ce].image:S.image[ce],Z[ce]=Ne(S,Z[ce]);const Ye=Z[0],R=m(Ye)||a,j=r.convert(S.format,S.colorSpace),ue=r.convert(S.type),re=b(S.internalFormat,j,ue,S.colorSpace),Me=a&&S.isVideoTexture!==!0,ke=ee.__version===void 0||te===!0;let je=C(S,Ye,R);W(i.TEXTURE_CUBE_MAP,S,R);let Ge;if(Ce){Me&&ke&&t.texStorage2D(i.TEXTURE_CUBE_MAP,je,re,Ye.width,Ye.height);for(let ce=0;ce<6;ce++){Ge=Z[ce].mipmaps;for(let P=0;P<Ge.length;P++){const oe=Ge[P];S.format!==en?j!==null?Me?t.compressedTexSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P,0,0,oe.width,oe.height,j,oe.data):t.compressedTexImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P,re,oe.width,oe.height,0,oe.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Me?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P,0,0,oe.width,oe.height,j,ue,oe.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P,re,oe.width,oe.height,0,j,ue,oe.data)}}}else{Ge=S.mipmaps,Me&&ke&&(Ge.length>0&&je++,t.texStorage2D(i.TEXTURE_CUBE_MAP,je,re,Z[0].width,Z[0].height));for(let ce=0;ce<6;ce++)if(Oe){Me?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,0,0,0,Z[ce].width,Z[ce].height,j,ue,Z[ce].data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,0,re,Z[ce].width,Z[ce].height,0,j,ue,Z[ce].data);for(let P=0;P<Ge.length;P++){const le=Ge[P].image[ce].image;Me?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P+1,0,0,le.width,le.height,j,ue,le.data):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P+1,re,le.width,le.height,0,j,ue,le.data)}}else{Me?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,0,0,0,j,ue,Z[ce]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,0,re,j,ue,Z[ce]);for(let P=0;P<Ge.length;P++){const oe=Ge[P];Me?t.texSubImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P+1,0,0,j,ue,oe.image[ce]):t.texImage2D(i.TEXTURE_CUBE_MAP_POSITIVE_X+ce,P+1,re,j,ue,oe.image[ce])}}}M(S,R)&&v(i.TEXTURE_CUBE_MAP),ee.__version=J.version,S.onUpdate&&S.onUpdate(S)}T.__version=S.version}function xe(T,S,z,te,J,ee){const ve=r.convert(z.format,z.colorSpace),de=r.convert(z.type),ge=b(z.internalFormat,ve,de,z.colorSpace);if(!n.get(S).__hasExternalTextures){const Oe=Math.max(1,S.width>>ee),Z=Math.max(1,S.height>>ee);J===i.TEXTURE_3D||J===i.TEXTURE_2D_ARRAY?t.texImage3D(J,ee,ge,Oe,Z,S.depth,0,ve,de,null):t.texImage2D(J,ee,ge,Oe,Z,0,ve,de,null)}t.bindFramebuffer(i.FRAMEBUFFER,T),_e(S)?l.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,te,J,n.get(z).__webglTexture,0,Pe(S)):(J===i.TEXTURE_2D||J>=i.TEXTURE_CUBE_MAP_POSITIVE_X&&J<=i.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&i.framebufferTexture2D(i.FRAMEBUFFER,te,J,n.get(z).__webglTexture,ee),t.bindFramebuffer(i.FRAMEBUFFER,null)}function Ue(T,S,z){if(i.bindRenderbuffer(i.RENDERBUFFER,T),S.depthBuffer&&!S.stencilBuffer){let te=a===!0?i.DEPTH_COMPONENT24:i.DEPTH_COMPONENT16;if(z||_e(S)){const J=S.depthTexture;J&&J.isDepthTexture&&(J.type===wn?te=i.DEPTH_COMPONENT32F:J.type===An&&(te=i.DEPTH_COMPONENT24));const ee=Pe(S);_e(S)?l.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,ee,te,S.width,S.height):i.renderbufferStorageMultisample(i.RENDERBUFFER,ee,te,S.width,S.height)}else i.renderbufferStorage(i.RENDERBUFFER,te,S.width,S.height);i.framebufferRenderbuffer(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.RENDERBUFFER,T)}else if(S.depthBuffer&&S.stencilBuffer){const te=Pe(S);z&&_e(S)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,te,i.DEPTH24_STENCIL8,S.width,S.height):_e(S)?l.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,te,i.DEPTH24_STENCIL8,S.width,S.height):i.renderbufferStorage(i.RENDERBUFFER,i.DEPTH_STENCIL,S.width,S.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.RENDERBUFFER,T)}else{const te=S.isWebGLMultipleRenderTargets===!0?S.texture:[S.texture];for(let J=0;J<te.length;J++){const ee=te[J],ve=r.convert(ee.format,ee.colorSpace),de=r.convert(ee.type),ge=b(ee.internalFormat,ve,de,ee.colorSpace),Ce=Pe(S);z&&_e(S)===!1?i.renderbufferStorageMultisample(i.RENDERBUFFER,Ce,ge,S.width,S.height):_e(S)?l.renderbufferStorageMultisampleEXT(i.RENDERBUFFER,Ce,ge,S.width,S.height):i.renderbufferStorage(i.RENDERBUFFER,ge,S.width,S.height)}}i.bindRenderbuffer(i.RENDERBUFFER,null)}function Ie(T,S){if(S&&S.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(i.FRAMEBUFFER,T),!(S.depthTexture&&S.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");(!n.get(S.depthTexture).__webglTexture||S.depthTexture.image.width!==S.width||S.depthTexture.image.height!==S.height)&&(S.depthTexture.image.width=S.width,S.depthTexture.image.height=S.height,S.depthTexture.needsUpdate=!0),X(S.depthTexture,0);const te=n.get(S.depthTexture).__webglTexture,J=Pe(S);if(S.depthTexture.format===Xn)_e(S)?l.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,te,0,J):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_ATTACHMENT,i.TEXTURE_2D,te,0);else if(S.depthTexture.format===Ti)_e(S)?l.framebufferTexture2DMultisampleEXT(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,te,0,J):i.framebufferTexture2D(i.FRAMEBUFFER,i.DEPTH_STENCIL_ATTACHMENT,i.TEXTURE_2D,te,0);else throw new Error("Unknown depthTexture format")}function Re(T){const S=n.get(T),z=T.isWebGLCubeRenderTarget===!0;if(T.depthTexture&&!S.__autoAllocateDepthBuffer){if(z)throw new Error("target.depthTexture not supported in Cube render targets");Ie(S.__webglFramebuffer,T)}else if(z){S.__webglDepthbuffer=[];for(let te=0;te<6;te++)t.bindFramebuffer(i.FRAMEBUFFER,S.__webglFramebuffer[te]),S.__webglDepthbuffer[te]=i.createRenderbuffer(),Ue(S.__webglDepthbuffer[te],T,!1)}else t.bindFramebuffer(i.FRAMEBUFFER,S.__webglFramebuffer),S.__webglDepthbuffer=i.createRenderbuffer(),Ue(S.__webglDepthbuffer,T,!1);t.bindFramebuffer(i.FRAMEBUFFER,null)}function qe(T,S,z){const te=n.get(T);S!==void 0&&xe(te.__webglFramebuffer,T,T.texture,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,0),z!==void 0&&Re(T)}function B(T){const S=T.texture,z=n.get(T),te=n.get(S);T.addEventListener("dispose",U),T.isWebGLMultipleRenderTargets!==!0&&(te.__webglTexture===void 0&&(te.__webglTexture=i.createTexture()),te.__version=S.version,o.memory.textures++);const J=T.isWebGLCubeRenderTarget===!0,ee=T.isWebGLMultipleRenderTargets===!0,ve=m(T)||a;if(J){z.__webglFramebuffer=[];for(let de=0;de<6;de++)if(a&&S.mipmaps&&S.mipmaps.length>0){z.__webglFramebuffer[de]=[];for(let ge=0;ge<S.mipmaps.length;ge++)z.__webglFramebuffer[de][ge]=i.createFramebuffer()}else z.__webglFramebuffer[de]=i.createFramebuffer()}else{if(a&&S.mipmaps&&S.mipmaps.length>0){z.__webglFramebuffer=[];for(let de=0;de<S.mipmaps.length;de++)z.__webglFramebuffer[de]=i.createFramebuffer()}else z.__webglFramebuffer=i.createFramebuffer();if(ee)if(s.drawBuffers){const de=T.texture;for(let ge=0,Ce=de.length;ge<Ce;ge++){const Oe=n.get(de[ge]);Oe.__webglTexture===void 0&&(Oe.__webglTexture=i.createTexture(),o.memory.textures++)}}else console.warn("THREE.WebGLRenderer: WebGLMultipleRenderTargets can only be used with WebGL2 or WEBGL_draw_buffers extension.");if(a&&T.samples>0&&_e(T)===!1){const de=ee?S:[S];z.__webglMultisampledFramebuffer=i.createFramebuffer(),z.__webglColorRenderbuffer=[],t.bindFramebuffer(i.FRAMEBUFFER,z.__webglMultisampledFramebuffer);for(let ge=0;ge<de.length;ge++){const Ce=de[ge];z.__webglColorRenderbuffer[ge]=i.createRenderbuffer(),i.bindRenderbuffer(i.RENDERBUFFER,z.__webglColorRenderbuffer[ge]);const Oe=r.convert(Ce.format,Ce.colorSpace),Z=r.convert(Ce.type),Ye=b(Ce.internalFormat,Oe,Z,Ce.colorSpace,T.isXRRenderTarget===!0),R=Pe(T);i.renderbufferStorageMultisample(i.RENDERBUFFER,R,Ye,T.width,T.height),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+ge,i.RENDERBUFFER,z.__webglColorRenderbuffer[ge])}i.bindRenderbuffer(i.RENDERBUFFER,null),T.depthBuffer&&(z.__webglDepthRenderbuffer=i.createRenderbuffer(),Ue(z.__webglDepthRenderbuffer,T,!0)),t.bindFramebuffer(i.FRAMEBUFFER,null)}}if(J){t.bindTexture(i.TEXTURE_CUBE_MAP,te.__webglTexture),W(i.TEXTURE_CUBE_MAP,S,ve);for(let de=0;de<6;de++)if(a&&S.mipmaps&&S.mipmaps.length>0)for(let ge=0;ge<S.mipmaps.length;ge++)xe(z.__webglFramebuffer[de][ge],T,S,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+de,ge);else xe(z.__webglFramebuffer[de],T,S,i.COLOR_ATTACHMENT0,i.TEXTURE_CUBE_MAP_POSITIVE_X+de,0);M(S,ve)&&v(i.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(ee){const de=T.texture;for(let ge=0,Ce=de.length;ge<Ce;ge++){const Oe=de[ge],Z=n.get(Oe);t.bindTexture(i.TEXTURE_2D,Z.__webglTexture),W(i.TEXTURE_2D,Oe,ve),xe(z.__webglFramebuffer,T,Oe,i.COLOR_ATTACHMENT0+ge,i.TEXTURE_2D,0),M(Oe,ve)&&v(i.TEXTURE_2D)}t.unbindTexture()}else{let de=i.TEXTURE_2D;if((T.isWebGL3DRenderTarget||T.isWebGLArrayRenderTarget)&&(a?de=T.isWebGL3DRenderTarget?i.TEXTURE_3D:i.TEXTURE_2D_ARRAY:console.error("THREE.WebGLTextures: THREE.Data3DTexture and THREE.DataArrayTexture only supported with WebGL2.")),t.bindTexture(de,te.__webglTexture),W(de,S,ve),a&&S.mipmaps&&S.mipmaps.length>0)for(let ge=0;ge<S.mipmaps.length;ge++)xe(z.__webglFramebuffer[ge],T,S,i.COLOR_ATTACHMENT0,de,ge);else xe(z.__webglFramebuffer,T,S,i.COLOR_ATTACHMENT0,de,0);M(S,ve)&&v(de),t.unbindTexture()}T.depthBuffer&&Re(T)}function mt(T){const S=m(T)||a,z=T.isWebGLMultipleRenderTargets===!0?T.texture:[T.texture];for(let te=0,J=z.length;te<J;te++){const ee=z[te];if(M(ee,S)){const ve=T.isWebGLCubeRenderTarget?i.TEXTURE_CUBE_MAP:i.TEXTURE_2D,de=n.get(ee).__webglTexture;t.bindTexture(ve,de),v(ve),t.unbindTexture()}}}function Te(T){if(a&&T.samples>0&&_e(T)===!1){const S=T.isWebGLMultipleRenderTargets?T.texture:[T.texture],z=T.width,te=T.height;let J=i.COLOR_BUFFER_BIT;const ee=[],ve=T.stencilBuffer?i.DEPTH_STENCIL_ATTACHMENT:i.DEPTH_ATTACHMENT,de=n.get(T),ge=T.isWebGLMultipleRenderTargets===!0;if(ge)for(let Ce=0;Ce<S.length;Ce++)t.bindFramebuffer(i.FRAMEBUFFER,de.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ce,i.RENDERBUFFER,null),t.bindFramebuffer(i.FRAMEBUFFER,de.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ce,i.TEXTURE_2D,null,0);t.bindFramebuffer(i.READ_FRAMEBUFFER,de.__webglMultisampledFramebuffer),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,de.__webglFramebuffer);for(let Ce=0;Ce<S.length;Ce++){ee.push(i.COLOR_ATTACHMENT0+Ce),T.depthBuffer&&ee.push(ve);const Oe=de.__ignoreDepthValues!==void 0?de.__ignoreDepthValues:!1;if(Oe===!1&&(T.depthBuffer&&(J|=i.DEPTH_BUFFER_BIT),T.stencilBuffer&&(J|=i.STENCIL_BUFFER_BIT)),ge&&i.framebufferRenderbuffer(i.READ_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.RENDERBUFFER,de.__webglColorRenderbuffer[Ce]),Oe===!0&&(i.invalidateFramebuffer(i.READ_FRAMEBUFFER,[ve]),i.invalidateFramebuffer(i.DRAW_FRAMEBUFFER,[ve])),ge){const Z=n.get(S[Ce]).__webglTexture;i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,Z,0)}i.blitFramebuffer(0,0,z,te,0,0,z,te,J,i.NEAREST),c&&i.invalidateFramebuffer(i.READ_FRAMEBUFFER,ee)}if(t.bindFramebuffer(i.READ_FRAMEBUFFER,null),t.bindFramebuffer(i.DRAW_FRAMEBUFFER,null),ge)for(let Ce=0;Ce<S.length;Ce++){t.bindFramebuffer(i.FRAMEBUFFER,de.__webglMultisampledFramebuffer),i.framebufferRenderbuffer(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ce,i.RENDERBUFFER,de.__webglColorRenderbuffer[Ce]);const Oe=n.get(S[Ce]).__webglTexture;t.bindFramebuffer(i.FRAMEBUFFER,de.__webglFramebuffer),i.framebufferTexture2D(i.DRAW_FRAMEBUFFER,i.COLOR_ATTACHMENT0+Ce,i.TEXTURE_2D,Oe,0)}t.bindFramebuffer(i.DRAW_FRAMEBUFFER,de.__webglMultisampledFramebuffer)}}function Pe(T){return Math.min(s.maxSamples,T.samples)}function _e(T){const S=n.get(T);return a&&T.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&S.__useRenderToTexture!==!1}function tt(T){const S=o.render.frame;h.get(T)!==S&&(h.set(T,S),T.update())}function Ne(T,S){const z=T.colorSpace,te=T.format,J=T.type;return T.isCompressedTexture===!0||T.isVideoTexture===!0||T.format===Ir||z!==vn&&z!==Wt&&(Qe.getTransfer(z)===nt?a===!1?e.has("EXT_sRGB")===!0&&te===en?(T.format=Ir,T.minFilter=Ht,T.generateMipmaps=!1):S=wl.sRGBToLinear(S):(te!==en||J!==Cn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",z)),S}this.allocateTextureUnit=D,this.resetTextureUnits=ne,this.setTexture2D=X,this.setTexture2DArray=Y,this.setTexture3D=q,this.setTextureCube=$,this.rebindTextures=qe,this.setupRenderTarget=B,this.updateRenderTargetMipmap=mt,this.updateMultisampleRenderTarget=Te,this.setupDepthRenderbuffer=Re,this.setupFrameBufferTexture=xe,this.useMultisampledRTT=_e}function eg(i,e,t){const n=t.isWebGL2;function s(r,o=Wt){let a;const l=Qe.getTransfer(o);if(r===Cn)return i.UNSIGNED_BYTE;if(r===_l)return i.UNSIGNED_SHORT_4_4_4_4;if(r===vl)return i.UNSIGNED_SHORT_5_5_5_1;if(r===Nu)return i.BYTE;if(r===Fu)return i.SHORT;if(r===Xr)return i.UNSIGNED_SHORT;if(r===gl)return i.INT;if(r===An)return i.UNSIGNED_INT;if(r===wn)return i.FLOAT;if(r===yi)return n?i.HALF_FLOAT:(a=e.get("OES_texture_half_float"),a!==null?a.HALF_FLOAT_OES:null);if(r===Ou)return i.ALPHA;if(r===en)return i.RGBA;if(r===Bu)return i.LUMINANCE;if(r===zu)return i.LUMINANCE_ALPHA;if(r===Xn)return i.DEPTH_COMPONENT;if(r===Ti)return i.DEPTH_STENCIL;if(r===Ir)return a=e.get("EXT_sRGB"),a!==null?a.SRGB_ALPHA_EXT:null;if(r===Gu)return i.RED;if(r===xl)return i.RED_INTEGER;if(r===Hu)return i.RG;if(r===Ml)return i.RG_INTEGER;if(r===Sl)return i.RGBA_INTEGER;if(r===$s||r===qs||r===Ys||r===js)if(l===nt)if(a=e.get("WEBGL_compressed_texture_s3tc_srgb"),a!==null){if(r===$s)return a.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(r===qs)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(r===Ys)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(r===js)return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(a=e.get("WEBGL_compressed_texture_s3tc"),a!==null){if(r===$s)return a.COMPRESSED_RGB_S3TC_DXT1_EXT;if(r===qs)return a.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(r===Ys)return a.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(r===js)return a.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(r===ya||r===Ta||r===ba||r===Aa)if(a=e.get("WEBGL_compressed_texture_pvrtc"),a!==null){if(r===ya)return a.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(r===Ta)return a.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(r===ba)return a.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(r===Aa)return a.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(r===El)return a=e.get("WEBGL_compressed_texture_etc1"),a!==null?a.COMPRESSED_RGB_ETC1_WEBGL:null;if(r===wa||r===Ra)if(a=e.get("WEBGL_compressed_texture_etc"),a!==null){if(r===wa)return l===nt?a.COMPRESSED_SRGB8_ETC2:a.COMPRESSED_RGB8_ETC2;if(r===Ra)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:a.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(r===Ca||r===La||r===Pa||r===Da||r===Ua||r===Ia||r===Na||r===Fa||r===Oa||r===Ba||r===za||r===Ga||r===Ha||r===ka)if(a=e.get("WEBGL_compressed_texture_astc"),a!==null){if(r===Ca)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:a.COMPRESSED_RGBA_ASTC_4x4_KHR;if(r===La)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:a.COMPRESSED_RGBA_ASTC_5x4_KHR;if(r===Pa)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:a.COMPRESSED_RGBA_ASTC_5x5_KHR;if(r===Da)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:a.COMPRESSED_RGBA_ASTC_6x5_KHR;if(r===Ua)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:a.COMPRESSED_RGBA_ASTC_6x6_KHR;if(r===Ia)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:a.COMPRESSED_RGBA_ASTC_8x5_KHR;if(r===Na)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:a.COMPRESSED_RGBA_ASTC_8x6_KHR;if(r===Fa)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:a.COMPRESSED_RGBA_ASTC_8x8_KHR;if(r===Oa)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:a.COMPRESSED_RGBA_ASTC_10x5_KHR;if(r===Ba)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:a.COMPRESSED_RGBA_ASTC_10x6_KHR;if(r===za)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:a.COMPRESSED_RGBA_ASTC_10x8_KHR;if(r===Ga)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:a.COMPRESSED_RGBA_ASTC_10x10_KHR;if(r===Ha)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:a.COMPRESSED_RGBA_ASTC_12x10_KHR;if(r===ka)return l===nt?a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:a.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(r===Ks||r===Va||r===Wa)if(a=e.get("EXT_texture_compression_bptc"),a!==null){if(r===Ks)return l===nt?a.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:a.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(r===Va)return a.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(r===Wa)return a.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(r===ku||r===Xa||r===$a||r===qa)if(a=e.get("EXT_texture_compression_rgtc"),a!==null){if(r===Ks)return a.COMPRESSED_RED_RGTC1_EXT;if(r===Xa)return a.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(r===$a)return a.COMPRESSED_RED_GREEN_RGTC2_EXT;if(r===qa)return a.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return r===Wn?n?i.UNSIGNED_INT_24_8:(a=e.get("WEBGL_depth_texture"),a!==null?a.UNSIGNED_INT_24_8_WEBGL:null):i[r]!==void 0?i[r]:null}return{convert:s}}class tg extends Jt{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}}class Ft extends St{constructor(){super(),this.isGroup=!0,this.type="Group"}}const ng={type:"move"};class Mr{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Ft,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Ft,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new I,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new I),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Ft,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new I,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new I),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const t=this._hand;if(t)for(const n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let s=null,r=null,o=null;const a=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){o=!0;for(const _ of e.hand.values()){const m=t.getJointPose(_,n),u=this._getHandJoint(c,_);m!==null&&(u.matrix.fromArray(m.transform.matrix),u.matrix.decompose(u.position,u.rotation,u.scale),u.matrixWorldNeedsUpdate=!0,u.jointRadius=m.radius),u.visible=m!==null}const h=c.joints["index-finger-tip"],d=c.joints["thumb-tip"],p=h.position.distanceTo(d.position),f=.02,g=.005;c.inputState.pinching&&p>f+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&p<=f-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));a!==null&&(s=t.getPose(e.targetRaySpace,n),s===null&&r!==null&&(s=r),s!==null&&(a.matrix.fromArray(s.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,s.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(s.linearVelocity)):a.hasLinearVelocity=!1,s.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(s.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(ng)))}return a!==null&&(a.visible=s!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){const n=new Ft;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}}class ig extends Zn{constructor(e,t){super();const n=this;let s=null,r=1,o=null,a="local-floor",l=1,c=null,h=null,d=null,p=null,f=null,g=null;const _=t.getContextAttributes();let m=null,u=null;const M=[],v=[],b=new Ae;let C=null;const w=new Jt;w.layers.enable(1),w.viewport=new xt;const A=new Jt;A.layers.enable(2),A.viewport=new xt;const U=[w,A],x=new tg;x.layers.enable(1),x.layers.enable(2);let E=null,F=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(W){let K=M[W];return K===void 0&&(K=new Mr,M[W]=K),K.getTargetRaySpace()},this.getControllerGrip=function(W){let K=M[W];return K===void 0&&(K=new Mr,M[W]=K),K.getGripSpace()},this.getHand=function(W){let K=M[W];return K===void 0&&(K=new Mr,M[W]=K),K.getHandSpace()};function V(W){const K=v.indexOf(W.inputSource);if(K===-1)return;const fe=M[K];fe!==void 0&&(fe.update(W.inputSource,W.frame,c||o),fe.dispatchEvent({type:W.type,data:W.inputSource}))}function ne(){s.removeEventListener("select",V),s.removeEventListener("selectstart",V),s.removeEventListener("selectend",V),s.removeEventListener("squeeze",V),s.removeEventListener("squeezestart",V),s.removeEventListener("squeezeend",V),s.removeEventListener("end",ne),s.removeEventListener("inputsourceschange",D);for(let W=0;W<M.length;W++){const K=v[W];K!==null&&(v[W]=null,M[W].disconnect(K))}E=null,F=null,e.setRenderTarget(m),f=null,p=null,d=null,s=null,u=null,pe.stop(),n.isPresenting=!1,e.setPixelRatio(C),e.setSize(b.width,b.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(W){r=W,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(W){a=W,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||o},this.setReferenceSpace=function(W){c=W},this.getBaseLayer=function(){return p!==null?p:f},this.getBinding=function(){return d},this.getFrame=function(){return g},this.getSession=function(){return s},this.setSession=async function(W){if(s=W,s!==null){if(m=e.getRenderTarget(),s.addEventListener("select",V),s.addEventListener("selectstart",V),s.addEventListener("selectend",V),s.addEventListener("squeeze",V),s.addEventListener("squeezestart",V),s.addEventListener("squeezeend",V),s.addEventListener("end",ne),s.addEventListener("inputsourceschange",D),_.xrCompatible!==!0&&await t.makeXRCompatible(),C=e.getPixelRatio(),e.getSize(b),s.renderState.layers===void 0||e.capabilities.isWebGL2===!1){const K={antialias:s.renderState.layers===void 0?_.antialias:!0,alpha:!0,depth:_.depth,stencil:_.stencil,framebufferScaleFactor:r};f=new XRWebGLLayer(s,t,K),s.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),u=new Un(f.framebufferWidth,f.framebufferHeight,{format:en,type:Cn,colorSpace:e.outputColorSpace,stencilBuffer:_.stencil})}else{let K=null,fe=null,Se=null;_.depth&&(Se=_.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,K=_.stencil?Ti:Xn,fe=_.stencil?Wn:An);const xe={colorFormat:t.RGBA8,depthFormat:Se,scaleFactor:r};d=new XRWebGLBinding(s,t),p=d.createProjectionLayer(xe),s.updateRenderState({layers:[p]}),e.setPixelRatio(1),e.setSize(p.textureWidth,p.textureHeight,!1),u=new Un(p.textureWidth,p.textureHeight,{format:en,type:Cn,depthTexture:new Bl(p.textureWidth,p.textureHeight,fe,void 0,void 0,void 0,void 0,void 0,void 0,K),stencilBuffer:_.stencil,colorSpace:e.outputColorSpace,samples:_.antialias?4:0});const Ue=e.properties.get(u);Ue.__ignoreDepthValues=p.ignoreDepthValues}u.isXRRenderTarget=!0,this.setFoveation(l),c=null,o=await s.requestReferenceSpace(a),pe.setContext(s),pe.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(s!==null)return s.environmentBlendMode};function D(W){for(let K=0;K<W.removed.length;K++){const fe=W.removed[K],Se=v.indexOf(fe);Se>=0&&(v[Se]=null,M[Se].disconnect(fe))}for(let K=0;K<W.added.length;K++){const fe=W.added[K];let Se=v.indexOf(fe);if(Se===-1){for(let Ue=0;Ue<M.length;Ue++)if(Ue>=v.length){v.push(fe),Se=Ue;break}else if(v[Ue]===null){v[Ue]=fe,Se=Ue;break}if(Se===-1)break}const xe=M[Se];xe&&xe.connect(fe)}}const O=new I,X=new I;function Y(W,K,fe){O.setFromMatrixPosition(K.matrixWorld),X.setFromMatrixPosition(fe.matrixWorld);const Se=O.distanceTo(X),xe=K.projectionMatrix.elements,Ue=fe.projectionMatrix.elements,Ie=xe[14]/(xe[10]-1),Re=xe[14]/(xe[10]+1),qe=(xe[9]+1)/xe[5],B=(xe[9]-1)/xe[5],mt=(xe[8]-1)/xe[0],Te=(Ue[8]+1)/Ue[0],Pe=Ie*mt,_e=Ie*Te,tt=Se/(-mt+Te),Ne=tt*-mt;K.matrixWorld.decompose(W.position,W.quaternion,W.scale),W.translateX(Ne),W.translateZ(tt),W.matrixWorld.compose(W.position,W.quaternion,W.scale),W.matrixWorldInverse.copy(W.matrixWorld).invert();const T=Ie+tt,S=Re+tt,z=Pe-Ne,te=_e+(Se-Ne),J=qe*Re/S*T,ee=B*Re/S*T;W.projectionMatrix.makePerspective(z,te,J,ee,T,S),W.projectionMatrixInverse.copy(W.projectionMatrix).invert()}function q(W,K){K===null?W.matrixWorld.copy(W.matrix):W.matrixWorld.multiplyMatrices(K.matrixWorld,W.matrix),W.matrixWorldInverse.copy(W.matrixWorld).invert()}this.updateCamera=function(W){if(s===null)return;x.near=A.near=w.near=W.near,x.far=A.far=w.far=W.far,(E!==x.near||F!==x.far)&&(s.updateRenderState({depthNear:x.near,depthFar:x.far}),E=x.near,F=x.far);const K=W.parent,fe=x.cameras;q(x,K);for(let Se=0;Se<fe.length;Se++)q(fe[Se],K);fe.length===2?Y(x,w,A):x.projectionMatrix.copy(w.projectionMatrix),$(W,x,K)};function $(W,K,fe){fe===null?W.matrix.copy(K.matrixWorld):(W.matrix.copy(fe.matrixWorld),W.matrix.invert(),W.matrix.multiply(K.matrixWorld)),W.matrix.decompose(W.position,W.quaternion,W.scale),W.updateMatrixWorld(!0),W.projectionMatrix.copy(K.projectionMatrix),W.projectionMatrixInverse.copy(K.projectionMatrixInverse),W.isPerspectiveCamera&&(W.fov=Nr*2*Math.atan(1/W.projectionMatrix.elements[5]),W.zoom=1)}this.getCamera=function(){return x},this.getFoveation=function(){if(!(p===null&&f===null))return l},this.setFoveation=function(W){l=W,p!==null&&(p.fixedFoveation=W),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=W)};let Q=null;function ie(W,K){if(h=K.getViewerPose(c||o),g=K,h!==null){const fe=h.views;f!==null&&(e.setRenderTargetFramebuffer(u,f.framebuffer),e.setRenderTarget(u));let Se=!1;fe.length!==x.cameras.length&&(x.cameras.length=0,Se=!0);for(let xe=0;xe<fe.length;xe++){const Ue=fe[xe];let Ie=null;if(f!==null)Ie=f.getViewport(Ue);else{const qe=d.getViewSubImage(p,Ue);Ie=qe.viewport,xe===0&&(e.setRenderTargetTextures(u,qe.colorTexture,p.ignoreDepthValues?void 0:qe.depthStencilTexture),e.setRenderTarget(u))}let Re=U[xe];Re===void 0&&(Re=new Jt,Re.layers.enable(xe),Re.viewport=new xt,U[xe]=Re),Re.matrix.fromArray(Ue.transform.matrix),Re.matrix.decompose(Re.position,Re.quaternion,Re.scale),Re.projectionMatrix.fromArray(Ue.projectionMatrix),Re.projectionMatrixInverse.copy(Re.projectionMatrix).invert(),Re.viewport.set(Ie.x,Ie.y,Ie.width,Ie.height),xe===0&&(x.matrix.copy(Re.matrix),x.matrix.decompose(x.position,x.quaternion,x.scale)),Se===!0&&x.cameras.push(Re)}}for(let fe=0;fe<M.length;fe++){const Se=v[fe],xe=M[fe];Se!==null&&xe!==void 0&&xe.update(Se,K,c||o)}Q&&Q(W,K),K.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:K}),g=null}const pe=new Ol;pe.setAnimationLoop(ie),this.setAnimationLoop=function(W){Q=W},this.dispose=function(){}}}function sg(i,e){function t(m,u){m.matrixAutoUpdate===!0&&m.updateMatrix(),u.value.copy(m.matrix)}function n(m,u){u.color.getRGB(m.fogColor.value,Ul(i)),u.isFog?(m.fogNear.value=u.near,m.fogFar.value=u.far):u.isFogExp2&&(m.fogDensity.value=u.density)}function s(m,u,M,v,b){u.isMeshBasicMaterial||u.isMeshLambertMaterial?r(m,u):u.isMeshToonMaterial?(r(m,u),d(m,u)):u.isMeshPhongMaterial?(r(m,u),h(m,u)):u.isMeshStandardMaterial?(r(m,u),p(m,u),u.isMeshPhysicalMaterial&&f(m,u,b)):u.isMeshMatcapMaterial?(r(m,u),g(m,u)):u.isMeshDepthMaterial?r(m,u):u.isMeshDistanceMaterial?(r(m,u),_(m,u)):u.isMeshNormalMaterial?r(m,u):u.isLineBasicMaterial?(o(m,u),u.isLineDashedMaterial&&a(m,u)):u.isPointsMaterial?l(m,u,M,v):u.isSpriteMaterial?c(m,u):u.isShadowMaterial?(m.color.value.copy(u.color),m.opacity.value=u.opacity):u.isShaderMaterial&&(u.uniformsNeedUpdate=!1)}function r(m,u){m.opacity.value=u.opacity,u.color&&m.diffuse.value.copy(u.color),u.emissive&&m.emissive.value.copy(u.emissive).multiplyScalar(u.emissiveIntensity),u.map&&(m.map.value=u.map,t(u.map,m.mapTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,t(u.alphaMap,m.alphaMapTransform)),u.bumpMap&&(m.bumpMap.value=u.bumpMap,t(u.bumpMap,m.bumpMapTransform),m.bumpScale.value=u.bumpScale,u.side===Dt&&(m.bumpScale.value*=-1)),u.normalMap&&(m.normalMap.value=u.normalMap,t(u.normalMap,m.normalMapTransform),m.normalScale.value.copy(u.normalScale),u.side===Dt&&m.normalScale.value.negate()),u.displacementMap&&(m.displacementMap.value=u.displacementMap,t(u.displacementMap,m.displacementMapTransform),m.displacementScale.value=u.displacementScale,m.displacementBias.value=u.displacementBias),u.emissiveMap&&(m.emissiveMap.value=u.emissiveMap,t(u.emissiveMap,m.emissiveMapTransform)),u.specularMap&&(m.specularMap.value=u.specularMap,t(u.specularMap,m.specularMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest);const M=e.get(u).envMap;if(M&&(m.envMap.value=M,m.flipEnvMap.value=M.isCubeTexture&&M.isRenderTargetTexture===!1?-1:1,m.reflectivity.value=u.reflectivity,m.ior.value=u.ior,m.refractionRatio.value=u.refractionRatio),u.lightMap){m.lightMap.value=u.lightMap;const v=i._useLegacyLights===!0?Math.PI:1;m.lightMapIntensity.value=u.lightMapIntensity*v,t(u.lightMap,m.lightMapTransform)}u.aoMap&&(m.aoMap.value=u.aoMap,m.aoMapIntensity.value=u.aoMapIntensity,t(u.aoMap,m.aoMapTransform))}function o(m,u){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,u.map&&(m.map.value=u.map,t(u.map,m.mapTransform))}function a(m,u){m.dashSize.value=u.dashSize,m.totalSize.value=u.dashSize+u.gapSize,m.scale.value=u.scale}function l(m,u,M,v){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,m.size.value=u.size*M,m.scale.value=v*.5,u.map&&(m.map.value=u.map,t(u.map,m.uvTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,t(u.alphaMap,m.alphaMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest)}function c(m,u){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,m.rotation.value=u.rotation,u.map&&(m.map.value=u.map,t(u.map,m.mapTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,t(u.alphaMap,m.alphaMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest)}function h(m,u){m.specular.value.copy(u.specular),m.shininess.value=Math.max(u.shininess,1e-4)}function d(m,u){u.gradientMap&&(m.gradientMap.value=u.gradientMap)}function p(m,u){m.metalness.value=u.metalness,u.metalnessMap&&(m.metalnessMap.value=u.metalnessMap,t(u.metalnessMap,m.metalnessMapTransform)),m.roughness.value=u.roughness,u.roughnessMap&&(m.roughnessMap.value=u.roughnessMap,t(u.roughnessMap,m.roughnessMapTransform)),e.get(u).envMap&&(m.envMapIntensity.value=u.envMapIntensity)}function f(m,u,M){m.ior.value=u.ior,u.sheen>0&&(m.sheenColor.value.copy(u.sheenColor).multiplyScalar(u.sheen),m.sheenRoughness.value=u.sheenRoughness,u.sheenColorMap&&(m.sheenColorMap.value=u.sheenColorMap,t(u.sheenColorMap,m.sheenColorMapTransform)),u.sheenRoughnessMap&&(m.sheenRoughnessMap.value=u.sheenRoughnessMap,t(u.sheenRoughnessMap,m.sheenRoughnessMapTransform))),u.clearcoat>0&&(m.clearcoat.value=u.clearcoat,m.clearcoatRoughness.value=u.clearcoatRoughness,u.clearcoatMap&&(m.clearcoatMap.value=u.clearcoatMap,t(u.clearcoatMap,m.clearcoatMapTransform)),u.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=u.clearcoatRoughnessMap,t(u.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),u.clearcoatNormalMap&&(m.clearcoatNormalMap.value=u.clearcoatNormalMap,t(u.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(u.clearcoatNormalScale),u.side===Dt&&m.clearcoatNormalScale.value.negate())),u.iridescence>0&&(m.iridescence.value=u.iridescence,m.iridescenceIOR.value=u.iridescenceIOR,m.iridescenceThicknessMinimum.value=u.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=u.iridescenceThicknessRange[1],u.iridescenceMap&&(m.iridescenceMap.value=u.iridescenceMap,t(u.iridescenceMap,m.iridescenceMapTransform)),u.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=u.iridescenceThicknessMap,t(u.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),u.transmission>0&&(m.transmission.value=u.transmission,m.transmissionSamplerMap.value=M.texture,m.transmissionSamplerSize.value.set(M.width,M.height),u.transmissionMap&&(m.transmissionMap.value=u.transmissionMap,t(u.transmissionMap,m.transmissionMapTransform)),m.thickness.value=u.thickness,u.thicknessMap&&(m.thicknessMap.value=u.thicknessMap,t(u.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=u.attenuationDistance,m.attenuationColor.value.copy(u.attenuationColor)),u.anisotropy>0&&(m.anisotropyVector.value.set(u.anisotropy*Math.cos(u.anisotropyRotation),u.anisotropy*Math.sin(u.anisotropyRotation)),u.anisotropyMap&&(m.anisotropyMap.value=u.anisotropyMap,t(u.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=u.specularIntensity,m.specularColor.value.copy(u.specularColor),u.specularColorMap&&(m.specularColorMap.value=u.specularColorMap,t(u.specularColorMap,m.specularColorMapTransform)),u.specularIntensityMap&&(m.specularIntensityMap.value=u.specularIntensityMap,t(u.specularIntensityMap,m.specularIntensityMapTransform))}function g(m,u){u.matcap&&(m.matcap.value=u.matcap)}function _(m,u){const M=e.get(u).light;m.referencePosition.value.setFromMatrixPosition(M.matrixWorld),m.nearDistance.value=M.shadow.camera.near,m.farDistance.value=M.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:s}}function rg(i,e,t,n){let s={},r={},o=[];const a=t.isWebGL2?i.getParameter(i.MAX_UNIFORM_BUFFER_BINDINGS):0;function l(M,v){const b=v.program;n.uniformBlockBinding(M,b)}function c(M,v){let b=s[M.id];b===void 0&&(g(M),b=h(M),s[M.id]=b,M.addEventListener("dispose",m));const C=v.program;n.updateUBOMapping(M,C);const w=e.render.frame;r[M.id]!==w&&(p(M),r[M.id]=w)}function h(M){const v=d();M.__bindingPointIndex=v;const b=i.createBuffer(),C=M.__size,w=M.usage;return i.bindBuffer(i.UNIFORM_BUFFER,b),i.bufferData(i.UNIFORM_BUFFER,C,w),i.bindBuffer(i.UNIFORM_BUFFER,null),i.bindBufferBase(i.UNIFORM_BUFFER,v,b),b}function d(){for(let M=0;M<a;M++)if(o.indexOf(M)===-1)return o.push(M),M;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function p(M){const v=s[M.id],b=M.uniforms,C=M.__cache;i.bindBuffer(i.UNIFORM_BUFFER,v);for(let w=0,A=b.length;w<A;w++){const U=Array.isArray(b[w])?b[w]:[b[w]];for(let x=0,E=U.length;x<E;x++){const F=U[x];if(f(F,w,x,C)===!0){const V=F.__offset,ne=Array.isArray(F.value)?F.value:[F.value];let D=0;for(let O=0;O<ne.length;O++){const X=ne[O],Y=_(X);typeof X=="number"||typeof X=="boolean"?(F.__data[0]=X,i.bufferSubData(i.UNIFORM_BUFFER,V+D,F.__data)):X.isMatrix3?(F.__data[0]=X.elements[0],F.__data[1]=X.elements[1],F.__data[2]=X.elements[2],F.__data[3]=0,F.__data[4]=X.elements[3],F.__data[5]=X.elements[4],F.__data[6]=X.elements[5],F.__data[7]=0,F.__data[8]=X.elements[6],F.__data[9]=X.elements[7],F.__data[10]=X.elements[8],F.__data[11]=0):(X.toArray(F.__data,D),D+=Y.storage/Float32Array.BYTES_PER_ELEMENT)}i.bufferSubData(i.UNIFORM_BUFFER,V,F.__data)}}}i.bindBuffer(i.UNIFORM_BUFFER,null)}function f(M,v,b,C){const w=M.value,A=v+"_"+b;if(C[A]===void 0)return typeof w=="number"||typeof w=="boolean"?C[A]=w:C[A]=w.clone(),!0;{const U=C[A];if(typeof w=="number"||typeof w=="boolean"){if(U!==w)return C[A]=w,!0}else if(U.equals(w)===!1)return U.copy(w),!0}return!1}function g(M){const v=M.uniforms;let b=0;const C=16;for(let A=0,U=v.length;A<U;A++){const x=Array.isArray(v[A])?v[A]:[v[A]];for(let E=0,F=x.length;E<F;E++){const V=x[E],ne=Array.isArray(V.value)?V.value:[V.value];for(let D=0,O=ne.length;D<O;D++){const X=ne[D],Y=_(X),q=b%C;q!==0&&C-q<Y.boundary&&(b+=C-q),V.__data=new Float32Array(Y.storage/Float32Array.BYTES_PER_ELEMENT),V.__offset=b,b+=Y.storage}}}const w=b%C;return w>0&&(b+=C-w),M.__size=b,M.__cache={},this}function _(M){const v={boundary:0,storage:0};return typeof M=="number"||typeof M=="boolean"?(v.boundary=4,v.storage=4):M.isVector2?(v.boundary=8,v.storage=8):M.isVector3||M.isColor?(v.boundary=16,v.storage=12):M.isVector4?(v.boundary=16,v.storage=16):M.isMatrix3?(v.boundary=48,v.storage=48):M.isMatrix4?(v.boundary=64,v.storage=64):M.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",M),v}function m(M){const v=M.target;v.removeEventListener("dispose",m);const b=o.indexOf(v.__bindingPointIndex);o.splice(b,1),i.deleteBuffer(s[v.id]),delete s[v.id],delete r[v.id]}function u(){for(const M in s)i.deleteBuffer(s[M]);o=[],s={},r={}}return{bind:l,update:c,dispose:u}}class Wl{constructor(e={}){const{canvas:t=th(),context:n=null,depth:s=!0,stencil:r=!0,alpha:o=!1,antialias:a=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:d=!1}=e;this.isWebGLRenderer=!0;let p;n!==null?p=n.getContextAttributes().alpha:p=o;const f=new Uint32Array(4),g=new Int32Array(4);let _=null,m=null;const u=[],M=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=Mt,this._useLegacyLights=!1,this.toneMapping=Rn,this.toneMappingExposure=1;const v=this;let b=!1,C=0,w=0,A=null,U=-1,x=null;const E=new xt,F=new xt;let V=null;const ne=new $e(0);let D=0,O=t.width,X=t.height,Y=1,q=null,$=null;const Q=new xt(0,0,O,X),ie=new xt(0,0,O,X);let pe=!1;const W=new Kr;let K=!1,fe=!1,Se=null;const xe=new dt,Ue=new Ae,Ie=new I,Re={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};function qe(){return A===null?Y:1}let B=n;function mt(y,N){for(let H=0;H<y.length;H++){const k=y[H],G=t.getContext(k,N);if(G!==null)return G}return null}try{const y={alpha:!0,depth:s,stencil:r,antialias:a,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:d};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${Wr}`),t.addEventListener("webglcontextlost",ce,!1),t.addEventListener("webglcontextrestored",P,!1),t.addEventListener("webglcontextcreationerror",oe,!1),B===null){const N=["webgl2","webgl","experimental-webgl"];if(v.isWebGL1Renderer===!0&&N.shift(),B=mt(N,y),B===null)throw mt(N)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}typeof WebGLRenderingContext<"u"&&B instanceof WebGLRenderingContext&&console.warn("THREE.WebGLRenderer: WebGL 1 support was deprecated in r153 and will be removed in r163."),B.getShaderPrecisionFormat===void 0&&(B.getShaderPrecisionFormat=function(){return{rangeMin:1,rangeMax:1,precision:1}})}catch(y){throw console.error("THREE.WebGLRenderer: "+y.message),y}let Te,Pe,_e,tt,Ne,T,S,z,te,J,ee,ve,de,ge,Ce,Oe,Z,Ye,R,j,ue,re,Me,ke;function je(){Te=new mp(B),Pe=new cp(B,Te,e),Te.init(Pe),re=new eg(B,Te,Pe),_e=new Jm(B,Te,Pe),tt=new vp(B),Ne=new Bm,T=new Qm(B,Te,_e,Ne,Pe,re,tt),S=new hp(v),z=new pp(v),te=new bh(B,Pe),Me=new op(B,Te,te,Pe),J=new gp(B,te,tt,Me),ee=new Ep(B,J,te,tt),R=new Sp(B,Pe,T),Oe=new up(Ne),ve=new Om(v,S,z,Te,Pe,Me,Oe),de=new sg(v,Ne),ge=new Gm,Ce=new $m(Te,Pe),Ye=new ap(v,S,z,_e,ee,p,l),Z=new Zm(v,ee,Pe),ke=new rg(B,tt,Pe,_e),j=new lp(B,Te,tt,Pe),ue=new _p(B,Te,tt,Pe),tt.programs=ve.programs,v.capabilities=Pe,v.extensions=Te,v.properties=Ne,v.renderLists=ge,v.shadowMap=Z,v.state=_e,v.info=tt}je();const Ge=new ig(v,B);this.xr=Ge,this.getContext=function(){return B},this.getContextAttributes=function(){return B.getContextAttributes()},this.forceContextLoss=function(){const y=Te.get("WEBGL_lose_context");y&&y.loseContext()},this.forceContextRestore=function(){const y=Te.get("WEBGL_lose_context");y&&y.restoreContext()},this.getPixelRatio=function(){return Y},this.setPixelRatio=function(y){y!==void 0&&(Y=y,this.setSize(O,X,!1))},this.getSize=function(y){return y.set(O,X)},this.setSize=function(y,N,H=!0){if(Ge.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}O=y,X=N,t.width=Math.floor(y*Y),t.height=Math.floor(N*Y),H===!0&&(t.style.width=y+"px",t.style.height=N+"px"),this.setViewport(0,0,y,N)},this.getDrawingBufferSize=function(y){return y.set(O*Y,X*Y).floor()},this.setDrawingBufferSize=function(y,N,H){O=y,X=N,Y=H,t.width=Math.floor(y*H),t.height=Math.floor(N*H),this.setViewport(0,0,y,N)},this.getCurrentViewport=function(y){return y.copy(E)},this.getViewport=function(y){return y.copy(Q)},this.setViewport=function(y,N,H,k){y.isVector4?Q.set(y.x,y.y,y.z,y.w):Q.set(y,N,H,k),_e.viewport(E.copy(Q).multiplyScalar(Y).floor())},this.getScissor=function(y){return y.copy(ie)},this.setScissor=function(y,N,H,k){y.isVector4?ie.set(y.x,y.y,y.z,y.w):ie.set(y,N,H,k),_e.scissor(F.copy(ie).multiplyScalar(Y).floor())},this.getScissorTest=function(){return pe},this.setScissorTest=function(y){_e.setScissorTest(pe=y)},this.setOpaqueSort=function(y){q=y},this.setTransparentSort=function(y){$=y},this.getClearColor=function(y){return y.copy(Ye.getClearColor())},this.setClearColor=function(){Ye.setClearColor.apply(Ye,arguments)},this.getClearAlpha=function(){return Ye.getClearAlpha()},this.setClearAlpha=function(){Ye.setClearAlpha.apply(Ye,arguments)},this.clear=function(y=!0,N=!0,H=!0){let k=0;if(y){let G=!1;if(A!==null){const me=A.texture.format;G=me===Sl||me===Ml||me===xl}if(G){const me=A.texture.type,ye=me===Cn||me===An||me===Xr||me===Wn||me===_l||me===vl,Le=Ye.getClearColor(),De=Ye.getClearAlpha(),He=Le.r,Fe=Le.g,Be=Le.b;ye?(f[0]=He,f[1]=Fe,f[2]=Be,f[3]=De,B.clearBufferuiv(B.COLOR,0,f)):(g[0]=He,g[1]=Fe,g[2]=Be,g[3]=De,B.clearBufferiv(B.COLOR,0,g))}else k|=B.COLOR_BUFFER_BIT}N&&(k|=B.DEPTH_BUFFER_BIT),H&&(k|=B.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),B.clear(k)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",ce,!1),t.removeEventListener("webglcontextrestored",P,!1),t.removeEventListener("webglcontextcreationerror",oe,!1),ge.dispose(),Ce.dispose(),Ne.dispose(),S.dispose(),z.dispose(),ee.dispose(),Me.dispose(),ke.dispose(),ve.dispose(),Ge.dispose(),Ge.removeEventListener("sessionstart",bt),Ge.removeEventListener("sessionend",et),Se&&(Se.dispose(),Se=null),At.stop()};function ce(y){y.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),b=!0}function P(){console.log("THREE.WebGLRenderer: Context Restored."),b=!1;const y=tt.autoReset,N=Z.enabled,H=Z.autoUpdate,k=Z.needsUpdate,G=Z.type;je(),tt.autoReset=y,Z.enabled=N,Z.autoUpdate=H,Z.needsUpdate=k,Z.type=G}function oe(y){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",y.statusMessage)}function le(y){const N=y.target;N.removeEventListener("dispose",le),we(N)}function we(y){Ee(y),Ne.remove(y)}function Ee(y){const N=Ne.get(y).programs;N!==void 0&&(N.forEach(function(H){ve.releaseProgram(H)}),y.isShaderMaterial&&ve.releaseShaderCache(y))}this.renderBufferDirect=function(y,N,H,k,G,me){N===null&&(N=Re);const ye=G.isMesh&&G.matrixWorld.determinant()<0,Le=ec(y,N,H,k,G);_e.setMaterial(k,ye);let De=H.index,He=1;if(k.wireframe===!0){if(De=J.getWireframeAttribute(H),De===void 0)return;He=2}const Fe=H.drawRange,Be=H.attributes.position;let at=Fe.start*He,Ut=(Fe.start+Fe.count)*He;me!==null&&(at=Math.max(at,me.start*He),Ut=Math.min(Ut,(me.start+me.count)*He)),De!==null?(at=Math.max(at,0),Ut=Math.min(Ut,De.count)):Be!=null&&(at=Math.max(at,0),Ut=Math.min(Ut,Be.count));const _t=Ut-at;if(_t<0||_t===1/0)return;Me.setup(G,k,Le,H,De);let on,st=j;if(De!==null&&(on=te.get(De),st=ue,st.setIndex(on)),G.isMesh)k.wireframe===!0?(_e.setLineWidth(k.wireframeLinewidth*qe()),st.setMode(B.LINES)):st.setMode(B.TRIANGLES);else if(G.isLine){let Ve=k.linewidth;Ve===void 0&&(Ve=1),_e.setLineWidth(Ve*qe()),G.isLineSegments?st.setMode(B.LINES):G.isLineLoop?st.setMode(B.LINE_LOOP):st.setMode(B.LINE_STRIP)}else G.isPoints?st.setMode(B.POINTS):G.isSprite&&st.setMode(B.TRIANGLES);if(G.isBatchedMesh)st.renderMultiDraw(G._multiDrawStarts,G._multiDrawCounts,G._multiDrawCount);else if(G.isInstancedMesh)st.renderInstances(at,_t,G.count);else if(H.isInstancedBufferGeometry){const Ve=H._maxInstanceCount!==void 0?H._maxInstanceCount:1/0,zs=Math.min(H.instanceCount,Ve);st.renderInstances(at,_t,zs)}else st.render(at,_t)};function Ke(y,N,H){y.transparent===!0&&y.side===pn&&y.forceSinglePass===!1?(y.side=Dt,y.needsUpdate=!0,Yi(y,N,H),y.side=Dn,y.needsUpdate=!0,Yi(y,N,H),y.side=pn):Yi(y,N,H)}this.compile=function(y,N,H=null){H===null&&(H=y),m=Ce.get(H),m.init(),M.push(m),H.traverseVisible(function(G){G.isLight&&G.layers.test(N.layers)&&(m.pushLight(G),G.castShadow&&m.pushShadow(G))}),y!==H&&y.traverseVisible(function(G){G.isLight&&G.layers.test(N.layers)&&(m.pushLight(G),G.castShadow&&m.pushShadow(G))}),m.setupLights(v._useLegacyLights);const k=new Set;return y.traverse(function(G){const me=G.material;if(me)if(Array.isArray(me))for(let ye=0;ye<me.length;ye++){const Le=me[ye];Ke(Le,H,G),k.add(Le)}else Ke(me,H,G),k.add(me)}),M.pop(),m=null,k},this.compileAsync=function(y,N,H=null){const k=this.compile(y,N,H);return new Promise(G=>{function me(){if(k.forEach(function(ye){Ne.get(ye).currentProgram.isReady()&&k.delete(ye)}),k.size===0){G(y);return}setTimeout(me,10)}Te.get("KHR_parallel_shader_compile")!==null?me():setTimeout(me,10)})};let Je=null;function gt(y){Je&&Je(y)}function bt(){At.stop()}function et(){At.start()}const At=new Ol;At.setAnimationLoop(gt),typeof self<"u"&&At.setContext(self),this.setAnimationLoop=function(y){Je=y,Ge.setAnimationLoop(y),y===null?At.stop():At.start()},Ge.addEventListener("sessionstart",bt),Ge.addEventListener("sessionend",et),this.render=function(y,N){if(N!==void 0&&N.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(b===!0)return;y.matrixWorldAutoUpdate===!0&&y.updateMatrixWorld(),N.parent===null&&N.matrixWorldAutoUpdate===!0&&N.updateMatrixWorld(),Ge.enabled===!0&&Ge.isPresenting===!0&&(Ge.cameraAutoUpdate===!0&&Ge.updateCamera(N),N=Ge.getCamera()),y.isScene===!0&&y.onBeforeRender(v,y,N,A),m=Ce.get(y,M.length),m.init(),M.push(m),xe.multiplyMatrices(N.projectionMatrix,N.matrixWorldInverse),W.setFromProjectionMatrix(xe),fe=this.localClippingEnabled,K=Oe.init(this.clippingPlanes,fe),_=ge.get(y,u.length),_.init(),u.push(_),nn(y,N,0,v.sortObjects),_.finish(),v.sortObjects===!0&&_.sort(q,$),this.info.render.frame++,K===!0&&Oe.beginShadows();const H=m.state.shadowsArray;if(Z.render(H,y,N),K===!0&&Oe.endShadows(),this.info.autoReset===!0&&this.info.reset(),Ye.render(_,y),m.setupLights(v._useLegacyLights),N.isArrayCamera){const k=N.cameras;for(let G=0,me=k.length;G<me;G++){const ye=k[G];oa(_,y,ye,ye.viewport)}}else oa(_,y,N);A!==null&&(T.updateMultisampleRenderTarget(A),T.updateRenderTargetMipmap(A)),y.isScene===!0&&y.onAfterRender(v,y,N),Me.resetDefaultState(),U=-1,x=null,M.pop(),M.length>0?m=M[M.length-1]:m=null,u.pop(),u.length>0?_=u[u.length-1]:_=null};function nn(y,N,H,k){if(y.visible===!1)return;if(y.layers.test(N.layers)){if(y.isGroup)H=y.renderOrder;else if(y.isLOD)y.autoUpdate===!0&&y.update(N);else if(y.isLight)m.pushLight(y),y.castShadow&&m.pushShadow(y);else if(y.isSprite){if(!y.frustumCulled||W.intersectsSprite(y)){k&&Ie.setFromMatrixPosition(y.matrixWorld).applyMatrix4(xe);const ye=ee.update(y),Le=y.material;Le.visible&&_.push(y,ye,Le,H,Ie.z,null)}}else if((y.isMesh||y.isLine||y.isPoints)&&(!y.frustumCulled||W.intersectsObject(y))){const ye=ee.update(y),Le=y.material;if(k&&(y.boundingSphere!==void 0?(y.boundingSphere===null&&y.computeBoundingSphere(),Ie.copy(y.boundingSphere.center)):(ye.boundingSphere===null&&ye.computeBoundingSphere(),Ie.copy(ye.boundingSphere.center)),Ie.applyMatrix4(y.matrixWorld).applyMatrix4(xe)),Array.isArray(Le)){const De=ye.groups;for(let He=0,Fe=De.length;He<Fe;He++){const Be=De[He],at=Le[Be.materialIndex];at&&at.visible&&_.push(y,ye,at,H,Ie.z,Be)}}else Le.visible&&_.push(y,ye,Le,H,Ie.z,null)}}const me=y.children;for(let ye=0,Le=me.length;ye<Le;ye++)nn(me[ye],N,H,k)}function oa(y,N,H,k){const G=y.opaque,me=y.transmissive,ye=y.transparent;m.setupLightsView(H),K===!0&&Oe.setGlobalState(v.clippingPlanes,H),me.length>0&&Ql(G,me,N,H),k&&_e.viewport(E.copy(k)),G.length>0&&qi(G,N,H),me.length>0&&qi(me,N,H),ye.length>0&&qi(ye,N,H),_e.buffers.depth.setTest(!0),_e.buffers.depth.setMask(!0),_e.buffers.color.setMask(!0),_e.setPolygonOffset(!1)}function Ql(y,N,H,k){if((H.isScene===!0?H.overrideMaterial:null)!==null)return;const me=Pe.isWebGL2;Se===null&&(Se=new Un(1,1,{generateMipmaps:!0,type:Te.has("EXT_color_buffer_half_float")?yi:Cn,minFilter:Bi,samples:me?4:0})),v.getDrawingBufferSize(Ue),me?Se.setSize(Ue.x,Ue.y):Se.setSize(Fr(Ue.x),Fr(Ue.y));const ye=v.getRenderTarget();v.setRenderTarget(Se),v.getClearColor(ne),D=v.getClearAlpha(),D<1&&v.setClearColor(16777215,.5),v.clear();const Le=v.toneMapping;v.toneMapping=Rn,qi(y,H,k),T.updateMultisampleRenderTarget(Se),T.updateRenderTargetMipmap(Se);let De=!1;for(let He=0,Fe=N.length;He<Fe;He++){const Be=N[He],at=Be.object,Ut=Be.geometry,_t=Be.material,on=Be.group;if(_t.side===pn&&at.layers.test(k.layers)){const st=_t.side;_t.side=Dt,_t.needsUpdate=!0,la(at,H,k,Ut,_t,on),_t.side=st,_t.needsUpdate=!0,De=!0}}De===!0&&(T.updateMultisampleRenderTarget(Se),T.updateRenderTargetMipmap(Se)),v.setRenderTarget(ye),v.setClearColor(ne,D),v.toneMapping=Le}function qi(y,N,H){const k=N.isScene===!0?N.overrideMaterial:null;for(let G=0,me=y.length;G<me;G++){const ye=y[G],Le=ye.object,De=ye.geometry,He=k===null?ye.material:k,Fe=ye.group;Le.layers.test(H.layers)&&la(Le,N,H,De,He,Fe)}}function la(y,N,H,k,G,me){y.onBeforeRender(v,N,H,k,G,me),y.modelViewMatrix.multiplyMatrices(H.matrixWorldInverse,y.matrixWorld),y.normalMatrix.getNormalMatrix(y.modelViewMatrix),G.onBeforeRender(v,N,H,k,y,me),G.transparent===!0&&G.side===pn&&G.forceSinglePass===!1?(G.side=Dt,G.needsUpdate=!0,v.renderBufferDirect(H,N,k,G,y,me),G.side=Dn,G.needsUpdate=!0,v.renderBufferDirect(H,N,k,G,y,me),G.side=pn):v.renderBufferDirect(H,N,k,G,y,me),y.onAfterRender(v,N,H,k,G,me)}function Yi(y,N,H){N.isScene!==!0&&(N=Re);const k=Ne.get(y),G=m.state.lights,me=m.state.shadowsArray,ye=G.state.version,Le=ve.getParameters(y,G.state,me,N,H),De=ve.getProgramCacheKey(Le);let He=k.programs;k.environment=y.isMeshStandardMaterial?N.environment:null,k.fog=N.fog,k.envMap=(y.isMeshStandardMaterial?z:S).get(y.envMap||k.environment),He===void 0&&(y.addEventListener("dispose",le),He=new Map,k.programs=He);let Fe=He.get(De);if(Fe!==void 0){if(k.currentProgram===Fe&&k.lightsStateVersion===ye)return ua(y,Le),Fe}else Le.uniforms=ve.getUniforms(y),y.onBuild(H,Le,v),y.onBeforeCompile(Le,v),Fe=ve.acquireProgram(Le,De),He.set(De,Fe),k.uniforms=Le.uniforms;const Be=k.uniforms;return(!y.isShaderMaterial&&!y.isRawShaderMaterial||y.clipping===!0)&&(Be.clippingPlanes=Oe.uniform),ua(y,Le),k.needsLights=nc(y),k.lightsStateVersion=ye,k.needsLights&&(Be.ambientLightColor.value=G.state.ambient,Be.lightProbe.value=G.state.probe,Be.directionalLights.value=G.state.directional,Be.directionalLightShadows.value=G.state.directionalShadow,Be.spotLights.value=G.state.spot,Be.spotLightShadows.value=G.state.spotShadow,Be.rectAreaLights.value=G.state.rectArea,Be.ltc_1.value=G.state.rectAreaLTC1,Be.ltc_2.value=G.state.rectAreaLTC2,Be.pointLights.value=G.state.point,Be.pointLightShadows.value=G.state.pointShadow,Be.hemisphereLights.value=G.state.hemi,Be.directionalShadowMap.value=G.state.directionalShadowMap,Be.directionalShadowMatrix.value=G.state.directionalShadowMatrix,Be.spotShadowMap.value=G.state.spotShadowMap,Be.spotLightMatrix.value=G.state.spotLightMatrix,Be.spotLightMap.value=G.state.spotLightMap,Be.pointShadowMap.value=G.state.pointShadowMap,Be.pointShadowMatrix.value=G.state.pointShadowMatrix),k.currentProgram=Fe,k.uniformsList=null,Fe}function ca(y){if(y.uniformsList===null){const N=y.currentProgram.getUniforms();y.uniformsList=Ms.seqWithValue(N.seq,y.uniforms)}return y.uniformsList}function ua(y,N){const H=Ne.get(y);H.outputColorSpace=N.outputColorSpace,H.batching=N.batching,H.instancing=N.instancing,H.instancingColor=N.instancingColor,H.skinning=N.skinning,H.morphTargets=N.morphTargets,H.morphNormals=N.morphNormals,H.morphColors=N.morphColors,H.morphTargetsCount=N.morphTargetsCount,H.numClippingPlanes=N.numClippingPlanes,H.numIntersection=N.numClipIntersection,H.vertexAlphas=N.vertexAlphas,H.vertexTangents=N.vertexTangents,H.toneMapping=N.toneMapping}function ec(y,N,H,k,G){N.isScene!==!0&&(N=Re),T.resetTextureUnits();const me=N.fog,ye=k.isMeshStandardMaterial?N.environment:null,Le=A===null?v.outputColorSpace:A.isXRRenderTarget===!0?A.texture.colorSpace:vn,De=(k.isMeshStandardMaterial?z:S).get(k.envMap||ye),He=k.vertexColors===!0&&!!H.attributes.color&&H.attributes.color.itemSize===4,Fe=!!H.attributes.tangent&&(!!k.normalMap||k.anisotropy>0),Be=!!H.morphAttributes.position,at=!!H.morphAttributes.normal,Ut=!!H.morphAttributes.color;let _t=Rn;k.toneMapped&&(A===null||A.isXRRenderTarget===!0)&&(_t=v.toneMapping);const on=H.morphAttributes.position||H.morphAttributes.normal||H.morphAttributes.color,st=on!==void 0?on.length:0,Ve=Ne.get(k),zs=m.state.lights;if(K===!0&&(fe===!0||y!==x)){const zt=y===x&&k.id===U;Oe.setState(k,y,zt)}let rt=!1;k.version===Ve.__version?(Ve.needsLights&&Ve.lightsStateVersion!==zs.state.version||Ve.outputColorSpace!==Le||G.isBatchedMesh&&Ve.batching===!1||!G.isBatchedMesh&&Ve.batching===!0||G.isInstancedMesh&&Ve.instancing===!1||!G.isInstancedMesh&&Ve.instancing===!0||G.isSkinnedMesh&&Ve.skinning===!1||!G.isSkinnedMesh&&Ve.skinning===!0||G.isInstancedMesh&&Ve.instancingColor===!0&&G.instanceColor===null||G.isInstancedMesh&&Ve.instancingColor===!1&&G.instanceColor!==null||Ve.envMap!==De||k.fog===!0&&Ve.fog!==me||Ve.numClippingPlanes!==void 0&&(Ve.numClippingPlanes!==Oe.numPlanes||Ve.numIntersection!==Oe.numIntersection)||Ve.vertexAlphas!==He||Ve.vertexTangents!==Fe||Ve.morphTargets!==Be||Ve.morphNormals!==at||Ve.morphColors!==Ut||Ve.toneMapping!==_t||Pe.isWebGL2===!0&&Ve.morphTargetsCount!==st)&&(rt=!0):(rt=!0,Ve.__version=k.version);let In=Ve.currentProgram;rt===!0&&(In=Yi(k,N,G));let ha=!1,wi=!1,Gs=!1;const Et=In.getUniforms(),Nn=Ve.uniforms;if(_e.useProgram(In.program)&&(ha=!0,wi=!0,Gs=!0),k.id!==U&&(U=k.id,wi=!0),ha||x!==y){Et.setValue(B,"projectionMatrix",y.projectionMatrix),Et.setValue(B,"viewMatrix",y.matrixWorldInverse);const zt=Et.map.cameraPosition;zt!==void 0&&zt.setValue(B,Ie.setFromMatrixPosition(y.matrixWorld)),Pe.logarithmicDepthBuffer&&Et.setValue(B,"logDepthBufFC",2/(Math.log(y.far+1)/Math.LN2)),(k.isMeshPhongMaterial||k.isMeshToonMaterial||k.isMeshLambertMaterial||k.isMeshBasicMaterial||k.isMeshStandardMaterial||k.isShaderMaterial)&&Et.setValue(B,"isOrthographic",y.isOrthographicCamera===!0),x!==y&&(x=y,wi=!0,Gs=!0)}if(G.isSkinnedMesh){Et.setOptional(B,G,"bindMatrix"),Et.setOptional(B,G,"bindMatrixInverse");const zt=G.skeleton;zt&&(Pe.floatVertexTextures?(zt.boneTexture===null&&zt.computeBoneTexture(),Et.setValue(B,"boneTexture",zt.boneTexture,T)):console.warn("THREE.WebGLRenderer: SkinnedMesh can only be used with WebGL 2. With WebGL 1 OES_texture_float and vertex textures support is required."))}G.isBatchedMesh&&(Et.setOptional(B,G,"batchingTexture"),Et.setValue(B,"batchingTexture",G._matricesTexture,T));const Hs=H.morphAttributes;if((Hs.position!==void 0||Hs.normal!==void 0||Hs.color!==void 0&&Pe.isWebGL2===!0)&&R.update(G,H,In),(wi||Ve.receiveShadow!==G.receiveShadow)&&(Ve.receiveShadow=G.receiveShadow,Et.setValue(B,"receiveShadow",G.receiveShadow)),k.isMeshGouraudMaterial&&k.envMap!==null&&(Nn.envMap.value=De,Nn.flipEnvMap.value=De.isCubeTexture&&De.isRenderTargetTexture===!1?-1:1),wi&&(Et.setValue(B,"toneMappingExposure",v.toneMappingExposure),Ve.needsLights&&tc(Nn,Gs),me&&k.fog===!0&&de.refreshFogUniforms(Nn,me),de.refreshMaterialUniforms(Nn,k,Y,X,Se),Ms.upload(B,ca(Ve),Nn,T)),k.isShaderMaterial&&k.uniformsNeedUpdate===!0&&(Ms.upload(B,ca(Ve),Nn,T),k.uniformsNeedUpdate=!1),k.isSpriteMaterial&&Et.setValue(B,"center",G.center),Et.setValue(B,"modelViewMatrix",G.modelViewMatrix),Et.setValue(B,"normalMatrix",G.normalMatrix),Et.setValue(B,"modelMatrix",G.matrixWorld),k.isShaderMaterial||k.isRawShaderMaterial){const zt=k.uniformsGroups;for(let ks=0,ic=zt.length;ks<ic;ks++)if(Pe.isWebGL2){const da=zt[ks];ke.update(da,In),ke.bind(da,In)}else console.warn("THREE.WebGLRenderer: Uniform Buffer Objects can only be used with WebGL 2.")}return In}function tc(y,N){y.ambientLightColor.needsUpdate=N,y.lightProbe.needsUpdate=N,y.directionalLights.needsUpdate=N,y.directionalLightShadows.needsUpdate=N,y.pointLights.needsUpdate=N,y.pointLightShadows.needsUpdate=N,y.spotLights.needsUpdate=N,y.spotLightShadows.needsUpdate=N,y.rectAreaLights.needsUpdate=N,y.hemisphereLights.needsUpdate=N}function nc(y){return y.isMeshLambertMaterial||y.isMeshToonMaterial||y.isMeshPhongMaterial||y.isMeshStandardMaterial||y.isShadowMaterial||y.isShaderMaterial&&y.lights===!0}this.getActiveCubeFace=function(){return C},this.getActiveMipmapLevel=function(){return w},this.getRenderTarget=function(){return A},this.setRenderTargetTextures=function(y,N,H){Ne.get(y.texture).__webglTexture=N,Ne.get(y.depthTexture).__webglTexture=H;const k=Ne.get(y);k.__hasExternalTextures=!0,k.__hasExternalTextures&&(k.__autoAllocateDepthBuffer=H===void 0,k.__autoAllocateDepthBuffer||Te.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),k.__useRenderToTexture=!1))},this.setRenderTargetFramebuffer=function(y,N){const H=Ne.get(y);H.__webglFramebuffer=N,H.__useDefaultFramebuffer=N===void 0},this.setRenderTarget=function(y,N=0,H=0){A=y,C=N,w=H;let k=!0,G=null,me=!1,ye=!1;if(y){const De=Ne.get(y);De.__useDefaultFramebuffer!==void 0?(_e.bindFramebuffer(B.FRAMEBUFFER,null),k=!1):De.__webglFramebuffer===void 0?T.setupRenderTarget(y):De.__hasExternalTextures&&T.rebindTextures(y,Ne.get(y.texture).__webglTexture,Ne.get(y.depthTexture).__webglTexture);const He=y.texture;(He.isData3DTexture||He.isDataArrayTexture||He.isCompressedArrayTexture)&&(ye=!0);const Fe=Ne.get(y).__webglFramebuffer;y.isWebGLCubeRenderTarget?(Array.isArray(Fe[N])?G=Fe[N][H]:G=Fe[N],me=!0):Pe.isWebGL2&&y.samples>0&&T.useMultisampledRTT(y)===!1?G=Ne.get(y).__webglMultisampledFramebuffer:Array.isArray(Fe)?G=Fe[H]:G=Fe,E.copy(y.viewport),F.copy(y.scissor),V=y.scissorTest}else E.copy(Q).multiplyScalar(Y).floor(),F.copy(ie).multiplyScalar(Y).floor(),V=pe;if(_e.bindFramebuffer(B.FRAMEBUFFER,G)&&Pe.drawBuffers&&k&&_e.drawBuffers(y,G),_e.viewport(E),_e.scissor(F),_e.setScissorTest(V),me){const De=Ne.get(y.texture);B.framebufferTexture2D(B.FRAMEBUFFER,B.COLOR_ATTACHMENT0,B.TEXTURE_CUBE_MAP_POSITIVE_X+N,De.__webglTexture,H)}else if(ye){const De=Ne.get(y.texture),He=N||0;B.framebufferTextureLayer(B.FRAMEBUFFER,B.COLOR_ATTACHMENT0,De.__webglTexture,H||0,He)}U=-1},this.readRenderTargetPixels=function(y,N,H,k,G,me,ye){if(!(y&&y.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let Le=Ne.get(y).__webglFramebuffer;if(y.isWebGLCubeRenderTarget&&ye!==void 0&&(Le=Le[ye]),Le){_e.bindFramebuffer(B.FRAMEBUFFER,Le);try{const De=y.texture,He=De.format,Fe=De.type;if(He!==en&&re.convert(He)!==B.getParameter(B.IMPLEMENTATION_COLOR_READ_FORMAT)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}const Be=Fe===yi&&(Te.has("EXT_color_buffer_half_float")||Pe.isWebGL2&&Te.has("EXT_color_buffer_float"));if(Fe!==Cn&&re.convert(Fe)!==B.getParameter(B.IMPLEMENTATION_COLOR_READ_TYPE)&&!(Fe===wn&&(Pe.isWebGL2||Te.has("OES_texture_float")||Te.has("WEBGL_color_buffer_float")))&&!Be){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}N>=0&&N<=y.width-k&&H>=0&&H<=y.height-G&&B.readPixels(N,H,k,G,re.convert(He),re.convert(Fe),me)}finally{const De=A!==null?Ne.get(A).__webglFramebuffer:null;_e.bindFramebuffer(B.FRAMEBUFFER,De)}}},this.copyFramebufferToTexture=function(y,N,H=0){const k=Math.pow(2,-H),G=Math.floor(N.image.width*k),me=Math.floor(N.image.height*k);T.setTexture2D(N,0),B.copyTexSubImage2D(B.TEXTURE_2D,H,0,0,y.x,y.y,G,me),_e.unbindTexture()},this.copyTextureToTexture=function(y,N,H,k=0){const G=N.image.width,me=N.image.height,ye=re.convert(H.format),Le=re.convert(H.type);T.setTexture2D(H,0),B.pixelStorei(B.UNPACK_FLIP_Y_WEBGL,H.flipY),B.pixelStorei(B.UNPACK_PREMULTIPLY_ALPHA_WEBGL,H.premultiplyAlpha),B.pixelStorei(B.UNPACK_ALIGNMENT,H.unpackAlignment),N.isDataTexture?B.texSubImage2D(B.TEXTURE_2D,k,y.x,y.y,G,me,ye,Le,N.image.data):N.isCompressedTexture?B.compressedTexSubImage2D(B.TEXTURE_2D,k,y.x,y.y,N.mipmaps[0].width,N.mipmaps[0].height,ye,N.mipmaps[0].data):B.texSubImage2D(B.TEXTURE_2D,k,y.x,y.y,ye,Le,N.image),k===0&&H.generateMipmaps&&B.generateMipmap(B.TEXTURE_2D),_e.unbindTexture()},this.copyTextureToTexture3D=function(y,N,H,k,G=0){if(v.isWebGL1Renderer){console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: can only be used with WebGL2.");return}const me=y.max.x-y.min.x+1,ye=y.max.y-y.min.y+1,Le=y.max.z-y.min.z+1,De=re.convert(k.format),He=re.convert(k.type);let Fe;if(k.isData3DTexture)T.setTexture3D(k,0),Fe=B.TEXTURE_3D;else if(k.isDataArrayTexture||k.isCompressedArrayTexture)T.setTexture2DArray(k,0),Fe=B.TEXTURE_2D_ARRAY;else{console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: only supports THREE.DataTexture3D and THREE.DataTexture2DArray.");return}B.pixelStorei(B.UNPACK_FLIP_Y_WEBGL,k.flipY),B.pixelStorei(B.UNPACK_PREMULTIPLY_ALPHA_WEBGL,k.premultiplyAlpha),B.pixelStorei(B.UNPACK_ALIGNMENT,k.unpackAlignment);const Be=B.getParameter(B.UNPACK_ROW_LENGTH),at=B.getParameter(B.UNPACK_IMAGE_HEIGHT),Ut=B.getParameter(B.UNPACK_SKIP_PIXELS),_t=B.getParameter(B.UNPACK_SKIP_ROWS),on=B.getParameter(B.UNPACK_SKIP_IMAGES),st=H.isCompressedTexture?H.mipmaps[G]:H.image;B.pixelStorei(B.UNPACK_ROW_LENGTH,st.width),B.pixelStorei(B.UNPACK_IMAGE_HEIGHT,st.height),B.pixelStorei(B.UNPACK_SKIP_PIXELS,y.min.x),B.pixelStorei(B.UNPACK_SKIP_ROWS,y.min.y),B.pixelStorei(B.UNPACK_SKIP_IMAGES,y.min.z),H.isDataTexture||H.isData3DTexture?B.texSubImage3D(Fe,G,N.x,N.y,N.z,me,ye,Le,De,He,st.data):H.isCompressedArrayTexture?(console.warn("THREE.WebGLRenderer.copyTextureToTexture3D: untested support for compressed srcTexture."),B.compressedTexSubImage3D(Fe,G,N.x,N.y,N.z,me,ye,Le,De,st.data)):B.texSubImage3D(Fe,G,N.x,N.y,N.z,me,ye,Le,De,He,st),B.pixelStorei(B.UNPACK_ROW_LENGTH,Be),B.pixelStorei(B.UNPACK_IMAGE_HEIGHT,at),B.pixelStorei(B.UNPACK_SKIP_PIXELS,Ut),B.pixelStorei(B.UNPACK_SKIP_ROWS,_t),B.pixelStorei(B.UNPACK_SKIP_IMAGES,on),G===0&&k.generateMipmaps&&B.generateMipmap(Fe),_e.unbindTexture()},this.initTexture=function(y){y.isCubeTexture?T.setTextureCube(y,0):y.isData3DTexture?T.setTexture3D(y,0):y.isDataArrayTexture||y.isCompressedArrayTexture?T.setTexture2DArray(y,0):T.setTexture2D(y,0),_e.unbindTexture()},this.resetState=function(){C=0,w=0,A=null,_e.reset(),Me.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return mn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const t=this.getContext();t.drawingBufferColorSpace=e===$r?"display-p3":"srgb",t.unpackColorSpace=Qe.workingColorSpace===Ls?"display-p3":"srgb"}get outputEncoding(){return console.warn("THREE.WebGLRenderer: Property .outputEncoding has been removed. Use .outputColorSpace instead."),this.outputColorSpace===Mt?$n:yl}set outputEncoding(e){console.warn("THREE.WebGLRenderer: Property .outputEncoding has been removed. Use .outputColorSpace instead."),this.outputColorSpace=e===$n?Mt:vn}get useLegacyLights(){return console.warn("THREE.WebGLRenderer: The property .useLegacyLights has been deprecated. Migrate your lighting according to the following guide: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733."),this._useLegacyLights}set useLegacyLights(e){console.warn("THREE.WebGLRenderer: The property .useLegacyLights has been deprecated. Migrate your lighting according to the following guide: https://discourse.threejs.org/t/updates-to-lighting-in-three-js-r155/53733."),this._useLegacyLights=e}}class ag extends Wl{}ag.prototype.isWebGL1Renderer=!0;class og extends St{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t}}class _n extends $t{constructor(e=1,t=1,n=1,s=32,r=1,o=!1,a=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:s,heightSegments:r,openEnded:o,thetaStart:a,thetaLength:l};const c=this;s=Math.floor(s),r=Math.floor(r);const h=[],d=[],p=[],f=[];let g=0;const _=[],m=n/2;let u=0;M(),o===!1&&(e>0&&v(!0),t>0&&v(!1)),this.setIndex(h),this.setAttribute("position",new ct(d,3)),this.setAttribute("normal",new ct(p,3)),this.setAttribute("uv",new ct(f,2));function M(){const b=new I,C=new I;let w=0;const A=(t-e)/n;for(let U=0;U<=r;U++){const x=[],E=U/r,F=E*(t-e)+e;for(let V=0;V<=s;V++){const ne=V/s,D=ne*l+a,O=Math.sin(D),X=Math.cos(D);C.x=F*O,C.y=-E*n+m,C.z=F*X,d.push(C.x,C.y,C.z),b.set(O,A,X).normalize(),p.push(b.x,b.y,b.z),f.push(ne,1-E),x.push(g++)}_.push(x)}for(let U=0;U<s;U++)for(let x=0;x<r;x++){const E=_[x][U],F=_[x+1][U],V=_[x+1][U+1],ne=_[x][U+1];h.push(E,F,ne),h.push(F,V,ne),w+=6}c.addGroup(u,w,0),u+=w}function v(b){const C=g,w=new Ae,A=new I;let U=0;const x=b===!0?e:t,E=b===!0?1:-1;for(let V=1;V<=s;V++)d.push(0,m*E,0),p.push(0,E,0),f.push(.5,.5),g++;const F=g;for(let V=0;V<=s;V++){const D=V/s*l+a,O=Math.cos(D),X=Math.sin(D);A.x=x*X,A.y=m*E,A.z=x*O,d.push(A.x,A.y,A.z),p.push(0,E,0),w.x=O*.5+.5,w.y=X*.5*E+.5,f.push(w.x,w.y),g++}for(let V=0;V<s;V++){const ne=C+V,D=F+V;b===!0?h.push(D,D+1,ne):h.push(D+1,D,ne),U+=3}c.addGroup(u,U,b===!0?1:2),u+=U}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new _n(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class tn extends _n{constructor(e=1,t=1,n=32,s=1,r=!1,o=0,a=Math.PI*2){super(0,e,t,n,s,r,o,a),this.type="ConeGeometry",this.parameters={radius:e,height:t,radialSegments:n,heightSegments:s,openEnded:r,thetaStart:o,thetaLength:a}}static fromJSON(e){return new tn(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class Ns extends $t{constructor(e=[],t=[],n=1,s=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:s};const r=[],o=[];a(s),c(n),h(),this.setAttribute("position",new ct(r,3)),this.setAttribute("normal",new ct(r.slice(),3)),this.setAttribute("uv",new ct(o,2)),s===0?this.computeVertexNormals():this.normalizeNormals();function a(M){const v=new I,b=new I,C=new I;for(let w=0;w<t.length;w+=3)f(t[w+0],v),f(t[w+1],b),f(t[w+2],C),l(v,b,C,M)}function l(M,v,b,C){const w=C+1,A=[];for(let U=0;U<=w;U++){A[U]=[];const x=M.clone().lerp(b,U/w),E=v.clone().lerp(b,U/w),F=w-U;for(let V=0;V<=F;V++)V===0&&U===w?A[U][V]=x:A[U][V]=x.clone().lerp(E,V/F)}for(let U=0;U<w;U++)for(let x=0;x<2*(w-U)-1;x++){const E=Math.floor(x/2);x%2===0?(p(A[U][E+1]),p(A[U+1][E]),p(A[U][E])):(p(A[U][E+1]),p(A[U+1][E+1]),p(A[U+1][E]))}}function c(M){const v=new I;for(let b=0;b<r.length;b+=3)v.x=r[b+0],v.y=r[b+1],v.z=r[b+2],v.normalize().multiplyScalar(M),r[b+0]=v.x,r[b+1]=v.y,r[b+2]=v.z}function h(){const M=new I;for(let v=0;v<r.length;v+=3){M.x=r[v+0],M.y=r[v+1],M.z=r[v+2];const b=m(M)/2/Math.PI+.5,C=u(M)/Math.PI+.5;o.push(b,1-C)}g(),d()}function d(){for(let M=0;M<o.length;M+=6){const v=o[M+0],b=o[M+2],C=o[M+4],w=Math.max(v,b,C),A=Math.min(v,b,C);w>.9&&A<.1&&(v<.2&&(o[M+0]+=1),b<.2&&(o[M+2]+=1),C<.2&&(o[M+4]+=1))}}function p(M){r.push(M.x,M.y,M.z)}function f(M,v){const b=M*3;v.x=e[b+0],v.y=e[b+1],v.z=e[b+2]}function g(){const M=new I,v=new I,b=new I,C=new I,w=new Ae,A=new Ae,U=new Ae;for(let x=0,E=0;x<r.length;x+=9,E+=6){M.set(r[x+0],r[x+1],r[x+2]),v.set(r[x+3],r[x+4],r[x+5]),b.set(r[x+6],r[x+7],r[x+8]),w.set(o[E+0],o[E+1]),A.set(o[E+2],o[E+3]),U.set(o[E+4],o[E+5]),C.copy(M).add(v).add(b).divideScalar(3);const F=m(C);_(w,E+0,M,F),_(A,E+2,v,F),_(U,E+4,b,F)}}function _(M,v,b,C){C<0&&M.x===1&&(o[v]=M.x-1),b.x===0&&b.z===0&&(o[v]=C/2/Math.PI+.5)}function m(M){return Math.atan2(M.z,-M.x)}function u(M){return Math.atan2(-M.y,Math.sqrt(M.x*M.x+M.z*M.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Ns(e.vertices,e.indices,e.radius,e.details)}}class Jr extends Ns{constructor(e=1,t=0){const n=(1+Math.sqrt(5))/2,s=1/n,r=[-1,-1,-1,-1,-1,1,-1,1,-1,-1,1,1,1,-1,-1,1,-1,1,1,1,-1,1,1,1,0,-s,-n,0,-s,n,0,s,-n,0,s,n,-s,-n,0,-s,n,0,s,-n,0,s,n,0,-n,0,-s,n,0,-s,-n,0,s,n,0,s],o=[3,11,7,3,7,15,3,15,13,7,19,17,7,17,6,7,6,15,17,4,8,17,8,10,17,10,6,8,0,16,8,16,2,8,2,10,0,12,1,0,1,18,0,18,16,6,10,2,6,2,13,6,13,15,2,16,18,2,18,3,2,3,13,18,1,9,18,9,11,18,11,3,4,14,12,4,12,0,4,0,8,11,9,5,11,5,19,11,19,7,19,5,14,19,14,4,19,4,17,1,12,14,1,14,5,1,5,9];super(r,o,e,t),this.type="DodecahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new Jr(e.radius,e.detail)}}class Qr extends Ns{constructor(e=1,t=0){const n=(1+Math.sqrt(5))/2,s=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(s,r,e,t),this.type="IcosahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new Qr(e.radius,e.detail)}}class ea extends $t{constructor(e=1,t=32,n=16,s=0,r=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:s,phiLength:r,thetaStart:o,thetaLength:a},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));const l=Math.min(o+a,Math.PI);let c=0;const h=[],d=new I,p=new I,f=[],g=[],_=[],m=[];for(let u=0;u<=n;u++){const M=[],v=u/n;let b=0;u===0&&o===0?b=.5/t:u===n&&l===Math.PI&&(b=-.5/t);for(let C=0;C<=t;C++){const w=C/t;d.x=-e*Math.cos(s+w*r)*Math.sin(o+v*a),d.y=e*Math.cos(o+v*a),d.z=e*Math.sin(s+w*r)*Math.sin(o+v*a),g.push(d.x,d.y,d.z),p.copy(d).normalize(),_.push(p.x,p.y,p.z),m.push(w+b,1-v),M.push(c++)}h.push(M)}for(let u=0;u<n;u++)for(let M=0;M<t;M++){const v=h[u][M+1],b=h[u][M],C=h[u+1][M],w=h[u+1][M+1];(u!==0||o>0)&&f.push(v,b,w),(u!==n-1||l<Math.PI)&&f.push(b,C,w)}this.setIndex(f),this.setAttribute("position",new ct(g,3)),this.setAttribute("normal",new ct(_,3)),this.setAttribute("uv",new ct(m,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new ea(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}}class Xi extends $t{constructor(e=1,t=.4,n=12,s=48,r=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:t,radialSegments:n,tubularSegments:s,arc:r},n=Math.floor(n),s=Math.floor(s);const o=[],a=[],l=[],c=[],h=new I,d=new I,p=new I;for(let f=0;f<=n;f++)for(let g=0;g<=s;g++){const _=g/s*r,m=f/n*Math.PI*2;d.x=(e+t*Math.cos(m))*Math.cos(_),d.y=(e+t*Math.cos(m))*Math.sin(_),d.z=t*Math.sin(m),a.push(d.x,d.y,d.z),h.x=e*Math.cos(_),h.y=e*Math.sin(_),p.subVectors(d,h).normalize(),l.push(p.x,p.y,p.z),c.push(g/s),c.push(f/n)}for(let f=1;f<=n;f++)for(let g=1;g<=s;g++){const _=(s+1)*f+g-1,m=(s+1)*(f-1)+g-1,u=(s+1)*(f-1)+g,M=(s+1)*f+g;o.push(_,m,M),o.push(m,u,M)}this.setIndex(o),this.setAttribute("position",new ct(a,3)),this.setAttribute("normal",new ct(l,3)),this.setAttribute("uv",new ct(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Xi(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}}class lg extends Vi{constructor(e){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.type="MeshStandardMaterial",this.color=new $e(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new $e(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Tl,this.normalScale=new Ae(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class ta extends St{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new $e(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),t}}class cg extends ta{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(St.DEFAULT_UP),this.updateMatrix(),this.groundColor=new $e(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}}const Sr=new dt,Oo=new I,Bo=new I;class ug{constructor(e){this.camera=e,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ae(512,512),this.map=null,this.mapPass=null,this.matrix=new dt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Kr,this._frameExtents=new Ae(1,1),this._viewportCount=1,this._viewports=[new xt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const t=this.camera,n=this.matrix;Oo.setFromMatrixPosition(e.matrixWorld),t.position.copy(Oo),Bo.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Bo),t.updateMatrixWorld(),Sr.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Sr),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Sr)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.bias=e.bias,this.radius=e.radius,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}class hg extends ug{constructor(){super(new Us(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class zo extends ta{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(St.DEFAULT_UP),this.updateMatrix(),this.target=new St,this.shadow=new hg}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}class dg extends ta{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}}class fg{constructor(e=!0){this.autoStart=e,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=Go(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let e=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){const t=Go();e=(t-this.oldTime)/1e3,this.oldTime=t,this.elapsedTime+=e}return e}}function Go(){return(typeof performance>"u"?Date:performance).now()}class pg{constructor(e,t,n=0,s=1/0){this.ray=new Yr(e,t),this.near=n,this.far=s,this.camera=null,this.layers=new jr,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):console.error("THREE.Raycaster: Unsupported camera type: "+t.type)}intersectObject(e,t=!0,n=[]){return Br(e,this,n,t),n.sort(Ho),n}intersectObjects(e,t=!0,n=[]){for(let s=0,r=e.length;s<r;s++)Br(e[s],this,n,t);return n.sort(Ho),n}}function Ho(i,e){return i.distance-e.distance}function Br(i,e,t,n){if(i.layers.test(e.layers)&&i.raycast(e,t),n===!0){const s=i.children;for(let r=0,o=s.length;r<o;r++)Br(s[r],e,t,!0)}}class ko{constructor(e=1,t=0,n=0){return this.radius=e,this.phi=t,this.theta=n,this}set(e,t,n){return this.radius=e,this.phi=t,this.theta=n,this}copy(e){return this.radius=e.radius,this.phi=e.phi,this.theta=e.theta,this}makeSafe(){return this.phi=Math.max(1e-6,Math.min(Math.PI-1e-6,this.phi)),this}setFromVector3(e){return this.setFromCartesianCoords(e.x,e.y,e.z)}setFromCartesianCoords(e,t,n){return this.radius=Math.sqrt(e*e+t*t+n*n),this.radius===0?(this.theta=0,this.phi=0):(this.theta=Math.atan2(e,n),this.phi=Math.acos(Ct(t/this.radius,-1,1))),this}clone(){return new this.constructor().copy(this)}}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Wr}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Wr);const L={renderer:null,scene:null,camera:null,controls:null,composer:null,passH:null,passV:null,sun:null,staticGroup:null,dynGroup:null,fxGroup:null,highlightGroup:null,terrGroup:null,waterMeshes:[],decoMeshes:[],tilePickMeshes:[],hovered:null,bobUnits:[],_fillGeo:null,_edgeGeoX:null,_edgeGeoZ:null,_tileGeo:null,_deco:null,_unitTpl:{},_cityTpl:{},_fillMat:{},_edgeMat:{},raycaster:new pg,pointer:new Ae,panKeys:new Set,panV:null,panRamp:0,lastPanT:0,lastT:0,onClick:null},kt=1,qn=.9,Vo=.015,Wo={type:"change"},Er={type:"start"},Xo={type:"end"},_s=new Yr,$o=new bn,mg=Math.cos(70*eh.DEG2RAD);class gg extends Zn{constructor(e,t){super(),this.object=e,this.domElement=t,this.domElement.style.touchAction="none",this.enabled=!0,this.target=new I,this.cursor=new I,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:"ArrowLeft",UP:"ArrowUp",RIGHT:"ArrowRight",BOTTOM:"ArrowDown"},this.mouseButtons={LEFT:Jn.ROTATE,MIDDLE:Jn.DOLLY,RIGHT:Jn.PAN},this.touches={ONE:Qn.ROTATE,TWO:Qn.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._domElementKeyEvents=null,this.getPolarAngle=function(){return a.phi},this.getAzimuthalAngle=function(){return a.theta},this.getDistance=function(){return this.object.position.distanceTo(this.target)},this.listenToKeyEvents=function(R){R.addEventListener("keydown",ee),this._domElementKeyEvents=R},this.stopListenToKeyEvents=function(){this._domElementKeyEvents.removeEventListener("keydown",ee),this._domElementKeyEvents=null},this.saveState=function(){n.target0.copy(n.target),n.position0.copy(n.object.position),n.zoom0=n.object.zoom},this.reset=function(){n.target.copy(n.target0),n.object.position.copy(n.position0),n.object.zoom=n.zoom0,n.object.updateProjectionMatrix(),n.dispatchEvent(Wo),n.update(),r=s.NONE},this.update=function(){const R=new I,j=new Yn().setFromUnitVectors(e.up,new I(0,1,0)),ue=j.clone().invert(),re=new I,Me=new Yn,ke=new I,je=2*Math.PI;return function(ce=null){const P=n.object.position;R.copy(P).sub(n.target),R.applyQuaternion(j),a.setFromVector3(R),n.autoRotate&&r===s.NONE&&F(x(ce)),n.enableDamping?(a.theta+=l.theta*n.dampingFactor,a.phi+=l.phi*n.dampingFactor):(a.theta+=l.theta,a.phi+=l.phi);let oe=n.minAzimuthAngle,le=n.maxAzimuthAngle;isFinite(oe)&&isFinite(le)&&(oe<-Math.PI?oe+=je:oe>Math.PI&&(oe-=je),le<-Math.PI?le+=je:le>Math.PI&&(le-=je),oe<=le?a.theta=Math.max(oe,Math.min(le,a.theta)):a.theta=a.theta>(oe+le)/2?Math.max(oe,a.theta):Math.min(le,a.theta)),a.phi=Math.max(n.minPolarAngle,Math.min(n.maxPolarAngle,a.phi)),a.makeSafe(),n.enableDamping===!0?n.target.addScaledVector(h,n.dampingFactor):n.target.add(h),n.target.sub(n.cursor),n.target.clampLength(n.minTargetRadius,n.maxTargetRadius),n.target.add(n.cursor),n.zoomToCursor&&w||n.object.isOrthographicCamera?a.radius=$(a.radius):a.radius=$(a.radius*c),R.setFromSpherical(a),R.applyQuaternion(ue),P.copy(n.target).add(R),n.object.lookAt(n.target),n.enableDamping===!0?(l.theta*=1-n.dampingFactor,l.phi*=1-n.dampingFactor,h.multiplyScalar(1-n.dampingFactor)):(l.set(0,0,0),h.set(0,0,0));let we=!1;if(n.zoomToCursor&&w){let Ee=null;if(n.object.isPerspectiveCamera){const Ke=R.length();Ee=$(Ke*c);const Je=Ke-Ee;n.object.position.addScaledVector(b,Je),n.object.updateMatrixWorld()}else if(n.object.isOrthographicCamera){const Ke=new I(C.x,C.y,0);Ke.unproject(n.object),n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/c)),n.object.updateProjectionMatrix(),we=!0;const Je=new I(C.x,C.y,0);Je.unproject(n.object),n.object.position.sub(Je).add(Ke),n.object.updateMatrixWorld(),Ee=R.length()}else console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."),n.zoomToCursor=!1;Ee!==null&&(this.screenSpacePanning?n.target.set(0,0,-1).transformDirection(n.object.matrix).multiplyScalar(Ee).add(n.object.position):(_s.origin.copy(n.object.position),_s.direction.set(0,0,-1).transformDirection(n.object.matrix),Math.abs(n.object.up.dot(_s.direction))<mg?e.lookAt(n.target):($o.setFromNormalAndCoplanarPoint(n.object.up,n.target),_s.intersectPlane($o,n.target))))}else n.object.isOrthographicCamera&&(n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/c)),n.object.updateProjectionMatrix(),we=!0);return c=1,w=!1,we||re.distanceToSquared(n.object.position)>o||8*(1-Me.dot(n.object.quaternion))>o||ke.distanceToSquared(n.target)>0?(n.dispatchEvent(Wo),re.copy(n.object.position),Me.copy(n.object.quaternion),ke.copy(n.target),!0):!1}}(),this.dispose=function(){n.domElement.removeEventListener("contextmenu",ge),n.domElement.removeEventListener("pointerdown",Ne),n.domElement.removeEventListener("pointercancel",S),n.domElement.removeEventListener("wheel",J),n.domElement.removeEventListener("pointermove",T),n.domElement.removeEventListener("pointerup",S),n._domElementKeyEvents!==null&&(n._domElementKeyEvents.removeEventListener("keydown",ee),n._domElementKeyEvents=null)};const n=this,s={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6};let r=s.NONE;const o=1e-6,a=new ko,l=new ko;let c=1;const h=new I,d=new Ae,p=new Ae,f=new Ae,g=new Ae,_=new Ae,m=new Ae,u=new Ae,M=new Ae,v=new Ae,b=new I,C=new Ae;let w=!1;const A=[],U={};function x(R){return R!==null?2*Math.PI/60*n.autoRotateSpeed*R:2*Math.PI/60/60*n.autoRotateSpeed}function E(R){const j=Math.abs(R)/(100*(window.devicePixelRatio|0));return Math.pow(.95,n.zoomSpeed*j)}function F(R){l.theta-=R}function V(R){l.phi-=R}const ne=function(){const R=new I;return function(ue,re){R.setFromMatrixColumn(re,0),R.multiplyScalar(-ue),h.add(R)}}(),D=function(){const R=new I;return function(ue,re){n.screenSpacePanning===!0?R.setFromMatrixColumn(re,1):(R.setFromMatrixColumn(re,0),R.crossVectors(n.object.up,R)),R.multiplyScalar(ue),h.add(R)}}(),O=function(){const R=new I;return function(ue,re){const Me=n.domElement;if(n.object.isPerspectiveCamera){const ke=n.object.position;R.copy(ke).sub(n.target);let je=R.length();je*=Math.tan(n.object.fov/2*Math.PI/180),ne(2*ue*je/Me.clientHeight,n.object.matrix),D(2*re*je/Me.clientHeight,n.object.matrix)}else n.object.isOrthographicCamera?(ne(ue*(n.object.right-n.object.left)/n.object.zoom/Me.clientWidth,n.object.matrix),D(re*(n.object.top-n.object.bottom)/n.object.zoom/Me.clientHeight,n.object.matrix)):(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."),n.enablePan=!1)}}();function X(R){n.object.isPerspectiveCamera||n.object.isOrthographicCamera?c/=R:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),n.enableZoom=!1)}function Y(R){n.object.isPerspectiveCamera||n.object.isOrthographicCamera?c*=R:(console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."),n.enableZoom=!1)}function q(R,j){if(!n.zoomToCursor)return;w=!0;const ue=n.domElement.getBoundingClientRect(),re=R-ue.left,Me=j-ue.top,ke=ue.width,je=ue.height;C.x=re/ke*2-1,C.y=-(Me/je)*2+1,b.set(C.x,C.y,1).unproject(n.object).sub(n.object.position).normalize()}function $(R){return Math.max(n.minDistance,Math.min(n.maxDistance,R))}function Q(R){d.set(R.clientX,R.clientY)}function ie(R){q(R.clientX,R.clientX),u.set(R.clientX,R.clientY)}function pe(R){g.set(R.clientX,R.clientY)}function W(R){p.set(R.clientX,R.clientY),f.subVectors(p,d).multiplyScalar(n.rotateSpeed);const j=n.domElement;F(2*Math.PI*f.x/j.clientHeight),V(2*Math.PI*f.y/j.clientHeight),d.copy(p),n.update()}function K(R){M.set(R.clientX,R.clientY),v.subVectors(M,u),v.y>0?X(E(v.y)):v.y<0&&Y(E(v.y)),u.copy(M),n.update()}function fe(R){_.set(R.clientX,R.clientY),m.subVectors(_,g).multiplyScalar(n.panSpeed),O(m.x,m.y),g.copy(_),n.update()}function Se(R){q(R.clientX,R.clientY),R.deltaY<0?Y(E(R.deltaY)):R.deltaY>0&&X(E(R.deltaY)),n.update()}function xe(R){let j=!1;switch(R.code){case n.keys.UP:R.ctrlKey||R.metaKey||R.shiftKey?V(2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):O(0,n.keyPanSpeed),j=!0;break;case n.keys.BOTTOM:R.ctrlKey||R.metaKey||R.shiftKey?V(-2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):O(0,-n.keyPanSpeed),j=!0;break;case n.keys.LEFT:R.ctrlKey||R.metaKey||R.shiftKey?F(2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):O(n.keyPanSpeed,0),j=!0;break;case n.keys.RIGHT:R.ctrlKey||R.metaKey||R.shiftKey?F(-2*Math.PI*n.rotateSpeed/n.domElement.clientHeight):O(-n.keyPanSpeed,0),j=!0;break}j&&(R.preventDefault(),n.update())}function Ue(R){if(A.length===1)d.set(R.pageX,R.pageY);else{const j=Ye(R),ue=.5*(R.pageX+j.x),re=.5*(R.pageY+j.y);d.set(ue,re)}}function Ie(R){if(A.length===1)g.set(R.pageX,R.pageY);else{const j=Ye(R),ue=.5*(R.pageX+j.x),re=.5*(R.pageY+j.y);g.set(ue,re)}}function Re(R){const j=Ye(R),ue=R.pageX-j.x,re=R.pageY-j.y,Me=Math.sqrt(ue*ue+re*re);u.set(0,Me)}function qe(R){n.enableZoom&&Re(R),n.enablePan&&Ie(R)}function B(R){n.enableZoom&&Re(R),n.enableRotate&&Ue(R)}function mt(R){if(A.length==1)p.set(R.pageX,R.pageY);else{const ue=Ye(R),re=.5*(R.pageX+ue.x),Me=.5*(R.pageY+ue.y);p.set(re,Me)}f.subVectors(p,d).multiplyScalar(n.rotateSpeed);const j=n.domElement;F(2*Math.PI*f.x/j.clientHeight),V(2*Math.PI*f.y/j.clientHeight),d.copy(p)}function Te(R){if(A.length===1)_.set(R.pageX,R.pageY);else{const j=Ye(R),ue=.5*(R.pageX+j.x),re=.5*(R.pageY+j.y);_.set(ue,re)}m.subVectors(_,g).multiplyScalar(n.panSpeed),O(m.x,m.y),g.copy(_)}function Pe(R){const j=Ye(R),ue=R.pageX-j.x,re=R.pageY-j.y,Me=Math.sqrt(ue*ue+re*re);M.set(0,Me),v.set(0,Math.pow(M.y/u.y,n.zoomSpeed)),X(v.y),u.copy(M);const ke=(R.pageX+j.x)*.5,je=(R.pageY+j.y)*.5;q(ke,je)}function _e(R){n.enableZoom&&Pe(R),n.enablePan&&Te(R)}function tt(R){n.enableZoom&&Pe(R),n.enableRotate&&mt(R)}function Ne(R){n.enabled!==!1&&(A.length===0&&(n.domElement.setPointerCapture(R.pointerId),n.domElement.addEventListener("pointermove",T),n.domElement.addEventListener("pointerup",S)),Ce(R),R.pointerType==="touch"?ve(R):z(R))}function T(R){n.enabled!==!1&&(R.pointerType==="touch"?de(R):te(R))}function S(R){Oe(R),A.length===0&&(n.domElement.releasePointerCapture(R.pointerId),n.domElement.removeEventListener("pointermove",T),n.domElement.removeEventListener("pointerup",S)),n.dispatchEvent(Xo),r=s.NONE}function z(R){let j;switch(R.button){case 0:j=n.mouseButtons.LEFT;break;case 1:j=n.mouseButtons.MIDDLE;break;case 2:j=n.mouseButtons.RIGHT;break;default:j=-1}switch(j){case Jn.DOLLY:if(n.enableZoom===!1)return;ie(R),r=s.DOLLY;break;case Jn.ROTATE:if(R.ctrlKey||R.metaKey||R.shiftKey){if(n.enablePan===!1)return;pe(R),r=s.PAN}else{if(n.enableRotate===!1)return;Q(R),r=s.ROTATE}break;case Jn.PAN:if(R.ctrlKey||R.metaKey||R.shiftKey){if(n.enableRotate===!1)return;Q(R),r=s.ROTATE}else{if(n.enablePan===!1)return;pe(R),r=s.PAN}break;default:r=s.NONE}r!==s.NONE&&n.dispatchEvent(Er)}function te(R){switch(r){case s.ROTATE:if(n.enableRotate===!1)return;W(R);break;case s.DOLLY:if(n.enableZoom===!1)return;K(R);break;case s.PAN:if(n.enablePan===!1)return;fe(R);break}}function J(R){n.enabled===!1||n.enableZoom===!1||r!==s.NONE||(R.preventDefault(),n.dispatchEvent(Er),Se(R),n.dispatchEvent(Xo))}function ee(R){n.enabled===!1||n.enablePan===!1||xe(R)}function ve(R){switch(Z(R),A.length){case 1:switch(n.touches.ONE){case Qn.ROTATE:if(n.enableRotate===!1)return;Ue(R),r=s.TOUCH_ROTATE;break;case Qn.PAN:if(n.enablePan===!1)return;Ie(R),r=s.TOUCH_PAN;break;default:r=s.NONE}break;case 2:switch(n.touches.TWO){case Qn.DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;qe(R),r=s.TOUCH_DOLLY_PAN;break;case Qn.DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;B(R),r=s.TOUCH_DOLLY_ROTATE;break;default:r=s.NONE}break;default:r=s.NONE}r!==s.NONE&&n.dispatchEvent(Er)}function de(R){switch(Z(R),r){case s.TOUCH_ROTATE:if(n.enableRotate===!1)return;mt(R),n.update();break;case s.TOUCH_PAN:if(n.enablePan===!1)return;Te(R),n.update();break;case s.TOUCH_DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;_e(R),n.update();break;case s.TOUCH_DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;tt(R),n.update();break;default:r=s.NONE}}function ge(R){n.enabled!==!1&&R.preventDefault()}function Ce(R){A.push(R.pointerId)}function Oe(R){delete U[R.pointerId];for(let j=0;j<A.length;j++)if(A[j]==R.pointerId){A.splice(j,1);return}}function Z(R){let j=U[R.pointerId];j===void 0&&(j=new Ae,U[R.pointerId]=j),j.set(R.pageX,R.pageY)}function Ye(R){const j=R.pointerId===A[0]?A[1]:A[0];return U[j]}n.domElement.addEventListener("contextmenu",ge),n.domElement.addEventListener("pointerdown",Ne),n.domElement.addEventListener("pointercancel",S),n.domElement.addEventListener("wheel",J,{passive:!1}),this.update()}}const _g={name:"CopyShader",uniforms:{tDiffuse:{value:null},opacity:{value:1}},vertexShader:`

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


		}`};class Fs{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error("THREE.Pass: .render() must be implemented in derived pass.")}dispose(){}}const vg=new Us(-1,1,1,-1,0,1);class xg extends $t{constructor(){super(),this.setAttribute("position",new ct([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new ct([0,2,0,0,2,0],2))}}const Mg=new xg;class Sg{constructor(e){this._mesh=new be(Mg,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,vg)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}}class zr extends Fs{constructor(e,t){super(),this.textureID=t!==void 0?t:"tDiffuse",e instanceof xn?(this.uniforms=e.uniforms,this.material=e):e&&(this.uniforms=Il.clone(e.uniforms),this.material=new xn({name:e.name!==void 0?e.name:"unspecified",defines:Object.assign({},e.defines),uniforms:this.uniforms,vertexShader:e.vertexShader,fragmentShader:e.fragmentShader})),this.fsQuad=new Sg(this.material)}render(e,t,n){this.uniforms[this.textureID]&&(this.uniforms[this.textureID].value=n.texture),this.fsQuad.material=this.material,this.renderToScreen?(e.setRenderTarget(null),this.fsQuad.render(e)):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this.fsQuad.render(e))}dispose(){this.material.dispose(),this.fsQuad.dispose()}}class qo extends Fs{constructor(e,t){super(),this.scene=e,this.camera=t,this.clear=!0,this.needsSwap=!1,this.inverse=!1}render(e,t,n){const s=e.getContext(),r=e.state;r.buffers.color.setMask(!1),r.buffers.depth.setMask(!1),r.buffers.color.setLocked(!0),r.buffers.depth.setLocked(!0);let o,a;this.inverse?(o=0,a=1):(o=1,a=0),r.buffers.stencil.setTest(!0),r.buffers.stencil.setOp(s.REPLACE,s.REPLACE,s.REPLACE),r.buffers.stencil.setFunc(s.ALWAYS,o,4294967295),r.buffers.stencil.setClear(a),r.buffers.stencil.setLocked(!0),e.setRenderTarget(n),this.clear&&e.clear(),e.render(this.scene,this.camera),e.setRenderTarget(t),this.clear&&e.clear(),e.render(this.scene,this.camera),r.buffers.color.setLocked(!1),r.buffers.depth.setLocked(!1),r.buffers.color.setMask(!0),r.buffers.depth.setMask(!0),r.buffers.stencil.setLocked(!1),r.buffers.stencil.setFunc(s.EQUAL,1,4294967295),r.buffers.stencil.setOp(s.KEEP,s.KEEP,s.KEEP),r.buffers.stencil.setLocked(!0)}}class Eg extends Fs{constructor(){super(),this.needsSwap=!1}render(e){e.state.buffers.stencil.setLocked(!1),e.state.buffers.stencil.setTest(!1)}}class yg{constructor(e,t){if(this.renderer=e,this._pixelRatio=e.getPixelRatio(),t===void 0){const n=e.getSize(new Ae);this._width=n.width,this._height=n.height,t=new Un(this._width*this._pixelRatio,this._height*this._pixelRatio,{type:yi}),t.texture.name="EffectComposer.rt1"}else this._width=t.width,this._height=t.height;this.renderTarget1=t,this.renderTarget2=t.clone(),this.renderTarget2.texture.name="EffectComposer.rt2",this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2,this.renderToScreen=!0,this.passes=[],this.copyPass=new zr(_g),this.copyPass.material.blending=gn,this.clock=new fg}swapBuffers(){const e=this.readBuffer;this.readBuffer=this.writeBuffer,this.writeBuffer=e}addPass(e){this.passes.push(e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}insertPass(e,t){this.passes.splice(t,0,e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}removePass(e){const t=this.passes.indexOf(e);t!==-1&&this.passes.splice(t,1)}isLastEnabledPass(e){for(let t=e+1;t<this.passes.length;t++)if(this.passes[t].enabled)return!1;return!0}render(e){e===void 0&&(e=this.clock.getDelta());const t=this.renderer.getRenderTarget();let n=!1;for(let s=0,r=this.passes.length;s<r;s++){const o=this.passes[s];if(o.enabled!==!1){if(o.renderToScreen=this.renderToScreen&&this.isLastEnabledPass(s),o.render(this.renderer,this.writeBuffer,this.readBuffer,e,n),o.needsSwap){if(n){const a=this.renderer.getContext(),l=this.renderer.state.buffers.stencil;l.setFunc(a.NOTEQUAL,1,4294967295),this.copyPass.render(this.renderer,this.writeBuffer,this.readBuffer,e),l.setFunc(a.EQUAL,1,4294967295)}this.swapBuffers()}qo!==void 0&&(o instanceof qo?n=!0:o instanceof Eg&&(n=!1))}}this.renderer.setRenderTarget(t)}reset(e){if(e===void 0){const t=this.renderer.getSize(new Ae);this._pixelRatio=this.renderer.getPixelRatio(),this._width=t.width,this._height=t.height,e=this.renderTarget1.clone(),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.renderTarget1=e,this.renderTarget2=e.clone(),this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2}setSize(e,t){this._width=e,this._height=t;const n=this._width*this._pixelRatio,s=this._height*this._pixelRatio;this.renderTarget1.setSize(n,s),this.renderTarget2.setSize(n,s);for(let r=0;r<this.passes.length;r++)this.passes[r].setSize(n,s)}setPixelRatio(e){this._pixelRatio=e,this.setSize(this._width,this._height)}dispose(){this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.copyPass.dispose()}}class Tg extends Fs{constructor(e,t,n=null,s=null,r=null){super(),this.scene=e,this.camera=t,this.overrideMaterial=n,this.clearColor=s,this.clearAlpha=r,this.clear=!0,this.clearDepth=!1,this.needsSwap=!1,this._oldClearColor=new $e}render(e,t,n){const s=e.autoClear;e.autoClear=!1;let r,o;this.overrideMaterial!==null&&(o=this.scene.overrideMaterial,this.scene.overrideMaterial=this.overrideMaterial),this.clearColor!==null&&(e.getClearColor(this._oldClearColor),e.setClearColor(this.clearColor)),this.clearAlpha!==null&&(r=e.getClearAlpha(),e.setClearAlpha(this.clearAlpha)),this.clearDepth==!0&&e.clearDepth(),e.setRenderTarget(this.renderToScreen?null:n),this.clear===!0&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),e.render(this.scene,this.camera),this.clearColor!==null&&e.setClearColor(this._oldClearColor),this.clearAlpha!==null&&e.setClearAlpha(r),this.overrideMaterial!==null&&(this.scene.overrideMaterial=o),e.autoClear=s}}function bg(i){const e=Xt(i.owner),t=e?e.color:16777215,n=i.type+"|"+t;let s=L._unitTpl[n];return s||(s=Ag(i.type,t),L._unitTpl[n]=s),s.clone(!0)}function Ag(i,e){const t=new Ft,n=We(e,{r:.55,m:.15}),s=We(e,{e,ei:.2}),r=We(2761240,{r:.7}),o=We(9080985,{r:.4,m:.7}),a=We(8016432,{r:.85}),l=We(15121288,{r:.7}),c=We(15392968,{r:.85}),h=We(16734794,{e:16726570,ei:.9}),d=new be(new _n(.34,.38,.1,16),We(1709069,{r:.8}));d.position.y=.05,d.receiveShadow=!0,t.add(d);const p=new be(new Xi(.33,.04,8,20),s);p.rotation.x=Math.PI/2,p.position.y=.06,t.add(p);const f=(v,b,C,w,A,U,x)=>(v.castShadow=!0,b!==void 0&&(v.position.x=b,v.position.y=C,v.position.z=w),A!==void 0&&(v.rotation.x=A,v.rotation.y=U||0,v.rotation.z=x||0),t.add(v),v),g=(v,b,C,w)=>new be(new it(v,b,C),w||n),_=(v,b,C,w,A)=>new be(new _n(v,b,C,A||10),w||n),m=(v,b,C,w)=>new be(new tn(v,b,8),C||n),u=(v,b)=>new be(new ea(v,10,10),b||n),M=v=>{f(_(.13,.16,.32,v||n),0,.3,0),f(u(.12,l),0,.55,0)};if(i==="founder")f(g(.42,.2,.3,a),0,.22,0),f(_(.2,.2,.42,c,12),0,.42,0,0,0,Math.PI/2),f(_(.12,.12,.05,r,12),.16,.13,.18,Math.PI/2,0,0),f(_(.12,.12,.05,r,12),-.16,.13,.18,Math.PI/2,0,0);else if(i==="rambler")M(n),f(g(.12,.16,.09,r),-.12,.4,0),f(_(.02,.02,.6,a,5),.17,.4,0),f(m(.1,.1,s),0,.7,0);else if(i==="guard")M(n),f(_(.16,.16,.04,s,16),.2,.34,0,0,0,Math.PI/2),f(_(.02,.02,.58,o,5),-.18,.4,0);else if(i==="armed")M(n),f(g(.04,.4,.3,o),.2,.4,0),f(g(.04,.5,.04,a),-.16,.44,.05,.18,0,0),f(_(.015,.015,.16,o,5),-.16,.72,.08);else if(i==="pike")f(g(.22,.48,.16,n),0,.36,0),f(u(.12,l),0,.66,0),f(g(.04,.36,.26,s),-.18,.38,0),f(_(.02,.02,1,o,5),.18,.58,0),f(m(.04,.12,o),.18,1.12,0);else if(i==="pony")f(g(.46,.18,.2,a),0,.3,0),f(g(.12,.2,.12,a),.24,.4,0),f(g(.18,.12,.12,a),.32,.48,0),f(g(.05,.22,.05,r),.18,.12,.13),f(g(.05,.22,.05,r),-.18,.12,.13),f(g(.05,.22,.05,r),.18,.12,-.13),f(g(.05,.22,.05,r),-.18,.12,-.13),f(g(.16,.18,.16,n),-.04,.5,0),f(u(.1,l),-.04,.64,0);else if(i==="gun")f(g(.3,.12,.18,r),0,.2,0),f(_(.06,.07,.6,o,12),.06,.34,0,0,0,-.5),f(g(.34,.05,.05,r),-.22,.12,0),f(_(.18,.18,.05,a,14),0,.18,.16,Math.PI/2,0,0),f(_(.18,.18,.05,a,14),0,.18,-.16,Math.PI/2,0,0);else if(i==="ironclad")f(g(.5,.14,.12,r),0,.13,.16),f(g(.5,.14,.12,r),0,.13,-.16),f(g(.44,.18,.34,n),0,.3,0),f(_(.16,.18,.16,o,12),0,.46,0),f(_(.05,.05,.34,o,8),.26,.46,0,0,0,Math.PI/2),f(_(.04,.05,.18,r,8),-.16,.55,0);else if(i==="skylark")f(_(.02,.02,.6,r,5),0,.38,0),f(g(.5,.1,.1,n),0,.72,0),f(g(.12,.04,.6,s),0,.8,0),f(g(.12,.04,.6,s),0,.64,0),f(g(.1,.16,.03,r),-.22,.8,0),f(_(.02,.02,.24,r,5),.27,.72,0,Math.PI/2,0,0),f(u(.04,o),.28,.72,0);else if(i==="nightmail")f(_(.12,.12,.42,We(2106414,{m:.5,r:.3}),12),.08,.28,0,0,0,Math.PI/2),f(g(.16,.24,.26,We(1447967)),-.18,.34,0),f(_(.04,.05,.16,r,8),.14,.46,0),f(u(.05,h),.3,.28,0),f(_(.08,.08,.04,o,12),.02,.13,.14,Math.PI/2,0,0),f(_(.08,.08,.04,o,12),.02,.13,-.14,Math.PI/2,0,0);else if(i==="colossus"){const v=We(11621434,{r:.95}),b=We(9060400,{r:.95});f(_(.22,.22,.62,v,14),.05,.42,0,0,0,Math.PI/2),f(g(.3,.4,.5,b),-.32,.46,0),f(_(.1,.12,.4,r,10),.26,.84,0),f(u(.09,s),.42,.46,0),f(_(.16,.16,.06,r,14),.18,.18,.26,Math.PI/2,0,0),f(_(.16,.16,.06,r,14),.18,.18,-.26,Math.PI/2,0,0),f(_(.16,.16,.06,r,14),-.18,.18,.26,Math.PI/2,0,0),f(_(.16,.16,.06,r,14),-.18,.18,-.26,Math.PI/2,0,0),d.scale.set(1.7,1,1.7)}else if(i==="monitor"){const v=We(2897216,{m:.4,r:.4});f(g(.6,.12,.26,v),0,.16,0),f(g(.5,.08,.2,v),0,.26,0),f(_(.12,.14,.12,o,12),-.02,.36,0),f(_(.05,.05,.28,o,8),.14,.4,0,0,0,Math.PI/2),f(_(.04,.05,.18,r,8),-.16,.42,0),f(g(.04,.18,.04,n),0,.46,0),f(m(.06,.1,s),0,.6,0)}else if(i==="lighter"){const v=We(7031340,{r:.85});f(g(.62,.14,.3,v),0,.16,0),f(g(.5,.04,.22,We(4862752)),0,.24,0),f(g(.04,.34,.04,a),-.18,.4,0),f(g(.02,.26,.22,c),-.06,.42,0,0,0,0),f(g(.62,.03,.04,a),0,.24,.15),f(g(.62,.03,.04,a),0,.24,-.15)}else f(g(.36,.4,.36,n),0,.3,0);return t}function wg(i){const e=Xt(i.owner),t=e?e.color:10066329,n=t+"|"+i.level+"|"+(i.walls?1:0)+"|"+(i.isCapital?1:0);let s=L._cityTpl[n];return s||(s=Rg(i,t),L._cityTpl[n]=s),s.clone(!0)}function Rg(i,e){const t=new Ft,n=br(i.level,1,Ar),s=We(e,{r:.55}),r=We(15392196,{r:.85}),o=We(13287334,{r:.9}),a=We(3812381),l=We(10115642,{r:.9}),c=We(7311280,{r:.25,m:.55,e:2767434,ei:.18}),h=We(12169892,{r:.9}),d=.42+n*.022,p=new be(new _n(d,d+.04,.1,18),o);p.position.y=.05,p.receiveShadow=!0,t.add(p);const f=n<=3?.3+n*.05:n<=6?.5+n*.09:.7+n*.18;if(n<=6){const u=new be(new it(.3,f,.3),r);u.position.y=f/2+.08,u.castShadow=!0,t.add(u);const M=new be(new tn(.27,.2,4),s);M.position.y=f+.18,M.rotation.y=.78,M.castShadow=!0,t.add(M)}else{const u=new be(new it(.26,f,.26),c);u.position.y=f/2+.08,u.castShadow=!0,t.add(u);const M=new be(new it(.1,.24,.1),s);M.position.y=f+.2,M.castShadow=!0,t.add(M)}if(n>=3){const u=new be(new _n(.05,.06,.4+n*.04,8),l);u.position.set(.22,.3,.16),u.castShadow=!0,t.add(u)}const g=Math.min(2+n*3,30),_=n<=3?1:n<=6?2:3;let m=0;for(let u=0;u<_&&m<g;u++){const M=Math.ceil(g/_),v=.26+u*.18+d*.25;for(let b=0;b<M&&m<g;b++,m++){const C=b/M*6.28+u*.9+b*.5,w=Math.cos(C)*v,A=Math.sin(C)*v;if(n>=7){const U=.5+(3-u)*.35+b*53%5*.12+(n-7)*.18,x=.12-u*.012,E=new be(new it(x,U,x),b%2?c:h);E.position.set(w,U/2+.08,A),E.castShadow=!0,t.add(E);const F=new be(new it(.02,.12,.02),a);F.position.set(w,U+.14,A),t.add(F)}else if(n>=4){const U=.24+b*97%5*.06+u*.05,x=new be(new it(.17,U,.17),r);x.position.set(w,U/2+.08,A),x.castShadow=!0,t.add(x);const E=new be(new it(.18,.04,.18),s);E.position.set(w,U+.1,A),E.castShadow=!0,t.add(E)}else{const U=.15+b*97%4*.035,x=new be(new it(.14,U,.14),r);x.position.set(w,U/2+.08,A),x.castShadow=!0,t.add(x);const E=new be(new tn(.12,.12,4),s);E.position.set(w,U+.13,A),E.rotation.y=.78,E.castShadow=!0,t.add(E)}}}if(i.walls){const u=new be(new Xi(d-.02,.05,6,20),We(12103840));u.rotation.x=Math.PI/2,u.position.y=.1,t.add(u)}if(i.isCapital){const u=f+.5,M=new be(new it(.14,u,.14),o);M.position.set(0,u/2+.08,0),M.castShadow=!0,t.add(M);const v=new be(new tn(.12,.18,4),s);v.position.y=u+.18,v.rotation.y=.78,t.add(v);const b=new be(new _n(.02,.02,.5,6),a);b.position.set(0,u+.45,0),t.add(b);const C=new be(new it(.02,.16,.26),We(e,{e,ei:.5}));C.position.set(0,u+.58,.13),t.add(C)}return t}function Cg(i,e){const t=se.G;if(!L.terrGroup)return;L.terrGroup.clear(),L._fillGeo||(L._fillGeo=new Wi(kt*.98,kt*.98),L._edgeGeoX=new it(.07,.08,kt*.96),L._edgeGeoZ=new it(kt*.96,.08,.07));const n=(r,o)=>!e||i.explored.has(Ui(r,o)),s=t._ownedTiles||[];for(const r of s){const o=r.x,a=r.z;if(!r.owner||!n(o,a))continue;const l=Xt(r.owner);if(!l)continue;const c=l.color,h=Vn[r.terrain].h*qn;for(const[d,p]of[[1,0],[-1,0],[0,1],[0,-1]]){const f=o+d,g=a+p,_=el(f,g)?rn(f,g):null;if(!_||_.owner!==r.owner){const m=new be(d?L._edgeGeoX:L._edgeGeoZ,Ig(c));m.position.set(ot(o)+d*.49*kt,h+.07,lt(a)+p*.49*kt),L.terrGroup.add(m)}}}}function Bt(){const i=se.G;L.dynGroup.clear(),L.bobUnits=[];const e=i.mode==="campaign"?Qo():null,t=!!e;for(const n of L.tilePickMeshes){const{tx:s,tz:r,base:o}=n.userData,a=!t||e.explored.has(Ui(s,r)),l=rn(s,r),c=new $e(o);if(!a)c.multiplyScalar(.16),c.offsetHSL(0,-.45,-.02);else if(l.owner){const h=Xt(l.owner);h&&c.lerp(new $e(h.color),.25)}n.material.color.copy(c),n.userData.visible=a}for(const n of L.decoMeshes)n.o.visible=!t||e.explored.has(Ui(n.tx,n.tz));Cg(e,t);for(const n of i.cities){if(t&&!e.explored.has(Ui(n.x,n.z)))continue;const s=wg(n),r=Vn[rn(n.x,n.z).terrain].h*qn;s.position.set(ot(n.x),r,lt(n.z)),s.userData={kind:"city",ref:n},L.dynGroup.add(s)}for(const n of i.units){if(n.hp<=0||t&&n.owner!==e.id&&(!sc(e,n.x,n.z)||rc(n,e.id)))continue;const s=bg(n),r=Vn[rn(n.x,n.z).terrain].h*qn,o=Kt[n.type].domain==="air",a=r+Vo+(o?.8:0);if(s.userData={kind:"unit",ref:n},s.userData.baseY=a,s.position.set(ot(n.x),a,lt(n.z)),n._animFrom){const l=ac()-(n._animStart||0),c=n._animDur||300;if(l<c&&el(n._animFrom.x,n._animFrom.z)){const h=Vn[rn(n._animFrom.x,n._animFrom.z).terrain].h*qn+Vo+(o?.8:0);s.userData.anim={fx:ot(n._animFrom.x),fz:lt(n._animFrom.z),tx:ot(n.x),tz:lt(n.z),fy:h,ty:a,start:n._animStart||0,dur:c,unit:n},s.position.x=s.userData.anim.fx,s.position.z=s.userData.anim.fz,s.position.y=h}else n._animFrom=null}L.dynGroup.add(s),L.bobUnits.push(s)}jn(),L.renderer&&(L.renderer.shadowMap.needsUpdate=!0)}function jn(){const i=se.G;if(L.highlightGroup.clear(),!i.sel)return;const e=i.sel;if(i.reach)for(const t of i.reach.set){const[n,s]=t.split(",").map(Number);vs(n,s,4830975,.5)}if(i.atks)for(const t of i.atks)vs(t.x,t.z,16733508,.7);Kt[e.type].role==="settle"&&Gr(e,e.x,e.z)&&vs(e.x,e.z,7331962,.7),vs(e.x,e.z,16769658,.85)}function vs(i,e,t,n,s){const r=Vn[rn(i,e).terrain].h*qn,o=new be(new Wi(kt*.92,kt*.92),new Ds({color:t,transparent:!0,opacity:n,depthWrite:!1}));o.rotation.x=-Math.PI/2,o.position.set(ot(i),r+.03,lt(e)),L.highlightGroup.add(o)}function Lg(){L.raycaster.setFromCamera(L.pointer,L.camera);const i=L.raycaster.intersectObjects(L.tilePickMeshes,!1);return i.length?i[0].object.userData:null}function Pg(){const i=se.N;se.FR=Math.max(11,i*.62);const e=Math.max(20,i*1.15);L.camera.position.set(e,e*1.2,e),L.camera.lookAt(0,0,0);const t=innerWidth/innerHeight;if(L.camera.left=-se.FR*t,L.camera.right=se.FR*t,L.camera.top=se.FR,L.camera.bottom=-se.FR,L.camera.zoom=1,L.camera.updateProjectionMatrix(),L.sun){const n=Math.max(20,i*.85),s=L.sun.shadow.camera;s.left=-n,s.right=n,s.top=n,s.bottom=-n,s.far=i*5,s.updateProjectionMatrix&&s.updateProjectionMatrix()}L.scene&&L.scene.fog&&(L.scene.fog.near=i*1.15,L.scene.fog.far=i*2.6),L.controls&&L.controls.target.set(0,0,0),L.renderer&&(L.renderer.shadowMap.needsUpdate=!0)}function Xl(){const i=se.G,e=se.N;L.controls.target.set(0,0,0);const t=Qo();if(t){const n=i.cities.find(s=>s.owner===t.id&&s.isCapital)||i.cities.find(s=>s.owner===t.id);n&&L.controls.target.set(ot(n.x),0,lt(n.z))}L.camera.zoom=e<=12?1.15:1,L.camera.updateProjectionMatrix()}function Dg(i){const e=L.panKeys.size>0;if(!e&&(!L.panV||L.panV.lengthSq()<1e-6))return L.panRamp=0,L.lastPanT=i,!1;if(!L.controls||!L.camera)return!1;let t=(i-L.lastPanT)/1e3;L.lastPanT=i,(!(t>0)||t>.12)&&(t=.016),L.panV||(L.panV=new I);const n=new I(0,0,-1).applyQuaternion(L.camera.quaternion);n.y=0,n.lengthSq()<1e-6&&n.set(0,0,-1),n.normalize();const s=new I(1,0,0).applyQuaternion(L.camera.quaternion);s.y=0,s.normalize();const r=new I;L.panKeys.has("up")&&r.add(n),L.panKeys.has("down")&&r.addScaledVector(n,-1),L.panKeys.has("right")&&r.add(s),L.panKeys.has("left")&&r.addScaledVector(s,-1);let o;if(e&&r.lengthSq()>0){r.normalize(),L.panRamp=Math.min(1,L.panRamp+t/1.3);const l=se.FR*.16,c=se.FR*1.25;o=r.multiplyScalar(l+(c-l)*L.panRamp*L.panRamp)}else L.panRamp=0,o=new I;const a=1-Math.exp(-t*(o.lengthSq()>0?6.5:9));return L.panV.x+=(o.x-L.panV.x)*a,L.panV.z+=(o.z-L.panV.z)*a,L.panV.lengthSq()<2e-4&&!e?(L.panV.set(0,0,0),!1):(L.camera.position.x+=L.panV.x*t,L.camera.position.z+=L.panV.z*t,L.controls.target.x+=L.panV.x*t,L.controls.target.z+=L.panV.z*t,!0)}function Ug(i){L.pointer.x=i.clientX/innerWidth*2-1,L.pointer.y=-(i.clientY/innerHeight)*2+1}function $l(i){requestAnimationFrame($l);const e=se.G,t=Dg(i);L.controls.update();const n=i<(e&&e._animUntil||0);if(!(!t&&!n&&i-L.lastT<33)){L.lastT=i;for(const s of L.bobUnits){const r=s.userData.anim;if(r){let o=(i-r.start)/r.dur;o>=1&&(o=1,s.userData.anim=null,r.unit&&r.unit._animFrom&&(r.unit._animFrom=null));const a=1-Math.pow(1-o,3);s.position.x=r.fx+(r.tx-r.fx)*a,s.position.z=r.fz+(r.tz-r.fz)*a,s.position.y=r.fy+(r.ty-r.fy)*a}else s.position.y=s.userData.baseY}L.composer.render()}}function Ig(i){return L._edgeMat[i]||(L._edgeMat[i]=new Ds({color:i,transparent:!0,opacity:.85,depthWrite:!1}))}function We(i,e={}){return new lg({color:i,roughness:e.r??.9,metalness:e.m??0,flatShading:!0,transparent:e.t||!1,opacity:e.o??1,emissive:e.e??0,emissiveIntensity:e.ei??0})}function ql(){const i=document.getElementById("stage");L.renderer=new Wl({antialias:!0,powerPreference:"high-performance"}),L.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)),L.renderer.setSize(innerWidth,innerHeight),L.renderer.shadowMap.enabled=!0,L.renderer.shadowMap.type=dl,L.renderer.shadowMap.autoUpdate=!1,L.renderer.toneMapping=pl,L.renderer.toneMappingExposure=1.05,i.appendChild(L.renderer.domElement),L.scene=new og,L.scene.background=new $e(1912640),L.scene.fog=null;const e=innerWidth/innerHeight;L.camera=new Us(-se.FR*e,se.FR*e,se.FR,-se.FR,.1,1200),L.camera.position.set(34,40,34),L.camera.lookAt(0,0,0),L.controls=new gg(L.camera,L.renderer.domElement),L.controls.enableDamping=!0,L.controls.dampingFactor=.08,L.controls.minZoom=.55,L.controls.maxZoom=6,L.controls.maxPolarAngle=Math.PI*.46,L.controls.minPolarAngle=Math.PI*.12,L.controls.target.set(0,0,0),L.sun=new zo(16773334,1.5),L.sun.position.set(26,46,16),L.sun.castShadow=!0,L.sun.shadow.mapSize.set(2048,2048);const t=26,n=L.sun.shadow.camera;n.left=-t,n.right=t,n.top=t,n.bottom=-t,n.near=1,n.far=140,L.sun.shadow.bias=-6e-4,L.sun.shadow.normalBias=.02,L.scene.add(L.sun),L.scene.add(new dg(16777215,.45)),L.scene.add(new cg(14675711,6969924,.9));const s=new zo(13624063,.55);s.position.set(-24,30,-22),L.scene.add(s),L.staticGroup=new Ft,L.scene.add(L.staticGroup),L.dynGroup=new Ft,L.scene.add(L.dynGroup),L.fxGroup=new Ft,L.scene.add(L.fxGroup),L.terrGroup=new Ft,L.scene.add(L.terrGroup),L.highlightGroup=new Ft,L.scene.add(L.highlightGroup),L.composer=new yg(L.renderer),L.composer.addPass(new Tg(L.scene,L.camera)),L.passH=new zr(Yo),L.passH.uniforms.uDir.value.set(1,0),L.passV=new zr(Yo),L.passV.uniforms.uDir.value.set(0,1),L.passV.uniforms.uSat.value=1.22,L.passV.renderToScreen=!0,L.composer.addPass(L.passH),L.composer.addPass(L.passV),jo(),L.renderer.domElement.addEventListener("pointermove",Ug),L.renderer.domElement.addEventListener("click",r=>{L.onClick&&L.onClick(r)}),addEventListener("resize",jo),$l()}const Yo={uniforms:{tDiffuse:{value:null},uDir:{value:new Ae(1,0)},uTexel:{value:new Ae(1/1280,1/720)},uFocus:{value:.54},uBand:{value:.16},uStrength:{value:7},uSat:{value:1}},vertexShader:"varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",fragmentShader:`
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
    }`};function jo(){const i=innerWidth/innerHeight;L.camera.left=-se.FR*i,L.camera.right=se.FR*i,L.camera.top=se.FR,L.camera.bottom=-se.FR,L.camera.updateProjectionMatrix(),L.renderer.setSize(innerWidth,innerHeight),L.composer.setSize(innerWidth,innerHeight),L.passH.uniforms.uTexel.value.set(1/innerWidth,1/innerHeight),L.passV.uniforms.uTexel.value.set(1/innerWidth,1/innerHeight)}const ot=i=>(i-(se.N-1)/2)*kt,lt=i=>(i-(se.N-1)/2)*kt;function Ng(){return L._deco||(L._deco={tree:new tn(.22,.55,6),treeBig:new tn(.32,.9,7),trunk:new _n(.06,.08,.18,5),rock:new Jr(.22,0),peak:new tn(.46,.9,5),snow:new tn(.2,.3,5),gem:new Qr(.16,0),farm:new it(.62,.05,.62),mine:new it(.2,.18,.2),mill:new it(.22,.26,.22),wheel:new Xi(.12,.03,6,12),port:new it(.4,.06,.16),reed:new tn(.04,.22,4),treeMat:We(4160058),treeMat2:We(3106352),trunkMat:We(7031338),rockMat:We(10129280),snowMat:We(15921909,{r:.6}),farmMat:We(14201418,{r:.85}),mineMat:We(3551274,{r:.7}),millMat:We(11567184,{r:.85}),steelMat:We(9080985,{r:.4,m:.6}),reedMat:We(8367706,{r:.9})}),L._deco}function Fg(i,e){const t=se.N;if(t<=46)return!1;const n=t>=80?3:2;return(i*7+e*13)%n!==0}function Yl(i,e,t,n){const s=Ng(),r=l=>{l.userData.deco=!0,L.staticGroup.add(l),L.decoMeshes.push({o:l,tx:i,tz:e})};if(!Fg(i,e)){if(t.terrain==="lightforest"){const l=new Ft,c=new be(s.tree,s.treeMat);c.position.y=.5,c.castShadow=!0;const h=new be(s.trunk,s.trunkMat);h.position.y=.16,h.castShadow=!0,l.add(h,c),l.position.set(ot(i),n,lt(e)),l.rotation.y=(i*7+e*13)%62/10,r(l)}else if(t.terrain==="denseforest"){const l=new Ft,c=new be(s.treeBig,s.treeMat2);c.position.y=.68,c.castShadow=!0;const h=new be(s.trunk,s.trunkMat);h.position.y=.18,h.castShadow=!0;const d=new be(s.tree,s.treeMat);d.position.set(.2,.46,.18),d.castShadow=!0,l.add(h,c,d),l.position.set(ot(i),n,lt(e)),l.rotation.y=(i*7+e*13)%62/10,r(l)}else if(t.terrain==="hill"){const l=new be(s.rock,s.rockMat);l.position.set(ot(i)+.16,n+.16,lt(e)-.12),l.castShadow=!0,r(l)}else if(t.terrain==="mountain"){const l=new be(s.peak,s.rockMat);l.position.set(ot(i),n+.42,lt(e)),l.castShadow=!0,r(l);const c=new be(s.snow,s.snowMat);c.position.set(ot(i),n+.78,lt(e)),r(c)}else if(t.terrain==="river"){const l=new be(s.reed,s.reedMat);l.position.set(ot(i)+.24,n+.1,lt(e)+.2),l.castShadow=!0,r(l)}}if(t.resource){const l=Mi[t.resource],c=new be(s.gem,We(l.color,{e:l.color,ei:.25,m:.2,r:.4}));c.position.set(ot(i)+.28,n+.2,lt(e)+.28),c.castShadow=!0,c.userData.res=!0,r(c)}const a=t.improved;if(a==="farm"){const l=new be(s.farm,s.farmMat);l.position.set(ot(i),n+.02,lt(e)),r(l)}else if(a==="mine"){const l=new be(s.mine,s.mineMat);l.position.set(ot(i)-.18,n+.09,lt(e)-.18),l.castShadow=!0,r(l)}else if(a==="lumber"){const l=new be(s.mill,s.millMat);l.position.set(ot(i)-.16,n+.13,lt(e)-.16),l.castShadow=!0,r(l)}else if(a==="watermill"){const l=new be(s.mill,s.millMat);l.position.set(ot(i),n+.13,lt(e)),l.castShadow=!0,r(l);const c=new be(s.wheel,s.steelMat);c.rotation.y=Math.PI/2,c.position.set(ot(i)+.16,n+.12,lt(e)),r(c)}else if(a==="port"){const l=new be(s.port,s.millMat);l.position.set(ot(i),n+.04,lt(e)),l.castShadow=!0,r(l)}}function Og(){L.staticGroup.clear(),L.tilePickMeshes=[],L.waterMeshes=[],L.decoMeshes=[];const i=se.N;L._tileGeo||(L._tileGeo=new it(kt*.99,1,kt*.99));for(let t=0;t<i;t++)for(let n=0;n<i;n++){const s=rn(n,t),r=Vn[s.terrain],o=r.h*qn,a=new be(L._tileGeo,We(r.color));a.scale.y=o,a.position.set(ot(n),o/2,lt(t)),a.receiveShadow=!0,a.castShadow=!1,a.userData={tx:n,tz:t,base:r.color},L.staticGroup.add(a),L.tilePickMeshes.push(a),r.pass==="water"&&L.waterMeshes.push(a),Yl(n,t,s,o)}const e=new be(new it(i*2.2,.4,i*2.2),We(2447986,{r:.5}));e.position.y=-.2,e.receiveShadow=!0,L.staticGroup.add(e)}function na(i,e){const t=rn(i,e),n=Vn[t.terrain],s=n.h*qn,r=L.tilePickMeshes.find(o=>o.userData.tx===i&&o.userData.tz===e);r&&(r.scale.y=s,r.position.y=s/2,r.userData.base=n.color,r.material.color.set(n.color));for(let o=L.decoMeshes.length-1;o>=0;o--){const a=L.decoMeshes[o];a.tx===i&&a.tz===e&&(L.staticGroup.remove(a.o),L.decoMeshes.splice(o,1))}Yl(i,e,t,s),Bt()}function Bg(){L.renderer||ql(),tl({refreshTile:(i,e)=>na(i,e)})}function zg(i){L.onClick=i}const Vt=i=>document.getElementById(i),Ko={domain:"score"};function ia(){const i=se.G,e=se.knowledge;if(!e)return;Vt("brainGames").textContent=`${e.games} games`;let t='<div class="label" style="margin-bottom:8px">What the AI has learned</div>';const n=Object.entries(e.lessons).filter(([l])=>Vs[l]).sort((l,c)=>c[1].weight-l[1].weight);for(const[l,c]of n){const h=Math.round((c.weight||0)*100),d=Vs[l].type==="pattern";t+=`<div class="lesson"><div class="lt"><b>${d?"★ ":"⚠ "}${Vs[l].label}</b><span>${h}%</span></div>
      <div class="meter"><i style="width:${h}%;background:${d?"linear-gradient(90deg,#5a9e4e,#9bd07f)":"linear-gradient(90deg,var(--rust),var(--amber2))"}"></i></div></div>`}t+='<div class="label" style="margin:12px 0 8px">House strategies <span style="color:var(--faint)">(genome · W/L)</span></div>';const s=e.factions,r=i&&i.started?i.players.map(l=>l.id):Object.keys(s),o=new Set;for(const l of r){if(o.has(l))continue;o.add(l);const c=s[l],h=Hr.find(f=>f.id===l);if(!c||!h)continue;const d=c.genome||oc(),p="#"+h.color.toString(16).padStart(6,"0");t+=`<div class="gen-row"><span class="gc" style="background:${p}"></span><span class="gn" title="${h.name}">${h.name}</span>
      <div class="bars">`;for(const f of["aggression","expansion","economy","defense","tech","risk"]){const g=Math.round((d[f]||0)*100);t+=`<div class="barseg" title="${f} ${g}%"><i style="width:${g}%;background:${p}"></i></div>`}t+=`</div><span class="gw">${c.wins||0}/${c.losses||0}</span></div>`}const a=i&&i.started?i.players[i.cur]:null;a&&a.isAI&&a.lastThought&&(t+=`<div class="label" style="margin:12px 0 6px">Now thinking — ${a.name}</div><div class="desc">${a.lastThought}</div>`),Vt("brainBody").innerHTML=t}function Gg(){const i=se.G;if(i.mode!=="auto")return;i._obsTurn!==i.turn&&(i._obsTurn=i.turn,sa(),jl());const e=(i.pivots||[]).length;e!==i._pivN&&(i._pivN=e,Kl())}function sa(){const i=se.G;if(i.mode!=="auto")return;Vt("scoreTurn").textContent=`turn ${i.turn}`;const e=Ko.domain;Vt("domainRow").innerHTML=Object.entries(lc).map(([l,c])=>`<div class="chip ${l===e?"on":""}" data-dom="${l}" style="padding:5px 9px;font-size:10px">${c.label}</div>`).join(""),Vt("domainRow").querySelectorAll(".chip").forEach(l=>l.onclick=()=>{Ko.domain=l.dataset.dom,sa()});const t=i.scoreHist,n=252,s=128,r=4;if(t.length<2)Vt("scoreChart").innerHTML=`<div class="legend" style="height:${s}px;display:grid;place-items:center">gathering data…</div>`;else{let l=1;for(const _ of t)for(const m of i.players){const u=_.v[m.id]?.[e]||0;u>l&&(l=u)}const c=t[0].turn,h=t[t.length-1].turn||c+1,d=Math.max(1,h-c),p=_=>r+(_-c)/d*(n-2*r),f=_=>s-r-_/l*(s-2*r);let g=`<svg viewBox="0 0 ${n} ${s}" width="100%" style="display:block;background:var(--bg-base,#16110b);border:1px solid var(--line);border-radius:7px">`;for(let _=0;_<=2;_++){const m=r+_*(s-2*r)/2;g+=`<line x1="${r}" y1="${m}" x2="${n-r}" y2="${m}" stroke="#3a3025" stroke-width="0.5"/>`}for(const _ of i.leadHist||[]){if(_.turn<c||_.turn>h)continue;const m=p(_.turn);g+=`<line x1="${m.toFixed(1)}" y1="${r}" x2="${m.toFixed(1)}" y2="${s-r}" stroke="var(--amber)" stroke-width="0.6" stroke-dasharray="2 3" stroke-opacity="0.5"/>`}for(const _ of i.players){const m="#"+_.color.toString(16).padStart(6,"0"),u=_.id===i._leader,M=t.map(v=>`${p(v.turn).toFixed(1)},${f(v.v[_.id]?.[e]||0).toFixed(1)}`).join(" ");g+=`<polyline points="${M}" fill="none" stroke="${m}" stroke-width="${_.alive?u?2.6:1.7:1}" stroke-opacity="${_.alive?1:.3}" stroke-linejoin="round"/>`}if(i._leader){const _=i.players.find(m=>m.id===i._leader);if(_&&_.alive){const m=p(h),u=f(t[t.length-1].v[_.id]?.[e]||0),M="#"+_.color.toString(16).padStart(6,"0");g+=`<circle cx="${m.toFixed(1)}" cy="${u.toFixed(1)}" r="3.4" fill="${M}" stroke="#16110b" stroke-width="1"/><text x="${(m-3).toFixed(1)}" y="${(u-5).toFixed(1)}" font-size="9" text-anchor="end">👑</text>`}}g+=`<text x="${r}" y="11" fill="var(--muted)" font-size="9" font-family="monospace">${l}</text></svg>`,Vt("scoreChart").innerHTML=g}const o=t.length?t[t.length-1].v:{},a=i.players.map(l=>({p:l,val:o[l.id]?.[e]||0})).sort((l,c)=>c.val-l.val);Vt("scoreLegend").innerHTML=a.map(({p:l,val:c})=>{const h="#"+l.color.toString(16).padStart(6,"0");return`<div style="display:flex;align-items:center;gap:7px;font-size:10.5px;font-family:'JetBrains Mono';margin-bottom:3px;opacity:${l.alive?1:.45}">
      <span style="width:9px;height:9px;border-radius:2px;background:${h};flex:none"></span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.name}${l.alive?"":" ✝"}</span>
      <b style="color:var(--ink)">${c}</b></div>`}).join("")}const Hg=["aggression","expansion","economy","defense","tech","risk"];function jl(){const i=se.G,e=se.knowledge;if(i.mode!=="auto")return;const t=Vt("tickerBody");if(!t)return;Vt("tickerTurn").textContent=`turn ${i.turn}`;const n=i.players.map(o=>({p:o,sc:Ii(o)})).sort((o,a)=>a.p.alive-o.p.alive||a.sc-o.sc),s={};n.forEach((o,a)=>{o.p.alive&&(s[o.p.id]=a+1)});let r="";n.forEach((o,a)=>{const l=o.p,c="#"+l.color.toString(16).padStart(6,"0"),h=e.factions[l.id]&&e.factions[l.id].archetype||cc(l.id),d=l.genome||{},p=i.cities.filter(M=>M.owner===l.id).length,f=i.units.filter(M=>M.owner===l.id&&M.hp>0).length,g=i._prevRank[l.id],_=s[l.id];let m='<span class="lb-trend flat">·</span>';l.alive&&g&&(_<g?m='<span class="lb-trend up">▲</span>':_>g&&(m='<span class="lb-trend dn">▼</span>'));const u=l.alive&&a===0;r+=`<div class="lbrow ${u?"lead":""} ${l.alive?"":"dead"}">
      <div class="lb-rank">${l.alive?a+1:"✝"}</div>
      <div class="lb-dot" style="background:${c}"></div>
      <div class="lb-main">
        <div style="display:flex;align-items:center;gap:5px"><span class="lbname">${u?"👑 ":""}${l.name}</span></div>
        <div class="lb-arch">${h}</div>
        <div class="lb-gen">${Hg.map(M=>`<div title="${M} ${Math.round((d[M]||0)*100)}%"><i style="width:${Math.round((d[M]||0)*100)}%;background:${c}"></i></div>`).join("")}</div>
        <div class="lb-stats"><span>🏙 ${p}</span><span>⚔ ${f}</span></div>
      </div>
      ${m}
      <div class="lb-score">${o.sc}</div>
    </div>`}),t.innerHTML=r,i.turn!==i._rankTurn&&(i._rankTurn=i.turn,i._prevRank=s)}function Kl(){const i=se.G;if(i.mode!=="auto")return;const e=Vt("pivotBody");if(!e)return;Vt("pivotTurn").textContent=`${(i.pivots||[]).length} beats`;const t=(i.pivots||[]).slice(-24).reverse();if(!t.length){e.innerHTML='<div class="legend" style="padding:6px">The chronicle awaits its first turning point…</div>';return}e.innerHTML=t.map(n=>`<div class="pivot ${n.kind}"><span class="pv-ico">${n.ico}</span><div><div class="pv-txt">${n.text}</div><div class="pv-turn">turn ${n.turn}</div></div></div>`).join("")}const ae=i=>document.getElementById(i);function $i(i,e){const t=se.G;if(t&&t._headless)return;const n=ae("logbody");if(!n)return;const s=document.createElement("div");for(s.className="logline",s.innerHTML=`<span class="tag ${i}">${i}</span>${e}`,n.prepend(s);n.children.length>60;)n.removeChild(n.lastChild)}function Os(){const i=se.G,e=i.mode==="campaign"?i.players.find(h=>!h.isAI):Lt(),t=Lt();ae("hudWho").textContent=t.name+(t.isAI?" (AI)":""),ae("hudDot").style.background="#"+t.color.toString(16).padStart(6,"0"),ae("hudTurn").innerHTML=`${i.turn}${i.endless?"":"<small>/"+wr.turnCap+"</small>"}`;const n=e||t,s=n.foodUpkeep!=null?n.foodUpkeep:pc(n),r=(n.foodIncome||0)-s;ae("hudFood").innerHTML=`${Math.round(n.food||0)}<small> 🌾 <span style="color:${r<0?"#e87a5a":r>0?"#9bd07f":"var(--faint)"}">${r>=0?"+":""}${r}</span> <span style="color:var(--faint)">(${n.foodIncome||0}−${s}🍴)</span>${n.starving?" ⚠":""}</small>`;const o=Ws(n,"woodCap"),a=Ws(n,"stoneCap"),l=Ws(n,"prodCap"),c=(h,d)=>h>=d*.85?`<span style="color:#e8b35a">/${d}</span>`:`<span style="color:var(--faint)">/${d}</span>`;ae("hudWood").innerHTML=`${n.wood||0}<small> 🪵${c(n.wood||0,o)} +${n.woodIncome||0}</small>`,ae("hudStone").innerHTML=`${n.stone||0}<small> 🪨${c(n.stone||0,a)} +${n.stoneIncome||0}</small>`,ae("hudProd").innerHTML=`${n.prod}<small> ⚒${c(n.prod||0,l)} +${n.prodIncome||0}</small>`,ae("hudSci").innerHTML=`${n.science}<small> 🔬 +${n.sciIncome||0}</small>`,ae("hudCities").textContent=i.cities.filter(h=>h.owner===n.id).length,ae("hudScore").textContent=Ii(n)}function kg(){const i=se.G,e=i.mode==="campaign"?i.players.find(s=>!s.isAI):Lt();if(!e){ae("techBody").innerHTML="";return}const t=e;let n="";for(const[s,r]of Object.entries(mc)){const o=t.techs.has(s),a=!o&&r.prereq&&!t.techs.has(r.prereq),l=gc(t,s),c=!o&&!a&&t.science>=l&&!t.isAI&&i.mode==="campaign";n+=`<div class="tech ${o?"owned":""} ${a?"locked":""}" ${c?`data-tech="${s}"`:""}>
      <div class="ico">${o?"✓":a?"🔒":"🔬"}</div>
      <div><div class="tn">${r.name}</div><div class="nt">${r.note}</div></div>
      ${o?"":`<div class="tc">${l}🔬</div>`}</div>`}ae("techBody").innerHTML=n,ae("techHint").textContent=e.isAI||i.mode==="auto"?"observing":"click to research",!e.isAI&&i.mode==="campaign"&&ae("techBody").querySelectorAll("[data-tech]").forEach(s=>s.onclick=()=>{_c(t,s.dataset.tech)&&ht()})}function ht(){Os(),kg(),ia(),se.G.sel?ra():se.G.selCity&&Bs(),se.G.mode==="auto"&&Gg()}function Vg(){const i=se.G;if(!i.started||i.gameOver)return;const e=Lg();if(!e)return;const{tx:t,tz:n}=e,s=Lt();if(!(i.mode==="campaign"&&!s.isAI)){Zo(t,n);return}const o=Gi(t,n),a=ul(t,n);if(i.sel){const l=i.sel;if(i.atks&&i.atks.some(c=>c.x===t&&c.z===n)){const c=i.atks.find(h=>h.x===t&&h.z===n);eu(l,c),Wg();return}if(i.reach&&i.reach.set.has(Ui(t,n))&&l.movesLeft>0){tu(l,t,n),Ln(l),ht(),Bt(),Kn();return}l===o&&Gr(l,l.x,l.z)}if(o&&o.owner===s.id){Ln(o);return}if(a&&a.owner===s.id){Zl(a);return}Zo(t,n)}function Ln(i){const e=se.G;e.sel=i,e.selCity=null;const t=Lt();i.owner===t.id&&!i.hasMovedFlag?(e.reach=i.movesLeft>0?kc(i):{set:new Set,dist:{}},e.atks=Vc(i)):(e.reach=null,e.atks=null),jn(),ra()}function Zl(i){const e=se.G;e.sel=null,e.selCity=i,e.reach=null,e.atks=null,jn(),ra()}function Zo(i,e){const t=se.G,n=Gi(i,e),s=ul(i,e);if(n){Ln(n);return}if(s){Zl(s);return}t.sel=null,t.selCity=null,t.reach=null,t.atks=null,jn();const r=rn(i,e),o={pennine:"Pennine uplands",dale:"Fertile dale",weald:"Weald",coast:"Coast & estuary"}[r.region]||"",a=r.resource&&Mi[r.resource].strategic;ae("selBody").innerHTML=`<div class="sel-empty"><b style="color:var(--ink)">${r.terrain[0].toUpperCase()+r.terrain.slice(1)}</b>${o?` · <span style="color:var(--muted)">${o}</span>`:""}${r.resource?`<br>${Mi[r.resource].glyph} <b style="color:var(--amber2)">${r.resource}</b>${a?' <span style="color:var(--teal)">⚙ strategic</span>':""}`:""}<br>${r.owner?`Territory of ${Xt(r.owner)?.name||"—"}`:"Unclaimed land."}</div>`,ae("selTitle").textContent="Tile",ae("selSub").textContent=`${i},${e}`}function Wg(){const i=se.G;i.sel&&i.sel.hp>0?Ln(i.sel):(i.sel=null,i.reach=null,i.atks=null),ht(),Bt(),cl(),Kn()}function ra(){const i=se.G,e=Lt(),t=ae("selBody"),n=ae("selTitle"),s=ae("selSub");if(i.sel){const r=i.sel,o=Kt[r.type],a=Xt(r.owner),l=r.owner===e.id&&!e.isAI&&i.mode==="campaign";n.textContent="Unit",s.textContent=`#${r.id}`;let c=`<div class="unit-head"><div class="unit-emoji" style="color:#${a.color.toString(16).padStart(6,"0")}">${o.glyph}</div>
      <div><div class="unit-name">${o.name}</div><div class="unit-faction">${a.name}</div></div></div>
      <div class="hpbar"><i style="width:${Math.round(r.hp/r.maxHp*100)}%"></i></div>
      <div class="stat-grid">
        <div class="mini"><div class="k">HP</div><div class="vv">${r.hp}</div></div>
        <div class="mini"><div class="k">ATK</div><div class="vv">${o.atk}</div></div>
        <div class="mini"><div class="k">DEF</div><div class="vv">${o.def}</div></div>
        <div class="mini"><div class="k">MOV</div><div class="vv">${vc(r)}</div></div>
      </div>
      <div class="desc">${o.desc}</div>`;if(pa[r.type]&&(c+=`<div class="legend" style="margin-top:4px">⚔ Strong vs <b style="color:var(--amber2)">${pa[r.type].label}</b></div>`),c+=`<div class="legend" style="margin-top:2px">${r.fortified?'<b style="color:var(--teal)">🛡 Fortified</b> — dug in (+def). ':"Not fortified — end the turn without moving to dig in. "}</div>`,o.needs){const h=Xt(r.owner);c+=`<div class="legend" style="margin-top:4px">⚙ Strategic: ${o.needs.map(d=>{const p=Jl(h,d);return`<span style="color:${p?"var(--teal)":"#f0998e"}">${Mi[d].glyph} ${d}${p?"":" ✗"}</span>`}).join(" · ")}</div>`}if(l){if(c+='<div class="label" style="margin-top:10px">Orders</div>',c+='<div style="display:flex;flex-direction:column;gap:6px;margin-top:5px;">',o.role==="settle"&&(Gr(r,r.x,r.z)?c+='<button class="btn primary" data-act="found">⌂ Found a village here</button>':c+=`<div class="legend">⌂ Move to open land at least <b>${t_()}</b> tiles from any city, then found.</div>`),o.role==="scout"&&(r.movesLeft>0&&(c+='<button class="btn" data-act="scout">✦ Scout ahead (reveal the fog)</button>'),c+=`<button class="btn ${r.autoExplore?"primary":""}" data-act="auto">⤳ Auto-explore${r.autoExplore?" — ON":""}</button>`),o.domain==="land"&&r.movesLeft>0){const h=xc(e,r.x,r.z);for(const d of h)c+=`<button class="btn" data-embark="${d.id}">⛵ Board the Tees Lighter (${(d.cargo||[]).length}/${ma(d)})</button>`}if(o.role==="transport"){const h=r.cargo||[];if(c+=`<div class="legend" style="margin-top:4px">Cargo <b>${h.length}/${ma(r)}</b>${h.length?": "+h.map(d=>Kt[d.type].glyph+" "+Kt[d.type].name).join(", "):" — empty"}</div>`,h.length){const d=Mc(r.x,r.z).filter(([p,f])=>Sc(p,f)&&!Gi(p,f));if(d.length)for(let p=0;p<h.length;p++){const[f,g]=d[0];c+=`<button class="btn" data-disembark="${p},${f},${g}">⌂ Land ${Kt[h[p].type].glyph} ${Kt[h[p].type].name} (${Vr(f-r.x,g-r.z)})</button>`}else c+='<div class="legend">Move beside open land to disembark.</div>'}}if(i.atks&&i.atks.length){c+=`<div class="legend">⚔ <b>${i.atks.length}</b> target(s) in range — click a <span style="color:#ff5544">red</span> tile to strike.</div>`;for(const h of i.atks){const d=Ec(r,h),p=d.factors,f=Kt[h.type],g=[];p.counter>0&&g.push(`<span style="color:#9bd07f">counter +${Math.round(p.counter*100)}%</span>`),Math.abs(p.elev-1)>.001&&g.push(`<span style="color:${p.elev<1?"#f0998e":"#9bd07f"}">${p.elev<1?"uphill":"downhill"} ${p.elev<1?"−":"+"}${Math.round(Math.abs(p.elev-1)*100)}%</span>`),d.flankers>0&&g.push(`<span style="color:#9bd07f">flank +${Math.round(Math.min(wr.flankCap,d.flankers*wr.flankPerUnit)*100)}% (${d.flankers})</span>`),d.defBon>1.001&&g.push(`<span style="color:#f0998e">terrain/def ×${d.defBon.toFixed(2)}${h.fortified?" 🛡":""}</span>`),c+=`<div class="legend" style="margin-top:3px;border-left:2px solid var(--line2);padding-left:6px">
            ⚔ vs ${f.glyph} <b>${f.name}</b> (${h.hp}hp): deal <b style="color:#ff7a5a">${d.atkDmg}</b>${d.kills?' <b style="color:#9bd07f">— KILL</b>':d.defDmg>0?`, take <b style="color:#f0998e">${d.defDmg}</b> back`:", no retaliation"}${g.length?`<br><span style="font-size:9px">${g.join(" · ")}</span>`:""}</div>`}}r.movesLeft>0&&(c+='<div class="legend">→ Click a <span style="color:#49b6ff">blue</span> tile to march there.</div>'),r.movesLeft>0||!r.hasAttacked?c+='<button class="btn" data-act="skip">✓ Done for this turn</button>':c+='<div class="legend">This unit has spent its turn.</div>',c+="</div>"}t.innerHTML=c,l&&(t.querySelectorAll("[data-act]").forEach(h=>h.onclick=()=>{const d=h.dataset.act;d==="found"?Xg(r):d==="scout"?Jo(r):d==="auto"?(r.autoExplore=!r.autoExplore,r.autoExplore&&(Pn("Auto-explore on — this scout roams the fog at the start of each turn."),Jo(r)),Ln(r),ht()):d==="skip"&&(r.movesLeft=0,r.hasAttacked=!0,Ln(r),ht())}),t.querySelectorAll("[data-embark]").forEach(h=>h.onclick=()=>{const d=i.units.find(p=>p.id==h.dataset.embark);d&&yc(r,d)&&(i.sel=null,Pn("Boarded the lighter."),ht(),Bt(),Kn())}),t.querySelectorAll("[data-disembark]").forEach(h=>h.onclick=()=>{const d=h.dataset.disembark.split(",").map(Number);Tc(r,d[0],d[1],d[2])&&(Pn("Unit landed."),Ln(r),ht(),Bt(),Kn())}))}else i.selCity&&Bs()}function Bs(){const i=se.G,e=i.selCity,t=Lt(),n=Xt(e.owner),s=ae("selBody"),r=ae("selTitle"),o=ae("selSub"),a=e.owner===t.id&&!t.isAI&&i.mode==="campaign";r.textContent="City",o.textContent=e.isCapital?"capital":"";const l=bc(e),c=Ac(e),h=wc(e),d=Rc(e),p=e.level>=c,f=Cc(e),g=Lc(e),_=p?1:Math.min(br((t.food||0)/h,0,1),br((t.prod||0)/Math.max(1,d),0,1));let m=`<div class="unit-head"><div class="unit-emoji" style="color:#${n.color.toString(16).padStart(6,"0")}">${e.isCapital?"★":"⌂"}</div>
    <div><div class="unit-name">${e.name}</div><div class="unit-faction">${n.name} · Lv ${e.level}/${Ar} · border ${Pc(e)}${e.unrest>0?` · <span style="color:#e87a5a">⚑ unrest ${e.unrest}t</span>`:""}</div></div></div>
    ${e.unrest>0?`<div class="legend" style="margin-top:4px;color:#e87a5a">Newly captured — in unrest for <b>${e.unrest}</b> more turn(s): yields nothing & cannot grow until order is restored.</div>`:""}
    <div class="hpbar" style="background:#2a2412"><i style="width:${Math.round(_*100)}%;background:linear-gradient(90deg,var(--amber),var(--amber2))"></i></div>
    <div class="legend" style="margin-top:4px">${e.level<c?`Ready to grow — next level costs <b>${h}</b> 🌾 + <b>${d}</b> ⚒ (you have ${t.food||0} 🌾, ${t.prod||0} ⚒)`:e.level>=Math.min(Ar,g)?"At the limit of its land":`Build <b>infrastructure</b> nearby to unlock level ${e.level+1}`} ${e.walls?"· walled":""}</div>
    <div class="legend" style="margin-top:2px">Improvements: <b>${f}</b> built → caps growth at Lv <b>${c}</b></div>
    <div class="stat-grid" style="margin-top:8px;grid-template-columns:repeat(5,1fr)">
      <div class="mini"><div class="k">🌾</div><div class="vv">+${l.food}</div></div>
      <div class="mini"><div class="k">🪵</div><div class="vv">+${l.wood}</div></div>
      <div class="mini"><div class="k">🪨</div><div class="vv">+${l.stone}</div></div>
      <div class="mini"><div class="k">⚒</div><div class="vv">+${l.prod}</div></div>
      <div class="mini"><div class="k">🔬</div><div class="vv">+${l.sci}</div></div>
    </div>
    <div class="desc">Each <b>improvement</b> built in this city's land unlocks one more level (hamlet → skyscrapers at Lv 10). Farms→food, Lumber Mills→wood, Ports/Water Mills→food &amp; production, Mines→stone.</div>`;if(a){const u=sl(t),M=rl(t),v=Dc.filter(U=>Jl(t,U));m+=`<div class="legend" style="margin-top:8px">Strategic resources: ${v.length?v.map(U=>`<span style="color:var(--teal)">${Mi[U].glyph} ${U}</span>`).join(" · "):'<span style="color:var(--faint)">none controlled — expand to a coalfield / iron field to unlock the elite roster</span>'}</div>`,m+=`<div style="margin-top:8px"><div class="label" style="margin-bottom:6px">Build <span style="color:var(--faint)">(⚒ ${t.prod} · 🪵 ${t.wood} · 🪨 ${t.stone}) · units ${M}/${u}</span></div><div class="buildlist">`;const b=!!Gi(e.x,e.z),C=M>=u,w=Uc(e);for(const[U,x]of Object.entries(Kt)){if(x.role==="super"||x.tech&&!t.techs.has(x.tech)||x.port&&!w)continue;const E=Ic(U,t),F=Nc(t,U),V=b||C||!al(t,U)||x.domain==="sea"&&!ol(e),ne=x.needs?`<span class="cost" style="color:${F.length?"#f0998e":"var(--teal)"};margin-left:4px">${x.needs.map(D=>Mi[D].glyph).join("")}${F.length?" needs "+F.join("+"):""}</span>`:"";m+=`<button class="btn" data-build="${U}" ${V?"disabled":""} title="${x.needs?"Requires "+x.needs.join(" + ")+(F.length?" — you control none of: "+F.join(", "):" (controlled)"):""}">
        <span>${x.glyph} ${x.name}${ne}</span><span class="cost">${E.prod}⚒${E.wood?` ${E.wood}🪵`:""}${E.stone?` ${E.stone}🪨`:""}${E.food?` ${E.food}🌾`:""}</span></button>`}m+="</div>",w?m+='<div class="legend" style="margin-top:6px">⚓ This city has a <b>Port</b> — it can build ships, launched onto adjacent open water.</div>':Fc(e)&&t.techs.has("harbours")&&(m+='<div class="legend" style="margin-top:6px">⚓ Build a <b>Port</b> on adjacent water below to make this a shipyard.</div>'),C&&(m+=`<div class="legend" style="margin-top:6px">Unit cap reached (${M}/${u}) — grow cities to support more.</div>`),b&&(m+='<div class="legend" style="margin-top:6px">A unit blocks the city — move it to build.</div>'),m+='<div class="label" style="margin:12px 0 6px">Build infrastructure <span style="color:var(--faint)">(each unlocks a level)</span></div><div class="buildlist">';let A=!1;for(const U of Oc(e,t)){A=!0;const x=U.disabled;m+=`<button class="btn" data-imp="${U.x},${U.z},${U.id}" ${x?"disabled":""} title="${U.note}${U.reason?" — "+U.reason:""}">
        <span>${U.glyph} ${U.label} <span style="color:var(--faint)">· ${Vr(U.x-e.x,U.z-e.z)} ${U.terrain}</span></span><span class="cost">${U.reason?"🔒 "+U.reason:U.cost+"⚒ "+U.wood+"🪵"}</span></button>`}A||(m+='<div class="legend">No improvable land in reach — research more techs (Husbandry, Forestry, Harbours, Milling, Ironworking) or grow to claim tiles.</div>'),m+="</div>",m+="</div>"}s.innerHTML=m,a&&(s.querySelectorAll("[data-build]").forEach(u=>u.onclick=()=>{$g(e,u.dataset.build)}),s.querySelectorAll("[data-imp]").forEach(u=>u.onclick=()=>{const M=u.dataset.imp.split(",");qg(e,+M[0],+M[1],M[2])}))}function Jo(i){const e=Xt(i.owner);il(e,i),Ln(i),ht(),Bt()}function Xg(i){const e=se.G,t=Xt(i.owner);Gc(t,i.x,i.z,!1),Hc(i),e.sel=null,$i("city",`${t.name} founded a village at the Skerne.`),ll(),ht(),Bt()}function $g(i,e){const t=Xt(i.owner),n=Kt[e].domain==="sea";if(!al(t,e))return;if(rl(t)>=sl(t)){Pn("Unit cap reached — grow your cities to support more.");return}let s=i.x,r=i.z;if(n){const o=ol(i);if(!o){Pn("No open water beside the port to launch.");return}[s,r]=o}else if(Gi(i.x,i.z))return;Wc(t,e),Xc(t,e,s,r),$i("city",`${i.name} built a ${Kt[e].name}.`),ht(),Bt(),Bs()}function qg(i,e,t,n){const s=se.G,r=Xt(i.owner),o=rn(e,t),a=$c(r,i,o);if(!a.ok||a.id!==n)return;const l=qc[n];r.prod-=l.cost.prod,r.wood=(r.wood||0)-Yc(),o.improved=n,$i("city",`${i.name} built a ${l.label} (${Vr(e-i.x,t-i.z)}).`),ll(),na(e,t),ht(),s.sel===null&&s.selCity&&Bs()}function aa(i){const e=se.G;if(!(i.isAI||e.gameOver))for(const t of e.units){if(t.owner!==i.id||t.hp<=0||!t.autoExplore)continue;let n=0;for(;t.movesLeft>0&&n++<12;){const s=t.x,r=t.z;if(il(i,t),t.x===s&&t.z===r)break}}}function Kn(){const i=se.G;if(se.autoEndTimer&&(clearTimeout(se.autoEndTimer),se.autoEndTimer=null),i.gameOver)return;const e=Lt();e.isAI||i.mode!=="campaign"||i.selCity||fa(e)||(se.autoEndTimer=setTimeout(()=>{if(i.gameOver)return;const t=Lt();t.isAI||fa(t)||i.selCity||(Pn("Turn passed — all units rested."),ae("endturn").disabled||Oi())},900))}function Rs(){ae("selTitle").textContent="Selection",ae("selSub").textContent="",ae("selBody").innerHTML='<div class="sel-empty">Your turn. Select a <b>unit</b> to move &amp; fight, or a <b>city</b> to build units (cities grow themselves from the surrounding land). Then <b>End Turn</b>.</div>'}function Yg(){se.G.mode==="auto"&&Oi()}function jg(){se.G,L.renderer&&(Og(),Pg(),Bt(),ht(),Xl())}function Kg(){const i=se.G;Os();const e=Lt();e.isAI?Zg(e):(i.sel=null,i.selCity=null,i.reach=null,i.atks=null,jn(),Rs(),ae("endturn").disabled=!1,aa(e),ht(),Bt(),Kn())}function Zg(i){const e=se.G;if(Jc(i),cl(),Bt(),ht(),e.gameOver||e.mode==="auto"&&!se.autoplay&&se.speed==="step")return;const t=e.mode==="auto"?Qc[se.speed]||450:320;se.autoTimer=setTimeout(()=>{Oi()},t)}function Jg(i,e){const t=se.G;i&&jc("win","👑",`<b>${i.name}</b> win by ${e} on turn ${t.turn}.`),se.autoTimer&&clearTimeout(se.autoTimer),t.mode==="auto"&&(t._obsTurn=-1,t._pivN=-1,sa(),jl(),Kl()),Kc(i,e),ia();const n=[...t.players].sort((o,a)=>Ii(a)-Ii(o));ae("endTitle").innerHTML=i?`${i.name} <span style="color:var(--amber)">prevails</span>`:"Stalemate";const s={domination:"Victory by domination — every rival capital has fallen.",science:"Victory by science — the Great Exhibition crowns the Age of Steam.",economy:"Victory by industry — a railway empire of unrivalled wealth.",score:`Victory by score after ${Zc} turns.`};ae("endSub").textContent=s[e]||s.score;let r="";n.forEach((o,a)=>{r+=`<div class="rrow ${a===0?"win":""}"><div class="rk">${a+1}</div>
    <span class="dot" style="background:#${o.color.toString(16).padStart(6,"0")};width:12px;height:12px"></span>
    <div class="rn">${o.name}${o.isAI?"":" (you)"}</div><div class="rs">${Ii(o)} pts · ${t.cities.filter(l=>l.owner===o.id).length} cities</div></div>`}),ae("endRank").innerHTML=r,ae("endLearn").textContent=`AI memory updated — ${se.knowledge.games} games played.`,$i("sys",i?`${i.name} wins by ${e}.`:"The game ends in stalemate."),t.mode==="auto"&&t.marathon?(ae("endModal").classList.add("hidden"),setTimeout(()=>{kr({seed:t.seed+1>>>0,mode:"auto",count:t.players.length,marathon:!0,mapSize:t.mapSize,endless:t.endless}),ht(),Ni()},1400)):ae("endModal").classList.remove("hidden")}function Qg(){const i=ae("endturn");i&&(i.disabled=!0)}function Pn(i){const e=ae("toast");e&&(e.textContent=i,e.classList.add("show"),setTimeout(()=>e.classList.remove("show"),1600))}const Ze={count:4,mode:"campaign",faction:"kelly",seed:1825,marathon:!1,mapSize:"medium",endless:!1};function Ss(){const i=ae("countRow");i.innerHTML="";for(let t=2;t<=8;t++){const n=document.createElement("div");n.className="chip"+(t===Ze.count?" on":""),n.textContent=t,n.onclick=()=>{Ze.count=t,zi()},i.appendChild(n)}const e=ae("facGrid");e.innerHTML="",Hr.forEach(t=>{const n=document.createElement("div");n.className="fac"+(t.id===Ze.faction?" on":""),n.innerHTML=`<span class="fc" style="background:#${t.color.toString(16).padStart(6,"0")}"></span>
      <div><div class="fn">${t.name}</div><div class="fm">${t.motto}</div></div><span class="fb">${t.bonusTxt}</span>`,n.onclick=()=>{Ze.faction=t.id,zi()},e.appendChild(n)}),dc(),ae("memNote").textContent=`AI memory: ${se.knowledge.games} games, ${Object.values(se.knowledge.lessons).filter(t=>t.weight>.05).length} active lessons.`}function zi(){ae("countRow").querySelectorAll(".chip").forEach(e=>e.classList.toggle("on",+e.textContent===Ze.count)),ae("mapRow").querySelectorAll(".chip").forEach(e=>e.classList.toggle("on",e.dataset.map===Ze.mapSize)),ae("modeRow").querySelectorAll(".chip").forEach(e=>e.classList.toggle("on",e.dataset.mode===Ze.mode)),ae("facGrid").querySelectorAll(".fac").forEach((e,t)=>e.classList.toggle("on",Hr[t].id===Ze.faction)),ae("facField").style.opacity=Ze.mode==="auto"?.4:1,ae("facHintTxt").textContent=Ze.mode==="auto"?"— not needed in autonomous mode":"";const i=fc[Ze.mapSize]||32;ae("playersHint").textContent=`· ${i}×${i} board (${Ze.mapSize})`}function e_(){ae("setup").classList.add("hidden"),["hud","leftcol","rightcol","log","controls"].forEach(i=>ae(i).classList.remove("hidden")),L.renderer||ql(),kr({seed:Ze.seed,mode:Ze.mode,count:Ze.count,faction:Ze.faction,marathon:Ze.marathon,mapSize:Ze.mapSize,endless:Ze.endless}),se.G,ae("speedSeg").querySelectorAll("button").forEach(i=>i.classList.toggle("on",i.dataset.sp===se.speed)),ae("endturn").style.display=Ze.mode==="auto"?"none":"",ae("btnAuto").style.display=Ze.mode==="auto"?"none":"",se.autoplay=Ze.mode==="auto",yr("ticker",Ze.mode==="auto"),yr("scorePanel",Ze.mode==="auto"),yr("pivots",Ze.mode==="auto"),ht(),Ze.mode==="auto"?Ni():(nl(Lt()),Os(),ae("endturn").disabled=!1,Rs(),aa(Lt()),ht(),Bt(),Kn())}function yr(i,e){const t=ae(i);t&&t.classList.toggle("hidden",!e)}function Jl(i,e){return Bc(i,e)}function t_(){return zc()}function n_(){zg(Vg),ae("startBtn").onclick=e_,ae("rematchBtn").onclick=()=>{const e=se.G;ae("endModal").classList.add("hidden"),kr({seed:e.seed+1>>>0,mode:e.mode,count:e.players.length,faction:Ze.faction,marathon:e.marathon,mapSize:e.mapSize,endless:e.endless}),ht(),se.G.mode==="auto"?Ni():(nl(Lt()),Os(),ae("endturn").disabled=!1,Rs(),aa(Lt()),ht(),Bt(),Kn())},ae("menuBtn2").onclick=()=>{ae("endModal").classList.add("hidden"),ae("setup").classList.remove("hidden"),Ss()},ae("btnMenu").onclick=()=>{se.autoTimer&&clearTimeout(se.autoTimer),ae("setup").classList.remove("hidden"),Ss()},ae("endturn").onclick=()=>{const e=se.G;e.sel&&(e.sel=null,jn()),Oi()},ae("btnHome").onclick=Xl,ae("btnAuto").onclick=()=>{se.autoplay=!se.autoplay,ae("btnAuto").textContent=se.autoplay?"⏸":"▶",se.autoplay?Lt().isAI&&Ni():se.autoTimer&&clearTimeout(se.autoTimer)},ae("speedSeg").querySelectorAll("button").forEach(e=>e.onclick=()=>{const t=se.G;se.speed=e.dataset.sp,ae("speedSeg").querySelectorAll("button").forEach(n=>n.classList.toggle("on",n===e)),se.speed!=="step"&&t.mode==="auto"&&!t.gameOver&&(se.autoTimer&&clearTimeout(se.autoTimer),Ni())}),ae("techHead").onclick=()=>{const e=ae("techBody").classList.toggle("hidden");ae("techChevron").textContent=e?"▸":"▾"},ae("mapRow").querySelectorAll(".chip").forEach(e=>e.onclick=()=>{Ze.mapSize=e.dataset.map,zi()}),ae("modeRow").querySelectorAll(".chip").forEach(e=>e.onclick=()=>{Ze.mode=e.dataset.mode,zi()}),ae("marathonChk").onchange=e=>{Ze.marathon=e.target.checked},ae("endlessChk").onchange=e=>{Ze.endless=e.target.checked},ae("seedInput").oninput=e=>{Ze.seed=parseInt(e.target.value)||1825},ae("wipeBtn").onclick=()=>{se.knowledge=uc(),hc(),Ss(),ia(),Pn("AI memory wiped.")},ae("btnHelp").onclick=Tr,ae("helpClose").onclick=i_,ae("helpBtn2").onclick=Tr;const i={KeyW:"up",ArrowUp:"up",KeyS:"down",ArrowDown:"down",KeyA:"left",ArrowLeft:"left",KeyD:"right",ArrowRight:"right"};addEventListener("keydown",e=>{const t=se.G,n=e.target&&e.target.tagName||"";if(!(n==="INPUT"||n==="TEXTAREA")){if(i[e.code]){e.preventDefault(),L.panKeys.add(i[e.code]);return}e.code==="Space"&&(e.preventDefault(),t&&t.mode==="auto"?Yg():ae("endturn").disabled||Oi()),e.key==="Escape"&&t&&(t.sel=null,t.selCity=null,t.reach=null,t.atks=null,jn(),t.started&&Rs()),(e.key==="?"||e.shiftKey&&e.code==="Slash")&&Tr()}}),addEventListener("keyup",e=>{i[e.code]&&L.panKeys.delete(i[e.code])}),addEventListener("blur",()=>L.panKeys.clear())}function Tr(){ae("help").classList.remove("hidden")}function i_(){ae("help").classList.add("hidden");try{localStorage.setItem("brassrails.seenHelp","1")}catch{}}tl({afterSetup:jg,afterAdvance:Kg,onEndGame:Jg,log:(i,e)=>$i(i,e),refreshTile:(i,e)=>na(i,e),toast:i=>Pn(i),endTurnUi:Qg});Bg();n_();Ss();zi();try{localStorage.getItem("brassrails.seenHelp")||document.getElementById("help").classList.remove("hidden")}catch{}
