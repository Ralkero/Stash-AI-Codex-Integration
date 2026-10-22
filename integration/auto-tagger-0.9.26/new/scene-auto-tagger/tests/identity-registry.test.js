const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const owner=require('../scene-auto-tagger.js');
const manifest=require('../identity-registry.json');
const p=owner.identityEligibility;
const tag=(name,id='1')=>({id,name,ignore_auto_tag:false,parents:[]});
test('reviewed registry schema, provenance, deterministic aliases and privacy',()=>{
  assert.equal(manifest.schemaVersion,1);
  assert.equal(p.registryRevision,manifest.revision);
  assert.equal(manifest.records.length,66);
  const seen=new Set();
  for(const r of manifest.records){
    assert.equal(r.category,'character');assert.equal(r.gender,'female');
    assert.ok(r.franchise && r.basis && r.sources.length);
    assert.ok(!Object.hasOwn(r,'tagId')&&!Object.hasOwn(r,'adultVerified'));
    for(const url of r.sources){const u=new URL(url);assert.equal(u.protocol,'https:');assert.ok(!u.username&&!u.password);}
    for(const n of [r.canonical,...r.aliases]){
      const key=p.normalizeIdentity(n);assert.ok(key.length>=3);assert.ok(!seen.has(key),'ambiguous alias '+n);seen.add(key);
      assert.equal(p.resolve(tag(n)).length,1);
    }
  }
  assert.doesNotMatch(JSON.stringify(manifest),/localhost|127\.0\.0\.1|sceneIds|tag_ids/i);
});
for(const r of manifest.records)test('reviewed identity and separate association: '+r.canonical,()=>{
  for(const name of [r.canonical,...r.aliases]){
    const decision=p.classify(tag(name));assert.equal(decision.status,'eligible');
    assert.equal(decision.canonical,r.canonical);assert.deepEqual(decision.evidenceSources,r.sources);
    assert.equal(p.authorize(tag(name),{title:r.franchise,files:[]}).reason,'unresolved-scene-association');
    assert.equal(p.authorize(tag(name),{title:name+' animation'}).status,'eligible');
    assert.equal(p.classify({...tag(name),ignore_auto_tag:true}).reason,'unresolved-ignored');
    assert.equal(p.classify({...tag(name),parents:[{name:'Franchises'}]}).reason,'unresolved-conflicting-taxonomy');
  }
});
test('ambiguous labels and unverified gender are not promoted',()=>{
  for(const name of ['Ashe','Anna','Nami','Nero','Lisa','Jane Doe','Bayonetta','Evelynn','Fate','Audio','The Twins','Black Widow','Aunt Cass','Cass Hamada','Ashley Graham','Unknown Girl'])
    assert.equal(p.classify(tag(name)).status,'unresolved',name);
});
for(const names of [['Samus','Samus Aran'],['Lili','Emilie De Rochefort'],['Sue Storm','Susan Storm']])test('verified aliases still collide at the read and native write boundary: '+names.join('/'),()=>{
  const tags=names.map((n,i)=>tag(n,String(i+1)));
  const scene={id:'8',title:names[0]+' animation',tags:[tag('Existing unknown','9')]};
  const runtime={gql:{Do(q){if(q.includes('findScene'))return {findScene:scene};if(q.includes('findTags'))return {findTags:{count:tags.length,tags}};throw Error('Unexpected write');}}};
  const r=owner.readIdentityEligibility({kind:'tags',tagIds:['1','2']},runtime);
  assert.ok(r.tags.every(t=>t.reason==='unresolved-alias-collision'));
  assert.throws(()=>owner.guardSceneIdentityWrite({id:'8',tag_ids:['9','1']},runtime),/alias-collision/);
});
test('new registry records pass the same preserving native boundary',()=>{
  const tags=[tag('Jill Valentine','1'),tag('Anna','2')];
  const scene={id:'8',title:'Jill Valentine animation',tags:[tag('Old unknown','9')],files:[]};
  let mutations=0;
  const runtime={gql:{Do(q){if(q.includes('mutation')){mutations++;throw Error('Unexpected write');}if(q.includes('findScene'))return {findScene:scene};return {findTags:{count:tags.length,tags}};}}};
  assert.deepEqual(owner.guardSceneIdentityWrite({id:'8',tag_ids:['9','1']},runtime),{id:'8',tag_ids:['9','1']});
  assert.throws(()=>owner.guardSceneIdentityWrite({id:'8',tag_ids:['9','2']},runtime),/unresolved/);
  assert.throws(()=>owner.guardSceneIdentityWrite({id:'8',tag_ids:['1']},runtime),/REMOVAL/);
  scene.title='Resident Evil';assert.throws(()=>owner.guardSceneIdentityWrite({id:'8',tag_ids:['9','1']},runtime),/scene-association/);
  assert.equal(mutations,0);assert.deepEqual(scene.tags,[tag('Old unknown','9')]);
});
test('generated registry is local-only and seed semantics remain stable',()=>{
  const source=fs.readFileSync(require.resolve('../identity-eligibility-source.js'),'utf8');
  assert.doesNotMatch(source,/fetch\(|https?\.request|\\p\{/);
  assert.equal(p.classify(tag('Batman')).reason,'ineligible-male-character');
  assert.equal(p.classify(tag('Overwatch')).reason,'ineligible-franchise');
  assert.equal(p.classify(tag('Mercy')).status,'eligible');
  assert.equal(p.normalizeIdentity('Jill_Valentine'),'jill valentine');
});
