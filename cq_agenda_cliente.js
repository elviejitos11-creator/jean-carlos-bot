'use strict';
const fs=require('fs');
const path=require('path');
const estadoRuta=path.join(__dirname,'clientes_data','jean_bot_estado.json');
const store=require('./clientes_store');
module.exports=function(app){
app.get('/cliente/agenda-datos',(req,res)=>{
res.setHeader('Cache-Control','no-store');
const cookie=String(req.headers.cookie||'');
if(!cookie.includes('cq_cliente='))return res.status(401).json({ok:false});
return res.status(501).json({ok:false,error:'Pendiente de enlazar sesion segura'});
});
};