const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {Pool}=require('pg');
const {PrismaClient}=require('@prisma/client');
const {PrismaPg}=require('@prisma/adapter-pg');
const bcrypt=require('bcrypt'),jwt=require('jsonwebtoken');
test('secretary scheduling: session duration, clock boundaries, preferred slots and collisions',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const source=new URL(process.env.TEST_DATABASE_URL);assert(['localhost','127.0.0.1','[::1]'].includes(source.hostname));
 const admin=new Pool({connectionString:source.toString()}),name=`cedin_schedule_${process.pid}`;let created=false,pool,prisma,server;
 try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;const url=new URL(source);url.pathname='/'+name;pool=new Pool({connectionString:url.toString()});
 for(const dir of fs.readdirSync(path.join(__dirname,'../prisma/migrations')).sort()){const file=path.join(__dirname,'../prisma/migrations',dir,'migration.sql');if(fs.existsSync(file))await pool.query(fs.readFileSync(file,'utf8'));}
 prisma=new PrismaClient({adapter:new PrismaPg(pool)});global.prisma=prisma;
 Object.assign(process.env,{JWT_SECRET:'synthetic-scheduling-secret',DATABASE_URL:url.toString(),NODE_ENV:'test',NOTIFICATIONS_ENABLED:'false'});
 const password='SyntheticOnly123!',passwordHash=await bcrypt.hash(password,4);
 const secretary=await prisma.user.create({data:{fullName:'Synthetic secretary',email:'secretary@schedule.invalid',passwordHash,role:'SECRETARY'}});
 const doctor=await prisma.user.create({data:{fullName:'Synthetic doctor',email:'doctor@schedule.invalid',passwordHash,role:'PROFESSIONAL'}});
 await prisma.professional.create({data:{userId:doctor.id,firstName:'Synthetic',lastName:'Doctor',specialty:'General',registrationNumber:'SYN',email:doctor.email,color:'#000000',workingHours:{days:[3],start:'08:30',end:'12:45'}}});
 const {app}=require('../dist/app');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;
 const login=async rememberMe=>{const res=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier:secretary.email,password,rememberMe})});assert.equal(res.status,200);return(await res.json()).token;};
 const token=await login(false),remembered=await login(true);assert.equal(jwt.decode(token).exp-jwt.decode(token).iat,8*3600);assert.equal(jwt.decode(remembered).exp-jwt.decode(remembered).iat,24*3600);
 const slots=async preferredTime=>{const res=await fetch(base+'/availability/slots?'+new URLSearchParams({date:'2026-10-14T00:00:00.000Z',professionalId:doctor.id,duration:'30',preferredTime}),{headers:{Authorization:'Bearer '+token}});assert.equal(res.status,200);return res.json();};
 let available=await slots('10:15');assert.equal(available[0],'2026-10-14T08:30:00.000Z');assert(available.includes('2026-10-14T10:15:00.000Z'));assert(available.every(s=>new Date(s).getTime()+30*60000<=Date.parse('2026-10-14T12:45:00Z')));
 assert(!(await slots('08:15')).includes('2026-10-14T08:15:00.000Z'));assert(!(await slots('12:30')).includes('2026-10-14T12:30:00.000Z'));
 const patient=await prisma.patient.create({data:{firstName:'Synthetic',lastName:'Patient',identifier:'SCHEDULE-SYNTHETIC'}});
 await prisma.appointment.create({data:{patientId:patient.id,doctorId:doctor.id,date:new Date('2026-10-14T10:10:00Z'),duration:30,type:'CONSULTATION',status:'CONFIRMED'}});
 available=await slots('10:15');assert(!available.includes('2026-10-14T10:15:00.000Z'));assert(available.includes('2026-10-14T10:40:00.000Z'));
 }finally{if(server)await new Promise(r=>server.close(r));if(prisma)await prisma.$disconnect();if(pool)await pool.end();if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
});
