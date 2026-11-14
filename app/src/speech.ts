// Reads answers aloud through the glasses speaker (speechSynthesis plays there on Ray-Ban
// Display). The answer is always on screen too, so speech failing is never fatal.

export function speak(text: string): void {
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
