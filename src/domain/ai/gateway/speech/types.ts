export type SpeechInput = {
  /** Plain text to read out (no markup). */
  text: string;
};

export type SpeechOutput = {
  /** OGG/Opus, what Telegram plays as a voice message. */
  audio: Buffer;
  mimeType: 'audio/ogg';
};
