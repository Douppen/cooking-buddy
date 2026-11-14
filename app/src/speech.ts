// Reads answers aloud through the glasses speaker (speechSynthesis plays there on Ray-Ban
// Display). The answer is always on screen too, so speech failing is never fatal. The cook
// can turn voice off on home (RecipesContext sets it); then speak() does nothing.

let voiceOn = true;

export function setVoiceOn(on: boolean): void {
  voiceOn = on;
  if (!on) stopSpeaking();
}

export function speak(text: string): void {
  if (!voiceOn) return;
  if (typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
}
