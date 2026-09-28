/**
 * Accent-aware gym ASR substitutions.
 *
 * PRIMARY (Kenneth): Southern US + General American
 *   - pin/pen, th→d/f, gonna/finna/y'all fillers
 *   - drawled numbers (eighdy→80, faw→4, tree→3, twenny→20)
 *   - standard GA Whisper gym mishits (prest, carl, squad)
 *
 * Also covers (lighter): British/non-rhotic, Spanish-influenced b/v,
 * South Asian English epenthesis — applied after Southern/GA maps.
 *
 * Applied early in correctGymTranscript, before Kenneth PHRASE_FIXES,
 * so accent-normalized tokens still hit existing gym recoveries.
 */

/** @type {Array<[RegExp, string]>} */
export const ACCENT_FIXES = [
  // =====================================================================
  // Stub + "a set(s) of" + digit → exercise (Whisper dropped the lift name)
  // MUST run before "a sets" → "4 sets" so "by a sets of 40…" stays bicep.
  // "X press a set of" before bare stubs (lag press ≠ lag → curl).
  // =====================================================================
  [/\b(?:lag|lake|lead|led|like|lack|leak|left|league|egg|black|legs?)\s+press(?:es|ed|t)?\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'leg press'],
  [/\b(?:calf|cal|caf|half|cough|cahf|cat|cap|cast)\s+press(?:es|ed|t)?\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'calf press'],
  [/\b(?:bens?|binged|binge|beach|bench|binch|bent|vench)\s+press(?:es|ed|t)?\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'bench press'],
  [/\b(?:by|bi|bye|buy)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'bicep curl'],
  [/\b(?:caf|calf|cal|half|cough|cahf)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'calf press'],
  [/\b(?:i\s+)?have\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'calf press'],
  [/\b(?:lag|lake|lead|led|like|lack|leak|neck|deck|egg)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'leg curl'],
  [/\b(?:bens?|binged|binge|beach|bench|binch|bent|vench|pen|pin)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'bench press'],
  [/\b(?:squads?|squats?|scott)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'squat'],
  [/\b(?:rdls?|ardeals?)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'romanian deadlift'],
  [/\b(?:ohps?)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'overhead press'],
  [/\b(?:deads?)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'deadlift'],
  [/\b(?:glutes?|glue|flute|glut|clute|loot)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'glute machine'],
  // Pec deck before deck→curl confusion
  [/\bpeck?\s+decks?\b/gi, 'pec deck'],
  [/\bpact\s+decks?\b/gi, 'pec deck'],
  [/\bpack\s+decks?\b/gi, 'pec deck'],
  // Whisper: sets → "sex" (very common)
  [/\bfor\s+a\s+sex\s+of\b/gi, '4 sets of'],
  [/\ba\s+sex\s+of\b/gi, '4 sets of'],
  [/\bsex\s+of\b/gi, 'sets of'],
  [/\bsex\s+of\s+(\d+)/gi, 'sets of $1'],
  // Word before "sets" is a set-count number (for/fore Whisper ≈ four)
  [/\bfor\s+sets\b/gi, '4 sets'],
  [/\bfore\s+sets\b/gi, '4 sets'],
  // Safari Heard: seats ≈ sets (set-count)
  [/\bfor\s+seats?\b/gi, '4 sets'],
  [/\bfore\s+seats?\b/gi, '4 sets'],
  [/\b(\d+)\s+seats?\b/gi, '$1 sets'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+seats?\b/gi, '$1 sets'],
  [/\bseats?\s+of\b/gi, 'sets of'],
  // Singular "set" after a set-count ("four set" / "4 set") → sets
  [/\b(\d+)\s+set\b(?!\s+of)/gi, '$1 sets'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+set\b(?!\s+of)/gi, '$1 sets'],
  // Safari Heard: cents ≈ sets (set-count; Southern/GA Whisper)
  [/\bfor\s+cents?\b/gi, '4 sets'],
  [/\bfore\s+cents?\b/gi, '4 sets'],
  [/\b(\d+)\s+cents?\b/gi, '$1 sets'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+cents?\b/gi, '$1 sets'],
  [/\bcents?\s+of\b/gi, 'sets of'],
  // Safari Heard: sense/senses ≈ sets (soft-s Whisper)
  [/\bfor\s+senses?\b/gi, '4 sets'],
  [/\bfore\s+senses?\b/gi, '4 sets'],
  [/\b(\d+)\s+senses?\b/gi, '$1 sets'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+senses?\b/gi, '$1 sets'],
  [/\bsenses?\s+of\b/gi, 'sets of'],
    // Safari Heard soft end: "10 or so" / "10 or four" / "10 reps or set" ≈ 10 reps · 4 sets
  // (or so / or set ≈ for/four sets; do not touch "or sets of")
  [/\b(pounds?|lbs?|kg)\s+(\d+)\s+or\s+so\b/gi, '$1 $2 reps 4 sets'],
  [/\b(pounds?|lbs?|kg)\s+(\d+)\s+or\s+(?:four|for|fore)\b/gi, '$1 $2 reps 4 sets'],
  [/\b(pounds?|lbs?|kg)\s+(\d+)\s+or\s+sets?\b(?!\s+of)/gi, '$1 $2 reps 4 sets'],
  [/\b(\d+)\s+reps?\s+or\s+so\b/gi, '$1 reps 4 sets'],
  [/\b(\d+)\s+reps?\s+or\s+sets?\b(?!\s+of)/gi, '$1 reps 4 sets'],
  [/\b(\d+)\s+or\s+so\b(?=\s*$)/gi, '$1 reps 4 sets'],
  [/\b(\d+)\s+or\s+sets?\b(?!\s+of)(?=\s*$)/gi, '$1 reps 4 sets'],
  [/\b(\d+)\s+or\s+(?:four|for|fore)\b(?=\s*$)/gi, '$1 reps 4 sets'],
  // Safari Heard: "torn ends" ≈ twenty lbs (weight missing)
  [/\b(?:torn|tore|tour|twenny|twenty)\s+(?:ends?|ands?)\b/gi, '20 pounds'],
[/\bfree\s+sets\b/gi, '3 sets'],
  [/(?<!\b(?:by|bi|bye|buy)\s)\ba\s+sets\b/gi, '4 sets'],
  // =====================================================================
  // Conversational ASR family (Southern/GA look-ahead): I said/I say + lift
  // MUST run before bare calves→calf press and similar token rewrites.
  // I-said + curl(s) → bicep even when Whisper inserts hallucinated "leg/lag"
  // before curl. Real "leg curl" WITHOUT I-said prefix is untouched.
  // =====================================================================
  [/\b(?:i(?:['’]?ve|\s+have)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:(?:lags?|legs?)\s+)?curls?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|raps?|wraps?|cents?|syllables?|symbols?|simples?|settles?|seats?))/gi, 'bicep curl'],
  [/\b(?:i(?:['’]?ve|\s+have)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:(?:lags?|legs?)\s+)?curls?\b/gi, 'bicep curl'],
  [/\b(?:i(?:['’]?ve)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:calves?|cafs?|halfs?)\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'calf press'],
  [/\b(?:i(?:['’]?ve)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:squads?|squats?)\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'squat'],
  [/\b(?:i(?:['’]?ve)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:bens?|bench|beach|binged|vench)(?:\s+press(?:es)?)?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'bench press'],
  [/\b(?:i(?:['’]?ve)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:lags?|legs?)\s+press(?:es)?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'leg press'],
  // Leftover conversational lead-in before a known lift (after partial rewrites)
  [/\b(?:i(?:['’]?ve)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?=bicep|calf|squat|leg|bench|deadlift|glute|press|curl)/gi, ''],
  [/\bin\s+cline\b/gi, 'incline'],
  [/\bde\s+cline\b/gi, 'decline'],
  [/\bseat\s+ed\b/gi, 'seated'],
  // Row Whisper class: rose/roe/roll/rho after row stems (before rear-delt→machine / pendlay alias)
  [/\bpendlay\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, 'pendlay row'],
  [/\b(barbell|dumbbell|cable)\s+rear\s+delt\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, '$1 rear delt row'],
  [/\brear\s+delt\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, 'rear delt row'],
  [/\bone[\s-]?handed\s+cable\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, 'one-handed cable row'],
  [/\bsmith(?:\s+machine)?\s+one[\s-]?handed\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, 'smith machine one-handed row'],
  [/\b(barbell|dumbbell|cable|seated|bent[\s-]?over|t[\s-]?bar|kettlebell|landmine|ring)\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, '$1 row'],
  [/\b(?:roll|roe|rho|rose)\s+machines?\b/gi, 'row machine'],
  [/\brows?\s+machines?\b/gi, 'row machine'],
  [/\bsquash(?:es)?\s+jerks?\b/gi, 'squat jerk'],

  // =====================================================================
  // Southern US + General American — fillers
  // =====================================================================
  [/\by['’]?all\b/gi, ''],
  [/\bfixin['’]?\s+to\s+do\b/gi, ''],
[/\bfixin['’]?\s+to\b/gi, ''],
[/\bfixin\b/gi, ''],
  [/\bfinna\s+do\b/gi, ''],
  [/\bfinna\b/gi, ''],
  [/\bgonna\s+(?:log|do)\b/gi, ''],
  [/\bgonna\b/gi, ''],
  [/\bwanna\s+(?:log|do)\b/gi, ''],
  [/\bwanna\b/gi, ''],
  [/\bimma\b/gi, ''],
  [/\bi'?m\s+a\b/gi, ''],
  [/\blemme\b/gi, ''],
  [/\bgimme\b/gi, ''],
  [/\bplease\s+log\b/gi, ''],
  // Conversational lead-in (Whisper often inserts before equipment name)
  [/\bit\s+s\s+okay\b/gi, ''],
  [/\bit['’]?s\s+okay\b/gi, ''],
  [/\bits\s+okay\b/gi, ''],
  [/\bit\s+is\s+okay\b/gi, ''],
  // please add → handled in gymTranscript STRUCTURAL_FIXES (number-aware)
  [/\b(?:please\s+)?log(?:\s+a)?\b/gi, ''],
  [/\btryina\b/gi, ''],
  [/\btryin['’]?\s+to\b/gi, ''],
  [/\bmight\s+could\b/gi, ''],
  [/\breckon\b/gi, ''],

  // =====================================================================
  // Southern US + GA — drawled / reduced number words
  // =====================================================================
  // Compound drawls FIRST (before bare fife→5, fiddy→50, hunnert→100)
  [/\bfife[\s-]?teen\b/gi, '15'],
  [/\bfifeteen\b/gi, '15'],
  [/\bfaw[\s-]?(?:hunnerts?|hunnerds?|hundreds?)\b/gi, '400'],
  [/\bfoe?[\s-]?(?:hunnerts?|hunnerds?|hundreds?)\b/gi, '400'],
  [/\bthriddy\b/gi, '30'],
  [/\btoo[\s-]?fiddy\b/gi, '250'],
  [/\btwo[\s-]?fiddy\b/gi, '250'],
  [/\btoo[\s-]?fifty\b/gi, '250'],
  [/\btwo[\s-]?fifty\b(?=\s*(?:pounds?|lbs?|kg|for|at|sets?|reps?|x|$))/gi, '250'],
  [/\bfor\s+tree\b/gi, 'for 3'],
  // ones
  [/\bfaw\b/gi, '4'],
  [/\bfoe?\b(?=\s+(?:sets?|reps?|of|at|times|x|pounds?|lbs?))/gi, '4'],
  [/\bfivee?\b(?=\s+(?:sets?|reps?|of|at|pounds?|lbs?))/gi, '5'],
  [/\bfife\b/gi, '5'],
  [/\bsix\b(?=\s+(?:sets?|reps?|of|at|times|x))/gi, '6'], // keep word; numeric contexts only via below
  [/\bsebm\b/gi, '7'],
  [/\bseb'?m\b/gi, '7'],
  [/\bate\b(?=\s+(?:sets?|reps?|of|at|times|x|pounds?|lbs?))/gi, '8'],
  [/\bnine\b(?=\s+(?:sets?|reps?|of|at|times|x))/gi, '9'],
  // teens / special
  [/\bleben\b/gi, '11'],
  [/\bleven\b/gi, '11'],
  [/\btwelve\b(?=\s+(?:sets?|reps?|of|at|times|x))/gi, '12'],
  [/\bthirt'?een\b/gi, '13'],
  [/\bfawteen\b/gi, '14'],
  [/\bforteen\b/gi, '14'],
  [/\bfifteen\b(?=\s*(?:pounds?|lbs?|kg)\b)/gi, '15'],
  // tens (Southern drawl spellings Whisper often emits)
  [/\btwenny\b/gi, '20'],
  [/\btwunni\b/gi, '20'],
  [/\btwenty\b(?=\s*(?:pounds?|lbs?|kg|sets?|reps?|for|at|x))/gi, '20'],
  [/\bthurdy\b/gi, '30'],
  [/\bthirdy\b/gi, '30'],
  [/\bthuty\b/gi, '30'],
  [/\bdirty\b(?=\s*(?:pounds?|lbs?|kg|for|sets?|reps?|x|at))/gi, '30'],
  [/\bthirty\b(?=\s*(?:pounds?|lbs?|kg|sets?|reps?|for|at|x))/gi, '30'],
  [/\bfawty\b/gi, '40'],
  [/\bfawdy\b/gi, '40'],
  [/\bforty\b(?=\s*(?:pounds?|lbs?|kg|sets?|reps?|for|at|x))/gi, '40'],
  [/\bfiddy\b/gi, '50'],
  [/\bfifdy\b/gi, '50'],
  [/\bfifty\b(?=\s*(?:pounds?|lbs?|kg))/gi, '50'],
  [/\bsixdy\b/gi, '60'],
  [/\bsixty\b(?=\s*(?:pounds?|lbs?|kg|sets?|reps?|for|at|x))/gi, '60'],
  [/\bsevendy\b/gi, '70'],
  [/\bsebendy\b/gi, '70'],
  [/\bseventy\b(?=\s*(?:pounds?|lbs?|kg|sets?|reps?|for|at|x))/gi, '70'],
  [/\beighdy\b/gi, '80'],
  [/\beady\b(?=\s*(?:pounds?|lbs?|kg|for|at|sets?|reps?))/gi, '80'],
  [/\beighty\b(?=\s*(?:pounds?|lbs?|kg|sets?|reps?|for|at|x|$))/gi, '80'],
  [/\bninedy\b/gi, '90'],
  [/\bnined?y\b/gi, '90'],
  [/\bnined?\b(?=\s*(?:pounds?|lbs?|kg|for|sets?|reps?|$))/gi, '90'],
  [/\bhunnert\b/gi, '100'],
  [/\bhunnerd\b/gi, '100'],
  [/\bhundred\b(?=\s*(?:pounds?|lbs?|kg|and))?/gi, '100'],

  // th→t/d/f number openings (tree/free = three)
  [/\btree\s+sets?\b/gi, '3 sets'],
  [/\btree\s+reps?\b/gi, '3 reps'],
  [/\btree\b(?=\s+(?:sets?|reps?|of|at|times|x))/gi, '3'],
  [/\bfree\s+sets?\b/gi, '3 sets'],
  [/\bfree\b(?=\s+(?:sets?|reps?|of|at))/gi, '3'],

  // fifteen/fifty disambiguation near sets-of / for
  [/\bsets?\s+of\s+fiddy\b/gi, 'sets of 50'],
  [/\bsets?\s+of\s+fifty\b/gi, 'sets of 50'],
  [/\bsets?\s+of\s+fifteen\b/gi, 'sets of 15'],
  [/\bninety\b(?=\s*(?:pounds?|lbs?|kg|sets?|reps?|for|at|x|$))/gi, '90'],
  [/\bfifteen\b(?=\s*(?:pounds?|lbs?|kg|sets?|reps?|for|at|x|$))/gi, '15'],
  [/\bfor\s+fiddy\b/gi, 'for 50'],
  [/\bfor\s+fifty\b(?!\s+pounds?)/gi, 'for 15'],
  [/\bfor\s+fifteen\b/gi, 'for 15'],
  [/\bat\s+fiddy\b/gi, 'at 50'],
  [/\bat\s+fifty\b/gi, 'at 50'],
  [/\bat\s+eighdy\b/gi, 'at 80'],
  [/\bat\s+eighty\b/gi, 'at 80'],
  [/\bat\s+fawty\b/gi, 'at 40'],
  [/\bat\s+twenny\b/gi, 'at 20'],

  // =====================================================================
  // Southern US + GA — th→d/f in Kenneth gym phrases
  // =====================================================================
  [/\bboth\s+dat\s+the\s+man\b/gi, 'both that the man'],
[/\bdat\s+the\s+man\b/gi, 'that the man'],
[/\bda\s+man\b/gi, 'the man'],
  [/\bbofe?\b(?=\s+(?:that|the|dat|da))/gi, 'both'],
  [/\bwit\b(?=\s+(?:the|da|dat)\s+man)/gi, 'with'],

  // =====================================================================
  // Southern US + GA — pin/pen, vowel mergers, gym Whisper mishits
  // =====================================================================
  // pin/pen: "pen press" almost never intentional → bench press
  // Whisper one-word: bench press → pinterest / pintrest / pin terest (NOT Pin Press)
  [/\bpinterest\b/gi, 'bench press'],
  [/\bpintrest\b/gi, 'bench press'],
  [/\bpinteres\b/gi, 'bench press'],
  [/\bpin\s+terest\b/gi, 'bench press'],
  [/\bpin\s+interest\b/gi, 'bench press'],
  [/\bpinter\s+est\b/gi, 'bench press'],
  [/\bpin[\s-]+trest\b/gi, 'bench press'],
  [/\bpen\s+press(?:es)?\b/gi, 'bench press'],
  [/\bpin\s+press(?:es)?\b/gi, 'bench press'],
  // calf mergers (Southern often cough/calf; GA Whisper cahf/cal)
  [/\bcough\s+press(?:es)?\b/gi, 'calf press'],
  [/\bcough\s+raises?\b/gi, 'calf raise'],
  [/\bcahf\s+press(?:es)?\b/gi, 'calf press'],
  [/\bcahf\s+raises?\b/gi, 'calf raise'],
  [/\bcaf\s+raises?\b/gi, 'calf raise'],
  [/\bcal\s+raises?\b/gi, 'calf raise'],
  [/\bhalf\s+raises?\b/gi, 'calf raise'],
  [/\bseeded\s+roses?\b/gi, 'seated row'],
  [/\bseated\s+roses?\b/gi, 'seated row'],
  [/\bseeded\b/gi, 'seated'],
  // Qualifier + girl/pearl/carl/cull → that equipment's curl (class; before bare girl→leg)
  [/\b(wrist|barbell|dumbbell|ez|ez\s*bar|preacher|hammer|cable|machine|bicep|biceps|bayesian|concentration|spider|incline|decline|seated|standing|reverse|kettlebell|jefferson|overhead)\s+(?:girls?|pearls?|carls?|culls?|kernels?)\b/gi, '$1 curl'],
  [/\bcahfs?\b/gi, 'calf'],
  [/\bcal\s+press(?:es)?\b/gi, 'calf press'],
  // glute mergers (glue/flute/gloot already reinforced in PHRASE_FIXES)
  [/\bgloot(?:s)?\s+machines?\b/gi, 'glute machine'],
  [/\bgloots?\b(?=\s+(?:\d|for|at|sets?|machine))/gi, 'glute'],
  [/\bglue\s+machines?\b/gi, 'glute machine'],
  [/\bflute\s+machines?\b/gi, 'glute machine'],
  // r-linking / reduction (GA Whisper)
  [/\bsquad\s+goals?\b/gi, 'squat'],
  [/\bsquat\s+goals?\b/gi, 'squat'],
  [/\bsquad(?:s)?\b/gi, 'squat'],
  [/\blunch(?:es)?\b(?=\s+(?:\d|for|at|sets?|reps?|pounds?|lbs?))/gi, 'lunge'],
  [/\bscott(?:s)?\b(?=\s+(?:\d|for|at|sets?|reps?|pounds?))/gi, 'squat'],
  [/\bcarl(?:s)?\b(?=\s+(?:\d|for|at|sets?|reps?|pounds?|of))/gi, 'curl'],
  [/\bcull(?:s)?\b(?=\s+(?:\d|for|at|sets?|reps?|pounds?))/gi, 'curl'],
  [/\bprest\b/gi, 'press'],
  [/\bpresss+\b/gi, 'press'],
  [/\bfur\b(?=\s+\d)/gi, 'for'],
  [/\bta\b(?=\s+\d)/gi, 'to'],
  // "ought" as "at" in drawled speech near weights
  [/\bought\s+(\d+)/gi, 'at $1'],
  [/\boughta?\b/gi, ''],
  [/\bpahnds?\b/gi, 'pounds'],

  // =====================================================================
  // Secondary: Spanish-influenced b/v (keep; lower priority)
  // =====================================================================
  [/\bvench\s+press(?:es)?\b/gi, 'bench press'],
  [/\bvenchpress\b/gi, 'bench press'],
  [/\bvench\b/gi, 'bench'],
  [/\bvence\s+press(?:es)?\b/gi, 'bench press'],
  [/\bvib\s+curl(?:s)?\b/gi, 'bicep curl'],
  [/\bvicep(?:s)?\s+curl(?:s)?\b/gi, 'bicep curl'],
  [/\bvice\s+curl(?:s)?\b/gi, 'bicep curl'],
  // Whisper: bicyclo / bicycle / bysicle / sickle / byceps ≈ bicep curl (not bicycle crunch)
  [/\b(?:bicyclo|bysicle|bysickle|bi[\s-]?cycles?|by[\s-]?cycles?|bicycles?)\s+curls?\b/gi, 'bicep curl'],
  [/\b(?:bicyclo|bysicle|bysickle|bi[\s-]?cycles?|by[\s-]?cycles?|bicycles?)\b(?!\s+crunch)(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?|symbols?|simples?|settles?|curls?))/gi, 'bicep curl'],
  [/\b(?:by|bi|buy|bye)\s+sickles?(?:\s+curls?)?\b/gi, 'bicep curl'],
  [/\b(?:byceps?|by\s+ceps?|bi\s+ceps?)(?:\s+curls?)?\b/gi, 'bicep curl'],
  [/\bbicep(?:s)?\s+girls?\b/gi, 'bicep curl'],
  [/\b(?:by|bi|bye|buy)\s+(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\b/gi, 'bicep curl $1 $2'],
  [/\bcalves?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?))/gi, 'calf press'],
  [/\b(?:lag|lake|lead|like|lack)\s+(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\b/gi, 'leg curl $1 $2'],
  // Whisper: "syllables" / "symbols" / "simples" / "settles" ≈ "sets of"
  // Optional "of" between mangled set-word and reps (4 syllables of 10)
  [/\b(\d+)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+of\s+(\d+)\b/gi, '$1 sets of $2'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+of\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|\d+)\b/gi, '$1 sets of $2'],
  [/\b(\d+)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+(\d+)\b/gi, '$1 sets of $2'],
  [/\b(\d+)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty)\b/gi, '$1 sets of $2'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|\d+)\b/gi, '$1 sets of $2'],
  [/\b(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+(\d+)\b/gi, 'sets of $1'],
  [/\bfor\s+ate\b/gi, 'for 8'],
  [/\bate\b(?=\s+for\b)/gi, '8'],
  // GA/Southern Whisper: bi/by/bye/buy curls ≈ bicep curl
  // Dropped "curls": by/bi/bye/buy + a set of + digit (also at top of ACCENT_FIXES)
  [/\b(?:by|bi|bye|buy)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'bicep curl'],
  [/\b(?:by|bi|bye|buy)\s+curl(?:s)?\b/gi, 'bicep curl'],
  // Whisper / Safari Heard: bye|by|bi + seth|sep (+ curl) ≈ bicep curl
  [/\b(?:by|bi|bye|buy)\s+(?:seth|septh|sep|cept?s?)\s+curl(?:s)?\b/gi, 'bicep curl'],
  [/\b(?:by|bi|bye|buy)\s+(?:seth|septh|sep)\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|raps?|wraps?|cents?|syllables?|seats?))/gi, 'bicep curl'],
  [/\b(?:by|bi|bye|buy)curl(?:s)?\b/gi, 'bicep curl'],

  // Safari Heard / Whisper: buy/by + some + cars/curls/cards ≈ bicep curl
  // (bicep curls → "buy some cars"; never invent "Buy Some Cars" equipment)
  [/\b(?:buy|by|bi|bye)\s+(?:some|sum)\s+(?:cars?|curls?|cards?|carts?)\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'bicep curl'],
  [/\b(?:buy|by|bi|bye)\s+(?:some|sum)\s+(?:cars?|curls?|cards?|carts?)\b/gi, 'bicep curl'],
  [/\bboys?\s+and\s+(?:cars?|curls?|cards?|carts?)\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'bicep curl'],
  [/\bboys?\s+and\s+(?:cars?|curls?|cards?|carts?)\b/gi, 'bicep curl'],
  // Whisper: buzz/bus/buz lip (curls) ≈ bicep curl
  [/\b(?:buzz|buz|bus)\s+lip\s+curl(?:s)?\b/gi, 'bicep curl'],
  [/\b(?:buzz|buz|bus)\s+lips?\b/gi, 'bicep'],
  [/\bbusy\s+lip\s+curl(?:s)?\b/gi, 'bicep curl'],
  [/\bbusy\s+lips?\b/gi, 'bicep'],
  [/(?<!\bbusy\s)(?<!\bbuzz\s)(?<!\bbuz\s)(?<!\bbus\s)\blip\s+curl(?:s)?\b/gi, 'bicep curl'],
  // Wild brand/noun class (mirror shared/gymTranscript PHRASE_FIXES)
  [/\bvisa\s+curl(?:s)?\b/gi, 'bicep curl'],
    [/\bbusy\s+lips?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|curls?))/gi, 'bicep'],
  [/\bguest\s+press(?:es)?\b/gi, 'chest press'],
  [/\boverheard\s+press(?:es)?\b/gi, 'overhead press'],
  [/\bover\s+bread(?:\s+press(?:es)?)?\b/gi, 'overhead press'],
  [/\bfacebook\s+pulls?\b/gi, 'face pull'],
  [/\bfacebook\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?))/gi, 'face pull'],
  [/\bsquad\s+goals?\b/gi, 'squat'],
  [/\bsquash(?:es)?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?|jerks?))/gi, 'squat'],
  [/\bdeadlines?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?))/gi, 'deadlift'],
  [/\bdead\s+leafs?\b/gi, 'deadlift'],
  [/\bdead\s+leaves?\b/gi, 'deadlift'],
    [/\bcedar\s+(?:rows?|rolls?)\b/gi, 'seated row'],
  // Safari Heard / Whisper: isa/ice/eyes/iza/issa curls ≈ bicep curl
  [/\b(?:isa|ice|eyes|iza|issa)\s+curl(?:s)?\b/gi, 'bicep curl'],
  [/\b(?:isa|iza|issa)curls?\b/gi, 'bicep curl'],

  // =====================================================================
  // More GA/Southern gym Whisper mishits (Kenneth + commercial machines)
  // =====================================================================
  [/\btry\s+cep\b/gi, 'tricep'],
  [/\btri\s+cep\b/gi, 'tricep'],
  [/\btryceps?\b/gi, 'tricep'],
  [/\bbye\s+cep\b/gi, 'bicep'],
  [/\bbuy\s+cep\b/gi, 'bicep'],
  [/\bbycep\b/gi, 'bicep'],
  [/\bbicepts?\b/gi, 'bicep'],
  [/\btricepts?\b/gi, 'tricep'],
  [/\bskull\s+crusher?s?\b/gi, 'skull crusher'],
  [/\bscull\s+crushers?\b/gi, 'skull crusher'],
  [/\bschool\s+crushers?\b/gi, 'skull crusher'],
  // Calf Extension is its own catalog entry — do not collapse to calf press
  [/\bhalf\s+extension\b/gi, 'calf extension'],
  [/\bglute\s+kick\s+back\b/gi, 'glute kickback'],
  [/\bouter\s+thighs?\b/gi, 'hip abduction'],
  [/\binner\s+thighs?\b/gi, 'hip adduction'],
  [/\byes\s+no\s+machines?\b/gi, 'hip abduction'],
  [/\bpecks?\s+decks?\b/gi, 'pec deck'],
  [/\bbutter\s+flies?(?!\s+machines?)\b/gi, 'pec deck'],
  [/\blat\s+pull\s+downs?\b/gi, 'lat pulldown'],
  [/\bface\s+poles?\b/gi, 'face pull'],
  [/\bfaith\s+poles?\b/gi, 'face pull'],
  [/\bover\s+head\s+press(?:es)?\b/gi, 'overhead press'],
  [/\bmilitary\s+press(?:es)?\b/gi, 'military press'],
  [/\bromeanian\b/gi, 'romanian'],
  [/\bromeanian\s+dead\b/gi, 'romanian deadlift'],
  [/\bdead\s+lifts?\b/gi, 'deadlift'],
  [/\bsquads?\b(?=\s+(?:\d|for|at|sets?|reps?|pounds?))/gi, 'squat'],
  [/\bshrugs?\b(?=\s+(?:\d|for|at|sets?|reps?|pounds?))/gi, 'shrug'],
  [/\bfarmers?\s+walks?\b/gi, "farmer's walk"],
  [/\bkettle\s+bell\b/gi, 'kettlebell'],
  [/\breps?\s+and\s+sets?\b/gi, 'reps'],
  [/\bsets?\s+and\s+reps?\b/gi, 'sets'],
  // pounds mishears
  [/\bpowns?\b/gi, 'pounds'],
  [/\bpowns?d\b/gi, 'pounds'],
  [/\bpouns?\b/gi, 'pounds'],
  [/\blbs\b/gi, 'lbs'],

  // =====================================================================
  // Cardio / Stair Step Machine Whisper class (diaper≈stepper; plots≈flights)
  // =====================================================================
  [/\bstairs?\s+diapers?(?:\s+machines?)?\b/gi, 'stair step machine'],
  [/\bstair\s+diapers?(?:\s+machines?)?\b/gi, 'stair step machine'],
  [/\bplots?\s+of\s+stairs?\b/gi, 'flights of stairs'],
  [/\b((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))\s+plots?\b/gi, '$1 flights'],

  // =====================================================================
  // Secondary: South Asian / syllable-timed epenthesis
  // =====================================================================
  [/\bleg[\s-]+a[\s-]+press(?:es)?\b/gi, 'leg press'],
  [/\bleg[\s-]+uh[\s-]+press(?:es)?\b/gi, 'leg press'],
  [/\blega\s*press(?:es)?\b/gi, 'leg press'],
  [/\bleg[\s-]+a[\s-]+curl(?:s)?\b/gi, 'leg curl'],
  [/\bleg[\s-]+uh[\s-]+curl(?:s)?\b/gi, 'leg curl'],
  [/\bcurl[\s-]+uh\b/gi, 'curl'],
  [/\bcurl[\s-]+a\b(?=\s|$|\d)/gi, 'curl'],
  [/\bpress[\s-]+uh\b/gi, 'press'],
  [/\bsquat[\s-]+uh\b/gi, 'squat'],
  [/\bbench[\s-]+a[\s-]+press(?:es)?\b/gi, 'bench press'],
  [/\blat[\s-]+a[\s-]+pull[\s-]*downs?\b/gi, 'lat pulldown'],
  [/\bhip[\s-]+a[\s-]+bductions?\b/gi, 'hip abduction'],
  [/\bhip[\s-]+a[\s-]+dductions?\b/gi, 'hip adduction'],
]

/**
 * Apply accent substitutions (order matters; longer patterns first in the list).
 * @param {string} text
 * @returns {string}
 */
export function applyAccentFixes(text) {
  let out = String(text ?? '')
  for (const [re, rep] of ACCENT_FIXES) {
    out = out.replace(re, rep)
  }
  return out.replace(/\s+/g, ' ').trim()
}
