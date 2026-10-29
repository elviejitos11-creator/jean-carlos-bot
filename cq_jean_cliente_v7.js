'use strict';
module.exports=function(app){
app.use('/cliente',(req,res,next)=>{
if(req.method!=='GET'||
(req.path.replace(/\/+$/,'')||'/')!=='/')
return next();
const original=res.send.bind(res);
res.send=function(body){
if(typeof body!=='string'||
!/<(?:html|head|body)\b/i.test(body))
return original(body);
const estilo='<style>'+
"body{background:#091c2e!important;\ncolor:#eef5ff!important;\nfont-family:system-ui,Arial,sans-serif!important}\nh1{color:white!important;\nfont-size:clamp(24px,3vw,34px)!important}\n.card,.perfil,.profile-card,.tarjeta,article{\nbackground:#142f4b!important;\nborder-radius:14px!important;\npadding:16px!important;\nbox-sizing:border-box!important}\n.cards,.perfiles,.profiles,.grid,.tarjetas,.profile-grid{\ndisplay:grid!important;\ngrid-template-columns:repeat(2,minmax(0,1fr))!important;\ngap:14px!important}\nbutton,.btn{border-radius:9px!important;\nfont-weight:700!important}\n@media(max-width:760px){\n.cards,.perfiles,.profiles,.grid,.tarjetas,.profile-grid{\ngrid-template-columns:1fr!important}}"+'</style>';
const script='<script>'+
"\n(function(){\n  if(window.__cqAuto)return;\n  window.__cqAuto=true;\n\n  const e=(...n)=>String.fromCodePoint(...n);\n  document.title='JEAN__BOT CLIENTE';\n\n  for(const h of document.querySelectorAll('h1')){\n    if(/PANEL PRO|JEAN__BOT/i.test(h.textContent)){\n      h.textContent=\n        e(0x1f525)+' JEAN__BOT CLIENTE '+e(0x1f525);\n    }\n  }\n\n  const cambios=[\n    [/\\?\\? Perfil:/g,e(0x1f194)+' Perfil:'],\n    [/\\?\\? Chat ID:/g,e(0x1f4ac)+' Chat ID:'],\n    [/\\?\\? Tel[e?]fono:/g,e(0x1f4de)+' Tel?fono:'],\n    [/\\?\\? C[o?]digo:/g,e(0x1f194)+' C?digo:'],\n    [/\\?\\? Ubicaci[o?]n:/g,e(0x1f4cd)+' Ubicaci?n:'],\n    [/\\?\\? ACTIVA/g,e(0x1f7e2)+' ACTIVA'],\n    [/\\?\\? PAUSADA/g,e(0x1f534)+' PAUSADA'],\n    [/\\?\\? Bump hoy:/g,e(0x1f4ca)+' Bump hoy:'],\n    [/\\?\\? Bump total:/g,e(0x1f4c8)+' Bump total:'],\n    [/\\? Nuevo perfil/g,e(0x2795)+' Nuevo perfil']\n  ];\n\n  const walker=document.createTreeWalker(\n    document.body,NodeFilter.SHOW_TEXT\n  );\n\n  let nodo;\n\n  while((nodo=walker.nextNode())){\n    if(nodo.parentElement?.closest(\n      'script,style,textarea'\n    ))continue;\n\n    let texto=nodo.nodeValue;\n\n    for(const [patron,valor] of cambios){\n      texto=texto.replace(patron,valor);\n    }\n\n    nodo.nodeValue=texto;\n  }\n\n  let ultimaActividad=Date.now();\n  let editando=false;\n\n  document.addEventListener('pointerdown',()=>{\n    ultimaActividad=Date.now();\n  },{passive:true});\n\n  document.addEventListener('keydown',()=>{\n    ultimaActividad=Date.now();\n  });\n\n  document.addEventListener('input',ev=>{\n    if(ev.target.matches('input,textarea,select')){\n      editando=true;\n    }\n  });\n\n  try{\n    const y=sessionStorage.getItem('cq_cliente_y');\n\n    if(y!==null){\n      sessionStorage.removeItem('cq_cliente_y');\n\n      requestAnimationFrame(()=>{\n        scrollTo(0,Number(y)||0);\n      });\n    }\n  }catch{}\n\n  setInterval(()=>{\n    if(document.hidden||editando)return;\n    if(Date.now()-ultimaActividad<15000)return;\n\n    if(document.activeElement?.matches(\n      'input,textarea,select,[contenteditable]'\n    ))return;\n\n    try{\n      sessionStorage.setItem(\n        'cq_cliente_y',String(scrollY)\n      );\n    }catch{}\n\n    location.reload();\n  },10000);\n})();\n"+'</script>';
let html=body;
html=/<\/head>/i.test(html)
?html.replace(/<\/head>/i,estilo+'</head>')
:estilo+html;
html=/<\/body>/i.test(html)
?html.replace(/<\/body>/i,script+'</body>')
:html+script;
return original(html);
};
next();
});
};