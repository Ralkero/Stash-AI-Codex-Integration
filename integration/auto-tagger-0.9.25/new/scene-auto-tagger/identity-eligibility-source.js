// Owner-controlled policy v1. No network, model output, learned rules or taxonomy
// parent can confer eligibility. Seed evidence: explicit user policy examples.
// Registry changes require source review; no runtime registry mutation API exists.
function normalizeIdentity(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    // Avoid Unicode property escapes: Stash's embedded engine accepts them but
    // does not implement the same matching semantics as Node. Preserve Unicode
    // letters conservatively; unsupported spellings therefore fail closed.
    .replace(/[\s_\-\u2010-\u2015\u2018-\u201f]+/g, ' ').replace(/[^a-z0-9\u0080-\uffff ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const records = [
  ['Mercy','female'], ['Widowmaker','female'], ['Tifa Lockhart','female'],
  ['Aerith Gainsborough','female'], ['Kiriko','female'], ['Wonder Woman','female'],
  ['Supergirl','female'], ['Batgirl','female'], ['Chainsaw Man','male'],
  ['Spider-Man','male'], ['Iron Man','male'], ['Batman','male'],
  ['Superman','male'], ['Hellboy','male'], ['Reinhardt','male'], ['Baymax','genderless']
].map(function(r) { return { canonical: r[0], aliases: [], category: 'character',
  gender: r[1], evidence: 'reviewed-policy-examples-v1' }; }).concat(
  ['Overwatch','Soul Calibur','Stellar Blade','Resident Evil','Street Fighter',
   'League of Legends','Elden Ring','Dead or Alive'].map(function(name) {
    return { canonical:name, aliases:[], category:'franchise', evidence:'reviewed-policy-examples-v1' };
  })
);
function genderSignal(name) {
  const n = normalizeIdentity(name), tokens = n.split(' ');
  const male = tokens.some(t => ['man','boy','sir','mister'].includes(t)) ||
    ['batman','superman','hellboy'].includes(n);
  const female = tokens.some(t => ['woman','girl','lady'].includes(t)) ||
    ['supergirl','batgirl'].includes(n);
  return male && female ? 'conflict' : male ? 'male' : female ? 'female' : null;
}
function result(status, reason, record) {
  const message = status === 'eligible' ? 'Verified female identity. Assignment also requires evidence in this scene.' :
    reason === 'unresolved-scene-association' ? 'This identity was not verified in the scene title or filename.' :
    reason === 'unresolved-conflicting-evidence' ? 'Identity information and established name signals conflict. Review is needed.' :
    reason === 'unresolved-alias-collision' ? 'This name resolves to more than one identity or Tag. Review is needed.' :
    reason === 'unresolved-gender' ? 'Female identity has not been verified.' :
    status === 'ineligible' && record && record.category === 'franchise' ? 'This is a Franchise, not an individual Character.' :
    status === 'ineligible' ? 'This identity does not meet the female-only identity policy.' :
    'Identity eligibility could not be verified. No automatic assignment is permitted; this is not proof of incorrect metadata.';
  return {status, reason, policyVersion:1, canonical:record ? record.canonical : null,
    category:record ? record.category : null, gender:record ? record.gender || null : null,
    evidence:record ? record.evidence : null, message};
}
function resolve(tag, registry) {
  if (!tag || typeof tag.name !== 'string') return [];
  return (registry || records).filter(r =>
    [r.canonical].concat(r.aliases || []).some(n => normalizeIdentity(n) === normalizeIdentity(tag.name)) &&
    (!r.tagId || String(r.tagId) === String(tag.id)));
}
function classify(tag, registry) {
  const matches = resolve(tag, registry);
  if (!matches.length) return result('unresolved','unresolved-identity');
  if (matches.length !== 1) return result('unresolved','unresolved-alias-collision');
  const r = matches[0];
  if (r.canonical === 'Chainsaw Man' && (tag.parents || []).some(p =>
      normalizeIdentity(p.name) === 'franchises'))
    return result('ineligible','ineligible-franchise',{...r,category:'franchise',gender:null});
  if (!r.evidence) return result('unresolved','unresolved-identity',r);
  if (!['character','adult-performer'].includes(r.category))
    return result('ineligible','ineligible-' + r.category,r);
  if (r.category === 'adult-performer' && r.adultVerified !== true)
    return result('unresolved','unresolved-adult-performer',r);
  const signals = [r.canonical].concat(r.aliases || []).map(genderSignal).filter(Boolean);
  if (signals.includes('conflict') || (signals.includes('male') && signals.includes('female')) ||
      (r.gender === 'female' && signals.includes('male')) ||
      (r.gender === 'male' && signals.includes('female')))
    return result('unresolved','unresolved-conflicting-evidence',r);
  const gender = r.gender || (signals.includes('male') ? 'male' : null);
  if (!gender || gender === 'unknown') return result('unresolved','unresolved-gender',r);
  if (gender !== 'female') return result('ineligible','ineligible-' + gender + '-' + r.category,r);
  if (tag.ignore_auto_tag) return result('unresolved','unresolved-ignored',r);
  if ((tag.parents || []).some(p => normalizeIdentity(p.name) !== 'characters'))
    return result('unresolved','unresolved-conflicting-taxonomy',r);
  return result('eligible','eligible-known-female-' + r.category,r);
}
// Folders, details, Studio and Author never establish scene presence. An exact
// bounded identity phrase in title/basename is required in addition to eligibility.
function associated(scene, record) {
  if (!scene || !record) return false;
  const texts = [scene.title || ''].concat((scene.files || []).map(f =>
    f.basename || String(f.path || '').split(/[\\/]/).pop() || ''));
  return [record.canonical].concat(record.aliases || []).some(alias => {
    const n = normalizeIdentity(alias);
    return n.length >= 3 && texts.some(t => (' ' + normalizeIdentity(t) + ' ').includes(' ' + n + ' '));
  });
}
function authorize(tag, scene, registry) {
  const decision = classify(tag, registry);
  if (decision.status !== 'eligible') return decision;
  return associated(scene, resolve(tag,registry)[0]) ? decision :
    result('unresolved','unresolved-scene-association',resolve(tag,registry)[0]);
}
return { records, normalizeIdentity, genderSignal, resolve, classify, associated, authorize };
