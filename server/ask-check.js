// Ask real questions through /api/ask (this calls Gemini and costs a fraction of a cent).
//   node ask-check.js [base-url] [--image photo.jpg]
//   npm run ask -- https://cook.simonnars.com
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const args = process.argv.slice(2);
const imageFlag = args.indexOf("--image");
const imagePath = imageFlag >= 0 ? args.splice(imageFlag, 2)[1] : null;
const base = args[0] ?? "http://localhost:8787";
// A fixed test recipe (the app has no built-in recipes; the AI writes them).
const recipe = JSON.parse(readFileSync(new URL("./fixtures/buttermilk-pancakes.json", import.meta.url)));

const image = imagePath && {
  mime_type: { ".png": "image/png", ".webp": "image/webp" }[extname(imagePath).toLowerCase()] ?? "image/jpeg",
  data: readFileSync(imagePath).toString("base64"),
};

const questions = image
  ? [{ step_index: 5, question: "Is this pancake ready to flip?", image }]
  : [
      // Whole-recipe questions, as the glasses app asks them (no step_index).
      { question: "How much butter?" },
      { question: "What can I use instead of buttermilk?" },
      { question: "How long does this take in total?" },
      { question: "How much butter if I make 2 servings?", servings: 2 },
      // A question about one step still works for clients that send step_index.
      { step_index: 3, question: "Is it okay if the batter is lumpy?" },
    ];

for (const q of questions) {
  const started = performance.now();
  const res = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipe, ...q }),
  });
  const body = await res.json();
  const total = Math.round(performance.now() - started);
  if (!res.ok) {
    console.log(`${res.status} after ${total} ms | ${q.question} -> ${JSON.stringify(body)}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`${total} ms total (${body.ms} ms in ${body.model}) | ${q.question} -> ${body.answer}`);
}
