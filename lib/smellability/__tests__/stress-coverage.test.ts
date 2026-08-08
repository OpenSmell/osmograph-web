import { describe, expect, it } from "vitest"
import { searchSubstances } from "../search"
import { resolveAndRun } from "../chain"

// Stress coverage probe. This is the honest record of local search coverage:
// queries that genuinely have no local anchor are documented as gaps (they
// fall through to the live PubChem path). Any change to these gap lists must
// be deliberate.

const EVERYDAY = [
  "fresh cut grass", "skunk", "lavender", "eucalyptus", "citronella", "vanilla",
  "rose", "onion", "mothballs", "clove", "spearmint", "thyme", "rosemary",
  "black tea", "chocolate", "cocoa", "coconut", "peach", "violet", "mint",
  "coffee", "garlic", "vinegar", "rotten egg", "gasoline", "hand sanitizer",
  "nail polish remover", "propane", "natural gas", "ethanol", "acetone",
  "banana", "cinnamon", "spoiled milk", "car exhaust", "fish market",
  "marijuana", "weed", "sweaty socks", "gym bag", "burnt toast", "fresh bread",
  "popcorn", "strawberry", "lemon", "orange", "pineapple", "watermelon",
  "caramel", "honey", "maple syrup", "soy sauce", "peanut butter", "cheddar cheese",
  "blue cheese", "cigarette smoke", "cigarette", "cigar", "tobacco", "vape",
  "air freshener", "bleach", "ammonia cleaner", "dish soap", "laundry detergent",
  "fabric softener", "wet dog", "wet paint", "paint thinner", "turpentine",
  "kerosene", "diesel", "jet fuel", "butane lighter", "matches", "charcoal",
  "barbecue", "smoked fish", "kombucha", "beer", "wine", "whiskey", "rum",
  "vodka", "tequila", "gin", "sake", "soy milk", "coconut milk", "olive oil",
  "sesame oil", "fish sauce", "worcestershire", "mustard", "ketchup", "pickles",
  "sauerkraut", "kimchi", "durian", "jackfruit", "truffle", "mushroom", "yeast",
  "sourdough", "garlic powder", "onion powder", "curry", "turmeric", "ginger",
  "cardamom", "nutmeg", "cinnamon", "allspice", "anise", "fennel", "dill",
  "basil", "oregano", "sage", "chives", "parsley", "cilantro", "coriander",
  "marijuana smoke", "cannabis", "hemp", "hops", "matcha", "oolong", "yerba mate",
  "leather", "new car", "new shoe", "rubber", "latex", "vinyl", "silicone",
  "adhesive tape", "glue", "superglue", "model glue", "marker", "permanent marker",
  "dry erase", "whiteboard", "pencil shavings", "eraser", "crayon", "playdough",
  "mildew", "musty basement", "damp towel", "stagnant water", "swamp", "pond",
  "dead fish", "rotten meat", "rancid butter", "sour milk", "expired milk",
  "barnyard", "cow", "horse", "sheep", "chicken coop", "cat urine", "dog breath",
  "skunk spray", "armpit", "body odor", "bad breath", "flatulence",
  "burning rubber", "burning plastic", "electrical fire", "burnt hair",
  "smoke", "campfire", "wood fire", "incense", "frankincense", "myrrh", "sandalwood",
  "patchouli", "musk", "amber", "jasmine", "lily", "tulip", "hyacinth", "gardenia",
  "magnolia", "lilac", "wisteria", "peony", "carnation", "sweet pea", "honeysuckle",
  "daffodil", "narcissus", "iris", "freesia", "chamomile", "marigold",
  "marijuana", "skunk", "fresh grass", "fresh laundry", "rain on pavement",
  "ozone after storm", "sea air", "ocean breeze", "salty air", "cotton candy",
  "bubble gum", "chewing gum", "candy apple", "maple bacon", "french toast",
  "pancakes", "waffles", "syrup", "molasses", "brown sugar", "toffee", "butterscotch",
  "cream soda", "root beer", "cola", "ginger ale", "lemonade", "iced tea",
  "fruit punch", "orange juice", "grapefruit", "lime", "pomegranate", "cherry",
  "plum", "apricot", "nectarine", "fig", "date", "raisin", "prune", "apple",
  "pear", "guava", "papaya", "mango", "kiwi", "passion fruit", "lychee",
  "dragon fruit", "avocado", "cucumber", "celery", "lettuce", "spinach",
  "kale", "broccoli", "cauliflower", "cabbage", "brussels sprouts", "asparagus",
  "green pepper", "bell pepper", "chili pepper", "jalapeño", "habanero", "wasabi",
  "horseradish", "ginger", "galangal", "lemongrass", "kaffir lime", "shiso",
  "basil", "tarragon", "chervil", "marjoram", "sumac", "za'atar", "harissa",
  "miso", "tamari", "hoisin", "oyster sauce", "sesame paste", "tahini",
  "hummus", "falafel", "shawarma", "curry powder", "garam masala", "five spice",
  "wasabi", "teriyaki", "sriracha", "tabasco", "chili oil", "garlic chili",
  "pepper spray", "tear gas", "smoke bomb", "fireworks", "gunpowder", "cordite",
  "chlorine pool", "public pool", "swimming pool", "hot tub", "sauna",
  "essential oil", "tea tree oil", "lemongrass oil", "peppermint oil",
  "eucalyptus oil", "sandalwood", "frankincense", "myrrh",
]

