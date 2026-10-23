const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
function fixture(existing=false){
 const calls=[];const ctx={module:{exports:{}},console:{log(){}}};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../scene-auto-tagger.js'),'utf8')+'\nthis.api={runImageFolderTagTask,createTag,doGraphQL};',ctx);
 const runtime={gql:{Do(q,v){calls.push(q);if(q.includes('findImages'))return {findImages:{count:1,images:[{id:'990001',tags:[],visual_files:[{path:'C:/fixture/Rule34 Pictures/Fixture Franchise/image.png'}]}]}};
 if(q.includes('findTags'))return {findTags:{count:existing?1:0,tags:existing?[{id:'990002',name:'Fixture Franchise'}]:[]}};
 if(q.includes('imageUpdate'))return {imageUpdate:{id:'990001'}};throw Error('Unexpected fixture request');}}};return {api:ctx.api,runtime,calls};
}
for(const dryRun of [true,false])test('missing image folder definition is blocked, dryRun='+dryRun,()=>{const f=fixture();const r=f.api.runImageFolderTagTask({config:{dryRun,imageTaggingCreateMissingTags:true,imageTaggingLimit:1}},f.runtime);assert.match(r.Output,/blockedCreation=1/);assert.match(r.Output,/updated=0/);assert.match(r.Output,/wouldUpdate=0/);assert(!f.calls.some(q=>/\bmutation\b/.test(q)));});
test('legacy definition helper and final transport both fail closed',()=>{const f=fixture();assert.throws(()=>f.api.createTag('Fixture Franchise',[],f.runtime),/AUTOMATIC_TAG_CREATION_NOT_PERMITTED/);assert.throws(()=>f.api.doGraphQL('mutation { tagCreate(input:$input){id} }',{input:{name:'Fixture Franchise'}},f.runtime),/AUTOMATIC_TAG_CREATION_NOT_PERMITTED/);assert.equal(f.calls.length,0);});
test('existing image assignment semantics are unchanged',()=>{const f=fixture(true);const r=f.api.runImageFolderTagTask({config:{dryRun:false,imageTaggingLimit:1}},f.runtime);assert.match(r.Output,/updated=1/);assert.match(r.Output,/blockedCreation=0/);assert.equal(f.calls.filter(q=>q.includes('imageUpdate')).length,1);assert(!f.calls.some(q=>q.includes('tagCreate')));});
