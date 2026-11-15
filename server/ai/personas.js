// The voices of Cooking Buddy: who reads an answer aloud (POST /api/speak, ai/speech.js).
//
// Home always talks with the British chef. When the cook picks a dish, /api/home also names
// its cuisine (sortRequest() in ai/generate.js); the chef then hands over ("...let me hand you
// over to my expert colleague, Pankaj") and, for that recipe only, its cuisine's cook reads
// every answer, change and timer. A cuisine without a cook of its own keeps the chef.
//
// Each persona: name and his/her (said in the handover; the app's ask field shows "Ask Pankaj" from its
// own copy of the names, COOKS in app/src/speech.ts: change both), then its character voice, either
//   voice + style (+ languageCode): a Gemini prebuilt voice; the style says how it speaks
//     (given beside the text, never inside it: the model reads the text word for word), and
//     languageCode helps the accent stick (Babushka Olga's "ru-RU"), or
//   chirp: a native-language Chirp 3 HD voice ({ voice, languageCode?, speakingRate? }),
// optionally after rewrite: an instruction for Gemini to respell the text the way the cook
//   pronounces it (Kenji's katakana), for accents a style alone can't make;
// and fallback: a plain Chirp 3 HD voice reading the original text when the character fails.
// Picked on 2026-11-15 by ear and with an AI rater (Gemini judging each sample's accent and
// how easy it is to follow): describing an accent left Kenji, Uncle Wei and Auntie Mali
// sounding American or British. The accents are meant as warm, affectionate characters, the
// kind of cook you'd love to learn from.

import { CUISINES } from "../models/domain.js";

export const PERSONAS = {
  chef: {
    name: "the British chef",
    voice: process.env.TTS_VOICE ?? "Algenib",
    style:
      process.env.TTS_STYLE ??
      "An energetic, passionate British chef, warm but a bit cheeky, with a deep bass voice and a British accent.",
    fallback: process.env.TTS_FALLBACK_VOICE ?? "en-GB-Chirp3-HD-Charon",
  },
  indian: {
    name: "Pankaj",
    his: "his",
    voice: "Sadaltager",
    style:
      "Pankaj, a warm, enthusiastic home-cooking expert from Delhi, speaking English with a strong, thick Indian accent: Hindi-influenced pronunciation, rhythm and intonation on every word. Friendly and encouraging, like a favourite uncle who loves to feed you.",
    fallback: "en-IN-Chirp3-HD-Sadaltager",
  },
  chinese: {
    name: "Uncle Wei",
    his: "his",
    // Respelled, then read by a Mandarin voice. Plain English in that voice, or Gemini told
    // he's Chinese, sounded American.
    rewrite:
      "Respell the English text phonetically, in Latin letters, the way a gentle older man from China with a heavy Chinese accent pronounces it, but keep it understandable: 'th' becomes 'd' or 's' ('the' → 'de', 'then' → 'den'), final consonants are soft or followed by a short 'uh' ('hot' → 'hot-uh', 'wok' → 'wok-uh'), 'r' sometimes becomes 'l', 'v' becomes 'w'. Keep numbers, amounts and units understandable. Keep the punctuation. Output only the respelled text.",
    chirp: { voice: "cmn-CN-Chirp3-HD-Umbriel" },
    fallback: "en-US-Chirp3-HD-Umbriel",
  },
  italian: {
    name: "Giuseppe",
    his: "his",
    voice: "Orus",
    style:
      "Giuseppe, a passionate chef from Naples who learned to cook in his nonna's kitchen, speaking English with a very heavy, thick Italian accent on every single word: rolled r's, open Italian vowels, an extra 'a' sound at the end of words, the sing-song rhythm and expressive ups and downs of Italian speech. Warm, proud and full of feeling, like he is talking with his hands.",
    fallback: "en-US-Chirp3-HD-Orus",
  },
  mexican: {
    name: "Abuela Rosa",
    his: "her",
    voice: "Gacrux",
    style:
      "Abuela Rosa, a warm, proud grandmother from Oaxaca, speaking English with a strong, thick Mexican Spanish accent on every word. Affectionate and lively, like she is cooking for her grandchildren.",
    fallback: "en-US-Chirp3-HD-Gacrux",
  },
  french: {
    name: "Chef Jacques",
    his: "his",
    // Plain English read by a French voice: the most reliably French (Gemini with fr-FR
    // varied, and sounded "performed" when asked to be dramatic).
    chirp: { voice: "fr-FR-Chirp3-HD-Schedar" },
    fallback: "en-US-Chirp3-HD-Schedar",
  },
  japanese: {
    name: "Kenji",
    his: "his",
    // Katakana English read by a Japanese voice, the cook's pick. Content words in katakana,
    // small everyday words left in English: a little milder and easier to follow than all
    // katakana, with the quick Japanese rhythm (and a touch faster).
    rewrite:
      "Rewrite the English text for a Japanese voice: write the content words (nouns, verbs, adjectives, numbers) in katakana the way a Japanese person pronounces English (e.g. 'cutlet' → カツレツ, 'golden' → ゴールデン, 'minute' → ミニット), but keep the small everyday English words as plain English (the, a, it, is, and, then, for, to, of, before, until). Keep every word, in the same order, separated by spaces; use 、 and 。 for pauses. Output only the text.",
    chirp: { voice: "ja-JP-Chirp3-HD-Iapetus", speakingRate: 1.06 },
    fallback: "en-US-Chirp3-HD-Iapetus",
  },
  thai: {
    name: "Auntie Mali",
    his: "her",
    // Plain English read by a Thai voice: clearly Thai and easy to follow.
    chirp: { voice: "th-TH-Chirp3-HD-Laomedeia" },
    fallback: "en-US-Chirp3-HD-Laomedeia",
  },
  eastern_european: {
    name: "Babushka Olga",
    his: "her",
    voice: "Sulafat",
    languageCode: "ru-RU",
    style:
      "Babushka Olga, a warm, strict and loving grandmother from Eastern Europe who has always lived there, with a very heavy Russian accent: rolled r's, hard consonants, 'th' as 'z' or 'd', 'w' as 'v', no articles. Caring and a little bossy.",
    // A Polish voice reading English sounds Eastern European on its own.
    fallback: "pl-PL-Chirp3-HD-Sulafat",
  },
  american: {
    name: "Bubba",
    his: "his",
    voice: "Fenrir",
    languageCode: "en-US",
    style:
      "Bubba, a big, friendly hillbilly from the Appalachian mountains of Tennessee, with a very thick Southern redneck drawl and a nasal twang: long stretched vowels, 'I' as 'ah', dropped g's, slow and easygoing, loud and folksy, loves his cast-iron skillet.",
    fallback: "en-US-Chirp3-HD-Fenrir",
  },
};