// Documented everyday gaps: no local anchor exists and the term is a
// multi-word product/brand-like phrase PubChem cannot resolve either.
// silicone: no siloxane anchor exists in the corpus.
const EVERYDAY_DOCUMENTED_GAPS = ["silicone"]

const CHEMICALS = [
  "acetaldehyde", "acetic acid", "acetone", "acetophenone", "acetylene",
  "acrolein", "acrylic acid", "adipic acid", "alanine", "allyl alcohol",
  "allyl mercaptan", "alpha-pinene", "ammonia", "amyl acetate", "aniline",
  "anisole", "anthracene", "arginine", "argon", "aspirin", "atrazine",
  "benzaldehyde", "benzene", "benzoic acid", "benzyl acetate", "benzyl alcohol",
  "beta-carotene", "beta-myrcene", "bisphenol A", "bromine", "butadiene",
  "butane", "butanethiol", "butanol", "butyl acetate", "butyric acid",
  "caffeine", "camphene", "camphor", "capsaicin", "carbon dioxide",
  "carbon disulfide", "carbon monoxide", "carbon tetrachloride", "carvacrol",
  "carvone", "chlorine", "chloroform", "chlorophyll", "cholesterol",
  "cinnamaldehyde", "cinnamic acid", "citral", "citric acid", "citronellal",
  "citronellol", "coumarin", "cresol", "cumene", "cyclohexane",
  "cyclohexanol", "cyclohexanone", "cyclopentane", "cysteine", "decane",
  "decanal", "decanoic acid", "diallyl disulfide", "dichloromethane",
  "diethyl ether", "diethylamine", "digoxin", "dihydrogen sulfide",
  "diisopropyl ether", "dimethyl sulfide", "dimethylamine", "dipropyl disulfide",
  "dodecane", "ethanol", "ethanethiol", "ethyl acetate", "ethyl alcohol",
  "ethyl benzoate", "ethyl butyrate", "ethyl hexanoate", "ethyl lactate",
  "ethyl mercaptan", "ethyl vanillin", "ethylene", "ethylene glycol",
  "eucalyptol", "eugenol", "formaldehyde", "formic acid", "fructose",
  "furfural", "furfuryl alcohol", "galactose", "geraniol", "glucose",
  "glutamic acid", "glycerin", "glycerol", "glycine", "glyoxal", "heptane",
  "hexadecane", "hexanal", "hexane", "hexanoic acid", "hexene",
  "histamine", "hydrazine", "hydrogen", "hydrogen chloride", "hydrogen cyanide",
  "hydrogen peroxide", "hydrogen sulfide", "hydroxyproline", "indole",
  "iodine", "isobutane", "isobutanol", "isoprene", "isopropanol",
  "isopropyl alcohol", "isovaleraldehyde", "isovaleric acid", "lactic acid",
  "lanolin", "lauric acid", "lavandulol", "leucine", "limonene", "linalool",
  "linoleic acid", "lithium", "lysine", "malic acid", "maltose", "menthol",
  "menthone", "mercaptan", "mesitylene", "methane", "methanethiol", "methanol",
  "methyl acetate", "methyl anthranilate", "methyl ethyl ketone", "methyl mercaptan",
  "methyl salicylate", "methylamine", "methylcyclohexane", "methylene chloride",
  "myrcene", "naphthalene", "naphthol", "nerol", "nerolidol", "niacin",
  "nicotine", "nitric oxide", "nitrobenzene", "nitrogen", "nitrogen dioxide",
  "nitroglycerin", "nitromethane", "nitrous oxide", "nonane", "nonanal",
  "octane", "octanal", "octanoic acid", "oleic acid", "oleic acid",
  "oxalic acid", "oxygen", "ozone", "palmitic acid", "panthenol",
  "para-dichlorobenzene", "pentane", "pentanal", "pentanol", "phenol",
  "phenylethyl alcohol", "phenylalanine", "phosgene", "phosphine",
  "phosphoric acid", "phthalates", "piperidine", "piperine", "proline",
  "propane", "propanal", "propanethiol", "propanol", "propionic acid",
  "propylene", "propylene glycol", "pyridine", "pyrogallol", "pyruvic acid",
  "quinine", "retinol", "riboflavin", "saccharin", "salicylic acid",
  "serine", "squalene", "stearic acid", "styrene", "sucrose", "sulfuric acid",
  "sulfur dioxide", "tartaric acid", "terpinene", "terpineol", "testosterone",
  "tetrahydrofuran", "tetrahydrocannabinol", "thiophene", "threonine",
  "thymol", "toluene", "toluol", "trimethylamine", "tryptophan", "tyrosine",
  "undecane", "urea", "valeric acid", "vanillin", "vinyl chloride",
  "xylene", "xylitol", "xylose", "zinc chloride",
]

