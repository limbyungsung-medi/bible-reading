/* 말씀나눔 성경읽기 — 오프라인(비행기 모드)용 서비스 워커
   앱 화면(index.html)과 글꼴·압축 해제 도구를 휴대폰에 보관해 두었다가, 인터넷이 없으면
   보관본으로 앱을 연다. 인터넷이 있으면 늘 서버의 최신 화면을 먼저 받고 보관본도 새로 바꾼다.
   (성경 본문·오디오는 원래부터 휴대폰 안(IndexedDB)에 저장되어 있어서 따로 할 일이 없다.) */
var CACHE = "bible-reading-offline-v1";
var APP_URL = new URL("./", self.location).href;              /* .../bible-reading/ */
var JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
var PRETENDARD_CSS = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

self.addEventListener("install", function(event){
  event.waitUntil((async function(){
    var cache = await caches.open(CACHE);
    /* 꼭 필요한 것: 앱 화면 + 성경 파일(zip)을 여는 도구 */
    await Promise.all([APP_URL, JSZIP].map(function(u){
      return fetch(u, {cache:"reload"}).then(function(r){ if(r.ok || r.type === "opaque") return cache.put(u, r); }).catch(function(){});
    }));
    /* 본문 글꼴(프리텐다드): 글자 묶음 파일들까지 미리 받아 두어 비행기 안에서도 같은 글꼴로 보이게 */
    precacheCssWithFonts(cache, PRETENDARD_CSS).catch(function(){});
    self.skipWaiting();
  })());
});

self.addEventListener("activate", function(event){
  event.waitUntil((async function(){
    var keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k.indexOf("bible-reading-offline-") === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();
  })());
});

async function precacheCssWithFonts(cache, cssUrl){
  var res = await fetch(cssUrl, {mode:"cors"});
  if(!res.ok) return;
  await cache.put(cssUrl, res.clone());
  var css = await res.text();
  var urls = [], re = /url\(([^)]+)\)/g, m;
  while((m = re.exec(css))){ urls.push(new URL(m[1].replace(/["']/g, ""), cssUrl).href); }
  for(var i = 0; i < urls.length; i += 8){
    await Promise.all(urls.slice(i, i + 8).map(function(u){
      return cache.match(u).then(function(hit){
        if(hit) return;
        return fetch(u, {mode:"cors"}).then(function(r){ if(r.ok) return cache.put(u, r); }).catch(function(){});
      });
    }));
  }
}

function isAppPage(req){
  if(req.mode === "navigate") return true;
  var u = new URL(req.url);
  return u.origin === self.location.origin && (u.pathname === new URL(APP_URL).pathname || /\/index\.html$/.test(u.pathname));
}

self.addEventListener("fetch", function(event){
  var req = event.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);

  /* 1) 앱 화면: 인터넷이 되면 서버의 최신 화면(보관본도 갱신), 안 되면(또는 4초 넘게 응답이 없으면) 보관본 */
  if(isAppPage(req) && url.origin === self.location.origin && url.pathname.indexOf(new URL(APP_URL).pathname) === 0){
    /* 새 버전 확인(cache:no-store)은 서버에 직접 물어봐야 하므로 보관본으로 대신하지 않는다(실패하면 앱이 조용히 넘어감) */
    if(req.cache === "no-store" && req.mode !== "navigate"){
      event.respondWith(fetch(req).then(function(r){
        if(r.ok){ var copy = r.clone(); caches.open(CACHE).then(function(c){ c.put(APP_URL, copy); }); }
        return r;
      }));
      return;
    }
    event.respondWith((async function(){
      var cache = await caches.open(CACHE);
      var net = fetch(req).then(function(r){
        if(r.ok){ cache.put(APP_URL, r.clone()); }
        return r;
      });
      var timeout = new Promise(function(resolve){ setTimeout(function(){ resolve(null); }, 4000); });
      try{
        var first = await Promise.race([net, timeout]);
        if(first && first.ok) return first;
      }catch(e){ /* 오프라인 */ }
      var cached = await cache.match(APP_URL) || await cache.match(req, {ignoreSearch:true});
      if(cached) return cached;
      return net;   /* 보관본도 없으면(처음 설치 직후 등) 그냥 네트워크 결과 */
    })());
    return;
  }

  /* 2) 글꼴·압축 도구 같은 외부 파일: 보관본이 있으면 바로 쓰고, 없으면 받아서 보관 */
  if(url.origin !== self.location.origin &&
     /(^|\.)(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)){
    event.respondWith((async function(){
      var cache = await caches.open(CACHE);
      var hit = await cache.match(req);
      if(hit) return hit;
      try{
        var r = await fetch(req);
        if(r.ok || r.type === "opaque") cache.put(req, r.clone());
        return r;
      }catch(e){
        return new Response("", {status:504});
      }
    })());
  }
});
