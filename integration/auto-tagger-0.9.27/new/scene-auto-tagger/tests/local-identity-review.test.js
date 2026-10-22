const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../scene-auto-tagger.js'),'utf8');
const record=(extra={})=>({tagId:'810001',nativeName:'Fixture Mascot',canonical:'Fixture fictional mascot',identityKey:'Fixture fictional mascot',category:'fictional-mascot',gender:'female',policyApproval:true,evidence:'user-policy',sources:[],associationMode:'review-required',matchNames:['Fixture fictional mascot'],...extra});
const tag=(name='Fixture Mascot',id='810001')=>({id,name,ignore_auto_tag:false,parents:[]});
function fixture(records){const context={module:{exports:{}},console:{log(){},error(){}}};vm.createContext(context);vm.runInContext(source.replace(/^const localReview = .*;$/m,'const localReview = '+JSON.stringify({schemaVersion:1,revision:'fixture',records})+';'),context);return context.module.exports;}
test('fictional mascot eligibility is distinct from brand/person and scene association',()=>{
 const p=fixture([record()]).identityEligibility;
 assert.equal(p.classify(tag()).status,'eligible');
 assert.equal(p.classify(tag('Fixture Restaurant')).status,'unresolved');
 assert.equal(p.classify(tag('Fixture Real Person')).status,'unresolved');
 assert.equal(p.authorize(tag(),{title:'Fixture fictional mascot'}).reason,'unresolved-scene-association');
 assert.equal(p.classify({...tag(),ignore_auto_tag:true}).reason,'unresolved-ignored');
 assert.equal(p.classify({...tag(),parents:[{name:'Franchises'}]}).reason,'unresolved-conflicting-taxonomy');
});
test('bound ID and native name drift fail closed; aliases cannot cross-bind',()=>{
 const p=fixture([record({nativeName:'Old Mislabel',canonical:'Correct Identity',category:'character',matchNames:['Correct Identity'],associationMode:'exact-phrase'})]).identityEligibility;
 assert.equal(p.classify(tag('Old Mislabel')).status,'eligible');
 assert.equal(p.classify(tag('Mercy')).status,'unresolved');
 assert.equal(p.classify(tag('Old Mislabel','810002')).status,'unresolved');
 assert.equal(p.authorize(tag('Old Mislabel'),{title:'Old Mislabel'}).status,'unresolved');
 assert.equal(p.authorize(tag('Old Mislabel'),{title:'Correct Identity'}).status,'eligible');
});
test('approved categories and form/collective association holds are explicit',()=>{
 for(const category of ['fictional-mascot','fictional-avatar','collective','shared-mantle','female-form']){
  assert.equal(fixture([record({category})]).identityEligibility.classify(tag()).status,'eligible');
  assert.equal(fixture([record({category,policyApproval:false})]).identityEligibility.classify(tag()).status,'ineligible');
 }
 assert.equal(fixture([record({category:'adult-performer',adultVerified:false})]).identityEligibility.classify(tag()).status,'unresolved');
 assert.equal(fixture([record({eligibilityHold:'unresolved-identity-details'})]).identityEligibility.classify(tag()).status,'unresolved');
});
test('exact short identifiers need explicit opt-in and whole-token match',()=>{
 const r=record({nativeName:'Q2',canonical:'Q2',category:'character',matchNames:['Q2'],associationMode:'exact-phrase',allowShortIdentifier:true}),p=fixture([r]).identityEligibility;
 assert.equal(p.authorize(tag('Q2'),{title:'Q2 animation'}).status,'eligible');
 for(const title of ['Q20','XQ2','Brand only'])assert.equal(p.authorize(tag('Q2'),{title}).status,'unresolved');
 assert.equal(fixture([{...r,allowShortIdentifier:false}]).identityEligibility.authorize(tag('Q2'),{title:'Q2 animation'}).status,'unresolved');
});
test('canonical duplicates remain blocked across separately bound records',()=>{
 const o=fixture([record({associationMode:'exact-phrase'}),record({tagId:'810002',nativeName:'Alternate Label',associationMode:'exact-phrase'})]);
 const tags=[tag(),tag('Alternate Label','810002')],scene={id:'4',title:'Fixture fictional mascot',tags:[tag('Retained','9')]};
 const runtime={gql:{Do(q){assert(!q.includes('mutation'));return q.includes('findScene')?{findScene:scene}:{findTags:{count:2,tags}};}}};
 const result=o.readIdentityEligibility({kind:'tags',tagIds:tags.map(t=>t.id)},runtime);
 assert(result.tags.every(t=>t.reason==='unresolved-alias-collision'&&t.identityStatus==='eligible'));
 assert.throws(()=>o.guardSceneIdentityWrite({id:'4',tag_ids:['9','810001']},runtime),/alias-collision/);
 assert.throws(()=>o.guardSceneIdentityWrite({id:'4',tag_ids:[]},runtime),/REMOVAL/);
});
test('ineligible and ignored states do not become unknown because of duplicates',()=>{
 const o=fixture([record({gender:'male'}),record({tagId:'810002',nativeName:'Alternate Label',gender:'male'})]);
 const tags=[tag(),tag('Alternate Label','810002')];
 const result=o.readIdentityEligibility({kind:'tags',tagIds:tags.map(t=>t.id)},{gql:{Do:()=>({findTags:{count:2,tags}})}});
 assert(result.tags.every(t=>t.status==='ineligible'));
});