const MIXED = [
  "banana peel", "orange peel", "lemon zest", "coffee grounds", "green apple",
  "red wine", "white wine", "rosé wine", "dark chocolate", "white chocolate",
  "milk chocolate", "butter", "margarine", "lard", "bacon grease",
  "chicken stock", "beef broth", "fish stock", "vegetable broth", "tomato paste",
  "ketchup", "mayonnaise", "ranch dressing", "caesar dressing", "vinaigrette",
  "olive oil", "coconut oil", "canola oil", "peanut oil", "avocado oil",
  "ghee", "clarified butter", "buttermilk", "yogurt", "greek yogurt",
  "sour cream", "crème fraîche", "cream cheese", "ricotta", "mozzarella",
  "parmesan", "pecorino", "gorgonzola", "brie", "camembert", "swiss cheese",
  "gruyère", "smoked cheese", "goat cheese", "feta", "halloumi",
  "pepperoni", "salami", "prosciutto", "ham", "bacon", "sausage",
  "hot dog", "bratwurst", "chorizo", "jerky", "beef jerky", "turkey",
  "chicken", "duck", "goose", "lamb", "pork", "veal", "venison", "rabbit",
  "bison", "elk", "crab", "lobster", "shrimp", "prawn", "scallop", "oyster",
  "clam", "mussel", "squid", "octopus", "anchovy", "sardine", "tuna", "salmon",
  "trout", "cod", "halibut", "mackerel", "herring", "eel", "tilapia", "bass",
  "catfish", "carp", "pike", "perch", "walleye", "caviar", "roe",
]

const CLASS_QUERIES = [
  "aldehyde", "ketone", "alcohol", "ether", "ester", "amine", "thiol",
  "alkene", "alkane", "aromatic compound", "carboxylic acid", "phenol",
  "terpene", "furan", "lactone", "sulfide", "disulfide", "mercaptan",
  "sulfur compound", "nitrogen compound", "chlorinated compound",
  "halogen", "volatile organic compound", "fermentation", "sweetener",
  "essential oil", "fragrance", "perfume", "solvent", "cleaning product",
  "combustion product", "plant volatile", "fruit ester", "roasting",
  "caramelization", "Maillard reaction", "smoking", "curing", "brewing",
  "fermentation", "spoilage", "decay", "rot", "rancidity", "oxidation",
]

