/** A sale the till refuses before anything is stored (the cashier is still at the register and can fix it). */
export class PosSaleValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PosSaleValidationError'
  }
}
