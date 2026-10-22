// GENERATED exact owner transaction block; fixture GraphQL transport only.
function doGraphQL(q,v,r){return r.gql.Do(q,v);}
// BEGIN GENERATED DESCRIPTOR TRANSACTIONS
var SceneDescriptorTransactions = (function(){
var FIELD_ACTS="r34_sex_acts_positions", FIELD_ENDINGS="r34_ending_descriptors", FIELD_STATUS="r34_scene_descriptor_status", FIELD_SOURCE="r34_scene_descriptor_source";
  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function uniq(values) {
    var seen = {};
    return (values || []).filter(function (value) {
      var key = normalize(value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }
  function readList(fields, key) {
    var raw = fields && fields[key];
    if (!raw) return [];
    if (Array.isArray(raw)) return uniq(raw.map(String));
    try {
      var parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) return uniq(parsed.map(String));
    } catch (ignore) {}
    return uniq(String(raw).split(/[|,]/).map(function (item) { return item.trim(); }));
  }
  function scenePath(scene) {
    return String(scene && scene.files && scene.files[0] && scene.files[0].path || "");
  }
  function isRule34Scene(scene) {
    var path = scenePath(scene).replace(/\//g, "\\");
    return /\\Rule34(?:\\|$)/i.test(path) && !/\\_r34_[^\\]*(?:\\|$)/i.test(path);
  }
  function isProcessedScene(scene) {
    var status = String(scene && scene.custom_fields && scene.custom_fields[FIELD_STATUS] || "");
    return status === "reviewed" || status === "not_applicable";
  }
  var ACT_ALIASES = {
    "anal doggystyle": "Anal Doggystyle",
    "pov cowgirl": "POV Cowgirl",
    "prone bone": "Prone Bone",
    "standing sex": "Standing Sex",
    "reverse cowgirl": "Reverse Cowgirl",
    "doggy style": "Doggystyle",
    "doggystyle": "Doggystyle",
    "doggy": "Doggystyle",
    "missionary": "Missionary",
    "cowgirl": "Cowgirl",
    "blow job": "Blowjob",
    "blowjob": "Blowjob",
    "bj": "Blowjob",
    "hand job": "Handjob",
    "handjob": "Handjob",
    "hj": "Handjob",
    "paizuri": "Paizuri",
    "tit job": "Paizuri",
    "titjob": "Paizuri",
    "tit fuck": "Paizuri",
    "titfuck": "Paizuri",
    "deep throat": "Deepthroat",
    "deepthroat": "Deepthroat",
    "face sitting": "Facesitting",
    "facesitting": "Facesitting",
    "facesit": "Facesitting",
    "pile driver": "Piledriver",
    "piledriver": "Piledriver",
    "spooning": "Spooning",
    "riding": "Riding",
    "on top": "On Top",
    "foot job": "Footjob",
    "footjob": "Footjob",
    "butt job": "Buttjob",
    "buttjob": "Buttjob",
    "thigh job": "Thighjob",
    "thighjob": "Thighjob",
    "cunnilingus": "Cunnilingus",
    "fingering": "Fingering",
    "masturbation": "Masturbation",
    "anal": "Anal",
    "oral": "Oral",
    "69": "69"
  };
  var ENDING_ALIASES = {
    "loop": "Loop",
    "creampie": "Creampie",
    "cream pie": "Creampie",
    "swallow": "Swallow",
    "swallowing": "Swallow",
    "facial": "Facial",
    "cumshot": "Cumshot",
    "cum shot": "Cumshot"
  };
  function descriptorAssignmentFields(acts, endings) {
    var partial = {};
    partial[FIELD_ACTS] = JSON.stringify(uniq(acts));
    partial[FIELD_ENDINGS] = JSON.stringify(uniq(endings));
    return partial;
  }
// Generated with exact owner UI helpers/constants, not a second taxonomy.
// The authenticated companion owns the durable operation journal and sole dispatch.
// This synchronous Stash operation validates again; it has no filesystem/lock API.
function fail(code) { throw Error(code); }
// Go's Map scalar can reorder object keys across the GraphQL boundary.
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function(k) { return JSON.stringify(k) + ':' + stable(value[k]); }).join(',') + '}';
  return JSON.stringify(value);
}
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('DESCRIPTOR_INVALID_ARGUMENT');
  Object.keys(value).forEach(function(k) { if (allowed.indexOf(k) < 0) fail('DESCRIPTOR_INVALID_ARGUMENT'); });
}
function ref(category, name) { return category + ':' + encodeURIComponent(name); }
function values(raw) {
  if (raw === null) return [];
  if (typeof raw !== 'string') fail('DESCRIPTOR_INVALID_STORED_VALUE');
  var parsed;
  try { parsed = JSON.parse(raw); } catch (_) { fail('DESCRIPTOR_INVALID_STORED_VALUE'); }
  if (!Array.isArray(parsed) || parsed.length > 100 || !parsed.every(function(v) { return typeof v === 'string' && v.length > 0 && v.length <= 100 && normalize(v); }) || uniq(parsed).length !== parsed.length) fail('DESCRIPTOR_INVALID_STORED_VALUE');
  return parsed;
}
function state(scene) {
  var fields = scene.custom_fields || {}, raw = {};
  [FIELD_ACTS, FIELD_ENDINGS, FIELD_STATUS, FIELD_SOURCE].forEach(function(k) {
    raw[k] = Object.prototype.hasOwnProperty.call(fields, k) ? fields[k] : null;
  });
  values(raw[FIELD_ACTS]); values(raw[FIELD_ENDINGS]);
  return { sceneId: String(scene.id), updatedAt: scene.updated_at, fields: raw };
}
function catalog(snapshot) {
  var result = [];
  ['acts', 'endings'].forEach(function(category) {
    var aliases = category === 'acts' ? ACT_ALIASES : ENDING_ALIASES;
    var field = category === 'acts' ? FIELD_ACTS : FIELD_ENDINGS;
    var builtins = uniq(Object.keys(aliases).map(function(k) { return aliases[k]; }));
    var assigned = snapshot ? values(snapshot.fields[field]) : [];
    uniq(builtins.concat(assigned)).forEach(function(name) {
      result.push({ id: ref(category, name), name: name, category: category,
        authority: builtins.indexOf(name) >= 0 ? 'owner_builtin' : 'target_scene_assignment',
        canAdd: builtins.indexOf(name) >= 0, assigned: assigned.indexOf(name) >= 0 });
    });
  });
  return result;
}
function read(sceneId, runtime) {
  if (typeof sceneId !== 'string' || !/^[1-9][0-9]{0,15}$/.test(sceneId)) fail('DESCRIPTOR_INVALID_SCENE');
  var scene = doGraphQL('query($id:ID!){findScene(id:$id){id updated_at custom_fields files{path}}}', {id:sceneId}, runtime, 'DescriptorTransactionRead').findScene;
  if (!scene) fail('DESCRIPTOR_SCENE_NOT_FOUND');
  if (!isRule34Scene(scene)) fail('DESCRIPTOR_SCENE_INELIGIBLE');
  return scene;
}
function commandIds(ids) {
  if (!Array.isArray(ids) || ids.length > 12 || !ids.every(function(v) { return typeof v === 'string' && v.length <= 320; }) || new Set(ids).size !== ids.length) fail('DESCRIPTOR_INVALID_IDS');
  return ids;
}
function plan(scene, command) {
  keys(command, ['sceneId','add','remove','expected','restore']);
  var before = state(scene), add = commandIds(command.add), remove = commandIds(command.remove);
  if (!add.length && !remove.length) fail('DESCRIPTOR_EMPTY_COMMAND');
  if (add.length + remove.length > 12 || add.some(function(id) { return remove.indexOf(id) >= 0; })) fail('DESCRIPTOR_CONFLICT');
  if (command.expected && stable(command.expected) !== stable(before)) fail('DESCRIPTOR_STALE');
  var definitions = catalog(before), selected = add.concat(remove).map(function(id) {
    var d = definitions.find(function(d) { return d.id === id; });
    if (!d || !d.canAdd) fail('DESCRIPTOR_UNKNOWN_OR_PROTECTED');
    return d;
  });
  var acts = values(before.fields[FIELD_ACTS]), endings = values(before.fields[FIELD_ENDINGS]);
  var afterValues = {acts:acts.slice(), endings:endings.slice()}, added = [], removed = [];
  selected.forEach(function(d) {
    var target = afterValues[d.category], index = target.indexOf(d.name);
    if (add.indexOf(d.id) >= 0 && index < 0) { target.push(d.name); added.push(d); }
    if (remove.indexOf(d.id) >= 0 && index >= 0) { target.splice(index,1); removed.push(d); }
  });
  var serialized = descriptorAssignmentFields(afterValues.acts, afterValues.endings), after = JSON.parse(JSON.stringify(before.fields));
  [FIELD_ACTS, FIELD_ENDINGS].forEach(function(field, i) {
    var category = i ? 'endings' : 'acts';
    if (added.concat(removed).some(function(d) { return d.category === category; })) after[field] = serialized[field];
  });
  if (command.restore !== undefined) {
    // Compensation accepts only the two assignment representations and only if
    // their semantic result exactly matches this independently validated inverse.
    keys(command.restore, [FIELD_ACTS, FIELD_ENDINGS]);
    [FIELD_ACTS, FIELD_ENDINGS].forEach(function(field, i) {
      if (!Object.prototype.hasOwnProperty.call(command.restore,field)) fail('DESCRIPTOR_INVALID_RESTORE');
      var restored = values(command.restore[field]), category = i ? 'endings' : 'acts';
      if (JSON.stringify(restored.slice().sort()) !== JSON.stringify(afterValues[category].slice().sort())) fail('DESCRIPTOR_INVALID_RESTORE');
      afterValues[category] = restored;
      after[field] = command.restore[field];
    });
  }
  var partial = {}, removeFields = [];
  [FIELD_ACTS, FIELD_ENDINGS].forEach(function(field) {
    if (after[field] === before.fields[field]) return;
    if (after[field] === null) removeFields.push(field); else partial[field] = after[field];
  });
  var custom = {};
  if (Object.keys(partial).length) custom.partial = partial;
  if (removeFields.length) custom.remove = removeFields;
  var detail = function(category, names) { return names.map(function(name) { return {id:ref(category,name), name:name, category:category}; }); };
  return { before:before, afterFields:after, mutation:{id:String(scene.id),custom_fields:custom},
    noOp:Object.keys(custom).length === 0, added:added, removed:removed,
    current:detail('acts',acts).concat(detail('endings',endings)),
    proposed:detail('acts',afterValues.acts).concat(detail('endings',afterValues.endings)),
    reviewEffect:'unchanged', operationCount:added.length + removed.length };
}
function run(args, runtime) {
  keys(args,['mode','kind','sceneId','query','command','operationId','expectedPlan']);
  var result = {apiVersion:1, owner:'scene-auto-tagger', ownerVersion:'0.9.20', observedAt:new Date().toISOString()};
  if (args.kind === 'capabilities') return Object.assign(result,{readOnly:true, descriptorTransactions:1, maxChanges:12, reviewEffect:'unchanged', journalAuthority:'paired_companion'});
  if (args.kind === 'resolve') {
    var snapshot = args.sceneId ? state(read(args.sceneId,runtime)) : null;
    if (typeof args.query !== 'string' || args.query.length > 100) fail('DESCRIPTOR_INVALID_QUERY');
    var all = catalog(snapshot), query = normalize(args.query), matches = all.filter(function(d) {return normalize(d.name).indexOf(query)>=0;});
    var exact = matches.filter(function(d){return normalize(d.name)===query;});
    return Object.assign(result,{readOnly:true, matches:matches.slice(0,30), exact:exact,
      resolution:exact.length===1?'exact':exact.length>1?'ambiguous':matches.length?'similar_only':'no_match',
      hasMore:matches.length>30, scope:'owner builtins plus this scene assignments; browser-only vocabulary unavailable'});
  }
  if (args.kind !== 'preview' && args.kind !== 'apply') fail('DESCRIPTOR_INVALID_KIND');
  var scene = read(args.command && args.command.sceneId,runtime), preview = plan(scene,args.command);
  if (args.kind === 'preview') return Object.assign(result,{readOnly:true,preview:preview});
  if (typeof args.operationId !== 'string' || !/^[0-9a-f-]{36}$/.test(args.operationId) || !args.command.expected || stable(preview) !== stable(args.expectedPlan)) fail('DESCRIPTOR_APPROVED_PLAN_CHANGED');
  if (preview.noOp) return Object.assign(result,{readOnly:true,status:'no_op',state:state(scene)});
  // Only the owner constructs the two-field partial/remove payload. No review,
  // tag, learning, plugin configuration, variant or preference mutation exists.
  doGraphQL('mutation DescriptorTransaction($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}',{input:preview.mutation},runtime,'DescriptorTransactionApply');
  var after = state(read(args.command.sceneId,runtime));
  if (JSON.stringify(after.fields) !== JSON.stringify(preview.afterFields)) fail('DESCRIPTOR_READBACK_FAILED');
  return Object.assign(result,{readOnly:false,status:'verified',operationId:args.operationId,state:after});
}
return {run:run, plan:plan, catalog:catalog, state:state};

})();
// END GENERATED DESCRIPTOR TRANSACTIONS
module.exports=SceneDescriptorTransactions;