// Element names must not resolve via did-you-mean noise. Only elements with a
// real pinned compound (the inert gases) are allowed a local match; any match
// for the rest must be an exact (>= 100) pinned hit, not a fuzzy guess.
const ELEMENTS = [
  "krypton", "xenon", "radon", "helium", "neon", "scandium", "titanium",
  "vanadium", "chromium", "manganese", "cobalt", "nickel", "copper", "zinc",
  "gallium", "germanium", "arsenic", "selenium", "rubidium", "strontium",
  "yttrium", "zirconium", "niobium", "molybdenum", "technetium", "ruthenium",
  "rhodium", "palladium", "silver", "cadmium", "indium", "tin", "antimony",
  "tellurium", "cesium", "barium", "lanthanum", "cerium", "praseodymium",
  "neodymium", "samarium", "europium", "gadolinium", "terbium", "dysprosium",
  "holmium", "erbium", "thulium", "ytterbium", "lutetium", "hafnium",
  "tantalum", "tungsten", "rhenium", "osmium", "iridium", "platinum",
  "gold", "mercury", "thallium", "lead", "bismuth", "polonium", "astatine",
  "francium", "radium", "actinium", "thorium", "protactinium", "uranium",
  "neptunium", "plutonium", "americium", "curium", "berkelium", "californium",
  "einsteinium", "fermium", "mendelevium", "nobelium", "lawrencium",
  "rutherfordium", "dubnium", "seaborgium", "bohrium", "hassium", "meitnerium",
  "darmstadtium", "roentgenium", "copernicium", "nihonium", "flerovium",
  "moscovium", "livermorium", "tennessine", "oganesson",
]

const NONSENSE = [
  "asdfghjkl", "zxqwerty", "florp", "gleep", "xylph", "qwertyuiop",
  "zzzzzz", "aaaaaa", "blorpt", "snarfle", "wonkabot", "fizzwidget",
]

// Known false-positive traps from the substring/fuzzy noise investigation.
// These must stay empty (no match at all). "pear" and "blecch" are excluded:
// pear is now a real composite, and blecch resolves to "bleach" at edit
// distance 1 (correct did-you-mean).
const FALSE_POSITIVE_TRAPS = [
  "gold", "gol", "curium", "cesium", "cerium", "holmium", "thulium", "rhenium",
  "copper",
]

const MISSPELL = [
  "cinnomon", "cinnamin", "vinnila", "vanila", "bananna", "banan",
  "ethanal", "actone", "acetn", "gasolin", "garli", "vinigar", "vinega",
  "choclate", "choclate", "eucaliptus", "eucalyptus", "lavander", "lavenda",
  "cittronella", "citonella", "skunk", "suphur", "sulfur", "sulfer",
  "blech", "blecch", "amonia", "ammonia", "amoniac", "clorine", "clorine bleach",
  "perfume", "perfurm", "alcohol", "alcahol", "methonol", "methanol",
  "propanol", "isopropal", "naptha", "naphtha", "turpentin", "turpentine",
]

// Distance-2 typos intentionally not fuzzy-resolved (the did-you-mean fallback
// is capped at a single edit so it cannot suggest unrelated lookalikes).
// These fall through to the live PubChem path or a graceful miss.
const MISSPELL_DOCUMENTED_GAPS = [
  "vinnila", "acetn", "lavenda", "suphur", "sulfer", "amoniac", "perfurm",
  "propanol", "isopropal", "naptha",
]

