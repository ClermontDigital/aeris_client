export class RelayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly correlationId: string | null,
    public readonly action: string,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}
