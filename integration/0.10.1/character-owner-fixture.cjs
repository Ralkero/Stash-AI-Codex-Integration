// GENERATED exact owner rules. Test-only GraphQL transport; never imported by service.
function doGraphQL(q,v,r){return r.gql.Do(q,v);}
function normalize(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .replace(/[']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function makeSet(values) {
  const s = {};
  for (const v of values) s[normalize(v)] = true;
  return s;
}
function tagHasParentNamed(tag, parentName) {
  const target = normalize(parentName);
  if (!target) return false;
  for (const parent of (tag && tag.parents) || []) {
    if (normalize(parent && parent.name) === target) return true;
  }
  return false;
}
function isCurrentCharacterTag(tag, config, aliases) {
  if (!tag || tag.ignore_auto_tag) return false;
  if (tagHasParentNamed(tag, config.characterParentTag)) return true;
  const target = normalize(tag.name);
  for (const key of Object.keys((aliases && aliases.characters) || {})) {
    if (normalize(aliases.characters[key]) === target) return true;
  }
  return false;
}
const DEFAULT_CONFIG = {
  dryRun: true,
  createMissingTags: true,
  createMissingGroups: true,
  createMissingStudios: true,
  confidenceThreshold: 0.9,
  characterParentTag: "Characters",
  addNeedsReviewTag: true,
  removeNeedsReviewOnApply: false,
  allowOverwriteExistingMetadata: false,
  discoverScenesWhenNoSceneIds: true,
  sceneDiscoveryLimit: 10000,
  sceneDiscoveryPage: 1,
  sceneDiscoverySort: "id",
  sceneDiscoveryDirection: "DESC",
  sceneDiscoveryQuery: "",
  sceneDiscoveryOnlyUnorganized: true,
  sceneDiscoveryOnlyIncomplete: true,
  sceneDiscoveryIncludeMissingStudioOnly: false,
  sceneDiscoverySkipNeedsReview: true,
  sceneDiscoveryOnlyActionable: true,
  sceneDiscoveryRepairNeedsReview: true,
  sceneDiscoveryPageSize: 250,
  sceneDiscoveryScanPages: 10000,
  allowDiscoveredWrites: false,
  useRuntimeStashAliases: true,
  runtimeAliasPageSize: 250,
  runtimeAliasScanPages: 40,
  runtimeAliasIncludeTopLevelTagAliases: true,
  runtimeAliasIncludeTopLevelCharacterNames: true,
  runtimeAliasIncludeSingleTokenCharacterNames: true,
  autoAliasMode: "suggest",
  minAutoAliasConfidence: 0.9,
  autoAliasMaxLength: 80,
  preferExistingCloseMatches: true,
  closeMatchMinConfidence: 0.92,
  sceneDiscoveryPathIncludes: "",
  sceneDiscoveryPathExcludes: "",
  missReportLimit: 50,
  finalLibraryAuditEnabled: true,
  finalLibraryAuditPageSize: 250,
  finalLibraryAuditMaxPages: 1000,
  allowTitleFallbackCharacterTags: false,
  strictCharacterTagNames: true,
  imageTaggingPathIncludes: "Rule34 Pictures",
  imageTaggingPathExcludes: "_Unsorted_Franchise|_Delete_Review|Futa|mp4|zip",
  imageTaggingLimit: 10000,
  imageTaggingPageSize: 250,
  imageTaggingScanPages: 10000,
  imageTaggingCreateMissingTags: true
};
const EMBEDDED_ALIASES = {
  studios: {
    "overwatch": "Overwatch",
    "ow": "Overwatch",
    "rule34": "Rule34",
    "final fantasy": "Final Fantasy",
    "ff": "Final Fantasy",
    "resident evil": "Resident Evil",
    "re": "Resident Evil",
    "devil may cry": "Devil May Cry",
    "dmc": "Devil May Cry",
    "street fighter": "Street Fighter",
    "sf army": "Street Fighter",
    "king of fighters": "King of Fighters",
    "kof": "King of Fighters",
    "soul calibur": "Soul Calibur",
    "paragon": "Paragon",
    "pixar": "Pixar",
    "dead or alive": "Dead or Alive",
    "doa": "Dead or Alive",
    "tekken": "Tekken",
    "metroid": "Metroid",
    "nioh": "Nioh",
    "stellar blade": "Stellar Blade",
    "baldur's gate 3": "Baldur's Gate 3",
    "baldurs gate 3": "Baldur's Gate 3",
    "bg3": "Baldur's Gate 3",
    "nier automata": "Nier: Automata",
    "nier": "Nier: Automata",
    "uncharted": "Uncharted",
    "league of legends": "League of Legends",
    "lol": "League of Legends",
    "atomic heart": "Atomic Heart",
    "genshin": "Genshin Impact",
    "genshin impact": "Genshin Impact",
    "the ring": "The Ring",
    "ringu": "The Ring",
    "expedition 33": "Expedition 33",
    "clair obscur": "Expedition 33",
    "clair obscur expedition 33": "Expedition 33",
    "cyberpunk": "Cyberpunk 2077",
    "cyberpunk 2077": "Cyberpunk 2077",
    "monster hunter": "Monster Hunter",
    "elden ring": "Elden Ring",
    "legend of zelda": "Legend of Zelda",
    "zelda": "Legend of Zelda",
    "tomb raider": "Tomb Raider",
    "teen titans": "Teen Titans",
    "ben 10": "Ben 10",
    "ben10": "Ben 10",
    "life is strange": "Life Is Strange",
    "dc": "DC Comics",
    "dc comics": "DC Comics",
    "marvel": "Marvel",
    "the witcher": "The Witcher",
    "witcher": "The Witcher",
    "detroit become human": "Detroit: Become Human",
    "dbh": "Detroit: Become Human",
    "rainbow six siege": "Rainbow Six Siege",
    "r6": "Rainbow Six Siege"
  },
  groups: {
    "bewyx": "Bewyx",
    "bewyx_": "Bewyx",
    "artistname": "Artist Name",
    "idemi": "Idemi",
    "hydrafxx": "HydraFXX",
    "hydra fxx": "HydraFXX",
    "bulgingsenpai": "BulgingSenpai",
    "bulging senpai": "BulgingSenpai",
    "bouquetman": "Bouquetman",
    "nodu": "NoduSFM",
    "nodusfm": "NoduSFM",
    "nodu sfm": "NoduSFM",
    "lvl3toaster": "Lvl3Toaster",
    "lvl3 toaster": "Lvl3Toaster",
    "secazz": "Secazz",
    "pantsushi": "Pantsushi",
    "erovirus": "EroVirus",
    "waifuenjoyer": "WaifuEnjoyer",
    "entduke": "Entduke",
    "aphy3d": "Aphy3D",
    "nagoonimation": "Nagoonimation",
    "milkychu": "Milkychu",
    "darkdreamsvr": "DarkDreamsVR",
    "leeterr": "Leeterr",
    "creamtau": "CreamTau",
    "gretdb": "GretDB",
    "conseitnsfw": "ConseiTNSFW",
    "saveass": "SaveAss",
    "rein": "Rein",
    "mept44": "Mept44",
    "thecount": "TheCount",
    "ffpanda": "FFPanda",
    "splucky": "Splucky",
    "redmoa": "Redmoa",
    "timpossible": "Timpossible",
    "jewelz blu": "Jewelz Blu",
    "nsfwmegaera": "NSFWmegaera",
    "niki3d": "Niki3D",
    "xholy3dx": "xHoly3Dx",
    "ryanreos": "RyanReos",
    "cerbskies": "CerbSkies",
    "lazyprocrastinator": "LazyProcrastinator",
    "rouse3d": "Rouse3D",
    "evilbaka": "Evilbaka",
    "iamfgn": "iamfgn",
    "polishedjadebell": "PolishedJadeBell",
    "axenanim": "AxenAnim",
    "axen anim": "AxenAnim"
  },
  characters: {
    "mei": "Mei",
    "tracer": "Tracer",
    "widowmaker": "Widowmaker",
    "widow": "Widowmaker",
    "d.va": "D.Va",
    "dva": "D.Va",
    "dv.a": "D.Va",
    "juno": "Juno",
    "ashley graham": "Ashley Graham",
    "ashley": "Ashley Graham",
    "leon": "Leon Kennedy",
    "leon kennedy": "Leon Kennedy",
    "bela": "Bela Dimitrescu",
    "bela dimitrescu": "Bela Dimitrescu",
    "cassandra": "Cassandra Dimitrescu",
    "cassandra dimitrescu": "Cassandra Dimitrescu",
    "ethan": "Ethan Winters",
    "ethan winters": "Ethan Winters",
    "eve": "Eve",
    "shadowheart": "Shadowheart",
    "sophitia": "Sophitia",
    "countess": "Countess",
    "countess paragon": "Countess",
    "starfire": "Starfire",
    "raven": "Raven",
    "shani": "Shani",
    "juri": "Juri Han",
    "juri han": "Juri Han",
    "cammy": "Cammy White",
    "cammy white": "Cammy White",
    "chun li": "Chun-Li",
    "chun-li": "Chun-Li",
    "chunli": "Chun-Li",
    "taki": "Taki",
    "ayane": "Ayane",
    "honoka": "Honoka",
    "nyotengu": "Nyotengu",
    "nyo": "Nyotengu",
    "marie rose": "Marie Rose",
    "marie": "Marie Rose",
    "sayuri": "Sayuri",
    "lobelia": "Lobelia",
    "tsukushi": "Tsukushi",
    "ivy": "Ivy Valentine",
    "ivy valentine": "Ivy Valentine",
    "hilde": "Hilde",
    "setsuka": "Setsuka",
    "tira": "Tira",
    "angel halloween": "Angel",
    "asuka": "Asuka Kazama",
    "aunt cass": "Aunt Cass",
    "cass instant loss": "Cassandra Alexandra",
    "cass mating press": "Cassandra Alexandra",
    "devil kazumi": "Devil Kazumi",
    "kazumi": "Kazumi Mishima",
    "eliza": "Eliza",
    "josie": "Josie Rizal",
    "julia": "Julia Chang",
    "kunimitsu": "Kunimitsu",
    "lili": "Lili",
    "karin": "Karin",
    "menat": "Menat",
    "sakura": "Sakura",
    "kula": "Kula Diamond",
    "leona": "Leona Heidern",
    "mai": "Mai Shiranui",
    "shermie": "Shermie",
    "maria": "Maria",
    "okatsu": "Okatsu",
    "2p": "2P",
    "samus": "Samus",
    "melina": "Melina",
    "marika": "Marika",
    "tifa": "Tifa Lockhart",
    "tifa lockhart": "Tifa Lockhart",
    "brig": "Brigitte Lindholm",
    "brigitte": "Brigitte Lindholm",
    "brigitte lindholm": "Brigitte Lindholm",
    "fia": "Fia",
    "fia baldachin": "Fia",
    "yshtola": "Y'shtola Rhul",
    "yshtola rhul": "Y'shtola Rhul",
    "panam": "Panam Palmer",
    "panam palmer": "Panam Palmer",
    "ballerina": "Ballerina",
    "the twins": "The Twins",
    "twins": "The Twins",
    "jinx": "Jinx",
    "mona": "Mona",
    "sadako": "Sadako",
    "witch": "Witch",
    "lune": "Lune",
    "2b": "2B",
    "2booty": "2B",
    "2 booty": "2B",
    "2bb": "2B",
    "2bs": "2B",
    "a2": "A2",
    "9s": "9S",
    "kaine": "Kaine",
    "aerith": "Aerith Gainsborough",
    "aerith gainsborough": "Aerith Gainsborough",
    "yuffie": "Yuffie Kisaragi",
    "yuffie kisaragi": "Yuffie Kisaragi",
    "cloud": "Cloud Strife",
    "cloud strife": "Cloud Strife",
    "lady": "Lady",
    "jessie": "Jessie Rasberry",
    "jessie rasberry": "Jessie Rasberry",
    "lightning": "Lightning",
    "rebecca": "Rebecca Chambers",
    "rebecca chambers": "Rebecca Chambers",
    "sheva": "Sheva Alomar",
    "sheva alomar": "Sheva Alomar",
    "elena fisher": "Elena Fisher",
    "rachel amber": "Rachel Amber",
    "harley": "Harley Quinn",
    "harley quinn": "Harley Quinn",
    "gwen": "Gwen Stacy",
    "gwen stacy": "Gwen Stacy",
    "gwen tennyson": "Gwen Tennyson",
    "jill": "Jill Valentine",
    "jill valentine": "Jill Valentine",
    "ingrid hunnigan": "Ingrid Hunnigan",
    "hunnigan": "Ingrid Hunnigan",
    "yennefer": "Yennefer",
    "mizora": "Mizora",
    "wyll": "Wyll",
    "kara": "Kara",
    "clive": "Clive Rosfield",
    "clive rosfield": "Clive Rosfield",
    "claire": "Claire Redfield",
    "claire redfield": "Claire Redfield",
    "ada": "Ada Wong",
    "ada wong": "Ada Wong",
    "mercy": "Mercy",
    "pharah": "Pharah",
    "lara": "Lara Croft",
    "lara croft": "Lara Croft",
    "drake": "Nathan Drake",
    "nathan drake": "Nathan Drake",
    "loba": "Loba",
    "nico": "Nico",
    "nero": "Nero",
    "ahsoka": "Ahsoka Tano",
    "ahsoka tano": "Ahsoka Tano",
    "ela": "Ela",
    "dokkaebi": "Dokkaebi",
    "bloodrayne": "Bloodrayne"
  },
  characterStudios: {
    "mei": "Overwatch",
    "tracer": "Overwatch",
    "widowmaker": "Overwatch",
    "widow": "Overwatch",
    "d.va": "Overwatch",
    "dva": "Overwatch",
    "juno": "Overwatch",
    "mercy": "Overwatch",
    "pharah": "Overwatch",
    "ashley graham": "Resident Evil",
    "ashley": "Resident Evil",
    "leon": "Resident Evil",
    "leon kennedy": "Resident Evil",
    "claire": "Resident Evil",
    "claire redfield": "Resident Evil",
    "ada": "Resident Evil",
    "ada wong": "Resident Evil",
    "bela": "Resident Evil",
    "bela dimitrescu": "Resident Evil",
    "cassandra": "Resident Evil",
    "cassandra dimitrescu": "Resident Evil",
    "ethan": "Resident Evil",
    "ethan winters": "Resident Evil",
    "rachel amber": "Life Is Strange",
    "harley quinn": "DC Comics",
    "gwen stacy": "Marvel",
    "gwen tennyson": "Ben 10",
    "jill": "Resident Evil",
    "jill valentine": "Resident Evil",
    "ingrid hunnigan": "Resident Evil",
    "hunnigan": "Resident Evil",
    "yennefer": "The Witcher",
    "mizora": "Baldur's Gate 3",
    "wyll": "Baldur's Gate 3",
    "kara": "Detroit: Become Human",
    "clive": "Final Fantasy",
    "clive rosfield": "Final Fantasy",
    "tifa": "Final Fantasy",
    "tifa lockhart": "Final Fantasy",
    "aerith": "Final Fantasy",
    "aerith gainsborough": "Final Fantasy",
    "yuffie": "Final Fantasy",
    "yuffie kisaragi": "Final Fantasy",
    "cloud": "Final Fantasy",
    "lady": "Devil May Cry",
    "jessie": "Final Fantasy",
    "jessie rasberry": "Final Fantasy",
    "lightning": "Final Fantasy",
    "rebecca": "Resident Evil",
    "rebecca chambers": "Resident Evil",
    "sheva": "Resident Evil",
    "sheva alomar": "Resident Evil",
    "elena fisher": "Uncharted",
    "2b": "Nier: Automata",
    "a2": "Nier: Automata",
    "9s": "Nier: Automata",
    "lara": "Tomb Raider",
    "lara croft": "Tomb Raider",
    "loba": "Apex Legends",
    "nico": "Devil May Cry",
    "nero": "Devil May Cry",
    "ahsoka": "Star Wars",
    "ela": "Rainbow Six Siege",
    "dokkaebi": "Rainbow Six Siege",
    "eve": "Stellar Blade",
    "shadowheart": "Baldur's Gate 3",
    "sophitia": "Soul Calibur",
    "countess": "Paragon",
    "starfire": "Teen Titans",
    "raven": "Teen Titans",
    "shani": "The Witcher",
    "taki": "Soul Calibur",
    "juri": "Street Fighter",
    "cammy": "Street Fighter",
    "cammy white": "Street Fighter",
    "chun li": "Street Fighter",
    "chunli": "Street Fighter",
    "ayane": "Dead or Alive",
    "honoka": "Dead or Alive",
    "nyotengu": "Dead or Alive",
    "nyo": "Dead or Alive",
    "marie rose": "Dead or Alive",
    "marie": "Dead or Alive",
    "sayuri": "Dead or Alive",
    "lobelia": "Dead or Alive",
    "tsukushi": "Dead or Alive",
    "ivy": "Soul Calibur",
    "ivy valentine": "Soul Calibur",
    "hilde": "Soul Calibur",
    "setsuka": "Soul Calibur",
    "tira": "Soul Calibur",
    "angel": "King of Fighters",
    "asuka": "Tekken",
    "asuka kazama": "Tekken",
    "aunt cass": "Pixar",
    "cass instant loss": "Soul Calibur",
    "cass mating press": "Soul Calibur",
    "cassandra alexandra": "Soul Calibur",
    "devil kazumi": "Tekken",
    "kazumi": "Tekken",
    "kazumi mishima": "Tekken",
    "eliza": "Tekken",
    "josie": "Tekken",
    "josie rizal": "Tekken",
    "julia": "Tekken",
    "julia chang": "Tekken",
    "kunimitsu": "Tekken",
    "lili": "Tekken",
    "karin": "Street Fighter",
    "menat": "Street Fighter",
    "sakura": "Street Fighter",
    "kula": "King of Fighters",
    "kula diamond": "King of Fighters",
    "leona": "King of Fighters",
    "leona heidern": "King of Fighters",
    "mai": "King of Fighters",
    "mai shiranui": "King of Fighters",
    "shermie": "King of Fighters",
    "maria": "Nioh",
    "okatsu": "Nioh",
    "2p": "Nier: Automata",
    "samus": "Metroid",
    "melina": "Elden Ring",
    "marika": "Elden Ring",
    "fia": "Elden Ring",
    "fia baldachin": "Elden Ring",
    "yshtola": "Final Fantasy",
    "yshtola rhul": "Final Fantasy",
    "brig": "Overwatch",
    "brigitte": "Overwatch",
    "brigitte lindholm": "Overwatch",
    "panam": "Cyberpunk 2077",
    "ballerina": "Atomic Heart",
    "the twins": "Atomic Heart",
    "twins": "Atomic Heart",
    "mona": "Genshin Impact",
    "sadako": "The Ring",
    "witch": "Resident Evil",
    "lune": "Expedition 33",
    "jinx": "League of Legends",
    "bloodrayne": "BloodRayne"
  }
};
const NON_CHARACTER_TAG_NAMES = makeSet([
  "needs review", "character", "characters", "animated", "animation", "animations",
  "loop", "nude", "kda",
  "4k", "1080p", "720p", "vr", "video", "scene", "scenes", "unknown",
  "male", "female",
  "dimitrescu daughters", "twin moon knight", "yorha", "yorha android",
  "yorha type a no"
]);
// BEGIN GENERATED CHARACTER IDENTITY
var SceneCharacterIdentity = (function(){
// Read-only, explicit subset of the owner's existing Character rules.
// Intentionally does NOT call runtime alias inference, learning or configuration
// loaders. Rootless/unregistered tags and indirect ancestry remain unknown.
function validId(v) { return typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v); }
function classify(tag) {
  if (!tag || !validId(tag.id) || typeof tag.name !== "string" ||
      typeof tag.ignore_auto_tag !== "boolean" || !Array.isArray(tag.parents) ||
      tag.parents.some(function(p) { return !p || !validId(p.id) || typeof p.name !== "string"; }))
    return "unknown";
  // Opting out of inference does not assert that this is a non-Character.
  if (tag.ignore_auto_tag) return "unknown";
  var excluded = !!NON_CHARACTER_TAG_NAMES[normalize(tag.name)] ||
    normalize(tag.name) === normalize(DEFAULT_CONFIG.characterParentTag);
  var positive = isCurrentCharacterTag(tag, DEFAULT_CONFIG, EMBEDDED_ALIASES);
  var explicitParent = tagHasParentNamed(tag, DEFAULT_CONFIG.characterParentTag);
  var otherParent = tag.parents.some(function(p) {
    return normalize(p.name) !== normalize(DEFAULT_CONFIG.characterParentTag);
  });
  // Conflicting parent categories or positive/exclusion rules cannot prove absence.
  if (otherParent || (positive && excluded)) return "unknown";
  if (positive) return explicitParent ? "character-parent" : "registered-character";
  return excluded ? "owner-excluded" : "unknown";
}
function summary(scene, requestedId) {
  if (!scene) return { sceneId: requestedId, status: "not_found" };
  if (String(scene.id) !== requestedId || typeof scene.updated_at !== "string" ||
      !Number.isFinite(Date.parse(scene.updated_at)) || !Array.isArray(scene.tags))
    return { sceneId: requestedId, status: "unavailable", reason: "invalid_scene" };
  var result = { sceneId: requestedId, status: "available", updatedAt: scene.updated_at,
    presence: "unknown", completeness: "partial", characterTagIds: [],
    characterCount: 0, nonCharacterCount: 0, unclassifiedCount: 0,
    assignedTagCount: scene.tags.length, evidence: { parent: 0, registered: 0 },
    truncated: scene.tags.length > 100,
    unclassifiedTags: [], unclassifiedDetailsTruncated: false };
  // A bounded response never silently drops unknown assignments.
  if (result.truncated) {
    result.unclassifiedCount = scene.tags.length;
    result.unclassifiedDetailsTruncated = true;
    return result;
  }
  var seen = {};
  if (scene.tags.some(function(t) {
    if (!t || !validId(t.id) || seen[t.id]) return true;
    seen[t.id] = true; return false;
  })) {
    result.unclassifiedCount = scene.tags.length;
    result.unclassifiedDetailsTruncated = true;
    return result;
  }
  scene.tags.forEach(function(tag) {
    var kind = classify(tag);
    if (kind === "character-parent" || kind === "registered-character") {
      result.characterTagIds.push(tag.id);
      result.evidence[kind === "character-parent" ? "parent" : "registered"]++;
    } else if (kind === "owner-excluded") result.nonCharacterCount++;
    else {
      result.unclassifiedCount++;
      if (result.unclassifiedTags.length < 4) result.unclassifiedTags.push({
        id: tag.id, name: typeof tag.name === "string" ? tag.name.slice(0,120) : "",
        nameTruncated: typeof tag.name === "string" && tag.name.length > 120,
        reason: explainUnknown(tag)
      });
    }
  });
  result.characterCount = result.characterTagIds.length;
  result.presence = result.characterCount ? "present" : result.unclassifiedCount ? "unknown" : "absent";
  result.completeness = result.unclassifiedCount ? "partial" : "complete";
  result.unclassifiedDetailsTruncated = result.unclassifiedTags.length < result.unclassifiedCount;
  return result;
}
// Explains only the unchanged classifier's unknown branches. Never reclassifies
// tags or treats a conflicting rule/hierarchy as proof of incorrect metadata.
function explainUnknown(tag) {
  if (typeof tag.name !== "string" || typeof tag.ignore_auto_tag !== "boolean" ||
      !Array.isArray(tag.parents) || tag.parents.some(function(p) {
        return !p || !validId(p.id) || typeof p.name !== "string";
      })) return "invalid-reference";
  if (tag.ignore_auto_tag) return "ignored";
  var explicitParent = tagHasParentNamed(tag, DEFAULT_CONFIG.characterParentTag);
  var otherParent = tag.parents.some(function(p) {
    return normalize(p.name) !== normalize(DEFAULT_CONFIG.characterParentTag);
  });
  if (otherParent) return explicitParent ? "conflicting-parents" : "other-parent";
  var excluded = !!NON_CHARACTER_TAG_NAMES[normalize(tag.name)] ||
    normalize(tag.name) === normalize(DEFAULT_CONFIG.characterParentTag);
  if (isCurrentCharacterTag(tag, DEFAULT_CONFIG, EMBEDDED_ALIASES) && excluded)
    return "conflicting-rules";
  return "unregistered";
}
function run(args, runtime) {
  if (!args || typeof args !== "object" || Array.isArray(args) ||
      Object.keys(args).some(function(k) { return ["mode","kind","sceneIds"].indexOf(k) < 0; }))
    throw Error("CHARACTER_IDENTITY_INVALID_ARGUMENT");
  var result = { apiVersion: 1, owner: "scene-auto-tagger", ownerVersion: "0.9.22",
    readOnly: true, observedAt: new Date().toISOString(),
    authority: "explicit-character-rules-v1", taxonomyComplete: false,
    definition: "Existing direct Character parent / builtin canonical Character registry; explicit owner exclusions. Other, ignored, conflicting and indirect tags remain unknown.",
    maxScenes: 20, maxTagsPerScene: 100, detailSchema: 1, maxUnclassifiedDetails: 4 };
  if (args.kind === "capabilities") {
    if (args.sceneIds !== undefined) throw Error("CHARACTER_IDENTITY_INVALID_ARGUMENT");
    return result;
  }
  if (args.kind !== "scenes" || !Array.isArray(args.sceneIds) || !args.sceneIds.length ||
      args.sceneIds.length > 20 || !args.sceneIds.every(validId))
    throw Error("CHARACTER_IDENTITY_INVALID_IDS");
  var ids = args.sceneIds.filter(function(id, i, list) { return list.indexOf(id) === i; });
  var variables = {}, definitions = [], queries = [];
  ids.forEach(function(id, i) {
    variables["id" + i] = id; definitions.push("$id" + i + ":ID!");
    queries.push("s" + i + ":findScene(id:$id" + i + "){id updated_at tags{id name ignore_auto_tag parents{id name}}}");
  });
  var data = doGraphQL("query(" + definitions.join(",") + "){" + queries.join(" ") + "}", variables, runtime, "CharacterIdentityRead");
  result.scenes = ids.map(function(id, i) {
    return Object.prototype.hasOwnProperty.call(data, "s" + i)
      ? summary(data["s" + i], id)
      : { sceneId: id, status: "unavailable", reason: "missing_response" };
  });
  return result;
}
return { run: run, classify: classify, summary: summary };

})();
module.exports=SceneCharacterIdentity;
