export type TranscriptionInput = {
  audioFileBuffer: Buffer;
  mimeType: string;
};

export type TranscriptionOutput = {
  text: string;
};