describe("stress coverage (local)", () => {
  it("everyday coverage stays within documented gaps", () => {
    const unresolved = EVERYDAY.filter((q) => searchSubstances(q).length === 0)
    console.log(`[EVERYDAY] ${EVERYDAY.length} queries, ${unresolved.length} unresolved locally:`, unresolved.join(" | "))
    expect([...new Set(unresolved)].sort()).toEqual([...EVERYDAY_DOCUMENTED_GAPS].sort())
  }, 30_000)

  it("real chemical names never resolve via did-you-mean", () => {
    const viaFuzzy: string[] = []
    const unresolved: string[] = []
    for (const q of CHEMICALS) {
      const r = searchSubstances(q)
      if (r.length === 0) unresolved.push(q)
      else if (r[0].score < 40) viaFuzzy.push(`${q}->${r[0].name}(${r[0].score})`)
    }
    console.log(
      `[CHEMICALS] ${CHEMICALS.length} queries, ${unresolved.length} unresolved locally (all are real compounds resolvable via live PubChem):`,
      unresolved.join(" | "),
    )
    console.log(`[CHEMICALS-viaFuzzy] ${viaFuzzy.join(" | ")}`)
    // A real chemical name resolving to a different compound via did-you-mean
    // (score 35) is misdirection and must never happen.
    expect(viaFuzzy).toEqual([])
  }, 30_000)

  it("mixed food/kitchen coverage is complete", () => {
    const unresolved = MIXED.filter((q) => searchSubstances(q).length === 0)
    console.log(`[MIXED] ${MIXED.length} queries, ${unresolved.length} unresolved locally:`, unresolved.join(" | "))
    expect(unresolved).toEqual([])
  }, 30_000)

  it("class/fragment coverage is complete", () => {
    const unresolved = CLASS_QUERIES.filter((q) => searchSubstances(q).length === 0)
    console.log(`[CLASS] ${CLASS_QUERIES.length} queries, ${unresolved.length} unresolved locally:`, unresolved.join(" | "))
    expect(unresolved).toEqual([])
  }, 30_000)

  it("element names only match via exact pinned compounds, never fuzzy", () => {
    const noisy: string[] = []
    const matched: string[] = []
    for (const q of ELEMENTS) {
      const r = searchSubstances(q)
      if (r.length === 0) continue
      matched.push(q)
      if (r[0].score < 100) noisy.push(`${q}->${r[0].name}(${r[0].score})`)
    }
    console.log(`[ELEMENTS] ${ELEMENTS.length} queried, ${matched.length} matched locally:`, matched.join(" | "))
    expect(noisy).toEqual([])
  }, 30_000)

  it("nonsense never matches", () => {
    const hit = NONSENSE.filter((q) => searchSubstances(q).length > 0)
    console.log(`[NONSENSE] ${NONSENSE.length} queried, ${hit.length} spuriously matched:`, hit.join(" | "))
    expect(hit).toEqual([])
  })

  it("known false-positive traps stay dead", () => {
    const hit = FALSE_POSITIVE_TRAPS.filter((q) => searchSubstances(q).length > 0)
    console.log(`[TRAPS] ${FALSE_POSITIVE_TRAPS.length} queried, ${hit.length} matched:`, hit.join(" | "))
    expect(hit).toEqual([])
  })

  it("misspelling resolution stays within documented gaps", () => {
    const unresolved = MISSPELL.filter((q) => searchSubstances(q).length === 0)
    console.log(`[MISSPELL] ${MISSPELL.length} queries, ${unresolved.length} unresolved locally:`, unresolved.join(" | "))
    expect([...new Set(unresolved)].sort()).toEqual([...MISSPELL_DOCUMENTED_GAPS].sort())
  }, 30_000)

  it("full chain smoke on all resolved everyday hits", () => {
    const bad: string[] = []
    for (const q of [...EVERYDAY, ...MIXED]) {
      const r = searchSubstances(q, 1)
      if (r.length === 0) continue
      try {
        const v = resolveAndRun(r[0].id, r[0].kind, {})
        if (!v?.entityId) bad.push(`${q}:no-entity`)
      } catch (e) {
        bad.push(`${q}:${String(e)}`)
      }
    }
    console.log(`[CHAIN] smoke failures: ${bad.length}`, bad.slice(0, 20).join(" | "))
    expect(bad).toEqual([])
  }, 30_000)
})
