/**
 * An error the player caused and can fix, as opposed to a bug. Routes render these
 * as a message rather than a 500, so the distinction has to live somewhere shared.
 */
export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
    this.status = 400;
  }
}