// Every cuisine the sorting can name is either a persona or "other" (the chef).
for (const cuisine of CUISINES) {
  if (cuisine !== "other" && !PERSONAS[cuisine]) throw new Error(`no persona for cuisine ${cuisine}`);
}

// Recipes saved before cuisines existed: Italian dishes in the title still get Giuseppe. Only
// clearly Italian words, not ingredients used everywhere (parmesan, basil, olive oil).
const ITALIAN = new RegExp(
  "\\b(" +
    [
      "italian", "italy", "pasta", "spaghetti", "linguine", "fettuccine", "tagliatelle", "pappardelle", "penne",
      "rigatoni", "fusilli", "farfalle", "orecchiette", "bucatini", "lasagnas?", "lasagne", "ravioli", "tortellini",
      "gnocchi", "risottos?", "carbonara", "bolognese", "amatriciana", "cacio e pepe", "puttanesca", "arrabbiata",
      "alfredo", "pesto", "pizzas?", "calzones?", "focaccia", "ciabatta", "bruschetta", "caprese", "minestrone",
      "osso buco", "saltimbocca", "piccata", "parmigiana", "marsala", "tiramisu", "panna cotta", "cannoli",
      "gelato", "affogato", "arancini", "polenta", "prosciutto", "antipasto", "panzanella", "frittata",
      "cacciatore", "carpaccio", "biscotti", "limoncello", "stromboli", "chicken parm", "eggplant parm",
    ].join("|") +
    ")\\b",
  "i",
);

/**
 * Who reads an answer: the recipe's cuisine's cook, else (older recipes without a cuisine)
 * Giuseppe when `context` (the recipe title) is clearly Italian, else the British chef. Home
 * sends neither, so home is always the chef.
 * @returns {keyof typeof PERSONAS}
 */
export function personaFor(cuisine, context = "") {
  if (cuisine && PERSONAS[cuisine] && cuisine !== "chef") return cuisine;
  if (!cuisine && context && ITALIAN.test(context)) return "italian";
  return "chef";
}

/**
 * What the chef says when a recipe opens: hands over to its cuisine's cook, if it has one.
 * About half the time it adds "This dish is his specialty.", so the handover doesn't always
 * sound the same. `random` is there for tests.
 */
export function handoverLine(dish, cuisine, random = Math.random) {
  const persona = personaFor(cuisine);
  const opening = `Alright, here's your ${dish} recipe.`;
  if (persona === "chef") return `${opening} Let's get cooking!`;
  const { name, his } = PERSONAS[persona];
  const handover = `${opening} Now let me hand you over to my expert colleague, ${name}.`;
  return random() < 0.5 ? `${handover} This dish is ${his} specialty.` : handover;
}
