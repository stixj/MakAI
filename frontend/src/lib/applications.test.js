import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationNextStep} from './applications.js';
const now=new Date('2026-10-09T10:00:00Z');
const blank={status:'waiting',appliedAt:'2026-10-01',tasks:[],interviews:[]};
test('next step prioritizes overdue tasks and the nearest scheduled event, ignoring completed and cancelled entries',()=>{
 const interview={at:'2026-10-10T10:00:00Z',cancelled:false};
 const task={text:'Poslat podklady',due:'2026-10-08',done:false};
 assert.equal(applicationNextStep({...blank,tasks:[task],interviews:[interview]},now).overdue,true);
 assert.equal(applicationNextStep({...blank,tasks:[{...task,due:'2026-10-12'}],interviews:[interview]},now).kind,'interview');
 assert.equal(applicationNextStep({...blank,tasks:[{...task,done:true}],interviews:[{...interview,cancelled:true}]},now).kind,'waiting');
 assert.equal(applicationNextStep({...blank,status:'rejected',tasks:[task],interviews:[interview]},now).kind,'closed');
});
test('elapsed days use Prague calendar dates and no follow-up is invented without a known sent date',()=>{
 assert.equal(applicationNextStep(blank,now).daysSinceApplied,8);
 assert.equal(applicationNextStep(blank,now).suggestFollowUp,true);
 assert.equal(applicationNextStep({...blank,appliedAt:null},now).suggestFollowUp,false);
 assert.equal(applicationNextStep({...blank,appliedAt:'2026-10-10'},now).daysSinceApplied,null);
 assert.equal(applicationNextStep({...blank,appliedAt:'2026-10-09'},new Date('2026-10-09T23:30:00Z')).daysSinceApplied,1);
});

test('promised response suppresses generic reminders until due; assignments disappear when delivered',()=>{
 const promised={...blank,responseExpectedAt:'2026-10-12'};
 assert.equal(applicationNextStep(promised,now).suggestFollowUp,false);
 const overdue=applicationNextStep({...promised,responseExpectedAt:'2026-10-08'},now);assert.equal(overdue.kind,'response');assert.equal(overdue.suggestFollowUp,true);
 const assignment={...promised,assignment:'Návrh řešení',assignmentDue:'2026-10-08',assignmentDone:false};assert.equal(applicationNextStep(assignment,now).kind,'assignment');
 assert.equal(applicationNextStep({...assignment,assignmentDone:true},now).kind,'waiting');
});
