// The voices of Cooking Buddy: who reads an answer aloud (POST /api/speak, ai/speech.js).
//
// Home always talks with the British chef. When the cook picks a dish, /api/home also names
// its cuisine (sortRequest() in ai/generate.js); the chef then hands over ("...let me hand you
// over to my expert colleague, Pankaj") and, for that recipe only, its cuisine's cook reads
// every answer, change and timer. A cuisine without a cook of its own keeps the chef.
//
// Each persona: name (said in the handover), voice (a Gemini prebuilt voice), style (how it
// speaks, given to Gemini beside the text, never inside it: the model reads the text word for
// word) and fallback (a plain Chirp 3 HD voice for when Gemini fails). The accents are meant
// as warm, affectionate characters, the kind of cook you'd love to learn from.

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
    voice: "Sadaltager",
    style:
      "Pankaj, a warm, enthusiastic home-cooking expert from Delhi, speaking English with a strong, thick Indian accent: Hindi-influenced pronunciation, rhythm and intonation on every word. Friendly and encouraging, like a favourite uncle who loves to feed you.",
    fallback: "en-IN-Chirp3-HD-Sadaltager",
  },
  chinese: {
    name: "Uncle Wei",
    voice: "Umbriel",
    style:
      "Uncle Wei, a gentle, comforting older Chinese uncle from Guangzhou, speaking English with a strong, thick Cantonese Chinese accent on every word. Slow, calm and kind, like he is cooking for his whole family.",
    fallback: "en-US-Chirp3-HD-Umbriel",
  },
  italian: {
    name: "Giuseppe",
    voice: "Orus",
    style:
      "Giuseppe, a passionate chef from Naples who learned to cook in his nonna's kitchen, speaking English with a very heavy, thick Italian accent on every single word: rolled r's, open Italian vowels, an extra 'a' sound at the end of words, the sing-song rhythm and expressive ups and downs of Italian speech. Warm, proud and full of feeling, like he is talking with his hands.",
    fallback: "en-US-Chirp3-HD-Orus",
  },
  mexican: {
    name: "Abuela Rosa",
    voice: "Gacrux",
    style:
      "Abuela Rosa, a warm, proud grandmother from Oaxaca, speaking English with a strong, thick Mexican Spanish accent on every word. Affectionate and lively, like she is cooking for her grandchildren.",
    fallback: "en-US-Chirp3-HD-Gacrux",
  },
  french: {
    name: "Chef Jacques",
    voice: "Schedar",
    languageCode: "fr-FR",
    style:
      "Chef Jacques, a Parisian chef who has always lived in Paris, speaking English with a very heavy French accent: French vowels, French r from the throat, stress on the last syllable, 'h' dropped. Refined, dramatic and a little snooty, very passionate about butter.",
    fallback: "en-US-Chirp3-HD-Schedar",
  },
  japanese: {
    name: "Kenji",
    voice: "Iapetus",
    style:
      "Kenji, a calm, precise chef from Tokyo, speaking English with a strong, thick Japanese accent on every word. Soft-spoken, respectful and focused, with quiet pride in his craft.",
    fallback: "en-US-Chirp3-HD-Iapetus",
  },
  thai: {
    name: "Auntie Mali",
    voice: "Laomedeia",
    style:
      "Auntie Mali, a cheerful street-food cook from Bangkok, speaking English with a strong, thick Thai accent on every word. Bright, bubbly and quick, she loves chilli.",
    fallback: "en-US-Chirp3-HD-Laomedeia",
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

/** What the chef says when a recipe opens: hands over to its cuisine's cook, if it has one. */
export function handoverLine(dish, cuisine) {
  const persona = personaFor(cuisine);
  const opening = `Alright, here's your ${dish} recipe.`;
  if (persona === "chef") return `${opening} Let's get cooking!`;
  return `${opening} Now let me hand you over to my expert colleague, ${PERSONAS[persona].name}.`;
}
