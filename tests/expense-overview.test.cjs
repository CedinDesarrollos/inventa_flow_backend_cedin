const {test}=require('node:test');const assert=require('node:assert/strict');
const {expenseOverview,expensePaymentDay}=require('../dist/services/cost-overview');
const filters={startMonth:'2026-09',endMonth:'2026-10',basis:'payment',page:1,pageSize:25};
function cost(id,amount,date,extra={}){return {id,categoryId:'services',category:{name:'Servicios'},description:'Compra '+id,amount,date:new Date(date),isRecurring:false,...extra};}
const rows=[cost('definition',1000,'2026-10-01T00:00:00Z',{isRecurring:true}),cost('rent',1000,'2026-11-01T02:30:00Z',{recurringParentId:'rent-template',recurringPeriod:'2026-09',parent:{description:'Alquiler'}}),cost('small-a',0.1,'2026-10-31T23:30:00Z'),cost('small-b',0.2,'2026-10-31T23:31:00Z'),cost('stock',25,'2026-10-10T00:00:00Z',{categoryId:'supplies',category:{name:'Insumos'},inventoryMovements:[{id:'movement'}]})];
test('expense comparison excludes definitions, includes inventory once, preserves last clinic day and exact cents',()=>{
 const result=expenseOverview(rows,filters);
 assert.equal(result.summary.total,1025.3);assert.equal(result.summary.count,4);
 assert.equal(result.comparison[1].recurring,1000);assert.equal(result.comparison[1].individual,0.3);assert.equal(result.comparison[1].inventory,25);
 assert.equal(expensePaymentDay(new Date('2026-11-01T02:30:00Z')),'2026-10-31');
 assert.equal(expensePaymentDay(new Date('2026-10-01T00:00:00Z')),'2026-10-01');
});
test('period view moves only the paid recurring item; category, concept and chart drill-down retain explainable totals',()=>{
 const period=expenseOverview(rows,{...filters,basis:'period'});assert.equal(period.comparison[0].recurring,1000);assert.equal(period.comparison[1].total,25.3);
 const detail=expenseOverview(rows,{...filters,month:'2026-10',detailOrigin:'individual'});assert.equal(detail.detailTotal,0.3);assert.equal(detail.pagination.total,2);assert.equal(detail.summary.total,1025.3);
 const rent=period.options.concepts.find(x=>x.name==='Alquiler');assert.equal(rent.category,'Servicios');
 const only=expenseOverview(rows,{...filters,basis:'period',conceptId:rent.id});assert.equal(only.detailTotal,1000);assert.equal(only.payments[0].category.name,'Servicios');
 assert.equal(expenseOverview(rows,{...filters,categoryId:'supplies'}).summary.total,25);
});
test('pagination never reduces totals and empty months remain visible',()=>{
 const many=Array.from({length:30},(_,n)=>cost('row-'+n,1,'2026-10-15T15:00:00Z'));
 const result=expenseOverview(many,{...filters,page:2});assert.equal(result.payments.length,5);assert.equal(result.detailTotal,30);assert.equal(result.summary.total,30);assert.equal(result.pagination.totalPages,2);assert.equal(result.comparison[0].total,0);
 assert.throws(()=>expenseOverview(rows,{...filters,startMonth:'2026-11'}),RangeError);
 assert.throws(()=>expenseOverview(rows,{...filters,startMonth:'1900-01'}),RangeError);
});
