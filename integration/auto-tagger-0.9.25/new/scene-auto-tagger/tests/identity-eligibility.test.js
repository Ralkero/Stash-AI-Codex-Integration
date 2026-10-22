const {test}=require('node:test');
const assert=require('node:assert/strict');
const owner=require('../scene-auto-tagger.js');
const p=owner.identityEligibility;
const tag=(name,id='1')=>({id,name,ignore_auto_tag:false,parents:[]});
for(const name of ['Mercy','Widowmaker','Tifa Lockhart','Aerith Gainsborough','Kiriko','Wonder Woman','Supergirl','Batgirl'])
  test('eligible '+name,()=>assert.equal(p.classify(tag(name)).status,'eligible'));
for(const name of ['Chainsaw Man','Spider-Man','Iron Man','Batman','Superman','Hellboy','Reinhardt','Baymax','Overwatch','Soul Calibur'])
  test('excluded '+name,()=>assert.equal(p.classify(tag(name)).status,'ineligible'));
for(const name of ['Amanda','Manami','Human','Woman','Wonder Woman'])
  test('no masculine substring '+name,()=>assert.notEqual(p.genderSignal(name),'male'));
test('normalized word boundaries',()=>{
  for(const name of ['SPIDER_MAN',' Spider—Man ','iron-man','Chainsaw_Man']) assert.equal(p.genderSignal(name),'male');
  assert.equal(p.classify(tag('Unknown Girl')).status,'unresolved');
});
test('typed identity authority and conflict',()=>{
  assert.equal(p.classify({...tag('Chainsaw Man'),parents:[{name:'Franchises'}]}).reason,'ineligible-franchise');
  assert.equal(p.classify(tag('Chainsaw Man')).reason,'ineligible-male-character');
  const record={canonical:'Fixture',category:'character',gender:'female',evidence:'fixture-reviewed'};
  for(const gender of ['male','genderless','agender','nonbinary'])
    assert.equal(p.classify(tag('Fixture'),[{...record,gender}]).status,'ineligible');
  for(const gender of [null,'unknown']) assert.equal(p.classify(tag('Fixture'),[{...record,gender}]).status,'unresolved');
  for(const category of ['franchise','author-credit','descriptor','object','category'])
    assert.equal(p.classify(tag('Fixture'),[{...record,category}]).reason,'ineligible-'+category);
  assert.equal(p.classify(tag('Fixture'),[{...record,category:'adult-performer',adultVerified:true}]).status,'eligible');
  assert.equal(p.classify(tag('Fixture'),[{...record,category:'adult-performer'}]).status,'unresolved');
  assert.equal(p.classify(tag('Fixture'),[{...record,aliases:['Iron Man']}]).reason,'unresolved-conflicting-evidence');
  assert.equal(p.classify(tag('Fixture'),[record,record]).reason,'unresolved-alias-collision');
  assert.equal(p.classify({...tag('Mercy'),parents:[{name:'Descriptors'}]}).status,'unresolved');
  assert.equal(p.classify({...tag('Mercy'),ignore_auto_tag:true}).status,'unresolved');
});
test('association is identity-specific, not franchise or folder membership',()=>{
  assert.equal(p.authorize(tag('Mercy'),{title:'Overwatch',files:[{path:'C:/Mercy/clip.mp4'}]}).reason,'unresolved-scene-association');
  assert.equal(p.authorize(tag('Mercy'),{title:'Mercy animation'}).status,'eligible');
  assert.equal(p.authorize(tag('Mercy'),{title:'Mercyless'}).status,'unresolved');
});
function fixture(tags=[tag('Mercy'),tag('Overwatch','2')]) {
  const scene={id:'8',title:'Mercy Overwatch',tags:[tag('Existing unknown','9')],files:[],studio:{id:'4'},groups:[]};
  const calls=[];return {scene,calls,runtime:{gql:{Do(q,v){calls.push({q,v});
    if(q.includes('findScene'))return {findScene:scene};
    if(q.includes('IdentityPolicyTags'))return {findTags:{count:tags.length,tags}};
    throw Error('Unexpected operation');
  }}}};
}
test('shared write guard preserves existing tags and filters only preview additions',()=>{
  const f=fixture(),before=JSON.stringify(f.scene);
  const allowed=owner.guardSceneIdentityWrite({id:'8',tag_ids:['9','1']},f.runtime);
  assert.deepEqual(allowed,{id:'8',tag_ids:['9','1']});
  assert.throws(()=>owner.guardSceneIdentityWrite({id:'8',tag_ids:['9','2']},f.runtime),/ineligible-franchise/);
  assert.deepEqual(owner.guardSceneIdentityWrite({id:'8',tag_ids:['1','2']},f.runtime,true),allowed);
  assert.throws(()=>owner.guardSceneIdentityWrite({id:'8',tag_ids:[]},f.runtime),/REMOVAL_NOT_PERMITTED/);
  assert.equal(JSON.stringify(f.scene),before);
  assert.ok(f.calls.every(c=>!c.q.includes('mutation')));
});
test('duplicate names, missing API and absent scene fail closed',()=>{
  const f=fixture([tag('Mercy'),tag('Mercy','3')]);
  assert.throws(()=>owner.guardSceneIdentityWrite({id:'8',tag_ids:['9','1']},f.runtime),/alias-collision/);
  assert.throws(()=>owner.guardSceneIdentityWrite({id:'8',tag_ids:['1']},{}),/not available/);
  assert.throws(()=>owner.guardSceneIdentityWrite({id:'8',tag_ids:['1']},{gql:{Do:()=>({})}}),/SCENE_UNAVAILABLE/);
});
test('read API validates bounds, cannot execute writes',()=>{
  assert.equal(owner.readIdentityEligibility({kind:'capabilities'},{}).readOnly,true);
  assert.throws(()=>owner.readIdentityEligibility({kind:'tags',tagIds:['1'],query:'mutation'},{}),/INVALID_ARGUMENT/);
  assert.throws(()=>owner.readIdentityEligibility({kind:'tags',tagIds:Array(51).fill('1')},{}),/INVALID_IDS/);
});
test('actual GraphQL boundary prevents forbidden writes and preserves allowed payload',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const ctx={module:{exports:{}},console};vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require.resolve('../scene-auto-tagger.js'),'utf8')+'\nthis.send=doGraphQL;this.build=buildUpdateInput;',ctx);
  const f=fixture();let writes=[];const read=f.runtime.gql.Do;
  f.runtime.gql.Do=(q,v)=>q.includes('sceneUpdate')?(writes.push(v.input),{sceneUpdate:{id:'8'}}):read(q,v);
  const q='mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}';
  for(const id of ['2','unknown'])assert.throws(()=>ctx.send(q,{input:{id:'8',tag_ids:['9',id]}},f.runtime));
  assert.equal(writes.length,0);
  ctx.send(q,{input:{id:'8',tag_ids:['9','1']}},f.runtime);
  assert.deepEqual(JSON.parse(JSON.stringify(writes)),[{id:'8',tag_ids:['9','1']}]);
  const current={currentTagIds:new Set(['9']),currentStudioId:'4',currentGroupIds:new Set()};
  const input=ctx.build('8',{studioId:'4',groupIds:[],tagIds:['9','1']},current);
  f.scene.tags.push(tag('Concurrent change','10'));
  assert.throws(()=>ctx.send(q,{input},f.runtime),/SCENE_CHANGED/);
  assert.equal(writes.length,1);
});
