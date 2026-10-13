const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');
const { DateTime } = require('luxon');

test('requested fixes: history paging, whole-day agenda, recurring period, revoked user sessions', { skip: !process.env.TEST_DATABASE_URL }, async () => {
 const source = new URL(process.env.TEST_DATABASE_URL);
 assert(['localhost','127.0.0.1','[::1]'].includes(source.hostname));
 const admin = new Pool({connectionString:source.toString()});
 const name = `cedin_requested_${process.pid}`;
 let pool,prisma,server,created=false;
 try {
  await admin.query(`CREATE DATABASE "${name}"`);created=true;
  const url=new URL(source);url.pathname='/'+name;
  pool=new Pool({connectionString:url.toString()});
  for(const migration of fs.readdirSync(path.join(__dirname,'../prisma/migrations')).sort()){
   const file=path.join(__dirname,'../prisma/migrations',migration,'migration.sql');
   if(fs.existsSync(file))await pool.query(fs.readFileSync(file,'utf8'));
  }
  prisma=new PrismaClient({adapter:new PrismaPg(pool)});global.prisma=prisma;
  Object.assign(process.env,{JWT_SECRET:'synthetic-four-fixes-secret',DATABASE_URL:url.toString(),NODE_ENV:'test',NOTIFICATIONS_ENABLED:'false'});
  const password='SyntheticOnly123!';const passwordHash=await bcrypt.hash(password,4);
  const manager=await prisma.user.create({data:{fullName:'Synthetic manager',email:'manager@four.invalid',username:'four.admin',passwordHash,role:'ADMIN'}});
  const professional=await prisma.user.create({data:{fullName:'Synthetic doctor',email:'doctor@four.invalid',username:'four.doctor',passwordHash,role:'PROFESSIONAL'}});
  const other=await prisma.user.create({data:{fullName:'Synthetic other',email:'other@four.invalid',passwordHash,role:'PROFESSIONAL'}});
  const {app}=require('../dist/app');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(route,{method='GET',body,token}={})=>fetch(base+'/api'+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const json=async(r,status=200)=>{assert.equal(r.status,status,await r.clone().text());return r.json();};
  const login=async identifier=>json(await request('/auth/login',{method:'POST',body:{identifier,password}}));
  const auth=(await login('four.admin')).token;
  const oldToken=(await login('four.doctor')).token;
  const patient=await prisma.patient.create({data:{firstName:'Synthetic',lastName:'Four fixes',identifier:'FOUR-PATIENT'}});
  const branch=await prisma.branch.create({data:{name:'Synthetic branch',address:'Synthetic address',city:'Synthetic city',phone:'000000000',exhibitColor:'#000000',email:'branch@four.invalid'}});
  const secondBranch=await prisma.branch.create({data:{name:'Other synthetic branch',address:'Synthetic address',city:'Synthetic city',phone:'000000000',exhibitColor:'#000000',email:'branch@four.invalid'}});
  for(let n=0;n<23;n++)await prisma.clinicalRecord.create({data:{patientId:patient.id,doctorId:professional.id,date:new Date(Date.UTC(2026,0,n+1)),content:{type:'doc',content:[]}}});
  const first=await json(await request(`/clinical-records/${patient.id}?page=1&pageSize=10`,{token:auth}));
  const second=await json(await request(`/clinical-records/${patient.id}?page=2&pageSize=10`,{token:auth}));
  const last=await json(await request(`/clinical-records/${patient.id}?page=3&pageSize=10`,{token:auth}));
  assert.equal(first.total,23);assert.equal(first.totalPages,3);assert.equal(first.records.length,10);assert.equal(last.records.length,3);
  assert(!first.records.some(a=>second.records.some(b=>a.id===b.id)));
  assert.equal((await request(`/clinical-records/${patient.id}?page=0`,{token:auth})).status,400);
  assert.equal((await json(await request(`/clinical-records/${patient.id}?page=4`,{token:auth}))).records.length,0);
  assert.equal(await prisma.clinicalRecord.count(),23);
  console.log('PASS: paginated clinical history without duplicated or fabricated records');

  const day=DateTime.now().setZone('America/Asuncion').toISODate();
  const tomorrow=DateTime.fromISO(day).plus({days:1}).toISODate();
  const seed=(status,hour,doctorId=professional.id,branchId=branch.id,date=day)=>prisma.appointment.create({data:{patientId:patient.id,doctorId,branchId,date:new Date(`${date}T${hour}:00.000Z`),duration:20,type:'CONSULTATION',status}});
  const scheduled=await seed('SCHEDULED','07:00');const confirmed=await seed('CONFIRMED','23:59');
  const arrived=await seed('ARRIVED','08:00');const attending=await seed('IN_PROGRESS','09:00');
  const elsewhere=await seed('SCHEDULED','10:00',professional.id,secondBranch.id);
  const anotherDoctor=await seed('SCHEDULED','11:00',other.id);const nextDay=await seed('SCHEDULED','07:00',professional.id,branch.id,tomorrow);
  const close=()=>request('/appointments/close-agenda',{method:'POST',token:auth,body:{date:day,doctorId:professional.id,branchId:branch.id}});
  assert.equal((await json(await close())).count,2);assert.equal((await json(await close())).count,0);
  for(const apt of [scheduled,confirmed])assert.equal((await prisma.appointment.findUnique({where:{id:apt.id}})).status,'NO_SHOW');
  for(const apt of [arrived,attending,elsewhere,anotherDoctor,nextDay])assert.equal((await prisma.appointment.findUnique({where:{id:apt.id}})).status,apt.status);
  assert.equal((await request('/appointments/close-agenda',{method:'POST',token:auth,body:{date:tomorrow}})).status,400);
  console.log('PASS: entire pending day closes, arrived/active/other scopes remain');
  const {clinicDateRange}=require('../dist/lib/clinic-dates');const range=clinicDateRange('2026-09-01','2026-09-30');
  const operational=async(date)=>prisma.appointment.create({data:{patientId:patient.id,doctorId:professional.id,branchId:branch.id,date,duration:35,type:'CONSULTATION',status:'COMPLETED'}});
  await operational(new Date(range.gte.getTime()-60000));await operational(range.gte);await operational(new Date(range.lt.getTime()-60000));await operational(range.lt);
  const report=await json(await request(`/reports/kpis?startDate=2026-09-01&endDate=2026-09-30&branchId=${branch.id}&doctorId=${professional.id}`,{token:auth}));
  assert.equal(report.operations.totalAttended,2);assert.deepEqual(report.operations.history.map(day=>day.date),['2026-09-01','2026-09-30']);assert.equal(report.operations.avgDuration,35);
  assert.equal((await request('/reports/kpis?startDate=2026-09-30&endDate=2026-09-01',{token:auth})).status,400);
  console.log('PASS: dashboard dates and daily duration use clinic timezone and reject reversed ranges');
  const billingPatient=await prisma.patient.create({data:{firstName:'Synthetic',lastName:'Report billing',identifier:'REPORT-BILLING',branchId:secondBranch.id}});
  const billingAppointment=await prisma.appointment.create({data:{patientId:billingPatient.id,doctorId:professional.id,branchId:branch.id,date:range.gte,duration:20,type:'CONSULTATION',status:'COMPLETED'}});
  const billing=await prisma.transaction.create({data:{patientId:billingPatient.id,appointmentId:billingAppointment.id,doctorId:professional.id,authorId:manager.id,type:'TICKET',paymentMethod:'CASH',status:'COMPLETED',subtotal:100,total:100,amountPaid:100,balance:0,createdAt:range.gte}});
  await prisma.payment.create({data:{transactionId:billing.id,amount:60,paymentMethod:'CASH',createdAt:new Date('2026-09-02T15:00:00Z'),createdBy:manager.id}});
  await prisma.payment.create({data:{transactionId:billing.id,amount:40,paymentMethod:'CASH',createdAt:new Date('2026-10-02T15:00:00Z'),createdBy:manager.id}});
  const billingRows=await json(await request('/transactions?startDate=2026-09-01&endDate=2026-09-30',{token:auth}));
  assert.equal(billingRows[0].branchId,branch.id);assert.equal(Number(billingRows[0].amountPaid),100);
  const cashRows=await json(await request('/transactions?startDate=2026-09-01&endDate=2026-09-30&cashFlow=true',{token:auth}));
  assert.equal(cashRows.length,1);assert.equal(Number(cashRows[0].amountPaid),60);assert.equal(cashRows[0].branchId,branch.id);
  const otherScope=await json(await request(`/reports/kpis?startDate=2026-09-01&endDate=2026-09-30&branchId=${secondBranch.id}`,{token:auth}));
  assert.equal(otherScope.operations.totalAttended,0);
  console.log('PASS: report receipts use payment date/amount and appointment branch before patient current branch');



  const category=await prisma.costCategory.create({data:{name:'Synthetic category',type:'FIXED'}});
  const template=await prisma.cost.create({data:{categoryId:category.id,description:'Synthetic recurring cost',amount:100,date:new Date(),isRecurring:true,recurrenceRule:'MONTHLY'}});
  const paidAt=new Date().toISOString();
  const payment=await json(await request(`/costs/recurring/${template.id}/pay`,{method:'POST',token:auth,body:{period:'2025-02',date:paidAt,amount:100}}),201);
  assert.equal(payment.recurringPeriod,'2025-02');assert.equal(payment.date,paidAt);assert.equal(payment.createdBy,manager.id);
  const status=await json(await request('/costs/recurring/status?month=2&year=2025',{token:auth}));assert.equal(status[0].status,'PAID');
  assert.equal((await request(`/costs/recurring/${template.id}/pay`,{method:'POST',token:auth,body:{period:'2025-02',date:paidAt,amount:100}})).status,409);
  await prisma.cost.create({data:{categoryId:category.id,description:'Legacy synthetic',amount:100,date:new Date('2025-03-10T00:00:00Z'),recurringParentId:template.id}});
  assert.equal((await json(await request('/costs/recurring/status?month=3&year=2025',{token:auth})))[0].status,'PAID');
  assert.equal((await request(`/costs/recurring/${template.id}/pay`,{method:'POST',token:auth,body:{period:'2025-03',date:paidAt,amount:100}})).status,409);
  assert.equal(await prisma.cost.count({where:{recurringParentId:template.id}}),2);
  console.log('PASS: prior period, actual payment date, legacy status, duplicate prevention');

  const product=await prisma.product.create({data:{name:'Synthetic supplies',currentStock:0}});
  const purchased=await json(await request('/costs',{method:'POST',token:auth,body:{categoryId:category.id,description:'Synthetic inventory purchase',amount:25,date:'2026-10-31T23:50:00.000Z',items:[{productId:product.id,quantity:1,unitPrice:25}]}}),201);
  assert.equal(purchased.createdBy,manager.id);
  assert.equal((await prisma.product.findUnique({where:{id:product.id}})).currentStock,1);
  const overview=await json(await request('/costs/overview?startMonth=2025-01&endMonth=2026-10&basis=payment&pageSize=1',{token:auth}));
  assert.equal(overview.summary.total,225);assert.equal(overview.payments.length,1);assert.equal(overview.pagination.total,3);assert.equal(overview.detailTotal,225);
  assert.equal(overview.comparison.find(m=>m.month==='2026-10').inventory,25);
  const obligation=await json(await request('/costs/overview?startMonth=2025-02&endMonth=2025-02&basis=period',{token:auth}));
  assert.equal(obligation.summary.total,100);assert.equal(obligation.payments[0].category.name,'Synthetic category');
  const lastDay=await json(await request('/costs?startDate=2026-10-31&endDate=2026-10-31&isRecurring=false',{token:auth}));
  assert.equal(lastDay.length,1);assert.equal(lastDay[0].id,purchased.id);
  assert.equal((await request('/costs/overview?startMonth=2025-01&endMonth=2026-10',{token:oldToken})).status,403);
  assert.equal((await request('/costs/overview?startMonth=2025-01&endMonth=2026-10')).status,401);
  console.log('PASS: expense overview excludes definitions, respects period and includes linked inventory and last-day payments');
  const scopedBody={categoryId:category.id,description:'Synthetic scoped expense',amount:37,date:'2026-10-15T00:00:00.000Z',branchId:branch.id};
  const scoped=await json(await request('/costs',{method:'POST',token:auth,body:scopedBody}),201);
  await json(await request('/costs',{method:'POST',token:auth,body:{...scopedBody,amount:63,branchId:secondBranch.id}}),201);
  const scopeQuery=`/costs/overview?startMonth=2025-01&endMonth=2026-10&branchId=${branch.id}`;
  const withLegacy=await json(await request(scopeQuery,{token:auth}));
  assert.equal(withLegacy.summary.total,262);assert.equal(withLegacy.summary.unassignedCount,3);assert.equal(withLegacy.summary.unassignedTotal,225);
  const strict=await json(await request(scopeQuery+'&includeUnassigned=false',{token:auth}));
  assert.equal(strict.summary.total,37);assert.equal(strict.summary.count,1);assert.equal(strict.summary.unassignedCount,0);
  assert.equal(strict.payments[0].branch.name,branch.name);
  await json(await request('/costs/'+scoped.id,{method:'PUT',token:auth,body:{...scopedBody,branchId:null}}));
  assert.equal((await prisma.cost.findUnique({where:{id:scoped.id}})).branchId,null);
  assert.equal((await json(await request(scopeQuery+'&includeUnassigned=false',{token:auth}))).summary.total,0);
  console.log('PASS: legacy unassigned expenses visible explicitly, other branches excluded, strict scope and branch editing work');


  await json(await request(`/users/${professional.id}`,{method:'PUT',token:auth,body:{isActive:false}}));
  assert.equal((await request('/auth/login',{method:'POST',body:{identifier:'four.doctor',password}})).status,401);
  assert.equal((await request('/appointments',{token:oldToken})).status,401);
  await json(await request(`/users/${professional.id}`,{method:'PUT',token:auth,body:{isActive:true}}));
  assert.equal((await request('/appointments',{token:oldToken})).status,401);
  assert.equal((await request('/appointments',{token:(await login('four.doctor')).token})).status,200);
  assert.equal((await request(`/users/${manager.id}`,{method:'PUT',token:auth,body:{isActive:false}})).status,400);
  console.log('PASS: inactive login blocked, old sessions stay revoked after reactivation');
 } finally {
  if(server)await new Promise(r=>server.close(r));
  if(prisma)await prisma.$disconnect();if(pool)await pool.end();delete global.prisma;
  if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();
 }
});
