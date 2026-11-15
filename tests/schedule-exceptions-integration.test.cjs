const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {Pool}=require('pg');
const {PrismaClient}=require('@prisma/client');
const {PrismaPg}=require('@prisma/adapter-pg');
const bcrypt=require('bcrypt');
test('schedule layers: base per branch, particular days, OOO requests/approval and reschedule list',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const source=new URL(process.env.TEST_DATABASE_URL);assert(['localhost','127.0.0.1','[::1]'].includes(source.hostname));
 const admin=new Pool({connectionString:source.toString()}),name=`cedin_exceptions_${process.pid}`;let created=false,pool,prisma,server;
 try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;const url=new URL(source);url.pathname='/'+name;pool=new Pool({connectionString:url.toString()});pool.on('error',()=>{}); // idle clients killed by DROP DATABASE at teardown
 for(const dir of fs.readdirSync(path.join(__dirname,'../prisma/migrations')).sort()){const file=path.join(__dirname,'../prisma/migrations',dir,'migration.sql');if(fs.existsSync(file))await pool.query(fs.readFileSync(file,'utf8'));}
 prisma=new PrismaClient({adapter:new PrismaPg(pool)});global.prisma=prisma;
 Object.assign(process.env,{JWT_SECRET:'synthetic-exceptions-secret',DATABASE_URL:url.toString(),NODE_ENV:'test',NOTIFICATIONS_ENABLED:'false'});
 const password='SyntheticOnly123!',passwordHash=await bcrypt.hash(password,4);
 const user=(email,role)=>prisma.user.create({data:{fullName:email,email,passwordHash,role}});
 const adminUser=await user('admin@x.invalid','ADMIN'),secretary=await user('sec@x.invalid','SECRETARY'),doc=await user('doc@x.invalid','PROFESSIONAL'),other=await user('other@x.invalid','PROFESSIONAL'),free=await user('free@x.invalid','PROFESSIONAL');
 const branch=n=>prisma.branch.create({data:{name:n,address:'-',city:'-',phone:'-',exhibitColor:'#000'}});
 const asu=await branch('Asuncion'),cde=await branch('CDE');
 const prof=(u,workingHours)=>prisma.professional.create({data:{userId:u.id,firstName:u.email,lastName:'X',specialty:'G',registrationNumber:'R',email:u.email,color:'#000',workingHours}});
 // Lunes: mañana Asunción y tarde CDE. 2026-11-16 es lunes, 2026-11-19 jueves.
 const p=await prof(doc,[{branchId:asu.id,days:[1],start:'08:00',end:'12:00'},{branchId:cde.id,days:[1],start:'14:00',end:'18:00'}]);
 const p2=await prof(other,[{branchId:asu.id,days:[1],start:'08:00',end:'12:00'}]);
 await prof(free,null);
 const {app}=require('../dist/app');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const login=async u=>{const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:u.email,password})});assert.equal(r.status,200);return(await r.json()).token;};
 const tA=await login(adminUser),tS=await login(secretary),tD=await login(doc);
 const call=async(token,method,p,body)=>{const r=await fetch(base+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});return{status:r.status,body:r.status===204?null:await r.json()};};
 const slots=async(userId,date,branchId)=>(await call(tS,'GET','/availability/slots?'+new URLSearchParams({date:`${date}T00:00:00.000Z`,professionalId:userId,duration:'30',...(branchId&&{branchId})}))).body;
 // Base: varias franjas, filtro por sede, día sin horario => sin turnos, sin configuración => 08-18.
 let s=await slots(doc.id,'2026-11-16');assert.equal(s[0],'2026-11-16T08:00:00.000Z');assert(s.includes('2026-11-16T14:00:00.000Z'));assert(!s.includes('2026-11-16T12:30:00.000Z'));
 s=await slots(doc.id,'2026-11-16',cde.id);assert.equal(s[0],'2026-11-16T14:00:00.000Z');
 assert.deepEqual(await slots(doc.id,'2026-11-19'),[]);
 s=await slots(free.id,'2026-11-19');assert.equal(s[0],'2026-11-19T08:00:00.000Z');assert.equal(s.at(-1),'2026-11-19T17:30:00.000Z');
 // Día particular: jueves en CDE hasta las 21, reemplaza el día completo.
 assert.equal((await call(tS,'PUT','/schedule-exceptions/site-day',{professionalId:p.id,date:'2026-11-19',windows:[{branchId:cde.id,start:'15:00',end:'21:00'}]})).status,403);
 assert.equal((await call(tD,'PUT','/schedule-exceptions/site-day',{professionalId:p2.id,date:'2026-11-19',windows:[]})).status,403);
 assert.equal((await call(tD,'PUT','/schedule-exceptions/site-day',{professionalId:p.id,date:'2026-11-19',windows:[{start:'08:00',end:'12:00'},{start:'11:00',end:'13:00'}]})).status,400);
 assert.equal((await call(tD,'PUT','/schedule-exceptions/site-day',{professionalId:p.id,date:'2026-11-19',windows:[{branchId:cde.id,start:'15:00',end:'21:00'}]})).status,200);
 s=await slots(doc.id,'2026-11-19');assert.equal(s[0],'2026-11-19T15:00:00.000Z');assert(s.includes('2026-11-19T20:30:00.000Z'));
 assert.deepEqual(await slots(doc.id,'2026-11-19',asu.id),[]);
 const w=(await call(tS,'GET','/availability/windows?date=2026-11-19')).body.find(x=>x.userId===doc.id);assert.deepEqual(w.windows.map(x=>[x.start,x.end,x.source]),[['15:00','21:00','site']]);
 // Particular para el lunes 16 reemplaza base; vaciarlo vuelve a la base.
 await call(tA,'PUT','/schedule-exceptions/site-day',{professionalId:p.id,date:'2026-11-16',windows:[{branchId:asu.id,start:'09:00',end:'10:00'}]});
 assert.equal((await slots(doc.id,'2026-11-16')).length,4);
 await call(tA,'PUT','/schedule-exceptions/site-day',{professionalId:p.id,date:'2026-11-16',windows:[]});
 assert.equal((await slots(doc.id,'2026-11-16'))[0],'2026-11-16T08:00:00.000Z');
 // Ausencia: secretaría solicita (pendiente, sin efecto); el médico aprueba; citas quedan a reagendar.
 const patient=await prisma.patient.create({data:{firstName:'Syn',lastName:'Patient',identifier:'EXC-1'}});
 const appt=await prisma.appointment.create({data:{patientId:patient.id,doctorId:doc.id,branchId:cde.id,date:new Date('2026-11-23T15:00:00Z'),duration:30,type:'CONSULTATION',status:'SCHEDULED'}});
 await prisma.appointment.create({data:{patientId:patient.id,doctorId:doc.id,date:new Date('2026-11-23T09:00:00Z'),duration:30,type:'CONSULTATION',status:'SCHEDULED'}});
 const ooo={professionalId:p.id,dateFrom:'2026-11-23',dateTo:'2026-11-23',startTime:'13:00',endTime:'19:00',reason:'Congreso'};
 const dry=await call(tS,'POST','/schedule-exceptions/ooo',{...ooo,dryRun:true});assert.equal(dry.body.status,'PENDING');assert.deepEqual(dry.body.affected.map(a=>a.id),[appt.id]);
 assert.equal((await call(tS,'GET','/schedule-exceptions?kind=OOO')).body.length,0);
 const req=await call(tS,'POST','/schedule-exceptions/ooo',ooo);assert.equal(req.status,201);assert.equal(req.body.exception.status,'PENDING');
 assert((await slots(doc.id,'2026-11-23')).includes('2026-11-23T16:00:00.000Z'));
 assert.equal((await call(tA,'GET','/schedule-exceptions/to-reschedule')).body.length,0);
 assert.equal((await call(tS,'PATCH',`/schedule-exceptions/${req.body.exception.id}/review`,{approve:true})).status,403);
 const ok=await call(tD,'PATCH',`/schedule-exceptions/${req.body.exception.id}/review`,{approve:true});assert.equal(ok.status,200);assert.equal(ok.body.affected.length,1);
 s=await slots(doc.id,'2026-11-23');assert(s.includes('2026-11-23T08:00:00.000Z'));assert(!s.some(x=>x>='2026-11-23T13'));
 const list=(await call(tS,'GET','/schedule-exceptions/to-reschedule')).body;assert.deepEqual(list.map(a=>a.id),[appt.id]);assert.equal(list[0].absence.reason,'Congreso');assert.equal(list[0].patient.lastName,'Patient');
 assert.equal((await call(tS,'DELETE',`/schedule-exceptions/${req.body.exception.id}`)).status,403);
 // Ausencia de día completo creada por admin queda aprobada al instante.
 const full=await call(tA,'POST','/schedule-exceptions/ooo',{professionalId:p.id,dateFrom:'2026-11-30',dateTo:'2026-11-30'});assert.equal(full.body.exception.status,'APPROVED');
 assert.deepEqual(await slots(doc.id,'2026-11-30'),[]);
 assert.equal((await call(tD,'DELETE',`/schedule-exceptions/${full.body.exception.id}`)).status,204);
 assert.equal((await slots(doc.id,'2026-11-30'))[0],'2026-11-30T08:00:00.000Z');
 assert.equal((await call(tA,'POST','/schedule-exceptions/ooo',{professionalId:p.id,dateFrom:'2026-11-30',dateTo:'2026-11-29'})).status,400);
 }finally{if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();if(pool)await pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
});
